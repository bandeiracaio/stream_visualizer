// Always-on collectors, run in a Web Worker (the page puts collectors-core.js before this file and starts it from collectors.js, whether or not
// auto-record is armed). Why a worker: it keeps the page's heavy work off the page thread; whether a worker's timers are throttled while its page is hidden is undocumented, and a FROZEN page blocks its dedicated workers too (only the page's Web Lock prevents freezing). It reads public endpoints only (no keys),
// posts {t:"col", rec} for each record and {t:"note", k, d} for the Health log, and never touches anything else. An error or a rate limit
// stops only the source concerned. Collector "derivs": Binance premium index + open interest (15 s), Hyperliquid funding / open interest
// (15 s), and from one stream the basis (10 s) and every liquidation. Collector "calendar": a record at every scheduled instant (COLLECT.calendar, by rule, no network).
// Collector "venues" (fast, only while a recording is on or auto-record is armed): sockets to Coinbase, Bybit (perp) and Binance spot, one record a second, for the market state's venue gap.
// Collector "options" (BTC and ETH only): Deribit's volatility index and index price (pushed, sampled every 10 s), for the market state.
// Collector "book" (fast): Binance and Hyperliquid book depth summaries, one record a second each, only while a recording is on (the page says so with `recording`).
// The page says which collectors are on in the start message: {t:"start", sym, want:{derivs, calendar, venues, book, options}, rec, recording}, and tells when a recording starts or stops ({t:"rec"}); {t:"stop"} ends it.
let recording = false, on = false, gen = 0, sym = "btc", want = {}, ws = null, lastMsg = 0, timer = null, mk = null, lastCal = 0, recOn = false, vOn = false, vGen = 0, vSock = {}, vState = {}, lastVen = 0, lastPing = 0, startAt = 0, dsk = null, dGen = 0, dState = {}, optOn = false;
const last = {}, busy = {}, hold = {}, said = {};
const BN = "https://fapi.binance.com", HLI = "https://api.hyperliquid.xyz/info";
const post = m => self.postMessage(m);
const { watch, shut } = COLLECT.sockWatch(post, Date.now);      // close log for every socket below (collectors-core.js)
const col = (name, t, payload) => post({t:"col", rec:COLLECT.rec(name, t, payload)});
function say(name, err) {      // one note per source per 5 minutes: an outage must not fill the log
  const now = Date.now(); if (said[name] && now - said[name] < 300000) return; said[name] = now;
  post({t:"note", k:"collector error", d:{collector:name, err:String(err && err.message || err)}});
}
async function getJson(name, url, init) {
  const r = await fetch(url, Object.assign({cache:"no-store"}, init));
  if (r.status === 429 || r.status === 418) { hold[name] = Date.now() + COLLECT.BACKOFF_MS; throw new Error("HTTP " + r.status + ", resting 5 min"); }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function run(name, fn) {
  if (busy[name] || (hold[name] && hold[name] > Date.now())) return;
  busy[name] = true;
  try { await fn(); } catch (e) { say(name, e); } finally { busy[name] = false; }
}
const first = rs => { const f = rs.find(r => r.status === "rejected"); return f ? f.reason : new Error("no usable answer"); };

async function pollPremium() {
  const s = sym.toUpperCase() + "USDT", g = gen, t = Date.now();
  const rs = await Promise.allSettled([getJson("bnDerivs", `${BN}/fapi/v1/premiumIndex?symbol=${s}`), getJson("bnDerivs", `${BN}/fapi/v1/openInterest?symbol=${s}`)]);
  if (!on || g !== gen) return;
  const p = rs[0].status === "fulfilled" ? COLLECT.premium(rs[0].value) : null, o = rs[1].status === "fulfilled" ? COLLECT.openInterest(rs[1].value) : null;
  if (!p && !o) throw first(rs);
  col("bnDerivs", t, {prem:p, oi:o});
}
async function pollHl() {
  const g = gen, t = Date.now();
  const j = await getJson("hlCtx", HLI, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({type:"metaAndAssetCtxs"})});
  if (!on || g !== gen) return;
  const c = COLLECT.hlCtx(j, sym.toUpperCase()); if (!c) throw new Error("no usable answer for " + sym.toUpperCase());
  col("hlCtx", t, c);
}
function open() {
  const g = gen, s = sym.toLowerCase(); let w;
  try { w = new WebSocket(`wss://fstream.binance.com/market/stream?streams=${s}usdt@markPrice@1s/${s}usdt@forceOrder`); } catch (e) { say("stream", e); return; }
  watch("stream", w);
  ws = w; lastMsg = Date.now();
  w.onmessage = ev => {
    try {
      const d = JSON.parse(ev.data).data; lastMsg = Date.now();
      const f = COLLECT.force(d); if (f) return col("liq", lastMsg, f);
      const b = COLLECT.basis(d); if (b) mk = b;
    } catch {}
  };
  w.onclose = () => { if (!on || g !== gen) return; say("stream", "closed, reopening"); setTimeout(() => { if (on && g === gen) open(); }, 5000); };
}
// ---- volatility index (Deribit): the volatility and price index arrive on a socket
function dOpen() {
  const g = dGen, c = sym.toLowerCase(); let w;
  try { w = new WebSocket("wss://www.deribit.com/ws/api/v2"); } catch (e) { say("options", e); return; }
  watch("options", w);
  dsk = {w, last:Date.now()};
  w.onopen = () => { try { w.send(JSON.stringify({jsonrpc:"2.0", id:1, method:"public/subscribe", params:{channels:["deribit_volatility_index." + c + "_usd", "deribit_price_index." + c + "_usd"]}})); } catch {} };
  w.onmessage = ev => {
    if (!dsk || dsk.w !== w) return;
    const now = dsk.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }
    const p = j.method === "subscription" && j.params; if (!p || !p.data) return;
    if (/volatility_index/.test(p.channel)) { dState.vol = +p.data.volatility; dState.vAt = now; }
    else if (/price_index/.test(p.channel)) { dState.idx = +p.data.price; dState.iAt = now; }
  };
  w.onclose = () => { if (!on || g !== dGen) return; say("options socket", "closed, reopening"); setTimeout(() => { if (on && g === dGen) dOpen(); }, 5000); };
}
function optionsStart() {
  dGen++; dState = {}; optOn = false;
  if (!COLLECT.deribitCoin(sym)) { say("options", "Deribit has options for BTC and ETH only, not " + sym.toUpperCase()); return; }
  optOn = true; dOpen();
}
function optionsStop() { dGen++; optOn = false; if (dsk) shut(dsk.w, "stop"); dsk = null; dState = {}; }
function optionsTick(now) {
  if (!optOn) return;
  if (dsk && now - dsk.last > 60000) shut(dsk.w, "silent");      // the volatility index pushes every few seconds, so a minute of silence is a dead socket
  if (now - (last.dping || 0) >= 30000) { last.dping = now; if (dsk && dsk.w.readyState === 1) try { dsk.w.send(JSON.stringify({jsonrpc:"2.0", id:2, method:"public/test"})); } catch {} }
  if (COLLECT.due(last.dvol, now, COLLECT.EVERY.dvol) && (dState.vol != null || dState.idx != null)) {
    last.dvol = now;
    col("dvol", now, {vol:Number.isFinite(dState.vol) ? dState.vol : null, idx:Number.isFinite(dState.idx) ? dState.idx : null, vAge:dState.vAt ? now - dState.vAt : null, iAge:dState.iAt ? now - dState.iAt : null});
  }
}

