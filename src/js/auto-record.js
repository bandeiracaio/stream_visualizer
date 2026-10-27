"use strict";
// Auto-record (view): while armed it listens to ONE price stream (Binance mark price, about 1 message a second) and nothing else: no other feeds,
// no Reader engine, no drawing. When AUTOREC says the market has turned volatile it connects the app and starts the normal recording; when it
// has been calm long enough (or the time limit hits) it stops, saves the file, and disconnects again if it was the one who connected.
const AR = {on:false, ws:null, gen:0, h:null, st:null, cfg:null, timer:null, lock:null, byUs:false, t0:0, lastMsg:0, runs:0, drops:[], worker:null, volAt:0, unlock:null, v:null, pre:null, preMeta:null};
const ar$ = id => document.getElementById(id);
const AR_FIELDS = {arTrigRatio:"trigRatio", arTrigSigma:"trigSigma", arExitRatio:"exitRatio", arExitSigma:"exitSigma", arCalmMin:"calmMin", arMaxMin:"maxMin", arCooldown:"cooldownMin", arPreMin:"preMin"};
const arCfgFromUi = () => { const c = {}; for (const id in AR_FIELDS){ const v = +ar$(id).value; if (v > 0) c[AR_FIELDS[id]] = v; } c.rearm = ar$("arRearm").checked; c.epTrig = ar$("arEpTrig").checked; return Object.assign({}, AUTOREC.DEFAULTS, c); };
const arMsg = t => { ar$("arMsg").textContent = t; };
const arDur = ms => { const m = Math.floor(ms/60000); return ms < 60000 ? Math.round(ms/1000) + " s" : m >= 60 ? Math.floor(m/60) + " h " + (m%60) + " min" : m + " min"; };

(function arInit() {
  const saved = store.get("ar.cfg", {});
  for (const id in AR_FIELDS){ const k = AR_FIELDS[id]; ar$(id).value = saved && saved[k] > 0 ? saved[k] : AUTOREC.DEFAULTS[k]; ar$(id).onchange = () => store.set("ar.cfg", arCfgFromUi()); }
  ar$("arRearm").checked = !saved || saved.rearm !== false; ar$("arRearm").onchange = () => store.set("ar.cfg", arCfgFromUi());
  ar$("arEpTrig").checked = !saved || saved.epTrig !== false; ar$("arEpTrig").onchange = () => store.set("ar.cfg", arCfgFromUi());
  ar$("arArm").onclick = arToggle;
  ar$("arHdr").onclick = () => {      // the same switch from the header: arms with the settings of the Reader tab and shows the answer here for a few seconds
    arToggle(); const full = ar$("arMsg").textContent, m = /^Disconnect first/.test(full) ? "Disconnect first, then press Arm." : full.split(/(?<=\.)\s/)[0], box = ar$("arHdrMsg"); box.textContent = m.length > 140 ? m.slice(0, 137) + "…" : m;      // the first sentence only: "Armed." / "Disarmed." / the reason it refused (a phone header must not grow for long)
    clearTimeout(arInit.t); arInit.t = setTimeout(() => { box.textContent = ""; }, 9000);
  };
  document.addEventListener("visibilitychange", () => { if (AR.on && document.visibilityState === "visible") arLock(); });     // the screen lock is dropped when the tab is hidden
})();

function arLabels() { const t = AR.on ? "Disarm" : "Arm"; ar$("arArm").textContent = ar$("arHdr").textContent = t; ar$("arHdr").classList.toggle("on", AR.on); }

