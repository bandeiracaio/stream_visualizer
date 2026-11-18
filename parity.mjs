// Parity check of the Rust (WASM) cores against the JS cores they replace: both run on the same inputs and the outputs must be identical
// (deep equal, numbers by Object.is, an undefined property counts as absent). One line per batch of cases and per real input; exit 1 on any difference.
//   node parity.mjs promo            all promo cases
//   node parity.mjs promo --cases N  N generated cases per kind (default 1000)
//   node parity.mjs paper | hist | sq | all   (R1: paper broker, order history, session quality; the R1 section below)
//   node parity.mjs system [--designs N] [--all-sessions]   (R2: the system core, lib/parity-system.mjs: self-test, validate / id, random systems and streams, and the saved sessions before 2026-11-16)
//   node parity.mjs promo --seed S   another seed (default 1)
// Inputs: (1) every call the core's own self-test makes, replayed on the JS version; (2) seeded random journals, stage logs and moves, with the boundary values of the rule
// over-represented; (3) the real journal sessions/trader-journal_check4.json (recorded 2026-11-11, before the test set of the registered episode-outcomes study; no session recording is read).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildWasm } from "./lib/wasm-build.mjs";
import { system as systemParity } from "./lib/parity-system.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), which = args[0];
const argNum = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : +args[i + 1]; };
const N = argNum("--cases", 1000), SEED = argNum("--seed", 1);
const text = p => fs.readFileSync(path.join(root, "src", p), "utf8");

// ----- comparison
const norm = v => v === undefined ? undefined : v;
function diff(a, b, at = "") {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b) ? null : `${at}: ${Object.is(a, -0) ? "-0" : a} vs ${Object.is(b, -0) ? "-0" : b}`;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b ? null : `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${at}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${at}[${i}]`); if (d) return d; }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (norm(a[k]) === undefined && norm(b[k]) === undefined) continue;
    if (!(k in a) || a[k] === undefined) return `${at}.${k}: missing in js`;
    if (!(k in b) || b[k] === undefined) return `${at}.${k}: missing in wasm`;
    const d = diff(a[k], b[k], `${at}.${k}`); if (d) return d;
  }
  return null;
}

// ----- seeded random
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ----- the two sides
function loadSides(wasmBytes) {
  const ctx = vm.createContext({ atob, TextEncoder, TextDecoder, __SV_SYNC: true });
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name });
  run(text("js/wasm-loader.js").replace("__SV_WASM_B64__", () => wasmBytes.toString("base64")), "wasm-loader.js");
  run(text("js/js-cores/promotion-core.js") + "\n" + text("js/promotion-core.js"), "promotion-core.js");
  return { js: run("PROMO_JS", "x"), wasm: run("PROMO", "x"), ctx };
}

// ----- promo
function promoCases(rand) {
  const DAY = 86400000, D0 = 20000 * DAY, SYS = ["A", "B", "Sc80470035a61"];
  const pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  const num = () => { const k = rand(); return k < 0.15 ? 0 : k < 0.3 ? Math.round((rand() - 0.5) * 20) : k < 0.4 ? [0.001, -0.001, 1e-9, 2, -1.5, 3][Math.floor(rand() * 6)] : (rand() - 0.45) * 30; };
  const journal = (o) => {
    const rows = [], nDays = o.days, perDay = o.perDay;
    for (const sys of o.systems) for (let d = 0; d < nDays; d++) {
      const biasDay = chance(o.posDays) ? 1 : -1;
      for (let i = 0; i < perDay + Math.floor(rand() * 3); i++) {
        const tIn = D0 + d * DAY + Math.floor(rand() * DAY), stage = pick(o.stages), net = chance(o.flat) ? 0 : biasDay * Math.abs(num()) + (o.shift || 0);
        const r = { k: "trade", sys, tIn, t: tIn + Math.floor(rand() * 600000), netBps: net, R: net / 10 + (chance(0.05) ? rand() : 0), usd: net * 1.3, reason: pick(["time", "stop", "target"]) };
        if (stage) { r.stage = stage; r.fill = chance(0.85) ? stage : pick(["paper", "demo", "live"]); }
        if (r.stage === "demo" && chance(0.9)) r.paperNetBps = net + rand() * 3 - (o.costShift || 0);
        if (chance(0.03)) { r.interrupted = true; r.reason = "interrupted"; delete r.netBps; delete r.R; delete r.usd; }
        if (chance(0.02)) r.netBps = undefined;
        rows.push(r);
      }
      if (o.twins) for (let n = 0; n < o.twins; n++) for (let i = 0; i < o.twinTrades + (chance(0.1) ? -1 : 0); i++) if (chance(0.97)) rows.push({ k: "twin", sys, n, tIn: D0 + d * DAY + Math.floor(rand() * DAY), R: (rand() - 0.5) * 2 + (n === 0 ? 0.3 : 0), usd: 0, reason: "time" });
    }
    if (chance(0.5)) rows.sort(() => rand() - 0.5);
    for (let i = 0; i < 3; i++) if (chance(0.3)) rows.push(pick([{ k: "skip", sys: pick(SYS), t: D0 }, { k: "enter", sys: pick(SYS), t: D0 }, { k: "trade", sys: pick(SYS), tIn: D0 + 5 }]));
    return rows;
  };
  const stageLog = () => {
    const log = []; let stage = "paper", t = D0 + Math.floor(rand() * 8) * DAY;
    for (const sys of SYS) { stage = "paper"; t = D0 + Math.floor(rand() * 8) * DAY; const n = Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const to = stage === "paper" ? "demo" : stage === "demo" ? pick(["live", "paper"]) : "paper";
        const e = { sys, from: stage, to, t, by: pick(["user", "auto"]), figures: { criteria: [] } };
        if (to === "demo" && chance(0.8)) e.figures.edge = pick([4, 2.5, 0.5, 1, rand() * 6, -1]);
        if (to === "live") e.cap = pick([10, 80, 250, 0, undefined]);
        if (chance(0.3)) e.reason = "r" + i;
        log.push(e); stage = to; t += Math.floor(rand() * 5 * DAY);
      } }
    if (chance(0.5)) log.sort(() => rand() - 0.5);
    return log;
  };
  const move = () => {
    const m = { sys: pick(["A", "B", "C", "Sc80470035a61"]), to: pick(["paper", "demo", "live", "demo", "live", "gold"]), t: pick([5, D0, D0 + 70 * DAY, 1.5e12]), by: pick(["user", "user", "auto"]) };
    if (chance(0.5)) m.cap = pick([0, -5, 250, 80.5]);
    if (chance(0.3)) m.reason = pick(["loss limit: $150 in one day", "manual", ""]);
    if (chance(0.3)) m.start = pick(["paper", "demo", "live", ""]);
    for (const k of ["sys", "to", "by", "t"]) if (chance(0.05)) delete m[k];
    if (chance(0.03)) m.t = "5";
    if (chance(0.02)) return pick([null, undefined, 5, "x"]);
    return m;
  };
  const good = () => journal({ systems: [pick(SYS)], days: pick([9, 10, 12]), perDay: pick([29, 30, 31]), stages: [undefined, "paper"], posDays: pick([0.55, 0.6, 0.65, 0.5]), flat: 0.1, shift: pick([0.5, 1, 2, -1]), twins: 20, twinTrades: pick([5, 12]) });
  const demoJ = () => journal({ systems: ["A"], days: pick([4, 5, 6]), perDay: pick([19, 20, 21]), stages: ["demo"], posDays: 0.7, flat: 0.05, shift: 1, costShift: pick([0, 1, 2, 3]) });
  const kinds = {
    eligibility_random: () => { const rows = journal({ systems: SYS.slice(0, 2), days: Math.floor(rand() * 14), perDay: Math.floor(rand() * 20), stages: [undefined, "paper", "demo", "live"], posDays: rand(), flat: 0.1, twins: chance(0.4) ? 20 : 0, twinTrades: pick([3, 6]) }); return ["eligibility", [rows, chance(0.7) ? stageLog() : [], pick(SYS), pick([undefined, "paper", "demo", "live"])]]; },
    eligibility_boundary: () => { const rows = good(); const sys = rows.find(r => r.sys)?.sys || "A"; return ["eligibility", [rows, chance(0.3) ? stageLog() : [], sys, undefined]]; },
    eligibility_demo: () => [ "eligibility", [demoJ(), [{ sys: "A", from: "paper", to: "demo", t: D0 - DAY, by: "user", figures: { criteria: [], edge: pick([4, 2, 0, null, 1.234567]) } }], "A", undefined]],
    apply: () => { const kind = rand(); const rows = kind < 0.4 ? good() : kind < 0.6 ? demoJ() : journal({ systems: SYS, days: 3, perDay: 5, stages: [undefined, "paper"], posDays: 0.5, flat: 0.1 }); return ["apply", [chance(0.7) ? stageLog() : (chance(0.5) ? [] : undefined), move(), chance(0.05) ? undefined : rows]]; },
    apply_chain: () => { const rows = good(), sys = rows.find(r => r.sys)?.sys || "A"; return ["apply", [[], { sys, to: "demo", t: 5, by: "user" }, rows]]; },
    lossLimit: () => { const rows = journal({ systems: ["A", "B"], days: 4, perDay: 6, stages: ["live", "paper", undefined], posDays: 0.3, flat: 0, shift: -2 }); for (const r of rows) if (r.usd != null) r.usd = (rand() - 0.7) * 120; return ["lossLimit", [rows, { id: pick(["A", "B"]), riskFrac: pick([0.005, 0.01, 0.0025]), equity0: pick([10000, 5000, 123456.789]) }, pick([null, undefined, 80, 500, 0, 150]), D0 / DAY + Math.floor(rand() * 4)]]; },
    log: () => { const log = stageLog(), id = pick(["A", "B", "C"]); const fn = pick(["stageOf", "stages", "since", "edgeOf", "capOf"]); return [fn, fn === "stages" ? [log] : fn === "stageOf" ? [log, id, pick([undefined, "demo", "paper", ""])] : fn === "since" ? [log, id, pick(["paper", "demo", "live"])] : [log, id]]; },
  };
  return kinds;
}

