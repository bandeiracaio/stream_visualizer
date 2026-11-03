// Offline robustness test for the Reader's thresholds (the "randomized Monte Carlo" idea: do not reshuffle the results, perturb the SETTINGS that produced them).
// The Reader's detections come from thresholds (READER_EPISODES.DEFAULTS, also what a proposal or an approved override changes). If a threshold was tuned until the numbers looked good, those numbers may
// hold only at that exact value. This script keeps the data fixed (saved sessions), draws many perturbed configurations around a base configuration, replays every session under each, and shows how
// the scoreboard numbers spread. Descriptive and small-sample like the scoreboard; it never says keep or drop, and it never changes a detection.
//   - Each RUN draws one configuration: every listed threshold is multiplied by a random factor in [1 - spread, 1 + spread] (uniform, seeded, so a run is repeatable); fractions are kept in [0, 1],
//     counts are rounded. The same configuration is used for all sessions of a run (a configuration is what would actually be shipped). No threshold is added or removed, none changes meaning.
//   - Per family and run: group count, median forward move at the horizon (sigmas, in the side's direction, as in reader-scoreboard.mjs) and, with --labels, precision (agree / (agree + disagree)).
//   - Output: the base (unperturbed) value, then the 5th / 50th / 95th percentile over runs, and the share of runs that "hold": forward move keeps the base's sign, precision stays at or above 50%
//     (only counted when the run has at least minN labelled groups). Most runs holding means the result does not hang on exact values; a collapse means it does.
//   - The spread matters: too wide and any detector degrades. Compare 0.1, 0.25, 0.5.
// Usage:  node reader-robustness.mjs SESSION... [--labels reader_labels.json] [--cfg base.json] [--runs 200] [--spread 0.25] [--seed 1] [--params a,b,c] [--horizon 300] [--json]   |   --selftest
//   --cfg is an engine config (e.g. { "ep": { "exhNear": 1.3 } }) used as the centre of the perturbation; default thresholds when omitted. --params restricts the perturbed thresholds.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readInput, rng } from "./analyze-collectors.mjs";
import { scoreboard, PLAN as SB_PLAN } from "./reader-scoreboard.mjs";
import { loadEngine } from "./compare-detections.mjs";

// thresholds perturbed by default: the episode layer's numeric cut-offs. Timers, caps and cache sizes are not detection judgements, so they stay.
export const PARAMS = ["enterScore", "formScore", "exitScore", "enterHoldMs", "endHoldMs", "recentShare", "recentPace", "crossShare", "crossZ", "burstLiq", "burstSweeps", "exhDecay", "exhWasZ", "exhWasShare", "exhGap", "exhNear", "exhSize", "absAdverse", "absConc", "exhCount", "wallMinMult", "wallMinUsd", "wallMergeBps", "minTradesFast", "minTradesMid"];
export const FRACTIONS = new Set(["enterScore", "formScore", "exitScore", "recentShare", "crossShare", "exhDecay", "exhWasShare", "absConc", "exhCount"]);
export const INTEGERS = new Set(["burstSweeps", "minTradesFast", "minTradesMid", "enterHoldMs", "endHoldMs", "wallMinUsd"]);

// A new engine config: `base` with the listed thresholds of `centre` (the base's full episode settings) scaled; everything else is copied untouched. Unknown or non-numeric keys are skipped.
export function jitterCfg(base, centre, params, spread, rand) {
  const out = {};
  for (const k of params) {
    const v = centre[k]; if (typeof v !== "number") continue;
    let x = v*(1 - spread + 2*spread*rand());
    if (FRACTIONS.has(k)) x = Math.min(1, Math.max(0, x));
    if (INTEGERS.has(k)) x = Math.max(1, Math.round(x));
    out[k] = x;
  }
  return Object.assign({}, base || {}, { ep:Object.assign({}, (base && base.ep) || {}, out) });
}
export function quantile(sorted, q) { if (!sorted.length) return null; const i = (sorted.length - 1)*q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo])*(i - lo); }
const r2 = x => x == null ? null : +x.toFixed(2);

