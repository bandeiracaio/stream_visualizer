"use strict";
// Continuous recording (Trader step 6a, page side). While connected the page records everything the engine consumes, in chunks (chunk-core.js: PIPE, made in feeds.js), and keeps each chunk: in the save folder if one
// is chosen (all of them) and in this browser's storage (the newest 24 hours; older copies are deleted). A run is what lies between two engine resets (connect, a change of asset, a page load) or a disconnect.
// Chunk files are session files (kind "sv-session") with the run, the chunk number and the paper runner's rows added, so `node design-harness.mjs --replay-run` can replay a run and compare its journal with the page's.
// Also here: the one switch (remembered), the reconnect after a reload, marking a run cut short, and the Web Lock and screen wake lock a connected page holds so a hidden tab is not frozen.
// Nothing here changes what the engine, the systems or the runner decide: it copies the inputs and the rows.
const RR = {on: store.get("recOn", true) !== false, id: null, sym: "", seqSaved: -1, saved: 0, bytes: 0, fail: 0, prevFailed: false, err: "", lastAt: 0, lastBytes: 0, lastMs: 0, lastStall: 0, worstStall: 0, q: Promise.resolve(), lock: null, unlock: null, wake: null, beganAt: 0, folderFail: false};
const rr$ = id => document.getElementById(id);
const RR_KEEP_MS = 86400000;      // the browser's own copies: the newest 24 hours
const rrPad = n => String(n).padStart(2, "0");
const rrStamp = d => d.getUTCFullYear() + rrPad(d.getUTCMonth() + 1) + rrPad(d.getUTCDate()) + rrPad(d.getUTCHours()) + rrPad(d.getUTCMinutes()) + rrPad(d.getUTCSeconds());
const rrCfgKey = () => { try { return JSON.stringify(rtCfg()); } catch { return ""; } };      // the engine's settings, read at a chunk's start and end: a change inside a chunk is written on it

// ----- a run begins and ends with the engine's resets (READER.reset, feeds.js)
function rrBeforeReset() { rrEnd(true, "reset"); }
function rrAfterReset() { if (connected) rrBegin(); }
function rrEnd(final, why) { trStop(); PIPE.end(final, why); RR.id = null; rrRender(); }      // the runner stops first (its closing rows are part of the chunk), then the chunk is closed
function rrBegin() {
  const sym = trAsset(), runner = trBegin(sym), now = Date.now(); RR.beganAt = now;
  if (!RR.on) { RR.id = null; rrRender(); return; }
  RR.id = rrStamp(new Date(now)); RR.sym = sym; RR.seqSaved = -1; RR.prevFailed = false;
  PIPE.begin({id: RR.id, sym: rt$("sym").value.trim().toUpperCase(), startedAt: now, lateMs: TF_LATE, engineCfg: (() => { try { return rtCfg(); } catch { return null; } })(),
    runner: {on: runner, cfg: TR_CFG, ids: SYSTEMS_DEFAULT.map(d => SYSTEM.id(d)), carry: TRN.driver ? TRN.driver.carry : []}});
  store.set("rr.last", {id: RR.id, seq: -1, final: false, at: now, cut: false}); rrRender();
}
function rrDisconnect() { rrEnd(true, "disconnect"); store.set("rr.was", false); rrRelease(); setTimeout(() => { if (typeof colRelay === "function") colRelay(); }, 0); }      // called by the Connect button before it disconnects
function rrConnected() { store.set("rr.was", true); rrHold(); if (typeof colRelay === "function") colRelay(); }      // ... and after it connects
function rrSetOn(on) {
  RR.on = !!on; store.set("recOn", RR.on);
  if (!connected) return rrRender();
  if (!RR.on) { hlNote("recording switched off", {run: RR.id}); PIPE.end(false, "switch"); RR.id = null; }
  else { READER.reset(); rdLastBook.bn = rdLastBook.hl = 0; hlNote("recording switched on: a new run begins, the Reader starts again"); }      // a recorded run starts from a new engine, so the replay can too
  rrRender();
}

