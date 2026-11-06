// Always-on collectors, run in a Web Worker (the page puts collectors-core.js before this file and starts it from collectors.js, whether or not
// auto-record is armed). Why a worker: its timers and sockets are not slowed with a hidden tab. It reads public endpoints only (no keys),
// posts {t:"col", rec} for each record and {t:"note", k, d} for the Health log, and never touches anything else. An error or a rate limit
// stops only the source concerned. Collector "derivs": Binance premium index + open interest (15 s), Hyperliquid funding / open interest
// (15 s), long-short and taker ratios (60 s), and from one stream the basis (10 s) and every liquidation. Collector "calendar": a record at every
// scheduled instant (COLLECT.calendar, by rule, no network). Collector "venues" (fast, only while a recording is on or auto-record is armed): sockets to Coinbase, Bybit, OKX, Binance spot and the majors' marks, one record a second.
// Collector "wallets": the 10 Hyperliquid wallets that traded the most in this coin over 15 minutes, their positions (30 s), their liquidation fills,
// and the predicted funding across venues (60 s).
// Collector "options" (BTC and ETH only): Deribit's volatility index and index price (pushed, sampled every 10 s) and the whole option chain summarised every 120 s.
// Collector "book" (fast): Binance and Hyperliquid book depth summaries, one record a second each, only while a recording is on (the page says so with `recording`). Collector "tradeVol" (fast, like venues): every venue's BTC trades in one-second buckets (record "tv", every 10 s). Collector "vol24" (slow): each venue's 24 h ticker volume once a minute (record "vol24").
// The page says which collectors are on in the start message: {t:"start", sym, want:{derivs, calendar, venues, tradeVol, book, bookPerp, perpFlow, vol24, wallets, options}, rec, recording}, and tells when a recording starts or stops: {t:"rec", on, recording} (on = recording or armed).
let recording = false, on = false, gen = 0, sym = "btc", want = {}, ws = null, lastMsg = 0, timer = null, mk = null, prevRatios = null, lastCal = 0, recOn = false, vOn = false, vGen = 0, vSock = {}, vState = {}, lastVen = 0, lastPing = 0, wtr = null, wsk = null, wTracked = new Map(), wGen = 0, startAt = 0, dsk = null, dGen = 0, dState = {}, optOn = false;
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
async function pollRatios() {
  const s = sym.toUpperCase() + "USDT", g = gen, t = Date.now(), q = `symbol=${s}&period=5m&limit=1`;
  const rs = await Promise.allSettled([getJson("ratios", `${BN}/futures/data/globalLongShortAccountRatio?${q}`), getJson("ratios", `${BN}/futures/data/topLongShortPositionRatio?${q}`), getJson("ratios", `${BN}/futures/data/takerlongshortRatio?${q}`)]);
  if (!on || g !== gen) return;
  const ok = (i, kind) => rs[i].status === "fulfilled" ? COLLECT.ratioPoint(kind, rs[i].value) : null;
  const cur = {acct:ok(0, "acct"), top:ok(1, "top"), taker:ok(2, "taker")};
  if (!cur.acct && !cur.top && !cur.taker) throw first(rs);
  if (COLLECT.ratiosChanged(prevRatios, cur)) { prevRatios = cur; col("ratios", t, cur); }
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
// ---- Hyperliquid wallets: one socket (the coin's trades, to rank wallets, and userFills for the ones followed) and a request every 30 s for their positions
function wOpen() {
  const g = wGen; let w;
  try { w = new WebSocket("wss://api.hyperliquid.xyz/ws"); } catch (e) { say("wallets", e); return; }
  watch("wallets", w);
  wsk = {w, last:Date.now()};
  w.onopen = () => {
    try { w.send(JSON.stringify({method:"subscribe", subscription:{type:"trades", coin:sym.toUpperCase()}})); for (const a of wTracked.keys()) w.send(JSON.stringify({method:"subscribe", subscription:{type:"userFills", user:a}})); } catch {}
  };
  w.onmessage = ev => {
    if (!wsk || wsk.w !== w) return;
    const now = wsk.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }
    if (j.channel === "trades" && Array.isArray(j.data)) { for (const t of j.data) wtr.note(t.time, t.users, +t.px * +t.sz, now); }
    else if (j.channel === "userFills") { for (const f of COLLECT.liqFills(j)) col("hlLiq", f.t || now, f); }
    else if (j.channel === "error") say("wallets", String(j.data).slice(0, 120));
  };
  w.onclose = () => { if (!on || g !== wGen) return; say("wallets socket", "closed, reopening"); setTimeout(() => { if (on && g === wGen) wOpen(); }, 5000); };
}
async function pollWallets() {
  if (!wtr) return;
  const g = wGen, now = Date.now(), coin = sym.toUpperCase(), top = wtr.top(COLLECT.WALLET_TOP, now);
  if (!top.length) return;
  const want_ = new Set(top.map(x => x.w));
  for (const a of [...wTracked.keys()]) if (!want_.has(a)) { wTracked.delete(a); if (wsk && wsk.w.readyState === 1) try { wsk.w.send(JSON.stringify({method:"unsubscribe", subscription:{type:"userFills", user:a}})); } catch {} }
  for (const x of top) if (!wTracked.has(x.w)) { wTracked.set(x.w, {prev:null, at:0}); if (wsk && wsk.w.readyState === 1) try { wsk.w.send(JSON.stringify({method:"subscribe", subscription:{type:"userFills", user:x.w}})); } catch {} }
  const rs = await Promise.allSettled(top.map(x => getJson("wallets", HLI, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({type:"clearinghouseState", user:x.w})})));
  if (!on || g !== wGen) return;
  const rows = []; let bad = null;
  rs.forEach((r, i) => {
    const x = top[i], st = wTracked.get(x.w); if (!st) return;
    if (r.status !== "fulfilled") { bad = bad || r.reason; return; }
    const cur = COLLECT.walletPosition(r.value, coin); if (!cur) { bad = bad || new Error("no usable answer"); return; }
    if (COLLECT.walletChanged(st.prev, cur, now - st.at)) { st.prev = cur; st.at = now; rows.push(Object.assign({w:x.w, n:x.n}, cur)); }
  });
  if (rows.length) col("walletsTop", now, {rows});
  if (bad && rows.length === 0 && rs.every(r => r.status !== "fulfilled")) throw bad;
}
async function pollFunding() {
  const g = gen, t = Date.now(), j = await getJson("fundPred", HLI, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({type:"predictedFundings"})});
  if (!on || g !== gen) return;
  const f = COLLECT.predictedFunding(j, sym.toUpperCase()); if (!f) throw new Error("no usable answer for " + sym.toUpperCase());
  col("fundPred", t, f);
}
function walletsStart() { wGen++; wtr = COLLECT.walletTracker(); wTracked = new Map(); wOpen(); }
function walletsStop() { wGen++; wtr = null; wTracked = new Map(); if (wsk) shut(wsk.w, "stop"); wsk = null; }

