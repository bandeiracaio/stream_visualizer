"use strict";
// Account info (view, Trade area): every balance, the open positions with leverage and margin type, position and asset mode, fee rates and
// whether the key may trade. Read-only: it only sends GET requests (aiGet below), loads when the view opens and on Refresh, never on a timer.
// Rows come from history-core.js (HIST.account / HIST.simAccount). Spec: .scratch/order-history/spec.md.
const AI = {busy:false, data:null, errs:[], at:0, mode:null};
const ai$ = id => document.getElementById(id);
const aiEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const aiGet = (path, params) => bnSigned("GET", path, params);        // the only kind of call this view makes
const aiNum = x => x == null ? "–" : fmt(x, Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 1 ? 4 : 6);
const aiPct = r => r == null ? "–" : (r * 100).toFixed(4) + "%";
const aiCls = x => x > 0 ? "up" : x < 0 ? "dn" : "";

async function aiLoad() {
  if (AI.busy) return;
  if (!ACC.mode) { AI.data = null; AI.errs = []; AI.mode = null; aiRender(); return; }
  const mode = ACC.mode, sym = accSym(); AI.busy = true; AI.errs = []; aiRender();
  try {
    if (mode === "sim") { AI.data = SIM ? HIST.simAccount(simSnapshot(), {maker:.0002, taker:.0005}) : null; }
    else {
      const names = ["account", "positions", "position mode", "fee rates"];
      const res = await Promise.allSettled([aiGet("/fapi/v2/account"), aiGet("/fapi/v2/positionRisk"), aiGet("/fapi/v1/positionSide/dual"), aiGet("/fapi/v1/commissionRate", {symbol:sym})]);
      if (ACC.mode !== mode) return;                                   // logged out or switched account while waiting
      res.forEach((r, i) => { if (r.status === "rejected") AI.errs.push(`${names[i]}: ${r.reason && r.reason.message || r.reason}`); });
      const [account, positions, dual, rate] = res.map(r => r.status === "fulfilled" ? r.value : null);
      AI.data = res.some(r => r.status === "fulfilled") ? HIST.account({account, positions, dual, rate}) : null;
    }
    AI.at = Date.now(); AI.mode = mode;
  } catch (e) { AI.errs.push(e && e.message || String(e)); }
  finally { AI.busy = false; aiRender(); }
}

function aiTable(head, rows) {
  return `<div style="overflow-x:auto"><table class="tt"><thead><tr>${head.map((h, i) => `<th${i ? ' style="text-align:right"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function aiRender() {
  const head = ai$("aiHead"), err = ai$("aiErr"), body = ai$("aiBody"); if (!head) return;
  if (!ACC.mode) { head.textContent = "No account connected. Log in on the Accounts tab."; err.innerHTML = ""; body.innerHTML = ""; return; }
  const name = ACC.mode === "sim" ? "Simulated paper" : ACC.mode === "demo" ? "Binance demo (paper)" : "Binance LIVE (real money)";
  head.innerHTML = aiEsc(name) + (AI.busy ? " · loading…" : AI.at && AI.mode === ACC.mode ? " · updated " + hhmmss(AI.at).slice(0, 8) : "");
  err.innerHTML = AI.errs.map(e => `<div class="acc-msg err">${aiEsc(e)}</div>`).join("");
  const d = AI.mode === ACC.mode ? AI.data : null;
  if (!d) { body.innerHTML = AI.busy ? "" : `<div class="note">${AI.errs.length ? "Nothing could be read." : "Press Refresh."}</div>`; return; }
  const yn = v => v == null ? "–" : v ? "yes" : "no";
  const margins = [...new Set(d.positions.map(p => p.marginType).filter(Boolean))];
  const rows = [
    ["Position mode", d.mode.hedge == null ? "–" : d.mode.hedge ? "hedge mode" : "one-way mode"],
    ["Asset mode", d.mode.multiAssets == null ? "–" : d.mode.multiAssets ? "multi-assets" : "single asset"],
    ["Margin mode", margins.length ? margins.join(", ") : "per symbol (shown for open positions)"],
    ["Key may trade", yn(d.canTrade)],
    ["Fee tier", d.feeTier == null ? "–" : d.feeTier],
    [`Fee rates (${aiEsc(accSym())})`, d.fees ? `maker ${aiPct(d.fees.maker)} · taker ${aiPct(d.fees.taker)}` : "–"],
  ];
  body.innerHTML =
    `<h3>Balances</h3>` + (d.assets.length ? aiTable(["asset", "wallet", "available", "unrealised PnL", "margin balance"], d.assets.map(a =>
      `<tr><td>${aiEsc(a.asset)}</td><td>${aiNum(a.wallet)}</td><td>${aiNum(a.available)}</td><td class="${aiCls(a.upnl)}">${aiNum(a.upnl)}</td><td>${aiNum(a.margin)}</td></tr>`)) : `<div class="note">No balances.</div>`) +
    `<h3>Positions</h3>` + (d.positions.length ? aiTable(["symbol", "side", "size", "entry", "mark", "unrealised PnL", "leverage", "margin", "liquidation"], d.positions.map(p =>
      `<tr><td>${aiEsc(p.symbol)}</td><td>${p.qty > 0 ? "long" : "short"}</td><td>${aiNum(Math.abs(p.qty))}</td><td>${aiNum(p.entry)}</td><td>${aiNum(p.mark)}</td><td class="${aiCls(p.upnl)}">${aiNum(p.upnl)}</td><td>${p.lev ? p.lev + "x" : "–"}</td><td>${aiEsc(p.marginType || "–")}</td><td>${p.liq ? aiNum(p.liq) : "–"}</td></tr>`)) : `<div class="note">No open positions.</div>`) +
    `<h3>Settings and permissions</h3>` + aiTable(["", ""], rows.map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right">${aiEsc(v)}</td></tr>`)).replace('<thead><tr><th></th><th style="text-align:right"></th></tr></thead>', "");
}

ai$("aiRefresh").onclick = aiLoad;
{ const prev = setTab; setTab = function (t) { prev(t); if (t === "accinfo" && Date.now() - AI.at > 5000) aiLoad(); }; }   // open the view: load (not more than once in 5 s)
{ const prev = logout; logout = function () { prev(); AI.data = null; AI.errs = []; AI.mode = null; AI.at = 0; aiRender(); }; }      // another account must never show this one's balances
aiRender();
