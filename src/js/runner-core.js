// Runner core (Trader step 4): runs trade systems (SYSTEM) on paper, each with its own small ledger, fees, a global cap on open risk, and 20 random-entry twins. Pure: no DOM, timers, storage, clock or Math.random();
// it is driven only by snapshots (SYSTEM.facts), so the same snapshots always give the same journal. Nothing here sends an order anywhere. Spec: .scratch/trader/spec.md sections 3 and 4, prompt prompts/04-paper-runner.md.
// Fills: an entry or exit is filled at the far side of the Binance quote in the snapshot (buy at the ask, sell at the bid), whatever venue the trigger reads. No quote, or one older than the core's staleMs: the entry
// is cancelled (a skip row "no quote"); an exit waits for the next quote. Each fill pays feeBps of its notional.
// Journal rows (all carry sys = the system id and t = snapshot time):
//   {k:"enter", pid, dir, px, qty, notional, stopBps, thesis, trigger, tSig}    {k:"exit"|"invalidate", pid, reason, why?}    {k:"skip", reason}
//   {k:"trade", pid, tIn, tOut, dir, qty, notional, entryPx, exitPx, grossBps, feesBps, netBps, R, usd, stopBps, reason, thesis}   a closed trade; reason "interrupted" = open when the page closed (no figures)
//   {k:"twin", n, tIn, netBps, R, usd, reason}                                                                              a closed twin trade (twins write nothing else)
const RUNNER = (() => {
  "use strict";
  const hash32 = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
  const mulberry = a => () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const MIN_TWIN_TRIGGERS = 5, MIN_TRADES = 20, MIN_TWINS = 15, DAY = 86400000;

  // equity: the start plus the closed results of the rows already in the journal
  function create(o) {
    const defs = o.systems, N = o.twins == null ? 20 : o.twins, eq0 = o.equity == null ? 10000 : o.equity, fee = o.feeBps == null ? 5 : o.feeBps, cap = o.riskCap == null ? 0.02 : o.riskCap, seed = o.seed == null ? 1 : o.seed;
    const staleMs = SYSTEM.OPTIONS.staleMs, rows = (o.journal || []).slice(), fresh = [];
    // what the journal already says: results per system and per twin, and the positions that were open when it ended
    const usd = new Map(), openPos = new Map(), closedPid = new Set();
    for (const r of rows) {
      if (r.k === "trade") { closedPid.add(r.pid); if (!r.interrupted && typeof r.usd === "number") usd.set(r.sys, (usd.get(r.sys) || 0) + r.usd); }
      else if (r.k === "twin" && typeof r.usd === "number") usd.set(r.sys + "#" + r.n, (usd.get(r.sys + "#" + r.n) || 0) + r.usd);
      else if (r.k === "enter") openPos.set(r.pid, r);
    }
    // a position open when the page closed cannot be filled honestly: it is closed as interrupted and left out of every figure
    for (const [pid, e] of openPos) if (!closedPid.has(pid)) { const r = { k: "trade", sys: e.sys, t: e.t, pid, tIn: e.t, tOut: null, dir: e.dir, entryPx: e.px, reason: "interrupted", interrupted: true, thesis: e.thesis }; rows.push(r); fresh.push(r); }

    const S = defs.map(def => {
      const inst = SYSTEM.create(def), id = inst.id;
      return { def, id, inst, led: { eq: eq0 + (usd.get(id) || 0), pos: null, pend: null }, trig: 0, secs: 0, t0: null,
        twins: Array.from({ length: N }, (_, n) => ({ n, inst: SYSTEM.create(def, { forced: true }), led: { eq: eq0 + (usd.get(id + "#" + n) || 0), pos: null, pend: null }, rng: null, forced: 0 })) };
    });
    if (new Set(S.map(s => s.id)).size !== S.length) throw new Error("two systems have the same id");

    // close the open position of an entity at the quote q (the far side), or report that it cannot be done yet
    function settle(s, e, isTwin, snap, q, out) {
      const L = e.led; if (!L.pend || !q) return;
      const p = L.pos, px = p.dir > 0 ? q.bid : q.ask; e.inst.closed(px, snap.t);
      const grossBps = p.dir * (px / p.px - 1) * 1e4, feeOut = fee / 1e4 * p.qty * px, usdNet = p.dir * p.qty * (px - p.px) - p.feeIn - feeOut;
      const netBps = usdNet / p.notional * 1e4, feesBps = (p.feeIn + feeOut) / p.notional * 1e4, R = netBps / p.stopBps;
      L.eq += usdNet; L.pos = null; const reason = L.pend; L.pend = null;
      const row = isTwin ? { k: "twin", sys: s.id, t: snap.t, n: e.n, tIn: p.tIn, netBps, R, usd: usdNet, reason }
        : { k: "trade", sys: s.id, t: snap.t, pid: p.pid, tIn: p.tIn, tOut: snap.t, dir: p.dir, qty: p.qty, notional: p.notional, entryPx: p.px, exitPx: px, grossBps, feesBps, netBps, R, usd: usdNet, stopBps: p.stopBps, reason, thesis: p.thesis };
      out.push(row);
    }
    // the open risk of the systems (not the twins)
    const openRisk = () => { let r = 0; for (const s of S) if (s.led.pos) r += s.def.risk.riskFrac; return r; };

    function handle(s, e, isTwin, intents, snap, q, out) {
      for (const it of intents) {
        const L = e.led;
        if (it.type === "enter") {
          if (!isTwin) s.trig++;
          const rf = s.def.risk.riskFrac;
          const refuse = why => { e.inst.cancelled(); if (!isTwin) out.push({ k: "skip", sys: s.id, t: snap.t, reason: why, tSig: it.tSig }); };
          if (!q) { refuse("no quote"); continue; }
          if (!isTwin && openRisk() + rf > cap + 1e-12) { refuse("risk cap"); continue; }
          const px = it.dir > 0 ? q.ask : q.bid, sz = SYSTEM.size(L.eq, rf, it.stopBps, px);
          if (!(sz.qty > 0)) { refuse("no size"); continue; }
          if (e.inst.filled(px, snap.t).length) { if (!isTwin) out.push({ k: "skip", sys: s.id, t: snap.t, reason: "no room", tSig: it.tSig }); continue; }      // a level exit with no room behind the fill: void, nothing was bought
          const p = { pid: s.id + ":" + snap.t, dir: it.dir, px, qty: sz.qty, notional: sz.notional, tIn: snap.t, stopBps: it.stopBps, thesis: it.thesis, feeIn: fee / 1e4 * sz.notional };
          L.pos = p; L.pend = null;
          if (!isTwin) out.push({ k: "enter", sys: s.id, t: snap.t, pid: p.pid, dir: p.dir, px, qty: p.qty, notional: p.notional, stopBps: p.stopBps, thesis: p.thesis, trigger: s.def.trigger.type, tSig: it.tSig });
        } else if (it.type === "skip") {
          if (!isTwin) { s.trig++; out.push({ k: "skip", sys: s.id, t: snap.t, reason: it.reason, tSig: it.tSig }); }
        } else if (it.type === "exit" || it.type === "invalidate") {
          if (!L.pos) continue;
          L.pend = it.reason;
          if (!isTwin) out.push(Object.assign({ k: it.type, sys: s.id, t: snap.t, pid: L.pos.pid, reason: it.reason }, it.why ? { why: it.why } : {}));
          settle(s, e, isTwin, snap, q, out);
        }
      }
    }

    const api = {
      // one snapshot (SYSTEM.facts): every system and every twin takes it; returns the journal rows that second produced
      step(snap) {
        const out = [], q0 = snap.q && snap.q.bn, ok = q0 && snap.age && snap.age.bn != null && snap.age.bn <= staleMs, q = ok ? q0 : null;
        for (const s of S) {
          s.secs++;
          if (s.t0 == null) { s.t0 = snap.t; for (const w of s.twins) w.rng = mulberry(hash32(seed + "|" + s.id + "|" + w.n + "|" + snap.t)); }
          settle(s, s, false, snap, q, out);
          handle(s, s, false, s.inst.step(snap), snap, q, out);
          // twins: the system's own trigger rate so far, none before its fifth trigger
          const r = s.trig >= MIN_TWIN_TRIGGERS ? s.trig / s.secs : 0, venue = s.def.venue === "any" ? "bn" : s.def.venue;
          for (const w of s.twins) {
            const u = w.rng(); if (u < r) { w.inst.force({ t: snap.t, side: w.rng() < 0.5 ? 1 : -1, venue }); w.forced++; }
            settle(s, w, true, snap, q, out);
            handle(s, w, true, w.inst.step(snap), snap, q, out);
          }
        }
        for (const r of out) rows.push(r);
        return out;
      },
      rows: () => rows,
      fresh: () => fresh,      // the rows written when the runner was created (interrupted positions)
      // the page is stopping (disconnect): what is open stays unfinished, so it is closed as interrupted, as at a reload
      interrupt(t) {
        const out = [];
        for (const s of S) if (s.led.pos) { const p = s.led.pos; s.led.pos = null; s.led.pend = null; out.push({ k: "trade", sys: s.id, t, pid: p.pid, tIn: p.tIn, tOut: null, dir: p.dir, entryPx: p.px, reason: "interrupted", interrupted: true, thesis: p.thesis }); }
        for (const r of out) rows.push(r);
        return out;
      },
      state: () => S.map(s => ({ id: s.id, name: s.def.name, equity: s.led.eq, triggers: s.trig, secs: s.secs, twinForced: s.twins.length ? s.twins.reduce((a, w) => a + w.forced, 0) / s.twins.length : 0,
        open: s.led.pos ? { dir: s.led.pos.dir, px: s.led.pos.px, tIn: s.led.pos.tIn, notional: s.led.pos.notional, exiting: s.led.pend } : null })),
    };
    return api;
  }

  // per system: trades, days with a trade (UTC day of the entry), mean net bps and R, the share of days with a positive sum, counts by exit reason (invalidate apart from stop), interrupted positions (left out of every figure),
  // the last skip, and the system's mean net R as a percentile among its twins' means (null until the system and at least 15 twins have 20 trades each). It does not decide promotion (step 7).
  function evaluate(rows) {
    const by = new Map(), get = id => { let s = by.get(id); if (!s) { s = { tr: [], interrupted: 0, lastSkip: null, tw: new Map() }; by.set(id, s); } return s; };
    for (const r of rows) {
      if (r.k === "trade") { const s = get(r.sys); if (r.interrupted) s.interrupted++; else s.tr.push(r); }
      else if (r.k === "skip") { const s = get(r.sys); if (!s.lastSkip || r.t >= s.lastSkip.t) s.lastSkip = { reason: r.reason, t: r.t }; }
      else if (r.k === "twin") { const s = get(r.sys); let a = s.tw.get(r.n); if (!a) { a = []; s.tw.set(r.n, a); } a.push(r.R); }
    }
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, res = {};
    for (const [id, s] of by) {
      const days = new Map(); for (const t of s.tr) { const d = Math.floor(t.tIn / DAY); days.set(d, (days.get(d) || 0) + t.netBps); }
      const reasons = {}; for (const t of s.tr) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
      const meanR = mean(s.tr.map(t => t.R)), twinMeans = []; for (const a of s.tw.values()) if (a.length >= MIN_TRADES) twinMeans.push(mean(a));
      let pct = null;
      if (s.tr.length >= MIN_TRADES && twinMeans.length >= MIN_TWINS) { let below = 0, same = 0; for (const m of twinMeans) { if (m < meanR) below++; else if (m === meanR) same++; } pct = 100 * (below + same / 2) / twinMeans.length; }
      res[id] = { trades: s.tr.length, days: days.size, meanNetBps: mean(s.tr.map(t => t.netBps)), meanR,
        posDayShare: days.size ? Array.from(days.values()).filter(x => x > 0).length / days.size : null, byReason: reasons, interrupted: s.interrupted, lastSkip: s.lastSkip, twinsWithEnough: twinMeans.length, twinPercentile: pct };
    }
    return res;
  }

  // ---------- self-test: scenarios named runner:* ----------
  function selftest() {
    const res = [], ok = (name, c, detail) => res.push({ name: "runner:" + name, ok: !!c, detail: c ? "" : String(detail || "") });
    const T0 = 1.7e12, sd = (i, o) => Object.assign({ t: T0 + i * 1000, px: { bn: 100, hl: 100 }, sigma: { bn: 0.5, hl: 0.5 }, age: { bn: 100, hl: 100 }, q: { bn: { bid: 99.99, ask: 100.01 }, hl: { bid: 99.99, ask: 100.01 } }, calibrated: true,
      flow: { bn: { buy: 10, sell: 10, liqBuy: 0, liqSell: 0 }, hl: { buy: 10, sell: 10, liqBuy: 0, liqSell: 0 } }, imb: { bn: { 5: 0, 20: 0 }, hl: { 5: 0, 20: 0 } }, episodes: { new: [], ended: [], active: [] }, state: null }, o);
    // the quote follows the price, 2 cents wide
    const mkSnaps = (n, f) => { const a = []; for (let i = 0; i < n; i++) { const p = f ? f(i) : 100; a.push(sd(i, { px: { bn: p, hl: 100 }, q: { bn: { bid: p - 0.01, ask: p + 0.01 }, hl: null }, age: { bn: 100, hl: 100 } })); } return a; };
    const sys = (over, risk) => Object.assign({ name: "t", stage: "paper", venue: "bn", context: { type: "always" }, region: { type: "none" }, trigger: { type: "priceMove", lookSec: 10, m: 2 },
      thesis: { dir: "continuation", text: "x", invalidation: { type: "none" } }, exit: { type: "timed", holdSec: 30 }, risk: Object.assign({ stopK: 20, riskFrac: 0.01 }, risk) }, over);
    const jump = i => i < 60 ? 100 : 100 * (1 + 1e-4 * Math.min(i - 59, 5) * 6);      // a move of 30 bps over 5 s at second 60
    const runAll = (o, snaps) => { const r = create(o); for (const s of snaps) r.step(s); return r; };
    // ----- fills at the far side, with the fee
    { const snaps = mkSnaps(200, jump), r = runAll({ systems: [sys()], twins: 0 }, snaps), en = r.rows().find(x => x.k === "enter"), tr = r.rows().find(x => x.k === "trade"), at = snaps.find(x => x.t === en.t);
      ok("entry is filled at the ask, a long exit at the bid, each side pays the fee", en && tr && en.dir === 1 && en.px === at.q.bn.ask && tr.exitPx === snaps.find(x => x.t === tr.tOut).q.bn.bid && Math.abs(tr.feesBps - (5 + 5 * tr.exitPx / tr.entryPx)) < 1e-9 && Math.abs(tr.netBps - (tr.grossBps - tr.feesBps)) < 1e-9, JSON.stringify([en, tr])); }
    { const down = i => i < 60 ? 100 : 100 * (1 - 1e-4 * Math.min(i - 59, 5) * 6), snaps = mkSnaps(200, down), r = runAll({ systems: [sys()], twins: 0 }, snaps), en = r.rows().find(x => x.k === "enter"), tr = r.rows().find(x => x.k === "trade");
      ok("a short is sold at the bid and bought back at the ask", en && en.dir === -1 && en.px === snaps.find(x => x.t === en.t).q.bn.bid && tr.exitPx === snaps.find(x => x.t === tr.tOut).q.bn.ask, JSON.stringify([en, tr])); }
    { const r = runAll({ systems: [sys()], twins: 0, equity: 10000 }, mkSnaps(200, jump)), en = r.rows().find(x => x.k === "enter");
      ok("size is the system's own risk: the loss at the stop is equity times riskFrac", Math.abs(en.notional * en.stopBps / 1e4 - 100) < 1e-6, JSON.stringify(en)); }
    // ----- no quote
    { const snaps = mkSnaps(200, jump); for (const i of [60, 61, 62]) snaps[i].q = { bn: null, hl: null };
      const r = runAll({ systems: [sys()], twins: 0 }, snaps), rr = r.rows();
      ok("an entry with no quote is cancelled and the system stays free to enter later", rr.some(x => x.k === "skip" && x.reason === "no quote") && !rr.some(x => x.k === "enter" && x.t < T0 + 63000), JSON.stringify(rr.map(x => x.k + ":" + (x.reason || "")))); }
    { const snaps = mkSnaps(200, jump); for (let i = 88; i < 100; i++) snaps[i].q = { bn: null, hl: null };
      const r = runAll({ systems: [sys()], twins: 0 }, snaps), rr = r.rows(), ex = rr.find(x => x.k === "exit"), tr = rr.find(x => x.k === "trade");
      ok("an exit with no quote waits for the next quote", ex && tr && ex.t < T0 + 100000 && tr.tOut === T0 + 100000, JSON.stringify([ex, tr && tr.tOut - T0])); }
    { const snaps = mkSnaps(200, jump); for (let i = 60; i < 64; i++) snaps[i].age = { bn: 9000, hl: 100 };
      const r = runAll({ systems: [sys()], twins: 0 }, snaps), rr = r.rows(); ok("a quote older than the core's stale limit is no quote (a stale skip, no entry then)", !rr.some(x => x.k === "enter" && x.t < T0 + 64000)); }
    // ----- risk cap, twins not counted
    const three = [sys({}, { riskFrac: 0.01 }), sys({ trigger: { type: "priceMove", lookSec: 10, m: 2.1 } }, { riskFrac: 0.01 }), sys({ trigger: { type: "priceMove", lookSec: 10, m: 2.2 } }, { riskFrac: 0.01 })];
    { const r = runAll({ systems: three, twins: 0, riskCap: 0.02 }, mkSnaps(200, jump)), rr = r.rows(), id3 = r.state()[2].id;
      ok("the risk cap skips the entry that would take open risk above it, with its reason", rr.filter(x => x.k === "enter").length === 2 && rr.some(x => x.k === "skip" && x.reason === "risk cap" && x.sys === id3), JSON.stringify(rr.map(x => x.k + ":" + (x.reason || "")))); }
    // a price that steps every 20 s: both directions, many triggers
    const saw = i => 100 * (1 + 6e-4 * (Math.floor(i / 20) % 2)), fast = sys({ exit: { type: "timed", holdSec: 5 } }, { riskFrac: 0.01 });
    { const r = runAll({ systems: [fast], twins: 20, riskCap: 1e-6 }, mkSnaps(1200, saw)), rr = r.rows();
      ok("twins are not counted by the cap and are not capped (the system is refused every time, its twins still trade)", !rr.some(x => x.k === "enter") && rr.some(x => x.k === "skip" && x.reason === "risk cap") && rr.filter(x => x.k === "twin").length > 100); }
    // ----- twins match the system's rate on average, in both directions, none before the fifth trigger
    { const snaps = mkSnaps(1200, saw), r = runAll({ systems: [fast], twins: 20, riskCap: 1 }, snaps), rr = r.rows(), st = r.state()[0], expect = st.triggers / st.secs * st.secs;
      const trigT = rr.filter(x => x.k === "enter" || x.k === "skip").map(x => x.t).sort((a, b) => a - b), fifth = trigT[4];
      const tw = rr.filter(x => x.k === "twin");
      ok("twins fire at about the system's own trigger rate", Math.abs(st.twinForced - expect) < 0.25 * expect && st.triggers > 40, JSON.stringify([st.twinForced, expect]));
      ok("no twin trades before the system's fifth trigger", tw.length > 0 && tw.every(x => x.tIn >= fifth), fifth - T0 + " " + (tw[0] && tw[0].tIn - T0));
      ok("twins trade in both directions (a 6 bp step against the 10 bp fee: right way about -4, wrong way about -16)", tw.some(x => x.netBps > -9.5) && tw.some(x => x.netBps < -10.5)); }
    // ----- determinism, and a restart with the journal handed over
    { const snaps = mkSnaps(1200, saw), a = runAll({ systems: [fast], twins: 20, riskCap: 1, seed: 3 }, snaps), b = runAll({ systems: [fast], twins: 20, riskCap: 1, seed: 3 }, snaps), c = runAll({ systems: [fast], twins: 20, riskCap: 1, seed: 4 }, snaps);
      ok("the same snapshots give the same journal, another seed another twins", JSON.stringify(a.rows()) === JSON.stringify(b.rows()) && JSON.stringify(a.rows().filter(x => x.k === "twin")) !== JSON.stringify(c.rows().filter(x => x.k === "twin")) && a.rows().length > 100);
      // split in two with the journal handed over (at a moment with nothing open): the first part is the same rows, the second part carries the equity and adds to the journal, nothing is written twice
      const cut = 610, h1 = runAll({ systems: [fast], twins: 20, riskCap: 1, seed: 3 }, snaps.slice(0, cut)), full = a.rows(), j1 = h1.rows();
      ok("a run split in two: the first part's journal is the full run's journal up to the split", JSON.stringify(j1) === JSON.stringify(full.slice(0, j1.length)), j1.length + " of " + full.length);
      const open = h1.state()[0].open, h2 = create({ systems: [fast], twins: 20, riskCap: 1, seed: 3, journal: j1 }); for (const s of snaps.slice(cut)) h2.step(s);
      const nTrade = r => r.rows().filter(x => x.k === "trade" && !x.interrupted).length, pids = h2.rows().filter(x => x.k === "enter").map(x => x.pid);
      ok("handing the journal over keeps the earlier rows once, adds the later ones and carries the equity", h2.rows().length > j1.length && new Set(pids).size === pids.length && JSON.stringify(h2.rows().slice(0, j1.length + h2.fresh().length)) === JSON.stringify(j1.concat(h2.fresh())) && Math.abs(h2.state()[0].equity - (10000 + h2.rows().filter(x => x.k === "trade" && !x.interrupted).reduce((q, x) => q + x.usd, 0))) < 1e-6 && nTrade(h2) >= nTrade(h1), "open at split " + JSON.stringify(open)); }
    // ----- restart with a position open
    { const snaps = mkSnaps(200, jump), r1 = runAll({ systems: [sys()], twins: 0 }, snaps.slice(0, 70)), j = r1.rows(), id = r1.state()[0].id;
      ok("a position open at the journal's end is there", r1.state()[0].open && j.some(x => x.k === "enter") && !j.some(x => x.k === "trade"));
      const r2 = create({ systems: [sys()], twins: 0, journal: j }), f = r2.fresh();
      ok("on restart that position is written as closed, reason interrupted", f.length === 1 && f[0].k === "trade" && f[0].reason === "interrupted" && f[0].interrupted === true && r2.state()[0].open === null);
      const ev = evaluate(r2.rows())[id]; ok("an interrupted position is counted and left out of every figure", ev.trades === 0 && ev.interrupted === 1 && ev.meanNetBps === null && ev.meanR === null && ev.days === 0, JSON.stringify(ev));
      const r3 = create({ systems: [sys()], twins: 0, journal: r2.rows() }); ok("it is interrupted only once", r3.fresh().length === 0);
      const r4 = runAll({ systems: [sys()], twins: 0 }, snaps.slice(0, 70)), cl = r4.interrupt(T0 + 70000); ok("stopping the runner closes what is open as interrupted", cl.length === 1 && cl[0].interrupted && r4.state()[0].open === null);
      const j2 = runAll({ systems: [sys()], twins: 0 }, snaps).rows(), eq = create({ systems: [sys()], twins: 0, journal: j2 }).state()[0].equity, want = 10000 + j2.filter(x => x.k === "trade").reduce((q, x) => q + x.usd, 0);
      ok("equity carries over a restart", Math.abs(eq - want) < 1e-9 && eq !== 10000, eq + " " + want); }
    // ----- evaluate
    { const tr = (sys, d, net, reason, h) => ({ k: "trade", sys, t: 0, pid: sys + d + net + h, tIn: d * DAY + h * 3600000, netBps: net, R: net / 10, reason }), twin = (sys, n, R) => ({ k: "twin", sys, t: 0, n, tIn: 0, netBps: R * 10, R, reason: "time" });
      const rows = [tr("A", 1, 5, "time", 1), tr("A", 1, -2, "stop", 2), tr("A", 2, -4, "invalidate", 1), tr("A", 3, 6, "time", 5), { k: "skip", sys: "A", t: 5, reason: "risk cap" }, { k: "skip", sys: "A", t: 9, reason: "in position" }];
      const e = evaluate(rows).A; ok("evaluate: trades, days, means, positive days, reasons, last skip", e.trades === 4 && e.days === 3 && Math.abs(e.meanNetBps - 1.25) < 1e-9 && Math.abs(e.meanR - 0.125) < 1e-9 && Math.abs(e.posDayShare - 2 / 3) < 1e-9 && e.byReason.invalidate === 1 && e.byReason.stop === 1 && e.byReason.time === 2 && e.lastSkip.reason === "in position" && e.twinPercentile === null, JSON.stringify(e));
      const many = (nSys, nTw, twTrades, R) => { const o = []; for (let i = 0; i < nSys; i++) o.push(tr("B", 1 + (i % 5), R * 10, "time", i)); for (let n = 0; n < nTw; n++) for (let i = 0; i < twTrades; i++) o.push(twin("B", n, n / 100)); return o; };
      ok("percentile: none with 14 twins, none with 19 system trades, present with 15 twins and 20 trades", evaluate(many(20, 14, 20, 0.5)).B.twinPercentile === null && evaluate(many(19, 20, 20, 0.5)).B.twinPercentile === null && evaluate(many(20, 15, 20, 0.5)).B.twinPercentile === 100 && evaluate(many(20, 20, 19, 0.5)).B.twinPercentile === null, JSON.stringify(evaluate(many(20, 15, 20, 0.5)).B));
      ok("percentile is the share of twin means below the system's mean", Math.abs(evaluate(many(20, 20, 20, 0.095)).B.twinPercentile - 50) < 1e-9, JSON.stringify(evaluate(many(20, 20, 20, 0.095)).B)); }
    // ----- the seven defaults
    { const D = typeof SYSTEMS_DEFAULT !== "undefined" ? SYSTEMS_DEFAULT : [], bad = D.map(d => SYSTEM.validate(d).map(m => d.name + ": " + m)).flat(), ids = new Set(D.map(d => SYSTEM.id(d)));
      ok("every default system validates, there are seven, with different ids and names, all paper, risk 0.005, stop 2", D.length === 7 && bad.length === 0 && ids.size === 7 && new Set(D.map(d => d.name)).size === 7 && D.every(d => d.stage === "paper" && d.risk.riskFrac === 0.005 && d.risk.stopK === 2 && d.venue === "bn" && d.context.type === "always" && d.thesis.text.length > 20), bad.join("; ")); }
    return res;
  }

  return { create, evaluate, selftest };
})();
