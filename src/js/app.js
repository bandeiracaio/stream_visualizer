"use strict";
// ---------- chart colours: read from the CSS tokens (styles.css :root) so the charts always match the rest of the look ----------
// TH.dim = axis text, TH.text / TH.hi = lines and labels, TH.line = grid, TH.edge = axes and zero lines, TH.ink = text on a coloured fill, TH.canvas = chart background;
// TH.a(name, alpha) = the token as an rgba() string. A token that is missing shows up as magenta, never as a silent default.
const TH = (() => {
  const cs = getComputedStyle(document.documentElement), t = {};
  for (const n of ["bg", "panel", "panel2", "canvas", "line", "edge", "text", "dim", "hi", "buy", "sell", "warn", "bn", "hl", "accent", "ink"]) t[n] = cs.getPropertyValue("--" + n).trim() || "#ff00ff";
  t.a = (n, al) => { const h = t[n].replace("#", ""); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${al})`; };
  return t;
})();
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
// Text colour of each stream in the Raw messages log (and in its filter list): warm colours are Binance, cool colours are Hyperliquid.
const LOG_COLOR = {"bn.trade":TH.bn, "bn.aggTrade":"#c9a227", "bn.depth":"#ff8a3d", "bn.bookTicker":"#ffb4a2", "bn.markPrice":"#e07be0", "bn.forceOrder":"#ff5c5c", "bn.ticker":"#a89984", "bn.kline":"#8a7f60", "bn.oi":"#ffd9a0",
                   "hl.trades":TH.hl, "hl.l2Book":"#4da6ff", "hl.bbo":"#9ad1ff", "hl.ctx":"#7be08f", "hl.candle":"#b19cff"};

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
let selected = null, connected = false, connectedAt = 0;

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
function resetMarket(){ Object.assign(M, MARKET.freshQuotes()); }
resetMarket();
let hlBook = null, hlBookT = 0;
const KEEP = MARKET.KEEP;            // 5 min of history for charts (market-core.js)
let trades = [];                     // {t, v, side, px, q, ntl, liq, bf, users}
let cvd = MARKET.freshCvd(), cvdHist = []; // sampled every 500ms
let midHist = [];                    // sampled every 250ms
const logLines = [];
const health = MARKET.freshHealth();
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
  MARKET.stampMid(t, M);
  trades.push(t);
  if (ACC.mode==="sim" && t.v==="bn" && !t.liq) simOnTrade(t);
  MARKET.bumpCvd(cvd, t);
}

// ---------- sampling for charts ----------
setInterval(()=>{
  if (!connected) return;
  const row = MARKET.midRow(M, nowEx());
  if (row) midHist.push(row);
}, MARKET.MID_MS);
setInterval(()=>{ if (connected) cvdHist.push(MARKET.cvdRow(cvd, nowEx())); }, MARKET.CVD_MS);
function prune(){
  const cut = nowEx() - KEEP;
  const drop = (a) => { let i=0; while (i<a.length && a[i].t<cut) i++; return i ? a.slice(i) : a; };
  ({trades, midHist, cvdHist} = MARKET.prune(nowEx(), trades, midHist, cvdHist)); MI.hist = drop(MI.hist); MI.heatBn = drop(MI.heatBn); MI.heatHl = drop(MI.heatHl);
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
function emptyMsg(ctx,w,h,txt){ ctx.fillStyle=TH.dim; ctx.textAlign="center"; ctx.fillText(txt, w/2, h/2); }
function timeAxis(ctx, X, t0, t1, h, B, L, R, w){
  const win = t1-t0, step = win<=60000?10000:win<=180000?30000:60000;
  ctx.strokeStyle=TH.line; ctx.fillStyle=TH.dim; ctx.textAlign="center"; ctx.lineWidth=1;
  for (let k=step; k<=win; k+=step){
    const x = X(t1-k); if (x < L) break;
    ctx.beginPath(); ctx.moveTo(x,6); ctx.lineTo(x,h-B); ctx.stroke();
    ctx.fillText(`-${k/1000}s`, x, h-5);
  }
}
const COL = {buy:TH.buy, sell:TH.sell, bn:TH.bn, hl:TH.hl};

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
    const o = document.createElement("option"); o.value=d.id; o.textContent=`${d.v.toUpperCase()} ${d.name}`; o.style.color = LOG_COLOR[d.id] || ""; $("logFilter").appendChild(o);
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
  box.innerHTML = lines.map(l=>`${hhmmss(l.t)} <span style="color:${LOG_COLOR[l.id]||"inherit"}">${l.id.padEnd(14)}${l.bf?'<span class="bf">[replay] </span>':""}${esc(l.raw.length>220?l.raw.slice(0,220)+"…":l.raw)}</span>`).join("\n");
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
const MI = MICRO.create({onSweep:(v, t, side, ntl, levels) => { rdSafe(() => READER.onSweep(v, t, side, ntl, levels)); dirty = true; }});   // data logic: micro-core.js
const resetMicro = () => MI.reset();
const bnTopN = n => MICRO.bnTopN(bnBook, n), hlTop = () => MICRO.hlTop(hlBook);
const addSweep = (v, t, side, fills) => MI.addSweep(v, t, side, fills), bnSweepFeed = tr => MI.bnSweepFeed(tr);
setInterval(()=>{ if (!connected) return; MI.sample(nowEx(), bnBook, hlBook, M); }, 250);
setInterval(()=>MI.flushStale(nowEx()), 250);

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
  ctx.strokeStyle=TH.line; ctx.fillStyle=TH.dim; ctx.textAlign="left"; ctx.lineWidth=1;
  for (let v=Math.ceil(lo/st)*st; v<=hi; v+=st){ const y=Y(v); ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(w-R,y); ctx.stroke(); ctx.fillText(f(v), w-R+4, y+3.5); }
  if (lo<0 && hi>0){ ctx.strokeStyle=TH.edge; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(L,Y(0)); ctx.lineTo(w-R,Y(0)); ctx.stroke(); ctx.setLineDash([]); }
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
  const ss = (v==="bn"?MI.heatBn:MI.heatHl).filter(s=>s.t>=t0);
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
  ctx.fillStyle=TH.dim; ctx.textAlign="left";
  for (let p=Math.ceil(lo/st)*st; p<=hi; p+=st) ctx.fillText(fmt(p, st<1?1:0), w-R+4, Y(p)+3.5);
  timeAxis(ctx, X, t0, t1, h, B, L, R, w);
  ctx.save(); ctx.beginPath(); ctx.rect(L,T,pw,ph); ctx.clip();
  ctx.strokeStyle=TH.a("hi",.85); ctx.lineWidth=1.2; ctx.beginPath();
  ss.forEach((s,i)=>{ const x=X(s.t), y=Y(s.mid); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); }); ctx.stroke();
  for (const t of trades){
    if (t.v!==v || t.t<t0 || t.bf || t.liq) continue;
    const r = Math.min(14, Math.max(1.4, Math.sqrt(t.ntl)/22));
    ctx.fillStyle = t.side==="buy" ? TH.a("buy",.8) : TH.a("sell",.8);
    ctx.beginPath(); ctx.arc(X(t.t), Y(t.px), r, 0, Math.PI*2); ctx.fill();
  }
  for (const s of MI.sweeps){
    if (s.v!==v || s.t<t0) continue;
    const x=X(s.t), y=Y(s.to), d = s.side==="buy" ? -1 : 1;
    ctx.fillStyle = s.side==="buy" ? COL.buy : COL.sell; ctx.strokeStyle=TH.hi; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x, y+d*9); ctx.lineTo(x-5, y+d*1); ctx.lineTo(x+5, y+d*1); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle=TH.hi; ctx.fillRect(w-R+1, Y(mid)-7, R-2, 14); ctx.fillStyle=TH.ink; ctx.fillText(fmt(mid,1), w-R+4, Y(mid)+3.5);
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
    ctx.fillStyle=TH.dim; ctx.font="10px ui-monospace,Menlo,monospace"; ctx.fillText(labels[i], cx, h-6);
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
  const recent = MI.sweeps.filter(s=>s.t>=t0 && s.ntl>=min);
  const stat = v => { const a = recent.filter(s=>s.v===v); return `${a.length} · $${fmtK(a.reduce((x,s)=>x+s.ntl,0))}`; };
  $("swSum").innerHTML = [["BN sweeps (window)", stat("bn")], ["HL sweeps (window)", stat("hl")],
    ["Most levels", recent.length ? Math.max(...recent.map(s=>s.levels)) : "–"]]
    .map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("");
  $("swTable").innerHTML = `<tr><th>time</th><th>venue</th><th>side</th><th>lvls</th><th>fills</th><th>from → to</th><th>Δ</th><th>bps</th><th>$</th></tr>` +
    MI.sweeps.filter(s=>s.ntl>=min).slice(-80).reverse().map(s=>{
      const c = s.side==="buy"?"var(--buy)":"var(--sell)", d = Math.abs(s.to-s.from);
      return `<tr><td>${hhmmss(s.t)}</td><td><span class="venue v-${s.v}">${s.v.toUpperCase()}</span></td><td style="color:${c}">${s.side}</td>
        <td>${s.levels}</td><td>${s.fills}</td><td>${fmt(s.from,1)} → ${fmt(s.to,1)}</td><td>${fmt(d,1)}</td><td>${(d/s.from*1e4).toFixed(1)}</td><td style="color:${c}">${fmtK(s.ntl)}</td></tr>`;
    }).join("");
}

function renderMicro(){
  drawHeat();
  const N = $("imbN").value;
  drawLines($("cvImb"), MI.hist, [{key:"bnImb"+N, color:COL.bn},{key:"hlImb"+N, color:COL.hl}], {lo:-1.05, hi:1.05, fmt:v=>(v*100).toFixed(0)+"%"});
  drawLines($("cvMicro"), MI.hist, [{key:"bnMicro", color:COL.bn},{key:"hlMicro", color:COL.hl}], {zero:true});
  drawLines($("cvSpread"), MI.hist, [{key:"bnSpread", color:COL.bn},{key:"hlSpread", color:COL.hl}], {zero:true});
  drawLines($("cvBasis"), MI.hist, [{key:"basis", color:TH.accent}], {zero:true});
  const t0 = nowEx() - +$("mwin").value, b = MI.hist.filter(r=>r.t>=t0 && r.basis!=null).map(r=>r.basis);
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


// ---------- tabs ----------
// Seven areas by what you are doing; an area with several views shows them as a sub-row. Every view is one VIEWS.register (views.js): its place in
// the navigation, and (render + minIntervalMs) how the frame loop draws it. Views of one slot (reader) share one render and one throttle.
for (const [id, l, icon] of [["now","Now","M3 12h4l3-8 4 16 3-8h4"],["setups","Setups","M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],["reader","Reader","M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z"],["review","Review","M4 6l2 2 3-3M4 14l2 2 3-3M13 7h8M13 15h8"],["rec","Recordings","M12 4a8 8 0 100 16 8 8 0 000-16zM12 9a3 3 0 100 6 3 3 0 000-6z"],["trade","Trade","M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"],["system","System","M4 7h8M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6"]]) VIEWS.area(id, l, icon);
const READER_SLOT = {slot:"reader", render:()=>renderReader(), minIntervalMs:250};   // renderReader draws all of these views
VIEWS.register({id:"overview", label:"Overview", area:"now", minIntervalMs:250, render:()=>{ try{ renderOverview(); }catch(e){ console.error("overview", e); } }});
VIEWS.register({id:"armmode", label:"Arm mode", area:"now"});
VIEWS.register({id:"market", label:"Market and tape", area:"now"});
VIEWS.register({id:"futures", label:"Futures stack", area:"setups", minIntervalMs:250, render:()=>{ if (typeof futuresRender === "function") futuresRender(); }});
VIEWS.register({id:"micro", label:"Microstructure", area:"setups", minIntervalMs:250, render:()=>renderMicro()});
VIEWS.register(Object.assign({id:"reader", label:"Episodes", area:"reader"}, READER_SLOT));
VIEWS.register({id:"signals", label:"Signals", area:"reader", slot:"reader"});
VIEWS.register({id:"replay", label:"Replay and labels", area:"review", slot:"reader"});
VIEWS.register({id:"drift", label:"Drift", area:"review", slot:"reader"});
VIEWS.register({id:"assumptions", label:"Assumptions", area:"review", slot:"reader"});
VIEWS.register({id:"scoreboard", label:"Scoreboard", area:"review"});
VIEWS.register({id:"record", label:"Record", area:"rec", slot:"reader"});
VIEWS.register({id:"saved", label:"Saved", area:"rec", slot:"reader"});
VIEWS.register({id:"healthlog", label:"Health log", area:"rec", slot:"reader"});
VIEWS.register({id:"collectors", label:"Collectors", area:"rec", slot:"reader"});
VIEWS.register({id:"trading", label:"Trading", area:"trade", minIntervalMs:400, render:()=>renderTrading()});
VIEWS.register({id:"history", label:"History", area:"trade"});
VIEWS.register({id:"streams", label:"Streams", area:"system"});
VIEWS.register({id:"health", label:"Feed health", area:"system"});
VIEWS.register({id:"raw", label:"Raw", area:"system"});
VIEWS.register({id:"engine", label:"Engine", area:"system", slot:"reader"});
const TABS = VIEWS.tabs(), GROUPS = VIEWS.groups();
const GICON = VIEWS.icons();
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
  VIEWS.open(t);
}
const visible = name => tab===name || (tab==="trading" && !!document.querySelector(`#tgrid section[data-home="${name}"]`));
$("groups").innerHTML = GROUPS.map(([id,l])=>`<button data-g="${id}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${GICON[id]}"/></svg><span>${l}</span></button>`).join("");
$("groups").onclick = e => { const b = e.target.closest("button"); if (!b) return; const g = GROUPS.find(x=>x[0]===b.dataset.g), last = store.get("lastView", {})[g[0]]; setTab(g[2].includes(last) ? last : g[2][0]); window.scrollTo(0, 0); };
{ const hdr = document.querySelector("header"), setHH = () => document.documentElement.style.setProperty("--hh", hdr.offsetHeight + "px"); setHH(); if (window.ResizeObserver) new ResizeObserver(setHH).observe(hdr); }   // the PC sidebar starts under the header
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
let SIM = null;                                                // the paper broker lives in paper-broker-core.js (PAPER); these wrappers supply the quotes, symbol and clock
const simCtx = () => ({sym:accSym(), now:Date.now(), q:{bid:M.bnBid, ask:M.bnAsk, mark:M.bnMark}});
function simReset(start){ SIM = PAPER.reset(start); }
const simPos = (sym=accSym()) => PAPER.pos(SIM, sym);
function simLogEnd(id, status, filled, avg){ PAPER.logEnd(SIM, simCtx(), id, status, filled, avg); }
function simPlace(o){
  const r = PAPER.place(SIM, simCtx(), o);
  return r.kind==="filled" ? {msg:`filled ${r.qty} @ ${fmt(r.px,1)}${r.crossed ? " (crossed)" : ""}`} : {msg:`limit resting @ ${r.price}`};
}
function simOnTrade(t){ if (SIM) PAPER.onTrade(SIM, simCtx(), t); }
function simSnapshot(){ return PAPER.snapshot(SIM, simCtx()); }

// ---- the broker seam: broker.js holds the two adapters; validation and the live confirm stay in placeOrder below ----
const SIMB = BROKER.sim({getSim:()=>SIM, sym:accSym, place:simPlace, logEnd:simLogEnd, snapshot:simSnapshot});
const BNB = BROKER.binance({signed:bnSigned, sym:accSym});   // demo and live
const broker = () => ACC.mode==="sim" ? SIMB : BNB;
async function bnRefresh(){ ACC.data = await BNB.snapshot(); }
async function accRefresh(){
  if (!ACC.mode) return;
  if (ACC.mode==="sim"){ ACC.data = SIMB.snapshot(); return; }
  try{ await bnRefresh(); ACC.status = ""; }catch(e){ ACC.status = e.message; }
}
setInterval(()=>{ if (ACC.mode && ACC.mode!=="sim") accRefresh(); }, 3000);
const refreshSoon = () => setTimeout(accRefresh, 400);

async function placeOrder(o){
  if (!ACC.mode) throw new Error("no account; log in with the account button in the header");
  const f = await loadFilters();
  const q = +roundStep(o.qty, f.step);
  if (!(q > 0) || q < f.minQty) throw new Error(`size below the minimum of ${f.minQty} ${accAsset()}`);
  const price = o.type==="LIMIT" ? +roundTick(o.price, f.tick) : o.price, notional = q*price;
  if (!o.reduce && f.minNotional && notional < f.minNotional) throw new Error(`order value $${notional.toFixed(2)} is below Binance's $${f.minNotional} minimum`);
  if (ACC.mode==="live" && notional > ACC.maxUsd) throw new Error(`order value $${notional.toFixed(0)} is above your $${ACC.maxUsd} live cap`);
  if (ACC.mode==="live" && !confirm(`REAL-MONEY ORDER on Binance\n\n${o.side} ${q} ${accSym()} · ${o.type}${o.type==="LIMIT" ? " @ "+price : ""}\n≈ $${notional.toFixed(2)}${o.reduce ? "\nreduce-only" : ""}\n\nSend this order?`)) throw new Error("cancelled");
  const res = await broker().place({...o, qty:q, price, qtyStr:roundStep(q, f.step), priceStr:o.type==="LIMIT" ? roundTick(price, f.tick) : undefined});
  accRefresh(); refreshSoon(); return res;
}
async function cancelOrder(id){
  await broker().cancel(id);
  accRefresh(); refreshSoon();
}
async function cancelAll(){
  await broker().cancelAll();   // this asset only, in both adapters
  accRefresh(); refreshSoon();
}

function logout(){
  Object.assign(ACC, {mode:null, key:null, secret:null, base:null, maxUsd:Infinity, status:"", data:null});
  SIM = null; renderAccount();
  HOOKS.emit("logout");
}
function renderAccount(){
  $("accActive").innerHTML = !ACC.mode ? "No account connected." :
    ACC.mode==="sim" ? `Connected: <b>simulated paper</b> · started with $${fmtK(SIM.start)}` :
    ACC.mode==="demo" ? `Connected: <b>Binance demo</b> (paper)` :
    `Connected: <b style="color:var(--sell)">Binance LIVE — real money</b> · max order $${ACC.maxUsd}`;
  HOOKS.emit("renderAccount");
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

// ---------- trading tab / Reader cards: see trading-view.js and reader-cards.js (loaded before this file) ----------
tradingInit();

function renderReader(){
  const s=RD().state(),card=(k,v,cls)=>`<div class="rd-card ${cls||""}"><span>${k}</span><b>${v}</b></div>`;
  $("rdStatus").textContent=s.calibrated?"armed":`calibrating ${(s.calibratingPct*100).toFixed(0)}%`;
  renderEpisodes(s);
  rdToolsRender(s);
  $("rdStrip").innerHTML=[card("activity",`${s.regime} (x${s.ratio.toFixed(2)})`)].concat(["fast","mid","slow"].map(k=>{const h=s.horizons[k];return h?card(`${k} - window ${rdMs(h.ms)}`,`${h.side} (${(h.share*100).toFixed(0)}% buy)`,h.side==="buyers"?"buy":h.side==="sellers"?"sell":""):card(k,"-");})).concat([card("episodes active",String(s.episodesActive))]).join("");
  const rows=RD().events.slice().reverse().filter(e=>(!rdFilter.family.size||rdFilter.family.has(e.family))&&(!rdFilter.venue.size||rdFilter.venue.has(e.venue))&&e.strength>=rdFilter.min).slice(0,100);
  $("rdFeed").innerHTML=`<tr><th>time</th><th>type</th><th>venue</th><th>price</th><th>horizon</th><th>strength</th><th>evidence</th></tr>`+rows.map(e=>`<tr class="neutral"><td>${hhmmss(e.t)}</td><td>${e.type.replace(/_/g," ")}</td><td><span class="venue v-${e.venue}">${e.venue.toUpperCase()}</span></td><td>${fmt(e.px,1)}</td><td>${e.horizon}</td><td><i class="rd-str" style="width:${Math.round(e.strength*60)}px"></i> ${(e.strength*100).toFixed(0)}</td><td style="white-space:normal">${rdEsc(e.evidence)}</td></tr>`).join("");
  const hs=["bn.trade","bn.depth","bn.bookTicker","hl.trades","hl.l2Book","hl.bbo"].map(id=>[id.replace("."," "),S[id].on?(status(S[id])||"-"):"off"]);
  hs.push(["signals / min",s.eventsPerMin],["BN book age",s.bookAgeMs.bn==null?"-":s.bookAgeMs.bn+" ms"],["HL book age",s.bookAgeMs.hl==null?"-":s.bookAgeMs.hl+" ms"],["heartbeat",rdWorker?"on":"off"]);
  $("rdHealth").innerHTML=hs.map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("");
  HOOKS.emit("renderReader");
}

// ---------- loops ----------
function renderSlow(){
  if (visible("streams")) renderCards();
  if (visible("health")) renderHealth();
  renderAlerts();
}
setInterval(()=>{
  for (const id in S){ const s=S[id]; s.rates.shift(); s.rates.push(s.cur); s.cur=0; }
  for (const [st,pre] of [[bnStats,"bn"],[hlStats,"hl"]]){ $(pre+"Rate").textContent=st.cur; $(pre+"Bytes").textContent=(st.bytes/1024).toFixed(1); st.cur=0; st.bytes=0; }
  prune(); renderSlow();
}, 1000);
let lastFast = 0;
(function frame(ts){
  VIEWS.tick(ts, visible);   // overview, futures, micro, the reader views, trading: registered above
  if (dirty && ts - lastFast > 150){
    dirty = false; lastFast = ts;
    if (visible("market")){ renderMetrics(); renderBooks(); renderTape(); }
    if (visible("raw")){ renderLog(); renderInspector(); }
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
  trades=[]; cvd=MARKET.freshCvd(); cvdHist=[]; midHist=[]; resetMicro(); logLines.length=0; hlBook=null; bnBook=null;
  resetMarket(); Object.assign(health, MARKET.freshHealth());
  READER.reset(); rdLastBook.bn = rdLastBook.hl = 0;
  syncClock(); clockTimer = setInterval(syncClock, 60000);
  bnConnect(); hlConnect(); rdStartHeartbeat();
  $("go").textContent="Disconnect"; $("go").classList.remove("primary");
};
$("route").onchange = () => scheduleReconnect("bn");
$("bnSrc").onchange = () => {
  const id = $("bnSrc").value;                       // make sure the chosen source is subscribed
  if (!S[id].on){ S[id].on = true; const el=$("c-"+id); el.classList.remove("off"); el.querySelector("input").checked = true; scheduleReconnect("bn"); }
  trades = trades.filter(t => t.v!=="bn" || t.liq);   // avoid mixing sources in the history
  cvd.bn = 0; cvdHist = [];
};
$("sym").onchange = () => { if (connected){ resetMicro(); trades=[]; midHist=[]; cvdHist=[]; cvd=MARKET.freshCvd(); resetMarket(); READER.reset(); rdLastBook.bn = rdLastBook.hl = 0; hlBook=null; bnConnect(); hlConnect(); } };
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
for (const id of ["sym","route","bnSrc","ovWin","rdSens","rdMin","minNtl","swMin","tlWin","rtMissFam","rtMissSide"]){
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
  document.querySelectorAll("main > section[data-tab]").forEach(sec=>{
    const h2 = sec.querySelector(":scope > h2"); if (!h2 || sec.classList.contains("tcontainer")) return;
    const body = document.createElement("div"); body.className = "pbody";
    while (h2.nextSibling) body.appendChild(h2.nextSibling);
    sec.appendChild(body); sec.classList.add("cx");
    const key = sec.dataset.tab + "/" + (h2.childNodes[0].textContent || "").trim();
    sec.dataset.fold = key;
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