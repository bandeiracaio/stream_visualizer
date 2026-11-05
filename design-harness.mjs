// design-harness.mjs: replay a sampled trade-system design on saved sessions (offline, not part of the app).
// Spec: .scratch/trade-system/sampling-design.md. First version implements ONE trigger (reader-episode-event), ONE exit (elapsed-time-stop)
// and ONE stop (sigma-multiple-stop) so the loop can be checked end to end; more categories are added as entries in TEMPLATES.
//
//   node design-harness.mjs --selftest
//   node design-harness.mjs [--sessions sessions] [--split dev|holdout] [--confirm-holdout] [--n 100] [--seed 1] [--out results.jsonl]
//
// Facts used from each session: the Reader's episode groups (default thresholds), the engine's price history (one point a second) per venue, sigma per venue.
// Execution model, same for every design: entry latency 1 s after detection at the next price, one position at a time per session, exit at the stop
// (filled at the stop price) or after the hold time, a fixed round-trip cost in bps. R = net bps / stop distance in bps. Descriptive only: no app, Reader or broker change.
// Hold-out: sessions are ordered by start time; the latest 30% are reserved and refused unless --confirm-holdout is given.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./compare-detections.mjs";
import { readInput } from "./analyze-collectors.mjs";
import { sigmaOf, sideDir } from "./reader-scoreboard.mjs";
import { rng, generate, loadPool } from "./sample-designs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, ".scratch", "trade-system", "cache");
export const EXEC = { latencyMs: 1000, costBps: 8, maxGapMs: 30000, holdoutShare: 0.3 };

// ---------- price helpers (history = [[t_ms, price]], one point a second) ----------
export function priceAt(h, t, within = 2000) {
  let lo = 0, hi = h.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r >= 0 && t - h[r][0] <= within ? [h[r][1], r] : null;
}

// ---------- one trade ----------
// dir +1 long / -1 short. Returns null when the history cannot support the whole trade (no price at entry, a gap, or it ends before the hold time).
// exitAt: optional ms time of a flow signal against the position; the trade is closed one latency later at the then price (holdSec stays the maximum hold).
// opts (all optional): tpBps target distance (limit order, filled at the target, not better); trailBps trailing distance from the best price so far (filled at the tick price);
// levelPx a target price (same fill rule as tpBps; no room if it is not beyond the entry); exitWhen(t) a predicate checked every second (filled at the tick price, exit "norm").
export function fillTrade(h, tSignal, dir, holdSec, stopBps, ex = EXEC, exitAt = null, opts = {}) {
  const tIn = tSignal + ex.latencyMs, a = priceAt(h, tIn); if (!a) return null;
  const [p0, i0] = a, tEnd = tIn + holdSec * 1000; if (!(p0 > 0) || !h.length || h[h.length - 1][0] < tEnd) return null;
  const tFlow = exitAt != null && exitAt + ex.latencyMs > tIn && exitAt + ex.latencyMs < tEnd ? exitAt + ex.latencyMs : null;
  let tp = opts.tpBps != null ? opts.tpBps : null;
  if (opts.levelPx != null) { const lb = dir * (opts.levelPx / p0 - 1) * 1e4; if (!(lb > 0.2)) return null; tp = tp == null ? lb : Math.min(tp, lb); }
  let prevT = h[i0][0], best = 0;
  for (let i = i0 + 1; i < h.length; i++) {
    const [t, p] = h[i]; if (t - prevT > ex.maxGapMs) return null; prevT = t;
    if (t > tEnd) { const b = priceAt(h, tEnd); if (!b) return null; return result(dir, p0, b[0], tIn, tEnd, "time", stopBps, ex); }
    const move = dir * (p / p0 - 1) * 1e4;
    if (move <= -stopBps) return { tIn, tOut: t, dir, gross: move, net: move - ex.costBps, R: (move - ex.costBps) / stopBps, exit: "stop", stopBps };      // filled at the price seen at the crossing tick (a gap through the stop costs more than the stop distance); versions before 2026-11-04 filled exactly at the stop level, which made every gross figure optimistic
    if (move > best) best = move;
    if (opts.trailBps != null && best - move >= opts.trailBps && best > 0) return { tIn, tOut: t, dir, gross: move, net: move - ex.costBps, R: (move - ex.costBps) / stopBps, exit: "trail", stopBps };
    if (tp != null && move >= tp) return { tIn, tOut: t, dir, gross: tp, net: tp - ex.costBps, R: (tp - ex.costBps) / stopBps, exit: "target", stopBps };
    if (opts.exitWhen && opts.exitWhen(t)) return { tIn, tOut: t, dir, gross: move, net: move - ex.costBps, R: (move - ex.costBps) / stopBps, exit: "norm", stopBps };
    if (tFlow != null && t >= tFlow) return result(dir, p0, p, tIn, t, "flow", stopBps, ex);
  }
  const b = priceAt(h, tEnd); return b ? result(dir, p0, b[0], tIn, tEnd, "time", stopBps, ex) : null;
}
function result(dir, p0, p1, tIn, tOut, exit, stopBps, ex) { const gross = dir * (p1 / p0 - 1) * 1e4; return { tIn, tOut, dir, gross, net: gross - ex.costBps, R: (gross - ex.costBps) / stopBps, exit, stopBps }; }

