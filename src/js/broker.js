// ---------- broker seam: one interface, two adapters ----------
// Interface: place(order) -> {msg}, cancel(id), cancelAll() (this asset only), snapshot() -> {balance, positions, orders, fills}.
// Validation (filter rounding, minimums, live cap) and the live confirm() stay above the seam, in app.js placeOrder.
// No DOM, timers or storage: everything impure (signing/fetch, the PAPER state, quotes) is injected, so build.mjs self-tests it.
// order handed to place(): {side, type, qty, price, reduce, qtyStr, priceStr} with qty/price already rounded to the exchange filters.
const BROKER = (() => {
  function sim(d){   // d: {getSim, sym, ctx, place, logEnd, snapshot}  (the sim* wrappers in app.js over PAPER)
    return {
      place: o => d.place(o),
      cancel(id){ const S = d.getSim(); if (S.orders.some(x=>x.id===id)) d.logEnd(id, "CANCELED"); S.orders = S.orders.filter(x=>x.id!==id); },
      cancelAll(){ const S = d.getSim(), sym = d.sym(); S.orders.filter(x=>x.symbol===sym).forEach(x=>d.logEnd(x.id, "CANCELED")); S.orders = S.orders.filter(x=>x.symbol!==sym); },   // same scope as live: this asset only
      snapshot: () => d.snapshot(),
    };
  }
  function binance(d){   // d: {signed(method, path, params), sym}  (demo and live share it; the base URL lives in signed)
    return {
      async place(o){
        const prm = {symbol:d.sym(), side:o.side, type:o.type, quantity:o.qtyStr};
        if (o.type==="LIMIT"){ prm.price = o.priceStr; prm.timeInForce = "GTC"; }
        if (o.reduce) prm.reduceOnly = "true";
        const r = await d.signed("POST","/fapi/v1/order", prm);
        return {msg:`order ${r.orderId} ${r.status}`};
      },
      async cancel(id){ await d.signed("DELETE","/fapi/v1/order",{symbol:d.sym(), orderId:String(id)}); },
      async cancelAll(){ await d.signed("DELETE","/fapi/v1/allOpenOrders",{symbol:d.sym()}); },
      async snapshot(){
        const sym = d.sym();
        const [bal, pos, ords, fills] = await Promise.all([
          d.signed("GET","/fapi/v2/balance"), d.signed("GET","/fapi/v2/positionRisk",{symbol:sym}),
          d.signed("GET","/fapi/v1/openOrders",{symbol:sym}), d.signed("GET","/fapi/v1/userTrades",{symbol:sym, limit:"30"})]);
        if (![bal, pos, ords, fills].every(Array.isArray)) throw new Error("unexpected response from Binance (check the keys and that USD-M futures is enabled)");
        const u = bal.find(b=>b.asset==="USDT") || {};
        return {balance:{wallet:+u.balance, available:+u.availableBalance, upnl:+u.crossUnPnl},
          positions: pos.filter(p=>+p.positionAmt!==0).map(p=>({symbol:p.symbol, qty:+p.positionAmt, entry:+p.entryPrice, mark:+p.markPrice, upnl:+p.unRealizedProfit, liq:+p.liquidationPrice||null, lev:p.leverage})),
          orders: ords.map(o=>({id:o.orderId, side:o.side, type:o.type, qty:+o.origQty, filled:+o.executedQty, price:+o.price, reduce:o.reduceOnly, t:o.time})),
          fills: fills.slice().reverse().map(f=>({t:f.time, side:f.side, qty:+f.qty, price:+f.price, fee:+f.commission, pnl:+f.realizedPnl}))};
      },
    };
  }
  async function selftest(){
    const out = [], ok = (n, c) => out.push({name:"broker: "+n, ok:!!c, detail:c ? "" : "failed"});
    const calls = [];
    const signed = async (m, p, prm) => { calls.push([m, p, JSON.stringify(prm||{})]);
      if (p==="/fapi/v1/order" && m==="POST") return {orderId:7, status:"NEW"};
      if (p==="/fapi/v2/balance") return [{asset:"USDT", balance:"100", availableBalance:"90", crossUnPnl:"1"}];
      if (p==="/fapi/v2/positionRisk") return [{symbol:"BTCUSDT", positionAmt:"0.5", entryPrice:"10", markPrice:"11", unRealizedProfit:"0.5", liquidationPrice:"0", leverage:"5"}, {symbol:"BTCUSDT", positionAmt:"0"}];
      if (p==="/fapi/v1/openOrders") return [{orderId:3, side:"BUY", type:"LIMIT", origQty:"1", executedQty:"0", price:"9", reduceOnly:false, time:5}];
      if (p==="/fapi/v1/userTrades") return [{time:1, side:"BUY", qty:"1", price:"9", commission:"0.1", realizedPnl:"0"}, {time:2, side:"SELL", qty:"1", price:"10", commission:"0.1", realizedPnl:"1"}];
      return {}; };
    const b = binance({signed, sym:()=>"BTCUSDT"});
    let r = await b.place({side:"BUY", type:"LIMIT", qty:1, price:9, reduce:true, qtyStr:"1.000", priceStr:"9.0"});
    ok("limit place params", calls[0].join(" ")==='POST /fapi/v1/order {"symbol":"BTCUSDT","side":"BUY","type":"LIMIT","quantity":"1.000","price":"9.0","timeInForce":"GTC","reduceOnly":"true"}' && r.msg==="order 7 NEW");
    calls.length = 0; await b.place({side:"SELL", type:"MARKET", qty:1, price:0, reduce:false, qtyStr:"2"});
    ok("market place params", calls[0][2]==='{"symbol":"BTCUSDT","side":"SELL","type":"MARKET","quantity":"2"}');
    calls.length = 0; await b.cancel(12);
    ok("cancel", calls[0].join(" ")==='DELETE /fapi/v1/order {"symbol":"BTCUSDT","orderId":"12"}');
    calls.length = 0; await b.cancelAll();
    ok("cancelAll", calls[0].join(" ")==='DELETE /fapi/v1/allOpenOrders {"symbol":"BTCUSDT"}');
    calls.length = 0; const snap = await b.snapshot();
    ok("snapshot requests", calls.map(c=>c[0]+" "+c[1]+" "+c[2]).sort().join("|")===['GET /fapi/v2/balance {}','GET /fapi/v2/positionRisk {"symbol":"BTCUSDT"}','GET /fapi/v1/openOrders {"symbol":"BTCUSDT"}','GET /fapi/v1/userTrades {"symbol":"BTCUSDT","limit":"30"}'].sort().join("|"));
    ok("snapshot mapping", snap.balance.wallet===100 && snap.positions.length===1 && snap.positions[0].liq===null && snap.orders[0].id===3 && snap.fills[0].t===2);
    let bad = false; try{ await binance({signed:async()=>({}), sym:()=>"X"}).snapshot(); }catch(e){ bad = /unexpected response/.test(e.message); }
    ok("snapshot rejects non-array", bad);
    // sim adapter + same-shape check, over the real PAPER core
    const SIMST = PAPER.reset(1000), ctx = () => ({sym:"BTCUSDT", now:1, q:{bid:99, ask:101, mark:100}});
    const s = sim({getSim:()=>SIMST, sym:()=>"BTCUSDT", place:o=>PAPER.place(SIMST, ctx(), o), logEnd:(id,st,f,a)=>PAPER.logEnd(SIMST, ctx(), id, st, f, a), snapshot:()=>PAPER.snapshot(SIMST, ctx())});
    s.place({side:"BUY", type:"LIMIT", qty:1, price:50, reduce:false});
    ok("sim limit rests", SIMST.orders.length===1);
    const ssnap = s.snapshot();
    ok("sim and binance snapshot same shape (sim orders may carry extra fields)", JSON.stringify(Object.keys(ssnap))===JSON.stringify(Object.keys(snap)) && JSON.stringify(Object.keys(ssnap.balance))===JSON.stringify(Object.keys(snap.balance)) && Object.keys(snap.orders[0]).every(k => k in ssnap.orders[0]) && Object.keys(snap.positions[0]).every(k => k in PAPER.snapshot((()=>{ const T = PAPER.reset(1000); PAPER.place(T, ctx(), {type:"MARKET", side:"BUY", qty:1}); return T; })(), ctx()).positions[0]));
    s.cancelAll(); ok("sim cancelAll", SIMST.orders.length===0);
    return out;
  }
  return {sim, binance, selftest};
})();
