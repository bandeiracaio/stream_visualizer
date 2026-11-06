// Offline pre-registered study of the Hyperliquid wallet-attributed tape in saved sessions. Not part of the app. The plan is .scratch/wallet-study/plan.md and is fixed BEFORE the first run on
// real sessions: every definition, threshold and decision rule below is in PLAN or in the code it names, and nothing is tuned after seeing results.
//   node analyze-wallets.mjs [DIR_OR_SESSION...] [--json]      (default: sessions/)      |      --plan      |      --selftest
// Sessions are ordered by time and cut into three blocks by recorded hours (PLAN.blockFractions): A = learn wallet classes (never tested), B = decide, C = confirm.
//   Classes from A only:  P "persistent" = wallets seen (either side of a trade) in at least PLAN.persistFrac of A's sessions;  H "hot" = the top PLAN.hotTopFrac of the wallets with at least
//   PLAN.hotMinTrades taker trades in A, ranked by their notional-weighted signed mid markout PLAN.hotMarkoutSec seconds after each taker trade (needs PLAN.hotMinWallets such wallets).
//   Unit of analysis: a non-overlapping window of PLAN.windowSec seconds of Hyperliquid trades (at least PLAN.minTradesWindow trades). Outcome: the Hyperliquid mid move over the NEXT PLAN.horizonSec
//   seconds in sigmas (the scoreboard's ruler: sigmaOf / forwardMove of src/js/scoreboard-core.js), signed for the directional family, absolute for the volatility family.
//   Test per feature and block: partial rank correlation with a circular-shift permutation p-value (the shift keeps the series' own autocorrelation); Holm correction across the 11 features in B;
//   verdict CONFIRMED only if B passes (Holm p <= alpha, |rho| >= minAbsRho) and C agrees in sign with p <= alpha and |rho| >= minAbsRho.  Descriptive and small-sample: it says where to look.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readInput, rng } from "./analyze-collectors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SB = vm.runInNewContext(fs.readFileSync(path.join(HERE, "src/js/scoreboard-core.js"), "utf8") + ";SCOREBOARD", {});
const { sigmaOf, forwardMove } = SB;

export const PLAN = {
  windowSec:300, horizonSec:300, blockFractions:[0.4, 0.3, 0.3], minTradesWindow:20, minWindowsBlock:100,
  persistFrac:0.5, hotMarkoutSec:10, hotMinTrades:30, hotMinWallets:50, hotTopFrac:0.1, blockPrintUsd:100000,
  alpha:0.05, minAbsRho:0.08, permutations:999, minShiftFrac:0.05, seed:20261105,
};

// V = volatility family (outcome |next move|, controls |own move| and log notional); D = directional family (outcome next signed move; controls own signed move, and for all but `flow` also `flow`).
export const FEATURES = [
  { id:"hhi",          fam:"V", text:"concentration of taker dollars (sum of squared shares), per window" },
  { id:"top1",         fam:"V", text:"share of taker dollars of the single biggest taker" },
  { id:"persistShare", fam:"V", text:"share of taker dollars from persistent wallets (class P)" },
  { id:"blockShare",   fam:"V", text:"share of dollars in trades of at least $100k" },
  { id:"nTakers",      fam:"V", text:"log of the number of distinct taker wallets" },
  { id:"flow",         fam:"D", text:"signed taker imbalance, all wallets (the anonymous baseline)" },
  { id:"flowP",        fam:"D", text:"signed taker flow of persistent wallets, over all taker dollars" },
  { id:"flowE",        fam:"D", text:"signed taker flow of the other (event) wallets, over all taker dollars" },
  { id:"flowH",        fam:"D", text:"signed taker flow of the hot cohort (class H), over all taker dollars" },
  { id:"breadthH",     fam:"D", text:"distinct hot buyers minus distinct hot sellers" },
  { id:"netP",         fam:"D", text:"net buying of persistent wallets over both sides of every trade, over all dollars" },
];

