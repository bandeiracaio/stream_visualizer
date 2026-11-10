// Offline scoreboard for the Reader: what price did after each episode, and how often do you agree with it. Descriptive, never a keep/drop verdict.
// Replays each saved session through the Reader (default thresholds unless --cfg), takes the episode GROUPS (one per event, like the cards and the labels), and reports per family:
//   1. FORWARD MOVE: the price change after detection at 1, 5 and 15 minutes, in sigmas (the Reader's own ruler, ADR 0004, measured on that session and venue: 75th percentile of absolute deviation
//      of overlapping 15 s returns / 1.1503 / sqrt(15), floor 0.05 bps; the move is divided by sigma * sqrt(horizon seconds)). Signed in the direction of the side: positive means price went the way
//      the aggressor pushed it (for a wall: the way the wall protects, up for a buy wall). Shown as the median, the share that went with the side, and, split by your label, agree / disagree / not labelled.
//      Beside it the typical |move| at random moments of the same sessions at that horizon, so "a big move" can be told from "price always moves this much". Needs the session to run past the horizon.
//   2. PRECISION: agree / (agree + disagree), with a 95% Wilson interval, in total and per UTC day (so a trend over days is visible).
//   3. RECALL among what you called real: agree / (agree + missed), where a "missed" label counts as found when this replay now has a group that matches it (try a changed --cfg).
//      Only missed labels inside the time range of the sessions given are counted.
// Small samples are the rule: every number prints its n, and a family with fewer than `minN` labelled groups says so instead of showing a rate.
// Usage:  node reader-scoreboard.mjs SESSION... [--labels reader_labels.json] [--cfg cfg.json] [--json]      |      --selftest
//   SESSION is a session_*.json.gz (or .json) from the app; --labels is the file from "Export labels" in the Reader tab.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readInput } from "./analyze-collectors.mjs";
import { labelMatches, labelFor } from "./analyze-episodes.mjs";
import { loadEngine } from "./compare-detections.mjs";

// The maths lives in src/js/scoreboard-core.js (shared with the in-app Scoreboard view); it is loaded here from the same file.
const SB = vm.runInNewContext(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "src/js/scoreboard-core.js"), "utf8") + ";SCOREBOARD", {});
export const { PLAN, sideDir, sigmaOf, forwardMove, typicalAbs, wilson } = SB;
export const scoreboard = (sessions, labels, E, cfg, plan = PLAN) => SB.scoreboard(sessions, labels, E, cfg, plan, { labelFor, labelMatches });

const pct = x => x == null ? "  -  " : String(Math.round(100*x)).padStart(3) + "%";
function print(r) {
  const L = s => console.log(s), P = r.plan;
  L("\n== " + r.groups + " episode groups in " + r.sessions + " session(s)   (horizons " + P.horizonsSec.join(", ") + " s; a rate needs at least " + P.minN + " labelled groups)");
  if (!r.groups) return L("   nothing detected in these sessions");
  L("   typical |move| at random moments, in sigmas, per horizon: " + P.horizonsSec.map(H => H + "s " + (r.typicalAbs[H] == null ? "-" : r.typicalAbs[H])).join("   "));
  for (const fam in r.families) {
    const o = r.families[fam], lb = o.labelled, p = o.precision;
    L("\n-- " + fam.toUpperCase() + ": " + o.n + " groups; labelled " + lb.agree + " agree, " + lb.disagree + " disagree, " + lb.none + " not labelled");
    L("   PRECISION  " + (p.n ? (p.enough ? pct(p.share) + "  (95% " + pct(p.ci[0]).trim() + " to " + pct(p.ci[1]).trim() + ")" : "n " + p.n + ", too few for a rate (need " + P.minN + ")") : "no labels") + (p.n && p.enough ? "  of " + p.n : ""));
    for (const d of o.byDay) if (d.n) L("      " + d.day + "  " + (d.enough ? pct(d.share) : "  . ") + "   " + d.agree + " agree / " + d.disagree + " disagree");
    L("   FORWARD MOVE in sigmas, in the side's direction (median / share that went with the side / n):");
    L("      " + "horizon".padEnd(9) + "all".padEnd(22) + "agree".padEnd(22) + "disagree".padEnd(22) + "not labelled");
    for (const H of P.horizonsSec) {
      const f = o.forward[H], c = x => (x.n ? (x.median >= 0 ? "+" : "") + x.median + " / " + pct(x.withShare).trim() + " / " + x.n : "-").padEnd(22);
      L("      " + (H + "s").padEnd(9) + c(f.all) + c(f.agree) + c(f.disagree) + c(f.none).trimEnd());
    }
  }
  const m = r.missed;
  L("\n-- RECALL among what you called real (agree + missed; a missed label is found when this replay now has a matching group). Missed labels in range: " + m.total);
  const fams = Object.keys(m.perFamily);
  if (!fams.length) L("   no agree or missed labels");
  for (const f of fams) { const x = m.perFamily[f]; L("   " + f.padEnd(12) + (x.enough ? pct(x.recall) + "  (95% " + pct(x.ci[0]).trim() + " to " + pct(x.ci[1]).trim() + ")" : "too few (n " + x.real + ")") + "   agree " + x.agree + ", missed " + x.missed + " (" + x.caughtNow + " caught now, " + x.stillMissed + " still missed)"); }
}

