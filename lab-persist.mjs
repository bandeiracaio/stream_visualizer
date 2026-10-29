// Analysis lab: is the bar-to-bar dependence we saw in the bars (flow imbalance of a bar vs the NEXT bar's return, rho 0.26) an artifact of cutting bursts into bars,
// or does order flow really persist in clock time? Offline, not part of the app. `node lab-persist.mjs --selftest` checks the pieces.
//
// The plan is fixed here before the data is looked at (and printed into the entry):
//   1. Cut each session's Binance trades into non-overlapping clock windows of W = 10 s. F = taker-flow imbalance of a window ((buy - sell) / (buy + sell), aggressor side).
//   2. R(delta) = return, in sigmas of sqrt(W) (causal sigma from the 30 minutes before, ADR 0004 scale), of the window that starts `delta` seconds after the flow window ends;
//      delta in {0, 10, 30, 60}. Spearman rank correlation of F and R over all sessions.
//   3. p-values: circular shift of R inside each session by a random offset (keeps the autocorrelation of both series), 999 shifts, two-sided, seed fixed; four deltas, so a
//      test counts as significant at p < 0.05 / 4. Sessions in time order; the first half of the windows is the DECIDING half, the second the CONFIRMING half.
//   4. Decision, fixed in advance. Slicing is supported if rho(delta = 10) is below 0.05 over all windows (the dependence is gone once a pause separates the windows).
//      Slicing is rejected (the flow really persists in clock time) if rho(delta = 10) is above 0.10 in BOTH halves and significant in the confirming half. Anything else is inconclusive.
//   5. The same permutation test is run on the bars' lag-1 pairs (flow imbalance of bar i vs return of bar i + 1, from lab-data/bars.json), and that dependence is split by the
//      duration of bar i + 1 in thirds (descriptive; bursts make short bars).
// Usage:  node lab-persist.mjs SESSION... [--bars lab-data/bars.json] [--entry docs/lab/lab_DATE_dependence.json] [--date YYYY-MM-DD]      |      --selftest
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spearman, rng, quantile } from "./lab-stats.mjs";
import { PARAMS, sigmaAt } from "./lab-bars.mjs";

export const PLAN = { W: 10, deltas: [0, 10, 30, 60], perms: 999, seed: 20261029, alpha: 0.05, rejectRho: 0.10, nullRho: 0.05, minPairs: 200 };

// one second per slot: taker flow, trade count, last price (carried over quiet seconds)
export function secondSeries(inputs, venue = "bn") {
  let s0 = null, last = null, lastIdx = -1; const buy = [], sell = [], n = [], px = [];
  for (const r of inputs) {
    if (r[0] !== "t") continue; const x = r[1]; if (!x || x.v !== venue || !(x.px > 0) || !(x.ntl > 0) || !Number.isFinite(x.t)) continue;
    if (s0 === null) s0 = Math.floor(x.t / 1000) * 1000;
    const idx = Math.max(lastIdx, Math.floor((x.t - s0) / 1000));            // a trade stamped a little late lands in the newest second
    for (let k = lastIdx + 1; k <= idx; k++) { buy[k] = 0; sell[k] = 0; n[k] = 0; px[k] = last; }
    lastIdx = Math.max(idx, lastIdx); if (x.side === "buy") buy[idx] += x.ntl; else sell[idx] += x.ntl; n[idx]++; px[idx] = x.px; last = x.px;
  }
  return { s0, buy, sell, n, px, len: lastIdx + 1 };
}

// F and R(delta) for each window of one session; NaN where a window has no trades or the price is not known yet. Windows start at second 0 and step W.
export function windows(sec, W, deltas, P = PARAMS) {
  const out = deltas.map(() => ({ F: [], R: [] })), nW = Math.floor(sec.len / W);
  const sum = (a, i, j) => { let s = 0; for (let k = i; k < j; k++) s += a[k]; return s; };
  for (let w = 0; w + 1 < nW; w++) {
    const i = w * W, j = i + W, b = sum(sec.buy, i, j), s = sum(sec.sell, i, j), cnt = sum(sec.n, i, j), F = cnt > 0 && b + s > 0 ? (b - s) / (b + s) : NaN;
    deltas.forEach((d, di) => {
      const a = j + d, e = a + W;                                            // forward window [a, e): its return runs from the price at the decision time (end of second a - 1) to the end of second e - 1
      let R = NaN;
      if (Number.isFinite(F) && e <= sec.len && sec.px[a - 1] > 0 && sec.px[e - 1] > 0 && sum(sec.n, a, e) > 0) {
        const sig = sigmaAt(sec.px, a - 1, P); R = 1e4 * Math.log(sec.px[e - 1] / sec.px[a - 1]) / (sig * Math.sqrt(W));
      }
      out[di].F.push(F); out[di].R.push(R);
    });
  }
  return out;
}

