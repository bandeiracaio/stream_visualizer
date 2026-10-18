"use strict";
// Auto-record (view): while armed it listens to ONE price stream (Binance mark price, about 1 message a second) and nothing else: no other feeds,
// no Reader engine, no drawing. When AUTOREC says the market has turned volatile it connects the app and starts the normal recording; when it
// has been calm long enough (or the time limit hits) it stops, saves the file, and disconnects again if it was the one who connected.
const AR = {on:false, ws:null, gen:0, h:null, st:null, cfg:null, timer:null, lock:null, byUs:false, t0:0};
const ar$ = id => document.getElementById(id);
const AR_FIELDS = {arTrigRatio:"trigRatio", arTrigSigma:"trigSigma", arExitRatio:"exitRatio", arExitSigma:"exitSigma", arCalmMin:"calmMin", arMaxMin:"maxMin"};
const arCfgFromUi = () => { const c = {}; for (const id in AR_FIELDS){ const v = +ar$(id).value; if (v > 0) c[AR_FIELDS[id]] = v; } return Object.assign({}, AUTOREC.DEFAULTS, c); };
const arMsg = t => { ar$("arMsg").textContent = t; };
const arDur = ms => { const m = Math.floor(ms/60000); return ms < 60000 ? Math.round(ms/1000) + " s" : m >= 60 ? Math.floor(m/60) + " h " + (m%60) + " min" : m + " min"; };

(function arInit() {
  const saved = store.get("ar.cfg", {});
  for (const id in AR_FIELDS){ const k = AR_FIELDS[id]; ar$(id).value = saved && saved[k] > 0 ? saved[k] : AUTOREC.DEFAULTS[k]; ar$(id).onchange = () => store.set("ar.cfg", arCfgFromUi()); }
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
  AR.ws = ws;
  ws.onmessage = ev => { try { const j = JSON.parse(ev.data), d = j.data || j; if (d && d.p) AUTOREC.push(AR.h, d.E || Date.now(), +d.p); } catch {} };
  ws.onclose = () => { if (AR.on && gen === AR.gen) setTimeout(() => { if (AR.on && gen === AR.gen) arOpen(); }, 5000); };
}
async function arLock() { try { if (navigator.wakeLock && !AR.lock) { AR.lock = await navigator.wakeLock.request("screen"); AR.lock.onrelease = () => { AR.lock = null; }; } } catch {} }

function arToggle() {
  if (AR.on) return arFinish("Disarmed.");
  if (typeof connected !== "undefined" && connected){ arMsg("Disconnect first (the Disconnect button at the top): while it waits the app should listen to one stream only."); return; }
  AR.cfg = arCfgFromUi(); store.set("ar.cfg", AR.cfg);
  AR.on = true; AR.gen++; AR.h = AUTOREC.createHistory(); AR.st = {mode:"waiting"}; AR.byUs = false; AR.t0 = Date.now();
  arOpen(); arLock(); AR.timer = setInterval(arTick, 5000);
  ar$("arArm").textContent = "Disarm"; arMsg("Armed. It needs 15 minutes of prices to know what a normal hour looks like before it can judge."); arTick();
}
function arTick() {
  if (!AR.on) return;
  const v = AUTOREC.vol(AR.h, AR.cfg), now = Date.now();
  if (AR.st.mode === "recording" && !RT.rec) return arFinish("The recording was stopped by hand, so auto-record is off. The session is loaded: use Save session.");
  const r = AUTOREC.step(AR.st, v, now, AR.cfg); AR.st = r.st;
  if (r.action === "start") arStart(r.why, v); else if (r.action === "stop") arStop(r.why);
  if (AR.on) arStatus(v, now);
}
function arStatus(v, now) {
  const c = AR.cfg, fx = x => x.toFixed(2);
  let t;
  if (!v.ready) t = `learning the last hour: ${Math.min(15, Math.round(v.nSlow/60))} of 15 min`;
  else if (AR.st.mode === "waiting") t = `waiting · sigma ${fx(v.fast)} (x${fx(v.ratio)} of the hour) · starts at x${c.trigRatio} or ${c.trigSigma}`;
  else t = `recording ${arDur(now - AR.st.since)} of at most ${c.maxMin} min · sigma ${fx(v.fast)} (x${fx(v.ratio)}) · calm ${AR.st.calmSince == null ? 0 : Math.floor((now - AR.st.calmSince)/60000)} of ${c.calmMin} min`;
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
  arFinish(`Done (${why === "calm" ? "calm again" : "time limit"}), ${mins} recorded and saved. Replay it from this panel or drop the file in the repo.`);
}
function arFinish(msg) {
  AR.on = false; AR.gen++; clearInterval(AR.timer); AR.timer = null;
  try { if (AR.ws) AR.ws.close(); } catch {} AR.ws = null;
  try { if (AR.lock) AR.lock.release(); } catch {} AR.lock = null;
  ar$("arArm").textContent = "Arm"; ar$("arStat").textContent = "off"; arMsg(msg);
}
