"use strict";
// Market Reader episodes: pure logic, no DOM, no timers. Driven by the engine's one-second tick.
//
// An episode is one phenomenon with a lifecycle: forming -> active -> fading -> ended, and it can resume.
// Each family scores a weighted evidence checklist (several variables, never one). Gate items must all hold.
// Hysteresis: it starts when gate+score >= enterScore for enterHoldMs, fades when it drops under exitScore,
// and ends after endHoldMs under it. The start time is back-dated to the first moment the evidence was building
// (formScore), so "when it began" is not just "when it was confirmed". If the same thing returns within
// resumeMs of ending, it is the same episode, resumed (pulses + 1).
// Language is neutral: who is the aggressor, who is passive, what price did. No bull/bear.
const READER_EPISODES = (() => {
  const DEFAULTS = {
    enterScore:.7, formScore:.5, exitScore:.45, enterHoldMs:2000, endHoldMs:4000, resumeMs:20000,
    keepEpisodes:300, wallFadeFrac:.6, wallStaleMs:30000, wallEpisodeMs:60000, wallMinMult:1.5, keepWalls:300, wallMaxActive:2, wallMergeBps:6, wallMergeMs:90000, wallMinUsd:0, minTradesFast:5, minTradesMid:12, refreshMs:10000, pokeMs:30000, traceCap:240,
    horizons:["fast","mid"], famHorizons:{exhaustion:["mid"]}, families:{absorption:true, exhaustion:true, burst:true, wall:true},
    // evidence cut-offs that used to be written inline; now named so they can be measured and proposed for revision
    recentShare:.55, recentPace:.5, crossShare:.6, crossZ:2, burstLiq:2, burstSweeps:3,
    exhDecay:.5, exhWasZ:1.5, exhWasShare:.55, exhGap:1, exhSize:.75,
    // after-the-fact layers: what price did after an episode faded, and how far apart episodes may be to count as one phenomenon
    absConc:.2, exhCount:.5, wallReposts:2, wallDip:.7, wallBack:.9,
    outcomeLookMs:30000, outcomeFlatSigma:.5, groupGapMs:10000,
  };
  const FAMILY_LABEL = {absorption:"Absorption", exhaustion:"Exhaustion", burst:"Aggression burst", wall:"Wall"};
  const clamp = (x,lo,hi) => Math.min(hi, Math.max(lo,x));
  const clamp01 = x => clamp(x,0,1);
  const money = x => x>=1e6 ? (x/1e6).toFixed(1)+"M" : x>=1e3 ? Math.round(x/1e3)+"k" : x.toFixed(0);
  const pct = x => Math.round(x*100)+"%";
  const zf = z => (Math.round(z*10)/10+0).toFixed(1);
  const sgn = (x,d) => (x>=0?"+":"-")+Math.abs(x).toFixed(d==null?1:d);
  const other = vn => vn==="bn" ? "hl" : "bn";
  const opp = s => s==="buy" ? "sell" : "buy";
  const who = s => s==="buy" ? "buyers" : "sellers";
  const moved = (side, p) => ((side==="buy") === (p >= 0) ? "up " : "down ")+Math.abs(p).toFixed(1)+"σ";   // progress is signed relative to the aggressor

  function create(ctx){
    const cfg = ctx.cfg, E = () => cfg.ep;
    let episodes = [], tracks = new Map(), walls = new Map(), pend = [], seq = 0, refresh = {bn:{buy:0,sell:0}, hl:{buy:0,sell:0}};
    const listeners = [];
    const notify = (ep, change) => { for (const fn of listeners) try{ fn(ep, change); }catch(err){} };

    // Aggregate ring buckets [len-offset-count, len-offset): the same sums horizon() makes, for a window that ended earlier.
    function agg(vn, count, offset){
      const r = ctx.venue(vn).ring, end = r.length-offset, start = end-count;
      if (count < 1 || start < 0) return null;
      const a = {buy:0, sell:0, n:0, hi:-Infinity, lo:Infinity, open:null, close:null, liqBuyN:0, liqSellN:0, sweepBuyN:0, sweepSellN:0};
      for (let i = start; i < end; i++){
        const b = r[i]; a.buy += b.buy; a.sell += b.sell; a.n += b.n; a.liqBuyN += b.liqBuyN; a.liqSellN += b.liqSellN; a.sweepBuyN += b.sweepBuyN; a.sweepSellN += b.sweepSellN;
        if (b.hi != null){ if (b.hi > a.hi) a.hi = b.hi; if (b.lo < a.lo) a.lo = b.lo; if (a.open == null) a.open = b.open; a.close = b.close; }
      }
      return a.open == null ? null : a;
    }
    const minTrades = hz => hz==="fast" ? E().minTradesFast : E().minTradesMid;
    // price progress in the aggressor's direction, in units of normal movement over the window (negative: price went the other way)
    const progress = (vn, h, side) => (side==="buy"?1:-1) * (h.close/h.open-1) * 1e4 / (ctx.sigmaBps(vn)*Math.sqrt(h.ms/1000));
    // Is it still going on? Looks only at the latest quarter of the window, so a stretched window (slow market) cannot keep an old surge alive.
    function recent(vn, h, side, rate){
      const q = clamp(Math.round(h.ms/cfg.bucketMs/4), 4, 32), r = agg(vn, q, 0);   // at most the last 8 s
      if (!r || !(r.buy+r.sell > 0)) return {ok:false, val:"no trades"};
      const share = (side==="buy" ? r.buy : r.sell)/(r.buy+r.sell), now = (side==="buy" ? r.buy : r.sell)/(q*cfg.bucketMs/1000);
      return {ok: share >= E().recentShare && now >= E().recentPace*rate, val: pct(share)+", "+(rate > 0 ? pct(now/rate) : "-")+" of pace", share, pace: rate > 0 ? now/rate : null};
    }
    const item = (k, label, ok, w, val, gate) => ({k, label, ok:!!ok, w, val, gate:!!gate});
    const na = (k, label) => ({k, label, ok:false, w:0, val:"n/a", na:true});

    function scoreOf(items){
      let w = 0, s = 0, gate = true;
      for (const it of items){ if (it.na) continue; w += it.w; if (it.ok) s += it.w; if (it.gate && !it.ok) gate = false; }
      return {score: w ? s/w : 0, gate};
    }

    // ---- absorption: aggressors keep hitting one side, price makes no progress, the passive side holds or refills ----
    function evalAbsorption(vn, hz, side, t){
      const h = ctx.horizon(vn, hz);
      if (!h || h.n < minTrades(hz) || !(h.open > 0) || !(h.buy+h.sell > 0)) return null;
      const v = ctx.venue(vn), secs = h.ms/1000, share = side==="buy" ? h.share : 1-h.share, rate = (side==="buy" ? h.buy : h.sell)/secs;
      const z = ctx.robustZ(rate, vn, side, 1), prog = progress(vn, h, side), count = Math.round(h.ms/cfg.bucketMs), r = v.ring.slice(-count);
      let path = 0; for (let i = 1; i < r.length; i++) if (r[i-1].close > 0 && r[i].close > 0) path += Math.abs(r[i].close/r[i-1].close-1);
      const eff = path > 0 ? Math.abs(h.close/h.open-1)/path : 0;
      const dSide = side==="sell" ? "bid" : "ask", start = r.length ? r[0][dSide+"Depth"] : 0, refill = start > 0 ? v.depth[dSide]/start : null;
      const w = ctx.walletEvidence(vn, side, t-h.ms), oh = ctx.horizon(other(vn), hz);
      const oShare = oh ? (side==="buy" ? oh.share : 1-oh.share) : null, oProg = oh && oh.open > 0 ? progress(other(vn), oh, side) : null;
      const rc = recent(vn, h, side, rate), conc = h.maxTrade/(h.buy+h.sell);   // the largest single trade's share of the window's flow (either side): low = many small fills
      const items = [
        item("flow", "aggressor share of taker flow", share >= cfg.absorbShare, 2, pct(share), true),
        item("stalled", "price progress with the aggressor", prog <= cfg.absorbSigma, 2, sgn(prog)+"σ", true),
        item("recent", "still happening in the latest seconds", rc.ok, 1.5, rc.val, true),
        item("intensity", "flow intensity vs normal", z >= ctx.th("absorbZ"), 1.5, "z "+z.toFixed(1)),
        item("efficiency", "price path efficiency (low = chop)", eff <= cfg.absorbEfficiency, 1, eff.toFixed(2)),
        refill == null ? na("refill", "passive depth refilled") : item("refill", "passive depth refilled", refill >= cfg.absorbRefill, 1.5, pct(refill)),
        item("fills", "flow spread over many fills (no one large trade)", conc <= E().absConc, 1, pct(conc)),
        item("level", "repeated fills at one level", t-refresh[vn][side] <= E().refreshMs, 1, t-refresh[vn][side] <= E().refreshMs ? "yes" : "no"),
        vn==="hl" ? item("wallet", "one wallet dominates", !!w, 1, w ? pct(w.share) : "no") : na("wallet", "one wallet dominates"),
        oShare == null || oProg == null ? na("cross", "other venue agrees") : item("cross", "other venue agrees", oShare >= E().crossShare && oProg <= cfg.absorbSigma, 1, pct(oShare)),
      ];
      return {items, ...scoreOf(items), px:h.close, facts:{share, z, prog, eff, refill, dSide, open:h.open, secs, rate$:rate*secs},
        quants:{share, z, prog, eff, refill, conc, recentShare:rc.share, recentPace:rc.pace}};
    }

    // ---- exhaustion: one side's aggression, strong a moment ago, has faded, near an extreme, price stops progressing ----
    // price progress over only the latest quarter-window: has it stalled now, whatever the window as a whole did?
    function lateProgress(vn, h, side){
      const q = clamp(Math.round(h.ms/cfg.bucketMs/4), 4, 32), r = agg(vn, q, 0); if (!r || !(r.open > 0)) return 0;
      return (side==="buy"?1:-1) * (r.close/r.open-1) * 1e4 / (ctx.sigmaBps(vn)*Math.sqrt(q*cfg.bucketMs/1000));
    }
    function evalExhaustion(vn, hz, side, t){
      const h = ctx.horizon(vn, hz); if (!h || !(h.open > 0)) return null;
      const count = Math.round(h.ms/cfg.bucketMs), prev = agg(vn, count, count);
      if (!prev || prev.n < minTrades(hz)) return null;
      const v = ctx.venue(vn), secs = h.ms/1000, sig = ctx.sigmaBps(vn)*Math.sqrt(secs);
      const rate = (side==="buy" ? h.buy : h.sell)/secs, was = (side==="buy" ? prev.buy : prev.sell)/secs, zWas = ctx.robustZ(was, vn, side, 1);
      const ratio = was > 0 ? rate/was : 1, prog = progress(vn, h, side), late = lateProgress(vn, h, side), wasShare = prev.buy+prev.sell > 0 ? (side==="buy" ? prev.buy : prev.sell)/(prev.buy+prev.sell) : 0;
      const ext = side==="buy" ? Math.max(h.hi, prev.hi) : Math.min(h.lo, prev.lo), prior = side==="buy" ? ctx.priorHigh(vn, 2*count) : ctx.priorLow(vn, 2*count);
      const gap = Number.isFinite(prior) ? (side==="buy" ? prior-ext : ext-prior)/ext*1e4/sig : 0;
      const countRatio = prev.n > 0 ? h.n/prev.n : null, sizeNow = h.n ? (h.buy+h.sell)/h.n : 0, sizeWas = prev.n ? (prev.buy+prev.sell)/prev.n : 0, poke = v.lastPokeFail && v.lastPokeFail.side===(side==="buy" ? "high" : "low") && t-v.lastPokeFail.t <= E().pokeMs;
      const items = [
        item("decay", "aggression vs the window before", ratio <= E().exhDecay, 2.5, pct(ratio), true),
        item("was", "it was elevated before", zWas >= E().exhWasZ, 1.5, "z "+zWas.toFixed(1), true),
        item("dominant", "it was the dominant side before", wasShare >= E().exhWasShare, 1, pct(wasShare), true),
        item("extreme", "near the 5-minute extreme", gap <= E().exhGap, 1.5, gap <= 0 ? "new extreme" : gap.toFixed(1)+"σ away"),
        item("stalled", "price progress with the aggressor (latest seconds)", late <= cfg.absorbSigma, 1.5, sgn(late)+"σ", true),
        item("poke", "recent failed poke", !!poke, 1.5, poke ? "yes" : "no"),
        countRatio == null ? na("count", "trade count falling") : item("count", "trade count vs the window before", countRatio <= E().exhCount, 1, pct(countRatio)),
        item("size", "average trade size shrinking", sizeWas > 0 && sizeNow <= E().exhSize*sizeWas, 1, sizeWas > 0 ? pct(sizeNow/sizeWas) : "-"),
      ];
      return {items, ...scoreOf(items), px:h.close, facts:{ratio, zWas, gap, prog, poke:!!poke, side, open:h.open, secs},
        quants:{decay:ratio, zWas, wasShare, gap, late, sizeRatio:sizeWas > 0 ? sizeNow/sizeWas : null, countRatio}};
    }

    // ---- aggression burst: a surge of one side's flow, with price movement and supporting signs ----
    function evalBurst(vn, hz, side, t){
      const h = ctx.horizon(vn, hz);
      if (!h || h.n < minTrades(hz) || !(h.open > 0) || !(h.buy+h.sell > 0)) return null;
      const secs = h.ms/1000, share = side==="buy" ? h.share : 1-h.share, rate = (side==="buy" ? h.buy : h.sell)/secs;
      const z = ctx.robustZ(rate, vn, side, 1), prog = progress(vn, h, side), count = Math.round(h.ms/cfg.bucketMs);
      const liq = side==="buy" ? h.liqBuyN : h.liqSellN, sweeps = side==="buy" ? h.sweepBuyN : h.sweepSellN;
      const brk = side==="buy" ? h.hi > ctx.priorHigh(vn, count) : h.lo < ctx.priorLow(vn, count);
      const oh = ctx.horizon(other(vn), hz), oZ = oh && oh.n >= minTrades(hz) ? ctx.robustZ((side==="buy" ? oh.buy : oh.sell)/(oh.ms/1000), other(vn), side, 1) : null;
      const rc = recent(vn, h, side, rate);
      const items = [
        item("rate", "flow rate vs normal", z >= ctx.th("burstZ"), 2, "z "+z.toFixed(1), true),
        item("share", "aggressor share of taker flow", share >= cfg.burstShare, 2, pct(share), true),
        item("recent", "still happening in the latest seconds", rc.ok, 1.5, rc.val, true),
        item("move", "price moved with the aggressor", prog >= ctx.th("burstSigma"), 2, sgn(prog)+"σ"),
        item("liq", "liquidations", liq >= E().burstLiq, 1, String(liq)),
        item("sweeps", "multi-level sweeps", sweeps >= E().burstSweeps, 1, String(sweeps)),
        item("thin", "far side of the book thinned", ctx.depthThinned(vn, side==="buy" ? "ask" : "bid"), 1, ctx.depthThinned(vn, side==="buy" ? "ask" : "bid") ? "yes" : "no"),
        item("break", "through the 5-minute extreme", brk, 1, brk ? "yes" : "no"),
        oZ == null ? na("cross", "other venue agrees") : item("cross", "other venue agrees", oZ >= E().crossZ, 1, "z "+oZ.toFixed(1)),
      ];
      return {items, ...scoreOf(items), px:h.close, facts:{z, share, prog, liq, sweeps, secs, notional:(side==="buy" ? h.buy : h.sell), open:h.open},
        quants:{liq, sweeps, crossZ:oZ}};
    }

    const EVAL = {absorption:evalAbsorption, exhaustion:evalExhaustion, burst:evalBurst};

    function reading(ep){
      const f = ep.facts, a = ep.aggressor;
      if (ep.family==="absorption") return `Aggressive ${who(a)} (${pct(f.share)} of taker flow, z ${zf(f.z)}) are being absorbed by passive ${who(opp(a))}: price ${moved(a, f.prog)}${f.refill != null ? `, ${f.dSide} depth ${pct(f.refill)} refilled` : ""}.`;
      if (ep.family==="exhaustion") return `Aggressive ${who(a)} have faded to ${pct(f.ratio)} of the previous window's pace${f.gap <= E().exhGap ? `, near the 5-minute ${a==="buy" ? "high" : "low"}` : ""}${f.poke ? ", after a failed poke" : ""}; price ${moved(a, f.prog)}.`;
      if (ep.family==="burst") return `Aggressive ${who(a)}: $${money(f.notional)} in ${f.secs.toFixed(0)} s (z ${zf(f.z)}), price ${moved(a, f.prog)}${f.liq ? `, ${f.liq} liquidations` : ""}${f.sweeps ? `, ${f.sweeps} sweeps` : ""}.`;
      const w = ep.wall; return `${w.side==="bid" ? "Bid" : "Ask"} wall at ${w.px}, ${w.ratio.toFixed(1)}x the median level, ${Math.round((ep.tUpdate-ep.tStart)/1000)} s old, ${pct(w.size/w.peak)} of its peak left${w.tradedFrac != null ? `; ${pct(w.tradedFrac)} of the size that left was traded through (the rest was pulled)` : ""}.`;
    }

    // ---- lifecycle ----
    function refreshEp(ep, ev, t){
      ep.intensity = ev.score;
      ep.evidence = ev.items; ep.facts = ev.facts; ep.px = ev.px; ep.tUpdate = t; ep.reading = reading(ep);
      if (ev.score >= ep.peak){ ep.peak = ev.score; ep.peakReading = ep.reading; ep.peakEvidence = ev.items; }   // an ended episode is described as it was at its peak, not as it was when it ended
      ep.trace.push([t, ev.score]); if (ep.trace.length > E().traceCap) ep.trace.shift();
    }
    function trim(){
      // walls have their own budget so a busy book cannot push the rarer families out of the list
      const c = E(), isW = e => e.family==="wall";
      let nw = episodes.filter(isW).length, no = episodes.length-nw;
      for (let i = 0; (nw > c.keepWalls || no > c.keepEpisodes) && i < episodes.length; ){
        const e = episodes[i], w = isW(e);
        if (e.stage==="ended" && (w ? nw > c.keepWalls : no > c.keepEpisodes)){ episodes.splice(i, 1); if (w) nw--; else no--; } else i++;
      }
    }
    function openEp(tr, ev, t){
      const prev = tr.lastEnded;
      if (prev && t-prev.tEnd <= E().resumeMs){
        prev.stage = "active"; prev.tEnd = null; prev.outcome = null; prev.resolution = null; prev.resolutionSigma = null; pend = pend.filter(x => x !== prev); prev.pulses++; prev.resumedAt.push(t); prev.fadingSince = null;
        tr.lastEnded = null; tr.ep = prev; tr.onSince = null; tr.lowSince = null; refreshEp(prev, ev, t); notify(prev, "resumed"); return;
      }
      const ep = {id:++seq, family:tr.fam, kind:tr.fam, venue:tr.vn, horizon:tr.hz, aggressor:tr.side, passive:tr.fam==="absorption" ? opp(tr.side) : null,
        stage:"active", pulses:1, tStart:Math.min(tr.runSince==null ? t : tr.runSince, t), tDetected:t, tEnd:null, peak:0, intensity:0, evidence:[], facts:{}, reading:"",
        outcome:null, resumedAt:[], trace:[], px:null, pxStart:ev.facts.open, tUpdate:t, fadingSince:null};
      tr.ep = ep; tr.onSince = null; tr.lowSince = null; episodes.push(ep); refreshEp(ep, ev, t); trim(); notify(ep, "started");
    }
    function endEp(tr, tEnd, outcome){
      const ep = tr.ep; ep.stage = "ended"; ep.tEnd = tEnd; ep.outcome = outcome; ep.fadingSince = null;
      tr.lastEnded = ep; tr.ep = null; tr.onSince = null; tr.runSince = null; tr.lowSince = null; if (outcome=="faded") pend.push(ep); notify(ep, "ended");
    }
    function step(fam, vn, hz, side, ev, t){
      const key = fam+"|"+vn+"|"+hz+"|"+side; let tr = tracks.get(key);
      if (!tr){ if (!ev) return; tr = {key, fam, vn, hz, side, ep:null, lastEnded:null, runSince:null, lastNear:0, onSince:null, lowSince:null}; tracks.set(key, tr); }
      tr.last = ev; tr.lastT = t;
      const c = E(), has = !!(ev && ev.gate), sc = has ? ev.score : 0, on = has && sc >= c.enterScore, near = has && sc >= c.formScore;
      if (!tr.ep){
        if (near){ if (tr.runSince == null) tr.runSince = t; tr.lastNear = t; } else if (tr.runSince != null && t-tr.lastNear > 2000) tr.runSince = null;
        if (on){ if (tr.onSince == null) tr.onSince = t; if (t-tr.onSince >= c.enterHoldMs) openEp(tr, ev, t); } else tr.onSince = null;
        return;
      }
      const ep = tr.ep, holds = has && sc >= c.exitScore;
      if (ev) refreshEp(ep, ev, t);
      if (ep.stage==="active"){
        if (!holds){ ep.stage = "fading"; ep.fadingSince = t; tr.lowSince = t; notify(ep, "fading"); }
      } else if (on){ ep.stage = "active"; ep.fadingSince = null; tr.lowSince = null; notify(ep, "active"); }
      else if (holds) tr.lowSince = null;
      else {
        if (tr.lowSince == null){ tr.lowSince = t; ep.fadingSince = t; }
        if (t-tr.lowSince >= c.endHoldMs) endEp(tr, ep.fadingSince || t, "faded");
      }
    }
    function tick(t){
      const c = E();
      for (const vn of ["bn","hl"]) for (const hz of c.horizons) for (const fam of ["absorption","exhaustion","burst"]){
        if (!c.families[fam] || (c.famHorizons[fam] && !c.famHorizons[fam].includes(hz))) continue;
        for (const side of ["buy","sell"]){ const ev = EVAL[fam](vn, hz, side, t); if (ev && ctx.observe) ctx.observe(vn, hz, fam, ev.quants); step(fam, vn, hz, side, ev, t); }
      }
      for (const [k, ep] of walls) if (t-ep.tSeen > c.wallStaleMs) closeWall(k, ep, t, "left", null);
      if (ctx.observe) for (const ep of walls.values()) ctx.observe(ep.venue, "book", "wall", {reposts:ep.wall.reposts});
      resolve(t);
    }
    // After the fact: what did price do in the aggressor's direction during the look-ahead after the episode faded? Never feeds back into a detection.
    function resolve(t){
      if (!pend.length) return;
      const c = E(), keep = [];
      for (const ep of pend){
        if (t < ep.tEnd+c.outcomeLookMs){ keep.push(ep); continue; }
        const p0 = ctx.priceAt(ep.venue, ep.tEnd), p1 = ctx.priceAt(ep.venue, ep.tEnd+c.outcomeLookMs);
        if (!(p0 > 0) || !(p1 > 0)) continue;
        const mv = (ep.aggressor==="buy"?1:-1) * (p1/p0-1) * 1e4 / (ctx.sigmaBps(ep.venue)*Math.sqrt(c.outcomeLookMs/1000));
        ep.resolutionSigma = mv; ep.resolution = mv >= c.outcomeFlatSigma ? "resolved-with" : mv <= -c.outcomeFlatSigma ? "resolved-against" : "flat"; notify(ep, "resolved");
      }
      pend = keep;
    }

    // ---- wall episodes: fed by the engine's wall tracker (a confirmed wall opens one; its resolution ends it) ----
    const wallKey = (vn, w) => vn+"|"+w.side+"|"+w.px;
    function wallItems(ep, ratio, distBps){
      const w = ep.wall, th = ctx.th("wallRatio");
      return [item("size", "size vs median level", ratio >= th, 2, ratio.toFixed(1)+"x", true), item("held", "held without being hit", ep.tUpdate-ep.tStart >= cfg.wallConfirmMs, 1.5, Math.round((ep.tUpdate-ep.tStart)/1000)+" s"),
        item("intact", "still near its peak size", w.size >= w.peak*E().wallFadeFrac, 2, pct(w.size/w.peak)), item("repost", "refilled after being hit", w.reposts >= E().wallReposts, 1, String(w.reposts)), item("near", "distance from mid", true, 0, distBps.toFixed(1)+" bps")];
    }
    // A confirmed wall becomes an episode only once it has stood long enough (flickering liquidity is noise), after calibration, and within a per-side cap.
    function wallUpdate(vn, t, w, ratio, mid){
      let ep = walls.get(wallKey(vn, w)), fresh = false;
      if (!ep){
        const c = E(); if (!c.families.wall || !ctx.isCalibrated() || t-w.born < c.wallEpisodeMs) return;
        let n = 0; for (const o of walls.values()) if (o.venue===vn && o.wall.side===w.side) n++;
        if (n >= c.wallMaxActive || ratio < ctx.th("wallRatio")*c.wallMinMult) return;
        if (w.peak*w.px < c.wallMinUsd) return;                                                  // too small to matter (a thin median level inflates the multiple)
        const near = o => o.venue===vn && o.wall.side===w.side && Math.abs(o.wall.px-w.px)/w.px*1e4 <= c.wallMergeBps;
        for (const o of walls.values()) if (near(o)) return;      // one resting region seen at several nearby prices is one episode
        for (let i = episodes.length-1, k = 0; i >= 0 && k < 40; i--){ const o = episodes[i]; if (o.family!=="wall") continue; k++; if (o.tEnd != null && t-o.tEnd <= c.wallMergeMs && near(o)) return; }      // and so is one that re-appears nearby right after the last one ended
        ep = wallOpen(vn, t, w, ratio, mid); fresh = true;
      }
      const x = ep.wall; x.size = w.size; x.peak = w.peak; x.ratio = ratio; x.reposts = w.reposts || 0; ep.tSeen = t; ep.tUpdate = t;
      ep.intensity = clamp01(Math.log2(Math.max(ratio, 1)/ctx.th("wallRatio"))/4); if (ep.intensity > ep.peak) ep.peak = ep.intensity;
      const fading = w.size <= w.peak*E().wallFadeFrac;
      if (fading && ep.stage==="active"){ ep.stage = "fading"; ep.fadingSince = t; ep.evidence = wallItems(ep, ratio, Math.abs(w.px-mid)/mid*1e4); ep.reading = reading(ep); notify(ep, "fading"); }
      else if (!fading && ep.stage==="fading"){ ep.stage = "active"; ep.fadingSince = null; notify(ep, "active"); }
      ep.evidence = wallItems(ep, ratio, Math.abs(w.px-mid)/mid*1e4); ep.reading = reading(ep);
      if (fresh) notify(ep, "started");
    }
    function wallOpen(vn, t, w, ratio, mid){
      const key = wallKey(vn, w);
      const ep = {id:++seq, family:"wall", kind:w.side+" wall", venue:vn, horizon:"book", aggressor:null, passive:w.side==="bid" ? "buy" : "sell", stage:"active", pulses:1,
        tStart:w.born, tDetected:t, tEnd:null, peak:0, intensity:0, evidence:[], facts:{}, reading:"", outcome:null, resumedAt:[], trace:[], px:w.px, pxStart:w.px, tUpdate:t, tSeen:t, fadingSince:null,
        wall:{side:w.side, px:w.px, size:w.size, peak:w.peak, ratio, reposts:w.reposts || 0, tradedFrac:null}};
      walls.set(key, ep); episodes.push(ep); trim(); return ep;
    }
    function closeWall(key, ep, t, outcome, frac, size){
      if (size != null) ep.wall.size = size;
      ep.stage = "ended"; ep.tEnd = t; ep.outcome = outcome; ep.fadingSince = null; ep.wall.tradedFrac = frac; ep.tUpdate = t; ep.reading = reading(ep);
      walls.delete(key); notify(ep, "ended");
    }
    function wallClose(vn, t, w, outcome, frac, size){ const key = wallKey(vn, w), ep = walls.get(key); if (ep) closeWall(key, ep, t, outcome, frac, size); }

    // Evidence that is building but has not yet held long enough to count: stage "forming".
    function forming(t){
      const out = [];
      for (const tr of tracks.values()){
        if (tr.ep || tr.runSince == null || !tr.last || t-tr.lastT > 2000 || !tr.last.gate || tr.last.score < E().formScore) continue;
        const ev = tr.last, ep = {family:tr.fam, venue:tr.vn, horizon:tr.hz, aggressor:tr.side, passive:tr.fam==="absorption" ? opp(tr.side) : null, stage:"forming", facts:ev.facts};
        out.push({id:"f|"+tr.key, family:tr.fam, kind:tr.fam, venue:tr.vn, horizon:tr.hz, aggressor:tr.side, passive:ep.passive, stage:"forming", pulses:0, tStart:tr.runSince, tDetected:null, tEnd:null,
          peak:ev.score, intensity:ev.score, evidence:ev.items, facts:ev.facts, reading:reading(ep), outcome:null, px:ev.px, tUpdate:tr.lastT});
      }
      return out;
    }
    // Groups: one phenomenon seen on several venues / horizons. Derived on demand from the per-track episodes, which stay as they are.
    // Same family and aggressor, a different venue or horizon, and the time spans overlap (within groupGapMs). Walls are a group of one.
    function groups(){
      const gap = E().groupGapMs, list = episodes.slice().sort((a,b) => a.tStart-b.tStart || a.id-b.id), par = list.map((_, i) => i);
      const find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; }, endOf = e => e.tEnd != null ? e.tEnd : e.tUpdate;
      for (let i = 0; i < list.length; i++){
        const a = list[i]; if (a.family==="wall") continue;
        for (let j = i+1; j < list.length; j++){
          const b = list[j]; if (b.tStart > endOf(a)+gap) break;   // sorted by start: nothing later can overlap a either
          if (b.family!==a.family || b.aggressor!==a.aggressor || (b.venue===a.venue && b.horizon===a.horizon)) continue;
          if (b.tStart <= endOf(a)+gap && a.tStart <= endOf(b)+gap) par[find(j)] = find(i);
        }
      }
      const by = new Map(); list.forEach((e, i) => { const r = find(i); if (!by.has(r)) by.set(r, []); by.get(r).push(e); });
      const out = [], rank = {active:2, fading:1, ended:0};
      for (const m of by.values()){
        const prim = m.reduce((x, y) => (y.tDetected < x.tDetected || (y.tDetected===x.tDetected && y.id < x.id)) ? y : x), lead = m.reduce((x, y) => y.peak > x.peak ? y : x);
        const stage = m.reduce((x, y) => rank[y.stage] > rank[x] ? y.stage : x, "ended"), ended = stage==="ended";
        out.push({id:"g"+prim.id, primary:prim.id, members:m, family:lead.family, kind:lead.kind, aggressor:lead.aggressor, passive:lead.passive, venue:lead.venue, horizon:lead.horizon,
          venues:Array.from(new Set(m.map(e => e.venue))).sort(), horizons:Array.from(new Set(m.map(e => e.horizon))),
          stage, pulses:Math.max(...m.map(e => e.pulses)), tStart:Math.min(...m.map(e => e.tStart)), tDetected:Math.min(...m.map(e => e.tDetected)), tEnd:ended ? Math.max(...m.map(e => e.tEnd)) : null,
          tUpdate:Math.max(...m.map(e => e.tUpdate)), peak:Math.max(...m.map(e => e.peak)), intensity:Math.max(...m.map(e => e.intensity)), resumedAt:[].concat(...m.map(e => e.resumedAt || [])).sort((a,b) => a-b),
          reading:lead.reading, peakReading:lead.peakReading, evidence:lead.evidence, peakEvidence:lead.peakEvidence, facts:lead.facts, wall:lead.wall, px:lead.px,
          outcome:ended ? lead.outcome : null, resolution:lead.resolution || null, resolutionSigma:lead.resolutionSigma == null ? null : lead.resolutionSigma});
      }
      return out.sort((a,b) => a.tStart-b.tStart || a.primary-b.primary);
    }
    function closeAll(t, reason){
      for (const tr of tracks.values()) if (tr.ep) endEp(tr, t, reason);
      for (const [k, ep] of Array.from(walls)) closeWall(k, ep, t, reason, null);
      tracks.clear(); pend = [];
    }
    function setFamily(name, on){ if (!Object.prototype.hasOwnProperty.call(E().families, name)) return; E().families[name] = !!on; if (!on) for (const tr of tracks.values()) if (tr.fam===name && tr.ep) endEp(tr, tr.ep.tUpdate, "disabled"); }
    return {
      reset(){ episodes = []; tracks = new Map(); walls = new Map(); pend = []; seq = 0; refresh = {bn:{buy:0,sell:0}, hl:{buy:0,sell:0}}; },
      tick, closeAll, setFamily, forming, groups, wallUpdate, wallClose,
      noteRefresh(vn, side, t){ refresh[vn][side] = t; },
      list: () => episodes, active: () => episodes.filter(e => e.stage !== "ended"),
      subscribe(fn){ listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    };
  }
  return {create, DEFAULTS, FAMILY_LABEL};
})();
