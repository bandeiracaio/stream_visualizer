// Feeds: the market-reader instance and its hooks, plus the Binance and Hyperliquid socket handlers and book maintenance.
// Classic script loaded BEFORE app.js; function bodies use app.js globals (M, S, $, STREAMS, addTrade, record, ...) lazily at call time.
// Moved verbatim out of app.js; behaviour unchanged.

// ---------- market reader: instance and hooks ----------
const READER = READER_ENGINE.create();
READER.selfTest = () => READER_SELFTEST.run(READER_ENGINE);
// Time spent inside the Reader engine per call, for Diagnostics: one bucket per second (last 60) and the last 2000 call times for a percentile.
const rdPerf = {sec:[], durs:new Float32Array(2000), i:0, n:0, slow:0, SLOW_MS:8};
function rdPerfAdd(d){
  const sec = Math.floor(performance.now()/1000), q = rdPerf.sec;
  let b = q.length ? q[q.length-1] : null;
  if (!b || b.s !== sec){ b = {s:sec, n:0, ms:0, max:0, slow:0}; q.push(b); if (q.length > 60) q.shift(); }
  b.n++; b.ms += d; if (d > b.max) b.max = d; if (d > rdPerf.SLOW_MS){ b.slow++; rdPerf.slow++; }
  rdPerf.durs[rdPerf.i] = d; rdPerf.i = (rdPerf.i+1) % rdPerf.durs.length; if (rdPerf.n < rdPerf.durs.length) rdPerf.n++;
}
const rdSafe = fn => { const t0 = performance.now(); try{ fn(); }catch(e){ console.error("reader", e); } rdPerfAdd(performance.now() - t0); };
const rdLastBook = {bn:0, hl:0};
let rdWorker = null;
function rdStopHeartbeat(){ if(rdWorker){ try{rdWorker.terminate();URL.revokeObjectURL(rdWorker._url);}catch{} rdWorker=null; } }
function rdStartHeartbeat(){
  rdStopHeartbeat();
  try{
    const url=URL.createObjectURL(new Blob(["setInterval(()=>postMessage(0),250)"],{type:"text/javascript"}));
    rdWorker=new Worker(url); rdWorker._url=url;
    rdWorker.onmessage=()=>rdSafe(()=>READER.advance(nowEx() - 1500));
  }catch(e){ rdWorker=null; }
}
function rdBook(v, t){
  rdSafe(() => {
    if (!(t - rdLastBook[v] >= 250)) return;
    rdLastBook[v] = t;
    const b = v==="bn" ? bnTopN(30) : hlTop();
    if (b) READER.onBook(v, t, b.bids, b.asks);
  });
}

// ---------- Binance ----------
const bnStats = {cur:0, bytes:0};
let bnSockets = [], bnGen = 0, oiTimer = null, bnBook = null;
const BN_REST = "https://fapi.binance.com";
const bnSym = () => $("sym").value.trim().toLowerCase() + "usdt";

function bnConnect(isRetry){
  bnDisconnect();
  if (isRetry) health.bnReconnects++;
  const gen = ++bnGen, sym = bnSym(), route = $("route").value;
  const active = STREAMS.filter(d => d.v==="bn" && !d.rest && S[d.id].on);
  const groups = {}, lookup = {};
  for (const d of active){ (groups[route==="routed" ? d.sock : "legacy"] ||= []).push(d.sub(sym)); lookup[d.sub(sym)] = d.id; }
  if (S["bn.depth"].on) bnBook = {bids:new Map(), asks:new Map(), lastU:null, buffer:[], ready:false, gaps:bnBook?bnBook.gaps:0};
  const keys = Object.keys(groups);
  if (!keys.length && !S["bn.oi"].on){ $("bnState").textContent="off"; return; }
  let open = 0; $("bnState").textContent = "connecting…";
  for (const key of keys){
    const url = key==="legacy" ? `wss://fstream.binance.com/stream?streams=${groups[key].join("/")}`
                               : `wss://fstream.binance.com/${key}/stream?streams=${groups[key].join("/")}`;
    let ws; try{ ws = new WebSocket(url); }catch{ $("bnState").textContent="blocked by page"; return; }
    bnSockets.push(ws);
    ws.onopen = () => { if(gen!==bnGen) return; open++; $("bnState").textContent = `${open}/${keys.length} sockets`; };
    ws.onmessage = ev => { if(gen===bnGen) bnHandle(ev.data, lookup); };
    ws.onclose = () => { if(gen!==bnGen) return; $("bnState").textContent="reconnecting…"; setTimeout(()=>{ if(gen===bnGen) bnConnect(true); }, 3000); };
    ws.onerror = () => { if(gen===bnGen) $("bnState").textContent = "blocked / failed"; };
  }
  if (!keys.length) $("bnState").textContent = "REST only";
  if (S["bn.depth"].on) bnSnapshot(gen);
  if (S["bn.oi"].on){ pollOI(); oiTimer = setInterval(pollOI, 10000); }
}
function bnDisconnect(){ bnGen++; for (const w of bnSockets) try{w.close()}catch{}; bnSockets=[]; clearInterval(oiTimer); oiTimer=null; $("bnState").textContent="off"; }

