"use strict";
// Auto-record (view): while armed it listens to ONE price stream (Binance mark price, about 1 message a second) and nothing else: no other feeds,
// no Reader engine, no drawing. When AUTOREC says the market has turned volatile it connects the app and starts the normal recording; when it
// has been calm long enough (or the time limit hits) it stops, saves the file, and disconnects again if it was the one who connected.
const AR = {on:false, ws:null, gen:0, h:null, st:null, cfg:null, timer:null, lock:null, byUs:false, t0:0, lastMsg:0, runs:0, drops:[]};
const ar$ = id => document.getElementById(id);
const AR_FIELDS = {arTrigRatio:"trigRatio", arTrigSigma:"trigSigma", arExitRatio:"exitRatio", arExitSigma:"exitSigma", arCalmMin:"calmMin", arMaxMin:"maxMin", arCooldown:"cooldownMin"};
const arCfgFromUi = () => { const c = {}; for (const id in AR_FIELDS){ const v = +ar$(id).value; if (v > 0) c[AR_FIELDS[id]] = v; } c.rearm = ar$("arRearm").checked; return Object.assign({}, AUTOREC.DEFAULTS, c); };
const arMsg = t => { ar$("arMsg").textContent = t; };
const arDur = ms => { const m = Math.floor(ms/60000); return ms < 60000 ? Math.round(ms/1000) + " s" : m >= 60 ? Math.floor(m/60) + " h " + (m%60) + " min" : m + " min"; };

(function arInit() {
  const saved = store.get("ar.cfg", {});
  for (const id in AR_FIELDS){ const k = AR_FIELDS[id]; ar$(id).value = saved && saved[k] > 0 ? saved[k] : AUTOREC.DEFAULTS[k]; ar$(id).onchange = () => store.set("ar.cfg", arCfgFromUi()); }
  ar$("arRearm").checked = !saved || saved.rearm !== false; ar$("arRearm").onchange = () => store.set("ar.cfg", arCfgFromUi());
  ar$("arArm").onclick = arToggle;
  document.addEventListener("visibilitychange", () => { if (AR.on && document.visibilityState === "visible") arLock(); });     // the screen lock is dropped when the tab is hidden
})();

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
async function arLock() { try { if (navigator.wakeLock && !AR.lock) { AR.lock = await navigator.wakeLock.request("screen"); AR.lock.onrelease = () => { AR.lock = null; }; } } catch {} }

function arToggle() {
  if (AR.on) return arFinish(AR.st.mode === "recording" ? "Disarmed. The recording and the connection keep running: stop them by hand (Stop recording, then Save session)." : "Disarmed.");
  if (connected){ arMsg("Disconnect first (the Disconnect button at the top): while it waits the app should listen to one stream only."); return; }
  AR.cfg = arCfgFromUi(); store.set("ar.cfg", AR.cfg);
  AR.on = true; AR.gen++; AR.h = AUTOREC.createHistory(); AR.st = {mode:"waiting"}; AR.byUs = false; AR.t0 = Date.now(); AR.runs = 0; AR.drops = [];
  arOpen(); arLock(); AR.timer = setInterval(arTick, 5000);
  ar$("arArm").textContent = "Disarm"; arMsg("Armed. It needs 15 minutes of prices to know what a normal hour looks like before it can judge."); arTick();
}
function arTick() {
  if (!AR.on) return;
  if (AR.ws && Date.now() - AR.lastMsg > 15000) try { AR.ws.close(); } catch {}     // a socket that went silent without closing: close it so onclose reopens it
  const now = Date.now(), v = AR.v = AUTOREC.vol(AR.h, AR.cfg, now);      // AR.v is read by the header status (status-bar.js)
  if (AR.st.mode === "recording" && !RT.rec){
    if (AR.byUs && connected) $("go").click();
    return arFinish("The recording stopped on its own (by hand or at its input limit), so auto-record is off. The session is loaded: use Save session.");
  }
  const r = AUTOREC.step(AR.st, v, now, AR.cfg); AR.st = r.st;
  if (r.action === "start") arStart(r.why, v); else if (r.action === "stop") arStop(r.why);
  if (AR.on) arStatus(v, now);
}
function arStatus(v, now) {
  const c = AR.cfg, fx = x => x.toFixed(2);
  let t;
  if (!v.ready) t = v.nSlow >= AR.cfg.minSlow ? "price stream stalled: waiting for fresh prices" : `learning the last hour: ${Math.min(15, Math.round(v.nSlow/60))} of 15 min`;
  else if (AR.st.mode === "waiting" && AR.st.until > now) t = `cooldown after recording ${AR.runs}: ${Math.ceil((AR.st.until - now)/60000)} min left before it can start again`;
  else if (AR.st.mode === "waiting") t = `waiting · sigma ${fx(v.fast)} (x${fx(v.ratio)} of the hour) · starts at x${c.trigRatio} or ${c.trigSigma}`;
  else t = `recording ${arDur(now - AR.st.since)} of at most ${c.maxMin} min · sigma ${fx(v.fast)} (x${fx(v.ratio)}) · calm ${AR.st.calmSince == null ? 0 : Math.floor((now - AR.st.calmSince)/60000)} of ${c.calmMin} min`;
  if (AR.drops.length) t += ` · price stream dropped ${AR.drops.length}x, last at ${new Date(AR.drops[AR.drops.length - 1].at).toLocaleTimeString()}`;
  ar$("arStat").textContent = t;
}
function arStart(why, v) {
  AR.byUs = !connected;
  if (!connected) $("go").click();
  RT.recLimit = {ms:(AR.cfg.maxMin + 2)*60000, n:2000000};
  if (!RT.rec) ar$("rtRec").click();
  arMsg(`Recording since ${new Date().toLocaleTimeString()}: the last 5 minutes are x${v.ratio.toFixed(2)} of the hour (sigma ${v.fast.toFixed(2)}). It stops after ${AR.cfg.calmMin} calm minutes or ${AR.cfg.maxMin} minutes in all.`);
}
function arStop(why) {
  const mins = AR.st.since ? arDur(Date.now() - AR.st.since) : "";
  if (RT.rec) rtRecStop();
  ar$("rtSave").click();                                           // downloads the file; the session also stays loaded, so Save session still works
  if (AR.byUs && connected) $("go").click();
  const saved = `${mins} recorded and saved: downloaded, and kept on this device under Saved recordings (Share sends it to mail or Drive).`, how = why === "calm" ? "calm again" : "time limit";
  AR.runs++;
  if (!AR.cfg.rearm || AR.runs >= AR.cfg.maxRuns) return arFinish(`Done (${how}), ${saved}${AR.cfg.rearm ? ` That was recording ${AR.runs} of at most ${AR.cfg.maxRuns} per arming, so it is off now.` : ""}`);
  AR.st = AUTOREC.afterStop(Date.now(), AR.cfg); AR.byUs = false;      // stay armed: the price stream and its history keep running, so there is no new 15 minutes to learn
  arMsg(`Recording ${AR.runs} done (${how}), ${saved} Still armed: it can start again after a ${AR.cfg.cooldownMin} minute cooldown.`); arTick();
}
function arFinish(msg) {
  AR.on = false; AR.gen++; clearInterval(AR.timer); AR.timer = null;
  try { if (AR.ws) AR.ws.close(); } catch {} AR.ws = null;
  try { if (AR.lock) AR.lock.release(); } catch {} AR.lock = null;
  ar$("arArm").textContent = "Arm"; ar$("arStat").textContent = "off"; arMsg(msg);
}
