// Small shared statistics for the analysis lab scripts (lab-*.mjs). Pure, no I/O. `node lab-stats.mjs --selftest` checks them.
// Everything here ignores non-finite values the way the callers want: a missing reading never becomes a zero.
import { fileURLToPath } from "node:url";

export const finite = a => a.filter(Number.isFinite);
// quantile q in [0,1] by linear interpolation on the sorted finite values; null when there are none
export function quantile(a, q) {
  const s = finite(a).sort((x, y) => x - y); if (!s.length) return null;
  const p = (s.length - 1) * Math.min(1, Math.max(0, q)), lo = Math.floor(p), hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
}
export const median = a => quantile(a, 0.5);
export function mean(a) { const f = finite(a); return f.length ? f.reduce((s, x) => s + x, 0) / f.length : null; }
export function std(a) { const f = finite(a); if (f.length < 2) return null; const m = mean(f); return Math.sqrt(f.reduce((s, x) => s + (x - m) * (x - m), 0) / (f.length - 1)); }
// ranks with ties averaged (1-based)
export function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
export function pearson(x, y) {
  const n = x.length; if (n < 3 || y.length !== n) return null;
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
// Spearman rank correlation over the pairs where both values are finite; null under 3 pairs
export function spearman(x, y) {
  const xs = [], ys = []; for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) { xs.push(x[i]); ys.push(y[i]); }
  return xs.length < 3 ? null : pearson(ranks(xs), ranks(ys));
}
// seeded generator (mulberry32), so a result can be re-run exactly
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function selftest() {
  const bad = [], ok = (c, m) => { if (!c) bad.push(m); }, near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
  ok(quantile([1, 2, 3, 4, 5], 0.5) === 3 && quantile([1, 2, 3, 4], 0.5) === 2.5 && quantile([], 0.5) === null && quantile([NaN, 7], 0.9) === 7, "quantile");
  ok(near(mean([1, 2, 3, NaN]), 2) && mean([]) === null && near(std([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395), "mean/std");
  ok(ranks([10, 20, 20, 30]).join() === "1,2.5,2.5,4", "ranks with ties");
  ok(near(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 1000]), 1) && near(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1) && spearman([1, 2], [1, 2]) === null, "spearman monotone");
  ok(near(spearman([1, 2, NaN, 4, 5], [2, 4, 9, 8, 10]), 1), "spearman skips pairs with a missing value");
  ok(pearson([1, 1, 1], [1, 2, 3]) === null, "pearson of a constant is null");
  const r = rng(7), a = [r(), r(), r()], r2 = rng(7); ok(a[0] === r2() && a[1] === r2() && a.every(v => v >= 0 && v < 1), "rng repeatable and in [0,1)");
  return bad;
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--selftest")) {
  const bad = selftest(); if (bad.length) { console.error("FAIL: " + bad.join("; ")); process.exit(1); } console.log("lab-stats selftest: ok");
}