function bnHandle(raw, lookup){
  let msg; try{ msg = JSON.parse(raw); }catch{ return; }
  const id = lookup[msg.stream]; const d = msg.data; if (!id || !d) return;
  let evt = d.E;
  switch(id){
    case "bn.trade": case "bn.aggTrade": {
      evt = d.T;
      const px=+d.p, q=+d.q; if (!q) break;               // settlement prints with p=q=0
      if (id === $("bnSrc").value){ const tr={t:d.T, v:"bn", side:d.m?"sell":"buy", px, q, ntl:px*q}; addTrade(tr); bnSweepFeed(tr); }
      break;
    }
    case "bn.depth": evt = d.T || d.E; bnDepth(d); break;
    case "bn.bookTicker": evt = d.T || d.E; M.bnBid=+d.b; M.bnAsk=+d.a; M.bnBidSz=+d.B; M.bnAskSz=+d.A; rdSafe(() => READER.onQuote("bn", evt, M.bnBid, M.bnAsk)); break;
    case "bn.markPrice": M.bnMark=+d.p; M.bnIndex=+d.i; M.bnFund=+d.r; M.bnNextFund=d.T; break; // T here is next funding, not event time
    case "bn.forceOrder": {
      const o=d.o; evt=o.T; const px=+(o.ap||o.p), q=+(o.z||o.q);
      M.liqs++; M.liqUsd += px*q;
      addTrade({t:o.T, v:"bn", side:o.S==="SELL"?"sell":"buy", px, q, ntl:px*q, liq:true});
      break;
    }
  }
  record(id, raw, evt, d);
}
async function bnSnapshot(gen){
  try{
    const r = await fetch(`${BN_REST}/fapi/v1/depth?symbol=${bnSym().toUpperCase()}&limit=1000`);
    const snap = await r.json(); if (gen!==bnGen || !bnBook) return;
    bnBook.bids = new Map(snap.bids.map(([p,q])=>[p,+q]));
    bnBook.asks = new Map(snap.asks.map(([p,q])=>[p,+q]));
    bnBook.lastU = snap.lastUpdateId; bnBook.ready = true; bnBook.first = true;
    const buf = bnBook.buffer; bnBook.buffer = [];
    for (const d of buf) bnDepth(d);
  }catch{ $("bnBookAge").textContent = "snapshot failed (CORS/network)"; }
}
function bnDepth(d){
  HOOKS.emit("bnDepth", d);      // collectors.js watches updates before the book applies them
  const b = bnBook; if (!b) return;
  if (!b.ready){ b.buffer.push(d); return; }
  if (d.u < b.lastU) return;
  if (b.first){ if (d.U > b.lastU) return bnResync(); b.first=false; }
  else if (d.pu !== b.lastU) return bnResync();
  for (const [p,q] of d.b){ +q ? b.bids.set(p,+q) : b.bids.delete(p); }
  for (const [p,q] of d.a){ +q ? b.asks.set(p,+q) : b.asks.delete(p); }
  b.lastU = d.u;
  rdBook("bn", d.T || d.E);
}
function bnResync(){ const g=(bnBook.gaps||0)+1; bnBook={bids:new Map(),asks:new Map(),lastU:null,buffer:[],ready:false,gaps:g}; bnSnapshot(bnGen); }
async function pollOI(){
  const gen = bnGen;
  try{
    const r = await fetch(`${BN_REST}/fapi/v1/openInterest?symbol=${bnSym().toUpperCase()}`);
    const txt = await r.text(); if (gen!==bnGen) return;
    const d = JSON.parse(txt); M.bnOI = +d.openInterest;
    record("bn.oi", txt, d.time, d, {noLat:true}); // polled: its time field is not a delivery time
  }catch{}
}

