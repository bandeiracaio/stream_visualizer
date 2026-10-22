"use strict";
// Market Reader assumption register: pure logic, no DOM, no timers. Exchange timestamps only.
// Part 1 of the self-revising Reader (see .scratch/self-revising-reader/): it MEASURES, it never changes a detection.
//
// Each observable variable has, per venue, a baseline: a bounded uniform sample (reservoir) from which quantiles are read.
// A baseline is "prior" (we wrote the expectation down, too little data to replace it), "learned" (enough samples to trust
// the measurement) or "none" (no prior can be written without knowing the asset, and too little data yet).
// A session is one continuous live run (the engine ends it on reset or a data gap). Each finished session keeps a small
// quantile summary, which is what later steps compare across sessions before calling anything a drift.
// Deterministic: the sampler uses its own seeded generator, so replaying the same inputs gives the same register.
const READER_REGISTER = (() => {
  const QS = [.05, .25, .5, .75, .95, .99];
  // The first four are plumbing. The rest are the drift judge's settings (assumptions about the evidence bar) and are
  // editable; every change is written to the history with its old and new value.
  const DEFAULTS = {cap:512, minLearned:300, keepSessions:150, keepHistory:200,
    minSessionMs:600000, segmentMs:3600000, k:5, m:3, medShift:.5, widthLo:.6, widthHi:1.667, tailShift:1, minSamples:300, scalarShift:1.5, minEpisodes:3,
    // what a correct sigma looks like in the data (price progress is measured in sigmas): a random walk gives a typical |move| of 0.67
    // and tails near 1.64; real markets trend a little and progress is only sampled in busy windows, so the bands are wider (upper bounds widened from 1.0 and 2.6 after measuring BTC, ETH and DOGE). Tuned in the weekly review.
    expMedLo:.5, expMedHi:1.2, expTailLo:1.3, expTailHi:3.2};
  // version of how sigma (and so every sigma-unit variable) is measured: 14 = 75th percentile of 15 s returns (v014, ADR 0004). A file without it may be on an older scale.
  const SIGMA_SCALE = 14;
  const SETTABLE = ["k", "m", "medShift", "widthLo", "widthHi", "tailShift", "minSamples", "scalarShift", "minEpisodes", "expMedLo", "expMedHi", "expTailLo", "expTailHi", "segmentMs", "minSessionMs"];
  const FAMS = ["absorption", "exhaustion", "burst", "wall"];
  // prior: what we assumed before measuring (null when it depends on the asset). Kept as quantiles where it can be said.
  const VARS = [
    {id:"buyRate",   label:"buy aggression, fast window",       unit:"$/s",  prior:null},
    {id:"sellRate",  label:"sell aggression, fast window",      unit:"$/s",  prior:null},
    {id:"share",     label:"buyer share of aggression",         unit:"",     prior:{median:.5}},
    {id:"ret",       label:"price change over 4 buckets",       unit:"bps",  prior:{median:0}},
    {id:"depthBid",  label:"bid depth near the touch",          unit:"qty",  prior:null},
    {id:"depthAsk",  label:"ask depth near the touch",          unit:"qty",  prior:null},
    {id:"spreadBps", label:"spread",                            unit:"bps",  prior:null},
  ];
  // The quantities the detectors compare against their thresholds, measured every calibrated second per venue and horizon
  // (both sides pooled, whenever the window had enough trades to be evaluated). Fed by the episode layer; nothing reads them back.
  const QDEF = [["share","aggressor share of taker flow",""], ["z","flow rate vs normal (z)",""], ["prog","price progress with the aggressor","sigma"], ["eff","price path efficiency",""],
    ["refill","passive depth refilled",""], ["recentShare","aggressor share in the latest seconds",""], ["recentPace","pace now vs the window",""],
    ["liq","liquidations in the window","n"], ["sweeps","multi-level sweeps in the window","n"], ["crossZ","other venue's flow (z)",""],
    ["decay","aggression vs the window before",""], ["zWas","flow in the window before (z)",""], ["wasShare","dominant side's share before",""],
    ["gap","distance from the 5-minute extreme","sigma"], ["late","price progress, latest seconds","sigma"], ["sizeRatio","trade size vs the window before",""],
    ["conc","largest single trade as a share of the flow",""], ["countRatio","trade count vs the window before",""]];
  for (const hz of ["fast", "mid"]) for (const [id, label, unit] of QDEF) VARS.push({id:id + "." + hz, label:label + " (" + hz + ")", unit, prior:null, q:id, hz});
  VARS.push({id:"wallMult", label:"largest book level vs the median level", unit:"x", prior:null, q:"wallMult"});
  // What the Reader outputs: one number per session segment, venue-less ("all").
  for (const f of FAMS){
    VARS.push({id:"rate." + f, label:f + " episodes started per hour", unit:"/h", prior:null, venues:["all"], scalar:true});
    VARS.push({id:"dur." + f, label:f + " median episode length", unit:"ms", prior:null, venues:["all"], scalar:true});
  }
  VARS.push({id:"reposts.book", label:"times a live wall was refilled after being hit", unit:"n", prior:null, q:"reposts", hz:"book"});
  // Variables added after the first release draw from their own generator, so adding one never changes what an older variable's sample holds.
  const OWN_RNG = new Set(["conc", "countRatio", "reposts"]);
  const BYID = {}; for (const d of VARS) BYID[d.id] = d;
  const venuesOf = d => d.venues || ["bn", "hl"];
  // Each threshold the detectors apply, linked to the quantity it is compared with. at: "cfg" or "ep" (cfg.ep). Values are read from the live config.
  // A threshold sits at a percentile of its quantity's reference distribution; a proposal (a later step) keeps that percentile.
  const LINKS = [
    {k:"absorbShare", at:"cfg", q:"share", fams:["absorption"], label:"absorption: one side dominates at share"}, {k:"burstShare", at:"cfg", q:"share", fams:["burst"], label:"burst: one side dominates at share"},
    {k:"absorbZ", at:"cfg", q:"z", fams:["absorption"], label:"absorption: flow is intense at z"}, {k:"burstZ", at:"cfg", q:"z", fams:["burst"], label:"burst: flow is abnormal at z"},
    {k:"absorbSigma", at:"cfg", q:"prog", fams:["absorption", "exhaustion"], label:"price counts as stalled under (sigma)"}, {k:"burstSigma", at:"cfg", q:"prog", fams:["burst"], label:"price moved with a burst over (sigma)"},
    {k:"absorbEfficiency", at:"cfg", q:"eff", fams:["absorption"], label:"price path is choppy under (efficiency)"}, {k:"absorbRefill", at:"cfg", q:"refill", fams:["absorption"], label:"passive depth has refilled at"},
    {k:"recentShare", at:"ep", q:"recentShare", fams:["absorption", "burst"], label:"still happening: aggressor share in the latest seconds"}, {k:"recentPace", at:"ep", q:"recentPace", fams:["absorption", "burst"], label:"still happening: pace vs the window"},
    {k:"crossShare", at:"ep", q:"share", fams:["absorption"], label:"other venue agrees at share"}, {k:"crossZ", at:"ep", q:"crossZ", fams:["burst"], label:"other venue agrees at z"},
    {k:"burstLiq", at:"ep", q:"liq", fams:["burst"], int:true, label:"liquidations count as many at"}, {k:"burstSweeps", at:"ep", q:"sweeps", fams:["burst"], int:true, label:"sweeps count as many at"},
    {k:"exhDecay", at:"ep", q:"decay", fams:["exhaustion"], label:"aggression has faded to"}, {k:"exhWasZ", at:"ep", q:"zWas", fams:["exhaustion"], label:"it was elevated before at z"},
    {k:"exhWasShare", at:"ep", q:"wasShare", fams:["exhaustion"], label:"it was the dominant side before at share"}, {k:"exhGap", at:"ep", q:"gap", fams:["exhaustion"], label:"near the 5-minute extreme within (sigma)"},
    {k:"exhSize", at:"ep", q:"sizeRatio", fams:["exhaustion"], label:"trade size is shrinking under"}, {k:"wallRatio", at:"cfg", q:"wallMult", fams:["wall"], label:"a wall is big at (x median level)"},
    {k:"absConc", at:"ep", q:"conc", fams:["absorption"], label:"absorption: flow is spread over many fills (largest trade under)"}, {k:"exhCount", at:"ep", q:"countRatio", fams:["exhaustion"], label:"exhaustion: trade count has fallen to"},
    {k:"wallReposts", at:"ep", q:"reposts", fams:["wall"], int:true, label:"a wall counts as refilled after this many re-posts"},
  ];
  const TAILN = 10, KEEP_TAILS = 60, KEEP_PROPOSALS = 60, EXPIRE_MS = 30 * 86400000;
  const keyOf = (vn, id) => vn + "|" + id;
  const finite = x => typeof x === "number" && isFinite(x);

  function quantiles(res){
    if (!res.length) return null;
    const s = res.slice().sort((a, b) => a - b), n = s.length;
    return QS.map(q => s[Math.min(n - 1, Math.floor(q * n))]);
  }
  function newCell(){ return {n:0, res:[]}; }

  function create(options, state){
    const cfg = Object.assign({}, DEFAULTS, options || {});
    let seed = 20240607, cum = {}, cumOk = {}, cur = null, sessions = [], history = [], run = null, proposals = [], approvals = [], overrides = {}, epoch = 0, seed2 = 1013904223, scaleOk = true;   // scaleOk: false for a loaded file that does not carry the current sigma scale (ADR 0004)
    const rand2 = () => (seed2 = (Math.imul(seed2, 1664525) + 1013904223) >>> 0) / 4294967296;
    const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    function put(cell, x, rnd){
      cell.n++;
      if (cell.res.length < cfg.cap) cell.res.push(x);
      else { const j = Math.floor((rnd || rand)() * cell.n); if (j < cfg.cap) cell.res[j] = x; }
    }
    function observe(t, vn, vals){
      if (!(t > 0)) return;
      if (cur && t - cur.start >= cfg.segmentMs) finalize(true);       // long runs are cut into segments; each one is a vote
      if (!cur) cur = {id:t, start:t, end:t, run:run == null ? (run = t) : run, cells:{}, fire:{}};
      cur.end = t;
      for (const id in vals){
        const x = vals[id]; if (!finite(x) || !BYID[id]) continue;
        const k = keyOf(vn, id);
        const rnd = OWN_RNG.has(BYID[id].q) ? rand2 : rand;
        put(cum[k] || (cum[k] = newCell()), x, rnd);
        const cc = cur.cells[k] || (cur.cells[k] = newCell());
        put(cc, x, rnd);
        if (BYID[id].q) tail(cc, x);
      }
    }
    // the largest and smallest few values of a segment: they place a threshold beyond the stored quantiles (p99 and above)
    function tail(cell, x){
      const hi = cell.hi || (cell.hi = []), lo = cell.lo || (cell.lo = []);
      if (hi.length < TAILN || x > hi[0]){ hi.push(x); hi.sort((a, b) => a - b); if (hi.length > TAILN) hi.shift(); }
      if (lo.length < TAILN || x < lo[lo.length - 1]){ lo.push(x); lo.sort((a, b) => a - b); if (lo.length > TAILN) lo.pop(); }
    }
    const rnd = x => Number(x.toPrecision(6));
    // the engine tells the register when an episode starts or ends; a segment keeps how many started and how long the ended ones lasted
    function noteEpisode(family, change, lengthMs){
      if (!cur || !FAMS.includes(family)) return;
      const f = cur.fire[family] || (cur.fire[family] = {n:0, durs:[]});
      if (change === "started") f.n++; else if (change === "ended" && finite(lengthMs) && lengthMs >= 0) f.durs.push(lengthMs);
    }
    function finalize(keepRun){
      if (!cur) return null;
      const sum = {};
      for (const k in cur.cells){ const c = cur.cells[k]; sum[k] = {n:c.n, q:quantiles(c.res).map(rnd)}; if (c.hi && c.lo){ sum[k].hi = c.hi.map(rnd); sum[k].lo = c.lo.map(rnd); } }
      const hours = (cur.end - cur.start) / 3600000;
      if (hours > 0) for (const f of FAMS){
        const x = cur.fire && cur.fire[f] || {n:0, durs:[]};
        sum["all|rate." + f] = {n:x.n, v:rnd(x.n / hours)};
        if (x.durs.length){ const d = x.durs.slice().sort((a, b) => a - b), m = d.length >> 1; sum["all|dur." + f] = {n:d.length, v:rnd(d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2)}; }
      }
      const counted = cur.end - cur.start >= cfg.minSessionMs;
      if (counted) poolCounted(cur.cells);
      const d = new Date(cur.start);
      const s = {id:cur.id, start:cur.start, end:cur.end, run:cur.run, hour:d.getUTCHours(), dow:d.getUTCDay(), durationMs:cur.end - cur.start, counts:cur.end - cur.start >= cfg.minSessionMs, sum};
      if (cur.mixed && cur.mixed.length) s.mixed = cur.mixed;
      cur = null; if (!keepRun) run = null;
      if (s.durationMs > 0){
        sessions.push(s); if (sessions.length > cfg.keepSessions) sessions.shift();
        for (let i = 0; i < sessions.length - KEEP_TAILS; i++) for (const k in sessions[i].sum){ delete sessions[i].sum[k].hi; delete sessions[i].sum[k].lo; }
        noteDrifts(); return s;
      }
      return null;
    }
    // price progress from sessions that count only (the static expectation must not be set off by a 3-minute test or simulator run).
    // Pure hash instead of the shared random generators, so the sampling of every other cell stays as it was.
    function poolCounted(cells){
      for (const k in cells){ if (!k.includes("|prog.")) continue;
        const c = cumOk[k] || (cumOk[k] = newCell());
        for (const x of cells[k].res) put(c, x, () => ((c.n * 2654435761) >>> 0) / 4294967296);
      }
    }
    const endSession = () => finalize(false);
    const allKeys = () => { const k = []; for (const d of VARS) for (const vn of venuesOf(d)) k.push(keyOf(vn, d.id)); return k; };
    const priors = () => { const o = {}; for (const d of VARS) if (d.prior) for (const vn of venuesOf(d)) o[keyOf(vn, d.id)] = d.prior; return o; };
    const undoneSet = () => new Set(history.filter(h => h.type === "drift" && h.undone).map(h => h.id));
    const push = h => { history.push(h); if (history.length > cfg.keepHistory) history.shift(); };
    // drifts the judge confirms are written to the history once; the user then acknowledges or undoes them
    function noteDrifts(){
      const ev = READER_DRIFT.evaluate(sessions, cfg, allKeys(), {undone:undoneSet(), priors:priors()});
      const fresh = [];
      for (const k in ev) for (const c of ev[k].confs) if (!history.some(h => h.id === c.id)){
        const h = {type:"drift", id:c.id, key:c.key, at:c.at, from:c.from, sessions:c.sessions, reasons:c.reasons, acked:false, undone:false}; push(h); fresh.push(h);
      }
      for (const h of fresh){
        const a = followsApproval(h);
        if (a){ h.followsApproval = a.id; h.note = "Follows your approval of " + a.k + " (" + a.from + " → " + a.to + "), so it was expected; no proposals were made."; continue; }
        proposeFor(h);
      }
    }
    function followsApproval(d){
      if (!/^all\|(rate|dur)\./.test(d.key)) return null;
      const fam = d.key.split(".")[1], ref = sessions.filter(s => s.id < d.from && s.durationMs >= cfg.minSessionMs && s.sum[d.key]).slice(-cfg.k);
      return approvals.find(a => a.status === "approved" && a.families.includes(fam) && a.at <= d.from && ref.some(s => s.start < a.at)) || null;
    }

    // ---- threshold proposals (a confirmed drift in a linked quantity, or in a family's firing rate) ----
    const counted = s => s.durationMs >= cfg.minSessionMs;
    const itemsFor = (key, list) => list.filter(s => counted(s) && s.sum[key] && s.sum[key].q && s.sum[key].n >= cfg.minSamples).map(s => ({q:s.sum[key].q, n:s.sum[key].n, hi:s.sum[key].hi, lo:s.sum[key].lo}));
    function partsFor(link, from, newIds){
      const parts = [];
      for (const def of VARS) if (def.q === link.q) for (const vn of ["bn", "hl"]){
        const key = keyOf(vn, def.id), old = itemsFor(key, sessions.filter(s => s.id < from)).slice(-cfg.k), neu = itemsFor(key, sessions.filter(s => newIds.has(s.id)));
        if (old.length >= 3 && neu.length >= 1) parts.push({key, old, neu});
      }
      return parts;
    }
    const threshold = link => cfg.getThreshold ? cfg.getThreshold(link) : null;
    const sig3 = x => Number(x.toPrecision(3));
    function proposeFor(d){
      const fam = /^all\|(rate|dur)\./.test(d.key) ? d.key.split(".")[1] : null, def = BYID[d.key.split("|")[1]];
      const links = fam ? LINKS.filter(l => l.fams.includes(fam)) : def && def.q ? LINKS.filter(l => l.q === def.q) : [];
      if (!links.length) return;
      const newIds = new Set(d.sessions); let made = 0;
      for (const link of links){
        const id = link.k + "@" + d.id; if (proposals.some(p => p.id === id)) continue;
        const x = threshold(link); if (!finite(x)) continue;
        const r = READER_PROPOSALS.build(link, partsFor(link, d.from, newIds), x); if (r.to == null) continue;
        for (const p of proposals) if (p.k === link.k && p.status === "pending") p.status = "superseded";
        proposals.push({id, k:link.k, at:link.at, q:link.q, label:link.label, families:link.fams, from:x, to:r.to, change:r.change, large:r.large, provisional:true, rev:0, driftId:d.id, driftKey:d.key, driftFrom:d.from, driftAt:d.at,
          createdAt:d.at, status:"pending", reason:"", per:r.per.map(q => ({key:q.key, p:+q.p.toFixed(4), value:sig3(q.value)}))});
        made++;
      }
      while (proposals.length > KEEP_PROPOSALS) proposals.shift();
      if (!made) d.note = fam ? "The firing rate changed, but the quantities behind its thresholds did not move enough to propose a change. That points at structure, for the weekly review." : "No linked threshold moves enough to propose a change.";
    }
    function recompute(id){
      const p = proposals.find(x => x.id === id && x.status === "pending"); if (!p) return false;
      const link = LINKS.find(l => l.k === p.k), x = link && threshold(link); if (!link || !finite(x)) return false;
      const used = sessions.filter(s => s.id >= p.driftFrom && counted(s)).slice(0, cfg.k), r = READER_PROPOSALS.build(link, partsFor(link, p.driftFrom, new Set(used.map(s => s.id))), x);
      if (r.to == null){ p.note = r.reason; return false; }
      Object.assign(p, {from:x, to:r.to, change:r.change, large:r.large, rev:(p.rev || 0) + 1, provisional:used.length < cfg.k, note:"", per:r.per.map(q => ({key:q.key, p:+q.p.toFixed(4), value:sig3(q.value)}))});
      return true;
    }
    function reject(id, reason){ const p = proposals.find(x => x.id === id && x.status === "pending"); if (!p) return false; p.status = "rejected"; p.reason = String(reason || "").slice(0, 200); return true; }
    // the usual episodes per hour of each family in the period before the drift (what a replay of the proposal should move toward)
    function oldRates(id){
      const p = proposals.find(x => x.id === id); if (!p) return {};
      const out = {}, before = sessions.filter(s => s.id < p.driftFrom && counted(s));
      for (const f of p.families){ const v = before.filter(s => s.sum["all|rate." + f]).slice(-cfg.k).map(s => s.sum["all|rate." + f].v); if (v.length >= 3) out[f] = READER_DRIFT.refOf(v.map(x => [x, x, x, x, x, x]))[2]; }
      return out;
    }
    // ---- approval: an accepted proposal becomes a local override of the built-in threshold ----
    const engineNow = () => cur ? cur.end : sessions.length ? sessions[sessions.length - 1].end : 0;
    const builtIn = link => cfg.getDefault ? cfg.getDefault(link) : null;
    function recordApproval(a){
      approvals.push(Object.assign({status:"approved"}, a)); if (approvals.length > 200) approvals.shift();
      push({type:"approval", id:a.id, k:a.k, from:a.from, to:a.to, at:a.at, group:a.group || null});
      if (cur) cur.mixed = Array.from(new Set((cur.mixed || []).concat(a.families)));
    }
    function approve(ids, o){
      o = o || {}; const done = [];
      for (const id of ids){
        const p = proposals.find(x => x.id === id && x.status === "pending"), link = p && LINKS.find(l => l.k === p.k); if (!link) continue;
        p.status = "approved"; p.approvedAt = o.time || engineNow(); p.group = o.group || null;
        overrides[p.k] = {value:p.to, builtIn:builtIn(link), at:p.approvedAt, id:p.id, group:p.group};
        recordApproval({id:p.id, k:p.k, families:p.families, from:p.from, to:p.to, at:p.approvedAt, group:p.group});
        done.push(p);
      }
      if (done.length) epoch++;
      return done;
    }
    function resetOverride(k, reason){
      const o = overrides[k], link = LINKS.find(l => l.k === k); if (!o || !link) return null;
      const to = builtIn(link), at = engineNow();
      delete overrides[k]; for (const a of approvals) if (a.id === o.id) a.status = "reverted";
      push({type:"revert", k, of:o.id, from:o.value, to, at, reason:String(reason || "").slice(0, 200)}); epoch++;
      return {k, at:link.at, of:o.id, from:o.value, to, reason:String(reason || "").slice(0, 200), time:at};
    }
    // overrides that already equal the built-in default (after a release folded them in) are redundant
    function settleOverrides(){
      const gone = [];
      for (const k in overrides){ const link = LINKS.find(l => l.k === k), d = link && builtIn(link); if (!link){ delete overrides[k]; continue; } if (finite(d) && Math.abs(d - overrides[k].value) < 1e-9){ delete overrides[k]; gone.push(k); } }
      return gone;
    }
    // overrides carried in from another device's export: only applied after the user agrees
    function applyOverrides(map){
      const done = [];
      for (const k in map){ const link = LINKS.find(l => l.k === k), o = map[k]; if (!link || !o || !finite(o.value)) continue; overrides[k] = {value:o.value, builtIn:builtIn(link), at:o.at || 0, id:o.id || "import", group:o.group || null, imported:true}; done.push(k); }
      if (done.length){ push({type:"import", keys:done, at:engineNow()}); epoch++; }
      return done;
    }
    // Static expectations: a baseline can be wrong from day one, which a drift check never sees. Price progress is in sigma units, so if
    // sigma is right its distribution has a known shape. Evaluated on everything seen so far, once there is enough of it.
    function expectations(){
      const out = [], med = a => { const x = a.slice().sort((u, v) => u - v), n = x.length; return n % 2 ? x[n >> 1] : (x[n / 2 - 1] + x[n / 2]) / 2; };
      for (const d of VARS) if (d.q === "prog") for (const vn of ["bn", "hl"]){
        const key = keyOf(vn, d.id), base = cumOk[key], live = cur && cur.end - cur.start >= cfg.minSessionMs && cur.cells[key];
        const c = base || live ? {n:(base ? base.n : 0) + (live ? live.n : 0), res:(base ? base.res : []).concat(live ? live.res : [])} : null;
        if (!c || c.n < cfg.minLearned){ out.push({key, n:c ? c.n : 0, ready:false, ok:true, reasons:[]}); continue; }
        const q = quantiles(c.res), medAbs = med(c.res.map(Math.abs)), tail = (Math.abs(q[0]) + Math.abs(q[4])) / 2, reasons = [];
        if (medAbs < cfg.expMedLo || medAbs > cfg.expMedHi) reasons.push("a typical move is " + medAbs.toFixed(2) + " sigma (expected " + cfg.expMedLo + " to " + cfg.expMedHi + ")");
        if (tail < cfg.expTailLo || tail > cfg.expTailHi) reasons.push("the 5th and 95th percentiles sit at about ±" + tail.toFixed(2) + " sigma (expected " + cfg.expTailLo + " to " + cfg.expTailHi + ")");
        out.push({key, n:c.n, ready:true, medAbs, tail, ok:!reasons.length, reasons});
      }
      return out;
    }
    function expire(){
      const latest = sessions.length ? sessions[sessions.length - 1].end : 0;
      for (const p of proposals) if (p.status === "pending" && latest - p.createdAt > EXPIRE_MS) p.status = "expired";
    }
    // the judgement for every variable now, plus a non-voting preview of the running segment
    function review(){
      const cq = {}; if (cur) for (const k in cur.cells) if (cur.cells[k].n >= 30) cq[k] = quantiles(cur.cells[k].res);
      const ev = READER_DRIFT.evaluate(sessions, cfg, allKeys(), {undone:undoneSet(), priors:priors(), cur:cq});
      expire();
      return {keys:ev, history, proposals, expectations:expectations(), scale:{ok:scaleOk, current:SIGMA_SCALE}, unacked:history.filter(h => h.type === "drift" && !h.acked && !h.undone).length};
    }
    function ack(id){ const h = history.find(x => x.id === id && x.type === "drift"); if (h) h.acked = true; return !!h; }
    function undo(id){ const h = history.find(x => x.id === id && x.type === "drift"); if (!h || h.undone) return false; h.undone = true; h.acked = true; for (const p of proposals) if (p.driftId === id && p.status === "pending") p.status = "withdrawn"; noteDrifts(); return true; }
    function setSetting(key, value, at){
      const v = Number(value); if (!SETTABLE.includes(key) || !(v > 0) || !isFinite(v)) return false;
      const to = (key === "k" || key === "m" || key === "minSamples" || key === "minEpisodes") ? Math.round(v) : v, from = cfg[key];
      if (to === from) return true;
      cfg[key] = to; push({type:"setting", key, from, to, at:at || 0}); return true;
    }
    function status(vn, id){
      const c = cum[keyOf(vn, id)], d = VARS.find(x => x.id === id), n = c ? c.n : 0;
      return n >= cfg.minLearned ? "learned" : d && d.prior ? "prior" : "none";
    }
    // compact view: what each baseline currently says (also what a recording embeds)
    function snapshot(){
      const out = {v:1, qs:QS, minLearned:cfg.minLearned, vars:{}};
      for (const vn of ["bn", "hl"]) for (const d of VARS){
        const c = cum[keyOf(vn, d.id)], st = status(vn, d.id);
        if (!c && !d.prior) continue;
        out.vars[keyOf(vn, d.id)] = {n:c ? c.n : 0, status:st, q:c ? quantiles(c.res) : null, prior:d.prior || null};
      }
      return out;
    }
    // full state: includes the samples, so it can be restored and keep learning
    function save(){ const settings = {}; for (const k of SETTABLE) settings[k] = cfg[k]; return {v:1, sigmaScale:scaleOk ? SIGMA_SCALE : undefined, seed, seed2, cum, cumOk, cur, sessions, history, settings, proposals, approvals, overrides, epoch}; }
    function load(s){
      if (!s || s.v !== 1 || typeof s.cum !== "object") return false;
      const ok = c => c && Array.isArray(c.res) && finite(c.n) && c.res.every(finite);
      const tl = a => Array.isArray(a) && a.length <= TAILN && a.every(finite) ? a.slice() : undefined;
      const clean = o => { const r = {}; for (const k in o) if (ok(o[k])){ r[k] = {n:o[k].n, res:o[k].res.slice(0, cfg.cap)}; const hi = tl(o[k].hi), lo = tl(o[k].lo); if (hi && lo){ r[k].hi = hi; r[k].lo = lo; } } return r; };
      if (s.settings) for (const k of SETTABLE) if (finite(s.settings[k]) && s.settings[k] > 0) cfg[k] = s.settings[k];
      cum = clean(s.cum); cumOk = s.cumOk && typeof s.cumOk === "object" ? clean(s.cumOk) : {}; cur = null; run = null;
      sessions = Array.isArray(s.sessions) ? s.sessions.filter(x => x && finite(x.id) && finite(x.start) && finite(x.end) && x.sum).slice(-cfg.keepSessions).map(x => { const d = new Date(x.start); return Object.assign({run:x.id, hour:d.getUTCHours(), dow:d.getUTCDay(), durationMs:x.end - x.start}, x); }) : [];
      history = Array.isArray(s.history) ? s.history.filter(h => h && ["drift", "setting", "approval", "revert", "import"].includes(h.type)).slice(-cfg.keepHistory) : [];
      approvals = Array.isArray(s.approvals) ? s.approvals.filter(a => a && typeof a.id === "string" && typeof a.k === "string" && Array.isArray(a.families) && finite(a.at)).slice(-200) : [];
      if (s.overrides && typeof s.overrides === "object") { overrides = {}; for (const k in s.overrides){ const o = s.overrides[k]; if (LINKS.some(l => l.k === k) && o && finite(o.value)) overrides[k] = {value:o.value, builtIn:finite(o.builtIn) ? o.builtIn : null, at:finite(o.at) ? o.at : 0, id:String(o.id || ""), group:o.group || null}; } }
      if (finite(s.epoch)) epoch = s.epoch;
      proposals = Array.isArray(s.proposals) ? s.proposals.filter(x => x && typeof x.id === "string" && typeof x.k === "string" && finite(x.to) && finite(x.from) && Array.isArray(x.families)).slice(-KEEP_PROPOSALS) : [];
      if (finite(s.seed)) seed = s.seed >>> 0;
      if (finite(s.seed2)) seed2 = s.seed2 >>> 0;
      scaleOk = s.sigmaScale === SIGMA_SCALE || (!Object.keys(cum).length && !sessions.length);
      if (s.cur && finite(s.cur.start) && s.cur.cells){ cur = {id:s.cur.id, start:s.cur.start, end:s.cur.end, run:finite(s.cur.run) ? s.cur.run : s.cur.id, cells:clean(s.cur.cells), fire:s.cur.fire && typeof s.cur.fire === "object" ? s.cur.fire : {}, mixed:Array.isArray(s.cur.mixed) ? s.cur.mixed.filter(f => FAMS.includes(f)) : []}; endSession(); }   // a run that was cut by closing the page
      return true;
    }
    function reset(){ cum = {}; cumOk = {}; cur = null; sessions = []; history = []; proposals = []; approvals = []; overrides = {}; epoch = 0; run = null; seed = 20240607; seed2 = 1013904223; scaleOk = true; }
    function confirmScale(){ scaleOk = true; }
    function claims(engineCfg){ return LINKS.map(c => ({q:c.q, k:c.k, label:c.label, value:c.at === "ep" ? (engineCfg.ep || {})[c.k] : engineCfg[c.k]})); }
    const api = {cfg, confirmScale, observe, noteEpisode, endSession, snapshot, save, load, reset, status, claims, review, expectations, ack, undo, setSetting, recompute, reject, oldRates, approve, resetOverride, settleOverrides, applyOverrides, recordApproval, vars:VARS,
      get sessions(){ return sessions; }, get proposals(){ return proposals; }, get overrides(){ return overrides; }, get approvals(){ return approvals; }, get epoch(){ return epoch; }, get history(){ return history; }, get active(){ return !!cur; }};
    if (state) load(state);
    return api;
  }
  return {create, quantiles, DEFAULTS, SETTABLE, VARS, LINKS, FAMS, QS};
})();