// ---------- flow facts: trades per second and book depth imbalance, aligned with each venue's price history, cached ----------
const FLOWDIR = path.join(HERE, ".scratch", "trade-system", "cache-flow");
const idxAt = (h, t) => { const a = priceAt(h, t); return a ? a[1] : -1; };
export function flowOf(s) {
  if (s.flow) return s.flow;
  fs.mkdirSync(FLOWDIR, { recursive: true }); const cf = path.join(FLOWDIR, s.file + ".json");
  try { const c = JSON.parse(fs.readFileSync(cf, "utf8")); if (c.size === s.size && c.v === 1) { s.flow = c.flow; return s.flow; } } catch { /* rebuild */ }
  const inp = readInput(path.join(s.dir, s.file)).inputs, out = {}, idx = {}, snaps = { bn: [], hl: [] };
  for (const v of ["bn", "hl"]) { const n = s.hist[v].length; out[v] = { buy: new Array(n).fill(0), sell: new Array(n).fill(0), liqB: new Array(n).fill(0), liqS: new Array(n).fill(0), imb5: new Array(n).fill(null), imb20: new Array(n).fill(null) }; idx[v] = new Map(s.hist[v].map((x, i) => [x[0], i])); }
  for (const r of inp) {
    if (r[0] === "t" && r[1] && out[r[1].v]) { const x = r[1], i = idx[x.v].get(Math.ceil(x.t / 1000) * 1000); if (i == null || !(x.ntl > 0)) continue; const o = out[x.v]; if (x.liq) { if (x.side === "buy") o.liqB[i] += x.ntl; else o.liqS[i] += x.ntl; } else if (x.side === "buy") o.buy[i] += x.ntl; else o.sell[i] += x.ntl; }      // trades in (T-1 s, T] belong to the history point T: nothing from after T
    else if (r[0] === "b" && snaps[r[1]]) snaps[r[1]].push(r);
  }
  for (const v of ["bn", "hl"]) {
    const arr = snaps[v].sort((a, b) => a[2] - b[2]), h = s.hist[v], cache = new Map(); let j = -1;
    const imb = (snap, X) => { const bids = snap[3], asks = snap[4]; let bb = -Infinity, ba = Infinity; for (const l of bids) if (l[0] > bb) bb = l[0]; for (const l of asks) if (l[0] < ba) ba = l[0]; if (!(bb > 0) || !(ba < Infinity)) return null; const mid = (bb + ba) / 2; let sb = 0, sa = 0; for (const l of bids) if (l[0] >= mid * (1 - X / 1e4)) sb += l[1]; for (const l of asks) if (l[0] <= mid * (1 + X / 1e4)) sa += l[1]; return sb + sa > 0 ? Math.round(1000 * (sb - sa) / (sb + sa)) / 1000 : null; };
    for (let i = 0; i < h.length; i++) { const t = h[i][0]; while (j + 1 < arr.length && arr[j + 1][2] <= t) j++; if (j < 0 || t - arr[j][2] > 10000) continue; if (!cache.has(j)) cache.set(j, [imb(arr[j], 5), imb(arr[j], 20)]); const c = cache.get(j); out[v].imb5[i] = c[0]; out[v].imb20[i] = c[1]; }
  }
  fs.writeFileSync(cf, JSON.stringify({ size: s.size, v: 1, flow: out })); s.flow = out; return out;
}
const preCache = new WeakMap();
const pre = arr => { let p = preCache.get(arr); if (!p) { p = new Float64Array(arr.length + 1); for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + (arr[i] || 0); preCache.set(arr, p); } return p; };
// rolling extremes of the previous W seconds (excluding the current point) for a venue, cached per session
const extCache = new WeakMap();
export function rollingExt(s, venue, W) {
  let m = extCache.get(s); if (!m) { m = new Map(); extCache.set(s, m); }
  const key = venue + "|" + W; if (m.has(key)) return m.get(key);
  const h = s.hist[venue], n = h.length, hi = new Float64Array(n).fill(NaN), lo = new Float64Array(n).fill(NaN), dh = [], dl = [];
  let hh = 0, hl = 0;
  for (let i = 0; i < n; i++) {
    while (hh < dh.length && h[dh[hh]][0] < h[i][0] - W * 1000) hh++; while (hl < dl.length && h[dl[hl]][0] < h[i][0] - W * 1000) hl++;
    if (hh < dh.length) hi[i] = h[dh[hh]][1]; if (hl < dl.length) lo[i] = h[dl[hl]][1];
    while (dh.length > hh && h[dh[dh.length - 1]][1] <= h[i][1]) dh.pop(); dh.push(i); while (dl.length > hl && h[dl[dl.length - 1]][1] >= h[i][1]) dl.pop(); dl.push(i);
  }
  const out = { hi, lo }; m.set(key, out); return out;
}

