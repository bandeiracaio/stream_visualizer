// Parity of the runner core (R3): the JS reference (src/js/js-cores/runner-core.js, RUNNER_JS, on SYSTEM_JS) against the WebAssembly wrapper (src/js/runner-core.js, RUNNER, on the Rust systems). Called by parity.mjs (`node parity.mjs runner`).
// Both runners are stepped in lockstep on the same snapshot objects; every step's rows (deep, numbers by Object.is, object keys in the same order), the state() and risk() every few steps and at the end, the journal, the fresh rows,
// evaluate() over the journal, and the driver's own rows are compared. Inputs:
//  (A) the runner:* self-test on both versions;
//  (B) seeded random configurations (random systems of every kind, twins 0..20, equity, fee, risk cap, seed, stages, a journal handed over, moves, interrupts, gaps through the driver) on synthetic streams with quotes;
//  (C) the real thing: the seven default systems with 20 twins (the harness's configuration, journal carried from one session to the next, as `--run-defaults` does) and a random configuration, on the cached snapshots of the saved
//      sessions recorded before 2026-11-16T00:00Z (the file NAME decides; a later file is never opened).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadSystemContexts, randDef, synthSnaps, rng, mk } from "./parity-system.mjs";

const sdiff = (a, b, at) => {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b) ? null : at + ": " + (Object.is(a, -0) ? "-0" : a) + " vs " + (Object.is(b, -0) ? "-0" : b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b ? null : at + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b);
  if (Array.isArray(a) !== Array.isArray(b)) return at + ": array vs object";
  if (Array.isArray(a)) { if (a.length !== b.length) return at + ": length " + a.length + " vs " + b.length; for (let i = 0; i < a.length; i++) { const d = sdiff(a[i], b[i], at + "[" + i + "]"); if (d) return d; } return null; }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("|") !== kb.join("|")) return at + ": keys [" + ka + "] vs [" + kb + "]";
  for (const k of ka) { const d = sdiff(a[k], b[k], at + "." + k); if (d) return d; }
  return null;
};

export function loadRunnerContexts(root, wasmBytes) {
  const c = loadSystemContexts(root, wasmBytes), text = p => fs.readFileSync(path.join(root, "src", p), "utf8");
  c.run(text("js/systems-default.js"), "systems-default.js");
  c.run(text("js/js-cores/runner-core.js"), "js-cores/runner-core.js");
  c.run(text("js/runner-core.js"), "runner-core.js");
  return { ...c, RUNNER_JS: c.run("RUNNER_JS"), RUNNER: c.run("RUNNER"), DEFAULTS: c.run("SYSTEMS_DEFAULT") };
}

// the quote follows the price, a little wide; sometimes missing (a gap or no quote), sometimes old (age)
function addQuotes(rand, snaps) {
  const r = mk(rand);
  for (const s of snaps) {
    const p = s.px.bn, w = r.num(0.001, 0.02, 4);
    s.q = { bn: p != null && !r.chance(0.03) ? { bid: +(p - w).toFixed(4), ask: +(p + w).toFixed(4) } : null, hl: p != null ? { bid: p - 0.01, ask: p + 0.01 } : null };
  }
  return snaps;
}

// a configuration (the same object goes to both runners; systems and journal are cloned per runner so neither sees the other's objects)
function randConfig(rand, h0, defaults) {
  const r = mk(rand), n = r.int(1, 6), systems = Array.from({ length: n }, () => r.chance(0.15) ? r.pick(defaults) : randDef(rand, h0));
  const ids = new Set(), uniq = systems.filter(d => { const k = JSON.stringify(d.trigger) + JSON.stringify(d.exit) + d.venue + JSON.stringify(d.region) + JSON.stringify(d.context) + JSON.stringify(d.thesis) + JSON.stringify(d.risk); if (ids.has(k)) return false; ids.add(k); return true; });
  const cfg = { systems: uniq, twins: r.pick([0, 1, 3, 20, 20, 5]), equity: r.pick([10000, 10000, 2500, 123456.789]), feeBps: r.pick([5, 5, 0, 2.5, 10]), riskCap: r.pick([0.02, 0.01, 0.005, 0.5, 1e-9]), seed: r.pick([1, 1, 7, 12345, "abc", 0]) };
  if (r.chance(0.2)) delete cfg.twins; if (r.chance(0.2)) delete cfg.equity; if (r.chance(0.2)) delete cfg.feeBps; if (r.chance(0.2)) delete cfg.riskCap; if (r.chance(0.2)) delete cfg.seed;
  return cfg;
}