// ---------- prices and sessions
function priceAt(h, t) {      // newest point at or before t, within 2 s of it (the engine's and the scoreboard's rule)
  let lo = 0, hi = h.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r >= 0 && t - h[r][0] <= 2000 ? h[r][1] : null;
}
// one session -> the Hyperliquid mid once a second (from the recorded quotes), the Hyperliquid taker trades with both wallets, and sigma of that mid
export function prepSession(s) {
  const q = new Map(), trades = [];
  for (const r of s.inputs) {
    if (r[0] === "q" && r[1] === "hl") { const t = +r[2], bid = +r[3], ask = +r[4]; if (t > 0 && bid > 0 && ask >= bid) q.set(Math.floor(t/1000), (bid + ask)/2); }
    else if (r[0] === "t") {
      const x = r[1]; if (!x || x.v !== "hl" || !Array.isArray(x.users) || x.users.length !== 2 || !(x.px > 0) || !(x.ntl > 0) || !(x.t > 0) || (x.side !== "buy" && x.side !== "sell")) continue;
      const buy = x.side === "buy"; trades.push({ t:x.t, buy, buyer:x.users[0], seller:x.users[1], taker:buy ? x.users[0] : x.users[1], ntl:x.ntl });
    }
  }
  const hist = [...q.entries()].sort((a, b) => a[0] - b[0]).map(([sec, m]) => [sec*1000, m]);
  trades.sort((a, b) => a.t - b.t);
  return { file:s.file, t0:hist.length ? hist[0][0] : s.t0, hist, trades, sigma:hist.length >= 120 ? sigmaOf(hist) : null, hours:hist.length > 1 ? (hist[hist.length - 1][0] - hist[0][0])/3600000 : 0 };
}

// ---------- classes from block A
export function scoreWallets(A, plan = PLAN) {
  const presence = new Map(), mo = new Map();
  for (const p of A) {
    const seen = new Set();
    for (const x of p.trades) {
      seen.add(x.buyer); seen.add(x.seller);
      const m0 = priceAt(p.hist, x.t), m1 = priceAt(p.hist, x.t + plan.hotMarkoutSec*1000);
      if (m0 > 0 && m1 > 0) { const v = (m1/m0 - 1)*1e4*(x.buy ? 1 : -1); let o = mo.get(x.taker); if (!o) mo.set(x.taker, o = { s:0, w:0, n:0 }); o.s += v*x.ntl; o.w += x.ntl; o.n++; }
    }
    for (const w of seen) presence.set(w, (presence.get(w) || 0) + 1);
  }
  const need = Math.max(1, Math.ceil(plan.persistFrac*A.length));
  const P = new Set([...presence].filter(([, n]) => n >= need).map(([w]) => w));
  const elig = [...mo].filter(([, o]) => o.n >= plan.hotMinTrades).map(([w, o]) => ({ w, score:o.s/o.w, n:o.n })).sort((a, b) => b.score - a.score || (a.w < b.w ? -1 : 1));
  const H = new Set(elig.length >= plan.hotMinWallets ? elig.slice(0, Math.max(1, Math.floor(elig.length*plan.hotTopFrac))).map(x => x.w) : []);
  return { P, H, eligible:elig.length, sessions:A.length, wallets:presence.size, hotScores:elig.slice(0, Math.max(1, Math.floor(elig.length*plan.hotTopFrac))).map(x => +x.score.toFixed(2)) };
}

