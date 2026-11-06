// Offline pre-registered test: does price come back after a big liquidation cluster, beyond what matched moments without one do? Plan: .scratch/liquidation-study/plan.md (registered before any
// test-set session existed). Not part of the app.
//   node analyze-liquidations.mjs --status [DIR]     counts only (sessions, clusters, pairs); computes and prints NO outcome, so it can be run as often as you like
//   node analyze-liquidations.mjs [DIR] [--json]     the test, on sessions that started after PLAN.cutoffIso; refuses to run before PLAN.minClusters clusters and PLAN.minPairs pairs exist
//   node analyze-liquidations.mjs --plan | --selftest
// Events: Binance liquidations from the session inputs (trades with liq), Bybit and OKX from the `liqPerp` collector records (v122 and later; a session counts as having them if it has `oiPerp` records,
// so "no liquidations" is told from "not recorded"). A cluster = events within PLAN.gapMs of each other (LIQ.clusters of src/js/liq-core.js). Primary clusters: at least PLAN.minClusterUsd,
// at least PLAN.oneSided of the dollars on one side. Price: the Binance mid once a second from the recorded quotes; moves in sigmas (scoreboard-core: sigmaOf, forwardMove), signed in the direction
// the forced orders pushed (longs liquidated = down), so a negative move after the cluster is a reversal.
// Controls (pooled over the test sessions): moments on a PLAN.ctlStepSec grid whose 5-minute move in that direction is within PLAN.priorTol sigma of the cluster's and whose last-minute move is within
// PLAN.prior1Tol, with no cluster of at least PLAN.ctlNearUsd overlapping [5 min before, horizon after]; at least PLAN.ctlMin of them. Test T2: per cluster, the move after it minus the median move after its controls (at least PLAN.ctlMin controls); the statistic is the
// median of those differences; one-sided p-value by flipping the sign of whole sessions (PLAN.permutations) and a second one-sided p-value from resampling sessions (PLAN.bootstrap); both must be at most PLAN.alpha.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readInput, rng } from "./analyze-collectors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (f, name) => vm.runInNewContext(fs.readFileSync(path.join(HERE, "src/js", f), "utf8") + ";" + name, {});
const SB = load("scoreboard-core.js", "SCOREBOARD"), LIQ = load("liq-core.js", "LIQ");
const { sigmaOf, forwardMove, wilson } = SB;

export const PLAN = {
  cutoffIso:"2026-11-06T03:15:00Z", gapMs:30000, minClusterUsd:100000, oneSided:0.9, priorTol:0.3, prior1Tol:0.6, ctlNearUsd:25000, ctlMin:20, ctlMax:200, ctlStepSec:10, preSec:300,
  horizons:[60, 300, 900], primaryH:60, alpha:0.05, permutations:9999, bootstrap:2000, minClusters:60, minPairs:30, seed:20261106,
};

const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m])/2; };
const r3 = x => x == null ? null : +x.toFixed(3);

// ---------- sessions
export function prepSession(s) {
  const q = new Map(), events = [];
  for (const r of s.inputs) {
    if (r[0] === "q" && r[1] === "bn") { const t = +r[2], b = +r[3], a = +r[4]; if (t > 0 && b > 0 && a >= b) q.set(Math.floor(t/1000), (b + a)/2); }
    else if (r[0] === "t") { const x = r[1]; if (x && x.liq && x.v === "bn" && x.ntl > 0 && (x.side === "buy" || x.side === "sell")) events.push({ t:x.t, v:"bn", side:x.side, ntl:x.ntl }); }
  }
  let hasPerp = false;
  for (const r of s.records || []) {
    if (r[1] === "oiPerp") hasPerp = true;
    else if (r[1] === "liqPerp" && r[3] && (r[3].v === "by" || r[3].v === "ok") && Array.isArray(r[3].rows)) for (const x of r[3].rows) { const ntl = x.px*x.q; if (ntl > 0 && (x.side === "buy" || x.side === "sell")) events.push({ t:x.t, v:r[3].v, side:x.side, ntl }); }
  }
  const hist = [...q.entries()].sort((a, b) => a[0] - b[0]).map(([sec, m]) => [sec*1000, m]);
  return { file:s.file, t0:s.t0, hist, events, hasPerp, sigma:hist.length >= 600 ? sigmaOf(hist) : null, hours:hist.length > 1 ? (hist[hist.length - 1][0] - hist[0][0])/3600000 : 0 };
}
export function loadSessions(paths) {
  const files = [];
  for (const p of paths) { if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p).sort()) { if (/\.json(\.gz)?$/.test(f) && f.startsWith("session")) files.push(path.join(p, f)); } else files.push(p); }
  return files.map(f => { const s = readInput(f); if (s.kind !== "session") throw new Error(f + ": not a session file"); return prepSession(s); });
}
export const testSet = (preps, plan = PLAN) => preps.filter(p => p.t0 >= Date.parse(plan.cutoffIso) && p.sigma);