export async function runner(root, wasmBytes, st, cases, seed, opts = {}) {
  const { RUNNER_JS, RUNNER, SYSTEM_JS, SYSTEM, READER, DEFAULTS, ctx } = loadRunnerContexts(root, wasmBytes);
  const clone = x => structuredClone(x);
  const diffs = [];
  const note = (label, d) => { if (diffs.length < 40) diffs.push(label + " " + d); else if (diffs.length === 40) diffs.push("... more"); };
  const flush = (label, count, extra = "") => { st.report(label + extra, count, diffs.splice(0)); };
  const cmp = (label, a, b) => { const d = sdiff(a, b, "result"); if (d) note(label, d); return !d; };
  const seen = { rows: 0, enter: 0, trade: 0, twin: 0, skip: 0, interrupted: 0, reasons: {} };
  const tally = rows => { for (const x of rows) { seen.rows++; seen[x.k] = (seen[x.k] || 0) + 1; if (x.k === "skip") seen.reasons[x.reason] = (seen.reasons[x.reason] || 0) + 1; if (x.interrupted) seen.interrupted++; } };

  // a pair of runners (the page's wrapper and the reference) on clones of the same configuration, stepped in lockstep
  const pair = (cfg, label) => {
    let a, b, ea = null, eb = null;
    try { a = RUNNER_JS.create(clone(cfg)); } catch (e) { ea = e.message; }
    try { b = RUNNER.create(clone(cfg)); } catch (e) { eb = e.message; }
    if (ea !== eb) { note(label + " create", "error js: " + ea + " vs wasm: " + eb); return null; }
    if (ea) return { error: ea };
    let n = 0;
    const same = what => { cmp(label + " " + what + " rows", a.rows(), b.rows()); cmp(label + " " + what + " fresh", a.fresh(), b.fresh()); };
    cmp(label + " create fresh", a.fresh(), b.fresh()); cmp(label + " create state", a.state(), b.state()); cmp(label + " create risk", a.risk(), b.risk());
    return {
      a, b,
      step(snap, deep) {
        const ra = a.step(snap), rb = b.step(snap); n++; tally(ra);
        if (!cmp(label + " step " + snap.t, ra, rb)) return false;
        if (deep || n % 97 === 0) { cmp(label + " state@" + snap.t, a.state(), b.state()); cmp(label + " risk@" + snap.t, a.risk(), b.risk()); }
        return true;
      },
      interrupt(t) { const ra = a.interrupt(t), rb = b.interrupt(t); tally(ra); cmp(label + " interrupt", ra, rb); cmp(label + " state after interrupt", a.state(), b.state()); },
      move(id, to) { const ra = a.move(id, to), rb = b.move(id, to); cmp(label + " move", ra, rb); },
      finish() { same("final"); cmp(label + " final state", a.state(), b.state()); cmp(label + " final risk", a.risk(), b.risk()); cmp(label + " evaluate", RUNNER_JS.evaluate(a.rows()), RUNNER.evaluate(b.rows())); },
      dispose() { b.dispose(); },
      ids: () => a.state().map(s => s.id),
    };
  };

  // (A) the self-test on both versions
  if (opts.only !== "real") {
    const ja = RUNNER_JS.selftest(), wa = RUNNER.selftest(), bad = [];
    if (ja.length !== wa.length) bad.push(`scenario count ${ja.length} / ${wa.length}`);
    ja.forEach((x, i) => { if (!wa[i] || !x.ok || !wa[i].ok || x.name !== wa[i].name) bad.push(`${x.name}: js ok=${x.ok}, wasm ok=${wa[i] && wa[i].ok} ${wa[i] && wa[i].detail}`); });
    st.report(`runner self-test (${ja.length} scenarios on the JS reference and on WASM)`, ja.length, bad);
  }

  // (B) seeded random configurations on synthetic streams
  if (opts.only !== "real") {
    const rand = rng(seed * 9973), r = mk(rand), nCfg = Math.min(cases, 300), BATCH = 25;
    for (let from = 0; from < nCfg; from += BATCH) {
      const n = Math.min(BATCH, nCfg - from), before = { ...seen };
      for (let c = 0; c < n; c++) {
        const T0 = 1.7e12 + r.int(0, 23) * 3600000 + r.int(0, 3599) * 1000, h0 = new Date(T0).getUTCHours(), cfg = randConfig(rand, h0, DEFAULTS), snaps = addQuotes(rand, synthSnaps(rand, r.int(400, 1400), T0)), label = `cfg#${from + c}`;
        // a journal to begin from: the rows an earlier run of the same configuration wrote (with open positions among them), sometimes
        if (r.chance(0.4)) { const warm = RUNNER_JS.create(clone(cfg)), sn = addQuotes(rand, synthSnaps(rand, r.int(300, 900), T0 - 3600000)); for (const s of sn) warm.step(s); cfg.journal = clone(warm.rows()); }
        if (r.chance(0.3)) cfg.stages = Object.fromEntries(cfg.systems.filter(() => r.chance(0.6)).map(d => [SYSTEM_JS.id(d), r.pick(["paper", "demo", "live"])]));
        const p = pair(cfg, label); if (!p) continue; if (p.error) continue;
        const ids = p.ids(), moves = Array.from({ length: r.int(0, 3) }, () => ({ at: r.int(0, snaps.length - 1), id: r.chance(0.9) ? r.pick(ids) : "nope", to: r.pick(["paper", "demo", "live"]) })), cuts = r.chance(0.3) ? [r.int(1, snaps.length - 1)] : [];
        for (let i = 0; i < snaps.length; i++) {
          for (const m of moves) if (m.at === i) p.move(m.id, m.to);
          p.step(snaps[i], false);
          if (cuts.includes(i)) p.interrupt(snaps[i].t);
        }
        if (r.chance(0.5)) p.interrupt(snaps[snaps.length - 1].t);
        p.finish(); p.dispose();
      }
      // the driver: the gap rule, carry-over and stages, on a stream with holes
      for (let c = 0; c < Math.min(6, n); c++) {
        const T0 = 1.7e12 + r.int(0, 23) * 3600000, h0 = new Date(T0).getUTCHours(), cfg = randConfig(rand, h0, DEFAULTS); cfg.gapMs = r.pick([30000, 10000, undefined]);
        const all = addQuotes(rand, synthSnaps(rand, r.int(600, 1500), T0)), snaps = all.filter((s, i) => !(i % 250 > 100 && i % 250 < 100 + r.int(5, 60))), label = `driver#${from + c}`;
        if (r.chance(0.5)) { const warm = RUNNER_JS.create(clone(cfg)); for (const s of addQuotes(rand, synthSnaps(rand, 500, T0 - 3600000))) warm.step(s); cfg.journal = clone(warm.rows()); }
        let da, db; try { da = RUNNER_JS.driver(clone(cfg)); db = RUNNER.driver(clone(cfg)); } catch (e) { continue; }
        const ids = SYSTEM_JS.id ? cfg.systems.map(d => SYSTEM_JS.id(d)) : [], ra = [], rb = [];
        for (let i = 0; i < snaps.length; i++) {
          if (i % 180 === 90) { const m = { sys: r.pick(ids), to: r.pick(["paper", "demo", "live"]) }; da.move(m); db.move(m); }
          const xa = da.step(snaps[i]), xb = db.step(snaps[i]); tally(xa); cmp(label + " step " + i, xa, xb); ra.push(...xa); rb.push(...xb);
          if (i % 50 === 0) { cmp(label + " drain", da.drain(), db.drain()); cmp(label + " stages", da.stages(), db.stages()); const sa = da.runner() && da.runner().state(), sb = db.runner() && db.runner().state(); cmp(label + " runner state", sa, sb); }
        }
        cmp(label + " stop", da.stop(), db.stop()); cmp(label + " own", da.own(), db.own()); cmp(label + " carry", da.carry, db.carry); cmp(label + " lastT", da.lastT(), db.lastT());
      }
      const dz = Object.fromEntries(Object.entries(seen).filter(([k, v]) => typeof v === "number").map(([k, v]) => [k, v - (before[k] || 0)]));
      flush(`runner random configurations #${from}-${from + n - 1} (seed ${seed}; rows ${dz.rows}, enter ${dz.enter || 0}, trade ${dz.trade || 0}, twin ${dz.twin || 0}, skip ${dz.skip || 0}, interrupted ${dz.interrupted || 0}; plus driver runs with gaps)`, n);
    }
    console.log("coverage of the random runs: " + JSON.stringify(seen));
  }

  // (C) real recordings before 2026-11-16: the snapshots the harness cached (or makes from the session file, which is read only if its NAME is before the cut)
  const CUT = "202611160000", dir = path.join(root, "sessions"), snapDir = path.join(root, ".scratch", "trade-system", "cache-snap");
  if (fs.existsSync(dir)) {
    const H = await import("../design-harness.mjs");
    const names = fs.readdirSync(dir).filter(f => /^session_.*\.json\.gz$/.test(f)).filter(f => { const m = f.match(/_(\d{12})/); return m && m[1] < CUT; }).sort();
    const cached = names.filter(f => fs.existsSync(path.join(snapDir, f + ".json"))), files = (opts.allSessions ? names : cached).slice(0, opts.limit || Infinity);
    console.log(`real recordings: ${names.length} session files are before 2026-11-16, ${cached.length} have cached snapshots; using ${files.length}${opts.allSessions ? "" : " (--all-sessions also builds the rest)"}; the later ones are not opened`);
    const rand = rng(seed * 15485863), r = mk(rand); let nf = 0, secs = 0, jsMs = 0, wasmMs = 0; const t0 = Date.now(), bad = [];
    let journalA = [], journalB = [];      // the harness's way: one runner a session, the journal carried over
    for (const f of files) {
      nf++;
      const s = H.loadSnaps({ file: f, dir, size: fs.statSync(path.join(dir, f)).size }), snaps = s.snaps;
      if (!snaps.length) { console.log(`  ${nf}/${files.length} ${f}: no snapshots`); continue; }
      const before = { ...seen }, h0 = new Date(snaps[0].t).getUTCHours();
      // pass 1: the seven defaults, 20 twins, the harness's configuration, the journal carried over
      const cfg1 = { systems: DEFAULTS, twins: 20, equity: 10000, feeBps: 5, riskCap: 0.02, seed: 1 };
      // pass 2: a random configuration
      const cfg2 = randConfig(rand, h0, DEFAULTS);
      for (const [pi, cfg] of [cfg1, cfg2].entries()) {
        const label = f + (pi ? " random" : " defaults");
        const a = RUNNER_JS.create(Object.assign(clone(cfg), pi ? {} : { journal: clone(journalA) })), b = RUNNER.create(Object.assign(clone(cfg), pi ? {} : { journal: clone(journalB) }));
        cmp(label + " create fresh", a.fresh(), b.fresh());
        for (let i = 0; i < snaps.length; i++) {
          const x = snaps[i]; let t = process.hrtime.bigint(); const ra = a.step(x); jsMs += Number(process.hrtime.bigint() - t) / 1e6; t = process.hrtime.bigint(); const rb = b.step(x); wasmMs += Number(process.hrtime.bigint() - t) / 1e6;
          if (ra.length || rb.length) { tally(ra); cmp(label + " step " + x.t, ra, rb); }
          if (i % 120 === 0) { cmp(label + " state@" + x.t, a.state(), b.state()); cmp(label + " risk@" + x.t, a.risk(), b.risk()); }
          if (diffs.length > 20) break;
        }
        secs += snaps.length;
        const last = snaps[snaps.length - 1].t; cmp(label + " interrupt", a.interrupt(last), b.interrupt(last));
        cmp(label + " final state", a.state(), b.state()); cmp(label + " journal", a.rows(), b.rows()); cmp(label + " evaluate", RUNNER_JS.evaluate(a.rows()), RUNNER.evaluate(b.rows()));
        if (!pi) { journalA = a.rows(); journalB = b.rows(); }
        b.dispose();
      }
      s.snaps = null; s.hist = null; s.legacy = null;
      const mine = diffs.splice(0); bad.push(...mine.map(x => f + ": " + x));
      const dz = k => (seen[k] || 0) - (before[k] || 0);
      console.log(`  ${nf}/${files.length} ${f}: ${snaps.length} snapshots x 2 runs, rows ${dz("rows")}, enter ${dz("enter")}, trade ${dz("trade")}, twin ${dz("twin")}, skip ${dz("skip")}, ${mine.length ? "DIFF" : "same"}`);
      for (const d of mine.slice(0, 3)) console.log("      " + d.slice(0, 700));
    }
    st.report(`real recordings before 2026-11-16 (${files.length} sessions, ${secs} runner-seconds, every row, state, risk, journal and evaluate compared; the harness's journal carried over between sessions)`, secs, bad);
    console.log(`time over the real runs: js reference ${jsMs.toFixed(0)} ms, wasm wrapper ${wasmMs.toFixed(0)} ms (${(jsMs / Math.max(1, secs)).toFixed(3)} and ${(wasmMs / Math.max(1, secs)).toFixed(3)} ms per runner-second of the random + defaults mix; ${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
  } else console.log("skip  real recordings: sessions/ not found");
}
