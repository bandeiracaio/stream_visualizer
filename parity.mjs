// Parity check of the Rust (WASM) cores against the JS cores they replace: both run on the same inputs and the outputs must be identical
// (deep equal, numbers by Object.is, an undefined property counts as absent). One line per batch of cases and per real input; exit 1 on any difference.
//   node parity.mjs promo            all promo cases
//   node parity.mjs promo --cases N  N generated cases per kind (default 1000)
//   node parity.mjs promo --seed S   another seed (default 1)
// Inputs: (1) every call the core's own self-test makes, replayed on the JS version; (2) seeded random journals, stage logs and moves, with the boundary values of the rule
// over-represented; (3) the real journal sessions/trader-journal_check4.json (recorded 2026-11-11, before the test set of the registered episode-outcomes study; no session recording is read).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildWasm } from "./lib/wasm-build.mjs";

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

  console.log(`\n${bad ? "FAILED" : "OK"}: ${total} cases, ${bad} differences`);
  process.exit(bad ? 1 : 0);
}

if (which === "promo") await promo();
else { console.error("usage: node parity.mjs promo [--cases N] [--seed S]"); process.exit(1); }
