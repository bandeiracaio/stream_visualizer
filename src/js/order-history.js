"use strict";
// History (view, Trade area): orders, fills and income of the connected account, a symbol and a period at a time, with totals and a CSV download.
// Read-only: only GET requests (hsGet below). It loads when the view opens with nothing loaded for the choice made, and on Refresh; never on a timer.
// Rows come from history-core.js (HIST.order / fill / income, pieces, merge, totals, toCsv). Spec: .scratch/order-history/spec.md.
const HS = {tab:"orders", sym:null, days:7, busy:false, stop:false, cache:{}, found:[], at:0};
const hs$ = id => document.getElementById(id);
const hsEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hsGet = (path, params) => bnSigned("GET", path, params);                    // the only kind of call this view makes
const hsArr = x => { if (!Array.isArray(x)) throw new Error("unexpected answer from Binance"); return x; };
const hsSleep = ms => new Promise(r => setTimeout(r, ms));
const hsNum = x => x == null ? "–" : Number(x).toLocaleString("en-US", {maximumFractionDigits:8});
const hsCls = x => x > 0 ? "up" : x < 0 ? "dn" : "";
const hsTime = t => { const d = new Date(t), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const hsSym = () => HS.sym || accSym();
const hsKey = (tab = HS.tab) => `${ACC.mode}|${tab}|${tab === "income" ? "*" : hsSym()}|${HS.days}`;
const ROWS_SHOWN = 500, PAGE = 1000, MAX_PAGES = 20, PAUSE_MS = 150;

// ---- loading
function hsFromSim(tab) {
  const log = SIM ? SIM.log : {orders:[], fills:[], income:[]}, from = Date.now() - HS.days * HIST.DAY, sym = hsSym();
  const rows = log[tab].filter(r => r.t >= from && (tab === "income" || r.symbol === sym));
  return {rows:rows.slice().sort((a, b) => b.t - a.t), warn:[], errs:[], at:Date.now()};
}
async function hsFromBinance(tab, mode) {
  const sym = hsSym(), {from, to} = HIST.period(HS.days, Date.now() + (typeof clockOffset === "number" ? clockOffset : 0)), pcs = HIST.pieces(from, to), rows = [], warn = [], errs = [];
  for (let i = 0; i < pcs.length; i++) {
    if (HS.stop || ACC.mode !== mode) { warn.push("stopped before every piece was loaded: the rows below are only part of the period"); break; }
    const [a, b] = pcs[i]; hsProgress(`Loading piece ${i + 1} of ${pcs.length}…`);
    try {
      let got;
      if (tab === "orders") got = hsArr(await hsGet("/fapi/v1/allOrders", {symbol:sym, startTime:a, endTime:b, limit:PAGE})).map(HIST.order);
      else if (tab === "income") got = hsArr(await hsGet("/fapi/v1/income", {startTime:a, endTime:b, limit:PAGE})).map(HIST.income);
      else {
        let page = hsArr(await hsGet("/fapi/v1/userTrades", {symbol:sym, startTime:a, endTime:b, limit:PAGE})), raw = page;
        for (let n = 1; page.length >= PAGE && n < MAX_PAGES; n++) {                 // a full page: carry on from the last trade id (fromId cannot be combined with a time window)
          page = hsArr(await hsGet("/fapi/v1/userTrades", {symbol:sym, fromId:+page[page.length - 1].id + 1, limit:PAGE}));
          const inside = page.filter(f => +f.time <= b); raw = raw.concat(inside); if (inside.length < page.length) break;
        }
        got = raw.map(HIST.fill);
      }
      if (tab !== "fills" && got.length >= PAGE) warn.push(`${new Date(a).toLocaleDateString()} – ${new Date(b).toLocaleDateString()}: Binance returned a full page of ${PAGE}, so some rows of that piece may be missing (choose a shorter period)`);
      rows.push(...got);
    } catch (e) { errs.push(e && e.message || String(e)); break; }                    // stop at the first refusal: the next calls would likely fail the same way
    if (i < pcs.length - 1) await hsSleep(PAUSE_MS);
  }
  return {rows:HIST.merge(rows), warn, errs, at:Date.now()};
}
async function hsLoad(tab = HS.tab, force = false) {
  if (HS.busy || !ACC.mode) { hsRender(); return; }
  const key = hsKey(tab), mode = ACC.mode;
  if (!force && HS.cache[key] && mode !== "sim") { hsRender(); return; }          // the simulated account is local and cheap: always read it again
  HS.busy = true; HS.stop = false; hsRender();
  try {
    const res = mode === "sim" ? hsFromSim(tab) : await hsFromBinance(tab, mode);
    if (ACC.mode === mode) { HS.cache[key] = res; HS.at = Date.now(); if (tab === "income") hsFound(res.rows); }
  } finally { HS.busy = false; hsProgress(""); hsRender(); }
}
function hsFound(rows) { HS.found = [...new Set(HS.found.concat(HIST.symbols(rows)))].sort(); }

// ---- display
const hsProgress = t => { const el = hs$("hsProgress"); if (el) el.textContent = t; };
function hsRender() {
  const head = hs$("hsHead"); if (!head) return;
  const set = (id, h) => { hs$(id).innerHTML = h; };
  document.querySelectorAll(".hs-tabs button").forEach(b => b.classList.toggle("act", b.dataset.hs === HS.tab));
  hs$("hsSymBox").style.display = HS.tab === "income" ? "none" : ""; hs$("hsStop").style.display = HS.busy ? "" : "none";
  if (document.activeElement !== hs$("hsSym")) hs$("hsSym").value = hsSym();
  if (!ACC.mode) { head.textContent = "No account connected. Log in on the Accounts tab."; for (const id of ["hsPicks", "hsErr", "hsTotals", "hsTable", "hsNote"]) set(id, ""); hs$("hsCsv").disabled = true; return; }
  const name = ACC.mode === "sim" ? "Simulated paper" : ACC.mode === "demo" ? "Binance demo (paper)" : "Binance LIVE (real money)", res = HS.cache[hsKey()];
  head.innerHTML = hsEsc(name) + (HS.busy ? " · loading…" : res ? " · loaded " + hsTime(res.at).slice(11) : "");
  const picks = [...new Set([hsSym()].concat(HS.found, SIM && ACC.mode === "sim" ? HIST.symbols(SIM.log.orders) : []))];
  set("hsPicks", picks.length > 1 || HS.found.length ? picks.map(s => `<button data-sym="${hsEsc(s)}"${s === hsSym() && HS.tab !== "income" ? ' class="act"' : ""}>${hsEsc(s)}</button>`).join("") : "");
  set("hsErr", ((res && res.errs) || []).map(e => `<div class="acc-msg err">${hsEsc(e)}</div>`).concat(((res && res.warn) || []).map(w => `<div class="note">${hsEsc(w)}</div>`)).join(""));
  hs$("hsCsv").disabled = !(res && res.rows.length);
  if (!res) { set("hsTotals", ""); set("hsTable", HS.busy ? "" : `<div class="note">Press Refresh to load.</div>`); set("hsNote", ""); return; }
  const rows = res.rows, m = (k, v, cls) => `<div class="metric"><span>${k}</span><b class="${cls || ""}">${v}</b></div>`;
  let totals = "", head2, cells;
  if (HS.tab === "orders") {
    const c = HIST.statusCounts(rows); totals = m("orders", rows.length) + Object.keys(c).sort().map(k => m(hsEsc(k.toLowerCase().replace(/_/g, " ")), c[k])).join("");
    head2 = ["time", "symbol", "side", "type", "price", "qty", "filled", "avg", "status", "reduce"];
    cells = r => [hsTime(r.t), r.symbol, r.side, r.type, hsNum(r.price), hsNum(r.qty), hsNum(r.filled), hsNum(r.avg), r.status, r.reduce ? "yes" : ""];
  } else if (HS.tab === "fills") {
    const t = HIST.fillTotals(rows), assets = [...new Set(rows.map(r => r.feeAsset).filter(Boolean))];
    totals = m("fills", t.n) + m("volume", "$" + fmtK(t.volume)) + m("fees" + (assets.length === 1 ? " (" + hsEsc(assets[0]) + ")" : ""), hsNum(+t.fee.toFixed(8))) + m("realised PnL", hsNum(+t.pnl.toFixed(8)), hsCls(t.pnl));
    if (assets.length > 1) totals += `<div class="note">Fees are in more than one asset (${hsEsc(assets.join(", "))}); the fee total adds them as if equal.</div>`;
    head2 = ["time", "symbol", "side", "price", "qty", "fee", "realised PnL", "maker"];
    cells = r => [hsTime(r.t), r.symbol, r.side, hsNum(r.price), hsNum(r.qty), hsNum(r.fee) + " " + r.feeAsset, hsNum(r.pnl), r.maker ? "maker" : "taker"];
  } else {
    const t = HIST.totals(rows); totals = m("rows", t.n) + Object.keys(t.byType).sort().map(k => m(hsEsc(k.toLowerCase().replace(/_/g, " ")), hsNum(+t.byType[k].amount.toFixed(8)), hsCls(t.byType[k].amount))).join("") + m("net", hsNum(+t.total.toFixed(8)), hsCls(t.total));
    if (t.assets.length > 1) totals += `<div class="note">Amounts are in more than one asset (${hsEsc(t.assets.join(", "))}); each total adds them as if equal.</div>`;
    head2 = ["time", "symbol", "type", "amount", "asset"];
    cells = r => [hsTime(r.t), r.symbol || "–", r.type, hsNum(r.amount), r.asset];
  }
  set("hsTotals", totals);
  const num = new Set(["price", "qty", "filled", "avg", "fee", "realised PnL", "amount"]), pnlCol = head2.findIndex(h => h === "realised PnL" || h === "amount");
  set("hsTable", rows.length ? `<div style="overflow-x:auto"><table class="tt"><thead><tr>${head2.map(h => `<th${num.has(h) ? ' style="text-align:right"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, ROWS_SHOWN).map(r => `<tr>${cells(r).map((c, i) => `<td${num.has(head2[i]) ? ' style="text-align:right"' : ""}${i === pnlCol ? ` class="${hsCls(HS.tab === "fills" ? r.pnl : r.amount)}"` : ""}>${hsEsc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` + (rows.length > ROWS_SHOWN ? `<div class="hs-more">Showing the newest ${ROWS_SHOWN} of ${rows.length}; the CSV has all of them.</div>` : "") : `<div class="note">Nothing in this period.</div>`);
  set("hsNote", HS.tab === "orders" ? "Binance keeps orders for 90 days and drops cancelled or expired orders that never filled after 3 days, so those can be missing from older history." : HS.tab === "fills" ? "Binance keeps trades for 3 months." : "All symbols. Binance keeps income for 3 months. Times are your local time; the CSV uses UTC.");
}

function hsCsv() {
  const res = HS.cache[hsKey()]; if (!res || !res.rows.length) return;
  const text = HIST.toCsv(HIST.csvRows(res.rows), HIST.COLUMNS[HS.tab]), who = ACC.mode, scope = HS.tab === "income" ? "all" : hsSym();
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], {type:"text/csv"}));
  a.download = `history_${who}_${HS.tab}_${scope}_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- controls
document.querySelector(".hs-tabs").onclick = e => { const b = e.target.closest("button[data-hs]"); if (!b) return; HS.tab = b.dataset.hs; hsLoad(); };
hs$("hsDays").onchange = () => { HS.days = +hs$("hsDays").value || 7; hsLoad(); };
hs$("hsSym").onchange = () => { HS.sym = hs$("hsSym").value.trim().toUpperCase() || null; if (HS.tab === "income") HS.tab = "orders"; hsLoad(); };
hs$("hsPicks").onclick = e => { const b = e.target.closest("button[data-sym]"); if (!b) return; HS.sym = b.dataset.sym; if (HS.tab === "income") HS.tab = "orders"; hsLoad(); };
hs$("hsFind").onclick = () => { HS.tab = "income"; hsLoad("income", true); };
hs$("hsRefresh").onclick = () => hsLoad(HS.tab, true);
hs$("hsStop").onclick = () => { HS.stop = true; };
hs$("hsCsv").onclick = hsCsv;
{ const prev = setTab; setTab = function (t) { prev(t); if (t === "history") hsLoad(); }; }
{ const prev = logout; logout = function () { prev(); HS.cache = {}; HS.found = []; HS.sym = null; hsRender(); }; }      // another account must never show this one's rows      // open the view: load only what is not loaded yet for this choice
hsRender();
