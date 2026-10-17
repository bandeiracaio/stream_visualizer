"use strict";
// Flow landscape view (Reader tab): a 3D surface of where, and how long ago, buyers and sellers hit the book, with the playhead as the
// fourth dimension. All the maths is in reader-landscape.js. This file only reads app state (trades, mids, the loaded session, the
// episodes) and draws; it never writes to the Reader engine. It hooks renderReader, and every call is guarded, so if anything here
// fails the rest of the Reader tab keeps working.
const LV = {
  src: "live", venue: store.get("ls.venue", "both"), spanMs: +store.get("ls.span", 60000) || 60000, speed: +store.get("ls.speed", 4) || 4,
  yaw: -.62, pitch: .62, t: null, play: false, half: 0, zscale: 0, sess: null, sessOf: null, drag: null, last: 0, raf: 0, dirty: true, box: null,
};
const ls$ = id => document.getElementById(id);
const LS_HEIGHT = .78;                      // tallest peak, as a share of half the floor width

function lsSource() {
  if (LV.src === "session") {
    if (typeof RT === "undefined" || !RT.session) return null;
    if (LV.sessOf !== RT.session){ LV.sessOf = RT.session; LV.sess = READER_LANDSCAPE.fromInputs(RT.session.inputs); LV.t = null; }
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

// ---------- projection ----------
function lsProject(box, X, H, Z) {
  const cy = Math.cos(LV.yaw), sy = Math.sin(LV.yaw), cp = Math.cos(LV.pitch), sp = Math.sin(LV.pitch);
  const x1 = X*1.6*cy - Z*sy, z1 = X*sy + Z*cy, y2 = H*cp + z1*sp, z2 = z1*cp - H*sp, f = 3.6/(3.6 + z2);
  return {x: box.cx + x1*f*box.S, y: box.cy - y2*f*box.S, d: z2};
}
const lsMix = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const LS_BUY = [47,191,113], LS_SELL = [229,83,75];

function lsDraw(cv, g, info) {
  const {ctx, w, h} = prep(cv); if (w < 60) return;
  const box = LV.box = {cx: w/2, cy: h*.5, S: Math.min(w*.27, h*.33)}, nx = g.nx, ny = g.ny;
  const U = i => (i+.5)/nx*2 - 1, Zc = j => (j+.5)/ny*2 - 1;                        // price left to right; age: newest at the front (-1)
  const P = (u, hgt, z) => lsProject(box, u, hgt, z);
  const sc = LV.zscale || 1, sq = x => Math.sign(x)*Math.sqrt(Math.min(1, Math.abs(x)/sc));   // height and colour grow with the square root of the flow, so small pockets stay visible beside big ones
  ctx.lineWidth = 1; ctx.font = "10.5px ui-monospace,Menlo,Consolas,monospace";
  // floor
  const c4 = [P(-1,0,-1), P(1,0,-1), P(1,0,1), P(-1,0,1)];
  ctx.beginPath(); c4.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  ctx.fillStyle = "rgba(122,162,247,.05)"; ctx.fill(); ctx.strokeStyle = "#2c3744"; ctx.stroke();
  ctx.strokeStyle = "rgba(125,138,153,.16)";
  for (let k = 1; k < 4; k++){ const u = -1 + k/2, a = P(u,0,-1), b = P(u,0,1); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
  for (let k = 1; k < 4; k++){ const z = -1 + k/2, a = P(-1,0,z), b = P(1,0,z); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
  // the current mid, as a line along time
  ctx.setLineDash([4,4]); ctx.strokeStyle = "rgba(214,221,230,.4)"; { const a = P(0,0,-1), b = P(0,0,1); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); } ctx.setLineDash([]);
  // where the price actually was
  ctx.strokeStyle = "rgba(240,244,248,.95)"; ctx.lineWidth = 2; ctx.beginPath(); let pen = false;
  g.path.forEach((off, j) => { if (off == null){ pen = false; return; } const u = Math.max(-1, Math.min(1, off/g.half)), p = P(u, 0, Zc(j)); pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; });
  ctx.stroke(); ctx.lineWidth = 1;
  // surface, far to near
  const H = (i, j) => sq(g.zs[j*nx+i]) * LS_HEIGHT, quads = [];
  for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++){
    const v = sq((g.zs[j*nx+i] + g.zs[j*nx+i+1] + g.zs[(j+1)*nx+i] + g.zs[(j+1)*nx+i+1]) / 4);
    if (Math.abs(v) < .04) continue;
    const p = [P(U(i),H(i,j),Zc(j)), P(U(i+1),H(i+1,j),Zc(j)), P(U(i+1),H(i+1,j+1),Zc(j+1)), P(U(i),H(i,j+1),Zc(j+1))];
    quads.push({p, v, d:(p[0].d+p[1].d+p[2].d+p[3].d)/4});
  }
  quads.sort((a, b) => b.d - a.d);
  for (const q of quads){
    const m = Math.min(1, Math.abs(q.v)), col = q.v > 0 ? LS_BUY : LS_SELL, a = .25 + .7*Math.sqrt(m);
    ctx.beginPath(); q.p.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    ctx.fillStyle = lsMix(col.map((c, k) => Math.round(c*(.45+.55*Math.sqrt(m)) + 12*(1-m))), a); ctx.fill();
    ctx.strokeStyle = lsMix(col, .28); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(240,244,248,.5)"; ctx.lineWidth = 1; ctx.beginPath(); pen = false;      // the path again over the surface, so a peak cannot hide it
  g.path.forEach((off, j) => { if (off == null){ pen = false; return; } const u = Math.max(-1, Math.min(1, off/g.half)), p = P(u, 0, Zc(j)); pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; });
  ctx.stroke();
  // the newest edge, drawn over the surface
  ctx.strokeStyle = "rgba(122,162,247,.9)"; ctx.lineWidth = 1.5; { const a = P(-1,0,-1), b = P(1,0,-1); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); } ctx.lineWidth = 1;
  // axes
  ctx.fillStyle = "#7d8a99"; ctx.textAlign = "center";
  for (const u of [-1, 0, 1]){ const p = P(u,0,-1.2); ctx.fillText((u > 0 ? "+" : u < 0 ? "-" : "") + (Math.abs(u)*g.half).toFixed(g.half < 10 ? 1 : 0) + " bps", p.x, p.y+4); }
  ctx.textAlign = "left";
  for (const z of [-1, 0, 1]){ const p = P(1.08,0,z); ctx.fillText(z === -1 ? "now" : ((z+1)/2*g.spanMs/1000).toFixed(0) + " s ago", p.x, p.y+3); }
  { const a = P(-1,0,1), b = P(-1,LS_HEIGHT,1), c = P(-1,-LS_HEIGHT,1); ctx.strokeStyle = "#2c3744"; ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.textAlign = "left"; ctx.fillStyle = lsMix(LS_BUY, 1); ctx.fillText("buyers", b.x+4, b.y+3); ctx.fillStyle = lsMix(LS_SELL, 1); ctx.fillText("sellers", c.x+4, c.y+3); }
  ctx.fillStyle = "#7d8a99"; ctx.textAlign = "left"; ctx.fillText(info + "   ·   full height = " + fmtK(sc) + " net per spot (square-root scale)", 8, 14);
}

// ---------- readout ----------
function lsEpisodes(tNow) {
  const eng = RD(); if (!eng || !eng.episodeGroups) return "";
  if (LV.src === "session" && !rdView.engine) return "";
  if (LV.src === "live" && rdView.engine) return "";
  const list = eng.episodeGroups().filter(e => e.tStart <= tNow && (e.tEnd == null || e.tEnd >= tNow - 5000));
  if (!list.length) return "";
  return " Reader episodes at this moment: " + list.map(e => `${READER_EPISODES.FAMILY_LABEL[e.family] || e.family} (${(e.venues || [e.venue]).map(v => v.toUpperCase()).join("+")}, ${e.stage})`).join("; ") + ".";
}
function lsReadout(g, tNow) {
  const cell = c => c ? `${fmtK(Math.abs(c.z))} at ${c.xBps >= 0 ? "+" : "-"}${Math.abs(c.xBps).toFixed(1)} bps, ${c.ageS.toFixed(0)} s ago` : "none";
  const tot = g.buy + g.sell, lean = tot > 0 ? g.net/tot : 0;
  const side = Math.abs(lean) < .15 ? "flow was balanced" : lean > 0 ? "buyers were the aggressors" : "sellers were the aggressors";
  const move = g.moveBps == null ? "" : ` The mid moved ${g.moveBps >= 0 ? "+" : ""}${g.moveBps.toFixed(1)} bps over the window.`;
  return `<b>${hhmmss(tNow).slice(0,8)}</b> · last ${(g.spanMs/1000).toFixed(0)} s · ${g.venue === "both" ? "BN + HL" : g.venue.toUpperCase()}: ${side} (buy ${fmtK(g.buy)}, sell ${fmtK(g.sell)}).` +
    ` Biggest buying pocket: ${cell(g.peakBuy)}. Biggest selling pocket: ${cell(g.peakSell)}.${move}${g.clipped ? ` ${g.clipped} trade${g.clipped === 1 ? "" : "s"} fell outside the price range.` : ""}${lsEpisodes(tNow)}`;
}

// ---------- frame ----------
function lsPlayhead(src) {
  const r = lsRange(src);
  if (LV.t == null) return LV.src === "live" ? r.b : r.a;
  return Math.max(r.a, Math.min(r.b, LV.t));
}
function lsRender(force) {
  const sec = ls$("lsSection"); if (!sec || !visible("reader")) return;
  const cv = ls$("lsCv"), src = lsSource();
  if (!src){ const {ctx, w, h} = prep(cv); emptyMsg(ctx, w, h, LV.src === "session" ? "Load a recorded session (Session, replay and labels) to walk through it." : "Connect to see the landscape."); ls$("lsRead").textContent = ""; lsControls(null); return; }
  const tNow = lsPlayhead(src), live = LV.src === "live" && LV.t == null;
  const o = {venue: LV.venue, spanMs: LV.spanMs}, target = READER_LANDSCAPE.autoHalf(src, tNow, o);
  LV.half = !LV.half ? target : target > LV.half ? target : LV.half + (target - LV.half)*.1;
  const g = READER_LANDSCAPE.grid(src, tNow, Object.assign({halfBps: Math.ceil(LV.half*2)/2}, o));
  const a = Array.from(g.zs, Math.abs).filter(x => x > 0).sort((x, y) => x - y), p = a.length ? a[Math.min(a.length-1, Math.floor(a.length*.97))] : 0;
  LV.zscale = !LV.zscale || p > LV.zscale ? Math.max(p, 1) : Math.max(1, LV.zscale*.96 + p*.04);
  lsDraw(cv, g, live ? "LIVE" : "PLAYHEAD " + hhmmss(tNow).slice(0,8));
  ls$("lsRead").innerHTML = lsReadout(g, tNow);
  lsControls(src, tNow, live);
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
  if (LV.dirty || LV.play){ LV.dirty = false; try { lsRender(); } catch (e) { /* the landscape must never take the Reader down */ } }
  if (LV.play || LV.drag) LV.raf = requestAnimationFrame(lsLoop);
}
function lsKick() { LV.dirty = true; if (!LV.raf) { LV.lastFrame = performance.now(); LV.raf = requestAnimationFrame(lsLoop); } }

// ---------- wiring ----------
(function lsInit() {
  const cv = ls$("lsCv"); if (!cv) return;
  ls$("lsSrc").value = LV.src; ls$("lsVenue").value = LV.venue; ls$("lsSpan").value = String(LV.spanMs); ls$("lsSpeed").value = String(LV.speed);
  ls$("lsSrc").onchange = e => { LV.src = e.target.value; LV.t = null; LV.play = false; LV.half = LV.zscale = 0; lsKick(); };
  ls$("lsVenue").onchange = e => { LV.venue = e.target.value; store.set("ls.venue", LV.venue); LV.half = LV.zscale = 0; lsKick(); };
  ls$("lsSpan").onchange = e => { LV.spanMs = +e.target.value; store.set("ls.span", LV.spanMs); LV.half = LV.zscale = 0; lsKick(); };
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
  cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); LV.drag = {kind:"rotate", x:e.clientX, y:e.clientY, touch:e.pointerType !== "mouse"}; lsKick(); });
  cv.addEventListener("pointermove", e => { const d = LV.drag; if (!d || d.kind !== "rotate") return;
    LV.yaw += (e.clientX - d.x)*.008; if (!d.touch) LV.pitch = Math.max(.05, Math.min(1.5, LV.pitch + (e.clientY - d.y)*.006)); d.x = e.clientX; d.y = e.clientY; LV.dirty = true; });
  const end = () => { if (LV.drag && LV.drag.kind === "rotate") LV.drag = null; };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  window.addEventListener("resize", () => { LV.dirty = true; });
})();

// Draw with the Reader tab's own refresh (every 250 ms while it is visible); a failure here is contained.
(function lsHook() {
  if (typeof renderReader !== "function") return;
  const original = renderReader;
  renderReader = function () { original.apply(this, arguments); try { if (!LV.play && !LV.drag) lsRender(); } catch (e) { /* contained */ } };
})();
