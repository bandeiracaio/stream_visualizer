"use strict";
// Re-arm prompt (view, header bar #armBar): while auto-record is armed this page keeps a flag in the browser's storage ("ar.armed": since, last seen, recordings made); a deliberate Disarm clears it.
// A page that loads, finds the flag and is not armed shows the bar: a reload, a browser restart or a closed tab silently ends an overnight collection otherwise. Nothing is shown while another page of
// this app is armed (it holds the Web Lock "sv-armed"). Arming is auto-record's own: the button only presses the header Arm button. Decisions: arm-memory-core.js. Spec: .scratch/arm-memory/spec.md.
const ARMV = {prev:false, elsewhere:false, dismissed:false, noted:false};
const armv$ = id => document.getElementById(id);
async function armvLocks() {
  try { if (!navigator.locks || !navigator.locks.query) return; const q = await navigator.locks.query(); ARMV.elsewhere = !AR.on && (q.held || []).some(l => l.name === "sv-armed"); } catch {}
}
function armvTick() {
  const now = Date.now(), flag = store.get("ar.armed", null), st = ARMMEM.step(flag, {armed:AR.on, justArmed:AR.on && !ARMV.prev, justDisarmed:!AR.on && ARMV.prev, now, runs:AR.runs});
  ARMV.prev = AR.on;
  if (st.write) store.set("ar.armed", st.flag);
  const p = ARMMEM.prompt(st.write ? st.flag : flag, {now, armed:AR.on, lockElsewhere:ARMV.elsewhere, dismissed:ARMV.dismissed}), bar = armv$("armBar");
  if (!bar) return;
  if (!p) { if (!bar.hidden) bar.hidden = true; return; }
  const t = ARMMEM.text(p, x => new Date(x).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) + (now - x > 20*3600000 ? " on " + new Date(x).toLocaleDateString([], {day:"numeric", month:"short"}) : ""));
  if (armv$("armText").textContent !== t) armv$("armText").textContent = t;
  bar.title = "A reload, a browser restart or a closed tab ends an armed page. Re-arm needs 15 minutes of prices before it can judge the market again."; if (bar.hidden) bar.hidden = false;
  if (!ARMV.noted) { ARMV.noted = true; try { hlNote("armed page ended", {lastSeen:new Date(p.last).toISOString(), agoMin:Math.round(p.agoMs/60000), runs:p.runs}); } catch {} }      // the Health log keeps the unexpected end for the morning summary
}
armv$("armBtn").onclick = () => { const b = armv$("arHdr"); if (b && !AR.on) b.click(); };      // the same switch as the header's Arm
armv$("armClose").onclick = () => { ARMV.dismissed = true; store.set("ar.armed", null); armvTick(); };
setInterval(armvTick, 1000); setInterval(armvLocks, 5000); armvLocks().then(armvTick);
