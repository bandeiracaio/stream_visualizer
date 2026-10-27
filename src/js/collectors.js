"use strict";
// Collectors (view): samples that no detector uses yet, kept on a rolling 24 h tape (IndexedDB "sv-tape") and attached to every saved session
// as `ext`. This file runs the page-side collector (self-telemetry of the page's own feeds), receives the worker's records, owns the tape and the
// switches. Read-only: it only looks at the app's state and never touches a feed, a recording or a detection. Loaded after health-log.js.
const CL = {cfg:store.get("col.cfg", {}) || {}, db:null, prev:null, prevAt:0, adds:0, count:0, stat:{}, t0:Date.now(), recent:{}, ctx:new Map()};      // recent: the last 75 minutes of records by name, for the episode cards
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
  try { await colReq("readwrite", st => st.add(r)); CL.count++; if (++CL.adds % 360 === 0) colPrune(); const o = COLLECT.ownerOf(r[1]); if (o) { const s = CL.stat[o] || (CL.stat[o] = {n:0, last:0}); s.n++; s.last = Date.now(); } colRemember(r); } catch {}      // a full or blocked store only costs the tape, never the app
}
const colAll = () => colReq("readonly", st => st.getAll()).then(a => a || []);
async function colPrune() {
  try {
    const cutoff = Date.now() - COLLECT.TAPE_MS;
    await colReq("readwrite", st => { const rq = st.openCursor(); rq.onsuccess = () => { const c = rq.result; if (c && c.value[2] < cutoff) { c.delete(); c.continue(); } }; return rq; });
    const all = await colAll(); CL.count = all.length; colTally(all);
  } catch {}
}
// the records for a session that started at t0, from leadMs before it (a minute by default; auto-recordings ask for 30 minutes, like their `pre` prices), newest within the file budget
async function colSlice(t0, leadMs) {
  try { return COLLECT.fit(COLLECT.slice(await colAll(), (t0 || 0) - (leadMs == null ? 60000 : leadMs), Date.now())); } catch { return []; }
}

// ---- the last 75 minutes in memory (episode cards read their context from here while live), seeded from the tape
const COL_RECENT_MS = 75*60000;
function colRemember(r) {
  const a = CL.recent[r[1]] || (CL.recent[r[1]] = []); a.push(r);
  if (a.length > 4000 || (a.length > 64 && a[0][2] < r[2] - COL_RECENT_MS)) { const cut = r[2] - COL_RECENT_MS; let i = 0; while (i < a.length && a[i][2] < cut) i++; if (i) a.splice(0, i); }
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
  const sym = cl$("sym").value.trim().toLowerCase(), wants = {derivs:colOn("derivs"), calendar:colOn("calendar"), venues:colOn("venues"), wallets:colOn("wallets"), options:colOn("options")}, key = sym + "|" + wants.derivs + "|" + wants.calendar + "|" + wants.venues + "|" + wants.wallets + "|" + wants.options;
  const want = (wants.derivs || wants.calendar || wants.venues || wants.wallets || wants.options) && !!sym;
  if (CL.worker && (!want || CL.workerKey !== key)) { try { CL.worker.postMessage({t:"stop"}); CL.worker.terminate(); } catch {} CL.worker = null; }
  if (!want || CL.worker) return;
  let w;
  try { const u = URL.createObjectURL(new Blob([cl$("colWorkerSrc").textContent], {type:"text/javascript"})); w = new Worker(u); URL.revokeObjectURL(u); }
  catch (e) { hlNote("collector worker failed", {err:String(e && e.message || e)}); return; }
  CL.worker = w; CL.workerKey = key;
  w.onmessage = ev => { if (w !== CL.worker) return; const m = ev.data; if (m.t === "col") colAdd(m.rec); else if (m.t === "note") hlNote(m.k, m.d); };
  w.onerror = () => { if (w !== CL.worker) return; CL.worker = null; try { w.terminate(); } catch {} hlNote("collector worker failed", {err:"stopped on an error"}); };      // no retry loop: reload the page
  CL.recSent = colWatching(); w.postMessage({t:"start", sym, want:wants, rec:CL.recSent});
}
cl$("sym").addEventListener("change", colWorkerSync);
// tell the worker when the extra venues should be listened to: while a recording is on, and while auto-record is armed (so an auto-recording has the lead-in)
const colWatching = () => !!RT.rec || (typeof AR !== "undefined" && !!AR.on);
setInterval(() => { const on = colWatching(); if (CL.worker && CL.recSent !== on) { CL.recSent = on; CL.worker.postMessage({t:"rec", on}); } }, 1000);

