"use strict";
// Reader tools: record a session, replay it with different settings, tune the episode thresholds, see episodes on a
// timeline, and keep your own agree / disagree / missed labels as ground truth. Reads the live engine (READER) or a
// replayed one (rdView.engine) through RD(). Loaded after app.js, which owns the engine and the episode cards.
const RT = {session:null, rec:null, recTimer:null, sel:null, hits:[], labels:store.get("labels", []), last:{}};
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
const rtCfg = () => { const c = READER.cfg, o = {sens:c.sens, detectors:{...c.detectors}, ep:{...c.ep, families:{...c.ep.families}, horizons:c.ep.horizons.slice()}}; for (const l of READER_REGISTER.LINKS) if (l.at === "cfg") o[l.k] = c[l.k]; return o; };

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
  if (!s.ext && typeof colSlice === "function") colSlice(s.startedAt, 1800000).then(x => { if (RT.session && RT.session.startedAt === s.startedAt && !RT.session.ext) { RT.session.ext = x; if (typeof renderReader === "function") renderReader(); } });      // a recording made on this page: its collector records come from the tape
  rtMsg(span ? `Session ready: ${s.sym || "?"}, ${rtDur(span.t1-span.t0)}, ${s.inputs.length.toLocaleString()} inputs.${span.t1-span.t0 < 150000 ? " It is shorter than the 2-minute warm-up, so a replay will find nothing." : ""}` : "That session has no usable data.");
  rtButtons();
}
function rtRecTick(){
  const r = READER.recording(), ms = Date.now()-RT.rec.t0;
  rt$("rtStat").textContent = `recording ${rtDur(ms)} · ${r.n.toLocaleString()} inputs`;
  const lim = RT.recLimit || {n:600000, ms:1800000}; if (r.n > lim.n || ms > lim.ms) rtRecStop();
}
function rtRecStop(){
  clearInterval(RT.recTimer); const inputs = READER.stopRecording(), meta = RT.rec; RT.rec = null; RT.recLimit = null;
  rt$("rtRec").textContent = "Record"; rt$("rtStat").textContent = "not recording";
  rtSetSession({inputs, sym:meta.sym, startedAt:meta.t0, baseline:meta.baseline});
}
rt$("rtRec").onclick = () => {
  if (RT.rec) return rtRecStop();
  if (!connected){ rtMsg("Connect first, then record."); return; }
  READER.startRecording({quoteMs:100});       // quotes are decimated to one per 100 ms per venue; the live engine still sees every one
  RT.rec = {t0:Date.now(), sym:rt$("sym").value.trim().toUpperCase(), baseline:READER.register.snapshot()};
  rt$("rtRec").textContent = "Stop recording"; RT.recTimer = setInterval(rtRecTick, 1000); rtRecTick();
  rtMsg("Recording the raw inputs. It stops by itself after 30 minutes. The engine needs 2 minutes of data before it can detect anything, so record at least 3.");
};
function rtDownload(blob, name){
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
rt$("rtSave").onclick = async () => {
  const s = RT.session; if (!s) return;
  const stamp = new Date(s.startedAt || Date.now()).toISOString().slice(0,16).replace(/[-:T]/g, ""), base = `session_${String(s.sym || "X").replace(/[^A-Za-z0-9_-]/g, "") || "X"}_${stamp}`;
  const quality = SQ.of(s.inputs), health = typeof HL !== "undefined" ? HL.ev.filter(e => e.t >= (s.startedAt || 0) - 60000).slice(-60) : null;      // how complete it is, and what the page noted meanwhile
  const pre = typeof AR !== "undefined" && AR.pre && AR.pre.at >= (s.startedAt || 0) - 120000 && AR.pre.at <= (s.startedAt || 0) + 120000 ? AR.pre : null;      // auto-record's 30 minutes of mark price before the trigger
  const ext = typeof colSlice === "function" ? await colSlice(s.startedAt, pre ? 1800000 : 60000) : [];      // collector records (collectors.js); the engine never sees them. An auto-recording takes 30 minutes before the trigger, like its `pre` prices
  const text = JSON.stringify({kind:"sv-session", v:1, sym:s.sym, startedAt:s.startedAt, baseline:s.baseline || null, quality, health, pre, ext, inputs:s.inputs});
  const gz = typeof CompressionStream !== "undefined", name = base + (gz ? ".json.gz" : ".json");
  const blob = gz ? await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob() : new Blob([text], {type:"application/json"});
  rtDownload(blob, name);
  const kept = typeof rcKeep === "function" ? await rcKeep(name, blob, {sym:s.sym, startedAt:s.startedAt, quality}) : false;      // a copy stays on the device (recordings.js)
  rtMsg("Saved" + (quality.verdict === "complete" ? "" : ` (${SQ.line(quality)})`) + "." + (kept ? " A copy is kept on this device (Recordings, Saved)." : "") + " Load it later (or on another device) with Load session.");
};
rt$("rtLoadBtn").onclick = () => rt$("rtLoad").click();
async function rtReadSessionFile(f){
  const buf = new Uint8Array(await f.arrayBuffer());
  const text = buf[0]===0x1f && buf[1]===0x8b
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : new TextDecoder().decode(buf);
  const o = JSON.parse(text);
  if (!o || o.kind !== "sv-session" || !Array.isArray(o.inputs)) throw new Error("not a session file from this app");
  return {inputs:o.inputs, sym:String(o.sym || ""), startedAt:+o.startedAt || 0, baseline:o.baseline && o.baseline.v === 1 ? o.baseline : null, ext:Array.isArray(o.ext) && typeof COLLECT !== "undefined" ? o.ext.filter(COLLECT.isRec) : null};      // ext: the collector records saved with the session (the cards show their context)
}
rt$("rtLoad").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try{ rtSetSession(await rtReadSessionFile(f)); }
  catch(err){ rtMsg("Could not load that file: " + err.message); }
};

