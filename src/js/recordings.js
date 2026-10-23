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
    await rcTx("readwrite", st => st.put({name, blob, size:blob.size, at:Date.now(), sym:(meta && meta.sym) || "", startedAt:(meta && meta.startedAt) || 0, quality:(meta && meta.quality) || null}));
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
async function rcRender() {
  const box = rc$("rcList"); if (!box) return;
  let rows;
  try { rows = RC.rows = await rcAll(); } catch { RC.rows = []; box.innerHTML = `<div class="note">This browser would not give the app storage, so recordings are only downloaded (private window?).</div>`; return; }
  if (!rows.length) { box.innerHTML = `<div class="note">Nothing kept yet. A recording is kept here when you press Save session or when auto-record finishes.</div>`; return; }
  box.innerHTML = rows.map(r => {
    const when = new Date(r.at).toLocaleString(), can = !!rcShareable(r);
    return `<div class="rv-row" data-rc="${encodeURIComponent(r.name)}"><div class="grow"><b>${rcEsc(r.name)}</b><div class="stat">${rcSize(r.size)} · kept ${when}${r.quality ? ` · <span style="${r.quality.verdict === "complete" ? "" : "color:var(--warn)"}">${rcEsc(SQ.line(r.quality))}</span>` : ""}</div></div>`
      + (can ? `<button data-rcact="share">Share</button>` : "") + `<button data-rcact="dl">Download</button><button data-rcact="open">Open</button><button data-rcact="del">Delete</button></div>`;
  }).join("") + `<div class="note">${navigator.canShare ? "Share opens this device's share sheet (mail, Drive, Quick Share...)." : "This browser has no share sheet: use Download."} Recordings stay here until you delete them.</div>`;
}
rc$("rcList").onclick = async e => {
  const b = e.target.closest("button[data-rcact]"); if (!b) return;
  const name = decodeURIComponent(b.closest("[data-rc]").dataset.rc), act = b.dataset.rcact;
  const r = RC.rows.find(x => x.name === name); if (!r) return rcRender();
  try {
    if (act === "share") { const f = rcShareable(r); if (f) await navigator.share({files:[f], title:r.name}); }
    else if (act === "dl") rtDownload(r.blob, r.name);
    else if (act === "open") { rtSetSession(await rtReadSessionFile(rcFile(r))); rtMsg(`Loaded ${r.name}. Replay it from here.`); }
    else if (act === "del") { await rcTx("readwrite", st => st.delete(name)); rcRender(); }
  } catch (err) { if (!err || err.name !== "AbortError") rtMsg("Could not do that: " + (err && err.message || err)); }      // AbortError = the share sheet was closed
};
rcRender();
