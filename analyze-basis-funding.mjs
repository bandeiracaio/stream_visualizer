// Basis, funding and open-interest pressure: exploratory, descriptive. Plan: .scratch/basis-funding-oi/plan.md (written before the first run on real sessions).
// Usage:  node analyze-basis-funding.mjs [DIR] [--json]      |      --plan      |      --selftest
// Reads saved sessions ONE FILE AT A TIME and keeps only a compact table of 10 s rows per session (the whole folder does not fit in memory at once).
// Says where to look; never keeps or drops anything, never changes a detection. Part (b) uses only sessions before the liquidation study cutoff.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const SB = vm.runInNewContext(fs.readFileSync(path.join(root, "src/js/scoreboard-core.js"), "utf8") + "\n;SCOREBOARD", {});

export const PLAN = {
  stepSec:10, prevSec:300, horizonsSec:[300, 900], effDiv:30, permutations:1999, seed:20261108, minSessionRows:150, minRows:300,
  stale:{ default:60000, fundPred:180000, ratios:300000 }, cutoffIso:"2026-11-06T03:15:00Z", alpha:0.05,
};
export const FEATURES = ["basisBps", "basisChg5", "fundBn", "fundSprBnHl", "fundSprBnBy", "oiChgBn5", "oiChgHl5", "oiChgBy5", "oiChgOk5", "lsAcct", "lsTop", "lsTaker"];
const OI_FEATS = ["oiChgBn5", "oiChgHl5", "oiChgBy5", "oiChgOk5"];
const LATE_ONLY = ["oiChgBy5", "oiChgOk5"];      // oiPerp exists from v122 (about 2026-11-06 05:00) on

// ---------- statistics (same method as analyze-collectors.mjs: partial rank correlation, circular-shift permutation; copied so this script stands alone)
function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j)/2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
export function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0)/4294967296); }
function residual(a, z) {
  const n = a.length, ma = a.reduce((p, q) => p + q, 0)/n, mz = z.reduce((p, q) => p + q, 0)/n; let cov = 0, vz = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma)*(z[i] - mz); vz += (z[i] - mz)**2; }
  const b = vz ? cov/vz : 0; return a.map((v, i) => v - ma - b*(z[i] - mz));
}
// rho of x and y given z; K shifts for the p-value (K = 0: rho only). null when too few samples or no variation.
export function partialTest(x, y, z, K, seed) {
  const n = x.length; if (n < 30 || y.length !== n || z.length !== n) return null;
  const rz = ranks(z), ex = residual(ranks(x), rz), ey = residual(ranks(y), rz);
  let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += ex[i]**2; syy += ey[i]**2; sxy += ex[i]*ey[i]; }
  if (!(sxx > 1e-9) || !(syy > 1e-9)) return null;
  const den = Math.sqrt(sxx*syy), rho = sxy/den; if (!K) return { rho:+rho.toFixed(3), p:null, n };
  const rand = rng(seed), lo = Math.ceil(n*0.05), hi = Math.floor(n*0.95); let ge = 0;
  for (let k = 0; k < K; k++) { const s = lo + Math.floor(rand()*(hi - lo + 1)); let acc = 0; for (let i = 0; i < n; i++) acc += ex[i]*ey[(i + s) % n]; if (Math.abs(acc/den) >= Math.abs(rho) - 1e-12) ge++; }
  return { rho:+rho.toFixed(3), p:+((1 + ge)/(K + 1)).toFixed(4), n };
}
const quantile = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q*(s.length - 1)))]; };

