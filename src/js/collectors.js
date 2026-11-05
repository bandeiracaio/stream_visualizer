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
  const sym = cl$("sym").value.trim().toLowerCase(), wants = {derivs:colOn("derivs"), calendar:colOn("calendar"), venues:colOn("venues"), tradeVol:colOn("tradeVol"), book:colOn("book"), bookPerp:colOn("bookPerp"), vol24:colOn("vol24"), wallets:colOn("wallets"), options:colOn("options")}, key = sym + "|" + wants.derivs + "|" + wants.calendar + "|" + wants.venues + "|" + wants.tradeVol + "|" + wants.book + "|" + wants.bookPerp + "|" + wants.vol24 + "|" + wants.wallets + "|" + wants.options;
  const want = (wants.derivs || wants.calendar || wants.venues || wants.tradeVol || wants.book || wants.bookPerp || wants.vol24 || wants.wallets || wants.options) && !!sym;
  if (CL.worker && (!want || CL.workerKey !== key)) { try { CL.worker.postMessage({t:"stop"}); CL.worker.terminate(); } catch {} CL.worker = null; }
  if (!want || CL.worker) return;
  let w;
  try { const u = URL.createObjectURL(new Blob([cl$("colWorkerSrc").textContent], {type:"text/javascript"})); w = new Worker(u); URL.revokeObjectURL(u); }
  catch (e) { hlNote("collector worker failed", {err:String(e && e.message || e)}); return; }
  CL.worker = w; CL.workerKey = key;
  w.onmessage = ev => { if (w !== CL.worker) return; const m = ev.data; if (m.t === "col") colAdd(m.rec); else if (m.t === "note") hlNote(m.k, m.d); };
  w.onerror = () => { if (w !== CL.worker) return; CL.worker = null; try { w.terminate(); } catch {} hlNote("collector worker failed", {err:"stopped on an error"}); };      // no retry loop: reload the page
  CL.recSent = colWatching(); CL.recNow = !!RT.rec; w.postMessage({t:"start", sym, want:wants, rec:CL.recSent, recording:CL.recNow});
}
cl$("sym").addEventListener("change", colWorkerSync);
// tell the worker when the extra venues should be listened to: while a recording is on, and while auto-record is armed (so an auto-recording has the lead-in)
const colWatching = () => !!RT.rec || (typeof AR !== "undefined" && !!AR.on);
setInterval(() => { const on = colWatching(), rec = !!RT.rec; if (CL.worker && (CL.recSent !== on || CL.recNow !== rec)) { CL.recSent = on; CL.recNow = rec; CL.worker.postMessage({t:"rec", on, recording:rec}); } }, 1000);

// ---- book depth summaries (fast collector "book"): moved into the worker (collectors-worker.js), which keeps its own Binance and Hyperliquid books while a recording is on, so a hidden
// tab cannot starve it. The page only tells the worker when a recording starts and stops (colWorkerSync, `recording`); nothing here watches the page's books any more.