// ---- venue prices: open only while the page says so ({t:"rec"}: a recording is on or auto-record is armed) and the collector is on, close when that stops
function vOpen(v) {
  const g = vGen; let w;
  try { w = new WebSocket(v.url); } catch (e) { say("venue " + v.id, e); return; }
  watch("venue " + v.id, w);
  vSock[v.id] = {w, last:Date.now()};
  w.onopen = () => { if (v.sub) try { w.send(JSON.stringify(v.sub)); } catch {} };
  w.onmessage = ev => {
    const s = vSock[v.id]; if (!s || s.w !== w) return;
    const now = s.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }      // OKX answers a ping with the plain text "pong"
    COLLECT.venueApply(vState, COLLECT.venueParse(v.id, j), now);
  };
  w.onclose = () => { if (!vOn || g !== vGen) return; say("venue " + v.id, "closed, reopening"); setTimeout(() => { if (vOn && g === vGen) vOpen(v); }, 5000); };
}
function venuesClose() { vOn = false; vGen++; for (const id in vSock) shut(vSock[id].w, "stop"); vSock = {}; }
function venuesSync() {
  const wanted = !!(want.venues && recOn && on);
  if (wanted && !vOn) { vOn = true; vGen++; vState = {}; lastVen = 0; for (const v of COLLECT.venueSubs(sym)) vOpen(v); }
  else if (!wanted && vOn) venuesClose();
}
function venuesTick(now) {
  if (!vOn) return;
  if (now - lastPing >= 20000) { lastPing = now; for (const v of COLLECT.venueSubs(sym)) { const s = vSock[v.id]; if (v.ping && s && s.w.readyState === 1) try { s.w.send(typeof v.ping === "string" ? v.ping : JSON.stringify(v.ping)); } catch {} } }
  for (const id in vSock) { const s = vSock[id]; if (now - s.last > 30000) shut(s.w, "silent"); }      // silent without closing: close it so onclose reopens it
  if (now - lastVen >= 1000) { lastVen = now; const p = COLLECT.venueRecord(vState, now); if (p) col("venues", now, p); }
}
// ---- book depth, Binance and Hyperliquid (fast collector "book"): while a recording is on, the worker keeps its own books so a hidden tab cannot starve them. Binance: the diff stream plus the REST
// snapshot (COLLECT.perpBook("bn")); Hyperliquid: the exact 20 levels from its socket, topped up with the bucketed book asked for every 2 s. One record a second each ("bookBn", "bookHl").
let kOn = false, kGen = 0, kSock = {}, kBn = null, kBuf = [], kSnapAt = 0, kSnapBusy = false, kHl = null, kCo = null, kCoAt = 0, kAt = 0, kCoLast = 0, kPing = 0;
async function kSnap(g) {
  if (kSnapBusy || !kBn || (hold.bookBn && hold.bookBn > Date.now())) return;
  kSnapBusy = true; kSnapAt = Date.now();
  try {
    const j = await getJson("bookBn", COLLECT.bnBookSub(sym).snap);
    if (!kOn || g !== kGen) return;
    kBn.apply(COLLECT.bookParse("bn", j));
    const buf = kBuf; kBuf = []; for (const m of buf) kApply(m);
  } catch (e) { say("book bn", e); }
  finally { kSnapBusy = false; }
}
function kApply(m) { if (kBn.apply(m) === "resync") { say("book bn", "book out of step (" + JSON.stringify(kBn.stats()) + "), taking a new snapshot"); kBuf = []; } }
function kOpenBn() {
  const g = kGen; let w;
  try { w = new WebSocket(COLLECT.bnBookSub(sym).url); } catch (e) { say("book bn", e); return; }
  watch("book bn", w);
  kSock.bn = {w, last:Date.now()};
  kBn = COLLECT.perpBook("bn"); kBuf = [];
  w.onopen = () => kSnap(g);
  w.onmessage = ev => {
    const s = kSock.bn; if (!s || s.w !== w) return;
    s.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }
    const m = COLLECT.bookParse("bn", j); if (!m) return;
    if (!kBn.ready()) { kBuf.push(m); if (kBuf.length > 5000) kBuf.shift(); } else kApply(m);      // no good book yet: keep the diffs for when the snapshot arrives
  };
  w.onclose = () => { if (!kOn || g !== kGen) return; say("book bn", "closed, reopening"); kBn = COLLECT.perpBook("bn"); kBuf = []; setTimeout(() => { if (kOn && g === kGen) kOpenBn(); }, 5000); };
}
function kOpenHl() {
  const g = kGen; let w;
  try { w = new WebSocket("wss://api.hyperliquid.xyz/ws"); } catch (e) { say("book hl", e); return; }
  watch("book hl", w);
  kSock.hl = {w, last:Date.now()};
  w.onopen = () => { try { w.send(JSON.stringify({method:"subscribe", subscription:{type:"l2Book", coin:sym.toUpperCase()}})); } catch {} };
  w.onmessage = ev => {
    const s = kSock.hl; if (!s || s.w !== w) return;
    const now = s.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }
    const b = COLLECT.hlBookParse(j, sym); if (b) kHl = {bids:b.bids, asks:b.asks, at:now};
  };
  w.onclose = () => { if (!kOn || g !== kGen) return; say("book hl", "closed, reopening"); kHl = null; setTimeout(() => { if (kOn && g === kGen) kOpenHl(); }, 5000); };
}
function depthClose() { kOn = false; kGen++; for (const id in kSock) shut(kSock[id].w, "stop"); kSock = {}; kBn = null; kBuf = []; kHl = null; kCo = null; kCoAt = 0; kSnapBusy = false; }
function depthSync() {
  const wanted = !!(want.book && recording && on);
  if (wanted && !kOn) { kOn = true; kGen++; kHl = null; kCo = null; kCoAt = 0; kAt = Date.now(); kCoLast = 0; kOpenBn(); kOpenHl(); }
  else if (!wanted && kOn) depthClose();
}
async function pollCoarse(g) {
  const j = await getJson("bookCoarse", HLI, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({type:"l2Book", coin:sym.toUpperCase(), nSigFigs:4})});
  if (!kOn || g !== kGen) return;
  const c = COLLECT.hlCoarse(j); if (c) { kCo = c; kCoAt = Date.now(); }
}
function depthTick(now) {
  if (!kOn) return;
  if (now - kPing >= 30000) { kPing = now; const s = kSock.hl; if (s && s.w.readyState === 1) try { s.w.send(JSON.stringify({method:"ping"})); } catch {} }
  for (const id in kSock) { const s = kSock[id]; if (now - s.last > 30000) shut(s.w, "silent"); }      // silent without closing: close it so onclose reopens it
  if (kBn && !kBn.ready() && !kSnapBusy && kSock.bn && kSock.bn.w.readyState === 1 && now - kSnapAt >= 3000) kSnap(kGen);      // a book that was dropped (gap, crossed) gets a new snapshot
  if (now - kCoLast >= 2000) { kCoLast = now; const g = kGen; run("bookCoarse", () => pollCoarse(g)); }
  if (now - kAt >= 1000) {
    kAt = now;
    if (kBn) { const s = kBn.summary(); if (s) col("bookBn", now, s); }
    const h = COLLECT.hlBookSummary(kHl, kCo, now, kCoAt); if (h) col("bookHl", now, h);
  }
}