// the self-test of the wrapper, with every SVWASM.call recorded, replayed on the JS reference
function replaySelftest(wasmBytes) {
  const ctx = vm.createContext({ atob, TextEncoder, TextDecoder, __SV_SYNC: true });
  const run = code => vm.runInContext(code, ctx);
  run(text("js/wasm-loader.js").replace("__SV_WASM_B64__", () => wasmBytes.toString("base64")));
  run("const __rec = []; { const c = SVWASM.call; SVWASM.call = (n, o) => { const r = c(n, o); __rec.push([n, JSON.parse(JSON.stringify(o === undefined ? null : o)), r]); return r; }; }");
  run(text("js/js-cores/promotion-core.js") + "\n" + text("js/promotion-core.js"));
  const results = run("PROMO.selftest()"), rec = run("__rec");
  return { results, rec, js: run("PROMO_JS") };
}

function jsOf(js, name, o) {      // the JS reference for one raw WASM call, shaped like the raw result
  switch (name) {
    case "promo_stage_of": return js.stageOf(o.log, o.id, o.start);
    case "promo_stages": return Object.entries(js.stages(o.log));
    case "promo_since": { const t = js.since(o.log, o.id, o.to); return Number.isFinite(t) ? t : null; }
    case "promo_edge_of": return js.edgeOf(o.log, o.id);
    case "promo_cap_of": return js.capOf(o.log, o.id);
    case "promo_eligibility": return js.eligibility(o.rows, o.log, o.sys, o.start);
    case "promo_loss_limit": return js.lossLimit(o.rows, o.system, o.cap, o.day);
    case "promo_apply": { const r = js.apply(o.log, o.move, o.rows); return r.ok ? { ok: true, entry: r.entry } : { ok: false, reason: r.reason }; }
  }
  throw new Error("no JS reference for " + name);
}

