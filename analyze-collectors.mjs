// Offline analysis of collector data. Reads a downloaded tape (tape_*.json) and/or saved sessions (session_*.json.gz or .json); prints, per file:
//   1. coverage: per collector and per record name, how many records, the longest gap, and the share of minutes with data;
//   2. lead-in: for a session, how far before the start each collector's data reaches (an auto-recording should reach 30 minutes back);
//   3. field check: numeric fields that never change (a collector that reads a constant is not telling anything);
//   4. lead test: does a feature taken now go with the NEXT 5 minutes of volatility or movement of the Binance mark price? (Spearman rank correlation, descriptive only:
//      windows overlap, so there is no significance here, and a few hours of data prove nothing; it is the monthly judgement's first look.)
// Usage:  node analyze-collectors.mjs FILE... [--horizon 300] [--fields] [--json]      |      node analyze-collectors.mjs --selftest
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
    return { file, kind:"session", sym:j.sym, auto:!!j.pre, records:recs, t0:j.startedAt, t1:end, quality:j.quality || null };
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

// ---------- 4. lead test
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
// the Binance mark price (the `basis` records) -> for each time t, the volatility (standard deviation of the log returns between marks) and the absolute move over the next horizon
export function futureMoves(records, horizonMs) {
  const marks = records.filter(r => r[1] === "basis" && r[3] && num(r[3].mark) > 0).map(r => [r[2], r[3].mark]).sort((a, b) => a[0] - b[0]);
  const after = t => { let lo = 0, hi = marks.length; while (lo < hi) { const m = (lo + hi) >> 1; if (marks[m][0] <= t) lo = m + 1; else hi = m; } return lo; };      // first mark later than t
  const at = new Map();
  const out = t => {
    if (at.has(t)) return at.get(t);
    const lo = after(t), hi = after(t + horizonMs), w = marks.slice(lo, hi); let res = null;
    if (w.length >= 10 && w[w.length - 1][0] - t >= horizonMs*0.8) {
      const r = []; for (let i = 1; i < w.length; i++) r.push(Math.log(w[i][1]/w[i - 1][1]));
      const m = r.reduce((a, b) => a + b, 0)/r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m)**2, 0)/r.length);
      res = { vol:sd*1e4, move:Math.abs(Math.log(w[w.length - 1][1]/w[0][1]))*1e4 };      // in bps
    }
    at.set(t, res); return res;
  };
  return { out, n:marks.length };
}
export function leadTest(records, horizonMs) {
  const fm = futureMoves(records, horizonMs), byName = {};
  for (const r of records) (byName[r[1]] ||= []).push(r);
  for (const k in byName) byName[k].sort((a, b) => a[2] - b[2]);
  const rows = [];
  for (const f in FEATURES) {
    const [name, fn] = FEATURES[f], xs = [], v = [], m = [];
    for (const r of byName[name] || []) { let x = null; try { x = fn(r[3] || {}); } catch {} if (num(x) == null) continue; const fut = fm.out(r[2]); if (!fut) continue; xs.push(x); v.push(fut.vol); m.push(fut.move); }
    rows.push({ feature:f, n:xs.length, rhoVol:spearman(xs, v), rhoMove:spearman(xs, m) });
  }
  rows.sort((a, b) => Math.abs(b.rhoVol ?? 0) - Math.abs(a.rhoVol ?? 0));
  return { rows, marks:fm.n };
}

// ---------- report
const dur = ms => ms == null ? "-" : ms < 90000 ? Math.round(ms/1000) + "s" : ms < 5400000 ? Math.round(ms/MIN) + "m" : (ms/3600000).toFixed(1) + "h";
export function analyze(input, horizonMs) {
  const recs = input.records, times = recs.map(r => r[2]);
  const a = input.t0 != null ? input.t0 - 30*MIN : Math.min(...times), b = input.t1 != null ? input.t1 : Math.max(...times);
  const cov = recs.length ? coverage(recs, a, b) : null, st = recs.length ? fieldStats(recs) : {};
  return { file:input.file, kind:input.kind, window:{ from:a, to:b, minutes:cov ? cov.totalMinutes : 0 }, records:recs.length, coverage:cov, leadIn:input.t0 != null ? leadIn(recs, input.t0) : null, auto:!!input.auto, constants:constantFields(st), fields:st, lead:leadTest(recs, horizonMs) };
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
  L("\n   LEAD TEST: feature now vs the next " + (r.horizonMin) + " minutes of the Binance mark (Spearman rank correlation; descriptive only; " + r.lead.marks + " mark prices)");
  if (r.lead.marks < 120) L("   not enough mark prices (need the `basis` collector for 20+ minutes)");
  else { L("   " + "feature".padEnd(32) + "n".padEnd(8) + "vs volatility".padEnd(16) + "vs abs move"); for (const x of r.lead.rows) L("   " + x.feature.padEnd(32) + String(x.n).padEnd(8) + String(x.rhoVol ?? "-").padEnd(16) + String(x.rhoMove ?? "-") + (x.n < 200 ? "   few samples" : "")); }
}