// ---- book depth summaries (fast collector "book"): only while the app is connected AND recording. Once a second it writes the Binance book (the full
// local book, about 17 bps either side for BTC) and the Hyperliquid book (the exact 20 levels, plus a bucketed 20 levels every 2 s for the deeper edges).
// The flow (size added / removed near the touch) is read from the Binance updates by watching bnDepth, which is called as before and never changed.
// On a hidden tab the page's timers slow down, so this thins out; the recording itself needs the visible window anyway.
const CB = {flow:COLLECT.flowStat(20), snap:null, snapOf:null, coarse:null, coarseAt:0, busy:false, hold:0, errAt:0};
const colBookOn = () => colOn("book") && connected && !!RT.rec;
function colBookObserve(d) {      // before bnDepth applies the update: compare each level with what the book held
  try {
    const b = bnBook; if (!b || !b.ready || d.u < b.lastU) return;
    if (CB.snapOf !== b) {      // a new book: right now it is exactly the snapshot (this runs on every update, recording or not), so remember how far it covers
      let lo = Infinity, hi = 0; for (const p of b.bids.keys()) if (+p < lo) lo = +p; for (const p of b.asks.keys()) if (+p > hi) hi = +p;
      CB.snapOf = b; CB.snap = lo < Infinity && hi > 0 ? {lo, hi} : null;
    }
    if (!colBookOn() || !(M.bnBid > 0) || !(M.bnAsk > 0)) return;
    const mid = (M.bnBid + M.bnAsk)/2, k = 1e4/mid;
    for (const [p, q] of d.b) CB.flow.note("b", b.bids.get(p), +q, (mid - p)*k);
    for (const [p, q] of d.a) CB.flow.note("a", b.asks.get(p), +q, (p - mid)*k);
  } catch {}
}
if (typeof bnDepth === "function") { const bnDepthOrig = bnDepth; bnDepth = function(d) { colBookObserve(d); return bnDepthOrig.call(this, d); }; }
function colBookTick() {
  if (!colBookOn()) { CB.flow.take(); return; }
  const now = Date.now(), arr = m => { const a = []; for (const [p, q] of m) a.push([+p, q]); return a; };
  try {
    const flow = CB.flow.take();
    if (S["bn.depth"].on && bnBook && bnBook.ready) { const mid = (M.bnBid + M.bnAsk)/2, cover = CB.snap && CB.snapOf === bnBook && mid > 0 ? [Math.max(0, (mid - CB.snap.lo)*1e4/mid), Math.max(0, (CB.snap.hi - mid)*1e4/mid)] : [0, 0];      // no snapshot seen yet: no depth beyond the touch is claimed
      const s = COLLECT.book(arr(bnBook.bids), arr(bnBook.asks), null, cover); if (s) colAdd(COLLECT.rec("bookBn", now, Object.assign(s, {fl:flow}))); }
    const t = hlTop();
    if (t && now - hlBookT < 5000) {
      const fine = COLLECT.book(t.bids, t.asks), m = COLLECT.mergeBook(fine, now - CB.coarseAt < 10000 ? CB.coarse : null);
      if (m) colAdd(COLLECT.rec("bookHl", now, Object.assign(m, {cAge:CB.coarseAt ? now - CB.coarseAt : null})));
    }
  } catch {}
}
async function colBookCoarse() {      // Hyperliquid l2Book aggregated to 4 significant figures: 20 levels that reach about 24 bps for BTC
  if (CB.busy || !colBookOn() || Date.now() < CB.hold) return;
  CB.busy = true;
  try {
    const r = await fetch("https://api.hyperliquid.xyz/info", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({type:"l2Book", coin:cl$("sym").value.trim().toUpperCase(), nSigFigs:4})});
    if (r.status === 429) CB.hold = Date.now() + COLLECT.BACKOFF_MS;
    if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 429 ? ", resting 5 min" : ""));
    const L = (await r.json()).levels;
    CB.coarse = COLLECT.book(L[0].map(l => [+l.px, +l.sz]), L[1].map(l => [+l.px, +l.sz]), COLLECT.BOOK_EDGES); CB.coarseAt = Date.now();
  } catch (e) { if (Date.now() - CB.errAt > 300000) { CB.errAt = Date.now(); hlNote("collector error", {collector:"book", err:String(e && e.message || e)}); } }
  finally { CB.busy = false; }
}
setInterval(colBookTick, 1000); setInterval(colBookCoarse, 2000);

