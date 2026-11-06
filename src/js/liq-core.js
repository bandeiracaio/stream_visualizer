"use strict";
// Liquidation readout (pure, no DOM, no timers, no clock: the caller passes now): events from Binance, Bybit and OKX grouped into clusters, a window summary, one-minute buckets and the price move
// before and after a cluster. Display only; it feeds the Liquidations section of Now > Market and tape (liq-readout.js) and never touches a feed, a recording or a detection.
// An event is {t (ms), v ("bn" | "by" | "ok"), side ("sell" = a long was liquidated, a forced sell; "buy" = a short was liquidated, a forced buy), ntl (dollars)}.
// A cluster is the events whose gaps are at most GAP_MS (30 s, as in the exploratory look at the saved sessions: .scratch/liquidation-study/exploration-20261105.md).
const LIQ = (() => {
  const GAP_MS = 30000, BIG = 100000, HUGE = 1000000, VENUES = ["bn", "by", "ok"], NAME = {bn:"Binance", by:"Bybit", ok:"OKX"}, SHORT = {bn:"BN", by:"BY", ok:"OK"};
  const valid = e => e && Number.isFinite(e.t) && e.ntl > 0 && (e.side === "buy" || e.side === "sell") && VENUES.indexOf(e.v) >= 0;
  const usd = x => { const a = Math.abs(x); return "$" + (a >= 1e6 ? (a/1e6).toFixed(a >= 1e7 ? 1 : 2) + "M" : a >= 1e3 ? (a/1e3).toFixed(a >= 1e5 ? 0 : 1) + "k" : a.toFixed(0)); };
  function clusters(events, gapMs) {
    const gap = gapMs == null ? GAP_MS : gapMs, ev = (events || []).filter(valid).slice().sort((a, b) => a.t - b.t), out = []; let c = null;
    const finish = k => { k.ntl = k.buy + k.sell; k.dom = k.sell >= k.buy ? "sell" : "buy"; k.domShare = Math.max(k.buy, k.sell)/k.ntl; k.tier = k.ntl >= HUGE ? "huge" : k.ntl >= BIG ? "big" : "small"; return k; };
    for (const e of ev) {
      if (c && e.t - c.t1 <= gap) { c.t1 = e.t; c.n++; c[e.side] += e.ntl; c.venues[e.v] += e.ntl; }
      else { if (c) out.push(finish(c)); c = {t0:e.t, t1:e.t, n:1, buy:0, sell:0, venues:{bn:0, by:0, ok:0}}; c[e.side] = e.ntl; c.venues[e.v] = e.ntl; }
    }
    if (c) out.push(finish(c));
    return out;
  }
  const active = (c, now, gapMs) => now - c.t1 <= (gapMs == null ? GAP_MS : gapMs);      // still forming: the next event would join it
  // dollars in the window [now - windowMs, now]: per venue {sell, buy, n}, and in total
  function summary(events, now, windowMs) {
    const per = {bn:{sell:0, buy:0, n:0}, by:{sell:0, buy:0, n:0}, ok:{sell:0, buy:0, n:0}}; let sell = 0, buy = 0, n = 0;
    for (const e of events || []) { if (!valid(e) || e.t < now - windowMs || e.t > now) continue; per[e.v][e.side] += e.ntl; per[e.v].n++; if (e.side === "sell") sell += e.ntl; else buy += e.ntl; n++; }
    return {windowMs, per, sell, buy, total:sell + buy, n};
  }
  // spanMs / binMs buckets ending at now, oldest first: {t (start), sell, buy}
  function buckets(events, now, spanMs, binMs) {
    const n = Math.max(1, Math.round(spanMs/binMs)), start = now - n*binMs, out = Array.from({length:n}, (_, i) => ({t:start + i*binMs, sell:0, buy:0}));
    for (const e of events || []) { if (!valid(e) || e.t < start || e.t >= now) continue; out[Math.min(n - 1, Math.floor((e.t - start)/binMs))][e.side] += e.ntl; }
    return out;
  }
  // The price move around a cluster in sigmas, signed in the direction the liquidations pushed (longs liquidated = down): positive = price kept going that way, negative = it came back.
  // hist: [[t, price]] one point a second; sigma: bps per root second; fm(hist, t, horizonSec, dir, sigma) -> move or null (scoreboard-core's forwardMove).
  function moves(hist, c, sigma, now, fm) {
    const out = {pre:null, after60:null, after300:null, soFar:null};
    if (!hist || !hist.length || !(sigma > 0)) return out;
    const dir = c.dom === "sell" ? -1 : 1, last = hist[hist.length - 1][0], el = Math.min(now, last) - c.t1;
    out.pre = fm(hist, c.t0 - 300000, 300, dir, sigma);
    if (el >= 60000) out.after60 = fm(hist, c.t1, 60, dir, sigma); else if (el >= 5000) out.soFar = {sec:Math.floor(el/1000), move:fm(hist, c.t1, Math.floor(el/1000), dir, sigma)};
    if (el >= 300000) out.after300 = fm(hist, c.t1, 300, dir, sigma);
    return out;
  }
  const mix = c => VENUES.filter(v => c.venues[v] > 0).sort((a, b) => c.venues[b] - c.venues[a]).map(v => SHORT[v] + " " + Math.round(100*c.venues[v]/c.ntl) + "%").join(" · ");
  const sideText = c => c.dom === "sell" ? "longs liquidated" : "shorts liquidated";

  function selftest() {
    const out = [], ok = (name, pass, detail) => out.push({name:"liquidation readout: " + name, ok:!!pass, detail:detail || ""});
    const T = 1.8e12, ev = (dt, v, side, ntl) => ({t:T + dt, v, side, ntl});
    const list = [ev(0, "bn", "sell", 40000), ev(5000, "bn", "sell", 30000), ev(9000, "by", "sell", 20000), ev(39000, "ok", "sell", 10000), ev(69001, "bn", "buy", 5000), ev(200000, "by", "buy", 800000), ev(205000, "ok", "buy", 300000)];
    const copy = JSON.stringify(list), cs = clusters(list);
    ok("events within 30 s of each other (gap 30000 joins, 30001 splits) form one cluster, across venues", cs.length === 3 && cs[0].n === 4 && cs[0].ntl === 100000 && cs[0].t0 === T && cs[0].t1 === T + 39000 && cs[1].n === 1 && cs[1].t0 === T + 69001, JSON.stringify(cs.map(c => [c.n, c.ntl])));
    ok("dominant side, its share and the dollars per venue", cs[0].dom === "sell" && cs[0].domShare === 1 && cs[0].venues.bn === 70000 && cs[0].venues.by === 20000 && cs[0].venues.ok === 10000 && cs[2].dom === "buy" && cs[2].ntl === 1100000);
    ok("tiers: under $100k small, $100k big, $1M huge", cs[1].tier === "small" && cs[0].tier === "big" && cs[2].tier === "huge" && clusters([ev(0, "bn", "sell", 99999)])[0].tier === "small" && clusters([ev(0, "bn", "sell", 1e6)])[0].tier === "huge");
    ok("a mixed cluster takes the side with more dollars, ties go to longs liquidated", clusters([ev(0, "bn", "sell", 100), ev(1000, "by", "buy", 300)])[0].dom === "buy" && clusters([ev(0, "bn", "sell", 100), ev(1000, "by", "buy", 100)])[0].dom === "sell" && Math.abs(clusters([ev(0, "bn", "sell", 100), ev(1000, "by", "buy", 300)])[0].domShare - 0.75) < 1e-9);
    ok("bad events are ignored, input order does not matter, the input is not changed", clusters([null, {t:T, v:"bn", side:"sell", ntl:0}, {t:T, v:"zz", side:"sell", ntl:5}, {t:NaN, v:"bn", side:"sell", ntl:5}, {t:T, v:"bn", side:"x", ntl:5}]).length === 0 && JSON.stringify(clusters(list.slice().reverse())) === JSON.stringify(cs) && JSON.stringify(list) === copy);
    ok("a cluster is forming while the next event would still join it", active(cs[0], T + 39000 + 30000) && !active(cs[0], T + 39000 + 30001));
    const s = summary(list, T + 210000, 600000), s2 = summary(list, T + 210000, 20000);
    ok("window summary: dollars per venue and side, outside the window left out", s.total === 1205000 && s.sell === 100000 && s.buy === 1105000 && s.per.bn.sell === 70000 && s.per.by.buy === 800000 && s.per.ok.buy === 300000 && s.n === 7 && s2.total === 1100000 && s2.n === 2);
    const b = buckets(list, T + 240000, 240000, 60000);
    ok("buckets: oldest first, one per bin, dollars land in the right bin", b.length === 4 && b[0].sell === 100000 && b[1].buy === 5000 && b[3].buy === 1100000 && b[2].buy === 0 && b[0].t === T);
    // moves: price falls 1 bp a second from T, then is flat; longs liquidated (down) in [T, T+39 s]
    const hist = []; for (let i = 0; i <= 700; i++) hist.push([T - 400000 + i*1000, 100000]);
    const fm = (h, t, H, dir, sigma) => { const end = t + H*1000; if (end > h[h.length - 1][0] || t < h[0][0]) return null; const at = x => h[Math.round((x - h[0][0])/1000)][1]; return dir*((at(end)/at(t) - 1)*1e4)/(sigma*Math.sqrt(H)); };
    for (let i = 0; i < hist.length; i++) { const t = hist[i][0]; hist[i][1] = t <= T - 300000 ? 100000 : t <= T ? 100000 - (t - (T - 300000))/1000*10 : 100000 - 3000 + (t - T)/1000*5; }      // falls 3000 over the 5 minutes before T, then rises 5 a second
    const mv = moves(hist, cs[0], 0.5, T + 100000, fm), mvEarly = moves(hist, cs[0], 0.5, T + 39000 + 30000, fm);
    ok("moves: before the cluster in its direction (price had fallen), 1 minute after it has come back", mv.pre > 1 && mv.after60 < 0 && mv.after300 === null && mv.soFar === null);
    ok("moves: under a minute after the cluster ends only 'so far' is given, from 5 s on", mvEarly.after60 === null && mvEarly.soFar && mvEarly.soFar.sec === 30 && moves(hist, cs[0], 0.5, T + 39000 + 2000, fm).soFar === null);
    ok("moves: a buy cluster flips the direction, and no sigma or history gives nothing", moves(hist, {t0:T, t1:T + 1000, dom:"buy"}, 0.5, T + 100000, fm).pre < -1 && moves(hist, cs[0], 0, T + 100000, fm).pre === null && moves([], cs[0], 0.5, T, fm).after60 === null);
    ok("text: venue mix largest first, side wording, dollars", mix(cs[0]) === "BN 70% · BY 20% · OK 10%" && sideText(cs[2]) === "shorts liquidated" && usd(950) === "$950" && usd(12345) === "$12.3k" && usd(250000) === "$250k" && usd(1200000) === "$1.20M" && usd(42368538) === "$42.4M");
    return out;
  }
  return {GAP_MS, BIG, HUGE, VENUES, NAME, SHORT, clusters, active, summary, buckets, moves, mix, sideText, usd, selftest};
})();
