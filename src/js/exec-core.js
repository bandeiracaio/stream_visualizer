// Execution core (Trader step 8): mirrors the paper rows of a demo-stage system onto the Binance DEMO account. Pure: no DOM, timers, storage, network or clock; the time is handed in, requests are returned
// (drain()) and the exchange's answers are handed back (reply()). Nothing here decides a trade: it follows the runner's journal rows (enter, then exit / invalidate, then trade) and never feeds anything back.
// Spec: .scratch/trader/spec.md section 7, prompt prompts/08-demo-execution.md.   Words: mirror, fault, kill switch (CONTEXT.md).
// One machine per asset (the account nets one position per asset, so one system holds it at a time).
// Requests (all carry id, role): {op:"market", role:"e"|"x", side, qty, qtyStr, reduce, cid}   {op:"stop", role:"s", side, qty, qtyStr, stopPx, stopStr, cid}   {op:"cancel", role:"c", cid, algo}
//   {op:"lookup", role, of: cid, algo}   (the state of an order by its client id). Answers: {ok:true, data} | {ok:false, unknown:true, err} (no answer: timeout, dropped) | {ok:false, err, code} (the exchange said no).
//   data of a fill: {px, qty, fee (USDT), t, status}; of a lookup: {found, status, px, qty, fee, t}.
// Exchange state handed in (start(), poll()): {t, positions: [signed qty ...], orders: [{cid, algo}] (every open regular and algo order on the asset)}.
// Guards handed in with an enter row: {quoteAgeMs, offsetMs, oneWay, readOk, step, tick, minQty, minNotional}.
// Rows written: {k:"mirror", sys, pid, t, status: "filled"|"paper"|"failed"|"interrupted", fill: "demo"|"paper", dir, qty, entryPx, exitPx, fees, feesBps, netBps, paperNetBps, entrySlipBps, exitSlipBps (positive = worse than paper),
//   entryDelayMs, exitDelayMs, exitReason, lateMs, notes: [...]}. A refused entry writes a mirror row at once (status "paper", the reason in notes): the trade stays a paper trade.
// Since R4 the machine itself (create, onRow, reply, tick, start, poll, kill, unkill, clearFault, drain, state, snapshot, faults, debug) runs in WebAssembly (rust/crates/sv-exec, loaded by wasm-loader.js as SVWASM); the old JS is
// src/js/js-cores/exec-core.js (EXEC_JS) and `node parity.mjs exec` compares the two. Signatures, request / row / fault shapes and key order are the old ones.
// SAFETY: the rule that no request is produced unless the base URL is the demo host (or a local http address with a port) and ALLOW_LIVE is false is decided in Rust (is_demo_base / allowed_base; ALLOW_LIVE is a const there; `send` queues nothing
// for a machine that is not allowed). This file keeps a second copy of the host test (jsDemo): create() refuses to make a machine when the two disagree, and drain() hands out no request from a machine that is not allowed.
// isDemoBase asks the module, and answers false until it is loaded (fail closed).
// merge() stays here in JS: it reshapes arbitrary journal row objects (key order of every field, untouched rows returned by reference, the same array when no mirror row exists) and the Trader view calls it with the whole journal, so a
// round trip through JSON would lose the order and cost O(journal) per render. The self-test and its fake exchange (test only) stay here too; they drive the WebAssembly machine through the public calls only.
// Edge differences from the JS version, all in inputs the page never sends: a number that is NaN / undefined in a handed-in object reads as absent (JSON), so a NaN guard value or reply field reads as 0 where it is null, and NaN in an output
// number comes back as null; a string where a number is expected (price, quantity) is read as that number and echoed as a number; a successful exit answer with no data throws a plain Error (was a TypeError) with the state left as the JS leaves it;
// a time stamp that is not a whole number gets a client id without the fraction digits; saved faults keep only t, kind and text; a tick size finer than 1e-100 is written with 100 decimals.
const EXEC = (() => {
  "use strict";
  const DEMO_BASE = "https://demo-fapi.binance.com", LIVE_BASE = "https://fapi.binance.com";
  const ALLOW_LIVE = false;      // the live path stays closed until step 9 (a const in the Rust crate too)
  const C = { prefix: "svx_", capUsd: 5000, quoteMs: 3000, offsetMs: 1000, stopMs: 3000, unknownMs: 5000, reqMs: 8000, lateMs: 5000, exitTries: 3, retryMs: 1000 };      // the figures live in the Rust crate; this copy is for callers
  const wasm = (fn, o) => SVWASM.call("exec_" + fn, o);
  const reg = typeof FinalizationRegistry === "function" ? new FinalizationRegistry(h => { try { if (SVWASM.loaded) wasm("drop", { h }); } catch (e) { /* the module is gone */ } }) : null;
  // the second copy of the host test (see SAFETY above)
  const jsDemo = b => b === DEMO_BASE || /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(String(b));
  // the demo host itself, or this PC's demo proxy (demo-proxy.mjs: forwards only to the demo host; the page checks that with GET /__proxy before it logs in)
  const isDemoBase = b => SVWASM.loaded && wasm("is_demo_base", { s: String(b), isStr: typeof b === "string" });

  function create(o) {
    const made = wasm("create", { s: String(o.base), isStr: typeof o.base === "string", saved: o.saved || {} }), h = made.h, allowed = made.allowed;
    if (allowed !== jsDemo(o.base)) { wasm("drop", { h }); throw new Error("exec: the base URL check of the page and of the module disagree; no machine was made"); }
    let live = true;
    const api = {
      debug: () => wasm("debug", { h }),
      onRow: (row, now, g) => { wasm("on_row", { h, row: { k: row.k, stage: row.stage, sys: row.sys, pid: row.pid, dir: row.dir, px: row.px, qty: row.qty, t: row.t, stopBps: row.stopBps, reason: row.reason, interrupted: row.interrupted, exitPx: row.exitPx, netBps: row.netBps }, now, g }); },
      reply: (id, res, now) => { wasm("reply", { h, id, res, now }); },
      tick: now => { wasm("tick", { h, now }); },
      start: (x, now, extra) => { wasm("start", { h, x, now, extra: extra || {} }); },
      poll: (x, now) => { wasm("poll", { h, x, now }); },
      kill: now => { wasm("kill", { h, now }); },
      unkill: () => { wasm("unkill", { h }); },
      clearFault: () => { wasm("clear_fault", { h }); },
      drain: () => { const d = wasm("drain", { h }); if (!allowed) d.reqs = []; return d; },
      state: () => wasm("state", { h }),
      snapshot: () => wasm("snapshot", { h }),
      faults: () => wasm("faults", { h }),
      allowed,
      // free the machine now (it is freed anyway when this object is collected); no call may follow
      dispose: () => { if (live) { live = false; if (reg) reg.unregister(api); wasm("drop", { h }); } },
    };
    if (reg) reg.register(api, h, api);
    return api;
  }

  // Trades of the journal as the promotion rule should read them: a paper trade that was also filled on the demo exchange (mirror row, fill "demo") reads as a demo trade with the real net result and the paper one beside it.
  // The recorded paper rows are not changed (a replay reproduces them exactly); this is a view.
  function merge(rows) {
    const m = new Map(); for (const r of rows) if (r.k === "mirror" && r.fill === "demo" && typeof r.netBps === "number") m.set(r.pid, r);
    if (!m.size) return rows;
    return rows.map(r => { if (r.k !== "trade" || r.interrupted) return r; const x = m.get(r.pid); if (!x) return r; return Object.assign({}, r, { fill: "demo", paperNetBps: r.netBps, netBps: x.netBps, R: x.netBps / r.stopBps, usd: x.netBps / 1e4 * r.notional }); });
  }


  // ---------- self-test: a fake exchange and the scenarios exec:* ----------
  function selftest(tap) {      // tap (parity only): wraps every machine the scenarios create, to record its calls
    const mk = o => tap ? tap(create(o)) : create(o);
    const res = [], ok = (name, c, detail) => res.push({ name: "exec:" + name, ok: !!c, detail: c ? "" : String(detail || "") });
    const G = { quoteAgeMs: 100, offsetMs: 10, oneWay: true, step: 0.001, tick: 0.1, minQty: 0.001, minNotional: 5 };
    // The fake exchange. S.px is the market price; behaviours: S.beh[key] = "reject" | "lost" (not executed, no answer) | "silent" (executed, no answer) | {slow: ms} (executed, answered late)
    // key: op + role, with an optional "#n" for the nth request of that kind (1-based).
    function fx(over) {
      const S = Object.assign({ px: 100, pos: 0, stops: [], book: {}, foreign: [], beh: {}, count: {}, partial: 1, slip: 0.05, sent: [], dual: false, queue: [], log: [] }, over);
      const fill = (side, qty, px) => { S.pos += side === "BUY" ? qty : -qty; return { px, qty, fee: px * qty * 0.0005, t: S.now, status: "FILLED" }; };
      S.exec = (r, now) => {
        S.now = now; S.sent.push(r); const k = r.op + ":" + r.role, n = S.count[k] = (S.count[k] || 0) + 1, b = S.beh[k + "#" + n] || S.beh[k];
        const answer = (a, delay) => S.queue.push({ at: now + (delay || 50), id: r.id, a });
        if (b === "lost") return;
        if (S.netDown > now) return;      // the network is down: nothing reaches the exchange, nothing comes back
        if (r.op === "lookup" && S.downUntil > now) return answer({ ok: false, unknown: true, err: "timeout" });
        let a;
        if (r.op === "market") {
          if (r.reduce && (S.pos === 0 || Math.sign(S.pos) === (r.side === "BUY" ? 1 : -1))) a = { ok: false, code: -2022, err: "-2022 ReduceOnly rejected" };
          else if (b === "reject") a = { ok: false, code: -4003, err: "-4003 quantity less than zero" };
          else { const q = r.reduce ? Math.min(r.qty, Math.abs(S.pos)) : r.qty * S.partial, px = r.side === "BUY" ? S.px + S.slip : S.px - S.slip; const f = fill(r.side, q, px); S.book[r.cid] = f; a = { ok: true, data: f }; }
        } else if (r.op === "stop") {
          const bad = r.side === "SELL" ? r.stopPx >= S.px : r.stopPx <= S.px;
          if (b === "reject" || bad) a = { ok: false, code: -2021, err: "-2021 Order would immediately trigger" };
          else { S.stops.push({ cid: r.cid, side: r.side, qty: r.qty, trig: r.stopPx }); a = { ok: true, data: {} }; }
        } else if (r.op === "cancel") {
          const i = S.stops.findIndex(s => s.cid === r.cid); if (i >= 0) { S.stops.splice(i, 1); a = { ok: true, data: {} }; } else a = { ok: false, code: -2011, err: "-2011 Unknown order sent" };
          if (b === "reject") a = { ok: false, code: -1000, err: "-1000 internal error" };
        } else if (r.op === "lookup") {
          const s = S.stops.find(x => x.cid === r.of), f = S.book[r.of];
          a = f ? { ok: true, data: Object.assign({ found: true }, f) } : s ? { ok: true, data: { found: true, status: "NEW" } } : { ok: true, data: { found: false } };
          if (b === "reject") a = { ok: false, unknown: true, err: "timeout" };
        }
        if (b === "silent") return;
        answer(a, b && b.slow);
      };
      S.setPx = (px, now) => { S.px = px; S.now = now; for (const s of S.stops.slice()) if (s.side === "SELL" ? px <= s.trig : px >= s.trig) { S.stops.splice(S.stops.indexOf(s), 1); const f = fill(s.side, s.qty, s.trig - (s.side === "SELL" ? S.slip : -S.slip)); S.book[s.cid] = Object.assign({}, f, { status: "TRIGGERED" }); } };
      S.snap = now => ({ t: now, positions: S.pos === 0 ? [] : [S.pos], orders: S.stops.map(s => ({ cid: s.cid, algo: true })).concat(S.foreign) });
      return S;
    }
    const enter = (o, sys) => Object.assign({ k: "enter", sys: sys || "A", t: 1000, pid: (sys || "A") + ":1000", dir: 1, px: 100, qty: 1, notional: 100, stopBps: 50, thesis: "x", stage: "demo", fill: "paper" }, o);
    const exitRow = (e, t, why) => ({ k: "exit", sys: e.sys, t, pid: e.pid, reason: why || "time" });
    const tradeRow = (e, t, o) => Object.assign({ k: "trade", sys: e.sys, t, pid: e.pid, tIn: e.t, tOut: t, dir: e.dir, qty: e.qty, notional: e.notional, entryPx: e.px, exitPx: 100.2, grossBps: 20, feesBps: 10, netBps: 10, R: 0.2, usd: 0.1, stopBps: e.stopBps, reason: "time", stage: "demo", fill: "paper" }, o);
    // the driver: advances time in 100 ms steps, ships requests to the fake exchange, hands answers back, polls every 3 s
    function rig(over, mopts) {
      const X = fx(over), M = mk(Object.assign({ base: DEMO_BASE }, mopts)), R = { X, M, now: 0, rows: [], faults: [], poll: true, reqs: [] };
      R.pump = now => { const d = M.drain(); for (const r of d.rows) R.rows.push(r); for (const f of d.faults) R.faults.push(f); for (const q of d.reqs) { R.reqs.push(q); X.exec(q, now); } return d; };
      R.run = ms => { const end = R.now + ms; while (R.now < end) { R.now += 100; R.pump(R.now); for (const q of X.queue.filter(z => z.at <= R.now)) { X.queue.splice(X.queue.indexOf(q), 1); M.reply(q.id, q.a, R.now); } M.tick(R.now); R.pump(R.now); if (R.poll && R.now % 3000 === 0) { M.poll(X.snap(R.now), R.now); R.pump(R.now); } } };
      R.start = (extra) => { M.start(X.snap(R.now), R.now, extra); R.pump(R.now); R.run(1000); };
      R.row = (r, g) => { M.onRow(r, R.now, g === undefined ? G : g); R.pump(R.now); };
      R.flat = () => X.pos === 0 && X.stops.length === 0;
      return R;
    }
    const happy = (over, mopts) => { const R = rig(over, mopts); R.now = 1000; R.start(); const e = enter(); R.row(e); R.run(1000); return { R, e }; };

    // ----- the working path
    { const { R, e } = happy(); const st = R.M.state();
      ok("a demo entry: market buy, then a reduce-only stop at the stop price from the REAL fill, state holding", R.X.pos === 1 && R.X.stops.length === 1 && Math.abs(R.X.stops[0].trig - Math.round(100.05 * (1 - 0.005) / 0.1) * 0.1) < 1e-9 && R.X.sent[0].op === "market" && R.X.sent[0].reduce === false && R.X.sent[1].op === "stop" && st.state === "holding", JSON.stringify([R.X.stops, st]));
      ok("every order carries the page's prefix, the system and the position", R.X.sent.every(r => r.cid.startsWith("svx_") && r.cid.length <= 36) && new Set(R.X.sent.map(r => r.cid)).size === R.X.sent.length, R.X.sent.map(r => r.cid).join(" "));
      R.run(2500); R.row(exitRow(e, R.now, "time")); R.run(1000); R.row(tradeRow(e, R.now)); R.run(500);
      const m = R.rows.find(x => x.k === "mirror" && x.pid === e.pid);
      ok("the exit is a reduce-only market order; the stop is cancelled only after the exit is filled; the position ends flat", R.flat() && R.X.sent.filter(r => r.op === "market").length === 2 && R.X.sent[2].reduce === true && R.X.sent[3].op === "cancel" && R.M.state().state === "ready", JSON.stringify(R.X.sent.map(r => r.op + r.role)));
      ok("the mirror row: both real fills, fees, slip against the paper fill (buy at 100.05 against 100: 5 bps), delays, fill demo", m && m.status === "filled" && m.fill === "demo" && Math.abs(m.entrySlipBps - 5) < 1e-6 && m.entryDelayMs >= 0 && m.exitDelayMs >= 0 && m.fees > 0 && typeof m.netBps === "number" && m.paperNetBps === 10, JSON.stringify(m));
      const mg = merge(R.rows.concat([tradeRow(e, 4000)])).find(x => x.k === "trade");
      ok("merge: the paper trade reads as a demo trade with the real net result and the paper one beside it; the stored rows are not changed", mg.fill === "demo" && mg.paperNetBps === 10 && mg.netBps === m.netBps && tradeRow(e, 4000).fill === "paper"); }
    // ----- never on a non-demo account
    { const R = rig({}, { base: "https://fapi.binance.com" }); R.now = 1000; R.start(); R.row(enter()); R.run(1000);
      ok("no request is ever produced when the account is not the demo one (live host, mode name irrelevant)", R.reqs.length === 0 && R.X.pos === 0 && R.M.state().state === "off");
      const R2 = rig({}, { base: "https://demo-fapi.binance.com.evil.example" }); R2.now = 1000; R2.start(); R2.row(enter()); R2.run(1000); ok("a look-alike host is refused too", R2.reqs.length === 0);
      const bad = ["http://127.0.0.1.evil.example:8787", "http://localhost:8787/x", "https://127.0.0.1:8787", "http://127.0.0.1", "http://evil.example/http://127.0.0.1:8787", "https://fapi.binance.com.local:8787"];
      ok("only the demo host or a local http address with a port counts as the demo base; look-alikes and the live host do not", isDemoBase("http://127.0.0.1:8787") && isDemoBase("http://localhost:9000") && isDemoBase(DEMO_BASE) && bad.every(b => !isDemoBase(b)) && !isDemoBase(LIVE_BASE), bad.filter(b => isDemoBase(b)).join(" "));
      const R3 = rig({}, { base: "http://127.0.0.1:8787" }); R3.now = 1000; R3.start(); R3.row(enter()); R3.run(1000); ok("through the local demo proxy the machine works as on the demo host", R3.X.pos === 1 && R3.M.state().state === "holding"); }
    // ----- entry blocks (the paper trade goes on, the note says why)
    const blocked = (name, g, setup, why) => { const R = rig(); R.now = 1000; R.start(); if (setup) setup(R); R.row(enter(), g); R.run(500); const m = R.rows.find(x => x.k === "mirror");
      ok("block: " + name, R.reqs.length === (setup && setup.keep ? R.reqs.length : 0) && m && m.status === "paper" && m.fill === "paper" && m.notes[0].includes(why), JSON.stringify(m)); };
    blocked("no Binance quote for 3 s", Object.assign({}, G, { quoteAgeMs: 3500 }), null, "quote");
    blocked("clock offset above 1 s", Object.assign({}, G, { offsetMs: 1500 }), null, "clock");
    blocked("not in one-way position mode", Object.assign({}, G, { oneWay: false }), null, "one-way");
    blocked("size below the exchange minimum after rounding", Object.assign({}, G, { minQty: 5 }), null, "minimum");
    blocked("the page cannot read the exchange (the poll fails)", Object.assign({}, G, { readOk: false }), null, "cannot read");
    blocked("the kill switch is on", G, R => R.M.kill(R.now), "kill switch");
    { const R = rig(); R.now = 1000; R.row(enter()); ok("block: execution not started yet (no read of the exchange)", R.rows[0].notes[0].includes("not started")); }
    { const R = rig(); R.now = 1000; R.start(); R.M.start({ positions: [], orders: [] }, R.now); R.row(enter(), Object.assign({}, G, { quoteAgeMs: null })); ok("block: an unknown quote age counts as no quote", R.rows[0].notes[0].includes("quote")); }
    { const { R, e } = happy(); const e2 = enter({ sys: "B", pid: "B:2000", t: 2000 }); R.row(e2); R.run(500);
      const m = R.rows.find(x => x.k === "mirror" && x.sys === "B");
      ok("one exchange position at a time: a second system's entry is not sent, counts as a paper fill, note account busy", m && m.notes[0] === "account busy" && m.fill === "paper" && R.X.sent.filter(r => r.op === "market").length === 1); }
    { const { R } = happy(); const R2 = rig(); R2.now = 1000; R2.start(); R2.row(enter({ qty: 100, px: 100, notional: 10000 })); R2.run(1000);
      ok("size is capped at 5,000 notional per trade and the trade says capped", R2.X.pos === 50 && R2.X.sent[0].qty === 50 && R2.M.state().state === "holding"); R2.row(exitRow(enter({ qty: 100 }), 2000)); R2.run(1000); R2.row(tradeRow(enter({ qty: 100 }), 2100)); R2.run(500);
      const m = R2.rows.find(x => x.k === "mirror" && x.status === "filled"); ok("the mirror row of a capped trade says capped", m && m.notes.includes("capped"), JSON.stringify(m)); }
    // ----- rule 3: the stop
    { const R = rig({ beh: { "stop:s": "reject" } }); R.now = 1000; R.start(); const e = enter(); R.row(e); R.run(1500);
      ok("a rejected stop: the position is closed at market at once, a fault is logged, new entries are blocked", R.flat() && R.faults.length === 1 && /stop rejected/.test(R.faults[0].kind) && R.M.state().state === "fault" && R.X.sent.filter(r => r.op === "market").length === 2, JSON.stringify([R.faults, R.X.pos]));
      R.row(tradeRow(e, R.now)); R.run(500); const m = R.rows.find(x => x.k === "mirror" && x.status === "filled"); ok("...and the trade is recorded with the reason stop rejected", m && m.notes.includes("stop rejected") && m.exitReason.includes("stop rejected"), JSON.stringify(m));
      const R3 = rig(); R3.now = 1000; R3.start(); R3.M.clearFault(); ok("clearing a fault by the user lets entries through again", R.M.clearFault() === undefined && (R.M.clearFault(), R.M.state().state === "ready")); }
    { const R = rig({ beh: { "stop:s": "silent" } }); R.now = 1000; R.start(); R.row(enter()); R.run(5000);
      ok("a stop not confirmed within 3 seconds: the position is closed at market", R.flat() && R.faults.length >= 1 && /stop/.test(R.faults[0].kind), JSON.stringify(R.faults)); }
    { const R = rig({ beh: { "stop:s": { slow: 6000 } } }); R.now = 1000; R.start(); R.row(enter()); R.run(9000);
      ok("a stop confirmed late, after the position was closed: the stray stop is cancelled, the account ends flat", R.flat() && R.faults.length >= 1, JSON.stringify([R.X.stops, R.X.pos, R.faults])); }
    // ----- rule 6: unknown result
    { const R = rig({ beh: { "market:e": "silent" } }); R.now = 1000; R.start(); R.row(enter()); R.run(10000);
      ok("an entry with no answer is looked up by its client id: it was filled, so the machine goes on (stop placed), no fault", R.X.sent.some(r => r.op === "lookup" && r.of.startsWith("svx_")) && R.X.stops.length === 1 && R.faults.length === 0 && R.M.state().state === "holding", JSON.stringify([R.M.state(), R.faults])); }
    { const R = rig({ beh: { "market:e": "lost" } }); R.now = 1000; R.start(); R.row(enter()); R.run(10000);
      ok("an entry that never reached the exchange: the lookup says not found, nothing is held, no fault, the trade stays paper", R.X.pos === 0 && R.faults.length === 0 && R.M.state().state === "ready" && R.rows.some(x => x.k === "mirror" && x.status === "failed"), JSON.stringify(R.rows)); }
    { const R = rig({ beh: { "market:e": { slow: 2000 } } }); R.now = 1000; R.start(); R.row(enter()); R.run(12000);
      ok("an answer that arrives after the timeout does not place two stops or two entries", R.X.pos === 1 && R.X.stops.length === 1 && R.X.sent.filter(r => r.op === "market").length === 1, JSON.stringify(R.X.sent.map(r => r.op + r.role))); }
    { const R = rig({ beh: { "market:e": "silent", "lookup:e": "reject" } }); R.now = 1000; R.start(); R.row(enter()); R.run(20000);
      ok("a state still unknown after 5 seconds: fault, own position closed, entries blocked", R.faults.some(f => f.kind === "unknown order state") && R.flat() && R.M.state().state === "fault", JSON.stringify([R.faults, R.X.pos, R.X.stops])); }
    // ----- exits
    const hold = (over) => { const o = happy(over); return o; };
    { const { R, e } = hold({ beh: { "market:x#1": "reject" } }); R.run(500); R.row(exitRow(e, R.now)); R.run(2000); R.row(tradeRow(e, R.now)); R.run(500);
      ok("an exit that needed a second attempt succeeds, is a fault, and ends flat", R.flat() && R.faults.some(f => f.kind === "exit needed more than one attempt") && R.rows.some(x => x.k === "mirror" && x.fill === "demo"), JSON.stringify([R.faults, R.X.sent.map(r => r.op + r.role)])); }
    { const { R, e } = hold({ beh: { "market:x#1": "lost" } }); R.run(500); R.row(exitRow(e, R.now)); R.run(9000); R.row(tradeRow(e, R.now)); R.run(500);
      ok("an exit that got no answer and never reached the exchange is looked up, sent again, and is a fault (needed more than one attempt)", R.flat() && R.faults.some(f => f.kind === "exit needed more than one attempt") && R.rows.some(x => x.k === "mirror" && x.fill === "demo" && x.notes.includes("exit retried")), JSON.stringify([R.faults, R.rows])); }
    { const { R, e } = hold({ beh: { "market:x#1": "silent" } }); R.run(500); R.X.downUntil = R.now + 16000; R.row(exitRow(e, R.now)); R.run(26000); R.row(tradeRow(e, R.now)); R.run(500);
      ok("an exit that DID fill but whose answer was lost, with the lookup down for 16 s: still unknown 5 s after the 8 s request timeout (fault), sent again, refused as reduce-only, the earlier exit is found by its client id, the row has its real fill, flat", R.flat() && R.faults.some(f => f.kind === "unknown order state") && R.rows.some(x => x.k === "mirror" && x.status === "filled" && x.exitPx > 0), JSON.stringify([R.faults.map(f => f.kind), R.rows, R.X.pos])); }
    { const { R, e } = hold(); R.run(500); R.X.netDown = R.now + 45000; R.row(exitRow(e, R.now)); R.run(30000); const during = { pos: R.X.pos, state: R.M.state().state }; R.run(30000); R.row(tradeRow(e, R.now)); R.run(1000);
      ok("a network drop of 45 s across the exit: the position stays (the stop holds it), faults are raised, and once the network is back the poll sends the exit again; flat, one mirror row with the real exit", during.pos === 1 && R.flat() && R.faults.some(f => f.kind === "unknown order state") && R.rows.filter(x => x.k === "mirror" && x.status === "filled").length === 1 && R.M.state().phase === "idle", JSON.stringify([during, R.faults.map(f => f.kind), R.rows.map(x => x.status), R.X.pos, R.M.state()])); }
    { const { R, e } = hold({ beh: { "market:x#1": "silent" } }); R.run(500); R.X.netDown = R.now + 40000; R.row(exitRow(e, R.now)); R.run(70000); R.row(tradeRow(e, R.now)); R.run(1000);
      ok("an exit that DID fill, then a 40 s drop: flat on the exchange and nothing left to reduce; the poll looks up the earlier exit by client id and the row has its real fill", R.flat() && R.rows.some(x => x.k === "mirror" && x.status === "filled" && x.exitPx > 0) && R.M.state().phase === "idle", JSON.stringify([R.faults.map(f => f.kind), R.rows, R.M.state()])); }
    { const { R, e } = hold(); R.run(500); R.X.netDown = R.now + 45000; R.row(exitRow(e, R.now)); R.run(5000); R.X.setPx(99.0, R.now); R.run(60000); R.row(tradeRow(e, R.now)); R.run(1000);
      const m = R.rows.find(x => x.k === "mirror");
      ok("a network drop across the exit during which the exchange STOP fires: the account is flat, the stop's fill is the real exit, the row says so and is a demo fill, faults are raised, nothing is left on the exchange", R.flat() && m && m.status === "filled" && m.fill === "demo" && m.notes.includes("stop fired on the exchange") && m.exitPx < 99.5 && R.faults.length >= 1 && R.M.state().phase === "idle", JSON.stringify([m, R.faults.map(f => f.kind), R.X.pos, R.X.stops, R.M.state(), R.M.debug()])); }
    { const { R, e } = hold({ beh: { "market:x": "reject" } }); R.run(500); R.row(exitRow(e, R.now)); R.run(3000);
      ok("an exit that always fails stops after three tries, raises a fault, keeps the stop on the exchange and waits for the user (no endless loop)", R.X.sent.filter(r => r.op === "market" && r.role === "x").length === 3 && R.faults.some(f => f.kind === "exit failed") && R.X.stops.length === 1 && R.X.pos === 1 && R.M.state().state === "fault", JSON.stringify(R.M.state())); }
    { const { R, e } = hold(); R.run(500); R.X.setPx(99.0, R.now); R.run(3200);
      ok("a stop that triggers on the exchange before the paper exit: the page sees flat on its poll, reads the stop's fill as the real exit", R.X.pos === 0 && R.rows.length === 0 && R.M.state().phase !== "holding", JSON.stringify([R.M.state(), R.X.book]));
      R.row(exitRow(e, R.now, "stop")); R.row(tradeRow(e, R.now, { reason: "stop" })); R.run(500);
      const m = R.rows.find(x => x.k === "mirror"); ok("...and the row has the exchange stop's fill, the note, and the account is flat", m && m.status === "filled" && m.notes.includes("stop fired on the exchange") && m.exitPx < 99.5 && R.flat(), JSON.stringify(m)); }
    { const { R, e } = hold({ partial: 0.5 }); R.run(500); R.row(exitRow(e, R.now)); R.run(1500); R.row(tradeRow(e, R.now)); R.run(500);
      ok("a partial entry fill: the stop and the exit are sized on what was filled, the note says partial, flat at the end", R.flat() && R.X.stops.length === 0 && R.rows.some(x => x.k === "mirror" && x.notes.includes("partial fill") && x.qty === 0.5), JSON.stringify([R.rows, R.X.sent.map(r => r.qty)])); }
    { const { R, e } = hold(); R.run(500); R.M.onRow(exitRow(e, R.now - 12000), R.now, G); R.pump(R.now); R.run(1500); R.row(tradeRow(e, R.now)); R.run(500); const m = R.rows.find(x => x.k === "mirror" && x.status === "filled");
      ok("a late exit (the page woke 12 s after the paper exit): exited at once, lateness and the note recorded, the stop bounded the loss meanwhile", m && m.lateMs >= 12000 && m.notes.includes("late exit") && R.flat(), JSON.stringify(m)); }
    // ----- rule 5 and faults: start, foreign, leftover
    { const R = rig({ pos: 0.4, stops: [{ cid: "svx_zz_1_s1", side: "SELL", qty: 0.4, trig: 90 }] }); R.now = 1000; R.start({ savedOpen: true, savedSys: "A" });
      ok("a reload with the page's own position left: its orders are cancelled, it is closed at market, recorded as interrupted with the real exit, a fault is raised, ends flat", R.flat() && R.faults.some(f => /leftover/.test(f.kind)) && R.rows.some(x => x.k === "mirror" && x.status === "interrupted"), JSON.stringify([R.rows, R.faults, R.X.pos])); }
    { const R = rig({ pos: 0.4 }); R.now = 1000; R.start({ savedOpen: false });
      ok("a position that is not the page's own blocks execution, is not touched, and says why", R.X.pos === 0.4 && R.X.sent.length === 0 && R.M.state().state === "fault" || (R.X.pos === 0.4 && R.X.sent.length === 0 && /not the page's own/.test(R.M.state().why)), JSON.stringify(R.M.state()));
      R.M.clearFault(); R.row(enter()); R.run(500); ok("...and no entry is sent while it is there", R.X.sent.length === 0 && R.rows[R.rows.length - 1].notes[0].includes("blocked"), JSON.stringify(R.rows));
      R.X.pos = 0; R.run(4000); R.row(enter({ t: 9000, pid: "A:9000" })); R.run(1000); ok("...it clears by itself when the position is gone", R.X.pos === 1, JSON.stringify(R.M.state())); }
    { const R = rig({ foreign: [{ cid: "manual-1", algo: false }] }); R.now = 1000; R.start(); R.row(enter()); R.run(500);
      ok("an order made by hand on the asset blocks entries and is never cancelled by the page", R.X.sent.length === 0 && R.M.state().state === "blocked" && R.rows[0].notes[0].includes("blocked")); }
    { const R = rig({ stops: [{ cid: "svx_zz_1_s1", side: "SELL", qty: 1, trig: 90 }] }); R.now = 1000; R.start(); ok("an own order with no position is cancelled at start, no fault", R.X.stops.length === 0 && R.faults.length === 0); }
    { const { R } = hold(); R.X.pos = 3; R.run(3500);
      ok("the exchange position changed from outside while holding: a fault, the whole exchange position is closed", R.faults.some(f => /differs/.test(f.kind)) && R.X.pos === 0, JSON.stringify([R.faults, R.X.pos])); }
    { const { R } = hold(); R.X.stops.length = 0; R.run(4500);
      ok("the stop order vanished from the exchange: a fault and the position is closed", R.faults.some(f => /differs/.test(f.kind)) && R.X.pos === 0, JSON.stringify(R.faults)); }
    // ----- the kill switch from every state
    const killAt = (name, setup, steps) => { const R = rig(setup && setup.over); R.now = 1000; R.start(); const e = enter(); R.row(e); R.run(steps); R.M.kill(R.now); R.pump(R.now); R.run(4000);
      ok("kill switch " + name + ": flat, no order left, entries blocked, the switch stays on", R.flat() && R.M.state().state === "killed" && R.M.snapshot().killed === true, JSON.stringify([R.X.pos, R.X.stops, R.M.state()])); return R; };
    killAt("while the entry is in flight", { over: {} }, 0); killAt("while the stop is being placed", { over: {} }, 100); killAt("while holding", { over: {} }, 1000);
    { const R = rig({ beh: { "market:e": { slow: 1500 } } }); R.now = 1000; R.start(); R.row(enter()); R.run(200); R.M.kill(R.now); R.pump(R.now); R.run(6000); ok("kill switch pressed while the entry answer is still on its way: the fill arrives, is closed at once, flat", R.flat() && R.X.stops.length === 0); }
    { const { R, e } = hold(); R.run(300); R.row(exitRow(e, R.now)); R.M.kill(R.now); R.run(3000); ok("kill switch while the exit is in flight: one exit only, flat", R.flat() && R.X.sent.filter(r => r.op === "market" && r.role === "x").length === 1); }
    { const R = rig(); R.now = 1000; R.start(); R.M.kill(R.now); R.row(enter()); R.run(500); R.M.unkill(); R.row(enter({ t: 5000, pid: "A:5000" })); R.run(1000); ok("kill switch while ready blocks entries; turned off it lets them through", R.rows[0].notes[0] === "kill switch" && R.X.pos === 1); }
    { const R = rig({}, { saved: { killed: true } }); R.now = 1000; R.start(); R.row(enter()); R.run(300); ok("a kill switch saved by the page is still on after a reload", R.M.state().state === "killed" && R.X.sent.length === 0); }
    // ----- a reload in every state ends flat
    const reloadAt = (name, steps, over) => { const R = rig(over); R.now = 1000; R.start(); R.row(enter()); R.run(steps); const snap = R.M.snapshot(), X = R.X; X.queue.length = 0;
      const R2 = rig(); R2.X = X; R2.M = mk({ base: DEMO_BASE, saved: snap }); R2.pump = R.pump.bind({}); const M2 = R2.M; R2.now = R.now;
      const pump2 = now => { const d = M2.drain(); for (const q of d.reqs) X.exec(q, now); return d; };
      M2.start(X.snap(R2.now), R2.now, { savedOpen: !!snap.open, savedSys: snap.open && snap.open.sys }); pump2(R2.now);
      for (let i = 0; i < 60; i++) { R2.now += 100; for (const q of X.queue.filter(z => z.at <= R2.now)) { X.queue.splice(X.queue.indexOf(q), 1); M2.reply(q.id, q.a, R2.now); } M2.tick(R2.now); pump2(R2.now); }
      ok("a reload " + name + " ends flat with no order of the page's left", X.pos === 0 && X.stops.length === 0, JSON.stringify([X.pos, X.stops, M2.state()])); };
    reloadAt("while the entry is in flight (answer comes back)", 50); reloadAt("while the stop is being placed", 150); reloadAt("while holding", 1500);
    // every machine state is left by some scenario above: entering (fill, reject, lost, late), stopping (confirm, reject, late), holding (exit, stop fired, changed, kill), exiting (filled, failed), settling (stop fired), stuck (waits for the user)
    // ----- a fault never lets a new entry through until cleared
    { const R = rig({ beh: { "stop:s": "reject" } }); R.now = 1000; R.start(); R.row(enter()); R.run(1500); R.row(enter({ sys: "B", pid: "B:3000", t: 3000 })); const m = R.rows.filter(x => x.k === "mirror").pop();
      ok("after a fault a new entry is refused (the paper trade goes on) until the user clears it", m.notes[0] === "fault not cleared" && R.X.sent.filter(r => r.op === "market" && r.role === "e").length === 1); }
    // ----- other stages are ignored
    { const R = rig(); R.now = 1000; R.start(); R.row(enter({ stage: "paper" })); R.run(300); ok("a paper-stage entry is not mirrored", R.X.sent.length === 0 && R.rows.length === 0); }
    // ----- the interrupted paper trade (a gap or a disconnect) closes the real position too
    { const { R, e } = hold(); R.run(300); R.row(tradeRow(e, R.now, { interrupted: true, reason: "interrupted" })); R.run(2000);
      ok("the paper trade closed as interrupted (disconnect or gap): the real position is closed, the row says interrupted", R.flat() && R.rows.some(x => x.k === "mirror" && x.status === "interrupted"), JSON.stringify(R.rows)); }
    return res;
  }
  return { create, merge, selftest, isDemoBase, DEMO_BASE, ALLOW_LIVE, C };
})();
