// Offline, EXPLORATORY and DESCRIPTIVE cross-venue lead-lag study. Plan and caveats: .scratch/venue-leadlag/plan.md (an amendment goes there). Not part of the app; says where to look, never keep / drop.
//   node analyze-venue-leadlag.mjs [DIR|FILE...] [--limit N] [--out per-session.json] [--json]   one session file at a time (read, reduce to 1 s grids, drop)
//   node analyze-venue-leadlag.mjs --plan | --selftest
// A: lead-lag. Reference = Binance perp mid. For venue V and scale s (1, 5, 30 s) non-overlapping log returns; c(k) = corr(r_V[i], r_B[i+k]); lead index A = c(+1) - c(-1)
//    (positive: V moved first, negative: Binance moved first). Per session, all blocks and volatile / calm thirds (trailing 300 s |Binance move|). Spread across sessions, sign-flip test, session bootstrap.
// B: gap. Deviation of 1e4*ln(V/Binance) from its own trailing 600 s mean, on a 10 s grid, against the Binance perp's next 60 s / 300 s move in sigmas (scoreboard-core: sigmaOf, forwardMove),
//    partial rank correlation controlling for the previous 60 s Binance move. Per session, then spread, sign-flip test and bootstrap across sessions.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readInput, rng } from "./analyze-collectors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SB = vm.runInNewContext(fs.readFileSync(path.join(HERE, "src/js/scoreboard-core.js"), "utf8") + ";SCOREBOARD", {});
const { sigmaOf, forwardMove } = SB;

export const PLAN = {
  useAge:true, scales:[1, 5, 30], lagsBlocks:3, minBlocks:100, minGridSec:1200, maxFillSec:4, volWinSec:300,
  gapStepSec:10, gapWinSec:600, gapMinPts:60, horizons:[60, 300], prevSec:60,
  permutations:9999, bootstrap:2000, seed:20261108, minSessions:8,
};
// venue key -> how to read a mid from a `venues` record (hl and the reference bn come from the `q` inputs)
export const VENUES = [
  { id:"hl",  label:"Hyperliquid perp", from:"q" },
  { id:"cb",  label:"Coinbase spot",    from:"venues", key:"cb" },
  { id:"bnS", label:"Binance spot",     from:"venues", key:"bnS" },
  { id:"okS", label:"OKX spot",         from:"venues", key:"okS" },
  { id:"okP", label:"OKX perp",         from:"venues", key:"okP" },
  { id:"byL", label:"Bybit perp",       from:"venues", key:"byL" },
  { id:"byS", label:"Bybit spot (last)", from:"venues", key:"byS" },
  { id:"plc", label:"PLACEBO bn perp sampled like venues", from:"placebo" },      // the reference itself, read at each venues record: what the 2 s snapshots alone do to the lead index
];
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m])/2; };
const quant = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p*(s.length - 1))))]; };
const r3 = x => x == null || !Number.isFinite(x) ? null : +x.toFixed(3);

