"use strict";
// Reader tools: record a session, replay it with different settings, tune the episode thresholds, see episodes on a
// timeline. Reads the live engine (READER) or a
// replayed one (rdView.engine) through RD(). Loaded after app.js, which owns the engine and the episode cards.
const RT = {session:null, sel:null, hits:[], last:{}};
const rt$ = id => document.getElementById(id);
const RT_COLORS = {absorption:"#7aa2f7", exhaustion:"#d9a43b", burst:"#c792ea", wall:"#7fb7a8"};
const RT_SHORT = {absorption:"absorb", exhaustion:"exhaust", burst:"burst", wall:"wall"};
const RT_TUNE = [["enterScore","enter score",.05],["exitScore","exit score",.05],["enterHoldMs","confirm hold (ms)",500],["endHoldMs","end hold (ms)",500],["resumeMs","resume window (ms)",1000],
  ["wallEpisodeMs","wall must stand (ms)",1000],["wallMaxActive","max walls per side",1],["minTradesFast","min trades, fast",1],["minTradesMid","min trades, mid",1]];
const rtDur = ms => { const s = Math.round(ms/1000); return s >= 3600 ? `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m` : s >= 60 ? `${Math.floor(s/60)}m ${String(s%60).padStart(2,"0")}s` : s+"s"; };
const rtMsg = t => { document.querySelectorAll(".rtmsg").forEach(el => { el.textContent = t; }); };   // the same line shows in Record, Saved and Replay
const rtSide = ep => ep.aggressor || (ep.wall && ep.wall.side) || "";

// ---------- thresholds ----------
(function(){ const saved = store.get("epcfg", {}); for (const [k] of RT_TUNE) if (typeof saved[k]==="number") READER.cfg.ep[k] = saved[k]; })();
function rtBuildTune(){
  rt$("rtTune").innerHTML = RT_TUNE.map(([k,l,st])=>`<label>${l} <input type="number" data-k="${k}" step="${st}" min="0" value="${READER.cfg.ep[k]}"></label>`).join("") + `<button id="rtTuneReset">back to defaults</button>`;
  rt$("rtTuneReset").onclick = () => { for (const [k] of RT_TUNE) READER.cfg.ep[k] = READER_EPISODES.DEFAULTS[k]; store.set("epcfg", {}); rtBuildTune(); };
}
rtBuildTune();
rt$("rtTune").onchange = e => {
  const k = e.target.dataset.k, v = +e.target.value; if (!k || !(v >= 0)) return;
  READER.cfg.ep[k] = v; const saved = store.get("epcfg", {}); saved[k] = v; store.set("epcfg", saved);
};
const rtCfg = () => { const c = READER.cfg, o = {sens:c.sens, detectors:{...c.detectors}, ep:{...c.ep, families:{...c.ep.families}, horizons:c.ep.horizons.slice()}}; return o; };

