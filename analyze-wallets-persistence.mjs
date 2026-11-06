// EXPLORATORY follow-up to the registered wallet study (.scratch/wallet-study/plan.md, result-20261105.md), written AFTER its result was seen (the plan is unchanged; see its section 10).
// Question: do the wallets that looked good in block A (10-second signed mid markout after their taker trades) stay good later? Same score and eligibility as the registered study
// (notional-weighted mean markout in bps, at least PLAN.hotMinTrades taker trades, top PLAN.hotTopFrac = the hot cohort), same blocks (A, and B + C together as "later").
//   1. rank correlation of a wallet's score in period 1 and in period 2 (wallets with enough taker trades in both), permutation p-value;
//   2. the hot cohort's pooled markout in period 2 against 1,000 random cohorts of the same size drawn from the wallets that have period-2 data;
//   3. mean period-2 markout by period-1 decile (regression to the mean shows as a flat or reversed pattern).
// Run for A -> later and, as a baseline over a shorter gap, first half of A -> second half of A. Sensitivity: period-2 minimum 10 and 30 taker trades; a robust score (median of per-trade markouts).
//   node analyze-wallets-persistence.mjs [--json]      |      --selftest
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN, blocksOf, loadSessions } from "./analyze-wallets.mjs";
import { rng } from "./analyze-collectors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPEC = { min1:PLAN.hotMinTrades, min2List:[10, 30], topFrac:PLAN.hotTopFrac, markoutSec:PLAN.hotMarkoutSec, permutations:2000, cohortDraws:1000, deciles:10, seed:20261106 };

function priceAt(h, t) { let lo = 0, hi = h.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 && t - h[r][0] <= 2000 ? h[r][1] : null; }
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m])/2; };
function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j)/2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
function spearmanOf(rx, ry) { const n = rx.length, m = (n + 1)/2; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (rx[i] - m)*(ry[i] - m); sxx += (rx[i] - m)**2; syy += (ry[i] - m)**2; } return sxx && syy ? sxy/Math.sqrt(sxx*syy) : null; }

