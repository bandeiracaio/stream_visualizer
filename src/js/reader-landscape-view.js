"use strict";
// Flow landscape view (Reader tab): a 3D surface of where, and how long ago, buyers and sellers hit the book, with the playhead as the
// fourth dimension. All the maths is in reader-landscape.js. This file only reads app state (trades, mids, the loaded session, the
// episodes) and draws; it never writes to the Reader engine. It hooks renderReader, and every call is guarded, so if anything here
// fails the rest of the Reader tab keeps working.
const LV = {
  src: "live", venue: store.get("ls.venue", "both"), spanMs: +store.get("ls.span", 60000) || 60000, speed: +store.get("ls.speed", 4) || 4, marks: store.get("ls.marks", "all"),
  yaw: -.62, pitch: .62, t: null, play: false, half: 0, zscale: 0, sess: null, sessOf: null, drag: null, last: 0, raf: 0, dirty: true, cache: null, order: null, orderKey: "", ms: 0,
};
const ls$ = id => document.getElementById(id);
const LS_HEIGHT = .78;                      // tallest peak, as a share of half the floor width

function lsSource() {
  if (LV.src === "session") {
    if (typeof RT === "undefined" || !RT.session) return null;
    if (LV.sessOf !== RT.session){ LV.sessOf = RT.session; LV.sessId = (LV.sessId || 0) + 1; LV.sess = READER_LANDSCAPE.fromInputs(RT.session.inputs); LV.t = null; }
    return LV.sess.trades.length ? LV.sess : null;
  }
  return {
    trades, t0: nowEx() - KEEP, t1: nowEx() - 300,
    mid: (v, t) => {
      const last = midHist.length ? midHist[midHist.length-1] : null;
      if (!last) return null;
      if (t >= last.t) return last[v] > 0 ? last[v] : null;
      let lo = 0, hi = midHist.length;
      while (lo < hi){ const m = (lo+hi) >> 1; if (midHist[m].t < t) lo = m+1; else hi = m; }
      const e = midHist[Math.min(lo, midHist.length-1)];
      return e && e[v] > 0 && Math.abs(e.t - t) < 5000 ? e[v] : null;
    },
  };
}
const lsRange = src => src === LV.sess ? {a: src.t0, b: src.t1} : {a: src.t0 + LV.spanMs, b: src.t1};

// ---------- drawing ----------
// Cost control (v022): the data (grid) is computed only when the playhead, window, venue or live data changes; rotating redraws from the cached
// grid. Each frame projects the 41x24 vertices once (not four corners per quad), walks the cells far to near in an order that is sorted only
// when the angle changes, and fills from a small colour table. While dragging or playing it draws at 1x resolution without cell outlines.
const LS_BUY = [47,191,113], LS_SELL = [229,83,75], LS_LEVELS = 24;
const lsRgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const LS_FILL = [LS_SELL, LS_BUY].map(col => Array.from({length: LS_LEVELS+1}, (_, k) => { const m = k/LS_LEVELS; return lsRgba(col.map(c => Math.round(c*(.45+.55*Math.sqrt(m)) + 12*(1-m))), (.25 + .7*Math.sqrt(m)).toFixed(3)); }));
const LS_FAM = {absorption:"122,162,247", exhaustion:"240,185,80", burst:"187,134,252", wall:"214,221,230"};   // episode marks on the floor
const LS_EDGE = [LS_SELL, LS_BUY].map(col => lsRgba(col, .28));

function lsPrepCanvas(cv, fast) {
  const dpr = fast ? 1 : Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w*dpr) || cv.height !== Math.round(h*dpr)){ cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr); }
  const ctx = cv.getContext("2d"); ctx.setTransform(cv.width/w, 0, 0, cv.height/h, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.font = "10.5px ui-monospace,Menlo,Consolas,monospace";
  return {ctx, w, h};
}

