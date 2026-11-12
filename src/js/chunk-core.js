// Chunk core (Trader step 6a): continuous recording. Pure: no DOM, timers, storage or clock; everything it needs is handed in, so the same inputs always give the same chunks.
// One input stream: the pipeline takes every input the page consumes, thins quotes to one per 100 ms per venue (the rule the old recorder used, applied once, at the entrance), records what it lets through,
// and hands it to the facts accumulator (SYSTEM.facts), which hands it to the engine. The recording is exactly what the engine consumed.
// A run: from an engine reset (connect, asset change, page load) to the next reset or the disconnect. A chunk: a cut of one run's stream, made when an input's OWN time is 30 minutes after the chunk's first
// input, or at 600,000 inputs, never by a timer. A chunk file is a session file (kind "sv-session", `inputs` as always) plus: run, seq, final, runner (configuration, carry-over, on), engineCfg, lateMs, thinMs, rows
// (the journal rows the page wrote during the chunk), moves (step 7: the stage moves applied to the runner during the chunk, [{sys, to, at}] with `at` the snapshot time they took effect; they are user actions, so a replay is handed them),
// changed (settings that moved during the chunk, which a replay cannot follow) and prevMissing. runner.stages (chunk 0) is {system id: stage} at the start of the run.
const CHUNK = (() => {
  "use strict";
  const MAX_MS = 1800000, MAX_N = 600000, THIN_MS = 100, KIND = "sv-session", EMPTY = [];
  // the time of an input record, null when it has none
  function timeOf(r) {
    const k = r[0], t = k === "t" ? (r[1] && r[1].t) : k === "a" ? r[1] : (k === "q" || k === "b" || k === "s") ? r[2] : null;
    return typeof t === "number" && t > 0 ? t : null;
  }
  // one quote per ms-window per venue; a quote that is let through starts the next window. Thinning an already thinned stream changes nothing.
  function thinner(ms) {
    let last = {};
    return { pass(vn, t) { if (ms > 0 && t - last[vn] < ms) return false; last[vn] = t; return true; }, reset() { last = {}; } };
  }
  const trRec = tr => tr ? ["t", { t: tr.t, v: tr.v, side: tr.side, px: tr.px, q: tr.q, ntl: tr.ntl, liq: !!tr.liq, users: tr.users }] : ["t", tr];

  // facts: {feed(record) -> snapshots, reset()}. o.onChunk(chunk) gets every finished chunk. o.cfgNow(): a string that changes when the engine's settings change (read at the chunk's start and end).
  function pipeline(o) {
    const F = o.facts, maxMs = o.maxMs || MAX_MS, maxN = o.maxN || MAX_N, thin = thinner(o.thinMs == null ? THIN_MS : o.thinMs), cfgNow = o.cfgNow || (() => "");
    let run = null;
    const startChunk = () => { run.rec = []; run.rows = []; run.moves = []; run.exec = []; run.t0 = null; run.t1 = null; run.changed = []; run.cfg0 = cfgNow(); };
    function emit(final, why) {
      const r = run; if (!r) return;
      if (cfgNow() !== r.cfg0 && !r.changed.includes("engine settings")) r.changed.push("engine settings");
      if (r.rec.length || r.rows.length || r.moves.length || r.exec.length) {
        const c = { kind: KIND, v: 1, sym: r.meta.sym, startedAt: r.t0 || r.meta.startedAt, run: r.meta.id, seq: r.seq, final: !!final, why: why || "cut", prevMissing: false, changed: r.changed.slice(),
          runner: r.seq === 0 ? r.meta.runner : Object.assign({}, r.meta.runner, { carry: undefined, stages: undefined }), engineCfg: r.meta.engineCfg, lateMs: r.meta.lateMs, thinMs: r.thinMs, t0: r.t0, t1: r.t1, rows: r.rows, moves: r.moves, exec: r.exec, inputs: r.rec };
        r.seq++; startChunk(); o.onChunk(c);
      } else startChunk();
    }
    function input(rec) {
      if (rec[0] === "q" && !thin.pass(rec[1], rec[2])) return EMPTY;
      if (run) {
        const x = timeOf(rec);
        if (run.rec.length && (run.rec.length >= maxN || (x != null && run.t0 != null && x - run.t0 >= maxMs))) emit(false, "cut");
        run.rec.push(rec);
        if (x != null) { if (run.t0 == null) run.t0 = x; if (run.t1 == null || x > run.t1) run.t1 = x; }
      }
      return F.feed(rec);
    }
    return {
      trade: tr => input(trRec(tr)), quote: (v, t, b, a) => input(["q", v, t, b, a]), book: (v, t, b, a) => input(["b", v, t, b, a]), sweep: (v, t, s, n, l) => input(["s", v, t, s, n, l]), advance: t => input(["a", t]),
      input,
      // the engine, the accumulator and the thinning start again; a run that was going is ended first (final: false, because the caller has not stopped its runner; use end() before reset() for that)
      reset() { if (run) emit(false, "reset"), run = null; F.reset(); thin.reset(); },
      // meta: {id, sym, startedAt, runner:{on, cfg, ids, carry}, engineCfg, lateMs}. Starts recording a run.
      begin(meta) { if (run) emit(false, "restart"); run = { meta, seq: 0, thinMs: o.thinMs == null ? THIN_MS : o.thinMs }; startChunk(); },
      // final: the caller stopped its runner (its closing rows are already in addRows), so a replay stops its own runner too. why: "disconnect" | "reset" | "switch" | ...
      end(final, why) { if (run) { emit(final, why || "end"); run = null; } },
      addRows(rows) { if (run && rows.length) for (const r of rows) run.rows.push(r); },
      addExec(rows) { if (run && rows.length) for (const r of rows) run.exec.push(r); },      // step 8: mirror rows (what the demo exchange did). Recorded facts: a replay does not reproduce them and firstDiff does not read them.
      addMoves(moves) { if (run && moves.length) for (const m of moves) run.moves.push(m); },      // [{sys, to, at}] from RUNNER.driver().drain()
      touch(what) { if (run && !run.changed.includes(what)) run.changed.push(what); },
      running: () => !!run, state: () => run ? { id: run.meta.id, seq: run.seq, n: run.rec.length, t0: run.t0, t1: run.t1, rows: run.rows.length } : null,
    };
  }

  // Replay of one run's chunks (in seq order): a new engine, a new accumulator, the runner driver, exactly as the page began the run. deps: {ENGINE, SYSTEM, RUNNER, SYSTEMS}.
  // Returns {rows: [rows per chunk], stoppedAt} ; a chunk marked `changed` ends what can be followed: the replay stops before it (upto = number of chunks followed).
  function replay(chunks, deps) {
    const c0 = chunks[0], rn = c0.runner || {}, E = deps.ENGINE.create(c0.engineCfg || undefined), F = deps.SYSTEM.facts({ engine: E, lateMs: c0.lateMs == null ? 1000 : c0.lateMs });
    const drv = rn.on ? deps.RUNNER.driver(Object.assign({ systems: deps.SYSTEMS }, rn.cfg, { carry: rn.carry || [], stages: rn.stages || {} })) : null;
    const out = []; let upto = 0;
    for (const c of chunks) {
      if (c.changed && c.changed.length && c !== c0) break;      // settings moved inside this chunk (or an earlier one): the replay cannot follow from here
      const rows = [], mv = (c.moves || []).slice().sort((a, b) => a.at - b.at); let mi = 0;      // a move is handed back just before the snapshot whose time it took effect at
      for (const r of c.inputs) { const snaps = F.feed(r); if (drv) for (const s of snaps) { while (mi < mv.length && mv[mi].at <= s.t) drv.move(mv[mi++]); for (const x of drv.step(s)) rows.push(x); } }
      if (c.final && drv) for (const x of drv.stop()) rows.push(x);
      out.push(rows); upto++;
      if (c.changed && c.changed.length) break;
    }
    return { rows: out, upto };
  }
  // chunks of one run: complete (seq 0..n without a hole), whether it starts at 0, and the holes
  function check(chunks) {
    const seqs = chunks.map(c => c.seq).sort((a, b) => a - b), holes = []; let next = seqs[0] === 0 ? 0 : seqs[0];
    for (const s of seqs) { while (next < s) holes.push(next++); next = s + 1; }
    return { first: seqs[0], last: seqs[seqs.length - 1], startsAtZero: seqs[0] === 0, holes };
  }
  // the first difference between the rows a chunk stored and the rows the replay made, as JSON; null when equal
  // Rows a chunk stored before step 7 have no stage and fill on their enter and trade rows; they read as paper / paper (the page wrote paper fills under stage paper then), so an old chunk still replays equal.
  const legacy = r => r && (r.k === "enter" || r.k === "trade") && r.stage === undefined && r.fill === undefined ? Object.assign({}, r, { stage: "paper", fill: "paper" }) : r;
  function firstDiff(stored, made) {
    const n = Math.max(stored.length, made.length);
    for (let i = 0; i < n; i++) { const a = i < stored.length ? JSON.stringify(legacy(stored[i])) : undefined, b = i < made.length ? JSON.stringify(made[i]) : undefined; if (a !== b) return { i, stored: a, replay: b }; }
    return null;
  }
  // chunk file name: session_<SYM>_<minute of the first input>_run<id>-c<seq>; it still matches the old session_*.json.gz pattern
  function fileName(c, gz) {
    const stamp = new Date(c.startedAt || 0).toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return "session_" + (String(c.sym || "X").replace(/[^A-Za-z0-9_-]/g, "") || "X") + "_" + stamp + "_run" + c.run + "-c" + String(c.seq).padStart(3, "0") + (gz ? ".json.gz" : ".json");
  }

  // The checks that still matter for a page left running for hours (they were the Arm mode checklist). env: {connected, recOn, folder:{supported, state:"ok"|"none"|"denied"|"failed", name}|null, disk:{tone, text}|null,
  // battery:{charging, level 0..1}|null, wakeApi, wake (lock held), newer (a newer version string or null), hidden, persisted}. Items {id, tone:"ok"|"warn"|"bad"|"info", text, fix}; fix is empty when ok.
  function leftRunning(env) {
    const out = [], add = (id, tone, text, fix) => out.push({ id, tone, text, fix: tone === "ok" ? "" : fix || "" });
    if (!env.recOn) add("rec", "bad", "Recording is off", "Turn the switch on (Continuous recording): nothing is being kept.");
    else if (!env.connected) add("rec", "warn", "Not connected", "Press Connect: a run is recorded from connect to disconnect.");
    else add("rec", "ok", "Connected and recording");
    const f = env.folder;
    if (f && f.supported) {
      if (f.state === "ok") add("folder", "ok", "Save folder: " + (f.name || "chosen"));
      else if (f.state === "none") add("folder", "warn", "No save folder: chunks are kept in this browser for 24 hours only", "Choose a folder (Saved recordings, Choose folder).");
      else if (f.state === "denied") add("folder", "bad", "The browser took back access to the save folder", "Press Allow (Saved recordings).");
      else add("folder", "bad", "The last save into the folder failed", "Check the folder and the disk.");
    }
    if (env.disk) add("disk", env.disk.tone === "ok" ? "ok" : env.disk.tone, "Disk room: " + env.disk.text, "Free some space or choose another folder.");
    if (env.persisted === false) add("persist", "warn", "The browser may evict stored chunks", "Allow persistent storage for this site.");
    if (env.battery) add("power", env.battery.charging ? "ok" : env.battery.level < 0.5 ? "bad" : "warn", env.battery.charging ? "Power: charging" : "Power: on battery, " + Math.round(env.battery.level * 100) + "%", "Plug in the device.");
    if (env.connected && env.wakeApi === false) add("wake", "warn", "No screen wake lock in this browser: the device may sleep", "Turn off sleep in the system settings.");
    else if (env.connected && env.wakeApi && !env.wake) add("wake", "warn", "The screen wake lock is not held: the device may sleep", "Keep the tab visible; the lock is asked for again when it is.");
    else if (env.connected) add("wake", "ok", "Screen wake lock held");
    if (env.newer) add("version", "warn", "A newer version (" + env.newer + ") is out", "Reload when you can stop the run: the chunk being recorded is lost on a reload.");
    return { items: out, bad: out.filter(x => x.tone === "bad").length, warn: out.filter(x => x.tone === "warn").length };
  }

  // ---------- self-test: scenarios named chunk:* ----------
  function selftest() {
    const res = [], ok = (name, c, detail) => res.push({ name: "chunk:" + name, ok: !!c, detail: c ? "" : String(detail || "") });
    const T0 = 1.7e12;
    // a synthetic stream: quotes every 40 ms on both venues, a trade a second, a clock tick every 250 ms; price walks so the runner has things to do
    const stream = (secs, step) => {
      const a = []; let px = 100;
      for (let ms = 0; ms < secs * 1000; ms += 40) {
        const t = T0 + ms; px = 100 * (1 + 4e-4 * Math.sin(ms / 20000) + 3e-4 * Math.floor(ms / 30000 % 2));
        a.push(["q", "bn", t, px - 0.01, px + 0.01]); if (ms % 80 === 0) a.push(["q", "hl", t + 3, px - 0.012, px + 0.012]);
        if (ms % 1000 === 0) a.push(["t", { t, v: ms % 2000 ? "bn" : "hl", side: ms % 3000 ? "buy" : "sell", px, q: 1, ntl: px * (1 + (ms % 7000) / 1000) }]);
        if (ms % 250 === 0) a.push(["a", t - 1500]);
        if (ms % 500 === 0) a.push(["b", "bn", t, [[px - 0.01, 5], [px - 0.02, 6]], [[px + 0.01, 5], [px + 0.02, 6]]]);
      }
      return a;
    };
    const apply = (p, rec) => { switch (rec[0]) { case "t": return p.trade(rec[1]); case "q": return p.quote(rec[1], rec[2], rec[3], rec[4]); case "b": return p.book(rec[1], rec[2], rec[3], rec[4]); case "a": return p.advance(rec[1]); } return EMPTY; };
    // ----- thinning: twice is once, the first quote of a window passes, a later one inside it does not, venues apart
    { const s = stream(20), t1 = thinner(100), once = s.filter(r => r[0] !== "q" || t1.pass(r[1], r[2])), t2 = thinner(100), twice = once.filter(r => r[0] !== "q" || t2.pass(r[1], r[2]));
      ok("thinning the stream twice equals once, and it removed some", JSON.stringify(once) === JSON.stringify(twice) && once.length < s.length && once.filter(r => r[0] === "q" && r[1] === "bn").length > 100, once.length + " " + twice.length + " of " + s.length);
      const t = thinner(100); ok("thinning: the quote at +99 ms is dropped, +100 passes, venues are separate, a quote out of order is dropped", t.pass("bn", 1000) && !t.pass("bn", 1099) && t.pass("bn", 1100) && t.pass("hl", 1050) && !t.pass("bn", 1000)); }
    // ----- the time rule and the count rule, and chunks of a run joined equal the uncut stream
    const mkFacts = () => { const E = READER_ENGINE.create(); return { E, F: SYSTEM.facts({ engine: E, lateMs: 1000 }) }; };
    const runOf = (inputs, o) => {
      const { F } = mkFacts(), got = [], p = pipeline(Object.assign({ facts: F, onChunk: c => got.push(c) }, o)); p.reset(); p.begin({ id: "r1", sym: "BTC", startedAt: T0, runner: { on: false }, engineCfg: null, lateMs: 1000 });
      for (const r of inputs) apply(p, r); p.end(true, "disconnect"); return got;
    };
    { const s = stream(300), whole = runOf(s, { maxMs: 1e9, maxN: 1e9 }), cut = runOf(s, { maxMs: 100000 }), joined = [].concat(...cut.map(c => c.inputs));
      ok("a chunk is cut by input time: 300 s of data at 100 s a chunk is three chunks, each under 100 s long and seq 0,1,2", cut.length === 3 && cut.every((c, i) => c.seq === i && c.t1 - c.t0 < 100000) && cut[0].final === false && cut[2].final === true, cut.map(c => c.seq + ":" + c.inputs.length + ":" + (c.t1 - c.t0)).join(" "));
      ok("two or more chunks of a run joined equal the uncut stream", whole.length === 1 && JSON.stringify(joined) === JSON.stringify(whole[0].inputs) && joined.length > 1000, joined.length + " " + (whole[0] && whole[0].inputs.length));
      const byN = runOf(s, { maxN: 1000, maxMs: 1e9 });
      ok("a chunk is cut by count: every chunk but the last holds exactly maxN inputs, nothing lost or repeated", byN.length > 2 && byN.slice(0, -1).every(c => c.inputs.length === 1000) && JSON.stringify([].concat(...byN.map(c => c.inputs))) === JSON.stringify(whole[0].inputs)); }
    // the cut never looks at a clock: the same stream delivered in one go or slowly gives the same chunks (the pipeline has no timer; this is the same call, so it checks the cut is by input time only)
    { const s = stream(300), a = runOf(s, { maxMs: 100000 }), b = runOf(s, { maxMs: 100000 }); ok("the cuts are the same every time for the same inputs", JSON.stringify(a.map(c => c.inputs.length)) === JSON.stringify(b.map(c => c.inputs.length))); }
    // ----- the gap rule is in the runner core (driver): a gap of more than gapMs restarts the runner with the equity carried and the open position interrupted
    // ----- a simulated run recorded in three chunks and replayed gives the same journal as the run itself
    { const D = typeof SYSTEMS_DEFAULT !== "undefined" ? SYSTEMS_DEFAULT : null;
      if (D) {
        const s = stream(900), cfg = { twins: 3, equity: 10000, feeBps: 5, riskCap: 0.02, seed: 1, gapMs: 30000 }, got = [];
        const { F } = mkFacts(), drv = RUNNER.driver(Object.assign({ systems: D, journal: [] }, cfg)), p = pipeline({ facts: F, maxMs: 300000, onChunk: c => got.push(c) });
        p.reset(); p.begin({ id: "r2", sym: "BTC", startedAt: T0, runner: { on: true, cfg, ids: D.map(d => SYSTEM.id(d)), carry: drv.carry, stages: drv.stages() }, engineCfg: null, lateMs: 1000 });
        const live = []; let moved = 0; for (const r of s) for (const sn of apply(p, r)) { if (!moved && sn.t >= T0 + 400000) { moved = 1; for (const d of D.slice(0, 3)) drv.move({ sys: SYSTEM.id(d), to: "demo" }); }      // the user moves three systems to demo 400 s in
          const rows = drv.step(sn); p.addRows(rows); p.addMoves(drv.drain()); for (const x of rows) live.push(x); }
        { const rows = drv.stop(); p.addRows(rows); for (const x of rows) live.push(x); } p.end(true, "disconnect");
        const stored = JSON.parse(JSON.stringify(got)), rp = replay(stored, { ENGINE: READER_ENGINE, SYSTEM, RUNNER, SYSTEMS: D });
        const flat = [].concat(...rp.rows), eq = JSON.stringify(flat) === JSON.stringify(live) && stored.every((c, i) => !CHUNK.firstDiff(c.rows, rp.rows[i]));
        ok("a simulated run recorded in three chunks and replayed (through JSON) gives the same journal as the run itself, chunk by chunk", got.length === 3 && eq && live.length > 0, got.length + " chunks, " + live.length + " live rows, " + flat.length + " replay rows " + JSON.stringify(CHUNK.firstDiff(live, flat)));
        { const mvs = [].concat(...stored.map(c => c.moves || [])), after = live.filter(x => x.k === "enter" && x.t >= T0 + 400000 && D.slice(0, 3).some(d => SYSTEM.id(d) === x.sys)), noMoves = replay(stored.map(c => Object.assign({}, c, { moves: [] })), { ENGINE: READER_ENGINE, SYSTEM, RUNNER, SYSTEMS: D });
          ok("stage moves: recorded in the chunk where they took effect (three, one snapshot time), the replay handed them gives the same journal with the stages in it, and without them it does not", mvs.length === 3 && new Set(mvs.map(m => m.at)).size === 1 && mvs.every(m => m.to === "demo") && after.length > 0 && after.every(x => x.stage === "demo") && eq && JSON.stringify([].concat(...noMoves.rows)) !== JSON.stringify(live), mvs.length + " moves, " + after.length + " entries after"); }
        ok("a chunk carries the run, its number, the rows of its own stretch and the runner's configuration", got.every((c, i) => c.run === "r2" && c.seq === i && Array.isArray(c.rows)) && got[0].runner.on === true && got[0].runner.carry && got[1].runner.carry === undefined && got.reduce((a, c) => a + c.rows.length, 0) === live.length);
      } else ok("a simulated run recorded in three chunks (needs the default systems)", false, "SYSTEMS_DEFAULT missing"); }
    // ----- holes and checks
    { const c = (seq) => ({ seq }); const k = check([c(0), c(1), c(3), c(4)]), z = check([c(2), c(3)]); ok("check: a hole is named, and a run whose first chunk is missing is not startsAtZero", k.holes.join() === "2" && k.startsAtZero && !z.startsAtZero && z.first === 2); }
    { const d = firstDiff([{ a: 1 }, { a: 2 }], [{ a: 1 }, { a: 3 }]), e = firstDiff([{ a: 1 }], [{ a: 1 }, { a: 2 }]); ok("firstDiff: the first differing row with both versions, a missing row too, null when equal", d.i === 1 && d.stored === '{"a":2}' && d.replay === '{"a":3}' && e.i === 1 && e.stored === undefined && firstDiff([{ a: 1 }], [{ a: 1 }]) === null); }
    { const old = [{ k: "enter", sys: "A", px: 1 }, { k: "trade", sys: "A", usd: 2, thesis: "x" }, { k: "skip", sys: "A" }], neu = [{ k: "enter", sys: "A", px: 1, stage: "paper", fill: "paper" }, { k: "trade", sys: "A", usd: 2, thesis: "x", stage: "paper", fill: "paper" }, { k: "skip", sys: "A" }];
      ok("firstDiff: a chunk stored before step 7 (no stage, fill) equals the same rows read as paper / paper; a different stage is a difference", firstDiff(old, neu) === null && firstDiff(old, neu.map((r, i) => i === 1 ? Object.assign({}, r, { stage: "demo" }) : r)).i === 1 && firstDiff(neu, old) !== null); }
    { const name = fileName({ sym: "BTC", startedAt: Date.UTC(2026, 10, 11, 15, 30), run: "20261111153000", seq: 3 }, true); ok("file names keep the session_*.json.gz shape, with run and chunk number", /^session_BTC_202611111530_run20261111153000-c003\.json\.gz$/.test(name), name); }
    // ----- a settings change during a chunk is noted, and the replay does not follow past it
    { const { F } = mkFacts(), got = []; let cfg = "a"; const p = pipeline({ facts: F, maxMs: 1e9, cfgNow: () => cfg, onChunk: c => got.push(c) }); p.reset(); p.begin({ id: "r3", sym: "BTC", startedAt: T0, runner: { on: false }, engineCfg: null, lateMs: 1000 });
      const s = stream(20); for (let i = 0; i < s.length; i++) { if (i === 200) cfg = "b"; apply(p, s[i]); } p.end(false, "switch");
      ok("settings that changed during a chunk are noted on it", got.length === 1 && got[0].changed.join() === "engine settings" && got[0].final === false && got[0].why === "switch"); }
    { const good = { connected: true, recOn: true, folder: { supported: true, state: "ok", name: "sessions" }, disk: { tone: "ok", text: "40 GB" }, battery: { charging: true, level: 1 }, wakeApi: true, wake: true, newer: null, persisted: true };
      const r = leftRunning(good), t = (env, id) => leftRunning(Object.assign({}, good, env)).items.find(x => x.id === id);
      ok("left running: everything fine has no warning and no fix text", r.bad === 0 && r.warn === 0 && r.items.every(x => x.tone === "ok" && x.fix === ""));
      ok("left running: recording off is bad, not connected warns, a missing folder warns, a denied one is bad", t({ recOn: false }, "rec").tone === "bad" && t({ connected: false }, "rec").tone === "warn" && t({ folder: { supported: true, state: "none" } }, "folder").tone === "warn" && t({ folder: { supported: true, state: "denied" } }, "folder").tone === "bad" && !t({ folder: { supported: false } }, "folder"));
      ok("left running: disk tone passes on, battery under 50% is bad, a lost wake lock and a newer version warn", t({ disk: { tone: "bad", text: "1 GB" } }, "disk").tone === "bad" && t({ battery: { charging: false, level: 0.3 } }, "power").tone === "bad" && t({ battery: { charging: false, level: 0.8 } }, "power").tone === "warn" && t({ wake: false }, "wake").tone === "warn" && /v200/.test(t({ newer: "v200" }, "version").text)); }
    return res;
  }

  return { MAX_MS, MAX_N, THIN_MS, timeOf, thinner, pipeline, replay, check, firstDiff, fileName, leftRunning, selftest };
})();