// wallet -> {s, w, n, vs}: the notional-weighted markout sum, the dollars, the number of taker trades, and the per-trade markouts (bps, signed in the taker's direction)
export function markouts(sessions, sec = SPEC.markoutSec) {
  const m = new Map();
  for (const p of sessions) for (const x of p.trades) {
    const m0 = priceAt(p.hist, x.t), m1 = priceAt(p.hist, x.t + sec*1000); if (!(m0 > 0) || !(m1 > 0)) continue;
    const v = (m1/m0 - 1)*1e4*(x.buy ? 1 : -1); let o = m.get(x.taker); if (!o) m.set(x.taker, o = { s:0, w:0, n:0, vs:[] });
    o.s += v*x.ntl; o.w += x.ntl; o.n++; o.vs.push(v);
  }
  return m;
}
// period 1 -> period 2 (maps from markouts()). robust = score by the median per-trade markout instead of the notional-weighted mean.
export function persistence(m1, m2, min1, min2, o = SPEC, robust = false) {
  const score = x => robust ? median(x.vs) : x.s/x.w, elig = [...m1].filter(([, x]) => x.n >= min1).map(([w, x]) => ({ w, x:score(x) })).sort((a, b) => b.x - a.x || (a.w < b.w ? -1 : 1));
  const nHot = Math.max(1, Math.floor(elig.length*o.topFrac)), hot = new Set(elig.slice(0, nHot).map(e => e.w));
  const both = elig.filter(e => m2.has(e.w) && m2.get(e.w).n >= min2).map(e => ({ w:e.w, x:e.x, y:score(m2.get(e.w)), s2:m2.get(e.w).s, w2:m2.get(e.w).w, hot:hot.has(e.w) }));
  const out = { eligible1:elig.length, nHot, withPeriod2:both.length, hotWithPeriod2:both.filter(b => b.hot).length };
  if (both.length < 30) return Object.assign(out, { short:true });
  const rx = ranks(both.map(b => b.x)), ry = ranks(both.map(b => b.y)), rho = spearmanOf(rx, ry), R = rng(o.seed); let ge = 0;
  for (let k = 0; k < o.permutations; k++) { const p = ry.slice(); for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(R()*(i + 1)); [p[i], p[j]] = [p[j], p[i]]; } const r = spearmanOf(rx, p); if (r != null && Math.abs(r) >= Math.abs(rho) - 1e-12) ge++; }
  out.rho = +rho.toFixed(3); out.p = +((1 + ge)/(o.permutations + 1)).toFixed(4);
  const pooled = list => { const w = list.reduce((a, b) => a + b.w2, 0); return w ? list.reduce((a, b) => a + b.s2, 0)/w : null; };
  const hotL = both.filter(b => b.hot), restL = both.filter(b => !b.hot);
  if (hotL.length >= 5) {
    const hp = pooled(hotL); let ge2 = 0; const R2 = rng(o.seed + 1);
    for (let k = 0; k < o.cohortDraws; k++) { const idx = both.map((_, i) => i); for (let i = 0; i < hotL.length; i++) { const j = i + Math.floor(R2()*(idx.length - i)); [idx[i], idx[j]] = [idx[j], idx[i]]; } if (pooled(idx.slice(0, hotL.length).map(i => both[i])) >= hp) ge2++; }
    out.hotLater = { n:hotL.length, pooledBps:+hp.toFixed(2), restPooledBps:restL.length ? +pooled(restL).toFixed(2) : null, share_positive:+(hotL.filter(b => b.y > 0).length/hotL.length).toFixed(3), restShare_positive:restL.length ? +(restL.filter(b => b.y > 0).length/restL.length).toFixed(3) : null, pRandomCohort:+((1 + ge2)/(o.cohortDraws + 1)).toFixed(4) };
  }
  const sorted = both.slice().sort((a, b) => b.x - a.x), per = Math.ceil(sorted.length/o.deciles); out.deciles = [];
  for (let d = 0; d < o.deciles; d++) { const g = sorted.slice(d*per, (d + 1)*per); if (g.length) out.deciles.push({ decile:d + 1, n:g.length, meanScore1:+(g.reduce((a, b) => a + b.x, 0)/g.length).toFixed(2), pooledPeriod2Bps:+pooled(g).toFixed(2), sharePositive2:+(g.filter(b => b.y > 0).length/g.length).toFixed(3) }); }
  return out;
}

function study(prepared) {
  const { A, B, C } = blocksOf(prepared, PLAN), later = B.concat(C), h = Math.floor(A.length/2), res = { sessions:{ A:A.length, later:later.length, A1:h, A2:A.length - h } };
  const mA = markouts(A), mL = markouts(later), mA1 = markouts(A.slice(0, h)), mA2 = markouts(A.slice(h));
  res.runs = [];
  for (const [name, m1, m2] of [["A -> later (B + C)", mA, mL], ["A first half -> A second half", mA1, mA2]])
    for (const min2 of SPEC.min2List) for (const robust of [false, true]) res.runs.push(Object.assign({ name, min2, score:robust ? "median per trade" : "notional-weighted mean" }, persistence(m1, m2, SPEC.min1, min2, SPEC, robust)));
  return res;
}
function print(r) {
  const L = s => console.log(s);
  L("\n== exploratory: do hot wallets stay good?   sessions A " + r.sessions.A + " (halves " + r.sessions.A1 + " + " + r.sessions.A2 + "), later " + r.sessions.later);
  for (const x of r.runs) {
    L("\n-- " + x.name + " | period-2 minimum " + x.min2 + " taker trades | score: " + x.score);
    L("   eligible in period 1: " + x.eligible1 + " wallets, hot cohort " + x.nHot + "; with period-2 data: " + x.withPeriod2 + " (hot: " + x.hotWithPeriod2 + ")");
    if (x.short) { L("   too few wallets to test"); continue; }
    L("   rank correlation of the two scores: rho " + x.rho + ", permutation p " + x.p);
    if (x.hotLater) L("   hot cohort later: pooled " + x.hotLater.pooledBps + " bps against " + x.hotLater.restPooledBps + " for the rest; " + Math.round(100*x.hotLater.share_positive) + "% of hot wallets positive against " + Math.round(100*x.hotLater.restShare_positive) + "% of the rest; random cohorts of the same size do as well in " + x.hotLater.pRandomCohort + " of draws");
    L("   by period-1 decile (best first): " + x.deciles.map(d => d.pooledPeriod2Bps).join(", ") + " bps later  (n per decile " + x.deciles[0].n + ")");
  }
  L("\n   Exploratory, written after the registered result was seen; small sample. Score noise is large for 30 trades, so a weak persistence can hide.");
}

