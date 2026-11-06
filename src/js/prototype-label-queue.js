// PROTOTYPE, THROWAWAY (branch prototype/label-queue-variants; never merge to main). Question: how should labelling look so 200 groups take about 10 minutes (3 s each) instead of an hour?
// Three layouts on the Reader view, switched with ?variant=A|B|C (open the page, load a replay as usual, then add ?variant=A to the address). They read RD().episodeGroups() (the real groups of the
// loaded replay or the live engine) and keep their OWN labels in memory (a stub: nothing reaches RT.labels or the saved labels), with a stopwatch so each layout can be timed.
//   A  Deck:       one group at a time, big sparkline + the evidence that matters, keys A agree / D disagree / S skip / Backspace undo.
//   B  Sheet:      every open group as a small tile (sparkline + family + side); tap a tile to cycle blank > agree > disagree; filter by family; "rest agree / rest disagree".
//   C  Pre-sorted: groups ranked by how much of the Reader's own checklist is met; two sliders cut the list into "agree" / "review" / "disagree" blocks; accept a block in one tap, review the middle one by one.
//      (Risk to judge while using it: the proposal anchors you on the Reader's own evidence.)
(function lqProto() {
  let V = (new URLSearchParams(location.search).get("variant") || "").toUpperCase();
  if (!V || "ABC".indexOf(V) < 0 || typeof RD === "undefined" || typeof LABELQ === "undefined") return;
  const NAMES = { A: "Deck: one at a time", B: "Sheet: all tiles", C: "Pre-sorted: confirm blocks" };
  const stub = new Map(), undo = [], skipped = new Set();
  let t0 = 0, tLast = 0, deckId = null, famOn = null, cutHi = 0.8, cutLo = 0.4, lastKey = "", lastEng = null;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const root = document.createElement("div");
  root.id = "lqProto";
  root.style.cssText = "position:fixed;inset:0;z-index:9000;overflow:auto;background:var(--bg);color:var(--text);font:13px var(--mono);padding:8px 8px 70px";
  document.body.appendChild(root);

  // ----- data
  const groups = () => LABELQ.sorted(RD().episodeGroups(), null);
  const label = g => stub.get(String(g.id)) || null;
  function setLabel(g, v) { if (!t0) t0 = Date.now(); tLast = Date.now(); const id = String(g.id); undo.push([id, stub.get(id) || null]); if (v) stub.set(id, v); else stub.delete(id); }
  function undoLast() { const u = undo.pop(); if (!u) return; if (u[1]) stub.set(u[0], u[1]); else stub.delete(u[0]); deckId = u[0]; }
  function score(g) {                                              // share of the Reader's own weighted checklist that is met (first member), and whether every gate is met
    const m = (g.members && g.members[0]) || g, ev = (m.evidence || []).filter(e => !e.na); let w = 0, ok = 0, gates = true;
    for (const e of ev) { w += e.w || 1; if (e.ok) ok += e.w || 1; else if (e.gate) gates = false; }
    return { s: w ? ok / w : 0, gates };
  }
  function priceHist() { const e = RD(), a = e.priceHistory("bn"); return a && a.length ? a : (e.priceHistory("hl") || []); }
  function spark(g, w, h, ph) {
    const a = g.tStart - 90000, b = (g.tEnd || g.tUpdate || g.tDetected) + 15000, pts = [];
    for (const p of ph) { if (p[0] > b) break; if (p[0] >= a) pts.push(p); }
    if (pts.length < 3) return `<svg width="${w}" height="${h}"></svg>`;
    let mn = Infinity, mx = -Infinity; for (const p of pts) { if (p[1] < mn) mn = p[1]; if (p[1] > mx) mx = p[1]; }
    const X = t => ((t - a) / (b - a) * (w - 2) + 1).toFixed(1), Y = p => (mx === mn ? h / 2 : (h - 3) - (p - mn) / (mx - mn) * (h - 6) + 1.5).toFixed(1);
    const d = pts.map(p => X(p[0]) + "," + Y(p[1])).join(" "), xs = X(g.tStart), xd = X(g.tDetected), xe = X(g.tEnd || g.tUpdate || g.tDetected);
    return `<svg width="${w}" height="${h}" style="display:block"><rect x="${xs}" y="0" width="${Math.max(1, xe - xs)}" height="${h}" fill="var(--accent)" opacity=".16"/><line x1="${xd}" x2="${xd}" y1="0" y2="${h}" stroke="var(--accent)"/><polyline points="${d}" fill="none" stroke="var(--hi)" stroke-width="1.2"/></svg>`;
  }
  const sideOf = g => g.aggressor || (g.wall && g.wall.side) || (g.members && g.members[0] && (g.members[0].aggressor || (g.members[0].wall && g.members[0].wall.side))) || "";
  const tag = g => g.family + (sideOf(g) ? " " + sideOf(g) : "") + " · " + (g.venues && g.venues.length > 1 ? "both" : g.venue);
  const chips = g => { const m = (g.members && g.members[0]) || g; return (m.evidence || []).filter(e => !e.na).map(e => `<span title="${esc(e.label)}: ${esc(e.val)}" style="display:inline-block;margin:1px 3px 1px 0;padding:0 4px;border:1px solid ${e.ok ? "var(--buy)" : "var(--edge)"};color:${e.ok ? "var(--buy)" : "var(--dim)"};${e.gate ? "font-weight:bold" : ""}">${esc(e.label.length > 30 ? e.label.slice(0, 30) + "…" : e.label)} ${esc(e.val)}</span>`).join(""); };
  const btn = (id, txt, col) => `<button data-p="${id}" style="min-height:44px;padding:0 14px;font:inherit;background:var(--panel2);color:${col || "var(--text)"};border:1px solid var(--edge)">${txt}</button>`;

  // ----- header with the stopwatch (the number the question is about)
  function head(all) {
    const done = all.filter(label).length, el = t0 ? ((tLast || Date.now()) - t0) / 1000 : 0, per = done ? el / done : 0, left = all.length - done;
    const m = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
    return `<div style="position:sticky;top:0;background:var(--bg);padding:4px 0 8px;border-bottom:1px solid var(--line);margin-bottom:8px"><b style="color:var(--accent)">PROTOTYPE ${V} · ${NAMES[V]}</b> · ${done} of ${all.length} labelled · ${t0 ? m(el) + " used" : "clock starts at your first label"}${done ? " · " + per.toFixed(1) + " s each · " + m(per * left) + " left at this pace" : ""} <button data-p="reset" style="font:inherit">reset</button></div>`;
  }

  // ----- A: deck
  function viewA(all) {
    const open = all.filter(g => !label(g) && !skipped.has(String(g.id)));
    let g = open.find(x => String(x.id) === String(deckId)) || open[0]; if (!g) return `<p>Nothing left. ${all.filter(label).length} labelled, ${skipped.size} skipped.</p>`;
    deckId = g.id; const m = (g.members && g.members[0]) || g, sc = score(g);
    return `<div style="max-width:720px;margin:auto"><div style="font-size:18px;color:var(--hi)">${esc(tag(g))} <span style="color:var(--dim);font-size:13px">${open.length} open · reader score ${(sc.s * 100).toFixed(0)}%${sc.gates ? " · all gates met" : ""}</span></div>
      <div style="margin:6px 0">${spark(g, Math.min(700, innerWidth - 24), 150, priceHist())}</div>
      <div style="margin:6px 0;color:var(--text)">${esc(m.reading || "")}</div><div style="margin:6px 0">${chips(g)}</div>
      <div style="display:flex;gap:8px;margin-top:10px">${btn("agree", "agree (A)", "var(--buy)")}${btn("disagree", "disagree (D)", "var(--sell)")}${btn("skip", "skip (S)")}${btn("undo", "undo (⌫)")}</div></div>`;
  }

  // ----- B: sheet
  function viewB(all) {
    const fams = [...new Set(all.map(g => g.family))], ph = priceHist(), w = 150;
    const shown = all.filter(g => !famOn || g.family === famOn);
    const tiles = shown.map(g => { const l = label(g), col = l === "agree" ? "var(--buy)" : l === "disagree" ? "var(--sell)" : "var(--edge)";
      return `<div data-tile="${esc(g.id)}" title="${esc(((g.members && g.members[0]) || g).reading || "")}" style="width:${w + 8}px;border:2px solid ${col};background:${l ? "var(--panel2)" : "var(--panel)"};padding:3px;cursor:pointer;user-select:none"><div style="font-size:11px;color:${col === "var(--edge)" ? "var(--dim)" : col}">${esc(tag(g))} ${l || ""}</div>${spark(g, w, 44, ph)}</div>`; }).join("");
    return `<div style="margin-bottom:8px">family: <button data-p="fam:" style="font:inherit${famOn ? "" : ";color:var(--accent)"}">all</button> ${fams.map(f => `<button data-p="fam:${f}" style="font:inherit${famOn === f ? ";color:var(--accent)" : ""}">${f}</button>`).join(" ")} · tap a tile: blank → agree → disagree → blank · ${btn("restAgree", "rest shown: agree", "var(--buy)")} ${btn("restDis", "rest shown: disagree", "var(--sell)")}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${tiles}</div>`;
  }

  // ----- C: pre-sorted
  function viewC(all) {
    const rows = all.map(g => ({ g, sc: score(g) })).sort((a, b) => b.sc.s - a.sc.s), ph = priceHist();
    const hi = rows.filter(r => r.sc.s >= cutHi && r.sc.gates), lo = rows.filter(r => r.sc.s < cutLo), mid = rows.filter(r => !hi.includes(r) && !lo.includes(r));
    const open = a => a.filter(r => !label(r.g)).length;
    const row = r => { const l = label(r.g), g = r.g; return `<div style="display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--line);padding:3px 0"><div style="width:110px">${spark(g, 110, 34, ph)}</div><div style="flex:1;min-width:0"><div>${esc(tag(g))} · ${(r.sc.s * 100).toFixed(0)}%${r.sc.gates ? " · gates ok" : ""} ${l ? "<b style='color:" + (l === "agree" ? "var(--buy)" : "var(--sell)") + "'>" + l + "</b>" : ""}</div><div style="color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(((g.members && g.members[0]) || g).reading || "")}</div></div><div data-row="${esc(g.id)}">${btn("ra", "A", "var(--buy)")}${btn("rd", "D", "var(--sell)")}</div></div>`; };
    return `<div>agree block = score ≥ <input type="range" id="cHi" min="0.3" max="1" step="0.05" value="${cutHi}"> ${(cutHi * 100).toFixed(0)}% with every gate met · disagree block = score < <input type="range" id="cLo" min="0" max="0.8" step="0.05" value="${cutLo}"> ${(cutLo * 100).toFixed(0)}%</div>
      <div style="margin:8px 0">${btn("accHi", "accept agree block (" + open(hi) + ")", "var(--buy)")} ${btn("accLo", "accept disagree block (" + open(lo) + ")", "var(--sell)")} <span style="color:var(--dim)">review in the middle: ${open(mid)} of ${mid.length}</span></div>
      <div style="color:var(--accent)">Middle (review one by one)</div>${mid.map(row).join("") || "<div>none</div>"}
      <div style="color:var(--buy);margin-top:10px">Agree block (${hi.length}) — check a few before accepting</div>${hi.slice(0, 12).map(row).join("")}${hi.length > 12 ? "<div style='color:var(--dim)'>… " + (hi.length - 12) + " more</div>" : ""}
      <div style="color:var(--sell);margin-top:10px">Disagree block (${lo.length}) — check a few before accepting</div>${lo.slice(0, 12).map(row).join("")}${lo.length > 12 ? "<div style='color:var(--dim)'>… " + (lo.length - 12) + " more</div>" : ""}`;
  }

  // ----- switcher bar (visible on every variant)
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:9100;background:var(--accent);color:var(--ink);padding:6px 10px;font:13px var(--mono);box-shadow:0 2px 8px #000;display:flex;gap:10px;align-items:center";
  const label$ = () => bar.querySelector("span").textContent = V + " (" + NAMES[V] + ")";
  const go = v => { if (!v) { const u = new URL(location.href); u.searchParams.delete("variant"); location.href = u.toString(); return; } V = v; const u = new URL(location.href); u.searchParams.set("variant", v); history.replaceState(null, "", u); label$(); lastKey = ""; render(); };      // in place: the loaded replay and the labels survive a switch
  bar.innerHTML = `<button id="lqpP" style="font:inherit">◀</button><span></span><button id="lqpN" style="font:inherit">▶</button><button id="lqpOff" style="font:inherit">off</button>`; label$();
  document.body.appendChild(bar);
  const nextV = d => "ABC"[("ABC".indexOf(V) + d + 3) % 3];
  bar.querySelector("#lqpP").onclick = () => go(nextV(-1)); bar.querySelector("#lqpN").onclick = () => go(nextV(1)); bar.querySelector("#lqpOff").onclick = () => go("");

  // ----- render + events
  function render() {
    const all = groups(), body = V === "A" ? viewA(all) : V === "B" ? viewB(all) : viewC(all);
    if (!all.length) { root.innerHTML = `<b style="color:var(--accent)">PROTOTYPE ${V}</b><p>No episode groups yet. Load a replay (Review &gt; replay, or Recordings &gt; Saved &gt; Open) and come back to the Reader view.</p>`; return; }
    const sy = root.scrollTop; root.innerHTML = head(all) + body; root.scrollTop = sy;
    const hi = root.querySelector("#cHi"), lo = root.querySelector("#cLo");
    if (hi) hi.oninput = () => { cutHi = +hi.value; render(); }; if (lo) lo.oninput = () => { cutLo = +lo.value; render(); };
  }
  function openGroups() { return groups().filter(g => !label(g) && !skipped.has(String(g.id))); }
  function deckAct(v) { if (deckId == null) render(); const g = groups().find(x => String(x.id) === String(deckId)); if (!g) return; if (v === "skip") skipped.add(String(g.id)); else setLabel(g, v); deckId = null; render(); }
  root.addEventListener("click", e => {
    const t = e.target.closest("[data-tile]"); if (t) { const g = groups().find(x => String(x.id) === t.dataset.tile), l = label(g); setLabel(g, l === "agree" ? "disagree" : l === "disagree" ? null : "agree"); render(); return; }
    const b = e.target.closest("[data-p]"); if (!b) return; const p = b.dataset.p, row = b.parentElement && b.parentElement.dataset.row;
    if (p === "agree" || p === "disagree" || p === "skip") deckAct(p);
    else if (p === "undo") { undoLast(); render(); }
    else if (p === "reset") { stub.clear(); undo.length = 0; skipped.clear(); t0 = tLast = 0; deckId = null; render(); }
    else if (p.startsWith("fam:")) { famOn = p.slice(4) || null; render(); }
    else if (p === "restAgree" || p === "restDis") { for (const g of groups()) if (!label(g) && (!famOn || g.family === famOn)) setLabel(g, p === "restAgree" ? "agree" : "disagree"); render(); }
    else if (p === "ra" || p === "rd") { const g = groups().find(x => String(x.id) === row); if (g) { setLabel(g, p === "ra" ? "agree" : "disagree"); render(); } }
    else if (p === "accHi" || p === "accLo") { const rows = groups().map(g => ({ g, sc: score(g) })); for (const r of rows) if (!label(r.g)) { if (p === "accHi" && r.sc.s >= cutHi && r.sc.gates) setLabel(r.g, "agree"); if (p === "accLo" && r.sc.s < cutLo) setLabel(r.g, "disagree"); } render(); }
  });
  document.addEventListener("keydown", e => {                        // capture: the real queue's keys (arrows, N, P, A, D) must not also act while the prototype is open
    if (e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target, tag = t && t.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "arrowright") { e.preventDefault(); e.stopImmediatePropagation(); go(nextV(k === "arrowright" ? 1 : -1)); return; }
    if (V === "A" && (k === "a" || k === "d" || k === "s" || k === "backspace")) { e.preventDefault(); e.stopImmediatePropagation(); if (k === "backspace") { undoLast(); render(); } else deckAct(k === "a" ? "agree" : k === "d" ? "disagree" : "skip"); }
  }, true);
  setInterval(() => { let key; try { const e = RD(), n = groups().length; key = n + "|" + (e === lastEng); lastEng = e; if (key !== lastKey || (V === "A" && !root.innerHTML)) { lastKey = key; render(); } } catch (err) { /* engine not ready */ } }, 1000);
  render();
})();