// ---------- recording, saving, loading ----------
function rtSpan(inputs){
  let t0 = Infinity, t1 = -Infinity;
  for (const r of inputs){
    const t = r[0]==="t" ? (r[1] && r[1].t) : r[0]==="a" ? r[1] : (r[0]==="q" || r[0]==="b" || r[0]==="s") ? r[2] : null;
    if (typeof t==="number" && t > 0){ if (t < t0) t0 = t; if (t > t1) t1 = t; }
  }
  return t1 > t0 ? {t0, t1} : null;
}
function rtSetSession(s){
  const span = rtSpan(s.inputs); RT.session = {...s, span};
  if (!s.ext) colSlice(s.startedAt, 1800000).then(x => { if (RT.session && RT.session.startedAt === s.startedAt && !RT.session.ext) { RT.session.ext = x; if (typeof renderReader === "function") renderReader(); } });      // a recording made on this page: its collector records come from the tape
  rtMsg(span ? `Session ready: ${s.sym || "?"}, ${rtDur(span.t1-span.t0)}, ${s.inputs.length.toLocaleString()} inputs.${span.t1-span.t0 < 150000 ? " It is shorter than the 2-minute warm-up, so a replay will find nothing." : ""}` : "That session has no usable data.");
  rtButtons();
}
function rtDownload(blob, name){
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
rt$("rtSave").onclick = async () => {
  const s = RT.session; if (!s) return;
  const stamp = new Date(s.startedAt || Date.now()).toISOString().slice(0,16).replace(/[-:T]/g, ""), base = `session_${String(s.sym || "X").replace(/[^A-Za-z0-9_-]/g, "") || "X"}_${stamp}`;
  const quality = SQ.of(s.inputs), health = typeof HL !== "undefined" ? HL.ev.filter(e => e.t >= (s.startedAt || 0) - 60000).slice(-60) : null;      // how complete it is, and what the page noted meanwhile
  const ext = await colSlice(s.startedAt, 60000);      // collector records (collectors.js); the engine never sees them
  if (typeof colExpected === "function") { const c = SQ.collectors(ext, s.startedAt || 0, quality.t1, colExpected()); if (c) quality.collectors = c; }      // which collectors wrote during the recording and how long each was silent
  const text = JSON.stringify({kind:"sv-session", v:1, sym:s.sym, startedAt:s.startedAt, quality, health, ext, inputs:s.inputs});
  const gz = typeof CompressionStream !== "undefined", name = base + (gz ? ".json.gz" : ".json");
  const blob = gz ? await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob() : new Blob([text], {type:"application/json"});
  const inFolder = typeof fsSave === "function" ? await fsSave(name, blob) : false;      // the chosen save folder (folder-save.js); if there is none, or it failed, download as before
  if (!inFolder) rtDownload(blob, name);
  const kept = typeof rcKeep === "function" ? await rcKeep(name, blob, {sym:s.sym, startedAt:s.startedAt, quality}) : false;      // a copy stays on the device (recordings.js)
  rtMsg("Saved" + (SQ.clean(quality) ? "" : ` (${SQ.line(quality)})`) + (inFolder ? ` into the folder "${FS.name}".` : ".") + (kept ? " A copy is kept on this device (Recordings, Saved recordings)." : "") + " Load it later (or on another device) with Load session.");
};
rt$("rtLoadBtn").onclick = () => rt$("rtLoad").click();
async function rtReadSessionFile(f){
  const buf = new Uint8Array(await f.arrayBuffer());
  const text = buf[0]===0x1f && buf[1]===0x8b
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : new TextDecoder().decode(buf);
  const o = JSON.parse(text);
  if (!o || o.kind !== "sv-session" || !Array.isArray(o.inputs)) throw new Error("not a session file from this app");
  return {inputs:o.inputs, sym:String(o.sym || ""), startedAt:+o.startedAt || 0, ext:Array.isArray(o.ext) && typeof COLLECT !== "undefined" ? o.ext.filter(COLLECT.isRec) : null};      // ext: the collector records saved with the session (the cards show their context)
}
rt$("rtLoad").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try{ rtSetSession(await rtReadSessionFile(f)); }
  catch(err){ rtMsg("Could not load that file: " + err.message); }
};

// ---------- replay ----------
function rtButtons(){
  rt$("rtSave").disabled = !RT.session; rt$("rtReplay").disabled = !RT.session; rt$("rtLive").disabled = !rdView.engine;
}
function rtFresh(){ RT.sel = null; epLast.epActive = epLast.epDone = null; rtButtons(); renderReader(); }
rt$("rtReplay").onclick = () => {
  if (!RT.session) return; rtMsg("Replaying…");
  setTimeout(() => {
    try{ rdView.engine = READER_ENGINE.replayEngine(RT.session.inputs, rtCfg()); }
    catch(err){ rdView.engine = null; rtMsg("Replay failed: " + err.message); return rtFresh(); }
    const n = rdView.engine.episodes.length; rtMsg(`Replayed with the current settings: ${n} episode${n===1 ? "" : "s"}. Change the thresholds above and press Replay again to compare.`); rtFresh();
  }, 30);
};
rt$("rtLive").onclick = () => { rdView.engine = null; rtMsg(""); rtFresh(); };