function selfTest() {
  const checks = [], add = (n, ok) => checks.push([n, !!ok]); const R = rng(9), g = () => Math.sqrt(-2*Math.log(R() + 1e-12))*Math.cos(2*Math.PI*R());
  // hand-made price path rising 1 bp a second: a buy has +10 bps after 10 s, a sell -10
  const hist = []; for (let i = 0; i <= 200; i++) hist.push([i*1000, 100000*(1 + i*1e-4)]);
  const mk = (taker, buy, n, t0) => Array.from({ length:n }, (_, i) => ({ t:(t0 + i)*1000, buy, taker, buyer:buy ? taker : "x", seller:buy ? "x" : taker, ntl:1000 }));
  const m = markouts([{ hist, trades:mk("b", true, 3, 10).concat(mk("s", false, 3, 20)) }]);
  add("markout: a buy into a rising price earns about +10 bps after 10 s, a sell about -10", Math.abs(m.get("b").s/m.get("b").w - 10) < 0.1 && Math.abs(m.get("s").s/m.get("s").w + 10) < 0.1 && m.get("b").n === 3);
  // wallets with a stable skill: period-1 and period-2 scores share a wallet effect
  const sk = Array.from({ length:400 }, () => g()), mkMap = (noise, seed) => { const RR = rng(seed), gg = () => Math.sqrt(-2*Math.log(RR() + 1e-12))*Math.cos(2*Math.PI*RR()), mm = new Map(); sk.forEach((s, i) => { const vs = Array.from({ length:40 }, () => 2*s + 6*gg()*noise); mm.set("w" + i, { s:vs.reduce((a, b) => a + b, 0)*1000, w:40000, n:40, vs }); }); return mm; };
  const real = persistence(mkMap(1, 1), mkMap(1, 2), 30, 30), nullp = persistence(mkMap(1, 1), (() => { const RR = rng(77), gg = () => Math.sqrt(-2*Math.log(RR() + 1e-12))*Math.cos(2*Math.PI*RR()), mm = new Map(); for (let i = 0; i < 400; i++) { const vs = Array.from({ length:40 }, () => 6*gg()); mm.set("w" + i, { s:vs.reduce((a, b) => a + b, 0)*1000, w:40000, n:40, vs }); } return mm; })(), 30, 30);
  add("persistence: a real wallet skill gives a clearly positive rank correlation and the hot cohort beats random cohorts", real.rho > 0.3 && real.p <= 0.01 && real.hotLater && real.hotLater.pRandomCohort <= 0.01 && real.hotLater.pooledBps > real.hotLater.restPooledBps);
  add("no skill: the correlation is near zero, the hot cohort is no better than random, the deciles are flat-ish", Math.abs(nullp.rho) < 0.15 && nullp.p > 0.01 && nullp.hotLater.pRandomCohort > 0.01);
  add("deciles: the best period-1 decile does better later than the worst when skill is real", real.deciles[0].pooledPeriod2Bps > real.deciles[9].pooledPeriod2Bps + 1);
  add("too few wallets says so", persistence(new Map(), new Map(), 30, 30).short === true);
  add("deterministic", JSON.stringify(persistence(mkMap(1, 1), mkMap(1, 2), 30, 30)) === JSON.stringify(real));
  let bad = 0; for (const [n, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + n); if (!ok) bad++; }
  if (bad) { console.log(JSON.stringify({ real, nullp }, null, 1)); process.exit(1); } console.log("\nall " + checks.length + " checks passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--selftest")) selfTest();
  else { const r = study(loadSessions([path.join(HERE, "sessions")])); if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 1)); else print(r); }
}