// ---------- windows and features
export function windowFeatures(seg, cls, plan = PLAN) {
  let tot = 0, buy = 0, sell = 0, bP = 0, sP = 0, bE = 0, sE = 0, bH = 0, sH = 0, block = 0, netP = 0; const tk = new Map(), hotB = new Set(), hotS = new Set();
  for (const x of seg) {
    tot += x.ntl; tk.set(x.taker, (tk.get(x.taker) || 0) + x.ntl); if (x.buy) buy += x.ntl; else sell += x.ntl;
    if (cls.P.has(x.taker)) { if (x.buy) bP += x.ntl; else sP += x.ntl; } else { if (x.buy) bE += x.ntl; else sE += x.ntl; }
    if (cls.H.has(x.taker)) { if (x.buy) { bH += x.ntl; hotB.add(x.taker); } else { sH += x.ntl; hotS.add(x.taker); } }
    if (x.ntl >= plan.blockPrintUsd) block += x.ntl;
    if (cls.P.has(x.buyer)) netP += x.ntl; if (cls.P.has(x.seller)) netP -= x.ntl;
  }
  let hhi = 0, top = 0; for (const v of tk.values()) { hhi += (v/tot)**2; if (v > top) top = v; }
  return { hhi, top1:top/tot, persistShare:(bP + sP)/tot, blockShare:block/tot, nTakers:Math.log(tk.size), flow:(buy - sell)/tot, flowP:(bP - sP)/tot, flowE:(bE - sE)/tot, flowH:(bH - sH)/tot, breadthH:hotB.size - hotS.size, netP:netP/tot, logNtl:Math.log(tot) };
}
export function windowsOf(p, cls, plan = PLAN) {
  const out = [], W = plan.windowSec*1000; if (!p.hist.length || !p.sigma) return out;
  const t0 = p.hist[0][0], tEnd = p.hist[p.hist.length - 1][0], tr = p.trades; let ti = 0;
  for (let ws = t0; ws + 2*W <= tEnd; ws += W) {
    while (ti < tr.length && tr[ti].t < ws) ti++;
    let tj = ti; while (tj < tr.length && tr[tj].t < ws + W) tj++;
    if (tj - ti < plan.minTradesWindow) continue;
    const prior = forwardMove(p.hist, ws, plan.windowSec, 1, p.sigma), fwd = forwardMove(p.hist, ws + W, plan.horizonSec, 1, p.sigma);
    if (prior == null || fwd == null) continue;
    out.push(Object.assign({ file:p.file, t:ws, prior, fwd }, windowFeatures(tr.slice(ti, tj), cls, plan)));
  }
  return out;
}

// ---------- statistics
function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j)/2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
function solve(A, b) {      // Gaussian elimination with partial pivoting for the small normal equations
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return new Array(n).fill(0); [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]/M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f*M[c][k]; }
  }
  return M.map((r, i) => r[n]/r[i]);
}
function residualize(y, Z) {      // y with the least-squares part explained by the columns of Z (and an intercept) removed
  const n = y.length, my = y.reduce((a, b) => a + b, 0)/n, yc = y.map(v => v - my);
  const Zc = Z.map(z => { const m = z.reduce((a, b) => a + b, 0)/n; return z.map(v => v - m); });
  const A = Zc.map(a => Zc.map(b => a.reduce((s, v, i) => s + v*b[i], 0))), b = Zc.map(z => z.reduce((s, v, i) => s + v*yc[i], 0)), beta = Zc.length ? solve(A, b) : [];
  return yc.map((v, i) => v - Zc.reduce((s, z, k) => s + beta[k]*z[i], 0));
}
function pearson(a, b) { let sa = 0, sb = 0, sab = 0; for (let i = 0; i < a.length; i++) { sa += a[i]*a[i]; sb += b[i]*b[i]; sab += a[i]*b[i]; } return sa > 1e-9 && sb > 1e-9 ? sab/Math.sqrt(sa*sb) : null; }
// partial rank correlation of x and y given the columns of Z, with a circular-shift permutation p-value (two-sided); null with too few samples or no variation
export function partialRank(x, y, Z, K, seed, minShiftFrac = PLAN.minShiftFrac) {
  const n = x.length; if (n < 30 || y.length !== n || Z.some(z => z.length !== n)) return null;
  const rz = Z.map(ranks), rx = ranks(x), ey = residualize(ranks(y), rz), rho = pearson(residualize(rx, rz), ey);
  if (rho == null) return null;
  const R = rng(seed), lo = Math.max(1, Math.ceil(minShiftFrac*n)); let ge = 0;
  for (let k = 0; k < K; k++) {
    const s = lo + Math.floor(R()*(n - 2*lo + 1)), r = pearson(residualize(rx.map((_, i) => rx[(i + s) % n]), rz), ey);
    if (r != null && Math.abs(r) >= Math.abs(rho) - 1e-12) ge++;
  }
  return { rho:+rho.toFixed(3), p:(1 + ge)/(K + 1), n };
}
export function holm(ps) {      // adjusted p-values in the original order (null stays null)
  const idx = ps.map((p, i) => [p, i]).filter(x => x[0] != null).sort((a, b) => a[0] - b[0]), m = idx.length, out = ps.map(() => null); let run = 0;
  idx.forEach(([p, i], j) => { run = Math.max(run, Math.min(1, (m - j)*p)); out[i] = run; });
  return out;
}