// ---------- one session -> 1 s grids (index i = second t0 + i; NaN = no value)
function midOf(x) { if (!x) return NaN; const b = +x.b, a = +x.a; if (b > 0 && a >= b) return (b + a)/2; const l = +x.l; return l > 0 ? l : NaN; }
function fill(map, t0, n, maxFill) {
  const g = new Float64Array(n).fill(NaN); let last = NaN, lastI = -1e9;
  for (let i = 0; i < n; i++) { const v = map.get(t0 + i); if (v != null) { last = v; lastI = i; } if (i - lastI <= maxFill) g[i] = last; }
  return g;
}
export function gridsOfSession(s, plan = PLAN) {
  const bn = new Map(), hl = new Map(), ven = {}, plc = new Map(); for (const v of VENUES) if (v.from === "venues") ven[v.id] = new Map();
  for (const r of s.inputs) if (r[0] === "q" && (r[1] === "bn" || r[1] === "hl")) { const t = +r[2], b = +r[3], a = +r[4]; if (t > 0 && b > 0 && a >= b) (r[1] === "bn" ? bn : hl).set(Math.floor(t/1000), (b + a)/2); }
  let hasVenues = false; const recSecs = [];
  for (const r of s.records || []) if (r[1] === "venues" && r[3]) { const sec = Math.floor(+r[2]/1000), o = r[3]; for (const v of VENUES) if (v.from === "venues") { const m = midOf(o[v.key]); if (m > 0) { const age = plan.useAge && Number.isFinite(+o[v.key].age) && +o[v.key].age >= 0 && +o[v.key].age < 30000 ? +o[v.key].age : 0; ven[v.id].set(Math.floor((+r[2] - age)/1000), m); hasVenues = true; } } recSecs.push(sec); }
  for (const sec of recSecs) { let k = sec; while (k > sec - 3 && !bn.has(k)) k--; if (bn.has(k)) plc.set(sec, bn.get(k)); }
  if (!bn.size) return null;
  const secs = [...bn.keys()], lo = (() => { let m = Infinity, M = -Infinity; for (const x of secs) { if (x < m) m = x; if (x > M) M = x; } return [m, M]; })();
  const T0 = lo[0], n = lo[1] - lo[0] + 1; if (n < plan.minGridSec) return null;
  const out = { file:s.file, t0:T0*1000, n, hasVenues, ref:fill(bn, T0, n, plan.maxFillSec), series:{}, refObs:[...bn.entries()].sort((a, b) => a[0] - b[0]).map(([sec, m]) => [sec*1000, m]) };
  out.series.hl = fill(hl, T0, n, plan.maxFillSec);
  if (hasVenues) { for (const v of VENUES) if (v.from === "venues") out.series[v.id] = fill(ven[v.id], T0, n, plan.maxFillSec); out.series.plc = fill(plc, T0, n, plan.maxFillSec); }
  return out;
}

// ---------- A: lead-lag
const corr = (xs, ys) => { const n = xs.length; if (n < 20) return null; let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; } const mx = sx/n, my = sy/n; let c = 0, vx = 0, vy = 0; for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; c += a*b; vx += a*a; vy += b*b; } return vx > 0 && vy > 0 ? c/Math.sqrt(vx*vy) : null; };
// log returns over blocks of s points, plus each block's start index
function blockReturns(p, s) { const r = [], at = []; for (let j = 0; j + s < p.length; j += s) { const a = p[j], b = p[j + s]; r.push(a > 0 && b > 0 ? Math.log(b/a) : NaN); at.push(j); } return { r, at }; }
// label per block of the reference: trailing volWinSec |move| tercile ("vol" top third, "calm" bottom third, null otherwise); null when the history is too short
export function regimeLabels(ref, at, volWin) {
  const mv = at.map(j => { if (j < volWin) return NaN; const a = ref[j - volWin], b = ref[j]; return a > 0 && b > 0 ? Math.abs(Math.log(b/a)) : NaN; });
  const ok = mv.filter(Number.isFinite); if (ok.length < 30) return at.map(() => null);
  const lo = quant(ok, 1/3), hi = quant(ok, 2/3);
  return mv.map(x => !Number.isFinite(x) ? null : x >= hi ? "vol" : x <= lo ? "calm" : null);
}
export function leadLag(pV, pB, s, regime, labels, plan = PLAN) {
  const V = blockReturns(pV, s), B = blockReturns(pB, s), nb = Math.min(V.r.length, B.r.length), K = plan.lagsBlocks;
  const c = {}; let used = 0;
  for (let k = -K; k <= K; k++) {
    const xs = [], ys = [];
    for (let i = Math.max(0, -k); i < nb && i + k < nb; i++) {
      if (regime && (labels[i] !== regime || labels[i + k] !== regime)) continue;
      const a = V.r[i], b = B.r[i + k]; if (Number.isFinite(a) && Number.isFinite(b)) { xs.push(a); ys.push(b); }
    }
    c[k] = xs.length >= plan.minBlocks ? corr(xs, ys) : null; if (k === 0) used = xs.length;
  }
  if (c[1] == null || c[-1] == null) return null;
  let peak = null, best = -Infinity; for (let k = -K; k <= K; k++) if (c[k] != null && c[k] > best) { best = c[k]; peak = k; }
  return { n:used, c0:c[0], cPlus:c[1], cMinus:c[-1], A:c[1] - c[-1], peak };
}
export function sessionLead(g, plan = PLAN) {
  const out = {};
  for (const [id, pV] of Object.entries(g.series)) {
    out[id] = {};
    for (const s of plan.scales) {
      const B = blockReturns(g.ref, s), labels = regimeLabels(g.ref, B.at, plan.volWinSec);
      out[id][s] = { all:leadLag(pV, g.ref, s, null, labels, plan), vol:leadLag(pV, g.ref, s, "vol", labels, plan), calm:leadLag(pV, g.ref, s, "calm", labels, plan) };
    }
  }
  return out;
}

