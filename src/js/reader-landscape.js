"use strict";
// Flow landscape (pure, no DOM): the grid behind the 3D view in the Reader tab. It only READS trades and mid prices; it never feeds the
// Reader engine, so nothing it does can change a detection.
//   X  price relative to the venue's mid at the playhead, in bps
//   Y  age: seconds before the playhead (the newest slice is index 0)
//   Z  net aggressor flow in that cell, in $ (buy aggression positive, sell aggression negative)
//   4th dimension: the playhead (any moment the source still has), so the terrain re-forms as time moves.
// A source is {trades:[{t,v,side,ntl}] sorted by t, mid:(venue,t)=>number|null}.
const READER_LANDSCAPE = (() => {
  const VENUES = ["bn", "hl"];
  const DEFAULTS = {xBins:41, yBins:24, spanMs:60000, halfBps:4, venue:"both"};
  const lower = (a, t, key) => { let lo = 0, hi = a.length; while (lo < hi){ const m = (lo+hi) >> 1; if (key(a[m]) < t) lo = m+1; else hi = m; } return lo; };
  const venuesOf = o => o.venue === "bn" ? ["bn"] : o.venue === "hl" ? ["hl"] : VENUES;

  // Offset of a price from the venue's mid at the playhead, in bps.
  const off = (px, mid) => (px/mid - 1) * 1e4;

  // The mid-price path over the window (offset from the playhead's mid, averaged over the chosen venues); null where unknown.
  function path(src, tNow, o) {
    const vs = venuesOf(o), base = {}; for (const v of vs){ const m = src.mid(v, tNow); if (m > 0) base[v] = m; }
    const out = [];
    for (let j = 0; j < o.yBins; j++){
      const t = tNow - (j+.5)/o.yBins*o.spanMs; let s = 0, n = 0;
      for (const v of vs){ if (!base[v]) continue; const m = src.mid(v, t); if (m > 0){ s += off(m, base[v]); n++; } }
      out.push(n ? s/n : null);
    }
    return out;
  }

  // A symmetric price range that holds the trades and the mid path of the window (at least 1.5 bps, rounded up so it does not jitter).
  // opt.path lets a caller that already has the path pass it in instead of computing it again.
  function autoHalf(src, tNow, opt) {
    const o = Object.assign({}, DEFAULTS, opt), vs = venuesOf(o), [i0, i1] = span(src, tNow, o), a = [];
    for (const v of vs){ const m = src.mid(v, tNow); if (!(m > 0)) continue; for (let i = i0; i < i1; i++){ const tr = src.trades[i]; if (tr.v === v && tr.px > 0) a.push(Math.abs(off(tr.px, m))); } }
    for (const p of (o.path || path(src, tNow, o))) if (p != null) a.push(Math.abs(p));
    if (!a.length) return o.halfBps;
    a.sort((x, y) => x-y); const p95 = a[Math.min(a.length-1, Math.floor(a.length*.95))];
    const x = Math.max(1.5, p95*1.15), step = x < 5 ? .5 : x < 20 ? 1 : 5;
    return Math.ceil(x/step)*step;
  }

  // The index range [i0, i1) of the trades inside the window; nothing is copied.
  function span(src, tNow, o) {
    const i0 = lower(src.trades, tNow - o.spanMs, x => x.t);
    let i1 = i0; while (i1 < src.trades.length && src.trades[i1].t <= tNow) i1++;
    return [i0, i1];
  }

  // The surface at the playhead tNow. z is the raw net flow per cell; zs is the lightly smoothed copy used for drawing.
  function grid(src, tNow, opt) {
    const o = Object.assign({}, DEFAULTS, opt), nx = o.xBins, ny = o.yBins, z = new Float64Array(nx*ny), half = o.halfBps;
    const vs = venuesOf(o), base = {}; for (const v of vs){ const m = src.mid(v, tNow); if (m > 0) base[v] = m; }
    let buy = 0, sell = 0, n = 0, clipped = 0;
    const [i0, i1] = span(src, tNow, o);
    for (let k = i0; k < i1; k++){
      const tr = src.trades[k], m = base[tr.v]; if (!m || !(tr.px > 0) || !(tr.ntl > 0)) continue;
      const xi = Math.floor((off(tr.px, m) + half)/(2*half)*nx), yi = Math.floor((tNow - tr.t)/o.spanMs*ny);
      if (xi < 0 || xi >= nx){ clipped++; continue; }
      const yj = Math.min(ny-1, Math.max(0, yi)), s = tr.side === "buy" ? tr.ntl : -tr.ntl;
      z[yj*nx + xi] += s; n++; if (s > 0) buy += s; else sell -= s;
    }
    const blur = src => { const out = new Float64Array(src.length);                // two passes of a 3x3 weighted blur, for the picture only
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
        let s = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){ const jj = j+dj, ii = i+di; if (jj < 0 || jj >= ny || ii < 0 || ii >= nx) continue; const w = (dj === 0 ? 2 : 1) * (di === 0 ? 2 : 1); s += src[jj*nx+ii]*w; c += w; }
        out[j*nx+i] = s/c;
      } return out; };
    const zs = blur(blur(z));
    const tmp = new Float64Array(zs.length); let cnt = 0; for (let k = 0; k < zs.length; k++){ const m = Math.abs(zs[k]); if (m > 0) tmp[cnt++] = m; }
    const sorted = tmp.subarray(0, cnt).sort(), scale = cnt ? sorted[Math.min(cnt-1, Math.floor(cnt*.97))] : 0;   // the 97th percentile of the smoothed flow: what the picture treats as full height
    let peakBuy = null, peakSell = null;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
      const v = z[j*nx+i], cell = {z:v, xBps:-half + (i+.5)/nx*2*half, ageS:(j+.5)/ny*o.spanMs/1000};
      if (v > 0 && (!peakBuy || v > peakBuy.z)) peakBuy = cell;
      if (v < 0 && (!peakSell || v < peakSell.z)) peakSell = cell;
    }
    const p = o.path || path(src, tNow, o), first = p.slice().reverse().find(x => x != null);
    return {nx, ny, half, scale, spanMs:o.spanMs, venue:o.venue, tNow, z, zs, buy, sell, net:buy-sell, trades:n, clipped, peakBuy, peakSell, path:p, moveBps:first == null ? null : -first};
  }

  // A recorded session (the inputs of the Reader's record/replay) as a source: trades in time order and a mid series per venue.
  function fromInputs(inputs) {
    const trades = [], mids = {bn:[], hl:[]}; let t0 = Infinity, t1 = -Infinity;
    for (const r of inputs){
      if (r[0] === "t" && r[1] && r[1].t > 0 && r[1].px > 0 && r[1].ntl > 0 && VENUES.includes(r[1].v)){ const x = r[1]; trades.push({t:x.t, v:x.v, side:x.side, px:x.px, ntl:x.ntl}); if (x.t < t0) t0 = x.t; if (x.t > t1) t1 = x.t; }
      else if (r[0] === "q" && VENUES.includes(r[1]) && r[3] > 0 && r[4] >= r[3] && r[2] > 0){ const a = mids[r[1]]; if (!a.length || r[2] >= a[a.length-1][0]) a.push([r[2], (r[3]+r[4])/2]); if (r[2] < t0) t0 = r[2]; if (r[2] > t1) t1 = r[2]; }
    }
    trades.sort((a, b) => a.t - b.t);
    return {trades, mids, t0, t1, mid:(v, t) => midAt(mids[v], t)};
  }
  // Latest mid at or before t (within 5 s), else the first one after it.
  function midAt(a, t) {
    if (!a || !a.length) return null;
    const i = lower(a, t, x => x[0]);
    if (i < a.length && a[i][0] === t) return a[i][1];
    if (i > 0 && t - a[i-1][0] <= 5000) return a[i-1][1];
    return i < a.length && a[i][0] - t <= 5000 ? a[i][1] : null;
  }
  // Identifies what a drawn grid was computed from, so a redraw (rotating) can reuse it. live: the playhead follows the market, rounded to
  // half a second; a session is told apart by id, live trades by count and first/last time (the buffer is trimmed, so the count alone can repeat).
  function cacheKey(o) {
    const tq = o.live ? Math.round(o.tNow/500)*500 : o.tNow, n = o.trades ? o.trades.length : 0;
    const data = o.sessId != null ? "s" + o.sessId : n + "@" + (n ? o.trades[0].t + "-" + o.trades[n-1].t : 0);
    return [o.src, o.venue, o.spanMs, tq, data].join("|");
  }
  return {DEFAULTS, grid, autoHalf, path, span, fromInputs, midAt, cacheKey};
})();
