// Offline analysis of collector data. Reads a downloaded tape (tape_*.json) and/or saved sessions (session_*.json.gz or .json); prints, per file:
//   1. coverage: per collector and per record name, how many records, the longest gap, and the share of minutes with data;
//   2. lead-in: for a session, how far before the start each collector's data reaches (an auto-recording should reach 30 minutes back);
//   3. field check: numeric fields that never change (a collector that reads a constant is not telling anything);
//   4. evaluation: does a feature taken now say something about the NEXT 5 minutes of volatility of the Binance mark that the PREVIOUS 5 minutes of volatility do not?
//      A plan fixed in advance (see PLAN below, printed with every result): partial rank correlation, permutation p-values that respect the autocorrelation,
//      a correction for the number of features, and a time split into a deciding and a confirming half. Meant for weeks of tapes joined with --merge.
// Usage:  node analyze-collectors.mjs FILE... [--merge] [--horizon 300] [--fields] [--json]      |      --plan      |      --selftest
// The record names and expected intervals come from src/js/collectors-core.js (COLLECT.OWNER / EXPECT_MS), so a new collector is picked up when it is added there.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const COLLECT = vm.runInNewContext(fs.readFileSync(path.join(root, "src/js/collectors-core.js"), "utf8") + "\n;COLLECT", {});
const MIN = 60000;

// ---------- reading files
export function readInput(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const j = JSON.parse(buf.toString("utf8"));
  if (j.kind === "sv-tape") return { file, kind:"tape", version:j.version, records:(j.records || []).filter(COLLECT.isRec), t0:null, t1:null };
  if (j.kind === "sv-session") {
    const recs = (j.ext || []).filter(COLLECT.isRec), times = (j.inputs || []).map(r => r[0] === "t" ? r[1] && r[1].t : r[2]).filter(Number.isFinite);
    const end = times.length ? Math.max(...times) : (recs.length ? recs[recs.length - 1][2] : j.startedAt);
    return { file, kind:"session", sym:j.sym, auto:!!j.pre, records:recs, t0:j.startedAt, t1:end, quality:j.quality || null, inputs:j.inputs || [] };
  }
  throw new Error(file + ": not a tape or a session (kind " + j.kind + ")");
}

// ---------- 1. coverage
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length/2)]; };
function gapsOf(times) { const g = []; for (let i = 1; i < times.length; i++) g.push(times[i] - times[i - 1]); return g; }
function minutesWith(times, a, b) { const set = new Set(); for (const t of times) if (t >= a && t <= b) set.add(Math.floor(t/MIN)); return set.size; }
export function coverage(records, a, b) {
  const byName = {}, byOwner = {};
  for (const r of records) { (byName[r[1]] ||= []).push(r[2]); const o = COLLECT.ownerOf(r[1]); if (o) (byOwner[o] ||= []).push(r[2]); }
  const total = Math.max(1, Math.floor(b/MIN) - Math.floor(a/MIN) + 1);
  const sum = (times, expect) => {
    const t = times.filter(x => x >= a && x <= b).sort((x, y) => x - y), g = gapsOf(t), mx = g.length ? Math.max(...g) : null;
    return { n:t.length, medianGapMs:median(g), maxGapMs:mx, minutes:minutesWith(t, a, b), minutesPct:Math.round(100*minutesWith(t, a, b)/total), onTimePct:expect && g.length ? Math.round(100*g.filter(x => x <= 3*expect).length/g.length) : null };
  };
  const owners = {}, names = {};
  for (const o in byOwner) owners[o] = sum(byOwner[o], COLLECT.EXPECT_MS[o]);
  for (const n in byName) names[n] = sum(byName[n], null);
  return { owners, names, totalMinutes:total };
}

// ---------- 2. lead-in
export function leadIn(records, startedAt) {
  const first = {};
  for (const r of records) { const o = COLLECT.ownerOf(r[1]); if (o && (first[o] == null || r[2] < first[o])) first[o] = r[2]; }
  const out = {}; for (const o in first) out[o] = Math.round(10*(startedAt - first[o])/MIN)/10;      // minutes before the start (negative: the first record is after it)
  return out;
}

