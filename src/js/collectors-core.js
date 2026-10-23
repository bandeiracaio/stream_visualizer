"use strict";
// Collectors (pure, no DOM, no timers): data worth keeping that no detector uses yet. Each collector writes records
// ["c", name, t, payload] (t in ms). They are kept on a rolling tape on the device and attached to a saved session as `ext`, beside `inputs`;
// the Reader engine never sees them (its replay ignores them), so they cannot change a detection. Spec: .scratch/collectors/01-collectors.md.
// (The record type letter is "c": "x" is already the engine's reset marker.)
const COLLECT = (() => {
  const REGISTRY = [
    {id:"telemetry", label:"Self-telemetry: feed latency, message rates, gaps, clock offset", speed:"slow", on:true},
    {id:"derivs", label:"Derivatives context: funding, open interest, basis, liquidations, long/short and taker ratios (Binance, Hyperliquid)", speed:"slow", on:true},
    {id:"calendar", label:"Calendar tags: funding times, 15m / 1h / 4h / daily / weekly / monthly closes, US open and close, options expiry (rules, no network)", speed:"slow", on:true},
    {id:"book", label:"Book depth (while recording): depth within 1 / 5 / 10 / 25 bps, spread, touch size, size added and removed per side (Binance, Hyperliquid)", speed:"fast", on:true},
    {id:"venues", label:"Extra venues (while recording): Coinbase, Bybit and OKX quotes, Binance spot, perp marks and indexes, and the ETH / SOL / BNB / XRP / DOGE marks", speed:"fast", on:true},
  ];
  const TAPE_MS = 24*3600*1000, FILE_BUDGET = 8*1024*1024;      // the rolling tape keeps 24 h; one session file takes at most about 8 MB of them (5 MB until v058: book depth and the extra venues fill about 2 MB an hour each while recording)
  const round = (x, d) => Math.round(x*Math.pow(10, d))/Math.pow(10, d);
  const quantile = (arr, p) => { if (!arr || !arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length*p))]; };
  const rec = (name, t, payload) => ["c", name, t, payload];
  const isRec = r => Array.isArray(r) && r[0] === "c" && typeof r[1] === "string" && Number.isFinite(r[2]);

  // The page's feeds. cur/prev: {streamId: {total, bytes, late, last, maxLat, lats[]}} (prev may be null); dtMs: time between the two.
  // Per stream: messages and rate since the last sample, how old the newest message is, latency median / p90 / max, and late messages (over 1 s).
  function feeds(prev, cur, nowMs, dtMs) {
    const out = {};
    for (const id in cur) {
      const c = cur[id], p = prev && prev[id];
      if (!c.total) continue;
      const n = c.total - (p ? p.total : 0);
      out[id] = {n, hz:dtMs > 0 ? round(n/(dtMs/1000), 1) : null, ageMs:c.last ? nowMs - c.last : null, latMed:quantile(c.lats, .5), latP90:quantile(c.lats, .9), latMax:c.maxLat == null ? null : c.maxLat, late:c.late - (p ? p.late : 0)};
    }
    return out;
  }
  // One stream seen from the worker: note(exchangeMs, localMs) for every message, take() at each sample. lag = local clock minus the exchange's
  // clock, so it holds the clock offset as well as the real delay; a jump of the median is the thing to look for.
  function streamStat() {
    let n = 0, lags = [], last = 0, gap = 0;
    return {
      note(exch, local) { n++; if (exch > 0) { lags.push(local - exch); if (lags.length > 200) lags.shift(); } if (last) gap = Math.max(gap, local - last); last = local; },
      take(nowMs, dtMs) { const r = {n, hz:dtMs > 0 ? round(n/(dtMs/1000), 1) : null, lagMed:quantile(lags, .5), lagP90:quantile(lags, .9), lagMax:lags.length ? Math.max.apply(null, lags) : null, gapMs:gap, ageMs:last ? nowMs - last : null}; n = 0; gap = 0; return r; },
    };
  }

  // ---- derivatives context (collector "derivs", run by collectors-worker.js). Readers of the public endpoints; each returns null for an answer that is not usable.
  // Verified live 2026-10-23, see .scratch/collectors/01-collectors.md.
  const EVERY = {prem:15000, hl:15000, ratios:60000, basis:10000}, BACKOFF_MS = 300000;      // polling spacing per source; a rate-limited source rests this long
  const num = x => { const n = +x; return x != null && x !== "" && Number.isFinite(n) ? n : null; };
  const due = (last, now, every) => !last || now - last >= every;
  function premium(j) {
    const mark = j && num(j.markPrice); if (mark == null) return null;
    return {mark, index:num(j.indexPrice), est:num(j.estimatedSettlePrice), fund:num(j.lastFundingRate), next:num(j.nextFundingTime), t:num(j.time)};
  }
  function openInterest(j) { const oi = j && num(j.openInterest); return oi == null ? null : {oi, t:num(j.time)}; }
  // the newest point of a /futures/data answer (5 minute periods): kind "acct" / "top" (long-short share) or "taker" (buy and sell volume)
  function ratioPoint(kind, arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    const p = arr[arr.length - 1];
    if (kind === "taker") { const buy = num(p.buyVol), sell = num(p.sellVol); return buy == null || sell == null ? null : {buy, sell, ratio:num(p.buySellRatio), ts:num(p.timestamp)}; }
    const long = num(p.longAccount), short = num(p.shortAccount); return long == null || short == null ? null : {long, short, ratio:num(p.longShortRatio), ts:num(p.timestamp)};
  }
  const ratiosChanged = (prev, cur) => !prev || ["acct", "top", "taker"].some(k => (prev[k] && prev[k].ts) !== (cur[k] && cur[k].ts));      // the points only move every 5 minutes: no new point, no new record
  // Hyperliquid metaAndAssetCtxs: [{universe:[{name}]}, [ctx...]] with the contexts in the order of the universe
  function hlCtx(j, coin) {
    if (!Array.isArray(j) || !j[0] || !Array.isArray(j[0].universe) || !Array.isArray(j[1])) return null;
    const i = j[0].universe.findIndex(u => u.name === coin), c = i >= 0 && j[1][i]; if (!c) return null;
    const mark = num(c.markPx); if (mark == null) return null;
    return {fund:num(c.funding), oi:num(c.openInterest), prem:num(c.premium), oracle:num(c.oraclePx), mark, mid:num(c.midPx)};
  }
  function force(d) {
    const o = d && d.e === "forceOrder" && d.o; if (!o) return null;
    const qty = num(o.z) || num(o.q), px = num(o.ap) || num(o.p); if (!qty || !px) return null;
    return {side:o.S, qty, px, limit:num(o.p), status:o.X, T:num(o.T)};
  }
  // one markPrice@1s message: mark, index, funding and the next funding time; basis in bps of the index
  function basis(d) {
    const mark = d && num(d.p), index = d && num(d.i); if (mark == null || index == null || !index) return null;
    return {mark, index, fund:num(d.r), next:num(d.T), bps:round((mark - index)/index*1e4, 2)};
  }

  // ---- calendar tags (collector "calendar", run by collectors-worker.js): when scheduled things happen, by rule, no network. Times are UTC.
  // calendar(t0, t1) -> [{t, tags:[...]}] for every instant in (t0, t1], tags merged per instant. Tags: "15m", "1h", "4h", "1d", "1w" (Monday 00:00),
  // "1M" (the 1st), "funding" (00 / 08 / 16: the Binance 8 h rule; a symbol on another interval is not followed), "usOpen" / "usClose" (09:30 / 16:00 New York
  // on weekdays, daylight saving followed; exchange holidays are NOT known), "optExp:daily|weekly|monthly|quarterly" (08:00 UTC every day: Friday weekly,
  // last Friday of the month monthly, last Friday of Mar / Jun / Sep / Dec quarterly). Macro releases (CPI, FOMC, jobs) follow no rule: not here.
  const NY_FMT = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York", hourCycle:"h23", year:"numeric", month:"numeric", day:"numeric", hour:"numeric", minute:"numeric"}) : null;
  function nyOffsetMin(ms) {      // minutes New York is ahead of UTC at that instant (-300 or -240)
    const p = {}; for (const x of NY_FMT.formatToParts(new Date(ms))) p[x.type] = +x.value;
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms/60000)*60000)/60000);
  }
  function nyToUtc(y, m, d, h, mi) { const g = Date.UTC(y, m, d, h, mi); return g - nyOffsetMin(g - nyOffsetMin(g)*60000)*60000; }
  const lastFriday = (y, m) => { const last = new Date(Date.UTC(y, m + 1, 0)); return last.getUTCDate() - ((last.getUTCDay() - 5 + 7) % 7); };
  function calendar(t0, t1) {
    const map = new Map(), add = (t, tag) => { if (t > t0 && t <= t1) { if (!map.has(t)) map.set(t, []); map.get(t).push(tag); } };
    const Q = 900000;
    for (let t = (Math.floor(t0/Q) + 1)*Q; t <= t1; t += Q) {
      const d = new Date(t), h = d.getUTCHours(); add(t, "15m");
      if (d.getUTCMinutes() !== 0) continue;
      add(t, "1h"); if (h % 4 === 0) add(t, "4h");
      if (h === 0) { add(t, "1d"); if (d.getUTCDay() === 1) add(t, "1w"); if (d.getUTCDate() === 1) add(t, "1M"); }
      if (h % 8 === 0) add(t, "funding");
    }
    for (let D = Math.floor(t0/86400000) - 1; D <= Math.floor(t1/86400000) + 1; D++) {
      const d = new Date(D*86400000), y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate(), wd = d.getUTCDay();
      const monthly = wd === 5 && day === lastFriday(y, m);
      add(Date.UTC(y, m, day, 8), "optExp:" + (monthly ? (m % 3 === 2 ? "quarterly" : "monthly") : wd === 5 ? "weekly" : "daily"));
      if (wd >= 1 && wd <= 5) { add(nyToUtc(y, m, day, 9, 30), "usOpen"); add(nyToUtc(y, m, day, 16, 0), "usClose"); }      // (y, m, day) read as the New York date
    }
    return [...map].sort((a, b) => a[0] - b[0]).map(([t, tags]) => ({t, tags}));
  }

  // ---- book depth summaries (collector "book", run by collectors.js while a recording is on). The raw book the recording already keeps is shallow
  // (Binance 30 levels is under 1 bp for BTC, Hyperliquid 20 levels about 2.4 bps), so these summaries are where depth out to 25 bps comes from.
  const BOOK_EDGES = [1, 5, 10, 20];      // not 25: Binance's snapshot is 1000 levels (about 15 bps for BTC) and Hyperliquid's bucketed book reaches about 24 bps
  // book(bids, asks, edges): levels are [px, qty] in any order. Returns the mid, the spread in bps, the size at the best bid and ask, how far out the
  // data reaches on each side (bps from the mid) and the quantity within each edge: d[edge] = [bidQty, askQty], null where the data does not reach that far.
  // `reach` [bid, ask] (bps) overrides the farthest level seen, for a book that keeps stray far levels (Binance's local book does): the levels past the real
  // coverage are incomplete, so the reach there is only what the snapshot guaranteed.
  function book(bids, asks, edges, reach) {
    edges = edges || BOOK_EDGES;
    let bb = -Infinity, ba = Infinity, tb = 0, ta = 0;
    for (const l of bids) if (l[0] > bb) { bb = l[0]; tb = l[1]; }
    for (const l of asks) if (l[0] < ba) { ba = l[0]; ta = l[1]; }
    if (!(bb > 0) || !(ba > 0) || !Number.isFinite(ba) || ba <= bb) return null;
    const mid = (bb + ba)/2, k = 1e4/mid, sb = edges.map(() => 0), sa = edges.map(() => 0);
    let rb = 0, ra = 0;
    for (const l of bids) { const dist = (mid - l[0])*k; if (dist > rb) rb = dist; for (let i = 0; i < edges.length; i++) if (dist <= edges[i]) sb[i] += l[1]; }
    for (const l of asks) { const dist = (l[0] - mid)*k; if (dist > ra) ra = dist; for (let i = 0; i < edges.length; i++) if (dist <= edges[i]) sa[i] += l[1]; }
    if (reach) { rb = reach[0]; ra = reach[1]; }
    const d = {}; edges.forEach((e, i) => { d[e] = [rb >= e ? round(sb[i], 3) : null, ra >= e ? round(sa[i], 3) : null]; });
    return {mid:round(mid, 2), spr:round((ba - bb)*k, 2), tb:round(tb, 4), ta:round(ta, 4), reach:[round(rb, 1), round(ra, 1)], d};
  }
  // a fine book (exact prices, shallow) topped up with a coarse one (price buckets, deeper): each edge comes from the fine book where it reaches,
  // otherwise from the coarse one; `coarse` lists the edges that are bucket-resolution only (the bucket edge decides, so they are approximate).
  function mergeBook(fine, coarse) {
    if (!fine) return null;
    const d = {}, coarseEdges = [];
    for (const e in fine.d) {
      const f = fine.d[e], c = coarse && coarse.d[e], pick = i => f[i] != null ? f[i] : (c && c[i] != null ? c[i] : null);
      d[e] = [pick(0), pick(1)]; if ((f[0] == null && d[e][0] != null) || (f[1] == null && d[e][1] != null)) coarseEdges.push(+e);
    }
    return Object.assign({}, fine, {d, coarse:coarseEdges});
  }
  // size added and removed near the touch, from the book's incremental updates: note(side "b"|"a", qty before, qty after, bps from the mid), take() once a second.
  // "Removed" is a level shrinking or disappearing: a cancel or a trade, which this cannot tell apart.
  function flowStat(limitBps) {
    const z = () => ({add:0, rem:0, nAdd:0, nUp:0, nRed:0, nDel:0}); let s = {b:z(), a:z()};
    return {
      note(side, oldQ, newQ, distBps) {
        if (!(Math.abs(distBps) <= limitBps)) return;
        const x = s[side], o = oldQ || 0, n = newQ || 0;
        if (n === o) return;
        if (!o) { x.nAdd++; x.add += n; } else if (!n) { x.nDel++; x.rem += o; } else if (n > o) { x.nUp++; x.add += n - o; } else { x.nRed++; x.rem += o - n; }
      },
      take() { const r = s; s = {b:z(), a:z()}; for (const k of ["b", "a"]) { r[k].add = round(r[k].add, 3); r[k].rem = round(r[k].rem, 3); } return r; },
    };
  }

  // ---- extra venues (collector "venues", run by collectors-worker.js while a recording is on): the same instrument on other exchanges, to see who moves first and how
  // far apart the prices are. Raw quotes only; the perp-spot basis and the correlation are worked out afterwards. Public sockets, no keys.
  const MAJORS = ["eth", "sol", "bnb", "xrp", "doge"];      // Binance perp marks, for correlation (the symbol being watched is left out)
  // the sockets to open for a coin: {id, url, sub (sent on open), ping (sent every 20 s)}
  function venueSubs(coin) {
    const C = String(coin || "BTC").toUpperCase(), c = C.toLowerCase();
    return [
      {id:"cb", url:"wss://ws-feed.exchange.coinbase.com", sub:{type:"subscribe", product_ids:[C + "-USD"], channels:["ticker"]}},
      {id:"byL", url:"wss://stream.bybit.com/v5/public/linear", sub:{op:"subscribe", args:["tickers." + C + "USDT"]}, ping:{op:"ping"}},
      {id:"byS", url:"wss://stream.bybit.com/v5/public/spot", sub:{op:"subscribe", args:["tickers." + C + "USDT"]}, ping:{op:"ping"}},
      {id:"ok", url:"wss://ws.okx.com:8443/ws/v5/public", ping:"ping",
       sub:{op:"subscribe", args:[{channel:"tickers", instId:C + "-USDT-SWAP"}, {channel:"tickers", instId:C + "-USDT"}, {channel:"mark-price", instId:C + "-USDT-SWAP"}, {channel:"index-tickers", instId:C + "-USDT"}]}},
      {id:"bnS", url:"wss://stream.binance.com:9443/stream?streams=" + c + "usdt@bookTicker"},
      {id:"maj", url:"wss://fstream.binance.com/market/stream?streams=" + MAJORS.filter(m => m !== c).map(m => m + "usdt@markPrice@1s").join("/")},
    ];
  }
  // One parsed socket message -> {src, set, e} (e = the exchange's own time in ms, or null), or null for anything that is not a price. Fields: b / a = best bid / ask,
  // l = last trade, m = mark, i = index, f = funding rate. Sources: cb Coinbase spot, byL Bybit perp, byS Bybit spot, okS OKX swap, okP OKX spot, bnS Binance spot, maj the majors.
  // Bybit sends only the fields that changed, so a message is merged into what the source already holds (venueApply).
  const BYBIT = {bid1Price:"b", ask1Price:"a", lastPrice:"l", markPrice:"m", indexPrice:"i", fundingRate:"f"};
  function venueParse(id, j) {
    if (!j || typeof j !== "object") return null;
    const got = (src, pairs, e) => { const set = {}; let n = 0; for (const k in pairs) { const v = num(pairs[k]); if (v != null) { set[k] = v; n++; } } return n ? {src, set, e:e == null || !Number.isFinite(e) ? null : e} : null; };
    if (id === "cb") return j.type === "ticker" ? got("cb", {b:j.best_bid, a:j.best_ask, l:j.price}, Date.parse(j.time)) : null;
    if (id === "byL" || id === "byS") {
      if (!j.data || typeof j.topic !== "string" || j.topic.indexOf("tickers.") !== 0) return null;
      const pairs = {}; for (const k in BYBIT) if (j.data[k] != null) pairs[BYBIT[k]] = j.data[k];
      return got(id, pairs, num(j.ts));
    }
    if (id === "ok") {
      const d = j.arg && Array.isArray(j.data) && j.data[0]; if (!d) return null;
      if (j.arg.channel === "tickers") return got(d.instType === "SWAP" ? "okS" : "okP", {b:d.bidPx, a:d.askPx, l:d.last}, num(d.ts));
      if (j.arg.channel === "mark-price") return got("okS", {m:d.markPx}, num(d.ts));
      if (j.arg.channel === "index-tickers") return got("okS", {i:d.idxPx}, num(d.ts));
      return null;
    }
    if (id === "bnS") { const d = j.data; return d && d.b != null && d.a != null ? got("bnS", {b:d.b, a:d.a}, null) : null; }
    if (id === "maj") {
      const d = j.data; if (!d || d.e !== "markPriceUpdate" || typeof d.s !== "string") return null;
      const v = num(d.p); if (v == null) return null;
      return {src:"maj", set:{[d.s.toLowerCase().replace(/usdt$/, "")]:v}, e:num(d.E)};
    }
    return null;
  }
  function venueApply(state, p, nowMs) {
    if (!p) return;
    const s = state[p.src] || (state[p.src] = {f:{}, at:0, e:null});
    Object.assign(s.f, p.set); s.at = nowMs; s.e = p.e;
  }
  // the once-a-second record: each source's latest fields, `age` (ms since it last spoke) and `lag` (local time minus the exchange's time when it sends one)
  function venueRecord(state, nowMs) {
    const out = {}; let n = 0;
    for (const src in state) { const s = state[src]; out[src] = Object.assign({}, s.f, {age:nowMs - s.at}); if (s.e != null) out[src].lag = s.at - s.e; n++; }
    return n ? out : null;
  }

  // tape helpers on arrays of records
  const prune = (recs, nowMs, keepMs) => recs.filter(r => r[2] >= nowMs - (keepMs == null ? TAPE_MS : keepMs));
  const slice = (recs, t0, t1) => recs.filter(r => r[2] >= t0 && r[2] <= t1);
  // keep the newest records that fit in maxBytes of JSON
  function fit(recs, maxBytes) {
    const lim = maxBytes == null ? FILE_BUDGET : maxBytes, out = []; let size = 2;
    for (let i = recs.length - 1; i >= 0; i--) { const b = JSON.stringify(recs[i]).length + 1; if (size + b > lim) break; size += b; out.push(recs[i]); }
    return out.reverse();
  }
  return {REGISTRY, TAPE_MS, FILE_BUDGET, EVERY, BACKOFF_MS, quantile, rec, isRec, feeds, streamStat, due, calendar, MAJORS, venueSubs, venueParse, venueApply, venueRecord, BOOK_EDGES, book, mergeBook, flowStat, premium, openInterest, ratioPoint, ratiosChanged, hlCtx, force, basis, prune, slice, fit};
})();