// ---------- one session -> compact rows. s = the parsed session file ({startedAt, inputs, ext}).
// A row: {t, f:{feature:value|null}, abs5, abs15, sgn5, sgn15, cont5, cont15, vol, liqNext, liqPrev}. Returns {t0, rows, sigma, nLiq, liqUsd, hasLate} or null when there is no usable price.
export function sessionRows(s, plan = PLAN) {
  const inputs = s.inputs || [], hist = []; let lastSec = -1;
  for (const r of inputs) {
    if (r[0] !== "q" || r[1] !== "bn") continue; const bid = r[3], ask = r[4], t = r[2]; if (!(bid > 0) || !(ask > 0) || !Number.isFinite(t)) continue;
    const sec = Math.floor(t/1000), pt = [sec*1000, (bid + ask)/2]; if (sec === lastSec) hist[hist.length - 1] = pt; else { hist.push(pt); lastSec = sec; }
  }
  if (hist.length < 900) return null;
  const sigma = SB.sigmaOf(hist), T0 = hist[0][0], T1 = hist[hist.length - 1][0];
  const series = {};      // name -> [[t, payload]]
  for (const r of s.ext || []) if (Array.isArray(r) && r[0] === "c" && Number.isFinite(r[2])) (series[r[1]] || (series[r[1]] = [])).push([r[2], r[3]]);
  for (const k in series) series[k].sort((a, b) => a[0] - b[0]);
  const at = (name, t, stale) => {      // latest payload at or before t, not older than stale
    const a = series[name]; if (!a) return null; let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r >= 0 && t - a[r][0] <= stale ? a[r][1] : null;
  };
  const sd = plan.stale, num = v => (Number.isFinite(v) ? v : null);
  const per8 = a => (Array.isArray(a) && Number.isFinite(a[0]) && a[2] > 0 ? a[0]*1e4*8/a[2] : null);
  const read = t => {
    const o = {}, b = at("basis", t, sd.default), fp = at("fundPred", t, sd.fundPred), bd = at("bnDerivs", t, sd.default), hc = at("hlCtx", t, sd.default), op = at("oiPerp", t, sd.default), ra = at("ratios", t, sd.ratios);
    o.basisBps = b ? num(b.bps) : null;
    const fb = fp ? per8(fp.Bin) : null, fh = fp ? per8(fp.Hl) : null, fy = fp ? per8(fp.Bybit) : null;
    o.fundBn = fb; o.fundSprBnHl = fb != null && fh != null ? fb - fh : null; o.fundSprBnBy = fb != null && fy != null ? fb - fy : null;
    o.oi = { bn:bd && bd.oi ? num(bd.oi.oi) : null, hl:hc ? num(hc.oi) : null, by:op && op.by ? num(op.by.oi) : null, ok:op && op.ok ? num(op.ok.oi) : null };
    const lg = x => (x && x.ratio > 0 ? Math.log(x.ratio) : null);
    o.lsAcct = ra ? lg(ra.acct) : null; o.lsTop = ra ? lg(ra.top) : null; o.lsTaker = ra ? lg(ra.taker) : null; o.basisRaw = o.basisBps;
    return o;
  };
  const liq = inputs.filter(r => r[0] === "t" && r[1] && r[1].v === "bn" && r[1].liq && r[1].ntl > 0).map(r => [r[1].t, r[1].ntl]).sort((a, b) => a[0] - b[0]);
  const liqIn = (a, b) => { let x = 0; for (const e of liq) { if (e[0] > b) break; if (e[0] > a) x += e[1]; } return x; };
  const rows = [], step = plan.stepSec*1000, prev = plan.prevSec*1000;
  for (let t = T0 + prev; t + plan.horizonsSec[0]*1000 <= T1; t += step) {
    const now = read(t), old = read(t - prev), f = {};
    f.basisBps = now.basisBps; f.basisChg5 = now.basisBps != null && old.basisBps != null ? now.basisBps - old.basisBps : null;
    f.fundBn = now.fundBn; f.fundSprBnHl = now.fundSprBnHl; f.fundSprBnBy = now.fundSprBnBy;
    for (const v of ["bn", "hl", "by", "ok"]) { const k = "oiChg" + v[0].toUpperCase() + v[1] + "5"; f[k] = now.oi[v] > 0 && old.oi[v] > 0 ? (now.oi[v]/old.oi[v] - 1)*100 : null; }
    f.lsAcct = now.lsAcct; f.lsTop = now.lsTop; f.lsTaker = now.lsTaker;
    const ret5 = SB.forwardMove(hist, t - prev, plan.prevSec, 1, sigma), sgnPrev = ret5 > 0 ? 1 : ret5 < 0 ? -1 : 0;
    let ss = 0, m = 0; for (let u = t - prev; u < t; u += step) { const r = SB.forwardMove(hist, u, plan.stepSec, 1, sigma); if (r != null) { ss += r*r; m++; } }
    const row = { t, f, vol:m ? Math.sqrt(ss/m) : null, liqNext:liqIn(t, t + prev), liqPrev:liqIn(t - prev, t) };
    for (const H of plan.horizonsSec) { const k = H/60, mv = SB.forwardMove(hist, t, H, 1, sigma); row["sgn" + k] = mv; row["abs" + k] = mv == null ? null : Math.abs(mv); row["cont" + k] = mv == null || !sgnPrev ? null : mv*sgnPrev; }
    rows.push(row);
  }
  return { t0:s.startedAt || T0, rows, sigma, nLiq:liq.length, liqUsd:liq.reduce((p, e) => p + e[1], 0), hasLate:rows.some(r => r.f.oiChgBy5 != null) };
}

