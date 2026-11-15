// Episode outcomes: the event study registered in .scratch/episode-outcomes/plan.md. Offline, not part of the app.
// For every absorption / exhaustion episode group (bursts beside them) it measures the Binance move after detection at six horizons, signed by the aggressor,
// against control moments of the same run, and reports mean differences with intervals from a bootstrap over UTC days.
//
//   node episode-outcomes.mjs [sessions/]                   the exploration set (inputs before the cut): results are exploratory, not evidence
//   node episode-outcomes.mjs [sessions/] --count           the test set, counts only (hours, runs, episodes per family): the one look the plan allows before the run
//   node episode-outcomes.mjs [sessions/] --confirm-test    the test set, results. ONCE, when the plan's conditions hold.
//   node episode-outcomes.mjs --selftest
//   options: --out file.json (every episode with its results)   --limit N (first N runs, exploration only)   --boot N (resamples, default 10000)
//
// Detections come from the Reader frozen at FROZEN (git show, so the working tree does not matter), default configuration.
// A recording is a run: the chunks of one run in order, or one old session file by itself.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./compare-detections.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FROZEN = "5c10923";
export const CUT = Date.parse("2026-11-16T00:00:00Z");
export const P = {
  delayMs: 2000,                                                  // detection to the start price
  horizons: [10, 30, 60, 300, 900, 3600],                         // seconds
  families: ["absorption", "exhaustion", "burst"], primary: ["absorption", "exhaustion"],
  nControls: 20, minControls: 5, nearMs: 2 * 3600e3, sigmaFactor: 1.5, priorSec: 60, priorTol: 0.5,
  awayMs: 60e3,                                                   // a control is at least this far from its own episode's start (amendment 1)
  tolMs: 5000,                                                    // a price is read from the one-a-second snapshots: the first at or after the wanted time, at most this late
  minDays: 10,                                                    // a cell with fewer UTC days gets no verdict (amendment 1)
  costBps: 11, aliveBps: 3, closedHalfBps: 3, boot: 10000, seed: 20261115,
};

// ---------- small tools ----------
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
const quant = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))] : null;
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const hLabel = s => s < 60 ? s + " s" : s / 60 + " min";