async function promo() {
  const bytes = buildWasm(root, { quiet: true });
  console.log(`wasm: ${bytes.length} bytes`);
  let bad = 0, total = 0;
  const cov = { eligible: 0, eligibleCalls: 0, applyOk: 0, applyCalls: 0, applyRefused: 0, hit: 0, lossCalls: 0, twinsMet: 0, costMet: 0 };
  const report = (label, count, diffs) => { total += count; bad += diffs.length; console.log(`${diffs.length ? "DIFF" : "same"}  ${label}: ${count} cases, ${diffs.length} differences`); for (const d of diffs.slice(0, 5)) console.log("      " + d); };

  // (1) the self-test's own inputs
  { const { results, rec, js } = replaySelftest(bytes);
    const failed = results.filter(r => !r.ok), diffs = [];
    if (failed.length) diffs.push("self-test scenarios failed on the WASM: " + failed.map(f => f.name).join(", "));
    rec.forEach(([name, o, r], i) => { const d = diff(jsOf(js, name, o), r, name); if (d) diffs.push(`call ${i} ${d}`); });
    report(`self-test replay (${results.length} scenarios, every call)`, rec.length, diffs); }

  // (2) generated cases
  const { js, wasm } = loadSides(bytes);
  const kinds = promoCases(rng(SEED * 7919)), BATCH = 250;
  for (const [kind, make] of Object.entries(kinds)) {
    const per = kind === "eligibility_random" || kind === "apply" ? N * 2 : N;
    for (let from = 0; from < per; from += BATCH) {
      const n = Math.min(BATCH, per - from), diffs = [];
      for (let i = 0; i < n; i++) {
        const [fn, a] = make();
        let r1, r2, e1 = null, e2 = null;
        try { r1 = js[fn](...a); } catch (e) { e1 = e.message; }
        try { r2 = wasm[fn](...a); } catch (e) { e2 = e.message; }
        if (fn === "eligibility" && r1) { cov.eligibleCalls++; if (r1.eligible) cov.eligible++; if (r1.criteria.some(c => c.id === "twins" && c.met)) cov.twinsMet++; if (r1.criteria.some(c => c.id === "cost" && c.met)) cov.costMet++; }
        if (fn === "apply" && r1) { cov.applyCalls++; if (r1.ok) cov.applyOk++; else cov.applyRefused++; }
        if (fn === "lossLimit" && r1) { cov.lossCalls++; if (r1.hit) cov.hit++; }
        const d = e1 || e2 ? (e1 && e2 ? null : `${fn}: threw only on ${e1 ? "js" : "wasm"}: ${e1 || e2}`) : diff(r1, r2, fn);
        if (d) diffs.push(`case ${kind}#${from + i} ${d}\n        input: ${JSON.stringify(a).slice(0, 300)}`);
      }
      report(`${kind} #${from}-${from + n - 1} (seed ${SEED})`, n, diffs);
    }
  }

  console.log("coverage of the generated cases: " + JSON.stringify(cov));

  // (3) the real journal
  const file = path.join(root, "sessions", "trader-journal_check4.json");
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, "utf8")), rows = j.rows || [], systems = [...new Set(rows.map(r => r.sys).filter(Boolean))];
    const logs = [[], [{ sys: systems[0], from: "paper", to: "demo", t: rows[0].t, by: "user", figures: { criteria: [], edge: 1.5 } }], [{ sys: systems[0], from: "paper", to: "demo", t: rows[0].t, by: "user", figures: { criteria: [], edge: 1.5 } }, { sys: systems[0], from: "demo", to: "live", t: rows[0].t + 1, by: "user", cap: 100, figures: { criteria: [] } }]];
    const diffs = []; let n = 0;
    const days = [...new Set(rows.filter(r => r.t).map(r => Math.floor(r.t / 86400000)))];
    for (const log of logs) for (const sys of systems) {
      for (const start of [undefined, "demo"]) { n++; const d = diff(js.eligibility(rows, log, sys, start), wasm.eligibility(rows, log, sys, start), "eligibility"); if (d) diffs.push(`${sys}: ${d}`); }
      for (const day of days) for (const cap of [null, 50]) { n++; const s = { id: sys, riskFrac: 0.005, equity0: 10000 }, d = diff(js.lossLimit(rows, s, cap, day), wasm.lossLimit(rows, s, cap, day), "lossLimit"); if (d) diffs.push(`${sys}: ${d}`); }
      for (const to of ["demo", "live", "paper"]) for (const by of ["user", "auto"]) { n++; const m = { sys, to, t: rows[0].t, by, cap: 100 }, d = diff(js.apply(log, m, rows), wasm.apply(log, m, rows), "apply"); if (d) diffs.push(`${sys}: ${d}`); }
    }
    report(`real journal sessions/trader-journal_check4.json (${rows.length} rows, ${systems.length} systems)`, n, diffs);
  } else console.log("skip  real journal: sessions/trader-journal_check4.json not found");

  console.log(`\n${bad ? "FAILED" : "OK"} promo: ${total} cases, ${bad} differences`);
  return bad;
}


// =====================================================================================================================================================================
// R1: paper, hist, sq. The JS reference (PAPER_JS / HIST_JS / SQ_JS in src/js/js-cores) and the WebAssembly wrapper (PAPER / HIST / SQ) run side by side in one context.
// Comparison is strict: numbers by Object.is, object keys in the same ORDER (it shows in JSON.stringify and CSV), an undefined property is a property. A call that throws must throw the same error class and message
// (except where a wrapper doc says a message differs: those generators compare the class only).
const ENGINE_FILES = ["reader-episodes", "reader-engine", "system-core", "systems-default", "runner-core", "chunk-core", "exec-core", "trader-core", "status-core", "collectors-core", "disk-core"];
const CORES = ["promotion-core", "history-core", "paper-broker-core", "session-quality"];
function loadAll(wasmBytes, withReader) {
  const ctx = vm.createContext({ atob, TextEncoder, TextDecoder, __SV_SYNC: true, console, structuredClone });
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name });
  run(text("js/wasm-loader.js").replace("__SV_WASM_B64__", () => wasmBytes.toString("base64")), "wasm-loader.js");
  if (withReader) for (const f of ENGINE_FILES) run(text("js/" + f + ".js"), f + ".js");
  for (const f of CORES) run(text("js/js-cores/" + f + ".js"), "js-cores/" + f + ".js");
  for (const f of CORES) run(text("js/" + f + ".js"), f + ".js");
  if (withReader) for (const f of ["broker", "market-core", "micro-core", "hooks", "views", "reader-selftest"]) run(text("js/" + f + ".js"), f + ".js");
  return { ctx, run, js: { PAPER: run("PAPER_JS"), HIST: run("HIST_JS"), SQ: run("SQ_JS") }, wasm: { PAPER: run("PAPER"), HIST: run("HIST"), SQ: run("SQ") } };
}

// strict deep comparison: keys in the same order, an undefined property counts
function sdiff(a, b, at = "") {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b) ? null : `${at}: ${Object.is(a, -0) ? "-0" : a} vs ${Object.is(b, -0) ? "-0" : b}`;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b ? null : `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${at}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = sdiff(a[i], b[i], `${at}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("\u0001") !== kb.join("\u0001")) return `${at}: keys [${ka}] vs [${kb}]`;
  for (const k of ka) { const d = sdiff(a[k], b[k], `${at}.${k}`); if (d) return d; }
  return null;
}
function tryCall(f) { try { return { v: f() }; } catch (e) { return { e: (e && e.name) || "?", m: String(e && e.message) }; } }
function cmpRun(a, b, classOnly) {
  if (a.e || b.e) { if (a.e && b.e) return a.e === b.e && (classOnly || a.m === b.m) ? null : `error ${a.e}: ${a.m} vs ${b.e}: ${b.m}`; return `threw only on ${a.e ? "js" : "wasm"}: ${a.e ? a.e + " " + a.m : b.e + " " + b.m}`; }
  return sdiff(a.v, b.v, "result");
}
const clone = x => structuredClone(x);
const show = x => { try { return JSON.stringify(x).slice(0, 400); } catch { return String(x).slice(0, 400); } };