// ---------- 3. fields that never change
function flatten(v, prefix, out, depth) {
  if (typeof v === "number" && Number.isFinite(v)) out[prefix] = v;
  else if (v && typeof v === "object" && depth < 4) { const keys = Array.isArray(v) ? v.slice(0, 2).map((_, i) => i) : Object.keys(v); for (const k of keys) flatten(v[k], prefix ? prefix + "." + k : String(k), out, depth + 1); }
}
export function fieldStats(records) {
  const by = {};
  for (const r of records) { const o = {}; flatten(r[3], "", o, 0); const m = (by[r[1]] ||= {}); for (const k in o) (m[k] ||= []).push(o[k]); }
  const out = {};
  for (const name in by) {
    out[name] = {};
    for (const k in by[name]) {
      const a = by[name][k], n = a.length, mean = a.reduce((x, y) => x + y, 0)/n, sd = Math.sqrt(a.reduce((x, y) => x + (y - mean)**2, 0)/n);
      out[name][k] = { n, distinct:new Set(a).size, min:Math.min(...a), max:Math.max(...a), sd:+sd.toPrecision(4) };
    }
  }
  return out;
}
export const constantFields = (stats, minN = 20) => { const out = []; for (const name in stats) for (const k in stats[name]) { const s = stats[name][k]; if (s.n >= minN && s.distinct === 1) out.push(name + "." + k + " = " + s.min + " (" + s.n + " records)"); } return out; };