// ---------- B: gap predicts the next Binance move
const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const m = (i + j)/2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = m; i = j + 1; } return r; };
function resid(y, z) { const n = y.length, my = y.reduce((p, q) => p + q, 0)/n, mz = z.reduce((p, q) => p + q, 0)/n; let c = 0, v = 0; for (let i = 0; i < n; i++) { c += (y[i] - my)*(z[i] - mz); v += (z[i] - mz)**2; } const b = v ? c/v : 0; return y.map((q, i) => q - my - b*(z[i] - mz)); }
export function partialSpearman(x, y, z) { if (x.length < 20) return null; const rx = rank(x), ry = rank(y), rz = rank(z); return corr(resid(rx, rz), resid(ry, rz)); }
export function sessionGap(g, plan = PLAN) {
  const hist = g.refObs, sig = hist.length >= 600 ? sigmaOf(hist) : null, out = {}; if (!sig) return out;
  for (const [id, pV] of Object.entries(g.series)) {
    const gap = new Float64Array(g.n); for (let i = 0; i < g.n; i++) gap[i] = pV[i] > 0 && g.ref[i] > 0 ? 1e4*Math.log(pV[i]/g.ref[i]) : NaN;
    const dev = [], prev = [], fwd = Object.fromEntries(plan.horizons.map(H => [H, []])), rows = Object.fromEntries(plan.horizons.map(H => [H, { x:[], y:[], z:[] }]));
    for (let i = plan.gapWinSec; i + Math.max(...plan.horizons) < g.n; i += plan.gapStepSec) {
      if (!Number.isFinite(gap[i])) continue;
      let sum = 0, cnt = 0; for (let j = i - plan.gapWinSec; j < i; j++) if (Number.isFinite(gap[j])) { sum += gap[j]; cnt++; }
      if (cnt < plan.gapWinSec/2) continue;
      const d = gap[i] - sum/cnt, t = g.t0 + i*1000, p = forwardMove(hist, t - plan.prevSec*1000, plan.prevSec, 1, sig); if (p == null) continue;
      for (const H of plan.horizons) { const f = forwardMove(hist, t, H, 1, sig); if (f != null) { rows[H].x.push(d); rows[H].y.push(f); rows[H].z.push(p); } }
    }
    out[id] = {}; for (const H of plan.horizons) out[id][H] = rows[H].x.length >= plan.gapMinPts ? { n:rows[H].x.length, rho:partialSpearman(rows[H].x, rows[H].y, rows[H].z), raw:corr(rank(rows[H].x), rank(rows[H].y)) } : null;
  }
  return out;
}

// ---------- across sessions
export function signFlipP(vals, perms, rand) { // two-sided, flipping the sign of whole sessions; statistic = |median|
  const obs = Math.abs(median(vals)); let ge = 0;
  for (let b = 0; b < perms; b++) { const f = vals.map(v => rand() < 0.5 ? -v : v); if (Math.abs(median(f)) >= obs - 1e-12) ge++; }
  return (ge + 1)/(perms + 1);
}
export function bootCI(vals, B, rand) { const m = []; for (let b = 0; b < B; b++) { const d = []; for (let i = 0; i < vals.length; i++) d.push(vals[Math.floor(rand()*vals.length)]); m.push(median(d)); } return [quant(m, 0.025), quant(m, 0.975)]; }
export function summarize(vals, plan = PLAN) {
  const v = vals.filter(x => x != null && Number.isFinite(x)); if (v.length < plan.minSessions) return { n:v.length };
  const rand = rng(plan.seed);
  return { n:v.length, median:r3(median(v)), q25:r3(quant(v, 0.25)), q75:r3(quant(v, 0.75)), pos:r3(v.filter(x => x > 0).length/v.length), p:+signFlipP(v, plan.permutations, rand).toFixed(4), ci:bootCI(v, plan.bootstrap, rand).map(r3) };
}
export function aggregate(per, plan = PLAN) {
  const lead = {}, gap = {};
  for (const v of VENUES) {
    lead[v.id] = {};
    for (const s of plan.scales) { lead[v.id][s] = {}; for (const reg of ["all", "vol", "calm"]) { const A = per.map(p => p.lead[v.id] && p.lead[v.id][s] && p.lead[v.id][s][reg] ? p.lead[v.id][s][reg].A : null); lead[v.id][s][reg] = summarize(A, plan); } }
    gap[v.id] = {}; for (const H of plan.horizons) gap[v.id][H] = summarize(per.map(p => p.gap[v.id] && p.gap[v.id][H] ? p.gap[v.id][H].rho : null), plan);
  }
  return { lead, gap };
}

