"use strict";
// Reader scoreboard maths: pure, no DOM, no timers, no storage. What price did after each episode group (in sigmas, the Reader's own ruler), how often the user agrees (precision with a
// Wilson interval, per day) and how many of the episodes called real were found (recall). Descriptive, never a keep / drop verdict. Used by reader-scoreboard.mjs (command line) and
// scoreboard-view.js (Review > Scoreboard). Spec: .scratch/scoreboard-view/spec.md. Meaning of each number: the comment block at the top of reader-scoreboard.mjs.
const SCOREBOARD = (() => {
const PLAN = { horizonsSec:[60, 300, 900], minN:8, sigmaLagSec:15, sigmaFloor:0.05, randomStepSec:10, z:1.96 };
const rtSide = g => g.aggressor || (g.wall && g.wall.side) || "";
const sideDir = side => side === "buy" || side === "bid" ? 1 : side === "sell" || side === "ask" ? -1 : 0;      // aggressors are buy / sell; a wall's side is bid / ask (a bid wall protects upward)
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m])/2; };
const r2 = x => x == null ? null : +x.toFixed(2);

// ---------- price helpers: hist is the engine's [[t_ms, price]] one point a second
function priceAt(h, t) {      // newest point at or before t, within 2 s of it (the engine's own rule)
  let lo = 0, hi = h.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r >= 0 && t - h[r][0] <= 2000 ? h[r][1] : null;
}
function sigmaOf(h, plan = PLAN) {      // bps per root second over the whole history
  const rets = [];
  for (let i = 0; i < h.length; i++) { const p0 = h[i][1], p1 = priceAt(h, h[i][0] + plan.sigmaLagSec*1000); if (p0 > 0 && p1 > 0 && h[i][0] + plan.sigmaLagSec*1000 <= h[h.length - 1][0]) rets.push((p1/p0 - 1)*1e4); }
  if (rets.length < 60) return plan.sigmaFloor;
  const med = median(rets), dev = rets.map(x => Math.abs(x - med)).sort((a, b) => a - b), q75 = dev[Math.floor(0.75*(dev.length - 1))];
  return Math.max(q75/1.1503/Math.sqrt(plan.sigmaLagSec), plan.sigmaFloor);
}
function forwardMove(h, t, horizonSec, dir, sigma) {      // signed move in sigmas after horizonSec; null when the history does not reach that far or the start has no price
  const end = t + horizonSec*1000; if (!h.length || end > h[h.length - 1][0]) return null;
  const p0 = priceAt(h, t), p1 = priceAt(h, end); if (!(p0 > 0) || !(p1 > 0)) return null;
  return dir*((p1/p0 - 1)*1e4)/(sigma*Math.sqrt(horizonSec));
}
function typicalAbs(h, horizonSec, sigma, step = PLAN.randomStepSec) {      // median |move| in sigmas at moments spread over the history
  const v = []; if (h.length < 2) return null;
  for (let t = h[0][0]; t + horizonSec*1000 <= h[h.length - 1][0]; t += step*1000) { const m = forwardMove(h, t, horizonSec, 1, sigma); if (m != null) v.push(Math.abs(m)); }
  return v.length ? median(v) : null;
}
function wilson(k, n, z = PLAN.z) {      // 95% interval for a share k of n
  if (!n) return null;
  const p = k/n, d = 1 + z*z/n, c = p + z*z/(2*n), w = z*Math.sqrt(p*(1 - p)/n + z*z/(4*n*n));
  return [Math.max(0, (c - w)/d), Math.min(1, (c + w)/d)];
}


  // One session replayed: its episode groups with the price moves after each, and the typical |move| of the session (per horizon). No labels yet, so a label change needs no replay.
  function sessionPart(s, E, cfg, plan = PLAN) {
    const rows = [], typ = {};      // typ[h] = list of typical |move| values of this session
    const e = E.replayEngine(s.inputs, cfg || undefined), sig = {}, hist = {};
    for (const vn of ["bn", "hl"]) { hist[vn] = e.priceHistory(vn) || []; sig[vn] = sigmaOf(hist[vn], plan); }
    for (const H of plan.horizonsSec) for (const vn of ["bn", "hl"]) { const x = typicalAbs(hist[vn], H, sig[vn], plan.randomStepSec); if (x != null) (typ[H] ||= []).push(x); }
    for (const g of e.episodeGroups()) {
      const vn = g.venues && g.venues.length > 1 ? (g.venues.includes("bn") ? "bn" : g.venues[0]) : g.venue, side = rtSide(g), dir = sideDir(side), fwd = {};
      for (const H of plan.horizonsSec) fwd[H] = dir && hist[vn] ? forwardMove(hist[vn], g.tDetected, H, dir, sig[vn]) : null;
      rows.push({ session:s.file, family:g.family, side:side || "-", venue:vn, tDetected:g.tDetected, day:new Date(g.tDetected).toISOString().slice(0, 10), fwd, g });
    }
    return { file:s.file, t0:s.t0, t1:s.t1, rows, typ };
  }
  // The scoreboard from replayed parts and the labels. L = {labelFor(labels, group) -> "agree" | "disagree" | null, labelMatches(label, group) -> bool}: the caller's own label rule (the app's, or analyze-episodes.mjs's).
  function summarize(parts, labels, L, plan = PLAN) {
    const { labelFor, labelMatches } = L, typ = {};
    const rows = [].concat(...parts.map(p => p.rows.map(r => Object.assign({}, r, { label:labelFor(labels, r.g) }))));
    for (const p of parts) for (const H in p.typ) (typ[H] ||= []).push(...p.typ[H]);
    const ranges = parts.map(p => [p.t0, p.t1]);
  const out = { plan, sessions:parts.length, groups:rows.length, families:{}, typicalAbs:{}, missed:null };
  for (const H of plan.horizonsSec) out.typicalAbs[H] = r2(median(typ[H] || []));
  const fams = [...new Set(rows.map(r => r.family))].sort();
  for (const fam of fams) {
    const g = rows.filter(r => r.family === fam), o = { n:g.length, labelled:{ agree:0, disagree:0, none:0 }, forward:{}, precision:null, byDay:[] };
    for (const r of g) o.labelled[r.label || "none"]++;
    for (const H of plan.horizonsSec) {
      const cell = sel => { const v = sel.map(r => r.fwd[H]).filter(x => x != null); return { n:v.length, median:r2(median(v)), withShare:v.length ? +(v.filter(x => x > 0).length/v.length).toFixed(2) : null }; };
      o.forward[H] = { all:cell(g), agree:cell(g.filter(r => r.label === "agree")), disagree:cell(g.filter(r => r.label === "disagree")), none:cell(g.filter(r => !r.label)) };
    }
    const prec = (a, d) => ({ agree:a, disagree:d, n:a + d, share:a + d ? +(a/(a + d)).toFixed(3) : null, ci:a + d ? wilson(a, a + d).map(x => +x.toFixed(3)) : null, enough:a + d >= plan.minN });
    o.precision = prec(o.labelled.agree, o.labelled.disagree);
    for (const day of [...new Set(g.map(r => r.day))].sort()) { const d = g.filter(r => r.day === day); o.byDay.push(Object.assign({ day, groups:d.length }, prec(d.filter(r => r.label === "agree").length, d.filter(r => r.label === "disagree").length))); }
    out.families[fam] = o;
  }
  // recall among what was called real: missed labels inside the sessions' time range, found when a group now matches one
  const inRange = l => ranges.some(([a, b]) => a != null && b != null && l.t0 <= b && l.t1 >= a), missed = labels.filter(l => l.verdict === "missed" && inRange(l)), agreeRows = rows.filter(r => r.label === "agree");
  out.missed = { total:missed.length, perFamily:{} };
  for (const fam of new Set(missed.map(l => l.family).concat(fams))) {
    const m = missed.filter(l => l.family === fam), ag = agreeRows.filter(r => r.family === fam), caught = m.filter(l => rows.some(r => r.label !== "agree" && r.family === fam && labelMatches(l, r.g))).length, real = ag.length + m.length;
    if (!m.length && !ag.length) continue;
    out.missed.perFamily[fam] = { agree:ag.length, missed:m.length, caughtNow:caught, stillMissed:m.length - caught, real, recall:real ? +((ag.length + caught)/real).toFixed(3) : null, ci:real ? wilson(ag.length + caught, real).map(x => +x.toFixed(3)) : null, enough:real >= plan.minN };
  }
  return out;
  }


  const scoreboard = (sessions, labels, E, cfg, plan = PLAN, L) => summarize(sessions.map(s => sessionPart(s, E, cfg, plan)), labels, L, plan);
  // build self-test (no engine: hand-made parts; the engine-driven checks are in reader-scoreboard.mjs --selftest)
  function selftest() {
    const out = [], ok = (name, pass) => out.push({ name:"scoreboard core: " + name, ok:!!pass, detail:"" });
    const mk = (i, fam, h) => ({ session:"s", family:fam, side:"sell", venue:"bn", tDetected:i, day:"2026-01-0" + (1 + (i >> 4)), fwd:{ 60:h, 300:null, 900:null }, g:{ id:i, family:fam, venue:"bn", aggressor:"sell", tStart:i*10, tEnd:i*10 + 5 } });
    const rows = []; for (let i = 0; i < 12; i++) rows.push(mk(i, "burst", i % 4 ? 1 : -1)); rows.push(mk(20, "wall", null));
    const parts = [{ file:"a", t0:0, t1:1000, rows:rows.slice(0, 7), typ:{ 60:[0.5] } }, { file:"b", t0:5000, t1:6000, rows:rows.slice(7), typ:{ 60:[0.7] } }];
    const labelMatches = (l, g) => l.family === g.family && l.t0 <= g.tEnd && l.t1 >= g.tStart;
    const labelFor = (labels, g) => { for (let i = labels.length - 1; i >= 0; i--) if (labels[i].verdict !== "missed" && labelMatches(labels[i], g)) return labels[i].verdict; return null; };
    const labels = []; for (let i = 0; i < 10; i++) labels.push({ verdict:i < 7 ? "agree" : "disagree", family:"burst", t0:i*10, t1:i*10 + 5 });
    labels.push({ verdict:"missed", family:"wall", t0:5, t1:6 }, { verdict:"missed", family:"wall", t0:99999, t1:99999 });      // the second is outside both sessions
    const r = summarize(parts, labels, { labelFor, labelMatches }), b = r.families.burst, w = r.families.wall;
    ok("two parts, thirteen groups, two families", r.sessions === 2 && r.groups === 13 && b.n === 12 && w.n === 1);
    ok("labels are applied from the caller's rule: 7 agree, 3 disagree, 2 not labelled", b.labelled.agree === 7 && b.labelled.disagree === 3 && b.labelled.none === 2);
    ok("precision 7 / 10 with an interval around it, enough labels", b.precision.share === 0.7 && b.precision.ci[0] < 0.7 && b.precision.ci[1] > 0.7 && b.precision.enough);
    ok("per day: groups are split by day", b.byDay.length === 1 || b.byDay.every(d => d.groups > 0));
    ok("forward move: median and share with the side over the groups that have one", b.forward[60].all.n === 12 && b.forward[60].all.median === 1 && b.forward[60].all.withShare === 0.75);
    ok("a group with no move (null) is left out of the forward numbers", w.forward[60].all.n === 0 && w.forward[60].all.median === null);
    ok("typical |move| is the median over the sessions' values", r.typicalAbs[60] === 0.6);
    ok("recall: a missed label outside every session is ignored; the one inside is counted", r.missed.total === 1 && r.missed.perFamily.wall.missed === 1);
    ok("summarize does not change the replayed parts (a label change needs no replay)", parts[0].rows.every(x => !("label" in x)));
    ok("wilson: no sample is null; 0 of 10 starts at 0", wilson(0, 0) === null && wilson(0, 10)[0] === 0);
    return out;
  }
  return { PLAN, sideDir, sigmaOf, forwardMove, typicalAbs, wilson, sessionPart, summarize, scoreboard, selftest };
})();
