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
    {id:"wallets", label:"Hyperliquid wallets: position and liquidation price of the 10 biggest traders, their liquidation fills, predicted funding across venues", speed:"slow", on:true},
    {id:"options", label:"Options and volatility (Deribit, BTC and ETH): volatility index, at-the-money implied vol, skew, open interest and busiest strikes by expiry", speed:"slow", on:true},
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
  const EVERY = {prem:15000, hl:15000, ratios:60000, basis:10000, wallets:30000, funding:60000, options:120000, dvol:10000}, BACKOFF_MS = 300000;      // polling spacing per source; a rate-limited source rests this long
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

  // tape helpers on arrays of records
  const prune = (recs, nowMs, keepMs) => recs.filter(r => r[2] >= nowMs - (keepMs == null ? TAPE_MS : keepMs));
  const slice = (recs, t0, t1) => recs.filter(r => r[2] >= t0 && r[2] <= t1);
  // keep the newest records that fit in maxBytes of JSON
  function fit(recs, maxBytes) {
    const lim = maxBytes == null ? FILE_BUDGET : maxBytes, out = []; let size = 2;
    for (let i = recs.length - 1; i >= 0; i--) { const b = JSON.stringify(recs[i]).length + 1; if (size + b > lim) break; size += b; out.push(recs[i]); }
    return out.reverse();
  }
  return {REGISTRY, TAPE_MS, FILE_BUDGET, EVERY, BACKOFF_MS, quantile, rec, isRec, feeds, streamStat, due, calendar, deribitCoin, optName, optionsChain, walletTracker, walletPosition, walletChanged, liqFills, predictedFunding, WALLET_TOP, WALLET_REFRESH_MS, MAJORS, venueSubs, venueParse, venueApply, venueRecord, BOOK_EDGES, book, mergeBook, flowStat, premium, openInterest, ratioPoint, ratiosChanged, hlCtx, force, basis, prune, slice, fit};
})();