function reporter() {
  const st = { bad: 0, total: 0 };
  st.report = (label, count, diffs) => { st.total += count; st.bad += diffs.length; console.log(`${diffs.length ? "DIFF" : "same"}  ${label}: ${count} cases, ${diffs.length} differences`); for (const d of diffs.slice(0, 5)) console.log("      " + d); };
  return st;
}

// the public calls other code makes on a wrapper (the Reader self-test) are recorded with their arguments as they were before the call
function instrument(ctx, name, fnNames) {
  vm.runInContext(`globalThis.__calls = []; globalThis.__rec = true; (() => { const o = ${name}; for (const n of ${JSON.stringify(fnNames)}) { const f = o[n]; if (typeof f !== "function") continue; o[n] = function (...a) { if (!__rec) return f.apply(this, a); const before = structuredClone(a); const r = f.apply(this, a); __calls.push(["${name}", n, before, r]); return r; }; } })()`, ctx);
}

// ================= paper
function paperSequence(rand, N) {
  const pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  const QTY = [0.01, 0.05, 0.12, 0.07, 1, 2, 3, 5, 0.1 + 0.2, 1 / 3, 1 / 2048, 3 / 2048, 1e-11, 0.5, 10, 0];
  const quotes = () => { const b = pick([100, 99.5, 50, 0, null, undefined, 1e-3, 100.25]); return { bid: b, ask: chance(0.1) ? pick([0, null, undefined]) : (typeof b === "number" ? b + pick([1, 0.5, 0.01, 0]) : 101), mark: chance(0.3) ? pick([0, undefined, null, 100.5, 120]) : (100 + rand() * 4) }; };
  const ops = [];
  for (let i = 0; i < N; i++) {
    const sym = pick(["BTCUSDT", "BTCUSDT", "ETHUSDT"]), q = quotes(), now = 1000 + i * 37;
    const ctx = chance(0.03) ? { sym, now } : { sym, now, q: { bid: q.bid, ask: q.ask, mark: q.mark } }, k = rand();
    if (k < 0.4) ops.push(["place", ctx, { type: "MARKET", side: pick(["BUY", "SELL", "BUY", "SELL", "HOLD"]), qty: pick(QTY), reduce: pick([undefined, true, false, 1, "x", undefined]) }]);
    else if (k < 0.6) ops.push(["place", ctx, { type: pick(["LIMIT", "LIMIT", "STOP"]), side: pick(["BUY", "SELL"]), qty: pick(QTY), price: pick([99, 100, 101, 102, 98.5, 100.5, 50, 100 + Math.round(rand() * 400) / 100]), reduce: pick([undefined, true, false]) }]);
    else if (k < 0.8) ops.push(["onTrade", ctx, { px: pick([98, 99, 100, 101, 102, 111, 50, 99.5, 100 + rand() * 3]) }]);
    else if (k < 0.92) ops.push(["snapshot", ctx]);
    else if (k < 0.96) ops.push(["fill", ctx, pick(["BUY", "SELL"]), pick(QTY), 100 + rand(), chance(0.5), 5 + i]);
    else ops.push(["capReduce", ctx, { side: pick(["BUY", "SELL"]), qty: pick(QTY) }]);
  }
  return ops;
}
function paperRun(P, S, op) {
  const [fn, ctx, ...rest] = op;
  return tryCall(() => {
    const c = clone(ctx);
    if (fn === "place") return P.place(S, c, clone(rest[0]));
    if (fn === "onTrade") return P.onTrade(S, c, rest[0]);
    if (fn === "snapshot") return P.snapshot(S, c);
    if (fn === "fill") return P.fill(S, c, ...rest);
    return P.capReduce(S, c, clone(rest[0]));
  });
}
async function paper(wasmBytes, st, cases, seed) {
  const { js, wasm } = loadAll(wasmBytes, false), rand = rng(seed * 104729);
  const cov = { placeFilled: 0, resting: 0, thrown: 0, snapshots: 0, positionsMax: 0, restingFilledByTrade: 0 };
  { const a = js.PAPER.selftest(), b = wasm.PAPER.selftest(), diffs = [];
    if (a.length !== b.length) diffs.push("different number of scenarios");
    a.forEach((r, i) => { if (!r.ok || !b[i].ok || r.name !== b[i].name) diffs.push(`${r.name}: js ok=${r.ok}, wasm ok=${b[i].ok} ${b[i].detail}`); });
    st.report(`paper self-test (${a.length} scenarios, JS and WASM)`, a.length, diffs); }
  const BATCH = 50;
  for (let from = 0; from < cases; from += BATCH) {
    const diffs = []; let n = 0;
    for (let s = from; s < Math.min(cases, from + BATCH); s++) {
      const start = rand() < 0.2 ? 1000 : 10000, Sj = js.PAPER.reset(start), Sw = wasm.PAPER.reset(start);
      if (rand() < 0.3) { for (const S of [Sj, Sw]) { S.positions.XRPUSDT = { symbol: "XRPUSDT", qty: -3, entry: 0.5, mark: 0.4 }; S.positions.BTCUSDT = { symbol: "BTCUSDT", qty: 0.5, entry: 99, mark: null }; } }
      const ops = paperSequence(rng(Math.floor(rand() * 1e9)), 30 + Math.floor(rand() * 20));
      let i = 0;
      for (const op of ops) {
        i++; n++;
        const before = Sj.orders.length, ra = paperRun(js.PAPER, Sj, op), rb = paperRun(wasm.PAPER, Sw, op);
        if (ra.e) cov.thrown++; else if (op[0] === "place") (ra.v.kind === "filled" ? cov.placeFilled++ : cov.resting++); else if (op[0] === "snapshot") cov.snapshots++; else if (op[0] === "onTrade" && Sj.orders.length < before) cov.restingFilledByTrade++;
        cov.positionsMax = Math.max(cov.positionsMax, Object.keys(Sj.positions).length);
        const d = cmpRun(ra, rb, false) || sdiff(Sj, Sw, "SIM");
        if (d) { diffs.push(`sequence ${s} step ${i} ${op[0]} ${show(op.slice(1))}: ${d}`); break; }
      }
    }
    st.report(`paper random sequences #${from}-${Math.min(cases, from + BATCH) - 1} (seed ${seed}), every call and the whole state`, n, diffs);
  }
  { const Sj = js.PAPER.reset(10000), Sw = wasm.PAPER.reset(10000), diffs = []; let n = 0;
    const ctx = { sym: "BTCUSDT", now: 5, q: { bid: 100, ask: 101, mark: 100.5 } };
    for (let i = 0; i < 3600 && !diffs.length; i++) {
      const o = { type: "MARKET", side: i % 2 ? "SELL" : "BUY", qty: 0.01 + (i % 7) / 100 }, a = paperRun(js.PAPER, Sj, ["place", { ...ctx, now: i }, o]), b = paperRun(wasm.PAPER, Sw, ["place", { ...ctx, now: i }, o]); n++;
      const d = cmpRun(a, b) || (i % 300 === 299 ? sdiff(Sj, Sw, "SIM") : null); if (d) diffs.push(`step ${i}: ${d}`);
    }
    if (!diffs.length) { const d = sdiff(Sj, Sw, "SIM"); if (d) diffs.push(d); }
    if (!diffs.length && (Sw.log.income.length !== 5000 || Sw.fills.length !== 50)) diffs.push(`caps: income ${Sw.log.income.length}, fills ${Sw.fills.length}`);
    st.report("paper long run (3600 orders: log cap 5000, fills 50)", n, diffs); }
  console.log("coverage of the paper cases: " + JSON.stringify(cov));
}