// ---------- timeline ----------
function rtTimeline(s){
  const cv = rt$("tlCv"), eng = RD(), now = s.now; if (!now || !cv.clientWidth) return;   // timeline is on another view: nothing to draw
  const win = +rt$("tlWin").value, ph = eng.priceHistory("bn").length ? eng.priceHistory("bn") : eng.priceHistory("hl"), eps = eng.episodeGroups();
  let t0 = win > 0 ? now-win : Math.min(ph.length ? ph[0][0] : now, eps.length ? eps[0].tStart : now); if (!(now-t0 > 1000)) t0 = now-60000;
  const vis = eps.filter(e => (e.tEnd || now) >= t0 && e.tStart <= now), rowOf = new Map();
  const fams = ["absorption","exhaustion","burst","wall"], rowH = 9, gap = 2, laneGap = 9, PH = 120, T = 8, B = 24, L = 54, R = 8;
  const lanes = fams.map(f => {
    const list = vis.filter(e => e.family===f).sort((a,b) => a.tStart-b.tStart), ends = [];
    for (const e of list){ let r = ends.findIndex(x => x <= e.tStart); if (r < 0){ r = ends.length; ends.push(0); } ends[r] = e.tEnd || now; rowOf.set(e, r); }
    return {f, list, rows:Math.max(1, ends.length)};
  });
  const SB = 14;      // the market-state strip between the price panel and the lanes
  const H = T + PH + B + SB + lanes.reduce((a,l) => a + l.rows*(rowH+gap) + laneGap, 0);
  cv.style.height = H + "px";
  const {ctx, w, h} = prep(cv); if (w < 40) return;
  const X = t => L + (t-t0)/(now-t0)*(w-L-R);
  // price panel
  const pts = ph.filter(p => p[0] >= t0), stride = Math.max(1, Math.floor(pts.length/(w*1.5)));
  let lo = Infinity, hi = -Infinity; for (const p of pts){ if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (!(hi > lo)){ lo = (pts.length ? pts[0][1] : 1)-1; hi = lo+2; }
  const pad = (hi-lo)*.08; lo -= pad; hi += pad; const Y = p => T+PH-(p-lo)/(hi-lo)*PH;
  const sel = vis.find(e => e.id===RT.sel);
  if (sel){ ctx.fillStyle = TH.a("accent",.10); ctx.fillRect(X(Math.max(sel.tStart,t0)), T, Math.max(2, X(Math.min(sel.tEnd || now, now))-X(Math.max(sel.tStart,t0))), PH); }
  ctx.strokeStyle = TH.line; ctx.fillStyle = TH.dim; ctx.lineWidth = 1; ctx.textAlign = "right";
  for (let i = 0; i <= 3; i++){ const p = lo+(hi-lo)*i/3, y = Y(p); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w-R, y); ctx.stroke(); ctx.fillText(fmt(p, p >= 1000 ? 1 : 3), L-4, y+3); }
  const steps = [10e3,30e3,60e3,120e3,300e3,600e3,1800e3], span = now-t0, step = steps.find(x => span/x <= 7) || 3600e3; ctx.textAlign = "center";
  for (let t = Math.ceil(t0/step)*step; t <= now; t += step){ const x = X(t); ctx.strokeStyle = TH.line; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T+PH); ctx.stroke(); ctx.fillStyle = TH.dim; ctx.fillText(new Date(t).toTimeString().slice(0, span >= 600e3 ? 5 : 8), x, T+PH+13); }
  ctx.beginPath(); pts.forEach((p,i) => { if (i % stride) return; i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.strokeStyle = TH.text; ctx.lineWidth = 1.3; ctx.stroke();
  if (!pts.length){ ctx.fillStyle = TH.dim; ctx.textAlign = "center"; ctx.fillText("waiting for price data", w/2, T+PH/2); }
  // lanes
  // market-state strip (rules version 1): one band, darker the more of volatility / forced flow / venue gap fired; crowded in the accent colour; blank where unknown
  try{
    const st = typeof colStateStrip === "function" ? colStateStrip(t0, now) : null, y0 = T+PH+B, SH = 8;
    ctx.fillStyle = TH.dim; ctx.textAlign = "right"; ctx.fillText("state", L-4, y0+SH);
    if (st) st.rows.forEach((r, i) => {
      if (r.s === "unknown") return;
      const xa = X(Math.max(r.t, t0)), xb = X(Math.min(i+1 < st.rows.length ? st.rows[i+1].t : now, now)); if (!(xb > xa)) return;
      ctx.fillStyle = r.s === "stressed" ? TH.a("text",.9) : r.s === "unsettled" ? TH.a("text",.5) : r.s === "crowded" ? TH.accent : TH.a("text",.16);
      ctx.fillRect(xa, y0, xb-xa+0.5, SH);
    });
  }catch(e){ console.error("state strip", e); }
  RT.hits = []; let y = T+PH+B+SB;
  for (const lane of lanes){
    ctx.fillStyle = RT_COLORS[lane.f]; ctx.textAlign = "right"; ctx.fillText(RT_SHORT[lane.f], L-4, y+rowH);
    ctx.strokeStyle = TH.line; ctx.beginPath(); ctx.moveTo(L, y+lane.rows*(rowH+gap)+laneGap/2-1); ctx.lineTo(w-R, y+lane.rows*(rowH+gap)+laneGap/2-1); ctx.stroke();
    for (const e of lane.list){
      const x0 = X(Math.max(e.tStart, t0)), x1 = Math.max(x0+3, X(Math.min(e.tEnd || now, now))), yy = y+rowOf.get(e)*(rowH+gap);
      ctx.globalAlpha = e.stage==="ended" ? .55 : .95; ctx.fillStyle = RT_COLORS[lane.f]; ctx.fillRect(x0, yy, x1-x0, rowH); ctx.globalAlpha = 1;
      if (e.stage==="fading"){ ctx.strokeStyle = TH.warn; ctx.lineWidth = 1.5; ctx.strokeRect(x0, yy, x1-x0, rowH); }
      if (e.id===RT.sel){ ctx.strokeStyle = TH.hi; ctx.lineWidth = 1.5; ctx.strokeRect(x0-1, yy-1, x1-x0+2, rowH+2); }
      ctx.fillStyle = TH.ink; for (const r of e.resumedAt || []){ const rx = X(r); if (rx > x0 && rx < x1) ctx.fillRect(rx-.5, yy, 1.5, rowH); }
      RT.hits.push({x0, x1, y0:yy, y1:yy+rowH, ep:e});
    }
    y += lane.rows*(rowH+gap)+laneGap;
  }
  // detail of the selected episode
  const html = sel ? epCard(sel, now) : `<div class="note" style="margin:6px 0 0">Tap a bar to see that episode. ${vis.length ? "" : "No episodes in this window yet."}</div>`;
  if (RT.last.detail !== html){ RT.last.detail = html; rt$("tlDetail").innerHTML = html; }
}
rt$("tlCv").onclick = e => {
  const r = rt$("tlCv").getBoundingClientRect(), x = e.clientX-r.left, y = e.clientY-r.top;
  const hit = RT.hits.find(k => x >= k.x0-3 && x <= k.x1+3 && y >= k.y0-3 && y <= k.y1+3);
  RT.sel = hit ? hit.ep.id : null; if (hit) epOpen.add(String(hit.ep.id)); RT.last.detail = null; renderReader();
};
rt$("tlLegend").innerHTML = Object.keys(RT_COLORS).map(f => `<span><i style="background:${RT_COLORS[f]}"></i>${READER_EPISODES.FAMILY_LABEL[f]}</span>`).join("")
  + `<span><i style="background:${TH.a("text",.16)}"></i>state: calm</span><span><i style="background:${TH.a("text",.5)}"></i>unsettled</span><span><i style="background:${TH.accent}"></i>crowded</span><span><i style="background:${TH.a("text",.9)}"></i>stressed</span><span>dark tick = resumed</span>`;

// ---------- called from renderReader ----------
function rdToolsRender(s){
  rtTimeline(s);
  if (rdView.engine) rt$("rdStatus").textContent = "REPLAY of a recorded session";
  rtButtons();
}
