"use strict";
// Health log (view): a small black box that survives a reload. It writes down what the page and the feeds were doing around the moments that
// cost data: the tab hidden, frozen or throttled, the computer asleep, the page reopened or gone, a venue going silent, the price stream
// dropping, the wake lock lost, auto-record's learning starting over. Read-only: it only looks at the app's state once a second and never
// touches a feed, a recording or a detection. Loaded after status-bar.js (it reuses sbSnapshot).
const HL = {key:"sv.health", ev:[], t:Date.now(), mono:performance.now(), prev:{}, beatAt:0, silent:{}, drops:0, lastLog:0};
const hl$ = id => document.getElementById(id);
const hlLoad = () => { try { return JSON.parse(localStorage.getItem(HL.key)) || {}; } catch { return {}; } };
const hlSave = (extra) => { try { localStorage.setItem(HL.key, JSON.stringify(Object.assign({ev:HL.ev.slice(-400)}, extra || {}, {beat:hlBeat()}))); } catch {} };
const hlBeat = () => ({at:Date.now(), v:APP_VERSION, vis:document.visibilityState, ar:AR.on ? (AR.st && AR.st.mode) : "off", rec:!!RT.rec});
function hlNote(k, d) {
  HL.ev.push({t:Date.now(), k, d:d || null}); if (HL.ev.length > 400) HL.ev.shift();
  hlSave(); hlRender();
}
// what was going on, for the beat: heap and battery when the browser tells (Chrome does)
async function hlExtra() {
  const o = {};
  try { if (performance.memory) o.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch {}
  try { if (navigator.getBattery) { const b = await navigator.getBattery(); o.battery = Math.round(b.level * 100) + (b.charging ? "% charging" : "% on battery"); } } catch {}
  return o;
}

// ---- the list under Saved recordings
const hlTime = t => new Date(t).toLocaleTimeString();
const hlText = e => e.k + (e.d ? " · " + Object.entries(e.d).filter(([, v]) => v != null && v !== "").map(([k, v]) => k + " " + (typeof v === "object" ? JSON.stringify(v) : v)).join(", ") : "");
function hlRender() {
  const box = hl$("hlList"); if (!box) return;
  const now = Date.now(), t0 = now - 3600000, recent = HL.ev.filter(e => e.t >= t0 && e.k !== "load").length;
  hl$("hlSum").textContent = `Health log: ${HL.ev.length} notes, ${recent} in the last hour`;
  box.innerHTML = HL.ev.slice(-40).reverse().map(e => `<div class="stat">${hlTime(e.t)} · ${hlText(e).replace(/[&<>]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;"}[c]))}</div>`).join("") || `<div class="note">Nothing noted yet.</div>`;
}
hl$("hlSave").onclick = () => {
  const text = JSON.stringify({kind:"sv-health", v:1, version:APP_VERSION, at:Date.now(), ua:navigator.userAgent, events:HL.ev}, null, 1);
  rtDownload(new Blob([text], {type:"application/json"}), "health_" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".json");
};
hl$("hlClear").onclick = () => { HL.ev = []; hlSave(); hlNote("log cleared"); };
hlRender();

// ---- when the page starts: what did the last one leave behind?
(() => {
  const old = hlLoad(); HL.ev = Array.isArray(old.ev) ? old.ev : [];
  const b = old.beat, now = Date.now();
  hlNote("load", {version:APP_VERSION, discarded:!!document.wasDiscarded, vis:document.visibilityState,
    previous: b ? {goneMs:now - b.at, version:b.v, vis:b.vis, ar:b.ar, rec:b.rec, last:old.extra} : null});
})();

// ---- the heartbeat: the page asks to be woken every second; a long gap means it was frozen, throttled or the computer slept
setInterval(async () => {
  const now = Date.now(), mono = performance.now(), dt = now - HL.t, dm = mono - HL.mono; HL.t = now; HL.mono = mono;
  if (dt > 4000) hlNote("gap", {gapMs:dt, monoMs:Math.round(dm), vis:document.visibilityState, focus:document.hasFocus(), why: dt - dm > 3000 ? "clock jumped (the computer slept?)" : "timers delayed (tab throttled or frozen)"});
  let snap; try { snap = sbSnapshot(); } catch { return; }
  // a venue that went quiet, and came back
  for (const v of ["bn", "hl"]) {
    const q = snap.connected && snap.venues[v].ageMs != null && snap.venues[v].ageMs > 10000;
    if (q && !HL.silent[v]) { HL.silent[v] = now; hlNote("silent", {venue:v, ageMs:snap.venues[v].ageMs}); }
    else if (!q && HL.silent[v]) { hlNote("back", {venue:v, silentMs:now - HL.silent[v]}); HL.silent[v] = 0; }
  }
  // auto-record: the price stream dropping, the wake lock, the learning starting over, the mode
  const p = HL.prev, ar = snap.ar;
  if (AR.on) {
    if (AR.drops.length && AR.drops[AR.drops.length - 1].at !== HL.drops) { const d = AR.drops[AR.drops.length - 1]; HL.drops = d.at; hlNote("price-stream drop", {upMs:d.upMs, silentMs:d.silentMs}); }
    if (p.wake && !ar.wake) hlNote("wake lock lost", {vis:document.visibilityState});
    if (p.ready && !ar.ready) hlNote("auto-record not ready", {learnMin:ar.learnMin, mode:ar.mode, lastMsgMs:now - AR.lastMsg, wsState:AR.ws && AR.ws.readyState});
    if (p.mode && ar.mode && p.mode !== ar.mode) hlNote("auto-record " + p.mode + " -> " + ar.mode, {runs:ar.runs});
    if (p.learnMin > 5 && ar.learnMin < p.learnMin - 2) hlNote("learning started over", {from:p.learnMin, to:ar.learnMin});
  }
  if (p.recOn != null && p.recOn !== snap.rec.on) hlNote(snap.rec.on ? "recording started" : "recording stopped", snap.rec.on ? null : {ms:p.recMs});
  if (p.online != null && p.online !== snap.online) hlNote(snap.online ? "back online" : "went offline");
  HL.prev = {wake:ar.wake, ready:ar.ready, mode:ar.mode, learnMin:ar.learnMin, recOn:snap.rec.on, recMs:snap.rec.ms, online:snap.online};
  if (now - HL.beatAt > 5000) { HL.beatAt = now; hlSave({extra:await hlExtra()}); }
}, 1000);

document.addEventListener("visibilitychange", () => hlNote("tab " + document.visibilityState, {focus:document.hasFocus()}));
document.addEventListener("freeze", () => hlNote("page frozen by the browser"));
document.addEventListener("resume", () => hlNote("page resumed"));
addEventListener("pagehide", e => hlNote("pagehide", {cached:!!e.persisted}));
addEventListener("pageshow", e => { if (e.persisted) hlNote("pageshow from cache"); });
addEventListener("error", e => hlNote("page error", {msg:String(e.message).slice(0, 160)}));
addEventListener("unhandledrejection", e => hlNote("promise error", {msg:String(e.reason && e.reason.message || e.reason).slice(0, 160)}));
