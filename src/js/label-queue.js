// Label queue (view): go through the episodes you have not labelled yet, one after another, with few taps. Display and navigation only: a label is still made by the existing agree / disagree
// buttons (reader-tools.js), so the label format and the matching rule are untouched. Adds prev / next unlabelled buttons above the timeline detail, keys (right or N next, left or P previous,
// A agree, D disagree; only while no field has focus), and an "after a label, go to the next" switch (on by default, remembered). The order and the pick are LABELQ (label-queue-core.js).
(function lqSetup() {
  const bar = document.getElementById("lqBar"); if (!bar || typeof LABELQ === "undefined" || typeof RT === "undefined") return;
  const info = document.getElementById("lqInfo"), auto = document.getElementById("lqAuto"), famSet = () => (typeof epFilter !== "undefined" ? epFilter.family : null);
  try { if (localStorage.getItem("sv-lq-auto") === "0") auto.checked = false; } catch (e) { /* storage blocked: default on */ }
  auto.onchange = () => { try { localStorage.setItem("sv-lq-auto", auto.checked ? "1" : "0"); } catch (e) { /* ignore */ } };

  function show(id) {                                             // select the group in the timeline detail; widen the window when it lies outside it
    const g = RD().episodeGroups().find(x => String(x.id) === String(id)); if (!g) return false;
    const win = +rt$("tlWin").value, now = RD().state().now;
    if (win > 0 && now && g.tStart < now - win) rt$("tlWin").value = "0";
    const sec = rt$("tlCv").closest("section"); if (sec) sec.classList.remove("collapsed");      // the Timeline is folded by default: open it for now (the saved fold state is not changed)
    RT.sel = g.id; epOpen.add(String(g.id)); RT.last.detail = null; renderReader();
    const d = document.getElementById("tlDetail"); if (d && d.scrollIntoView) d.scrollIntoView({ block:"nearest" });
    return true;
  }
  function go(dir, fromId) {
    const id = LABELQ.pick(RD().episodeGroups(), rdLabelFor, fromId === undefined ? RT.sel : fromId, dir, famSet());
    if (id == null) { info.textContent = "Nothing left to label" + (famSet() && famSet().size ? " in the families shown" : "") + "."; info.dataset.keep = Date.now(); return false; }
    return show(id);
  }
  document.getElementById("lqNext").onclick = () => go(1);
  document.getElementById("lqPrev").onclick = () => go(-1);

  // after a label made in the timeline detail: go to the next unlabelled. The label is applied (and the card redrawn) by reader-tools.js in a document-level capture handler, so this one listens
  // on the window, which runs first and still sees the card, and moves on once that has happened.
  window.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("button[data-label]"); if (!e.isTrusted || !b || !auto.checked || !b.closest("#tlDetail")) return;      // a key press clicks the button itself and advances right away (below)
    const card = b.closest(".ep"), id = card && card.dataset.id; if (!id) return;
    setTimeout(() => { const g = RD().episodeGroups().find(x => String(x.id) === id); if (g && rdLabelFor(g)) go(1, id); }, 0);      // a tap that removed the label stays on the card
  }, true);

  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target, tag = t && t.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (!rt$("tlCv").clientWidth) return;                          // the Reader view is not on screen
    const k = e.key.toLowerCase();
    if (k === "arrowright" || k === "n") { e.preventDefault(); go(1); }
    else if (k === "arrowleft" || k === "p") { e.preventDefault(); go(-1); }
    else if (k === "a" || k === "d") {
      const btn = document.querySelector('#tlDetail button[data-label="' + (k === "a" ? "agree" : "disagree") + '"]'); if (btn) {
        e.preventDefault(); const card = btn.closest(".ep"), id = card && card.dataset.id;
        btn.click();                                                // the label is applied synchronously
        if (auto.checked && id) { const g = RD().episodeGroups().find(x => String(x.id) === id); if (g && rdLabelFor(g)) go(1, id); }
      }
    }
  });

  function update() {
    const p = LABELQ.progress(RD().episodeGroups(), rdLabelFor, famSet()), txt = p.total ? p.open + " unlabelled of " + p.total : "no episodes yet";
    if (info.dataset.keep && Date.now() - info.dataset.keep < 3000) return;
    if (info.textContent !== txt) info.textContent = txt;
  }
  if (typeof renderReader === "function") { const original = renderReader; renderReader = function () { original.apply(this, arguments); try { update(); } catch (err) { /* contained */ } }; }
})();
