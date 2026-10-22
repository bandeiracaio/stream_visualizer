"use strict";
// ---------- stream catalogue ----------
// gap: longest normal silence (ms) before the stream is flagged.
const STREAMS = [
  {id:"bn.trade",      v:"bn", name:"@trade",         sock:"public", sub:s=>`${s}@trade`,        gap:30000,  desc:"Every fill. Side from m (buyer is maker → sell aggressor)."},
  {id:"bn.aggTrade",   v:"bn", name:"@aggTrade",      sock:"market", sub:s=>`${s}@aggTrade`,     gap:30000,  desc:"Fills grouped per taker order.", off:true},
  {id:"bn.depth",      v:"bn", name:"@depth@100ms",   sock:"public", sub:s=>`${s}@depth@100ms`,  gap:3000,   desc:"Incremental book diffs every 100ms (U/u/pu)."},
  {id:"bn.bookTicker", v:"bn", name:"@bookTicker",    sock:"public", sub:s=>`${s}@bookTicker`,   gap:5000,   desc:"Real-time best bid/ask."},
  {id:"bn.markPrice",  v:"bn", name:"@markPrice@1s",  sock:"market", sub:s=>`${s}@markPrice@1s`, gap:5000,   desc:"Mark, index, funding rate, next funding."},
  {id:"bn.forceOrder", v:"bn", name:"@forceOrder",    sock:"market", sub:s=>`${s}@forceOrder`,   gap:Infinity,desc:"Liquidations (≤1 per second per symbol). Can be silent for long periods."},
  {id:"bn.ticker",     v:"bn", name:"@ticker",        sock:"market", sub:s=>`${s}@ticker`,       gap:5000,   desc:"Rolling 24h stats.", off:true},
  {id:"bn.kline",      v:"bn", name:"@kline_1m",      sock:"market", sub:s=>`${s}@kline_1m`,     gap:5000,   desc:"1m kline updates (raw only, not charted).", off:true},
  {id:"bn.oi",         v:"bn", name:"openInterest",   rest:true,                                   gap:75000,  desc:"REST poll every 10s (not pushed). A background tab is throttled to about one poll a minute, so the alert waits 75s."},
  {id:"hl.trades",     v:"hl", name:"trades",         hl:c=>({type:"trades",coin:c}),             gap:30000,  desc:"Fills with side + both wallets [buyer, seller]."},
  {id:"hl.l2Book",     v:"hl", name:"l2Book",         hl:c=>({type:"l2Book",coin:c}),             gap:10000,  desc:"Full 20-level snapshots, n orders per level."},
  {id:"hl.bbo",        v:"hl", name:"bbo",            hl:c=>({type:"bbo",coin:c}),                gap:15000,  desc:"Best bid/ask on change, per block."},
  {id:"hl.ctx",        v:"hl", name:"activeAssetCtx", hl:c=>({type:"activeAssetCtx",coin:c}),     gap:10000,  desc:"Funding, OI, mark, oracle (no timestamp)."},
  {id:"hl.candle",     v:"hl", name:"candle 1m",      hl:c=>({type:"candle",coin:c,interval:"1m"}),gap:30000, desc:"1m candle updates (raw only, not charted).", off:true},
];
const S = {};
function freshStats(){ return {total:0,cur:0,bytes:0,rates:new Array(60).fill(0),lats:[],late:0,maxLat:null,last:0,payload:null}; }
for (const d of STREAMS) S[d.id] = Object.assign({def:d, on:!d.off}, freshStats());
const HL_CHANNEL = {trades:"hl.trades", l2Book:"hl.l2Book", bbo:"hl.bbo", activeAssetCtx:"hl.ctx", candle:"hl.candle"};

// ---------- helpers ----------
const $ = id => document.getElementById(id);
// Per-viewer settings. Never holds keys/secrets. Every access is guarded: storage can be blocked or empty (private window, file:// quirks).
const store = {
  get(k, d){ try{ const v = localStorage.getItem("sv1:"+k); return v==null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem("sv1:"+k, JSON.stringify(v)); }catch{} },
};
const fmt = (x, d=2) => x==null||isNaN(x) ? "–" : Number(x).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtK = x => { if (x==null||isNaN(x)) return "–"; const a=Math.abs(x), s=x<0?"-":""; return a>=1e9?s+(a/1e9).toFixed(2)+"B":a>=1e6?s+(a/1e6).toFixed(2)+"M":a>=1e3?s+(a/1e3).toFixed(1)+"k":s+a.toFixed(0); };
const hhmmss = t => { const d=new Date(t); return d.toTimeString().slice(0,8)+"."+String(d.getMilliseconds()).padStart(3,"0"); };
const pct = (a,p) => { if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); return s[Math.min(s.length-1, Math.floor(p*s.length))]; };
let paused = false, selected = null, connected = false, connectedAt = 0;

// ---------- clock: offset of this device vs Binance server time ----------
let clockOffset = 0, clockRtt = null, clockOk = false, clockTimer = null;
const nowEx = () => Date.now() + clockOffset; // best estimate of exchange time
async function syncClock(){
  let best = null;
  for (let i=0;i<5;i++){
    try{
      const t0 = performance.now(), w0 = Date.now();
      const r = await fetch("https://fapi.binance.com/fapi/v1/time", {cache:"no-store"});
      const j = await r.json(); const rtt = performance.now() - t0;
      const off = j.serverTime - (w0 + rtt/2);
      if (!best || rtt < best.rtt) best = {rtt, off};
    }catch{}
  }
  if (best){ clockOffset = best.off; clockRtt = best.rtt; clockOk = true; }
  $("clk").textContent = clockOk ? `${clockOffset>=0?"+":""}${clockOffset.toFixed(0)}ms ±${(clockRtt/2).toFixed(0)}${clockRtt>100?" (rough)":""}` : "unsynced";
}

// ---------- market + analytics state ----------
const M = {};
function resetMarket(){ Object.assign(M, {bnMark:null,bnIndex:null,bnFund:null,bnNextFund:null,bnOI:null,bnBid:null,bnAsk:null,
  hlMark:null,hlOracle:null,hlFund:null,hlOI:null,hlVol:null,hlBid:null,hlAsk:null,liqs:0,liqUsd:0}); }
resetMarket();
let hlBook = null, hlBookT = 0;
const KEEP = 300000;                 // 5 min of history for charts
let trades = [];                     // {t, v, side, px, q, ntl, liq, bf, users}
let cvd = {bn:0, hl:0}, cvdHist = []; // sampled every 500ms
let midHist = [];                    // sampled every 250ms
const logLines = [];
const health = {bnReconnects:0, hlReconnects:0, hlReplays:0};
let dirty = false;

function record(id, raw, evtTime, payload, opts={}){
  const s = S[id]; if(!s) return;
  const now = Date.now();
  s.total++; s.cur++; s.bytes += raw.length; s.last = now; s.payload = payload;
  if (evtTime && !opts.noLat){
    const lat = now + clockOffset - evtTime;
    s.lats.push(lat); if (s.lats.length>500) s.lats.shift();
    if (lat > 1000) s.late++;
    if (s.maxLat==null || lat > s.maxLat) s.maxLat = lat;
  }
  const vb = s.def.v==="bn" ? bnStats : hlStats; vb.cur++; vb.bytes += raw.length;
  logLines.push({t:now, id, raw, bf:opts.backfill});
  if (logLines.length>400) logLines.shift();
  dirty = true;
}
function addTrade(t){
  if (!t.bf) rdSafe(() => READER.onTrade(t));
  if (t.mid == null){ const b = t.v==="bn" ? M.bnBid : M.hlBid, a = t.v==="bn" ? M.bnAsk : M.hlAsk; if (b && a) t.mid = (b+a)/2; }
  trades.push(t);
  if (ACC.mode==="sim" && t.v==="bn" && !t.liq) simOnTrade(t);
  if (!t.liq && !t.bf) cvd[t.v] += t.side==="buy" ? t.ntl : -t.ntl; // liquidations already appear as trades
}

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

// ---------- sampling for charts ----------
setInterval(()=>{
  if (!connected) return;
  const t = nowEx();
  const bnMid = M.bnBid&&M.bnAsk ? (M.bnBid+M.bnAsk)/2 : null;
  const hlMid = M.hlBid&&M.hlAsk ? (M.hlBid+M.hlAsk)/2 : null;
  if (bnMid||hlMid) midHist.push({t, bn:bnMid, hl:hlMid});
}, 250);
setInterval(()=>{ if (connected) cvdHist.push({t:nowEx(), bn:cvd.bn, hl:cvd.hl}); }, 500);
function prune(){
  const cut = nowEx() - KEEP;
  const drop = (a) => { let i=0; while (i<a.length && a[i].t<cut) i++; return i ? a.slice(i) : a; };
  trades.sort((a,b)=>a.t-b.t); trades = drop(trades); midHist = drop(midHist); cvdHist = drop(cvdHist); microHist = drop(microHist); heatBn = drop(heatBn); heatHl = drop(heatHl);
}

// ---------- canvas helpers ----------
function prep(cv){
  const dpr = window.devicePixelRatio||1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w*dpr) || cv.height !== Math.round(h*dpr)){ cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr); }
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
  ctx.font = "10.5px ui-monospace,Menlo,Consolas,monospace";
  return {ctx,w,h};
}
function niceStep(x){ const p = 10**Math.floor(Math.log10(x)); for (const m of [1,2,2.5,5,10]) if (m*p >= x) return m*p; return 10*p; }
function emptyMsg(ctx,w,h,txt){ ctx.fillStyle="#7d8a99"; ctx.textAlign="center"; ctx.fillText(txt, w/2, h/2); }
function timeAxis(ctx, X, t0, t1, h, B, L, R, w){
  const win = t1-t0, step = win<=60000?10000:win<=180000?30000:60000;
  ctx.strokeStyle="#1e252e"; ctx.fillStyle="#7d8a99"; ctx.textAlign="center"; ctx.lineWidth=1;
  for (let k=step; k<=win; k+=step){
    const x = X(t1-k); if (x < L) break;
    ctx.beginPath(); ctx.moveTo(x,6); ctx.lineTo(x,h-B); ctx.stroke();
    ctx.fillText(`-${k/1000}s`, x, h-5);
  }
}
const COL = {buy:"#2fbf71", sell:"#e5534b", bn:"#f0b90b", hl:"#5fd4c4"};

// ---------- trade bubble chart ----------
function drawBubbles(){
  const {ctx,w,h} = prep($("cvBub"));
  const win = +$("win").value, t1 = nowEx(), t0 = t1 - win, scale = +$("bubScale").value;
  const pts = trades.filter(t => t.t >= t0);
  const mids = midHist.filter(m => m.t >= t0);
  let lo=Infinity, hi=-Infinity;
  for (const p of pts){ lo=Math.min(lo,p.px); hi=Math.max(hi,p.px); }
  for (const m of mids){ for (const v of [m.bn,m.hl]) if (v){ lo=Math.min(lo,v); hi=Math.max(hi,v); } }
  if (!isFinite(lo)) return emptyMsg(ctx,w,h, connected ? "waiting for trades…" : "press Connect");
  const pad = Math.max((hi-lo)*0.08, hi*0.00005); lo-=pad; hi+=pad;
  const L=6, R=64, T=6, B=18;
  const X = t => L + (t-t0)/win*(w-L-R), Y = p => T + (hi-p)/(hi-lo)*(h-T-B);
  // price grid
  const st = niceStep((hi-lo)/6);
  ctx.strokeStyle="#1e252e"; ctx.fillStyle="#7d8a99"; ctx.textAlign="left"; ctx.lineWidth=1;
  for (let p=Math.ceil(lo/st)*st; p<=hi; p+=st){ const y=Y(p); ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(w-R,y); ctx.stroke(); ctx.fillText(fmt(p, st<1?1:0), w-R+4, y+3.5); }
  timeAxis(ctx, X, t0, t1, h, B, L, R, w);
  // mid lines
  for (const v of ["bn","hl"]){
    ctx.strokeStyle = COL[v]; ctx.globalAlpha=.8; ctx.lineWidth=1.3; ctx.beginPath(); let started=false;
    for (const m of mids){ if (!m[v]){ started=false; continue; } const x=X(m.t), y=Y(m[v]); started ? ctx.lineTo(x,y) : ctx.moveTo(x,y); started=true; }
    ctx.stroke(); ctx.globalAlpha=1;
  }
  // bubbles: big first so small ones stay visible on top
  const sorted = [...pts].sort((a,b)=>b.ntl-a.ntl);
  for (const p of sorted){
    const r = Math.min(30, Math.max(1.6, Math.sqrt(p.ntl)/14*scale)), x=X(p.t), y=Y(p.px), c=COL[p.side];
    if (p.liq){
      ctx.strokeStyle=c; ctx.lineWidth=2.2; const s=Math.max(r,6);
      ctx.beginPath(); ctx.moveTo(x-s,y-s); ctx.lineTo(x+s,y+s); ctx.moveTo(x+s,y-s); ctx.lineTo(x-s,y+s); ctx.stroke(); continue;
    }
    const hollow = p.v==="hl" && r > 8;
    ctx.fillStyle=c; ctx.strokeStyle=c; ctx.lineWidth = hollow ? 1.6 : 1; ctx.globalAlpha = p.bf ? .2 : .45;
    ctx.beginPath(); p.v==="bn" ? ctx.arc(x,y,r,0,Math.PI*2) : ctx.rect(x-r*.89,y-r*.89,r*1.78,r*1.78);
    if (!hollow) ctx.fill(); ctx.globalAlpha=.9; ctx.stroke(); ctx.globalAlpha=1;
  }
  // Reader signals: compact directional markers on the shared price/time axes.
  for (const e of READER.events){
    if (e.t<t0 || e.t>t1 || !(e.px>=lo && e.px<=hi)) continue;
    const x=X(e.t),y=Y(e.px),up=e.dir==="bull",neutral=e.dir==="neutral";
    ctx.fillStyle=neutral?"#e0af68":up?COL.buy:COL.sell;ctx.strokeStyle="#0d1014";ctx.lineWidth=1;
    ctx.beginPath();
    if(neutral){ctx.arc(x,y,4,0,Math.PI*2);}else{ctx.moveTo(x,y+(up?6:-6));ctx.lineTo(x-5,y+(up?-3:3));ctx.lineTo(x+5,y+(up?-3:3));ctx.closePath();}
    ctx.fill();ctx.stroke();
  }
  // current mids on the axis
  const last = mids[mids.length-1];
  if (last) for (const v of ["bn","hl"]) if (last[v]){ const y=Y(last[v]); ctx.fillStyle=COL[v]; ctx.fillRect(w-R+1,y-7,R-2,14); ctx.fillStyle="#0d1014"; ctx.fillText(fmt(last[v],1), w-R+4, y+3.5); }
}

// ---------- CVD chart (dual axis, rebased at window start) ----------
let cvdBase = null;
function drawCvd(){
  const {ctx,w,h} = prep($("cvCvd"));
  const win = +$("win").value, t1 = nowEx(), t0 = Math.max(t1 - win, cvdBase ? cvdBase.t : -Infinity);
  const pts = cvdHist.filter(p => p.t >= t0);
  if (pts.length < 2) return emptyMsg(ctx,w,h, connected ? "collecting…" : "press Connect");
  const b0 = pts[0], L=54, R=54, T=8, B=18;
  const X = t => L + (t-(t1-win))/win*(w-L-R);
  timeAxis(ctx, X, t1-win, t1, h, B, L, R, w);
  for (const [v, side] of [["bn","left"],["hl","right"]]){
    const vals = pts.map(p => p[v]-b0[v]);
    let lo = Math.min(0,...vals), hi = Math.max(0,...vals); if (hi-lo < 1){ hi+=1; lo-=1; }
    const pad=(hi-lo)*.1; lo-=pad; hi+=pad;
    const Y = x => T + (hi-x)/(hi-lo)*(h-T-B);
    if (v==="bn"){ ctx.strokeStyle="#39424e"; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(L,Y(0)); ctx.lineTo(w-R,Y(0)); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = COL[v]; ctx.textAlign = side==="left" ? "right" : "left";
    for (const val of [hi-pad, 0, lo+pad]) ctx.fillText(fmtK(val), side==="left" ? L-4 : w-R+4, Y(val)+3.5);
    ctx.strokeStyle = COL[v]; ctx.lineWidth=1.6; ctx.beginPath();
    pts.forEach((p,i)=>{ const x=X(p.t), y=Y(vals[i]); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); }); ctx.stroke();
  }
}