// ---------- measurement (pure: a price series and a list of episodes in, results out) ----------
// series: {t: [ms...], px: [...], sg: [...]} in time order (Binance mid and the engine's Binance sigma, about one a second).
// episodes: [{id, family, dir (+1 buyer is the aggressor, -1 seller), tDetected, ...}]. from / to: only moments in [from, to) are used as starts (episodes and controls).
export function measure(series, episodes, opt = {}) {
  const o = Object.assign({}, P, opt), T = series.t, PX = series.px, SG = series.sg, n = T.length, from = opt.from ?? -Infinity, to = opt.to ?? Infinity, key = String(opt.key || "");
  const atOrAfter = t => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; } return lo < n && T[lo] - t <= o.tolMs ? lo : -1; };
  const atOrBefore = t => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m + 1; else hi = m; } return lo > 0 && t - T[lo - 1] <= o.tolMs ? lo - 1 : -1; };
  // the move of the 60 s before moment i, in sigma units (unsigned by direction), and the results after it in bps (unsigned)
  const prior = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { const j = atOrBefore(T[i] - o.priorSec * 1000); if (j >= 0 && SG[i] > 0) prior[i] = (PX[i] / PX[j] - 1) * 1e4 / (SG[i] * Math.sqrt(o.priorSec)); }
  const fwd = (i, h) => { const j = atOrAfter(T[i] + h * 1000); return j < 0 ? null : (PX[j] / PX[i] - 1) * 1e4; };
  const out = [];
  for (const ep of episodes) {
    const i = atOrAfter(ep.tDetected + o.delayMs), r = { id: ep.id, family: ep.family, dir: ep.dir, tDetected: ep.tDetected, run: key, size: ep.size ?? null, venues: ep.venues || null, why: "" };
    out.push(r);
    if (i < 0 || !(T[i] >= from && T[i] < to)) { r.why = i < 0 ? "no price at the start" : "outside the set"; continue; }
    if (!(SG[i] > 0) || Number.isNaN(prior[i])) { r.why = "no sigma or no price 60 s before"; continue; }
    r.t = T[i]; r.day = dayOf(T[i]); r.sigma = SG[i]; r.prior = ep.dir * prior[i];
    // candidates: plain = near in time, similar sigma, away from the episode itself; matched = also a similar signed move before
    const pick = wide => {
      const plain = [], matched = [];
      for (let k = 0; k < n; k++) {
        const dt = Math.abs(T[k] - T[i]); if (dt < o.awayMs || (!wide && dt > o.nearMs) || !(T[k] >= from && T[k] < to)) continue;
        if (!(SG[k] > 0) || SG[k] > SG[i] * o.sigmaFactor || SG[k] < SG[i] / o.sigmaFactor || Number.isNaN(prior[k])) continue;
        plain.push(k); if (Math.abs(ep.dir * prior[k] - r.prior) <= o.priorTol) matched.push(k);
      }
      return { plain, matched };
    };
    let c = pick(false); const widened = { plain: false, matched: false };
    if (c.plain.length < o.nControls || c.matched.length < o.nControls) { const w = pick(true); if (c.plain.length < o.nControls) { c.plain = w.plain; widened.plain = true; } if (c.matched.length < o.nControls) { c.matched = w.matched; widened.matched = true; } }
    const rnd = rng(hash(key + "|" + ep.id + "|" + o.seed));
    const draw = list => { const a = list.slice(), m = Math.min(o.nControls, a.length); for (let x = 0; x < m; x++) { const y = x + Math.floor(rnd() * (a.length - x)); const tmp = a[x]; a[x] = a[y]; a[y] = tmp; } return a.slice(0, m); };
    const ctl = { matched: c.matched.length >= o.minControls ? draw(c.matched) : null, plain: c.plain.length >= o.minControls ? draw(c.plain) : null };
    r.nCtl = { matched: c.matched.length, plain: c.plain.length }; r.widened = widened; r.res = {}; r.ctl = { matched: {}, plain: {} }; r.d = { matched: {}, plain: {} }; r.ctlAll = {};
    for (const h of o.horizons) {
      const f = fwd(i, h); r.res[h] = f == null ? null : ep.dir * f;
      for (const kind of ["matched", "plain"]) {
        const vals = ctl[kind] ? ctl[kind].map(k => fwd(k, h)).filter(x => x != null).map(x => ep.dir * x) : [];
        const ok = f != null && vals.length >= o.minControls;
        r.ctl[kind][h] = ok ? mean(vals) : null; r.d[kind][h] = ok ? r.res[h] - r.ctl[kind][h] : null;
        if (kind === "plain") r.ctlAll[h] = vals;
      }
    }
  }
  return out;
}

// mean of D per cell with intervals from a bootstrap over UTC days. rows: measure() results with a day. pick(r) -> D or null.
export function cell(rows, pick, o = {}) {
  const boot = o.boot ?? P.boot, byDay = new Map(); let n = 0, sum = 0;
  for (const r of rows) { const d = pick(r); if (d == null) continue; n++; sum += d; let b = byDay.get(r.day); if (!b) { b = [0, 0]; byDay.set(r.day, b); } b[0] += d; b[1]++; }
  if (!n) return { n: 0, days: 0, mean: null };
  const days = Array.from(byDay.values()), rnd = rng((o.seed ?? P.seed) ^ hash(o.name || "")), means = [];
  for (let b = 0; b < boot; b++) { let s = 0, c = 0; for (let k = 0; k < days.length; k++) { const d = days[Math.floor(rnd() * days.length)]; s += d[0]; c += d[1]; } if (c) means.push(s / c); }
  means.sort((a, b) => a - b);
  return { n, days: days.length, mean: sum / n, lo95: quant(means, 0.025), hi95: quant(means, 0.975), lo995: quant(means, 0.0025), hi995: quant(means, 0.9975) };
}

