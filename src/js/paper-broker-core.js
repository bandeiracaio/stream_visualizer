"use strict";
// Simulated paper broker (pure, no DOM, timers or storage): state, quotes, symbol and clock are passed in, never read from the page.
// Display only: the Reader engine, feeds and the Binance broker are untouched. Rows go to the history log through HIST.push.
// ctx = {sym, now, q:{bid, ask, mark}}; functions change the state they are given in place (same SIM shape as before) and return results.
// Since R1 the arithmetic and decisions run in WebAssembly (rust/crates/sv-paper, loaded by wasm-loader.js as SVWASM); the signatures, results, thrown messages and the state left behind are the ones the JS version had
// A call sends the numbers of the state (cash, positions in key order, nextId, logSeq) and gets the new ones
// back, plus the rows to add; this wrapper writes them into the same SIM objects (positions are updated in place, never replaced, S.fills is the same array) and does the container bookkeeping: the 50-row fills list,
// the order log through HIST.push (5000 cap), logEnd's scan, the resting-order objects, reset and pos. Numbers go through JSON: NaN, Infinity and -0 are carried across as text. Quantities and prices are numbers.
const PAPER = (() => {
  const MAKER = 0.0002, TAKER = 0.0005, FILLS_KEEP = 50;
  const wasm = (fn, o) => SVWASM.call("paper_" + fn, o);
  const reset = start => ({start, cash:start, positions:{}, orders:[], fills:[], nextId:1, log:{orders:[], fills:[], income:[]}, logSeq:100000});   // orders filled at once and the fills and income rows take ids from logSeq so the ids of resting orders do not change
  // one position per asset: the header lets you switch asset while the paper account is live
  const pos = (S, sym) => (S.positions[sym] ||= {symbol:sym, qty:0, entry:0, mark:null});
  // JSON has no NaN, Infinity or -0: those travel as their text ("NaN", "Infinity", "-Infinity", "-0") in both directions
  const en = x => typeof x === "number" ? (Object.is(x, -0) ? "-0" : isFinite(x) ? x : String(x)) : x;
  const de = x => typeof x === "string" ? (x === "-0" ? -0 : Number(x)) : x;
  const fix = (r, keys) => { for (const k of keys) r[k] = de(r[k]); return r; };
  const numState = S => ({cash:en(S.cash), positions:Object.keys(S.positions).map(k => { const p = S.positions[k]; return [k, {symbol:p.symbol, qty:en(p.qty), entry:en(p.entry), mark:en(p.mark)}]; }), nextId:en(S.nextId), logSeq:en(S.logSeq)});
  function commit(S, out) {
    const st = out.state;
    S.cash = de(st.cash); S.nextId = de(st.nextId); S.logSeq = de(st.logSeq);
    for (const [k, p] of st.positions) {
      const e = S.positions[k];
      if (e) { e.qty = de(p.qty); e.entry = de(p.entry); e.mark = de(p.mark); } else S.positions[k] = {symbol:p.symbol, qty:de(p.qty), entry:de(p.entry), mark:de(p.mark)};
    }
    for (const r of out.newFills || []) { S.fills.unshift(fix(r, ["t", "qty", "price", "fee", "pnl"])); if (S.fills.length > FILLS_KEEP) S.fills.pop(); }
    if (out.log) {
      for (const r of out.log.fills) HIST.push(S.log.fills, fix(r, ["id", "orderId", "t", "price", "qty", "fee", "pnl"]));
      for (const r of out.log.income) HIST.push(S.log.income, fix(r, ["id", "t", "amount"]));
      for (const r of out.log.orders) HIST.push(S.log.orders, fix(r, ["t", "upd", "id", "price", "qty", "filled", "avg"]));
    }
  }
  const cx = (ctx, q) => ({sym:ctx.sym, now:en(ctx.now), bid:q && en(q.bid), ask:q && en(q.ask), mark:q && en(q.mark)});
  function fill(S, ctx, side, qty, price, maker, oid) {
    commit(S, wasm("fill", {state:numState(S), ctx:cx(ctx), side, qty:en(+qty), price:en(+price), maker:!!maker, oid:en(+oid)}));
  }
  // reduce-only: never grow or flip the position
  function capReduce(S, ctx, o) {
    const out = wasm("cap_reduce", {state:numState(S), ctx:cx(ctx), side:o.side, qty:en(+o.qty)}); commit(S, out); return de(out.q);
  }
  // the order log: a row when an order is placed, updated when it fills or ends
  const logNew = (S, ctx, row) => HIST.push(S.log.orders, Object.assign({t:ctx.now, upd:ctx.now, symbol:ctx.sym, tif:""}, row));
  function logEnd(S, ctx, id, status, filled, avg) {
    for (let i = S.log.orders.length - 1; i >= 0; i--) { const r = S.log.orders[i]; if (r.id === id) { r.status = status; r.upd = ctx.now; if (filled != null) { r.filled = filled; r.avg = avg; } return; } }
  }
  // returns {kind:"filled", qty, px, crossed} or {kind:"resting", price}; the caller words the message. Throws the same errors as before.
  function place(S, ctx, o) {
    const q = ctx.q, bid = q.bid, ask = q.ask;      // a missing ctx.q throws here, as it did
    const out = wasm("place", {state:numState(S), ctx:cx(ctx, q), type:o.type, side:o.side, qty:en(+o.qty), price:en(+o.price), reduce:!!o.reduce});
    commit(S, out);      // also when it throws: a reduce-only check creates the position first
    if (out.err) throw new Error(out.err);
    if (out.restId != null) {
      S.orders.push({id:out.restId, symbol:ctx.sym, side:o.side, type:"LIMIT", qty:o.qty, filled:0, price:+o.price, reduce:o.reduce, t:ctx.now});
      return {kind:"resting", price:o.price};
    }
    return fix(out.result, ["qty", "px"]);
  }
  function onTrade(S, ctx, t) {
    if (!S || !S.orders.length) return;
    const sym = ctx.sym, px = t.px;
    // trades are frequent and almost never touch a resting order: only a hit goes to WebAssembly (a miss leaves a fresh array, as the filter did)
    if (!S.orders.some(o => o.symbol === sym && ((o.side === "BUY" && px <= o.price) || (o.side === "SELL" && px >= o.price)))) { S.orders = S.orders.slice(); return; }
    const out = wasm("on_trade", {state:numState(S), ctx:cx(ctx), orders:S.orders.map(o => ({id:en(o.id), symbol:o.symbol, side:o.side, qty:en(o.qty), price:en(o.price), reduce:o.reduce})), px:en(px)});
    commit(S, out);
    S.orders = S.orders.filter((o, i) => out.keep[i]);
    for (const e of out.logEnds) logEnd(S, ctx, de(e.id), e.status, de(e.filled), de(e.avg));   // a reduce-only order with nothing left to reduce ends without a fill
  }
  function snapshot(S, ctx) {
    pos(S, ctx.sym);      // created before the quotes are read, as it was (a missing ctx.q throws after it)
    const q = ctx.q, mark = q.mark;
    const out = wasm("snapshot", {state:numState(S), ctx:cx(ctx, q), orders:S.orders.map(o => o.symbol)});
    commit(S, out);
    return {balance:fix(out.balance, ["wallet", "available", "upnl"]), positions:out.positions.map(p => fix(p, ["qty", "entry", "mark", "upnl"])), orders:out.orderIdx.map(i => ({...S.orders[i]})), fills:S.fills};
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