// ---------- report
function report(agg, per, plan = PLAN) {
  const L = [];
  L.push(`sessions analysed: ${per.length} (${per.filter(p => p.hasVenues).length} with the venues collector); grid hours: ${(per.reduce((a, p) => a + p.n, 0)/3600).toFixed(1)}`);
  L.push("", "A. LEAD INDEX  A = c(+1) - c(-1) of block returns, venue vs Binance perp. A > 0: venue moves first. Per session, then across sessions: median [q25, q75], share of sessions > 0, sign-flip p, bootstrap 95% CI of the median (n = sessions).");
  const cell = c => !c || c.median == null ? "n=" + (c ? c.n : 0) : `${c.median >= 0 ? "+" : ""}${c.median} [${c.q25},${c.q75}] pos ${c.pos} p ${c.p} CI(${c.ci[0]},${c.ci[1]}) n=${c.n}`;
  for (const reg of ["all", "vol", "calm"]) { L.push("", `-- regime: ${reg}`); for (const v of VENUES) for (const s of plan.scales) L.push(`${v.label.padEnd(18)} ${String(s).padStart(2)} s  ${cell(agg.lead[v.id][s][reg])}`); }
  L.push("", "B. GAP -> next Binance move, partial Spearman (controls: previous 60 s Binance move), per session then across sessions. 14 estimates: Bonferroni line p < 0.0036.");
  for (const v of VENUES) for (const H of plan.horizons) L.push(`${v.label.padEnd(18)} H ${String(H).padStart(3)} s  ${cell(agg.gap[v.id][H])}`);
  return L.join("\n");
}