// ---------- Hyperliquid ----------
const hlStats = {cur:0, bytes:0};
let hlWs = null, hlGen = 0, hlPing = null, hlFirstTrades = true;
function hlConnect(isRetry){
  hlDisconnect();
  if (isRetry) health.hlReconnects++;
  const gen = ++hlGen, coin = $("sym").value.trim().toUpperCase();
  const active = STREAMS.filter(d => d.v==="hl" && S[d.id].on);
  if (!active.length){ $("hlState").textContent="off"; return; }
  hlFirstTrades = true; $("hlState").textContent = "connecting…";
  let ws; try{ ws = hlWs = new WebSocket("wss://api.hyperliquid.xyz/ws"); }catch{ $("hlState").textContent="blocked by page"; return; }
  ws.onopen = () => {
    if (gen!==hlGen) return;
    for (const d of active) ws.send(JSON.stringify({method:"subscribe", subscription:d.hl(coin)}));
    hlPing = setInterval(()=>{ try{ ws.send('{"method":"ping"}'); }catch{} }, 20000);
    $("hlState").textContent = "connected";
  };
  ws.onmessage = ev => { if (gen===hlGen) hlHandle(ev.data); };
  ws.onclose = () => { if (gen!==hlGen) return; clearInterval(hlPing); $("hlState").textContent="reconnecting…"; setTimeout(()=>{ if(gen===hlGen) hlConnect(true); }, 3000); };
  ws.onerror = () => { if(gen===hlGen) $("hlState").textContent = "blocked / failed"; };
}
function hlDisconnect(){ hlGen++; clearInterval(hlPing); try{hlWs&&hlWs.close()}catch{}; hlWs=null; $("hlState").textContent="off"; }

function hlHandle(raw){
  let msg; try{ msg = JSON.parse(raw); }catch{ return; }
  const id = HL_CHANNEL[msg.channel]; const d = msg.data; if (!id) return;
  let evt = null, opts = {};
  switch(id){
    case "hl.trades": {
      if (hlFirstTrades){ hlFirstTrades=false; health.hlReplays++; opts={backfill:true, noLat:true}; } // replay of recent trades on subscribe
      for (const t of d){
        const px=+t.px, q=+t.sz;
        addTrade({t:t.time, v:"hl", side:t.side==="B"?"buy":"sell", px, q, ntl:px*q, users:t.users, bf:opts.backfill});
        evt = t.time;
      }
      if (!opts.backfill){                                   // fills of one aggressive order share a hash
        const g = {};
        for (const t of d) (g[t.hash] ||= []).push({px:+t.px, ntl:+t.px*+t.sz, t:t.time, side:t.side==="B"?"buy":"sell"});
        for (const h in g) addSweep("hl", g[h][0].t, g[h][0].side, g[h]);
      }
      break;
    }
    case "hl.l2Book": evt = d.time; hlBook = d.levels; hlBookT = Date.now(); rdBook("hl", d.time); break;
    case "hl.bbo": evt = d.time; if (d.bbo[0]){ M.hlBid=+d.bbo[0].px; M.hlBidSz=+d.bbo[0].sz; } if (d.bbo[1]){ M.hlAsk=+d.bbo[1].px; M.hlAskSz=+d.bbo[1].sz; } rdSafe(() => READER.onQuote("hl", d.time, M.hlBid, M.hlAsk)); break;
    case "hl.ctx": { const c=d.ctx; M.hlMark=+c.markPx; M.hlOracle=+c.oraclePx; M.hlFund=+c.funding; M.hlOI=+c.openInterest; M.hlVol=+c.dayNtlVlm; break; }
    case "hl.candle": break;
  }
  record(id, raw, evt, d, opts);
}