// ---------- clusters, control moments and pairs
// The primary clusters of one session with their moves: before (5 min and last minute, in the cluster's direction) and after (from the cluster's end, per horizon). No controls here.
export function sessionClusters(p, evFilter, plan = PLAN) {
  const all = LIQ.clusters(p.events.filter(evFilter), plan.gapMs), out = [];
  for (const c of all) {
    if (c.ntl < plan.minClusterUsd || c.domShare < plan.oneSided) continue;
    const dir = c.dom === "sell" ? -1 : 1, pre = forwardMove(p.hist, c.t0 - plan.preSec*1000, plan.preSec, dir, p.sigma), pre1 = forwardMove(p.hist, c.t0 - 60000, 60, dir, p.sigma);
    if (pre == null || pre1 == null) continue;
    const row = { file:p.file, t0:c.t0, t1:c.t1, ntl:c.ntl, dir, pre, pre1, after:{} };
    for (const H of plan.horizons) row.after[H] = forwardMove(p.hist, c.t1, H, dir, p.sigma);
    out.push(row);
  }
  return out;
}
// Control moments of one session on a plan.ctlStepSec grid: raw (upward-signed) moves over the last 5 minutes and last minute and over each horizon, and whether a cluster of at least
// plan.ctlNearUsd overlaps [5 min before, horizon after] (then the moment is no control for that horizon).
export function sessionMoments(p, evFilter, plan = PLAN) {
  const near = LIQ.clusters(p.events.filter(evFilter), plan.gapMs).filter(c => c.ntl >= plan.ctlNearUsd), out = [], t0h = p.hist[0][0], tEnd = p.hist[p.hist.length - 1][0], Hmax = Math.max(...plan.horizons);
  for (let t = t0h + plan.preSec*1000; t + Hmax*1000 <= tEnd; t += plan.ctlStepSec*1000) {
    const p5 = forwardMove(p.hist, t - plan.preSec*1000, plan.preSec, 1, p.sigma), p1 = forwardMove(p.hist, t - 60000, 60, 1, p.sigma); if (p5 == null || p1 == null) continue;
    const f = {}, ex = {}; for (const H of plan.horizons) { f[H] = forwardMove(p.hist, t, H, 1, p.sigma); ex[H] = near.some(k => k.t0 <= t + H*1000 && k.t1 >= t - plan.preSec*1000); }
    out.push({ file:p.file, t, p5, p1, f, ex });
  }
  return out;
}
// For every cluster and horizon: the controls (any test session) whose moves before match within the tolerances, signed in the cluster's direction; their outcome list (a seeded sample of at most plan.ctlMax)
export function pairUp(rows, moments, plan = PLAN) {
  const R = rng(plan.seed + 17);
  for (const r of rows) {
    r.ctl = {};
    for (const H of plan.horizons) {
      const cand = []; for (const m of moments) if (!m.ex[H] && m.f[H] != null && Math.abs(r.dir*m.p5 - r.pre) <= plan.priorTol && (plan.prior1Tol == null || Math.abs(r.dir*m.p1 - r.pre1) <= plan.prior1Tol)) cand.push(r.dir*m.f[H]);
      if (cand.length >= plan.ctlMin) { if (cand.length > plan.ctlMax) { for (let i = 0; i < plan.ctlMax; i++) { const j = i + Math.floor(R()*(cand.length - i)); [cand[i], cand[j]] = [cand[j], cand[i]]; } cand.length = plan.ctlMax; } r.ctl[H] = cand; }
    }
  }
  return rows;
}
const variantRows = (sessions, evFilter, plan) => pairUp([].concat(...sessions.map(p => sessionClusters(p, evFilter, plan))), [].concat(...sessions.map(p => sessionMoments(p, evFilter, plan))), plan);