export function robustness(sessions, labels, E, opts = {}) {
  const o = Object.assign({ runs:200, spread:.25, seed:1, horizon:300, params:PARAMS, base:null, minN:SB_PLAN.minN }, opts), rand = rng(o.seed);
  const centre = E.create(o.base || undefined).cfg.ep;      // the base's full episode settings: defaults plus whatever the base overrides
  const plan = Object.assign({}, SB_PLAN, { horizonsSec:[o.horizon], randomStepSec:86400 });      // typical |move| is not used here; a huge step skips its work
  const cell = sb => { const m = {}; for (const f in sb.families) { const x = sb.families[f]; m[f] = { n:x.n, fwd:x.forward[o.horizon].all.median, prec:x.precision.n >= o.minN ? x.precision.share : null }; } return m; };
  const base = cell(scoreboard(sessions, labels, E, o.base, plan)), runs = [];
  for (let i = 0; i < o.runs; i++) runs.push(cell(scoreboard(sessions, labels, E, jitterCfg(o.base, centre, o.params, o.spread, rand), plan)));
  const fams = {};
  for (const f of new Set([...Object.keys(base), ...runs.flatMap(r => Object.keys(r))])) {
    const get = k => runs.map(r => r[f] ? r[f][k] : (k === "n" ? 0 : null)), sorted = k => get(k).filter(x => x != null).sort((a, b) => a - b);
    const band = k => { const s = sorted(k); return s.length ? { n:s.length, p5:r2(quantile(s, .05)), p50:r2(quantile(s, .5)), p95:r2(quantile(s, .95)) } : { n:0, p5:null, p50:null, p95:null }; };
    const b = base[f] || { n:0, fwd:null, prec:null }, fw = get("fwd").filter(x => x != null), pr = get("prec").filter(x => x != null);
    fams[f] = { base:b, groups:band("n"), forward:band("fwd"), precision:band("prec"),
      holdForward: b.fwd == null || b.fwd === 0 ? null : { runs:fw.length, share:fw.length ? +(fw.filter(x => Math.sign(x) === Math.sign(b.fwd)).length/fw.length).toFixed(2) : null },
      holdPrecision: { runs:pr.length, share:pr.length ? +(pr.filter(x => x >= .5).length/pr.length).toFixed(2) : null } };
  }
  return { runs:o.runs, spread:o.spread, seed:o.seed, horizon:o.horizon, params:o.params, sessions:sessions.length, families:fams };
}

function print(r) {
  const L = s => console.log(s), f = x => x == null ? "-" : String(x), band = b => b.n ? f(b.p5) + " / " + f(b.p50) + " / " + f(b.p95) : "-";
  L("\n== " + r.runs + " perturbed configurations, spread +-" + Math.round(r.spread*100) + "% on " + r.params.length + " thresholds, seed " + r.seed + ", " + r.sessions + " session(s), forward move at " + r.horizon + " s");
  L("   columns: base, then the 5th / 50th / 95th percentile over runs");
  for (const name in r.families) {
    const x = r.families[name];
    L("\n-- " + name.toUpperCase());
    L("   groups        base " + f(x.base.n).padEnd(7) + band(x.groups));
    L("   forward move  base " + f(x.base.fwd).padEnd(7) + band(x.forward) + "   (sigmas, in the side's direction)");
    L("   precision     base " + f(x.base.prec).padEnd(7) + band(x.precision) + (x.precision.n ? "" : "   (needs --labels and enough labelled groups)"));
    if (x.holdForward) L("   HOLDS: forward move keeps the base's sign in " + Math.round(100*x.holdForward.share) + "% of " + x.holdForward.runs + " runs");
    if (x.holdPrecision.runs) L("   HOLDS: precision stays at or above 50% in " + Math.round(100*x.holdPrecision.share) + "% of " + x.holdPrecision.runs + " runs");
  }
}

