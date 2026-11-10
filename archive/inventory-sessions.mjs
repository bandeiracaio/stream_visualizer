// Data-quality inventory of the saved sessions (descriptive; no detector, no outcome statistics).
//   node inventory-sessions.mjs [DIR=sessions] [--out .scratch/data-inventory/inventory-20261108] [--cutoff 2026-11-06T03:15:00Z] [--quiet]
//   node inventory-sessions.mjs --selftest
// Reads ONE session file at a time (gunzip, parse, summarise, drop), so memory stays at one file. Writes <out>.md and <out>.json
// (one compact row per session). It never reads a liquidation outcome: it only counts what each file carries.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import os from "node:os";

const CUTOFF_ISO = "2026-11-06T03:15:00Z";   // the liquidation plan's cutoff (.scratch/liquidation-study/plan.md); a count only, nothing is tested here
const HOUR = 3600e3;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const r2 = x => x == null ? null : Math.round(x * 100) / 100;

// sigma of a Binance mid series, as in docs/adr/0004: overlapping 15 s returns (bps), MAD scaled by 1.1503 (the 75th percentile of |dev|), over sqrt(15)
function sigmaFromSeries(sec) {      // sec: [[tSec, mid], ...] one point a second, ascending
  const rets = [];
  for (let i = 0; i + 15 < sec.length; i++) { const p0 = sec[i][1], p1 = sec[i + 15][1]; if (p0 > 0 && p1 > 0) rets.push((p1 / p0 - 1) * 1e4); }
  if (rets.length < 60) return null;
  const med = median(rets), dev = rets.map(x => Math.abs(x - med)).sort((a, b) => a - b), q75 = dev[Math.floor(0.75 * (dev.length - 1))];
  return q75 / 1.1503 / Math.sqrt(15);
}
function perSecond(points) {      // [[ms, px]] ascending -> last price of each second, forward-filled
  const out = []; let last = null, cur = null;
  for (const [t, p] of points) {
    const s = Math.floor(t / 1000);
    if (cur == null) { cur = s; last = p; continue; }
    while (cur < s) { out.push([cur, last]); cur++; }
    last = p;
  }
  if (cur != null) out.push([cur, last]);
  return out;
}