// ---- the list under the Health log: a switch per collector and, under it, whether it is writing (records on the tape, time since the last one)
// colTally: counts and newest record per collector from the tape (kept by colAdd from then on)
function colTally(all) { const t = COLLECT.tally(all); for (const id in t) { const s = CL.stat[id] || (CL.stat[id] = {n:0, last:0}); s.n = t[id].n; s.last = Math.max(s.last, t[id].last); } for (const id in CL.stat) if (!t[id]) CL.stat[id].n = 0; }
// null when the collector should be writing right now, otherwise why it is not expected to
function colWhy(id) {
  switch (id) {
    case "telemetry": return connected || AR.on ? null : "waits for the app to be connected or armed";
    case "options": return !COLLECT.deribitCoin(cl$("sym").value.trim()) ? "Deribit lists BTC and ETH only" : CL.worker ? null : "worker not running";
    case "venues": return CL.worker ? (colWatching() ? null : "waits for a recording or auto-record armed") : "worker not running";
    case "book": return colBookOn() ? null : "waits for the app connected and recording";
    default: return CL.worker ? null : "worker not running";
  }
}
function colStatus() {
  const sum = cl$("colSum"); if (!sum) return;
  sum.textContent = `Collectors: ${CL.count} records on the tape`;
  const now = Date.now();
  for (const c of COLLECT.REGISTRY) {
    const el = cl$("colSt-" + c.id); if (!el) continue;
    const s = CL.stat[c.id], h = COLLECT.health({on:colOn(c.id), why:colWhy(c.id), n:s ? s.n : 0, ageMs:s && s.last ? now - s.last : null, expectMs:COLLECT.EXPECT_MS[c.id] || 60000, sinceMs:now - CL.t0});
    el.textContent = h.text; el.className = "stat" + (h.tone === "ok" || h.tone === "warn" || h.tone === "info" ? " sb-" + h.tone : "");
  }
}
function colRender() {
  const box = cl$("colList"); if (!box) return;
  box.innerHTML = COLLECT.REGISTRY.map(c => `<div style="margin:3px 0"><label class="stat" style="display:block"><input type="checkbox" data-col="${c.id}"${colOn(c.id) ? " checked" : ""}> ${c.label}</label><span id="colSt-${c.id}" class="stat" style="margin-left:22px"></span></div>`).join("");
  colStatus();
}
setInterval(colStatus, 1000);
cl$("colList").onchange = e => { const id = e.target.dataset && e.target.dataset.col; if (!id) return; CL.cfg[id] = e.target.checked; store.set("col.cfg", CL.cfg); colWorkerSync(); if (AR.on && AR.worker) AR.worker.postMessage({t:"cfg", cfg:Object.assign({}, AR.cfg, {collectors:colWorkerCfg()})}); };
cl$("colSave").onclick = async () => {
  const text = JSON.stringify({kind:"sv-tape", v:1, version:APP_VERSION, at:Date.now(), records:await colAll()});
  rtDownload(new Blob([text], {type:"application/json"}), "tape_" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".json");
};
cl$("colClear").onclick = async () => { try { await colReq("readwrite", st => st.clear()); CL.count = 0; CL.stat = {}; } catch {} colStatus(); };
colAll().then(a => { CL.count = a.length; colTally(a); colStatus(); colPrune(); const cut = Date.now() - COL_RECENT_MS; for (const r of a) if (r[2] >= cut) colRemember(r); }, () => colStatus());
colRender();
colWorkerSync();

