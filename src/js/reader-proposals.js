"use strict";
// Market Reader threshold proposals: pure logic, no DOM, no timers, no clock. Self-revising Reader, Part 3b.
// A threshold sits at a percentile of the quantity it is compared with. When that quantity's distribution has drifted, the
// proposal keeps the percentile and moves the number: value = new distribution's value at the old distribution's percentile.
// Distributions come from session summaries: 6 quantiles (p5..p99) plus the 10 largest and 10 smallest values of each segment,
// which resolve the tail beyond p99 (and below p5) for rare-event thresholds.
// It also judges a replay: "safe" only when the evidence supports the change, otherwise "unproven" with the missing condition named.
const READER_PROPOSALS = (() => {
  const QP = [.05, .25, .5, .75, .95, .99];
  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const sig3 = x => Number(x.toPrecision(3));

  // items: [{q:[6 quantiles], n, hi?:[...], lo?:[...]}] -> ascending points [[value, percentile]] describing the pooled distribution
  function cdfPoints(items){
    if (!items.length) return null;
    const N = items.reduce((a, x) => a + x.n, 0), pts = [];
    for (let i = 0; i < 6; i++) pts.push([median(items.map(x => x.q[i])), QP[i]]);
    if (items.every(x => x.hi && x.hi.length && x.lo && x.lo.length)){                    // tails are only exact when every session has them
      const highCov = Math.max(...items.map(x => Math.min(...x.hi))), lowCov = Math.min(...items.map(x => Math.max(...x.lo)));
      items.flatMap(x => x.hi).filter(v => v >= highCov).sort((a, b) => b - a).forEach((v, j) => pts.push([v, 1 - (j + .5) / N]));
      items.flatMap(x => x.lo).filter(v => v <= lowCov).sort((a, b) => a - b).forEach((v, j) => pts.push([v, (j + .5) / N]));
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];                                                                          // equal values collapse to their mean percentile; percentiles never fall
    for (const p of pts){ const last = out[out.length - 1]; if (last && last[0] === p[0]){ last[1] = (last[1] * last.n + p[1]) / (last.n + 1); last.n++; } else { const q = [p[0], p[1]]; q.n = 1; out.push(q); } }
    let run = 0; for (const p of out){ if (p[1] < run) p[1] = run; run = p[1]; }
    return out;
  }
  function pctOf(pts, x){
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x < pts[i][0]){ const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return pts[pts.length - 1][1];
  }
  function valueAt(pts, p){
    if (p <= pts[0][1]) return pts[0][0];
    for (let i = 1; i < pts.length; i++) if (p <= pts[i][1]){ const a = pts[i - 1], b = pts[i]; return b[1] > a[1] ? a[0] + (b[0] - a[0]) * (p - a[1]) / (b[1] - a[1]) : b[0]; }
    return pts[pts.length - 1][0];
  }

  // link: a LINKS entry. parts: [{key, old:[items], neu:[items]}] one per venue and horizon that has data. x: the threshold now.
  // The value is the median across the parts (one threshold serves every venue and horizon). Null when nothing moves materially.
  function build(link, parts, x){
    const per = [];
    for (const part of parts){
      const o = cdfPoints(part.old), n = cdfPoints(part.neu); if (!o || !n) continue;
      const p = pctOf(o, x); per.push({key:part.key, p, value:valueAt(n, p)});
    }
    if (!per.length) return {to:null, reason:"no venue or horizon had enough data in both periods", per};
    let to = sig3(median(per.map(r => r.value))); if (link.int) to = Math.round(to);
    const change = x !== 0 ? (to - x) / Math.abs(x) : (to === 0 ? 0 : 1);
    if (Math.abs(change) < .02) return {to:null, reason:"the linked quantity moved, but not enough to change this threshold", per};
    return {to, change, large:Math.abs(change) > .5, per};
  }

  // ---- judging a replay ----
  const sum = (runs, f) => runs.reduce((a, r) => a + f(r), 0);
  const lab = runs => ({a:sum(runs, r => r.labels.a), aF:sum(runs, r => r.labels.aF), dn:sum(runs, r => r.labels.dn), dS:sum(runs, r => r.labels.dS), m:sum(runs, r => r.labels.m), mD:sum(runs, r => r.labels.mD)});
  const rate = (runs, fam) => { const h = sum(runs, r => r.hours); return h > 0 ? sum(runs, r => r.eps[fam] || 0) / h : null; };
  // base / prop: the same recordings replayed under current thresholds / the proposal. oldRates: {family: usual episodes per hour}.
  function verdict(o){
    const { proposal, base, prop, oldRates } = o, minLabels = o.minLabels || 10, minRuns = o.minRuns || 2, lb = lab(base), lp = lab(prop), conds = [];
    conds.push({k:"sessions", ok:base.length >= minRuns, text:`${base.length} recording${base.length === 1 ? "" : "s"} replayed (need ${minRuns})`});
    const nl = lb.a + lb.dn + lb.m;
    conds.push({k:"labels", ok:nl >= minLabels, text:`${nl} of your labels fall inside them (need ${minLabels})`});
    const worse = []; if (lp.aF < lb.aF) worse.push("fewer agreed episodes found"); if (lp.dS > lb.dS) worse.push("more disagreed episodes still shown"); if (lp.mD < lb.mD) worse.push("fewer missed episodes found");
    conds.push({k:"noWorse", ok:!worse.length, text:worse.length ? "worse on your labels: " + worse.join(", ") : "no label count got worse"});
    const rates = {}, bad = [], none = [];
    for (const f of proposal.families){
      const old = oldRates ? oldRates[f] : null, rb = rate(base, f), rp = rate(prop, f); rates[f] = {old, base:rb, prop:rp};
      if (old == null || rb == null || rp == null){ none.push(f); continue; }
      if (Math.abs(rp - old) > Math.abs(rb - old)) bad.push(`${f} moved away from its usual ${old.toFixed(1)}/h (${rb.toFixed(1)} -> ${rp.toFixed(1)})`);
    }
    conds.push({k:"rate", ok:!bad.length && !none.length, text:bad.length ? bad.join("; ") : none.length ? `no usual firing rate to compare for ${none.join(", ")}` : "firing rate moved toward the usual, not away"});
    conds.push({k:"after", ok:base.some(r => r.tag === "after"), text:base.some(r => r.tag === "after") ? "includes a recording from after the drift began" : "no recording from after the drift began"});
    conds.push({k:"size", ok:!proposal.large, text:proposal.large ? "a large change (over 50%)" : "a moderate change"});
    return {verdict:conds.every(c => c.ok) ? "safe" : "unproven", conds, labels:{base:lb, prop:lp}, rates};
  }
  return {cdfPoints, pctOf, valueAt, build, verdict, rate, lab, QP};
})();