const pooled = (Fs, Rs) => { const f = [], r = []; for (let s = 0; s < Fs.length; s++) for (let k = 0; k < Fs[s].length; k++) { f.push(Fs[s][k]); r.push(Rs[s][k]); } return spearman(f, r); };
const pairCount = (Fs, Rs) => { let c = 0; for (let s = 0; s < Fs.length; s++) for (let k = 0; k < Fs[s].length; k++) if (Number.isFinite(Fs[s][k]) && Number.isFinite(Rs[s][k])) c++; return c; };
// observed pooled rho and its circular-shift p-value (two-sided): each session's R series is rotated by its own random offset
export function permTest(Fs, Rs, perms, seed) {
  const obs = pooled(Fs, Rs), pairs = pairCount(Fs, Rs); if (obs === null) return { rho: null, p: null, pairs };
  const rand = rng(seed); let ge = 0;
  for (let it = 0; it < perms; it++) {
    const sh = Rs.map(r => { const n = r.length, k = n ? Math.floor(rand() * n) : 0; return r.slice(k).concat(r.slice(0, k)); });
    const rho = pooled(Fs, sh); if (rho !== null && Math.abs(rho) >= Math.abs(obs) - 1e-12) ge++;
  }
  return { rho: obs, p: (1 + ge) / (1 + perms), pairs };
}
// the first sessions holding half of the windows form the deciding half, the rest the confirming half
export function halves(counts) { const total = counts.reduce((a, b) => a + b, 0); let acc = 0; return counts.map(c => { const first = acc < total / 2; acc += c; return first; }); }

// the decision rule of the plan
export function decide(profile, plan = PLAN) {
  const row = profile.find(r => r.delta === 10); if (!row || row.all.rho === null) return { verdict: "inconclusive", why: "no windows at delta 10 s" };
  const alpha = plan.alpha / plan.deltas.length;
  if (row.all.pairs >= plan.minPairs && row.all.rho < plan.nullRho) return { verdict: "confirmed", why: "slicing supported: rho at 10 s delay is " + row.all.rho.toFixed(3) + " (< " + plan.nullRho + ")" };
  if (row.dec.pairs >= plan.minPairs && row.con.pairs >= plan.minPairs && row.dec.rho > plan.rejectRho && row.con.rho > plan.rejectRho && row.con.p < alpha) return { verdict: "rejected", why: "slicing rejected: rho at 10 s delay is " + row.dec.rho.toFixed(3) + " (deciding) and " + row.con.rho.toFixed(3) + " (confirming, p " + row.con.p.toFixed(4) + ")" };
  return { verdict: "inconclusive", why: "rho at 10 s delay " + row.all.rho.toFixed(3) + " overall, " + (row.dec.rho === null ? "n/a" : row.dec.rho.toFixed(3)) + " deciding, " + (row.con.rho === null ? "n/a" : row.con.rho.toFixed(3)) + " confirming: between the two rules" };
}

function run(sessions, plan = PLAN) {
  const perSec = sessions.map(s => secondSeries(s.inputs)), wins = perSec.map(sec => windows(sec, plan.W, plan.deltas));
  const counts = wins.map(w => w[0].F.filter(Number.isFinite).length), dec = halves(counts);
  const profile = plan.deltas.map((delta, di) => {
    const F = wins.map(w => w[di].F), R = wins.map(w => w[di].R), pick = flag => [F.filter((_, s) => dec[s] === flag), R.filter((_, s) => dec[s] === flag)];
    const [fd, rd] = pick(true), [fc, rc] = pick(false);
    return { delta, all: permTest(F, R, plan.perms, plan.seed + di), dec: permTest(fd, rd, plan.perms, plan.seed + 100 + di), con: permTest(fc, rc, plan.perms, plan.seed + 200 + di) };
  });
  return { profile, windowsTotal: counts.reduce((a, b) => a + b, 0), decidingSessions: dec.filter(Boolean).length };
}