// One session object -> one compact row. No outcome of any kind is computed.
export function summarise(j, file) {
  const inputs = j.inputs || [], ext = j.ext || [], q = j.quality || null;
  const kinds = { q: 0, b: 0, a: 0, t: 0, s: 0 }, tradesBy = {}, bnMid = [];
  let tMin = Infinity, tMax = -Infinity, liqFlag = 0;
  for (const r of inputs) {
    const k = r[0]; if (k in kinds) kinds[k]++;
    let t;
    if (k === "t") { const o = r[1] || {}; t = o.t; tradesBy[o.v] = (tradesBy[o.v] || 0) + 1; if (o.liq) liqFlag++; }
    else t = k === "a" ? r[1] : r[2];
    if (Number.isFinite(t)) { if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
    if (k === "q" && r[1] === "bn" && r[3] > 0 && r[4] > 0) bnMid.push([r[2], (r[3] + r[4]) / 2]);
  }
  const started = Number.isFinite(j.startedAt) ? j.startedAt : null;      // the trigger (auto) or the Record press; inputs and quality start earlier (the lead-in)
  const t0 = q && Number.isFinite(q.t0) ? q.t0 : (tMin < Infinity ? tMin : started);
  const t1 = tMax > -Infinity ? tMax : (q && Number.isFinite(q.t1) ? q.t1 : null);
  const spanMin = q && Number.isFinite(q.spanMin) ? q.spanMin : (t0 != null && t1 != null ? (t1 - t0) / 60000 : 0);
  // ext records: type counts, liquidation rows, reconnects
  const extN = {}, liq = { binance: 0, bybitOkx: 0, hlLiq: 0, bybit: 0, okx: 0 };
  let reconnects = null;
  for (const r of ext) {
    if (!Array.isArray(r) || r[0] !== "c") continue;
    const name = r[1]; extN[name] = (extN[name] || 0) + 1;
    if (name === "liq") liq.binance++;
    else if (name === "hlLiq") liq.hlLiq++;
    else if (name === "liqPerp") { const rows = (r[3] && r[3].rows) || []; liq.bybitOkx += rows.length; if (r[3] && r[3].v === "by") liq.bybit += rows.length; else if (r[3] && r[3].v === "ok") liq.okx += rows.length; }
    else if (name === "feeds" && r[3] && r[3].reconnects) reconnects = r[3].reconnects;      // cumulative in the page, so the last reading is the count
  }
  // health notes
  const health = j.health || [], hk = {}; let gapMaxMs = 0;
  for (const h of health) { hk[h.k] = (hk[h.k] || 0) + 1; if (h.k === "gap" && h.d && h.d.gapMs > gapMaxMs) gapMaxMs = h.d.gapMs; }
  // collectors (from quality, v111+)
  const cols = {}, qc = q && q.collectors ? q.collectors : null;
  if (qc) for (const [k, v] of Object.entries(qc)) cols[k] = { state: v.state, n: v.n, min: v.min, of: v.of, gapSec: v.gapSec };
  // sigma during the recording (bps per root second) and, for an auto-recording, at the trigger and over the lead-in
  const sig = sigmaFromSeries(perSecond(bnMid));
  const pre = j.pre || null;
  let leadSig = null;
  if (pre && Array.isArray(pre.prices) && pre.prices.length > 100) { const pts = pre.prices.filter(p => Array.isArray(p) && p[1] > 0).map(p => [p[0] * 1000, p[1]]); leadSig = sigmaFromSeries(perSecond(pts)); }      // prices are [second, price]
  const d0 = t0 != null ? new Date(t0) : null;
  return {
    file: path.basename(file), t0, startedAt: started, startUtc: d0 ? d0.toISOString().slice(0, 16) + "Z" : null, hourUtc: d0 ? d0.getUTCHours() : null,
    spanMin: r1(spanMin), auto: !!pre, why: pre ? pre.why || null : null,
    verdict: q ? q.verdict || null : null, longestGapSec: q ? q.longestGapSec ?? null : null, dataMinutes: q ? q.dataMinutes ?? null : null, clock: q ? q.clock ?? null : null,
    hasExt: ext.length > 0, hasQuality: !!q, collectors: cols, ext: extN,
    inputs: { q: kinds.q, b: kinds.b, t: kinds.t, s: kinds.s, a: kinds.a, tradesBy, liqFlagged: liqFlag },
    liq, reconnects, health: { n: health.length, kinds: hk, gapMaxMs },
    sigma: r2(sig), leadInSigma: r2(leadSig), trigRatio: pre && Number.isFinite(pre.ratio) ? r2(pre.ratio) : null, trigSigma: pre && Number.isFinite(pre.fast) ? r2(pre.fast) : null,
    t1,
  };
}

export function readSummary(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const j = JSON.parse(buf.toString("utf8")); buf = null;
  if (j.kind !== "sv-session") return null;
  return summarise(j, file);      // `j` is dropped on return: one file in memory at a time
}

// Aggregate the rows.
export function aggregate(rows, cutoffIso = CUTOFF_ISO) {
  const cutoff = Date.parse(cutoffIso), afterC = r => (r.startedAt ?? r.t0) >= cutoff;      // by the trigger / Record press, like the liquidation plan's "started after"
  const sorted = [...rows].sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0));
  const hours = r => (r.spanMin || 0) / 60;
  const tot = sorted.reduce((a, r) => a + hours(r), 0);
  const byDay = {}, byHour = Array(24).fill(0), byDayHour = {};
  for (const r of sorted) {      // spread the span over the UTC hours it covers
    if (r.t0 == null) continue; const end = r.t0 + (r.spanMin || 0) * 60000;
    for (let t = r.t0; t < end;) {
      const hb = Math.floor(t / HOUR) * HOUR, nxt = Math.min(end, hb + HOUR), h = (nxt - t) / HOUR, d = new Date(hb).toISOString().slice(0, 10), hh = new Date(hb).getUTCHours();
      byDay[d] = (byDay[d] || 0) + h; byHour[hh] += h; (byDayHour[d] ||= Array(24).fill(0))[hh] += h; t = nxt;
    }
  }
  let unionMs = 0, curS = null, curE = null;      // hours with at least one recording (the lead-in of one auto-recording can overlap the one before)
  for (const r of sorted) { if (r.t0 == null) continue; const e = r.t0 + (r.spanMin || 0) * 60000; if (curE == null || r.t0 > curE) { if (curE != null) unionMs += curE - curS; curS = r.t0; curE = e; } else if (e > curE) curE = e; }
  if (curE != null) unionMs += curE - curS;
  const auto = sorted.filter(r => r.auto), hand = sorted.filter(r => !r.auto);
  const sum = a => a.reduce((x, r) => x + hours(r), 0);
  // ext types: sessions / hours / earliest / latest
  const extStat = {};
  for (const r of sorted) for (const k of Object.keys(r.ext || {})) { const e = (extStat[k] ||= { sessions: 0, hours: 0, records: 0, first: null, afterCutoff: 0 }); e.sessions++; e.hours += hours(r); e.records += r.ext[k]; if (e.first == null || r.t0 < e.first) e.first = r.t0; if (afterC(r)) e.afterCutoff++; }
  // collectors from quality
  const colStat = {};
  for (const r of sorted) for (const [k, v] of Object.entries(r.collectors || {})) { const e = (colStat[k] ||= { ok: 0, holes: 0, none: 0, hoursOk: 0, hoursAny: 0, firstSeen: null }); e[v.state] = (e[v.state] || 0) + 1; if (v.state !== "none") { e.hoursAny += hours(r); if (e.firstSeen == null || r.t0 < e.firstSeen) e.firstSeen = r.t0; } if (v.state === "ok") e.hoursOk += hours(r); }
  const withQ = sorted.filter(r => r.hasQuality), verdicts = {};
  for (const r of withQ) verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
  const holes = sorted.filter(r => Object.values(r.collectors || {}).some(v => v.state === "holes"));
  const gaps = sorted.filter(r => r.health && r.health.gapMaxMs > 30000);
  // duplicates and overlaps (by time; a start within a minute of another is flagged)
  const dups = [], overlaps = []; const seen = new Map();
  for (const r of sorted) { if (r.t0 == null) continue; const k = Math.round(r.t0 / 1000); if (seen.has(k)) dups.push([seen.get(k), r.file]); else seen.set(k, r.file); }
  for (let i = 1; i < sorted.length; i++) { const a = sorted[i - 1], b = sorted[i]; if (a.t0 == null || b.t0 == null) continue; const aEnd = a.t0 + (a.spanMin || 0) * 60000; if (b.t0 < aEnd - 5000) overlaps.push({ a: a.file, b: b.file, overlapMin: r1((aEnd - b.t0) / 60000) }); }
  const sameName = {}; for (const r of sorted) (sameName[r.file] ||= []).push(r.file);
  // volatility bias: per-recording sigma against the sigma of the lead-in (auto) and across kinds
  const sA = auto.map(r => r.sigma).filter(Number.isFinite), sH = hand.map(r => r.sigma).filter(Number.isFinite);
  const lead = auto.filter(r => Number.isFinite(r.sigma) && Number.isFinite(r.leadInSigma)), ratios = lead.map(r => r.sigma / r.leadInSigma);
  const trigR = auto.map(r => r.trigRatio).filter(Number.isFinite), trigS = auto.map(r => r.trigSigma).filter(Number.isFinite);
  const why = {}; for (const r of auto) why[r.why || "?"] = (why[r.why || "?"] || 0) + 1;
  // what each analysis can use
  const after = sorted.filter(afterC), has = (r, k) => (r.ext && r.ext[k] > 0), cleanQ = r => r.verdict === "complete";
  const uses = (label, pred) => { const a = sorted.filter(pred), c = a.filter(afterC); return { label, sessions: a.length, hours: r1(sum(a)), afterCutoffSessions: c.length, afterCutoffHours: r1(sum(c)) }; };
  const analyses = [
    uses("any collector data (ext)", r => r.hasExt),
    uses("quality verdict complete", cleanQ),
    uses("liqPerp (Bybit + OKX liquidations)", r => has(r, "liqPerp")),
    uses("liqPerp with at least one row", r => (r.liq.bybitOkx || 0) > 0),
    uses("Binance liq records", r => (r.liq.binance || 0) > 0),
    uses("liqPerp + complete (liquidation study inputs)", r => has(r, "liqPerp") && cleanQ(r)),
    uses("book depth Binance (bookBn) and Hyperliquid (bookHl)", r => has(r, "bookBn") && has(r, "bookHl")),
    uses("cross-venue prices (venues)", r => has(r, "venues")),
    uses("basis / funding / open interest (basis, bnDerivs, oiPerp)", r => has(r, "basis") && has(r, "bnDerivs")),
    uses("open interest Bybit/OKX (oiPerp)", r => has(r, "oiPerp")),
    uses("Hyperliquid wallets (walletsTop)", r => has(r, "walletsTop")),
    uses("options (dvol + optChain)", r => has(r, "dvol") && has(r, "optChain")),
    uses("tradeVol (tv)", r => has(r, "tv")),
    uses("trades and quotes for the Reader replay (inputs)", r => r.inputs.t > 0),
  ];
  return {
    cutoffIso, sessions: sorted.length, totalHours: r1(tot), uniqueHours: r1(unionMs / HOUR), withExt: sorted.filter(r => r.hasExt).length, withQuality: withQ.length, from: sorted[0]?.startUtc || null, to: sorted[sorted.length - 1]?.startUtc || null,
    auto: { sessions: auto.length, hours: r1(sum(auto)) }, hand: { sessions: hand.length, hours: r1(sum(hand)) }, autoShare: sorted.length ? r2(auto.length / sorted.length) : null, autoWhy: why,
    afterCutoff: { sessions: after.length, hours: r1(sum(after)) }, verdicts, sessionsWithHoles: holes.map(r => r.file), sessionsWithBigGap: gaps.map(r => ({ file: r.file, gapMaxMs: r.health.gapMaxMs })),
    byDay: Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, r1(v)])), byHourUtc: byHour.map(r1), byDayHour: Object.fromEntries(Object.entries(byDayHour).map(([k, v]) => [k, v.map(r1)])),
    extStat: Object.fromEntries(Object.entries(extStat).sort().map(([k, v]) => [k, { ...v, hours: r1(v.hours), first: v.first ? new Date(v.first).toISOString().slice(0, 16) + "Z" : null }])),
    colStat: Object.fromEntries(Object.entries(colStat).sort().map(([k, v]) => [k, { ...v, hoursOk: r1(v.hoursOk), hoursAny: r1(v.hoursAny), firstSeen: v.firstSeen ? new Date(v.firstSeen).toISOString().slice(0, 16) + "Z" : null }])),
    duplicates: dups, overlaps,
    volatility: {
      sigmaMedianAuto: r2(median(sA)), sigmaMedianHand: r2(median(sH)), nAuto: sA.length, nHand: sH.length,
      recordingOverLeadInMedian: r2(median(ratios)), nLead: ratios.length, trigRatioMedian: r2(median(trigR)), trigSigmaMedian: r2(median(trigS)),
      note: "sigma = bps per root second from Binance quote mids (15 s overlapping returns, ADR 0004). Auto-recordings start when the last 5 minutes are volatile, so their lead-in and trigger sigma are the selection; the ratio shows how far the recording stays above its own lead-in.",
    },
    analyses,
  };
}

