"use strict";
// Saved recordings (view): every session file that "Save session" or auto-record produces is also kept in this browser's own storage (IndexedDB),
// so a phone that blocks an unattended download loses nothing. The list offers Share (the phone's share sheet: mail, Drive, Quick Share...),
// Download, Open (load it into the replay) and Delete. Read-only for the Reader: nothing here touches detections. Loaded last, after reader-tools.js.
const RC = {db:null, failed:false, rows:[]};      // rows: what the list shows, kept in memory so a tap on Share needs no async read first (browsers want the share call right after the tap)
const rc$ = id => document.getElementById(id);
const rcEsc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
const rcSize = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB";
const rcOpen = () => RC.db ? Promise.resolve(RC.db) : new Promise((ok, no) => {
  if (RC.failed || typeof indexedDB === "undefined") return no(new Error("no storage"));
  const rq = indexedDB.open("sv-recordings", 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore("files", {keyPath:"name"});
  rq.onsuccess = () => { RC.db = rq.result; ok(RC.db); };
  rq.onerror = rq.onblocked = () => { RC.failed = true; no(rq.error || new Error("blocked")); };
});
const rcTx = (mode, fn) => rcOpen().then(db => new Promise((ok, no) => {
  const tx = db.transaction("files", mode), st = tx.objectStore("files"), r = fn(st);
  tx.oncomplete = () => ok(r && r.result); tx.onerror = tx.onabort = () => no(tx.error);
}));
// Keep a copy; resolves true if stored, false if the browser refused (private window, quota). Never throws: the download has already happened.
async function rcKeep(name, blob, meta) {
  try {
    await rcTx("readwrite", st => st.put({name, blob, size:blob.size, at:Date.now(), sym:(meta && meta.sym) || "", startedAt:(meta && meta.startedAt) || 0, quality:(meta && meta.quality) || null, run:(meta && meta.run) || null, seq:meta && meta.seq != null ? meta.seq : null, final:!!(meta && meta.final), why:(meta && meta.why) || "", rows:meta && meta.rows != null ? meta.rows : null, inputs:meta && meta.inputs != null ? meta.inputs : null}));
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}      // ask the browser not to evict it under storage pressure
    rcRender();
    return true;
  } catch { return false; }
}
const rcAll = () => rcTx("readonly", st => st.getAll()).then(a => (a || []).sort((x, y) => y.at - x.at));
const rcFile = r => new File([r.blob], r.name, {type:r.name.endsWith(".gz") ? "application/gzip" : "application/json"});
// Some browsers only share certain file types; try gzip, then a generic type, else report it cannot share.
function rcShareable(r) {
  if (!navigator.canShare || !navigator.share) return null;
  for (const type of [r.name.endsWith(".gz") ? "application/gzip" : "application/json", "application/octet-stream"]) {
    const f = new File([r.blob], r.name, {type});
    try { if (navigator.canShare({files:[f]})) return f; } catch {}
  }
  return null;
}
// Hours recorded: one row per day, one cell per hour (local clock), brighter = more of that hour recorded (OVERNIGHT.coverage).
function rcCoverage() {
  const box = rc$("cvBox"); if (!box) return;
  const days = +rc$("cvDays").value || 7, now = Date.now(), c = OVERNIGHT.coverage(RC.rows, now, days, -new Date(now).getTimezoneOffset() * 60000);
  const h = x => (Math.round(x * 10) / 10).toFixed(1), rowsHtml = [];
  for (let d = 0; d < days; d++) {
    const cells = c.slots.slice(d * 24, d * 24 + 24), day = new Date(cells[0].start + 1);
    rowsHtml.push(`<div style="display:flex;align-items:center;gap:6px"><span class="stat" style="width:84px;flex:none;white-space:nowrap">${day.toLocaleDateString([], {weekday:"short", day:"numeric", month:"numeric"})}</span><div style="display:grid;grid-template-columns:repeat(24,1fr);gap:2px;flex:1">`
      + cells.map(x => `<span title="${new Date(x.start).toLocaleString([], {weekday:"short", hour:"2-digit", minute:"2-digit"})}: ${Math.round(x.frac * 60)} min recorded" style="height:16px;border:1px solid ${x.frac ? "var(--buy)" : "var(--edge)"};background:${x.frac ? `color-mix(in srgb, var(--buy) ${Math.max(15, Math.round(x.frac * 100))}%, transparent)` : "transparent"}"></span>`).join("") + `</div></div>`);
  }
  box.innerHTML = `<div class="stat" style="margin-bottom:6px"><b>${h(c.last24)} h</b> in the last 24 h${days > 1 ? ` · <b>${h(c.hours)} h</b> in the last ${days} days` : ""}. Each cell is one hour, brighter = more of it recorded.</div>`
    + rowsHtml.join("") + `<div class="stat" style="margin-left:90px;display:flex;justify-content:space-between"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>`;
}
rc$("cvDays").onchange = rcCoverage;
async function rcRender() {
  const box = rc$("rcList"); if (!box) return;
  let rows;
  try { rows = RC.rows = await rcAll(); rcCoverage(); } catch { RC.rows = []; box.innerHTML = `<div class="note">This browser would not give the app storage, so recordings are only downloaded (private window?).</div>`; return; }
  if (!rows.length) { box.innerHTML = `<div class="note">Nothing kept yet. Chunks of a continuous recording are kept here for 24 hours; a recording is also kept when you press Save session.</div>`; return; }
  const rowHtml = r => {
    const when = new Date(r.at).toLocaleString(), can = !!rcShareable(r);
    return `<div class="rv-row" data-rc="${encodeURIComponent(r.name)}"><div class="grow"><b>${rcEsc(r.name)}</b><div class="stat">${rcSize(r.size)} · kept ${when}${r.quality ? ` · <span style="${SQ.clean(r.quality) ? "" : "color:var(--warn)"}">${rcEsc(SQ.line(r.quality))}</span>` : ""}</div></div>`
      + (can ? `<button data-rcact="share">Share</button>` : "") + `<button data-rcact="dl">Download</button><button data-rcact="open">Open</button><button data-rcact="del">Delete</button></div>`;
  };
  // chunks are grouped by run (newest run first); a recording made by hand has no run and is listed alone
  const runs = new Map(), singles = [];
  for (const r of rows) { if (r.run) { if (!runs.has(r.run)) runs.set(r.run, []); runs.get(r.run).push(r); } else singles.push(r); }
  const groups = [...runs.entries()].map(([id, a]) => { a.sort((x, y) => x.seq - y.seq); return {id, a, at:Math.max(...a.map(x => x.at))}; }).sort((x, y) => y.at - x.at);
  let html = groups.map(g => {
    const seqs = g.a.map(x => x.seq), holes = []; for (let i = seqs[0]; i <= seqs[seqs.length - 1]; i++) if (!seqs.includes(i)) holes.push(i);
    const last = g.a[g.a.length - 1], size = g.a.reduce((n, x) => n + x.size, 0), inputs = g.a.reduce((n, x) => n + (x.inputs || 0), 0), cut = g.a.some(x => x.cutShort), startsLate = seqs[0] > 0;
    const flags = [last.final ? "ended cleanly" : cut ? "cut short (the page closed or reloaded)" : "running or ended without a closing chunk", holes.length ? "missing here: chunk " + holes.join(", ") : "", startsLate ? "starts at chunk " + seqs[0] + " (earlier ones are older than 24 hours or deleted)" : ""].filter(Boolean);
    return `<details class="rv-run" open><summary><b>Run ${rcEsc(g.id)}</b> · ${g.a.length} chunk${g.a.length === 1 ? "" : "s"} · ${inputs.toLocaleString()} inputs · ${rcSize(size)} · ${rcEsc(flags.join(" · "))}</summary>${g.a.map(rowHtml).join("")}</details>`;
  }).join("");
  html += singles.map(rowHtml).join("");
  box.innerHTML = html + `<div class="note">${navigator.canShare ? "Share opens this device's share sheet (mail, Drive, Quick Share...)." : "This browser has no share sheet: use Download."} Chunks of a continuous recording are deleted from this browser after 24 hours (the save folder keeps all of them; without a folder, nothing older than 24 hours exists). Recordings saved by hand stay until you delete them.</div>`;
}
rc$("rcList").onclick = async e => {
  const b = e.target.closest("button[data-rcact]"); if (!b) return;
  const name = decodeURIComponent(b.closest("[data-rc]").dataset.rc), act = b.dataset.rcact;
  const r = RC.rows.find(x => x.name === name); if (!r) return rcRender();
  try {
    if (act === "share") { const f = rcShareable(r); if (f) await navigator.share({files:[f], title:r.name}); }
    else if (act === "dl") rtDownload(r.blob, r.name);
    else if (act === "open") { rtSetSession(await rtReadSessionFile(rcFile(r))); rtMsg(`Loaded ${r.name}. Replay it under Review, Replay and labels.`); }
    else if (act === "del") { await rcTx("readwrite", st => st.delete(name)); rcRender(); }
  } catch (err) { if (!err || err.name !== "AbortError") rtMsg("Could not do that: " + (err && err.message || err)); }      // AbortError = the share sheet was closed
};
rcRender();
