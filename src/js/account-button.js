"use strict";
// Account split button (header). Left half: account info panel (connect panel when no account is connected). Right half: switch / connect panel.
// The panels hold what used to be the Accounts and Account info views; their element ids are unchanged. Display only: no broker or feed logic here.
const accEl = id => document.getElementById(id);
const ACCP = {info:{panel:"accInfoPanel", btn:"accMain"}, switch:{panel:"accSwitchPanel", btn:"accCaret"}};
let accWas = null;
function accPanelClose() {
  for (const k in ACCP) accEl(ACCP[k].panel).hidden = true;
  accEl("accCaret").setAttribute("aria-expanded", "false"); accEl("accMain").setAttribute("aria-expanded", "false");
}
function accPanelOpen(which) {
  const was = !accEl(ACCP[which].panel).hidden;
  accPanelClose(); if (was) return;
  accEl(ACCP[which].panel).hidden = false; accEl(ACCP[which].btn).setAttribute("aria-expanded", "true");
  if (which === "info" && typeof AI !== "undefined" && Date.now() - AI.at > 5000) aiLoad();      // not more than once in 5 s, as the view did
}
function accBtnRender() {
  const mode = ACC.mode || "", box = accEl("accSplit"); box.dataset.m = mode;
  const lb = accEl("accLbl"); lb.textContent = mode ? mode.toUpperCase() : "Account"; lb.dataset.s = mode ? mode[0].toUpperCase() : "+";
  const up = mode && ACC.data && ACC.data.balance ? ACC.data.balance.upnl : null, p = accEl("accPnl");
  p.textContent = up == null || !isFinite(up) ? "" : (up >= 0 ? "+$" : "-$") + fmt(Math.abs(up), 2);
  p.className = up == null ? "" : up > 0 ? "up" : up < 0 ? "dn" : "";
  accEl("accMain").title = mode ? "Account info" : "No account connected: connect one";
}
accEl("accMain").onclick = e => { e.stopPropagation(); accPanelOpen(ACC.mode ? "info" : "switch"); };
accEl("accCaret").onclick = e => { e.stopPropagation(); accPanelOpen("switch"); };
accEl("accClose1").onclick = accEl("accClose2").onclick = accPanelClose;
document.addEventListener("click", e => {
  const o = e.target.closest("[data-acc-open]");      // any button elsewhere in the page that opens one of the panels (Overview)
  if (o) { e.stopPropagation(); accPanelOpen(o.dataset.accOpen); return; }
  if (!e.target.closest("#accSplit, .accpanel")) accPanelClose();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") accPanelClose(); });
HOOKS.on("renderAccount", () => {
  accBtnRender();
  if (ACC.mode && ACC.mode !== accWas && !accEl("accSwitchPanel").hidden) { accPanelClose(); accPanelOpen("info"); }   // just connected: show what the account holds
  accWas = ACC.mode;
});
setInterval(accBtnRender, 1000);       // the unrealised PnL changes between logins
accBtnRender();
