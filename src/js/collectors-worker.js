// Always-on collectors, run in a Web Worker (the page puts collectors-core.js before this file and starts it from collectors.js, whether or not
// auto-record is armed). Why a worker: its timers and sockets are not slowed with a hidden tab. It reads public endpoints only (no keys),
// posts {t:"col", rec} for each record and {t:"note", k, d} for the Health log, and never touches anything else. An error or a rate limit
// stops only the source concerned. Collector "derivs": Binance premium index + open interest (15 s), Hyperliquid funding / open interest
// (15 s), long-short and taker ratios (60 s), and from one stream the basis (10 s) and every liquidation. Collector "calendar": a record at every
// scheduled instant (COLLECT.calendar, by rule, no network). Collector "venues" (fast, only while a recording is on): sockets to Coinbase, Bybit, OKX, Binance spot and the majors' marks, one record a second.
// Collector "wallets": the 10 Hyperliquid wallets that traded the most in this coin over 15 minutes, their positions (30 s), their liquidation fills,
// and the predicted funding across venues (60 s).
// Collector "options" (BTC and ETH only): Deribit's volatility index and index price (pushed, sampled every 10 s) and the whole option chain summarised every 120 s.
// The page says which collectors are on in the start message: {t:"start", sym, want:{derivs, calendar, venues, wallets, options}, rec}, and tells when a recording starts or stops: {t:"rec", on}.
let on = false, gen = 0, sym = "btc", want = {}, ws = null, lastMsg = 0, timer = null, mk = null, prevRatios = null, lastCal = 0, recOn = false, vOn = false, vGen = 0, vSock = {}, vState = {}, lastVen = 0, lastPing = 0, wtr = null, wsk = null, wTracked = new Map(), wGen = 0, startAt = 0, dsk = null, dGen = 0, dState = {}, optOn = false;
const last = {}, busy = {}, hold = {}, said = {};
const BN = "https://fapi.binance.com", HLI = "https://api.hyperliquid.xyz/info";
const post = m => self.postMessage(m);
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
function walletsStop() { wGen++; wtr = null; wTracked = new Map(); if (wsk) try { wsk.w.close(); } catch {} wsk = null; }

// ---- options and volatility (Deribit): the volatility and price index arrive on a socket; the chain is a request (about 400 KB, sent compressed)
function dOpen() {
  const g = dGen, c = sym.toLowerCase(); let w;
  try { w = new WebSocket("wss://www.deribit.com/ws/api/v2"); } catch (e) { say("options", e); return; }
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
function optionsStop() { dGen++; optOn = false; if (dsk) try { dsk.w.close(); } catch {} dsk = null; dState = {}; }
function optionsTick(now) {
  if (!optOn) return;
  if (dsk && now - dsk.last > 60000) try { dsk.w.close(); } catch {}      // the volatility index pushes every few seconds, so a minute of silence is a dead socket
  if (now - (last.dping || 0) >= 30000) { last.dping = now; if (dsk && dsk.w.readyState === 1) try { dsk.w.send(JSON.stringify({jsonrpc:"2.0", id:2, method:"public/test"})); } catch {} }
  if (COLLECT.due(last.dvol, now, COLLECT.EVERY.dvol) && (dState.vol != null || dState.idx != null)) {
    last.dvol = now;
    col("dvol", now, {vol:Number.isFinite(dState.vol) ? dState.vol : null, idx:Number.isFinite(dState.idx) ? dState.idx : null, vAge:dState.vAt ? now - dState.vAt : null, iAge:dState.iAt ? now - dState.iAt : null});
  }
  if (COLLECT.due(last.options, now, COLLECT.EVERY.options)) { last.options = now; run("options", pollOptions); }
}

// ---- extra venues: open only while a recording is on (and the collector is), close when it stops
function vOpen(v) {
  const g = vGen; let w;
  try { w = new WebSocket(v.url); } catch (e) { say("venue " + v.id, e); return; }
  vSock[v.id] = {w, last:Date.now()};
  w.onopen = () => { if (v.sub) try { w.send(JSON.stringify(v.sub)); } catch {} };
  w.onmessage = ev => {
    const s = vSock[v.id]; if (!s || s.w !== w) return;
    const now = s.last = Date.now(); let j; try { j = JSON.parse(ev.data); } catch { return; }      // OKX answers a ping with the plain text "pong"
    COLLECT.venueApply(vState, COLLECT.venueParse(v.id, j), now);
  };
  w.onclose = () => { if (!vOn || g !== vGen) return; say("venue " + v.id, "closed, reopening"); setTimeout(() => { if (vOn && g === vGen) vOpen(v); }, 5000); };
}
function venuesClose() { vOn = false; vGen++; for (const id in vSock) try { vSock[id].w.close(); } catch {} vSock = {}; }
function venuesSync() {
  const wanted = !!(want.venues && recOn && on);
  if (wanted && !vOn) { vOn = true; vGen++; vState = {}; lastVen = 0; for (const v of COLLECT.venueSubs(sym)) vOpen(v); }
  else if (!wanted && vOn) venuesClose();
}
function venuesTick(now) {
  if (!vOn) return;
  if (now - lastPing >= 20000) { lastPing = now; for (const v of COLLECT.venueSubs(sym)) { const s = vSock[v.id]; if (v.ping && s && s.w.readyState === 1) try { s.w.send(typeof v.ping === "string" ? v.ping : JSON.stringify(v.ping)); } catch {} } }
  for (const id in vSock) { const s = vSock[id]; if (now - s.last > 30000) try { s.w.close(); } catch {} }      // silent without closing: close it so onclose reopens it
  if (now - lastVen >= 1000) { lastVen = now; const p = COLLECT.venueRecord(vState, now); if (p) col("venues", now, p); }
}
function tick() {
  if (!on) return;
  const now = Date.now();
  if (want.derivs && ws && now - lastMsg > 15000) try { ws.close(); } catch {}      // silent without closing: close it so onclose reopens it
  if (want.calendar) {      // a gap longer than 6 h (the computer slept) is not back-filled
    for (const c of COLLECT.calendar(Math.max(lastCal, now - 6*3600000), now)) col("cal", c.t, {tags:c.tags});
    lastCal = now;
  }
  venuesTick(now);
  if (want.wallets) {
    if (wsk && now - wsk.last > 30000) try { wsk.w.close(); } catch {}      // silent without closing (the coin's trades keep it busy): close it so onclose reopens it
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
  if (m.t === "start") { on = true; gen++; venuesClose(); walletsStop(); optionsStop(); sym = String(m.sym || "btc"); want = m.want || {derivs:true}; recOn = !!m.rec; mk = null; prevRatios = null; lastCal = Date.now(); for (const k of [last, busy, hold, said]) for (const i in k) delete k[i]; startAt = Date.now(); if (want.derivs) open(); if (want.wallets) walletsStart(); if (want.options) optionsStart(); venuesSync(); clearInterval(timer); timer = setInterval(tick, 1000); tick(); }
  else if (m.t === "rec") { recOn = !!m.on; venuesSync(); }
  else if (m.t === "stop") { venuesClose(); walletsStop(); optionsStop(); on = false; gen++; clearInterval(timer); try { if (ws) ws.close(); } catch {} ws = null; }
};