// ---------- selftest
export function selfTest() {
  let fail = 0; const ok = (name, c, d) => { console.log((c ? "  pass  " : "  FAIL  ") + name + (d ? "  (" + d + ")" : "")); if (!c) fail++; };
  const rand = rng(7), gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += rand(); return s - 6; };
  const N = 8000, B = new Float64Array(N); B[0] = 76000; for (let i = 1; i < N; i++) B[i] = B[i - 1] + 1.5*gauss();
  const shift = (a, d) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[Math.min(a.length - 1, Math.max(0, i - d))] + 0.05*gauss(); return o; };
  const Vlag = shift(B, 5), Vlead = shift(B, -5), Vind = new Float64Array(N); Vind[0] = 76000; for (let i = 1; i < N; i++) Vind[i] = Vind[i - 1] + 1.5*gauss();
  const a1 = leadLag(Vlag, B, 5, null, [], PLAN), a2 = leadLag(Vlead, B, 5, null, [], PLAN), a3 = leadLag(Vind, B, 5, null, [], PLAN);
  ok("a venue that copies Binance 5 s late has A near -1 at the 5 s scale (Binance first)", a1 && a1.A < -0.8, a1 && a1.A.toFixed(2));
  ok("a venue 5 s ahead of Binance has A near +1", a2 && a2.A > 0.8, a2 && a2.A.toFixed(2));
  ok("an independent venue has A near 0", a3 && Math.abs(a3.A) < 0.1, a3 && a3.A.toFixed(2));
  ok("the peak lag is where the copy was put", a1.peak === -1 && a2.peak === 1, `${a1.peak}, ${a2.peak}`);
  const labels = regimeLabels(B, blockReturns(B, 5).at, 300); ok("regime labels give top and bottom thirds", labels.filter(x => x === "vol").length > 100 && labels.filter(x => x === "calm").length > 100, `${labels.filter(x => x === "vol").length}/${labels.filter(x => x === "calm").length}`);
  // gap: Binance chases a random-walk venue, so the venue's deviation predicts Binance's next move; the control (previous move) must not remove it
  const V = new Float64Array(N), C = new Float64Array(N); V[0] = C[0] = 76000; for (let i = 1; i < N; i++) { V[i] = V[i - 1] + 1.5*gauss(); C[i] = C[i - 1] + 0.02*(V[i - 1] - C[i - 1]) + 0.3*gauss(); }
  const refObs = []; for (let i = 0; i < N; i++) refObs.push([1e12 + i*1000, C[i]]);
  const g = { file:"synthetic", t0:1e12, n:N, ref:C, refObs, series:{ v:V, ind:Vind }, hasVenues:true };
  const gp = sessionGap(g, PLAN);
  ok("a venue Binance follows has a positive partial rank correlation with Binance's next 60 s move", gp.v && gp.v[60] && gp.v[60].rho > 0.15, gp.v && gp.v[60] && gp.v[60].rho.toFixed(2));
  const indRho = []; for (let k = 0; k < 9; k++) { const W = new Float64Array(N); W[0] = 76000; for (let i = 1; i < N; i++) W[i] = W[i - 1] + 1.5*gauss(); const q = sessionGap({ ...g, series:{ w:W } }, PLAN); if (q.w && q.w[60]) indRho.push(q.w[60].rho); }
  ok("unrelated venues have a median partial rank correlation near 0 (one short random walk can wander: judged over 9)", Math.abs(median(indRho)) < 0.1, "median " + median(indRho).toFixed(2) + " of " + indRho.length);
  const rr = rng(3), sm = summarize(Array.from({ length:40 }, () => 0.3 + 0.1*(rr() - 0.5)), PLAN);
  ok("sign-flip across sessions: 40 sessions all near +0.3 is significant, and the interval excludes 0", sm.p < 0.01 && sm.ci[0] > 0, `p ${sm.p}, CI ${sm.ci}`);
  const sm0 = summarize(Array.from({ length:40 }, () => (rr() - 0.5)*0.4), PLAN); ok("sign-flip across sessions: noise around 0 is not", sm0.p > 0.05 && sm0.ci[0] < 0 && sm0.ci[1] > 0, `p ${sm0.p}, CI ${sm0.ci}`);
  ok("snapshot venues forward-fill at most maxFillSec", (() => { const m = new Map([[100, 5]]); const f = fill(m, 100, 10, 4); return f[0] === 5 && f[4] === 5 && Number.isNaN(f[5]); })());
  console.log(fail ? fail + " FAILED" : "all passed"); process.exit(fail ? 1 : 0);
}

// ---------- main
function listFiles(paths) {
  const files = [];
  for (const p of paths) { if (fs.statSync(p).isDirectory()) { for (const f of fs.readdirSync(p).sort()) if (/^session.*\.json(\.gz)?$/.test(f)) files.push(path.join(p, f)); } else files.push(p); }
  return files;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  if (args.includes("--selftest")) selfTest();
  else if (args.includes("--plan")) console.log(JSON.stringify({ PLAN, VENUES, doc:".scratch/venue-leadlag/plan.md" }, null, 2));
  else {
    const skip = new Set([val("--limit"), val("--out")].filter(Boolean)), paths = args.filter(a => !a.startsWith("--") && !skip.has(a));
    let files = listFiles(paths.length ? paths : [path.join(HERE, "sessions")]); const lim = val("--limit"); if (lim) files = files.slice(-Math.max(1, +lim));
    const per = [];
    files.forEach((f, i) => {
      try {
        const s = readInput(f); if (s.kind !== "session") return;
        const g = gridsOfSession(s); s.inputs = null; s.records = null; if (!g) { console.error(`${i + 1}/${files.length} ${path.basename(f)} skipped (no usable grid)`); return; }
        per.push({ file:path.basename(f), t0:g.t0, n:g.n, hasVenues:g.hasVenues, lead:sessionLead(g), gap:sessionGap(g) });
        console.error(`${i + 1}/${files.length} ${path.basename(f)} ${(g.n/60).toFixed(0)} min${g.hasVenues ? "" : " (no venues)"}`);
      } catch (e) { console.error(path.basename(f) + ": " + e.message); }
    });
    const out = val("--out"); if (out) fs.writeFileSync(out, JSON.stringify(per));
    const agg = aggregate(per);
    console.log(args.includes("--json") ? JSON.stringify({ PLAN, sessions:per.length, agg }, null, 1) : report(agg, per));
  }
}
