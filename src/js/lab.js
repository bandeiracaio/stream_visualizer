"use strict";
// Analysis lab (view, Analysis > Lab): shows the stored experiments (docs/lab/*.json, embedded by the build as LAB_ENTRIES). Display only: it computes nothing, reads no feed and
// touches no engine state, so it works offline on a phone or a PC exactly as released. The entry format, the filter and the number format are LAB (lab-core.js).
(function labSetup() {
  const root = document.getElementById("labRoot"); if (!root || typeof LAB === "undefined") return;
  const entries = LAB.sorted(typeof LAB_ENTRIES !== "undefined" ? LAB_ENTRIES : []);
  const st = { verdict: "all", q: "", open: null };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const VCOL = { confirmed: "var(--buy)", rejected: "var(--sell)", inconclusive: "var(--warn)", idea: "var(--accent)", sample: "var(--dim)" };
  const pill = v => `<span class="labv" style="color:${VCOL[v] || "var(--dim)"}">${esc(v)}</span>`;

  function bars(b) {                                          // horizontal bars from zero; negative values go left
    const max = Math.max.apply(null, b.items.map(i => Math.abs(i.value))) || 1, neg = b.items.some(i => i.value < 0);
    return `<div class="labbars">` + b.items.map(i => {
      const w = Math.abs(i.value) / max * (neg ? 50 : 100), left = neg ? (i.value < 0 ? 50 - w : 50) : 0;
      return `<div class="labbar"><span class="lbl">${esc(i.label)}</span><span class="trk"><i style="left:${left}%;width:${w}%;background:${i.value < 0 ? "var(--sell)" : "var(--buy)"}"></i></span><span class="val">${esc(LAB.fmt(i.value))}</span></div>`;
    }).join("") + `</div>` + (b.unit ? `<div class="note">unit: ${esc(b.unit)}</div>` : "");
  }
  function series(b) {                                        // a plain line chart in an svg; scales to the box
    const W = 320, H = 130, pl = 36, pb = 18, pt = 6, pr = 6;
    const x0 = Math.min.apply(null, b.x), x1 = Math.max.apply(null, b.x), y0 = Math.min.apply(null, b.y), y1 = Math.max.apply(null, b.y);
    const sx = v => pl + (x1 === x0 ? 0 : (v - x0) / (x1 - x0)) * (W - pl - pr), sy = v => H - pb - (y1 === y0 ? 0 : (v - y0) / (y1 - y0)) * (H - pb - pt);
    const pts = b.x.map((x, i) => sx(x).toFixed(1) + "," + sy(b.y[i]).toFixed(1)).join(" ");
    return `<svg class="labsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(b.title || "series")}">`
      + `<line x1="${pl}" y1="${H - pb}" x2="${W - pr}" y2="${H - pb}" stroke="var(--edge)"/><line x1="${pl}" y1="${pt}" x2="${pl}" y2="${H - pb}" stroke="var(--edge)"/>`
      + `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`
      + `<text x="${pl - 4}" y="${pt + 8}" text-anchor="end">${esc(LAB.fmt(y1))}</text><text x="${pl - 4}" y="${H - pb}" text-anchor="end">${esc(LAB.fmt(y0))}</text>`
      + `<text x="${pl}" y="${H - 4}">${esc(LAB.fmt(x0))}</text><text x="${W - pr}" y="${H - 4}" text-anchor="end">${esc(LAB.fmt(x1))}</text></svg>`
      + `<div class="note">${esc(b.xLabel || "x")} → ${esc(b.yLabel || "y")}</div>`;
  }
  function table(b) {
    return `<div class="labtbl"><table><thead><tr>${b.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>`
      + b.rows.map(r => `<tr>${r.map(c => `<td>${esc(LAB.fmt(c))}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
  }
  const block = b => `<div class="labblock">` + (b.title ? `<div class="labbt">${esc(b.title)}</div>` : "") + (b.type === "text" ? `<p>${esc(b.text)}</p>` : b.type === "table" ? table(b) : b.type === "bars" ? bars(b) : series(b)) + `</div>`;

  function entryPage(e) {
    const d = e.data || {}, m = e.method || {}, kv = (k, v) => v === undefined || v === "" ? "" : `<div class="labkv"><span>${k}</span><span>${esc(v)}</span></div>`;
    const counts = d.counts ? Object.keys(d.counts).map(k => k + " " + LAB.fmt(d.counts[k])).join(", ") : "";
    return `<div class="row"><button id="labBack">‹ All entries</button></div>`
      + `<h3 class="labt">${esc(e.title)} ${pill(e.verdict)}</h3><div class="note">${esc(e.date)}${e.tags && e.tags.length ? " · " + e.tags.map(esc).join(", ") : ""}</div>`
      + (e.verdict === "sample" ? `<div class="labwarn">Sample: an example of the format. The numbers are invented.</div>` : "")
      + `<div class="labblock"><div class="labbt">Question</div><p>${esc(e.question)}</p></div>`
      + (e.verdictNote ? `<div class="labblock"><div class="labbt">Verdict</div><p>${esc(e.verdictNote)}</p></div>` : "")
      + `<div class="labblock"><div class="labbt">Data</div>${kv("files", (d.files || []).join(", "))}${kv("range", d.range)}${kv("counts", counts)}</div>`
      + `<div class="labblock"><div class="labbt">Method</div><p>${esc(m.summary || "")}</p>`
      + (m.plan && m.plan.length ? `<div class="labsub">Plan fixed in advance</div><ul>${m.plan.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : "")
      + (m.params ? kv("params", JSON.stringify(m.params)) : "") + kv("re-run", m.rerun) + `</div>`
      + `<h3 class="labt">Results</h3>` + (e.results.length ? e.results.map(block).join("") : `<div class="note">No results in this entry.</div>`);
  }
  function listPage() {
    const shown = LAB.filter(entries, st.verdict, st.q), c = LAB.counts(entries);
    return `<div class="row"><input id="labQ" type="search" placeholder="search title, question, tag" value="${esc(st.q)}" aria-label="Search entries">`
      + `<select id="labV" aria-label="Verdict">` + ["all"].concat(LAB.VERDICTS).map(v => `<option value="${v}"${v === st.verdict ? " selected" : ""}>${v === "all" ? "all verdicts (" + entries.length + ")" : v + " (" + c[v] + ")"}</option>`).join("") + `</select></div>`
      + (shown.length ? shown.map(e => `<button class="labrow" data-id="${esc(e.id)}"><span class="labrt">${esc(e.title)}</span><span class="labrm">${esc(e.date)} · ${pill(e.verdict)}</span><span class="labrq">${esc(e.question)}</span></button>`).join("")
        : `<div class="note">${entries.length ? "No entry matches." : "No entries yet. Drop an entry file in docs/lab/ and build."}</div>`);
  }
  function draw() {
    const e = st.open && entries.find(x => x.id === st.open);
    root.innerHTML = e ? entryPage(e) : listPage();
    if (e) { document.getElementById("labBack").onclick = () => { st.open = null; draw(); window.scrollTo(0, 0); }; return; }
    const q = document.getElementById("labQ");
    q.oninput = () => { st.q = q.value; const pos = q.selectionStart; draw(); const n = document.getElementById("labQ"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* type=search may refuse */ } };
    document.getElementById("labV").onchange = ev => { st.verdict = ev.target.value; draw(); };
    root.querySelectorAll(".labrow").forEach(b => { b.onclick = () => { st.open = b.dataset.id; draw(); window.scrollTo(0, 0); }; });
  }
  draw();
})();