// ---------- the tests
function flipP(diffsBySession, observed, K, seed) {      // one-sided: the share of random whole-session sign flips whose median is at most the observed one
  const R = rng(seed), groups = Object.values(diffsBySession); let le = 0;
  for (let k = 0; k < K; k++) { const all = []; for (const g of groups) { const sg = R() < 0.5 ? -1 : 1; for (const d of g) all.push(sg*d); } if (median(all) <= observed + 1e-12) le++; }
  return (1 + le)/(K + 1);
}
function bootCI(diffsBySession, B, seed) {      // the 95% interval of the median difference and the one-sided p (the share of resampled medians at or above zero), resampling whole sessions
  const R = rng(seed), groups = Object.values(diffsBySession), meds = []; let ge = 0;
  for (let b = 0; b < B; b++) { const all = []; for (let i = 0; i < groups.length; i++) all.push(...groups[Math.floor(R()*groups.length)]); const m = median(all); meds.push(m); if (m >= 0) ge++; }
  meds.sort((a, b) => a - b); return { ci:[r3(meds[Math.floor(0.025*B)]), r3(meds[Math.min(B - 1, Math.floor(0.975*B))])], p:(1 + ge)/(B + 1) };
}
export function holm(ps) { const idx = ps.map((p, i) => [p, i]).filter(x => x[0] != null).sort((a, b) => a[0] - b[0]), m = idx.length, out = ps.map(() => null); let run = 0; idx.forEach(([p, i], j) => { run = Math.max(run, Math.min(1, (m - j)*p)); out[i] = run; }); return out; }
export function analyzeVariant(rows, plan = PLAN) {
  const out = { clusters:rows.length, sessions:new Set(rows.map(r => r.file)).size, horizons:{} };
  for (const H of plan.horizons) {
    const withAfter = rows.filter(r => r.after[H] != null), pairs = rows.filter(r => r.after[H] != null && r.ctl[H]);
    const diffs = pairs.map(r => ({ f:r.file, d:r.after[H] - median(r.ctl[H]) })), bySession = {}; for (const x of diffs) (bySession[x.f] ||= []).push(x.d);
    const neg = withAfter.filter(r => r.after[H] < 0).length, w = wilson(neg, withAfter.length);
    const h = { n:withAfter.length, medianAfter:r3(median(withAfter.map(r => r.after[H]))), shareReversed:withAfter.length ? r3(neg/withAfter.length) : null, shareReversedCI:w ? w.map(r3) : null, pairs:pairs.length };
    if (pairs.length >= 5) { const obs = median(diffs.map(x => x.d)); h.medianControl = r3(median(pairs.map(r => median(r.ctl[H])))); h.medianDiff = r3(obs); h.p = r3(flipP(bySession, obs, plan.permutations, plan.seed + H)); const bc = bootCI(bySession, plan.bootstrap, plan.seed + 7*H); h.ci = bc.ci; h.pBoot = r3(bc.p); }
    out.horizons[H] = h;
  }
  const pw = h => h.p == null ? null : Math.max(h.p, h.pBoot), sec = plan.horizons.filter(H => H !== plan.primaryH), hp = holm(sec.map(H => pw(out.horizons[H]))); sec.forEach((H, i) => { out.horizons[H].pHolm = hp[i] == null ? null : r3(hp[i]); });
  return out;
}
export function verdictOf(v, plan = PLAN) {
  const h = v.horizons[plan.primaryH];
  if (v.clusters < plan.minClusters || h.pairs < plan.minPairs) return "not enough data (need " + plan.minClusters + " clusters and " + plan.minPairs + " pairs, have " + v.clusters + " and " + h.pairs + ")";
  return h.medianDiff < 0 && h.p <= plan.alpha && h.pBoot <= plan.alpha ? "REVERSAL beyond matched controls" : "no reversal beyond matched controls";
}
export function status(preps, plan = PLAN) {
  const T = testSet(preps, plan), P = T.filter(p => p.hasPerp), allRows = variantRows(P, () => true, plan), bnRows = variantRows(T, e => e.v === "bn", plan);
  const count = rows => ({ clusters:rows.length, pairsAtPrimary:rows.filter(r => r.after[plan.primaryH] != null && r.ctl[plan.primaryH]).length });
  return { cutoff:plan.cutoffIso, testSessions:T.length, withBybitOkx:P.length, hours:+T.reduce((a, p) => a + p.hours, 0).toFixed(1), threeVenue:count(allRows), binanceOnly:count(bnRows), needed:{ clusters:plan.minClusters, pairs:plan.minPairs } };
}
export function study(preps, plan = PLAN) {
  const T = testSet(preps, plan), P = T.filter(p => p.hasPerp);
  const primaryRows = variantRows(P, () => true, plan), bnRows = variantRows(T, e => e.v === "bn", plan);
  const primary = analyzeVariant(primaryRows, plan), binance = analyzeVariant(bnRows, plan);
  // descriptive: does a bigger cluster reverse more? rank correlation of log dollars and the 1-minute move among the primary clusters, given the move before
  const pr = primaryRows.filter(r => r.after[plan.primaryH] != null); let dose = null;
  if (pr.length >= 30) { const rk = a => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); o.forEach(([, i], j) => { r[i] = j + 1; }); return r; }, x = rk(pr.map(r => Math.log(r.ntl))), y = rk(pr.map(r => r.after[plan.primaryH])), z = rk(pr.map(r => r.pre));
    const res = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0)/n, mb = b.reduce((s, v) => s + v, 0)/n; let c = 0, v = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma)*(b[i] - mb); v += (b[i] - mb)**2; } const k = v ? c/v : 0; return a.map((u, i) => u - ma - k*(b[i] - mb)); };
    const ex = res(x, z), ey = res(y, z); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < ex.length; i++) { sxy += ex[i]*ey[i]; sxx += ex[i]**2; syy += ey[i]**2; } dose = { n:pr.length, rho:sxx && syy ? r3(sxy/Math.sqrt(sxx*syy)) : null }; }
  return { plan, testSessions:T.length, withBybitOkx:P.length, hours:+T.reduce((a, p) => a + p.hours, 0).toFixed(1), primary, binanceOnly:binance, dose, verdict:verdictOf(primary, plan) };
}
function print(r) {
  const L = s => console.log(s), f = x => x == null ? "-" : (x >= 0 ? "+" : "") + x;
  L("\n== liquidation reversal test: " + r.testSessions + " test sessions (" + r.hours + " h), " + r.withBybitOkx + " with Bybit and OKX liquidations; sessions started on or after " + r.plan.cutoffIso);
  for (const [name, v] of [["PRIMARY: Binance + Bybit + OKX clusters", r.primary], ["secondary: Binance-only clusters (comparable with the exploratory look)", r.binanceOnly]]) {
    L("\n-- " + name + ": " + v.clusters + " clusters of at least $" + r.plan.minClusterUsd/1000 + "k in " + v.sessions + " sessions");
    for (const H of r.plan.horizons) { const h = v.horizons[H]; L("   after " + String(H).padStart(3) + " s: median move " + f(h.medianAfter) + " sigma, reversed in " + (h.shareReversed == null ? "-" : Math.round(100*h.shareReversed) + "%") + (h.shareReversedCI ? " (95% " + Math.round(100*h.shareReversedCI[0]) + " to " + Math.round(100*h.shareReversedCI[1]) + ")" : "") + "; " + h.pairs + " pairs" + (h.p != null ? "; controls " + f(h.medianControl) + ", cluster minus controls " + f(h.medianDiff) + " (95% " + h.ci[0] + " to " + h.ci[1] + "), one-sided p " + h.p + " (sign flips) / " + h.pBoot + " (resampled sessions)" + (h.pHolm != null ? ", Holm " + h.pHolm : "") : "")); }
  }
  if (r.dose) L("\n   descriptive: rank correlation of cluster size and the 1-minute move, given the move before: " + r.dose.rho + " (n " + r.dose.n + ")");
  L("\n   VERDICT (primary: " + r.plan.primaryH + " s, three venues): " + r.verdict);
  L("   Descriptive and small-sample; a reversal here is a hypothesis for the Reader, never a trading claim.");
}