// premium series of hl over bn on hl's own history seconds, with prefix sums for a trailing mean; built once per session
const premCache = new WeakMap();
export function premiumOf(s) {
  if (premCache.has(s)) return premCache.get(s);
  const hh = s.hist.hl, hb = s.hist.bn; let out = null;
  if (hh && hb && hh.length > 1 && hb.length > 1) {
    const t = new Array(hh.length), v = new Array(hh.length), sum = new Float64Array(hh.length + 1), n = new Int32Array(hh.length + 1);
    for (let i = 0; i < hh.length; i++) { t[i] = hh[i][0]; const b = priceAt(hb, hh[i][0]); v[i] = b && b[0] > 0 && hh[i][1] > 0 ? (hh[i][1] / b[0] - 1) * 1e4 : null; sum[i + 1] = sum[i] + (v[i] == null ? 0 : v[i]); n[i + 1] = n[i] + (v[i] == null ? 0 : 1); }
    // cs index k holds the total over the first k points; window (lo, i] uses cs[i+1]-cs[lo+1]; shift so callers can use cs[i]-cs[lo]
    out = { t, v, cs: { sum: sum.subarray(1), n: n.subarray(1) } };
  }
  premCache.set(s, out); return out;
}
// ---------- templates: category -> how it behaves, with parameter draws ----------
const logU = (r, lo, hi) => Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)));
const pick = (r, a) => a[Math.floor(r() * a.length)];
const FAMILIES = ["absorption", "exhaustion", "burst", "wall"];
const rtSide = g => g.aggressor || (g.wall && g.wall.side) || "";
export const HOLD_RANGE = { seconds: [10, 60], minutes: [60, 600] };      // sessions are short (about 15 minutes), so longer horizons are not testable yet
export const TEMPLATES = {
  ctx: { "always-on": { draw: () => ({}) } },
  reg: { "none": { draw: () => ({}) }, "range-or-session-box": { draw: r => ({ windowSec: Math.round(logU(r, 300, 1800)) }) } },
  sz: { "fixed-fraction-risk": { draw: () => ({}) } },
  trig: {
    "reader-episode-event": {
      draw: r => { const k = 1 + Math.floor(r() * 3), fams = FAMILIES.slice().sort(() => r() - 0.5).slice(0, k); return { families: fams.sort(), venue: pick(r, ["any", "bn", "hl"]) }; },
      // signals: [{t, venue, side}] with side +1/-1 = the episode's own direction (buy aggressor or bid wall = +1)
      entries: (s, p) => s.groups.filter(g => p.families.includes(g.family) && (p.venue === "any" || g.venue === p.venue) && sideDir(rtSide(g)) !== 0)
        .map(g => ({ t: g.tDetected, venue: g.venue, side: sideDir(rtSide(g)) })).sort((a, b) => a.t - b.t),
    },
    // price moved at least m sigmas over the last L seconds; side = the direction of that move; no new signal for L seconds after one. Needs no Reader data, so it is the control for the episode trigger.
    "price-move-or-distance-threshold": {
      draw: r => ({ lookSec: Math.round(logU(r, 10, 300)), m: +logU(r, 1, 4).toFixed(2), venue: pick(r, ["bn", "hl"]) }),
      entries: (s, p) => {
        const h = s.hist[p.venue] || [], sg = s.sigma[p.venue], thr = p.m * sg * Math.sqrt(p.lookSec), out = []; let last = -Infinity;
        for (let i = 0; i < h.length; i++) {
          const t = h[i][0]; if (t < last + p.lookSec * 1000) continue;
          const b = priceAt(h, t - p.lookSec * 1000); if (!b || !(b[0] > 0)) continue;
          const mv = (h[i][1] / b[0] - 1) * 1e4; if (Math.abs(mv) >= thr) { out.push({ t, venue: p.venue, side: mv > 0 ? 1 : -1 }); last = t; }
        }
        return out;
      },
    },
    // premium of Hyperliquid over Binance (bps, both venues' mid prices) against its own trailing mean over baseSec seconds. dev = premium - baseline. Trading venue hl: the dislocation
    // points up when hl is rich (side +1); trading venue bn: bn is rich when the premium is low (side = -sign of dev). A deviation of at least minBps fires; no new signal for coolSec seconds.
    // Thesis sign -1 fades the dislocation (convergence trade), +1 goes with it. Needs both venues' price history only.
    "cross-venue-or-asset-divergence": {
      draw: r => ({ baseSec: Math.round(logU(r, 60, 600)), minBps: +logU(r, 0.3, 3).toFixed(2), coolSec: Math.round(logU(r, 10, 120)), venue: pick(r, ["hl", "bn"]) }),
      entries: (s, p) => {
        const pr = premiumOf(s); if (!pr) return [];
        const { t, v, cs } = pr, out = []; let last = -Infinity, lo = 0;
        for (let i = 0; i < t.length; i++) {
          if (v[i] == null) continue;
          while (t[lo] < t[i] - p.baseSec * 1000) lo++;
          const n = (cs.n[i] - cs.n[lo]) || 0; if (n < 20) continue;
          const dev = v[i] - (cs.sum[i] - cs.sum[lo]) / n;
          if (t[i] < last + p.coolSec * 1000 || Math.abs(dev) < p.minBps) continue;
          out.push({ t: t[i], venue: p.venue, side: (dev > 0 ? 1 : -1) * (p.venue === "hl" ? 1 : -1) }); last = t[i];
        }
        return out;
      },
      // normalised again: the premium is back within 0.3 x minBps of its trailing mean
      norm: (s, p) => { const pr = premiumOf(s); if (!pr) return () => false; const { t, v, cs } = pr; return tt => { const i = idxAt(s.hist.hl, tt); if (i < 0 || v[i] == null) return false; let lo = 0, hi = i; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < t[i] - p.baseSec * 1000) lo = m + 1; else hi = m; } const n = (cs.n[i] - cs.n[lo]) || 0; if (n < 20) return false; return Math.abs(v[i] - (cs.sum[i] - cs.sum[lo]) / n) <= 0.3 * p.minBps; }; },
    },
    // net signed trade notional over the last lookSec seconds (aggressor buys minus sells): fires when its share of the total is at least `share` and its size is at least m times the session's median |net|; side = sign of the net flow
    "trade-flow-signal": {
      draw: r => ({ lookSec: Math.round(logU(r, 10, 120)), share: +(0.5 + 0.4 * r()).toFixed(2), m: +logU(r, 2, 8).toFixed(2), venue: pick(r, ["bn", "hl"]) }),
      entries: (s, p) => {
        const h = s.hist[p.venue] || [], L = p.lookSec; if (h.length <= L) return [];
        const f = flowOf(s)[p.venue], B = pre(f.buy), S = pre(f.sell), net = new Float64Array(h.length), tot = new Float64Array(h.length), ab = [];
        for (let i = L; i < h.length; i++) { const b = B[i + 1] - B[i + 1 - L], sl = S[i + 1] - S[i + 1 - L]; net[i] = b - sl; tot[i] = b + sl; if (tot[i] > 0) ab.push(Math.abs(net[i])); }
        if (ab.length < 30) return []; ab.sort((a, b) => a - b); const med = ab[ab.length >> 1]; if (!(med > 0)) return [];
        const out = []; let last = -Infinity;
        for (let i = L; i < h.length; i++) { const t = h[i][0]; if (t < last + L * 1000 || !(tot[i] > 0)) continue; if (Math.abs(net[i]) / tot[i] >= p.share && Math.abs(net[i]) >= p.m * med) { out.push({ t, venue: p.venue, side: net[i] > 0 ? 1 : -1 }); last = t; } }
        return out;
      },
      norm: (s, p) => { const h = s.hist[p.venue], f = flowOf(s)[p.venue], B = pre(f.buy), S = pre(f.sell), L = p.lookSec; return t => { const i = idxAt(h, t); if (i < L) return false; const b = B[i + 1] - B[i + 1 - L], sl = S[i + 1] - S[i + 1 - L], tt = b + sl; return tt > 0 ? Math.abs(b - sl) / tt < 0.2 : true; }; },
    },
    // order-book depth imbalance (bid minus ask size within `edge` bps of the mid, as a share of both) at least thr in one direction for sustainSec seconds in a row; side = the heavy side (bids heavy = +1)
    "book-depth-and-wall-event": {
      draw: r => ({ edge: pick(r, [5, 20]), thr: +(0.3 + 0.5 * r()).toFixed(2), sustainSec: Math.round(logU(r, 1, 10)), coolSec: Math.round(logU(r, 10, 120)), venue: pick(r, ["bn", "hl"]) }),
      entries: (s, p) => {
        const h = s.hist[p.venue] || [], arr = flowOf(s)[p.venue]["imb" + p.edge], out = []; let run = 0, sgn = 0, last = -Infinity;
        for (let i = 0; i < h.length; i++) { const x = arr[i]; if (x == null || Math.abs(x) < p.thr) { run = 0; sgn = 0; continue; } const sg = x > 0 ? 1 : -1; if (sg === sgn) run++; else { sgn = sg; run = 1; } if (run >= p.sustainSec && h[i][0] >= last + p.coolSec * 1000) { out.push({ t: h[i][0], venue: p.venue, side: sg }); last = h[i][0]; } }
        return out;
      },
      norm: (s, p) => { const h = s.hist[p.venue], arr = flowOf(s)[p.venue]["imb" + p.edge]; return t => { const i = idxAt(h, t), x = i >= 0 ? arr[i] : null; return x != null && Math.abs(x) < p.thr / 2; }; },
    },
    // needs a region (reg.windowSec): price goes beyond the high (low) of the previous windowSec seconds by at least brkBps; side = the direction of the break
    "level-or-range-break": {
      draw: r => ({ brkBps: +(r() * 2).toFixed(2), coolSec: Math.round(logU(r, 10, 120)), venue: pick(r, ["bn", "hl"]) }),
      entries: (s, p, reg) => {
        const W = reg && reg.windowSec; if (!W) return []; const h = s.hist[p.venue] || []; if (!h.length) return [];
        const { hi, lo } = rollingExt(s, p.venue, W), out = [], t0 = h[0][0]; let last = -Infinity;
        for (let i = 0; i < h.length; i++) { const t = h[i][0]; if (t - t0 < W * 1000 || t < last + p.coolSec * 1000) continue; const px = h[i][1]; if (px > hi[i] * (1 + p.brkBps / 1e4)) { out.push({ t, venue: p.venue, side: 1 }); last = t; } else if (px < lo[i] * (1 - p.brkBps / 1e4)) { out.push({ t, venue: p.venue, side: -1 }); last = t; } }
        return out;
      },
    },
    // needs a region: within the last lookSec seconds price touched the region's high (low) (within tolBps, without going beyond it by more than tolBps) and has since pulled back rejBps; side = the direction of the approach (up at a high), so the thesis "fade" takes the bounce
    "level-rejection-bounce": {
      draw: r => ({ tolBps: +logU(r, 0.2, 2).toFixed(2), rejBps: +logU(r, 1, 5).toFixed(2), lookSec: Math.round(logU(r, 5, 60)), coolSec: Math.round(logU(r, 10, 120)), venue: pick(r, ["bn", "hl"]) }),
      entries: (s, p, reg) => {
        const W = reg && reg.windowSec; if (!W) return []; const h = s.hist[p.venue] || []; if (h.length < 2) return [];
        const E = rollingExt(s, p.venue, W), R = rollingExt(s, p.venue, p.lookSec), out = [], t0 = h[0][0], Lp = p.lookSec; let last = -Infinity;
        for (let i = Lp; i < h.length; i++) {
          const t = h[i][0]; if (t - t0 < (W + Lp) * 1000 || t < last + p.coolSec * 1000) continue; const px = h[i][1];
          const levHi = E.hi[i - Lp], levLo = E.lo[i - Lp], maxLp = Math.max(R.hi[i], px), minLp = Math.min(R.lo[i], px), tol = p.tolBps / 1e4;
          if (levHi > 0 && maxLp >= levHi * (1 - tol) && maxLp <= levHi * (1 + tol) && px <= maxLp * (1 - p.rejBps / 1e4)) { out.push({ t, venue: p.venue, side: 1 }); last = t; }
          else if (levLo > 0 && minLp <= levLo * (1 + tol) && minLp >= levLo * (1 - tol) && px >= minLp * (1 + p.rejBps / 1e4)) { out.push({ t, venue: p.venue, side: -1 }); last = t; }
        }
        return out;
      },
    },
  },
  // the thesis fixes the direction relative to the episode: with it, or against it
  thes: { "continuation-momentum": { draw: () => ({ sign: +1 }) }, "mean-reversion-overreaction": { draw: () => ({ sign: -1 }) } },
  exit: {
    "elapsed-time-stop": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)) }; } },
    // leave when a Reader episode of the chosen families, on the entry venue, points against the position; holdSec is the maximum hold
    "flow-episode-or-book-state-exit": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor], k = 1 + Math.floor(r() * 3); return { holdSec: Math.round(logU(r, lo, hi)), families: FAMILIES.slice().sort(() => r() - 0.5).slice(0, k).sort() }; } },
    // take profit at tpK x sigma x sqrt(hold) bps (a limit order: filled at the target, never better); holdSec is the maximum hold
    "fixed-distance-target": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)), tpK: +logU(r, 0.5, 3).toFixed(2) }; } },
    // leave when price gives back trailK x sigma x sqrt(hold) bps from the best price since entry (filled at the tick price)
    "trailing-or-ratchet-stop": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)), trailK: +logU(r, 0.5, 3).toFixed(2) }; } },
    // needs a region: target at the middle of the region's range (frac 0.5) or at its far edge (frac 1) at entry time; no trade if the target is not beyond the entry
    "named-level-target": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)), frac: pick(r, [0.5, 1]) }; } },
    // leave when the trigger's own reading is back to normal (only triggers that define one: premium, trade flow, book depth)
    "indicator-normalization-exit": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)) }; } },
  },
  stop: { "sigma-multiple-stop": { draw: r => ({ k: +logU(r, 0.5, 3).toFixed(2) }) } },
};
export function implemented() { const o = {}; for (const s in TEMPLATES) o[s] = Object.keys(TEMPLATES[s]); o.hor = Object.keys(HOLD_RANGE); return o; }