const fmt = (n, w) => String(n ?? "-").padStart(w);
export function renderMd(rows, A) {
  const L = []; const p = s => L.push(s);
  p("# Data-quality inventory of the saved sessions"); p("");
  p(`Generated by \`node inventory-sessions.mjs\` (descriptive; counts only, no outcome statistics). ${A.sessions} sessions, ${A.from} to ${A.to} (UTC), **${A.totalHours} recorded hours** (${A.uniqueHours} h unique: an auto-recording's lead-in can overlap the one before). Session times are the first input (lead-in included), not the trigger. Liquidation-plan cutoff ${A.cutoffIso}: ${A.afterCutoff.sessions} sessions / ${A.afterCutoff.hours} h have a trigger (startedAt) after it.`); p("");
  p("## Kinds"); p("");
  p(`- Auto-recordings (carry \`pre\`): ${A.auto.sessions} sessions, ${A.auto.hours} h (${Math.round((A.autoShare || 0) * 100)}% of sessions). Hand-made: ${A.hand.sessions} sessions, ${A.hand.hours} h.`);
  p(`- Auto trigger reasons: ${Object.entries(A.autoWhy).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  p(`- With collector data (\`ext\`): ${A.withExt}; with \`quality\`: ${A.withQuality}. Quality verdicts: ${Object.entries(A.verdicts).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  p(`- Sessions where a collector had holes: ${A.sessionsWithHoles.length}. Sessions with a timer gap over 30 s: ${A.sessionsWithBigGap.length}.`); p("");
  p("## Volatility bias"); p("");
  const V = A.volatility;
  p(`- Median sigma during the recording (bps per root second): auto ${V.sigmaMedianAuto} (n ${V.nAuto}), hand-made ${V.sigmaMedianHand} (n ${V.nHand}). Trigger sigma (last 5 min, auto): median ${V.trigSigmaMedian}; trigger ratio to the hour's volatility: median ${V.trigRatioMedian}.`);
  p(`- Recording sigma over its own 30-minute lead-in sigma, median ${V.recordingOverLeadInMedian} (n ${V.nLead}).`);
  p(`- ${V.note}`); p("");
  p("## What each analysis can use today"); p("");
  p("| data | sessions | hours | after cutoff: sessions | hours |"); p("|---|---:|---:|---:|---:|");
  for (const a of A.analyses) p(`| ${a.label} | ${a.sessions} | ${a.hours} | ${a.afterCutoffSessions} | ${a.afterCutoffHours} |`);
  p("");
  p("## Collector records (ext) by type"); p(""); p("| record | sessions | hours | records | earliest session | after cutoff |"); p("|---|---:|---:|---:|---|---:|");
  for (const [k, v] of Object.entries(A.extStat)) p(`| ${k} | ${v.sessions} | ${v.hours} | ${v.records} | ${v.first} | ${v.afterCutoff} |`);
  p(""); p("## Collector state by quality (v111+ files only)"); p(""); p("| collector | ok | holes | none | hours ok | hours with data | first seen |"); p("|---|---:|---:|---:|---:|---:|---|");
  for (const [k, v] of Object.entries(A.colStat)) p(`| ${k} | ${v.ok} | ${v.holes} | ${v.none} | ${v.hoursOk} | ${v.hoursAny} | ${v.firstSeen} |`);
  p(""); p("## Hours by day (UTC)"); p(""); p("| day | hours |"); p("|---|---:|");
  for (const [k, v] of Object.entries(A.byDay)) p(`| ${k} | ${v} |`);
  p(""); p("## Hours by hour of day (UTC, all days)"); p(""); p("| hour | " + Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).join(" | ") + " |"); p("|---|" + "---:|".repeat(24));
  p("| hours | " + A.byHourUtc.join(" | ") + " |"); p("");
  p("## Coverage grid (UTC day x hour, hours recorded; blank = none)"); p(""); p("```");
  p("day        " + Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).join(" "));
  for (const [d, a] of Object.entries(A.byDayHour)) p(d + " " + a.map(v => v >= 0.95 ? " #" : v >= 0.5 ? " +" : v > 0.05 ? " ." : "  ").join(" "));
  p("```"); p("# full hour, + half or more, . some"); p("");
  p("## Duplicates and overlaps"); p("");
  p(A.duplicates.length ? A.duplicates.map(d => `- same start second: ${d[0]} and ${d[1]}`).join("\n") : "- no two sessions share a start second.");
  p(A.overlaps.length ? A.overlaps.map(o => `- overlap ${o.overlapMin} min: ${o.a} ends after ${o.b} starts`).join("\n") : "- no session overlaps the one before it.");
  p(""); p("## Sessions with collector holes or big timer gaps"); p("");
  p(A.sessionsWithHoles.length ? "Holes: " + A.sessionsWithHoles.join(", ") : "No collector holes in the quality rating.");
  p(A.sessionsWithBigGap.length ? "\nTimer gaps over 30 s: " + A.sessionsWithBigGap.map(g => `${g.file} (${Math.round(g.gapMaxMs / 1000)} s)`).join(", ") : "");
  p(""); p("## One row per session"); p(""); p("```");
  p("start (UTC)         span  kind  verdict   gap  sigma lead  trades   quotes  books  liqBn liqPerp liqHl rc(bn/hl) holes");
  for (const r of [...rows].sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0))) {
    const hl = Object.entries(r.collectors || {}).filter(([, v]) => v.state === "holes").map(([k]) => k).join(",");
    p(`${(r.startUtc || "?").padEnd(17)} ${fmt(r.spanMin, 6)}  ${(r.auto ? "auto" : "hand").padEnd(4)}  ${String(r.verdict || "-").padEnd(8)} ${fmt(r.longestGapSec, 4)} ${fmt(r.sigma, 6)} ${fmt(r.leadInSigma, 5)} ${fmt(r.inputs.t, 7)} ${fmt(r.inputs.q, 8)} ${fmt(r.inputs.b, 6)} ${fmt(r.liq.binance, 5)} ${fmt(r.liq.bybitOkx, 7)} ${fmt(r.liq.hlLiq, 5)} ${r.reconnects ? `${r.reconnects.bn ?? 0}/${r.reconnects.hl ?? 0}` : "-"}`.padEnd(120) + " " + hl);
  }
  p("```"); p("");
  return L.join("\n");
}

