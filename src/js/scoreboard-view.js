"use strict";
// Scoreboard (view, Review area): what price did after each episode group, how often you agree, how many real ones were found. The maths is in scoreboard-core.js
// (shared with reader-scoreboard.mjs). Sessions = the Saved recordings, labels = your agree / disagree / missed labels, thresholds = the current settings (rtCfg()).
// Computing replays every saved recording once; each result is kept per file and settings, so the next press replays only what is new. Display only. Spec: .scratch/scoreboard-view/spec.md.
const SBV = {busy:false, parts:new Map(), cfgKey:""};
const sbv$ = id => document.getElementById(id);
const sbvEsc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
const sbvPct = x => x == null ? "–" : Math.round(100 * x) + "%";
const sbvLabelFor = (labels, g) => { for (let i = labels.length - 1; i >= 0; i--) { const l = labels[i]; if (l.verdict !== "missed" && rtMatch(l, g)) return l.verdict; } return null; };
const sbvL = {labelFor:sbvLabelFor, labelMatches:rtMatch};      // the app's own label rule (reader-tools.js)
const sbvName = f => sbvEsc(READER_EPISODES.FAMILY_LABEL[f] || f);

function sbvSummary() {
  const parts = RC.rows.map(r => SBV.parts.get(r.name)).filter(Boolean);
  return parts.length ? SCOREBOARD.summarize(parts, RT.labels, sbvL) : null;
}
function sbvCell(c) { return c.n ? `${c.median >= 0 ? "+" : ""}${c.median} · ${sbvPct(c.withShare)} · n ${c.n}` : "–"; }
function sbvFamily(fam, o, P) {
  const lb = o.labelled, p = o.precision;
  const prec = !p.n ? "no labels yet" : p.enough ? `<b>${sbvPct(p.share)}</b> (95% ${sbvPct(p.ci[0])} to ${sbvPct(p.ci[1])}) · ${p.agree} agree / ${p.disagree} disagree` : `n ${p.n}, too few for a rate (need ${P.minN} labelled)`;
  const fwd = P.horizonsSec.map(H => { const f = o.forward[H]; return `<tr><td>${H / 60} min</td><td>${sbvCell(f.all)}</td><td>${sbvCell(f.agree)}</td><td>${sbvCell(f.disagree)}</td><td>${sbvCell(f.none)}</td></tr>`; }).join("");
  const days = o.byDay.filter(d => d.n).map(d => `<tr><td>${d.day}</td><td>${d.enough ? sbvPct(d.share) : "·"}</td><td>${d.agree} / ${d.disagree}</td></tr>`).join("");
  return `<div class="sbfam"><h3>${sbvName(fam)} <span class="stat">${o.n} groups · ${lb.agree} agree, ${lb.disagree} disagree, ${lb.none} not labelled</span></h3>
    <div>Precision: ${prec}</div>
    <div class="stat" style="margin-top:6px">Price move after detection, in sigmas in the side's direction: median · share that went with the side · n</div>
    <div style="overflow-x:auto"><table class="tt"><thead><tr><th>after</th><th>all</th><th>agree</th><th>disagree</th><th>not labelled</th></tr></thead><tbody>${fwd}</tbody></table></div>
    ${days ? `<div class="stat" style="margin-top:6px">Precision per day (UTC)</div><div style="overflow-x:auto"><table class="tt"><thead><tr><th>day</th><th>precision</th><th>agree / disagree</th></tr></thead><tbody>${days}</tbody></table></div>` : ""}</div>`;
}
function sbvRender() {
  const out = sbv$("sbOut"), r = sbvSummary();
  if (!r) { out.innerHTML = `<div class="note">${RC.rows.length ? "Press Compute to replay the saved recordings." : "No saved recordings yet (Recordings, Saved)."}</div>`; return; }
  const P = r.plan, fams = Object.keys(r.families), rec = r.missed.perFamily;
  const recall = Object.keys(rec).map(f => { const x = rec[f]; return `<tr><td>${sbvName(f)}</td><td>${x.enough ? `<b>${sbvPct(x.recall)}</b> (95% ${sbvPct(x.ci[0])} to ${sbvPct(x.ci[1])})` : `too few (n ${x.real})`}</td><td>${x.agree}</td><td>${x.missed}</td><td>${x.caughtNow}</td></tr>`; }).join("");
  out.innerHTML = `<div class="headline">${r.groups} episode groups in ${r.sessions} recording${r.sessions === 1 ? "" : "s"}${r.sessions < RC.rows.length ? ` (of ${RC.rows.length} saved: press Compute for the rest)` : ""}</div>
    <div class="stat">Typical |move| at random moments of the same recordings, in sigmas, so "a big move" can be told from "price always moves this much": ${P.horizonsSec.map(H => `${H / 60} min <b>${r.typicalAbs[H] == null ? "–" : r.typicalAbs[H]}</b>`).join(" · ")}</div>
    ${fams.length ? fams.map(f => sbvFamily(f, r.families[f], P)).join("") : `<div class="note">Nothing was detected in these recordings.</div>`}
    <div class="sbfam"><h3>Found among what you called real <span class="stat">agree + missed; a missed label is found when the replay now has a matching group</span></h3>
    ${recall ? `<div style="overflow-x:auto"><table class="tt"><thead><tr><th>family</th><th>found</th><th>agree</th><th>missed</th><th>found now</th></tr></thead><tbody>${recall}</tbody></table></div>` : `<div class="note">No agree or missed labels in range.</div>`}</div>
    <div class="note">Descriptive and small-sample: a rate needs at least ${P.minN} labelled groups, every number shows its n. It says where to look, never keep or drop. Replayed with the current settings (approved thresholds included).</div>`;
}
async function sbvCompute() {
  if (SBV.busy) return; SBV.busy = true; const btn = sbv$("sbGo"), st = sbv$("sbStatus"); btn.disabled = true;
  try {
    const rows = await rcAll(), cfg = rtCfg(), key = JSON.stringify(cfg);
    if (key !== SBV.cfgKey) { SBV.parts.clear(); SBV.cfgKey = key; }      // other thresholds: everything is replayed again
    for (const f of [...SBV.parts.keys()]) if (!rows.some(r => r.name === f)) SBV.parts.delete(f);      // a deleted recording no longer counts
    let i = 0;
    for (const r of rows) {
      i++; if (SBV.parts.has(r.name)) continue;
      st.textContent = `Replaying ${i}/${rows.length}: ${r.name}`; await new Promise(ok => setTimeout(ok, 30));      // let the page draw between recordings
      try {
        const s = await rtReadSessionFile(rcFile(r)), span = rtSpan(s.inputs);
        SBV.parts.set(r.name, SCOREBOARD.sessionPart({file:r.name, inputs:s.inputs, t0:span ? span.t0 : s.startedAt, t1:span ? span.t1 : s.startedAt}, READER_ENGINE, cfg));
      } catch (err) { st.textContent = `Skipped ${r.name}: ${err && err.message || err}`; await new Promise(ok => setTimeout(ok, 1500)); }
    }
    RC.rows = rows; st.textContent = `Done: ${SBV.parts.size} recording${SBV.parts.size === 1 ? "" : "s"} replayed.`;
  } catch (err) { st.textContent = "Could not compute: " + (err && err.message || err); }
  finally { SBV.busy = false; btn.disabled = false; sbvRender(); }
}
sbv$("sbGo").onclick = sbvCompute;
VIEWS.onOpen("scoreboard", () => { if (!SBV.busy) rcAll().then(r => { RC.rows = r; sbvRender(); }).catch(sbvRender); });      // opening shows what was computed; labels made since need no replay