// ---------- replay ----------
function rtButtons(){
  rt$("rtSave").disabled = !RT.session; rt$("rtReplay").disabled = !RT.session; rt$("rtLive").disabled = !rdView.engine;
  rt$("rtMiss").disabled = !!rdView.engine;
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

// ---------- labels ----------
const rtSave = () => { RT.labels = RT.labels.slice(-2000); store.set("labels", RT.labels); };
function rtMatch(lb, ep){
  if (ep.members) return ep.members.some(m => rtMatch(lb, m));    // an episode group: a label matches if it matches any member
  return lb.family===ep.family && (lb.venue==="any" || lb.venue===ep.venue) && (!lb.side || !rtSide(ep) || lb.side===rtSide(ep)) && lb.t0 <= (ep.tEnd || ep.tUpdate || Infinity) && lb.t1 >= ep.tStart;
}
function rdLabelFor(ep){ for (let i = RT.labels.length-1; i >= 0; i--){ const l = RT.labels[i]; if (l.verdict !== "missed" && rtMatch(l, ep)) return l; } return null; }
function epLabelChip(ep){ const l = rdLabelFor(ep); return l ? `<span class="chip lab-${l.verdict}">${l.verdict}d</span>` : ""; }
function epLabelBar(ep){
  if (String(ep.id).startsWith("f|")) return ""; const v = (rdLabelFor(ep) || {}).verdict;
  return `<div class="eplab"><span class="stat">your call</span><button data-label="agree" class="${v==="agree" ? "on" : ""}">agree</button><button data-label="disagree" class="${v==="disagree" ? "on" : ""}">disagree</button></div>`;
}
function rtToggleLabel(ep, verdict){
  const cur = rdLabelFor(ep); if (cur) RT.labels = RT.labels.filter(l => l !== cur);
  if (!cur || cur.verdict !== verdict) RT.labels.push({id:Date.now()+"."+Math.floor(Math.random()*1e6), verdict, family:ep.family, venue:ep.venues && ep.venues.length>1 ? "any" : ep.venue, side:rtSide(ep), horizon:ep.horizons && ep.horizons.length>1 ? undefined : ep.horizon, group:ep.primary, t0:ep.tStart, t1:ep.tEnd || ep.tUpdate, at:Date.now(), src:rdView.engine ? "replay" : "live", ctx:typeof colLabelCtx === "function" ? colLabelCtx(ep) : undefined});      // ctx: what the collectors read at detection, kept with the label because the tape is pruned after 24 hours
  rtSave();
}
document.addEventListener("click", e => {                        // capture phase: a label tap must not also fold/unfold the card
  const b = e.target.closest("button[data-label]"); if (!b) return; e.stopPropagation();
  const card = b.closest(".ep"), ep = card && RD().episodeGroups().find(x => String(x.id) === card.dataset.id);
  if (ep){ rtToggleLabel(ep, b.dataset.label); epLast.epActive = epLast.epDone = RT.last.detail = null; renderReader(); }
}, true);
rt$("rtMiss").onclick = () => {
  const now = READER.state().now; if (!now){ rtMsg("No live data yet."); return; }
  RT.labels.push({id:Date.now()+"."+Math.floor(Math.random()*1e6), verdict:"missed", family:rt$("rtMissFam").value, venue:"any", side:rt$("rtMissSide").value, t0:now-30000, t1:now, at:Date.now(), src:"live"});
  rtSave(); rtMsg(`Marked: you saw ${rt$("rtMissFam").value} in the last 30 s. Replays will show whether the Reader finds it.`);
};
rt$("rtExport").onclick = () => rtDownload(new Blob([JSON.stringify({kind:"sv-labels", v:1, labels:RT.labels}, null, 1)], {type:"application/json"}), "reader_labels.json");
let rtClearArmed = 0;
rt$("rtClear").onclick = () => {
  if (Date.now()-rtClearArmed > 4000){ rtClearArmed = Date.now(); rt$("rtClear").textContent = "really clear all?"; setTimeout(() => { rt$("rtClear").textContent = "Clear labels"; }, 4000); return; }
  RT.labels = []; rtSave(); rtClearArmed = 0; rt$("rtClear").textContent = "Clear labels"; epLast.epActive = epLast.epDone = null;
};
function rtScore(){
  const eng = RD(), d = eng.debug(), eps = eng.episodes, t0 = d.firstT, t1 = d.now; let txt;
  if (!t0) txt = `${RT.labels.length} label${RT.labels.length===1 ? "" : "s"} saved on this device.`;
  else {
    const L = RT.labels.filter(l => l.t1 >= t0 && l.t0 <= t1); let a = 0, aF = 0, dn = 0, dS = 0, m = 0, mD = 0;
    for (const l of L){ const hit = eps.some(ep => rtMatch(l, ep)); if (l.verdict==="agree"){ a++; if (hit) aF++; } else if (l.verdict==="disagree"){ dn++; if (hit) dS++; } else { m++; if (hit) mD++; } }
    txt = L.length ? `Against your labels in this ${rdView.engine ? "replay" : "live view"}: agreed ${aF} of ${a} found · disagreed ${dS} of ${dn} still shown (lower is better) · missed ${mD} of ${m} now detected. ${RT.labels.length} labels in total.`
      : `No labels fall inside this time range yet (${RT.labels.length} saved on this device).`;
  }
  if (RT.last.score !== txt){ RT.last.score = txt; rt$("rtScore").textContent = txt; }
}

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
  const SB = 28;      // the market-state and options-lens strips between the price panel and the lanes
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
  // options-lens strip: realized volatility against the index, accent ramp (below / in line / above); blank where there is no reading
  try{
    const ls = typeof colLensStrip === "function" ? colLensStrip(t0, now) : null, y1 = T+PH+B+14, SH = 8;
    ctx.fillStyle = TH.dim; ctx.textAlign = "right"; ctx.fillText("vol", L-4, y1+SH);
    if (ls) ls.rows.forEach((r, i) => {
      if (!r.w) return;
      const xa = X(Math.max(r.t, t0)), xb = X(Math.min(i+1 < ls.rows.length ? ls.rows[i+1].t : now, now)); if (!(xb > xa)) return;
      ctx.fillStyle = TH.a("accent", r.w === "above" ? .95 : r.w === "inline" ? .5 : .2); ctx.fillRect(xa, y1, xb-xa+0.5, SH);
    });
  }catch(e){ console.error("lens strip", e); }
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
      const lb = rdLabelFor(e); if (lb){ ctx.fillStyle = lb.verdict==="agree" ? TH.buy : TH.sell; ctx.beginPath(); ctx.arc(x1, yy, 3, 0, 7); ctx.fill(); }
      RT.hits.push({x0, x1, y0:yy, y1:yy+rowH, ep:e});
    }
    y += lane.rows*(rowH+gap)+laneGap;
  }
  ctx.fillStyle = "#c792ea"; ctx.lineWidth = 1;                // "missed" marks
  for (const l of RT.labels) if (l.verdict==="missed" && l.t1 >= t0 && l.t0 <= now){ const x = X((l.t0+l.t1)/2); ctx.beginPath(); ctx.moveTo(x, T+PH); ctx.lineTo(x-4, T+PH-8); ctx.lineTo(x+4, T+PH-8); ctx.closePath(); ctx.fill(); }
  // detail of the selected episode
  const html = sel ? epCard(sel, now) : `<div class="note" style="margin:6px 0 0">Tap a bar to see that episode and agree or disagree with it. ${vis.length ? "" : "No episodes in this window yet."}</div>`;
  if (RT.last.detail !== html){ RT.last.detail = html; rt$("tlDetail").innerHTML = html; }
}
rt$("tlCv").onclick = e => {
  const r = rt$("tlCv").getBoundingClientRect(), x = e.clientX-r.left, y = e.clientY-r.top;
  const hit = RT.hits.find(k => x >= k.x0-3 && x <= k.x1+3 && y >= k.y0-3 && y <= k.y1+3);
  RT.sel = hit ? hit.ep.id : null; if (hit) epOpen.add(String(hit.ep.id)); RT.last.detail = null; renderReader();
};
rt$("tlLegend").innerHTML = Object.keys(RT_COLORS).map(f => `<span><i style="background:${RT_COLORS[f]}"></i>${READER_EPISODES.FAMILY_LABEL[f]}</span>`).join("")
  + `<span><i style="background:${TH.a("text",.16)}"></i>state: calm</span><span><i style="background:${TH.a("text",.5)}"></i>unsettled</span><span><i style="background:${TH.accent}"></i>crowded</span><span><i style="background:${TH.a("text",.9)}"></i>stressed</span><span><i style="background:${TH.a("accent",.2)}"></i>vol: realized below implied</span><span><i style="background:${TH.a("accent",.5)}"></i>in line</span><span><i style="background:${TH.a("accent",.95)}"></i>above</span><span><i style="background:${TH.buy};border-radius:50%"></i>you agreed</span><span><i style="background:${TH.sell};border-radius:50%"></i>you disagreed</span><span><i style="background:#c792ea"></i>you marked missed</span><span>dark tick = resumed</span>`;