// ---- options and volatility (Deribit): the volatility and price index arrive on a socket; the chain is a request (about 400 KB, sent compressed)
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
async function pollOptions() {
  const g = gen, t = Date.now(), j = await getJson("options", "https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=" + COLLECT.deribitCoin(sym) + "&kind=option");
  if (!on || g !== gen) return;
  const c = COLLECT.optionsChain(j && j.result, t); if (!c) throw new Error("no usable option chain");
  col("optChain", t, c);
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
  if (COLLECT.due(last.options, now, COLLECT.EVERY.options)) { last.options = now; run("options", pollOptions); }
}

// ---- extra venues: open only while the page says so ({t:"rec"}: a recording is on or auto-record is armed) and the collector is on, close when that stops
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
// ---- venue trade volume (fast collector "tradeVol"): every venue's BTC trades into one-second buckets, a record ("tv") every 10 s. Open only while the page says so (like the extra venues).
let tOn = false, tGen = 0, tSock = {}, tBook = null, tCt = null, tFlushAt = 0, tPing = 0;
function tOpen(v) {
  const g = tGen; let w;
  try { w = new WebSocket(v.url); } catch (e) { say("trades " + v.id, e); return; }
  watch("trades " + v.id, w);
  tSock[v.id] = {w, last:Date.now()};
  w.onopen = () => { if (v.sub) try { w.send(JSON.stringify(v.sub)); } catch {} };
  w.onmessage = ev => {
    const s = tSock[v.id]; if (!s || s.w !== w || !tBook) return;
    const now = s.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }      // OKX answers a ping with the plain text "pong"
    try { for (const tr of COLLECT.tradeParse(v.id, j, tCt)) tBook.add(tr, now); } catch {}
  };
  w.onclose = () => { if (!tOn || g !== tGen) return; say("trades " + v.id, "closed, reopening"); setTimeout(() => { if (tOn && g === tGen) tOpen(v); }, 5000); };
}
async function tradesStart() {
  const g = ++tGen; tOn = true; tBook = COLLECT.tradeBook(); tFlushAt = Date.now(); tCt = null;
  try { const j = await (await fetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${sym.toUpperCase()}-USDT-SWAP`, {cache:"no-store"})).json(); tCt = COLLECT.okxCt(j); } catch (e) { say("trades okx", e); }
  if (!tOn || g !== tGen) return;
  if (!tCt) say("trades okx", "no contract size: OKX swap trades are skipped");
  for (const v of COLLECT.tradeSubs(sym, {swap:!!tCt})) tOpen(v);
}
function tradesFlush(now, all) { if (!tBook) return; const p = tBook.flush(now, all); if (p) col("tv", now, p); }
function tradesClose() { if (tOn) tradesFlush(Date.now(), true); tOn = false; tGen++; for (const id in tSock) shut(tSock[id].w, "stop"); tSock = {}; tBook = null; }
function tradesSync() {
  const wanted = !!(want.tradeVol && recOn && on);
  if (wanted && !tOn) tradesStart(); else if (!wanted && tOn) tradesClose();
}
function tradesTick(now) {
  if (!tOn) return;
  if (now - tPing >= 20000) { tPing = now; for (const v of COLLECT.tradeSubs(sym, {swap:!!tCt})) { const s = tSock[v.id]; if (v.ping && s && s.w.readyState === 1) try { s.w.send(typeof v.ping === "string" ? v.ping : JSON.stringify(v.ping)); } catch {} } }
  for (const id in tSock) { const s = tSock[id]; if (now - s.last > 60000) shut(s.w, "silent"); }      // silent without closing: close it so onclose reopens it
  if (now - tFlushAt >= 10000) { tFlushAt = now; tradesFlush(now, false); }
}

// ---- perp book depth, Bybit and OKX (fast collector "bookPerp"): one socket each, the book kept by price level (COLLECT.perpBook), a summary record ("bookBy" / "bookOk") every 10 s. Open only while
// the page says so (like the extra venues). A gap, a crossed book or a bad checksum drops the book and resubscribes (a new snapshot); a socket silent for 30 s is closed and reopened.
let bOn = false, bGen = 0, bSock = {}, bBook = {}, bAt = 0, bPing = 0, bCt = null;
const BREC = {by:"bookBy", ok:"bookOk"};
function bResub(v, w) { try { w.send(JSON.stringify(v.unsub)); w.send(JSON.stringify(v.sub)); } catch {} }
function bOpen(v) {
  const g = bGen; let w;
  try { w = new WebSocket(v.url); } catch (e) { say("book " + v.id, e); return; }
  watch("book " + v.id, w);
  bSock[v.id] = {w, last:Date.now()};
  bBook[v.id] = COLLECT.perpBook(v.id, {ct:bCt});
  w.onopen = () => { try { w.send(JSON.stringify(v.sub)); } catch {} };
  w.onmessage = ev => {
    const s = bSock[v.id]; if (!s || s.w !== w) return;
    const now = s.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }      // OKX answers a ping with the plain text "pong"
    try { const m = COLLECT.bookParse(v.id, j); if (m && bBook[v.id].apply(m) === "resync") { say("book " + v.id, "book out of step (" + JSON.stringify(bBook[v.id].stats()) + "), resubscribing"); bResub(v, w); } } catch {}
  };
  w.onclose = () => { if (!bOn || g !== bGen) return; say("book " + v.id, "closed, reopening"); bBook[v.id] = COLLECT.perpBook(v.id, {ct:bCt}); setTimeout(() => { if (bOn && g === bGen) bOpen(v); }, 5000); };
}
async function bookStart() {
  const g = ++bGen; bOn = true; bAt = Date.now(); bCt = null; bBook = {};
  try { const j = await (await fetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${sym.toUpperCase()}-USDT-SWAP`, {cache:"no-store"})).json(); bCt = COLLECT.okxCt(j); } catch (e) { say("book okx", e); }
  if (!bOn || g !== bGen) return;
  if (!bCt) say("book okx", "no contract size: the OKX book is skipped");
  for (const v of COLLECT.bookSubs(sym)) if (v.id !== "ok" || bCt) bOpen(v);
}
function bookClose() { bOn = false; bGen++; for (const id in bSock) shut(bSock[id].w, "stop"); bSock = {}; bBook = {}; }
function bookSync() {
  const wanted = !!(want.bookPerp && recOn && on);
  if (wanted && !bOn) bookStart(); else if (!wanted && bOn) bookClose();
}
function bookTick(now) {
  if (!bOn) return;
  if (now - bPing >= 20000) { bPing = now; for (const v of COLLECT.bookSubs(sym)) { const s = bSock[v.id]; if (v.ping && s && s.w.readyState === 1) try { s.w.send(typeof v.ping === "string" ? v.ping : JSON.stringify(v.ping)); } catch {} } }
  for (const id in bSock) { const s = bSock[id]; if (now - s.last > 30000) shut(s.w, "silent"); }      // silent without closing: close it so onclose reopens it
  if (now - bAt >= 10000) { bAt = now; for (const id in bBook) { const p = bBook[id].summary(); if (p) col(BREC[id], now, p); } }
}