function arUrl() {
  const d = STREAMS.find(x => x.id === "bn.markPrice"), key = $("route").value === "routed" ? d.sock : "legacy", sub = d.sub(bnSym());
  return key === "legacy" ? `wss://fstream.binance.com/stream?streams=${sub}` : `wss://fstream.binance.com/${key}/stream?streams=${sub}`;
}
function arOpen() {
  const gen = AR.gen; let ws;
  try { ws = new WebSocket(arUrl()); } catch { arMsg("The browser blocked the connection."); return; }
  AR.ws = ws; AR.lastMsg = Date.now(); const opened = AR.lastMsg;
  ws.onmessage = ev => { try { const j = JSON.parse(ev.data), d = j.data || j; if (d && d.p){ AR.lastMsg = Date.now(); AUTOREC.push(AR.h, AR.lastMsg, +d.p); } } catch {} };
  ws.onclose = () => { if (AR.on && gen === AR.gen) AR.drops = AR.drops.concat({at:Date.now(), upMs:Date.now() - opened, silentMs:Date.now() - AR.lastMsg}).slice(-20);      // kept so a pattern in the drops can be read afterwards
    if (AR.on && gen === AR.gen) setTimeout(() => { if (AR.on && gen === AR.gen) arOpen(); }, 5000); };
}
// The price feed in a Web Worker (auto-record-worker.js): its socket and timers are not slowed or frozen with a hidden tab the way the page's are.
// Falls back to the page's own socket (arOpen) when workers are unavailable.
function arStartFeed() {
  let w;
  try { const src = ar$("arWorkerSrc").textContent, u = URL.createObjectURL(new Blob([src], {type:"text/javascript"})); w = new Worker(u); URL.revokeObjectURL(u); }
  catch { AR.worker = null; return arOpen(); }
  AR.worker = w; AR.volAt = 0; AR.lastMsg = Date.now();
  w.onmessage = ev => {
    if (w !== AR.worker) return; const m = ev.data;
    if (m.t === "vol") { AR.v = m.v; AR.lastMsg = m.lastMsg; AR.volAt = Date.now(); AR.ws = {readyState:m.ws, close:() => w.postMessage({t:"close"})}; }
    else if (m.t === "col") { if (typeof colAdd === "function") colAdd(m.rec); }      // a collector record from the worker (collectors.js keeps the tape)
    else if (m.t === "trace") { if (AR.preMeta) AR.pre = Object.assign({}, AR.preMeta, {prices:m.rows}); }
    else if (m.t === "drop") AR.drops = AR.drops.concat(m.d).slice(-20);      // kept so a pattern in the drops can be read afterwards
  };
  w.onerror = () => { if (w !== AR.worker) return; AR.worker = null; try { w.terminate(); } catch {} arOpen(); };      // the worker failed: do the same job on the page
  w.postMessage({t:"start", url:arUrl(), cfg:Object.assign({}, AR.cfg, {collectors:typeof colWorkerCfg === "function" ? colWorkerCfg() : {}})});
}
// A page that holds a Web Lock is not frozen by the browser while hidden; hold one while armed.
function arKeepAlive() { try { if (navigator.locks) navigator.locks.request("sv-armed", {mode:"shared"}, () => new Promise(res => { AR.unlock = res; })); } catch {} }
async function arLock() { try { if (navigator.wakeLock && !AR.lock) { AR.lock = await navigator.wakeLock.request("screen"); AR.lock.onrelease = () => { AR.lock = null; }; } } catch {} }

