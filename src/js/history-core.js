"use strict";
// Order history and account info (pure, no DOM): one row shape for orders, fills and income whether they come from Binance futures
// or from the simulated broker, plus totals, 7-day request pieces and CSV. Spec: .scratch/order-history/spec.md.
// Display only: nothing here feeds a detection. Binance field names checked against the USD-M futures docs on 2026-10-24.
const HIST = (() => {
  const DAY = 86400000, WINDOW = 7 * DAY - 1000;          // allOrders / userTrades / income reject a window of 7 days or more
  const num = x => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
  const str = x => x == null ? "" : String(x);

  // ---- Binance -> common rows
  const order = o => ({id:o.orderId, t:+o.time || 0, upd:+o.updateTime || +o.time || 0, symbol:str(o.symbol), side:str(o.side), type:str(o.type), price:num(o.price), qty:num(o.origQty), filled:num(o.executedQty), avg:num(o.avgPrice), status:str(o.status), reduce:!!o.reduceOnly, tif:str(o.timeInForce)});
  const fill = f => ({id:f.id, orderId:f.orderId, t:+f.time || 0, symbol:str(f.symbol), side:str(f.side), price:num(f.price), qty:num(f.qty), fee:num(f.commission), feeAsset:str(f.commissionAsset), pnl:num(f.realizedPnl), maker:!!f.maker});
  const income = i => ({id:str(i.incomeType) + ":" + str(i.tranId), t:+i.time || 0, symbol:str(i.symbol), type:str(i.incomeType), amount:num(i.income), asset:str(i.asset), info:str(i.info)});

  // raw: {account:/fapi/v2/account, positions:/fapi/v2/positionRisk, dual:/fapi/v1/positionSide/dual, rate:/fapi/v1/commissionRate} (each may be missing: a failed call must not hide the rest)
  function account(raw) {
    raw = raw || {}; const a = raw.account || {};
    const assets = (Array.isArray(a.assets) ? a.assets : []).map(x => ({asset:str(x.asset), wallet:num(x.walletBalance), available:num(x.availableBalance), upnl:num(x.unrealizedProfit), margin:num(x.marginBalance)}))
      .filter(x => x.wallet || x.upnl || x.available || x.margin);
    const positions = (Array.isArray(raw.positions) ? raw.positions : []).filter(p => num(p.positionAmt) !== 0)
      .map(p => ({symbol:str(p.symbol), qty:num(p.positionAmt), entry:num(p.entryPrice), mark:num(p.markPrice), upnl:num(p.unRealizedProfit), lev:num(p.leverage), marginType:str(p.marginType), liq:num(p.liquidationPrice) || null, side:str(p.positionSide)}));
    const rate = raw.rate || {};
    return {assets, positions,
      mode:{hedge:raw.dual ? !!raw.dual.dualSidePosition : null, multiAssets:a.multiAssetsMargin == null ? null : !!a.multiAssetsMargin},
      canTrade:a.canTrade == null ? null : !!a.canTrade, feeTier:a.feeTier == null ? null : +a.feeTier,
      fees:rate.makerCommissionRate == null ? null : {maker:num(rate.makerCommissionRate), taker:num(rate.takerCommissionRate)}};
  }

  // the simulated account (simSnapshot() in app.js) in the same shape; its fees are the broker's own (maker 0.02%, taker 0.05%)
  function simAccount(snap, fees) {
    const b = (snap && snap.balance) || {};
    return {assets:[{asset:"USDT", wallet:num(b.wallet), available:num(b.available), upnl:num(b.upnl), margin:num(b.wallet) + num(b.upnl)}],
      positions:((snap && snap.positions) || []).map(p => ({symbol:str(p.symbol), qty:num(p.qty), entry:num(p.entry), mark:num(p.mark), upnl:num(p.upnl), lev:num(p.lev), marginType:"simulated", liq:null, side:"BOTH"})),
      mode:{hedge:false, multiAssets:false}, canTrade:true, feeTier:null, fees:fees ? {maker:num(fees.maker), taker:num(fees.taker)} : null};
  }

  // ---- totals
  // income inside [from, to): per type {n, amount}, the sum of all, and the assets seen (amounts of different assets must not be read as one number)
  function totals(rows, from, to) {
    const byType = {}, assets = new Set(); let total = 0, n = 0;
    for (const r of rows || []) {
      if ((from != null && r.t < from) || (to != null && r.t >= to)) continue;
      const k = byType[r.type] || (byType[r.type] = {n:0, amount:0});
      k.n++; k.amount += r.amount; total += r.amount; n++; if (r.asset) assets.add(r.asset);
    }
    return {byType, total, n, assets:[...assets].sort()};
  }
  const fillTotals = rows => { let fee = 0, pnl = 0, volume = 0, n = 0; for (const f of rows || []) { fee += f.fee; pnl += f.pnl; volume += f.qty * f.price; n++; } return {n, fee, pnl, volume}; };
  const statusCounts = rows => { const o = {}; for (const r of rows || []) o[r.status] = (o[r.status] || 0) + 1; return o; };

  // ---- columns shared by the History table and its CSV ("iso" is added by csvRows)
  const COLUMNS = {
    orders:[["iso", "time (UTC)"], ["symbol", "symbol"], ["side", "side"], ["type", "type"], ["price", "price"], ["qty", "qty"], ["filled", "filled"], ["avg", "avg price"], ["status", "status"], ["reduce", "reduce only"], ["id", "order id"]],
    fills:[["iso", "time (UTC)"], ["symbol", "symbol"], ["side", "side"], ["price", "price"], ["qty", "qty"], ["fee", "fee"], ["feeAsset", "fee asset"], ["pnl", "realised PnL"], ["maker", "maker"], ["orderId", "order id"], ["id", "trade id"]],
    income:[["iso", "time (UTC)"], ["symbol", "symbol"], ["type", "type"], ["amount", "amount"], ["asset", "asset"], ["info", "info"]],
  };
  const csvRows = rows => (rows || []).map(r => Object.assign({iso:new Date(r.t).toISOString()}, r));
  const symbols = rows => [...new Set((rows || []).map(r => r.symbol).filter(Boolean))].sort();
  const period = (days, now) => ({from:now - Math.min(days * DAY, days <= 7 ? WINDOW : Infinity), to:now});   // "7 days" is cut to the 6 days 23 h 59 min 59 s the API accepts, so it is one request, not two

  // ---- paging: [start, end] pieces no longer than the API accepts, newest first
  function pieces(from, to) {
    const out = []; let end = to;
    while (end > from) { const start = Math.max(from, end - WINDOW); out.push([start, end]); end = start - 1; }
    return out;
  }
  // rows from overlapping pieces: each id once, newest first
  function merge(rows, key = "id") {
    const seen = new Set(), out = [];
    for (const r of rows || []) { const k = r[key]; if (k != null && seen.has(k)) continue; if (k != null) seen.add(k); out.push(r); }
    return out.sort((a, b) => b.t - a.t);
  }

  // ---- CSV: columns are [key, label]; a text cell that a spreadsheet would read as a formula is quoted with a leading apostrophe
  function toCsv(rows, columns) {
    const cell = v => {
      let s = v == null ? "" : typeof v === "number" ? String(v) : String(v);
      if (typeof v === "string" && /^[=+@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [columns.map(c => cell(c[1])).join(",")].concat((rows || []).map(r => columns.map(c => cell(r[c[0]])).join(","))).join("\r\n") + "\r\n";
  }

  // ---- simulated broker log: bounded, so a long session cannot grow without limit
  const LOG_CAP = 5000;
  const push = (arr, row) => { arr.push(row); if (arr.length > LOG_CAP) arr.shift(); return row; };

  return {DAY, WINDOW, LOG_CAP, COLUMNS, csvRows, symbols, period, order, fill, income, account, simAccount, totals, fillTotals, statusCounts, pieces, merge, toCsv, push};
})();
