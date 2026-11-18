"use strict";
// Order history and account info (pure, no DOM): one row shape for orders, fills and income whether they come from Binance futures
// or from the simulated broker, plus totals, 7-day request pieces and CSV. Spec: .scratch/order-history/spec.md.
// Display only: nothing here feeds a detection. Binance field names checked against the USD-M futures docs on 2026-10-24.
// Since R1 the row building, totals, paging, merge and CSV run in WebAssembly (rust/crates/sv-history, loaded by wasm-loader.js as SVWASM); the signatures and results are the ones the JS version had
// (that version is src/js/js-cores/history-core.js, HIST_JS, and `node parity.mjs hist` compares the two). Values go in as JSON with JS semantics (+x, String(x), parseFloat(x) are done in Rust).
// Here: `push` (it mutates an array in place), the constants and COLUMNS, the pass-through ids (`id: o.orderId` is the raw value), and the objects whose key order JS decides (byType, statusCounts).
// A non-finite number travels as its text ("NaN", "Infinity") and comes back as a number. Known edges: a lone surrogate in a CSV cell is refused by the JSON boundary; a null row inside `assets` / `positions` throws
// the TypeError JS throws, but always says "null" (JSON has no undefined inside an array); totals / fillTotals add numbers (the rows these functions make): a text amount, fee or pnl would be concatenated by the JS version and is added here; merge assumes every `t` is a number (the order of rows without one is not defined).
const HIST = (() => {
  const DAY = 86400000, WINDOW = 7 * DAY - 1000;          // allOrders / userTrades / income reject a window of 7 days or more
  const wasm = (fn, o) => {
    try { return SVWASM.call("hist_" + fn, o); }
    catch (e) { const m = /^wasm core hist: (TypeError|RangeError): ([\s\S]*)$/.exec(e && e.message); if (m) throw new (m[1] === "TypeError" ? TypeError : RangeError)(m[2]); throw e; }
  };
  const enc = x => typeof x === "number" && !isFinite(x) ? String(x) : x;      // a non-finite number goes as its text
  const enc2 = x => x === undefined ? "NaN" : enc(x);      // for arithmetic arguments: undefined is NaN, null stays 0 (as in JS)
  const dec = x => typeof x === "string" ? Number(x) : x;
  const decT = (r, ...keys) => { for (const k of keys) r[k] = dec(r[k]); return r; };      // a time can be Infinity ("Infinity" in an API field)

  // ---- Binance -> common rows
  const order = o => ({id:o.orderId, ...decT(wasm("order", o), "t", "upd")});
  const fill = f => ({id:f.id, orderId:f.orderId, ...decT(wasm("fill", f), "t")});
  const income = i => decT(wasm("income", i), "t");

  // raw: {account:/fapi/v2/account, positions:/fapi/v2/positionRisk, dual:/fapi/v1/positionSide/dual, rate:/fapi/v1/commissionRate} (each may be missing: a failed call must not hide the rest)
  function account(raw) {
    const r = wasm("account", raw === undefined ? null : raw); r.feeTier = dec(r.feeTier); return r;
  }

  // the simulated account (simSnapshot() in app.js) in the same shape; its fees are the broker's own (maker 0.02%, taker 0.05%)
  const simAccount = (snap, fees) => wasm("sim_account", {snap, fees});

  // ---- totals
  // income inside [from, to): per type {n, amount}, the sum of all, and the assets seen (amounts of different assets must not be read as one number)
  function totals(rows, from, to) {
    const r = wasm("totals", {rows:rows && Array.isArray(rows) ? rows.map(x => ({t:enc2(x.t), type:x.type, amount:enc2(x.amount), asset:x.asset})) : rows, from:enc(from), to:enc(to)}), byType = {};
    for (const [k, v] of r.byType) byType[k] = v;
    return {byType, total:dec(r.total), n:r.n, assets:r.assets};
  }
  function fillTotals(rows) { const r = wasm("fill_totals", Array.isArray(rows) ? rows.map(x => ({fee:enc2(x.fee), pnl:enc2(x.pnl), qty:enc2(x.qty), price:enc2(x.price)})) : rows === undefined ? null : rows); return {n:r.n, fee:dec(r.fee), pnl:dec(r.pnl), volume:dec(r.volume)}; }
  function statusCounts(rows) { const o = {}; for (const [k, n] of wasm("status_counts", rows === undefined ? null : rows)) o[k] = n; return o; }

  // ---- columns shared by the History table and its CSV ("iso" is added by csvRows)
  const COLUMNS = {
    orders:[["iso", "time (UTC)"], ["symbol", "symbol"], ["side", "side"], ["type", "type"], ["price", "price"], ["qty", "qty"], ["filled", "filled"], ["avg", "avg price"], ["status", "status"], ["reduce", "reduce only"], ["id", "order id"]],
    fills:[["iso", "time (UTC)"], ["symbol", "symbol"], ["side", "side"], ["price", "price"], ["qty", "qty"], ["fee", "fee"], ["feeAsset", "fee asset"], ["pnl", "realised PnL"], ["maker", "maker"], ["orderId", "order id"], ["id", "trade id"]],
    income:[["iso", "time (UTC)"], ["symbol", "symbol"], ["type", "type"], ["amount", "amount"], ["asset", "asset"], ["info", "info"]],
  };
  const csvRows = rows => { const r = rows || [], iso = wasm("iso", r.map(x => typeof x.t === "number" ? x.t : new Date(x.t).getTime())); return r.map((x, i) => Object.assign({iso:iso[i]}, x)); };
  const symbols = rows => { const r = rows || [], vals = r.map(x => x.symbol); return wasm("symbols", vals).map(i => vals[i]); };
  const period = (days, now) => ({from:dec(wasm("period", {days:enc2(days), now:enc2(now)})), to:now});   // "7 days" is cut to the 6 days 23 h 59 min 59 s the API accepts, so it is one request, not two

  // ---- paging: [start, end] pieces no longer than the API accepts, newest first
  const pieces = (from, to) => wasm("pieces", {from:enc2(from), to:enc2(to)});
  // rows from overlapping pieces: each id once, newest first
  function merge(rows, key = "id") { const r = rows || []; return wasm("merge", r.map(x => ({k:x[key], t:enc2(x.t)}))).map(i => r[i]); }

  // ---- CSV: columns are [key, label]; a text cell that a spreadsheet would read as a formula is quoted with a leading apostrophe
  const toCsv = (rows, columns) => wasm("to_csv", {header:columns.map(c => enc(c[1])), rows:(rows || []).map(r => columns.map(c => enc(r[c[0]])))});

  // ---- simulated broker log: bounded, so a long session cannot grow without limit
  const LOG_CAP = 5000;
  const push = (arr, row) => { arr.push(row); if (arr.length > LOG_CAP) arr.shift(); return row; };

  return {DAY, WINDOW, LOG_CAP, COLUMNS, csvRows, symbols, period, order, fill, income, account, simAccount, totals, fillTotals, statusCounts, pieces, merge, toCsv, push};
})();
