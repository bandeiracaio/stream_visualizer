"use strict";
// Overnight run (view, Now > Arm mode): "Ready to arm?" (a checklist before you leave) and "Last night" (what the saved recordings of the last hours look like).
// The decisions are in overnight-core.js (pure, self-tested). Read-only: it looks at state owned by other files (like arm-mode.js, which it extends) and changes nothing
// except by the buttons Open (loads a recording into the replay) and Count episodes to label (replays the window's recordings, same cache as the Scoreboard view).
// Loaded after arm-mode.js and scoreboard-view.js. Spec: .scratch/overnight/spec.md.
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
function onGroups(name) {      // groups of one recording and how many are not labelled yet, from the cache the Scoreboard view keeps (null = not replayed)
  const p = typeof SBV !== "undefined" && SBV.parts.get(name); if (!p) return null;
  const open = p.rows.filter(r => !sbvLabelFor(RT.labels, r.g)).length; return {n:p.rows.length, open};
}
function onMorning() {
  const m = OVERNIGHT.morning(typeof RC !== "undefined" ? RC.rows : [], amTry(() => HL.ev, []), Date.now(), {hours:ON.hours}, SQ);
  if (!m.n) return `<div class="note">No recordings were saved in the last ${m.hours} hours.</div>`;
  const tot = m.recs.map(r => onGroups(r.name)), counted = tot.filter(Boolean), toLabel = counted.reduce((a, g) => a + g.open, 0), groups = counted.reduce((a, g) => a + g.n, 0);
  let h = `<div class="am-alert am-a-${m.tones.bad ? "bad" : m.tones.warn || m.tones.info ? "warn" : "ok"}">${amDot(m.tones.bad ? "bad" : m.tones.warn || m.tones.info ? "warn" : "ok")}<b>${m.n} recording${m.n === 1 ? "" : "s"}, ${amSize(m.bytes)}</b> · ${m.tones.ok} clean${m.tones.warn ? `, ${m.tones.warn} with holes` : ""}${m.tones.bad ? `, ${m.tones.bad} hollow or empty` : ""}${m.tones.info ? `, ${m.tones.info} without quality information` : ""}</div>`;
  if (counted.length) h += amRow("Episodes found", `${groups} in ${counted.length} replayed recording${counted.length === 1 ? "" : "s"}`) + amRow("Not labelled yet", String(toLabel), toLabel ? "warn" : "ok");
  if (m.collectorProblems.length) h += amRow("Collectors with holes", m.collectorProblems.map(c => `${amEsc(c.id)} (${c.recordings})`).join(", "), "warn");
  if (m.notes.length) h += amRow("Health log notes", m.notes.map(n => `${amEsc(n.k)} ×${n.n}`).join(", "), "warn");
  h += m.recs.slice().reverse().map(r => { const g = onGroups(r.name);
    return `<div class="am-ep" data-onrec="${encodeURIComponent(r.name)}">${amDot(r.tone)}<b>${amClock(r.at)}</b> ${amEsc(r.name)} · ${amSize(r.size)} · ${amEsc(r.line)}${g ? ` · ${g.n} groups, <b class="${g.open ? "am-t-warn" : ""}">${g.open} to label</b>` : ""} <button data-onact="open">Open</button></div>`; }).join("");
  return h;
}
function onRender() {
  if (tab !== "armmode") return;
  amSet("amPre", amTry(onPre, ""));
  amSet("amMorning", amTry(onMorning, ""));
}
async function onCount() {
  if (ON.busy) return; ON.busy = true; const btn = on$("onCount"), st = on$("onStatus"); btn.disabled = true;
  try {
    const rows = await rcAll(), m = OVERNIGHT.morning(rows, [], Date.now(), {hours:ON.hours}, SQ), cfg = rtCfg(); RC.rows = rows;
    let i = 0; for (const rec of m.recs) {
      i++; const row = rows.find(r => r.name === rec.name); if (!row) continue;
      st.textContent = `Replaying ${i}/${m.recs.length}: ${rec.name}`; await new Promise(ok => setTimeout(ok, 30));
      try { await sbvPartFor(row, cfg); } catch (err) { st.textContent = `Skipped ${rec.name}: ${err && err.message || err}`; await new Promise(ok => setTimeout(ok, 1500)); }
    }
    st.textContent = `Done: ${m.recs.length} recording${m.recs.length === 1 ? "" : "s"} replayed with the current thresholds.`;
  } catch (err) { st.textContent = "Could not count: " + (err && err.message || err); }
  finally { ON.busy = false; btn.disabled = false; onRender(); }
}
on$("onCount").onclick = onCount;
on$("onHours").onchange = e => { ON.hours = +e.target.value || 24; onRender(); };
on$("amMorning").onclick = async e => {
  const b = e.target.closest("button[data-onact]"); if (!b) return;
  const name = decodeURIComponent(b.closest("[data-onrec]").dataset.onrec), r = RC.rows.find(x => x.name === name); if (!r) return;
  try { rtSetSession(await rtReadSessionFile(rcFile(r))); rtMsg(`Loaded ${r.name}. Press Replay, then label with the label queue.`); setTab("replay"); }
  catch (err) { on$("onStatus").textContent = "Could not open it: " + (err && err.message || err); }
};
setInterval(onRender, 1000); onRender();