// a design = sampler categories + parameter draws (seeded by the design id, so a design replays identically)
export function instantiate(design, seed = 1) {
  const r = rng((seed * 1000003 + Number(design.id.slice(1))) >>> 0), p = {};
  for (const slot of ["ctx", "reg", "trig", "thes", "exit", "stop", "sz"]) { const t = TEMPLATES[slot] && TEMPLATES[slot][design[slot]]; if (!t) throw new Error("no template for " + slot + "=" + design[slot]); p[slot] = t.draw(r, design); }
  return { ...design, p };
}

// ---------- run a design on sessions ----------
export function runDesign(d, sessions, ex = EXEC, nullDraw = null) {
  const trades = [], T = TEMPLATES.trig[d.trig];
  for (const s of sessions) {
    let sig = T.entries(s, d.p.trig, d.p.reg);
    if (nullDraw) sig = nullDraw(s, sig);
    const normFn = d.exit === "indicator-normalization-exit" ? (T.norm ? T.norm(s, d.p.trig) : null) : null;
    if (d.exit === "indicator-normalization-exit" && !normFn) continue;
    let busy = -Infinity;
    for (const e of sig) {
      if (e.t < busy) continue;
      const h = s.hist[e.venue]; if (!h || !h.length) continue;
      const hold = d.p.exit.holdSec, sigma = s.sigma[e.venue], sg = sigma * Math.sqrt(hold), stopBps = d.p.stop.k * sg;
      const dir = e.side * d.p.thes.sign; let exitAt = null; const opts = {};
      if (d.exit === "flow-episode-or-book-state-exit") { let best = Infinity; for (const x of s.groups) if (x.tDetected > e.t && x.tDetected < best && x.venue === e.venue && d.p.exit.families.includes(x.family) && sideDir(rtSide(x)) === -dir) best = x.tDetected; exitAt = best < Infinity ? best : null; }
      else if (d.exit === "fixed-distance-target") opts.tpBps = d.p.exit.tpK * sg;
      else if (d.exit === "trailing-or-ratchet-stop") opts.trailBps = d.p.exit.trailK * sg;
      else if (d.exit === "named-level-target") {
        const W = d.p.reg && d.p.reg.windowSec; if (!W) continue; const E = rollingExt(s, e.venue, W), i = idxAt(h, e.t); if (i < 0) continue;
        const hi = E.hi[i], lo = E.lo[i]; if (!(hi > lo)) continue; const f = d.p.exit.frac; opts.levelPx = dir > 0 ? (f === 1 ? hi : (hi + lo) / 2) : (f === 1 ? lo : (hi + lo) / 2);
      } else if (d.exit === "indicator-normalization-exit") opts.exitWhen = normFn;
      const tr = fillTrade(h, e.t, dir, hold, stopBps, ex, exitAt, opts); if (!tr) continue;
      tr.session = s.file; tr.venue = e.venue; trades.push(tr); busy = tr.tOut;
    }
  }
  return trades;
}
// null: same number of signals, at random moments of each session on the same venue, random direction
export function randomizer(seed) {
  const r = rng(seed);
  return (s, sig) => sig.map(e => { const h = s.hist[e.venue]; if (!h || h.length < 2) return e; return { t: h[0][0] + r() * (h[h.length - 1][0] - h[0][0]), venue: e.venue, side: r() < 0.5 ? 1 : -1 }; }).sort((a, b) => a.t - b.t);
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function summarize(trades, seed = 1, boots = 300) {
  const R = trades.map(t => t.R), G = trades.map(t => t.gross), n = R.length;
  const out = { n, meanR: mean(R), medianR: median(R), hit: n ? R.filter(x => x > 0).length / n : null, meanGrossBps: mean(G), medianGrossBps: median(G), stopShare: n ? trades.filter(t => t.exit === "stop").length / n : null, sessions: new Set(trades.map(t => t.session)).size };
  // trades inside one session are not independent: bootstrap over sessions (R and gross bps)
  const by = {}; for (const t of trades) (by[t.session] ||= []).push(t);
  const ses = Object.values(by), rr = rng(seed + 17);
  if (ses.length >= 3) {
    const mR = [], mG = [];
    for (let b = 0; b < boots; b++) { let sr = 0, sg = 0, c = 0; for (let i = 0; i < ses.length; i++) { const x = ses[Math.floor(rr() * ses.length)]; for (const t of x) { sr += t.R; sg += t.gross; c++; } } mR.push(c ? sr / c : 0); mG.push(c ? sg / c : 0); }
    mR.sort((a, b) => a - b); mG.sort((a, b) => a - b); const q = (m, f) => m[Math.floor(f * boots)];
    out.ci = [q(mR, 0.025), q(mR, 0.975)]; out.ciGross = [q(mG, 0.025), q(mG, 0.975)];
  } else { out.ci = null; out.ciGross = null; }
  return out;
}

// ---------- sessions: facts from the Reader, cached ----------
const engineHash = () => { const f = ["reader-drift", "reader-proposals", "reader-register", "reader-episodes", "reader-engine"]; return crypto.createHash("sha1").update(f.map(x => fs.readFileSync(path.join(HERE, "src/js", x + ".js"))).join("\n")).digest("hex").slice(0, 12); };
export function loadSessionFacts(dir, { limit = Infinity } = {}) {
  const files = fs.readdirSync(dir).filter(f => /^session_.*\.json(\.gz)?$/.test(f)).sort().slice(0, limit), hash = engineHash(); let E = null;
  fs.mkdirSync(CACHE, { recursive: true }); const out = [];
  for (const f of files) {
    const full = path.join(dir, f), st = fs.statSync(full), cf = path.join(CACHE, f + ".json");
    let facts = null; try { const c = JSON.parse(fs.readFileSync(cf, "utf8")); if (c.hash === hash && c.size === st.size) facts = c; } catch { /* rebuild */ }
    if (!facts) {
      E ||= loadEngine(null).E; const s = readInput(full); if (s.kind !== "session" || !s.inputs.length) continue;
      const e = E.replayEngine(s.inputs), hist = { bn: e.priceHistory("bn") || [], hl: e.priceHistory("hl") || [] };
      const groups = e.episodeGroups().map(g => ({ family: g.family, venue: g.venues && g.venues.length > 1 ? (g.venues.includes("bn") ? "bn" : g.venues[0]) : g.venue, aggressor: g.aggressor || null, wall: g.wall ? { side: g.wall.side } : null, tDetected: g.tDetected, stage: g.stage }));
      facts = { hash, size: st.size, file: f, sym: s.sym, t0: s.t0, t1: s.t1, hist, sigma: { bn: sigmaOf(hist.bn), hl: sigmaOf(hist.hl) }, groups };
      fs.writeFileSync(cf, JSON.stringify(facts));
    }
    facts.dir = dir; out.push(facts);
  }
  return out.filter(s => s.sym === "BTC").sort((a, b) => a.t0 - b.t0);
}
export function splitSessions(all, which, confirm = false, cutT = null, share = EXEC.holdoutShare, freshT = null) {
  // cutT (ms): fixed start-time cut; sessions starting before it are dev. Without it the latest `share` of the list is the hold-out (only for tests: it moves as sessions are added).
  const cut = cutT == null ? null : cutT, i = Math.floor(all.length * (1 - share));
  const dev = cut == null ? all.slice(0, i) : all.filter(s => s.t0 < cut), hold = cut == null ? all.slice(i) : all.filter(s => s.t0 >= cut && (freshT == null || s.t0 < freshT));      // the hold-out ends where the fresh data begins, so new sessions never leak into it
  if (which === "dev") return dev;
  if (which === "holdout") { if (!confirm) throw new Error("hold-out sessions are reserved: pass --confirm-holdout only for final candidates"); return hold; }
  if (which === "fresh") { if (!confirm) throw new Error("fresh sessions are reserved for pre-registered tests: pass --confirm-holdout"); if (freshT == null) throw new Error("no fresh cutoff"); return all.filter(x => x.t0 >= freshT); }
  if (which === "all") { if (!confirm) throw new Error("'all' includes the hold-out: pass --confirm-holdout"); return all; }
  throw new Error("--split must be dev, holdout or all");
}
// fresh data = sessions that start after the newest session that existed when the cutoff file was written; used only for pre-registered tests (see .scratch/trade-system/prereg-*.md)
export function freshCutoff(all, file = path.join(HERE, ".scratch", "trade-system", "fresh-cutoff.json")) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).cutT; } catch { /* first use */ }
  const cutT = Math.max(...all.map(x => x.t1)) + 1;
  fs.writeFileSync(file, JSON.stringify({ cutT, iso: new Date(cutT).toISOString(), createdFromSessions: all.length, note: "sessions starting at or after cutT are fresh data for pre-registered tests only; do not edit" }, null, 1)); return cutT;
}
// the hold-out cut is written once, then reused, so new sessions never move sessions between dev and hold-out
export function holdoutCutoff(all, file = path.join(HERE, ".scratch", "trade-system", "holdout-cutoff.json")) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).cutT; } catch { /* first use */ }
  const cutT = all[Math.floor(all.length * (1 - EXEC.holdoutShare))].t0;
  fs.writeFileSync(file, JSON.stringify({ cutT, iso: new Date(cutT).toISOString(), createdFromSessions: all.length, note: "sessions starting at or after cutT are the hold-out; do not edit" }, null, 1)); return cutT;
}