// ----- keep the page alive while connected: a page holding a Web Lock is not frozen when hidden; the screen wake lock keeps the device awake
function rrHold() {
  try { if (navigator.locks && !RR.unlock) navigator.locks.request("sv-connected", {mode: "shared"}, () => new Promise(res => { RR.unlock = res; })); } catch {}
  rrWake();
}
async function rrWake() { try { if (connected && navigator.wakeLock && !RR.wake) { RR.wake = await navigator.wakeLock.request("screen"); RR.wake.onrelease = () => { RR.wake = null; }; } } catch {} }
function rrRelease() { if (RR.unlock) { RR.unlock(); RR.unlock = null; } try { if (RR.wake) RR.wake.release(); } catch {} RR.wake = null; }
document.addEventListener("visibilitychange", () => { if (connected && document.visibilityState === "visible") rrWake(); });      // the lock is dropped when the tab is hidden

// ----- saving a chunk (in order, off the input path)
function rrChunk(c) { RR.q = RR.q.then(() => rrSave(c)).catch(e => console.error("recorder", e)); rrRender(); }
async function rrSave(c) {
  const t0 = performance.now(); let ok = false;
  try {
    c.prevMissing = RR.prevFailed;
    const quality = SQ.of(c.inputs), health = typeof HL !== "undefined" ? HL.ev.filter(e => e.t >= (c.startedAt || 0) - 60000).slice(-60) : null;
    const ext = await colSlice(c.startedAt, 0);
    if (typeof colExpected === "function") { const q = SQ.collectors(ext, c.startedAt || 0, quality.t1, colExpected()); if (q) quality.collectors = q; }
    c.quality = quality; c.health = health; c.ext = ext;
    const text = JSON.stringify(c), gz = typeof CompressionStream !== "undefined", name = CHUNK.fileName(c, gz);
    const blob = gz ? await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob() : new Blob([text], {type: "application/json"});
    const inFolder = FS.dir ? await fsSave(name, blob) : null;      // null: no folder chosen, so only the browser keeps it (a download for every chunk would be a flood)
    const kept = await rcKeep(name, blob, {sym: c.sym, startedAt: c.startedAt, quality, run: c.run, seq: c.seq, final: c.final, why: c.why, rows: c.rows.length, inputs: c.inputs.length});
    RR.folderFail = inFolder === false;
    ok = kept || inFolder === true;
    RR.lastAt = Date.now(); RR.lastBytes = blob.size; RR.bytes += blob.size; if (ok) RR.saved++;
    if (!kept && inFolder !== true) throw new Error("neither the folder nor the browser's storage took the file");
    store.set("rr.last", {id: c.run, seq: c.seq, final: c.final, at: Date.now(), cut: false});
    rrPrune();
  } catch (e) {
    RR.fail++; RR.err = (e && e.message) || String(e);
    try { hlNote("chunk save failed", {run: c.run, seq: c.seq, why: RR.err}); } catch {}
  }
  RR.prevFailed = !ok; RR.lastMs = Math.round(performance.now() - t0); rrRender();
}
// the browser's copies of chunks older than 24 hours are deleted (the save folder is never touched); hand-made recordings stay
async function rrPrune() {
  try { const rows = await rcAll(), old = rows.filter(r => r.run && r.at < Date.now() - RR_KEEP_MS); for (const r of old) await rcTx("readwrite", st => st.delete(r.name)); if (old.length) rcRender(); } catch {}
}
setInterval(rrPrune, 3600000);

// ----- after a reload: a run that did not end cleanly is marked cut short in its last stored chunk; a page that was connected connects again by itself
async function rrAfterLoad() {
  const last = store.get("rr.last", null), was = store.get("rr.was", false);
  try {
    if (last && !last.final && !last.cut && last.seq >= 0) {
      const rows = (await rcAll()).filter(r => r.run === last.id).sort((a, b) => b.seq - a.seq), r = rows[0];
      if (r && !r.final) {
        const buf = new Uint8Array(await r.blob.arrayBuffer()), text = buf[0] === 0x1f ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text() : new TextDecoder().decode(buf), o = JSON.parse(text);
        o.cutShort = true; const t = JSON.stringify(o), blob = buf[0] === 0x1f ? await new Response(new Blob([t]).stream().pipeThrough(new CompressionStream("gzip"))).blob() : new Blob([t], {type: "application/json"});
        await rcTx("readwrite", st => st.put(Object.assign({}, r, {blob, size: blob.size, cutShort: true})));
      }
      store.set("rr.last", Object.assign({}, last, {cut: true})); hlNote("run cut short", {run: last.id, lastChunk: last.seq});
    }
  } catch (e) { console.error("recorder", e); }
  if (was && RR.on) {
    try { await TRN.ready; } catch {}
    if (!connected) { hlNote("connecting again after a reload (it was connected when it closed)", {run: last && last.id}); rt$("go").click(); }
  }
}