function tick() {
  if (!on) return;
  const now = Date.now();
  if (want.derivs && ws && now - lastMsg > 15000) shut(ws, "silent");      // silent without closing: close it so onclose reopens it
  if (want.calendar) {      // a gap longer than 6 h (the computer slept) is not back-filled
    for (const c of COLLECT.calendar(Math.max(lastCal, now - 6*3600000), now)) col("cal", c.t, {tags:c.tags});
    lastCal = now;
  }
  venuesTick(now);
  depthTick(now);
  if (want.options) optionsTick(now);
  if (!want.derivs) return;
  const E = COLLECT.EVERY;
  if (COLLECT.due(last.prem, now, E.prem)) { last.prem = now; run("bnDerivs", pollPremium); }
  if (COLLECT.due(last.hl, now, E.hl)) { last.hl = now; run("hlCtx", pollHl); }
  if (mk && now - lastMsg < 15000 && COLLECT.due(last.basis, now, E.basis)) { last.basis = now; col("basis", now, mk); }
}
self.onmessage = ev => {
  const m = ev.data;
  if (m.t === "start") { on = true; gen++; venuesClose(); depthClose(); optionsStop(); sym = String(m.sym || "btc"); want = m.want || {derivs:true}; recOn = !!m.rec; recording = !!m.recording; mk = null; lastCal = Date.now(); for (const k of [last, busy, hold, said]) for (const i in k) delete k[i]; startAt = Date.now(); if (want.derivs) open(); if (want.options) optionsStart(); venuesSync(); depthSync(); clearInterval(timer); timer = setInterval(tick, 1000); tick(); }
  else if (m.t === "rec") { recOn = !!m.on; recording = !!m.recording; venuesSync(); depthSync(); }
  else if (m.t === "stop") { venuesClose(); depthClose(); optionsStop(); on = false; gen++; clearInterval(timer); if (ws) shut(ws, "stop"); ws = null; }
};