// ---------- the study
export function blocksOf(prepared, plan = PLAN) {      // by recorded hours, in time order; a session belongs wholly to the block it starts in
  const S = prepared.filter(p => p.hist.length && p.sigma).slice().sort((a, b) => a.t0 - b.t0), total = S.reduce((a, p) => a + p.hours, 0), cut1 = plan.blockFractions[0]*total, cut2 = (plan.blockFractions[0] + plan.blockFractions[1])*total;
  const A = [], B = [], C = []; let cum = 0;
  for (const p of S) { (cum < cut1 ? A : cum < cut2 ? B : C).push(p); cum += p.hours; }
  return { A, B, C, hours:total };
}
const pick = (rows, f) => rows.map(w => w[f]);
function testFeature(f, rows, plan, seed) {
  if (rows.length < plan.minWindowsBlock) return { n:rows.length, short:true };
  const x = pick(rows, f.id);
  const y = f.fam === "V" ? rows.map(w => Math.abs(w.fwd)) : pick(rows, "fwd");
  const Z = f.fam === "V" ? [rows.map(w => Math.abs(w.prior)), pick(rows, "logNtl")] : (f.id === "flow" ? [pick(rows, "prior")] : [pick(rows, "prior"), pick(rows, "flow")]);
  const r = partialRank(x, y, Z, plan.permutations, seed, plan.minShiftFrac);
  return r ? r : { n:rows.length, flat:true };
}
export function analyze(prepared, plan = PLAN) {
  const { A, B, C, hours } = blocksOf(prepared, plan), cls = scoreWallets(A, plan);
  const wB = [].concat(...B.map(p => windowsOf(p, cls, plan))), wC = [].concat(...C.map(p => windowsOf(p, cls, plan)));
  const res = FEATURES.map((f, i) => {
    const hotOff = (f.id === "flowH" || f.id === "breadthH") && !cls.H.size;
    return { f, B:hotOff ? { n:wB.length, noHot:true } : testFeature(f, wB, plan, plan.seed + i), C:hotOff ? { n:wC.length, noHot:true } : testFeature(f, wC, plan, plan.seed + 1000 + i) };
  });
  const hp = holm(res.map(r => r.B.p == null ? null : r.B.p));
  const rows = res.map((r, i) => {
    const b = r.B, c = r.C, pass = b.p != null && hp[i] <= plan.alpha && Math.abs(b.rho) >= plan.minAbsRho;
    const agree = pass && c.p != null && Math.sign(c.rho) === Math.sign(b.rho) && c.p <= plan.alpha && Math.abs(c.rho) >= plan.minAbsRho;
    const verdict = b.noHot ? "not enough data (no hot cohort)" : b.short || c.short ? "not enough data (under " + plan.minWindowsBlock + " windows in a block)" : b.flat || c.flat ? "not enough data (no variation)" : pass ? (agree ? "CONFIRMED" : "promising, not confirmed in C") : "nothing";
    return { id:r.f.id, fam:r.f.fam, text:r.f.text, rhoB:b.rho ?? null, pB:b.p ?? null, pHolmB:hp[i] == null ? null : +hp[i].toFixed(4), nB:b.n, rhoC:c.rho ?? null, pC:c.p ?? null, nC:c.n, verdict };
  });
  const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p*s.length))].toFixed(3); };
  const all = wB.concat(wC), describe = {};
  for (const id of ["hhi", "top1", "persistShare", "blockShare", "nTakers"]) { const v = pick(all, id); describe[id] = { p10:q(v, .1), median:q(v, .5), p90:q(v, .9) }; }
  return { plan, hours:+hours.toFixed(1), blocks:{ A:{ sessions:A.length, hours:+A.reduce((a, p) => a + p.hours, 0).toFixed(1) }, B:{ sessions:B.length, windows:wB.length }, C:{ sessions:C.length, windows:wC.length } },
    classes:{ persistent:cls.P.size, hot:cls.H.size, eligibleForHot:cls.eligible, walletsSeenInA:cls.wallets, hotScoresBps:cls.hotScores }, describe, rows };
}