// ---- perp liquidations and open interest, Bybit and OKX (fast collector "perpFlow"): one socket each (Bybit: tickers + allLiquidation, OKX: open-interest + liquidation-orders), a "liqPerp" record for
// every message that carries liquidations and an "oiPerp" record every 10 s with each venue's latest open interest. Open only while the page says so (like the extra venues); a socket silent for 60 s
// is closed and reopened (open interest changes every few seconds on both, so silence means a dead socket).
let pOn = false, pGen = 0, pSock = {}, pState = null, pAt = 0, pPing = 0;
function pOpen(v) {
  const g = pGen; let w;
  try { w = new WebSocket(v.url); } catch (e) { say("perpFlow " + v.id, e); return; }
  watch("perpFlow " + v.id, w);
  pSock[v.id] = {w, last:Date.now()};
  w.onopen = () => { try { w.send(JSON.stringify(v.sub)); } catch {} };
  w.onmessage = ev => {
    const s = pSock[v.id]; if (!s || s.w !== w || !pState) return;
    const now = s.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }      // OKX answers a ping with the plain text "pong"
    try { const rows = pState.add(v.id, j, now); if (rows.length) col("liqPerp", now, {v:v.id, rows}); } catch {}
  };
  w.onclose = () => { if (!pOn || g !== pGen) return; say("perpFlow " + v.id, "closed, reopening"); setTimeout(() => { if (pOn && g === pGen) pOpen(v); }, 5000); };
}
async function perpStart() {
  const g = ++pGen; pOn = true; pAt = Date.now(); pState = null; let ct = null;
  try { const j = await (await fetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${sym.toUpperCase()}-USDT-SWAP`, {cache:"no-store"})).json(); ct = COLLECT.okxCt(j); } catch (e) { say("perpFlow okx", e); }
  if (!pOn || g !== pGen) return;
  if (!ct) say("perpFlow okx", "no contract size: OKX liquidations are skipped (open interest is still read)");
  pState = COLLECT.perpFlow(sym, ct);
  for (const v of COLLECT.perpFlowSubs(sym)) pOpen(v);
}
function perpClose() { pOn = false; pGen++; for (const id in pSock) shut(pSock[id].w, "stop"); pSock = {}; pState = null; }
function perpSync() {
  const wanted = !!(want.perpFlow && recOn && on);
  if (wanted && !pOn) perpStart(); else if (!wanted && pOn) perpClose();
}
function perpTick(now) {
  if (!pOn) return;
  if (now - pPing >= 20000) { pPing = now; for (const v of COLLECT.perpFlowSubs(sym)) { const s = pSock[v.id]; if (v.ping && s && s.w.readyState === 1) try { s.w.send(typeof v.ping === "string" ? v.ping : JSON.stringify(v.ping)); } catch {} } }
  for (const id in pSock) { const s = pSock[id]; if (now - s.last > 60000) shut(s.w, "silent"); }
  if (now - pAt >= 10000) { pAt = now; const p = pState && pState.sample(); if (p) col("oiPerp", now, p); }
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

// ---- venue 24 h volume (slow collector "vol24"): each venue's own ticker, once a minute, dollars per venue id
const V24 = id => { const C = sym.toUpperCase(), c = C + "USDT", H = {cache:"no-store"}; return {
  bnF: () => getJson("vol24", `${BN}/fapi/v1/ticker/24hr?symbol=${c}`), bnS: () => getJson("vol24", `https://api.binance.com/api/v3/ticker/24hr?symbol=${c}`),
  byF: () => getJson("vol24", `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${c}`), byS: () => getJson("vol24", `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${c}`),
  okF: () => getJson("vol24", `https://www.okx.com/api/v5/market/ticker?instId=${C}-USDT-SWAP`), okS: () => getJson("vol24", `https://www.okx.com/api/v5/market/ticker?instId=${C}-USDT`),
  cbS: () => getJson("vol24", `https://api.exchange.coinbase.com/products/${C}-USD/stats`), hlF: () => getJson("vol24", HLI, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({type:"metaAndAssetCtxs"})}),
}[id]; };
async function pollVol24() {
  const g = gen, t = Date.now(), ids = COLLECT.TRADE_ORDER;
  const rs = await Promise.allSettled(ids.map(id => V24(id)()));
  if (!on || g !== gen) return;
  const p = {}; let n = 0;
  ids.forEach((id, i) => { if (rs[i].status !== "fulfilled") return; const v = COLLECT.vol24Parse(id, rs[i].value, id === "hlF" ? sym : null); if (v != null) { p[id] = Math.round(v); n++; } });
  if (!n) throw first(rs);
  col("vol24", t, p);
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
  tradesTick(now);
  bookTick(now);
  perpTick(now);
  depthTick(now);
  if (want.vol24 && COLLECT.due(last.vol24, now, COLLECT.EVERY.vol24)) { last.vol24 = now; run("vol24", pollVol24); }
  if (want.wallets) {
    if (wsk && now - wsk.last > 30000) shut(wsk.w, "silent");      // silent without closing (the coin's trades keep it busy): close it so onclose reopens it
    if (now - (last.wping || 0) >= 30000) { last.wping = now; if (wsk && wsk.w.readyState === 1) try { wsk.w.send(JSON.stringify({method:"ping"})); } catch {} }
    if (now - startAt >= 60000 && COLLECT.due(last.wallets, now, COLLECT.EVERY.wallets)) { last.wallets = now; run("wallets", pollWallets); }
    if (COLLECT.due(last.fundPred, now, COLLECT.EVERY.funding)) { last.fundPred = now; run("fundPred", pollFunding); }
  }
  if (want.options) optionsTick(now);
  if (!want.derivs) return;
  const E = COLLECT.EVERY;
  if (COLLECT.due(last.prem, now, E.prem)) { last.prem = now; run("bnDerivs", pollPremium); }
  if (COLLECT.due(last.hl, now, E.hl)) { last.hl = now; run("hlCtx", pollHl); }
  if (COLLECT.due(last.ratios, now, E.ratios)) { last.ratios = now; run("ratios", pollRatios); }
  if (mk && now - lastMsg < 15000 && COLLECT.due(last.basis, now, E.basis)) { last.basis = now; col("basis", now, mk); }
}
self.onmessage = ev => {
  const m = ev.data;
  if (m.t === "start") { on = true; gen++; venuesClose(); tradesClose(); bookClose(); perpClose(); depthClose(); walletsStop(); optionsStop(); sym = String(m.sym || "btc"); want = m.want || {derivs:true}; recOn = !!m.rec; recording = !!m.recording; mk = null; prevRatios = null; lastCal = Date.now(); for (const k of [last, busy, hold, said]) for (const i in k) delete k[i]; startAt = Date.now(); if (want.derivs) open(); if (want.wallets) walletsStart(); if (want.options) optionsStart(); venuesSync(); tradesSync(); bookSync(); perpSync(); depthSync(); clearInterval(timer); timer = setInterval(tick, 1000); tick(); }
  else if (m.t === "rec") { recOn = !!m.on; recording = !!m.recording; venuesSync(); tradesSync(); bookSync(); perpSync(); depthSync(); }
  else if (m.t === "stop") { venuesClose(); tradesClose(); bookClose(); perpClose(); depthClose(); walletsStop(); optionsStop(); on = false; gen++; clearInterval(timer); if (ws) shut(ws, "stop"); ws = null; }
};