// ---------- 4. evaluation: does a feature say something about the NEXT horizon of the Binance mark that the CURRENT volatility does not?
// The plan is fixed here, in advance, and printed with every result. The questions it answers badly are listed in .scratch/collectors/01-collectors.md.
//   target     realised volatility of the mark over the next horizon (standard deviation of its 10-second log returns, in bps); the absolute move is reported, not judged
//   control    realised volatility over the PREVIOUS horizon: volatility clusters, so a feature that only mirrors the current volatility would look predictive without being so
//   statistic  partial rank correlation of feature and target given the control (ranks, both residualised on the control ranks)
//   inference  circular-shift permutation (keeps the autocorrelation of both series; a plain p-value would be meaningless because the windows overlap)
//   verdict    the data is split in time in two halves. A feature is "confirmed" only if the first half passes (p <= alpha / number of features, |rho| >= minAbsRho)
//              and the second half agrees (same sign, p <= confirmAlpha, |rho| >= minAbsRho / 2). Passing in the first half only is "promising", never "keep".
export const PLAN = { horizonSec:300, stepSec:10, minSamples:300, alpha:0.05, confirmAlpha:0.05, minAbsRho:0.08, permutations:999, seed:12345 };
const num = x => (typeof x === "number" && Number.isFinite(x) ? x : null);
const mid = q => (q && num(q.b) != null && num(q.a) != null ? (q.b + q.a)/2 : null);
const imb = (p, e) => { const d = p && p.d && p.d[e]; return d && num(d[0]) != null && num(d[1]) != null && d[0] + d[1] > 0 ? (d[0] - d[1])/(d[0] + d[1]) : null; };
const dep = (p, e) => { const d = p && p.d && p.d[e]; return d && num(d[0]) != null && num(d[1]) != null ? d[0] + d[1] : null; };
export const FEATURES = {
  "dvol.vol":           ["dvol", p => num(p.vol)],
  "bnDerivs.fund":      ["bnDerivs", p => p.prem && num(p.prem.fund)],
  "bnDerivs.basisBps":  ["bnDerivs", p => p.prem && num(p.prem.mark) != null && p.prem.index ? (p.prem.mark - p.prem.index)/p.prem.index*1e4 : null],
  "bnDerivs.oi":        ["bnDerivs", p => p.oi && num(p.oi.oi)],
  "hlCtx.fund":         ["hlCtx", p => num(p.fund)],
  "hlCtx.prem":         ["hlCtx", p => num(p.prem)],
  "hlCtx.oi":           ["hlCtx", p => num(p.oi)],
  "ratios.accountLS":   ["ratios", p => p.acct && num(p.acct.ratio)],
  "ratios.topLS":       ["ratios", p => p.top && num(p.top.ratio)],
  "ratios.taker":       ["ratios", p => p.taker && num(p.taker.ratio)],
  "basis.bps":          ["basis", p => num(p.bps)],
  "bookBn.spread":      ["bookBn", p => num(p.spr)],
  "bookBn.imbalance5":  ["bookBn", p => imb(p, 5)],
  "bookBn.depth5":      ["bookBn", p => dep(p, 5)],
  "bookHl.spread":      ["bookHl", p => num(p.spr)],
  "bookHl.imbalance5":  ["bookHl", p => imb(p, 5)],
  "bookHl.depth5":      ["bookHl", p => dep(p, 5)],
  "venues.coinbaseVsBinanceBps": ["venues", p => { const m = mid(p.bnS), c = p.cb && num(p.cb.l); return m && c != null ? (c - m)/m*1e4 : null; }],
  "venues.bybitVsBinanceBps":    ["venues", p => { const m = mid(p.bnS), c = p.byL && num(p.byL.l); return m && c != null ? (c - m)/m*1e4 : null; }],
  "optChain.atmVol":    ["optChain", p => p.exps && p.exps[0] && num(p.exps[0].atm)],
  "optChain.skew5":     ["optChain", p => p.exps && p.exps[0] && p.exps[0].s && num(p.exps[0].s["-5"]) != null && num(p.exps[0].s["5"]) != null ? p.exps[0].s["-5"] - p.exps[0].s["5"] : null],
};
function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j)/2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
export function spearman(x, y) {
  const n = x.length; if (n < 30) return null;
  const rx = ranks(x), ry = ranks(y), mx = (n + 1)/2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx)*(ry[i] - mx); sxx += (rx[i] - mx)**2; syy += (ry[i] - mx)**2; }
  return sxx && syy ? +(sxy/Math.sqrt(sxx*syy)).toFixed(3) : null;
}
export function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0)/4294967296); }
function residual(a, z) {      // a with the part explained by z (least squares) removed, then centred
  const n = a.length, ma = a.reduce((p, q) => p + q, 0)/n, mz = z.reduce((p, q) => p + q, 0)/n; let cov = 0, vz = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma)*(z[i] - mz); vz += (z[i] - mz)**2; }
  const b = vz ? cov/vz : 0; return a.map((v, i) => v - ma - b*(z[i] - mz));
}
// partial rank correlation of x and y given z, with a circular-shift permutation p-value; null when there are too few samples or no variation
export function partialTest(x, y, z, K, seed) {
  const n = x.length; if (n < 30 || y.length !== n || z.length !== n) return null;
  const rz = ranks(z), ex = residual(ranks(x), rz), ey = residual(ranks(y), rz);
  let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += ex[i]**2; syy += ey[i]**2; sxy += ex[i]*ey[i]; }
  if (!(sxx > 1e-9) || !(syy > 1e-9)) return null;
  const den = Math.sqrt(sxx*syy), rho = sxy/den, rand = rng(seed), lo = Math.ceil(n*0.05), hi = Math.floor(n*0.95); let ge = 0;
  for (let k = 0; k < K; k++) {
    const s = lo + Math.floor(rand()*(hi - lo + 1)); let acc = 0;
    for (let i = 0; i < n; i++) acc += ex[i]*ey[(i + s) % n];
    if (Math.abs(acc/den) >= Math.abs(rho) - 1e-12) ge++;
  }
  return { rho:+rho.toFixed(3), p:+((1 + ge)/(K + 1)).toFixed(4), n };
}
export function verdict(disc, conf, plan = PLAN, nFeatures = 1) {
  if (!disc || !conf) return "no variation, or too few samples";
  if (disc.n < plan.minSamples || conf.n < plan.minSamples) return "not enough data";
  const alpha = plan.alpha/Math.max(1, nFeatures);
  if (!(disc.p <= alpha && Math.abs(disc.rho) >= plan.minAbsRho)) return "nothing";
  return Math.sign(conf.rho) === Math.sign(disc.rho) && conf.p <= plan.confirmAlpha && Math.abs(conf.rho) >= plan.minAbsRho/2 ? "CONFIRMED" : "promising, not confirmed in the second half";
}
// the Binance mark (the `basis` records): realised volatility (bps) and absolute move over any window (a, b]
function makeMarks(records) {
  const marks = records.filter(r => r[1] === "basis" && r[3] && num(r[3].mark) > 0).map(r => [r[2], r[3].mark]).sort((a, b) => a[0] - b[0]);
  const after = t => { let lo = 0, hi = marks.length; while (lo < hi) { const m = (lo + hi) >> 1; if (marks[m][0] <= t) lo = m + 1; else hi = m; } return lo; };
  const stat = (a, b) => {
    const w = marks.slice(after(a), after(b));
    if (w.length < 10 || w[w.length - 1][0] - w[0][0] < (b - a)*0.7) return null;
    const r = []; for (let i = 1; i < w.length; i++) r.push(Math.log(w[i][1]/w[i - 1][1]));
    const m = r.reduce((p, q) => p + q, 0)/r.length, sd = Math.sqrt(r.reduce((p, q) => p + (q - m)**2, 0)/r.length);
    return { vol:sd*1e4, move:Math.abs(Math.log(w[w.length - 1][1]/w[0][1]))*1e4 };
  };
  return { marks, stat };
}
// per feature: samples (at most one per step) with the feature value, the next-horizon volatility and move, and the previous-horizon volatility
export function buildSamples(records, plan = PLAN) {
  const H = plan.horizonSec*1000, step = plan.stepSec*1000, mk = makeMarks(records), byName = {};
  for (const r of records) (byName[r[1]] ||= []).push(r);
  const out = {};
  for (const f in FEATURES) {
    const [name, fn] = FEATURES[f], rows = (byName[name] || []).sort((a, b) => a[2] - b[2]), s = []; let lastT = -Infinity;
    for (const r of rows) {
      if (r[2] - lastT < step) continue;
      let x = null; try { x = fn(r[3] || {}); } catch {}
      if (num(x) == null) continue;
      const fut = mk.stat(r[2], r[2] + H), past = mk.stat(r[2] - H, r[2]); if (!fut || !past) continue;
      s.push({ t:r[2], x, vol:fut.vol, move:fut.move, pvol:past.vol }); lastT = r[2];
    }
    out[f] = s;
  }
  return { samples:out, marks:mk.marks, stat:mk.stat };
}
export function evaluate(records, plan = PLAN) {
  const { samples, marks, stat } = buildSamples(records, plan), nF = Object.keys(FEATURES).length, H = plan.horizonSec*1000;
  const t0 = marks.length ? marks[0][0] : 0, t1 = marks.length ? marks[marks.length - 1][0] : 0, tMid = (t0 + t1)/2, rows = [];
  for (const f in samples) {
    const s = samples[f], a = s.filter(q => q.t < tMid), b = s.filter(q => q.t >= tMid), col = (arr, k) => arr.map(q => q[k]);
    const disc = partialTest(col(a, "x"), col(a, "vol"), col(a, "pvol"), plan.permutations, plan.seed), conf = partialTest(col(b, "x"), col(b, "vol"), col(b, "pvol"), plan.permutations, plan.seed + 1);
    rows.push({ feature:f, n:s.length, raw:spearman(col(s, "x"), col(s, "vol")), disc, conf, verdict:s.length < 2*plan.minSamples ? "not enough data" : verdict(disc, conf, plan, nF) });
  }
  const order = { "CONFIRMED":0, "promising, not confirmed in the second half":1, "nothing":2 };
  rows.sort((p, q) => (order[p.verdict] ?? 3) - (order[q.verdict] ?? 3) || Math.abs(q.disc ? q.disc.rho : 0) - Math.abs(p.disc ? p.disc.rho : 0));
  const vols = []; for (let t = t0 + H; t <= t1; t += 60000) { const v = stat(t - H, t); if (v) vols.push(v.vol); } vols.sort((p, q) => p - q);
  const q = p => vols.length ? vols[Math.min(vols.length - 1, Math.floor(vols.length*p))] : null;
  const days = new Set(marks.map(m => new Date(m[0]).toISOString().slice(0, 10)));
  return { plan, rows, marks:marks.length, span:{ from:t0, to:t1, hours:+((t1 - t0)/3600000).toFixed(1), days:days.size }, volRange:{ p10:q(.1) == null ? null : +q(.1).toFixed(2), p90:q(.9) == null ? null : +q(.9).toFixed(2) } };
}

