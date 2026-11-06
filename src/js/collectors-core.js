"use strict";
// Collectors (pure, no DOM, no timers): data worth keeping that no detector uses yet. Each collector writes records
// ["c", name, t, payload] (t in ms). They are kept on a rolling tape on the device and attached to a saved session as `ext`, beside `inputs`;
// the Reader engine never sees them (its replay ignores them), so they cannot change a detection. Spec: .scratch/collectors/01-collectors.md.
// (The record type letter is "c": "x" is already the engine's reset marker.)
const COLLECT = (() => {
  // The collector registry: ONE declaration per collector. OWNER, EXPECT_MS, FEATURES, FEATURE_INFO, the status list and the analysis scripts are all derived from it.
  //   id        name of the collector (what ownerOf() answers)       label / speed / on   shown in the list; "fast" ones write only while recording, "slow" ones always; default switch
  //   owner     where it runs: "worker" (collectors-worker.js) or "page" (collectors.js)      expectMs   how often it writes while working (three times that late is "slow")
  //   records   the record names it writes
  //   features  {feature name: [record name, fn(payload) -> number | null]}  and  info  {feature name: card display info}: added below, after the helpers they use
  // A new collector is one entry here (plus its own worker or page code); consumers iterate REGISTRY instead of naming collectors.
  const REGISTRY = [
    {id:"telemetry", label:"Self-telemetry: feed latency, message rates, gaps, clock offset", speed:"slow", on:true, owner:"worker", expectMs:30000, records:["feeds", "markPrice"]},
    {id:"derivs", label:"Derivatives context: funding, open interest, basis, liquidations, long/short and taker ratios (Binance, Hyperliquid)", speed:"slow", on:true, owner:"worker", expectMs:60000, records:["bnDerivs", "hlCtx", "ratios", "basis", "liq"]},
    {id:"calendar", label:"Calendar tags: funding times, 15m / 1h / 4h / daily / weekly / monthly closes, US open and close, options expiry (rules, no network)", speed:"slow", on:true, owner:"worker", expectMs:900000, records:["cal"]},
    {id:"book", label:"Book depth (while recording): depth within 1 / 5 / 10 / 20 bps, spread, touch size, size added and removed per side (Binance, Hyperliquid; the worker keeps its own books)", speed:"fast", on:true, owner:"worker", expectMs:10000, records:["bookBn", "bookHl"]},
    {id:"venues", label:"Extra venues (while recording or armed): Coinbase, Bybit and OKX quotes, Binance spot, perp marks and indexes, and the ETH / SOL / BNB / XRP / DOGE marks", speed:"fast", on:true, owner:"worker", expectMs:10000, records:["venues"]},
    {id:"tradeVol", label:"Venue trade volume (while recording or armed): coins traded per second on Binance, Bybit, OKX, Coinbase and Hyperliquid, perp and spot, buy and sell by aggressor", speed:"fast", on:true, owner:"worker", expectMs:10000, records:["tv"]},
    {id:"bookPerp", label:"Perp book depth, Bybit and OKX (while recording or armed): depth within 1 / 5 / 10 / 20 bps, spread, touch size, size added and removed per side, every 10 s, to compare with Binance and Hyperliquid", speed:"fast", on:true, owner:"worker", expectMs:10000, records:["bookBy", "bookOk"]},
    {id:"perpFlow", label:"Perp liquidations and open interest, Bybit and OKX (while recording or armed): every liquidation (side, price, size) and each venue's open interest every 10 s", speed:"fast", on:true, owner:"worker", expectMs:10000, records:["liqPerp", "oiPerp"]},
    {id:"vol24", label:"Venue 24 h volume: each venue's own ticker volume in dollars, for market share and the perp / spot split", speed:"slow", on:true, owner:"worker", expectMs:60000, records:["vol24"]},
    {id:"wallets", label:"Hyperliquid wallets: position and liquidation price of the 10 biggest traders, their liquidation fills, predicted funding across venues", speed:"slow", on:true, owner:"worker", expectMs:180000, records:["walletsTop", "hlLiq", "fundPred"]},
    {id:"options", label:"Options and volatility (Deribit, BTC and ETH): volatility index, at-the-money implied vol, skew, open interest and busiest strikes by expiry", speed:"slow", on:true, owner:"worker", expectMs:60000, records:["dvol", "optChain"]},
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
  const EVERY = {prem:15000, hl:15000, ratios:60000, basis:10000, wallets:30000, funding:60000, options:120000, dvol:10000, vol24:60000}, BACKOFF_MS = 300000;      // polling spacing per source; a rate-limited source rests this long
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

  // ---- extra venues (collector "venues", run by collectors-worker.js while a recording is on or auto-record is armed): the same instrument on other exchanges, to see who moves first and how
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

  // ---- Hyperliquid wallets (collector "wallets", run by collectors-worker.js). The trade stream names both wallets of every fill, so the 10 that traded the most in the
  // last 15 minutes are followed: their position and liquidation price are read every 30 s, and their fills on any coin are watched for liquidations. The ranking is by
  // traded notional in this coin (that favours market makers and bots; there is no public ranking by position size). Addresses are kept in full, in data files only.
  const WALLET_TOP = 10, WALLET_WIN_MS = 900000, WALLET_REFRESH_MS = 300000;
  function walletTracker(winMs) {
    const win = winMs || WALLET_WIN_MS, q = [], sums = new Map(); let head = 0;
    const drop = nowMs => { while (head < q.length && q[head][0] < nowMs - win) { const [, w, v] = q[head++]; const s = sums.get(w) - v; if (s > 1e-6) sums.set(w, s); else sums.delete(w); } if (head > 4096) { q.splice(0, head); head = 0; } };
    return {
      // one fill: t its time, users [buyer, seller], ntl its notional in dollars; both wallets are credited with it
      note(t, users, ntl, nowMs) { if (!Array.isArray(users) || !(ntl > 0) || !Number.isFinite(t)) return; for (const w of users) if (typeof w === "string" && w) { q.push([t, w, ntl]); sums.set(w, (sums.get(w) || 0) + ntl); } drop(nowMs == null ? t : nowMs); },
      top(n, nowMs) { drop(nowMs); return [...sums].sort((a, b) => b[1] - a[1]).slice(0, n == null ? WALLET_TOP : n).map(([w, v]) => ({w, n:Math.round(v)})); },
      size() { return sums.size; },
    };
  }
  // clearinghouseState -> the wallet's position in one coin (sz 0 when it has none) and its account
  function walletPosition(j, coin) {
    const m = j && j.marginSummary; if (!m || num(m.accountValue) == null) return null;
    const ap = Array.isArray(j.assetPositions) ? j.assetPositions.map(x => x && x.position).find(p => p && p.coin === coin) : null;
    return {sz:ap ? num(ap.szi) || 0 : 0, e:ap ? num(ap.entryPx) : null, lq:ap ? num(ap.liquidationPx) : null, lev:ap && ap.leverage ? num(ap.leverage.value) : null, up:ap ? num(ap.unrealizedPnl) : null,
      av:round(num(m.accountValue), 0), mg:round(num(m.totalMarginUsed) || 0, 0)};
  }
  // does this reading need a record: first reading, a different position (size, entry, leverage, liquidation price), or the refresh time has passed
  function walletChanged(prev, cur, ageMs) {
    return !prev || prev.sz !== cur.sz || prev.e !== cur.e || prev.lev !== cur.lev || prev.lq !== cur.lq || ageMs >= WALLET_REFRESH_MS;
  }
  // a live userFills message -> the fills that carry a liquidation. The first message of a subscription is a snapshot of old fills: ignored.
  function liqFills(j) {
    const d = j && j.channel === "userFills" && j.data; if (!d || d.isSnapshot || !Array.isArray(d.fills)) return [];
    return d.fills.filter(f => f && f.liquidation).map(f => ({w:d.user, coin:f.coin, side:f.side, px:num(f.px), sz:num(f.sz), t:num(f.time), dir:f.dir, pnl:num(f.closedPnl), start:num(f.startPosition),
      liquidated:f.liquidation.liquidatedUser, mark:num(f.liquidation.markPx), method:f.liquidation.method}));
  }
  // predictedFundings -> {venue: [rate, next funding time, interval hours]} for one coin, venue names without "Perp" ("Bin", "Hl", "Bybit")
  function predictedFunding(j, coin) {
    const row = Array.isArray(j) && j.find(r => Array.isArray(r) && r[0] === coin); if (!row || !Array.isArray(row[1])) return null;
    const out = {}; for (const v of row[1]) if (Array.isArray(v) && v[1] && num(v[1].fundingRate) != null) out[String(v[0]).replace(/Perp$/, "")] = [num(v[1].fundingRate), num(v[1].nextFundingTime), num(v[1].fundingIntervalHours)];
    return Object.keys(out).length ? out : null;
  }

  // ---- options and volatility (collector "options", run by collectors-worker.js). Deribit's public API, no key. Implied vols are in percent, as Deribit gives them.
  const MON = {JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11};
  const deribitCoin = sym => { const c = String(sym || "").toUpperCase(); return c === "BTC" || c === "ETH" ? c : null; };      // the coins with options and a volatility index there
  // "BTC-27NOV26-73000-P" -> expiry label, expiry time (08:00 UTC on the day, Deribit's rule), strike and C / P
  function optName(n) {
    const m = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(String(n)); if (!m || !(m[3] in MON)) return null;
    return {x:m[2] + m[3] + m[4], t:Date.UTC(2000 + +m[4], MON[m[3]], +m[2], 8), k:+m[5], cp:m[6]};
  }
  // get_book_summary_by_currency (kind option) -> the index and, for the nExp nearest expiries still to come: forward `f`, days to expiry `dte`, at-the-money implied vol `atm`
  // (the strike nearest the forward, call and put averaged), the out-of-the-money implied vol at -10 / -5 / +5 / +10 % of the forward `s` (a put below, a call above, the
  // nearest listed strike within 3 %, else null), call / put open interest `oc` / `op` and 24 h volume `vc` / `vp` (coins), and the 5 strikes with the most open interest `pin`.
  // `tot` adds open interest and volume over every expiry.
  function optionsChain(list, nowMs, nExp) {
    nExp = nExp || 5; const by = new Map(), tot = {oc:0, op:0, vc:0, vp:0}; let u = null;
    for (const s of Array.isArray(list) ? list : []) {
      const o = s && optName(s.instrument_name); if (!o || o.t <= nowMs) continue;
      if (u == null) u = num(s.estimated_delivery_price);
      const oi = num(s.open_interest) || 0, vol = num(s.volume) || 0;
      let e = by.get(o.t); if (!e) by.set(o.t, e = {x:o.x, t:o.t, f:null, opts:[]});
      if (e.f == null) e.f = num(s.underlying_price);
      e.opts.push({k:o.k, cp:o.cp, iv:num(s.mark_iv), oi, vol});
      if (o.cp === "C") { tot.oc += oi; tot.vc += vol; } else { tot.op += oi; tot.vp += vol; }
    }
    const exps = [...by.values()].sort((a, b) => a.t - b.t).slice(0, nExp).map(e => {
      const F = e.f, r = {x:e.x, dte:round((e.t - nowMs)/86400000, 2), f:F == null ? null : round(F, 2), atm:null, s:{}, oc:0, op:0, vc:0, vp:0, pin:[]};
      const byK = new Map();
      for (const o of e.opts) {
        if (o.cp === "C") { r.oc += o.oi; r.vc += o.vol; } else { r.op += o.oi; r.vp += o.vol; }
        byK.set(o.k, (byK.get(o.k) || 0) + o.oi);
      }
      if (F != null && F > 0) {
        let best = null;
        for (const k of byK.keys()) {
          const c = e.opts.find(o => o.k === k && o.cp === "C" && o.iv != null), p = e.opts.find(o => o.k === k && o.cp === "P" && o.iv != null);
          if (c && p && (best == null || Math.abs(k - F) < Math.abs(best.k - F))) best = {k, iv:(c.iv + p.iv)/2};
        }
        r.atm = best ? round(best.iv, 2) : null;
        for (const m of [-10, -5, 5, 10]) {
          const want = F*(1 + m/100), pool = e.opts.filter(o => o.cp === (m < 0 ? "P" : "C") && o.iv != null);
          let near = null; for (const o of pool) if (near == null || Math.abs(o.k - want) < Math.abs(near.k - want)) near = o;
          r.s[m] = near && Math.abs(near.k - want) <= 0.03*F ? round(near.iv, 2) : null;
        }
      }
      for (const k of ["oc", "op", "vc", "vp"]) r[k] = round(r[k], 1);
      r.pin = [...byK].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [k, round(v, 1)]);
      return r;
    });
    if (!exps.length) return null;
    for (const k in tot) tot[k] = round(tot[k], 1);
    return {u:u == null ? null : round(u, 2), exps, tot};
  }

  // ---- status of each collector, for the list in the Reader tab (view: collectors.js)
  // derived from REGISTRY: which collector writes which record name; how often (ms) a collector writes while it is working (three times that late is "slow")
  const OWNER = {}; for (const c of REGISTRY) for (const n of c.records) OWNER[n] = c.id;
  const EXPECT_ORDER = ["telemetry", "derivs", "calendar", "wallets", "options", "venues", "tradeVol", "vol24", "book", "bookPerp", "perpFlow"];      // the order the analysis reports list collectors in (it is not the registry order); kept as it was
  const EXPECT_MS = {}; for (const id of EXPECT_ORDER) EXPECT_MS[id] = REGISTRY.find(c => c.id === id).expectMs;
  const ownerOf = name => OWNER[name] || null;
  // records -> {collectorId: {n, last}} (last = the newest record time)
  function tally(recs) {
    const out = {};
    for (const r of recs) { const id = isRec(r) && OWNER[r[1]]; if (!id) continue; const s = out[id] || (out[id] = {n:0, last:0}); s.n++; if (r[2] > s.last) s.last = r[2]; }
    return out;
  }
  function ageText(ms) { return ms < 90000 ? Math.max(0, Math.round(ms/1000)) + " s" : ms < 5400000 ? Math.round(ms/60000) + " min" : round(ms/3600000, 1) + " h"; }
  // one line of status: o = {on (switch), why (text when it cannot be working now, else null), n (records on the tape), ageMs (since its last record, null if none), expectMs, sinceMs (page open for)}
  // -> {text, tone: "ok" | "warn" | "info" | "idle" | "off"}
  function health(o) {
    if (!o.on) return {text:"off", tone:"off"};
    const n = o.n ? o.n.toLocaleString("en-US") + " on the tape" : "";
    if (o.why) return {text:o.why + (n ? " · " + n : ""), tone:"idle"};
    if (o.ageMs == null) return o.sinceMs > o.expectMs*3 + 60000 ? {text:"nothing written yet: check the Health log", tone:"warn"} : {text:"starting…", tone:"info"};
    return o.ageMs <= o.expectMs*3 ? {text:n + " · last " + ageText(o.ageMs) + " ago", tone:"ok"} : {text:n + " · last " + ageText(o.ageMs) + " ago, slower than expected", tone:"warn"};
  }

  // ---- features and context: what the collectors read, as numbers a person can read (shared by the offline analysis scripts and the episode cards)
  // FEATURES: name -> [record name, function(payload) -> number | null]
  const fmid = q => (q && num(q.b) != null && num(q.a) != null ? (q.b + q.a)/2 : null);
  const fimb = (p, e) => { const d = p && p.d && p.d[e]; return d && num(d[0]) != null && num(d[1]) != null && d[0] + d[1] > 0 ? (d[0] - d[1])/(d[0] + d[1]) : null; };
  const fdep = (p, e) => { const d = p && p.d && p.d[e]; return d && num(d[0]) != null && num(d[1]) != null ? d[0] + d[1] : null; };
  // What each collector contributes (see REGISTRY): its features and how a card shows them. Added to the registry entry here because the functions use the helpers above.
  const CONTRIB = {
    derivs: {
      features: {
        "bnDerivs.fund":      ["bnDerivs", p => p.prem && num(p.prem.fund)],
        "bnDerivs.basisBps":  ["bnDerivs", p => p.prem && num(p.prem.mark) != null && p.prem.index ? (p.prem.mark - p.prem.index)/p.prem.index*1e4 : null],
        "bnDerivs.oi":        ["bnDerivs", p => p.oi && num(p.oi.oi)],
        "hlCtx.fund":         ["hlCtx", p => num(p.fund)],
        "hlCtx.prem":         ["hlCtx", p => num(p.prem)],
        "hlCtx.oi":           ["hlCtx", p => num(p.oi)],
        "ratios.accountLS":   ["ratios", p => p.acct && num(p.acct.ratio)],
        "ratios.topLS":       ["ratios", p => p.top && num(p.top.ratio)],
        "ratios.taker":       ["ratios", p => p.taker && num(p.taker.ratio)],
        "basis.bps":          ["basis", p => num(p.bps)],
      },
      info: {
        "bnDerivs.fund":{label:"Binance funding", unit:"bps", scale:1e4, min:0.2}, "bnDerivs.basisBps":{label:"Binance basis", unit:"bps", min:0.3}, "bnDerivs.oi":{label:"Binance open interest", rel:true, min:0.1},
        "hlCtx.fund":{label:"Hyperliquid funding", unit:"bps", scale:1e4, min:0.2}, "hlCtx.prem":{label:"Hyperliquid premium", unit:"bps", scale:1e4, min:0.3}, "hlCtx.oi":{label:"Hyperliquid open interest", rel:true, min:0.1},
        "ratios.taker":{label:"taker buy/sell", unit:"", min:0.1}, "basis.bps":{label:"mark vs index", unit:"bps", min:0.3},
      },
    },
    book: {
      features: {
        "bookBn.spread":      ["bookBn", p => num(p.spr)],
        "bookBn.imbalance5":  ["bookBn", p => fimb(p, 5)],
        "bookBn.depth5":      ["bookBn", p => fdep(p, 5)],
        "bookHl.spread":      ["bookHl", p => num(p.spr)],
        "bookHl.imbalance5":  ["bookHl", p => fimb(p, 5)],
        "bookHl.depth5":      ["bookHl", p => fdep(p, 5)],
      },
      info: {
        "bookBn.imbalance5":{label:"Binance book imbalance (5 bps)", unit:"", min:0.1}, "bookBn.depth5":{label:"Binance depth (5 bps)", rel:true, min:10}, "bookHl.depth5":{label:"Hyperliquid depth (5 bps)", rel:true, min:10}, "bookHl.imbalance5":{label:"Hyperliquid book imbalance (5 bps)", unit:"", min:0.1},
      },
    },
    venues: {
      features: {
        "venues.coinbaseVsBinanceBps": ["venues", p => { const m = fmid(p.bnS), c = p.cb && num(p.cb.l); return m && c != null ? (c - m)/m*1e4 : null; }],
        "venues.bybitVsBinanceBps":    ["venues", p => { const m = fmid(p.bnS), c = p.byL && num(p.byL.l); return m && c != null ? (c - m)/m*1e4 : null; }],
      },
      info: {"venues.coinbaseVsBinanceBps":{label:"Coinbase vs Binance", unit:"bps", min:0.5}, "venues.bybitVsBinanceBps":{label:"Bybit vs Binance", unit:"bps", min:0.5}},
    },
    options: {
      features: {
        "dvol.vol":           ["dvol", p => num(p.vol)],
        "optChain.atmVol":    ["optChain", p => p.exps && p.exps[0] && num(p.exps[0].atm)],
        "optChain.skew5":     ["optChain", p => p.exps && p.exps[0] && p.exps[0].s && num(p.exps[0].s["-5"]) != null && num(p.exps[0].s["5"]) != null ? p.exps[0].s["-5"] - p.exps[0].s["5"] : null],
      },
      info: {
        "dvol.vol":{label:"volatility index", rel:true, min:0.3},
        "optChain.atmVol":{label:"option ATM vol", rel:true, min:1}, "optChain.skew5":{label:"option skew (-5/+5%)", unit:"pts", min:1},
      },
    },
  };
  for (const c of REGISTRY) { const k = CONTRIB[c.id] || {}; c.features = k.features || {}; c.info = k.info || {}; }      // every collector has both, empty if it contributes none
  // FEATURES: name -> [record name, function(payload) -> number | null], FEATURE_INFO: name -> how a card shows it (a short name, and whether its change reads as a percentage of
  // its recent level (`rel`) or in its own unit (`unit`)). Both are the union of the registry's contributions. The ORDER of FEATURES is fixed (analysis plans depend on it, the
  // multiple-comparison count and the report lines follow it); the self-test checks that this list and the contributions are the same set.
  const FEATURE_ORDER = ["dvol.vol", "bnDerivs.fund", "bnDerivs.basisBps", "bnDerivs.oi", "hlCtx.fund", "hlCtx.prem", "hlCtx.oi", "ratios.accountLS", "ratios.topLS", "ratios.taker", "basis.bps",
    "bookBn.spread", "bookBn.imbalance5", "bookBn.depth5", "bookHl.spread", "bookHl.imbalance5", "bookHl.depth5", "venues.coinbaseVsBinanceBps", "venues.bybitVsBinanceBps", "optChain.atmVol", "optChain.skew5"];
  const FEATURES = {}, FEATURE_INFO = {}, allF = {}, allI = {};
  for (const c of REGISTRY) { Object.assign(allF, c.features); Object.assign(allI, c.info); }
  for (const f of FEATURE_ORDER) { if (allF[f]) FEATURES[f] = allF[f]; if (allI[f]) FEATURE_INFO[f] = allI[f]; }
  for (const f in allF) if (!(f in FEATURES)) FEATURES[f] = allF[f];      // a feature of a new collector not yet in the list goes last (the self-test flags it)
  for (const f in allI) if (!(f in FEATURE_INFO)) FEATURE_INFO[f] = allI[f];
  // the feature over time: at most one value per step, with `dev` = value minus the mean of the previous winMs (null until 5 earlier values exist)
  function featureSeries(rows, fn, stepMs, winMs) {
    const out = [], win = []; let sum = 0, lastT = -Infinity;
    for (const r of rows) {
      if (r[2] - lastT < stepMs) continue;
      let x = null; try { x = fn(r[3] || {}); } catch {}
      if (num(x) == null) continue;
      while (win.length && win[0][0] < r[2] - winMs) sum -= win.shift()[1];
      out.push({t:r[2], x, dev:win.length >= 5 ? x - sum/win.length : null});
      win.push([r[2], x]); sum += x; lastT = r[2];
    }
    return out;
  }
  const featureMaxAge = f => f.indexOf("ratios.") === 0 ? 900000 : Math.max(3*(EXPECT_MS[OWNER[FEATURES[f][0]]] || 60000), 120000);      // how old a reading may be and still count
  // context(recs, tMs): what the collector records (any order, any times) said at time tMs, as the deviation of each shown feature from its own mean of the previous 30 minutes.
  // `z` is that deviation in standard deviations of the same window; `unusual` is |z| >= zMin AND a move worth seeing (FEATURE_INFO.min, in the shown unit: a funding rate that moved 0.03 bps can be many standard deviations of its own jitter and still mean nothing). `liq` counts the Binance liquidations and the Hyperliquid liquidation fills in the minute before.
  function context(recs, tMs, opt) {
    opt = opt || {}; const winMs = (opt.winSec || 1800)*1000, zMin = opt.zMin || 1.5, by = {}; let lb = 0, lh = 0;
    for (const r of recs) {
      if (!isRec(r) || r[2] > tMs || r[2] < tMs - winMs - 120000) continue;
      (by[r[1]] || (by[r[1]] = [])).push(r);
      if (r[2] > tMs - 60000) { if (r[1] === "liq") lb++; else if (r[1] === "hlLiq") lh++; }
    }
    const items = [];
    for (const f in FEATURE_INFO) {
      const rows = by[FEATURES[f][0]]; if (!rows || rows.length < 6) continue;
      rows.sort((a, b) => a[2] - b[2]);
      const ser = featureSeries(rows, FEATURES[f][1], 10000, winMs), q = ser[ser.length - 1];
      if (!q || q.dev == null || tMs - q.t > featureMaxAge(f)) continue;
      const prev = ser.slice(0, -1).filter(s => s.t >= q.t - winMs).map(s => s.x); if (prev.length < 5) continue;
      const mean = prev.reduce((a, b) => a + b, 0)/prev.length, sd = Math.sqrt(prev.reduce((a, b) => a + (b - mean)*(b - mean), 0)/prev.length), info = FEATURE_INFO[f];
      const z = sd > 1e-12*Math.max(1, Math.abs(mean)) ? q.dev/sd : (Math.abs(q.dev) > 1e-9*Math.max(1, Math.abs(mean)) ? (q.dev > 0 ? 99 : -99) : 0);
      const mag = info.rel ? (mean ? Math.abs(q.dev/mean)*100 : 0) : Math.abs(q.dev)*(info.scale || 1);
      items.push({f, label:info.label, x:q.x, dev:q.dev, mean, z:round(z, 2), unusual:Math.abs(z) >= zMin && mag >= (info.min || 0), text:cardText(info, q.dev, mean)});
    }
    items.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    return {t:tMs, items, liq:{bn:lb, hl:lh}, lead:venueLead(by.venues || [], tMs), liqx:liqDriven(recs, tMs, {coin:opt.coin})};
  }
  function cardText(info, dev, mean) {
    const sign = dev >= 0 ? "+" : "-", a = Math.abs(dev);
    if (info.rel) return mean ? sign + round(a/Math.abs(mean)*100, a/Math.abs(mean) < 0.1 ? 2 : 1) + "%" : sign + round(a, 2);
    const v = a*(info.scale || 1); return sign + round(v, v < 10 ? 2 : 1) + (info.unit ? " " + info.unit : "");
  }

  // ---- who moved first (v079): over the 60 s before an episode was detected, when each venue's own price covered half of the move that all venues made, against Binance spot.
  // Prices differ by level (Coinbase is USD, the others USDT, perps carry a basis), so only each venue's CHANGE over the window is used. The records come about once a second, so
  // "with" means within `withSec` (2 s) of the reference; a venue that moved less than half of `minBps` is "flat", one that moved the other way "against".
  const LEAD_SRC = {cb:"Coinbase", byL:"Bybit perp", byS:"Bybit spot", okS:"OKX swap", okP:"OKX spot", bnS:"Binance spot"}, LEAD_REF = "bnS";
  function venueLead(rows, tMs, opt) {
    opt = opt || {}; const winMs = (opt.winSec || 60)*1000, minBps = opt.minBps == null ? 2 : opt.minBps, withMs = (opt.withSec == null ? 2 : opt.withSec)*1000, maxAge = opt.maxAgeMs || 5000, t0 = tMs - winMs;
    const rs = rows.filter(r => isRec(r) && r[1] === "venues" && r[2] <= tMs && r[2] >= t0).sort((a, b) => a[2] - b[2]);
    if (!rs.length) return null;
    const ser = {};
    for (const r of rs) for (const s in LEAD_SRC) {
      const q = r[3] && r[3][s]; if (!q || !(q.age <= maxAge)) continue;      // a source that had gone quiet is not a reading
      const p = num(q.b) != null && num(q.a) != null ? (q.b + q.a)/2 : num(q.l);
      if (p != null && p > 0) (ser[s] || (ser[s] = [])).push([r[2], p]);
    }
    const none = why => ({t:tMs, ref:LEAD_REF, none:why, items:[]}), mv = {};
    for (const s in ser) {
      const a = ser[s]; if (a.length < 15 || a[0][0] > t0 + winMs*0.3 || a[a.length - 1][0] < tMs - 5000) continue;      // needs most of the window
      mv[s] = {a, p0:a[0][1], bps:(a[a.length - 1][1] - a[0][1])/a[0][1]*1e4};
    }
    if (!mv[LEAD_REF]) return none("too few readings from Binance spot");
    const moves = Object.values(mv).map(m => m.bps).sort((x, y) => x - y);
    if (moves.length < 3) return none("too few venues");
    const cons = moves.length % 2 ? moves[(moves.length - 1)/2] : (moves[moves.length/2 - 1] + moves[moves.length/2])/2, sg = cons >= 0 ? 1 : -1;
    if (Math.abs(cons) < minBps) return none("no clear move");
    const reach = (m, f) => { const total = m.a[m.a.length - 1][1] - m.p0; for (const [t, p] of m.a) if ((p - m.p0)*sg >= Math.abs(total)*f) return t; return null; };      // first time it had covered the fraction f of its move
    const half = m => reach(m, 0.5);
    const tRef = mv[LEAD_REF].bps*sg >= minBps/2 ? half(mv[LEAD_REF]) : null;
    if (tRef == null) return none("Binance spot did not move");
    const q1 = reach(mv[LEAD_REF], 0.25), q3 = reach(mv[LEAD_REF], 0.75);
    if (q1 == null || q3 == null || q3 - q1 > winMs*0.4) return none("gradual move, no timing");      // a drift that stepped along has no moment to compare
    const items = [];
    for (const s in mv) {
      if (s === LEAD_REF) continue;
      const m = mv[s], mine = m.bps*sg, row = {src:s, label:LEAD_SRC[s], move:round(m.bps, 1)};
      if (Math.abs(m.bps) < minBps/2) row.kind = "flat";
      else if (mine < 0) row.kind = "against";
      else { const lead = (tRef - half(m))/1000; row.lead = round(lead, 1); row.kind = Math.abs(lead*1000) < withMs ? "with" : lead > 0 ? "led" : "lagged"; }
      items.push(row);
    }
    items.sort((x, y) => (y.lead == null ? -1e9 : y.lead) - (x.lead == null ? -1e9 : x.lead));
    return {t:tMs, ref:LEAD_REF, move:round(mv[LEAD_REF].bps, 1), cons:round(cons, 1), items};
  }
  function leadText(x) {
    switch (x.kind) {
      case "led": return x.label + " led by ~" + x.lead + " s";
      case "lagged": return x.label + " lagged by ~" + (-x.lead) + " s";
      case "with": return x.label + " with it";
      case "flat": return x.label + " flat";
      default: return x.label + " moved the other way";
    }
  }

  // ---- was it forced flow? (v080) The forced orders in the 60 s before an episode was detected: Binance liquidations of this symbol, and the Hyperliquid liquidation fills of the
  // followed wallets in this coin only (the followed wallet is the counterparty: it BOUGHT when the liquidated trader was forced to sell). Notional in dollars.
  // Rule, written before looking at episodes: "liquidation-driven" = at least `minUsd` (500k) in the window AND at least `ratio` (10) times the average minute of the previous
  // hour (when less than 10 minutes of earlier data exist, the floor alone decides). Most minutes hold nothing (76% in the first 17 recordings), the 99th percentile of a minute was about 3.6M.
  function liqDriven(recs, tMs, opt) {
    opt = opt || {}; const winMs = (opt.winSec || 60)*1000, histMs = (opt.histMin || 60)*60000, minUsd = opt.minUsd == null ? 5e5 : opt.minUsd, ratio = opt.ratio || 10, coin = String(opt.coin || "BTC").toUpperCase();
    const w = {bn:{sell:0, buy:0, n:0}, hl:{sell:0, buy:0, n:0}}; let hist = 0, first = opt.since == null ? Infinity : opt.since, other = 0;
    for (const r of recs) {
      if (!isRec(r) || r[2] > tMs) continue;
      if (r[2] < first) first = r[2];      // any record shows how far back the data reaches
      const p = r[3] || {}; let k, sell, usd;
      if (r[1] === "liq") { k = "bn"; sell = p.side === "SELL"; usd = (num(p.qty) || 0)*(num(p.px) || 0); }
      else if (r[1] === "hlLiq") {
        if (String(p.coin).toUpperCase() !== coin) { if (r[2] > tMs - winMs) other++; continue; }
        k = "hl"; sell = p.side === "B"; usd = (num(p.sz) || 0)*(num(p.px) || 0);
      } else continue;
      if (!(usd > 0)) continue;
      if (r[2] > tMs - winMs) { const x = w[k]; x[sell ? "sell" : "buy"] += usd; x.n++; }
      else if (r[2] >= tMs - winMs - histMs) hist += usd;
    }
    const sell = w.bn.sell + w.hl.sell, buy = w.bn.buy + w.hl.buy, usd = sell + buy, avail = first === Infinity ? 0 : Math.min(histMs, tMs - winMs - first)/60000;
    const avg = avail >= 10 ? hist/avail : null, x = avg ? usd/avg : null;
    const tag = usd >= minUsd && (avg == null || avg === 0 || usd >= ratio*avg);
    for (const k in w) for (const f of ["sell", "buy"]) w[k][f] = Math.round(w[k][f]);
    return {t:tMs, usd:Math.round(usd), sell:Math.round(sell), buy:Math.round(buy), side:usd ? (sell/usd >= 0.7 ? "sells" : buy/usd >= 0.7 ? "buys" : "mixed") : null,
      bn:w.bn, hl:w.hl, other, avg:avg == null ? null : Math.round(avg), x:x == null ? null : round(x, 1), histMin:Math.round(avail), tag};
  }
  const usdText = v => v >= 1e6 ? "$" + round(v/1e6, 1) + "M" : v >= 1e3 ? "$" + Math.round(v/1e3) + "k" : "$" + Math.round(v);

  // ---- wall quality (v081): what the book depth summaries (collector "book", recordings only) say about a wall episode, as an independent view of the engine's own reading.
  // wall = an episode group {venue "bn"|"hl", wall:{side "bid"|"ask", px, peak (base units)}, tStart, tEnd (null while open), tUpdate}. Depth is the quantity within an edge (1 / 5 / 10 / 20 bps)
  // on the wall's side, taken at the smallest edge that holds the wall's distance from the mid at its start. Shown: the wall's share of that depth, that depth against its usual (median of the
  // 30 minutes before), and what the depth did until the end. Fixed words: depth fell to half or less, with the mid still 2+ bps from the wall = "pulled before price arrived"; fell to half or less
  // with the mid closer = "gone with price at the wall"; 80% or more kept = "depth held"; otherwise "partly gone". No verdict when the wall is under 20% of that depth. Records within 10 s of the moment count.
  function wallQuality(recs, g, opt) {
    opt = opt || {}; const name = g && g.venue === "bn" ? "bookBn" : g && g.venue === "hl" ? "bookHl" : null, none = why => ({none:why, venue:g && g.venue});
    if (!name || !g.wall) return null;
    const rows = recs.filter(r => isRec(r) && r[1] === name && r[3] && r[3].d).sort((x, y) => x[2] - y[2]);
    if (!rows.length) return none("no book records (they exist only while recording)");
    const nearest = t => { let b = null, bd = Infinity; for (const r of rows) { const d = Math.abs(r[2] - t); if (d < bd) { bd = d; b = r; } if (r[2] > t && d > bd) break; } return bd <= 10000 ? b : null; };
    const w = g.wall, i = w.side === "bid" ? 0 : 1, r0 = nearest(g.tStart);
    if (!r0) return none("no book record within 10 s of the wall's start");
    const mid0 = num(r0[3].mid); if (!(mid0 > 0)) return none("book record without a mid");
    const dist0 = Math.abs(w.px - mid0)/mid0*1e4, edge = BOOK_EDGES.find(e => e >= dist0);
    if (!edge) return none("wall is " + round(dist0, 1) + " bps from the mid, beyond the " + BOOK_EDGES[BOOK_EDGES.length - 1] + " bps the summaries reach");
    const d0 = r0[3].d[edge] && num(r0[3].d[edge][i]);
    if (d0 == null || !(d0 > 0)) return none("the book did not reach " + edge + " bps on that side");
    const prior = rows.filter(r => r[2] < g.tStart && r[2] >= g.tStart - 1800000).map(r => r[3].d[edge] && num(r[3].d[edge][i])).filter(v => v != null).sort((x, y) => x - y);
    const usual = prior.length >= 20 ? (prior.length % 2 ? prior[(prior.length - 1)/2] : (prior[prior.length/2 - 1] + prior[prior.length/2])/2) : null;
    const out = {venue:g.venue, side:w.side, edge, dist0:round(dist0, 2), depth0:round(d0, 3), peak:round(w.peak, 3), share:round(Math.min(1, w.peak/d0), 2), usual:usual == null ? null : round(usual, 3), x:usual ? round(d0/usual, 1) : null, open:g.tEnd == null};
    const tE = g.tEnd != null ? g.tEnd : g.tUpdate, r1 = nearest(tE);
    if (!r1 || r1 === r0) { out.end = null; out.verdict = null; return out; }
    const m1 = num(r1[3].mid), d1 = r1[3].d[edge] && num(r1[3].d[edge][i]);
    if (d1 == null || !(m1 > 0)) { out.end = null; out.verdict = null; return out; }
    const dist1 = (w.side === "bid" ? m1 - w.px : w.px - m1)/m1*1e4, ret = d1/d0;      // negative distance: the mid went through the wall
    out.end = {t:r1[2], depth:round(d1, 3), dist:round(dist1, 2), ret:round(ret, 2)};
    out.weak = out.share < 0.2;      // a wall that is under a fifth of the depth says little through that depth
    out.verdict = out.weak ? null : ret <= 0.5 ? (dist1 >= 2 ? "pulled before price arrived" : "gone with price at the wall") : ret >= 0.8 ? "depth held" : "partly gone";
    return out;
  }

  // ---- market state (v082): a plain label for "what kind of market is this moment", from the past only, with its reasons. Rules version 1, written before looking at any episode
  // (.scratch/collector-features/spec.md, step D); a change is a new version, never an edit. Indicators, each true / false / null (no reading):
  //   V volatility index above its own previous 30 minutes (1.5 sd and 0.3%, the `context` rule); L "liquidation-driven" (liqDriven) at some moment of the last 5 minutes;
  //   F Coinbase or Bybit vs Binance gap unusual (context rule); C funding unusual on Binance or Hyperliquid AND open interest on either not below its 30-minute mean.
  // States, first match wins: stressed (2+ of V, L, F), crowded (C), unsettled (exactly one of V, L, F), calm (none of the four, at least 3 had a reading), unknown.
  const STATE_VERSION = 1;
  function marketState(recs, tMs, opt) {
    opt = opt || {};
    const c = opt.ctx || context(recs, tMs, {coin:opt.coin}), by = f => c.items.find(x => x.f === f);
    const anyOf = (fs, test) => { let seen = false; for (const f of fs) { const x = by(f); if (!x) continue; seen = true; if (test(x)) return true; } return seen ? false : null; };
    const V = anyOf(["dvol.vol"], x => x.unusual && x.z > 0), F = anyOf(["venues.coinbaseVsBinanceBps", "venues.bybitVsBinanceBps"], x => x.unusual);
    const fund = anyOf(["bnDerivs.fund", "hlCtx.fund"], x => x.unusual), oi = anyOf(["bnDerivs.oi", "hlCtx.oi"], x => x.dev >= 0), C = fund == null || oi == null ? null : fund && oi;
    let L = c.items.some(x => OWNER[FEATURES[x.f][0]] === "derivs") ? false : null;      // no derivatives reading at all: forced flow cannot be judged
    if (L === false) {
      let since = Infinity; const lr = [];
      for (const r of recs) { if (!isRec(r) || r[2] > tMs) continue; if (r[2] < since) since = r[2]; if (r[1] === "liq" || r[1] === "hlLiq") lr.push(r); }
      for (let k = 0; k <= 30 && !L; k++) if (liqDriven(lr, tMs - k*10000, {coin:opt.coin, since}).tag) L = true;
    }
    const ind = {V, L, F, C}, three = [V, L, F].filter(x => x === true).length, readings = [V, L, F, C].filter(x => x != null).length;
    const s = three >= 2 ? "stressed" : C === true ? "crowded" : three === 1 ? "unsettled" : readings >= 3 ? "calm" : "unknown";
    return {t:tMs, v:STATE_VERSION, s, ind, i:Object.keys(ind).filter(k => ind[k] === true).join(""), n:readings};
  }
  // the state every stepMs from t0 to t1 (for the strip under the Review timeline)
  function marketStateSeries(recs, t0, t1, stepMs, opt) { const out = []; for (let t = t0; t <= t1; t += stepMs) { const m = marketState(recs, t, opt); out.push({t, s:m.s, i:m.i}); } return out; }

  // ---- event clock (v083): the scheduled moments around now, all from the calendar rule above (no network). Funding (00 / 08 / 16 UTC), options expiry (08:00 UTC; the level is
  // daily, weekly, monthly or quarterly), US stock open and close. Macro releases (CPI, FOMC, jobs) follow no rule and are NOT here.
  const EVENT_LABEL = {funding:"funding", "optExp:daily":"options expiry (daily)", "optExp:weekly":"options expiry (weekly)", "optExp:monthly":"options expiry (monthly)", "optExp:quarterly":"options expiry (quarterly)", usOpen:"US stock open", usClose:"US stock close"};
  function evSpan(ms) { const m = Math.round(Math.abs(ms)/60000); return m < 90 ? m + " min" : m < 2880 ? Math.floor(m/60) + " h " + (m % 60) + " min" : Math.floor(m/1440) + " d " + Math.floor(m % 1440/60) + " h"; }
  // events within winMs either side of tMs: [{tag, label, t, off}] with off = tMs - t (positive: it was that long ago), nearest first
  function eventsNear(tMs, winMs) {
    const out = [];
    for (const c of calendar(tMs - winMs - 1, tMs + winMs)) for (const tag of c.tags) if (EVENT_LABEL[tag]) out.push({tag, label:EVENT_LABEL[tag], t:c.t, off:tMs - c.t});
    return out.sort((x, y) => Math.abs(x.off) - Math.abs(y.off) || (x.tag < y.tag ? -1 : 1));
  }
  // the next of each kind after tMs: {funding, expiry (nearest, any level), bigger (nearest weekly or larger, null when `expiry` already is one), stocks (next open or close)}; each {tag, label, t, in}
  function eventClock(tMs) {
    const next = (pred, spanMs) => { for (const c of calendar(tMs, tMs + spanMs)) for (const tag of c.tags) if (pred(tag)) return {tag, label:EVENT_LABEL[tag], t:c.t, in:c.t - tMs}; return null; };
    const expiry = next(g => g.indexOf("optExp:") === 0, 3*86400000), big = g => g === "optExp:weekly" || g === "optExp:monthly" || g === "optExp:quarterly";
    return {t:tMs, funding:next(g => g === "funding", 9*3600000), expiry, bigger:expiry && big(expiry.tag) ? null : next(big, 100*86400000), stocks:next(g => g === "usOpen" || g === "usClose", 5*86400000)};
  }

  // ---- options lens (v084): realized volatility against the volatility index, and the skew shift. Rules in .scratch/collector-features/spec.md (G), fixed words.
  // pts = [[t, price]] ascending (the engine's one-per-second price history). Realized = sqrt(mean of squared 1-minute log returns * minutes per year), in percent, not demeaned.
  const YEAR_MIN = 525960, LENS_WIN_MS = 1800000, LENS_HI = 1.25, LENS_LO = 0.75;
  function gridReturns(pts, a, b) {      // [[t, log return]] on a 60 s grid; a grid price is the last point at most 10 s old
    const out = []; let j = 0, prev = null;
    for (let g = Math.ceil(a/60000)*60000; g <= b; g += 60000) {
      while (j + 1 < pts.length && pts[j + 1][0] <= g) j++;
      const ok = pts.length && pts[j][0] <= g && g - pts[j][0] <= 10000 && pts[j][1] > 0, p = ok ? pts[j][1] : null;
      if (p != null && prev != null) out.push([g, Math.log(p/prev)]);
      prev = p;
    }
    return out;
  }
  function realizedAt(rets, tMs, winMs) {
    let n = 0, ss = 0; for (const r of rets) if (r[0] > tMs - winMs && r[0] <= tMs) { n++; ss += r[1]*r[1]; }
    return n >= 20 ? {vol:Math.sqrt(ss/n*YEAR_MIN)*100, n} : null;
  }
  const lensWord = ratio => ratio >= LENS_HI ? "above" : ratio <= LENS_LO ? "below" : "inline";
  const LENS_TEXT = {above:"realized above implied", below:"realized below implied", inline:"about in line"};
  function volLens(recs, pts, tMs, opt) {
    opt = opt || {}; const c = opt.ctx || context(recs, tMs, {coin:opt.coin}), win = opt.winMs || LENS_WIN_MS;
    let dv = null; for (const r of recs) if (isRec(r) && r[1] === "dvol" && r[2] <= tMs && (!dv || r[2] > dv[2])) dv = r;
    const implied = dv && tMs - dv[2] <= 300000 && num(dv[3] && dv[3].vol) > 0 ? dv[3].vol : null;
    const rl = pts && pts.length ? realizedAt(gridReturns(pts, tMs - win - 60000, tMs), tMs, win) : null;
    const ratio = rl && implied ? rl.vol/implied : null, sk = c.items.find(x => x.f === "optChain.skew5");
    return {t:tMs, implied:implied == null ? null : round(implied, 2), realized:rl ? round(rl.vol, 2) : null, n:rl ? rl.n : 0, ratio:ratio == null ? null : round(ratio, 2), word:ratio == null ? null : lensWord(ratio),
      skew:sk ? {x:round(sk.x, 2), dev:round(sk.dev, 2), unusual:sk.unusual, text:sk.text, side:sk.x > 0 ? "puts richer" : sk.x < 0 ? "calls richer" : "level"} : null};
  }
  // the ratio word every stepMs from t0 to t1: [{t, w, ratio}] (the grid returns and the index readings are worked out once)
  function lensSeries(recs, pts, t0, t1, stepMs, opt) {
    const win = (opt && opt.winMs) || LENS_WIN_MS, rets = pts && pts.length ? gridReturns(pts, t0 - win - 60000, t1) : [], dv = recs.filter(r => isRec(r) && r[1] === "dvol").sort((a, b) => a[2] - b[2]), out = []; let j = -1;
    for (let t = t0; t <= t1; t += stepMs) {
      while (j + 1 < dv.length && dv[j + 1][2] <= t) j++;
      const imp = j >= 0 && t - dv[j][2] <= 300000 ? num(dv[j][3] && dv[j][3].vol) : null, rl = realizedAt(rets, t, win), ratio = rl && imp > 0 ? rl.vol/imp : null;
      out.push({t, w:ratio == null ? null : lensWord(ratio), ratio:ratio == null ? null : round(ratio, 2)});
    }
    return out;
  }

  // ---- followed wallets (v085): what the 10 biggest Hyperliquid traders (by traded notional, which favours market makers and bots) did over the last winMs, against the crowd's taker flow.
  // Rules in .scratch/collector-features/spec.md (F). Positions are signed sizes in the coin (negative = short). A wallet counts at time t if its latest reading is at most 6 minutes old
  // (they are refreshed every 5 minutes and whenever they change). The change is measured only over wallets read at both ends, because the followed set rotates.
  const WHALE_STALE_MS = 360000, WHALE_WIN_MS = 600000;
  function walletSeries(recs) {      // {address: [{t, sz, lq, lev, up, av}]} ascending
    const by = {};
    for (const r of recs) { if (!isRec(r) || r[1] !== "walletsTop" || !r[3] || !Array.isArray(r[3].rows)) continue; for (const x of r[3].rows) if (x && x.w && num(x.sz) != null) (by[x.w] || (by[x.w] = [])).push({t:r[2], sz:x.sz, lq:x.lq, lev:x.lev, up:x.up, av:x.av}); }
    for (const w in by) by[w].sort((p, q) => p.t - q.t);
    return by;
  }
  const walletAt = (rows, t) => { let r = null; for (const x of rows) { if (x.t > t) break; r = x; } return r && t - r.t <= WHALE_STALE_MS ? r : null; };
  // aggregate taker flow of one venue from engine inputs, excluding liquidation fills: {net, gross} in dollars between t0 and t1 (buy minus sell)
  function takerNet(inputs, venue, t0, t1) {
    let net = 0, gross = 0, n = 0;
    for (const r of inputs) { if (r[0] !== "t" || !r[1] || r[1].v !== venue || r[1].liq || !(r[1].t > t0 && r[1].t <= t1) || !(r[1].ntl > 0)) continue; net += r[1].side === "buy" ? r[1].ntl : -r[1].ntl; gross += r[1].ntl; n++; }
    return {net:Math.round(net), gross:Math.round(gross), n};
  }
  // a running total of one venue's taker flow, for many windows over one input list: crowdNetAt(ix, t0, t1) = {net, gross}
  function crowdIndex(inputs, venue) {
    const t = [], net = [0], gross = [0];
    for (const r of inputs) { if (r[0] !== "t" || !r[1] || r[1].v !== venue || r[1].liq || !(r[1].ntl > 0) || !(r[1].t > 0)) continue; t.push(r[1].t); net.push(net[net.length - 1] + (r[1].side === "buy" ? r[1].ntl : -r[1].ntl)); gross.push(gross[gross.length - 1] + r[1].ntl); }
    return {t, net, gross};
  }
  function crowdNetAt(ix, t0, t1) {
    const up = x => { let lo = 0, hi = ix.t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ix.t[m] <= x) lo = m + 1; else hi = m; } return lo; }, a = up(t0), b = up(t1);
    return {net:Math.round(ix.net[b] - ix.net[a]), gross:Math.round(ix.gross[b] - ix.gross[a])};
  }
  // opt: px (price in dollars, for the dollar figures), crowdNet (the aggregate taker net over the same window, dollars), winMs, floorUsd (a net move under this is "flat")
  function whaleFlow(recs, tMs, opt) {
    opt = opt || {}; const win = opt.winMs || WHALE_WIN_MS, floor = opt.floorUsd == null ? WHALE_FLOOR_USD : opt.floorUsd, ser = opt.series || walletSeries(recs), px = num(opt.px);
    let n = 0, net = 0, longs = 0, shorts = 0, m = 0, d = 0;
    for (const w in ser) {
      const now = walletAt(ser[w], tMs); if (!now) continue;
      n++; net += now.sz; if (now.sz > 0) longs++; else if (now.sz < 0) shorts++;
      const was = walletAt(ser[w], tMs - win); if (was) { m++; d += now.sz - was.sz; }
    }
    if (!n) return null;
    const usd = v => px > 0 ? Math.round(v*px) : null, dUsd = usd(d), word = (v, f) => v == null ? null : v >= f ? "buying" : v <= -f ? "selling" : "flat";
    const whales = m && dUsd != null ? word(dUsd, floor) : null, crowdNet = num(opt.crowdNet), crowd = crowdNet == null ? null : word(crowdNet, floor);
    return {t:tMs, n, longs, shorts, net:round(net, 3), netUsd:usd(net), matched:m, delta:round(d, 3), deltaUsd:dUsd, whales, crowdNet:crowdNet == null ? null : Math.round(crowdNet), crowd,
      relation:whales && crowd ? (whales === "flat" || crowd === "flat" ? "one side flat" : whales === crowd ? "same direction" : "opposite directions") : null};
  }
  // the words every stepMs from t0 to t1: [{t, w, c}] (whales' change and the crowd's flow over the window ending at t; null where unknown)
  function whaleSeries(recs, ix, t0, t1, stepMs, opt) {
    opt = opt || {}; const win = opt.winMs || WHALE_WIN_MS, ser = walletSeries(recs), out = [];
    for (let t = t0; t <= t1; t += stepMs) {
      const w = whaleFlow(recs, t, {series:ser, px:opt.px, winMs:win, floorUsd:opt.floorUsd, crowdNet:ix ? crowdNetAt(ix, t - win, t).net : opt.crowdAt ? opt.crowdAt(t - win, t) : null});
      out.push({t, w:w ? w.whales : null, c:w ? w.crowd : null, rel:w ? w.relation : null});
    }
    return out;
  }
  const WHALE_FLOOR_USD = 1000000;      // a net move under this is "flat": about the 35th percentile of the whales' 10-minute change and the 20th of the crowd's flow in the first 13 recordings (104 windows)

  // ---- venue trade volume (v106; collectors "tradeVol" fast and "vol24" slow): how much each venue trades, to measure market share. Public sockets and tickers, no keys.
  // Ids: venue letters + F (perpetual / futures) or S (spot). Quantities are in the coin (BTC), dollars are price x quantity (USDT and USD are treated as the same dollar).
  // AGGRESSOR SIDE ("b" buy = the taker bought, lifting the ask; "s" sell = the taker sold, hitting the bid), per venue:
  //   Binance perp / spot aggTrade: field m = "buyer is the maker"; m true -> the taker sold ("s"), m false -> the taker bought ("b").
  //   Bybit publicTrade: field S is the taker's side ("Buy" / "Sell").   OKX trades: field side is the taker's side ("buy" / "sell").
  //   Coinbase matches: field side is the MAKER order's side, so it is inverted: side "sell" (resting ask hit) -> the taker bought ("b").
  //   Hyperliquid trades: field side "B" / "A" is the taker's side (B = bought). Swap sizes on OKX are contracts: base quantity = sz x ctVal x ctMult.
  const TRADE_IDS = {bnF:{venue:"bn", kind:"perp", label:"Binance perp"}, bnS:{venue:"bn", kind:"spot", label:"Binance spot"}, byF:{venue:"by", kind:"perp", label:"Bybit perp"}, byS:{venue:"by", kind:"spot", label:"Bybit spot"},
    okF:{venue:"ok", kind:"perp", label:"OKX swap"}, okS:{venue:"ok", kind:"spot", label:"OKX spot"}, cbS:{venue:"cb", kind:"spot", label:"Coinbase spot"}, hlF:{venue:"hl", kind:"perp", label:"Hyperliquid perp"}};
  const TRADE_ORDER = ["bnF", "bnS", "byF", "byS", "okF", "okS", "cbS", "hlF"];
  // the sockets to open for a coin: {id, url, sub, ping}; OKX is one socket for swap and spot (parsed by instId; the swap needs its contract size, see okxCt)
  function tradeSubs(coin, opt) {
    const C = String(coin || "BTC").toUpperCase(), c = C.toLowerCase(), swap = !opt || opt.swap !== false;
    return [
      {id:"bnF", url:"wss://fstream.binance.com/market/stream?streams=" + c + "usdt@aggTrade"},
      {id:"bnS", url:"wss://stream.binance.com:9443/stream?streams=" + c + "usdt@aggTrade"},
      {id:"byF", url:"wss://stream.bybit.com/v5/public/linear", sub:{op:"subscribe", args:["publicTrade." + C + "USDT"]}, ping:{op:"ping"}},
      {id:"byS", url:"wss://stream.bybit.com/v5/public/spot", sub:{op:"subscribe", args:["publicTrade." + C + "USDT"]}, ping:{op:"ping"}},
      {id:"ok", url:"wss://ws.okx.com:8443/ws/v5/public", ping:"ping", sub:{op:"subscribe", args:(swap ? [{channel:"trades", instId:C + "-USDT-SWAP"}] : []).concat([{channel:"trades", instId:C + "-USDT"}])}},
      {id:"cbS", url:"wss://ws-feed.exchange.coinbase.com", sub:{type:"subscribe", product_ids:[C + "-USD"], channels:["matches"]}},
      {id:"hlF", url:"wss://api.hyperliquid.xyz/ws", sub:{method:"subscribe", subscription:{type:"trades", coin:C}}, ping:{method:"ping"}},
    ];
  }
  // OKX /api/v5/public/instruments?instType=SWAP answer -> the coin per contract (ctVal x ctMult), or null
  function okxCt(j) { const d = j && Array.isArray(j.data) && j.data[0], v = d && num(d.ctVal), m = d && num(d.ctMult); return v > 0 ? v*(m > 0 ? m : 1) : null; }
  // One socket message -> a list of {id, venue, kind, t (exchange ms or null), side "b" | "s", qty (coin), usd, tid (for duplicates, or null)}; [] for anything that is not a trade or lacks a field.
  // sockId is the socket's id from tradeSubs; ct is the OKX swap contract size (okxCt).
  function tradeParse(sockId, j, ct) {
    const out = [];
    if (!j || typeof j !== "object") return out;
    const push = (id, t, side, qty, px, tid) => {
      qty = num(qty); px = num(px); const T = num(t), I = TRADE_IDS[id];
      if (!I || !(qty > 0) || !(px > 0) || (side !== "b" && side !== "s")) return;
      out.push({id, venue:I.venue, kind:I.kind, t:T > 0 ? T : null, side, qty, usd:qty*px, tid:tid == null || tid === "" ? null : String(tid)});
    };
    if (sockId === "bnF" || sockId === "bnS") {
      const d = j.data; if (!d || d.e !== "aggTrade" || typeof d.m !== "boolean") return out;
      push(sockId, d.T, d.m ? "s" : "b", d.q, d.p, d.a);
    } else if (sockId === "byF" || sockId === "byS") {
      if (typeof j.topic !== "string" || j.topic.indexOf("publicTrade.") !== 0 || !Array.isArray(j.data)) return out;
      for (const d of j.data) if (d) push(sockId, d.T != null ? d.T : j.ts, d.S === "Buy" ? "b" : d.S === "Sell" ? "s" : null, d.v, d.p, d.i);
    } else if (sockId === "ok") {
      if (!j.arg || j.arg.channel !== "trades" || !Array.isArray(j.data)) return out;
      for (const d of j.data) {
        if (!d || typeof d.instId !== "string") continue;
        const swap = /-SWAP$/.test(d.instId), side = d.side === "buy" ? "b" : d.side === "sell" ? "s" : null;
        if (swap) { if (ct > 0) push("okF", d.ts, side, num(d.sz) != null ? d.sz*ct : null, d.px, d.tradeId); }
        else push("okS", d.ts, side, d.sz, d.px, d.tradeId);
      }
    } else if (sockId === "cbS") {
      if (j.type !== "match") return out;      // "last_match" is the snapshot sent on subscribe: an old trade, not counted
      push("cbS", Date.parse(j.time), j.side === "sell" ? "b" : j.side === "buy" ? "s" : null, j.size, j.price, j.trade_id);      // inverted: Coinbase's side is the maker's
    } else if (sockId === "hlF") {
      if (j.channel !== "trades" || !Array.isArray(j.data)) return out;
      for (const d of j.data) if (d) push("hlF", d.time, d.side === "B" ? "b" : d.side === "A" ? "s" : null, d.sz, d.px, d.tid != null ? d.tid : d.hash);
    }
    return out;
  }
  // One-second buckets per id. add() puts a trade into its second (the exchange's time; the local clock when the trade has none or is more than 5 minutes off), drops repeats (same id and trade id),
  // and takes trades in any order; a trade for a second already flushed goes into the oldest second still open (counted in late). flush() hands out the closed seconds as a compact record payload:
  //   {t0: epoch second of the first row, v: {id: [[second - t0, buyUsd, sellUsd, buyQty, sellQty, n], ...]}}   (non-empty seconds only; dollars whole, quantities 5 decimals)
  function tradeBook(opt) {
    const holdMs = opt && opt.holdMs != null ? opt.holdMs : 2000, seenCap = opt && opt.seenCap || 20000, b = new Map(), seen = new Map(); let flushed = -Infinity, dup = 0, late = 0, bad = 0;
    return {
      add(tr, nowMs) {
        if (!tr || !TRADE_IDS[tr.id] || !(tr.qty > 0) || !(tr.usd > 0) || (tr.side !== "b" && tr.side !== "s")) { bad++; return false; }
        if (tr.tid != null) { const k = tr.id + ":" + tr.tid; if (seen.has(k)) { dup++; return false; } seen.set(k, 1); if (seen.size > seenCap) seen.delete(seen.keys().next().value); }
        let sec = Math.floor((tr.t != null && Math.abs(tr.t - nowMs) <= 300000 ? tr.t : nowMs)/1000);
        if (sec <= flushed) { sec = flushed + 1; late++; }
        const m = b.get(tr.id) || (b.set(tr.id, new Map()), b.get(tr.id)), r = m.get(sec) || (m.set(sec, [0, 0, 0, 0, 0]), m.get(sec));
        if (tr.side === "b") { r[0] += tr.usd; r[2] += tr.qty; } else { r[1] += tr.usd; r[3] += tr.qty; }
        r[4]++; return true;
      },
      flush(nowMs, all) {
        const cut = all ? Infinity : Math.floor((nowMs - holdMs)/1000); let t0 = Infinity; const take = {};
        for (const [id, m] of b) for (const [sec, r] of m) if (sec < cut) { (take[id] || (take[id] = [])).push([sec, r]); m.delete(sec); if (sec < t0) t0 = sec; }
        if (t0 === Infinity) return null;
        const v = {}; let top = -Infinity;
        for (const id in take) { v[id] = take[id].sort((x, y) => x[0] - y[0]).map(([s, r]) => { if (s > top) top = s; return [s - t0, Math.round(r[0]), Math.round(r[1]), round(r[2], 5), round(r[3], 5), r[4]]; }); }
        if (top > flushed) flushed = top;
        return {t0, v};
      },
      stats() { return {dup, late, bad}; },
    };
  }
  // a "tv" record payload -> rows {id, sec, bu, su, bq, sq, n} (absolute seconds)
  function tradeRows(p) {
    const out = []; if (!p || !p.v || !Number.isFinite(p.t0)) return out;
    for (const id in p.v) { if (!TRADE_IDS[id] || !Array.isArray(p.v[id])) continue; for (const r of p.v[id]) if (Array.isArray(r) && r.length >= 6) out.push({id, sec:p.t0 + r[0], bu:r[1], su:r[2], bq:r[3], sq:r[4], n:r[5]}); }
    return out;
  }
  // share of the dollar volume per id over the window ending at nowMs, from "tv" records: {usd, by:{id:{usd, share, buy, sell, qty, n}}, perp, spot (shares of the total)}; null when nothing traded
  function tradeShare(recs, nowMs, windowMs) {
    const by = {}; let tot = 0;
    for (const r of recs || []) {
      if (!isRec(r) || r[1] !== "tv" || r[2] < nowMs - windowMs - 60000 || r[2] > nowMs + 60000) continue;
      for (const x of tradeRows(r[3])) {
        const ms = x.sec*1000; if (ms < nowMs - windowMs || ms > nowMs) continue;
        const o = by[x.id] || (by[x.id] = {usd:0, share:0, buy:0, sell:0, qty:0, n:0}); o.usd += x.bu + x.su; o.buy += x.bu; o.sell += x.su; o.qty += x.bq + x.sq; o.n += x.n; tot += x.bu + x.su;
      }
    }
    if (!(tot > 0)) return null;
    let perp = 0, spot = 0; for (const id in by) { by[id].share = by[id].usd/tot; if (TRADE_IDS[id].kind === "perp") perp += by[id].usd; else spot += by[id].usd; }
    return {usd:tot, by, perp:perp/tot, spot:spot/tot};
  }
  // 24 h ticker answers -> dollars of volume (or null). `last` is a fallback price where the venue reports coin units (for hlF it is the coin name)
  function vol24Parse(id, j, last) {
    if (j == null) return null;
    const pos = x => { x = num(x); return x > 0 ? x : null; };
    if (id === "bnF" || id === "bnS") return pos(j.quoteVolume);
    if (id === "byF" || id === "byS") { const d = j.result && Array.isArray(j.result.list) && j.result.list[0]; return d ? pos(d.turnover24h) : null; }
    if (id === "okF") { const d = Array.isArray(j.data) && j.data[0]; const q = d && pos(d.volCcy24h), px = d && (pos(d.last) || pos(last)); return q && px ? q*px : null; }      // swap: volCcy24h is in coins
    if (id === "okS") { const d = Array.isArray(j.data) && j.data[0]; return d ? pos(d.volCcy24h) : null; }      // spot: volCcy24h is in the quote currency (USDT)
    if (id === "cbS") { const q = pos(j.volume), px = pos(j.last) || pos(last); return q && px ? q*px : null; }      // /products/BTC-USD/stats: volume in coins
    if (id === "hlF") {      // metaAndAssetCtxs: [{universe:[{name}]}, [ctx]]; dayNtlVlm in dollars
      const u = Array.isArray(j) && j[0] && j[0].universe, c = Array.isArray(j) && j[1]; if (!Array.isArray(u) || !Array.isArray(c)) return null;
      const i = u.findIndex(x => x && String(x.name).toUpperCase() === String(last).toUpperCase()); return i >= 0 && c[i] ? pos(c[i].dayNtlVlm) : null;
    }
    return null;
  }
  // the "vol24" record payload ({id: dollars}) -> {usd, by:{id:{usd, share}}, perp, spot}, null when empty
  function vol24Share(p) {
    if (!p || typeof p !== "object") return null;
    const by = {}; let tot = 0, perp = 0, spot = 0;
    for (const id of TRADE_ORDER) { const v = num(p[id]); if (v > 0) { by[id] = {usd:v, share:0}; tot += v; if (TRADE_IDS[id].kind === "perp") perp += v; else spot += v; } }
    if (!(tot > 0)) return null;
    for (const id in by) by[id].share = by[id].usd/tot;
    return {usd:tot, by, perp:perp/tot, spot:spot/tot};
  }

  // ---- perp book depth on Bybit and OKX (v107; collector "bookPerp", fast, run by collectors-worker.js while a recording is on or auto-record is armed): the same summaries the page writes
  // for Binance (bookBn) and Hyperliquid (bookHl), so the four perp venues can be compared. Public sockets, no keys. Records "bookBy" / "bookOk" have bookBn's shape
  // ({mid, spr, tb, ta, reach, d:{edge:[bidQty, askQty]}, fl:{b,a}}) plus rs = resyncs so far; quantities are in the coin (BTC), dollars = quantity x mid.
  //   Bybit linear   orderbook.1000.BTCUSDT: snapshot (1000 levels a side, about 25 to 30 bps for BTC; 500 levels is only about 11), then deltas by price level (size "0" removes); u rises by 1 per message, any other u is a gap
  //                  (u = 1 is a service restart that comes as a snapshot). 200 levels would reach only about 2.5 bps, so 1000.
  //   OKX swap       books: snapshot (400 levels a side, about 7 bps for BTC), then updates by price level (size "0" removes); prevSeqId must equal the last seqId; checksum (crc32 of the top 25 levels,
  //                  original strings) is verified when the message carries one (0 = not sent). books5 is 5 levels (under 1 bp): useless for depth; the deeper channels need a login.
  //                  Sizes are contracts: coin = sz x ctVal x ctMult (okxCt).
  // perpBook keeps the book by price level and tells when it must be rebuilt: apply() answers "snapshot", "ok", "ignored" (a delta before any snapshot) or "resync" (gap, crossed book, bad
  // checksum; the book is dropped until the next snapshot, so the caller resubscribes).
  const BOOK_PERP = {by:{label:"Bybit perp", rec:"bookBy"}, ok:{label:"OKX swap", rec:"bookOk"}};
  const BOOK_PERP_ORDER = ["bnF", "byF", "okF", "hlF"], BOOK_PERP_REC = {bnF:"bookBn", byF:"bookBy", okF:"bookOk", hlF:"bookHl"};
  function bookSubs(coin) {
    const C = String(coin || "BTC").toUpperCase(), topic = "orderbook.1000." + C + "USDT", arg = {channel:"books", instId:C + "-USDT-SWAP"};
    return [
      {id:"by", url:"wss://stream.bybit.com/v5/public/linear", sub:{op:"subscribe", args:[topic]}, unsub:{op:"unsubscribe", args:[topic]}, ping:{op:"ping"}},
      {id:"ok", url:"wss://ws.okx.com/ws/v5/public", sub:{op:"subscribe", args:[arg]}, unsub:{op:"unsubscribe", args:[arg]}, ping:"ping"},
    ];
  }
  // one socket message -> {venue, type "snapshot" | "delta", bids, asks (lists of [price, size] strings), seq, prev (OKX), cs (OKX checksum or null)} or null for anything that is not a book message
  function bookParse(id, j) {
    if (!j || typeof j !== "object") return null;
    if (id === "by") {
      const d = j.data; if (typeof j.topic !== "string" || j.topic.indexOf("orderbook.") !== 0 || !d || !Array.isArray(d.b) || !Array.isArray(d.a) || num(d.u) == null) return null;
      return {venue:"by", type:j.type === "snapshot" || num(d.u) === 1 ? "snapshot" : "delta", bids:d.b, asks:d.a, seq:num(d.u), prev:null, cs:null};
    }
    if (id === "ok") {
      const d = Array.isArray(j.data) && j.data[0]; if (!j.arg || j.arg.channel !== "books" || !d || !Array.isArray(d.bids) || !Array.isArray(d.asks) || (j.action !== "snapshot" && j.action !== "update")) return null;
      return {venue:"ok", type:j.action === "snapshot" ? "snapshot" : "delta", bids:d.bids, asks:d.asks, seq:num(d.seqId), prev:num(d.prevSeqId), cs:num(d.checksum) ? num(d.checksum) : null};
    }
    if (id === "bn") {      // Binance USD-M futures: a depthUpdate event (alone or inside the combined-stream wrapper {stream, data}) or the REST depth snapshot {lastUpdateId, bids, asks}
      const d = j.data && typeof j.data === "object" && j.data.e ? j.data : j;
      if (d.e === "depthUpdate" && Array.isArray(d.b) && Array.isArray(d.a) && num(d.u) != null) return {venue:"bn", type:"delta", bids:d.b, asks:d.a, seq:num(d.u), first:num(d.U), prev:num(d.pu), cs:null};
      if (!d.e && num(d.lastUpdateId) != null && Array.isArray(d.bids) && Array.isArray(d.asks)) return {venue:"bn", type:"snapshot", bids:d.bids, asks:d.asks, seq:num(d.lastUpdateId), first:null, prev:null, cs:null};
      return null;
    }
    return null;
  }
  // Binance book for the worker (collector "book"): the diff stream (the public route, like the page's) and the REST snapshot it is applied on top of (1000 levels, about 17 bps for BTC)
  function bnBookSub(coin) {
    const C = String(coin || "BTC").toUpperCase(), c = C.toLowerCase();
    return {id:"bn", url:"wss://fstream.binance.com/public/stream?streams=" + c + "usdt@depth@100ms", snap:"https://fapi.binance.com/fapi/v1/depth?symbol=" + C + "USDT&limit=1000"};
  }
  // Hyperliquid l2Book push for the coin -> {bids, asks} as [price, size] numbers, best first, or null for anything else (the default 20 exact levels; the bucketed book is asked for separately, hlCoarse)
  function hlBookParse(j, coin) {
    const d = j && j.channel === "l2Book" && j.data; if (!d || !Array.isArray(d.levels) || !Array.isArray(d.levels[0]) || !Array.isArray(d.levels[1])) return null;
    if (coin && String(d.coin).toUpperCase() !== String(coin).toUpperCase()) return null;
    const side = a => a.map(l => [num(l.px), num(l.sz)]).filter(l => l[0] > 0 && l[1] != null);
    return {bids:side(d.levels[0]), asks:side(d.levels[1])};
  }
  // the l2Book answer aggregated to 4 significant figures (20 levels that reach about 24 bps for BTC) -> a book summary at the standard edges, or null
  function hlCoarse(j) {
    const L = j && j.levels; if (!Array.isArray(L) || !Array.isArray(L[0]) || !Array.isArray(L[1])) return null;
    return book(L[0].map(l => [+l.px, +l.sz]), L[1].map(l => [+l.px, +l.sz]), BOOK_EDGES);
  }
  // the "bookHl" record payload: the exact book (cur = {bids, asks, at}) topped up with the bucketed one where it reaches deeper; null when the exact book is missing or older than 5 s
  function hlBookSummary(cur, coarse, nowMs, coarseAt) {
    if (!cur || !(nowMs - cur.at < 5000)) return null;
    const fine = book(cur.bids, cur.asks), m = mergeBook(fine, coarse && nowMs - coarseAt < 10000 ? coarse : null);
    return m ? Object.assign(m, {cAge:coarseAt ? nowMs - coarseAt : null}) : null;
  }
  const CRC_T = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
  const crc32 = s => { let c = 0xFFFFFFFF; for (let i = 0; i < s.length; i++) c = CRC_T[(c ^ s.charCodeAt(i)) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) | 0; };
  // venue "by" | "ok" | "bn" (Binance: REST snapshot, then diffs; the first diff must straddle the snapshot id, later ones chain on pu; the summary claims only the snapshot window as reach); opt.ct = coin per contract (OKX), opt.edges, opt.flowBps (flow window, default 20 bps), opt.maxLevels (levels a side the summary uses: the venue's window, 1000 Bybit / 400 OKX)
  function perpBook(venue, opt) {
    opt = opt || {}; const ct = venue === "ok" ? (opt.ct > 0 ? opt.ct : null) : 1, edges = opt.edges || BOOK_EDGES, flow = flowStat(opt.flowBps || 20), cap = opt.maxLevels || (venue === "ok" ? 400 : venue === "bn" ? Infinity : 1000), bids = new Map(), asks = new Map();
    let ready = false, lastSeq = null, bb = -Infinity, ba = Infinity, firstDelta = false, snapLo = 0, snapHi = 0; const st = {snap:0, upd:0, gap:0, cross:0, csum:0, ign:0, bad:0, resync:0};
    const qty = e => num(e[1])*ct;
    const rescan = () => { bb = -Infinity; ba = Infinity; for (const p of bids.keys()) if (p > bb) bb = p; for (const p of asks.keys()) if (p < ba) ba = p; };
    function setLevel(isBid, e, track) {
      if (!Array.isArray(e)) { st.bad++; return; }
      const px = num(e[0]), sz = num(e[1]); if (!(px > 0) || sz == null || sz < 0) { st.bad++; return; }
      const m = isBid ? bids : asks, old = m.get(px), oq = old ? qty(old) : 0;
      if (sz === 0) { if (!old) return; m.delete(px); if (isBid ? px === bb : px === ba) rescan(); }
      else { m.set(px, [e[0], e[1]]); if (isBid ? px > bb : px < ba) { if (isBid) bb = px; else ba = px; } }
      if (track && bb > 0 && ba < Infinity) { const mid = (bb + ba)/2; flow.note(isBid ? "b" : "a", oq, sz === 0 ? 0 : qty(m.get(px)), (isBid ? mid - px : px - mid)*1e4/mid); }
    }
    const fail = kind => { st[kind]++; st.resync++; ready = false; lastSeq = null; bids.clear(); asks.clear(); bb = -Infinity; ba = Infinity; return "resync"; };
    const crossed = () => bb > 0 && ba < Infinity && ba <= bb;
    function checksum() {      // OKX: crc32 of "bid:size:ask:size:..." for the 25 best levels each side, strings as sent
      const b = [...bids].sort((x, y) => y[0] - x[0]).slice(0, 25), a = [...asks].sort((x, y) => x[0] - y[0]).slice(0, 25), parts = [];
      for (let i = 0; i < Math.max(b.length, a.length); i++) { if (b[i]) parts.push(b[i][1][0], b[i][1][1]); if (a[i]) parts.push(a[i][1][0], a[i][1][1]); }
      return crc32(parts.join(":"));
    }
    return {
      apply(m) {
        if (!m) return "ignored";
        if (venue === "ok" && !ct) return "ignored";      // no contract size: the sizes could not be read, never guessed
        if (m.type === "snapshot") {
          bids.clear(); asks.clear(); bb = -Infinity; ba = Infinity; flow.take();
          for (const e of m.bids) setLevel(true, e, false); for (const e of m.asks) setLevel(false, e, false);
          if (!bids.size || !asks.size || crossed()) return fail("cross");
          if (m.cs != null && checksum() !== m.cs) return fail("csum");
          ready = true; lastSeq = m.seq; st.snap++; firstDelta = venue === "bn";
          if (venue === "bn") { snapLo = Infinity; snapHi = 0; for (const p of bids.keys()) if (p < snapLo) snapLo = p; for (const p of asks.keys()) if (p > snapHi) snapHi = p; }      // how far the snapshot reaches: past it the local book is incomplete
          return "snapshot";
        }
        if (!ready) { st.ign++; return "ignored"; }
        if (venue === "bn" && firstDelta) {      // the first event after a snapshot: drop what the snapshot already holds, then it must straddle the snapshot id
          if (m.seq <= lastSeq) { st.ign++; return "ignored"; }
          if (m.first > lastSeq + 1) return fail("gap");
          firstDelta = false;
        } else if (venue === "by" ? m.seq !== lastSeq + 1 : m.prev !== lastSeq) return fail("gap");
        for (const e of m.bids) setLevel(true, e, true); for (const e of m.asks) setLevel(false, e, true);
        lastSeq = m.seq; st.upd++;
        if (!bids.size || !asks.size || crossed()) return fail("cross");
        if (m.cs != null && checksum() !== m.cs) return fail("csum");
        return "ok";
      },
      ready: () => ready,
      stats: () => Object.assign({}, st),
      // the summary record payload (bookBn's shape) or null when there is no good book; also empties the flow counters
      summary() {
        const fl = flow.take(); if (!ready) return null;
        // keep the nearest `cap` levels a side: the venue's window is that deep, and a local book keeps stray levels beyond it that are incomplete (their reach would be claimed as depth)
        const arr = (m, isBid) => { const a = []; for (const [, e] of m) a.push([+e[0], qty(e)]); if (a.length > cap) { a.sort((x, y) => isBid ? y[0] - x[0] : x[0] - y[0]); a.length = cap; } return a; };
        let reach = null;
        if (venue === "bn") { const mid = (bb + ba)/2; reach = mid > 0 ? [Math.max(0, (mid - snapLo)*1e4/mid), Math.max(0, (snapHi - mid)*1e4/mid)] : [0, 0]; }      // Binance: the snapshot window, not the farthest stray level
        const s = book(arr(bids, true), arr(asks, false), edges, reach); return s ? Object.assign(s, {fl, rs:st.resync}) : null;
      },
      best: () => ready ? [bb, ba] : null,
    };
  }
  // the newest bookBy / bookOk / bookBn / bookHl records -> rows {id, label, mid, spr, depthBtc (both sides within `edge` bps, null where the book does not reach), depthUsd, imb (bid share), ageMs}
  function bookCompare(recs, nowMs, edge) {
    edge = edge || 5; const out = [];
    for (const id of BOOK_PERP_ORDER) {
      let r = null; for (let i = (recs || []).length - 1; i >= 0; i--) { const x = recs[i]; if (isRec(x) && x[1] === BOOK_PERP_REC[id]) { r = x; break; } }
      const p = r && r[3], d = p && p.d && p.d[edge], ok = d && num(d[0]) != null && num(d[1]) != null, tot = ok ? d[0] + d[1] : null;
      out.push({id, rec:BOOK_PERP_REC[id], mid:p ? num(p.mid) : null, spr:p ? num(p.spr) : null, depthBtc:tot, depthUsd:tot != null && num(p.mid) ? tot*p.mid : null, imb:ok && tot > 0 ? d[0]/tot : null, ageMs:r ? nowMs - r[2] : null});
    }
    return out;
  }

  // ---- perp liquidations and open interest on Bybit and OKX (fast collector "perpFlow", run by collectors-worker.js while a recording is on or auto-record is armed). Public sockets, no keys.
  // Until v122 the Futures stack view saw these two feeds live and nothing recorded them; Binance's own liquidation stream keeps only the latest liquidation per symbol per second, so these two
  // are the complete ones for the other venues. Verified live 2026-11-05 (messages captured from both sockets):
  //   Bybit linear   tickers.BTCUSDT: a snapshot with openInterest (coin) and openInterestValue (USD), then deltas; a delta carries openInterest only when it changed.
  //                  allLiquidation.BTCUSDT: {topic, type:"snapshot", ts, data:[{T, s, S, v, p}]} (every liquidation, pushed every 500 ms); S "Buy" = a long was liquidated (a forced sell), v coin, p bankruptcy price.
  //   OKX swap       open-interest (instId BTC-USDT-SWAP): data:[{oi (contracts), oiCcy (coin), oiUsd, ts}], about every 3 s while it changes.
  //                  liquidation-orders (instType SWAP): every coin on the channel; data:[{instId, details:[{side, posSide, sz (contracts), bkPx, ts}]}]; side is the side of the forced order ("sell" = a long
  //                  was closed out). Coin = sz x ctVal x ctMult (okxCt). OKX moved its public socket to port 443 (a notice on port 8443 says it will be retired), so this one uses the plain URL.
  // Records: "liqPerp" {v:"by"|"ok", rows:[{t, side, px, q}]} for every message that carries liquidations (t = exchange ms, side = forced order's side, px = bankruptcy price, q = coin),
  // and "oiPerp" {by:{oi, usd}, ok:{oi, usd}} every 10 s (the latest reading of each venue; a venue with no reading yet is left out). Nothing here is a detector input.
  function perpFlowSubs(coin) {
    const C = String(coin || "BTC").toUpperCase();
    return [
      {id:"by", url:"wss://stream.bybit.com/v5/public/linear", sub:{op:"subscribe", args:["tickers." + C + "USDT", "allLiquidation." + C + "USDT"]}, ping:{op:"ping"}},
      {id:"ok", url:"wss://ws.okx.com/ws/v5/public", sub:{op:"subscribe", args:[{channel:"open-interest", instId:C + "-USDT-SWAP"}, {channel:"liquidation-orders", instType:"SWAP"}]}, ping:"ping"},
    ];
  }
  // One venue's state: the newest open interest and the liquidations of a message. ct = the OKX swap contract size (okxCt), needed for its liquidations.
  function perpFlow(coin, ct) {
    const C = String(coin || "BTC").toUpperCase(), oi = {by:null, ok:null}; let bad = 0;
    const side = s => s === "Buy" || s === "buy" ? "buy" : s === "Sell" || s === "sell" ? "sell" : null;
    return {
      // one parsed socket message of venue id ("by" | "ok") -> the liquidation rows it carries ([] for none); open interest is kept for sample()
      add(id, j, nowMs) {
        const rows = [];
        if (!j || typeof j !== "object") return rows;
        try {
          if (id === "by") {
            if (typeof j.topic !== "string" || !j.data) return rows;
            if (j.topic.startsWith("tickers.")) {
              const o = num(j.data.openInterest), u = num(j.data.openInterestValue);
              if (o != null || u != null) { const p = oi.by || (oi.by = {oi:null, usd:null}); if (o != null) p.oi = o; if (u != null) p.usd = u; }
            } else if (j.topic.startsWith("allLiquidation.") && Array.isArray(j.data)) {
              for (const d of j.data) { const px = num(d.p), q = num(d.v), s = d.S === "Buy" ? "sell" : d.S === "Sell" ? "buy" : null; if (d.s !== C + "USDT" || !(px > 0) || !(q > 0) || !s) continue; rows.push({t:num(d.T) || num(j.ts) || nowMs, side:s, px, q:round(q, 6)}); }
            }
          } else if (id === "ok") {
            const ch = j.arg && j.arg.channel; if (!ch || !Array.isArray(j.data)) return rows;
            if (ch === "open-interest") {
              const d = j.data.find(x => x.instId === C + "-USDT-SWAP"), o = d && num(d.oiCcy), u = d && num(d.oiUsd);
              if (o != null || u != null) { const p = oi.ok || (oi.ok = {oi:null, usd:null}); if (o != null) p.oi = o; if (u != null) p.usd = u; }
            } else if (ch === "liquidation-orders" && ct > 0) {
              for (const d of j.data) { if (d.instId !== C + "-USDT-SWAP") continue; for (const x of d.details || []) { const px = num(x.bkPx), q = num(x.sz) * ct, s = side(x.side); if (!(px > 0) || !(q > 0) || !s) continue; rows.push({t:num(x.ts) || nowMs, side:s, px, q:round(q, 6)}); } }
            }
          }
        } catch { bad++; }
        return rows;
      },
      // the latest open interest of each venue that has one, or null when neither has a reading yet; oi in coin, usd in dollars
      sample() {
        const out = {}; let n = 0;
        for (const id of ["by", "ok"]) { const p = oi[id]; if (p && (p.oi != null || p.usd != null)) { out[id] = {oi:p.oi == null ? null : round(p.oi, 4), usd:p.usd == null ? null : Math.round(p.usd)}; n++; } }
        return n ? out : null;
      },
      stats: () => ({bad}),
    };
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
  return {perpFlowSubs, perpFlow, REGISTRY, TAPE_MS, FILE_BUDGET, EVERY, BACKOFF_MS, quantile, rec, isRec, feeds, streamStat, due, calendar, OWNER, EXPECT_MS, ownerOf, tally, ageText, health, FEATURES, FEATURE_INFO, featureSeries, featureMaxAge, context, venueLead, leadText, liqDriven, usdText, wallQuality, marketState, marketStateSeries, STATE_VERSION, EVENT_LABEL, evSpan, eventsNear, eventClock, volLens, lensSeries, gridReturns, LENS_TEXT, walletSeries, takerNet, crowdIndex, crowdNetAt, whaleFlow, whaleSeries, WHALE_FLOOR_USD, deribitCoin, optName, optionsChain, walletTracker, walletPosition, walletChanged, liqFills, predictedFunding, WALLET_TOP, WALLET_REFRESH_MS, MAJORS, TRADE_IDS, TRADE_ORDER, tradeSubs, okxCt, tradeParse, tradeBook, tradeRows, tradeShare, vol24Parse, vol24Share, bookSubs, bookParse, bnBookSub, hlBookParse, hlCoarse, hlBookSummary, perpBook, crc32, bookCompare, BOOK_PERP, BOOK_PERP_ORDER, BOOK_PERP_REC, venueSubs, venueParse, venueApply, venueRecord, BOOK_EDGES, book, mergeBook, flowStat, premium, openInterest, ratioPoint, ratiosChanged, hlCtx, force, basis, prune, slice, fit};
})();
