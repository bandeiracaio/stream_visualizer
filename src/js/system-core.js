// System core: a trade system is one JSON object (context, region, trigger, thesis, exit, risk). SYSTEM.facts() turns the Reader engine's inputs into one snapshot a second;
// SYSTEM.create(def).step(snapshot) answers with intents (enter / exit / invalidate / skip). The core never fills: the caller reports fills (filled / closed).
// Pure: no DOM, timers, storage, Date.now() or Math.random(). Causal: at second t it reads only what was known at t. The work per step does not grow with the length of the run.
// Loaded by the page (live) and by design-harness.mjs (replay), so one file decides the trades. Spec: .scratch/trader/spec.md section 3, prompt .scratch/trader/prompts/03-system-core.md.
// Since R2 the system itself (validate, id, size, and one running system: step, filled, closed, cancelled, end, force, state) runs in WebAssembly (rust/crates/sv-system, loaded by wasm-loader.js as SVWASM);
// the signatures, results and thrown messages are the ones the JS version had (that version is src/js/js-cores/system-core.js, SYSTEM_JS, and `node parity.mjs system` compares the two).
// facts() stays here: it drives the Reader engine (READER_ENGINE, JS) and reads its sigma, price history and episode groups, so it moves with the engine (R6). A system instance lives inside the module and is
// addressed by a handle; create() returns the same object as before (def, id, step, ...) plus dispose(), which frees the instance at once (it is also freed when the object is collected). A Rust runner (R3) owns the instances itself.
// Inputs go in as JSON: a non-finite number or undefined in a snapshot reads as absent (null); the self-test and the real recordings never have one.
const SYSTEM = (() => {
  "use strict";
  const FACTS_VERSION = 2;      // bump when the snapshot a second changes shape or meaning (the harness caches snapshots under it)
  const V = ["bn", "hl"];
  const OPT = { latencyMs: 0, staleMs: 3000, maxGapMs: 30000, flowWindowSec: 1800, minFlowReadings: 30, minRoomBps: 0.2 };      // the figures live in the Rust crate; this copy is for callers (RUNNER reads staleMs)
  const sideDir = s => s === "buy" || s === "bid" ? 1 : s === "sell" || s === "ask" ? -1 : 0;
  const EMPTY = Object.freeze([]);
  const wasm = (fn, o) => SVWASM.call("system_" + fn, o);
  const en = x => typeof x === "number" ? (Object.is(x, -0) ? "-0" : isFinite(x) ? x : String(x)) : x;      // JSON has no NaN, Infinity or -0: those travel as their text

  // ---------- definition: validate and id ----------
  const validate = def => wasm("validate", def);
  // short hash of venue, context, region, trigger, thesis (dir and invalidation), exit and risk: not name, stage or thesis text
  const id = def => wasm("id", def);
  // position size for a fixed risk per trade: the loss at the stop equals equity x riskFrac
  const de = x => typeof x === "string" ? (x === "-0" ? -0 : Number(x)) : x;
  const size = (equity, riskFrac, stopBps, price) => { const r = wasm("size", { equity: en(+equity), riskFrac: en(+riskFrac), stopBps: en(+stopBps), price: en(+price) }); return { qty: de(r.qty), notional: de(r.notional), risk: de(r.risk) }; };

  // ---------- facts: the engine's inputs to one snapshot a second ----------
  // A snapshot: {t, px:{bn,hl}, sigma:{bn,hl}, age:{bn,hl} (ms since that venue's last quote), q:{bn,hl} (that quote as {bid, ask}, null when none; added in FACTS_VERSION 2, the runner fills at it), calibrated, flow:{bn:{buy,sell,liqBuy,liqSell},hl:..} (taker notional in (t-1 s, t]),
  //   imb:{bn:{5,20},hl:..} (book imbalance within 5 / 20 bps of the mid, -1..1, null when no book in the last 10 s), episodes:{new,ended,active}, state}.
  // episodes.new lists each Reader episode group in the first second it is seen, with the venue and side it has then (never revised); ended lists groups that ended; active those still going.
  // A second t is created when the engine first sees an input at or after t; price, sigma and the episode groups are taken from the engine at that moment. The taker flow, book and quote age of t are by the
  // inputs' own times, so the snapshot is completed (and returned) when an input at least lateMs (default 1000) after t arrives. The venues' clocks differ (Hyperliquid stamps lag Binance's by up to a second,
  // and in a busy session Binance's own trades, books and quotes arrive up to 5 s out of time order, and a recording backlog can be minutes late): input later than lateMs is missed by the second it belongs to. The page keeps the short default (a decision
  // waits for the facts); the harness replays with a long one (5 minutes) so a recorded session's facts are exactly what its timestamps say.
  // Nothing from after t enters t. flush() completes the seconds still waiting when the data ends.
  function imbalance(bids, asks, X) {
    let bb = -Infinity, ba = Infinity; for (const l of bids) if (l[0] > bb) bb = l[0]; for (const l of asks) if (l[0] < ba) ba = l[0];
    if (!(bb > 0) || !(ba < Infinity)) return null; const mid = (bb + ba) / 2; let sb = 0, sa = 0;
    for (const l of bids) if (l[0] >= mid * (1 - X / 1e4)) sb += l[1]; for (const l of asks) if (l[0] <= mid * (1 + X / 1e4)) sa += l[1];
    return sb + sa > 0 ? Math.round(1000 * (sb - sa) / (sb + sa)) / 1000 + 0 : null;      // + 0: a small negative rounds to -0, which JSON (the module takes JSON) and the saved snapshots write as 0; the snapshot says 0 in both
  }
  function facts(o) {
    const engine = o.engine, marketState = o.marketState || null, L = o.lateMs == null ? 1000 : o.lateMs;
    let last = -Infinity, seenT = -Infinity, frames = [], pend = new Map(), books = { bn: [], hl: [] }, quotes = { bn: [], hl: [] }, seen = new Map();
    const bucket = T => { let b = pend.get(T); if (!b) { b = { bn: [0, 0, 0, 0], hl: [0, 0, 0, 0] }; pend.set(T, b); } return b; };
    // the newest entry at or before T of a time-ordered list, dropping the ones it makes obsolete
    const ins = (arr, item, key) => { const k = key(item); let i = arr.length; while (i > 0 && key(arr[i - 1]) > k) i--; arr.splice(i, 0, item); };      // keep a list in time order even when the input arrives late
    const upTo = (arr, T, key) => { while (arr.length >= 2 && key(arr[1]) <= T) arr.shift(); return arr.length && key(arr[0]) <= T ? arr[0] : null; };
    function episodesAt(T, groups) {
      const nw = [], ended = [], active = [];
      for (const g of groups) {
        if (g.tDetected > T) continue;
        let r = seen.get(g.id);
        if (!r) { r = { id: g.id, family: g.family, venue: g.venues && g.venues.length > 1 ? (g.venues.includes("bn") ? "bn" : g.venues[0]) : g.venue, side: sideDir(g.aggressor || (g.wall && g.wall.side) || ""), tDetected: g.tDetected, ended: false }; seen.set(g.id, r); nw.push({ id: r.id, family: r.family, venue: r.venue, side: r.side, tDetected: r.tDetected }); }
        if (g.stage === "ended" && g.tEnd != null && g.tEnd <= T) { if (!r.ended) { r.ended = true; ended.push({ id: r.id, family: r.family, venue: r.venue, side: r.side, tDetected: r.tDetected, tEnd: g.tEnd }); } }
        else { r.ended = false; active.push({ id: r.id, family: r.family, venue: r.venue, side: r.side, tDetected: r.tDetected }); }
      }
      nw.sort((a, b) => a.tDetected - b.tDetected);
      return { new: nw, ended, active };
    }
    // the moment the engine makes second T (its first input at or after T): price, sigma and the episode groups are taken then, as the engine has them
    function capture() {
      const ts = new Set(), px = new Map();
      for (const v of V) { const h = engine.priceHistory(v); let k = h.length; while (k > 0 && h[k - 1][0] > seenT) k--; for (; k < h.length; k++) { ts.add(h[k][0]); px.set(h[k][0] + v, h[k][1]); } }
      if (!ts.size) return;
      const dbg = engine.debug(), groups = engine.episodeGroups(), cur = new Set(); for (const g of groups) cur.add(g.id);
      for (const k of Array.from(seen.keys())) if (!cur.has(k)) seen.delete(k);      // the engine trims old episodes; so does the memory of them
      for (const T of Array.from(ts).sort((a, b) => a - b)) {
        const f = { t: T, px: { bn: px.has(T + "bn") ? px.get(T + "bn") : null, hl: px.has(T + "hl") ? px.get(T + "hl") : null }, sigma: { bn: engine.sigmaPeek("bn"), hl: engine.sigmaPeek("hl") }, calibrated: !!dbg.isCalibrated(), episodes: episodesAt(T, groups) };
        frames.push(f); if (T > seenT) seenT = T;
      }
    }
    // the rest of second T by the inputs' own times: taker flow in (T-1 s, T], the newest book and quote at or before T
    function finish(f) {
      const T = f.t, fl = pend.get(T); f.age = {}; f.q = {}; f.flow = {}; f.imb = {};
      for (const v of V) {
        const q = upTo(quotes[v], T, x => x.t); f.age[v] = q == null ? null : T - q.t; f.q[v] = q == null ? null : { bid: q.bid, ask: q.ask };
        const w = fl && f.px[v] != null ? fl[v] : null; f.flow[v] = { buy: w ? w[0] : 0, sell: w ? w[1] : 0, liqBuy: w ? w[2] : 0, liqSell: w ? w[3] : 0 };
        const b = upTo(books[v], T, x => x.t); if (b && T - b.t <= 10000) { if (!b.i) b.i = { 5: imbalance(b.bids, b.asks, 5), 20: imbalance(b.bids, b.asks, 20) }; f.imb[v] = { 5: b.i[5], 20: b.i[20] }; } else f.imb[v] = { 5: null, 20: null };
      }
      f.state = marketState ? marketState(T) : null;
      pend.delete(T); for (const k of Array.from(pend.keys())) if (k < T) pend.delete(k);
      last = T; return f;
    }
    const drain = (out, ready) => { while (frames.length && ready(frames[0].t)) out.push(finish(frames.shift())); };
    // one input: apply it to the engine, note the seconds it creates, make the seconds old enough (an input with time x completes every second T with T + lateMs <= x), add it to the facts
    function run(x, applyEngine, applyFacts) {
      applyEngine(); capture();
      const out = []; drain(out, T => T + L < x);
      if (applyFacts) applyFacts();
      drain(out, T => T + L <= x);
      return out;
    }
    const api = {
      trade(tr) {
        if (!tr || typeof tr.t !== "number") return engine.onTrade(tr), EMPTY;
        return run(tr.t, () => engine.onTrade(tr), () => {
          if (!V.includes(tr.v) || !(tr.ntl > 0)) return; const T = Math.ceil(tr.t / 1000) * 1000; if (T <= last) return;      // later than lateMs after its own second: too late to count
          const f = bucket(T)[tr.v]; if (tr.liq) f[tr.side === "buy" ? 2 : 3] += tr.ntl; else f[tr.side === "buy" ? 0 : 1] += tr.ntl;      // same rule as the harness: any side but buy counts as sell
        });
      },
      quote(vn, t, bid, ask) { return run(t, () => engine.onQuote(vn, t, bid, ask), () => { if (V.includes(vn) && bid > 0 && ask > 0 && ask >= bid && t > 0) ins(quotes[vn], { t, bid, ask }, x => x.t); }); },
      book(vn, t, bids, asks) { return run(t, () => engine.onBook(vn, t, bids, asks), () => { if (V.includes(vn) && Array.isArray(bids) && Array.isArray(asks) && t > 0) ins(books[vn], { t, bids, asks, i: null }, x => x.t); }); },
      sweep(vn, t, side, ntl, levels) { return run(t, () => engine.onSweep(vn, t, side, ntl, levels)); },
      advance(t) { return run(t, () => engine.advance(t)); },
      // the data ended: make the seconds still waiting for their lateMs
      flush() { const out = []; drain(out, () => true); return out; },
      reset() { engine.reset(); last = -Infinity; seenT = -Infinity; frames = []; pend = new Map(); books = { bn: [], hl: [] }; quotes = { bn: [], hl: [] }; seen = new Map(); return EMPTY; },
      // an input record in the engine's recording format: ["t", trade], ["q", v, t, bid, ask], ["b", v, t, bids, asks], ["s", ...], ["a", t], ["x"]
      feed(r) {
        switch (r[0]) { case "t": return api.trade(r[1]); case "q": return api.quote(r[1], r[2], r[3], r[4]); case "b": return api.book(r[1], r[2], r[3], r[4]); case "s": return api.sweep(r[1], r[2], r[3], r[4], r[5]); case "a": return api.advance(r[1]); case "x": return api.reset(); }
        return EMPTY;
      },
      finalGroups() {      // end-of-run groups in a plain form (the harness's comparison mode feeds these)
        return engine.episodeGroups().map(g => ({ id: g.id, family: g.family, venue: g.venues && g.venues.length > 1 ? (g.venues.includes("bn") ? "bn" : g.venues[0]) : g.venue, side: sideDir(g.aggressor || (g.wall && g.wall.side) || ""), tDetected: g.tDetected, tEnd: g.tEnd, stage: g.stage }));
      },
    };
    return api;
  }

  // ---------- one system running ----------
  // the region's hi / lo are NaN until the box has a point; JSON carries that as null
  const fixState = s => { const r = s.region; if (r && "hi" in r) { if (r.hi === null) r.hi = NaN; if (r.lo === null) r.lo = NaN; } return s; };
  const reg = typeof FinalizationRegistry === "function" ? new FinalizationRegistry(h => { try { if (SVWASM.loaded) wasm("drop", { h }); } catch (e) { /* the module is gone */ } }) : null;
  // every instance of a runner takes the same snapshot object in the same second: its JSON text is written once (a snapshot is not changed after it is made)
  const texts = new WeakMap();
  const snapText = snap => { if (snap === null || typeof snap !== "object") return JSON.stringify(snap); let t = texts.get(snap); if (t === undefined) { t = JSON.stringify(snap); texts.set(snap, t); } return t; };
  function create(def, opt) {
    let made;
    try { made = wasm("create", { def, opt: opt === undefined ? null : opt }); } catch (e) { throw new Error(String(e && e.message).replace(/^wasm core system: /, "")); }      // "invalid system: ..." as before
    const h = made.h; let live = true;
    const api = {
      def, id: made.id,
      step: snap => SVWASM.callText("system_step", '{"h":' + h + ',"snap":' + snapText(snap) + '}'),
      // a forced (random-entry) signal for the next step, {t, side, venue?}; only an instance made with opt.forced or opt.signals takes it
      force: sig => { wasm("force", { h, sig }); },
      // the caller's fill of the entry: price and time. May answer with an exit (a range-level target with no room left is void: the entry is closed at once).
      filled: (px, t) => wasm("filled", { h, px: en(px), t: en(t) }),
      // the entry was not filled (no price, order refused): back to flat as if the signal had not been taken
      cancelled: () => { wasm("cancelled", { h }); },
      // the caller's fill of an exit: returns the finished trade
      closed: (px, t) => wasm("closed", { h, px: en(px), t: en(t) }),
      // the data ended (or the caller is shutting down): close what is open
      end: snap => wasm("end", { h, t: en(snap.t) }),
      state: () => fixState(wasm("state", { h })),
      // free the instance now (it is freed anyway when this object is collected); no call may follow
      dispose: () => { if (live) { live = false; if (reg) reg.unregister(api); wasm("drop", { h }); } },
    };
    if (reg) reg.register(api, h, api);
    return api;
  }

  // ---------- self-test: scenarios named system:* (the build runs them) ----------
  function selftest(READER) {
    const res = []; const ok = (name, c, detail) => res.push({ name: "system:" + name, ok: !!c, detail: c ? "" : String(detail || "") });
    const T0 = 1.7e12;
    const mk = (over, o2) => Object.assign({ name: "t", stage: "paper", venue: "bn", context: { type: "always" }, region: { type: "none" }, trigger: { type: "priceMove", lookSec: 10, m: 2 },
      thesis: { dir: "continuation", text: "x", invalidation: { type: "none" } }, exit: { type: "timed", holdSec: 30 }, risk: { stopK: 2, riskFrac: 0.01 } }, over, o2);
    // synthetic second: price per venue, sigma, flows, imbalance, groups
    const snap = (i, o) => Object.assign({ t: T0 + i * 1000, px: { bn: 100, hl: 100 }, sigma: { bn: 0.5, hl: 0.5 }, age: { bn: 100, hl: 100 }, calibrated: true,
      flow: { bn: { buy: 10, sell: 10, liqBuy: 0, liqSell: 0 }, hl: { buy: 10, sell: 10, liqBuy: 0, liqSell: 0 } }, imb: { bn: { 5: 0, 20: 0 }, hl: { 5: 0, 20: 0 } }, episodes: { new: [], ended: [], active: [] }, state: null }, o && o(i));
    // run a system over n seconds; px(i) gives bn price; fills at the snapshot price of the signal second +1 s, like a replay; returns {intents, trades}
    const run = (def, n, f, opt) => {
      const inst = create(def, opt), all = [], snaps = []; for (let i = 0; i < n; i++) snaps.push(snap(i, f));
      const priceAtT = (v, t) => { let r = null; for (const s of snaps) { if (s.t <= t && s.px[v] > 0) r = s.px[v]; } return r; };
      const trades = [];
      for (const s of snaps) {
        for (const it of inst.step(s)) {
          all.push(it);
          if (it.type === "enter") { const r = inst.filled(priceAtT(it.venue, it.tSig + 1000), it.tSig + 1000); for (const r2 of r) all.push(r2); }
          else if (it.type === "exit" || it.type === "invalidate") { const px = it.reason === "target" ? null : priceAtT(it.venue, it.tAt); if (px != null) { const tr = inst.closed(px, it.tAt); if (tr) trades.push(tr); } }
        }
      }
      return { inst, intents: all, trades, snaps };
    };
    const kinds = r => r.intents.map(x => x.type + (x.reason ? ":" + x.reason : ""));
    const ramp = (at, h) => i => ({ px: { bn: i < at ? 100 : 100 * (1 + h * 1e-4 * Math.min(i - at + 1, 5)), hl: 100 } });      // flat, then a move of h bps over 5 s
    // ----- validate and id
    ok("validate good system", validate(mk()).length === 0, validate(mk()).join("; "));
    ok("validate unknown trigger", validate(mk({ trigger: { type: "bogus" } })).some(s => /unknown trigger/.test(s)));
    ok("validate missing parameter", validate(mk({ trigger: { type: "priceMove", lookSec: 10 } })).some(s => /valid m/.test(s)));
    ok("validate region trigger needs a region", validate(mk({ trigger: { type: "rangeBreak", brkBps: 1, coolSec: 10 } })).some(s => /needs a region/.test(s)));
    ok("validate normalisation needs a reading", validate(mk({ trigger: { type: "episode", families: ["burst"] }, venue: "any", exit: { type: "normalisation", holdSec: 30 } })).some(s => /normalisation/.test(s)));
    ok("validate rangeLevel needs a region", validate(mk({ exit: { type: "rangeLevel", holdSec: 30, frac: 1 } })).some(s => /rangeLevel/.test(s)));
    ok("validate any venue only for episodes", validate(mk({ venue: "any" })).some(s => /venue/.test(s)) && validate(mk({ venue: "any", trigger: { type: "episode", families: ["wall"] } })).length === 0);
    ok("validate context and invalidation", validate(mk({ context: { type: "hours", hours: [25] } })).length === 1 && validate(mk({ thesis: { dir: "fade", text: "", invalidation: { type: "region" } } })).some(s => /region/.test(s)));
    const base = mk(), b2 = Object.assign({}, base, { name: "other", stage: "demo", thesis: Object.assign({}, base.thesis, { text: "different words" }) });
    ok("id ignores name, stage and thesis text", id(base) === id(b2) && /^S[0-9a-f]{12}$/.test(id(base)), id(base) + " " + id(b2));
    ok("id changes with any parameter", id(base) !== id(mk({ trigger: { type: "priceMove", lookSec: 10, m: 2.1 } })) && id(base) !== id(mk({ venue: "hl" })) && id(base) !== id(mk({ risk: { stopK: 2, riskFrac: 0.02 } })) && id(base) !== id(mk({ thesis: { dir: "fade", text: "x", invalidation: { type: "none" } } })));
    // ----- sizing
    { const s = size(10000, 0.01, 20, 50000); ok("sizing: loss at the stop equals the risk", Math.abs(s.qty * 50000 * 20 / 1e4 - 100) < 1e-9 && Math.abs(s.notional - 50000) < 1e-9 && size(1, 0, 20, 5).qty === 0 && size(1, 0.01, 0, 5).qty === 0); }
    // ----- triggers: fire on a made case, quiet on a calm one
    const up = ramp(60, 30);
    { const r = run(mk(), 120, up), c = run(mk(), 120, () => ({})); ok("trigger priceMove fires on a jump, side up", r.intents.some(x => x.type === "enter" && x.dir === 1) && kinds(c).length === 0, kinds(r).join()); }
    { const r = run(mk({ thesis: { dir: "fade", text: "x", invalidation: { type: "none" } } }), 120, up); ok("thesis fade takes the other side", r.intents.find(x => x.type === "enter").dir === -1); }
    const prem = i => ({ px: { bn: 100, hl: i >= 100 && i < 130 ? 100.05 : 100 } });
    { const d = mk({ venue: "hl", trigger: { type: "premium", baseSec: 60, minBps: 2, coolSec: 20 } }), r = run(d, 160, prem), c = run(d, 160, () => ({})); ok("trigger premium fires when hl is rich, quiet when calm", r.intents.some(x => x.type === "enter" && x.tSig === T0 + 100000 && x.dir === 1) && kinds(c).length === 0, kinds(r).join()); }
    const flowF = i => ({ flow: { bn: { buy: i >= 100 && i < 130 ? 1000 : 12, sell: 10, liqBuy: 0, liqSell: 0 }, hl: { buy: 10, sell: 10, liqBuy: 0, liqSell: 0 } } });
    { const d = mk({ trigger: { type: "tradeFlow", lookSec: 10, share: 0.7, m: 3 } }), r = run(d, 160, flowF), c = run(d, 160, () => ({})), e = r.intents.find(x => x.type === "enter"); ok("trigger tradeFlow fires on a burst of buying, quiet when calm", e && e.dir === 1 && e.tSig >= T0 + 100000 && e.tSig <= T0 + 112000 && kinds(c).length === 0, kinds(r).join()); }
    { const d = mk({ trigger: { type: "tradeFlow", lookSec: 10, share: 0.7, m: 3 } }), r = run(d, 160, i => i < 20 ? ({ flow: { bn: { buy: 5000, sell: 10, liqBuy: 0, liqSell: 0 }, hl: { buy: 1, sell: 1, liqBuy: 0, liqSell: 0 } } }) : ({})); ok("tradeFlow is silent until 30 readings exist (no look-ahead median)", !r.intents.some(x => x.type === "enter" && x.tSig < T0 + 40000), kinds(r).join()); }
    const imbF = i => ({ imb: { bn: { 5: i >= 100 && i < 130 ? 0.7 : 0, 20: null }, hl: { 5: 0, 20: 0 } } });
    { const d = mk({ trigger: { type: "bookDepth", edge: 5, thr: 0.5, sustainSec: 5, coolSec: 30 } }), r = run(d, 160, imbF), c = run(d, 160, () => ({})); ok("trigger bookDepth needs the imbalance to hold, fires at the 5th second", r.intents.find(x => x.type === "enter") && r.intents.find(x => x.type === "enter").tSig === T0 + 104000 && kinds(c).length === 0, kinds(r).join()); }
    const box = i => ({ px: { bn: i < 400 ? 100 + 0.01 * Math.sin(i / 7) : 100.05, hl: 100 } });
    { const d = mk({ region: { type: "rangeBox", windowSec: 300 }, trigger: { type: "rangeBreak", brkBps: 1, coolSec: 30 } }), r = run(d, 480, box), c = run(d, 480, () => ({})); ok("trigger rangeBreak fires at the first second beyond the box, quiet inside it", r.intents.some(x => x.type === "enter" && x.tSig === T0 + 400000 && x.dir === 1) && kinds(c).length === 0, kinds(r).join()); }
    const touch = i => ({ px: { bn: i < 300 ? 100 + 0.01 * Math.sin(i / 11) : i < 330 ? 100.01 : i < 335 ? 100.01 - (i - 330) * 0.003 : 99.995, hl: 100 } });
    { const d = mk({ region: { type: "rangeBox", windowSec: 300 }, trigger: { type: "levelRejection", tolBps: 1, rejBps: 1, lookSec: 20, coolSec: 30 } }), r = run(d, 420, touch), d2 = mk({ region: { type: "rangeBox", windowSec: 300 }, trigger: { type: "levelRejection", tolBps: 1, rejBps: 50, lookSec: 20, coolSec: 30 } }); ok("trigger levelRejection fires after a pullback from the high, not when the pullback is too small", r.intents.some(x => x.type === "enter" && x.dir === 1) && run(d2, 420, touch).intents.every(x => x.type !== "enter"), kinds(r).join()); }
    const grp = (i0, side, fam, id) => i => i === i0 ? { episodes: { new: [{ id: id || "g1", family: fam || "burst", venue: "bn", side, tDetected: T0 + i0 * 1000 - 400 }], ended: [], active: [] } } : null;
    { const d = mk({ venue: "any", trigger: { type: "episode", families: ["burst"] } }), r = run(d, 100, grp(50, 1)), r2 = run(d, 100, grp(50, 1, "wall")), e = r.intents.find(x => x.type === "enter"); ok("trigger episode fires on a new group of the family with its own time, not on another family", e && e.dir === 1 && e.tSig === T0 + 49600 && e.venue === "bn" && !r2.intents.some(x => x.type === "enter"), kinds(r).join()); }
    // ----- contexts and skips
    { const d = mk({ context: { type: "sigmaBand", min: 1, max: 2 } }), r = run(d, 120, up); ok("context sigmaBand off: skip with the reason", r.intents.some(x => x.type === "skip" && x.reason === "context off") && !r.intents.some(x => x.type === "enter"), kinds(r).join()); const r2 = run(mk({ context: { type: "sigmaBand", min: 0.1, max: 2 } }), 120, up); ok("context sigmaBand on trades", r2.intents.some(x => x.type === "enter")); }
    { const hrs = new Date(T0 + 60000).getUTCHours(), r = run(mk({ context: { type: "hours", hours: [(hrs + 5) % 24] } }), 120, up), r2 = run(mk({ context: { type: "hours", hours: [hrs] } }), 120, up); ok("context hours", r.intents.some(x => x.reason === "context off") && r2.intents.some(x => x.type === "enter")); }
    { const d = mk({ context: { type: "marketState", states: ["quiet"] } }), a = run(d, 120, up), b = run(d, 120, i => Object.assign(up(i), { state: "wild" })), c = run(d, 120, i => Object.assign(up(i), { state: "quiet" })); ok("context marketState: no state means off with its reason, wrong state off, right state on", a.intents.some(x => x.reason === "context off") && a.inst.state().context.why === "no market state" && b.intents.some(x => x.reason === "context off") && c.intents.some(x => x.type === "enter"), a.inst.state().context.why); }
    { const r = run(mk(), 120, i => Object.assign(up(i), { calibrated: false })); ok("skip not calibrated", r.intents.some(x => x.reason === "not calibrated") && !r.intents.some(x => x.type === "enter")); }
    { const r = run(mk(), 120, i => Object.assign(up(i), { age: { bn: 9000, hl: 100 } })); ok("skip stale price", r.intents.some(x => x.reason === "stale price")); }
    { const d = mk({ venue: "any", trigger: { type: "episode", families: ["burst"] } }), r = run(d, 100, i => i === 50 ? { episodes: { new: [{ id: "a", family: "burst", venue: "bn", side: 1, tDetected: T0 + 50000 }, { id: "b", family: "burst", venue: "bn", side: 1, tDetected: T0 + 50000 }], ended: [], active: [] } } : null); ok("skip in position: a second signal while a trade is open", kinds(r).join() === "enter,skip:in position" || kinds(r).filter(x => x === "enter").length === 1 && kinds(r).includes("skip:in position"), kinds(r).join()); }
    { const d = mk({ region: { type: "rangeBox", windowSec: 300 }, exit: { type: "rangeLevel", holdSec: 60, frac: 1 }, venue: "any", trigger: { type: "episode", families: ["burst"] } }), r = run(d, 120, grp(10, 1)); ok("skip no region yet: a level exit before the region has a box", r.intents.some(x => x.reason === "no region yet") && !r.intents.some(x => x.type === "enter"), kinds(r).join()); }
    // ----- exits
    const E = (ex, f, over, n) => run(mk(Object.assign({ exit: ex }, over)), n || 200, f);
    const exitOf = r => r.intents.find(x => x.type === "exit" || x.type === "invalidate");
    { const r = E({ type: "timed", holdSec: 30 }, up); const x = exitOf(r); ok("exit time: at fill + hold, effective at that time", x && x.reason === "time" && x.tAt === T0 + 61000 + 30000, JSON.stringify(x)); }
    { const down = i => ({ px: { bn: i < 60 ? 100 : i < 62 ? 100.06 : 99.5, hl: 100 } }); const r = E({ type: "timed", holdSec: 120 }, down, { trigger: { type: "priceMove", lookSec: 10, m: 2 } }); const x = exitOf(r); ok("exit stop: a gap through the stop is filled at the tick price", x && x.reason === "stop" && x.px === 99.5, JSON.stringify(x)); }
    { const wave = i => ({ px: { bn: i < 60 ? 100 : i < 65 ? 100 + (i - 59) * 0.01 : i < 75 ? 100.05 + (i - 65) * 0.004 : 100.09, hl: 100 } }); const r = E({ type: "target", holdSec: 120, tpK: 0.2 }, wave, { risk: { stopK: 20, riskFrac: 0.01 } }); const x = exitOf(r); ok("exit target: a distance in bps, reached", x && x.reason === "target" && x.bps > 0, JSON.stringify(x)); }
    { const wave = i => ({ px: { bn: i < 60 ? 100 : i < 70 ? 100 + (i - 59) * 0.01 : 100.10 - (i - 69) * 0.003, hl: 100 } }); const r = E({ type: "trailing", holdSec: 120, trailK: 0.1 }, wave, { risk: { stopK: 20, riskFrac: 0.01 } }); const x = exitOf(r); ok("exit trail: gives back from the best price", x && x.reason === "trail", JSON.stringify(x)); }
    { const d = mk({ venue: "any", trigger: { type: "episode", families: ["burst"] }, exit: { type: "flowEpisode", holdSec: 100, families: ["burst"] } }), r = run(d, 200, i => i === 50 ? grp(50, 1)(50) : i === 70 ? { episodes: { new: [{ id: "g2", family: "burst", venue: "bn", side: -1, tDetected: T0 + 69800 }], ended: [], active: [] } } : i === 80 ? { episodes: { new: [{ id: "g3", family: "burst", venue: "bn", side: 1, tDetected: T0 + 79800 }], ended: [], active: [] } } : null), x = exitOf(r); ok("exit flow: an opposite-side episode on the venue closes the trade, a same-side one does not", x && x.reason === "flow" && x.t === T0 + 70000, JSON.stringify(x)); }
    { const calm = i => ({ flow: { bn: { buy: i >= 100 && i < 110 ? 1000 : 12, sell: 10, liqBuy: 0, liqSell: 0 }, hl: { buy: 10, sell: 10, liqBuy: 0, liqSell: 0 } } }), r = run(mk({ trigger: { type: "tradeFlow", lookSec: 10, share: 0.7, m: 3 }, exit: { type: "normalisation", holdSec: 100 } }), 200, calm), x = exitOf(r); ok("exit norm: the trigger's reading is back to normal", x && x.reason === "norm", kinds(r).join()); }
    { const d = mk({ region: { type: "rangeBox", windowSec: 300 }, trigger: { type: "rangeBreak", brkBps: 1, coolSec: 30 }, exit: { type: "rangeLevel", holdSec: 100, frac: 0.5 }, risk: { stopK: 50, riskFrac: 0.01 } }), r = run(d, 600, i => ({ px: { bn: i < 400 ? 100 + 0.1 * Math.sin(i / 7) : 100.3, hl: 100 } })); ok("exit rangeLevel: no room behind the fill voids the entry (the level is not beyond the price)", r.intents.some(x => x.type === "exit" && x.reason === "no room" && x.void), kinds(r).join()); }
    { const wave = i => ({ px: { bn: i < 60 ? 100 : 100 + (i - 59) * 0.002, hl: 100 } }); const d = mk({ region: { type: "rangeBox", windowSec: 30 }, trigger: { type: "priceMove", lookSec: 10, m: 1 }, exit: { type: "rangeLevel", holdSec: 100, frac: 1 }, risk: { stopK: 50, riskFrac: 0.01 } }), inst = create(d); ok("exit rangeLevel validates with a region", validate(d).length === 0 && !!inst); }
    { const inst = create(mk()); for (let i = 0; i < 70; i++) { const s = snap(i, up); for (const it of inst.step(s)) { if (it.type === "enter") inst.filled(100.3, it.tSig + 1000); } } const s2 = snap(120, up), a = inst.step(s2); ok("exit gap: no price for more than 30 s closes the trade", a.some(x => x.reason === "gap"), JSON.stringify(a)); }
    { const inst = create(mk()); for (let i = 0; i < 70; i++) { const s = snap(i, up); for (const it of inst.step(s)) if (it.type === "enter") inst.filled(100.3, it.tSig + 1000); } const a = inst.end(snap(71, up)); ok("exit end: the data ends with a trade open", a.length === 1 && a[0].reason === "end" && inst.state().position === null, JSON.stringify(a)); }
    // ----- invalidation
    { const d = mk({ trigger: { type: "priceMove", lookSec: 5, m: 1 }, thesis: { dir: "continuation", text: "x", invalidation: { type: "triggerReverses" } }, exit: { type: "timed", holdSec: 100 }, risk: { stopK: 50, riskFrac: 0.01 } });
      const down = i => ({ px: { bn: i < 60 ? 100 : i < 62 ? 100.03 : i < 75 ? 100.03 : 99.95, hl: 100 } }); const r = run(d, 200, down), x = exitOf(r); ok("invalidate triggerReverses: counted apart from stop", x && x.type === "invalidate" && x.reason === "invalidate" && x.why === "triggerReverses" && r.inst.state().counts.invalidate === 1 && !r.inst.state().counts.exit.stop, JSON.stringify(x) + kinds(r).join()); }
    { const d = mk({ venue: "any", trigger: { type: "episode", families: ["burst"] }, thesis: { dir: "continuation", text: "x", invalidation: { type: "episodeAgainst" } }, exit: { type: "timed", holdSec: 100 }, risk: { stopK: 50, riskFrac: 0.01 } });
      const r = run(d, 200, i => i === 50 ? grp(50, 1)(50) : i === 70 ? { episodes: { new: [{ id: "g2", family: "absorption", venue: "bn", side: -1, tDetected: T0 + 69800 }], ended: [], active: [] } } : null), x = exitOf(r); ok("invalidate episodeAgainst: an episode against the position appears", x && x.type === "invalidate" && x.why === "episodeAgainst", kinds(r).join());
      const r2 = run(d, 200, i => i === 50 ? Object.assign(grp(50, 1)(50), {}) : null); ok("invalidate episodeAgainst: quiet when nothing is against the trade", !r2.intents.some(x => x.type === "invalidate")); }
    { const d = mk({ region: { type: "rangeBox", windowSec: 300 }, trigger: { type: "rangeBreak", brkBps: 1, coolSec: 30 }, thesis: { dir: "continuation", text: "x", invalidation: { type: "region" } }, exit: { type: "timed", holdSec: 100 }, risk: { stopK: 50, riskFrac: 0.01 } });
      const r = run(d, 600, i => ({ px: { bn: i < 400 ? 100 + 0.01 * Math.sin(i / 7) : i < 410 ? 100.05 : 100, hl: 100 } })), x = exitOf(r); ok("invalidate region: price re-enters the box after a break trade", x && x.type === "invalidate" && x.why === "region", kinds(r).join()); }
    // ----- causality: the intents up to second N are the same whether the run stops at N or goes on
    { const f = i => ({ px: { bn: 100 + 0.05 * Math.sin(i / 9) + (i > 150 ? 0.1 : 0), hl: 100 } }), d = mk({ trigger: { type: "priceMove", lookSec: 5, m: 1 }, exit: { type: "timed", holdSec: 20 } }), a = run(d, 400, f), b = run(d, 250, f), cut = T0 + 249000;
      const sa = JSON.stringify(a.intents.filter(x => x.t <= cut)), sb = JSON.stringify(b.intents.filter(x => x.t <= cut)); ok("no look-ahead: intents up to second N are the same if the run stops at N", sa === sb && a.intents.length > 0, sa.slice(0, 200) + " | " + sb.slice(0, 200)); }
    // ----- state
    { const r = run(mk({ trigger: { type: "bookDepth", edge: 5, thr: 0.5, sustainSec: 5, coolSec: 30 } }), 102, imbF), s = r.inst.state(); ok("state: per part status with the reading against its threshold", s.trigger.reading === 0.7 && s.trigger.threshold === 0.5 && s.context.on === true && s.region.type === "none" && s.position === null && s.id === r.inst.id, JSON.stringify(s.trigger)); }
    { const r = run(mk(), 70, up), s = r.inst.state(); ok("state: an open position shows its levels", s.position && s.position.stopPx < s.position.entryPx && s.position.dir === 1 && !s.position.pending, JSON.stringify(s.position)); }
    // ----- facts from the Reader engine: one snapshot a second, ceil convention, flow in its own second, nothing from after
    if (READER) {
      const e = READER.create(), F = facts({ engine: e }), snaps = [], push = a => { for (const s of a) snaps.push(s); };
      const t0 = 1.7e12;
      for (let i = 0; i <= 5; i++) { push(F.quote("bn", t0 + i * 1000 + 500, 99.99, 100.01)); push(F.quote("hl", t0 + i * 1000 + 500, 99.99, 100.01)); }
      push(F.trade({ t: t0 + 7000, v: "bn", side: "buy", px: 100, q: 1, ntl: 100 })); push(F.trade({ t: t0 + 7400, v: "bn", side: "sell", px: 100, q: 1, ntl: 40 }));
      push(F.book("bn", t0 + 7450, [[99.99, 3], [99.9, 1]], [[100.01, 1]])); push(F.quote("bn", t0 + 9500, 99.99, 100.01));
      ok("facts: one snapshot per second, in order, with prices", snaps.length >= 5 && snaps.every((s, i) => i === 0 || s.t - snaps[i - 1].t === 1000) && snaps.every(s => s.t % 1000 === 0) && snaps[0].px.bn > 0, snaps.map(s => s.t - t0).join());
      const s7 = snaps.find(s => s.t === t0 + 7000), s8 = snaps.find(s => s.t === t0 + 8000);
      ok("facts: a trade at exactly the second belongs to it, a later one to the next second", s7 && s7.flow.bn.buy === 100 && s7.flow.bn.sell === 0 && s8 && s8.flow.bn.sell === 40 && s8.flow.bn.buy === 0, JSON.stringify([s7 && s7.flow.bn, s8 && s8.flow.bn]));
      ok("facts: the book seen at 7450 is not in second 7000 and gives an imbalance in 8000", s7 && s7.imb.bn[5] === null && s8 && s8.imb.bn[5] > 0.4 && s8.age.bn >= 0, JSON.stringify([s7 && s7.imb.bn, s8 && s8.imb.bn]));
      { const run2 = lateMs => { const eg = READER.create(), Fg = facts({ engine: eg, lateMs }), out = []; const p = a => { for (const x of a) out.push(x); };
          for (let i = 0; i <= 5; i++) { p(Fg.quote("bn", t0 + i * 1000 + 500, 99.99, 100.01)); p(Fg.quote("hl", t0 + i * 1000 + 500, 99.99, 100.01)); }
          p(Fg.quote("bn", t0 + 7200, 99.99, 100.01)); p(Fg.trade({ t: t0 + 6500, v: "hl", side: "buy", px: 100, q: 1, ntl: 70 })); p(Fg.quote("bn", t0 + 8100, 99.99, 100.01)); p(Fg.quote("bn", t0 + 9100, 99.99, 100.01)); return out.find(x => x.t === t0 + 7000); };
        const a = run2(1000), b = run2(0); ok("facts: a venue's late input still counts in its own second within lateMs (and is missed with lateMs 0)", a && a.flow.hl.buy === 70 && b && b.flow.hl.buy === 0, JSON.stringify([a && a.flow.hl, b && b.flow.hl])); }
      const e2 = READER.create(), F2 = facts({ engine: e2 }), snaps2 = []; const feedAll = (F, out) => { for (let i = 0; i <= 5; i++) { for (const s of F.quote("bn", t0 + i * 1000 + 500, 99.99, 100.01)) out.push(s); } for (const s of F.trade({ t: t0 + 7000, v: "bn", side: "buy", px: 100, q: 1, ntl: 100 })) out.push(s); };
      feedAll(F2, snaps2); const e3 = READER.create(), F3 = facts({ engine: e3 }), snaps3 = []; feedAll(F3, snaps3); for (const s of F3.advance(t0 + 20000)) snaps3.push(s);
      ok("facts: seconds made so far do not change when the run goes on", JSON.stringify(snaps2) === JSON.stringify(snaps3.slice(0, snaps2.length)) && snaps3.length > snaps2.length);
    }
    return res;
  }

  return { create, validate, id, size, facts, selftest, FACTS_VERSION, OPTIONS: OPT, sideDir };
})();