// ---- the list under the Health log: a switch per collector and, under it, whether it is writing (records on the tape, time since the last one)
// colTally: counts and newest record per collector from the tape (kept by colAdd from then on)
function colTally(all) { const t = COLLECT.tally(all); for (const id in t) { const s = CL.stat[id] || (CL.stat[id] = {n:0, last:0}); s.n = t[id].n; s.last = Math.max(s.last, t[id].last); } for (const id in CL.stat) if (!t[id]) CL.stat[id].n = 0; }
// null when the collector should be writing right now, otherwise why it is not expected to
function colWhy(id) {
  switch (id) {
    case "telemetry": return connected || AR.on ? null : "waits for the app to be connected or armed";
    case "options": return !COLLECT.deribitCoin(cl$("sym").value.trim()) ? "Deribit lists BTC and ETH only" : CL.worker ? null : "worker not running";
    case "venues": return CL.worker ? (colWatching() ? null : "waits for a recording or auto-record armed") : "worker not running";
    case "tradeVol": return CL.worker ? (colWatching() ? null : "waits for a recording or auto-record armed") : "worker not running";
    case "bookPerp": return CL.worker ? (colWatching() ? null : "waits for a recording or auto-record armed") : "worker not running";
    case "book": return CL.worker ? (RT.rec ? null : "waits for a recording") : "worker not running";
    default: return CL.worker ? null : "worker not running";
  }
}
function colStatus() {
  const sum = cl$("colSum"); if (!sum) return;
  sum.textContent = `Collectors: ${CL.count} records on the tape`;
  const now = Date.now();
  for (const c of COLLECT.REGISTRY) {
    const el = cl$("colSt-" + c.id); if (!el) continue;
    const s = CL.stat[c.id], h = COLLECT.health({on:colOn(c.id), why:colWhy(c.id), n:s ? s.n : 0, ageMs:s && s.last ? now - s.last : null, expectMs:COLLECT.EXPECT_MS[c.id], sinceMs:now - CL.t0});
    el.textContent = h.text; el.className = "stat" + (h.tone === "ok" || h.tone === "warn" || h.tone === "info" ? " sb-" + h.tone : "");
  }
}
function colRender() {
  const box = cl$("colList"); if (!box) return;
  box.innerHTML = COLLECT.REGISTRY.map(c => `<div style="margin:3px 0"><label class="stat" style="display:block"><input type="checkbox" data-col="${c.id}"${colOn(c.id) ? " checked" : ""}> ${c.label}</label><span id="colSt-${c.id}" class="stat" style="margin-left:22px"></span></div>`).join("");
  colStatus();
}
setInterval(colStatus, 1000);
// ---- venue volume readout (read-only): each venue's 24 h dollar volume and share from the newest "vol24" record, perp against spot, and, while a recording or armed
// run is writing "tv", the share of what was actually traded over the last 5 minutes by the aggressor (buy / sell split). Redrawn only when its text changes.
function colVolRender() {
  const box = cl$("colVol"); if (!box) return;
  const v24 = (CL.recent.vol24 || []).slice(-1)[0], d = v24 ? COLLECT.vol24Share(v24[3]) : null, now = Date.now(), tv = COLLECT.tradeShare(CL.recent.tv || [], now, 300000);
  const U = COLLECT.usdText, pct = x => (x*100).toFixed(1) + "%", I = COLLECT.TRADE_IDS;
  let html = "";
  if (!d) html = `<div class="note">Venue volume: no 24 h reading yet (the vol24 collector asks each venue once a minute).</div>`;
  else {
    const rows = COLLECT.TRADE_ORDER.filter(id => d.by[id]).map(id => { const t = tv && tv.by[id], bs = t && t.usd > 0 ? Math.round(t.buy/t.usd*100) : null;
      return `<tr><td>${I[id].label}</td><td style="text-align:right">${U(d.by[id].usd)}</td><td style="text-align:right">${pct(d.by[id].share)}</td><td style="text-align:right">${t ? pct(t.share) : "-"}</td><td style="text-align:right">${bs == null ? "-" : bs + " / " + (100 - bs)}</td></tr>`; }).join("");
    html = `<div class="stat" style="margin-top:8px" title="24 h volume is each venue's own ticker, in dollars (USDT and USD treated as equal), read ${COLLECT.ageText(now - v24[2])} ago. 'Last 5 min' and buy / sell come from the trade buckets, only while a recording or armed run is writing them; buy / sell is by aggressor (the taker's side).">Venue volume, ${String(cl$("sym").value).toUpperCase()}: 24 h ${U(d.usd)} · perp ${pct(d.perp)} · spot ${pct(d.spot)}</div>
      <table style="margin-top:4px"><thead><tr><th style="text-align:left">venue</th><th style="text-align:right">24 h</th><th style="text-align:right">share</th><th style="text-align:right">share 5 min</th><th style="text-align:right">buy / sell %</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
}
setInterval(colVolRender, 5000);
// ---- perp book comparison (read-only): depth within 5 bps (coin and dollars), spread and bid share of the four perp books from their newest summary records (bookBn, bookHl and bookBy, bookOk, all from the worker; the first two write only while a recording is on, the other two while a recording or armed run is on). A venue whose book does not reach 5 bps, or that has no recent record, shows "-".
function colBookRender() {
  const box = cl$("colBook"); if (!box) return;
  const now = Date.now(), recs = [].concat(CL.recent.bookBn || [], CL.recent.bookHl || [], CL.recent.bookBy || [], CL.recent.bookOk || []), rows = COLLECT.bookCompare(recs, now, 5), U = COLLECT.usdText;
  let html = "";
  if (!rows.some(r => r.ageMs != null && r.ageMs < 120000)) html = `<div class="note">Perp books: nothing recent (they are written only while a recording or an armed run is on).</div>`;
  else {
    const L = {bnF:"Binance perp", byF:"Bybit perp", okF:"OKX swap", hlF:"Hyperliquid perp"};
    const body = rows.map(r => { const live = r.ageMs != null && r.ageMs < 120000;
      return `<tr><td>${L[r.id]}</td><td style="text-align:right">${live && r.depthBtc != null ? r.depthBtc.toFixed(1) + " BTC" : "-"}</td><td style="text-align:right">${live && r.depthUsd != null ? U(r.depthUsd) : "-"}</td><td style="text-align:right">${live && r.spr != null ? r.spr.toFixed(2) + " bps" : "-"}</td><td style="text-align:right">${live && r.imb != null ? Math.round(r.imb*100) + " / " + (100 - Math.round(r.imb*100)) : "-"}</td><td style="text-align:right">${r.ageMs == null ? "-" : COLLECT.ageText(r.ageMs)}</td></tr>`; }).join("");
    html = `<div class="stat" style="margin-top:8px" title="Resting size within 5 bps of the mid, both sides, from each venue's own order book (OKX sizes converted from contracts). Bid / ask % is the bid share of that depth. The books reach different distances (Bybit about 25, OKX about 7, Binance about 15, Hyperliquid about 24), so a reading beyond a venue's reach shows as '-'.">Perp books, depth within 5 bps</div>
      <table style="margin-top:4px"><thead><tr><th style="text-align:left">venue</th><th style="text-align:right">depth</th><th style="text-align:right">dollars</th><th style="text-align:right">spread</th><th style="text-align:right">bid / ask %</th><th style="text-align:right">read</th></tr></thead><tbody>${body}</tbody></table>`;
  }
  if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
}
setInterval(colBookRender, 5000);
cl$("colList").onchange = e => { const id = e.target.dataset && e.target.dataset.col; if (!id) return; CL.cfg[id] = e.target.checked; store.set("col.cfg", CL.cfg); colWorkerSync(); if (AR.on && AR.worker) AR.worker.postMessage({t:"cfg", cfg:Object.assign({}, AR.cfg, {collectors:colWorkerCfg()})}); };
cl$("colSave").onclick = async () => {
  const text = JSON.stringify({kind:"sv-tape", v:1, version:APP_VERSION, at:Date.now(), records:await colAll()});
  rtDownload(new Blob([text], {type:"application/json"}), "tape_" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".json");
};
cl$("colClear").onclick = async () => { try { await colReq("readwrite", st => st.clear()); CL.count = 0; CL.stat = {}; } catch {} colStatus(); };
colAll().then(a => { CL.count = a.length; colTally(a); colStatus(); colPrune(); const cut = Date.now() - COL_RECENT_MS; for (const r of a) if (r[2] >= cut) colRemember(r); }, () => colStatus());
colRender();
colVolRender();
colBookRender();
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