// ---------- aggressor flow ----------
function renderFlow(){
  const t1 = nowEx(), rows = [];
  for (const [label, win] of [["1m",60000],["5m",300000]]) for (const v of ["bn","hl"]){
    let buy=0, sell=0, n=0;
    for (const t of trades) if (t.v===v && !t.liq && !t.bf && t.t >= t1-win){ t.side==="buy" ? buy+=t.ntl : sell+=t.ntl; n++; }
    const tot = buy+sell, bp = tot ? buy/tot*100 : 50, imb = tot ? (buy-sell)/tot*100 : 0;
    rows.push(`<span><span class="venue v-${v}">${v.toUpperCase()}</span> ${label}</span>
      <div class="fbar"><span class="b" style="width:${bp}%">${bp>18?"$"+fmtK(buy):""}</span><span class="s" style="width:${100-bp}%">${100-bp>18?"$"+fmtK(sell):""}</span></div>
      <div class="fsub">delta ${buy-sell>=0?"+":""}$${fmtK(buy-sell)} · imbalance ${imb>=0?"+":""}${imb.toFixed(1)}% · ${n} trades</div>`);
  }
  $("flow").innerHTML = rows.join("");
}

// ---------- streams, metrics, books, tape, log ----------
function buildCards(){
  const box = $("cards"); box.innerHTML = "";
  for (const d of STREAMS){
    const el = document.createElement("div"); el.className = "card"; el.id = "c-"+d.id;
    el.innerHTML = `<div class="top"><span class="dot"></span><span class="venue v-${d.v}">${d.v.toUpperCase()}</span>
      <span class="nm">${d.name}</span><span class="mini"><b class="r">0</b>/s · <b class="l">–</b></span>
      <label><input type="checkbox" ${S[d.id].on?"checked":""}></label></div>
      <div class="desc">${d.desc}</div><canvas class="spark"></canvas>`;
    const cb = el.querySelector("input");
    cb.onclick = e => e.stopPropagation();
    cb.onchange = () => { S[d.id].on = cb.checked; el.classList.toggle("off", !cb.checked); scheduleReconnect(d.v); };
    el.classList.toggle("off", !S[d.id].on);
    el.onclick = () => { selected = d.id; document.querySelectorAll(".card").forEach(c=>c.classList.remove("sel")); el.classList.add("sel"); $("logFilter").value = d.id; renderInspector(); renderLog(); };
    box.appendChild(el);
    const o = document.createElement("option"); o.value=d.id; o.textContent=`${d.v.toUpperCase()} ${d.name}`; $("logFilter").appendChild(o);
  }
}
const reconnectTimers = {};
function scheduleReconnect(v){
  if (!connected) return;
  clearTimeout(reconnectTimers[v]);
  reconnectTimers[v] = setTimeout(()=> v==="bn" ? bnConnect() : hlConnect(), 800);
}
function status(s){
  if (!s.on || !connected) return "";
  const ago = s.last ? Date.now()-s.last : Date.now()-connectedAt;
  if (ago < Math.min(5000, s.def.gap)) return "live";
  if (ago < s.def.gap) return s.last ? "live" : "";
  return ago < s.def.gap*3 ? "stale" : "dead";
}
function renderCards(){
  for (const d of STREAMS){
    const s = S[d.id], el = $("c-"+d.id);
    el.querySelector(".dot").className = "dot " + status(s);
    el.querySelector(".r").textContent = s.rates[59];
    const l = pct(s.lats,.5); el.querySelector(".l").textContent = l==null?"–":l.toFixed(0)+"ms";
    drawSpark(el.querySelector("canvas"), s.rates, COL[d.v]);
  }
}
function drawSpark(cv, data, color){
  const {ctx,w,h} = prep(cv), max = Math.max(1, ...data), bw = w/data.length;
  ctx.fillStyle = color; ctx.globalAlpha = .75;
  data.forEach((v,i)=>{ const bh = (v/max)*(h-2); ctx.fillRect(i*bw, h-bh, Math.max(1,bw-1), bh); });
  ctx.globalAlpha = 1;
}
function renderMetrics(){
  const spread = (b,a)=> b&&a ? fmt(a-b,1) : "–";
  const items = [
    ["BN mark", fmt(M.bnMark,1)], ["BN index", fmt(M.bnIndex,1)], ["BN funding (8h)", M.bnFund==null?"–":(M.bnFund*100).toFixed(4)+"%"],
    ["BN next funding", M.bnNextFund? new Date(M.bnNextFund).toTimeString().slice(0,5):"–"], ["BN OI (base)", fmtK(M.bnOI)],
    ["BN BBO", M.bnBid?`${fmt(M.bnBid,1)} / ${fmt(M.bnAsk,1)}`:"–"], ["BN spread", spread(M.bnBid,M.bnAsk)],
    ["BN liquidations", `${M.liqs} · $${fmtK(M.liqUsd)}`],
    ["HL mark", fmt(M.hlMark,1)], ["HL oracle", fmt(M.hlOracle,1)], ["HL funding (1h)", M.hlFund==null?"–":(M.hlFund*100).toFixed(4)+"%"],
    ["HL OI (base)", fmtK(M.hlOI)], ["HL 24h $vol", fmtK(M.hlVol)],
    ["HL BBO", M.hlBid?`${fmt(M.hlBid,1)} / ${fmt(M.hlAsk,1)}`:"–"], ["HL spread", spread(M.hlBid,M.hlAsk)],
    ["Mark diff HL−BN", M.hlMark&&M.bnMark ? fmt(M.hlMark-M.bnMark,1) : "–"],
  ];
  $("metrics").innerHTML = items.map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("");
}
function bookRows(bids, asks, withN){
  const N = 10, max = Math.max(1e-9, ...bids.slice(0,N).map(l=>l.sz), ...asks.slice(0,N).map(l=>l.sz));
  const row = (l, side) => `<tr><td class="px ${side}">${fmt(l.px,1)}</td><td class="bar">${fmt(l.sz,3)}<i style="width:${(l.sz/max*100).toFixed(0)}%;background:var(--${side==="b"?"buy":"sell"})"></i></td>${withN?`<td>${l.n}</td>`:""}</tr>`;
  return `<tr><th>price</th><th>size</th>${withN?"<th>n</th>":""}</tr>` + asks.slice(0,N).reverse().map(l=>row(l,"a")).join("") + bids.slice(0,N).map(l=>row(l,"b")).join("");
}
function renderBooks(){
  if (hlBook){
    const m = l => ({px:+l.px, sz:+l.sz, n:l.n});
    $("hlBook").innerHTML = bookRows(hlBook[0].map(m), hlBook[1].map(m), true);
    $("hlBookAge").textContent = "l2Book · " + ((Date.now()-hlBookT)/1000).toFixed(1)+"s ago";
  }
  if (bnBook && bnBook.ready){
    const bids = [...bnBook.bids].map(([p,q])=>({px:+p,sz:q})).sort((a,b)=>b.px-a.px).slice(0,10);
    const asks = [...bnBook.asks].map(([p,q])=>({px:+p,sz:q})).sort((a,b)=>a.px-b.px).slice(0,10);
    $("bnBook").innerHTML = bookRows(bids, asks, false);
    $("bnBookAge").textContent = `${bnBook.bids.size+bnBook.asks.size} levels · resyncs ${bnBook.gaps||0}`;
  }
}
function renderTape(){
  const min = +$("minNtl").value || 0, out = [];
  for (let i=trades.length-1; i>=0 && out.length<120; i--){
    const t = trades[i]; if (t.ntl < min) continue;
    const c = t.side==="buy"?"var(--buy)":"var(--sell)", tag = t.liq?" LIQ":t.bf?" (replay)":"";
    const who = t.users ? ` title="buyer ${t.users[0]}\nseller ${t.users[1]}"` : "";
    out.push(`<tr${who}><td style="text-align:left">${hhmmss(t.t)}</td><td><span class="venue v-${t.v}">${t.v.toUpperCase()}</span></td>
      <td style="color:${c}">${t.side}${tag}</td><td>${fmt(t.px,1)}</td><td>${fmt(t.q,4)}</td><td style="color:${c}">${fmtK(t.ntl)}</td></tr>`);
  }
  $("tape").tBodies[0].innerHTML = out.join("");
}
function renderLog(){
  const f = $("logFilter").value;
  const lines = (f ? logLines.filter(l=>l.id===f) : logLines).slice(-150);
  const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const box = $("log"), atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
  box.innerHTML = lines.map(l=>`${hhmmss(l.t)} <span class="s">${l.id.padEnd(13)}</span>${l.bf?'<span class="bf">[replay] </span>':""}${esc(l.raw.length>220?l.raw.slice(0,220)+"…":l.raw)}`).join("\n");
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function renderInspector(){
  if (!selected) return;
  const s = S[selected];
  $("inspName").textContent = `${s.def.v.toUpperCase()} ${s.def.name}`;
  let txt = s.payload ? JSON.stringify(s.payload, null, 2) : "(no message yet)";
  if (txt.length > 20000) txt = txt.slice(0,20000) + "\n… truncated";
  $("inspect").textContent = txt;
}

// ---------- feed health ----------
function rdPerfKeys(){
  const q = rdPerf.sec, now = Math.floor(performance.now()/1000), live = q.filter(b => now - b.s < 60);
  if (!live.length) return [["Engine work", "–"]];
  const n = live.reduce((a,b)=>a+b.n,0), ms = live.reduce((a,b)=>a+b.ms,0), max = Math.max(...live.map(b=>b.max)), busy = ms/(live.length*1000)*100;
  const d = Array.from(rdPerf.durs.subarray(0, rdPerf.n)).sort((a,b)=>a-b), p99 = d[Math.min(d.length-1, Math.floor(d.length*.99))];
  const fmt = x => x < 1 ? (x*1000).toFixed(0)+" µs" : x.toFixed(1)+" ms";
  return [["Engine calls / s", (n/live.length).toFixed(0)], ["Engine avg call", fmt(ms/n)], ["Engine p99 call", fmt(p99)], ["Engine worst (60 s)", fmt(max)],
          ["Engine busy", busy.toFixed(1)+" %"], ["Calls over "+rdPerf.SLOW_MS+" ms", rdPerf.slow]];
}
function renderHealth(){
  const k = [
    ["Clock offset", clockOk ? `${clockOffset>=0?"+":""}${clockOffset.toFixed(0)} ms` : "unsynced"],
    ["Offset uncertainty", clockRtt==null ? "–" : `±${(clockRtt/2).toFixed(0)} ms`],
    ["BN reconnects", health.bnReconnects], ["HL reconnects", health.hlReconnects],
    ["BN book resyncs", bnBook ? (bnBook.gaps||0) : "–"], ["HL trade replays", health.hlReplays],
    ["Uptime", connected ? ((Date.now()-connectedAt)/60000).toFixed(1)+" min" : "–"],
  ].concat(rdPerfKeys());
  $("healthKeys").innerHTML = k.map(([a,b])=>`<div class="metric"><span>${a}</span><b>${b}</b></div>`).join("");
  const ms = x => x==null ? "–" : x.toFixed(0);
  $("health").innerHTML = `<tr><th>stream</th><th>status</th><th>msg/s</th><th>avg/s 60s</th><th>p50</th><th>p99</th><th>max</th><th>late</th><th>silent</th><th>total</th></tr>` +
    STREAMS.filter(d=>S[d.id].on).map(d=>{
      const s=S[d.id], st=status(s), col = st==="live"?"var(--buy)":st==="stale"?"var(--warn)":st==="dead"?"var(--sell)":"var(--dim)";
      const avg = s.rates.reduce((a,b)=>a+b,0)/60, silent = s.last ? (Date.now()-s.last)/1000 : null;
      return `<tr><td><span class="venue v-${d.v}">${d.v.toUpperCase()}</span> ${d.name}</td><td style="color:${col}">${st||"–"}</td>
        <td>${s.rates[59]}</td><td>${avg.toFixed(1)}</td><td>${ms(pct(s.lats,.5))}</td><td>${ms(pct(s.lats,.99))}</td><td>${ms(s.maxLat)}</td>
        <td style="color:${s.late?"var(--warn)":"inherit"}">${s.late}</td><td>${silent==null?"never":silent<1?"0s":silent.toFixed(0)+"s"}</td><td>${fmtK(s.total)}</td></tr>`;
    }).join("");
}
function renderAlerts(){
  if (!connected){ $("alerts").textContent=""; return; }
  const bad = STREAMS.filter(d => { const st=status(S[d.id]); return st==="stale"||st==="dead"; })
    .map(d => { const s=S[d.id]; return `${d.v.toUpperCase()} ${d.name} ${s.last ? "silent "+((Date.now()-s.last)/1000).toFixed(0)+"s" : "no data yet"}`; });
  $("alerts").textContent = bad.length ? "⚠ " + bad.join(" · ") : "";
}


// ---------- microstructure ----------
let microHist = [], heatBn = [], heatHl = [], sweeps = [], bnGroup = null;
function resetMicro(){ retHist=[]; lastRetMid=null; microHist=[]; heatBn=[]; heatHl=[]; sweeps=[]; bnGroup=null; }
function topN(map, n, desc){
  const out = [];
  for (const [p, q] of map){
    const px = +p; let i = out.length;
    while (i > 0 && (desc ? out[i-1][0] < px : out[i-1][0] > px)) i--;
    if (i < n){ out.splice(i, 0, [px, q]); if (out.length > n) out.pop(); }
  }
  return out;
}
function bnTopN(n){ return bnBook && bnBook.ready && bnBook.bids.size && bnBook.asks.size ? {bids:topN(bnBook.bids,n,true), asks:topN(bnBook.asks,n,false)} : null; }
function bnTop(){
  if (!bnBook || !bnBook.ready || !bnBook.bids.size || !bnBook.asks.size) return null;
  return { bids:[...bnBook.bids].map(([p,q])=>[+p,q]).sort((a,b)=>b[0]-a[0]),
           asks:[...bnBook.asks].map(([p,q])=>[+p,q]).sort((a,b)=>a[0]-b[0]) };
}
function hlTop(){
  if (!hlBook || !hlBook[0].length || !hlBook[1].length) return null;
  return { bids:hlBook[0].map(l=>[+l.px,+l.sz]), asks:hlBook[1].map(l=>[+l.px,+l.sz]) };
}
function imbalance(b, N){
  let bs=0, as=0; for (let i=0;i<N && i<b.bids.length;i++) bs+=b.bids[i][1]; for (let i=0;i<N && i<b.asks.length;i++) as+=b.asks[i][1];
  return bs+as ? (bs-as)/(bs+as) : null;
}
// bucket the visible book into a fine fixed grid so the heatmap can re-bin at any zoom
function heatSnap(b, t){
  const mid = (b.bids[0][0]+b.asks[0][0])/2, base = niceStep(mid*5e-6), half = mid*0.0018;
  const lo = Math.floor((mid-half)/base)*base, nb = Math.ceil(2*half/base)+1, arr = new Float32Array(nb);
  for (const side of [b.bids, b.asks]) for (const [p,q] of side){ const i = Math.floor((p-lo)/base+1e-9); if (i>=0 && i<nb) arr[i]+=q; }
  return {t, mid, lo, base, arr};
}
const microprice = (b,a,bs,as) => bs+as ? (b*as + a*bs)/(bs+as) : null;
setInterval(()=>{
  if (!connected) return;
  const t = nowEx(), r = {t};
  const bn = bnTop();
  if (bn){ for (const N of [5,10,20]) r["bnImb"+N] = imbalance(bn,N); heatBn.push(heatSnap(bn,t)); }
  const hl = hlTop();
  if (hl){ for (const N of [5,10,20]) r["hlImb"+N] = imbalance(hl,N); heatHl.push(heatSnap(hl,t)); }
  let bnMid=null, hlMid=null;
  if (M.bnBid && M.bnAsk){ bnMid=(M.bnBid+M.bnAsk)/2; r.bnSpread=M.bnAsk-M.bnBid; const mp=microprice(M.bnBid,M.bnAsk,M.bnBidSz,M.bnAskSz); if (mp!=null) r.bnMicro=mp-bnMid; }
  if (M.hlBid && M.hlAsk){ hlMid=(M.hlBid+M.hlAsk)/2; r.hlSpread=M.hlAsk-M.hlBid; const mp=microprice(M.hlBid,M.hlAsk,M.hlBidSz,M.hlAskSz); if (mp!=null) r.hlMicro=mp-hlMid; }
  if (bnMid && hlMid) r.basis = hlMid - bnMid;
  microHist.push(r);
}, 250);

// sweeps: an aggressive order filling at 2+ prices
function addSweep(v, t, side, fills){
  const pxs = new Set(fills.map(f=>f.px)); if (pxs.size < 2) return;
  const lo = Math.min(...pxs), hi = Math.max(...pxs);
  sweeps.push({t, v, side, levels:pxs.size, fills:fills.length, from: side==="buy"?lo:hi, to: side==="buy"?hi:lo,
               ntl: fills.reduce((a,f)=>a+f.ntl,0)});
  if (sweeps.length > 300) sweeps.shift();
  rdSafe(() => READER.onSweep(v, t, side, fills.reduce((a, f) => a + f.ntl, 0), pxs.size));
  dirty = true;
}
function bnSweepFeed(tr){   // Binance gives no taker-order id on @trade: same ms + same side ≈ one order
  if (bnGroup && (bnGroup.t!==tr.t || bnGroup.side!==tr.side)) flushBnGroup();
  if (!bnGroup) bnGroup = {t:tr.t, side:tr.side, fills:[]};
  bnGroup.fills.push(tr);
}
function flushBnGroup(){ if (bnGroup){ addSweep("bn", bnGroup.t, bnGroup.side, bnGroup.fills); bnGroup=null; } }
setInterval(()=>{ if (bnGroup && nowEx()-bnGroup.t > 500) flushBnGroup(); }, 250);

// generic time-series line chart
function drawLines(cv, rows, series, opt={}){
  const {ctx,w,h} = prep(cv);
  const win = +$("mwin").value, t1 = nowEx(), t0 = t1-win;
  const pts = rows.filter(r=>r.t>=t0);
  let lo = opt.lo, hi = opt.hi;
  if (lo==null){
    lo=Infinity; hi=-Infinity;
    for (const p of pts) for (const sr of series){ const v=p[sr.key]; if (v!=null && isFinite(v)){ lo=Math.min(lo,v); hi=Math.max(hi,v); } }
    if (!isFinite(lo)) return emptyMsg(ctx,w,h, connected?"collecting…":"press Connect");
    if (opt.zero){ lo=Math.min(lo,0); hi=Math.max(hi,0); }
    if (hi-lo < 1e-9){ hi+=Math.abs(hi)*0.01||1; lo-=Math.abs(lo)*0.01||1; }
    const pad=(hi-lo)*.08; lo-=pad; hi+=pad;
  }
  if (pts.length < 2) return emptyMsg(ctx,w,h, connected?"collecting…":"press Connect");
  const L=6, R=58, T=8, B=18;
  const X = t => L+(t-t0)/win*(w-L-R), Y = v => T+(hi-v)/(hi-lo)*(h-T-B);
  const st = niceStep((hi-lo)/4), dec = st>=1?0:st>=0.1?1:st>=0.01?2:4, f = opt.fmt || (v=>fmt(v,dec));
  ctx.strokeStyle="#1e252e"; ctx.fillStyle="#7d8a99"; ctx.textAlign="left"; ctx.lineWidth=1;
  for (let v=Math.ceil(lo/st)*st; v<=hi; v+=st){ const y=Y(v); ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(w-R,y); ctx.stroke(); ctx.fillText(f(v), w-R+4, y+3.5); }
  if (lo<0 && hi>0){ ctx.strokeStyle="#4a5462"; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(L,Y(0)); ctx.lineTo(w-R,Y(0)); ctx.stroke(); ctx.setLineDash([]); }
  timeAxis(ctx, X, t0, t1, h, B, L, R, w);
  for (const sr of series){
    ctx.strokeStyle=sr.color; ctx.lineWidth=1.5; ctx.beginPath(); let on=false;
    for (const p of pts){ const v=p[sr.key]; if (v==null || !isFinite(v)){ on=false; continue; } const x=X(p.t), y=Y(v); on ? ctx.lineTo(x,y) : ctx.moveTo(x,y); on=true; }
    ctx.stroke();
  }
}

// heatmap colour ramp: near-black → blue → cyan → yellow → white
const HEAT_LUT = (()=>{
  const stops=[[0,[16,20,26]],[.2,[22,40,96]],[.45,[24,120,170]],[.7,[220,190,60]],[1,[255,250,230]]], lut=[];
  for (let i=0;i<256;i++){ const x=i/255; let k=0; while (k<stops.length-2 && x>stops[k+1][0]) k++;
    const [x0,c0]=stops[k],[x1,c1]=stops[k+1], f=(x-x0)/(x1-x0); lut.push(c0.map((c,j)=>Math.round(c+(c1[j]-c)*f))); }
  return lut;
})();
const hmOff = document.createElement("canvas");
function drawHeat(){
  const {ctx,w,h} = prep($("cvHeat"));
  const v = $("hmVenue").value, win = +$("mwin").value, t1 = nowEx(), t0 = t1-win;
  const ss = (v==="bn"?heatBn:heatHl).filter(s=>s.t>=t0);
  if (!ss.length) return emptyMsg(ctx,w,h, connected ? "waiting for the "+(v==="bn"?"Binance":"HL")+" book…" : "press Connect");
  const mid = ss[ss.length-1].mid, range = mid * +$("hmRange").value, lo = mid-range, hi = mid+range;
  const L=6, R=64, T=6, B=18, pw=w-L-R, ph=h-T-B;
  const rows = Math.max(30, Math.min(200, Math.round(ph/2.5))), rowSz = (hi-lo)/rows;
  const SLOT = 250, cols = Math.ceil(win/SLOT);
  const val = new Float32Array(cols*rows), has = new Uint8Array(cols);
  for (const s of ss){
    const c = Math.floor((s.t-t0)/SLOT); if (c<0 || c>=cols) continue; has[c]=1;
    const a = s.arr;
    for (let i=0;i<a.length;i++){ if (!a[i]) continue; const r = Math.floor((hi-(s.lo+(i+.5)*s.base))/rowSz); if (r>=0 && r<rows) val[r*cols+c]+=a[i]; }
  }
  const nz = []; for (let i=0;i<val.length;i+=Math.max(1,Math.floor(val.length/20000))) if (val[i]>0) nz.push(val[i]);
  nz.sort((a,b)=>a-b); const ref = Math.log1p(nz.length ? nz[Math.floor(nz.length*0.98)] : 1) || 1;
  hmOff.width = cols; hmOff.height = rows;
  const hctx = hmOff.getContext("2d"), img = hctx.createImageData(cols, rows), px = img.data;
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
    const o = (r*cols+c)*4;
    if (!has[c]){ px[o]=34; px[o+1]=36; px[o+2]=40; px[o+3]=255; continue; }    // not sampled ≠ empty
    const x = val[r*cols+c] ? Math.min(1, Math.log1p(val[r*cols+c])/ref) : 0, col = HEAT_LUT[Math.round(x*255)];
    px[o]=col[0]; px[o+1]=col[1]; px[o+2]=col[2]; px[o+3]=255;
  }
  hctx.putImageData(img,0,0);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(hmOff, L, T, pw, ph);
  const X = t => L+(t-t0)/win*pw, Y = p => T+(hi-p)/(hi-lo)*ph;
  const st = niceStep((hi-lo)/6);
  ctx.fillStyle="#7d8a99"; ctx.textAlign="left";
  for (let p=Math.ceil(lo/st)*st; p<=hi; p+=st) ctx.fillText(fmt(p, st<1?1:0), w-R+4, Y(p)+3.5);
  timeAxis(ctx, X, t0, t1, h, B, L, R, w);
  ctx.save(); ctx.beginPath(); ctx.rect(L,T,pw,ph); ctx.clip();
  ctx.strokeStyle="rgba(255,255,255,.85)"; ctx.lineWidth=1.2; ctx.beginPath();
  ss.forEach((s,i)=>{ const x=X(s.t), y=Y(s.mid); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); }); ctx.stroke();
  for (const t of trades){
    if (t.v!==v || t.t<t0 || t.bf || t.liq) continue;
    const r = Math.min(14, Math.max(1.4, Math.sqrt(t.ntl)/22));
    ctx.fillStyle = t.side==="buy" ? "rgba(47,191,113,.8)" : "rgba(229,83,75,.8)";
    ctx.beginPath(); ctx.arc(X(t.t), Y(t.px), r, 0, Math.PI*2); ctx.fill();
  }
  for (const s of sweeps){
    if (s.v!==v || s.t<t0) continue;
    const x=X(s.t), y=Y(s.to), d = s.side==="buy" ? -1 : 1;
    ctx.fillStyle = s.side==="buy" ? COL.buy : COL.sell; ctx.strokeStyle="#fff"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x, y+d*9); ctx.lineTo(x-5, y+d*1); ctx.lineTo(x+5, y+d*1); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle="#fff"; ctx.fillRect(w-R+1, Y(mid)-7, R-2, 14); ctx.fillStyle="#0d1014"; ctx.fillText(fmt(mid,1), w-R+4, Y(mid)+3.5);
}

