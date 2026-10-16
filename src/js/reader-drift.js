"use strict";
// Market Reader drift judge: pure logic, no DOM, no timers, no clock. Self-revising Reader, Parts 2 and 3a.
// Input: the register's finished session summaries. Output: for each variable, whether its behaviour has drifted from a
// frozen reference, and the evidence for it. It never touches a detection.
//
// Two kinds of variable:
//  - a distribution (6 quantiles per session): a session differs if its median moved more than medShift IQRs, its spread
//    changed outside [widthLo, widthHi], or a tail (p5 / p95) moved more than tailShift IQRs. IQR is the reference's own.
//  - a scalar (one number per session: episodes per hour, median episode duration; keys start with "all|"): a session
//    differs if it is more than scalarShift units from the reference median, where the unit is the reference IQR but never
//    less than a quarter of the median (and at least 1), since five numbers give a crude IQR.
// Rules (agreed in the grilling session):
//  - Unit of evidence is the session segment, not the second (consecutive seconds are strongly correlated).
//  - Reference = the K counted sessions just before the candidate (frozen while a possible drift is building).
//  - M differing sessions in a row confirm a drift. The reference then restarts from those sessions (baselines follow the
//    market without waiting for approval) and needs K sessions again before anything else can be judged.
//  - A confirmation the user undid is dropped: its sessions are treated as an anomaly and removed from the evidence.
const READER_DRIFT = (() => {
  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const quart = (a, f) => { const s = a.slice().sort((x, y) => x - y), i = f * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const refOf = list => [0, 1, 2, 3, 4, 5].map(i => median(list.map(q => q[i])));
  const fx = x => (Math.round(x * 100) / 100).toFixed(2);
  const isScalar = key => key.startsWith("all|");

  function effect(q, r, S){
    const iqr = r[3] - r[1], unit = Math.max(iqr, .05 * Math.abs(r[2]), 1e-9);
    const med = (q[2] - r[2]) / unit, width = (q[3] - q[1]) / unit, tail = Math.max(Math.abs(q[0] - r[0]), Math.abs(q[4] - r[4])) / unit;
    const reasons = [];
    if (Math.abs(med) > S.medShift) reasons.push(`median moved ${fx(med)} IQR`);
    if (width < S.widthLo || width > S.widthHi) reasons.push(`spread x${fx(width)}`);
    if (tail > S.tailShift) reasons.push(`tail moved ${fx(tail)} IQR`);
    return {med, width, tail, drifted:reasons.length > 0, reasons};
  }
  function scalarRef(vals){ const m = median(vals), iqr = quart(vals, .75) - quart(vals, .25); return {m, iqr, unit:Math.max(iqr, .25 * Math.abs(m), 1)}; }
  function scalarEffect(v, r, S){
    const med = (v - r.m) / r.unit, drifted = Math.abs(med) > S.scalarShift;
    return {med, width:1, tail:0, drifted, reasons:drifted ? [`${fx(v)} vs ${fx(r.m)} usual (${fx(med)} units)`] : []};
  }

  // The streak walk, shared by both kinds. seq: eligible sessions ascending; refFn(items) -> reference; effFn(item, ref) -> effect.
  function walk(key, seq, S, undone, refFn, effFn){
    const confs = []; let base = 0, i = S.k, s = i, streak = 0;
    while (i < seq.length){
      const ref = refFn(seq.slice(s - S.k, s)), e = effFn(seq[i], ref);
      seq[i].eff = e;
      if (!e.drifted){ streak = 0; i++; s = i; continue; }
      if (!streak) s = i;
      streak++;
      if (streak < S.m){ i++; continue; }
      const id = key + "@" + seq[s].id;
      if (undone.has(id)){ seq.splice(s, i - s + 1); i = s; streak = 0; continue; }          // an anomaly the user dismissed
      confs.push({id, key, at:seq[i].end, from:seq[s].id, sessions:seq.slice(s, i + 1).map(x => x.id), reasons:e.reasons});
      base = s; i = base + S.k; s = i; streak = 0;
    }
    const building = seq.length - base < S.k;
    return {confs, streak, building, have:Math.min(seq.length - base, S.k), ref:building ? null : refFn(seq.slice(s - S.k, s)), refStart:s - S.k};
  }
  const meta = x => ({id:x.id, start:x.start, end:x.end, run:x.run != null ? x.run : x.id, hour:x.hour, dow:x.dow});

  // key like "bn|share.fast". Returns the judgement for one variable.
  function judge(key, sessions, S, undone, prior, cur){
    const scalar = isScalar(key), minN = key.includes("|dur.") ? S.minEpisodes : scalar ? 0 : S.minSamples;
    const fam = scalar ? key.split(".")[1] : null;
    const seq = sessions.filter(s => !(fam && s.mixed && s.mixed.includes(fam)) && s.durationMs >= S.minSessionMs && s.sum && s.sum[key] && s.sum[key].n >= minN && (scalar ? isFinite(s.sum[key].v) : s.sum[key].q))
      .map(s => Object.assign(meta(s), scalar ? {v:s.sum[key].v} : {q:s.sum[key].q, n:s.sum[key].n}));
    const w = scalar ? walk(key, seq, S, undone, items => scalarRef(items.map(x => x.v)), (x, r) => scalarEffect(x.v, r, S))
                     : walk(key, seq, S, undone, items => refOf(items.map(x => x.q)), (x, r) => effect(x.q, r, S));
    const refQ = !scalar ? w.ref : null, unit = refQ ? Math.max(refQ[3] - refQ[1], .05 * Math.abs(refQ[2]), 1e-9) : 0;
    const priorGap = prior && refQ ? (refQ[2] - prior.median) / unit : null;
    return {
      key, scalar, state:w.building ? "building" : w.streak ? "watching" : "ok", refN:w.have, need:S.k, streak:w.streak, m:S.m, refQ, refV:scalar ? w.ref : null,
      points:seq.slice(-12).map((x, j, arr) => Object.assign(meta(x), scalar ? {v:x.v} : {q:x.q}, {eff:x.eff || null})),
      preview:!scalar && cur && refQ ? Object.assign({q:cur}, effect(cur, refQ, S)) : null,
      priorGap, priorOff:priorGap != null && Math.abs(priorGap) > S.medShift, confs:w.confs,
    };
  }
  // Orders by id and judges every key. priors: {key: {median}}. undone: Set of confirmation ids. cur: {key: quantiles} of the running segment.
  function evaluate(sessions, S, keys, o){
    o = o || {}; const list = sessions.slice().sort((a, b) => a.id - b.id), undone = o.undone || new Set(), out = {};
    for (const k of keys) out[k] = judge(k, list, S, undone, (o.priors || {})[k], (o.cur || {})[k]);
    return out;
  }
  return {evaluate, judge, effect, scalarEffect, refOf, isScalar};
})();