// ---------- self-test: synthetic sessions with a planted reversal, and the same without it
function synth(o) {
  const R = rng(o.seed), gauss = () => Math.sqrt(-2*Math.log(R() + 1e-12))*Math.cos(2*Math.PI*R()), out = [], secs = o.minutes*60;
  for (let s = 0; s < o.sessions; s++) {
    const t0 = Date.parse("2026-11-07T00:00:00Z") + s*7200000, inc = new Float64Array(secs + 1), inputs = [], records = [];
    for (let t = 0; t <= secs; t++) inc[t] = 0.8*gauss();
    for (let e = 400; e + 300 + 200 < secs; e += 700) { const sign = R() < 0.5 ? -1 : 1, d = sign*(0.04 + 0.02*R()); for (let t = e; t < e + 300; t++) inc[t] += d; }      // drift episodes: a trending state that has nothing to do with the clusters
    for (let k = 0; k < 4; k++) {      // clusters at random times, independent of the price path; the planted reversal follows each one
      const ce = 350 + Math.floor(R()*(secs - 600)), side = R() < 0.5 ? "sell" : "buy", sign = side === "sell" ? -1 : 1, n = 3 + Math.floor(R()*4), total = 150000 + R()*900000;
      for (let i = 0; i < n; i++) {
        const ts = ce + i*2, v = ["bn", "by", "ok"][Math.floor(R()*3)], ntl = total/n;
        if (v === "bn") inputs.push(["t", { t:t0 + ts*1000, v:"bn", side, px:100000, q:ntl/100000, ntl, liq:true }]);
        else records.push(["c", "liqPerp", t0 + ts*1000, { v, rows:[{ t:t0 + ts*1000, side, px:100000, q:ntl/100000 }] }]);
      }
      if (o.plant) for (let t = ce + 8; t < ce + 68; t++) inc[t] += -sign*0.25;
    }
    for (let t = 0; t <= secs; t += 10) records.push(["c", "oiPerp", t0 + t*1000, { by:{ oi:1, usd:1 } }]);
    let lp = 0; for (let t = 0; t <= secs; t++) { lp += inc[t]; const mid = 100000*Math.exp(lp/1e4); inputs.push(["q", "bn", t0 + t*1000, mid - 0.5, mid + 0.5]); }
    out.push({ file:"syn" + String(s).padStart(3, "0"), t0, inputs, records });
  }
  return out;
}
function selfTest() {
  const plan = Object.assign({}, PLAN, { cutoffIso:"2026-11-06T00:00:00Z", permutations:999, bootstrap:300, minClusters:30, minPairs:15 }), checks = [], add = (n, ok) => checks.push([n, !!ok]);
  const tape = o => synth(o).map(prepSession);
  const planted = tape({ seed:31, sessions:60, minutes:60, plant:true }), pv = study(planted, plan), st = status(planted, plan);
  add("planted reversal: more than 30 clusters, the move after the cluster is a reversal and clearly below the matched controls", pv.primary.clusters >= 30 && pv.primary.horizons[60].medianAfter < -0.5 && pv.primary.horizons[60].medianDiff < -0.4 && pv.primary.horizons[60].p <= 0.01 && pv.verdict === "REVERSAL beyond matched controls");
  add("planted: the 5-minute horizon is reported too, with a Holm-adjusted p-value", pv.primary.horizons[300].pHolm != null && pv.primary.horizons[900].pHolm != null && pv.primary.horizons[300].pHolm >= pv.primary.horizons[300].p);
  let falseHits = 0, maxAbs = 0; const diffs = [], nullSeeds = [41, 42, 43, 44, 45, 46, 47, 48];
  for (const seed of nullSeeds) { const v = study(tape({ seed, sessions:60, minutes:60, plant:false }), plan); if (v.verdict === "REVERSAL beyond matched controls") falseHits++; maxAbs = Math.max(maxAbs, Math.abs(v.primary.horizons[60].medianDiff)); diffs.push([v.primary.horizons[60].medianDiff, v.primary.horizons[60].p, v.primary.horizons[60].pairs]); }
  add("no planted reversal, eight different tapes: at most one false 'reversal' at the 5% level, and the cluster-minus-control difference stays near zero", falseHits <= 1 && maxAbs < 0.5);
  add("the sessions are split by the cutoff: sessions before it are not in the test set", testSet(planted, Object.assign({}, plan, { cutoffIso:"2030-01-01T00:00:00Z" })).length === 0 && testSet(planted, plan).length === 60);
  const noPerp = planted.map(p => Object.assign({}, p, { hasPerp:false })), sNo = status(noPerp, plan);
  add("a session without Bybit and OKX records is left out of the three-venue variant but kept in the Binance-only one", sNo.threeVenue.clusters === 0 && sNo.binanceOnly.clusters > 0 && st.threeVenue.clusters > sNo.binanceOnly.clusters);
  add("status prints counts only: no outcome field", !JSON.stringify(st).match(/median|\"p\"|rho|after/) && st.threeVenue.pairsAtPrimary > 0);
  const rows = variantRows(planted.slice(0, 20), () => true, plan), mom = sessionMoments(planted[0], () => true, plan);
  add("clusters of the primary kind are one-sided and big; every control set has at least the required number of moments; a moment near a $25k cluster is no control for that horizon", rows.length > 0 && rows.every(r => r.ntl >= plan.minClusterUsd && (!r.ctl[60] || r.ctl[60].length >= plan.ctlMin)) && rows.some(r => r.ctl[60]) && mom.some(m => m.ex[60]) && mom.some(m => !m.ex[60]));
  add("deterministic", JSON.stringify(study(planted, plan)) === JSON.stringify(pv));
  const few = study(tape({ seed:51, sessions:4, minutes:60, plant:true }), plan);
  add("too little data says so instead of a verdict", /^not enough data/.test(few.verdict));
  let bad = 0; for (const [n, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + n); if (!ok) bad++; }
  if (bad) { console.log(JSON.stringify({ pv:pv.primary, falseHits, maxAbs, diffs, st }, null, 1)); process.exit(1); }
  console.log("\nall " + checks.length + " checks passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), paths = args.filter(a => !a.startsWith("--"));
  if (args.includes("--selftest")) selfTest();
  else if (args.includes("--plan")) console.log(JSON.stringify({ PLAN }, null, 1));
  else {
    const preps = loadSessions(paths.length ? paths : [path.join(HERE, "sessions")]);
    if (args.includes("--status")) console.log(JSON.stringify(status(preps), null, 1));
    else { const st = status(preps); if (st.threeVenue.clusters < PLAN.minClusters || st.threeVenue.pairsAtPrimary < PLAN.minPairs) { console.log("Not yet: " + JSON.stringify(st) + "\nThe test runs once the primary variant has " + PLAN.minClusters + " clusters and " + PLAN.minPairs + " pairs."); process.exit(0); } const r = study(preps); if (args.includes("--json")) console.log(JSON.stringify(r, null, 1)); else print(r); }
  }
}
