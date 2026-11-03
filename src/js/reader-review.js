"use strict";
// Weekly-review decisions: pure logic, no DOM, no timers, no storage, no clock (the caller passes dates). Self-revising Reader, Part 3b/3c.
// The register, drift and proposal modules decide WHAT is proposed; this module holds the sequence around it that the view used to carry:
// which configurations to replay, how a replay is scored against labels, how the runs become verdicts, whether a verdict is still fresh,
// what an approval or a reset writes to its revision file (format: docs/adr/0003, read by fold.mjs), and which imported overrides are offered.
// It never changes a detection; applying a value to a config is the caller's choice (setValue works on the object it is given).
const READER_REVIEW = (() => {
  const link = k => READER_REGISTER.LINKS.find(l => l.k === k);
  const pct = x => (x >= 0 ? "+" : "") + Math.round(x * 100) + "%";
  const fam = f => READER_EPISODES.FAMILY_LABEL[f] || f;
  const when = t => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const labTxt = l => l.a + l.dn + l.m ? `agreed ${l.aF}/${l.a} · disagreed shown ${l.dS}/${l.dn} · missed found ${l.mD}/${l.m}` : "no labels";
  const rateTxt = (runs, f) => { const r = READER_PROPOSALS.rate(runs, f); return r == null ? "–" : r.toFixed(1) + "/h"; };
  const FENCE = "\x60\x60\x60";

  // a threshold lives in cfg.ep (episode settings) or directly on cfg (engine settings)
  const curValue = (cfg, k) => link(k).at === "ep" ? cfg.ep[k] : cfg[k];
  const builtIn = k => link(k).at === "ep" ? READER_EPISODES.DEFAULTS[k] : READER_ENGINE.DEFAULTS[k];
  function setValue(cfg, k, v){ if (link(k).at === "ep") cfg.ep[k] = v; else cfg[k] = v; }

  // a deep-enough copy of the live config, with the proposed values applied, for a replay
  function replayCfg(live, changes){
    const c = {sens:live.sens, detectors:{...live.detectors}, ep:{...live.ep, families:{...live.ep.families}, horizons:live.ep.horizons.slice()}};
    for (const l of READER_REGISTER.LINKS) if (l.at === "cfg") c[l.k] = live[l.k];
    c.ep.keepEpisodes = 5000; c.ep.keepWalls = 500;
    for (const k in changes) setValue(c, k, changes[k]);
    return c;
  }
  // the configurations to replay for the pending proposals: current, each alone, and all together when there are several
  function plan(pend){
    const cfgs = [{name:"current", changes:{}, what:"current thresholds"}].concat(pend.map((p, i) => ({name:p.id, changes:{[p.k]:p.to}, what:"proposal " + (i + 1) + " of " + pend.length})));
    if (pend.length > 1) cfgs.push({name:"together", changes:Object.fromEntries(pend.map(p => [p.k, p.to])), what:"all proposals together"});
    return cfgs;
  }
  // how many of the user's labels overlapping [t0, t1] a replay found again; match(label, episode) is the caller's matcher
  function tally(labels, episodes, t0, t1, match){
    const lab = {a:0, aF:0, dn:0, dS:0, m:0, mD:0};
    for (const l of labels.filter(l => l.t1 >= t0 && l.t0 <= t1)){
      const hit = episodes.some(ep => match(l, ep));
      if (l.verdict === "agree"){ lab.a++; if (hit) lab.aF++; } else if (l.verdict === "disagree"){ lab.dn++; if (hit) lab.dS++; } else { lab.m++; if (hit) lab.mD++; }
    }
    return lab;
  }
  // runs: [{name, t0, hours, by:{[planName]:{eps, labels}}}] -> per-proposal verdicts and the "together" comparison
  function verdicts(pend, runs, oldRates){
    const per = {};
    for (const p of pend){
      const mk = (r, key) => ({tag:r.t0 >= p.driftFrom ? "after" : "before", labels:r.by[key].labels, eps:r.by[key].eps, hours:r.hours, name:r.name});
      const base = runs.map(r => mk(r, "current")), prop = runs.map(r => mk(r, p.id));
      per[p.id] = {rev:p.rev || 0, base, prop, v:READER_PROPOSALS.verdict({proposal:p, base, prop, oldRates:oldRates(p.id)})};
    }
    const together = pend.length > 1 && runs.length ? {base:runs.map(r => ({labels:r.by.current.labels, eps:r.by.current.eps, hours:r.hours})), prop:runs.map(r => ({labels:r.by.together.labels, eps:r.by.together.eps, hours:r.hours})), ids:pend.map(p => p.id), revs:pend.map(p => p.rev || 0)} : null;
    return {per, together};
  }
  // a verdict is only good for the proposal revision and register epoch it was computed for
  const isFresh = (p, r, res, epoch) => !!r && r.rev === (p.rev || 0) && !!res && res.epoch === epoch;
  const togetherOk = (res, epoch) => !!res && !!res.together && res.epoch === epoch;
  const togetherShown = (res, epoch, pend) => { const T = res && res.together; return !!T && res.epoch === epoch && T.ids.every((id, i) => pend.some(p => p.id === id && (p.rev || 0) === T.revs[i])); };

  // the revision file an approval downloads (ADR 0003). nameOf(driftKey) -> readable variable name; date: "YYYY-MM-DD"
  function revisionFile(p, r, group, res, done, nameOf, date){
    const d = date, v = r.v;
    const json = {kind:"approval", v:1, id:p.id, group, key:p.k, where:p.at, label:p.label, from:p.from, to:p.to, change:+p.change.toFixed(4), approvedAt:p.approvedAt, date:d, provisional:p.provisional, large:p.large,
      verdict:v.verdict, conditions:v.conds.map(c => ({k:c.k, ok:c.ok, text:c.text})), cause:{driftId:p.driftId, driftKey:p.driftKey, driftFrom:p.driftFrom, driftAt:p.driftAt, per:p.per},
      replay:{checkedAt:res.at, recordings:r.base.map(b => ({name:b.name, tag:b.tag, hours:+b.hours.toFixed(3)})), labels:v.labels, rates:v.rates}, together:group ? done.map(x => x.k) : null};
    const lines = [`# Revision: ${p.label}`, "", "Status: approved", "Folded: no", `Date: ${d}`, `Threshold: ${p.k} (${p.at === "ep" ? "episode settings" : "engine settings"})`, `Change: ${p.from} -> ${p.to} (${pct(p.change)})${p.provisional ? ", provisional" : ""}${p.large ? ", large change" : ""}`,
      `Group: ${group ? group + " (approved together with " + done.filter(x => x.k !== p.k).map(x => x.k).join(", ") + ")" : "none"}`, "",
      "## Why", "", `${nameOf(p.driftKey)} drifted (${when(p.driftAt)}). The old number sat at: ${p.per.map(q => nameOf(q.key) + ": " + (q.p * 100).toFixed(2) + "th percentile").join("; ")}. The new value is taken at the same percentile of the new distribution.`, "",
      "## Evidence", "", `Verdict: **${v.verdict}**`, ""].concat(v.conds.map(c => `- ${c.ok ? "ok" : "MISSING"}: ${c.text}`));
    lines.push("", `Recordings replayed: ${r.base.map(b => b.name + " (" + b.tag + " the drift)").join(", ") || "none"}.`, "", "| Family | usual | current | proposed |", "|---|---|---|---|");
    for (const f of p.families) lines.push(`| ${fam(f)} | ${v.rates[f] && v.rates[f].old != null ? v.rates[f].old.toFixed(1) + "/h" : "-"} | ${rateTxt(r.base, f)} | ${rateTxt(r.prop, f)} |`);
    lines.push("", `Labels, current: ${labTxt(v.labels.base)}. Labels, proposed: ${labTxt(v.labels.prop)}.`, "", "## Machine-readable", "", FENCE + "json", JSON.stringify(json, null, 1), FENCE, "");
    return {name: `${d}-${p.k}${group ? "-" + group : ""}.md`, text: lines.join("\n")};
  }
  // the file a reset downloads; rec is what register.resetOverride returned
  function revertFile(rec, date){
    const d = date, json = {kind:"revert", v:1, key:rec.k, where:rec.at, of:rec.of, from:rec.from, to:rec.to, reason:rec.reason, date:d, time:rec.time};
    const lines = [`# Revert: ${link(rec.k).label}`, "", "Status: approved", "Folded: no", `Date: ${d}`, `Threshold: ${rec.k}`, `Change: ${rec.from} -> ${rec.to} (back to the built-in default)`, `Reverts: ${rec.of}`, `Reason: ${rec.reason || "none given"}`, "",
      "## Machine-readable", "", FENCE + "json", JSON.stringify(json, null, 1), FENCE, ""];
    return {name: `${d}-${rec.k}-revert.md`, text: lines.join("\n")};
  }
  // overrides carried in a register file: only known thresholds with a finite value that differs from the live one are offered
  function importCandidates(ov, cur){
    if (!ov || typeof ov !== "object") return null;
    const out = Object.fromEntries(Object.entries(ov).filter(([k, x]) => link(k) && x && isFinite(x.value) && x.value !== cur(k)));
    return Object.keys(out).length ? out : null;
  }
  return {link, pct, fam, when, labTxt, rateTxt, curValue, builtIn, setValue, replayCfg, plan, tally, verdicts, isFresh, togetherOk, togetherShown, revisionFile, revertFile, importCandidates};
})();