// ----- the Recordings view's panel and the status chip
function rrState() {
  const s = PIPE.state();
  return {on: RR.on, running: !!s, id: RR.id, seq: s ? s.seq : null, n: s ? s.n : 0, ms: s && s.t0 && s.t1 ? s.t1 - s.t0 : 0, saved: RR.saved, fail: RR.fail, err: RR.err, lastAt: RR.lastAt, folder: FS.dir ? (RR.folderFail ? "failed" : "ok") : "none", wake: !!RR.wake};
}
function rrRender() {
  const box = rr$("rrStat"); if (!box) return;
  rr$("rrOn").checked = RR.on;
  const s = rrState(), mb = b => (b / 1048576).toFixed(1) + " MB";
  let t;
  if (!RR.on) t = "Recording is off: nothing is recorded and a replay of this session is not possible.";
  else if (!connected) t = "Connect to start recording. A run begins at connect and ends at disconnect.";
  else if (!s.running) t = "Connected, but no run is being recorded yet.";
  else t = `Run ${s.id}, chunk ${s.seq}: ${s.n.toLocaleString()} inputs so far (${rtDur(s.ms)} of 30 min). ${RR.saved} chunk${RR.saved === 1 ? "" : "s"} saved this page${RR.lastAt ? ", last " + mb(RR.lastBytes) + " at " + new Date(RR.lastAt).toLocaleTimeString() + ", saved in " + RR.lastMs + " ms" : ""}.`;
  if (RR.fail) t += ` ${RR.fail} chunk save${RR.fail === 1 ? "" : "s"} failed (${RR.err}); the run goes on and the next chunk says the previous one is missing.`;
  box.textContent = t;
}
// one short line for the Trader home: is the page recording, which chunk, did a save fail
function rrShort() {
  if (!RR.on) return "Recording: off.";
  if (!connected) return "Recording: not connected.";
  const s = PIPE.state(); return s ? "Recording: run " + s.id.slice(-6) + ", chunk " + s.seq + (RR.fail ? ", " + RR.fail + " save(s) failed" : "") + "." : "Recording: no run yet.";
}
// ----- "left running": the checks that matter for a page left open for hours (CHUNK.leftRunning)
RR.battery = null;
async function rrPower() { try { if (navigator.getBattery) { const b = await navigator.getBattery(); RR.battery = {charging: b.charging, level: b.level}; } } catch {} }
rrPower(); setInterval(rrPower, 60000);
function rrLeft() {
  const box = rr$("lrList"); if (!box) return;
  const f = typeof FS !== "undefined" && FS.supported ? {supported: true, state: !FS.dir ? "none" : FS.perm !== "granted" ? "denied" : RR.folderFail ? "failed" : "ok", name: FS.name} : null;
  const d = typeof DW !== "undefined" ? DW.assess() : null;
  const r = CHUNK.leftRunning({connected, recOn: RR.on, folder: f, disk: d, battery: RR.battery, wakeApi: !!navigator.wakeLock, wake: !!RR.wake, newer: typeof SB !== "undefined" ? SB.latest : null});
  const col = {ok: "var(--buy)", warn: "var(--warn)", bad: "var(--sell)", info: "var(--dim)"}, esc = x => String(x).replace(/[&<>]/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[ch]));
  const html = r.items.map(x => `<div class="rv-row"><span style="color:${col[x.tone]};font-weight:700">${x.tone === "ok" ? "OK" : x.tone.toUpperCase()}</span><div class="grow">${esc(x.text)}${x.fix ? `<div class="stat">${esc(x.fix)}</div>` : ""}</div></div>`).join("");
  if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
}
setInterval(() => { try { rrRender(); rrLeft(); } catch {} }, 2000); rrLeft();
rr$("rrOn").onchange = () => rrSetOn(rr$("rrOn").checked);
rrRender();
rrAfterLoad();