// ---------- report
const dur = ms => ms == null ? "-" : ms < 90000 ? Math.round(ms/1000) + "s" : ms < 5400000 ? Math.round(ms/MIN) + "m" : (ms/3600000).toFixed(1) + "h";
export function analyze(input, plan = PLAN) {
  const recs = input.records, times = recs.map(r => r[2]);
  const a = input.t0 != null ? input.t0 - 30*MIN : Math.min(...times), b = input.t1 != null ? input.t1 : Math.max(...times);
  const cov = recs.length ? coverage(recs, a, b) : null, st = recs.length ? fieldStats(recs) : {};
  return { file:input.file, kind:input.kind, window:{ from:a, to:b, minutes:cov ? cov.totalMinutes : 0 }, records:recs.length, coverage:cov, leadIn:input.t0 != null ? leadIn(recs, input.t0) : null, auto:!!input.auto, constants:constantFields(st), fields:st, evaluation:evaluate(recs, plan) };
}
const fmt = x => x == null ? "-" : (x.rho >= 0 ? "+" : "") + x.rho.toFixed(2) + " (p " + (x.p < 0.001 ? "<.001" : x.p.toFixed(3)) + ")";
function printEvaluation(ev) {
  const L = s => console.log(s), p = ev.plan;
  L("\n   EVALUATION  (plan fixed in advance: " + p.horizonSec/60 + " min horizon; target = next-horizon volatility; control = previous-horizon volatility; partial rank correlation;");
  L("   circular-shift permutation, " + p.permutations + " shifts; first half decides at p <= " + p.alpha + "/" + Object.keys(FEATURES).length + " and |rho| >= " + p.minAbsRho + ", second half must agree; at least " + p.minSamples + " samples a half)");
  L("   data: " + ev.marks + " mark prices over " + ev.span.hours + " h on " + ev.span.days + " day(s); volatility seen: " + (ev.volRange.p10 == null ? "-" : ev.volRange.p10 + " to " + ev.volRange.p90 + " bps per 10 s step (10th to 90th percentile)"));
  if (ev.marks < 120) return L("   not enough mark prices (the `basis` collector needs to have run for hours; use --merge to join several tapes)");
  if (ev.span.hours < 24 || ev.span.days < 2) L("   WARNING: under a day, or one calendar day, of data: one regime only. Treat everything below as a rehearsal, not a result.");
  if (ev.volRange.p10 && ev.volRange.p90 / ev.volRange.p10 < 1.5) L("   WARNING: the volatility barely changed (90th/10th percentile under 1.5): there is nothing for a feature to lead.");
  L("   " + "feature".padEnd(30) + "n".padEnd(7) + "raw rho".padEnd(9) + "1st half (decides)".padEnd(22) + "2nd half (confirms)".padEnd(22) + "verdict");
  for (const x of ev.rows) L("   " + x.feature.padEnd(30) + String(x.n).padEnd(7) + String(x.raw ?? "-").padEnd(9) + fmt(x.disc).padEnd(22) + fmt(x.conf).padEnd(22) + x.verdict);
}
function print(r, showFields) {
  const L = s => console.log(s);
  L("\n== " + r.file + "  (" + r.kind + (r.auto ? ", auto-recording" : "") + ")");
  if (!r.coverage) return L("   no collector records in this file");
  L("   window " + new Date(r.window.from).toISOString().slice(0, 16) + " to " + new Date(r.window.to).toISOString().slice(0, 16) + " UTC, " + r.window.minutes + " minutes, " + r.records.toLocaleString("en-US") + " records");
  L("\n   COVERAGE".padEnd(26) + "records   minutes with data   longest gap   on time (gaps <= 3x usual)");
  for (const o of Object.keys(COLLECT.EXPECT_MS)) { const c = r.coverage.owners[o]; L("   " + o.padEnd(22) + (c ? String(c.n).padEnd(10) + (c.minutesPct + "%").padEnd(22) + dur(c.maxGapMs).padEnd(14) + (c.onTimePct == null ? "-" : c.onTimePct + "%") : "none")); }
  if (r.leadIn) {
    L("\n   LEAD-IN (minutes of data before the start; an auto-recording should reach 30)");
    for (const o of Object.keys(COLLECT.EXPECT_MS)) { const v = r.leadIn[o]; if (v == null) continue; L("   " + o.padEnd(22) + v + (r.auto && v < 25 ? "   short for an auto-recording" : "")); }
  }
  L("\n   FIELDS that never change: " + (r.constants.length ? "" : "none"));
  for (const c of r.constants) L("   " + c);
  if (showFields) { L("\n   ALL FIELDS (n, distinct, min, max, sd)"); for (const n in r.fields) for (const k in r.fields[n]) { const s = r.fields[n][k]; L("   " + (n + "." + k).padEnd(40) + [s.n, s.distinct, s.min, s.max, s.sd].join("  ")); } }
  printEvaluation(r.evaluation);
}

