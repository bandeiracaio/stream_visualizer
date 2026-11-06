"use strict";
// Simulated paper broker (pure, no DOM, timers or storage): state, quotes, symbol and clock are passed in, never read from the page.
// Display only: the Reader engine, feeds and the Binance broker are untouched. Rows go to the history log through HIST.push.
// ctx = {sym, now, q:{bid, ask, mark}}; functions change the state they are given in place (same SIM shape as before) and return results.
const PAPER = (() => {
  const MAKER = 0.0002, TAKER = 0.0005;
  const reset = start => ({start, cash:start, positions:{}, orders:[], fills:[], nextId:1, log:{orders:[], fills:[], income:[]}, logSeq:100000});   // orders filled at once and the fills and income rows take ids from logSeq so the ids of resting orders do not change
  // one position per asset: the header lets you switch asset while the paper account is live
  const pos = (S, sym) => (S.positions[sym] ||= {symbol:sym, qty:0, entry:0, mark:null});
  function fill(S, ctx, side, qty, price, maker, oid) {
    const fee = qty*price*(maker ? MAKER : TAKER), p = pos(S, ctx.sym), signed = side==="BUY" ? qty : -qty; let pnl = 0;
    S.cash -= fee;
    if (p.qty===0 || Math.sign(p.qty)===Math.sign(signed)) { p.entry = (p.entry*Math.abs(p.qty) + price*qty)/(Math.abs(p.qty)+qty); p.qty += signed; }
    else {
      const close = Math.min(Math.abs(p.qty), qty); pnl = close*(price-p.entry)*Math.sign(p.qty); S.cash += pnl;
      const wasSign = Math.sign(p.qty); p.qty += signed;
      if (Math.abs(p.qty) < 1e-12) { p.qty = 0; p.entry = 0; } else if (Math.sign(p.qty)!==wasSign) p.entry = price;
    }
    p.qty = +p.qty.toFixed(10);                                // drop float dust (0.12 - 0.05 = 0.06999999999999999)
    S.fills.unshift({t:ctx.now, side, qty, price, fee, pnl, symbol:p.symbol}); if (S.fills.length > 50) S.fills.pop();
    const lg = S.log, now = ctx.now;
    HIST.push(lg.fills, {id:S.logSeq++, orderId:oid, t:now, symbol:p.symbol, side, price, qty, fee, feeAsset:"USDT", pnl, maker});
    HIST.push(lg.income, {id:S.logSeq++, t:now, symbol:p.symbol, type:"COMMISSION", amount:-fee, asset:"USDT", info:""});
    if (pnl) HIST.push(lg.income, {id:S.logSeq++, t:now, symbol:p.symbol, type:"REALIZED_PNL", amount:pnl, asset:"USDT", info:""});
  }
  // reduce-only: never grow or flip the position
  function capReduce(S, ctx, o) {
    const p = pos(S, ctx.sym).qty, opp = (o.side==="SELL" && p>0) || (o.side==="BUY" && p<0);
    if (!opp) return 0; return Math.min(o.qty, Math.abs(p));
  }
  // the order log: a row when an order is placed, updated when it fills or ends
  const logNew = (S, ctx, row) => HIST.push(S.log.orders, Object.assign({t:ctx.now, upd:ctx.now, symbol:ctx.sym, tif:""}, row));
  function logEnd(S, ctx, id, status, filled, avg) {
    for (let i = S.log.orders.length - 1; i >= 0; i--) { const r = S.log.orders[i]; if (r.id === id) { r.status = status; r.upd = ctx.now; if (filled != null) { r.filled = filled; r.avg = avg; } return; } }
  }
  // returns {kind:"filled", qty, px, crossed} or {kind:"resting", price}; the caller words the message. Throws the same errors as before.
  function place(S, ctx, o) {
    const bid = ctx.q.bid, ask = ctx.q.ask;
    if (o.type==="MARKET") {
      const px = o.side==="BUY" ? ask : bid; if (!px) throw new Error("no Binance prices yet; press Connect");
      const q = o.reduce ? capReduce(S, ctx, o) : o.qty; if (!q) throw new Error("reduce-only: no position to reduce");
      const id = S.logSeq++; fill(S, ctx, o.side, q, px, false, id); logNew(S, ctx, {id, side:o.side, type:"MARKET", price:0, qty:q, filled:q, avg:px, status:"FILLED", reduce:!!o.reduce});
      return {kind:"filled", qty:q, px, crossed:false};
    }
    const cross = o.side==="BUY" ? (ask && o.price >= ask) : (bid && o.price <= bid);
    if (cross) {
      const px = o.side==="BUY" ? ask : bid, q = o.reduce ? capReduce(S, ctx, o) : o.qty; if (!q) throw new Error("reduce-only: no position to reduce");
      const id = S.logSeq++; fill(S, ctx, o.side, q, px, false, id); logNew(S, ctx, {id, side:o.side, type:"LIMIT", price:+o.price, qty:q, filled:q, avg:px, status:"FILLED", reduce:!!o.reduce, tif:"GTC"});
      return {kind:"filled", qty:q, px, crossed:true};
    }
    const rest = {id:S.nextId++, symbol:ctx.sym, side:o.side, type:"LIMIT", qty:o.qty, filled:0, price:+o.price, reduce:o.reduce, t:ctx.now};
    S.orders.push(rest); logNew(S, ctx, {id:rest.id, side:o.side, type:"LIMIT", price:+o.price, qty:o.qty, filled:0, avg:0, status:"NEW", reduce:!!o.reduce, tif:"GTC"});
    return {kind:"resting", price:o.price};
  }
  function onTrade(S, ctx, t) {
    if (!S || !S.orders.length) return;
    S.orders = S.orders.filter(o => {
      if (o.symbol !== ctx.sym) return true;                   // trades on this feed only touch this asset's orders
      const hit = (o.side==="BUY" && t.px <= o.price) || (o.side==="SELL" && t.px >= o.price);
      if (!hit) return true;
      const q = o.reduce ? capReduce(S, ctx, o) : o.qty; if (q) fill(S, ctx, o.side, q, o.price, true, o.id);
      logEnd(S, ctx, o.id, q ? "FILLED" : "EXPIRED", q, q ? o.price : 0);   // a reduce-only order with nothing left to reduce ends without a fill
      return false;
    });
  }
  function snapshot(S, ctx) {
    const sym = ctx.sym, cur = pos(S, sym), q = ctx.q;
    cur.mark = q.mark || (q.bid && q.ask ? (q.bid+q.ask)/2 : cur.mark || cur.entry);   // other assets keep their last known mark
    const open = Object.values(S.positions).filter(p=>p.qty).map(p => { const mark = p.mark || p.entry;
      return {symbol:p.symbol, qty:p.qty, entry:p.entry, mark, upnl:p.qty*(mark-p.entry), liq:null, lev:"10 (sim)"}; });
    const upnl = open.reduce((a,p)=>a+p.upnl, 0), margin = open.reduce((a,p)=>a+Math.abs(p.qty)*p.mark/10, 0);
    return {balance:{wallet:S.cash, available:S.cash+upnl-margin, upnl}, positions:open,
      orders: S.orders.filter(o=>o.symbol===sym).map(o=>({...o})), fills: S.fills};
  }

  function selftest() {
    const out = [], ok = (n, c, d) => out.push({name:"paper broker: " + n, ok:!!c, detail:c ? "" : String(d)});
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const mk = () => reset(10000), cx = (q, sym="BTCUSDT", now=1000) => ({sym, now, q});
    const Q = {bid:100, ask:101, mark:100.5};
    let S = mk(), r = place(S, cx(Q), {type:"MARKET", side:"BUY", qty:2}), msg = "";
    ok("market buy fills at ask, taker fee", r.px===101 && r.qty===2 && near(S.cash, 10000-2*101*TAKER) && S.positions.BTCUSDT.qty===2 && S.positions.BTCUSDT.entry===101, JSON.stringify(S.positions));
    ok("market buy logs order, fill, commission", S.log.orders.length===1 && S.log.fills.length===1 && S.log.income.length===1 && S.log.orders[0].status==="FILLED" && S.log.fills[0].orderId===S.log.orders[0].id, JSON.stringify(S.log));
    r = place(S, cx(Q, "BTCUSDT", 2000), {type:"MARKET", side:"SELL", qty:1});
    ok("market sell reduces at bid, realizes pnl", r.px===100 && S.positions.BTCUSDT.qty===1 && near(S.fills[0].pnl, -1) && S.log.income.length===3 && S.log.income[2].type==="REALIZED_PNL", JSON.stringify(S.fills[0]));
    r = place(S, cx(Q), {type:"MARKET", side:"SELL", qty:3});
    ok("flip long to short resets entry to fill price", S.positions.BTCUSDT.qty===-2 && S.positions.BTCUSDT.entry===100, JSON.stringify(S.positions.BTCUSDT));
    place(S, cx(Q), {type:"MARKET", side:"SELL", qty:1});
    ok("add to short averages entry", S.positions.BTCUSDT.qty===-3 && near(S.positions.BTCUSDT.entry, 100), JSON.stringify(S.positions.BTCUSDT));
    S = mk(); try { place(S, cx({bid:0, ask:0}), {type:"MARKET", side:"BUY", qty:1}); } catch (e) { msg = e.message; }
    ok("market without prices throws", msg==="no Binance prices yet; press Connect", msg);
    S = mk(); r = place(S, cx(Q), {type:"LIMIT", side:"BUY", qty:1, price:102});
    ok("limit buy at or above ask crosses at ask as taker", r.kind==="filled" && r.crossed && r.px===101 && S.log.orders[0].tif==="GTC" && S.orders.length===0, JSON.stringify(r));
    S = mk(); r = place(S, cx(Q), {type:"LIMIT", side:"SELL", qty:1, price:99});
    ok("limit sell at or below bid crosses at bid", r.crossed && r.px===100, JSON.stringify(r));
    S = mk(); r = place(S, cx(Q), {type:"LIMIT", side:"BUY", qty:1, price:99});
    ok("limit below ask rests, logged NEW", r.kind==="resting" && S.orders.length===1 && S.orders[0].id===1 && S.log.orders[0].status==="NEW" && S.cash===10000, JSON.stringify(S.orders));
    onTrade(S, cx(Q), {px:100});
    ok("trade above a resting buy does not fill", S.orders.length===1, S.orders.length);
    onTrade(S, cx(Q, "ETHUSDT"), {px:50});
    ok("trade on another symbol leaves the order", S.orders.length===1 && !S.positions.ETHUSDT, S.orders.length);
    onTrade(S, cx(Q, "BTCUSDT", 3000), {px:98.5});
    ok("trade through resting buy fills at its price as maker", S.orders.length===0 && S.positions.BTCUSDT.qty===1 && S.positions.BTCUSDT.entry===99 && near(S.cash, 10000-99*MAKER) && S.log.orders[0].status==="FILLED" && S.log.orders[0].avg===99 && S.log.fills[0].maker===true, JSON.stringify(S.log.orders[0]));
    S = mk(); msg = ""; try { place(S, cx(Q), {type:"MARKET", side:"SELL", qty:1, reduce:true}); } catch (e) { msg = e.message; }
    ok("reduce-only with no position throws", msg==="reduce-only: no position to reduce", msg);
    place(S, cx(Q), {type:"MARKET", side:"BUY", qty:1});
    r = place(S, cx(Q), {type:"MARKET", side:"SELL", qty:5, reduce:true});
    ok("reduce-only caps at the position and never flips", r.qty===1 && S.positions.BTCUSDT.qty===0 && S.positions.BTCUSDT.entry===0, JSON.stringify(r));
    S = mk(); place(S, cx(Q), {type:"MARKET", side:"BUY", qty:1});
    place(S, cx(Q), {type:"LIMIT", side:"SELL", qty:1, price:110, reduce:true});
    place(S, cx(Q), {type:"MARKET", side:"SELL", qty:1});
    onTrade(S, cx(Q, "BTCUSDT", 5000), {px:111});
    const last = S.log.orders.find(x => x.type==="LIMIT");
    ok("resting reduce-only with nothing to reduce ends EXPIRED, no fill", S.orders.length===0 && last.status==="EXPIRED" && last.filled===0 && last.avg===0 && S.fills.length===2 && S.positions.BTCUSDT.qty===0, JSON.stringify(last));
    S = mk(); place(S, cx(Q), {type:"MARKET", side:"BUY", qty:0.12}); place(S, cx(Q), {type:"MARKET", side:"SELL", qty:0.05});
    ok("float dust is dropped", S.positions.BTCUSDT.qty===0.07, S.positions.BTCUSDT.qty);
    S = mk(); place(S, cx(Q), {type:"MARKET", side:"BUY", qty:1});
    place(S, cx({bid:50, ask:51, mark:50.5}, "ETHUSDT"), {type:"MARKET", side:"SELL", qty:2});
    ok("positions are per symbol", S.positions.BTCUSDT.qty===1 && S.positions.ETHUSDT.qty===-2, JSON.stringify(S.positions));
    snapshot(S, cx({bid:50, ask:51, mark:50.5}, "ETHUSDT"));
    let snap = snapshot(S, cx({bid:110, ask:111, mark:120}, "BTCUSDT"));
    const b = snap.positions.find(p=>p.symbol==="BTCUSDT"), e = snap.positions.find(p=>p.symbol==="ETHUSDT");
    ok("snapshot upnl uses mark, other symbol keeps last mark", snap.positions.length===2 && near(b.upnl, 19) && b.mark===120 && e.mark===50.5 && near(e.upnl, -2*(50.5-50)), JSON.stringify(snap.positions));
    const margin = 120/10 + 2*50.5/10, up = b.upnl + e.upnl;
    ok("snapshot margin and available", near(snap.balance.upnl, up) && near(snap.balance.available, S.cash+up-margin) && snap.balance.wallet===S.cash, JSON.stringify(snap.balance));
    snap = snapshot(S, cx({bid:110, ask:112, mark:0}, "BTCUSDT"));
    ok("snapshot falls back to bid/ask mid without a mark", snap.positions.find(p=>p.symbol==="BTCUSDT").mark===111, JSON.stringify(snap.positions));
    return out;
  }
  return {MAKER, TAKER, reset, pos, fill, capReduce, logNew, logEnd, place, onTrade, snapshot, selftest};
})();