// ---- collector context on an episode card (v067): what the collectors read when the episode was detected, as the feature's deviation from its own recent mean
// While live the records come from the last 75 minutes in memory; in a replay from the session's own collector records (`ext`). Shown in the opened card, above "your call", and
// copied into the label when you press agree or disagree (the tape is pruned after 24 hours, the label is not).
function colContextFor(ep) {
  const t = ep.tDetected; if (!t) return null;
  const replay = !!rdView.engine, ext = replay ? RT.session && RT.session.ext : null, key = (replay ? "r" + (RT.session ? RT.session.startedAt : 0) + ":" + (ext ? ext.length : -1) : "l") + "|" + ep.id + "|" + t;
  if (CL.ctx.has(key)) return CL.ctx.get(key);
  const recs = replay ? (ext || []) : [].concat(...Object.values(CL.recent)), c = COLLECT.context(recs, t, {coin:replay ? RT.session && RT.session.sym : cl$("sym").value});
  if (CL.ctx.size > 400) CL.ctx.clear(); CL.ctx.set(key, c); return c;
}
// who moved first (v079): one row under the context chips, venues against Binance spot over the 60 s before detection
function epLeadBar(c) {
  const l = c.lead; if (!l) return "";
  const head = `<span class="stat" title="Each venue's own price change over the 60 s before detection: when it covered half of the move that the venues made, against Binance spot. The records come about once a second, so 'with it' means within 2 s. Prices are compared as changes, not levels.">who moved first (vs Binance spot)</span>`;
  if (l.none) return `<div class="epctx">${head}<span class="stat">no reading: ${l.none}</span></div>`;
  const chips = l.items.map(x => `<span class="chip" title="${x.label}: ${x.move >= 0 ? "+" : ""}${x.move} bps over the window">${COLLECT.leadText(x)}</span>`).join("");
  return `<div class="epctx">${head}<span class="stat">Binance spot ${l.move >= 0 ? "+" : ""}${l.move} bps</span>${chips}</div>`;
}
// forced flow (v080): the liquidations of the 60 s before detection, by side, against the previous hour's pace; "liquidation-driven" only when the written rule in COLLECT.liqDriven holds
function epLiqChip(c) {
  const l = c.liqx; if (!l || !l.usd && !l.other) return "";
  const U = COLLECT.usdText, what = !l.usd ? "no liquidations in this coin" : l.side === "sells" ? "forced sells " + U(l.sell) : l.side === "buys" ? "forced buys " + U(l.buy) : "forced sells " + U(l.sell) + " · buys " + U(l.buy);
  const pace = !l.usd ? "" : l.x != null ? ` · ${l.x}× the average minute of the previous ${l.histMin >= 60 ? "hour" : l.histMin + " min"}` : l.avg === 0 ? " · none in the hour before" : " · under 10 min of history";
  const venues = l.usd ? ` (Binance ${U(l.bn.sell + l.bn.buy)} · Hyperliquid ${U(l.hl.sell + l.hl.buy)})` : "", other = l.other ? ` · ${l.other} Hyperliquid fill${l.other > 1 ? "s" : ""} in other coins` : "";
  const tip = `Forced orders in the 60 s before detection: Binance liquidations of this symbol plus the Hyperliquid liquidation fills of the followed wallets in this coin (the followed wallet is the counterparty: it bought when the liquidated trader was forced to sell). Tagged when at least $500k and at least 10 times the average minute of the previous hour.`;
  return `<span class="chip" title="${tip}"${l.tag ? ' style="font-weight:700"' : ""}>${l.tag ? "liquidation-driven: " : ""}${what}${venues}${pace}${other}</span>`;
}
// wall quality (v081, wall episodes only): the book depth summaries around the wall. They exist only for a recording (live: while recording; replay: the session's own `ext`).
function colWallFor(ep) {
  if (ep.family !== "wall" || !ep.wall) return null;
  const replay = !!rdView.engine, ext = replay ? RT.session && RT.session.ext : null,
    key = (replay ? "r" + (RT.session ? RT.session.startedAt : 0) + ":" + (ext ? ext.length : -1) : "l") + "|w|" + ep.id + "|" + ep.tStart + "|" + ep.tEnd + "|" + ep.tUpdate;
  if (CL.ctx.has(key)) return CL.ctx.get(key);
  const q = COLLECT.wallQuality(replay ? (ext || []) : [].concat(CL.recent.bookBn || [], CL.recent.bookHl || []), ep);
  if (CL.ctx.size > 400) CL.ctx.clear(); CL.ctx.set(key, q); return q;
}
function epWallBar(ep) {
  const q = colWallFor(ep); if (!q) return "";
  const head = `<span class="stat" title="What the book depth summaries say about this wall, as a second view next to the engine's own reading. Depth is the quantity within an edge (1, 5, 10 or 20 bps) on the wall's side, in the coin's units; the edge is the smallest one that holds the wall. Fixed words: depth at half or less with the mid still 2+ bps from the wall = pulled before price arrived; half or less with the mid closer = gone with price at the wall; 80% or more kept = depth held. Other things add and remove depth at that edge too, so this is a hint.">wall quality (book depth)</span>`;
  if (q.none) return `<div class="epctx">${head}<span class="stat">no reading: ${q.none}</span></div>`;
  const side = q.side === "bid" ? "bid" : "ask", chips = [`wall = ${Math.round(q.share*100)}% of the ${side} depth within ${q.edge} bps`, q.x != null ? `that depth ${q.x}× its usual (${q.usual})` : "usual depth unknown (under 20 readings before)"];
  if (q.end) chips.push(`depth ${q.depth0} → ${q.end.depth} (${q.end.ret >= 1 ? "+" : "-"}${Math.abs(Math.round((q.end.ret - 1)*100))}%)${q.open ? " so far" : ""}`, q.end.dist >= 0 ? `mid ${q.end.dist} bps from the wall` : `mid ${-q.end.dist} bps through the wall`, q.weak ? "wall is a small part of this depth: its change says little about the wall" : q.verdict);
  else chips.push("no book record near the end");
  return `<div class="epctx">${head}${chips.map(t => `<span class="chip">${t}</span>`).join("")}</div>`;
}
// ---- market state (v082, rules version 1 in COLLECT.marketState): a label for the kind of market, with the indicators behind it. Display only.
const ST_IND = {V:"volatility up", L:"forced flow", F:"venues disagree", C:"crowded (funding + open interest)"};
function colStateSource() { const replay = !!rdView.engine; return {replay, recs:replay ? (RT.session && RT.session.ext || []) : [].concat(...Object.values(CL.recent)), coin:replay ? RT.session && RT.session.sym : cl$("sym").value}; }
function colStateLive() {      // the state now, from the last 75 minutes in memory; recomputed every 10 s
  const k = Math.floor(Date.now()/10000); if (CL.stNow && CL.stNow.k === k) return CL.stNow.m;
  const m = COLLECT.marketState([].concat(...Object.values(CL.recent)), Date.now(), {coin:cl$("sym").value}); CL.stNow = {k, m}; return m;
}
function colStateFor(ep, c) {
  const src = colStateSource(), key = (src.replay ? "r" + (RT.session ? RT.session.startedAt : 0) + ":" + src.recs.length : "l") + "|s|" + ep.id + "|" + ep.tDetected;
  if (CL.ctx.has(key)) return CL.ctx.get(key);
  const m = COLLECT.marketState(src.recs, ep.tDetected, {ctx:c, coin:src.coin}); if (CL.ctx.size > 400) CL.ctx.clear(); CL.ctx.set(key, m); return m;
}
function epStateChip(ep, c) {
  const m = colStateFor(ep, c), why = m.i ? m.i.split("").map(k => ST_IND[k]).join(", ") : m.s === "unknown" ? m.n + " of 4 indicators had a reading" : "none of the four indicators fired";
  return `<span class="chip" title="Market state at detection, rules version ${m.v}: ${why}. Stressed = two or more of volatility up / forced flow / venues disagree; crowded = funding and open interest; unsettled = one of the first three; calm = none. Compared with the previous 30 minutes.">market: ${m.s}${m.i ? " (" + m.i + ")" : ""}</span>`;
}
// the states over time for the strip under the Review timeline (cached; the work is a few milliseconds per step)
function colStateStrip(t0, t1) {
  const src = colStateSource(), step = Math.max(30000, Math.round((t1 - t0)/60/1000)*1000), a = Math.floor(t0/step)*step, b = Math.floor(t1/step)*step;
  const key = (src.replay ? "r" + (RT.session ? RT.session.startedAt : 0) + ":" + src.recs.length : "l") + "|" + step + "|" + a + "|" + b;
  if (CL.strip && CL.strip.key === key) return CL.strip;
  CL.strip = {key, step, rows:src.recs.length ? COLLECT.marketStateSeries(src.recs, a, b, step, {coin:src.coin}) : []}; return CL.strip;
}
// scheduled events within 10 minutes of detection (v083): funding, options expiry, US stock open / close; by rule, macro releases are not known
function colEventsFor(ep) {
  const key = "e|" + ep.tDetected; if (CL.ctx.has(key)) return CL.ctx.get(key);
  const e = COLLECT.eventsNear(ep.tDetected, 600000); if (CL.ctx.size > 400) CL.ctx.clear(); CL.ctx.set(key, e); return e;
}
function epEventChip(ep) {
  const e = colEventsFor(ep); if (!e.length) return "";
  return `<span class="chip" title="Scheduled events within 10 minutes of detection, by rule (funding, options expiry, US stock open and close). Macro releases (CPI, FOMC, jobs) are not known to the app.">${e.slice(0, 3).map(x => (Math.abs(x.off) < 60000 ? "at " : COLLECT.evSpan(x.off) + (x.off >= 0 ? " after " : " before ")) + x.label).join(" · ")}</span>`;
}
// ---- options lens (v084, rules in .scratch/collector-features/spec.md G): realized volatility against the volatility index, and the skew shift. Display only.
// price points [[ms, price]]: live from the engine's history (only while connected); in a replay the auto-recording's `pre` (30 minutes of mark price before the trigger) followed by the replay's own
function colPricePts(replay) {
  if (replay) {
    const eng = rdView.engine, h1 = eng.priceHistory("bn"), ph = h1.length ? h1 : eng.priceHistory("hl"), pre = RT.session && RT.session.pre && RT.session.pre.prices;
    return (Array.isArray(pre) ? pre.map(p => [p[0]*1000, p[1]]).filter(p => !ph.length || p[0] < ph[0][0]) : []).concat(ph);
  }
  const h = READER.priceHistory("bn"); return h.length ? h : READER.priceHistory("hl");
}
function colLensLive() {      // recomputed every 10 s
  const k = Math.floor(Date.now()/10000); if (CL.lensNow && CL.lensNow.k === k) return CL.lensNow.m;
  const m = COLLECT.volLens([].concat(...Object.values(CL.recent)), colPricePts(false), Date.now(), {coin:cl$("sym").value}); CL.lensNow = {k, m}; return m;
}
function colLensFor(ep, c) {
  const src = colStateSource(), key = (src.replay ? "r" + (RT.session ? RT.session.startedAt : 0) + ":" + src.recs.length : "l") + "|o|" + ep.id + "|" + ep.tDetected;
  if (CL.ctx.has(key)) return CL.ctx.get(key);
  const m = COLLECT.volLens(src.recs, colPricePts(src.replay), ep.tDetected, {ctx:c, coin:src.coin}); if (CL.ctx.size > 400) CL.ctx.clear(); CL.ctx.set(key, m); return m;
}
function colLensStrip(t0, t1) {
  const src = colStateSource(), step = Math.max(30000, Math.round((t1 - t0)/60/1000)*1000), a = Math.floor(t0/step)*step, b = Math.floor(t1/step)*step;
  const key = (src.replay ? "r" + (RT.session ? RT.session.startedAt : 0) + ":" + src.recs.length : "l") + "|" + step + "|" + a + "|" + b;
  if (CL.lensStrip && CL.lensStrip.key === key) return CL.lensStrip;
  CL.lensStrip = {key, step, rows:src.recs.length ? COLLECT.lensSeries(src.recs, colPricePts(src.replay), a, b, step) : []}; return CL.lensStrip;
}
// ---- followed wallets (v085, rules in .scratch/collector-features/spec.md F): the ten biggest Hyperliquid traders' position change against the crowd's taker flow. Display only.
// The crowd's flow: in a replay from the session's inputs (a running total, built once), live from the app's own running Hyperliquid CVD kept in the Overview history.
function colCrowdFn(replay) {
  if (replay) {
    const k = (RT.session ? RT.session.startedAt : 0) + ":" + (RT.session && RT.session.inputs ? RT.session.inputs.length : 0);
    if (!CL.crowd || CL.crowd.key !== k) CL.crowd = {key:k, ix:COLLECT.crowdIndex(RT.session && RT.session.inputs || [], "hl")};
    return (a, b) => COLLECT.crowdNetAt(CL.crowd.ix, a, b).net;
  }
  return (a, b) => {
    const h = typeof OV !== "undefined" ? OV.hist : []; if (!h.length) return null;
    const near = t => { let best = null, bd = 1e12; for (const x of h) { const d = Math.abs(x.t - t); if (d < bd) { bd = d; best = x; } } return bd <= 15000 ? best : null; };
    const x0 = near(a), x1 = near(b); return x0 && x1 ? x1.ch - x0.ch : null;
  };
}
function colWhaleBase(src) {      // the wallet series (built once per source), the price and the crowd function
  const k = (src.replay ? "r" + (RT.session ? RT.session.startedAt : 0) : "l") + ":" + src.recs.length + ":" + (src.recs.length ? src.recs[src.recs.length - 1][2] : 0);
  if (!CL.whaleSer || CL.whaleSer.key !== k) CL.whaleSer = {key:k, ser:COLLECT.walletSeries(src.recs)};
  const pts = colPricePts(src.replay), px = pts.length ? pts[pts.length - 1][1] : null;
  return {ser:CL.whaleSer.ser, px, crowd:colCrowdFn(src.replay)};
}
function colWhaleAt(t, src) {
  src = src || colStateSource(); const b = colWhaleBase(src), c = b.crowd(t - 600000, t);
  return COLLECT.whaleFlow(src.recs, t, {series:b.ser, px:b.px, crowdNet:c});
}
function colWhaleLive() {      // recomputed every 10 s
  const k = Math.floor(Date.now()/10000); if (CL.whaleNow && CL.whaleNow.k === k) return CL.whaleNow.m;
  const m = colWhaleAt(Date.now(), {replay:false, recs:[].concat(...Object.values(CL.recent)), coin:cl$("sym").value}); CL.whaleNow = {k, m}; return m;
}
function colWhaleFor(ep) {
  const src = colStateSource(), key = (src.replay ? "r" + (RT.session ? RT.session.startedAt : 0) + ":" + src.recs.length : "l") + "|h|" + ep.id + "|" + ep.tDetected;
  if (CL.ctx.has(key)) return CL.ctx.get(key);
  const m = colWhaleAt(ep.tDetected); if (CL.ctx.size > 400) CL.ctx.clear(); CL.ctx.set(key, m); return m;
}
function colWhaleStrip(t0, t1) {
  const src = colStateSource(), step = Math.max(30000, Math.round((t1 - t0)/60/1000)*1000), a = Math.floor(t0/step)*step, b = Math.floor(t1/step)*step;
  const key = (src.replay ? "r" + (RT.session ? RT.session.startedAt : 0) + ":" + src.recs.length : "l") + "|" + step + "|" + a + "|" + b;
  if (CL.whaleStrip && CL.whaleStrip.key === key) return CL.whaleStrip;
  const base = colWhaleBase(src);
  CL.whaleStrip = {key, step, rows:src.recs.length ? COLLECT.whaleSeries(src.recs, null, a, b, step, {px:base.px, crowdAt:base.crowd}) : []}; return CL.whaleStrip;
}
function epCtxBar(ep) {
  const c = colContextFor(ep); if (!c) return "";
  const lead = epLeadBar(c) + epWallBar(ep);
  const head = `<span class="stat" title="Each reading against its own mean of the previous 30 minutes, in standard deviations; only the unusual ones (1.5 or more) are shown">collector context at detection</span>` + epStateChip(ep, c) + epEventChip(ep);
  if (!c.items.length) return `<div class="epctx">${head}<span class="stat">none at that time (the collectors were off, or the data does not reach back that far)</span></div>${lead}`;
  const chips = c.items.filter(x => x.unusual).slice(0, 6).map(x => `<span class="chip ${x.z > 0 ? "hi" : "lo"}" title="${x.label}: ${+x.x.toPrecision(6)} now, ${x.text} from its 30-minute mean (${x.z >= 99 ? "it had been constant" : x.z + " sd"})">${x.label} ${x.z > 0 ? "▲" : "▼"} ${x.text}</span>`).join("");
  const liq = epLiqChip(c);
  return `<div class="epctx">${head}${chips || `<span class="stat">nothing unusual (${c.items.length} readings within 1.5 sd)</span>`}${liq}</div>${lead}`;
}
// the compact snapshot stored with a label: {t, v:{feature:[value, deviation]}, liq:[binance, hyperliquid]}
function colLabelCtx(ep) {
  try {
    const c = colContextFor(ep), wq = colWallFor(ep); if (!c) return undefined; const st = colStateFor(ep, c); if (!(st.s !== "unknown" || colEventsFor(ep).length || c.items.length || c.lead && !c.lead.none || c.liqx && (c.liqx.usd || c.liqx.other) || (wq && !wq.none))) return undefined;
    const v = {}; for (const x of c.items) v[x.f] = [+x.x.toPrecision(7), +x.dev.toPrecision(5)];
    const out = {t:c.t, v, liq:[c.liq.bn, c.liq.hl], st:{v:st.v, s:st.s, i:st.i}};      // st: the market state at detection (rules version, state, letters of the indicators that fired)
    if (c.liqx && (c.liqx.usd || c.liqx.other)) { const q = c.liqx; out.lq = {bn:[q.bn.sell, q.bn.buy], hl:[q.hl.sell, q.hl.buy], x:q.x, other:q.other, tag:q.tag ? 1 : 0}; }      // dollars forced to sell / buy in the 60 s before, by venue
    const wh = colWhaleFor(ep); if (wh && (wh.whales || wh.crowd)) out.wh = {w:wh.whales, c:wh.crowd, d:wh.deltaUsd};      // followed wallets' change over the last 10 minutes (words, dollars) and the crowd's taker-flow word
    const ol = colLensFor(ep, c); if (ol.ratio != null || ol.skew) out.ol = {r:ol.ratio, w:ol.word, sk:ol.skew ? ol.skew.x : null};      // realized / implied volatility at detection, its word, the option skew (-5% minus +5%, points)
    const ev = colEventsFor(ep); if (ev.length) out.ev = ev.slice(0, 3).map(x => [x.tag, Math.round(x.off/1000)]);      // scheduled events within 10 minutes: [tag, seconds after it (negative: before)]
    if (wq && !wq.none) out.wq = {e:wq.edge, sh:wq.share, x:wq.x, ret:wq.end ? wq.end.ret : null, dist:wq.end ? wq.end.dist : null, v:wq.verdict || null};      // the wall's share of the depth within its edge, depth against usual, what the depth did by the end, the mid's distance from the wall
    if (c.lead && !c.lead.none) { const lv = {}; for (const x of c.lead.items) lv[x.src] = x.lead == null ? [null, x.move] : [x.lead, x.move]; out.lead = {ref:c.lead.ref, move:c.lead.move, v:lv}; }      // v: venue -> [seconds it led the reference (negative: lagged; null: no timing), its move in bps]
    return out;
  } catch { return undefined; }
}