function arToggle() {
  if (AR.on) return arFinish(AR.st.mode === "recording" ? "Disarmed. The recording and the connection keep running: stop them by hand (Stop recording, then Save session)." : "Disarmed.");
  if (RT.rec){ arMsg("A recording is running: stop it first (Stop recording), then Arm."); return; }
  AR.cfg = arCfgFromUi(); store.set("ar.cfg", AR.cfg);
  AR.on = true; AR.gen++; AR.h = AUTOREC.createHistory(); AR.st = {mode:"waiting"}; AR.byUs = !connected; AR.t0 = Date.now(); AR.runs = 0; AR.drops = [];
  if (!connected) $("go").click();      // full watch: the feeds and the Reader engine run while armed, with a rolling lead-in of the real inputs
  arRoll(); arStartFeed(); arKeepAlive(); arLock(); AR.timer = setInterval(arTick, 5000);
  arLabels(); arMsg(`Armed (full watch: the feeds run and the last ${AR.cfg.preMin} minutes of inputs are kept, so a recording starts with its lead-in). It needs 15 minutes of prices to know what a normal hour looks like before it can judge.`); arTick();
}
function arTick() {
  if (!AR.on) return;
  const now = Date.now(); let v;
  if (AR.worker) { v = AR.v || AUTOREC.vol(AUTOREC.createHistory(), AR.cfg, now); if (now - AR.volAt > 20000) v = Object.assign({}, v, {ready:false}); }      // the worker's reading; if it has gone quiet the page cannot judge
  else {
    if (AR.ws && now - AR.lastMsg > 15000) try { AR.ws.close(); } catch {}     // a socket that went silent without closing: close it so onclose reopens it
    v = AR.v = AUTOREC.vol(AR.h, AR.cfg, now);      // AR.v is read by the header status (status-bar.js)
  }
  if (AR.st.mode === "waiting" && !connected) return arFinish("You disconnected, so auto-record is off.");
  if (AR.st.mode === "waiting") arRoll();
  if (AR.st.mode === "recording" && !RT.rec){
    if (AR.byUs && connected) $("go").click();
    return arFinish("The recording stopped on its own (by hand or at its input limit), so auto-record is off. The session is loaded: use Save session.");
  }
  const eps = READER.activeEpisodes().filter(e => e.family !== "wall");      // walls can stand for hours: they neither start a recording nor keep one open
  AR.ep = {active:eps.filter(e => e.stage === "active").length, live:eps.length, fams:[...new Set(eps.map(e => e.family))]};
  const r = AUTOREC.step(AR.st, v, now, AR.cfg, AR.ep); AR.st = r.st;
  if (r.action === "start") arStart(r.why, v); else if (r.action === "stop") arStop(r.why);
  if (AR.on) arStatus(v, now);
}
// The rolling lead-in: the engine's own input recording, trimmed to the last preMin minutes every tick. At a start it becomes the recording.
function arRoll() {
  if (RT.rec) return;
  if (!AR.roll || !READER.recording().on){ READER.startRecording({quoteMs:100}); AR.roll = true; AR.leadFrom = Date.now(); }
  READER.trimRecording(Date.now() - AR.cfg.preMin*60000); AR.leadMs = Math.min(AR.cfg.preMin*60000, Date.now() - AR.leadFrom);
}
function arStatus(v, now) {
  const c = AR.cfg, fx = x => x.toFixed(2);
  let t;
  if (!v.ready) t = v.nSlow >= AR.cfg.minSlow ? "price stream stalled: waiting for fresh prices" : `learning the last hour: ${Math.min(15, Math.round(v.nSlow/60))} of 15 min`;
  else if (AR.st.mode === "waiting" && AR.st.until > now) t = `cooldown after recording ${AR.runs}: ${Math.ceil((AR.st.until - now)/60000)} min left before it can start again`;
  else if (AR.st.mode === "waiting") t = `lead-in ${arDur(AR.leadMs)} kept · waiting · sigma ${fx(v.fast)} (x${fx(v.ratio)} of the hour) · starts at x${c.trigRatio} or ${c.trigSigma}`;
  else t = `recording ${arDur(now - AR.st.since)} of at most ${c.maxMin} min · sigma ${fx(v.fast)} (x${fx(v.ratio)}) · calm ${AR.st.calmSince == null ? 0 : Math.floor((now - AR.st.calmSince)/60000)} of ${c.calmMin} min`;
  if (AR.drops.length) t += ` · price stream dropped ${AR.drops.length}x, last at ${new Date(AR.drops[AR.drops.length - 1].at).toLocaleTimeString()}`;
  ar$("arStat").textContent = t;
}
function arStart(why, v) {
  // keep the last 30 minutes of the mark price (one point a second) with this recording: what led up to the trigger, which no feed was recording yet
  AR.preMeta = {at:Date.now(), why, eps:why === "episode" ? AR.ep : undefined, fast:v.fast, slow:v.slow, ratio:v.ratio, trigRatio:AR.cfg.trigRatio, trigSigma:AR.cfg.trigSigma}; AR.pre = null;
  if (AR.worker) AR.worker.postMessage({t:"dump", secs:1800}); else AR.pre = Object.assign({}, AR.preMeta, {prices:AUTOREC.dump(AR.h, Date.now(), 1800)});
  if (!connected){ AR.byUs = true; $("go").click(); }
  RT.recLimit = {ms:(AR.cfg.maxMin + 2)*60000, n:2000000};
  if (!RT.rec){      // adopt the rolling lead-in as the recording (the engine has been recording since the arming); startedAt is the trigger, the inputs begin earlier
    if (!READER.recording().on) READER.startRecording({quoteMs:100});
    RT.rec = {t0:Date.now(), sym:ar$("sym").value.trim().toUpperCase(), baseline:READER.register.snapshot()}; AR.roll = false;
    ar$("rtRec").textContent = "Stop recording"; RT.recTimer = setInterval(rtRecTick, 1000); rtRecTick();
  }
  arMsg(`Recording since ${new Date().toLocaleTimeString()}: ${why === "episode" ? `the Reader sees ${AR.ep.fams.join(", ")} (volatility is x${v.ratio.toFixed(2)} of the hour).` : `the last 5 minutes are x${v.ratio.toFixed(2)} of the hour (sigma ${v.fast.toFixed(2)}).`} It stops after ${AR.cfg.calmMin} calm minutes or ${AR.cfg.maxMin} minutes in all.`);
}
function arStop(why) {
  const mins = AR.st.since ? arDur(Date.now() - AR.st.since) : "";
  if (RT.rec) rtRecStop();
  ar$("rtSave").click();                                           // downloads the file; the session also stays loaded, so Save session still works
  const saved = `${mins} recorded and saved: downloaded, and kept on this device under Saved recordings (Share sends it to mail or Drive).`, how = why === "calm" ? "calm again" : "time limit";
  AR.runs++;
  if (!AR.cfg.rearm || AR.runs >= AR.cfg.maxRuns) return arFinish(`Done (${how}), ${saved}${AR.cfg.rearm ? ` That was recording ${AR.runs} of at most ${AR.cfg.maxRuns} per arming, so it is off now.` : ""}`);
  AR.st = AUTOREC.afterStop(Date.now(), AR.cfg); arRoll();      // stay armed: the price stream and its history keep running (no new 15 minutes to learn) and so do the feeds, which buffer the lead-in of the next one
  arMsg(`Recording ${AR.runs} done (${how}), ${saved} Still armed: it can start again after a ${AR.cfg.cooldownMin} minute cooldown.`); arTick();
}
function arFinish(msg) {
  AR.on = false; AR.gen++; clearInterval(AR.timer); AR.timer = null;
  if (AR.roll && !RT.rec){ READER.stopRecording(); AR.roll = false; }      // the lead-in buffer is dropped when nothing started
  if (AR.byUs && connected) $("go").click(); AR.byUs = false;
  try { if (AR.worker) { AR.worker.postMessage({t:"stop"}); AR.worker.terminate(); } } catch {} AR.worker = null;
  try { if (AR.ws) AR.ws.close(); } catch {} AR.ws = null;
  if (AR.unlock) { AR.unlock(); AR.unlock = null; }
  try { if (AR.lock) AR.lock.release(); } catch {} AR.lock = null;
  arLabels(); ar$("arStat").textContent = "off"; arMsg(msg);
}
