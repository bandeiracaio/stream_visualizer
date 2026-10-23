"use strict";
// Collectors (view): samples that no detector uses yet, kept on a rolling 24 h tape (IndexedDB "sv-tape") and attached to every saved session
// as `ext`. This file runs the page-side collector (self-telemetry of the page's own feeds), receives the worker's records, owns the tape and the
// switches. Read-only: it only looks at the app's state and never touches a feed, a recording or a detection. Loaded after health-log.js.
const CL = {cfg:store.get("col.cfg", {}) || {}, db:null, prev:null, prevAt:0, adds:0, count:0};
const cl$ = id => document.getElementById(id);
const colOn = id => CL.cfg[id] != null ? !!CL.cfg[id] : (COLLECT.REGISTRY.find(x => x.id === id) || {on:false}).on;
const colWorkerCfg = () => ({telemetry:colOn("telemetry")});

const colOpen = () => CL.db ? Promise.resolve(CL.db) : new Promise((ok, no) => {
  if (typeof indexedDB === "undefined") return no(new Error("no storage"));
  const rq = indexedDB.open("sv-tape", 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore("c", {autoIncrement:true});
  rq.onsuccess = () => { CL.db = rq.result; ok(CL.db); };
  rq.onerror = rq.onblocked = () => no(rq.error || new Error("blocked"));
});
const colReq = (mode, fn) => colOpen().then(db => new Promise((ok, no) => {
  const tx = db.transaction("c", mode), st = tx.objectStore("c"), r = fn(st);
  tx.oncomplete = () => ok(r && r.result); tx.onerror = tx.onabort = () => no(tx.error);
}));
async function colAdd(r) {
  if (!COLLECT.isRec(r)) return;
  try { await colReq("readwrite", st => st.add(r)); CL.count++; if (++CL.adds % 360 === 0) colPrune(); colRender(); } catch {}      // a full or blocked store only costs the tape, never the app
}
const colAll = () => colReq("readonly", st => st.getAll()).then(a => a || []);
async function colPrune() {
  try {
    const cutoff = Date.now() - COLLECT.TAPE_MS;
    await colReq("readwrite", st => { const rq = st.openCursor(); rq.onsuccess = () => { const c = rq.result; if (c && c.value[2] < cutoff) { c.delete(); c.continue(); } }; return rq; });
    CL.count = (await colAll()).length; colRender();
  } catch {}
}
// the records for a session that started at t0 (a minute before it, so the lead-in is there), newest within the file budget
async function colSlice(t0) {
  try { return COLLECT.fit(COLLECT.slice(await colAll(), (t0 || 0) - 60000, Date.now())); } catch { return []; }
}

// ---- the page's own feeds, every 10 s while connected
function colSample() {
  if (!colOn("telemetry") || !connected) { CL.prev = null; return; }
  const now = Date.now(), snap = {};
  for (const id in S) { const s = S[id]; if (s.total) snap[id] = {total:s.total, bytes:s.bytes, late:s.late, last:s.last, maxLat:s.maxLat, lats:s.lats.slice(-120)}; }
  const dt = CL.prev ? now - CL.prevAt : 0;
  if (CL.prev) colAdd(COLLECT.rec("feeds", now, {src:"page", dtMs:dt, vis:document.visibilityState, clockOffset:typeof clockOffset === "number" ? Math.round(clockOffset) : null, reconnects:{bn:health.bnReconnects, hl:health.hlReconnects}, feeds:COLLECT.feeds(CL.prev, snap, now, dt)}));
  CL.prev = snap; CL.prevAt = now;
}
setInterval(colSample, 10000);

// ---- the always-on worker (collectors-worker.js): derivatives context and calendar tags. It runs whether or not auto-record is armed, in a worker so a hidden tab
// does not slow it. Its records come here and go onto the tape; a record posted while the page is frozen is written when the page thaws.
function colWorkerSync() {
  const sym = cl$("sym").value.trim().toLowerCase(), wants = {derivs:colOn("derivs"), calendar:colOn("calendar")}, key = sym + "|" + wants.derivs + "|" + wants.calendar;
  const want = (wants.derivs || wants.calendar) && !!sym;
  if (CL.worker && (!want || CL.workerKey !== key)) { try { CL.worker.postMessage({t:"stop"}); CL.worker.terminate(); } catch {} CL.worker = null; }
  if (!want || CL.worker) return;
  let w;
  try { const u = URL.createObjectURL(new Blob([cl$("colWorkerSrc").textContent], {type:"text/javascript"})); w = new Worker(u); URL.revokeObjectURL(u); }
  catch (e) { hlNote("collector worker failed", {err:String(e && e.message || e)}); return; }
  CL.worker = w; CL.workerKey = key;
  w.onmessage = ev => { if (w !== CL.worker) return; const m = ev.data; if (m.t === "col") colAdd(m.rec); else if (m.t === "note") hlNote(m.k, m.d); };
  w.onerror = () => { if (w !== CL.worker) return; CL.worker = null; try { w.terminate(); } catch {} hlNote("collector worker failed", {err:"stopped on an error"}); };      // no retry loop: reload the page
  w.postMessage({t:"start", sym, want:wants});
}
cl$("sym").addEventListener("change", colWorkerSync);

// ---- the list under the Health log
function colRender() {
  const box = cl$("colList"); if (!box) return;
  cl$("colSum").textContent = `Collectors: ${CL.count} records on the tape`;
  box.innerHTML = COLLECT.REGISTRY.map(c => `<label class="stat" style="display:block"><input type="checkbox" data-col="${c.id}"${colOn(c.id) ? " checked" : ""}> ${c.label}</label>`).join("");
}
cl$("colList").onchange = e => { const id = e.target.dataset && e.target.dataset.col; if (!id) return; CL.cfg[id] = e.target.checked; store.set("col.cfg", CL.cfg); colWorkerSync(); if (AR.on && AR.worker) AR.worker.postMessage({t:"cfg", cfg:Object.assign({}, AR.cfg, {collectors:colWorkerCfg()})}); };
cl$("colSave").onclick = async () => {
  const text = JSON.stringify({kind:"sv-tape", v:1, version:APP_VERSION, at:Date.now(), records:await colAll()});
  rtDownload(new Blob([text], {type:"application/json"}), "tape_" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".json");
};
cl$("colClear").onclick = async () => { try { await colReq("readwrite", st => st.clear()); CL.count = 0; } catch {} colRender(); };
colAll().then(a => { CL.count = a.length; colRender(); colPrune(); }, () => colRender());
colRender();
colWorkerSync();