// the plan's verdict from the 12 primary cells (family x horizon, matched control)
export function verdict(cells, o = P) {
  const alive = [], cand = [];
  for (const c of cells) {
    if (c.mean == null || c.days < o.minDays) continue;      // a bootstrap over a handful of days says nothing (amendment 1)
    if (Math.abs(c.mean) >= o.aliveBps && (c.lo995 > 0 || c.hi995 < 0)) alive.push(c);
    if (c.lo95 >= o.costBps || c.hi95 <= -o.costBps) cand.push(c);
  }
  const five = cells.filter(c => c.h === 300), tight = five.length === o.primary.length && five.every(c => c.mean != null && c.days >= o.minDays &&(c.hi95 - c.lo95) / 2 <= o.closedHalfBps);
  return { verdict: cand.length ? "trade candidate" : alive.length ? "alive" : tight ? "closed" : "underpowered", alive, cand };
}

// ---------- reading recordings ----------
const gunzipJson = f => { let b = fs.readFileSync(f); if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); return JSON.parse(b.toString("utf8")); };
function listRuns(dir) {
  const runs = new Map();
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^session_([A-Z]+)_(\d{12})(?:_run(\d+)-c(\d+))?\.json(\.gz)?$/); if (!m || m[1] !== "BTC") continue;
    const id = m[3] ? "run" + m[3] : "ses" + m[2]; if (!runs.has(id)) runs.set(id, []);
    runs.get(id).push({ file: path.join(dir, f), seq: m[4] ? +m[4] : 0 });
  }
  for (const r of runs.values()) r.sort((a, b) => a.seq - b.seq);
  return runs;
}
const inputTime = r => r[0] === "t" ? r[1] && r[1].t : r[0] === "a" ? r[1] : r[2];
let ENGINE = null, SYSTEM = null;
function frozen() {
  if (ENGINE) return;
  ENGINE = loadEngine(FROZEN).E;
  SYSTEM = vm.runInNewContext(execFileSync("git", ["show", FROZEN + ":src/js/system-core.js"], { cwd: HERE, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) + "\n;SYSTEM", {});
}
// one run: the price / sigma series and the episode groups as first seen. stopAt: inputs at or after it are not fed (the exploration set ends at the cut).
function replayRun(files, stopAt) {
  frozen();
  const e = ENGINE.create(), F = SYSTEM.facts({ engine: e, lateMs: 1000 }), s = { t: [], px: [], sg: [] }, eps = [], seen = new Set(); let t0 = null, t1 = null, holes = false, stopped = false;
  const take = snaps => {
    for (const x of snaps) {
      if (x.px.bn != null) { s.t.push(x.t); s.px.push(x.px.bn); s.sg.push(x.calibrated ? x.sigma.bn : 0); }
      if (!x.episodes.new.length) continue;
      const groups = e.episodeGroups();
      for (const nw of x.episodes.new) {
        if (seen.has(nw.id) || !P.families.includes(nw.family) || !nw.side) continue; seen.add(nw.id);
        const g = groups.find(q => q.id === nw.id), fa = g && g.facts || {};
        eps.push({ id: nw.id, family: nw.family, dir: nw.side, tDetected: nw.tDetected, venues: g ? g.venues.join("+") : nw.venue, size: nw.family === "absorption" ? fa.rate$ ?? null : nw.family === "exhaustion" ? fa.zWas ?? null : fa.notional ?? null });
      }
    }
  };
  let want = files[0].seq;
  for (const f of files) {
    if (f.seq !== want) { holes = true; break; } want++;      // a missing chunk: the run is followed up to the hole
    const j = gunzipJson(f.file);
    for (const r of j.inputs || []) { const t = inputTime(r); if (stopAt != null && t >= stopAt) { stopped = true; break; } if (Number.isFinite(t)) { if (t0 == null) t0 = t; t1 = t; } take(F.feed(r)); }
    if (stopped) break;
  }
  take(F.flush());
  return { series: s, eps, t0, t1, holes };
}

// ---------- report ----------
const f2 = x => x == null ? "    -" : (x >= 0 ? "+" : "") + x.toFixed(2);
function report(rows, mode, bootN) {
  const lines = [], cells = [];
  const table = (title, fams, kind, filter) => {
    lines.push("", title, "  family       horizon      n  days   result  control        D     95% interval      99.5% interval");
    for (const fam of fams) for (const h of P.horizons) {
      const sel = rows.filter(r => r.family === fam && r.d && (!filter || filter(r))), c = cell(sel, r => r.d[kind][h], { boot: bootN, name: title + fam + h });
      const res = mean(sel.filter(r => r.d[kind][h] != null).map(r => r.res[h])), ctl = mean(sel.filter(r => r.d[kind][h] != null).map(r => r.ctl[kind][h]));
      lines.push("  " + fam.padEnd(12) + hLabel(h).padStart(8) + String(c.n).padStart(7) + String(c.days).padStart(6) + "  " + f2(res).padStart(7) + "  " + f2(ctl).padStart(7) + "  " + f2(c.mean).padStart(7) + "   " + (c.n ? (f2(c.lo95) + " to " + f2(c.hi95)).padEnd(18) + (f2(c.lo995) + " to " + f2(c.hi995)) : ""));
      if (!filter && kind === "matched" && P.primary.includes(fam)) cells.push(Object.assign({ family: fam, h }, c));
    }
  };
  const used = rows.filter(r => r.d), dropped = {}; for (const r of rows) if (!r.d) dropped[r.why] = (dropped[r.why] || 0) + 1;
  lines.push("episodes: " + rows.length + " detected, " + used.length + " measured" + (Object.keys(dropped).length ? "; dropped: " + Object.entries(dropped).map(([k, v]) => v + " " + k).join(", ") : ""));
  lines.push("days with an episode: " + new Set(used.map(r => r.day)).size + "   (bps; positive = the price went with the aggressor; D = result minus its controls)");
  table("PRIMARY: against the matched control (same run, similar sigma, similar move in the 60 s before)", P.primary, "matched");
  const v = verdict(cells);
  lines.push("", "verdict by the plan's rule: " + v.verdict.toUpperCase() + (v.alive.length ? "  (alive: " + v.alive.map(c => c.family + " " + hLabel(c.h)).join(", ") + ")" : "") + (mode === "exploration" ? "   [exploration set: NOT evidence]" : ""));
  table("secondary: against the plain control (similar sigma only)", P.primary, "plain");
  table("beside them: aggression bursts, matched control (not part of the verdict)", ["burst"], "matched");
  // registered splits; quartiles on this set's own values (no outcome is used)
  for (const fam of P.primary) {
    const mine = used.filter(r => r.family === fam), sz = mine.map(r => r.size).filter(x => x != null).sort((a, b) => a - b), sg = mine.map(r => r.sigma).sort((a, b) => a - b), q3 = quant(sz, 0.75), s3 = quant(sg, 0.75);
    table("split, " + fam + ": top quarter by size (at least " + (q3 == null ? "-" : q3.toPrecision(4)) + ")", [fam], "matched", r => r.size != null && r.size >= q3);
    table("split, " + fam + ": top quarter by sigma at detection (at least " + (s3 == null ? "-" : s3.toFixed(3)) + " bps per root second)", [fam], "matched", r => r.sigma >= s3);
    for (const vn of ["bn", "hl", "bn+hl"]) table("split, " + fam + ": first seen on " + vn, [fam], "matched", r => r.venues === vn);
  }
  // spread of single control results: what an interval can be expected to be
  lines.push("", "spread of one control result (plain), and the half-width a 95% interval would have with independent episodes:", "  horizon   sd (bps)   n=300   n=1000   n=3000");
  for (const h of P.horizons) { const all = []; for (const r of used) if (r.ctlAll[h]) for (const x of r.ctlAll[h]) all.push(x); const s = sd(all); lines.push("  " + hLabel(h).padStart(7) + "   " + (s == null ? "-" : s.toFixed(2)).padStart(8) + [300, 1000, 3000].map(k => (s == null ? "-" : (1.96 * s * Math.sqrt(1 + 1 / P.nControls) / Math.sqrt(k)).toFixed(2)).padStart(8)).join("")); }
  lines.push("  (episodes of one day are not independent and long horizons overlap, so real intervals are wider)");
  return { lines, cells, verdict: v.verdict };
}

// ---------- self-test: the measurement on synthetic prices ----------
function selftest() {
  let fail = 0; const ok = (c, name, detail) => { console.log((c ? "  pass  " : "  FAIL  ") + name + (c ? "" : "\n        " + detail)); if (!c) fail++; };
  // a world: `days` days of one-a-second prices, a random walk of `vol` bps a second; `revert`: every move of the last 60 s is given back over the next 300 s (true of every moment)
  const world = (seed, days, o = {}) => {
    const rnd = rng(seed), gauss = () => { let u = 0; for (let k = 0; k < 6; k++) u += rnd(); return (u - 3) / Math.sqrt(0.5); }, n = 6 * 3600, list = [];
    for (let d = 0; d < days; d++) {
      const t0 = Date.parse("2026-01-01T00:00:00Z") + d * 86400e3, lp = new Float64Array(n), push = new Float64Array(n + 400), eps = [];
      let x = Math.log(70000);
      for (let i = 0; i < n; i++) {
        x += gauss() * 1e-4 + push[i]; lp[i] = x;
        if (o.revert && i >= 60) { const back = (lp[i] - lp[i - 60]) * o.revert / 300 / 60; for (let k = 1; k <= 300; k++) push[i + k] -= back; }      // at every second, whether an episode is there or not
        if (i > 600 && i < n - 3700 && rnd() < 1 / 120) {
          let dir = rnd() < 0.5 ? 1 : -1;
          if (o.afterMove) { const mv = lp[i] - lp[i - 60]; if (Math.abs(mv) < 8e-4) continue; dir = mv > 0 ? 1 : -1; }      // "episodes" that only ever follow a move, in its direction
          eps.push({ id: "e" + d + "_" + i, family: "absorption", dir, tDetected: t0 + i * 1000 - 2000 });
          if (o.effect) for (let k = 1; k <= 300; k++) push[i + k] += dir * o.effect * 1e-4 / 300;      // a planted drift: `effect` bps with the aggressor over the next 300 s
        }
      }
      const s = { t: [], px: [], sg: [] }; for (let i = 0; i < n; i++) { s.t.push(t0 + i * 1000); s.px.push(Math.exp(lp[i])); s.sg.push(1); }
      list.push({ s, eps, key: "d" + d });
    }
    return list;
  };
  const run = (w, opt) => [].concat(...w.map(x => measure(x.s, x.eps, Object.assign({ key: x.key }, opt))));
  const at = (rows, kind, h) => cell(rows, r => r.d && r.d[kind][h], { boot: 2000, name: kind + h });
  { const rows = run(world(1, 12)), c = at(rows, "matched", 300), c10 = at(rows, "matched", 10);
    ok(c.n > 1000 && c.lo995 < 0 && c.hi995 > 0 && Math.abs(c.mean) < 0.5 && c10.lo995 < 0 && c10.hi995 > 0, "no effect planted: D is about 0 at 10 s and 5 min and its interval holds 0", JSON.stringify([c, c10])); }
  { const rows = run(world(2, 12, { effect: 5 })), c = at(rows, "matched", 300), c60 = at(rows, "matched", 60), c900 = at(rows, "matched", 900);
    ok(Math.abs(c.mean - 5) < 0.7 && c.lo995 > 0 && Math.abs(c60.mean - 1) < 0.5 && c900.lo995 < 5 && c900.hi995 > 5 && c900.mean > 1, "5 bps planted over 5 min is recovered: about 5 at 5 min, about 1 at 1 min, and the 15 min interval holds 5", JSON.stringify([c60.mean, c.mean, c900.mean])); }
  { const rows = run(world(3, 12, { effect: -5 })), c = at(rows, "matched", 300); ok(Math.abs(c.mean + 5) < 0.7 && c.hi995 < 0, "a planted move against the aggressor is recovered with its sign", JSON.stringify(c)); }
  { const rows = run(world(4, 12, { revert: 0.5, afterMove: true })), m = at(rows, "matched", 300), p = at(rows, "plain", 300);
    ok(p.hi995 < 0 && p.mean < -2 && Math.abs(m.mean) < 1 && Math.abs(m.mean) < Math.abs(p.mean) / 3, "every move reverts and episodes only follow moves: the plain control shows an effect, the matched control shows about none", "plain " + JSON.stringify(p) + " matched " + JSON.stringify(m)); }
  { const w = world(5, 1), a = run(w), b = run(w); ok(JSON.stringify(a) === JSON.stringify(b), "the same inputs give the same results (controls are drawn from a fixed seed)", ""); }
  { const w = world(6, 1)[0], cut = w.s.t[3 * 3600], a = measure(w.s, w.eps, { key: "x", to: cut }), b = measure(w.s, w.eps, { key: "x", from: cut });
    const na = a.filter(r => r.d).length, nb = b.filter(r => r.d).length, tot = measure(w.s, w.eps, { key: "x" }).filter(r => r.d).length;
    ok(na > 0 && nb > 0 && na + nb === tot && a.filter(r => r.d).every(r => r.t < cut) && b.filter(r => r.d).every(r => r.t >= cut), "from / to split the episodes of one run between the two sets with none in both", na + " + " + nb + " vs " + tot); }
  { const w = world(7, 1)[0], rows = measure(w.s, w.eps, { key: "x" }), late = rows.filter(r => r.d && r.t > w.s.t[w.s.t.length - 1] - 3600e3);
    ok(rows.filter(r => r.d).every(r => r.res[10] != null) && late.every(r => r.res[3600] == null && r.d.matched[3600] == null), "an episode whose run ends before a horizon has no result at that horizon", ""); }
  { const mk = (h, mean_, lo, hi, lo9, hi9) => ({ family: "absorption", h, mean: mean_, days: 20, lo95: lo, hi95: hi, lo995: lo9, hi995: hi9 }), five = (lo, hi) => [mk(300, 0, lo, hi, lo * 1.5, hi * 1.5), Object.assign(mk(300, 0, lo, hi, lo * 1.5, hi * 1.5), { family: "exhaustion" })];
    ok(verdict(five(-2, 2)).verdict === "closed" && verdict(five(-5, 5)).verdict === "underpowered" && verdict(five(-2, 2).concat([mk(900, -4, -6, -2, -7, -1)])).verdict === "alive" && verdict(five(-2, 2).concat([mk(900, -4, -9, 1, -11, 3)])).verdict === "closed" && verdict(five(-2, 2).concat([mk(3600, 15, 12, 18, 10, 20)])).verdict === "trade candidate",
      "verdicts: closed, underpowered, alive (3 bps and a 99.5% interval away from 0), trade candidate (11 bps at the 95% end)", ""); }
  console.log(fail ? fail + " FAILED" : "all passed"); process.exit(fail ? 1 : 0);
}

// ---------- cli ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), val = k => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; }, has = k => args.includes(k);
  if (has("--selftest")) selftest();
  const dir = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--out", "--limit", "--boot"].includes(args[i - 1])) || path.join(HERE, "sessions"));
  const mode = has("--confirm-test") ? "test" : has("--count") ? "count" : "exploration", bootN = +(val("--boot") || P.boot), limit = +(val("--limit") || 0);
  if (limit && mode !== "exploration") { console.error("--limit is for the exploration set only"); process.exit(2); }
  const runs = Array.from(listRuns(dir).entries()), rows = []; let k = 0, hours = 0, nRuns = 0; const perFam = {}, hoursByDay = new Map();
  console.error(mode === "test" ? "TEST SET (inputs from " + new Date(CUT).toISOString() + " on): the registered run" : mode === "count" ? "test set, counts only" : "exploration set (inputs before " + new Date(CUT).toISOString() + "): exploratory, not evidence");
  for (const [id, files] of runs) {
    k++; if (limit && nRuns >= limit) break;
    const stamp = files[files.length - 1].file.match(/_(\d{12})/)[1], lastStart = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12));
    if (mode !== "exploration" && lastStart + 3600e3 < CUT) continue;      // nothing of this run can be in the test set (a chunk is at most 30 minutes)
    const firstStamp = files[0].file.match(/_(\d{12})/)[1], firstStart = Date.UTC(+firstStamp.slice(0, 4), +firstStamp.slice(4, 6) - 1, +firstStamp.slice(6, 8), +firstStamp.slice(8, 10), +firstStamp.slice(10, 12));
    if (mode === "exploration" && firstStart >= CUT + 3600e3) continue;
    const t = Date.now(), r = replayRun(files, mode === "exploration" ? CUT : null);
    if (r.t0 == null) { console.error("[" + k + "/" + runs.length + "] " + id + ": no inputs in this set"); continue; }
    const from = mode === "exploration" ? -Infinity : CUT, to = mode === "exploration" ? CUT : Infinity;
    let secs = 0; for (const x of r.series.t) if (x >= from && x < to) { secs++; hoursByDay.set(dayOf(x), (hoursByDay.get(dayOf(x)) || 0) + 1 / 3600); }      // recorded time = seconds that have a Binance price, so a silence inside a run is not counted
    const hrs = secs / 3600;
    if (hrs <= 0) { console.error("[" + k + "/" + runs.length + "] " + id + ": nothing in this set"); continue; }
    nRuns++; hours += hrs;
    const mine = r.eps.filter(e => e.tDetected + P.delayMs >= from && e.tDetected + P.delayMs < to); for (const e of mine) perFam[e.family] = (perFam[e.family] || 0) + 1;
    if (mode !== "count") for (const m of measure(r.series, r.eps, { key: id, from, to })) if (m.why !== "outside the set") rows.push(m);
    console.error("[" + k + "/" + runs.length + "] " + id + ": " + files.length + " file" + (files.length === 1 ? "" : "s") + ", " + hrs.toFixed(2) + " h, " + mine.length + " episodes" + (r.holes ? ", a chunk is missing: followed up to the hole" : "") + " (" + ((Date.now() - t) / 1000).toFixed(1) + " s)");
  }
  const goodDays = Array.from(hoursByDay.values()).filter(h => h >= 12).length;
  console.log("\n" + nRuns + " runs, " + hours.toFixed(1) + " hours, " + hoursByDay.size + " UTC days (" + goodDays + " with at least 12 recorded hours); episodes detected: " + (P.families.map(f => (perFam[f] || 0) + " " + f).join(", ")));
  if (mode === "count") { console.log("needed for the registered run: 21 days with at least 12 hours, and 300 episodes with a 5 min result in absorption and in exhaustion"); process.exit(0); }
  const rep = report(rows, mode, bootN); for (const l of rep.lines) console.log(l);
  if (val("--out")) { fs.writeFileSync(path.resolve(val("--out")), JSON.stringify({ mode, frozen: FROZEN, cut: CUT, params: P, runs: nRuns, hours, cells: rep.cells, verdict: rep.verdict, rows: rows.map(r => { const c = Object.assign({}, r); delete c.ctlAll; return c; }) })); console.log("\nwrote " + val("--out")); }
}
