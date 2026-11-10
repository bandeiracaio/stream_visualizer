// Sigma and price helpers the design harness uses. Moved unchanged from src/js/scoreboard-core.js (that file leaves the app in step 2c).
// Sigma: 75th percentile of absolute deviation of overlapping 15 s returns / 1.1503 / sqrt(15), floor 0.05 bps (ADR 0004).
const PLAN = { horizonsSec:[60, 300, 900], minN:8, sigmaLagSec:15, sigmaFloor:0.05, randomStepSec:10, z:1.96 };
const sideDir = side => side === "buy" || side === "bid" ? 1 : side === "sell" || side === "ask" ? -1 : 0;      // aggressors are buy / sell; a wall's side is bid / ask (a bid wall protects upward)
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m])/2; };

// ---------- price helpers: hist is the engine's [[t_ms, price]] one point a second
function priceAt(h, t) {      // newest point at or before t, within 2 s of it (the engine's own rule)
  let lo = 0, hi = h.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r >= 0 && t - h[r][0] <= 2000 ? h[r][1] : null;
}
function sigmaOf(h, plan = PLAN) {      // bps per root second over the whole history
  const rets = [];
  for (let i = 0; i < h.length; i++) { const p0 = h[i][1], p1 = priceAt(h, h[i][0] + plan.sigmaLagSec*1000); if (p0 > 0 && p1 > 0 && h[i][0] + plan.sigmaLagSec*1000 <= h[h.length - 1][0]) rets.push((p1/p0 - 1)*1e4); }
  if (rets.length < 60) return plan.sigmaFloor;
  const med = median(rets), dev = rets.map(x => Math.abs(x - med)).sort((a, b) => a - b), q75 = dev[Math.floor(0.75*(dev.length - 1))];
  return Math.max(q75/1.1503/Math.sqrt(plan.sigmaLagSec), plan.sigmaFloor);
}
function forwardMove(h, t, horizonSec, dir, sigma) {      // signed move in sigmas after horizonSec; null when the history does not reach that far or the start has no price
  const end = t + horizonSec*1000; if (!h.length || end > h[h.length - 1][0]) return null;
  const p0 = priceAt(h, t), p1 = priceAt(h, end); if (!(p0 > 0) || !(p1 > 0)) return null;
  return dir*((p1/p0 - 1)*1e4)/(sigma*Math.sqrt(horizonSec));
}
export { PLAN, sideDir, sigmaOf, forwardMove };
