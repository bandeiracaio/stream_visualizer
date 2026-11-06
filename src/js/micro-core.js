"use strict";
// Microstructure data (pure, no DOM, timers or storage): book imbalance, microprice, heat snapshots, the 250 ms sample row and sweep grouping.
// Feed it books, quotes and trades; read hist / heatBn / heatHl / sweeps from the instance. Display only: nothing here feeds a detection
// (the Reader hears about a sweep only through the onSweep hook the page passes in). The page owns the timers and the drawing.
const MICRO = (() => {
  function niceStep(x){ const p = 10**Math.floor(Math.log10(x)); for (const m of [1,2,2.5,5,10]) if (m*p >= x) return m*p; return 10*p; }
  function topN(map, n, desc){
    const out = [];
    for (const [p, q] of map){
      const px = +p; let i = out.length;
      while (i > 0 && (desc ? out[i-1][0] < px : out[i-1][0] > px)) i--;
      if (i < n){ out.splice(i, 0, [px, q]); if (out.length > n) out.pop(); }
    }
    return out;
  }
  // bnBook: {ready, bids:Map, asks:Map}; hlBook: [bidLevels, askLevels] of {px, sz}
  function bnTopN(bnBook, n){ return bnBook && bnBook.ready && bnBook.bids.size && bnBook.asks.size ? {bids:topN(bnBook.bids,n,true), asks:topN(bnBook.asks,n,false)} : null; }
  function bnTop(bnBook){
    if (!bnBook || !bnBook.ready || !bnBook.bids.size || !bnBook.asks.size) return null;
    return { bids:[...bnBook.bids].map(([p,q])=>[+p,q]).sort((a,b)=>b[0]-a[0]),
             asks:[...bnBook.asks].map(([p,q])=>[+p,q]).sort((a,b)=>a[0]-b[0]) };
  }
  function hlTop(hlBook){
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

  // opts.onSweep(v, t, side, notional, levels) is called after each recorded sweep
  function create(opts){
    const onSweep = (opts && opts.onSweep) || (() => {});
    const me = {hist:[], heatBn:[], heatHl:[], sweeps:[], group:null};
    me.reset = () => { me.hist=[]; me.heatBn=[]; me.heatHl=[]; me.sweeps=[]; me.group=null; };
    // one 250 ms sample from the two books and the quote object M (bnBid/bnAsk/bnBidSz/bnAskSz, same for hl)
    me.sample = (t, bnBook, hlBook, M) => {
      const r = {t};
      const bn = bnTop(bnBook);
      if (bn){ for (const N of [5,10,20]) r["bnImb"+N] = imbalance(bn,N); me.heatBn.push(heatSnap(bn,t)); }
      const hl = hlTop(hlBook);
      if (hl){ for (const N of [5,10,20]) r["hlImb"+N] = imbalance(hl,N); me.heatHl.push(heatSnap(hl,t)); }
      let bnMid=null, hlMid=null;
      if (M.bnBid && M.bnAsk){ bnMid=(M.bnBid+M.bnAsk)/2; r.bnSpread=M.bnAsk-M.bnBid; const mp=microprice(M.bnBid,M.bnAsk,M.bnBidSz,M.bnAskSz); if (mp!=null) r.bnMicro=mp-bnMid; }
      if (M.hlBid && M.hlAsk){ hlMid=(M.hlBid+M.hlAsk)/2; r.hlSpread=M.hlAsk-M.hlBid; const mp=microprice(M.hlBid,M.hlAsk,M.hlBidSz,M.hlAskSz); if (mp!=null) r.hlMicro=mp-hlMid; }
      if (bnMid && hlMid) r.basis = hlMid - bnMid;
      me.hist.push(r);
      return r;
    };
    // sweeps: an aggressive order filling at 2+ prices
    me.addSweep = (v, t, side, fills) => {
      const pxs = new Set(fills.map(f=>f.px)); if (pxs.size < 2) return;
      const lo = Math.min(...pxs), hi = Math.max(...pxs);
      me.sweeps.push({t, v, side, levels:pxs.size, fills:fills.length, from: side==="buy"?lo:hi, to: side==="buy"?hi:lo,
                      ntl: fills.reduce((a,f)=>a+f.ntl,0)});
      if (me.sweeps.length > 300) me.sweeps.shift();
      onSweep(v, t, side, fills.reduce((a, f) => a + f.ntl, 0), pxs.size);
    };
    me.flushGroup = () => { if (me.group){ me.addSweep("bn", me.group.t, me.group.side, me.group.fills); me.group=null; } };
    me.bnSweepFeed = tr => {   // Binance gives no taker-order id on @trade: same ms + same side ~ one order
      if (me.group && (me.group.t!==tr.t || me.group.side!==tr.side)) me.flushGroup();
      if (!me.group) me.group = {t:tr.t, side:tr.side, fills:[]};
      me.group.fills.push(tr);
    };
    me.flushStale = now => { if (me.group && now-me.group.t > 500) me.flushGroup(); };
    return me;
  }

  function selftest(){
    const out = [], T = (name, ok, detail) => out.push({name:"micro: "+name, ok:!!ok, detail:ok?"":String(detail)});
    const heard = [];
    const m = create({onSweep:(...a)=>heard.push(a)});
    for (const px of [100, 101, 102]) m.bnSweepFeed({t:1000, side:"buy", px, q:1, ntl:px});
    T("same ms and side stay one open group", m.sweeps.length===0 && m.group.fills.length===3, m.sweeps.length);
    m.bnSweepFeed({t:1001, side:"buy", px:103, q:1, ntl:103});
    T("a new ms flushes one 3-level sweep", m.sweeps.length===1 && m.sweeps[0].levels===3 && m.sweeps[0].fills===3 && m.sweeps[0].from===100 && m.sweeps[0].to===102 && m.sweeps[0].ntl===303, JSON.stringify(m.sweeps));
    T("onSweep hook heard it", heard.length===1 && heard[0][0]==="bn" && heard[0][3]===303 && heard[0][4]===3, JSON.stringify(heard));
    m.bnSweepFeed({t:1001, side:"sell", px:102, q:1, ntl:102});
    T("other side in the same ms splits", m.group.side==="sell" && m.group.fills.length===1 && m.sweeps.length===1, JSON.stringify(m.group));
    m.flushStale(1300);
    T("fresh group within 500 ms is kept", m.group!==null);
    m.flushStale(1502);
    T("stale group past 500 ms is flushed (one price: no sweep)", m.group===null && m.sweeps.length===1);
    m.addSweep("hl", 5, "sell", [{px:10,ntl:10},{px:9,ntl:9}]);
    T("sell sweep goes from high to low", m.sweeps[1].from===10 && m.sweeps[1].to===9 && m.sweeps[1].v==="hl");
    for (let i=0;i<310;i++) m.addSweep("hl", i, "buy", [{px:1,ntl:1},{px:2,ntl:1}]);
    T("sweeps are capped at 300", m.sweeps.length===300);
    T("imbalance", Math.abs(imbalance({bids:[[10,3],[9,1]], asks:[[11,1],[12,1]]}, 1) - 0.5)<1e-12 && imbalance({bids:[],asks:[]},5)===null);
    T("microprice", microprice(100,102,3,1)===(100*1+102*3)/4 && microprice(1,2,0,0)===null);
    const snap = heatSnap({bids:[[99990,2]], asks:[[100010,3]]}, 7), tot = snap.arr.reduce((a,x)=>a+x,0);
    T("heat snapshot keeps mid and the book's size", snap.t===7 && snap.mid===100000 && Math.abs(tot-5)<1e-6, JSON.stringify([snap.mid,tot]));
    const bnBook = {ready:true, bids:new Map([["100",1],["99",2]]), asks:new Map([["101",1],["102",5]])};
    T("topN orders bids desc and asks asc", JSON.stringify(topN(bnBook.bids,1,true))==="[[100,1]]" && JSON.stringify(topN(bnBook.asks,2,false))==="[[101,1],[102,5]]");
    const hlBook = [[{px:"100",sz:"1"}],[{px:"101",sz:"1"}]];
    const r = m.sample(500, bnBook, hlBook, {bnBid:100, bnAsk:101, bnBidSz:3, bnAskSz:1, hlBid:100.5, hlAsk:101.5, hlBidSz:1, hlAskSz:1});
    T("sample row values", r.bnImb5===(3-6)/9 && r.hlImb5===0 && r.bnSpread===1 && r.basis===0.5 && m.hist.length===1 && m.heatBn.length===1 && m.heatHl.length===1, JSON.stringify(r));
    T("sample microprice offset", Math.abs(r.bnMicro-((100*1+101*3)/4-100.5))<1e-12, r.bnMicro);
    m.reset();
    T("reset clears all state", !m.hist.length && !m.heatBn.length && !m.heatHl.length && !m.sweeps.length && m.group===null);
    T("no book: row only has t", Object.keys(m.sample(1, null, null, {})).join()==="t");
    return out;
  }
  return {create, selftest, topN, bnTopN, bnTop, hlTop, imbalance, heatSnap, microprice};
})();