function drawHist(){
  const {ctx,w,h} = prep($("cvHist"));
  const t0 = nowEx() - +$("mwin").value;
  const edges = [10,100,1e3,1e4,1e5,1e6], labels = ["<10","10-100","100-1k","1k-10k","10k-100k","100k-1M",">1M"];
  const cnt = {bn:new Array(7).fill(0), hl:new Array(7).fill(0)}, vol = {bn:new Array(7).fill(0), hl:new Array(7).fill(0)};
  for (const t of trades){ if (t.t<t0 || t.liq || t.bf) continue; let i = edges.findIndex(e=>t.ntl<e); if (i<0) i=6; cnt[t.v][i]++; vol[t.v][i]+=t.ntl; }
  const tot = v => cnt[v].reduce((a,b)=>a+b,0), vtot = v => vol[v].reduce((a,b)=>a+b,0);
  if (!tot("bn") && !tot("hl")) return emptyMsg(ctx,w,h, connected?"collecting…":"press Connect");
  const share = v => cnt[v].map(c => tot(v) ? c/tot(v) : 0), vshare = v => vol[v].map(c => vtot(v) ? c/vtot(v) : 0);
  const sb = share("bn"), sh = share("hl"), vb = vshare("bn"), vh = vshare("hl");
  const max = Math.max(...sb, ...sh, 0.01), L=6, R=6, T=16, B=20, gw = (w-L-R)/7, bw = Math.min(22, gw*0.36);
  ctx.textAlign="center";
  for (let i=0;i<7;i++){
    const cx = L + gw*i + gw/2;
    [[sb[i],vb[i],COL.bn,-1],[sh[i],vh[i],COL.hl,1]].forEach(([s,vs,c,d])=>{
      const bh = s/max*(h-T-B), x = cx + (d<0 ? -bw-1 : 1);
      ctx.fillStyle=c; ctx.globalAlpha=.85; ctx.fillRect(x, h-B-bh, bw, bh); ctx.globalAlpha=1;
      if (vs>0.005){ ctx.fillStyle=c; ctx.font="9.5px ui-monospace,Menlo,monospace"; ctx.fillText((vs*100).toFixed(0)+"%", x+bw/2, h-B-bh-3); }
    });
    ctx.fillStyle="#7d8a99"; ctx.font="10px ui-monospace,Menlo,monospace"; ctx.fillText(labels[i], cx, h-6);
  }
}

function renderAnatomy(){
  if (!hlBook) return;
  const lv = l => ({px:+l.px, sz:+l.sz, n:l.n, avg:+l.sz/Math.max(1,l.n)});
  const bids = hlBook[0].map(lv), asks = hlBook[1].map(lv), all = [...bids, ...asks];
  const maxAvg = Math.max(1e-12, ...all.map(l=>l.avg));
  const sum = (a,k) => a.reduce((x,l)=>x+l[k],0);
  const biggest = all.reduce((a,l)=> !a || l.avg>a.avg ? l : a, null);
  const bAvg = sum(bids,"sz")/Math.max(1,sum(bids,"n")), aAvg = sum(asks,"sz")/Math.max(1,sum(asks,"n"));
  $("anatSum").innerHTML = [
    ["Bid orders (20 lvls)", sum(bids,"n")], ["Ask orders (20 lvls)", sum(asks,"n")],
    ["Bid avg order", fmt(bAvg,4)], ["Ask avg order", fmt(aAvg,4)],
    ["Avg order bid/ask", fmt(bAvg/aAvg,2)+"×"], ["Largest avg level", biggest ? `${fmt(biggest.px,1)} · ${fmt(biggest.avg,3)}` : "–"],
  ].map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("");
  const row = (l,sd) => `<tr><td class="px ${sd}">${fmt(l.px,1)}</td><td>${l.n}</td><td>${fmt(l.sz,3)}</td><td class="bar">${fmt(l.avg,4)}<i style="width:${(l.avg/maxAvg*100).toFixed(0)}%;background:var(--${sd==="b"?"buy":"sell"})"></i></td></tr>`;
  $("anat").innerHTML = `<tr><th>price</th><th>orders</th><th>size</th><th>avg / order</th></tr>` +
    asks.slice(0,10).reverse().map(l=>row(l,"a")).join("") + bids.slice(0,10).map(l=>row(l,"b")).join("");
}

function renderSweeps(){
  const min = +$("swMin").value || 0, t0 = nowEx() - +$("mwin").value;
  const recent = sweeps.filter(s=>s.t>=t0 && s.ntl>=min);
  const stat = v => { const a = recent.filter(s=>s.v===v); return `${a.length} · $${fmtK(a.reduce((x,s)=>x+s.ntl,0))}`; };
  $("swSum").innerHTML = [["BN sweeps (window)", stat("bn")], ["HL sweeps (window)", stat("hl")],
    ["Most levels", recent.length ? Math.max(...recent.map(s=>s.levels)) : "–"]]
    .map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("");
  $("swTable").innerHTML = `<tr><th>time</th><th>venue</th><th>side</th><th>lvls</th><th>fills</th><th>from → to</th><th>Δ</th><th>bps</th><th>$</th></tr>` +
    sweeps.filter(s=>s.ntl>=min).slice(-80).reverse().map(s=>{
      const c = s.side==="buy"?"var(--buy)":"var(--sell)", d = Math.abs(s.to-s.from);
      return `<tr><td>${hhmmss(s.t)}</td><td><span class="venue v-${s.v}">${s.v.toUpperCase()}</span></td><td style="color:${c}">${s.side}</td>
        <td>${s.levels}</td><td>${s.fills}</td><td>${fmt(s.from,1)} → ${fmt(s.to,1)}</td><td>${fmt(d,1)}</td><td>${(d/s.from*1e4).toFixed(1)}</td><td style="color:${c}">${fmtK(s.ntl)}</td></tr>`;
    }).join("");
}

function renderMicro(){
  drawHeat();
  const N = $("imbN").value;
  drawLines($("cvImb"), microHist, [{key:"bnImb"+N, color:COL.bn},{key:"hlImb"+N, color:COL.hl}], {lo:-1.05, hi:1.05, fmt:v=>(v*100).toFixed(0)+"%"});
  drawLines($("cvMicro"), microHist, [{key:"bnMicro", color:COL.bn},{key:"hlMicro", color:COL.hl}], {zero:true});
  drawLines($("cvSpread"), microHist, [{key:"bnSpread", color:COL.bn},{key:"hlSpread", color:COL.hl}], {zero:true});
  drawLines($("cvBasis"), microHist, [{key:"basis", color:"#7aa2f7"}], {zero:true});
  const t0 = nowEx() - +$("mwin").value, b = microHist.filter(r=>r.t>=t0 && r.basis!=null).map(r=>r.basis);
  const mean = b.length ? b.reduce((a,x)=>a+x,0)/b.length : null, sd = b.length>1 ? Math.sqrt(b.reduce((a,x)=>a+(x-mean)**2,0)/(b.length-1)) : null;
  $("basisStats").innerHTML = [["now", b.length?fmt(b[b.length-1],2):"–"], ["mean", fmt(mean,2)], ["std", fmt(sd,2)],
    ["min / max", b.length?`${fmt(Math.min(...b),1)} / ${fmt(Math.max(...b),1)}`:"–"],
    ["z-score now", b.length>1&&sd ? ((b[b.length-1]-mean)/sd).toFixed(2) : "–"]]
    .map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("");
  // trades per second, per venue
  const t1 = nowEx(), secs = Math.ceil(+$("mwin").value/1000), bins = [];
  for (let i=0;i<secs;i++) bins.push({t: t1-(secs-i)*1000+500, bn:0, hl:0});
  for (const t of trades){ if (t.liq || t.bf) continue; const i = secs - 1 - Math.floor((t1-t.t)/1000); if (i>=0 && i<secs) bins[i][t.v]++; }
  drawLines($("cvInt"), bins.slice(0,-1), [{key:"bn", color:COL.bn},{key:"hl", color:COL.hl}], {zero:true});
  drawHist(); renderAnatomy(); renderSweeps();
}
$("mwin").onchange = $("imbN").onchange = $("hmVenue").onchange = $("hmRange").onchange = () => { if (visible("micro")) renderMicro(); };
$("swMin").oninput = renderSweeps;


