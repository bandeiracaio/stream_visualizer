"use strict";
// Header status (view): live chips next to Connect/Pause and the BN/HL pills (STATUS.chips, status-core.js), and the "newer version" bar.
// Read-only: it only looks at the app's state once a second and never changes a feed, a recording or a detection. Loaded last.
const APP_VERSION = "__APP_VERSION__";            // "vNNN" in a release build, "dev" otherwise (build.mjs stamps it)
const SB = {latest:null, sure:false, timer:null};
const sb$ = id => document.getElementById(id);
sb$("ver").textContent = APP_VERSION;           // tiny version tag next to the title

function sbSnapshot() {
  const now = Date.now(), venues = {};
  for (const v of ["bn", "hl"]) {
    const on = Object.values(S).filter(s => s.def.v === v && s.on), last = Math.max(0, ...on.map(s => s.last));
    venues[v] = {on:on.length > 0, ageMs:last ? now - last : null, rate:on.reduce((a, s) => a + s.rates.slice(-3).reduce((x, y) => x + y, 0) / 3, 0)};
  }
  const ar = AR.on ? {on:true, ready:!!(AR.v && AR.v.ready), learnMin:AR.v ? Math.round(AR.v.nSlow / 60) : 0, mode:AR.st && AR.st.mode, wake:!!AR.lock, runs:AR.runs, cooldownMin:AR.st && AR.st.until > now ? Math.ceil((AR.st.until - now) / 60000) : 0} : {on:false};
  const rec = RT.rec ? {on:true, ms:now - RT.rec.t0, n:READER.recording().n} : {on:false};
  return {connected, paused, online:navigator.onLine, venues, ar, rec, kept:typeof RC !== "undefined" ? RC.rows.length : 0};
}
function sbRender() {
  let html = "";
  try { html = STATUS.chips(sbSnapshot()).map(c => `<span class="chip sb-${c.tone}" title="${c.title.replace(/"/g, "&quot;")}">${c.text}</span>`).join(""); } catch {}
  const el = sb$("liveChips"); if (el && el.innerHTML !== html) el.innerHTML = html;
}
async function sbCheckVersion() {
  try {
    const r = await fetch("version.json?t=" + Date.now(), {cache:"no-store"});
    if (!r.ok) return;
    const j = await r.json(), bar = sb$("updBar");
    if (j && STATUS.newer(APP_VERSION, j.version)) {
      SB.latest = j.version; SB.sure = false;
      sb$("updText").textContent = `A newer version (${j.version}) is available. You are on ${APP_VERSION}.`;
      sb$("updBtn").textContent = "Reload"; bar.hidden = false;
    } else bar.hidden = true;
  } catch {}                                       // offline, or served without a version.json (local copy): no banner
}
sb$("updBtn").onclick = () => {
  const busy = AR.on || RT.rec;
  if (busy && sb$("updBtn").textContent === "Reload") { sb$("updBtn").textContent = AR.on ? "Reload anyway (ends the wait)" : "Reload anyway (loses the recording)"; return; }
  location.replace(location.pathname + "?v=" + SB.latest);   // a new query string skips the cached copy of the page
};
sb$("updClose").onclick = () => { sb$("updBar").hidden = true; };
if (APP_VERSION !== "dev") {
  setTimeout(sbCheckVersion, 3000); setInterval(sbCheckVersion, 600000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sbCheckVersion(); });
}
setInterval(sbRender, 1000); sbRender();