function selftest() {
  const checks = []; const ok = (n, c) => checks.push([n, !!c]);
  const t0 = Date.parse("2026-11-07T10:30:00Z"), mk = (n, auto, withExt, extra = {}) => {
    const inputs = [], px = i => 100000 + Math.sin(i / 30) * 40;
    for (let i = 0; i < 400; i++) { inputs.push(["q", "bn", t0 + n + i * 1000, px(i) - 0.5, px(i) + 0.5]); if (i % 4 === 0) inputs.push(["t", { t: t0 + n + i * 1000, v: i % 8 === 0 ? "bn" : "hl", side: "buy", px: px(i), q: 1, ntl: 1e5, liq: i === 8 }]); if (i % 50 === 0) inputs.push(["b", "bn", t0 + n + i * 1000, [[px(i), 1]]]); inputs.push(["a", t0 + n + i * 1000]); }
    const ext = withExt ? [["c", "liq", t0 + 5000, { side: "BUY" }], ["c", "liqPerp", t0 + 6000, { v: "by", rows: [{ t: 1 }, { t: 2 }] }], ["c", "liqPerp", t0 + 7000, { v: "ok", rows: [{ t: 3 }] }], ["c", "hlLiq", t0 + 8000, {}], ["c", "feeds", t0 + 9000, { reconnects: { bn: 1, hl: 3 } }], ["c", "feeds", t0 + 19000, { reconnects: { bn: 2, hl: 5 } }]] : [];
    const j = { kind: "sv-session", v: 1, sym: "BTC", startedAt: t0 + n, baseline: {}, inputs, ...(withExt ? { ext, quality: { spanMin: 6.7, verdict: "complete", longestGapSec: 1, dataMinutes: 7, collectors: { book: { state: "ok", n: 5, min: 7, of: 7, gapSec: 2 }, wallets: { state: "holes", n: 1, min: 1, of: 7, gapSec: 90 } } }, health: [{ t: 1, k: "gap", d: { gapMs: 41000 } }] } : {}), ...(auto ? { pre: { at: t0, why: "volatility", fast: 1.5, slow: 0.5, ratio: 3, prices: [] } } : {}), ...extra };
    return j;
  };
  const a = summarise(mk(0, true, true), "a.json.gz"), b = summarise(mk(0, false, false), "b.json.gz");
  ok("auto when pre is present, hand-made otherwise", a.auto && !b.auto);
  ok("counts trades, quotes, books and the liquidation flag", a.inputs.t === 100 && a.inputs.q === 400 && a.inputs.b === 8 && a.inputs.liqFlagged === 1 && a.inputs.tradesBy.bn === 50);
  ok("liquidation counts: Binance records, Bybit+OKX rows, Hyperliquid", a.liq.binance === 1 && a.liq.bybitOkx === 3 && a.liq.bybit === 2 && a.liq.okx === 1 && a.liq.hlLiq === 1);
  ok("reconnects are the last cumulative reading", a.reconnects.bn === 2 && a.reconnects.hl === 5);
  ok("start, hour of day and quality come through", a.startUtc === "2026-11-07T10:30Z" && a.hourUtc === 10 && a.verdict === "complete" && a.collectors.wallets.state === "holes");
  ok("timer gap noted", a.health.gapMaxMs === 41000);
  ok("a file with no ext or quality still summarises", !b.hasExt && !b.hasQuality && b.spanMin > 6 && Number.isFinite(b.sigma));
  const c = summarise(mk(1000, true, true), "c.json.gz"), d = summarise(mk(300000, false, true), "d.json.gz");   // c starts 1 s after a (overlap), d 5 min in
  const A = aggregate([a, b, c, d], "2026-11-07T10:30:00Z");
  ok("totals and kinds", A.sessions === 4 && A.auto.sessions === 2 && A.hand.sessions === 2 && A.autoShare === 0.5);
  ok("overlap found, no false duplicate", A.overlaps.length >= 2 && A.duplicates.length === 1);      // a and b share a start second
  ok("holes and gaps listed", A.sessionsWithHoles.length === 3 && A.sessionsWithBigGap.length === 3);
  ok("hours spread over the UTC hours", Math.abs(A.byHourUtc[10] - A.totalHours) < 0.2 && Object.keys(A.byDay)[0] === "2026-11-07");
  ok("ext statistics and the cutoff split", A.extStat.liqPerp.sessions === 3 && A.extStat.liqPerp.afterCutoff === 3 && A.analyses.find(x => x.label.startsWith("liqPerp (")).sessions === 3);
  ok("sigma is positive for a moving price", a.sigma > 0);
  const md = renderMd([a, b, c, d], A); ok("markdown renders the tables", /What each analysis can use/.test(md) && /Coverage grid/.test(md));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-")); fs.writeFileSync(path.join(dir, "s.json.gz"), zlib.gzipSync(JSON.stringify(mk(0, true, true))));
  const rr = readSummary(path.join(dir, "s.json.gz")); ok("reads a gzip file", rr && rr.auto && rr.liq.bybitOkx === 3); fs.rmSync(dir, { recursive: true, force: true });
  for (const [n, c2] of checks) console.log((c2 ? "  pass  " : "  FAIL  ") + n);
  const bad = checks.filter(x => !x[1]).length; console.log(bad ? bad + " failed" : "all " + checks.length + " passed"); process.exit(bad ? 1 : 0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const flagged = new Set(["--out", "--cutoff"]); const pos = args.filter((a, i) => !a.startsWith("--") && !flagged.has(args[i - 1]));
  const dir = pos[0] || "sessions", out = opt("--out", ".scratch/data-inventory/inventory-20261108"), cutoff = opt("--cutoff", CUTOFF_ISO), quiet = args.includes("--quiet");
  const files = fs.readdirSync(dir).filter(f => /^session_.*\.json(\.gz)?$/.test(f)).sort();
  const rows = []; let i = 0;
  for (const f of files) {
    i++; try { const r = readSummary(path.join(dir, f)); if (r) rows.push(r); } catch (e) { console.error("skip " + f + ": " + e.message); }
    if (!quiet && i % 20 === 0) console.error(`  ${i}/${files.length}`);
  }
  const A = aggregate(rows, cutoff), md = renderMd(rows, A);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out + ".md", md); fs.writeFileSync(out + ".json", JSON.stringify({ generated: new Date().toISOString(), aggregate: A, rows }));
  console.log(md);
  console.error(`wrote ${out}.md and ${out}.json`);
}
if (import.meta.url === new URL(process.argv[1], "file:///").href || process.argv[1]?.endsWith("inventory-sessions.mjs")) main();