function lsDraw(cv, g, info, fast, marks) {
  const {ctx, w, h} = lsPrepCanvas(cv, fast); if (w < 60) return;
  const nx = g.nx, ny = g.ny, n = nx*ny, S = Math.min(w*.27, h*.33), cx = w/2, cy = h*.5;
  const cyw = Math.cos(LV.yaw), syw = Math.sin(LV.yaw), cp = Math.cos(LV.pitch), sp = Math.sin(LV.pitch);
  const P = (X, H, Z) => { const x1 = X*1.6*cyw - Z*syw, z1 = X*1.6*syw + Z*cyw, y2 = H*cp + z1*sp, z2 = z1*cp - H*sp, f = 3.6/(3.6 + z2); return [cx + x1*f*S, cy - y2*f*S]; };
  const U = i => (i+.5)/nx*2 - 1, Zc = j => (j+.5)/ny*2 - 1;
  const sc = LV.zscale || 1, sq = x => Math.sign(x)*Math.sqrt(Math.min(1, Math.abs(x)/sc));
  ctx.lineWidth = 1;
  // floor and grid
  const c4 = [P(-1,0,-1), P(1,0,-1), P(1,0,1), P(-1,0,1)];
  ctx.beginPath(); c4.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
  ctx.fillStyle = TH.a("accent",.05); ctx.fill(); ctx.strokeStyle = TH.line; ctx.stroke();
  ctx.strokeStyle = TH.a("dim",.16); ctx.beginPath();
  for (let k = 1; k < 4; k++){ const u = -1 + k/2, a = P(u,0,-1), b = P(u,0,1), c = P(-1,0,u), d = P(1,0,u); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.moveTo(c[0],c[1]); ctx.lineTo(d[0],d[1]); }
  ctx.stroke();
  ctx.setLineDash([4,4]); ctx.strokeStyle = TH.a("text",.4); { const a = P(0,0,-1), b = P(0,0,1); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); } ctx.setLineDash([]);
  const trace = (style, width) => {                              // where the price actually was
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.beginPath(); let pen = false;
    g.path.forEach((off, j) => { if (off == null){ pen = false; return; } const p = P(Math.max(-1, Math.min(1, off/g.half)), 0, Zc(j)); pen ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); pen = true; });
    ctx.stroke(); ctx.lineWidth = 1;
  };
  trace(TH.a("hi",.95), 2);
  // vertices, projected once
  const vx = new Float32Array(n), vy = new Float32Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){ const k = j*nx + i, p = P(U(i), sq(g.zs[k]) * LS_HEIGHT, Zc(j)); vx[k] = p[0]; vy[k] = p[1]; }
  // far-to-near cell order depends only on the angle
  const key = LV.yaw.toFixed(3) + "|" + LV.pitch.toFixed(3) + "|" + nx + "x" + ny;
  if (LV.orderKey !== key){
    const m = (nx-1)*(ny-1), depth = new Float64Array(m), idx = new Uint16Array(m);
    for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++){ const q = j*(nx-1) + i; idx[q] = q; depth[q] = (U(i)+.5/nx)*1.6*syw + (Zc(j)+.5/ny)*cyw; }
    idx.sort((a, b) => depth[b] - depth[a]); LV.order = idx; LV.orderKey = key;
  }
  const order = LV.order;
  for (let t = 0; t < order.length; t++){
    const q = order[t], j = (q / (nx-1)) | 0, i = q - j*(nx-1), k = j*nx + i;
    const v = sq((g.zs[k] + g.zs[k+1] + g.zs[k+nx] + g.zs[k+nx+1]) / 4);
    if (v > -.04 && v < .04) continue;
    const side = v > 0 ? 1 : 0, lv = Math.min(LS_LEVELS, Math.round(Math.abs(v)*LS_LEVELS));
    ctx.beginPath(); ctx.moveTo(vx[k], vy[k]); ctx.lineTo(vx[k+1], vy[k+1]); ctx.lineTo(vx[k+nx+1], vy[k+nx+1]); ctx.lineTo(vx[k+nx], vy[k+nx]); ctx.closePath();
    ctx.fillStyle = LS_FILL[side][lv]; ctx.fill();
    ctx.strokeStyle = fast ? LS_FILL[side][lv] : LS_EDGE[side]; ctx.stroke();      // fast mode: a hairline in the fill colour only hides the seams
  }
  trace(TH.a("hi",.5), 1);
  for (const m of marks || []){                                  // Reader episodes: a stripe along the age axis at the episode's price, a diamond where it was detected
    const col = LS_FAM[m.family] || "214,221,230", a0 = P(m.u, 0, m.z0), a1 = P(m.u, 0, m.z1);
    ctx.strokeStyle = `rgba(${col},${m.stage === "ended" ? .45 : .95})`; ctx.lineWidth = m.wall ? 3 : 2; ctx.setLineDash(m.outside ? [3,3] : []);
    ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    if (m.zd != null){ const d = P(m.u, 0, m.zd); ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.moveTo(d[0], d[1]-5); ctx.lineTo(d[0]+4, d[1]); ctx.lineTo(d[0], d[1]+5); ctx.lineTo(d[0]-4, d[1]); ctx.closePath(); ctx.fill(); }
  }                              // the path again over the surface, so a peak cannot hide it
  ctx.strokeStyle = TH.a("hi",.9); ctx.lineWidth = 1.5; { const a = P(-1,0,-1), b = P(1,0,-1); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); } ctx.lineWidth = 1;
  // axes
  ctx.fillStyle = TH.dim; ctx.textAlign = "center";
  for (const u of [-1, 0, 1]){ const p = P(u,0,-1.2); ctx.fillText((u > 0 ? "+" : u < 0 ? "-" : "") + (Math.abs(u)*g.half).toFixed(g.half < 10 ? 1 : 0) + " bps", p[0], p[1]+4); }
  ctx.textAlign = "left";
  for (const z of [-1, 0, 1]){ const p = P(1.08,0,z); ctx.fillText(z === -1 ? "now" : ((z+1)/2*g.spanMs/1000).toFixed(0) + " s ago", p[0], p[1]+3); }
  { const b = P(-1,LS_HEIGHT,1), c = P(-1,-LS_HEIGHT,1); ctx.strokeStyle = TH.line; ctx.beginPath(); ctx.moveTo(c[0],c[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
    ctx.fillStyle = lsRgba(LS_BUY, 1); ctx.fillText("buyers", b[0]+4, b[1]+3); ctx.fillStyle = lsRgba(LS_SELL, 1); ctx.fillText("sellers", c[0]+4, c[1]+3); }
  ctx.fillStyle = TH.dim; ctx.textAlign = "left"; ctx.fillText(info + "   \u00b7   full height = " + fmtK(sc) + " net per spot (square-root scale)", 8, 14);
}

// ---------- readout ----------
function lsEpisodeList(tNow, all) {
  const eng = RD(); if (!eng || !eng.episodeGroups) return [];
  if (LV.src === "session" && !rdView.engine) return [];
  if (LV.src === "live" && rdView.engine) return [];
  const gs = eng.episodeGroups();
  return all ? gs : gs.filter(e => e.tStart <= tNow && (e.tEnd == null || e.tEnd >= tNow - 5000));
}
function lsEpisodes(tNow) {
  const list = lsEpisodeList(tNow);
  if (!list.length) return "";
  return " Reader episodes at this moment: " + list.map(e => `${READER_EPISODES.FAMILY_LABEL[e.family] || e.family} (${(e.venues || [e.venue]).map(v => v.toUpperCase()).join("+")}, ${e.stage})`).join("; ") + ".";
}
function lsReadout(g, tNow, withEpisodes = true) {
  const cell = c => c ? `${fmtK(Math.abs(c.z))} at ${c.xBps >= 0 ? "+" : "-"}${Math.abs(c.xBps).toFixed(1)} bps, ${c.ageS.toFixed(0)} s ago` : "none";
  const tot = g.buy + g.sell, lean = tot > 0 ? g.net/tot : 0;
  const side = Math.abs(lean) < .15 ? "flow was balanced" : lean > 0 ? "buyers were the aggressors" : "sellers were the aggressors";
  const move = g.moveBps == null ? "" : ` The mid moved ${g.moveBps >= 0 ? "+" : ""}${g.moveBps.toFixed(1)} bps over the window.`;
  return `<b>${hhmmss(tNow).slice(0,8)}</b> · last ${(g.spanMs/1000).toFixed(0)} s · ${g.venue === "both" ? "BN + HL" : g.venue.toUpperCase()}: ${side} (buy ${fmtK(g.buy)}, sell ${fmtK(g.sell)}).` +
    ` Biggest buying pocket: ${cell(g.peakBuy)}. Biggest selling pocket: ${cell(g.peakSell)}.${move}${g.clipped ? ` ${g.clipped} trade${g.clipped === 1 ? "" : "s"} fell outside the price range.` : ""}${withEpisodes ? lsEpisodes(tNow) : ""}`;
}

// ---------- frame ----------
function lsLayout(split) {                                        // side by side: a second canvas, two columns on a wide screen and stacked on a phone
  const cv2 = ls$("lsCv2"); if (!cv2 || cv2.hidden === !split) return;
  cv2.hidden = !split; ls$("lsWrap").classList.toggle("split", split); ls$("lsCv").style.height = cv2.style.height = split ? "340px" : "440px"; LV.dirty = true; LV.cache = null;
}
function lsPlayhead(src) {
  const r = lsRange(src);
  if (LV.t == null) return LV.src === "live" ? r.b : r.a;
  return Math.max(r.a, Math.min(r.b, LV.t));
}
function lsRender() {
  const sec = ls$("lsSection"); if (!sec || !visible("reader")) return;
  const cv = ls$("lsCv"), cv2 = ls$("lsCv2"), split = LV.venue === "split", src = lsSource();
  lsLayout(split);
  if (!src){ const {ctx, w, h} = prep(cv); emptyMsg(ctx, w, h, LV.src === "session" ? "Load a recorded session (Recordings, Record) to walk through it." : "Connect to see the landscape."); ls$("lsRead").textContent = ""; lsControls(null); LV.cache = null; return; }
  const live = LV.src === "live" && LV.t == null, tNow = lsPlayhead(src);
  const key = READER_LANDSCAPE.cacheKey({src: LV.src, venue: LV.venue, spanMs: LV.spanMs, tNow, live, sessId: src === LV.sess ? LV.sessId : null, trades});
  let c = LV.cache;
  if (!c || c.key !== key){                                    // new data or a new moment: recompute; otherwise rotate from the cache
    const t0 = performance.now(), L = READER_LANDSCAPE, vs = split ? ["bn", "hl"] : [LV.venue];                  // side by side: one grid per venue, on a shared price range and height scale
    const os = vs.map(v => { const o = {venue: v, spanMs: LV.spanMs}; o.path = L.path(src, tNow, o); return o; });
    const target = Math.max(...os.map(o => L.autoHalf(src, tNow, o)));
    LV.half = !LV.half ? target : target > LV.half ? target : LV.half + (target - LV.half)*.1;
    const gs = os.map(o => L.grid(src, tNow, Object.assign({halfBps: Math.ceil(LV.half*2)/2}, o))), g = gs[0], sc = Math.max(...gs.map(x => x.scale));
    LV.zscale = !LV.zscale || sc > LV.zscale ? Math.max(sc, 1) : Math.max(1, LV.zscale*.96 + sc*.04);
    c = LV.cache = {key, g, gs, tNow, live, gridMs: performance.now() - t0};
    const dn = performance.now();                              // text and slider are written at most 4 times a second while playing: each write forces a page layout
    if (!LV.play || dn - (LV.domAt || 0) > 250){ LV.domAt = dn; ls$("lsRead").innerHTML = gs.map((x, i) => lsReadout(x, tNow, i === gs.length - 1)).join("<br>"); lsControls(src, tNow, live); }
  } else if (!LV.dirty) return;                                  // nothing changed since the last draw
  LV.dirty = false;
  { const b = ls$("lsPlay"), want = LV.play ? "Pause" : "Play"; if (b.textContent !== want) b.textContent = want; }      // a pause lands on a cached grid, so the label is kept right here
  const fast = !!LV.drag || LV.play, t1 = performance.now();
  [cv, cv2].slice(0, c.gs.length).forEach((cvx, i) => { const gx = c.gs[i];
    lsDraw(cvx, gx, (c.live ? "LIVE" : "PLAYHEAD " + hhmmss(c.tNow).slice(0,8)) + (split ? "   ·   " + gx.venue.toUpperCase() : ""), fast, LV.marks === "off" ? [] : READER_LANDSCAPE.episodeMarks(src, c.tNow, gx, lsEpisodeList(c.tNow, true), {hide: LV.marks === "nowall" ? {wall: true} : {}})); });
  LV.ms = performance.now() - t1;
  const now = performance.now(); if (now - (LV.perfAt || 0) > 700){ LV.perfAt = now; ls$("lsPerf").textContent = "grid " + c.gridMs.toFixed(1) + " ms · draw " + LV.ms.toFixed(1) + " ms" + (fast ? " (fast mode)" : ""); }      // DOM text is written rarely: writing it every frame forces a page layout
}
function lsControls(src, tNow, live) {
  const sl = ls$("lsT"), has = !!src;
  sl.disabled = !has; ls$("lsPlay").disabled = !has; ls$("lsLive").disabled = !has || LV.src !== "live";
  ls$("lsPlay").textContent = LV.play ? "Pause" : "Play";
  ls$("lsSrc").querySelector('option[value="session"]').disabled = typeof RT === "undefined" || !RT.session;
  if (!has) { ls$("lsClock").textContent = ""; return; }
  const r = lsRange(src); if (!LV.drag || LV.drag.kind !== "slider") sl.value = r.b > r.a ? Math.round((tNow - r.a)/(r.b - r.a)*1000) : 1000;
  ls$("lsClock").textContent = live ? "live" : hhmmss(tNow).slice(0,8) + (LV.src === "live" ? "  (" + Math.round((r.b - tNow)/1000) + " s ago)" : "");
}
function lsLoop() {
  LV.raf = 0;
  if (!visible("reader")) { LV.play = false; return; }
  const now = performance.now(), dt = Math.min(100, now - (LV.lastFrame || now)); LV.lastFrame = now;
  const src = lsSource();
  if (LV.play && src){
    const r = lsRange(src); let t = lsPlayhead(src) + dt*LV.speed;
    if (t >= r.b){ t = r.b; LV.play = false; if (LV.src === "live") t = null; }
    LV.t = t;
  }
  if (LV.dirty || LV.play){ try { lsRender(); } catch (e) { /* the landscape must never take the Reader down */ } }
  if (LV.play || LV.drag) LV.raf = requestAnimationFrame(lsLoop);
}
function lsKick() { LV.dirty = true; if (!LV.raf) { LV.lastFrame = performance.now(); LV.raf = requestAnimationFrame(lsLoop); } }

// ---------- wiring ----------
(function lsInit() {
  const cv = ls$("lsCv"), cv2 = ls$("lsCv2"); if (!cv) return;
  ls$("lsSrc").value = LV.src; ls$("lsVenue").value = LV.venue; ls$("lsSpan").value = String(LV.spanMs); ls$("lsSpeed").value = String(LV.speed);
  ls$("lsSrc").onchange = e => { LV.src = e.target.value; LV.t = null; LV.play = false; LV.half = LV.zscale = 0; lsKick(); };
  ls$("lsVenue").onchange = e => { LV.venue = e.target.value; store.set("ls.venue", LV.venue); LV.half = LV.zscale = 0; lsKick(); };
  ls$("lsSpan").onchange = e => { LV.spanMs = +e.target.value; store.set("ls.span", LV.spanMs); LV.half = LV.zscale = 0; lsKick(); };
  ls$("lsMarks").value = LV.marks; ls$("lsMarks").onchange = e => { LV.marks = e.target.value; store.set("ls.marks", LV.marks); lsKick(); };
  ls$("lsSpeed").onchange = e => { LV.speed = +e.target.value; store.set("ls.speed", LV.speed); };
  ls$("lsLive").onclick = () => { LV.t = null; LV.play = false; lsKick(); };
  ls$("lsPlay").onclick = () => { const src = lsSource(); if (!src) return; if (!LV.play){ const r = lsRange(src); if (lsPlayhead(src) >= r.b - 500 && LV.src === "session") LV.t = r.a; if (LV.src === "live" && LV.t == null) LV.t = Math.max(r.a, r.b - 120000); } LV.play = !LV.play; lsKick(); };
  const sl = ls$("lsT");
  sl.oninput = () => { const src = lsSource(); if (!src) return; const r = lsRange(src), f = +sl.value/1000; LV.play = false; LV.drag = {kind:"slider"};
    LV.t = LV.src === "live" && f >= .995 ? null : r.a + f*(r.b - r.a); lsKick(); };
  sl.onchange = () => { LV.drag = null; };
  ls$("lsView").onclick = e => { const b = e.target.closest("button"); if (!b) return; const v = b.dataset.v;
    if (v === "3d"){ LV.yaw = -.62; LV.pitch = .62; } else if (v === "top"){ LV.yaw = 0; LV.pitch = 1.5; } else if (v === "side"){ LV.yaw = 1.45; LV.pitch = .12; } else if (v === "front"){ LV.yaw = 0; LV.pitch = .22; }
    lsKick(); };
  for (const cvx of [cv, cv2]) cvx.addEventListener("pointerdown", e => { cvx.setPointerCapture(e.pointerId); LV.drag = {kind:"rotate", x:e.clientX, y:e.clientY, touch:e.pointerType !== "mouse"}; lsKick(); });
  for (const cvx of [cv, cv2]) cvx.addEventListener("pointermove", e => { const d = LV.drag; if (!d || d.kind !== "rotate") return;
    LV.yaw += (e.clientX - d.x)*.008; if (!d.touch) LV.pitch = Math.max(.05, Math.min(1.5, LV.pitch + (e.clientY - d.y)*.006)); d.x = e.clientX; d.y = e.clientY; LV.dirty = true; });
  const end = () => { if (LV.drag && LV.drag.kind === "rotate"){ LV.drag = null; lsKick(); } };
  for (const cvx of [cv, cv2]){ cvx.addEventListener("pointerup", end); cvx.addEventListener("pointercancel", end); }
  window.addEventListener("resize", () => { LV.dirty = true; });
})();

// Draw with the Reader tab's own refresh (every 250 ms while it is visible); a failure here is contained.
(function lsHook() {
  if (typeof renderReader !== "function") return;
  const original = renderReader;
  renderReader = function () { original.apply(this, arguments); try { if (!LV.play && !LV.drag) lsRender(); } catch (e) { /* contained */ } };
})();