// ---------- tests over the pooled rows
const effN = (n, plan = PLAN) => Math.round(n/plan.effDiv);
const usableRows = (rows, f, tg) => rows.filter(r => r.f[f] != null && r[tg] != null && r.vol != null);
function oneTest(rr, f, tg, K, seed, plan = PLAN) {      // rr: rows of one half with the feature and target present
  const n = rr.length, res = n >= plan.minRows ? partialTest(rr.map(r => r.f[f]), rr.map(r => r[tg]), rr.map(r => r.vol), K, seed) : null;
  return { feat:f, target:tg, rho:res ? res.rho : null, p:res ? res.p : null, n, eff:effN(n, plan) };
}
// rows are split in time per test: the earlier half of the rows that HAVE that feature explores, the later half checks (so a feature that exists only from v122 on is still split)
function tests(listFeat, targets, allSorted, K, seed, plan = PLAN) {
  const out = []; let i = 0;
  for (const f of listFeat) for (const [tg, only] of targets) {
    if (only && !only.includes(f)) continue; i++;
    const rr = usableRows(allSorted, f, tg), h = rr.length >> 1;
    out.push({ early:oneTest(rr.slice(0, h), f, tg, K, seed + i, plan), late:oneTest(rr.slice(h), f, tg, K, seed + 1000 + i, plan) });
  }
  return out;
}
const sortedRows = sessions => { const all = []; for (const s of sessions) for (const r of s.rows) all.push(r); return all.sort((a, b) => a.t - b.t); };
function perSession(sessions, feat, tg, plan = PLAN) {
  const rhos = [];
  for (const s of sessions) { const rr = usableRows(s.rows, feat, tg); if (rr.length < plan.minSessionRows) continue; const t = partialTest(rr.map(r => r.f[feat]), rr.map(r => r[tg]), rr.map(r => r.vol), 0, 1); if (t) rhos.push(t.rho); }
  return rhos.length ? { n:rhos.length, med:quantile(rhos, 0.5), q1:quantile(rhos, 0.25), q3:quantile(rhos, 0.75), pos:rhos.filter(x => x > 0).length/rhos.length } : { n:0 };
}
const TARGETS_A = [["abs5"], ["abs15"], ["sgn5"], ["sgn15"], ["cont5", OI_FEATS], ["cont15", OI_FEATS]];
const TARGETS_B = [["liqNext"]];
function part(label, sessions, feats, targets, plan = PLAN) {
  const all = sortedRows(sessions), T = tests(feats, targets, all, plan.permutations, plan.seed, plan), planned = T.length, thr = plan.alpha/planned;
  const rows = T.map(t => {
    const a = t.early, b = t.late, sp = perSession(sessions, a.feat, a.target, plan);
    const strong = a.p != null && a.p <= thr, confirmed = strong && b.p != null && b.p <= plan.alpha && Math.sign(b.rho) === Math.sign(a.rho);
    return { feat:a.feat, target:a.target, early:a, late:b, perSession:sp, flag:confirmed ? "WORTH A LOOK" : strong ? "early only" : "" };
  });
  return { label, sessions:sessions.length, rowsAll:all.length, tests:planned, threshold:+thr.toFixed(5), rows };
}
export function analyze(sessions, plan = PLAN) {
  const usable = sessions.filter(s => s && s.rows.length >= plan.minSessionRows/5).sort((a, b) => a.t0 - b.t0);
  const A = part("(a) the move after t", usable, FEATURES, TARGETS_A, plan);
  const expl = usable.filter(s => s.t0 < Date.parse(plan.cutoffIso)), featsB = FEATURES.filter(f => !LATE_ONLY.includes(f));
  const rowsB = expl.map(s => ({ ...s, rows:s.rows.map(r => ({ ...r, f:{ ...r.f, liqPrev:r.liqPrev } })) }));
  const B = part("(b) Binance liquidations in the next 5 minutes (sessions before the cutoff only)", rowsB, [...featsB, "liqPrev"], TARGETS_B, plan);
  return { A, B, liq:{ sessions:expl.length, events:expl.reduce((p, s) => p + s.nLiq, 0), usd:Math.round(expl.reduce((p, s) => p + s.liqUsd, 0)) } };
}
const fmtT = t => (t && t.rho != null ? `${t.rho >= 0 ? "+" : ""}${t.rho.toFixed(3)} p=${t.p.toFixed(4)}` : "n/a").padEnd(19);
export function report(res) {
  const L = [];
  for (const P of [res.A, res.B]) {
    L.push("", `== ${P.label}`, `   ${P.sessions} sessions, ${P.rowsAll} rows (about ${effN(P.rowsAll)} independent); the rows that have a feature are split in time into an earlier and a later half; ${P.tests} tests, Bonferroni line p <= ${P.threshold}`,
      "   feature         target   early (explore)    late (check)       n early/late (eff)   per session: n med [q1 q3] share>0   flag");
    for (const r of P.rows) { const s = r.perSession; L.push(`   ${r.feat.padEnd(14)}  ${r.target.padEnd(7)}  ${fmtT(r.early)}  ${fmtT(r.late)}  ${String(r.early.n).padStart(5)}/${String(r.late.n).padEnd(5)} (${r.early.eff}/${r.late.eff})   ${s.n ? `${s.n} ${s.med.toFixed(2)} [${s.q1.toFixed(2)} ${s.q3.toFixed(2)}] ${(s.pos*100).toFixed(0)}%` : "-"}   ${r.flag}`); }
  }
  L.push("", `Binance liquidation trades in the exploration sessions: ${res.liq.events} events, $${res.liq.usd.toLocaleString("en-US")}, ${res.liq.sessions} sessions.`);
  return L.join("\n");
}