// the bars' lag-1 pairs, by session: flow imbalance of bar i and return (sigmas) of bar i + 1; NaN across a gap or a session edge
function barPairs(bars, nSessions) {
  const F = Array.from({ length: nSessions }, () => []), R = Array.from({ length: nSessions }, () => []), D = Array.from({ length: nSessions }, () => []);
  for (let i = 0; i < bars.length; i++) {
    const a = bars[i], b = bars[i + 1], ok = b && b.s === a.s && !b.gapBefore;
    F[a.s].push(ok && Number.isFinite(a.imb) ? a.imb : NaN); R[a.s].push(ok ? b.retSig : NaN); D[a.s].push(ok ? b.dur : NaN);
  }
  return { F, R, D };
}

function buildEntry(res, bars, date, files, plan = PLAN) {
  const d = decide(res.profile, plan), r3 = x => x == null ? null : Math.round(x * 1000) / 1000, pf = p => p == null ? null : p < 0.001 ? "<0.001" : String(Math.round(p * 1000) / 1000);
  const nS = Math.max(...bars.bars.map(b => b.s)) + 1, bp = barPairs(bars.bars, nS), bAll = permTest(bp.F, bp.R, plan.perms, plan.seed + 300);
  const durs = []; bp.D.forEach(a => a.forEach(x => { if (Number.isFinite(x)) durs.push(x); }));
  const t1 = quantile(durs, 1 / 3), t2 = quantile(durs, 2 / 3), third = (lo, hi) => { const fs = bp.F.map((f, s) => f.map((x, k) => bp.D[s][k] >= lo && bp.D[s][k] <= hi ? x : NaN)), rs = bp.R.map((r, s) => r.map((x, k) => bp.D[s][k] >= lo && bp.D[s][k] <= hi ? x : NaN)); return [pairCount(fs, rs), spearman(fs.flat(), rs.flat())]; };
  const strata = [["shortest third (next bar < " + t1.toFixed(1) + " s)", -Infinity, t1], ["middle third", t1 + 1e-9, t2], ["longest third (next bar > " + t2.toFixed(1) + " s)", t2 + 1e-9, Infinity]].map(([name, lo, hi]) => { const [n, rho] = third(lo, hi); return [name, n, r3(rho)]; });
  const note = d.why + ". The same pairs on the bars (lag 1) give rho " + r3(bAll.rho) + " (p " + pf(bAll.p) + "). ";
  return {
    kind: "sv-lab-entry", version: 1, id: "dependence-slicing-vs-persistence-" + date, title: "Is the bar-to-bar dependence slicing or real persistence of flow?", date, verdict: d.verdict, tags: ["bars", "flow", "persistence", "plan"],
    verdictNote: note + (d.verdict === "confirmed" ? "Reading: the dependence is " + r3(bAll.rho) + " between consecutive bars, only " + r3(res.profile[0].all.rho) + " between adjacent clock windows, and " + r3(res.profile[1].all.rho) + " once a 10 s pause separates them. So most of what the bars showed comes from cutting bursts into bars, with a small real same-direction carry-over between neighbouring windows that does not last 10 s. Bars are still fine as a unit for describing and clustering, but a bar's flow should not be read as a signal for the next bar." : d.verdict === "rejected" ? "Reading: order flow imbalance in one 10 s window is followed by a same-direction move in a later window, in both halves of the time range. The bar-level dependence is a real short-memory effect, not slicing. It says nothing about tradability (costs, spread and the size of the move are not considered)." : "Reading: the plan fixed in advance does not settle it. More data (more sessions and days) or a different window length would be needed; nothing should be built on this yet.") + " Sessions are one short run each on a few days, so the result is about those days only.",
    question: "The bars showed the next bar's return moving with this bar's flow imbalance (rho 0.26), which we had expected to be near zero. Is that an artifact of cutting continuous bursts into bars, or does the flow really persist in clock time?",
    data: { files, range: "same sessions as the bars entry", counts: { sessions: files.length, windows: res.windowsTotal, decidingHalfSessions: res.decidingSessions, bars: bars.bars.length } },
    method: {
      summary: "Binance trades cut into non-overlapping " + plan.W + " s clock windows (independent of bar boundaries). Flow imbalance of a window against the sigma-scaled return of a later window starting 0, 10, 30 or 60 s after it ends. Spearman rank correlation, circular-shift permutation p-values (" + plan.perms + " shifts per session, so the autocorrelation of both series is kept), deciding and confirming halves in time.",
      params: { windowSec: plan.W, deltasSec: plan.deltas, permutations: plan.perms, seed: plan.seed, sigma: "ADR 0004, previous 30 minutes", alphaPerTest: plan.alpha / plan.deltas.length },
      plan: ["Decision fixed in advance. Slicing supported if rho at a 10 s pause is below " + plan.nullRho + " over all windows.", "Slicing rejected if rho at a 10 s pause is above " + plan.rejectRho + " in both halves and significant (p < " + (plan.alpha / plan.deltas.length) + ") in the confirming half.", "Anything else is inconclusive. Four pauses were tested, so the per-test level is " + plan.alpha + " / " + plan.deltas.length + ".", "The bars' lag-1 pairs get the same permutation test, and are split by the duration of the next bar (descriptive)."],
      rerun: "node lab-persist.mjs session_*.json.gz --bars lab-data/bars.json --entry docs/lab/lab_" + date + "_dependence.json --date " + date
    },
    results: [
      { type: "text", text: "Associated with, not caused by: this is about how a window's flow relates to a later window's price move, in these sessions. The pairs of neighbouring windows overlap in what they describe, which is why p-values come from shifting the series, not from a formula." },
      { type: "table", title: "Flow imbalance of a 10 s window vs the return of a later 10 s window (Spearman rho, shift-test p)", columns: ["pause (s)", "pairs", "rho all", "p all", "rho deciding half", "p deciding", "rho confirming half", "p confirming"], rows: res.profile.map(r => [r.delta, r.all.pairs, r3(r.all.rho), pf(r.all.p), r3(r.dec.rho), pf(r.dec.p), r3(r.con.rho), pf(r.con.p)]) },
      { type: "bars", title: "Clock-time dependence by pause: rho over all windows", unit: "rho", items: res.profile.map(r => ({ label: r.delta + " s", value: r3(r.all.rho) == null ? 0 : r3(r.all.rho) })) },
      { type: "table", title: "The bars' lag-1 pairs", columns: ["pairs", "rho", "shift-test p"], rows: [[bAll.pairs, r3(bAll.rho), pf(bAll.p)]] },
      { type: "table", title: "The bars' lag-1 dependence by the duration of the next bar (descriptive: a bar's duration is only known after it closes, so this explains the dependence, it is not usable as a signal)", columns: ["group", "pairs", "rho"], rows: strata }
    ]
  };
}