// ---------- assumption register (measures only; see reader-register.js) ----------
const rgMsg = t => { rt$("rgMsg").textContent = t; };
(function(){ const s = store.get("register", null); if (s) READER.register.load(s); })();
function rgPersist(){ store.set("register", READER.register.save()); }
setInterval(rgPersist, 30000);
addEventListener("pagehide", rgPersist);
const rgNum = x => x == null ? "–" : Math.abs(x) >= 1000 ? fmtK(x) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(3);
// ---------- drift review (reader-drift.js judges; this only shows it and records your decisions) ----------
const RV_SET = [["k","reference sessions (K)",1,1],["m","sessions in a row to confirm (M)",1,1],["medShift","median shift, in IQRs",.1,1],["widthLo","spread ratio, lowest",.1,1],["widthHi","spread ratio, highest",.1,1],
  ["tailShift","tail shift, in IQRs",.1,1],["scalarShift","firing-rate shift, in units",.1,1],["minEpisodes","episodes needed to judge their length",1,1],["expMedLo","expected typical move in sigma, lowest",.1,1],["expMedHi","expected typical move in sigma, highest",.1,1],["expTailLo","expected 5th/95th percentile in sigma, lowest",.1,1],["expTailHi","expected 5th/95th percentile in sigma, highest",.1,1],["minSamples","samples a session needs per variable",50,1],["segmentMs","segment length (minutes)",10,60000],["minSessionMs","shortest session that counts (minutes)",1,60000]];