// ================= hist
function histCases(rand) {
  const pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  const numLike = () => pick(["1", "0", "-0", "0.5", ".5", "5.", " 12 ", "1e3", "1E-7", "-1.5e+2", "0x10", "abc", "", "Infinity", "-Infinity", "NaN", "12abc", "1,5", "+3", "--1", "1e", "1e+", "0.1", "123456789012345678", "1.0000000000000002", "\t7\n", "8.64e15", "00012", "1_000"]);
  const any = () => { const k = rand(); return k < 0.35 ? numLike() : k < 0.55 ? pick([0, 1, -1, 0.5, 1e21, 1e-7, 123456789, 1700000000000, -0, 2 ** 53, 0.1 + 0.2, 1.5e300]) : k < 0.65 ? pick([null, undefined, true, false]) : k < 0.72 ? pick([[], [5], ["7", 1], [null, 2], [[3]], {}, { a: 1 }]) : numLike(); };
  const maybe = (v, p = 0.1) => chance(p) ? undefined : v;
  const sym = () => pick(["BTCUSDT", "ETHUSDT", "", null, undefined, 5, "XRP\u{1F600}USDT", "btc"]);
  const t = () => chance(0.8) ? pick([1700000000000, 1700000000123, 0, "1700000000000", 1.5e12, 1.7e12 + 0.7, -5, 8.64e15, 8.64e15 + 1, "x", null, undefined]) : any();
  const order = () => { const o = { orderId: any(), time: t(), updateTime: t(), symbol: sym(), side: pick(["BUY", "SELL", "", null]), type: pick(["LIMIT", "MARKET", "STOP", undefined]), price: any(), origQty: any(), executedQty: any(), avgPrice: any(), status: pick(["NEW", "FILLED", "CANCELED", undefined, 5, null]), reduceOnly: pick([true, false, undefined, 1, 0, "x", "", null, [], {}]), timeInForce: pick(["GTC", "IOC", undefined, null]) }; for (const k of Object.keys(o)) if (chance(0.06)) delete o[k]; return o; };
  const fill = () => { const o = { id: any(), orderId: any(), time: t(), symbol: sym(), side: pick(["BUY", "SELL", undefined]), price: any(), qty: any(), commission: any(), commissionAsset: pick(["USDT", "BNB", undefined, null, 5]), realizedPnl: any(), maker: pick([true, false, undefined, 1, "", "false", null]) }; for (const k of Object.keys(o)) if (chance(0.06)) delete o[k]; return o; };
  const income = () => { const o = { tranId: pick([9, 123456789012, "77", undefined, null, 1e21, 0.5]), time: t(), symbol: sym(), incomeType: pick(["FUNDING_FEE", "COMMISSION", "REALIZED_PNL", "", undefined, null, 5]), income: any(), asset: pick(["USDT", "BNB", "", undefined, null, 5]), info: pick(["", "x", undefined, null, 7]) }; for (const k of Object.keys(o)) if (chance(0.06)) delete o[k]; return o; };
  const account = () => {
    const raw = {};
    if (chance(0.9)) raw.account = chance(0.9) ? { canTrade: pick([true, false, undefined, 1, 0, null, "x"]), feeTier: pick([0, 2, "3", undefined, null, "x", "Infinity", [], 1.5]), multiAssetsMargin: pick([true, false, undefined, null, 0, "false"]), assets: chance(0.9) ? Array.from({ length: Math.floor(rand() * 4) }, () => ({ asset: pick(["USDT", "BNB", undefined, 5]), walletBalance: any(), availableBalance: any(), unrealizedProfit: any(), marginBalance: any() })) : pick(["nope", 5, null, {}]) } : pick([5, "x", 0, null, "", []]);
    if (chance(0.85)) raw.positions = chance(0.9) ? Array.from({ length: Math.floor(rand() * 4) }, () => ({ symbol: sym(), positionAmt: chance(0.2) ? "0.000" : any(), entryPrice: any(), markPrice: any(), unRealizedProfit: any(), leverage: any(), marginType: pick(["cross", "isolated", undefined]), liquidationPrice: pick(["0", "0.0", "12345.5", any(), undefined]), positionSide: pick(["BOTH", "LONG", undefined, null]) })) : pick(["nope", 5, {}]);
    if (chance(0.7)) raw.dual = pick([{ dualSidePosition: true }, { dualSidePosition: false }, {}, null, 0, [], "x", { dualSidePosition: "false" }]);
    if (chance(0.7)) raw.rate = pick([{ makerCommissionRate: "0.0002", takerCommissionRate: "0.0005" }, { makerCommissionRate: any(), takerCommissionRate: any() }, {}, null, { takerCommissionRate: "1" }, 5]);
    return chance(0.03) ? pick([null, undefined, 0, "", 5, "str", []]) : raw;
  };
  const simSnap = () => chance(0.05) ? pick([null, undefined, 0, {}, { balance: null }, { positions: "x" }, { positions: 5 }, { balance: 5, positions: [] }]) : { balance: { wallet: any(), available: any(), upnl: any() }, positions: Array.from({ length: Math.floor(rand() * 3) }, () => ({ symbol: sym(), qty: any(), entry: any(), mark: any(), upnl: any(), liq: null, lev: pick(["10 (sim)", 10, "x", undefined]) })) };
  let H = null;      // the JS reference's converters, so rows given to totals / merge / csvRows are real rows
  const incomeRows = () => Array.from({ length: Math.floor(rand() * 12) }, () => chance(0.8) ? H.income(income()) : { t: pick([100, 200, 300, 500, "250", undefined]), type: pick(["A", "B", "123", undefined, null]), amount: pick([1.5, -2, 0.1, 0.2, 1e-9, 3]), asset: pick(["USDT", "BNB", "", undefined, "Î©", "\u{1F600}"]) });
  const kinds = {
    order: () => ["order", [order()]],
    fill: () => ["fill", [fill()]],
    income: () => ["income", [income()]],
    account: () => ["account", [account()]],
    simAccount: () => ["simAccount", [simSnap(), pick([{ maker: 0.0002, taker: 0.0005 }, { maker: "x" }, null, undefined, 0, {}, { maker: any(), taker: any() }])]],
    totals: () => ["totals", [chance(0.05) ? pick([null, undefined, []]) : incomeRows(), maybe(pick([100, 200, 250, 300, null, "150", -Infinity, NaN, undefined, 1e9]), 0.3), maybe(pick([100, 200, 500, null, Infinity, 250, "400"]), 0.3)]],
    fillTotals: () => ["fillTotals", [chance(0.05) ? pick([null, undefined, []]) : Array.from({ length: Math.floor(rand() * 6) }, () => chance(0.8) ? H.fill(fill()) : { qty: pick([2, "3", 0.1]), price: pick([100, 50.5, "2"]), fee: pick([0.1, 0.2, 0.3, 1e-9]), pnl: pick([3, -1, 0.7, -0.0]) })]],
    statusCounts: () => ["statusCounts", [chance(0.05) ? pick([null, undefined]) : Array.from({ length: Math.floor(rand() * 10) }, () => ({ status: pick(["FILLED", "NEW", "CANCELED", "7", "10", "2", undefined, null, 5]) }))]],
    csvRows: () => ["csvRows", [chance(0.05) ? pick([null, undefined, []]) : Array.from({ length: Math.floor(rand() * 5) }, () => chance(0.9) ? H.order(order()) : { t: pick([1700000000000, 0, -1, 8.64e15, NaN, "2024-01-01T00:00:00Z", 1e300, 1.5, -62167219200000, 253402300800000, -62198755200000]), a: 1 })]],
    symbols: () => ["symbols", [chance(0.05) ? pick([null, undefined, []]) : Array.from({ length: Math.floor(rand() * 10) }, () => ({ symbol: sym() }))]],
    period: () => ["period", [pick([1, 7, 6.9, 7.5, 30, 0, 0.1, -1, NaN, Infinity, "7", "x", undefined, null, 365]), pick([1700000000000, 0, "1700000000000", NaN, Infinity, undefined, 1.7e12 + 0.5])]],
    pieces: () => { const to = pick([1.7e12, 1700000000123.5, 5e11]); return ["pieces", [maybe(to - pick([0, 1000, 86400000, 7 * 86400000, 7 * 86400000 - 1000, 7 * 86400000 - 999, 30 * 86400000, 90 * 86400000 + 12345, -5000]), 0.05), maybe(to, 0.03)]]; },
    merge: () => { const key = pick(["id", "id", "id", "orderId", "tid"]), n = Math.floor(rand() * 14); const rows = Array.from({ length: n }, () => ({ id: pick([1, 2, 3, "1", "a", "a", null, undefined, 0, -0, true, 2.5]), orderId: pick([1, 2, 3, undefined]), t: pick([10, 20, 30, 20, 10, 5, 1e12, -3, "40", null, 0.5, -0]) })); return ["merge", chance(0.05) ? [pick([null, undefined])] : [rows, key === "id" && chance(0.5) ? undefined : key]]; },
    toCsv: () => { const cols = [["a", "A"], ["b", pick(["B", "b,c", 'q"r', "=x", 7])], ["c", "C"], ["d", "D"]].slice(0, 1 + Math.floor(rand() * 4)); const cell = () => pick(["x,y", 'say "hi"', -1.5, "=1+1", "@SUM", "+3", "-ok", "two\nlines", "a\rb", "\tTab", null, undefined, 0, 1e21, 1e-7, NaN, Infinity, -Infinity, true, false, [1, [2, null]], { z: 1 }, "", " ", 0.1 + 0.2, 123456789, "Ã©", "\u{1F600}", -0, "=", "'q"]); return ["toCsv", [chance(0.05) ? pick([null, undefined, []]) : Array.from({ length: Math.floor(rand() * 5) }, () => ({ a: cell(), b: cell(), c: cell(), d: cell() })), cols]]; },
  };
  return { kinds, setConverters: h => { H = h; } };
}
async function hist(wasmBytes, st, cases, seed) {
  const { ctx, run, js, wasm } = loadAll(wasmBytes, true);
  { instrument(ctx, "HIST", ["order", "fill", "income", "account", "simAccount", "totals", "fillTotals", "statusCounts", "csvRows", "symbols", "period", "pieces", "merge", "toCsv"]);
    const results = await run("READER_SELFTEST.run(READER_ENGINE)"), calls = (run("__rec = false"), run("__calls")).filter(c => c[0] === "HIST"), diffs = [];
    const failed = results.filter(r => !r.ok); if (failed.length) diffs.push("Reader scenarios failed on the WASM: " + failed.map(f => f.name).join(", "));
    for (const [, fn, args, got] of calls) { const want = tryCall(() => js.HIST[fn](...clone(args))); const d = cmpRun(want, { v: got }); if (d) diffs.push(`${fn} ${show(args)}: ${d}`); }
    st.report(`hist: the Reader self-test's own HIST calls (${results.length} scenarios run)`, calls.length, diffs); }
  const g = histCases(rng(seed * 15485863)); g.setConverters(js.HIST);
  const BATCH = 500, cov = { threw: 0, returned: 0 };
  for (const [kind, make] of Object.entries(g.kinds)) {
    const per = ["order", "fill", "income", "account", "toCsv"].includes(kind) ? cases * 2 : cases;
    for (let from = 0; from < per; from += BATCH) {
      const n = Math.min(BATCH, per - from), diffs = [];
      for (let i = 0; i < n; i++) {
        const [fn, a] = make(), A = clone(a);
        const ra = tryCall(() => js.HIST[fn](...clone(a))), rb = tryCall(() => wasm.HIST[fn](...clone(a)));
        if (ra.e) cov.threw++; else cov.returned++;
        const d = cmpRun(ra, rb, kind === "account" || kind === "simAccount" || kind === "fillTotals" || kind === "statusCounts" || kind === "totals" || kind === "csvRows");
        if (d) diffs.push(`case ${kind}#${from + i} ${d}\n        input: ${show(A)}`);
      }
      st.report(`hist ${kind} #${from}-${from + n - 1} (seed ${seed})`, n, diffs);
    }
  }
  console.log(`coverage of the hist cases: ${cov.returned} returned, ${cov.threw} threw (same on both sides)`);
}