// ---------- visualizations (editorial views; read-only over existing state) ----------
const VC = {bnbuy:"#2fbf71", bnsell:"#e5534b", hlbuy:"#8fe3b4", hlsell:"#f4a39d"};
const vwin = () => +$("vwin").value;
const vTrades = t0 => trades.filter(t => t.t>=t0 && !t.liq && !t.bf);
const SIZE_EDGES = [1e3, 1e4, 1e5], SIZE_LABELS = ["<1k","1k–10k","10k–100k","≥100k"];
const sizeIdx = n => { let i=0; while (i<3 && n>=SIZE_EDGES[i]) i++; return i; };
let retHist = [], lastRetMid = null;
setInterval(()=>{                                     // 1s Binance mid returns, kept for the whole session
  if (!connected || !M.bnBid || !M.bnAsk) return;
  const mid = (M.bnBid+M.bnAsk)/2;
  if (lastRetMid) retHist.push({t: nowEx(), r: (mid/lastRetMid-1)*1e4});
  lastRetMid = mid; if (retHist.length > 7200) retHist.shift();
}, 1000);

function smoothPath(ctx, xs, ys, move){
  move ? ctx.moveTo(xs[0],ys[0]) : ctx.lineTo(xs[0],ys[0]);
  for (let i=1;i<xs.length;i++) ctx.quadraticCurveTo(xs[i-1], ys[i-1], (xs[i-1]+xs[i])/2, (ys[i-1]+ys[i])/2);
  ctx.lineTo(xs[xs.length-1], ys[ys.length-1]);
}
function label(ctx, txt, x, y, color, align="left", bold=false){
  ctx.font = (bold?"600 ":"")+"11px ui-monospace,Menlo,Consolas,monospace"; ctx.textAlign = align;
  ctx.lineWidth = 3; ctx.strokeStyle = "#0a0d10"; ctx.strokeText(txt, x, y); ctx.fillStyle = color; ctx.fillText(txt, x, y);
  ctx.font = "10.5px ui-monospace,Menlo,Consolas,monospace";
}

function fitLabel(ctx, options, x, y, maxW, color, bold){
  ctx.font = (bold?"600 ":"")+"11px ui-monospace,Menlo,Consolas,monospace";
  for (const t of options){ if (ctx.measureText(t).width <= maxW){ label(ctx, t, x, y, color, "left", bold); return true; } }
  ctx.font = "10.5px ui-monospace,Menlo,Consolas,monospace"; return false;
}

// 1. symmetric streamgraph: buyers above, sellers below
function drawStream(){
  const {ctx,w,h} = prep($("cvStream")), win = vwin(), t1 = nowEx(), t0 = t1-win;
  const BIN = win<=60000 ? 2000 : 4000, n = Math.ceil(win/BIN), keys = ["bnbuy","hlbuy","bnsell","hlsell"], b = {};
  for (const k of keys) b[k] = new Float64Array(n);
  for (const t of vTrades(t0)){ const i = Math.floor((t.t-t0)/BIN); if (i>=0 && i<n) b[t.v+t.side][i] += t.ntl; }
  for (const k of keys){ const a = b[k], c = Float64Array.from(a); for (let i=0;i<n;i++) a[i] = (c[Math.max(0,i-1)] + 2*c[i] + c[Math.min(n-1,i+1)])/4; }
  let max = 0; for (let i=0;i<n;i++) max = Math.max(max, b.bnbuy[i]+b.hlbuy[i], b.bnsell[i]+b.hlsell[i]);
  if (!max) return emptyMsg(ctx,w,h, connected?"waiting for trades…":"press Connect");
  const L=8, R=8, T=10, B=18, cy = T+(h-T-B)/2, sc = (h-T-B)/2/max*0.95;
  const xs = Array.from({length:n}, (_,i)=> L+(i+.5)/n*(w-L-R));
  const layers = [["bnbuy",-1,0,"bnbuy"],["hlbuy",-1,"bnbuy","hlbuy"],["bnsell",1,0,"bnsell"],["hlsell",1,"bnsell","hlsell"]];
  for (const [k, dir, under] of layers){
    const lo = xs.map((_,i)=> under ? b[under][i] : 0), hi = lo.map((v,i)=> v + b[k][i]);
    ctx.beginPath(); smoothPath(ctx, xs, hi.map(v=>cy+dir*v*sc), true);
    smoothPath(ctx, [...xs].reverse(), [...lo].reverse().map(v=>cy+dir*v*sc), false);
    ctx.closePath(); ctx.fillStyle = VC[k]; ctx.globalAlpha = .88; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = "#0a0d10"; ctx.lineWidth = 1; ctx.stroke();
    let bi = 0; for (let i=1;i<n;i++) if (b[k][i] > b[k][bi]) bi = i;
    if (b[k][bi]*sc > 16){ const y = cy + dir*(lo[bi] + b[k][bi]/2)*sc; label(ctx, `${k.slice(0,2).toUpperCase()} ${k.slice(2)} $${fmtK(b[k][bi])}`, xs[bi], y+4, "#0d1014", "center", true); }
  }
  ctx.strokeStyle = "#cfd6de"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L,cy); ctx.lineTo(w-R,cy); ctx.stroke();
  label(ctx, `buy $${fmtK(max)}/${BIN/1000}s`, L+2, T+10, "#7d8a99"); label(ctx, "sell", L+2, h-B-4, "#7d8a99");
  timeAxis(ctx, t => L+(t-t0)/win*(w-L-R), t0, t1, h, B, L, R, w);
}