// ---------- reading and printing
export function loadSessions(paths) {
  const files = [];
  for (const p of paths) { if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p).sort()) { if (/\.json(\.gz)?$/.test(f) && f.startsWith("session")) files.push(path.join(p, f)); } else files.push(p); }
  return files.map(f => { const s = readInput(f); if (s.kind !== "session") throw new Error(f + ": not a session file"); return prepSession(s); });
}
const fnum = x => x == null ? "   -  " : (x >= 0 ? " " : "") + x.toFixed(3);
const fp = x => x == null ? "  -  " : x < 0.001 ? "<.001" : x.toFixed(3);
function print(r) {
  const L = s => console.log(s);
  L("\n== wallet study on " + r.hours + " recorded hours (blocks by hours: A " + r.blocks.A.hours + " h / " + r.blocks.A.sessions + " sessions to learn classes, B decides, C confirms)");
  L("   windows: B " + r.blocks.B.windows + " (" + r.blocks.B.sessions + " sessions), C " + r.blocks.C.windows + " (" + r.blocks.C.sessions + " sessions); a block needs " + r.plan.minWindowsBlock);
  L("   classes from A: " + r.classes.persistent + " persistent wallets; hot cohort " + r.classes.hot + " of " + r.classes.eligibleForHot + " eligible (10-s markouts of the hot ones, bps: " + (r.classes.hotScoresBps.join(", ") || "-") + "); " + r.classes.walletsSeenInA + " wallets seen in A");
  L("   descriptive, windows of B and C:  " + Object.entries(r.describe).map(([k, v]) => k + " " + [v.p10, v.median, v.p90].join("/")).join("   ") + "   (p10/median/p90)");
  L("\n   feature        family   rho B    p B  Holm B   n B |  rho C    p C   n C | verdict");
  for (const x of r.rows) L("   " + x.id.padEnd(13) + "  " + x.fam + "      " + fnum(x.rhoB) + "  " + fp(x.pB) + "  " + fp(x.pHolmB) + "  " + String(x.nB).padStart(4) + " | " + fnum(x.rhoC) + "  " + fp(x.pC) + "  " + String(x.nC).padStart(4) + " | " + x.verdict);
  L("\n   V = outcome |next " + r.plan.horizonSec/60 + " min move| in sigmas, controls |own move| and log notional.  D = outcome signed next move, controls own move (and `flow` for all but `flow` itself).");
  L("   Descriptive and small-sample: CONFIRMED means B passed the Holm-corrected test and C agreed; it is a place to look, never a reason to keep or drop anything on its own.");
}

