"use strict";
// Save folder (view): on a browser with the File System Access API (desktop Chrome / Edge) the user picks one folder once and every session file
// ("Save session" and auto-record) is written straight into it, with no download prompt. The folder handle is remembered in IndexedDB; after a
// restart the browser may ask to allow it again (one click on "Allow"). Without a folder, or if a write fails, the file is downloaded as before.
// The panel at the top of Recordings > Saved shows what was written this session. Read-only for the Reader: nothing here touches detections.
// Loaded after recordings.js; reader-tools.js calls fsSave() when it saves a session.
const FS = {dir:null, name:"", perm:"none", log:[], listing:null, supported:typeof window.showDirectoryPicker === "function", db:null};      // perm: none | granted | prompt | unsupported
const fs$ = id => document.getElementById(id);
const fsEsc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
const fsSize = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB";
const fsClock = t => new Date(t).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
const fsHandleDb = () => FS.db ? Promise.resolve(FS.db) : new Promise((ok, no) => {
  if (typeof indexedDB === "undefined") return no(new Error("no storage"));
  const rq = indexedDB.open("sv-folder", 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
  rq.onsuccess = () => { FS.db = rq.result; ok(FS.db); };
  rq.onerror = rq.onblocked = () => no(rq.error || new Error("blocked"));
});
const fsKv = (mode, fn) => fsHandleDb().then(db => new Promise((ok, no) => {
  const tx = db.transaction("kv", mode), r = fn(tx.objectStore("kv"));
  tx.oncomplete = () => ok(r && r.result); tx.onerror = tx.onabort = () => no(tx.error);
}));
async function fsQuery() {
  if (!FS.dir) { FS.perm = FS.supported ? "none" : "unsupported"; return; }
  try { FS.perm = (await FS.dir.queryPermission({mode:"readwrite"})) === "granted" ? "granted" : "prompt"; } catch { FS.perm = "prompt"; }
}
async function fsPick() {
  try {
    const h = await window.showDirectoryPicker({id:"sv-recordings", mode:"readwrite", startIn:"documents"});
    FS.dir = h; FS.name = h.name; FS.listing = null;
    try { await fsKv("readwrite", st => st.put(h, "dir")); } catch {}
    await fsQuery(); fsRender();
    rtMsg(`Recordings will be saved into the folder "${h.name}".`);
  } catch (err) { if (!err || err.name !== "AbortError") rtMsg("Could not use that folder: " + (err && err.message || err)); }
}
async function fsAllow() {
  if (!FS.dir) return;
  try { FS.perm = (await FS.dir.requestPermission({mode:"readwrite"})) === "granted" ? "granted" : "prompt"; } catch { FS.perm = "prompt"; }
  fsRender();
}
async function fsForget() {
  FS.dir = null; FS.name = ""; FS.listing = null; FS.perm = FS.supported ? "none" : "unsupported";
  try { await fsKv("readwrite", st => st.delete("dir")); } catch {}
  fsRender();
}
const fsReady = () => !!(FS.dir && FS.perm === "granted");
// A name that does not overwrite an earlier file (two saves in the same minute share a stamp).
async function fsFreeName(name) {
  const dot = name.indexOf("."), stem = dot < 0 ? name : name.slice(0, dot), ext = dot < 0 ? "" : name.slice(dot);
  for (let i = 1; i < 100; i++) {
    const n = i === 1 ? name : `${stem}-${i}${ext}`;
    try { await FS.dir.getFileHandle(n); } catch (e) { if (e && e.name === "NotFoundError") return n; throw e; }
  }
  return `${stem}-${Date.now()}${ext}`;
}
// Write one file into the chosen folder. Resolves true if it is there. Resolves false (never throws) if no folder is set or the write failed,
// so the caller downloads it instead; a failure with a folder set is recorded in the list and the Health log.
async function fsSave(name, blob) {
  if (!FS.dir) return false;
  const row = {name, size:blob.size, at:Date.now(), ok:false, err:""};
  FS.log.unshift(row); FS.log.length = Math.min(FS.log.length, 200);
  try {
    if (FS.perm !== "granted") { await fsQuery(); if (FS.perm !== "granted") throw new Error("folder access needs your OK (open Recordings, Saved, Allow)"); }
    const n = await fsFreeName(name), w = await (await FS.dir.getFileHandle(n, {create:true})).createWritable();
    try { await w.write(blob); } finally { await w.close(); }
    row.name = n; row.ok = true; FS.listing = null;
    fsRender(); return true;
  } catch (err) {
    row.err = (err && err.message) || String(err);
    if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) FS.perm = "prompt";
    try { if (typeof hlNote === "function") hlNote("folder-write-failed", row.err); } catch {}
    fsRender(); return false;
  }
}
async function fsList() {
  if (!fsReady()) return;
  const out = [];
  try {
    for await (const [n, h] of FS.dir.entries()) if (h.kind === "file" && /^session_.*\.json(\.gz)?$/.test(n)) { const f = await h.getFile(); out.push({name:n, size:f.size, at:f.lastModified}); }
    FS.listing = out.sort((a, b) => b.at - a.at).slice(0, 15);
  } catch (err) { FS.listing = []; rtMsg("Could not read the folder: " + (err && err.message || err)); }
  fsRender();
}
function fsRender() {
  const box = fs$("fsPanel"); if (!box) return;
  const ok = FS.log.filter(r => r.ok), bad = FS.log.filter(r => !r.ok), last = FS.log[0];
  let head, tone;
  if (!FS.supported) { head = "Folder saving is not available in this browser (it needs desktop Chrome or Edge). Recordings are downloaded and kept under Saved recordings below."; tone = "var(--dim)"; }
  else if (!FS.dir) { head = "No folder chosen: recordings are downloaded. Choose a folder once and every recording is written into it without asking."; tone = "var(--warn)"; }
  else if (FS.perm !== "granted") { head = `Folder "${fsEsc(FS.name)}" needs your OK again after the browser restarted: press Allow. Until then recordings are downloaded.`; tone = "var(--warn)"; }
  else if (last && !last.ok) { head = `The last save to "${fsEsc(FS.name)}" failed (${fsEsc(last.err)}); it was downloaded instead.`; tone = "var(--sell)"; }
  else { head = `Saving into "${fsEsc(FS.name)}". ${ok.length ? `${ok.length} file${ok.length === 1 ? "" : "s"} written this session, last at ${fsClock(ok[0].at)}.` : "Nothing written yet this session."}`; tone = "var(--buy)"; }
  const btns = !FS.supported ? "" : (FS.dir ? (FS.perm !== "granted" ? `<button data-fsact="allow">Allow</button>` : `<button data-fsact="list">List folder</button>`) + `<button data-fsact="pick">Change folder</button><button data-fsact="forget">Stop using folder</button>` : `<button data-fsact="pick">Choose folder</button>`);
  const rows = FS.log.length ? FS.log.slice(0, 30).map(r => `<div class="rv-row"><span style="color:${r.ok ? "var(--buy)" : "var(--sell)"};font-weight:700">${r.ok ? "WRITTEN" : "FAILED"}</span><div class="grow"><b>${fsEsc(r.name)}</b><div class="stat">${fsClock(r.at)} · ${fsSize(r.size)}${r.ok ? "" : ` · ${fsEsc(r.err)}`}</div></div></div>`).join("")
    + (bad.length ? `<div class="note">${bad.length} save${bad.length === 1 ? "" : "s"} failed this session and ${bad.length === 1 ? "was" : "were"} downloaded instead.</div>` : "") : (FS.dir ? `<div class="note">Files written this session will be listed here.</div>` : "");
  const listing = FS.listing ? `<h3 style="margin-top:10px">In the folder (newest 15)</h3>` + (FS.listing.length ? FS.listing.map(r => `<div class="rv-row"><div class="grow"><b>${fsEsc(r.name)}</b><div class="stat">${new Date(r.at).toLocaleString()} · ${fsSize(r.size)}</div></div></div>`).join("") : `<div class="note">No session files in the folder yet.</div>`) : "";
  box.innerHTML = `<div class="rv-row" style="border-left:3px solid ${tone};padding-left:10px"><div class="grow" style="color:var(--text)">${head}</div>${btns}</div>${rows}${listing}`;
}
fs$("fsPanel").onclick = e => {
  const b = e.target.closest("button[data-fsact]"); if (!b) return;
  ({pick:fsPick, allow:fsAllow, forget:fsForget, list:fsList})[b.dataset.fsact]();
};
(async () => {
  if (FS.supported) { try { FS.dir = await fsKv("readonly", st => st.get("dir")) || null; FS.name = FS.dir ? FS.dir.name : ""; } catch {} }
  await fsQuery(); fsRender();
  if (FS.perm === "granted") fsList();
})();
document.addEventListener("visibilitychange", () => { if (!document.hidden && FS.dir && FS.perm !== "granted") fsQuery().then(fsRender); });
