"use strict";
// Overnight run (view, Now > Arm mode): "Ready to arm?" (a checklist before you leave) and "Last night" (what the saved recordings of the last hours look like).
// The decisions are in overnight-core.js (pure, self-tested). Read-only: it looks at state owned by other files (like arm-mode.js, which it extends) and changes nothing
// except by the button Open (loads a recording into the replay).
// Loaded after arm-mode.js. Spec: .scratch/overnight/spec.md.
const ON = {hours:24, busy:false, battery:null, persisted:null};
const on$ = id => document.getElementById(id);
try { if (navigator.getBattery) navigator.getBattery().then(b => { ON.battery = b; }).catch(() => {}); } catch {}
const onPersist = () => { try { if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(v => { ON.persisted = v; }).catch(() => {}); } catch {} };
onPersist(); setInterval(onPersist, 60000);

function onEnv() {
  const now = Date.now(), fs = typeof FS !== "undefined" && FS.supported;
  const cols = typeof COLLECT !== "undefined" && typeof CL !== "undefined" ? amTry(() => COLLECT.REGISTRY.map(c => { const s = CL.stat[c.id]; return {c, h:COLLECT.health({on:colOn(c.id), why:colWhy(c.id), n:s ? s.n : 0, ageMs:s && s.last ? now - s.last : null, expectMs:COLLECT.EXPECT_MS[c.id], sinceMs:now - CL.t0})}; }), null) : null;
  return {
    online:navigator.onLine, newer:typeof SB !== "undefined" && SB.latest && STATUS.newer(APP_VERSION, SB.latest) ? SB.latest : null,
    connected:!!connected, armed:!!AR.on, hidden:document.hidden, wakeLockApi:!!(navigator.wakeLock),
    folder:fs ? {supported:true, state:!FS.dir ? "none" : FS.perm !== "granted" ? "denied" : FS.log.length && !FS.log[0].ok ? "failed" : "ok", name:FS.name} : null,
    disk:typeof DW !== "undefined" ? amTry(() => DW.assess(), null) : null, persisted:ON.persisted,
    battery:ON.battery ? {charging:!!ON.battery.charging, level:ON.battery.level} : null,
    collectors:cols ? {expected:cols.filter(r => r.h.tone !== "off").length, active:cols.filter(r => r.h.tone === "ok").length, slow:cols.filter(r => r.h.tone === "warn").map(r => amShort(r.c.label))} : null,
  };
}
function onPre() {
  const r = OVERNIGHT.preflight(onEnv());
  return `<div class="am-alert am-a-${r.ready ? "ok" : r.bad ? "bad" : "warn"}">${amDot(r.ready ? "ok" : r.bad ? "bad" : "warn")}<b>${r.ready ? "Ready to arm" : r.text}</b></div>`
    + r.items.map(i => `<div class="am-kv"><span>${amDot(i.tone)}${amEsc(i.text)}</span><b class="${i.fix ? "am-t-" + (i.tone === "bad" ? "bad" : "warn") : ""}">${amEsc(i.fix)}</b></div>`).join("")
    + `<div class="note">Not checked: Chrome's Memory Saver can freeze a hidden tab (chrome://settings/performance, turn it off or add this site), and the computer's own sleep settings.</div>`;
}
function onMorning() {
  const m = OVERNIGHT.morning(typeof RC !== "undefined" ? RC.rows : [], amTry(() => HL.ev, []), Date.now(), {hours:ON.hours}, SQ);
  if (!m.n) return `<div class="note">No recordings were saved in the last ${m.hours} hours.</div>`;
  let h = `<div class="am-alert am-a-${m.tones.bad ? "bad" : m.tones.warn || m.tones.info ? "warn" : "ok"}">${amDot(m.tones.bad ? "bad" : m.tones.warn || m.tones.info ? "warn" : "ok")}<b>${m.n} recording${m.n === 1 ? "" : "s"}, ${amSize(m.bytes)}</b> · ${m.tones.ok} clean${m.tones.warn ? `, ${m.tones.warn} with holes` : ""}${m.tones.bad ? `, ${m.tones.bad} hollow or empty` : ""}${m.tones.info ? `, ${m.tones.info} without quality information` : ""}</div>`;
  if (m.collectorProblems.length) h += amRow("Collectors with holes", m.collectorProblems.map(c => `${amEsc(c.id)} (${c.recordings})`).join(", "), "warn");
  if (m.notes.length) h += amRow("Health log notes", m.notes.map(n => `${amEsc(n.k)} ×${n.n}`).join(", "), "warn");
  h += m.recs.slice().reverse().map(r => {
    return `<div class="am-ep" data-onrec="${encodeURIComponent(r.name)}">${amDot(r.tone)}<b>${amClock(r.at)}</b> ${amEsc(r.name)} · ${amSize(r.size)} · ${amEsc(r.line)} <button data-onact="open">Open</button></div>`; }).join("");
  return h;
}
function onRender() {
  if (tab !== "armmode") return;
  amSet("amPre", amTry(onPre, ""));
  amSet("amMorning", amTry(onMorning, ""));
}
on$("onHours").onchange = e => { ON.hours = +e.target.value || 24; onRender(); };
on$("amMorning").onclick = async e => {
  const b = e.target.closest("button[data-onact]"); if (!b) return;
  const name = decodeURIComponent(b.closest("[data-onrec]").dataset.onrec), r = RC.rows.find(x => x.name === name); if (!r) return;
  try { rtSetSession(await rtReadSessionFile(rcFile(r))); rtMsg(`Loaded ${r.name}. Press Replay.`); setTab("replay"); }
  catch (err) { on$("onStatus").textContent = "Could not open it: " + (err && err.message || err); }
};
setInterval(onRender, 1000); onRender();
