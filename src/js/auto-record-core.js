"use strict";
// Auto-record on volatility (pure, no DOM, no timers): how volatile the market is now against its own last hour, and when a recording should
// start and stop. Prices arrive once a second (Binance mark price); everything here only reads them.
// Volatility is the same scale the Reader uses for sigma: the robust spread of overlapping 15 s returns (75th percentile of the absolute
// deviation from the median, over 1.1503), divided by the square root of the lag, so it reads in bps per root second.
const AUTOREC = (() => {
  const DEFAULTS = {
    fastSec:300, slowSec:3600, lagSec:15, minFast:200, minSlow:900,       // 5 min against the last hour; needs 15 min of history before it can judge
    trigRatio:1.8, trigSigma:1.2, trigFloor:.4,                                          // start when the 5 min sigma is 1.8x the hour's, or above 1.2 bps/root s (either; the ratio only counts above trigFloor, so a dead-calm market cannot trigger it)
    exitRatio:1.3, exitSigma:.8, calmMin:5, maxMin:60, staleSec:10,                     // stop after 5 minutes below both exit levels, or after 60 minutes
    rearm:true, cooldownMin:3, maxRuns:8, preMin:10, epTrig:true, colTrig:true,                                              // after a recording keep watching (no new start for 3 minutes, none at all after a stop at the time limit), at most 8 recordings per arming
  };
  const SIZE = 4096, SD_PER_Q75 = 1.1503, Q75 = .75;     // the 75th percentile of the absolute deviation over 1.1503 is the standard deviation of a normal; the same constants as the engine's sigma
  function createHistory() { return {px:new Float64Array(SIZE), sec:new Float64Array(SIZE).fill(-1), last:-1}; }
  function push(h, tMs, p) {
    if (!(p > 0)) return;
    const s = Math.floor(tMs/1000), i = s % SIZE;
    h.px[i] = p; h.sec[i] = s; if (s > h.last) h.last = s;
  }
  // the price at second s, or the latest one within 3 s before it (a missed second does not break a return)
  function priceAt(h, s) { for (let k = 0; k <= 3; k++){ const i = (s-k) % SIZE; if (h.sec[i] === s-k) return h.px[i]; } return null; }
  // the last secs seconds of prices as [second, price] pairs (a missed second is left out): the trace kept with a recording
  function dump(h, nowMs, secs) { const out = [], end = Math.floor(nowMs/1000); for (let s = end - secs + 1; s <= end; s++){ const i = s % SIZE; if (h.sec[i] === s) out.push([s, h.px[i]]); } return out; }
  // robust sigma over the last winSec seconds: {sigma, n}
  function sigma(h, winSec, lagSec) {
    const r = [];
    for (let s = h.last - winSec + 1; s <= h.last; s++){ const a = priceAt(h, s), b = priceAt(h, s - lagSec); if (a && b) r.push((a/b - 1)*1e4); }
    if (r.length < 30) return {sigma:0, n:r.length};
    const s = Float64Array.from(r).sort(), med = s[s.length >> 1], d = Float64Array.from(s, x => Math.abs(x - med)).sort();
    return {sigma:d[Math.floor(d.length*Q75)]/SD_PER_Q75/Math.sqrt(lagSec), n:r.length};
  }
  // nowMs (the clock the prices were stamped with): when the newest price is older than staleSec the stream has stalled, and the last window is not judged
  function vol(h, cfg, nowMs) {
    const c = Object.assign({}, DEFAULTS, cfg), f = sigma(h, c.fastSec, c.lagSec), sl = sigma(h, c.slowSec, c.lagSec);
    return {fast:f.sigma, slow:sl.sigma, ratio:sl.sigma > 0 ? f.sigma/sl.sigma : 0, nFast:f.n, nSlow:sl.n, ready:f.n >= c.minFast && sl.n >= c.minSlow && !(nowMs != null && nowMs/1000 - h.last > c.staleSec)};
  }
  // One decision per check. st: {mode:"waiting"|"recording", since, calmSince}; returns the new state and an action ("start" | "stop" | null) with the reason.
  // ep (optional): what the Reader sees right now, {active, live}: episodes (not walls) that are active, and active or fading. With epTrig an active one also starts a recording
  // (the Reader's own detection, which needs no big price move: absorption, exhaustion, a burst), and a recording is not calm while one is live.
  // ep.col (with colTrig): the collectors read forced flow (liquidations) or a stressed market; that also starts a recording (why "collectors") and keeps it from counting as calm.
  function step(st, v, tMs, cfg, ep) {
    const c = Object.assign({}, DEFAULTS, cfg), o = Object.assign({}, st);
    if (o.mode === "waiting"){
      if (o.until != null && tMs < o.until) return {st:o, action:null, why:"cooldown"};     // just recorded: a long volatile stretch must not become a string of short files
      if (v.ready && ((v.ratio >= c.trigRatio && v.fast >= c.trigFloor) || v.fast >= c.trigSigma)){ o.mode = "recording"; o.since = tMs; o.calmSince = null; return {st:o, action:"start", why:v.ratio >= c.trigRatio && v.fast >= c.trigFloor ? "ratio" : "sigma"}; }
      const byEp = c.epTrig && ep && ep.active > 0, byCol = c.colTrig && ep && ep.col;
      if (v.ready && (byEp || byCol)){ o.mode = "recording"; o.since = tMs; o.calmSince = null; return {st:o, action:"start", why:byEp ? "episode" : "collectors"}; }
      return {st:o, action:null, why:""};
    }
    const calm = v.ready && v.ratio < c.exitRatio && v.fast < c.exitSigma && !(c.epTrig && ep && ep.live > 0) && !(c.colTrig && ep && ep.col);
    if (!calm) o.calmSince = null; else if (o.calmSince == null) o.calmSince = tMs;
    if (tMs - o.since >= c.maxMin*60000) return {st:o, action:"stop", why:"max"};
    if (o.calmSince != null && tMs - o.calmSince >= c.calmMin*60000) return {st:o, action:"stop", why:"calm"};
    return {st:o, action:null, why:""};
  }
  // the state to carry on with after a recording was saved, when auto-record stays armed
  // why: how the recording ended. A stop at the time limit means the market may still be wild, so there is no cooldown; after a calm stop (5 quiet minutes) a short one keeps a flickering trigger from making a string of tiny files.
  const afterStop = (tMs, cfg, why) => ({mode:"waiting", until:why === "max" ? tMs : tMs + Object.assign({}, DEFAULTS, cfg).cooldownMin*60000});
  return {DEFAULTS, createHistory, push, dump, sigma, vol, step, afterStop};
})();
