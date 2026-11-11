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
    {id:"derivs", label:"Derivatives context: mark, funding, open interest, basis and liquidations (Binance, Hyperliquid)", speed:"slow", on:true, owner:"worker", expectMs:60000, records:["bnDerivs", "hlCtx", "basis", "liq"]},
    {id:"calendar", label:"Calendar tags: funding times, 15m / 1h / 4h / daily / weekly / monthly closes, US open and close, options expiry (rules, no network)", speed:"slow", on:true, owner:"worker", expectMs:900000, records:["cal"]},
    {id:"book", label:"Book depth (while recording): depth within 1 / 5 / 10 / 20 bps, spread, touch size, size added and removed per side (Binance, Hyperliquid; the worker keeps its own books)", speed:"fast", on:true, owner:"worker", expectMs:10000, records:["bookBn", "bookHl"]},
    {id:"venues", label:"Venue prices (while recording or armed): Coinbase and Bybit perp quotes and Binance spot, for the market state's venue-gap reading", speed:"fast", on:true, owner:"worker", expectMs:10000, records:["venues"]},
    {id:"options", label:"Volatility index (Deribit, BTC and ETH): the index, for the market state", speed:"slow", on:true, owner:"worker", expectMs:60000, records:["dvol"]},
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

  // Socket close log (a worker's sockets; the Health log shows it as "socket closed"). watch(name, w) listens to one socket without touching its own handlers and, on every close that was not
  // collection ending, posts the close code, wasClean, the reason, how long it had been up, how long since its last message, how many messages it carried, and ours = why OUR code closed it
  // (shut(w, "silent") is a worker's silence check, so a "closed, reopening" can be told from a server close; shut(w, "stop") is collection ending and is not logged). A flapping source writes
  // at most 5 notes an hour so the 400-event Health log is not pushed out; the notes carry the running close and error counts and how many were left out. now() and post() come from the worker.
  function sockWatch(post, now) {
    const stat = {};
    return {
      watch(name, w) {
        const st = stat[name] || (stat[name] = {closes:0, errors:0, win:0, logged:0, suppressed:0}), at = {open:0, msg:0, n:0};
        w.addEventListener("open", () => { at.open = now(); });
        w.addEventListener("message", () => { at.msg = now(); at.n++; });
        w.addEventListener("error", () => { st.errors++; });
        w.addEventListener("close", ev => {
          const t = now(), why = w._why || null; st.closes++;
          if (why === "stop") return;
          if (!st.win || t - st.win >= 3600000) { st.win = t; st.logged = 0; }
          if (st.logged >= 5) { st.suppressed++; return; }
          st.logged++; const lastIn = at.msg || at.open;
          post({t:"note", k:"socket closed", d:{src:name, code:ev.code, clean:!!ev.wasClean, reason:String(ev.reason || "").slice(0, 60) || null, upMs:at.open ? t - at.open : null, silentMs:lastIn ? t - lastIn : null, msgs:at.n, ours:why, closes:st.closes, errors:st.errors, left_out:st.suppressed || null}});
          st.suppressed = 0;
        });
      },
      shut(w, why) { try { w._why = why; w.close(); } catch (e) { /* already closed */ } }
    };
  }

  // ---- derivatives context (collector "derivs", run by collectors-worker.js). Readers of the public endpoints; each returns null for an answer that is not usable.
  // Verified live 2026-10-23, see .scratch/collectors/01-collectors.md.
  const EVERY = {prem:15000, hl:15000, basis:10000, dvol:10000}, BACKOFF_MS = 300000;      // polling spacing per source; a rate-limited source rests this long
  const num = x => { const n = +x; return x != null && x !== "" && Number.isFinite(n) ? n : null; };
  const due = (last, now, every) => !last || now - last >= every;
  function premium(j) {
    const mark = j && num(j.markPrice); if (mark == null) return null;
    return {mark, index:num(j.indexPrice), est:num(j.estimatedSettlePrice), fund:num(j.lastFundingRate), next:num(j.nextFundingTime), t:num(j.time)};
  }
  function openInterest(j) { const oi = j && num(j.openInterest); return oi == null ? null : {oi, t:num(j.time)}; }
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

  // ---- venue prices (collector "venues", run by collectors-worker.js while a recording is on or auto-record is armed): the same instrument on Coinbase, Bybit and Binance spot, to see how
  // far apart the prices are. Raw quotes only; the perp-spot basis and the correlation are worked out afterwards. Public sockets, no keys.
  // the sockets to open for a coin: {id, url, sub (sent on open), ping (sent every 20 s)}
  function venueSubs(coin) {
    const C = String(coin || "BTC").toUpperCase(), c = C.toLowerCase();
    return [
      {id:"cb", url:"wss://ws-feed.exchange.coinbase.com", sub:{type:"subscribe", product_ids:[C + "-USD"], channels:["ticker"]}},
      {id:"byL", url:"wss://stream.bybit.com/v5/public/linear", sub:{op:"subscribe", args:["tickers." + C + "USDT"]}, ping:{op:"ping"}},
      {id:"bnS", url:"wss://stream.binance.com:9443/stream?streams=" + c + "usdt@bookTicker"},
    ];
  }
  // One parsed socket message -> {src, set, e} (e = the exchange's own time in ms, or null), or null for anything that is not a price. Fields: b / a = best bid / ask,
  // l = last trade, m = mark, i = index, f = funding rate. Sources: cb Coinbase spot, byL Bybit perp, bnS Binance spot.
  // Bybit sends only the fields that changed, so a message is merged into what the source already holds (venueApply).
  const BYBIT = {bid1Price:"b", ask1Price:"a", lastPrice:"l", markPrice:"m", indexPrice:"i", fundingRate:"f"};
  function venueParse(id, j) {
    if (!j || typeof j !== "object") return null;
    const got = (src, pairs, e) => { const set = {}; let n = 0; for (const k in pairs) { const v = num(pairs[k]); if (v != null) { set[k] = v; n++; } } return n ? {src, set, e:e == null || !Number.isFinite(e) ? null : e} : null; };
    if (id === "cb") return j.type === "ticker" ? got("cb", {b:j.best_bid, a:j.best_ask, l:j.price}, Date.parse(j.time)) : null;
    if (id === "byL") {
      if (!j.data || typeof j.topic !== "string" || j.topic.indexOf("tickers.") !== 0) return null;
      const pairs = {}; for (const k in BYBIT) if (j.data[k] != null) pairs[BYBIT[k]] = j.data[k];
      return got(id, pairs, num(j.ts));
    }
    if (id === "bnS") { const d = j.data; return d && d.b != null && d.a != null ? got("bnS", {b:d.b, a:d.a}, null) : null; }
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

  // ---- options and volatility (collector "options", run by collectors-worker.js): only Deribit's volatility index is read (the "dvol" record), for the market state.
  const deribitCoin = sym => { const c = String(sym || "").toUpperCase(); return c === "BTC" || c === "ETH" ? c : null; };      // the coins with a Deribit volatility index

  // ---- status of each collector, for the list in the Reader tab (view: collectors.js)
  // derived from REGISTRY: which collector writes which record name; how often (ms) a collector writes while it is working (three times that late is "slow")
  const OWNER = {}; for (const c of REGISTRY) for (const n of c.records) OWNER[n] = c.id;
  const EXPECT_ORDER = ["telemetry", "derivs", "calendar", "options", "venues", "book"];      // the order the analysis reports list collectors in (it is not the registry order); kept as it was
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
        "basis.bps":          ["basis", p => num(p.bps)],
      },
      info: {
        "bnDerivs.fund":{label:"Binance funding", unit:"bps", scale:1e4, min:0.2}, "bnDerivs.basisBps":{label:"Binance basis", unit:"bps", min:0.3}, "bnDerivs.oi":{label:"Binance open interest", rel:true, min:0.1},
        "hlCtx.fund":{label:"Hyperliquid funding", unit:"bps", scale:1e4, min:0.2}, "hlCtx.prem":{label:"Hyperliquid premium", unit:"bps", scale:1e4, min:0.3}, "hlCtx.oi":{label:"Hyperliquid open interest", rel:true, min:0.1},
        "basis.bps":{label:"mark vs index", unit:"bps", min:0.3},
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
      },
      info: {
        "dvol.vol":{label:"volatility index", rel:true, min:0.3},
      },
    },
  };
  for (const c of REGISTRY) { const k = CONTRIB[c.id] || {}; c.features = k.features || {}; c.info = k.info || {}; }      // every collector has both, empty if it contributes none
  // FEATURES: name -> [record name, function(payload) -> number | null], FEATURE_INFO: name -> how a card shows it (a short name, and whether its change reads as a percentage of
  // its recent level (`rel`) or in its own unit (`unit`)). Both are the union of the registry's contributions. The ORDER of FEATURES is fixed (analysis plans depend on it, the
  // multiple-comparison count and the report lines follow it); the self-test checks that this list and the contributions are the same set.
  const FEATURE_ORDER = ["dvol.vol", "bnDerivs.fund", "bnDerivs.basisBps", "bnDerivs.oi", "hlCtx.fund", "hlCtx.prem", "hlCtx.oi", "basis.bps",
    "bookBn.spread", "bookBn.imbalance5", "bookBn.depth5", "bookHl.spread", "bookHl.imbalance5", "bookHl.depth5", "venues.coinbaseVsBinanceBps", "venues.bybitVsBinanceBps"];
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
  const featureMaxAge = f => Math.max(3*(EXPECT_MS[OWNER[FEATURES[f][0]]] || 60000), 120000);      // how old a reading may be and still count
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
    return {t:tMs, items, liq:{bn:lb, hl:lh}, liqx:liqDriven(recs, tMs, {coin:opt.coin})};
  }
  function cardText(info, dev, mean) {
    const sign = dev >= 0 ? "+" : "-", a = Math.abs(dev);
    if (info.rel) return mean ? sign + round(a/Math.abs(mean)*100, a/Math.abs(mean) < 0.1 ? 2 : 1) + "%" : sign + round(a, 2);
    const v = a*(info.scale || 1); return sign + round(v, v < 10 ? 2 : 1) + (info.unit ? " " + info.unit : "");
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

  // one socket message -> {venue, type "snapshot" | "delta", bids, asks (lists of [price, size] strings), seq, prev (OKX), cs (OKX checksum or null)} or null for anything that is not a book message
  function bookParse(id, j) {
    if (!j || typeof j !== "object") return null;
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
  // venue "bn" (Binance: REST snapshot, then diffs; the first diff must straddle the snapshot id, later ones chain on pu; the summary claims only the snapshot window as reach); opt.ct = coin per contract (OKX), opt.edges, opt.flowBps (flow window, default 20 bps), opt.maxLevels (levels a side the summary uses: the venue's window, 1000 Bybit / 400 OKX)
  function perpBook(venue, opt) {
    opt = opt || {}; const ct = 1, edges = opt.edges || BOOK_EDGES, flow = flowStat(opt.flowBps || 20), cap = opt.maxLevels || Infinity, bids = new Map(), asks = new Map();
    let ready = false, lastSeq = null, bb = -Infinity, ba = Infinity, firstDelta = false, snapLo = 0, snapHi = 0; const st = {snap:0, upd:0, gap:0, cross:0, ign:0, bad:0, resync:0};
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
    return {
      apply(m) {
        if (!m) return "ignored";
        if (m.type === "snapshot") {
          bids.clear(); asks.clear(); bb = -Infinity; ba = Infinity; flow.take();
          for (const e of m.bids) setLevel(true, e, false); for (const e of m.asks) setLevel(false, e, false);
          if (!bids.size || !asks.size || crossed()) return fail("cross");
          ready = true; lastSeq = m.seq; st.snap++; firstDelta = true;
          { snapLo = Infinity; snapHi = 0; for (const p of bids.keys()) if (p < snapLo) snapLo = p; for (const p of asks.keys()) if (p > snapHi) snapHi = p; }      // how far the snapshot reaches: past it the local book is incomplete
          return "snapshot";
        }
        if (!ready) { st.ign++; return "ignored"; }
        if (firstDelta) {      // the first event after a snapshot: drop what the snapshot already holds, then it must straddle the snapshot id
          if (m.seq <= lastSeq) { st.ign++; return "ignored"; }
          if (m.first > lastSeq + 1) return fail("gap");
          firstDelta = false;
        } else if (m.prev !== lastSeq) return fail("gap");
        for (const e of m.bids) setLevel(true, e, true); for (const e of m.asks) setLevel(false, e, true);
        lastSeq = m.seq; st.upd++;
        if (!bids.size || !asks.size || crossed()) return fail("cross");
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
        { const mid = (bb + ba)/2; reach = mid > 0 ? [Math.max(0, (mid - snapLo)*1e4/mid), Math.max(0, (snapHi - mid)*1e4/mid)] : [0, 0]; }      // Binance: the snapshot window, not the farthest stray level
        const s = book(arr(bids, true), arr(asks, false), edges, reach); return s ? Object.assign(s, {fl, rs:st.resync}) : null;
      },
      best: () => ready ? [bb, ba] : null,
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
  return {REGISTRY, TAPE_MS, FILE_BUDGET, EVERY, BACKOFF_MS, quantile, rec, isRec, feeds, streamStat, sockWatch, due, calendar, OWNER, EXPECT_MS, ownerOf, tally, ageText, health, FEATURES, FEATURE_INFO, featureSeries, featureMaxAge, context, liqDriven, usdText, wallQuality, marketState, marketStateSeries, STATE_VERSION, EVENT_LABEL, evSpan, eventsNear, eventClock, deribitCoin, bookParse, bnBookSub, hlBookParse, hlCoarse, hlBookSummary, perpBook, venueSubs, venueParse, venueApply, venueRecord, BOOK_EDGES, book, mergeBook, flowStat, premium, openInterest, hlCtx, force, basis, prune, slice, fit};
})();