// ---------- self test ----------
function selftest() {
  let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok  ", m); };
  const ex = { latencyMs: 1000, costBps: 8, maxGapMs: 30000 }, T0 = 1e12;
  const mk = f => { const h = []; for (let i = 0; i <= 600; i++) h.push([T0 + i * 1000, f(i)]); return h; };
  const flat = mk(() => 100), up = mk(i => 100 * (1 + i * 1e-5)), crash = mk(i => i < 20 ? 100 : 99);
  let t = fillTrade(flat, T0 + 1000, 1, 60, 10, ex); ok(t && Math.abs(t.gross) < 1e-9 && t.net === -8 && t.exit === "time", "flat price: gross 0, net equals minus the cost, time exit");
  t = fillTrade(up, T0 + 1000, 1, 100, 50, ex); ok(t && Math.abs(t.gross - 10) < 0.2, "long on a steady rise earns 1e-5 per second (10 bps in 100 s) (" + (t && t.gross.toFixed(1)) + ")");
  t = fillTrade(up, T0 + 1000, -1, 100, 50, ex); ok(t && t.gross < -9.8, "short on a rise loses the same");
  t = fillTrade(crash, T0 + 5000, 1, 100, 30, ex); ok(t && t.exit === "stop" && Math.abs(t.gross + 100) < 1e-6 && t.R === (t.gross - 8) / 30, "a stop gapped through is filled at the tick price (-100 bps), not at the stop level, and R includes the cost");
  const slide = mk(i => 100 * (1 - i * 1e-4)); t = fillTrade(slide, T0 + 1000, 1, 100, 25, ex); ok(t && t.exit === "stop" && t.gross <= -25 && t.gross > -36, "a steady slide stops out just beyond the stop distance (" + (t && t.gross.toFixed(1)) + ")");
  t = fillTrade(crash, T0 + 5000, -1, 100, 30, ex); ok(t && t.exit === "time" && t.gross > 90, "short through the same crash is not stopped and profits");
  ok(fillTrade(flat, T0 + 590000, 1, 60, 10, ex) === null, "history ending before the hold time gives no trade");
  ok(fillTrade(flat, T0 - 500000, 1, 60, 10, ex) === null, "no price at entry gives no trade");
  const gap = flat.filter((x, i) => i < 100 || i > 200); ok(fillTrade(gap, T0 + 50000, 1, 300, 10, ex) === null, "a gap in the history gives no trade");
  // runDesign: one position at a time, direction from the thesis
  const sess = { file: "x", hist: { bn: up, hl: [] }, sigma: { bn: 0.05, hl: 0.05 }, groups: [{ family: "burst", venue: "bn", aggressor: "buy", tDetected: T0 + 10000 }, { family: "burst", venue: "bn", aggressor: "buy", tDetected: T0 + 20000 }, { family: "burst", venue: "bn", aggressor: "buy", tDetected: T0 + 200000 }] };
  const d = { trig: "reader-episode-event", thes: "continuation-momentum", p: { trig: { families: ["burst"], venue: "any" }, thes: { sign: 1 }, exit: { holdSec: 60 }, stop: { k: 3 } } };
  let tr = runDesign(d, [sess], ex); ok(tr.length === 2 && tr[0].dir === 1, "second signal inside an open position is skipped (2 trades of 3 signals)");
  d.p.thes.sign = -1; tr = runDesign(d, [sess], ex); ok(tr.every(x => x.dir === -1), "mean-reversion thesis trades against the episode");
  d.p.trig.families = ["wall"]; ok(runDesign(d, [sess], ex).length === 0, "family filter is respected");
  // determinism and summary
  d.p.trig.families = ["burst"]; const s1 = summarize(runDesign(d, [sess, { ...sess, file: "y" }, { ...sess, file: "z" }], ex), 1), s2 = summarize(runDesign(d, [sess, { ...sess, file: "y" }, { ...sess, file: "z" }], ex), 1);
  ok(JSON.stringify(s1) === JSON.stringify(s2) && s1.n === 6 && s1.sessions === 3, "summary is deterministic (" + s1.n + " trades)");
  const rz = randomizer(5), a = rz(sess, sess.groups.map(g => ({ t: g.tDetected, venue: "bn", side: 1 }))), b = randomizer(5)(sess, sess.groups.map(g => ({ t: g.tDetected, venue: "bn", side: 1 })));
  ok(JSON.stringify(a) === JSON.stringify(b) && a.length === 3, "random-entry null keeps the signal count and is seeded");
  // instantiate
  const des = instantiate({ id: "M00001", ctx: "always-on", reg: "none", trig: "reader-episode-event", thes: "continuation-momentum", exit: "elapsed-time-stop", stop: "sigma-multiple-stop", sz: "fixed-fraction-risk", hor: "minutes" }, 1);
  ok(des.p.exit.holdSec >= 60 && des.p.exit.holdSec <= 600 && des.p.stop.k >= 0.5 && des.p.stop.k <= 3, "parameters are drawn inside their ranges");
  ok(JSON.stringify(des) === JSON.stringify(instantiate({ id: "M00001", ctx: "always-on", reg: "none", trig: "reader-episode-event", thes: "continuation-momentum", exit: "elapsed-time-stop", stop: "sigma-multiple-stop", sz: "fixed-fraction-risk", hor: "minutes" }, 1)), "same design id and seed give the same parameters");
  // hold-out guard
  const fake = Array.from({ length: 10 }, (_, i) => ({ t0: i })); ok(splitSessions(fake, "dev").length === 7, "dev split is the earliest 70%");
  let threw = false; try { splitSessions(fake, "holdout"); } catch { threw = true; } ok(threw, "hold-out is refused without --confirm-holdout");
  ok(splitSessions(fake, "holdout", true).length === 3 && splitSessions(fake, "holdout", true)[0].t0 === 7, "hold-out is the latest 30%");
  const grown = fake.concat([{ t0: 10 }, { t0: 11 }]); ok(splitSessions(grown, "dev", false, 7).length === 7 && splitSessions(grown, "holdout", true, 7).length === 5, "with a fixed cut, new sessions land in the hold-out and dev does not move");
  const fresh = [{ t0: 1, t1: 5 }, { t0: 6, t1: 9 }, { t0: 12, t1: 15 }]; ok(splitSessions(fresh, "fresh", true, null, undefined, 10).length === 1, "fresh split keeps only sessions starting at or after the fresh cutoff");
  { const g = [{ t0: 1 }, { t0: 8 }, { t0: 11 }, { t0: 14 }]; ok(splitSessions(g, "holdout", true, 7, undefined, 12).length === 2 && splitSessions(g, "fresh", true, 7, undefined, 12).length === 1, "hold-out ends at the fresh cutoff: the newest session is fresh, not hold-out"); }
  let thr2 = false; try { splitSessions(fresh, "fresh", false, null, undefined, 10); } catch { thr2 = true; } ok(thr2, "fresh data is refused without --confirm-holdout");
  const NEEDS = ["level-or-range-break", "level-rejection-bounce", "sweep-or-failed-break-reclaim"];
  // sampler integration
  const g = generate({ pool: loadPool(), n: 60, seed: 4, implemented: implemented() }).designs; const imp = implemented(); ok(g.length === 60 && g.every(x => imp.trig.includes(x.trig) && imp.exit.includes(x.exit) && ["seconds", "minutes"].includes(x.hor)), "sampler draws only implemented categories");
  ok(new Set(g.map(x => x.trig)).size >= 5 && new Set(g.map(x => x.exit)).size >= 4, "most triggers and exits are drawn (" + new Set(g.map(x => x.trig)).size + " triggers, " + new Set(g.map(x => x.exit)).size + " exits in 60 designs)");
  ok(g.every(x => !(NEEDS.includes(x.trig) && x.reg === "none") && !(x.exit === "named-level-target" && x.reg === "none") && !(x.reg !== "none" && !NEEDS.includes(x.trig) && x.exit !== "named-level-target") && !(x.exit === "indicator-normalization-exit" && !["cross-venue-or-asset-divergence", "trade-flow-signal", "book-depth-and-wall-event"].includes(x.trig))), "sampled designs respect the region and normalisation rules");
  // price-move trigger: a flat path with one jump up
  const jump = []; for (let i = 0; i <= 600; i++) jump.push([T0 + i * 1000, i < 100 ? 100 : 100.1]);
  const sj = { file: "j", hist: { bn: jump, hl: [] }, sigma: { bn: 0.1, hl: 0.1 }, groups: [] };
  const pm = TEMPLATES.trig["price-move-or-distance-threshold"].entries(sj, { lookSec: 20, m: 2, venue: "bn" });
  ok(pm.length >= 1 && pm[0].side === 1 && pm[0].t === T0 + 100000, "price-move trigger fires on the jump, side up, at the first second that shows it");
  ok(TEMPLATES.trig["price-move-or-distance-threshold"].entries(sj, { lookSec: 20, m: 50, venue: "bn" }).length === 0, "a threshold above the move does not fire");
  ok(pm.every((e, i) => i === 0 || e.t - pm[i - 1].t >= 20000), "cooldown of one lookback between signals");
  // flow exit: an opposing episode closes the trade early; a same-side one does not
  const sf = { file: "f", hist: { bn: flat, hl: [] }, sigma: { bn: 0.05, hl: 0.05 }, groups: [{ family: "burst", venue: "bn", aggressor: "buy", tDetected: T0 + 10000 }, { family: "burst", venue: "bn", aggressor: "sell", tDetected: T0 + 50000 }, { family: "wall", venue: "bn", wall: { side: "bid" }, tDetected: T0 + 30000 }] };
  const df = { trig: "reader-episode-event", thes: "continuation-momentum", exit: "flow-episode-or-book-state-exit", p: { trig: { families: ["burst"], venue: "bn" }, thes: { sign: 1 }, exit: { holdSec: 200, families: ["burst", "wall"] }, stop: { k: 3 } } };
  const tf = runDesign(df, [sf], ex); ok(tf.length === 1 && tf[0].exit === "flow" && tf[0].tOut === T0 + 51000, "opposite-side episode (sell burst) exits one latency later; the supportive bid wall does not");
  df.p.exit.families = ["wall"]; ok(runDesign(df, [sf], ex)[0].exit === "time", "episodes of other families do not trigger the exit");
  const ff = fillTrade(crash, T0 + 5000, 1, 100, 30, ex, T0 + 30000); ok(ff.exit === "stop", "a stop that hits before the flow signal wins");
  ok(g.every(x => { try { instantiate(x, 1); return true; } catch { return false; } }), "every sampled design can be instantiated");
  // cross-venue premium trigger: hl is 5 bps rich between seconds 300 and 400, bn flat
  const hlRich = mk(i => i >= 300 && i < 400 ? 100.05 : 100), bnFlat = mk(() => 100);
  const sx = { file: "x", hist: { bn: bnFlat, hl: hlRich }, sigma: { bn: 0.1, hl: 0.1 }, groups: [] };
  const CV = TEMPLATES.trig["cross-venue-or-asset-divergence"], pHl = { baseSec: 120, minBps: 2, coolSec: 30, venue: "hl" };
  const eh = CV.entries(sx, pHl); ok(eh.length >= 1 && eh[0].t === T0 + 300000 && eh[0].side === 1, "premium trigger: hl rich -> signal on hl, side +1, at the first second it shows");
  ok(eh.every((e, i) => i === 0 || e.t - eh[i - 1].t >= 30000), "premium trigger: cooldown respected");
  ok(CV.entries(sx, { ...pHl, venue: "bn" })[0].side === -1, "premium trigger: the same dislocation read on bn means bn is cheap, side -1");
  ok(CV.entries(sx, { ...pHl, minBps: 10 }).length === 0, "premium trigger: threshold above the dislocation does not fire");
  const back = CV.entries(sx, pHl).filter(e => e.t >= T0 + 400000); ok(back.length === 0 || back[0].side === -1, "premium trigger: the fall back to normal reads as a dislocation the other way (or nothing)");
  const dX = { trig: "cross-venue-or-asset-divergence", thes: "mean-reversion-overreaction", exit: "elapsed-time-stop", p: { trig: pHl, thes: { sign: -1 }, exit: { holdSec: 60 }, stop: { k: 3 } } };
  const trX = runDesign(dX, [sx], ex); ok(trX.length >= 1 && trX[0].dir === -1, "fading a rich hl dislocation means going short hl");
  // --- new exits in fillTrade
  const wave = mk(i => i < 30 ? 100 + i * 0.002 : 100.06 - (i - 30) * 0.002);      // up 6 bps in 30 s, then down
  let tx2 = fillTrade(wave, T0 + 1000, 1, 300, 100, ex, null, { tpBps: 3 }); ok(tx2 && tx2.exit === "target" && tx2.gross === 3, "target is filled at the target price, not better");
  tx2 = fillTrade(wave, T0 + 1000, 1, 300, 100, ex, null, { trailBps: 2 }); ok(tx2 && tx2.exit === "trail" && tx2.gross > 3 && tx2.gross < 6, "trailing exit leaves after a 2 bps giveback from the best price (" + (tx2 && tx2.gross.toFixed(2)) + ")");
  ok(fillTrade(wave, T0 + 1000, 1, 300, 100, ex, null, { levelPx: 99 }) === null, "a level target behind the entry gives no trade");
  tx2 = fillTrade(wave, T0 + 1000, 1, 300, 100, ex, null, { levelPx: 100.04 }); ok(tx2 && tx2.exit === "target" && tx2.gross > 3.5 && tx2.gross < 4.5, "level target in front of the entry works (" + (tx2 && tx2.gross.toFixed(2)) + ")");
  tx2 = fillTrade(wave, T0 + 1000, 1, 300, 100, ex, null, { exitWhen: t => t >= T0 + 20000 }); ok(tx2 && tx2.exit === "norm" && tx2.tOut === T0 + 20000, "exitWhen closes at the first second the predicate is true");
  tx2 = fillTrade(wave, T0 + 1000, 1, 300, 100, ex, null, { tpBps: 50 }); ok(tx2 && tx2.exit === "time", "an unreachable target falls back to the time exit");
  // --- rolling extremes
  const zig = mk(i => 100 + (i % 20 < 10 ? i % 20 : 20 - (i % 20)) * 0.01), sz = { file: "z", hist: { bn: zig, hl: [] } };
  const ex1 = rollingExt(sz, "bn", 30); ok(Math.abs(ex1.hi[100] - 100.10) < 1e-9 && Math.abs(ex1.lo[100] - 100) < 1e-9 && isNaN(ex1.hi[0]), "rolling high/low over the previous 30 s exclude the current point");
  // --- range break and rejection on a box that is then broken
  const boxH = mk(i => i < 400 ? 100 + 0.01 * Math.sin(i / 7) : 100.05), sb = { file: "b", hist: { bn: boxH, hl: [] }, sigma: { bn: 0.1, hl: 0.1 }, groups: [] };
  const RB = TEMPLATES.trig["level-or-range-break"], bk = RB.entries(sb, { brkBps: 1, coolSec: 30, venue: "bn" }, { windowSec: 300 });
  ok(bk.length >= 1 && bk[0].side === 1 && bk[0].t === T0 + 400000, "range break fires up at the first second beyond the box (" + (bk[0] && bk[0].t - T0) + ")");
  ok(RB.entries(sb, { brkBps: 1, coolSec: 30, venue: "bn" }, null).length === 0 && RB.entries(sb, { brkBps: 1, coolSec: 30, venue: "bn" }, { windowSec: 300 }).every(e => e.t >= T0 + 300000), "no region means no signals, and none before the window is full");
  const touch = mk(i => i < 300 ? 100 + 0.01 * Math.sin(i / 11) : i < 330 ? 100.01 : i < 335 ? 100.01 - (i - 330) * 0.003 : 99.995), st = { file: "t", hist: { bn: touch, hl: [] }, sigma: { bn: 0.1, hl: 0.1 }, groups: [] };
  const RJ = TEMPLATES.trig["level-rejection-bounce"], rj = RJ.entries(st, { tolBps: 1, rejBps: 1, lookSec: 20, coolSec: 30, venue: "bn" }, { windowSec: 300 });
  ok(rj.length >= 1 && rj[0].side === 1, "rejection fires at the high with side +1 (approach up) after a pullback (" + rj.length + " signals)");
  ok(RJ.entries(st, { tolBps: 1, rejBps: 50, lookSec: 20, coolSec: 30, venue: "bn" }, { windowSec: 300 }).length === 0, "a pullback larger than the move does not fire");
  // --- trade flow and book depth from a hand-made flow object
  const flowS = { file: "f2", hist: { bn: mk(() => 100), hl: [] }, sigma: { bn: 0.1, hl: 0.1 }, groups: [], flow: { bn: { buy: new Array(601).fill(0).map((x, i) => i >= 200 && i < 230 ? 1000 : 12), sell: new Array(601).fill(10), liqB: [], liqS: [], imb5: new Array(601).fill(0).map((x, i) => i >= 300 && i < 330 ? 0.7 : 0), imb20: new Array(601).fill(null) }, hl: { buy: [], sell: [], liqB: [], liqS: [], imb5: [], imb20: [] } } };
  const TFS = TEMPLATES.trig["trade-flow-signal"], tfs = TFS.entries(flowS, { lookSec: 10, share: 0.7, m: 3, venue: "bn" });
  ok(tfs.length >= 1 && tfs[0].side === 1 && tfs[0].t >= T0 + 200000 && tfs[0].t <= T0 + 215000, "trade-flow signal fires on a burst of aggressor buying, side +1, inside the burst (" + (tfs[0] && (tfs[0].t - T0) / 1000) + " s)");
  ok(TFS.norm(flowS, { lookSec: 10, venue: "bn" })(T0 + 100000) === true && TFS.norm(flowS, { lookSec: 10, venue: "bn" })(T0 + 210000) === false, "trade-flow normaliser: balanced flow is normal, the burst is not");
  const BD = TEMPLATES.trig["book-depth-and-wall-event"], bd = BD.entries(flowS, { edge: 5, thr: 0.5, sustainSec: 5, coolSec: 30, venue: "bn" });
  ok(bd.length === 1 && bd[0].side === 1 && bd[0].t === T0 + 304000, "book-depth signal needs the imbalance to hold for sustainSec seconds (fires at " + (bd[0] && (bd[0].t - T0) / 1000) + " s)");
  ok(BD.entries(flowS, { edge: 5, thr: 0.9, sustainSec: 5, coolSec: 30, venue: "bn" }).length === 0, "book-depth threshold above the reading does not fire");
  // --- premium normaliser
  const nrm = TEMPLATES.trig["cross-venue-or-asset-divergence"].norm(sx, pHl); ok(nrm(T0 + 350000) === false && nrm(T0 + 200000) === true, "premium normaliser: dislocated is not normal, flat is");
  // --- runDesign wiring for a level exit and a normalisation exit
  const dN = { trig: "cross-venue-or-asset-divergence", thes: "mean-reversion-overreaction", exit: "indicator-normalization-exit", p: { trig: pHl, reg: {}, thes: { sign: -1 }, exit: { holdSec: 200 }, stop: { k: 3 } } };
  const trN = runDesign(dN, [sx], ex); ok(trN.length >= 1 && trN.some(x => x.exit === "norm" || x.exit === "time"), "normalisation exit runs through runDesign");
  const dL = { trig: "level-or-range-break", thes: "continuation-momentum", exit: "named-level-target", p: { trig: { brkBps: 1, coolSec: 30, venue: "bn" }, reg: { windowSec: 300 }, thes: { sign: 1 }, exit: { holdSec: 100, frac: 0.5 }, stop: { k: 3 } } };
  ok(Array.isArray(runDesign(dL, [sb], ex)), "level target runs through runDesign without error");
  dN.exit = "indicator-normalization-exit"; dN.trig = "price-move-or-distance-threshold"; dN.p.trig = { lookSec: 20, m: 2, venue: "bn" }; ok(runDesign(dN, [sj], ex).length === 0, "a trigger without a normaliser trades nothing under a normalisation exit");
  console.log(fail ? fail + " FAILED" : "all passed"); process.exit(fail ? 1 : 0);
}