// ================= sq
function sqInputs(rand) {
  const pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  const n = pick([0, 1, 2, 5, 40, 200, 1000]), t0 = pick([1.7e12, 1700000000123, 0, 5, 1.7e12 + 0.5]), span = pick([30000, 60000, 59999, 60001, 150000, 300000, 3600000, 1000, 0]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = chance(0.03) ? pick([NaN, undefined, Infinity, "x", String(t0 + 500)]) : t0 + Math.floor(rand() * (span + 1)), k = rand();
    out.push(k < 0.4 ? ["q", "bn", t, 1, 2] : k < 0.55 ? ["t", { t, px: 1 }] : k < 0.85 ? ["a", t] : k < 0.9 ? ["s", "bn", t] : k < 0.93 ? ["b", "hl", t] : k < 0.95 ? ["t", {}] : k < 0.97 ? ["a"] : ["zz", 1, t]);
  }
  return out;
}
function sqDenseInputs(rand) {      // a clock of about 4 ticks a second and quotes, with a silent minute, like a real recording
  const pick = a => a[Math.floor(rand() * a.length)], T0 = pick([1.7e12, 1700000000123]), minutes = pick([1, 2, 3, 5, 8]) + (rand() < 0.5 ? rand() : 0), gapMin = pick([-1, 1, 2]), perMin = pick([10, 19, 20, 21, 60, 300]);
  const out = [];
  for (let s = 0; s < minutes * 60; s++) {
    const m = Math.floor(s / 60); if (m === gapMin) continue;
    const kt = pick([4, 4, 3, 2]); for (let k = 0; k < kt; k++) out.push(["a", T0 + s * 1000 + k * 250]);
    for (let k = 0; k < Math.floor(perMin / 60) + (rand() < (perMin % 60) / 60 ? 1 : 0); k++) out.push(["q", "bn", T0 + s * 1000 + Math.floor(rand() * 1000), 1, 2]);
  }
  return out;
}
function sqQuality(rand) {
  const pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  const any = () => pick([0, 1, 5, 10, 79, 80, 81, 100, "50", "x", null, undefined, -1, 2.5, 120, 125, 1e21, [], [5]]);
  const q = { verdict: pick(["complete", "complete", "holes", "hollow", "empty", undefined, null, "weird"]), dataMinutes: any(), minutes: any(), longestGapSec: any(), clock: any() };
  for (const k of Object.keys(q)) if (chance(0.1)) delete q[k];
  if (chance(0.7)) { q.collectors = {}; for (let i = 0; i < Math.floor(rand() * 4); i++) { const e = { n: any(), min: any(), of: any(), gapSec: any(), state: pick(["ok", "ok", "holes", "none", undefined, "x", null]) }; if (chance(0.1)) e.id = pick(["other", 5, null]); q.collectors[pick(["book", "options", "venues", "derivs", "wallets", "7", "1"])] = e; } }
  return chance(0.05) ? pick([null, undefined, 0, "", {}, { verdict: "complete", collectors: null }]) : q;
}
function sqCoverage(rand) {
  const H = 3600000, pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p, base = pick([0, 88 * H, 1.7e12]);
  const rows = Array.from({ length: Math.floor(rand() * 8) }, () => { const a = base + Math.floor(rand() * 20 * H), len = Math.floor(rand() * 3 * H), k = rand();
    return { at: chance(0.1) ? pick([undefined, "x", null]) : a + len, quality: k < 0.45 ? { t0: a, t1: a + len } : k < 0.6 ? { spanMin: Math.floor(len / 60000) } : k < 0.7 ? null : k < 0.78 ? { t0: 0, t1: pick([5, undefined]) } : k < 0.85 ? { t0: "0", t1: a + len } : k < 0.9 ? { spanMin: 0 } : k < 0.95 ? { t0: a, t1: a } : 0 }; });
  return [rows, base + pick([0, 1.5 * H, 20 * H, 30 * H + 5]), pick([1, 2, 3, 7, 1.5, 0, undefined]), pick([0, 2 * H, -3 * H, 5.5 * H, undefined])];
}
function sqCollectors(rand) {
  const pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p, T0 = pick([1.7e12, 1700000000123, 5]), IDS = ["book", "options", "venues", "derivs", "wallets"];
  const reg = Array.from({ length: Math.floor(rand() * 5) }, (_, i) => ({ id: IDS[i], records: pick([["a" + i], ["a" + i, "b" + i], ["shared"], []]), expectMs: pick([1000, 5000, 60000, 90000, 30000, 10000, 0, undefined, "5000"]) }));
  const names = reg.flatMap(r => r.records).concat(["unknown", 5]);
  const to = T0 + pick([0, 60000, 119999, 120000, 300000, 600000, 1e6]), ext = [];
  for (let i = 0; i < Math.floor(rand() * 200); i++) { const tt = chance(0.05) ? pick([NaN, undefined, "x", T0 - 5, to + 5, null]) : T0 + Math.floor(rand() * (to - T0 + 1)); ext.push(chance(0.05) ? pick([null, "x", ["z", "a", tt], 5]) : ["c", pick(names), tt, { p: 1 }]); }
  return [chance(0.05) ? pick([null, undefined]) : ext, pick([T0, undefined, T0 + 1]), pick([to, undefined, NaN]), chance(0.05) ? pick([null, undefined, {}, "x"]) : reg];
}
async function sq(wasmBytes, st, cases, seed) {
  const { ctx, run, js, wasm } = loadAll(wasmBytes, true), rand = rng(seed * 32452843);
  { const a = js.SQ.selftest(), b = wasm.SQ.selftest(), diffs = [];
    a.forEach((r, i) => { if (!r.ok || !b[i].ok) diffs.push(`${r.name}: js ok=${r.ok}, wasm ok=${b[i].ok}`); });
    st.report("sq self-test (coverage scenarios, JS and WASM)", a.length, diffs); }
  { instrument(ctx, "SQ", ["of", "line", "collectors", "colProblems", "clean", "coverage"]);
    const results = await run("READER_SELFTEST.run(READER_ENGINE)"), calls = (run("__rec = false"), run("__calls")).filter(c => c[0] === "SQ"), diffs = [];
    const failed = results.filter(r => !r.ok); if (failed.length) diffs.push("Reader scenarios failed on the WASM: " + failed.map(f => f.name).join(", "));
    for (const [, fn, args, got] of calls) { const want = tryCall(() => js.SQ[fn](...clone(args))); const d = cmpRun(want, { v: got }); if (d) diffs.push(`${fn}: ${d}`); }
    st.report("sq: the Reader self-test's own SQ calls", calls.length, diffs); }
  const BATCH = 250, cov = { verdicts: {}, collectorStates: {}, nulls: 0 };
  const kinds = {
    of_random: () => ["of", [sqInputs(rand)]],
    of_dense: () => ["of", [sqDenseInputs(rand)]],
    line: () => ["line", [sqQuality(rand)]],
    clean: () => ["clean", [sqQuality(rand)]],
    colProblems: () => ["colProblems", [sqQuality(rand)]],
    coverage: () => ["coverage", sqCoverage(rand)],
    collectors: () => ["collectors", sqCollectors(rand)],
  };
  for (const [kind, make] of Object.entries(kinds)) {
    for (let from = 0; from < cases; from += BATCH) {
      const n = Math.min(BATCH, cases - from), diffs = [];
      for (let i = 0; i < n; i++) {
        const [fn, a] = make(), A = clone(a);
        const ra = tryCall(() => js.SQ[fn](...clone(a))), rb = tryCall(() => wasm.SQ[fn](...clone(a)));
        if (ra.v && ra.v.verdict) cov.verdicts[ra.v.verdict] = (cov.verdicts[ra.v.verdict] || 0) + 1;
        if (fn === "collectors") { if (ra.v === null) cov.nulls++; else if (ra.v) for (const c of Object.values(ra.v)) cov.collectorStates[c.state] = (cov.collectorStates[c.state] || 0) + 1; }
        const d = cmpRun(ra, rb, false);
        if (d) diffs.push(`case ${kind}#${from + i} ${d}\n        input: ${show(A)}`);
      }
      st.report(`sq ${kind} #${from}-${from + n - 1} (seed ${seed})`, n, diffs);
    }
  }
  console.log("coverage of the sq cases: " + JSON.stringify(cov));
  // real recordings: only files recorded BEFORE 2026-11-16T00:00Z (the registered study's test set starts there). The date comes from the file NAME (session_BTC_YYYYMMDDHHMM...); a file with a later stamp, or with no readable stamp, is never opened.
  const dir = path.join(root, "sessions"), CUT = "202611160000";
  if (fs.existsSync(dir)) {
    const zlib = await import("node:zlib");
    const all = fs.readdirSync(dir).filter(f => /^session_.*\.json\.gz$/.test(f)), files = all.filter(f => { const m = f.match(/_(\d{12})/); return m && m[1] < CUT; }).sort();
    console.log(`real recordings: ${files.length} of ${all.length} session files are before 2026-11-16 (the rest are not opened)`);
    let nf = 0, calls = 0, wasmMs = 0, jsMs = 0; const diffs = [], t0 = Date.now();
    for (const f of files) {
      nf++;
      const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8")), inputs = j.inputs || [], ext = j.ext || [];
      const names = [...new Set(ext.filter(r => Array.isArray(r) && r[0] === "c").map(r => r[1]))], reg = names.map((n, i) => ({ id: "c" + i, records: [n], expectMs: [5000, 60000, 1000, 30000][i % 4] }));
      const one = (label, fn, args) => {
        calls++;
        const a = tryCall(() => { const s = Date.now(); const r = js.SQ[fn](...args); jsMs += Date.now() - s; return r; }), b = tryCall(() => { const s = Date.now(); const r = wasm.SQ[fn](...args); wasmMs += Date.now() - s; return r; }), d = cmpRun(a, b);
        if (d) diffs.push(`${f} ${label}: ${d}`); return a.v;
      };
      const q = one("of", "of", [inputs]), c = one("collectors", "collectors", [ext, j.startedAt || 0, q && q.t1, reg]);
      if (q && c) q.collectors = c;
      if (q) { one("line", "line", [q]); one("clean", "clean", [q]); one("colProblems", "colProblems", [q]); }
      if (j.quality) { one("line(stored)", "line", [j.quality]); one("clean(stored)", "clean", [j.quality]); }
      const end = q && q.t1 || 0;
      one("coverage", "coverage", [[{ at: end, quality: q }, { at: end + 3600000, quality: { spanMin: 30 } }], end + 7200000, 3, 0]);
      console.log(`  ${nf}/${files.length} ${f}: ${inputs.length} inputs, ${diffs.length ? "DIFF" : "same"} (js ${jsMs} ms, wasm ${wasmMs} ms so far)`);
    }
    st.report(`real recordings before 2026-11-16 (${files.length} files: of / collectors / line / clean / colProblems / coverage, and the saved file's own quality for line / clean)`, calls, diffs);
    console.log(`time: js ${jsMs} ms, wasm ${wasmMs} ms over ${files.length} files (${((Date.now() - t0) / 1000).toFixed(0)} s wall, including reading)`);
  } else console.log("skip  real recordings: sessions/ not found");
}

const known = ["promo", "paper", "hist", "sq", "system", "all"];
if (!known.includes(which)) { console.error("usage: node parity.mjs promo|paper|hist|sq|system|all [--cases N] [--seed S] [--designs N] [--all-sessions] [--only-real] [--sessions N]"); process.exit(1); }
let failed = 0;
if (which === "promo" || which === "all") failed += await promo();
if (which !== "promo") {
  const bytes = buildWasm(root, { quiet: true }), st = reporter();
  console.log(`wasm: ${bytes.length} bytes`);
  if (which === "paper" || which === "all") await paper(bytes, st, N, SEED);
  if (which === "hist" || which === "all") await hist(bytes, st, N, SEED);
  if (which === "sq" || which === "all") await sq(bytes, st, Math.min(N, 400), SEED);
  if (which === "system" || which === "all") await systemParity(root, bytes, st, N, SEED, { allSessions: args.includes("--all-sessions"), designs: argNum("--designs", 24), only: args.includes("--only-real") ? "real" : null, limit: argNum("--sessions", 0) });
  console.log(`\n${st.bad ? "FAILED" : "OK"} ${which}: ${st.total} cases, ${st.bad} differences`);
  failed += st.bad;
}
process.exit(failed ? 1 : 0);
