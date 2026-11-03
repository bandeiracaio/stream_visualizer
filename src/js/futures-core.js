// Futures stack (pure, self-tested; FUTSTACK): the numbers behind Now > Futures stack, a "who got liquidated / who is aggressive / are positions opening or closing" overview.
// A store keeps 5-second base bins per venue (price open/high/low/close, liquidation $ by side, taker buy / sell $ without liquidations, open interest); `aggregate` re-bins them for display;
// `highlights` marks the moments the setup is about: a liquidation spike that is confirmed by a volume-delta spike on the same side and by open interest dropping (positions being closed by force).
// Reading only. Nothing here touches the Reader engine, the broker or the feeds.
const FUTSTACK = (() => {
  const BASE_MS = 5000, VENUES = ["bn", "hl", "by", "ok"], PRICE = ["bn", "hl"];      // by = Bybit, ok = OKX: liquidations only (the other venues give price, delta and open interest)
  const DEFAULTS = { minLiqUsd:100000, liqMult:3, deltaMult:1.5, oiDropPct:0.0005, oiLag:2, gap:2 };
  const slot = t => Math.floor(t / BASE_MS);
  const blank = () => ({ o:null, h:null, l:null, c:null, bl:0, sl:0, b:0, s:0, oi:null });
  const newStore = () => ({ bins:new Map(), oi:{ bn:null, hl:null } });
  function cell(st, k, v) { let b = st.bins.get(k); if (!b) { b = { k }; for (const x of VENUES) b[x] = blank(); st.bins.set(k, b); } return b[v]; }
  // t: {t, v, side, px, ntl, liq}. side is the aggressor side; for a liquidation it is the side of the forced order (sell = a long was closed out).
  function addTrade(st, t) {
    if (!VENUES.includes(t.v) || !(t.px > 0) || !(t.ntl >= 0)) return;
    const x = cell(st, slot(t.t), t.v);
    if (!PRICE.includes(t.v)) { if (t.liq) { if (t.side === "sell") x.sl += t.ntl; else x.bl += t.ntl; } return; }
    if (x.o == null) x.o = x.h = x.l = x.c = t.px; else { if (t.px > x.h) x.h = t.px; if (t.px < x.l) x.l = t.px; x.c = t.px; }
    if (t.liq) { if (t.side === "sell") x.sl += t.ntl; else x.bl += t.ntl; }
    else if (t.side === "buy") x.b += t.ntl; else x.s += t.ntl;
  }
  function setOi(st, v, val) { if (PRICE.includes(v)) st.oi[v] = val > 0 ? +val : null; }
  function stamp(st, t) { for (const v of VENUES) if (st.oi[v] != null) cell(st, slot(t), v).oi = st.oi[v]; }   // open interest is polled, so it is written into the current bin every tick
  function prune(st, keepMs, now) { const cut = slot(now - keepMs); for (const k of st.bins.keys()) if (k < cut) st.bins.delete(k); }

  // o: {venue:"bn"|"hl"|"all", t0, t1, binMs, liqAll}. "all" = Binance + Hyperliquid for price, delta and open interest. liqAll adds the liquidations of every venue (Bybit and OKX too) to whichever venue is shown. One entry per display bin, including empty ones, so the time axis is even.
  function aggregate(st, o) {
    const per = Math.max(1, Math.round(o.binMs / BASE_MS)), t0 = Math.floor(o.t0 / o.binMs) * o.binMs, n = Math.max(1, Math.ceil((o.t1 - t0) / o.binMs));
    const vs = o.venue === "all" ? PRICE : [o.venue], lv = o.liqAll ? VENUES : vs, out = [];
    for (let j = 0; j < n; j++) {
      const r = { t:t0 + j*o.binMs, o:null, h:null, l:null, c:null, bl:0, sl:0, b:0, s:0, oi:null, has:false }, k0 = slot(r.t), pv = {}, oiV = {};
      for (const v of vs) pv[v] = { o:null, h:null, l:null, c:null };
      for (let k = k0; k < k0 + per; k++) {
        const bin = st.bins.get(k); if (!bin) continue; r.has = true;
        for (const v of lv) { r.bl += bin[v].bl; r.sl += bin[v].sl; }
        for (const v of vs) {
          const x = bin[v], p = pv[v]; r.b += x.b; r.s += x.s; if (x.oi != null) oiV[v] = x.oi;
          if (x.o != null) { if (p.o == null) { p.o = x.o; p.h = x.h; p.l = x.l; } else { if (x.h > p.h) p.h = x.h; if (x.l < p.l) p.l = x.l; } p.c = x.c; }
        }
      }
      const pick = vs.find(v => pv[v].o != null); if (pick) Object.assign(r, pv[pick]);
      const known = vs.filter(v => oiV[v] != null); if (known.length) r.oi = known.reduce((a, v) => a + oiV[v], 0);
      r.liq = r.bl + r.sl; r.delta = r.b - r.s; r.vol = r.b + r.s; out.push(r);
    }
    return out;
  }

  // History for the start of a session: Binance 1-minute klines (price, and taker buy quote volume = delta) and 5-minute open interest history, spread over the 5 s base bins.
  // klines: rows of /fapi/v1/klines ([openTime, o, h, l, c, vol, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote]); oiHist: rows of /futures/data/openInterestHist ({timestamp, sumOpenInterest}); until: the time the open interest is held to.
  // Live data wins: a base bin that already has live price keeps it, one that already has open interest keeps it. Detail inside a minute is invented (price walks open -> low/high -> close, volume is split evenly), so 1-minute and 5-minute bins are exact and 15-second bins are approximate.
  // Liquidations cannot be backfilled (Binance keeps no public history), and the kline delta includes liquidation prints. Returns {t0, t1, minutes, oiPoints} of what was written.
  function backfill(st, klines, oiHist, until) {
    const per = 60000 / BASE_MS, res = { t0:null, t1:null, minutes:0, oiPoints:0 };
    for (const r of klines || []) {
      const t0 = +r[0], o = +r[1], h = +r[2], l = +r[3], c = +r[4], qv = +r[7], tb = +r[10]; if (!(o > 0) || !(h > 0) || !(l > 0) || !(c > 0)) continue;
      const wp = c >= o ? [[0, o], [4, l], [8, h], [per - 1, c]] : [[0, o], [4, h], [8, l], [per - 1, c]], k0 = slot(t0), buy = (tb > 0 ? tb : 0) / per, sell = Math.max(0, qv - (tb > 0 ? tb : 0)) / per; let wrote = false;
      for (let i = 0; i < per; i++) {
        const x = cell(st, k0 + i, "bn"); if (x.o != null) continue;
        let j = 0; while (j < wp.length - 2 && i > wp[j + 1][0]) j++;
        const [i0, p0] = wp[j], [i1, p1] = wp[j + 1], px = p0 + (p1 - p0) * (i - i0) / (i1 - i0);
        x.o = x.h = x.l = x.c = px; x.b = buy; x.s = sell; wrote = true;
      }
      if (wrote) { res.minutes++; res.t0 = res.t0 == null ? t0 : Math.min(res.t0, t0); res.t1 = Math.max(res.t1 || 0, t0 + 60000); }
    }
    const pts = (oiHist || []).map(r => ({ t:+r.timestamp, v:+r.sumOpenInterest })).filter(p => p.t > 0 && p.v > 0).sort((a, b) => a.t - b.t);
    pts.forEach((p, j) => { const end = j + 1 < pts.length ? pts[j + 1].t : Math.max(p.t + 300000, until || 0); for (let k = slot(p.t); k < slot(end); k++) { const x = cell(st, k, "bn"); if (x.oi == null) x.oi = p.v; } res.oiPoints++; });
    if (res.t0 != null) st.bf = { t0:res.t0, t1:res.t1 };
    return res;
  }
  function reset(st) { st.bins.clear(); st.oi.bn = st.oi.hl = null; st.bf = null; }

  // One liquidation message from Bybit (v5 public linear, topic allLiquidation.<COIN>USDT) or OKX (public, channel liquidation-orders, instType SWAP) -> trades {t, v, side, px, ntl, liq:true}.
  // side is the side of the forced order: "sell" = a long was closed out. Bybit S "Buy" means a long was liquidated, size v in coin, p the bankruptcy price. OKX gives side directly, sz in contracts (x ctVal coin), bkPx.
  // Only the coin asked for (USDT-margined); everything else on the channel is ignored. o: {coin:"BTC", ctVal: OKX contract size in coin}.
  function parseLiq(venue, msg, o) {
    const out = [], C = String(o.coin || "").toUpperCase(); if (!msg || !C) return out;
    if (venue === "by") {
      if (typeof msg.topic !== "string" || !msg.topic.startsWith("allLiquidation.") || !Array.isArray(msg.data)) return out;
      for (const d of msg.data) { const px = +d.p, q = +d.v; if (d.s !== C + "USDT" || !(px > 0) || !(q > 0)) continue; out.push({ t:+d.T || +msg.ts, v:"by", side:d.S === "Buy" ? "sell" : "buy", px, ntl:px * q, liq:true }); }
    } else if (venue === "ok") {
      if (!msg.arg || msg.arg.channel !== "liquidation-orders" || !Array.isArray(msg.data) || !(o.ctVal > 0)) return out;
      for (const d of msg.data) { if (d.instId !== C + "-USDT-SWAP") continue; for (const x of d.details || []) { const px = +x.bkPx, q = +x.sz * o.ctVal; if (!(px > 0) || !(q > 0) || (x.side !== "sell" && x.side !== "buy")) continue; out.push({ t:+x.ts, v:"ok", side:x.side, px, ntl:px * q, liq:true }); } }
    }
    return out;
  }

  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
  const usd = x => { const a = Math.abs(x); return (x < 0 ? "-" : "") + "$" + (a >= 1e6 ? (a/1e6).toFixed(2) + "M" : a >= 1e3 ? (a/1e3).toFixed(0) + "k" : a.toFixed(0)); };
  const lastOi = (bins, from, to) => { for (let j = Math.min(to, bins.length - 1); j >= from; j--) if (bins[j].oi != null) return bins[j].oi; return null; };

  // What delta and open interest say together (the usual four readings). eps: open interest change (a fraction) below which it counts as flat.
  function reading(delta, oiPct, eps) {
    const e = eps == null ? 0.0002 : eps, d = delta > 0 ? "buy" : delta < 0 ? "sell" : "none";
    if (d === "none") return { key:"none", text:"no clear aggressor" };
    if (oiPct == null) return { key:d, text:d === "buy" ? "aggressive buying (no open interest reading)" : "aggressive selling (no open interest reading)" };
    if (Math.abs(oiPct) < e) return { key:d + "-flat", text:d === "buy" ? "aggressive buying, open interest flat: trades swapping hands" : "aggressive selling, open interest flat: trades swapping hands" };
    if (d === "buy") return oiPct > 0 ? { key:"buy-up", text:"aggressive buying + open interest rising: new longs opening" } : { key:"buy-down", text:"aggressive buying + open interest falling: shorts closing" };
    return oiPct > 0 ? { key:"sell-up", text:"aggressive selling + open interest rising: new shorts opening" } : { key:"sell-down", text:"aggressive selling + open interest falling: longs closing" };
  }

  // Liquidation spikes (the anchor) with their confirmations. A spike is a bin whose liquidation $ is at least minLiqUsd and, once 8 or more bins had liquidations, liqMult times the typical (median) such bin; nearby spikes on the same side merge.
  // Confirmations: delta on the same side as the forced order (sell-liquidations with negative delta) of at least deltaMult times the typical |delta|; open interest down by oiDropPct from the bin before to oiLag bins after.
  function highlights(bins, cfg) {
    const c = Object.assign({}, DEFAULTS, cfg), liqs = bins.map(b => b.liq).filter(x => x > 0);
    const liqThr = Math.max(c.minLiqUsd, liqs.length >= 8 ? c.liqMult * median(liqs) : 0), mDelta = median(bins.filter(b => b.has).map(b => Math.abs(b.delta)).filter(x => x > 0));
    const anchors = [];
    bins.forEach((b, i) => { if (b.liq >= liqThr) anchors.push({ i, side:b.sl >= b.bl ? "longs" : "shorts" }); });
    const groups = [];
    for (const a of anchors) { const g = groups[groups.length - 1]; if (g && g.side === a.side && a.i - g.i1 <= c.gap) g.i1 = a.i; else groups.push({ side:a.side, i0:a.i, i1:a.i }); }
    return groups.map(g => {
      let liq = 0, delta = 0; for (let i = g.i0; i <= g.i1; i++) { liq += g.side === "longs" ? bins[i].sl : bins[i].bl; delta += bins[i].delta; }
      const expect = g.side === "longs" ? -1 : 1, base = lastOi(bins, Math.max(0, g.i0 - 6), g.i0 - 1) ?? bins[g.i0].oi, end = lastOi(bins, g.i0, g.i1 + c.oiLag);
      const oiPct = base != null && end != null && base > 0 ? (end - base) / base : null;
      const deltaOk = mDelta > 0 ? delta * expect >= c.deltaMult * mDelta : delta * expect > 0, oiOk = oiPct != null && oiPct <= -c.oiDropPct, score = 1 + (deltaOk ? 1 : 0) + (oiOk ? 1 : 0);
      const who = g.side === "longs" ? "Longs" : "Shorts", rd = reading(delta, oiPct);
      return { i0:g.i0, i1:g.i1, t0:bins[g.i0].t, t1:bins[g.i1].t, side:g.side, liq, delta, oiPct, checks:{ liq:true, delta:deltaOk, oi:oiOk }, score, strong:score === 3,
        text:`${who} forced out: ${usd(liq)} liquidated, delta ${usd(delta)}${oiPct == null ? ", no open interest reading" : `, open interest ${(oiPct*100).toFixed(2)}%`}. ${score === 3 ? "All three agree." : score === 2 ? "Two of three agree." : "Liquidations only."}`, reading:rd };
    });
  }

  // The last n bins as one reading (for the live checklist).
  function summary(bins, n) {
    const w = bins.slice(-Math.max(1, n)), s = { bl:0, sl:0, delta:0, vol:0 };
    for (const b of w) { s.bl += b.bl; s.sl += b.sl; s.delta += b.delta; s.vol += b.vol; }
    const first = bins.length - w.length, base = lastOi(bins, Math.max(0, first - 6), first - 1) ?? w.find(b => b.oi != null)?.oi ?? null, end = lastOi(w, 0, w.length - 1);
    s.oiPct = base != null && end != null && base > 0 ? (end - base) / base : null; s.reading = reading(s.delta, s.oiPct); return s;
  }

  function selftest() {
    const out = [], ok = (name, cond, detail) => out.push({ name:"futures stack: " + name, ok:!!cond, detail:cond ? "" : String(detail) });
    const st = newStore(), T = 6e9;
    for (let k = 0; k < 120; k++) {                                                    // 10 minutes of quiet 5 s bins around 100, balanced flow, open interest flat at 1000
      const t = T + k * BASE_MS; addTrade(st, { t, v:"bn", side:"buy", px:100 + (k % 3) * .01, ntl:1000 + (k % 5) * 100 }); addTrade(st, { t:t + 1, v:"bn", side:"sell", px:100, ntl:1000 + ((k + 2) % 5) * 100 });
      setOi(st, "bn", 1000); stamp(st, t);
    }
    const flushT = T + 60 * BASE_MS;                                                   // minute 5: long liquidations, heavy selling, open interest falls
    for (let k = 60; k < 63; k++) { const t = T + k * BASE_MS; addTrade(st, { t:t + 2, v:"bn", side:"sell", px:99.5, ntl:400000, liq:true }); addTrade(st, { t:t + 3, v:"bn", side:"sell", px:99.5, ntl:30000 }); }
    for (let k = 62; k < 120; k++) { setOi(st, "bn", 990); stamp(st, T + k * BASE_MS); }
    const bins = aggregate(st, { venue:"bn", t0:T, t1:T + 600000, binMs:15000 }), hs = highlights(bins);
    ok("aggregate even bins", bins.length === 40 && bins.every((b, i) => b.t === T + i * 15000), bins.length);
    ok("aggregate sums liquidations", Math.abs(bins.reduce((a, b) => a + b.sl, 0) - 1200000) < 1e-6 && bins.every(b => b.bl === 0), bins.reduce((a, b) => a + b.sl, 0));
    ok("liquidations are not in delta", bins.every(b => b.vol < 200000), Math.max(...bins.map(b => b.vol)));
    ok("one merged highlight on longs", hs.length === 1 && hs[0].side === "longs" && hs[0].t0 >= flushT - 15000 && hs[0].t0 <= flushT + 15000, JSON.stringify(hs));
    ok("highlight is confirmed by delta and open interest", hs.length === 1 && hs[0].strong && hs[0].oiPct < -0.005 && hs[0].delta < 0, JSON.stringify(hs));
    ok("reading: selling with open interest falling is longs closing", hs.length === 1 && hs[0].reading.key === "sell-down", hs.length ? hs[0].reading.key : "none");
    const quiet = aggregate(st, { venue:"bn", t0:T, t1:T + 300000, binMs:15000 });
    ok("no highlight in the quiet part", highlights(quiet).length === 0, highlights(quiet).length);
    const hs2 = highlights(bins, { minLiqUsd:5e6 }); ok("minimum liquidation size is respected", hs2.length === 0, hs2.length);
    const st2 = newStore(); for (let k = 0; k < 20; k++) addTrade(st2, { t:T + k*BASE_MS, v:"hl", side:"buy", px:50, ntl:500 }); addTrade(st2, { t:T + 40000, v:"hl", side:"buy", px:50.2, ntl:900000, liq:true });
    const b2 = aggregate(st2, { venue:"hl", t0:T, t1:T + 120000, binMs:5000 }), h2 = highlights(b2);
    ok("short squeeze without open interest: liquidation only, no open interest reading", h2.length === 1 && h2[0].side === "shorts" && h2[0].oiPct == null && h2[0].checks.oi === false && h2[0].checks.delta === false && h2[0].score === 1, JSON.stringify(h2));
    ok("reading table", reading(5, .01).key === "buy-up" && reading(5, -.01).key === "buy-down" && reading(-5, .01).key === "sell-up" && reading(-5, -.01).key === "sell-down" && reading(-5, 0).key === "sell-flat" && reading(0, .5).key === "none" && reading(3, null).key === "buy", "");
    const all = aggregate(st, { venue:"all", t0:T, t1:T + 60000, binMs:60000 }); ok("all venues keeps price from the venue that has it", all[0].o != null && all[0].oi === 1000, JSON.stringify(all[0]));
    const sm = summary(bins.slice(0, 24), 6); ok("summary of the last bins", sm.oiPct < -0.005 && sm.delta < 0 && sm.reading.key === "sell-down" && sm.sl === 1200000, JSON.stringify(sm));
    const by = parseLiq("by", { topic:"allLiquidation.BTCUSDT", ts:5, data:[{ T:T + 1000, s:"BTCUSDT", S:"Buy", v:"0.5", p:"60000" }, { T:8, s:"ETHUSDT", S:"Sell", v:"3", p:"3000" }] }, { coin:"BTC" });
    ok("bybit: a Buy update is a long liquidated (forced sell), other coins ignored", by.length === 1 && by[0].side === "sell" && by[0].ntl === 30000 && by[0].t === T + 1000 && by[0].liq === true, JSON.stringify(by));
    const okx = parseLiq("ok", { arg:{ channel:"liquidation-orders", instType:"SWAP" }, data:[{ instId:"BTC-USDT-SWAP", details:[{ bkPx:"60000", posSide:"short", side:"buy", sz:"50", ts:String(T + 2000) }] }, { instId:"BTC-USD-SWAP", details:[{ bkPx:"60000", side:"sell", sz:"5", ts:"9" }] }, { instId:"AKE-USDT-SWAP", details:[{ bkPx:"1", side:"sell", sz:"5", ts:"9" }] }] }, { coin:"btc", ctVal:0.01 });
    ok("okx: contracts x contract size, side as given, only the coin's USDT swap", okx.length === 1 && okx[0].side === "buy" && okx[0].ntl === 30000 && okx[0].t === T + 2000, JSON.stringify(okx));
    ok("parse: junk and missing contract size give nothing", parseLiq("ok", { arg:{ channel:"liquidation-orders" }, data:[] }, { coin:"BTC" }).length === 0 && parseLiq("by", null, { coin:"BTC" }).length === 0 && parseLiq("ok", { arg:{ channel:"liquidation-orders" }, data:[{ instId:"BTC-USDT-SWAP", details:[{ bkPx:"1", side:"buy", sz:"1", ts:"1" }] }] }, { coin:"BTC" }).length === 0, "");
    const st3 = newStore(); addTrade(st3, { t:T, v:"bn", side:"buy", px:100, ntl:1000 }); for (const t of by.concat(okx)) addTrade(st3, t);
    const own = aggregate(st3, { venue:"bn", t0:T, t1:T + 60000, binMs:60000 })[0], allL = aggregate(st3, { venue:"bn", t0:T, t1:T + 60000, binMs:60000, liqAll:true })[0];
    ok("liqAll adds Bybit and OKX liquidations without touching price or delta", own.liq === 0 && allL.sl === 30000 && allL.bl === 30000 && allL.c === 100 && allL.delta === 1000 && allL.h === 100, JSON.stringify(allL));
    const sb = newStore(), TB = 6e9, kl = [[TB, "100", "103", "99", "102", "0", TB + 59999, "60000", 10, "0", "42000"], [TB + 60000, "102", "104", "101", "101", "0", TB + 119999, "30000", 5, "0", "10000"]];
    addTrade(sb, { t:TB + 60000 + 2000, v:"bn", side:"buy", px:102.5, ntl:500 });                       // live data already in the second minute, first 5 s bin
    const rb = backfill(sb, kl, [{ timestamp:TB - 120000, sumOpenInterest:"1000" }, { timestamp:TB + 60000, sumOpenInterest:"990" }], TB + 400000), ab = aggregate(sb, { venue:"bn", t0:TB, t1:TB + 120000, binMs:60000 });
    ok("backfill: 1-minute bins keep the kline price", ab[0].o === 100 && ab[0].h === 103 && ab[0].l === 99 && ab[0].c === 102, JSON.stringify(ab[0]));
    ok("backfill: delta is taker buy minus taker sell", Math.abs(ab[0].delta - (42000 - 18000)) < 1e-6 && Math.abs(ab[0].vol - 60000) < 1e-6, JSON.stringify(ab[0]));
    ok("backfill: open interest carried forward from each point", ab[0].oi === 1000 && ab[1].oi === 990, JSON.stringify([ab[0].oi, ab[1].oi]));
    ok("backfill: live data wins over backfill in the same bin", ab[1].b >= 500 && ab[1].o === 102.5 && rb.minutes === 2 && sb.bf.t0 === TB, JSON.stringify([ab[1], rb, sb.bf]));
    ok("backfill: no liquidations invented, junk rows skipped", ab.every(b => b.liq === 0) && backfill(newStore(), [["x"], [TB, "0", "0", "0", "0"]], [{ timestamp:"a" }], 0).minutes === 0, "");
    const before = st.bins.size; prune(st, 60000, T + 600000); ok("prune drops old bins", st.bins.size < before && st.bins.size > 0, st.bins.size);
    return out;
  }
  return { BASE_MS, DEFAULTS, newStore, addTrade, setOi, stamp, prune, aggregate, highlights, summary, reading, parseLiq, backfill, reset, usd, selftest };
})();