// ---------- the self-test
export function selftest() {
  const bad = [], ok = (c, m) => { if (!c) bad.push(m); }, near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
  const T0 = 1_700_000_000_000, tr = (sec, side, px, ntl) => ["t", { t: T0 + sec * 1000 + 10, v: "bn", side, px, q: ntl / px, ntl }];
  // seconds: 0-9 buy-heavy (800 vs 200), 10-19 sell only, 20-29 quiet, 30-39 one buy
  const inp = []; for (let s = 0; s < 10; s++) { inp.push(tr(s, "buy", 100 + s * 0.1, 800)); inp.push(tr(s, "sell", 100 + s * 0.1, 200)); } for (let s = 10; s < 20; s++) inp.push(tr(s, "sell", 101, 500)); inp.push(tr(35, "buy", 102, 400));
  const sec = secondSeries(inp);
  ok(sec.len === 36 && sec.n[0] === 2 && sec.n[22] === 0 && sec.px[22] === 101 && near(sec.buy[3], 800) && sec.px[35] === 102, "second series: counts, carried price, flow");
  const w = windows(sec, 10, [0, 10]), flowOf = w[0].F;
  ok(flowOf.length === 2 && near(flowOf[0], 0.6) && near(flowOf[1], -1), "window flow imbalance (the last window has no successor and is not made): " + flowOf.join());
  // window 0 at delta 0 looks at seconds 10-19: price 101 at the end of second 9 (100.9) -> 101 at the end of second 19: a rise, in sigmas of the floor
  const expect = 1e4 * Math.log(101 / 100.9) / (PARAMS.sigmaFloor * Math.sqrt(10));
  ok(near(w[0].R[0], expect, 1e-6), "forward return in sigmas: got " + w[0].R[0] + " expected " + expect);
  // delta 10 for window 0 looks at seconds 20-29: no trades there, so no return (NaN); window 1 at delta 0 looks at seconds 20-29 as well
  ok(Number.isNaN(w[1].R[0]) && Number.isNaN(w[0].R[1]), "a forward window without trades gives no return");
  // permutation test: perfectly related series are significant, unrelated ones are not
  const g = rng(5), A = [], B = [], C = []; for (let s = 0; s < 4; s++) { const a = [], b = [], c = []; for (let k = 0; k < 120; k++) { const x = g() - 0.5; a.push(x); b.push(x * 2 + (g() - 0.5) * 0.01); c.push(g() - 0.5); } A.push(a); B.push(b); C.push(c); }
  const hi = permTest(A, B, 199, 1), lo = permTest(A, C, 199, 1);
  ok(hi.rho > 0.99 && hi.p <= 0.01 && hi.pairs === 480, "related series: rho " + hi.rho + " p " + hi.p);
  ok(Math.abs(lo.rho) < 0.2 && lo.p > 0.05, "unrelated series: rho " + lo.rho + " p " + lo.p);
  ok(permTest(A, B, 199, 1).p === hi.p, "the same seed gives the same p");
  ok(halves([10, 10, 10, 10]).join() === "true,true,false,false" && halves([30, 10, 10]).join() === "true,false,false", "halves by window count");
  const prof = (rho10, d, c, p) => [{ delta: 10, all: { rho: rho10, pairs: 1000, p: 0.5 }, dec: { rho: d, pairs: 500, p: 0.5 }, con: { rho: c, pairs: 500, p } }];
  ok(decide(prof(0.02, 0.0, 0.04, 0.5)).verdict === "confirmed" && decide(prof(0.2, 0.2, 0.18, 0.001)).verdict === "rejected" && decide(prof(0.2, 0.2, 0.18, 0.2)).verdict === "inconclusive" && decide(prof(0.08, 0.2, 0.01, 0.001)).verdict === "inconclusive", "decision rule");
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), val = (n, d) => args.includes(n) ? args[args.indexOf(n) + 1] : d;
  if (args.includes("--selftest")) { const bad = selftest(); if (bad.length) { console.error("FAIL:\n  " + bad.join("\n  ")); process.exit(1); } console.log("lab-persist selftest: ok"); process.exit(0); }
  const files = []; for (let i = 0; i < args.length; i++) { if (args[i].startsWith("--")) { i++; continue; } files.push(args[i]); }
  if (!files.length) { console.error("usage: node lab-persist.mjs SESSION... [--bars lab-data/bars.json] [--entry FILE] [--date YYYY-MM-DD]   |   --selftest"); process.exit(1); }
  const { readInput } = await import("./analyze-collectors.mjs");
  const bars = JSON.parse(fs.readFileSync(val("--bars", "lab-data/bars.json"), "utf8")), want = new Set(bars.files);
  const sessions = files.map(readInput).filter(s => s.kind === "session" && want.has(path.basename(s.file))).sort((a, b) => a.t0 - b.t0);   // the same sessions, in the same order, as the bars
  if (sessions.length !== bars.files.length) console.error("warning: " + sessions.length + " of the bars' " + bars.files.length + " sessions found");
  const res = run(sessions);
  console.log(sessions.length + " sessions, " + res.windowsTotal + " windows");
  for (const r of res.profile) console.log("pause " + String(r.delta).padStart(2) + " s  pairs " + r.all.pairs + "  rho " + (r.all.rho === null ? "n/a" : r.all.rho.toFixed(3)) + " p " + r.all.p + "   deciding " + (r.dec.rho === null ? "n/a" : r.dec.rho.toFixed(3)) + "   confirming " + (r.con.rho === null ? "n/a" : r.con.rho.toFixed(3)) + " p " + r.con.p);
  console.log("decision: " + JSON.stringify(decide(res.profile)));
  const entry = val("--entry", null);
  if (entry) {
    const date = val("--date", new Date().toISOString().slice(0, 10)), e = buildEntry(res, bars, date, sessions.map(s => path.basename(s.file)));
    fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, JSON.stringify(e, null, 1) + "\n"); console.log("wrote " + entry);
  }
}
