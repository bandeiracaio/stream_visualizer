"use strict";
// Market history invariants (pure, no DOM, timers or storage): the 5-minute window, the 250 ms mid row, the 500 ms cvd row, the trade bookkeeping
// and the reset values. The page keeps the live objects (M, trades, cvd, cvdHist, midHist) and the timers; it calls through this door.
// Display only: nothing here changes what the Reader hears. prune returns new arrays (as the old prune did), it never trims in place.
const MARKET = (() => {
  const KEEP = 300000;               // 5 min of history for charts
  const MID_MS = 250, CVD_MS = 500;  // sampling cadence the page timers use
  // trade row: {t, v, side, px, q, ntl, liq, bf, users}; mid is stamped on arrival
  const freshCvd = () => ({bn:0, hl:0});
  const freshHealth = () => ({bnReconnects:0, hlReconnects:0, hlReplays:0});
  const freshQuotes = () => ({bnMark:null,bnIndex:null,bnFund:null,bnNextFund:null,bnOI:null,bnBid:null,bnAsk:null,
    hlMark:null,hlOracle:null,hlFund:null,hlOI:null,hlVol:null,hlBid:null,hlAsk:null,liqs:0,liqUsd:0});
  const dropOld = (a, cut) => { let i = 0; while (i < a.length && a[i].t < cut) i++; return i ? a.slice(i) : a; };
  // stamp the venue mid on a trade that has none, from the live quotes M
  function stampMid(t, M){
    if (t.mid == null){ const b = t.v==="bn" ? M.bnBid : M.hlBid, a = t.v==="bn" ? M.bnAsk : M.hlAsk; if (b && a) t.mid = (b+a)/2; }
    return t;
  }
  // cvd moves on live non-liquidation trades only (liquidations already appear as trades; backfill is history)
  function bumpCvd(cvd, t){
    if (!t.liq && !t.bf) cvd[t.v] += t.side==="buy" ? t.ntl : -t.ntl;
    return cvd;
  }
  function midRow(M, t){
    const bn = M.bnBid&&M.bnAsk ? (M.bnBid+M.bnAsk)/2 : null, hl = M.hlBid&&M.hlAsk ? (M.hlBid+M.hlAsk)/2 : null;
    return bn||hl ? {t, bn, hl} : null;
  }
  const cvdRow = (cvd, t) => ({t, bn:cvd.bn, hl:cvd.hl});
  // sorts trades by time, then drops everything older than now-KEEP; returns the new arrays
  function prune(now, trades, midHist, cvdHist){
    const cut = now - KEEP;
    trades.sort((a,b)=>a.t-b.t);
    return {trades:dropOld(trades, cut), midHist:dropOld(midHist, cut), cvdHist:dropOld(cvdHist, cut)};
  }

  function selftest(){
    const out = [], ok = (n, c, d) => out.push({name:"market: " + n, ok:!!c, detail:c ? "" : String(d)});
    const tr = (t, v, side, ntl, x={}) => Object.assign({t, v, side, px:100, q:ntl/100, ntl, liq:false, bf:false}, x);
    const now = 1e6, cut = now - KEEP;
    const tl = [tr(cut-1,"bn","buy",1), tr(cut+5,"bn","buy",1), tr(cut,"hl","sell",1), tr(now,"bn","buy",1)];
    const r = prune(now, tl, [{t:cut-1},{t:cut},{t:now}], [{t:cut-10},{t:cut+1}]);
    ok("prune keeps t >= now-KEEP, drops older", r.trades.length===3 && r.trades.every(x=>x.t>=cut) && r.midHist.length===2 && r.cvdHist.length===1, JSON.stringify(r.trades.map(x=>x.t)));
    ok("prune sorts trades by time", r.trades.map(x=>x.t).join()===[cut,cut+5,now].join(), r.trades.map(x=>x.t));
    const same = [{t:now}]; ok("prune returns the same array when nothing is old", prune(now, [], same, []).midHist===same, "copied");
    ok("KEEP is 5 minutes", KEEP===300000, KEEP);
    const c = freshCvd();
    bumpCvd(c, tr(1,"bn","buy",100)); bumpCvd(c, tr(2,"bn","sell",40)); bumpCvd(c, tr(3,"hl","sell",25)); bumpCvd(c, tr(4,"hl","buy",5));
    ok("cvd sums buys minus sells per venue", c.bn===60 && c.hl===-20, JSON.stringify(c));
    bumpCvd(c, tr(5,"bn","buy",1000,{liq:true})); bumpCvd(c, tr(6,"hl","buy",1000,{bf:true}));
    ok("cvd ignores liquidations and backfill", c.bn===60 && c.hl===-20, JSON.stringify(c));
    const M = freshQuotes(); M.bnBid = 99; M.bnAsk = 101;
    ok("stampMid uses venue quotes", stampMid(tr(1,"bn","buy",1), M).mid===100 && stampMid(tr(1,"hl","buy",1), M).mid===undefined, "mid");
    ok("stampMid keeps an existing mid", stampMid(tr(1,"bn","buy",1,{mid:7}), M).mid===7, "overwrote");
    ok("midRow null without quotes, row with one venue", midRow(freshQuotes(), 5)===null && JSON.stringify(midRow(M, 5))===JSON.stringify({t:5,bn:100,hl:null}), JSON.stringify(midRow(M,5)));
    ok("cvdRow snapshots cvd", JSON.stringify(cvdRow(c, 9))===JSON.stringify({t:9,bn:60,hl:-20}), JSON.stringify(cvdRow(c,9)));
    ok("cadence constants", MID_MS===250 && CVD_MS===500, MID_MS+" "+CVD_MS);
    let hist = [];
    const n = 2 * KEEP / CVD_MS;
    for (let i = 0; i < n; i++){ hist.push(cvdRow(c, i*CVD_MS)); if (i % 20 === 0) hist = prune(i*CVD_MS, [], [], hist).cvdHist; }
    const last = (n-1)*CVD_MS; hist = prune(last, [], [], hist).cvdHist;
    ok("sampled history stays within the window", hist.length===KEEP/CVD_MS+1 && hist[0].t===last-KEEP, hist.length);
    ok("reset values are clean and independent", freshQuotes().liqs===0 && freshQuotes().bnBid===null && freshCvd()!==freshCvd() && freshHealth().hlReplays===0, "dirty");
    return out;
  }
  return {KEEP, MID_MS, CVD_MS, freshCvd, freshHealth, freshQuotes, stampMid, bumpCvd, midRow, cvdRow, prune, selftest};
})();