function selfTest() {
  const { E, S } = loadEngine(null, ["reader-landscape", "auto-record-core", "status-core", "session-quality", "collectors-core", "reader-selftest"]);
  const burst = { rate:200, buyP:.1, driftBps:-6, liqSell:3, sweepSell:2, bidMult:.4 }, sessions = [], K = 4, DAY = 86400000;
  for (let k = 0; k < K; k++) {
    const e = E.create(); e.startRecording();
    const base = S.T0 + k*DAY, a = S.sim(e, { t0:base, seconds:150, seed:3 + k }), b = S.sim(e, { t0:a.t, mid0:a.mid, seconds:12, seed:21 + k, params:() => burst }), c = S.sim(e, { t0:b.t, mid0:b.mid, seconds:70, seed:22 + k });
    sessions.push({ file:"sim" + k, inputs:e.stopRecording(), t0:base, t1:c.t });
  }
  const C = { enterScore:.7, exhNear:1, burstSweeps:3, minTradesFast:5, keepEpisodes:300 };
  const mid = jitterCfg(null, C, ["enterScore", "exhNear", "burstSweeps"], .25, () => .5), lo = jitterCfg(null, C, ["enterScore", "exhNear"], .5, () => 0), hi = jitterCfg(null, C, ["enterScore", "burstSweeps"], .5, () => 1);
  const keep = jitterCfg({ gap:1, ep:{ exhNear:2, other:9 } }, C, ["exhNear"], .1, () => 1), skip = jitterCfg(null, C, ["noSuchKey"], .5, () => 1);
  const opt = { runs:4, spread:.25, seed:7, params:["enterScore", "exhNear", "recentShare"] };
  const r1 = robustness(sessions, [], E, opt), r1b = robustness(sessions, [], E, opt), r0 = robustness(sessions, [], E, { runs:3, spread:0, seed:7, params:["enterScore", "exhNear"] }), b = r0.families.burst, g = r1.families.burst;
  const q = [1, 2, 3, 4, 5];
  const checks = [
    ["a draw of 0.5 leaves every threshold unchanged", Math.abs(mid.ep.enterScore - .7) < 1e-9 && Math.abs(mid.ep.exhNear - 1) < 1e-9 && mid.ep.burstSweeps === 3],
    ["the lowest draw scales by 1 - spread; a fraction stays inside [0, 1]", Math.abs(lo.ep.enterScore - .35) < 1e-9 && Math.abs(lo.ep.exhNear - .5) < 1e-9 && hi.ep.enterScore === 1],
    ["counts are rounded and at least 1", hi.ep.burstSweeps === 5 && jitterCfg(null, C, ["minTradesFast"], .99, () => 0).ep.minTradesFast === 1],
    ["only listed thresholds change; the base's other fields and overrides survive; unknown keys are not added", keep.gap === 1 && keep.ep.other === 9 && Math.abs(keep.ep.exhNear - 1.1) < 1e-9 && Object.keys(skip.ep).length === 0],
    ["quantile: median and ends of 1..5, interpolation, empty is null", quantile(q, .5) === 3 && quantile(q, 0) === 1 && quantile(q, 1) === 5 && quantile(q, .25) === 2 && quantile([], .5) === null],
    ["the same seed repeats the exact result", JSON.stringify(r1) === JSON.stringify(r1b)],
    ["the simulated bursts are detected at the base, at least one per session", b && b.base.n >= K],
    ["spread 0 reproduces the base in every run (zero-width band)", b.groups.p5 === b.base.n && b.groups.p95 === b.base.n && b.forward.p5 === b.forward.p95],
    ["a real spread gives ordered bands for the group count (5th <= 50th <= 95th)", g && g.groups.p5 <= g.groups.p50 && g.groups.p50 <= g.groups.p95],
  ];
  let bad = 0; for (const [name, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + name); if (!ok) bad++; }
  if (bad) { console.log(JSON.stringify({ r0:r0.families, r1:r1.families }, null, 1)); process.exit(1); }
  console.log("\nall " + checks.length + " checks passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), val = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const valued = ["--labels", "--cfg", "--runs", "--spread", "--seed", "--params", "--horizon"], files = args.filter((x, i) => !x.startsWith("--") && !valued.includes(args[i - 1]));
  if (args.includes("--selftest")) selfTest();
  else if (!files.length) { console.error("usage: node reader-robustness.mjs SESSION... [--labels reader_labels.json] [--cfg base.json] [--runs 200] [--spread 0.25] [--seed 1] [--params a,b,c] [--horizon 300] [--json]   |   --selftest"); process.exit(2); }
  else {
    const lf = val("--labels"), cf = val("--cfg"), labels = lf ? JSON.parse(fs.readFileSync(lf, "utf8")).labels || [] : [], base = cf ? JSON.parse(fs.readFileSync(cf, "utf8")) : null;
    const sessions = files.map(f => { const s = readInput(f); if (s.kind !== "session") { console.error(f + ": not a session file"); process.exit(2); } return s; });
    const res = robustness(sessions, labels, loadEngine(null).E, { runs:Number(val("--runs")) || 200, spread:val("--spread") != null ? Number(val("--spread")) : .25, seed:Number(val("--seed")) || 1, horizon:Number(val("--horizon")) || 300, params:val("--params") ? val("--params").split(",") : PARAMS, base });
    if (args.includes("--json")) console.log(JSON.stringify(res, null, 1)); else print(res);
  }
}