const rvName = key => { const [vn, id] = key.split("|"), d = READER.register.vars.find(x => x.id === id); return `${d ? d.label : id}${vn === "all" ? "" : vn === "bn" ? " (Binance)" : " (Hyperliquid)"}`; };
const rvWhen = t => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const rvDow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function rvSpark(j){
  if (!j.points.length) return "";
  if (j.scalar){
    const vs = j.points.map(p => p.v); if (j.refV) vs.push(j.refV.m - j.refV.unit, j.refV.m + j.refV.unit);
    let lo = Math.min(...vs), hi = Math.max(...vs); if (!(hi > lo)){ lo -= 1; hi += 1; }
    const W = 170, H = 30, n = j.points.length, X = i => 6 + i * (W - 12) / Math.max(1, n - 1), Y = v => H - 3 - (v - lo) / (hi - lo) * (H - 6);
    let g = j.refV ? `<rect x="0" y="${Y(j.refV.m + j.refV.unit).toFixed(1)}" width="${W}" height="${Math.max(1, Y(j.refV.m - j.refV.unit) - Y(j.refV.m + j.refV.unit)).toFixed(1)}" fill="${TH.a("accent",.22)}"/>` : "";
    j.points.forEach((p, i) => { g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.6" fill="${p.eff && p.eff.drifted ? TH.sell : TH.dim}"/>`; });
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="recent sessions against the reference band">${g}</svg>`;
  }
  const n = j.points.length + (j.preview ? 1 : 0), vals = [];
  for (const p of j.points) vals.push(p.q[0], p.q[4]);
  if (j.refQ) vals.push(j.refQ[0], j.refQ[4]); if (j.preview) vals.push(j.preview.q[0], j.preview.q[4]);
  let lo = Math.min(...vals), hi = Math.max(...vals); if (!(hi > lo)){ lo -= 1; hi += 1; }
  const W = 170, H = 30, X = i => 6 + i * (W - 12) / Math.max(1, n - 1), Y = v => H - 3 - (v - lo) / (hi - lo) * (H - 6);
  let g = "";
  if (j.refQ) g += `<rect x="0" y="${Y(j.refQ[4]).toFixed(1)}" width="${W}" height="${Math.max(1, Y(j.refQ[0]) - Y(j.refQ[4])).toFixed(1)}" fill="${TH.a("accent",.10)}"/><rect x="0" y="${Y(j.refQ[3]).toFixed(1)}" width="${W}" height="${Math.max(1, Y(j.refQ[1]) - Y(j.refQ[3])).toFixed(1)}" fill="${TH.a("accent",.22)}"/>`;
  j.points.forEach((p, i) => { const c = p.eff && p.eff.drifted ? TH.sell : TH.dim; g += `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${Y(p.q[4]).toFixed(1)}" y2="${Y(p.q[0]).toFixed(1)}" stroke="${c}" stroke-width="1"/><circle cx="${X(i).toFixed(1)}" cy="${Y(p.q[2]).toFixed(1)}" r="2.4" fill="${c}"/>`; });
  if (j.preview){ const i = n - 1; g += `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${Y(j.preview.q[4]).toFixed(1)}" y2="${Y(j.preview.q[0]).toFixed(1)}" stroke="${TH.warn}" stroke-width="1"/><circle cx="${X(i).toFixed(1)}" cy="${Y(j.preview.q[2]).toFixed(1)}" r="2.6" fill="none" stroke="${TH.warn}"/>`; }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="recent sessions against the reference band">${g}</svg>`;
}
const rvState = j => j.state === "building" ? `building ${j.refN}/${j.need}` : j.state === "watching" ? `watching ${j.streak}/${j.m}` : "ok";
const rvLast = j => { const p = j.points[j.points.length - 1]; if (j.scalar) return p ? `${+p.v.toFixed(2)}${p.eff ? ` (${p.eff.med >= 0 ? "+" : ""}${p.eff.med.toFixed(2)} units from usual)` : ""}` : "–"; return p && p.eff ? `median ${p.eff.med >= 0 ? "+" : ""}${p.eff.med.toFixed(2)} IQR, spread x${p.eff.width.toFixed(2)}, tail ${p.eff.tail.toFixed(2)}` : "–"; };
function rvRender(){
  const reg = READER.register, rv = reg.review(), keys = Object.keys(rv.keys).filter(k => rv.keys[k].points.length || rv.keys[k].refN || rv.keys[k].preview);
  const expOff = rv.expectations.filter(x => x.ready && !x.ok);
  const pend = rv.history.filter(h => h.type === "drift" && !h.acked && !h.undone), watch = keys.filter(k => rv.keys[k].state === "watching"), off = keys.filter(k => rv.keys[k].priorOff);
  const counted = reg.sessions.filter(x => x.durationMs >= reg.cfg.minSessionMs).length;
  const sum = `${counted} counted session${counted === 1 ? "" : "s"} (${reg.sessions.length} stored). ${pend.length} drift${pend.length === 1 ? "" : "s"} to review, ${watch.length} being watched. A drift needs ${reg.cfg.k} reference sessions and then ${reg.cfg.m} differing sessions in a row. This panel only reports; it never changes a detection.`;
  const needs = (rv.scale.ok ? "" : `<div class="rv-row"><div class="grow"><b>This register has no sigma-scale mark</b><div class="stat">It was saved before the mark existed. Registers from before v012 hold price progress, gap and late progress on the wrong scale (ADR 0004). If this one was saved by v014 or later, mark it as current; otherwise reset it.</div></div><button data-rv="scale">Mark as current</button></div>`) + expOff.map(x => `<div class="rv-row"><div class="grow"><b>The sigma scale looks wrong</b> on ${x.key.startsWith("bn") ? "Binance" : "Hyperliquid"} (${x.key.split("|")[1]}): ${x.reasons.join("; ")}.<div class="stat">Price progress is measured in sigmas, so it should have a known shape. ${x.n.toLocaleString()} samples so far.</div></div></div>`).join("") + pend.map(h => `<div class="rv-row"><div class="grow"><b>${rvName(h.key)}</b> drifted: ${h.reasons.join(", ")}.<div class="stat">From the session at ${rvWhen(h.from)}, confirmed ${rvWhen(h.at)}. The reference restarted there.${h.note ? " " + h.note : ""}</div></div><button data-rv="ack" data-id="${h.id}">Acknowledge</button><button data-rv="undo" data-id="${h.id}">Undo (was a one-off)</button></div>`).join("")
    + watch.map(k => `<div class="rv-row"><div class="grow"><b>${rvName(k)}</b> is being watched: ${rv.keys[k].streak} of ${rv.keys[k].m} sessions differ.</div></div>`).join("")
    + off.map(k => { const j = rv.keys[k]; return `<div class="rv-row"><div class="grow"><b>${rvName(k)}</b>: the reference median is ${j.priorGap.toFixed(2)} IQR away from what we assumed in advance.</div></div>`; }).join("");
  const all = `<table class="rv-tbl rv-keys"><tbody>${keys.map(k => { const j = rv.keys[k]; return `<tr><td>${rvName(k)}</td><td><span class="chip">${rvState(j)}</span></td><td>${rvSpark(j)}</td><td class="stat">${rvLast(j)}${j.preview ? `; running: ${j.preview.drifted ? "outside" : "inside"} the band (not a vote)` : ""}</td></tr>`; }).join("")}</tbody></table>`
    + `<div class="note">Dots are session medians with whiskers to the 5th and 95th percentile. The blue band is the reference (dark = middle half). Red = that session differed. Orange hollow = the running segment, which does not vote.</div>`;
  const set = RV_SET.map(([k, l, st, sc]) => `<label>${l} <input type="number" data-rvk="${k}" data-sc="${sc}" step="${st}" min="0" value="${+(reg.cfg[k] / sc).toFixed(3)}"></label>`).join("");
  const hist = rv.history.slice(-30).reverse().map(h => h.type === "approval" ? `<div class="rv-row"><span class="stat">${rvWhen(h.at)}</span> approved <b>${h.k}</b>: ${h.from} → ${h.to}${h.group ? " (group " + h.group + ")" : ""}</div>`
    : h.type === "revert" ? `<div class="rv-row"><span class="stat">${rvWhen(h.at)}</span> reset <b>${h.k}</b>: ${h.from} → ${h.to}${h.reason ? " — " + h.reason : ""}</div>`
    : h.type === "import" ? `<div class="rv-row"><span class="stat">${rvWhen(h.at)}</span> applied imported overrides: ${h.keys.join(", ")}</div>`
    : h.type === "setting"
    ? `<div class="rv-row"><span class="stat">${rvWhen(h.at)}</span> setting <b>${h.key}</b>: ${h.from} → ${h.to}</div>`
    : `<div class="rv-row"><span class="stat">${rvWhen(h.at)}</span> drift in <b>${rvName(h.key)}</b>: ${h.reasons.join(", ")} <span class="chip">${h.undone ? "undone" : h.acked ? "acknowledged" : "to review"}</span></div>`).join("") || `<div class="note">Nothing yet.</div>`;
  const html = [sum, needs, all, set, hist].join("§");
  if (RT.last.rv === html) return; RT.last.rv = html;
  rt$("rvSummary").textContent = sum; rt$("rvNeeds").innerHTML = needs || `<div class="note">Nothing to review.</div>`; rt$("rvAll").innerHTML = all; rt$("rvHist").innerHTML = hist;
  if (!rt$("rvSet").contains(document.activeElement)) rt$("rvSet").innerHTML = set;
}
rt$("rvSet").onchange = e => { const k = e.target.dataset.rvk; if (!k) return; READER.register.setSetting(k, (+e.target.value) * (+e.target.dataset.sc), Date.now()); rgPersist(); RT.last.rv = null; rvRender(); };
rt$("rvNeeds").onclick = e => {
  const b = e.target.closest("button[data-rv]"); if (!b) return;
  if (b.dataset.rv === "scale") READER.register.confirmScale(); else if (b.dataset.rv === "ack") READER.register.ack(b.dataset.id); else READER.register.undo(b.dataset.id);
  rgPersist(); RT.last.rv = null; rvRender(); rvBadge();
};
function rvBadge(){
  const rv = READER.register.review(), n = rv.unacked + (rv.scale.ok ? 0 : 1), g = document.querySelector('#groups button[data-g="review"]'); if (!g) return;
  let b = g.querySelector(".badge");
  if (!n){ if (b) b.remove(); return; }
  if (!b){ b = document.createElement("span"); b.className = "badge"; g.appendChild(b); }
  if (b.textContent !== String(n)) b.textContent = String(n);
}
setInterval(rvBadge, 5000); setTimeout(rvBadge, 800);
function rvReportText(){
  const reg = READER.register, rv = reg.review(), keys = Object.keys(rv.keys).filter(k => rv.keys[k].points.length || rv.keys[k].refN), L = [], d = new Date().toISOString().slice(0, 10);
  L.push(`# Reader review ${d}`, "", `Counted sessions: ${reg.sessions.filter(x => x.durationMs >= reg.cfg.minSessionMs).length} of ${reg.sessions.length} stored. Times are UTC.`, "", "## Settings", "");
  for (const [k, l, , sc] of RV_SET) L.push(`- ${l}: ${+(reg.cfg[k] / sc).toFixed(3)}`);
  L.push("", "## To review", "");
  if (!rv.scale.ok) L.push("- **This register has no sigma-scale mark** (saved before the mark existed): price progress, gap and late progress may be on an older scale.");
  for (const x of rv.expectations.filter(y => y.ready && !y.ok)) L.push(`- **The sigma scale looks wrong** on ${x.key}: ${x.reasons.join("; ")}.`);
  const pend = rv.history.filter(h => h.type === "drift" && !h.acked && !h.undone);
  if (!pend.length) L.push("Nothing confirmed and waiting.");
  for (const h of pend) L.push(`- **${rvName(h.key)}** drifted (${h.reasons.join(", ")}), from the session at ${rvWhen(h.from)}, confirmed ${rvWhen(h.at)}.`);
  for (const k of keys) if (rv.keys[k].state === "watching") L.push(`- Watching **${rvName(k)}**: ${rv.keys[k].streak} of ${rv.keys[k].m} sessions differ.`);
  for (const k of keys) if (rv.keys[k].priorOff) L.push(`- **${rvName(k)}**: reference median is ${rv.keys[k].priorGap.toFixed(2)} IQR from the prior assumption.`);
  L.push("", "## Threshold proposals", "");
  const pend2 = rv.proposals.filter(p => p.status === "pending");
  if (!pend2.length) L.push("None pending.");
  for (const p of pend2){
    const r = PX.res && PX.res.per[p.id], fresh = r && r.rev === (p.rev || 0);
    L.push(`- **${p.label}**: ${p.from} -> ${p.to} (${pxPct(p.change)})${p.provisional ? ", provisional" : ""}${p.large ? ", large change" : ""}. Cause: ${rvName(p.driftKey)} drifted ${rvWhen(p.driftAt)}. Replay: ${fresh ? r.v.verdict + (r.v.conds.some(c => !c.ok) ? " (missing: " + r.v.conds.filter(c => !c.ok).map(c => c.text).join("; ") + ")" : "") : "not checked"}.`);
  }
  for (const p of rv.proposals.filter(x => x.status !== "pending").slice(-10)) L.push(`- ${p.status}: ${p.label} ${p.from} -> ${p.to}${p.reason ? " (" + p.reason + ")" : ""}`);
  L.push("", "## Approved thresholds on this device", "");
  const ovk = Object.keys(READER.register.overrides);
  if (!ovk.length) L.push("None."); for (const k of ovk) L.push(`- ${k}: ${READER.register.overrides[k].value} (built-in ${pxBuiltIn(k)}, approved ${rvWhen(READER.register.overrides[k].at)})`);
  L.push("", "## Variables", "", "| variable | state | last session vs reference |", "|---|---|---|");
  for (const k of keys) L.push(`| ${rvName(k)} | ${rvState(rv.keys[k])} | ${rvLast(rv.keys[k])} |`);
  L.push("", "## Sessions (latest 30)", "", "| start | weekday | hour | run | minutes | counts |", "|---|---|---|---|---|---|");
  for (const s of reg.sessions.slice(-30)) L.push(`| ${rvWhen(s.start)} | ${rvDow[s.dow]} | ${s.hour} | ${rvWhen(s.run)} | ${Math.round(s.durationMs / 60000)} | ${s.durationMs >= reg.cfg.minSessionMs ? "yes" : "no"} |`);
  L.push("", "## History", "");
  for (const h of rv.history.slice(-40).reverse()) L.push(h.type === "setting" ? `- ${rvWhen(h.at)} setting ${h.key}: ${h.from} -> ${h.to}` : `- ${rvWhen(h.at)} drift in ${rvName(h.key)}: ${h.reasons.join(", ")} (${h.undone ? "undone" : h.acked ? "acknowledged" : "to review"})`);
  return L.join("\n") + "\n";
}
rt$("rvReport").onclick = () => { rtDownload(new Blob([rvReportText()], {type:"text/markdown"}), `reader_review_${new Date().toISOString().slice(0, 10)}.md`); rt$("rgMsg").textContent = "Report saved. Drop it into .scratch/ (with an exported register) for the weekly review."; };

// ---------- threshold proposals: built from confirmed drifts, checked by replaying recordings (Part 3b) ----------
const PX = {res:null, running:false, arm:null, importOv:null};
const pxLink = k => READER_REGISTER.LINKS.find(l => l.k === k);
const pxPct = x => (x >= 0 ? "+" : "") + Math.round(x * 100) + "%";
const pxFam = f => READER_EPISODES.FAMILY_LABEL[f] || f;
function pxCfg(changes){
  const c = rtCfg();
  for (const l of READER_REGISTER.LINKS) if (l.at === "cfg") c[l.k] = READER.cfg[l.k];
  c.ep.keepEpisodes = 5000; c.ep.keepWalls = 500;
  for (const k in changes){ const l = pxLink(k); if (l.at === "ep") c.ep[k] = changes[k]; else c[k] = changes[k]; }
  return c;
}
async function pxReplay(inputs, cfg, label){
  const e = READER_ENGINE.create(cfg), eps = {};
  e.subscribeEpisodes((ep, ch) => { if (ch === "started") eps[ep.family] = (eps[ep.family] || 0) + 1; });
  for (let i = 0; i < inputs.length; i += 4000){
    READER_ENGINE.feed(e, inputs, i, i + 4000);
    if ((i / 4000) % 3 === 0){ rt$("pxStat").textContent = label + " " + Math.min(100, Math.round(i / inputs.length * 100)) + "%"; await new Promise(r => setTimeout(r)); }
  }
  const d = e.debug(), t0 = d.firstT, t1 = d.now, L = RT.labels.filter(l => l.t1 >= t0 && l.t0 <= t1), lab = {a:0, aF:0, dn:0, dS:0, m:0, mD:0};
  for (const l of L){
    const hit = e.episodes.some(ep => rtMatch(l, ep));
    if (l.verdict === "agree"){ lab.a++; if (hit) lab.aF++; } else if (l.verdict === "disagree"){ lab.dn++; if (hit) lab.dS++; } else { lab.m++; if (hit) lab.mD++; }
  }
  return {eps, labels:lab};
}
async function pxRun(files){
  const rv = READER.register.review(), pend = rv.proposals.filter(p => p.status === "pending");
  if (!pend.length){ rt$("pxStat").textContent = "No pending proposals."; return; }
  files = files.slice(0, 8); PX.running = true; rt$("pxPick").disabled = true;
  const cfgs = [{name:"current", changes:{}, what:"current thresholds"}].concat(pend.map((p, i) => ({name:p.id, changes:{[p.k]:p.to}, what:"proposal " + (i + 1) + " of " + pend.length})));
  if (pend.length > 1) cfgs.push({name:"together", changes:Object.fromEntries(pend.map(p => [p.k, p.to])), what:"all proposals together"});
  const runs = []; let skipped = 0;
  try{
    for (let i = 0; i < files.length; i++){
      let sess; try{ sess = await rtReadSessionFile(files[i]); }catch(err){ skipped++; continue; }
      const span = rtSpan(sess.inputs), hours = span ? Math.max(0, (span.t1 - span.t0 - READER.cfg.warmupMs) / 3600000) : 0, one = {name:files[i].name, t0:span ? span.t0 : 0, hours, by:{}};
      for (const c of cfgs) one.by[c.name] = await pxReplay(sess.inputs, pxCfg(c.changes), `recording ${i + 1}/${files.length} · ${c.what}`);
      runs.push(one);
    }
  } finally { PX.running = false; rt$("pxPick").disabled = false; }
  const per = {};
  for (const p of pend){
    const mkRun = (r, key) => ({tag:r.t0 >= p.driftFrom ? "after" : "before", labels:r.by[key].labels, eps:r.by[key].eps, hours:r.hours, name:r.name});
    const base = runs.map(r => mkRun(r, "current")), prop = runs.map(r => mkRun(r, p.id));
    per[p.id] = {rev:p.rev || 0, base, prop, v:READER_PROPOSALS.verdict({proposal:p, base, prop, oldRates:READER.register.oldRates(p.id)})};
  }
  const tog = pend.length > 1 && runs.length ? {base:runs.map(r => ({labels:r.by.current.labels, eps:r.by.current.eps, hours:r.hours})), prop:runs.map(r => ({labels:r.by.together.labels, eps:r.by.together.eps, hours:r.hours})), ids:pend.map(p => p.id), revs:pend.map(p => p.rev || 0)} : null;
  PX.res = {at:Date.now(), per, runs, skipped, together:tog, epoch:READER.register.epoch};
  rt$("pxStat").textContent = runs.length ? `Checked ${runs.length} recording${runs.length === 1 ? "" : "s"}${skipped ? ", " + skipped + " could not be read" : ""}.` : "None of the files could be read.";
  RT.last.px = null; pxRender();
}
rt$("pxPick").onclick = () => rt$("pxFiles").click();
rt$("pxFiles").onchange = e => { const fl = Array.from(e.target.files); e.target.value = ""; if (fl.length && !PX.running) pxRun(fl); };
const pxLabTxt = l => l.a + l.dn + l.m ? `agreed ${l.aF}/${l.a} · disagreed shown ${l.dS}/${l.dn} · missed found ${l.mD}/${l.m}` : "no labels";
const pxRateTxt = (runs, f) => { const r = READER_PROPOSALS.rate(runs, f); return r == null ? "–" : r.toFixed(1) + "/h"; };
function pxResultHtml(p, r){
  const v = r.v;
  const conds = v.conds.map(c => `<li>${c.ok ? "✓" : "✗"} ${c.text}</li>`).join("");
  const fam = p.families.map(f => `<tr><td>${pxFam(f)}</td><td>${v.rates[f] && v.rates[f].old != null ? v.rates[f].old.toFixed(1) + "/h" : "–"}</td><td>${pxRateTxt(r.base, f)}</td><td>${pxRateTxt(r.prop, f)}</td></tr>`).join("");
  const sess = r.base.map((b, i) => `<tr><td>${b.name}</td><td>${b.tag} the drift</td><td>${b.hours.toFixed(2)} h</td><td>${pxLabTxt(b.labels)}</td><td>${pxLabTxt(r.prop[i].labels)}</td></tr>`).join("");
  return `<div style="margin-top:6px"><span class="chip ${v.verdict === "safe" ? "lab-agree" : ""}">${v.verdict}</span><ul class="rg-claims" style="list-style:none;padding:0">${conds}</ul>`
    + `<table class="rv-tbl"><thead><tr><th>Family</th><th>usual</th><th>current</th><th>proposed</th></tr></thead><tbody>${fam}</tbody></table>`
    + `<table class="rv-tbl"><thead><tr><th>Recording</th><th>When</th><th>Replayed</th><th>Labels, current</th><th>Labels, proposed</th></tr></thead><tbody>${sess}</tbody></table>`
    + `<div class="stat">Total: current ${pxLabTxt(v.labels.base)}; proposed ${pxLabTxt(v.labels.prop)}.</div></div>`;
}
function pxRender(){
  const rv = READER.register.review(), pend = rv.proposals.filter(p => p.status === "pending"), other = rv.proposals.filter(p => p.status !== "pending");
  const cards = pend.map(p => {
    const r = PX.res && PX.res.per[p.id], fresh = pxFresh(p, r), per = p.per.map(q => `${rvName(q.key)}: ${(q.p * 100).toFixed(2)}th percentile`).join("; ");
    const chips = (p.provisional ? `<span class="chip">provisional</span>` : "") + (p.large ? `<span class="chip">large change</span>` : "") + (p.rev ? `<span class="chip">recomputed ×${p.rev}</span>` : "");
    return `<div class="rv-row" style="display:block"><div><b>${p.label}</b>: ${p.from} → <b>${p.to}</b> (${pxPct(p.change)}) ${chips}</div>`
      + `<div class="stat">Because ${rvName(p.driftKey)} drifted (${rvWhen(p.driftAt)}). The old number sat at: ${per}. The new value is taken at the same percentile of the new distribution.${p.note ? " " + p.note : ""}</div>`
      + `<div class="row" style="margin-top:4px"><button data-px-do="recompute" data-id="${p.id}">Recompute</button><input data-px-reason="${p.id}" placeholder="reason (optional)" style="max-width:200px"><button data-px-do="reject" data-id="${p.id}">Reject</button>${pxApproveBtn(p, fresh)}</div>${pxArmHtml(p)}`
      + (r ? (fresh ? pxResultHtml(p, r) : `<div class="note">The proposal changed since the last check. Check it against recordings again.</div>`) : `<div class="note">Not checked against recordings yet.</div>`) + `</div>`;
  }).join("");
  const T = PX.res && PX.res.together, showTog = T && PX.res.epoch === READER.register.epoch && T.ids.every((id, i) => pend.some(p => p.id === id && (p.rev || 0) === T.revs[i]));
  const fams = ["absorption", "exhaustion", "burst", "wall"];
  const tog = showTog ? `<div class="rv-row" style="display:block"><b>All pending proposals together</b><table class="rv-tbl"><thead><tr><th>Family</th><th>current</th><th>together</th></tr></thead><tbody>${fams.map(f => `<tr><td>${pxFam(f)}</td><td>${pxRateTxt(T.base, f)}</td><td>${pxRateTxt(T.prop, f)}</td></tr>`).join("")}</tbody></table><div class="stat">Your labels: current ${pxLabTxt(READER_PROPOSALS.lab(T.base))}; together ${pxLabTxt(READER_PROPOSALS.lab(T.prop))}.</div>${pxApproveAll(T)}</div>` : "";
  const done = other.length ? `<details><summary class="stat">${other.length} earlier proposal${other.length === 1 ? "" : "s"} (rejected, withdrawn, superseded or expired)</summary>${other.slice().reverse().map(p => `<div class="rv-row"><span class="chip">${p.status}</span> ${p.label}: ${p.from} → ${p.to}${p.reason ? " — " + p.reason : ""}</div>`).join("")}</details>` : "";
  const html = (cards || `<div class="note">No pending proposals. One appears when a confirmed drift moves a quantity a threshold is compared with.</div>`) + tog + done + ovHtml();
  if (RT.last.px === html) return; RT.last.px = html; rt$("pxList").innerHTML = html;
}
rt$("pxList").onclick = e => {
  const b = e.target.closest("button[data-px-do]"); if (!b) return;
  const act = b.dataset.pxDo;
  if (act === "approve" || act === "approveAll"){
    const T = PX.res && PX.res.together, pend = READER.register.review().proposals.filter(p => p.status === "pending");
    const ids = act === "approve" ? [b.dataset.id] : (T ? T.ids.slice() : []);
    const ok = act === "approve" ? pxFresh(pend.find(p => p.id === ids[0]) || {}, PX.res && PX.res.per[ids[0]]) : !!T && PX.res.epoch === READER.register.epoch;
    if (!ok || !ids.length) return;
    if (pxArmed(ids)) return doApprove(ids);
    pxArm(ids); RT.last.px = null; pxRender(); return;
  }
  if (act === "recompute"){ if (!READER.register.recompute(b.dataset.id)) rt$("pxStat").textContent = "Nothing changed: the recomputed value would not differ materially."; }
  else { const inp = rt$("pxList").querySelector(`input[data-px-reason="${b.dataset.id}"]`); READER.register.reject(b.dataset.id, inp && inp.value); }
  rgPersist(); RT.last.px = null; RT.last.rv = null; pxRender(); rvRender();
};

// ---------- approval: an accepted proposal becomes a local override and a dated revision file (Part 3c) ----------
const pxCur = k => { const l = pxLink(k); return l.at === "ep" ? READER.cfg.ep[k] : READER.cfg[k]; };
const pxBuiltIn = k => { const l = pxLink(k); return l.at === "ep" ? READER_EPISODES.DEFAULTS[k] : READER_ENGINE.DEFAULTS[k]; };
function ovApplyOne(k, v){ if (pxLink(k).at === "ep") READER.cfg.ep[k] = v; else READER.cfg[k] = v; }
const pxFresh = (p, r) => !!r && r.rev === (p.rev || 0) && !!PX.res && PX.res.epoch === READER.register.epoch;
const pxArmed = ids => !!PX.arm && Date.now() < PX.arm.until && PX.arm.ids.join() === ids.join();
function pxArm(ids){ PX.arm = {ids, until:Date.now() + 8000}; setTimeout(() => { if (PX.arm && Date.now() >= PX.arm.until){ PX.arm = null; RT.last.px = null; pxRender(); } }, 8200); }
function pxApproveBtn(p, fresh){
  return `<button data-px-do="approve" data-id="${p.id}" ${fresh ? "" : "disabled"} title="${fresh ? "" : "Check this proposal against recordings first"}">${pxArmed([p.id]) ? "Confirm approve" : "Approve"}</button>`;
}
function pxArmHtml(p){
  if (!pxArmed([p.id])) return "";
  const r = PX.res.per[p.id], bad = r.v.conds.filter(c => !c.ok);
  return `<div class="note">Approving applies <b>${p.k}: ${p.from} → ${p.to}</b> on this device straight away and downloads a revision file. Verdict: <b>${r.v.verdict}</b>.${bad.length ? " Missing: " + bad.map(c => c.text).join("; ") + "." : ""} Tap Confirm approve within 8 seconds, or leave it.</div>`;
}
function pxApproveAll(T){
  const ids = T.ids;
  return `<div class="row" style="margin-top:6px"><button data-px-do="approveAll">${pxArmed(ids) ? "Confirm approve all" : "Approve all together"}</button></div>`
    + (pxArmed(ids) ? `<div class="note">Approving applies ${ids.length} changes together (${ids.map(i => { const p = READER.register.proposals.find(x => x.id === i); return p.k + " " + p.from + " → " + p.to; }).join("; ")}) and downloads ${ids.length} revision files marked as one group.</div>` : "");
}
const FENCE = "\x60\x60\x60";
function pxRevisionFile(p, r, group, res, done){
  const d = new Date().toISOString().slice(0, 10), v = r.v;
  const json = {kind:"approval", v:1, id:p.id, group, key:p.k, where:p.at, label:p.label, from:p.from, to:p.to, change:+p.change.toFixed(4), approvedAt:p.approvedAt, date:d, provisional:p.provisional, large:p.large,
    verdict:v.verdict, conditions:v.conds.map(c => ({k:c.k, ok:c.ok, text:c.text})), cause:{driftId:p.driftId, driftKey:p.driftKey, driftFrom:p.driftFrom, driftAt:p.driftAt, per:p.per},
    replay:{checkedAt:res.at, recordings:r.base.map(b => ({name:b.name, tag:b.tag, hours:+b.hours.toFixed(3)})), labels:v.labels, rates:v.rates}, together:group ? done.map(x => x.k) : null};
  const lines = [`# Revision: ${p.label}`, "", "Status: approved", "Folded: no", `Date: ${d}`, `Threshold: ${p.k} (${p.at === "ep" ? "episode settings" : "engine settings"})`, `Change: ${p.from} -> ${p.to} (${pxPct(p.change)})${p.provisional ? ", provisional" : ""}${p.large ? ", large change" : ""}`,
    `Group: ${group ? group + " (approved together with " + done.filter(x => x.k !== p.k).map(x => x.k).join(", ") + ")" : "none"}`, "",
    "## Why", "", `${rvName(p.driftKey)} drifted (${rvWhen(p.driftAt)}). The old number sat at: ${p.per.map(q => rvName(q.key) + ": " + (q.p * 100).toFixed(2) + "th percentile").join("; ")}. The new value is taken at the same percentile of the new distribution.`, "",
    "## Evidence", "", `Verdict: **${v.verdict}**`, ""].concat(v.conds.map(c => `- ${c.ok ? "ok" : "MISSING"}: ${c.text}`));
  lines.push("", `Recordings replayed: ${r.base.map(b => b.name + " (" + b.tag + " the drift)").join(", ") || "none"}.`, "", "| Family | usual | current | proposed |", "|---|---|---|---|");
  for (const f of p.families) lines.push(`| ${pxFam(f)} | ${v.rates[f] && v.rates[f].old != null ? v.rates[f].old.toFixed(1) + "/h" : "-"} | ${pxRateTxt(r.base, f)} | ${pxRateTxt(r.prop, f)} |`);
  lines.push("", `Labels, current: ${pxLabTxt(v.labels.base)}. Labels, proposed: ${pxLabTxt(v.labels.prop)}.`, "", "## Machine-readable", "", FENCE + "json", JSON.stringify(json, null, 1), FENCE, "");
  return {name: `${d}-${p.k}${group ? "-" + group : ""}.md`, text: lines.join("\n")};
}
function pxRevertFile(rec, reason){
  const d = new Date().toISOString().slice(0, 10), json = {kind:"revert", v:1, key:rec.k, where:rec.at, of:rec.of, from:rec.from, to:rec.to, reason:rec.reason, date:d, time:rec.time};
  const lines = [`# Revert: ${pxLink(rec.k).label}`, "", "Status: approved", "Folded: no", `Date: ${d}`, `Threshold: ${rec.k}`, `Change: ${rec.from} -> ${rec.to} (back to the built-in default)`, `Reverts: ${rec.of}`, `Reason: ${rec.reason || "none given"}`, "",
    "## Machine-readable", "", FENCE + "json", JSON.stringify(json, null, 1), FENCE, ""];
  return {name: `${d}-${rec.k}-revert.md`, text: lines.join("\n")};
}
async function pxDownloads(files){ for (const f of files){ rtDownload(new Blob([f.text], {type:"text/markdown"}), f.name); await new Promise(r => setTimeout(r, 500)); } }
function doApprove(ids){
  const res = PX.res, group = ids.length > 1 ? "g" + Date.now().toString(36) : null, done = READER.register.approve(ids, {group}), files = [];
  for (const p of done){ ovApplyOne(p.k, p.to); files.push(pxRevisionFile(p, res.per[p.id], group, res, done)); }
  PX.arm = null; rgPersist(); RT.last.px = null; RT.last.rv = null; pxRender(); rvRender(); rvBadge();
  rt$("pxStat").textContent = done.length ? `Approved ${done.map(p => p.k + " " + p.from + " → " + p.to).join(", ")}. Drop the downloaded file${done.length === 1 ? "" : "s"} into docs/revisions/.` : "Nothing was approved.";
  pxDownloads(files);
}
function ovHtml(){
  const reg = READER.register, ov = reg.overrides, ks = Object.keys(ov); let h = "";
  if (PX.importOv){
    const list = Object.keys(PX.importOv).map(k => `<li>${pxLink(k).label}: ${PX.importOv[k].value} <span class="stat">(now ${pxCur(k)})</span></li>`).join("");
    h += `<div class="rv-row" style="display:block"><b>The register file you imported carries threshold overrides.</b><ul class="rg-claims">${list}</ul><div class="row"><button data-ov-do="importApply">Apply these ${Object.keys(PX.importOv).length}</button><button data-ov-do="importIgnore">Ignore</button></div></div>`;
  }
  if (!ks.length) return h;
  const rows = ks.map(k => {
    const o = ov[k], link = pxLink(k), now = pxBuiltIn(k), moved = o.builtIn != null && Math.abs(now - o.builtIn) > 1e-9;
    return `<div class="rv-row"><div class="grow"><b>${link.label}</b>: ${o.value} <span class="stat">(built-in ${now}; approved ${rvWhen(o.at)}${o.imported ? ", imported" : ""})${moved ? " The built-in default is now " + now + "; your override is " + o.value + "." : ""}</span></div><input data-ov-reason="${k}" placeholder="reason (optional)" style="max-width:180px"><button data-ov-do="reset" data-k="${k}">Reset to default</button></div>`;
  }).join("");
  return h + `<div class="rt-h">Your approved thresholds</div>${rows}<div class="note">These replace the built-in values on this device. When a release folds them into the defaults, they clear themselves.</div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("button[data-ov-do]"); if (!b) return;
  const act = b.dataset.ovDo;
  if (act === "reset"){
    const inp = rt$("pxList").querySelector(`input[data-ov-reason="${b.dataset.k}"]`), rec = READER.register.resetOverride(b.dataset.k, inp && inp.value);
    if (rec){ ovApplyOne(rec.k, rec.to); pxDownloads([pxRevertFile(rec)]); rt$("pxStat").textContent = `Reset ${rec.k} to ${rec.to}. Drop the downloaded revert file into docs/revisions/.`; }
  } else if (act === "importApply"){
    const done = READER.register.applyOverrides(PX.importOv); for (const k of done) ovApplyOne(k, READER.register.overrides[k].value);
    PX.importOv = null; rt$("pxStat").textContent = `Applied ${done.length} imported override${done.length === 1 ? "" : "s"}.`;
  } else if (act === "importIgnore"){ PX.importOv = null; }
  rgPersist(); RT.last.px = null; pxRender();
});
(function(){ READER.register.settleOverrides(); for (const k in READER.register.overrides) if (pxLink(k)) ovApplyOne(k, READER.register.overrides[k].value); })();

function rgRender(){
  const t = Date.now(); if (RT.last.reg && t - (RT.last.regAt || 0) < 3000) return; RT.last.regAt = t;
  rvRender(); pxRender();
  const reg = READER.register, snap = reg.snapshot(), voting = reg.sessions.filter(x => x.counts).length;
  const rows = reg.vars.filter(d => !d.venues).map(d => ["bn", "hl"].filter(vn => snap.vars[vn + "|" + d.id]).map(vn => {
    const v = snap.vars[vn + "|" + d.id], q = v && v.q;
    return `<tr><td>${d.label}${d.unit ? ` <span class="stat">${d.unit}</span>` : ""}</td><td>${vn === "bn" ? "Binance" : "Hyperliquid"}</td>`
      + `<td><span class="chip">${v ? v.status : "none"}</span></td><td>${v ? v.n.toLocaleString() : 0}</td>`
      + `<td>${q ? `${rgNum(q[2])} <span class="stat">(${rgNum(q[0])} to ${rgNum(q[4])})</span>` : v && v.prior ? `assumed ${rgNum(v.prior.median)}` : "–"}</td></tr>`;
  }).join("")).join("");
  const claims = reg.claims(READER.cfg).map(c => `<li>${c.label}: <b>${c.value}</b> <span class="stat">(compared with: ${c.q})</span></li>`).join("");
  const html = `<table class="rg"><thead><tr><th>Variable</th><th>Venue</th><th>Basis</th><th>Samples</th><th>Median (5% to 95%)</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<div class="note">${reg.sessions.length} finished session${reg.sessions.length === 1 ? "" : "s"} stored, ${voting} long enough to count as evidence${reg.active ? ", plus the current run" : ""}. "prior" = the expectation we wrote down, "learned" = enough samples to trust the measurement, "none" = nothing assumed yet.</div>`
    + `<details><summary class="stat">Assumptions the detectors lean on</summary><ul class="rg-claims">${claims}</ul></details>`;
  if (RT.last.reg !== html){ RT.last.reg = html; rt$("rgList").innerHTML = html; }
}
rt$("rgExport").onclick = () => {
  rgPersist(); const stamp = new Date().toISOString().slice(0, 10);
  rtDownload(new Blob([JSON.stringify({kind:"sv-register", v:1, exportedAt:Date.now(), state:READER.register.save()})], {type:"application/json"}), `reader_register_${stamp}.json`);
  rgMsg("Exported. Import it on another device to carry what the Reader has learned.");
};
rt$("rgImportBtn").onclick = () => rt$("rgImport").click();
rt$("rgImport").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try{
    const o = JSON.parse(await f.text()), ov = o && o.state && o.state.overrides; if (o && o.state) delete o.state.overrides;
    if (!o || o.kind !== "sv-register" || !READER.register.load(o.state)) throw new Error("not a register file from this app");
    rgPersist(); RT.last.reg = null; RT.last.regAt = 0; rgRender(); PX.importOv = ov && typeof ov === "object" ? Object.fromEntries(Object.entries(ov).filter(([k, x]) => pxLink(k) && x && isFinite(x.value) && x.value !== pxCur(k))) : null; if (PX.importOv && !Object.keys(PX.importOv).length) PX.importOv = null; RT.last.px = null; pxRender(); rgMsg("Imported. It replaced the register on this device." + (PX.importOv ? " The file also carries threshold overrides; see Threshold proposals to apply or ignore them." : ""));
  }catch(err){ rgMsg("Could not import that file: " + err.message); }
};

// ---------- called from renderReader ----------
function rdToolsRender(s){
  rtTimeline(s); rtScore(); rgRender();
  if (rdView.engine) rt$("rdStatus").textContent = "REPLAY of a recorded session";
  const rec = rt$("rtRec"); if (rec && !RT.rec && rec.textContent !== "Record") rec.textContent = "Record";
  rtButtons();
}