// ---------- self-test
function selfTest() {
  const { E, S } = loadEngine(null, ["reader-landscape", "auto-record-core", "status-core", "session-quality", "collectors-core", "reader-selftest"]);
  const burst = { rate:200, buyP:.1, driftBps:-6, liqSell:3, sweepSell:2, bidMult:.4 }, sessions = [], labels = [], K = 10, DAY = 86400000;
  for (let k = 0; k < K; k++) {
    const e = E.create(); e.startRecording();
    const base = S.T0 + k*DAY, a = S.sim(e, { t0:base, seconds:150, seed:3 + k }), b = S.sim(e, { t0:a.t, mid0:a.mid, seconds:12, seed:21 + k, params:() => burst }), c = S.sim(e, { t0:b.t, mid0:b.mid, seconds:70, seed:22 + k });
    const inputs = e.stopRecording(), g = E.replayEngine(inputs).episodeGroups()[0];
    sessions.push({ file:"sim" + k, inputs, t0:base, t1:c.t });
    if (k < 8) labels.push({ verdict:k < 6 ? "agree" : "disagree", family:g.family, venue:"any", side:"sell", t0:g.tStart, t1:g.tEnd || g.tUpdate });
  }
  // two missed labels: one on a burst the Reader found (so it is "caught"), one in a quiet stretch of the first session (still missed). The caught one sits on an unlabelled group (k = 9).
  const g9 = E.replayEngine(sessions[9].inputs).episodeGroups()[0];
  labels.push({ verdict:"missed", family:g9.family, venue:"any", side:"sell", t0:g9.tStart, t1:g9.tEnd || g9.tUpdate });
  labels.push({ verdict:"missed", family:"wall", venue:"any", side:"buy", t0:sessions[0].t0 + 20000, t1:sessions[0].t0 + 40000 });
  labels.push({ verdict:"missed", family:"wall", venue:"any", side:"buy", t0:sessions[0].t0 + 400*DAY, t1:sessions[0].t0 + 400*DAY + 1000 });      // outside every session: ignored
  const sb = scoreboard(sessions, labels, E, null, Object.assign({}, PLAN, { minN:4 })), f = sb.families.burst || {}, mf = sb.missed.perFamily;
  // pieces on hand-made history: a price that rises 1 bp every second after t = 0, one point a second
  const hist = []; for (let i = 0; i <= 1000; i++) hist.push([i*1000, 100000*(1 + i*1e-4)]);
  const flat = []; for (let i = 0; i <= 400; i++) flat.push([i*1000, 50000]);
  const w1 = wilson(5, 10), w0 = wilson(0, 10), w00 = wilson(0, 0);
  const checks = [
    ["the simulator produced one burst group per session", sb.groups === K && f.n === K],
    ["labels were counted the way the app matches them", f.labelled.agree === 6 && f.labelled.disagree === 2 && f.labelled.none === 2],
    ["precision = agree / (agree + disagree) with an interval around it", f.precision.n === 8 && f.precision.share === 0.75 && f.precision.ci[0] < 0.75 && f.precision.ci[1] > 0.75 && f.precision.enough],
    ["precision per day: one row per day, labelled groups only counted", f.byDay.length === K && f.byDay.filter(d => d.n === 1).length === 8],
    ["a rate with too few labels says so", scoreboard(sessions.slice(0, 2), labels, E, null, Object.assign({}, PLAN, { minN:4 })).families.burst.precision.enough === false],
    ["forward move: a rise of 1 bp a second, measured from t = 100 s, is about +59 bps after 60 s, in sigmas of 0.5 bps/root s", Math.abs(forwardMove(hist, 100000, 60, 1, 0.5) - (1.016/1.01 - 1)*1e4/(0.5*Math.sqrt(60))) < 1e-6 && forwardMove(hist, 100000, 60, -1, 0.5) < 0],
    ["forward move: null past the end of the history, or with no price at the start", forwardMove(hist, 990000, 60, 1, 0.5) === null && forwardMove(hist, -50000, 60, 1, 0.5) === null],
    ["forward move was measured after the simulated bursts (the sessions run past the horizon)", f.forward[60].all.n === K],
    ["sell burst in a falling market: price went with the aggressor in most groups", f.forward[60].all.median > 0 && f.forward[60].all.withShare >= 0.7],
    ["sigma: a flat price sits on the floor; a moving one is above it", sigmaOf(flat) === PLAN.sigmaFloor && sigmaOf(hist) > PLAN.sigmaFloor],
    ["typical |move| of a steady rise is positive; of a flat price is zero", typicalAbs(hist, 60, 0.5) > 0 && typicalAbs(flat, 60, 0.5) === 0],
    ["side direction: buy and a bid wall are up, sell and an ask wall are down, no side is none", sideDir("buy") === 1 && sideDir("bid") === 1 && sideDir("sell") === -1 && sideDir("ask") === -1 && sideDir("") === 0],
    ["wilson: 5 of 10 is centred near half; 0 of 10 starts at 0; no sample is null", w1[0] < 0.5 && w1[1] > 0.5 && Math.abs((w1[0] + w1[1])/2 - 0.5) < 0.02 && w0[0] === 0 && w0[1] > 0 && w00 === null],
    ["recall: missed labels outside the sessions are ignored; one is caught now, one is still missed", sb.missed.total === 2 && mf.burst && mf.burst.missed === 1 && mf.burst.caughtNow === 1 && mf.wall && mf.wall.missed === 1 && mf.wall.stillMissed === 1],
    ["recall counts what was called real: agree groups plus caught missed", mf.burst.real === 7 && Math.abs(mf.burst.recall - 7/7) < 1e-9],
  ];
  let bad = 0; for (const [name, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + name); if (!ok) bad++; }
  if (bad) { console.log(JSON.stringify({ burst:{ n:f.n, labelled:f.labelled, precision:f.precision, fwd60:f.forward[60].all }, missed:sb.missed }, null, 1)); process.exit(1); }
  console.log("\nall " + checks.length + " checks passed");
}

// ---------- main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), val = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const files = args.filter((x, i) => !x.startsWith("--") && !["--labels", "--cfg"].includes(args[i - 1]));
  if (args.includes("--selftest")) selfTest();
  else if (!files.length) { console.error("usage: node reader-scoreboard.mjs SESSION... [--labels reader_labels.json] [--cfg cfg.json] [--json]   |   --selftest"); process.exit(2); }
  else {
    const lf = val("--labels"), cf = val("--cfg"), labels = lf ? JSON.parse(fs.readFileSync(lf, "utf8")).labels || [] : [], cfg = cf ? JSON.parse(fs.readFileSync(cf, "utf8")) : null;
    const sessions = files.map(f => { const s = readInput(f); if (s.kind !== "session") { console.error(f + ": not a session file"); process.exit(2); } return s; });
    const res = scoreboard(sessions, labels, loadEngine(null).E, cfg);
    if (args.includes("--json")) console.log(JSON.stringify(res, (k, v) => k === "g" ? undefined : v, 1)); else print(res);
  }
}
