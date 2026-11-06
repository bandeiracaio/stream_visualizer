"use strict";
// Status button (header): BN and HL as two coloured dots. Its panel holds the venue texts (#bnState / #hlState,
// classified by sbPills in status-bar.js). Display only.
(function () {
  const $ = id => document.getElementById(id), btn = $("stBtn"), panel = $("stPanel");
  function sync() {
    for (const [dot, id] of [["stBn", "bnState"], ["stHl", "hlState"]]) {
      const p = $(id) && $(id).parentElement; if (!p) continue;
      const st = p.dataset.st || "off"; if ($(dot).dataset.st !== st) $(dot).dataset.st = st;
    }
    const t = ($("bnState").parentElement.title || "") + " · " + ($("hlState").parentElement.title || "");
    if (btn.title !== t) btn.title = t;
  }
  function close() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  btn.onclick = () => { const open = panel.hidden; close(); if (open) { panel.hidden = false; btn.setAttribute("aria-expanded", "true"); } };
  $("stClose").onclick = close;
  document.addEventListener("click", e => { if (!e.target.closest("#stBtn, #stPanel")) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  setInterval(sync, 1000); sync();
})();