// ---------- self-test: a synthetic tape with a planted wallet signal, and the same tape without it
function synth(o) {
  const R = rng(o.seed), gauss = () => Math.sqrt(-2*Math.log(R() + 1e-12))*Math.cos(2*Math.PI*R());
  const nS = o.sessions, secs = o.minutes*60, W = 300, MM = Array.from({ length:30 }, (_, i) => "mm" + i), HOT = Array.from({ length:10 }, (_, i) => "hot" + i), out = [];
  for (let s = 0; s < nS; s++) {
    const t0 = 1.8e12 + s*7200000, nW = Math.floor(secs/W), g = Array.from({ length:nW + 2 }, () => gauss()), inc = new Float64Array(secs + 20), trades = [];
    for (let k = 0; k < nW; k++) for (let i = 0; i < 60; i++) {
      const u = R(), kind = u < 0.25 ? "hot" : u < 0.75 ? "retail" : "mm", sec = k*W + Math.floor(R()*W);
      const pBuy = kind === "hot" ? 1/(1 + Math.exp(-2*g[k])) : 0.5, buy = R() < pBuy;
      const taker = kind === "hot" ? HOT[Math.floor(R()*10)] : kind === "retail" ? "r" + Math.floor(R()*300) : MM[Math.floor(R()*30)];
      let maker = MM[Math.floor(R()*30)]; if (maker === taker) maker = MM[(MM.indexOf(maker) + 1) % 30];
      const ntl = Math.exp(8 + 1.2*gauss()) * (R() < 0.01 ? 40 : 1), sgn = buy ? 1 : -1, h = o.plant && kind === "hot" ? 1.0 : o.plant ? 0.02 : 0;
      for (let j = 1; j <= 10; j++) inc[sec + j] += sgn*h/10;
      trades.push({ sec, buy, taker, maker, ntl });
    }
    let lp = 0; const mid = new Float64Array(secs + 1);
    for (let t = 0; t <= secs; t++) { const k = Math.floor(t/W); lp += 0.8*gauss() + inc[t] + (o.plant && k >= 1 ? 0.05*g[k - 1] : 0); mid[t] = 100000*Math.exp(lp/1e4); }
    const inputs = [];
    for (let t = 0; t <= secs; t++) inputs.push(["q", "hl", t0 + t*1000, mid[t] - 0.5, mid[t] + 0.5]);
    for (const x of trades) inputs.push(["t", { t:t0 + x.sec*1000 + 500, v:"hl", side:x.buy ? "buy" : "sell", px:mid[x.sec], q:x.ntl/mid[x.sec], ntl:x.ntl, liq:false, users:x.buy ? [x.taker, x.maker] : [x.maker, x.taker] }]);
    out.push({ file:"syn" + String(s).padStart(3, "0"), t0, inputs });
  }
  return out;
}
function selfTest() {
  const plan = Object.assign({}, PLAN, { permutations:499, hotMinWallets:20, minWindowsBlock:80 }), checks = [], add = (name, ok) => checks.push([name, !!ok]);
  // pieces by hand
  const seg = [{ t:1, buy:true, buyer:"a", seller:"m", taker:"a", ntl:100 }, { t:2, buy:true, buyer:"b", seller:"m", taker:"b", ntl:100 }, { t:3, buy:false, buyer:"m", seller:"a", taker:"a", ntl:200 }, { t:4, buy:true, buyer:"c", seller:"m", taker:"c", ntl:200000 }];
  const cls = { P:new Set(["m"]), H:new Set(["a"]) }, wf = windowFeatures(seg, cls, PLAN), tot = 200400;
  add("concentration: shares and HHI of taker dollars", Math.abs(wf.top1 - 200000/tot) < 1e-9 && Math.abs(wf.hhi - ((300/tot)**2 + (100/tot)**2 + (200000/tot)**2)) < 1e-9);
  add("block-print share counts only trades of $100k or more", Math.abs(wf.blockShare - 200000/tot) < 1e-9);
  add("signed flow: all, persistent (the market maker is never the taker), event wallets", Math.abs(wf.flow - (100 + 100 - 200 + 200000)/tot) < 1e-9 && wf.flowP === 0 && Math.abs(wf.flowE - wf.flow) < 1e-9);
  add("hot cohort flow and breadth: wallet a bought 100 and sold 200 (one buyer, one seller)", Math.abs(wf.flowH - (100 - 200)/tot) < 1e-9 && wf.breadthH === 0);
  add("persistent net buying over both sides: m sold 100 + 100 + 200000 and bought 200", Math.abs(wf.netP - (-100 - 100 + 200 - 200000)/tot) < 1e-9);
  const hist = []; for (let i = 0; i <= 120; i++) hist.push([i*1000, 100000*(1 + i*1e-4)]);
  const sc = scoreWallets([{ hist, trades:Array.from({ length:40 }, (_, i) => ({ t:(10 + i)*1000, buy:true, buyer:"up", seller:"x", taker:"up", ntl:1000 })).concat(Array.from({ length:40 }, (_, i) => ({ t:(10 + i)*1000, buy:false, buyer:"y", seller:"dn", taker:"dn", ntl:1000 }))) }], Object.assign({}, PLAN, { hotMinWallets:2, hotTopFrac:0.5 }));
  add("hot cohort: a buyer into a rising price has the higher markout and is picked, a seller into it is not", sc.H.has("up") && !sc.H.has("dn") && sc.H.size === 1 && sc.hotScores[0] > 9.5 && sc.hotScores[0] < 10.5);
  const ses = (...others) => others.map(o => ({ hist, trades:[{ t:1000, buy:true, buyer:"p", seller:o, taker:"p", ntl:1 }] })), pc = scoreWallets(ses("q", "z", "z", "z"), PLAN);
  add("persistent: only wallets seen in at least half of the sessions (p in all four, z in three, q in one)", pc.P.has("p") && pc.P.has("z") && !pc.P.has("q"));
  // statistics
  const R = rng(5), g = () => Math.sqrt(-2*Math.log(R() + 1e-12))*Math.cos(2*Math.PI*R());
  const z = Array.from({ length:300 }, g), x = Array.from({ length:300 }, g), yOnlyZ = z.map((v, i) => v + 0.3*g()), yBoth = z.map((v, i) => v + 1.5*x[i] + 0.3*g());
  const t1 = partialRank(x, yOnlyZ, [z], 199, 1), t2 = partialRank(x, yBoth, [z], 199, 1), xz = x.map((v, i) => v + 2*z[i]), t3 = partialRank(xz, yOnlyZ, [z], 199, 1);
  add("partial rank correlation: nothing left of x once the control explains y; a real x effect survives", Math.abs(t1.rho) < 0.12 && t1.p > 0.05 && t2.rho > 0.5 && t2.p <= 0.01 && Math.abs(t3.rho) < 0.12);
  const t4 = partialRank(x, yBoth, [z, z.map(v => v*v)], 99, 1);
  add("two controls work and give the same answer to within a little", t4 && Math.abs(t4.rho - t2.rho) < 0.1);
  add("too few samples or a constant feature gives null", partialRank(x.slice(0, 20), yBoth.slice(0, 20), [z.slice(0, 20)], 9, 1) === null && partialRank(new Array(300).fill(1), yBoth, [z], 9, 1) === null);
  add("same seed, same p-value", partialRank(x, yBoth, [z], 99, 7).p === partialRank(x, yBoth, [z], 99, 7).p);
  const hp = holm([0.001, 0.02, null, 0.5, 0.04]);
  add("Holm: adjusted in order, monotone, null stays null", hp[2] === null && Math.abs(hp[0] - 0.004) < 1e-9 && Math.abs(hp[1] - 0.06) < 1e-9 && Math.abs(hp[4] - 0.08) < 1e-9 && hp[3] === 0.5);
  // the planted effect is found, and the same tape without it finds nothing
  const planted = analyze(synth({ seed:11, sessions:60, minutes:50, plant:true }).map(prepSession), plan), by = r => Object.fromEntries(r.rows.map(x => [x.id, x]));
  const P = by(planted);
  add("planted wallet signal: a hot cohort was found and its size-free breadth is CONFIRMED beyond the anonymous flow", planted.classes.hot >= 4 && planted.classes.hot <= 12 && P.breadthH.verdict === "CONFIRMED");
  add("planted: features that carry no planted signal (concentration, block prints, persistent and event flow, net persistent buying) are not CONFIRMED", ["hhi", "top1", "persistShare", "blockShare", "nTakers", "flowP", "flowE", "netP"].every(id => P[id].verdict !== "CONFIRMED"));
  add("planted: windows in each block, and a block count that matches the split", planted.blocks.B.windows >= 80 && planted.blocks.C.windows >= 80 && planted.blocks.A.sessions + planted.blocks.B.sessions + planted.blocks.C.sessions === 60);
  let falseHits = 0, ran = 0;
  for (const seed of [21, 22, 23, 24, 25]) { const r = analyze(synth({ seed, sessions:60, minutes:50, plant:false }).map(prepSession), plan); ran++; falseHits += r.rows.filter(x => x.verdict === "CONFIRMED").length; }
  add("no planted signal, five different tapes: nothing is CONFIRMED", ran === 5 && falseHits === 0);
  const a1 = JSON.stringify(analyze(synth({ seed:11, sessions:60, minutes:50, plant:true }).map(prepSession), plan).rows), a2 = JSON.stringify(planted.rows);
  add("the study is deterministic", a1 === a2);
  const few = analyze(synth({ seed:3, sessions:6, minutes:40, plant:true }).map(prepSession), plan);
  add("too little data says so instead of testing", few.rows.every(x => /not enough data/.test(x.verdict)));
  let bad = 0; for (const [name, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + name); if (!ok) bad++; }
  if (bad) { console.log(JSON.stringify({ planted:planted.rows.map(x => [x.id, x.rhoB, x.pHolmB, x.rhoC, x.pC, x.verdict]), classes:planted.classes, falseHits }, null, 1)); process.exit(1); }
  console.log("\nall " + checks.length + " checks passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), paths = args.filter(a => !a.startsWith("--"));
  if (args.includes("--selftest")) selfTest();
  else if (args.includes("--plan")) console.log(JSON.stringify({ PLAN, FEATURES }, null, 1));
  else {
    const r = analyze(loadSessions(paths.length ? paths : [path.join(HERE, "sessions")]));
    if (args.includes("--json")) console.log(JSON.stringify(r, null, 1)); else print(r);
  }
}