// 2. beeswarm rows by $ size (log)
function drawSwarm(){
  const {ctx,w,h} = prep($("cvSwarm")), t0 = nowEx()-vwin();
  const rows = [["bn","buy"],["bn","sell"],["hl","buy"],["hl","sell"]], tr = vTrades(t0);
  if (!tr.length) return emptyMsg(ctx,w,h, connected?"waiting for trades…":"press Connect");
  const L=62, R=14, T=20, B=8, rh = (h-T-B)/4, x0 = 0.5, x1 = 6.3;
  const X = v => L + (Math.log10(Math.max(3,v))-x0)/(x1-x0)*(w-L-R);
  ctx.textAlign="center";
  for (const [v,lab] of [[10,"$10"],[100,"$100"],[1e3,"$1k"],[1e4,"$10k"],[1e5,"$100k"],[1e6,"$1M"]]){
    const x = X(v); ctx.strokeStyle="#1e252e"; ctx.beginPath(); ctx.moveTo(x,T-4); ctx.lineTo(x,h-B); ctx.stroke(); ctx.fillStyle="#7d8a99"; ctx.fillText(lab, x, 11);
  }
  const rr = 2.7, gap = rr*2+0.4;
  rows.forEach(([v,side], r)=>{
    const cy = T + rh*(r+.5), pts = tr.filter(t=>t.v===v && t.side===side).slice(-300).map(t=>({x:X(t.ntl), t})).sort((a,b)=>a.x-b.x);
    label(ctx, `${v.toUpperCase()} ${side}`, 4, cy+4, VC[v+side], "left", true);
    if (!pts.length) return;
    ctx.strokeStyle = VC[v+side]; ctx.globalAlpha=.6; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(pts[0].x,cy); ctx.lineTo(pts[pts.length-1].x,cy); ctx.stroke(); ctx.globalAlpha=1;
    const placed = [], lim = rh/2 - rr;
    for (const p of pts){
      let y = cy;
      for (let k=0; k<60; k++){
        const off = (k%2 ? 1 : -1) * Math.ceil(k/2) * gap; if (Math.abs(off) > lim){ y = null; break; }
        y = cy + off; let hit = false;
        for (let j=placed.length-1; j>=0 && placed[j].x > p.x-2*rr; j--) if (Math.hypot(placed[j].x-p.x, placed[j].y-y) < 2*rr){ hit = true; break; }
        if (!hit) break;
      }
      if (y==null) continue;
      placed.push({x:p.x, y});
      ctx.fillStyle = VC[v+side]; ctx.globalAlpha=.8; ctx.beginPath(); ctx.arc(p.x, y, rr, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
    }
    const big = pts[pts.length-1];
    ctx.strokeStyle="#fff"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(big.x, cy, rr+2, 0, Math.PI*2); ctx.stroke();
    label(ctx, "$"+fmtK(big.t.ntl), Math.min(big.x+8, w-40), cy-6, "#e6edf3");
  });
}

// 3. diverging delta-by-price bars
function drawProfile(){
  const {ctx,w,h} = prep($("cvProf")), v = $("profVenue").value, t0 = nowEx()-vwin();
  const tr = vTrades(t0).filter(t=>t.v===v);
  if (tr.length < 3) return emptyMsg(ctx,w,h, connected?"waiting for trades…":"press Connect");
  let lo = Infinity, hi = -Infinity; for (const t of tr){ lo = Math.min(lo,t.px); hi = Math.max(hi,t.px); }
  const st = niceStep(Math.max((hi-lo)/20, hi*1e-6)), base = Math.floor(lo/st)*st, nb = Math.floor((hi-base)/st)+1;
  const buy = new Float64Array(nb), sell = new Float64Array(nb);
  for (const t of tr){ const i = Math.min(nb-1, Math.floor((t.px-base)/st)); t.side==="buy" ? buy[i]+=t.ntl : sell[i]+=t.ntl; }
  const net = Array.from(buy, (b,i)=> b-sell[i]), mx = Math.max(1, ...net.map(Math.abs));
  const L=70, R=50, T=8, B=8, rh = (h-T-B)/nb, cx = L + (w-L-R)/2, half = (w-L-R)/2 - 44;
  ctx.strokeStyle="#4a5462"; ctx.beginPath(); ctx.moveTo(cx,T); ctx.lineTo(cx,h-B); ctx.stroke();
  for (let i=0;i<nb;i++){
    const y = T + (nb-1-i)*rh, bh = Math.max(2, rh*0.64), yy = y + (rh-bh)/2, len = Math.abs(net[i])/mx*half, pos = net[i]>=0;
    ctx.fillStyle="#7d8a99"; ctx.textAlign="right"; ctx.fillText(fmt(base+i*st, st<1?1:0), L-6, y+rh/2+3.5);
    if (buy[i]+sell[i] === 0) continue;
    ctx.fillStyle = pos ? COL.buy : COL.sell; ctx.fillRect(pos ? cx : cx-len, yy, Math.max(1,len), bh);
    label(ctx, (pos?"+":"−")+"$"+fmtK(Math.abs(net[i])), pos ? cx+len+4 : cx-len-4, y+rh/2+4, pos?COL.buy:COL.sell, pos?"left":"right", true);
    const share = buy[i]/(buy[i]+sell[i]);
    ctx.fillStyle = "#c3cfdb"; ctx.textAlign="right"; ctx.fillText((share*100).toFixed(0)+"%", w-6, y+rh/2+3.5);
  }
  ctx.fillStyle="#7d8a99"; ctx.textAlign="right"; ctx.fillText("buy %", w-6, T+2);
  const b = v==="bn" ? M.bnBid : M.hlBid, a = v==="bn" ? M.bnAsk : M.hlAsk;
  if (b && a){ const mid=(a+b)/2, y = T + (nb-1-(mid-base)/st + 0.5)*rh;
    if (y>T && y<h-B){ ctx.setLineDash([4,3]); ctx.strokeStyle="#fff"; ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(w-R,y); ctx.stroke(); ctx.setLineDash([]); label(ctx, "mid", L+2, y-3, "#fff"); } }
}

// 4. basis anomaly vs trailing normal
function drawAnomaly(){
  const {ctx,w,h} = prep($("cvAnom")), win = vwin(), t1 = nowEx(), t0 = t1-win;
  const all = microHist.filter(r => r.basis!=null);
  const pts = [];
  let j = 0, sum = 0, sq = 0;
  for (let i=0;i<all.length;i++){                          // trailing 60s mean / σ, two-pointer window
    sum += all[i].basis; sq += all[i].basis**2;
    while (all[i].t - all[j].t > 60000){ sum -= all[j].basis; sq -= all[j].basis**2; j++; }
    const n = i-j+1, m = sum/n, sd = Math.sqrt(Math.max(0, sq/n - m*m));
    if (all[i].t >= t0 && n >= 20) pts.push({t:all[i].t, v:all[i].basis, m, sd});
  }
  if (pts.length < 2) return emptyMsg(ctx,w,h, connected?"building a 60s baseline…":"press Connect");
  let lo = Infinity, hi = -Infinity; for (const p of pts){ lo = Math.min(lo, p.v, p.m-2*p.sd); hi = Math.max(hi, p.v, p.m+2*p.sd); }
  const pad = (hi-lo)*.12 || 1; lo -= pad; hi += pad;
  const L=6, R=54, T=14, B=18, X = t => L+(t-t0)/win*(w-L-R), Y = v => T+(hi-v)/(hi-lo)*(h-T-B);
  const st = niceStep((hi-lo)/4); ctx.textAlign="left";
  for (let v=Math.ceil(lo/st)*st; v<=hi; v+=st){ ctx.strokeStyle="#1e252e"; ctx.beginPath(); ctx.moveTo(L,Y(v)); ctx.lineTo(w-R,Y(v)); ctx.stroke(); ctx.fillStyle="#7d8a99"; ctx.fillText(fmt(v, st<1?1:0), w-R+4, Y(v)+3.5); }
  timeAxis(ctx, X, t0, t1, h, B, L, R, w);
  for (let i=1;i<pts.length;i++){
    const a = pts[i-1], b = pts[i], z = b.sd ? (b.v-b.m)/b.sd : 0;
    ctx.fillStyle = z>2 ? "#b3261e" : z>0 ? "#e8806f" : z<-2 ? "#1f5fb0" : "#6fa8e0";
    ctx.beginPath(); ctx.moveTo(X(a.t),Y(a.m)); ctx.lineTo(X(a.t),Y(a.v)); ctx.lineTo(X(b.t),Y(b.v)); ctx.lineTo(X(b.t),Y(b.m)); ctx.closePath(); ctx.fill();
  }
  const line = (f, color, dash, wd) => { ctx.setLineDash(dash); ctx.strokeStyle=color; ctx.lineWidth=wd; ctx.beginPath(); pts.forEach((p,i)=> i ? ctx.lineTo(X(p.t),Y(f(p))) : ctx.moveTo(X(p.t),Y(f(p)))); ctx.stroke(); ctx.setLineDash([]); };
  line(p=>p.m+2*p.sd, "#7d8a99", [3,3], 1); line(p=>p.m-2*p.sd, "#7d8a99", [3,3], 1); line(p=>p.m, "#f2f4f7", [], 2);
  const zOf = p => p.sd ? (p.v-p.m)/p.sd : 0;
  const top = pts.reduce((a,p)=> zOf(p)>zOf(a) ? p : a), bot = pts.reduce((a,p)=> zOf(p)<zOf(a) ? p : a);
  for (const p of [top, bot]){ const z = zOf(p); if (Math.abs(z) < 1) continue;
    ctx.fillStyle="#fff"; ctx.strokeStyle="#0a0d10"; ctx.beginPath(); ctx.arc(X(p.t),Y(p.v),3.5,0,Math.PI*2); ctx.fill(); ctx.stroke();
    label(ctx, (z>0?"+":"")+z.toFixed(1)+"σ", X(p.t), Y(p.v)+(z>0?-8:15), "#fff", "center", true); }
  const last = pts[pts.length-1]; label(ctx, "normal", X(last.t)-4, Y(last.m)-5, "#f2f4f7", "right");
}

// 5. shifting bell curve of 1s returns
function drawBell(){
  const {ctx,w,h} = prep($("cvBell"));
  if (retHist.length < 30){ $("bellHead").textContent=""; $("bellLeg").innerHTML=""; return emptyMsg(ctx,w,h, connected?`collecting returns… ${retHist.length}/30s`:"press Connect"); }
  const all = retHist.map(x=>x.r), mu = all.reduce((a,b)=>a+b,0)/all.length;
  const sd = Math.sqrt(all.reduce((a,b)=>a+(b-mu)**2,0)/(all.length-1)) || 1e-9;
  const zs = all.map(r=>(r-mu)/sd), cur = retHist.filter(x=>x.t >= nowEx()-60000).map(x=>(x.r-mu)/sd);
  const kde = (arr, x) => { const bw = 0.35; let s = 0; for (const z of arr) s += Math.exp(-0.5*((x-z)/bw)**2); return s/(arr.length*bw*Math.sqrt(2*Math.PI)); };
  const N = 160, xs = Array.from({length:N}, (_,i)=> -5 + i*10/(N-1));
  const dBase = xs.map(x=>kde(zs,x)), dCur = cur.length ? xs.map(x=>kde(cur,x)) : xs.map(()=>0);
  const max = Math.max(...dBase, ...dCur), L=10, R=10, T=8, B=22;
  const X = z => L+(z+5)/10*(w-L-R), Y = d => h-B-(d/max)*(h-T-B)*0.95;
  const edges = [-Infinity,-3,-2,-0.43,0.43,2,3,Infinity];
  const cols = ["#1f4e9c","#4a86d6","#a9c8ee","#e9e9e4","#f2c39b","#e07a45","#9b2a1c"];
  const names = ["−3σ or worse","−3σ to −2σ","−2σ to −0.43σ","normal ±0.43σ","+0.43σ to +2σ","+2σ to +3σ","+3σ or more"];
  for (let k=0;k<7;k++){
    ctx.beginPath(); let started = false;
    for (let i=0;i<N;i++){ if (xs[i] < edges[k] || xs[i] > edges[k+1]) continue; const x=X(xs[i]), y=Y(dCur[i]); if (!started){ ctx.moveTo(x,h-B); started=true; } ctx.lineTo(x,y); }
    if (!started) continue;
    const lastX = X(Math.min(5, edges[k+1])); ctx.lineTo(lastX, h-B); ctx.closePath(); ctx.fillStyle = cols[k]; ctx.fill();
  }
  ctx.strokeStyle="#f2f4f7"; ctx.lineWidth=1.6; ctx.beginPath(); xs.forEach((x,i)=> i ? ctx.lineTo(X(x),Y(dCur[i])) : ctx.moveTo(X(x),Y(dCur[i]))); ctx.stroke();
  ctx.setLineDash([3,3]); ctx.strokeStyle="#9aa6b2"; ctx.lineWidth=1.2; ctx.beginPath(); xs.forEach((x,i)=> i ? ctx.lineTo(X(x),Y(dBase[i])) : ctx.moveTo(X(x),Y(dBase[i]))); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle="#7d8a99"; ctx.textAlign="center";
  for (let z=-4; z<=4; z++) ctx.fillText((z>0?"+":"")+z+"σ", X(z), h-8);
  const pct = k => cur.length ? cur.filter(z=>z>=edges[k] && z<edges[k+1]).length/cur.length*100 : 0;
  const tails = pct(0)+pct(1)+pct(5)+pct(6);
  $("bellHead").innerHTML = `<b>${tails.toFixed(0)}%</b> of the last 60 seconds moved more than 2σ · 1σ = ${sd.toFixed(2)} bps (session of ${all.length}s)`;
  $("bellLeg").innerHTML = names.map((n,k)=>`<span><i style="background:${cols[k]}"></i>${n} <b style="color:var(--text)">${pct(k).toFixed(0)}%</b></span>`).join("");
}

// 6. radial clock of the last minute
function drawRadial(){
  const {ctx,w,h} = prep($("cvRad")), t1 = nowEx(), cx = w/2, cy = h/2, R = Math.min(w,h)/2-22, r0 = R*0.26;
  const bins = {}; for (const v of ["bn","hl"]) bins[v] = Array.from({length:60}, ()=>({buy:0,sell:0,age:60}));
  for (const t of vTrades(t1-60000)){ const sec = Math.floor(t.t/1000)%60, b = bins[t.v][sec]; b[t.side] += t.ntl; b.age = Math.min(b.age, (t1-t.t)/1000); }
  const ring = {hl:[r0, r0+(R-r0)*0.38], bn:[r0+(R-r0)*0.44, R]}, ang = s => -Math.PI/2 + (s/60)*Math.PI*2;
  ctx.strokeStyle="#1e252e"; ctx.lineWidth=1;
  for (const v of ["bn","hl"]) for (const r of ring[v]){ ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke(); }
  ctx.fillStyle="#7d8a99"; ctx.textAlign="center";
  for (let s=0;s<60;s+=5){ const a=ang(s); ctx.fillText(String(s), cx+Math.cos(a)*(R+12), cy+Math.sin(a)*(R+12)+3.5); }
  let tot = 0, buyTot = 0;
  for (const v of ["bn","hl"]){
    const [ri, ro] = ring[v], mx = Math.max(1, ...bins[v].map(b=>b.buy+b.sell));
    bins[v].forEach((b, s)=>{
      const sum = b.buy+b.sell; if (!sum) return; tot += sum; buyTot += b.buy;
      const len = Math.sqrt(sum/mx)*(ro-ri), a0 = ang(s)+0.012, a1 = ang(s+1)-0.012, rb = ri + len*b.buy/sum;
      ctx.globalAlpha = 1 - Math.min(0.75, b.age/60*0.75);
      for (const [ra, rz, c] of [[ri, rb, v==="bn"?VC.bnbuy:VC.hlbuy],[rb, ri+len, v==="bn"?VC.bnsell:VC.hlsell]]){
        if (rz-ra < 0.3) continue;
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx,cy,rz,a0,a1); ctx.arc(cx,cy,ra,a1,a0,true); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
    label(ctx, v.toUpperCase(), cx, cy - (ri+ro)/2 - 0, "#7d8a99", "center");
  }
  const now = (t1/1000)%60, a = ang(now);
  ctx.strokeStyle="#fff"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*r0*0.9, cy+Math.sin(a)*r0*0.9); ctx.lineTo(cx+Math.cos(a)*(R+4), cy+Math.sin(a)*(R+4)); ctx.stroke();
  ctx.fillStyle="#e6edf3"; ctx.textAlign="center"; ctx.font="600 15px ui-monospace,Menlo,monospace"; ctx.fillText("$"+fmtK(tot), cx, cy+2);
  ctx.font="10.5px ui-monospace,Menlo,monospace"; ctx.fillStyle = buyTot/tot>=.5 ? COL.buy : COL.sell;
  ctx.fillText(tot ? `${(buyTot/tot*100).toFixed(0)}% buy` : "", cx, cy+16);
}

// 7. treemap: venue → side × size
function squarify(items, x, y, w, h){
  const out = []; let rest = items.filter(q=>q.a>0);
  while (rest.length && w>0.5 && h>0.5){
    const short = Math.min(w,h), worst = r => { const s=r.reduce((a,q)=>a+q.a,0), mx=Math.max(...r.map(q=>q.a)), mn=Math.min(...r.map(q=>q.a)); return Math.max(short*short*mx/(s*s), s*s/(short*short*mn)); };
    let row = [rest[0]], i = 1;
    while (i<rest.length && worst([...row, rest[i]]) <= worst(row)){ row.push(rest[i]); i++; }
    const s = row.reduce((a,q)=>a+q.a,0);
    if (w >= h){ const cw = s/h; let yy = y; for (const q of row){ const ch = q.a/cw; out.push({...q, x, y:yy, w:cw, h:ch}); yy += ch; } x += cw; w -= cw; }
    else { const ch = s/w; let xx = x; for (const q of row){ const cw = q.a/ch; out.push({...q, x:xx, y, w:cw, h:ch}); xx += cw; } y += ch; h -= ch; }
    rest = rest.slice(i);
  }
  return out;
}
function drawTree(){
  const {ctx,w,h} = prep($("cvTree")), tr = vTrades(nowEx()-vwin());
  const vol = {}; let total = 0;
  for (const t of tr){ const k = `${t.v}|${t.side}|${sizeIdx(t.ntl)}`; vol[k] = (vol[k]||0)+t.ntl; total += t.ntl; }
  if (!total) return emptyMsg(ctx,w,h, connected?"waiting for trades…":"press Connect");
  const area = w*h, venues = ["bn","hl"].map(v=>({v, val: Object.keys(vol).filter(k=>k.startsWith(v)).reduce((a,k)=>a+vol[k],0)}))
    .map(q=>({...q, a:q.val/total*area})).sort((a,b)=>b.a-a.a);
  for (const g of squarify(venues, 0, 0, w, h)){
    const P = 3, gx = g.x+P, gy = g.y+16, gw = g.w-2*P, gh = g.h-16-P;
    ctx.fillStyle = "#11161c"; ctx.fillRect(g.x+1, g.y+1, g.w-2, g.h-2);
    const pc = (g.val/total*100).toFixed(0)+"%", nm = g.v==="bn" ? "Binance" : "Hyperliquid";
    fitLabel(ctx, [`${nm} · $${fmtK(g.val)} · ${pc}`, `${nm} · ${pc}`, `${g.v.toUpperCase()} ${pc}`, g.v.toUpperCase()], g.x+5, g.y+12, g.w-8, COL[g.v], true);
    if (gw<4 || gh<4) continue;
    const leaves = [];
    for (const side of ["buy","sell"]) for (let s=0;s<4;s++){ const val = vol[`${g.v}|${side}|${s}`]||0; if (val) leaves.push({side, s, val}); }
    leaves.forEach(q => q.a = q.val/g.val*gw*gh); leaves.sort((a,b)=>b.a-a.a);
    for (const c of squarify(leaves, gx, gy, gw, gh)){
      const shade = [0.42,0.6,0.8,1][c.s], base = c.side==="buy" ? [47,191,113] : [229,83,75];
      ctx.fillStyle = `rgb(${base.map(v=>Math.round(14+(v-14)*shade)).join(",")})`;
      ctx.fillRect(c.x+1, c.y+1, Math.max(0,c.w-2), Math.max(0,c.h-2));
      const mw = c.w-8;
      if (c.h > 30 && fitLabel(ctx, [`${c.side} ${SIZE_LABELS[c.s]}`, SIZE_LABELS[c.s]], c.x+4, c.y+14, mw, "#f5f7fa")) fitLabel(ctx, [`$${fmtK(c.val)}`], c.x+4, c.y+27, mw, "#f5f7fa", true);
      else if (c.h > 15) fitLabel(ctx, [`$${fmtK(c.val)}`], c.x+4, c.y+12, mw, "#f5f7fa");
    }
  }
}

// 8. waterfall of net delta by venue × size
function drawWater(){
  const {ctx,w,h} = prep($("cvWater")), tr = vTrades(nowEx()-vwin());
  if (!tr.length) return emptyMsg(ctx,w,h, connected?"waiting for trades…":"press Connect");
  const steps = [];
  for (const v of ["bn","hl"]) for (let s=0;s<4;s++){ let d = 0; for (const t of tr) if (t.v===v && sizeIdx(t.ntl)===s) d += t.side==="buy" ? t.ntl : -t.ntl; steps.push({v, s, d}); }
  let run = 0; const bars = steps.map(st => { const a = run; run += st.d; return {...st, a, b: run}; });
  const lo = Math.min(0, ...bars.map(b=>Math.min(b.a,b.b))), hi = Math.max(0, ...bars.map(b=>Math.max(b.a,b.b)));
  const pad = (hi-lo)*.12 || 1, ylo = lo-pad, yhi = hi+pad, L=8, R=54, T=10, B=34, n = bars.length+1, cw = (w-L-R)/n;
  const Y = v => T+(yhi-v)/(yhi-ylo)*(h-T-B);
  ctx.fillStyle = "rgba(240,185,11,.06)"; ctx.fillRect(L, T, cw*4, h-T-B+16);
  ctx.fillStyle = "rgba(95,212,196,.06)"; ctx.fillRect(L+cw*4, T, cw*4, h-T-B+16);
  label(ctx, "Binance", L+cw*2, h-4, COL.bn, "center", true); label(ctx, "Hyperliquid", L+cw*6, h-4, COL.hl, "center", true);
  const st = niceStep((yhi-ylo)/4); ctx.textAlign="left";
  for (let v=Math.ceil(ylo/st)*st; v<=yhi; v+=st){ ctx.strokeStyle = v===0 ? "#4a5462" : "#1e252e"; ctx.beginPath(); ctx.moveTo(L,Y(v)); ctx.lineTo(w-R,Y(v)); ctx.stroke(); ctx.fillStyle="#7d8a99"; ctx.fillText("$"+fmtK(v), w-R+4, Y(v)+3.5); }
  bars.forEach((b,i)=>{
    const x = L+cw*i+cw*.18, bw = cw*.64, pos = b.d >= 0;
    ctx.fillStyle = pos ? COL.buy : COL.sell; ctx.fillRect(x, Y(Math.max(b.a,b.b)), bw, Math.max(1, Math.abs(Y(b.a)-Y(b.b))));
    ctx.setLineDash([2,2]); ctx.strokeStyle="#7d8a99"; ctx.beginPath(); ctx.moveTo(x+bw, Y(b.b)); ctx.lineTo(x+cw, Y(b.b)); ctx.stroke(); ctx.setLineDash([]);   // connector to the next bar (also to "net")
    const short = v => { const a=Math.abs(v); return a>=1e6 ? (a/1e6).toFixed(1)+"M" : a>=1e3 ? Math.round(a/1e3)+"k" : a.toFixed(0); };
    let vt = (pos?"+":"−")+fmtK(Math.abs(b.d)); if (ctx.measureText(vt).width > cw+6) vt = (pos?"+":"−")+short(b.d);
    if (Math.abs(b.d) > 0 && ctx.measureText(vt).width <= cw+6) label(ctx, vt, x+bw/2, pos ? Y(b.b)-4 : Y(b.b)+12, pos?COL.buy:COL.sell, "center");
    ctx.fillStyle="#7d8a99";
    const sl = ctx.measureText(SIZE_LABELS[b.s]).width <= cw-2 ? SIZE_LABELS[b.s] : ["<1k","<10k","<100k","≥100k"][b.s]; // compact on narrow screens
    ctx.textAlign="center"; ctx.fillText(sl, x+bw/2, h-B+12);
  });
  const x = L+cw*(n-1)+cw*.18, bw = cw*.64, pos = run>=0;
  ctx.fillStyle = pos ? "#1f8a52" : "#a8352e"; ctx.fillRect(x, Y(Math.max(0,run)), bw, Math.max(1, Math.abs(Y(0)-Y(run))));
  ctx.strokeStyle="#fff"; ctx.strokeRect(x, Y(Math.max(0,run)), bw, Math.max(1, Math.abs(Y(0)-Y(run))));
  label(ctx, (pos?"+":"−")+fmtK(Math.abs(run)), x+bw/2, pos ? Y(run)-4 : Y(0)-5, "#fff", "center", true); // net value sits beside the zero line, never off-canvas
  ctx.fillStyle="#e6edf3"; ctx.textAlign="center"; ctx.fillText("net", x+bw/2, h-B+12);
}

// 9. fan of trades from mid into a marginal density
function drawFan(){
  const {ctx,w,h} = prep($("cvFan")), tr = vTrades(nowEx()-30000).filter(t=>t.mid);
  if (tr.length < 3) return emptyMsg(ctx,w,h, connected?"waiting for trades…":"press Connect");
  const off = tr.map(t => (t.px - t.mid)/t.mid*1e4), sorted = off.map(Math.abs).sort((a,b)=>a-b);
  const lim = Math.max(1, sorted[Math.floor(sorted.length*0.98)]*1.15);
  const L=60, T=10, B=10, ox = L, oy = T+(h-T-B)/2, xe = w*0.64, dx0 = xe+8, dx1 = w-14;
  const Y = b => oy - Math.max(-lim, Math.min(lim, b))/lim*(h-T-B)/2;
  const maxN = Math.max(...tr.map(t=>t.ntl));
  ctx.strokeStyle="#1e252e"; ctx.fillStyle="#7d8a99"; ctx.textAlign="right";
  const st = niceStep(lim/3);
  for (let b=-Math.floor(lim/st)*st; b<=lim; b+=st){ ctx.beginPath(); ctx.moveTo(xe,Y(b)); ctx.lineTo(dx1,Y(b)); ctx.stroke(); ctx.fillText((b>0?"+":"")+fmt(b, st<1?1:0)+" bps", xe-4, Y(b)+3.5); }
  const order = tr.map((t,i)=>i).sort((a,b)=>tr[a].ntl-tr[b].ntl);
  for (const i of order){
    const t = tr[i], y = Y(off[i]), f = Math.sqrt(t.ntl/maxN);
    ctx.strokeStyle = t.side==="buy" ? COL.buy : COL.sell; ctx.globalAlpha = 0.08 + 0.6*f; ctx.lineWidth = 0.6 + 2.6*f;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.bezierCurveTo(ox+(xe-ox)*0.45, oy, ox+(xe-ox)*0.55, y, xe, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(ox, oy, 4, 0, Math.PI*2); ctx.fill();
  label(ctx, "mid", ox-8, oy+4, "#e6edf3", "right", true);
  const NB = 48, dens = new Float64Array(NB);
  tr.forEach((t,i)=>{ const k = Math.max(0, Math.min(NB-1, Math.floor((off[i]+lim)/(2*lim)*NB))); dens[k] += t.ntl; });
  const sm = Array.from(dens, (_,k)=> (dens[Math.max(0,k-1)] + 2*dens[k] + dens[Math.min(NB-1,k+1)])/4), dm = Math.max(...sm) || 1;
  const yk = k => T + (1 - (k+.5)/NB)*(h-T-B);
  for (const [cond, c] of [[k=>yk(k)<=oy, COL.buy],[k=>yk(k)>=oy, COL.sell]]){
    ctx.beginPath(); ctx.moveTo(dx0, oy); let any = false;
    for (let k=0;k<NB;k++) if (cond(k)){ ctx.lineTo(dx0 + sm[k]/dm*(dx1-dx0), yk(k)); any = true; }
    if (!any) continue;
    ctx.lineTo(dx0, cond(0) ? yk(0) : yk(NB-1)); ctx.closePath(); ctx.fillStyle = c; ctx.globalAlpha=.35; ctx.fill(); ctx.globalAlpha=1; ctx.strokeStyle=c; ctx.stroke();
  }
  ctx.strokeStyle="#cfd6de"; ctx.beginPath(); ctx.moveTo(dx0, T); ctx.lineTo(dx0, h-B); ctx.stroke();
  const above = tr.reduce((a,t,i)=> a + (off[i]>0 ? t.ntl : 0), 0), totN = tr.reduce((a,t)=>a+t.ntl,0);
  label(ctx, `${(above/totN*100).toFixed(0)}% of $ above mid`, dx1, T+12, COL.buy, "right", true);
  label(ctx, `${(100-above/totN*100).toFixed(0)}% at/below`, dx1, h-B-4, COL.sell, "right", true);
}

const VIZ = [[drawStream,"cvStream"],[drawSwarm,"cvSwarm"],[drawProfile,"cvProf"],[drawAnomaly,"cvAnom"],[drawBell,"cvBell"],[drawRadial,"cvRad"],[drawTree,"cvTree"],[drawWater,"cvWater"],[drawFan,"cvFan"]];
function renderViz(){
  for (const [f, id] of VIZ){
    if (!$(id).clientWidth) continue;                              // panel is on a hidden tab: nothing to draw (and a 0-size canvas makes arc() throw)
    try{ f(); }catch(e){ console.error(f.name, e); }               // one broken panel must not blank the rest
  }
}
$("vwin").onchange = $("profVenue").onchange = () => { if (visible("viz")) renderViz(); };

// ---------- tabs ----------
const TABS = [["overview","Overview"],["charts","Charts"],["micro","Micro"],["reader","Reader"],["viz","Visualizations"],["trading","Trading"],["accounts","Accounts"],["market","Market"],["tape","Tape"],["streams","Streams"],["health","Health"],["raw","Raw"]];
// Five groups; a group with several views shows them as a sub-row. A "view" is what data-tab on a <section> names.
const GROUPS = [["live","Live",["overview","charts","micro","viz","tape"]],["reader","Reader",["reader"]],["trade","Trade",["trading","accounts"]],["market","Market",["market"]],["diag","Diagnostics",["streams","health","raw"]]];
const groupOf = v => GROUPS.find(g=>g[2].includes(v)) || GROUPS[0];
let tab = "overview";
function setTab(t){
  tab = t;
  const g = groupOf(t), last = store.get("lastView", {}); last[g[0]] = t; store.set("lastView", last); store.set("view", t);
  document.querySelectorAll("#groups button").forEach(b=>b.classList.toggle("act", b.dataset.g===g[0]));
  $("views").hidden = g[2].length < 2;
  $("views").innerHTML = g[2].length < 2 ? "" : g[2].map(v=>`<button data-t="${v}" class="${v===t?"act":""}">${TABS.find(x=>x[0]===v)[1]}</button>`).join("");
  document.querySelectorAll("main section").forEach(s=>s.classList.toggle("hide", s.dataset.tab!==t));
  dirty = true; renderSlow();
}
const visible = name => tab===name || (tab==="trading" && !!document.querySelector(`#tgrid section[data-home="${name}"]`));
$("groups").innerHTML = GROUPS.map(([id,l])=>`<button data-g="${id}">${l}</button>`).join("");
$("groups").onclick = e => { const b = e.target.closest("button"); if (!b) return; const g = GROUPS.find(x=>x[0]===b.dataset.g), last = store.get("lastView", {})[g[0]]; setTab(g[2].includes(last) ? last : g[2][0]); window.scrollTo(0, 0); };
$("views").onclick = e => { const b = e.target.closest("button"); if (b) setTab(b.dataset.t); };


// ---------- accounts (keys in memory only) ----------
const ACC = {mode:null, key:null, secret:null, base:null, maxUsd:Infinity, status:"", data:null, filters:{}};
const BASES = {demo:"https://demo-fapi.binance.com", live:"https://fapi.binance.com"};
const accSym = () => bnSym().toUpperCase();
const accAsset = () => $("sym").value.trim().toUpperCase();

async function hmacHex(secret, msg){
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function bnSigned(method, path, params={}){
  if (!window.crypto || !crypto.subtle) throw new Error("this browser context has no WebCrypto; open the file directly in Chrome");
  const q = new URLSearchParams({...params, recvWindow:"5000", timestamp:String(Math.round(Date.now()+clockOffset))}).toString();
  const url = `${ACC.base}${path}?${q}&signature=${await hmacHex(ACC.secret, q)}`;
  let r;
  try{ r = await fetch(url, {method, headers:{"X-MBX-APIKEY":ACC.key}}); }
  catch(e){ throw new Error("request blocked before reaching Binance (network or browser CORS)"); }
  const txt = await r.text(); let j; try{ j = JSON.parse(txt); }catch{ j = {msg:txt.slice(0,120)}; }
  if (!r.ok) throw new Error(`Binance ${j.code ?? r.status}: ${j.msg || "error"}`);
  return j;
}
async function loadFilters(){
  const sym = accSym(); if (ACC.filters[sym]) return ACC.filters[sym];
  let j = null;
  for (const base of [ACC.mode==="demo" ? BASES.demo : null, BN_REST].filter(Boolean)){
    try{ const r = await fetch(`${base}/fapi/v1/exchangeInfo`); if (r.ok){ j = await r.json(); break; } }catch{}
  }
  if (!j) throw new Error("could not load symbol rules (exchangeInfo)");
  const sd = j.symbols.find(x=>x.symbol===sym); if (!sd) throw new Error(`${sym} is not a USD-M futures symbol`);
  const f = k => sd.filters.find(x=>x.filterType===k) || {};
  return ACC.filters[sym] = {tick:+f("PRICE_FILTER").tickSize, step:+f("LOT_SIZE").stepSize, minQty:+f("LOT_SIZE").minQty, minNotional:+(f("MIN_NOTIONAL").notional||0)};
}
const decOf = x => { const s = Number(x).toString(); if (s.includes("e-")) return +s.split("e-")[1]; return (s.split(".")[1]||"").length; };
const roundStep = (v, step) => (Math.floor(v/step + 1e-9)*step).toFixed(decOf(step));
const roundTick = (v, tick) => (Math.round(v/tick)*tick).toFixed(decOf(tick));

// ---- simulated paper broker ----
let SIM = null;
function simReset(start){ SIM = {start, cash:start, positions:{}, orders:[], fills:[], nextId:1}; }
// one position per asset: the header lets you switch asset while the paper account is live
const simPos = (sym=accSym()) => (SIM.positions[sym] ||= {symbol:sym, qty:0, entry:0, mark:null});
function simFill(side, qty, price, maker){
  const fee = qty*price*(maker ? 0.0002 : 0.0005), p = simPos(), signed = side==="BUY" ? qty : -qty; let pnl = 0;
  SIM.cash -= fee;
  if (p.qty===0 || Math.sign(p.qty)===Math.sign(signed)){ p.entry = (p.entry*Math.abs(p.qty) + price*qty)/(Math.abs(p.qty)+qty); p.qty += signed; }
  else {
    const close = Math.min(Math.abs(p.qty), qty); pnl = close*(price-p.entry)*Math.sign(p.qty); SIM.cash += pnl;
    const wasSign = Math.sign(p.qty); p.qty += signed;
    if (Math.abs(p.qty) < 1e-12){ p.qty = 0; p.entry = 0; } else if (Math.sign(p.qty)!==wasSign) p.entry = price;
  }
  p.qty = +p.qty.toFixed(10);                                  // drop float dust (0.12 - 0.05 = 0.06999999999999999)
  SIM.fills.unshift({t:Date.now(), side, qty, price, fee, pnl, symbol:p.symbol}); if (SIM.fills.length > 50) SIM.fills.pop();
}
function simCapReduce(o){                                      // reduce-only: never grow or flip the position
  const p = simPos().qty, opp = (o.side==="SELL" && p>0) || (o.side==="BUY" && p<0);
  if (!opp) return 0; return Math.min(o.qty, Math.abs(p));
}
function simPlace(o){
  if (o.type==="MARKET"){
    const px = o.side==="BUY" ? M.bnAsk : M.bnBid; if (!px) throw new Error("no Binance prices yet; press Connect");
    const q = o.reduce ? simCapReduce(o) : o.qty; if (!q) throw new Error("reduce-only: no position to reduce");
    simFill(o.side, q, px, false); return {msg:`filled ${q} @ ${fmt(px,1)}`};
  }
  const cross = o.side==="BUY" ? (M.bnAsk && o.price >= M.bnAsk) : (M.bnBid && o.price <= M.bnBid);
  if (cross){ const px = o.side==="BUY" ? M.bnAsk : M.bnBid, q = o.reduce ? simCapReduce(o) : o.qty; if (!q) throw new Error("reduce-only: no position to reduce"); simFill(o.side, q, px, false); return {msg:`filled ${q} @ ${fmt(px,1)} (crossed)`}; }
  SIM.orders.push({id:SIM.nextId++, symbol:accSym(), side:o.side, type:"LIMIT", qty:o.qty, filled:0, price:+o.price, reduce:o.reduce, t:Date.now()});
  return {msg:`limit resting @ ${o.price}`};
}
function simOnTrade(t){
  if (!SIM || !SIM.orders.length) return;
  SIM.orders = SIM.orders.filter(o=>{
    if (o.symbol !== accSym()) return true;                    // trades on this feed only touch this asset's orders
    const hit =(o.side==="BUY" && t.px <= o.price) || (o.side==="SELL" && t.px >= o.price);
    if (!hit) return true;
    const q = o.reduce ? simCapReduce(o) : o.qty; if (q) simFill(o.side, q, o.price, true);
    return false;
  });
}
function simSnapshot(){
  const sym = accSym(), cur = simPos(sym);
  cur.mark = M.bnMark || (M.bnBid && M.bnAsk ? (M.bnBid+M.bnAsk)/2 : cur.mark || cur.entry);   // other assets keep their last known mark
  const open = Object.values(SIM.positions).filter(p=>p.qty).map(p => { const mark = p.mark || p.entry;
    return {symbol:p.symbol, qty:p.qty, entry:p.entry, mark, upnl:p.qty*(mark-p.entry), liq:null, lev:"10 (sim)"}; });
  const upnl = open.reduce((a,p)=>a+p.upnl, 0), margin = open.reduce((a,p)=>a+Math.abs(p.qty)*p.mark/10, 0);
  return {balance:{wallet:SIM.cash, available:SIM.cash+upnl-margin, upnl}, positions:open,
    orders: SIM.orders.filter(o=>o.symbol===sym).map(o=>({...o})), fills: SIM.fills};
}

// ---- Binance (demo / live) broker ----
async function bnRefresh(){
  const sym = accSym();
  const [bal, pos, ords, fills] = await Promise.all([
    bnSigned("GET","/fapi/v2/balance"), bnSigned("GET","/fapi/v2/positionRisk",{symbol:sym}),
    bnSigned("GET","/fapi/v1/openOrders",{symbol:sym}), bnSigned("GET","/fapi/v1/userTrades",{symbol:sym, limit:"30"})]);
  if (![bal, pos, ords, fills].every(Array.isArray)) throw new Error("unexpected response from Binance (check the keys and that USD-M futures is enabled)");
  const u = bal.find(b=>b.asset==="USDT") || {};
  ACC.data = {balance:{wallet:+u.balance, available:+u.availableBalance, upnl:+u.crossUnPnl},
    positions: pos.filter(p=>+p.positionAmt!==0).map(p=>({symbol:p.symbol, qty:+p.positionAmt, entry:+p.entryPrice, mark:+p.markPrice, upnl:+p.unRealizedProfit, liq:+p.liquidationPrice||null, lev:p.leverage})),
    orders: ords.map(o=>({id:o.orderId, side:o.side, type:o.type, qty:+o.origQty, filled:+o.executedQty, price:+o.price, reduce:o.reduceOnly, t:o.time})),
    fills: fills.slice().reverse().map(f=>({t:f.time, side:f.side, qty:+f.qty, price:+f.price, fee:+f.commission, pnl:+f.realizedPnl}))};
}
async function accRefresh(){
  if (!ACC.mode) return;
  if (ACC.mode==="sim"){ ACC.data = simSnapshot(); return; }
  try{ await bnRefresh(); ACC.status = ""; }catch(e){ ACC.status = e.message; }
}
setInterval(()=>{ if (ACC.mode && ACC.mode!=="sim") accRefresh(); }, 3000);
const refreshSoon = () => setTimeout(accRefresh, 400);

async function placeOrder(o){
  if (!ACC.mode) throw new Error("no account; log in on the Accounts tab");
  const f = await loadFilters();
  const q = +roundStep(o.qty, f.step);
  if (!(q > 0) || q < f.minQty) throw new Error(`size below the minimum of ${f.minQty} ${accAsset()}`);
  const price = o.type==="LIMIT" ? +roundTick(o.price, f.tick) : o.price, notional = q*price;
  if (!o.reduce && f.minNotional && notional < f.minNotional) throw new Error(`order value $${notional.toFixed(2)} is below Binance's $${f.minNotional} minimum`);
  if (ACC.mode==="live" && notional > ACC.maxUsd) throw new Error(`order value $${notional.toFixed(0)} is above your $${ACC.maxUsd} live cap`);
  if (ACC.mode==="live" && !confirm(`REAL-MONEY ORDER on Binance\n\n${o.side} ${q} ${accSym()} · ${o.type}${o.type==="LIMIT" ? " @ "+price : ""}\n≈ $${notional.toFixed(2)}${o.reduce ? "\nreduce-only" : ""}\n\nSend this order?`)) throw new Error("cancelled");
  let res;
  if (ACC.mode==="sim") res = simPlace({...o, qty:q, price});
  else {
    const prm = {symbol:accSym(), side:o.side, type:o.type, quantity:roundStep(q, f.step)};
    if (o.type==="LIMIT"){ prm.price = roundTick(price, f.tick); prm.timeInForce = "GTC"; }
    if (o.reduce) prm.reduceOnly = "true";
    const r = await bnSigned("POST","/fapi/v1/order", prm);
    res = {msg:`order ${r.orderId} ${r.status}`};
  }
  accRefresh(); refreshSoon(); return res;
}
async function cancelOrder(id){
  if (ACC.mode==="sim"){ SIM.orders = SIM.orders.filter(o=>o.id!==id); }
  else await bnSigned("DELETE","/fapi/v1/order",{symbol:accSym(), orderId:String(id)});
  accRefresh(); refreshSoon();
}
async function cancelAll(){
  if (ACC.mode==="sim") SIM.orders = SIM.orders.filter(o=>o.symbol!==accSym());   // same scope as live: this asset only
  else await bnSigned("DELETE","/fapi/v1/allOpenOrders",{symbol:accSym()});
  accRefresh(); refreshSoon();
}

function logout(){
  Object.assign(ACC, {mode:null, key:null, secret:null, base:null, maxUsd:Infinity, status:"", data:null});
  SIM = null; renderAccount();
}
function renderAccount(){
  const b = $("accBadge"); b.className = ACC.mode || ""; b.textContent = ACC.mode ? ACC.mode.toUpperCase() : "";
  $("accActive").innerHTML = !ACC.mode ? "No account connected." :
    ACC.mode==="sim" ? `Connected: <b>simulated paper</b> · started with $${fmtK(SIM.start)}` :
    ACC.mode==="demo" ? `Connected: <b>Binance demo</b> (paper)` :
    `Connected: <b style="color:var(--sell)">Binance LIVE — real money</b> · max order $${ACC.maxUsd}`;
}
function accMsg(which, txt, ok){ const el = $(which+"Msg"); el.className = "acc-msg " + (ok ? "ok" : "err"); el.textContent = txt; }
$("simGo").onclick = () => {
  logout(); const start = +$("simStart").value || 10000;
  simReset(start); ACC.mode = "sim"; ACC.data = simSnapshot();
  accMsg("sim", connected ? "Simulated account ready." : "Simulated account ready. Press Connect for live prices.", true);
  renderAccount();
};
async function loginBinance(mode){
  const key = $(mode+"Key").value.trim(), secret = $(mode+"Secret").value.trim();
  if (!key || !secret) return accMsg(mode, "Enter both the API key and the secret.");
  if (mode==="live" && !$("liveAck").checked) return accMsg(mode, "Tick the acknowledgment to connect a real-money account.");
  logout();
  Object.assign(ACC, {mode, key, secret, base:BASES[mode], maxUsd: mode==="live" ? Math.max(1, +$("liveMax").value || 500) : Infinity});
  accMsg(mode, "Connecting…", true);
  await syncClock();
  try{
    await bnRefresh();
    $(mode+"Key").value = ""; $(mode+"Secret").value = "";
    accMsg(mode, `Connected. Wallet $${fmt(ACC.data.balance.wallet,2)}.`, true);
  }catch(e){ logout(); accMsg(mode, "Login failed: " + e.message); }
  renderAccount();
}
$("demoGo").onclick = () => loginBinance("demo");
$("liveGo").onclick = () => loginBinance("live");
$("logout").onclick = () => { logout(); for (const m of ["sim","demo","live"]) $(m+"Msg").textContent = ""; };

// ---------- trading tab: modular workspace ----------
const TMODS = [["t-ticket","Order ticket"],["t-pos","Positions"],["t-orders","Open orders"],["t-bal","Balance"],["t-fills","Recent fills"]];
const TAB_LABEL = Object.fromEntries(TABS);
let tkSide = "BUY";
function buildModCatalog(){
  const sel = $("addMod"); sel.innerHTML = '<option value="">+ add module…</option>';
  const g1 = document.createElement("optgroup"); g1.label = "Trading";
  for (const [id, nm] of TMODS){ const o = document.createElement("option"); o.value = id; o.textContent = nm; o.disabled = !!$(id+"-mod"); g1.appendChild(o); }
  sel.appendChild(g1);
  const groups = {};
  document.querySelectorAll("main section[data-mid]").forEach(sec=>{
    const home = sec.dataset.home || sec.dataset.tab, o = document.createElement("option");
    o.value = sec.dataset.mid; o.textContent = sec.dataset.title; o.disabled = !!sec.dataset.home;
    (groups[home] ||= document.createElement("optgroup")).appendChild(o);
  });
  for (const [k, g] of Object.entries(groups)){ g.label = TAB_LABEL[k] || k; sel.appendChild(g); }
}
function tagViewSections(){
  let i = 0;
  document.querySelectorAll("main > section").forEach(sec=>{
    const t = sec.dataset.tab; if (!t || t==="trading" || t==="accounts" || sec.classList.contains("ph")) return;
    const h2 = sec.querySelector("h2"); if (!h2) return;
    sec.dataset.mid = "v-"+(i++); sec.dataset.title = (h2.childNodes[0].textContent || "").trim() || "panel";
  });
}
function rmButton(onClick){ const b = document.createElement("button"); b.className = "rm"; b.textContent = "✕"; b.title = "remove from Trading"; b.onclick = onClick; return b; }
function addModule(id){
  if (!id) return;
  if (id.startsWith("t-")){
    if ($(id+"-mod")) return;
    const sec = document.createElement("section"); sec.id = id+"-mod"; sec.dataset.tab = "trading";
    const name = TMODS.find(m=>m[0]===id)[1];
    sec.innerHTML = `<h2>${name}</h2><div class="tbody"></div>`;
    sec.querySelector("h2").appendChild(rmButton(()=>{ sec.remove(); afterLayout(); }));
    $("tgrid").appendChild(sec);                                  // must be in the document before the ticket looks up its inputs
    if (id==="t-ticket") buildTicket(sec.querySelector(".tbody"));
  } else {
    const sec = document.querySelector(`main section[data-mid="${id}"]`); if (!sec || sec.dataset.home) return;
    const ph = document.createElement("section"); ph.className = "ph"; ph.dataset.tab = sec.dataset.tab;
    ph.innerHTML = `<div class="note" style="margin:0">“${sec.dataset.title}” is in the Trading tab. </div>`;
    const back = document.createElement("button"); back.textContent = "bring back"; ph.querySelector(".note").appendChild(back);
    const restore = () => { sec.dataset.tab = sec.dataset.home; delete sec.dataset.home; sec.querySelector("h2 > .rm")?.remove(); ph.replaceWith(sec); afterLayout(); };
    back.onclick = restore;
    sec.replaceWith(ph); sec.dataset.home = sec.dataset.tab; sec.dataset.tab = "trading";
    sec.querySelector("h2").appendChild(rmButton(restore));
    $("tgrid").appendChild(sec);
  }
  afterLayout();
}
let restoring = false;
function afterLayout(){
  $("tEmpty").style.display = $("tgrid").children.length ? "none" : ""; buildModCatalog(); setTab(tab);
  if (!restoring) store.set("tmods", [...$("tgrid").children].map(sec => sec.id ? sec.id.replace(/-mod$/, "") : sec.dataset.mid));
}
$("addMod").onchange = e => { addModule(e.target.value); e.target.value = ""; };

function buildTicket(el){
  el.innerHTML = `<div class="ticket">
    <div class="tk-side"><button class="buy act" data-side="BUY">Buy / Long</button><button class="sell" data-side="SELL">Sell / Short</button></div>
    <div class="row"><select id="tkType"><option value="MARKET">Market</option><option value="LIMIT">Limit</option></select>
      <input id="tkQty" type="number" step="any" min="0" placeholder="size"><select id="tkUnit"><option value="usd">USD</option><option value="base">BTC</option></select></div>
    <div class="row" id="tkPxRow" style="display:none"><input id="tkPx" type="number" step="any" placeholder="limit price"><button data-px="bid">bid</button><button data-px="mid">mid</button><button data-px="ask">ask</button></div>
    <label class="row"><input id="tkReduce" type="checkbox"> reduce-only</label>
    <div class="tk-info" id="tkInfo"></div>
    <button id="tkSubmit" class="primary">Place order</button>
    <div class="note" id="tkStatus"></div></div>`;
  el.querySelectorAll(".tk-side button").forEach(b => b.onclick = () => { tkSide = b.dataset.side; el.querySelectorAll(".tk-side button").forEach(x=>x.classList.toggle("act", x===b)); renderTicket(); });
  $("tkType").onchange = () => { $("tkPxRow").style.display = $("tkType").value==="LIMIT" ? "" : "none"; renderTicket(); };
  el.querySelectorAll("[data-px]").forEach(b => b.onclick = () => {
    const k = b.dataset.px, v = k==="bid" ? M.bnBid : k==="ask" ? M.bnAsk : (M.bnBid && M.bnAsk ? (M.bnBid+M.bnAsk)/2 : null);
    if (v) $("tkPx").value = v; renderTicket(); });
  $("tkQty").oninput = $("tkPx").oninput = $("tkUnit").onchange = renderTicket;
  $("tkSubmit").onclick = async () => {
    const st = $("tkStatus"), type = $("tkType").value, raw = +$("tkQty").value;
    const ref = type==="LIMIT" ? +$("tkPx").value : (tkSide==="BUY" ? M.bnAsk : M.bnBid);
    if (!raw){ st.className = "note err"; st.textContent = "Enter a size."; return; }
    if (!ref){ st.className = "note err"; st.textContent = type==="LIMIT" ? "Enter a limit price." : "No live price yet; press Connect."; return; }
    const qty = $("tkUnit").value==="usd" ? raw/ref : raw;
    $("tkSubmit").disabled = true; st.className = "note"; st.textContent = "Sending…";
    try{ const r = await placeOrder({side:tkSide, type, qty, price:ref, reduce:$("tkReduce").checked}); st.className = "note ok"; st.textContent = "✓ " + r.msg; }
    catch(e){ st.className = "note err"; st.textContent = e.message; }
    $("tkSubmit").disabled = false;
  };
  renderTicket();
}
function renderTicket(){
  if (!$("tkInfo")) return;
  const unit = $("tkUnit"); unit.options[1].textContent = accAsset();
  const type = $("tkType").value, raw = +$("tkQty").value, ref = type==="LIMIT" ? +$("tkPx").value : (tkSide==="BUY" ? M.bnAsk : M.bnBid);
  const qty = ref ? (unit.value==="usd" ? raw/ref : raw) : 0;
  $("tkInfo").innerHTML = `bid ${fmt(M.bnBid,1)} · ask ${fmt(M.bnAsk,1)}<br>${raw && ref ? `≈ ${qty.toFixed(5)} ${accAsset()} · $${fmt(qty*ref,2)}` : ""}<br>account: ${ACC.mode ? ACC.mode.toUpperCase() : "none (Accounts tab)"}`;
  const btn = $("tkSubmit"); btn.textContent = `${tkSide==="BUY"?"Buy":"Sell"} ${type==="LIMIT"?"limit":"market"}${ACC.mode==="live"?" · REAL":""}`;
  btn.style.background = tkSide==="BUY" ? "var(--buy)" : "var(--sell)"; btn.style.borderColor = btn.style.background;
}
function noAcc(el){ el.innerHTML = `<div class="note">No account connected. Log in on the Accounts tab.</div>`; }
function renderTrading(){
  if (ACC.mode==="sim") ACC.data = simSnapshot();
  const d = ACC.data, stMsg = ACC.status ? `<div class="note err">${ACC.status}</div>` : "";
  renderTicket();
  const body = id => $(id+"-mod")?.querySelector(".tbody");
  let el;
  if ((el = body("t-bal"))){
    if (!ACC.mode || !d) noAcc(el); else {
      const eq = d.balance.wallet + d.balance.upnl;
      el.innerHTML = `<div class="metrics">${[["Account", ACC.mode.toUpperCase()], ["Wallet", "$"+fmt(d.balance.wallet,2)], ["Unrealized PnL", `<span class="${d.balance.upnl>=0?"ok":"err"}">${d.balance.upnl>=0?"+":""}${fmt(d.balance.upnl,2)}</span>`],
        ["Equity", "$"+fmt(eq,2)], ["Available", "$"+fmt(d.balance.available,2)]].map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("")}</div>${stMsg}`;
    }
  }
  if ((el = body("t-pos"))){
    if (!ACC.mode || !d) noAcc(el); else el.innerHTML = d.positions.length ? `<table class="tt"><tr><th>symbol</th><th>size</th><th>entry</th><th>mark</th><th>uPnL</th><th>liq</th><th></th></tr>` +
      d.positions.map(p=>`<tr><td>${p.symbol}</td><td class="${p.qty>0?"ok":"err"}">${p.qty>0?"+":""}${p.qty}</td><td>${fmt(p.entry,1)}</td><td>${fmt(p.mark,1)}</td>
        <td class="${p.upnl>=0?"ok":"err"}">${p.upnl>=0?"+":""}${fmt(p.upnl,2)}</td><td>${p.liq?fmt(p.liq,1):"–"}</td><td>${p.symbol===accSym() ? `<button data-close="${p.qty}">close</button>` : `<span class="note" title="switch the asset in the header to close it">switch asset</span>`}</td></tr>`).join("") + `</table>${stMsg}` : `<div class="note">No open position on ${accSym()}.</div>${stMsg}`;
  }
  if ((el = body("t-orders"))){
    if (!ACC.mode || !d) noAcc(el); else el.innerHTML = d.orders.length ? `<table class="tt"><tr><th>side</th><th>type</th><th>price</th><th>qty</th><th>filled</th><th></th></tr>` +
      d.orders.map(o=>`<tr><td class="${o.side==="BUY"?"ok":"err"}">${o.side}${o.reduce?" (R)":""}</td><td>${o.type}</td><td>${fmt(o.price,1)}</td><td>${o.qty}</td><td>${o.filled||0}</td><td><button data-cancel="${o.id}">cancel</button></td></tr>`).join("") +
      `</table><div class="row" style="margin-top:6px"><button data-cancelall="1">cancel all</button></div>${stMsg}` : `<div class="note">No open orders on ${accSym()}.</div>${stMsg}`;
  }
  if ((el = body("t-fills"))){
    if (!ACC.mode || !d) noAcc(el); else el.innerHTML = d.fills.length ? `<div class="tape" style="height:220px"><table class="tt"><tr><th>time</th><th>side</th><th>price</th><th>qty</th><th>fee</th><th>realized</th></tr>` +
      d.fills.slice(0,40).map(f=>`<tr><td>${hhmmss(f.t)}</td><td class="${f.side==="BUY"?"ok":"err"}">${f.side}</td><td>${fmt(f.price,1)}</td><td>${f.qty}</td><td>${fmt(f.fee,3)}</td><td class="${f.pnl>=0?"ok":"err"}">${f.pnl?fmt(f.pnl,2):""}</td></tr>`).join("") + `</table></div>` : `<div class="note">No fills yet.</div>`;
  }
}
$("tgrid").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  try{
    if (b.dataset.close){
      const q = +b.dataset.close, side = q>0 ? "SELL" : "BUY", ref = side==="BUY" ? M.bnAsk : M.bnBid;
      if (!ref) throw new Error("no live price; press Connect");
      await placeOrder({side, type:"MARKET", qty:Math.abs(q), price:ref, reduce:true});
    } else if (b.dataset.cancel) await cancelOrder(isNaN(+b.dataset.cancel) ? b.dataset.cancel : +b.dataset.cancel);
    else if (b.dataset.cancelall) await cancelAll();
  }catch(err){ if (err.message!=="cancelled") alert(err.message); }
});

// ---------- market reader: tab ----------
const rdFilter = {family:new Set(), venue:new Set(), min:0};
const epFilter = {family:new Set(), horizon:new Set()}, epOpen = new Set(), epLast = {};
const rdView = {engine:null};                      // a replayed engine while viewing a recorded session, else null (live)
const RD = () => rdView.engine || READER;
const rdEsc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
const rdMs = ms => ms >= 10000 ? (ms/1000).toFixed(0)+"s" : (ms/1000).toFixed(1)+"s";
function rdInit(){
  const chip = (kind,v) => `<button class="chip" data-kind="${kind}" data-v="${v}">${v}</button>`;
  $("rdChips").innerHTML = ["wall","book","burst","absorption","exhaustion","silence","leadlag","cluster"].map(f=>chip("family",f)).join("") + ["bn","hl"].map(v=>chip("venue",v)).join("");
  $("rdChips").onclick = e => { const b=e.target.closest("button"); if(!b)return; const set=rdFilter[b.dataset.kind]; set.has(b.dataset.v)?set.delete(b.dataset.v):set.add(b.dataset.v); b.classList.toggle("on",set.has(b.dataset.v)); renderReader(); };
  $("rdMin").oninput = () => { rdFilter.min=+$("rdMin").value; renderReader(); };
  $("rdSens").onchange = () => READER.setSensitivity(+$("rdSens").value);
  const ec = (kind,v) => `<button class="chip" data-kind="${kind}" data-v="${v}">${v}</button>`;
  $("epChips").innerHTML = Object.keys(READER_EPISODES.FAMILY_LABEL).map(f=>ec("family",f)).join("") + READER_EPISODES.DEFAULTS.horizons.map(h=>ec("horizon",h)).join("");
  $("epChips").onclick = e => { const b=e.target.closest("button"); if(!b)return; const set=epFilter[b.dataset.kind]; set.has(b.dataset.v)?set.delete(b.dataset.v):set.add(b.dataset.v); b.classList.toggle("on",set.has(b.dataset.v)); store.set("epf",{family:[...epFilter.family],horizon:[...epFilter.horizon]}); renderReader(); };
  $("epFamilies").innerHTML = Object.entries(READER_EPISODES.FAMILY_LABEL).map(([k,l])=>`<label><input type="checkbox" data-f="${k}" checked> ${l}</label>`).join("");
  $("epFamilies").onchange = e => { const f=e.target.dataset.f; if(f){ READER.setFamily(f,e.target.checked); store.set("epOff",[...$("epFamilies").querySelectorAll("input[data-f]")].filter(c=>!c.checked).map(c=>c.dataset.f)); } };
  for (const id of ["epActive","epDone"]) $(id).onclick = e => { const c=e.target.closest(".ep"); if(!c)return; const k=c.dataset.id; epOpen.has(k)?epOpen.delete(k):epOpen.add(k); epLast[id]=null; renderReader(); };
  $("rdDetectors").innerHTML = Object.keys(READER.cfg.detectors).map(k=>`<label><input type="checkbox" data-d="${k}" checked> ${k.replace(/_/g," ")}</label>`).join("");
  $("rdDetectors").onchange = e => { const d=e.target.dataset.d; if(d)READER.setDetector(d,e.target.checked); };
}
const epSide = x => x==="buy" ? "buyers" : "sellers";
function epWho(ep){
  if (ep.family==="wall") return `<span class="who">passive <i class="${ep.passive}">${epSide(ep.passive)}</i> (${ep.wall.side} wall)</span>`;
  return `<span class="who">aggressor <i class="${ep.aggressor}">${epSide(ep.aggressor)}</i>${ep.passive ? ` · passive <i class="${ep.passive}">${epSide(ep.passive)}</i>` : ""}</span>`;
}
function epEvidence(ep){
  return `<table class="evid">` + (ep.stage==="ended" && ep.peakEvidence ? ep.peakEvidence : ep.evidence).map(i=>`<tr class="${i.na?"na":i.ok?"ok":"no"}"><td><i class="tick"></i></td><td>${i.label}${i.gate?' <span class="gate" title="must hold for the episode to exist">required</span>':""}</td><td>${i.val}</td></tr>`).join("") + `</table>`;
}
const RES_TEXT = {"resolved-with":"price then went with the aggressor", "resolved-against":"price then went against the aggressor", flat:"price then stayed flat"};
function epResolution(ep){ return ep.resolution ? ` · ${RES_TEXT[ep.resolution]} (${ep.resolutionSigma>=0?"+":""}${ep.resolutionSigma.toFixed(1)}σ in ${Math.round(READER.cfg.ep.outcomeLookMs/1000)} s)` : ""; }
function epMembers(g){
  if (!g.members || g.members.length<2) return "";
  return `<div class="epmeta stat">seen as ${g.members.length} episodes:</div>` + g.members.map(m=>`<div class="epmeta stat">${m.venue.toUpperCase()} ${m.horizon} · ${m.stage} · began ${hhmmss(m.tStart).slice(0,8)}${m.stage==="ended" ? ` · lasted ${rdMs(m.tEnd-m.tStart)}` : ""} · peak ${Math.round(m.peak*100)}%</div>`).join("");
}
function epCard(ep, now, compact){
  const timing = ep.stage==="ended" ? `${hhmmss(ep.tStart).slice(0,8)} · lasted ${rdMs(ep.tEnd-ep.tStart)} · ${ep.outcome}${epResolution(ep)}`
    : `began ${rdMs(now-ep.tStart)} ago${ep.tDetected ? ` · detected ${rdMs(now-ep.tDetected)} ago` : " · not yet confirmed"}`;
  return `<div class="ep ${ep.stage}" data-id="${ep.id}"><div class="eph"><b>${READER_EPISODES.FAMILY_LABEL[ep.family]}</b> ${(ep.venues||[ep.venue]).map(v=>`<span class="venue v-${v}">${v.toUpperCase()}</span>`).join("")}${(ep.horizons||[ep.horizon]).map(h=>`<span class="chip">${h}</span>`).join("")} <span class="stg">${ep.stage}</span>${typeof epLabelChip==="function" ? epLabelChip(ep) : ""}${ep.pulses>1 ? ` <span class="chip">${ep.pulses} pulses</span>` : ""} ${epWho(ep)}</div>`
    + (compact ? "" : `<div class="epbar"><i style="width:${Math.round(ep.intensity*100)}%"></i></div>`)
    + `<div class="epread">${ep.stage==="ended" && ep.peakReading ? "At its peak: " + ep.peakReading : ep.reading}</div><div class="epmeta stat">${timing} · peak ${Math.round(ep.peak*100)}%</div>${epOpen.has(String(ep.id)) ? epEvidence(ep) + epMembers(ep) + (typeof epLabelBar==="function" ? epLabelBar(ep) : "") : ""}</div>`;
}
function renderEpisodes(s){
  const keep = e => (!epFilter.family.size || epFilter.family.has(e.family)) && (!epFilter.horizon.size || (e.horizons||[e.horizon]).some(h=>epFilter.horizon.has(h)) || e.horizon==="book");
  const groups = RD().episodeGroups();
  const live = groups.filter(g=>g.stage!=="ended").concat(RD().formingEpisodes()).filter(keep).sort((a,b)=>(a.stage==="forming")-(b.stage==="forming") || b.intensity-a.intensity);
  const done = groups.filter(g=>g.stage==="ended" && keep(g)).slice(-40).reverse();
  const put = (id, html) => { if (epLast[id] !== html){ epLast[id] = html; $(id).innerHTML = html; } };   // only touch the DOM when something changed, so taps are not lost
  put("epActive", live.length ? live.map(e=>epCard(e, s.now)).join("") : `<div class="note" style="margin:0">${!connected ? "Not connected." : !s.calibrated ? "Calibrating: episodes arm after about two minutes of data." : "No active episodes: nothing matches a pattern right now."}</div>`);
  put("epDone", done.length ? done.map(e=>epCard(e, s.now, true)).join("") : `<div class="note" style="margin:0">Finished episodes appear here.</div>`);
}
function renderReader(){
  const s=RD().state(),card=(k,v,cls)=>`<div class="rd-card ${cls||""}"><span>${k}</span><b>${v}</b></div>`;
  $("rdStatus").textContent=s.calibrated?"armed":`calibrating ${(s.calibratingPct*100).toFixed(0)}%`;
  renderEpisodes(s);
  if (typeof rdToolsRender==="function") rdToolsRender(s);
  $("rdStrip").innerHTML=[card("activity",`${s.regime} (x${s.ratio.toFixed(2)})`)].concat(["fast","mid","slow"].map(k=>{const h=s.horizons[k];return h?card(`${k} - window ${rdMs(h.ms)}`,`${h.side} (${(h.share*100).toFixed(0)}% buy)`,h.side==="buyers"?"buy":h.side==="sellers"?"sell":""):card(k,"-");})).concat([card("episodes active",String(s.episodesActive))]).join("");
  const rows=RD().events.slice().reverse().filter(e=>(!rdFilter.family.size||rdFilter.family.has(e.family))&&(!rdFilter.venue.size||rdFilter.venue.has(e.venue))&&e.strength>=rdFilter.min).slice(0,100);
  $("rdFeed").innerHTML=`<tr><th>time</th><th>type</th><th>venue</th><th>price</th><th>horizon</th><th>strength</th><th>evidence</th></tr>`+rows.map(e=>`<tr class="neutral"><td>${hhmmss(e.t)}</td><td>${e.type.replace(/_/g," ")}</td><td><span class="venue v-${e.venue}">${e.venue.toUpperCase()}</span></td><td>${fmt(e.px,1)}</td><td>${e.horizon}</td><td><i class="rd-str" style="width:${Math.round(e.strength*60)}px"></i> ${(e.strength*100).toFixed(0)}</td><td style="white-space:normal">${rdEsc(e.evidence)}</td></tr>`).join("");
  const hs=["bn.trade","bn.depth","bn.bookTicker","hl.trades","hl.l2Book","hl.bbo"].map(id=>[id.replace("."," "),S[id].on?(status(S[id])||"-"):"off"]);
  hs.push(["signals / min",s.eventsPerMin],["BN book age",s.bookAgeMs.bn==null?"-":s.bookAgeMs.bn+" ms"],["HL book age",s.bookAgeMs.hl==null?"-":s.bookAgeMs.hl+" ms"],["heartbeat",rdWorker?"on":"off"]);
  $("rdHealth").innerHTML=hs.map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("");
}

// ---------- loops ----------
function renderSlow(){
  if (paused) return;
  if (visible("streams")) renderCards();
  if (visible("health")) renderHealth();
  if (visible("charts")) renderFlow();
  renderAlerts();
}
setInterval(()=>{
  for (const id in S){ const s=S[id]; s.rates.shift(); s.rates.push(s.cur); s.cur=0; }
  for (const [st,pre] of [[bnStats,"bn"],[hlStats,"hl"]]){ $(pre+"Rate").textContent=st.cur; $(pre+"Bytes").textContent=(st.bytes/1024).toFixed(1); st.cur=0; st.bytes=0; }
  prune(); renderSlow();
}, 1000);
let lastOv = 0, lastFast = 0, lastChart = 0, lastMicro = 0, lastViz = 0, lastTrade = 0, lastReader = 0;
(function frame(ts){
  if (!paused){
    if (visible("overview") && ts - lastOv > 250){ lastOv = ts; try{ renderOverview(); }catch(e){ console.error("overview", e); } }
    if (visible("charts") && ts - lastChart > 100){ lastChart = ts; drawBubbles(); drawCvd(); }
    if (visible("micro") && ts - lastMicro > 250){ lastMicro = ts; renderMicro(); }
    if (visible("viz") && ts - lastViz > 400){ lastViz = ts; renderViz(); }
    if (visible("reader") && ts - lastReader > 250){ lastReader = ts; renderReader(); }
    if (tab==="trading" && ts - lastTrade > 400){ lastTrade = ts; renderTrading(); }
    if (dirty && ts - lastFast > 150){
      dirty = false; lastFast = ts;
      if (visible("market")){ renderMetrics(); renderBooks(); }
      if (visible("tape")) renderTape();
      if (visible("raw")){ renderLog(); renderInspector(); }
    }
  }
  requestAnimationFrame(frame);
})(0);

// ---------- controls ----------
$("go").onclick = () => {
  if (connected){
    connected=false; bnDisconnect(); hlDisconnect(); clearInterval(clockTimer); rdStopHeartbeat();
    $("go").textContent="Connect"; $("go").classList.add("primary"); renderSlow(); return;
  }
  connected = true; connectedAt = Date.now();
  for (const id in S) Object.assign(S[id], freshStats());
  trades=[]; cvd={bn:0,hl:0}; cvdHist=[]; midHist=[]; cvdBase=null; resetMicro(); logLines.length=0; hlBook=null; bnBook=null;
  resetMarket(); Object.assign(health, {bnReconnects:0, hlReconnects:0, hlReplays:0});
  READER.reset(); rdLastBook.bn = rdLastBook.hl = 0;
  syncClock(); clockTimer = setInterval(syncClock, 60000);
  bnConnect(); hlConnect(); rdStartHeartbeat();
  $("go").textContent="Disconnect"; $("go").classList.remove("primary");
};
$("pause").onclick = () => { paused=!paused; $("pause").classList.toggle("on",paused); $("pause").textContent = paused?"Resume":"Pause"; };
$("route").onchange = () => scheduleReconnect("bn");
$("bnSrc").onchange = () => {
  const id = $("bnSrc").value;                       // make sure the chosen source is subscribed
  if (!S[id].on){ S[id].on = true; const el=$("c-"+id); el.classList.remove("off"); el.querySelector("input").checked = true; scheduleReconnect("bn"); }
  trades = trades.filter(t => t.v!=="bn" || t.liq);   // avoid mixing sources in the history
  cvd.bn = 0; cvdHist = []; cvdBase = null;
};
$("sym").onchange = () => { if (connected){ resetMicro(); trades=[]; midHist=[]; cvdHist=[]; cvd={bn:0,hl:0}; resetMarket(); READER.reset(); rdLastBook.bn = rdLastBook.hl = 0; hlBook=null; bnConnect(); hlConnect(); } };
$("cvdReset").onclick = () => { cvdBase = {t: nowEx()}; };
$("logFilter").onchange = renderLog;
$("clearLog").onclick = () => { logLines.length=0; renderLog(); };
$("minNtl").oninput = renderTape;
rdInit(); buildCards(); renderMetrics(); tagViewSections(); buildModCatalog(); renderAccount();

// ---------- settings sheet ----------
function sheet(open){ $("sheet").hidden = !open; $("cog").setAttribute("aria-expanded", String(open)); }
$("cog").onclick = () => sheet($("sheet").hidden);
document.addEventListener("click", e => { if (!$("sheet").hidden && !e.target.closest("#sheet, #cog")) sheet(false); });
document.addEventListener("keydown", e => { if (e.key==="Escape") sheet(false); });
$("sym").addEventListener("input", () => { $("symLbl").textContent = $("sym").value.trim().toUpperCase() || "–"; });

// ---------- remembered setup ----------
for (const id of ["sym","route","bnSrc","vwin","ovWin","rdSens","rdMin","minNtl","swMin","tlWin","rtMissFam","rtMissSide"]){
  const el = $(id); if (!el) continue;
  const v = store.get("v:"+id, null);
  if (v != null && (el.tagName!=="SELECT" || [...el.options].some(o=>o.value===v))) el.value = v;
  const save = () => store.set("v:"+id, el.value);
  el.addEventListener("change", save); el.addEventListener("input", save);
}
$("symLbl").textContent = $("sym").value.trim().toUpperCase() || "–";
READER.setSensitivity(+$("rdSens").value); rdFilter.min = +$("rdMin").value;
const rdOff = new Set(store.get("rdOff", []));
for (const cb of $("rdDetectors").querySelectorAll("input[data-d]")) if (rdOff.has(cb.dataset.d)){ cb.checked = false; READER.setDetector(cb.dataset.d, false); }
{
  const epf = store.get("epf", null); if (epf) for (const k of ["family","horizon"]) for (const v of epf[k] || []){ epFilter[k].add(v); const b = $("epChips").querySelector(`button[data-kind="${k}"][data-v="${v}"]`); if (b) b.classList.add("on"); }
  for (const f of store.get("epOff", [])){ const cb = $("epFamilies").querySelector(`input[data-f="${f}"]`); if (cb){ cb.checked = false; READER.setFamily(f, false); } }
}
$("rdDetectors").addEventListener("change", () => store.set("rdOff", [...$("rdDetectors").querySelectorAll("input[data-d]")].filter(c=>!c.checked).map(c=>c.dataset.d)));

// ---------- collapsible panels ----------
// Each titled panel gets a body wrapper; tapping the title folds it. State is remembered by panel title.
(function initPanels(){
  const saved = store.get("collapsed", null), fold = new Set(saved || []), narrow = matchMedia("(max-width:700px)").matches;
  let vizN = 0;
  document.querySelectorAll("main > section[data-tab]").forEach(sec=>{
    const h2 = sec.querySelector(":scope > h2"); if (!h2 || sec.classList.contains("tcontainer")) return;
    const body = document.createElement("div"); body.className = "pbody";
    while (h2.nextSibling) body.appendChild(h2.nextSibling);
    sec.appendChild(body); sec.classList.add("cx");
    const key = sec.dataset.tab + "/" + (h2.childNodes[0].textContent || "").trim();
    sec.dataset.fold = key;
    if (!saved && narrow && sec.dataset.tab==="viz" && ++vizN > 2) fold.add(key);   // first visit on a phone: Visualizations opens with its first panels only
    sec.classList.toggle("collapsed", fold.has(key));
  });
  document.getElementById("main").addEventListener("click", e => {
    const h2 = e.target.closest("section.cx > h2"); if (!h2 || e.target.closest(".ctl, .rm, button, input, select, label, a")) return;
    const sec = h2.parentElement; sec.classList.toggle("collapsed");
    const now = new Set(store.get("collapsed", null) || [...document.querySelectorAll("section.cx.collapsed")].map(x=>x.dataset.fold));
    sec.classList.contains("collapsed") ? now.add(sec.dataset.fold) : now.delete(sec.dataset.fold);
    store.set("collapsed", [...now]); dirty = true;
  });
  if (!saved) store.set("collapsed", [...fold]);
})();

// ---------- restore Trading layout, then the last view ----------
const savedView = store.get("view", "overview");      // read first: restoring modules calls setTab, which rewrites it
restoring = true;
for (const id of store.get("tmods", [])) try{ addModule(id); }catch{}
restoring = false;
tab = TABS.some(t=>t[0]===savedView) ? savedView : "overview"; afterLayout();