// ---------- cli ----------
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf("--" + k); return i < 0 ? d : args[i + 1]; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes("--selftest")) selftest();
  else {
    const dir = path.resolve(HERE, arg("sessions", "sessions")), seed = Number(arg("seed", 1)), n = Number(arg("n", 100)), nullReps = Number(arg("null", 20));
    const costs = arg("costs", "0,2,4,8").split(",").map(Number), split = arg("split", "dev");
    const ex = { ...EXEC, latencyMs: Number(arg("latency", EXEC.latencyMs)) };      // entry (and flow-exit) delay after a signal, ms
    const t0 = Date.now(), all = loadSessionFacts(dir), sessions = splitSessions(all, split, args.includes("--confirm-holdout"), holdoutCutoff(all), undefined, split === "fresh" || split === "holdout" ? freshCutoff(all) : null);
    if (!sessions.length) { console.error(`no sessions in the '${split}' split yet`); process.exit(3); }
    console.error(`sessions: ${all.length} BTC total, ${sessions.length} in '${split}' split (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    // --balance: the same number of designs in every cell of trigger x thesis x exit, drawn from a larger sample
    // --designs-file frozen.json: replay exactly these designs (id, trig, thes, exit, hor, p) instead of drawing them; used by pre-registrations, which must not depend on the sampler's current categories
    let designs;
    if (arg("designs-file", null)) designs = JSON.parse(fs.readFileSync(arg("designs-file"), "utf8")).map(d => ({ sampler: "frozen", ...d }));
    else {
      let designs = generate({ pool: loadPool(), n: args.includes("--balance") ? n * 12 : n, seed, implemented: implemented() }).designs;
      if (args.includes("--balance")) {
        const by = arg("balance-by", "trig,thes,exit").split(","), cellOf = d => by.map(k => d[k]).join(" | "), cells = new Set(designs.map(cellOf)), per = Math.ceil(n / cells.size), cnt = {}, keep = [];
        for (const d of designs) { const c = cellOf(d); cnt[c] = (cnt[c] || 0) + 1; if (cnt[c] <= per) keep.push(d); }
        designs = keep.slice(0, n);
      }
      // --only key=value,...: keep designs with those categories (keys trig, thes, exit, stop, hor). The list is built exactly as without the filter, so a design keeps its id and parameters.
      if (arg("only", null)) { const f = Object.fromEntries(arg("only").split(",").map(x => x.split("="))); designs = designs.filter(d => Object.entries(f).every(([k, v]) => d[k] === v)); }
      if (arg("ids", null)) { const ids = new Set(JSON.parse(fs.readFileSync(arg("ids"), "utf8"))); designs = designs.filter(d => ids.has(d.id)); }      // --ids file.json: a JSON array of design ids (pre-registered lists)

    }
    if (!arg("designs-file", null)) designs = designs.map(x => instantiate(x, seed));
    { const tf = Date.now(); let k = 0; for (const x of sessions) { flowOf(x); k++; } console.error(`flow facts ready for ${k} sessions (${((Date.now() - tf) / 1000).toFixed(0)} s)`); }
    const rows = [];
    for (const d of designs) {
      const tr = runDesign(d, sessions, ex), sm = summarize(tr, seed), nul = [];
      for (let k = 0; k < nullReps; k++) { const t = runDesign(d, sessions, ex, randomizer(seed * 7919 + Number(d.id.slice(1)) * 31 + k)); if (t.length) nul.push(mean(t.map(x => x.gross))); }
      const better = nul.filter(x => x >= sm.meanGrossBps).length, p = nul.length ? (1 + better) / (1 + nul.length) : null;      // share of random-entry runs at least as good (gross bps), one-sided
      nul.sort((a, b) => a - b);
      rows.push({ id: d.id, sampler: d.sampler, trig: d.trig, thes: d.thes, exit: d.exit, hor: d.hor, p: d.p, ...sm, netBps: Object.fromEntries(costs.map(c => [c, sm.meanGrossBps == null ? null : sm.meanGrossBps - c])), null: nul.length ? { mean: mean(nul), lo: nul[Math.floor(0.05 * (nul.length - 1))], hi: nul[Math.ceil(0.95 * (nul.length - 1))], p } : null });
    }
    const out = arg("out", null); if (out) fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    console.log(`designs ${rows.length}; trades total ${rows.reduce((a, r) => a + r.n, 0)}; split ${split}; null reps ${nullReps}; latency ${ex.latencyMs} ms`);
    const f = (x, d = 2) => x == null ? "-" : x.toFixed(d);
    const group = (label, keyFn) => {
      const keys = [...new Set(rows.map(keyFn))].sort();
      console.log(`\n${label}:  designs | mean gross bps | gross minus null | null p<=0.05 (chance) | CI above 0 | CI below 0 | best gross`);
      for (const k of keys) {
        const g = rows.filter(r => keyFn(r) === k && r.null); if (!g.length) continue;
        const gross = g.map(r => r.meanGrossBps), ex = g.map(r => r.meanGrossBps - r.null.mean);
        console.log(`  ${k.padEnd(62)} ${String(g.length).padStart(4)} | ${f(mean(gross)).padStart(5)} | ${f(mean(ex)).padStart(5)} | ${String(g.filter(r => r.null.p <= 0.05).length).padStart(3)} (${f(0.05 * g.length, 1)}) | ${String(g.filter(r => r.ciGross && r.ciGross[0] > 0).length).padStart(3)} | ${String(g.filter(r => r.ciGross && r.ciGross[1] < 0).length).padStart(3)} | ${f(Math.max(...gross)).padStart(5)}`);
      }
    };
    group("by trigger", r => r.trig); group("by thesis", r => r.thes); group("by exit", r => r.exit);
    group("by trigger x thesis", r => r.trig + " | " + r.thes); group("by trigger x thesis x exit", r => r.trig + " | " + r.thes + " | " + r.exit);
    console.log("\ntop 8 designs by gross bps:");
    for (const r of rows.slice().sort((a, b) => b.meanGrossBps - a.meanGrossBps).slice(0, 8)) console.log(`${r.id} ${r.thes.slice(0, 5)} ${r.trig.slice(0, 5)} ${JSON.stringify(r.p.trig)} exit ${r.exit.slice(0, 4)} ${JSON.stringify(r.p.exit)} k ${r.p.stop.k} | n ${r.n} gross ${f(r.meanGrossBps)} ci ${r.ciGross ? r.ciGross.map(x => f(x)).join("..") : "-"} | null ${f(r.null && r.null.mean)} p ${f(r.null && r.null.p, 2)}`);
  }
}
