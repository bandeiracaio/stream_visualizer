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
  let folder = null;      // folder-save.js is loaded before this file; without it (or in a browser that cannot save into a folder) there is no folder chip
  if (typeof FS !== "undefined" && FS.supported) { const last = FS.log[0]; folder = !FS.dir ? {state:"none"} : FS.perm !== "granted" ? {state:"denied"} : last && !last.ok ? {state:"failed", err:last.err} : {state:"ok"}; }
  let cr = null; try { if (typeof rrState === "function") { const q = rrState(); cr = {on:q.on && q.running, seq:q.seq, ms:q.ms, fail:q.fail, err:q.err, wake:q.wake}; } } catch {}      // continuous recording (run-record.js)
  return {connected, paused:false, online:navigator.onLine, venues, cr, kept:typeof RC !== "undefined" ? RC.rows.length : 0, folder};
}
// phone header: a venue pill shows a coloured dot instead of its long text (styles.css); the state is classified here, the full text stays in the title
function sbPills() {
  for (const [id, tag] of [["bnState", "BN"], ["hlState", "HL"]]) {
    const b = sb$(id), p = b && b.parentElement; if (!p) continue;
    const t = b.textContent.trim(), m = /^(\d+)\/(\d+) sockets$/.exec(t);
    const st = t === "off" ? "off" : m ? (m[1] === m[2] ? "ok" : "warn") : t === "connected" || t === "REST only" ? "ok" : /fail|blocked/.test(t) ? "bad" : "warn";
    if (p.dataset.st !== st) p.dataset.st = st;
    if (p.title !== tag + " " + t) p.title = tag + " " + t;
  }
}
function sbRender() {
  try { sbPills(); } catch {}
  let html = "";
  try { html = STATUS.chips(sbSnapshot()).map(c => `<span class="chip sb-${c.tone}" title="${c.title.replace(/"/g, "&quot;")}">${c.text}</span>`).join(""); } catch {}
  const el = sb$("liveChips"); if (el && el.innerHTML !== html) el.innerHTML = html;
  const pc = sb$("stChips"); if (pc && pc.innerHTML !== html) pc.innerHTML = html;
  const btn = sb$("stBtn");      // the status button shows only what needs attention: bad beats warn, info chips (armed, saved) stay in the panel
  if (btn) { let lvl = "", n = 0; try { for (const c of STATUS.chips(sbSnapshot())) if (c.tone === "bad" || c.tone === "warn") { n++; if (c.tone === "bad" || !lvl) lvl = c.tone; } } catch {} if (btn.dataset.alert !== lvl) btn.dataset.alert = lvl; if (btn.dataset.n !== String(n || "")) btn.dataset.n = n || ""; }
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
  const busy = connected && typeof RR !== "undefined" && RR.on;
  if (busy && sb$("updBtn").textContent === "Reload") { sb$("updBtn").textContent = "Reload anyway (the chunk being recorded is lost)"; return; }
  location.replace(location.pathname + "?v=" + SB.latest);   // a new query string skips the cached copy of the page
};
sb$("updClose").onclick = () => { sb$("updBar").hidden = true; };
if (APP_VERSION !== "dev") {
  setTimeout(sbCheckVersion, 3000); setInterval(sbCheckVersion, 600000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sbCheckVersion(); });
}
// the browser can take back the folder permission without telling the page: while the page is recording, ask it again every 30 s so the chip shows it before a save fails
setInterval(() => { if (typeof fsQuery === "function" && typeof FS !== "undefined" && FS.dir && typeof RR !== "undefined" && RR.on && connected) fsQuery().catch(() => {}); }, 30000);
setInterval(sbRender, 1000); sbRender();