// ---------- self-test on a synthetic tape with known structure
function selfTest() {
  const R = COLLECT.rec, T0 = Date.UTC(2026, 9, 24, 0, 0, 0), N = 1500, rnd = rng(7);
  // volatility regimes of random length (6 to 18 minutes), calm = 1, wild = 6
  const regime = []; for (let c = 0, w = false; regime.length < N + 60; w = !w, c++) { const len = 36 + Math.floor(rnd()*72); for (let k = 0; k < len; k++) regime.push(w ? 6 : 1); }
  const recs = [], basisRecs = []; let price = 80000;
  for (let i = 0; i < N; i++) { price *= Math.exp((rnd() - .5)*2e-5*regime[i]); basisRecs.push(R("basis", T0 + i*10000, { mark:price, index:price, bps:0 })); }
  const pastVol = makeMarks(basisRecs).stat;      // what the plan uses as its control: the volatility of the previous 5 minutes
  for (let i = 0; i < N; i++) {
    const t = T0 + i*10000, fut = regime[i + 30], pv = pastVol(t - 300000, t);
    recs.push(basisRecs[i]);
    recs.push(R("dvol", t, { vol:30 + 10*fut + rnd()*2, idx:basisRecs[i][3].mark }));      // knows the regime 5 minutes ahead: says something the previous volatility does not
    recs.push(R("hlCtx", t, { fund:0.0000125, oi:1000 + (pv ? 20*pv.vol : 0) + rnd()*2, prem:rnd()*1e-4 }));      // oi only mirrors the previous volatility; prem is noise; fund is constant
  }
  for (let i = 0; i < 120; i++) recs.push(R("venues", T0 + 3600000 + i*1000, { cb:{ l:80000 }, bnS:{ b:79999, a:80001 } }));
  const gone = recs.filter(r => r[1] !== "venues" || r[2] < T0 + 3600000 + 50000 || r[2] > T0 + 3600000 + 70000);
  const cov = coverage(gone, T0, T0 + N*10000), v = cov.owners.venues, d = cov.owners.derivs, w = cov.owners.wallets, o = cov.owners.options;
  const lead = leadIn(gone, T0 + 3600000), st = fieldStats(gone), consts = constantFields(st);
  const ev = evaluate(gone, Object.assign({}, PLAN, { permutations:499 })), row = f => ev.rows.find(x => x.feature === f);
  const sp1 = spearman(Array.from({ length:30 }, (_, i) => i), Array.from({ length:30 }, (_, i) => 30 - i));
  // partialTest on its own: y and x both just follow z -> raw correlation high, partial near zero; a real extra link survives
  const rz = rng(3), z = Array.from({ length:400 }, () => rz()), echo = z.map(q => q + rz()*0.3), y = z.map(q => q + rz()*0.3), extra = Array.from({ length:400 }, () => rz()), y2 = y.map((q, i) => q + 1.5*extra[i]);
  const pe = partialTest(echo, y, z, 299, 1), pl = partialTest(extra, y2, z, 299, 1), ps = partialTest(echo, y, z, 299, 1);
  const V = verdict, P = PLAN;
  const checks = [
    ["venues: 99 records, one 22 s gap", v && v.n === 99 && v.maxGapMs === 22000],
    ["venues: minutes with data counts only the minute that has some", v && v.minutes === 2],
    ["derivs: every 10 s step counted, no gap above 10 s", d && d.maxGapMs === 10000 && d.onTimePct === 100],
    ["dvol counts as options; no wallets records means no wallets coverage", o && o.n === N && w === undefined],
    ["lead-in: derivs start 60 minutes before the recording, venues at its start", lead.derivs === 60 && lead.venues === 0],
    ["constant field found (hlCtx.fund), noisy ones not", consts.some(c => c.startsWith("hlCtx.fund ")) && !consts.some(c => c.startsWith("hlCtx.prem"))],
    ["spearman: perfectly reversed is -1, fewer than 30 points is null", sp1 === -1 && spearman([1, 2], [2, 1]) === null],
    ["partialTest: a feature that only mirrors the control has a high raw but a small partial correlation", spearman(echo, y) > 0.6 && Math.abs(pe.rho) < 0.2],
    ["partialTest: a real extra link survives the control and is significant", pl.rho > 0.5 && pl.p <= 0.01],
    ["partialTest: same data and seed give the same answer", pe.rho === ps.rho && pe.p === ps.p],
    ["evaluation: the feature that knows the next regime is CONFIRMED", row("dvol.vol") && row("dvol.vol").verdict === "CONFIRMED" && row("dvol.vol").disc.rho > 0.3],
    ["evaluation: a copy of the previous volatility looks predictive raw but is NOT confirmed", row("hlCtx.oi") && row("hlCtx.oi").raw > 0.2 && row("hlCtx.oi").verdict !== "CONFIRMED"],
    ["evaluation: noise is not confirmed, a constant has no verdict of value", row("hlCtx.prem").verdict !== "CONFIRMED" && /no variation|nothing/.test(row("hlCtx.fund").verdict)],
    ["evaluation: features with no records say not enough data, and CONFIRMED comes first in the order", row("bookBn.spread").verdict === "not enough data" && ev.rows[0].feature === "dvol.vol"],
    ["verdict rules: both halves needed, same sign, enough samples, corrected alpha", V({ rho:.2, p:.0001, n:400 }, { rho:.12, p:.01, n:400 }, P, 21) === "CONFIRMED" && V({ rho:.2, p:.0001, n:400 }, { rho:-.12, p:.01, n:400 }, P, 21).startsWith("promising") && V({ rho:.2, p:.01, n:400 }, { rho:.2, p:.0001, n:400 }, P, 21) === "nothing" && V({ rho:.05, p:.0001, n:400 }, { rho:.2, p:.0001, n:400 }, P, 21) === "nothing" && V({ rho:.2, p:.0001, n:100 }, { rho:.2, p:.0001, n:400 }, P, 21) === "not enough data" && V(null, null) !== "CONFIRMED"],
    ["data summary: marks, hours and the volatility range are reported", ev.marks === N && ev.span.hours > 4 && ev.volRange.p90 > ev.volRange.p10 * 1.5],
  ];
  let bad = 0; for (const [name, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + name); if (!ok) bad++; }
  if (bad) { console.log(JSON.stringify({ v, d, lead, consts, pe, pl, rows:ev.rows.slice(0, 5), span:ev.span, volRange:ev.volRange })); process.exit(1); }
  console.log("\nall " + checks.length + " checks passed");
}

// ---------- main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) selfTest();
  else if (args.includes("--plan")) console.log(JSON.stringify(PLAN, null, 1));
  else {
    const hi = args.indexOf("--horizon"), horizon = hi >= 0 ? +args[hi + 1] : PLAN.horizonSec, files = args.filter((x, i) => !x.startsWith("--") && !(hi >= 0 && i === hi + 1));
    if (!files.length) { console.error("usage: node analyze-collectors.mjs FILE... [--merge] [--horizon 300] [--fields] [--json]   |   --plan   |   --selftest"); process.exit(1); }
    const plan = Object.assign({}, PLAN, { horizonSec:horizon });
    let inputs = files.map(readInput);
    if (args.includes("--merge")) {      // one analysis over all files: tapes of consecutive days overlap, and a session's slice overlaps the tape, so identical records are counted once
      const seen = new Set(), records = [];
      for (const i of inputs) for (const r of i.records) { const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); records.push(r); } }
      inputs = [{ file:"(" + files.length + " files merged)", kind:"merged", records, t0:null, t1:null }];
    }
    const results = inputs.map(i => analyze(i, plan));
    if (args.includes("--json")) console.log(JSON.stringify(results, null, 1));
    else for (const r of results) print(r, args.includes("--fields"));
  }
}