// ---------- reading the folder: one file at a time
export function loadAll(dir, plan = PLAN) {
  const out = [], files = fs.readdirSync(dir).filter(f => /^session_.*\.json\.gz$/.test(f)).sort();
  for (const f of files) {
    try { const sr = sessionRows(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8")), plan); if (sr) { sr.file = f; out.push(sr); } } catch (e) { console.error("skipped " + f + ": " + e.message); }
    if (global.gc) global.gc();
  }
  return out;
}

// ---------- self-test: a planted relationship is found, an unrelated feature is not, the control works, rows are shaped right
export function makeSynthetic(seed, minutes, plant) {
  const r = rng(seed), g = () => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return u - 3; }, T0 = 1.8e12, N = minutes*60;
  const level = []; for (let b = 0; b < Math.ceil(N/600) + 2; b++) level.push(0.5 + 2*r());      // block levels, 600 s each
  const lv = sec => level[Math.floor(Math.max(0, sec)/600)], inputs = [], basis = [], fp = [], oi = []; let p = 76000, oiv = 90000;
  for (let sec = 0; sec <= N; sec++) {
    const vol = lv(sec), lead = lv(sec + 240), drift = plant ? 0.25*Math.sign(lead - 1.5)*vol : 0;
    p *= 1 + (g()*vol*0.00004 + drift*0.00004); inputs.push(["q", "bn", T0 + sec*1000, p - 0.05, p + 0.05]);
    if (sec % 10 === 0) { basis.push(["c", "basis", T0 + sec*1000, { bps:plant ? 3*(lead - 1.5) + g()*0.5 : g()*3 }]); oiv *= 1 + g()*0.0002; oi.push(["c", "bnDerivs", T0 + sec*1000, { oi:{ oi:oiv } }]); }
    if (sec % 60 === 0) fp.push(["c", "fundPred", T0 + sec*1000, { Bin:[0.0001, 0, 8], Hl:[0.00001, 0, 1], Bybit:[0.0001, 0, 8] }]);
  }
  return { startedAt:T0, inputs, ext:[...basis, ...fp, ...oi] };
}
export function selfTest() {
  let fail = 0; const ok = (name, c, d) => { console.log((c ? "  pass  " : "  FAIL  ") + name + (d ? "  (" + d + ")" : "")); if (!c) fail++; };
  const plan = { ...PLAN, permutations:299 };
  const ss = [], nul = [];
  for (let i = 0; i < 4; i++) { ss.push({ ...sessionRows(makeSynthetic(100 + i, 90, true), plan), t0:1.8e12 + i*1e7 }); nul.push({ ...sessionRows(makeSynthetic(200 + i, 90, false), plan), t0:1.8e12 + i*1e7 }); }
  ok("session rows are built from the quotes and the records", ss[0].rows.length > 400 && ss[0].rows[100].f.basisBps != null && ss[0].rows[100].abs5 != null && ss[0].sigma > 0, ss[0].rows.length + " rows");
  ok("funding is put on a per-8 h scale: Hyperliquid 0.00001 per hour = 0.8 bps; spread to Binance (1 bp) = 0.2", Math.abs(ss[0].rows[50].f.fundSprBnHl - 0.2) < 1e-9 && Math.abs(ss[0].rows[50].f.fundBn - 1) < 1e-9);
  ok("a stale record is left out (funding record older than 180 s)", (() => { const s = makeSynthetic(5, 40, false); s.ext = s.ext.filter(r => r[1] !== "fundPred" || r[2] < s.startedAt + 400000); const rows = sessionRows(s, plan).rows; return rows[rows.length - 1].f.fundBn == null && rows[10].f.fundBn != null; })());
  const early = ss.flatMap(s => s.rows), one = (rows, f, tg) => { const rr = usableRows(rows, f, tg); return oneTest(rr, f, tg, 299, 1, plan); };
  const bs = [one(early, "basisBps", "abs5"), one(early, "basisBps", "sgn5")], bn = [one(nul.flatMap(s => s.rows), "basisBps", "abs5"), one(nul.flatMap(s => s.rows), "basisBps", "sgn5")];
  ok("a planted lead of basis over the size of the move is found (partial rho > 0.1, p < 0.05)", bs[0].rho > 0.1 && bs[0].p < 0.05, `rho ${bs[0].rho} p ${bs[0].p}`);
  ok("a planted lead of basis over the direction is found with the right sign", bs[1].rho > 0.1 && bs[1].p < 0.05, `rho ${bs[1].rho} p ${bs[1].p}`);
  ok("the same feature with nothing planted is not (|rho| < 0.1 or p > 0.05)", bn.every(t => Math.abs(t.rho) < 0.1 || t.p > 0.05), bn.map(t => t.rho + "/" + t.p).join(" "));
  const ob = one(early, "oiChgBn5", "abs5");
  ok("an open-interest feature unrelated to the move is not found", Math.abs(ob.rho) < 0.12 || ob.p > 0.05, `rho ${ob.rho} p ${ob.p}`);
  ok("the control matters: previous volatility is part of every test and a row without it is dropped", usableRows(early.map(r => ({ ...r, vol:null })), "basisBps", "abs5").length === 0);
  const res = analyze([...ss, ...nul].map((s, i) => ({ ...s, t0:Date.parse(plan.cutoffIso) - 1e9 + i*1e6 })), { ...plan, permutations:99 });
  ok("analyze returns both parts and a flag per test; part (b) uses only sessions before the cutoff", res.A.rows.length > 0 && res.B.sessions === 8 && analyze(ss.map((s, i) => ({ ...s, t0:Date.parse(plan.cutoffIso) + 1e6 + i })), { ...plan, permutations:99 }).B.sessions === 0);
  ok("report prints", /per session/.test(report(res)));
  console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) selfTest();
  else if (args.includes("--plan")) console.log(fs.readFileSync(path.join(root, ".scratch/basis-funding-oi/plan.md"), "utf8"));
  else {
    const dir = args.find(a => !a.startsWith("--")) || path.join(root, "sessions");
    const t = Date.now(), sessions = loadAll(dir); console.error(`read ${sessions.length} usable sessions in ${((Date.now() - t)/1000).toFixed(0)} s`);
    const res = analyze(sessions);
    if (args.includes("--json")) console.log(JSON.stringify(res)); else console.log(report(res));
  }
}