// ---------- self-test on a synthetic tape with known structure
function selfTest() {
  let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const T0 = Date.UTC(2026, 9, 24, 0, 0, 0), recs = [], R = COLLECT.rec;
  let price = 80000; const volAt = i => (Math.floor(i/60) % 2 ? 6 : 1);      // 10 minutes calm, 10 minutes wild, in 10 s steps
  for (let i = 0; i < 360*3; i++) {      // 3 hours of 10 s steps
    const t = T0 + i*10000, v = volAt(i + 30);      // `v` is what the market will be doing 5 minutes (30 steps) from now
    price *= Math.exp((rnd() - .5)*2e-5*volAt(i));
    recs.push(R("basis", t, { mark:price, index:price, bps:0 }));
    recs.push(R("dvol", t, { vol:30 + 10*v + rnd()*2, idx:price }));      // leads volatility by construction
    recs.push(R("hlCtx", t, { fund:0.0000125, oi:1000 + rnd(), prem:rnd()*1e-4 }));      // fund is constant, prem is noise
  }
  for (let i = 0; i < 120; i++) recs.push(R("venues", T0 + 3600000 + i*1000, { cb:{ l:80000 }, bnS:{ b:79999, a:80001 } }));      // a recording hour with a 2-minute gap
  const gone = recs.filter(r => r[1] !== "venues" || r[2] < T0 + 3600000 + 50000 || r[2] > T0 + 3600000 + 70000);
  const cov = coverage(gone, T0, T0 + 3*3600000), v = cov.owners.venues, d = cov.owners.derivs, w = cov.owners.wallets, o = cov.owners.options;
  const lead = leadIn(gone, T0 + 3600000), st = fieldStats(gone), consts = constantFields(st), lt = leadTest(gone, 300000);
  const row = f => lt.rows.find(x => x.feature === f);
  const sp1 = spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const checks = [
    ["venues: 99 records, one 22 s gap", v && v.n === 99 && v.maxGapMs === 22000],
    ["venues: minutes with data counts only the minute that has some", v && v.minutes === 2],
    ["derivs: every 10 s step counted, no gap above 10 s", d && d.maxGapMs === 10000 && d.onTimePct === 100],
    ["dvol counts as options; no wallets records means no wallets coverage", o && o.n === 1080 && w === undefined],
    ["lead-in: derivs start 60 minutes before the recording, venues at its start", lead.derivs === 60 && lead.venues === 0],
    ["constant field found (hlCtx.fund), noisy ones not", consts.some(c => c.startsWith("hlCtx.fund ")) && !consts.some(c => c.startsWith("hlCtx.prem"))],
    ["lead test: dvol leads volatility by construction, rank correlation high", row("dvol.vol") && row("dvol.vol").rhoVol > 0.5],
    ["lead test: noise has no such relation", row("hlCtx.prem") && Math.abs(row("hlCtx.prem").rhoVol) < 0.25],
    ["lead test: the ranking puts dvol first", lt.rows[0].feature === "dvol.vol"],
    ["spearman: perfectly reversed is -1, fewer than 30 points is null", sp1 === -1 && spearman([1, 2], [2, 1]) === null],
  ];
  let bad = 0; for (const [name, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + name); if (!ok) bad++; }
  if (bad) { console.log(JSON.stringify({ v, d, lead, consts, rows:lt.rows.slice(0, 4) })); process.exit(1); }
  console.log("\nall " + checks.length + " checks passed");
}

// ---------- main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) selfTest();
  else {
    const hi = args.indexOf("--horizon"), horizon = hi >= 0 ? +args[hi + 1] : 300, files = args.filter((x, i) => !x.startsWith("--") && !(hi >= 0 && i === hi + 1));
    if (!files.length) { console.error("usage: node analyze-collectors.mjs FILE... [--horizon 300] [--fields] [--json]   |   node analyze-collectors.mjs --selftest"); process.exit(1); }
    const results = files.map(f => Object.assign(analyze(readInput(f), horizon*1000), { horizonMin:+(horizon/60).toFixed(1) }));
    if (args.includes("--json")) console.log(JSON.stringify(results, null, 1));
    else for (const r of results) print(r, args.includes("--fields"));
  }
}
