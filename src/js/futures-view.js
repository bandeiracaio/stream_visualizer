// Futures stack (view): Now > Futures stack. Price over the order-book heatmap, then liquidations, volume delta and open interest on one time axis, with the moments the setup is about boxed in cyan
// (FUTSTACK.highlights, futures-core.js), a live reading of the last few minutes, and Buy now / Sell now buttons that use the account chosen with the account button in the header.
// Display and its own history only: it reads the page's `trades`, `M` and `heatBn` / `heatHl` by name, keeps its own 4-hour bins, and places orders through the existing placeOrder. The Reader engine is untouched.
// Registered in app.js (VIEWS.register, id "futures"); loaded after app.js, before label-queue.
(function futuresSetup() {
  const cv = document.getElementById("cvFut"); if (!cv || typeof FUTSTACK === "undefined") return;
  const g = id => document.getElementById(id), KEEP = 4 * 3600e3, MARK = getComputedStyle(document.documentElement).getPropertyValue("--mark").trim() || "#ff00ff";
  const st = FUTSTACK.newStore(), seen = new WeakSet(), heats = { bn:[], hl:[] }, fills = [];            // fills: what this page placed from the buttons ({t, side, px}), drawn on the price panel
  const lastHeat = { bn:0, hl:0 };
  let profData = { rows:[] }, profKey = "", watermark = 0, hovX = null, hits = [], bins = [], geo = null, heatImg = null, heatKey = "";
  const heatOff = document.createElement("canvas");

  // ---- backfill: on every connect (and when the header coin changes) fetch the last 4 hours from Binance so the chart is not empty ----
  let curCoin = null, wasConn = false, bfGen = 0, bfMsg = "", liveFrom = null;
  async function backfill(coin) {
    const gen = ++bfGen, sym = coin + "USDT"; bfMsg = "backfilling the last 4 hours from Binance…";
    try {
      const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(u.split("?")[0].split("/").pop() + " " + r.status); return r.json(); };
      const [kl, oh] = await Promise.all([get(`${BN_REST}/fapi/v1/klines?symbol=${sym}&interval=1m&limit=241`), get(`${BN_REST}/futures/data/openInterestHist?symbol=${sym}&period=5m&limit=60`).catch(() => [])]);
      if (gen !== bfGen) return; if (!Array.isArray(kl)) throw new Error("no klines for " + sym);
      const now = nowEx(), r = FUTSTACK.backfill(st, kl.filter(x => +x[6] < now), Array.isArray(oh) ? oh : [], now);
      const hist = await Promise.allSettled([get(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=5min&limit=60`), get(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${coin}-USDT-SWAP&period=5m&limit=60`)]);
      if (gen !== bfGen) return; const exOi = [];
      if (hist[0].status === "fulfilled" && hist[0].value.result && Array.isArray(hist[0].value.result.list) && FUTSTACK.backfillOi(st, "by", hist[0].value.result.list.map(x => ({ t:+x.timestamp, v:+x.singleOpenInterest })), now)) exOi.push("Bybit");   // singleOpenInterest: one side, the same scale as Binance and OKX (openInterest counts both sides)
      if (hist[1].status === "fulfilled" && Array.isArray(hist[1].value.data) && FUTSTACK.backfillOi(st, "ok", hist[1].value.data.map(x => ({ t:+x[0], v:+x[2] })), now)) exOi.push("OKX");
      bfMsg = r.minutes ? `backfilled ${r.minutes} min of price and delta${r.oiPoints ? " and open interest" : " (no open interest history)"} from Binance: 1-minute detail, no liquidations before you connected${exOi.length ? "; open interest history also from " + exOi.join(" and ") : ""}` : "nothing to backfill";
    } catch (e) { if (gen === bfGen) bfMsg = "backfill failed: " + e.message; }
    if (gen === bfGen && typeof futuresRender === "function") futuresRender();
  }
  function histManage(coin) {
    const on = typeof connected !== "undefined" && connected;
    if (!on) { wasConn = false; return; }
    if (coin && coin !== curCoin) { if (curCoin != null) { FUTSTACK.reset(st); heats.bn.length = heats.hl.length = 0; fills.length = 0; watermark = 0; heatKey = ""; } curCoin = coin; wasConn = false; }
    if (!wasConn && coin) { wasConn = true; liveFrom = nowEx(); backfill(coin); }
  }

  // ---- Bybit and OKX open interest: polled every 10 s while connected (public REST, one side, in coin) ----
  const OIX = { by:"–", ok:"–" }; let lastOiPoll = 0;
  function oiPoll(coin) {
    if (!coin || Date.now() - lastOiPoll < 10000) return; lastOiPoll = Date.now();
    const one = (k, url, pick) => fetch(url).then(r => r.json()).then(j => { if (coin !== curCoin) return; const v = pick(j); if (v > 0) { FUTSTACK.setOi(st, k, v); OIX[k] = "live"; } else OIX[k] = "no reading"; }).catch(() => { OIX[k] = "error"; });
    one("by", `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${coin}USDT`, j => +(j.result && j.result.list && j.result.list[0] && j.result.list[0].singleOpenInterest));
    one("ok", `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${coin}-USDT-SWAP`, j => +(j.data && j.data[0] && j.data[0].oiCcy));
  }

  // ---- Bybit and OKX liquidation sockets: open while the page is connected, for the coin in the header (own sockets; the collectors' worker is untouched) ----
  const LQ = { by:{ name:"Bybit", ws:null, coin:null, st:"off", gen:0, ping:null, retry:null, hold:0 }, ok:{ name:"OKX", ws:null, coin:null, st:"off", gen:0, ping:null, retry:null, hold:0 } };
  function lqClose(k) { const s = LQ[k]; s.gen++; clearInterval(s.ping); clearTimeout(s.retry); if (s.ws) { try { s.ws.close(); } catch (e) { /* already closed */ } } s.ws = null; s.st = "off"; s.coin = null; }
  async function lqConnect(k, coin) {
    const s = LQ[k]; lqClose(k); const gen = s.gen; s.coin = coin; s.st = "connecting"; let ctVal = null;
    if (k === "ok") {                                                                       // OKX sizes are contracts: ask what one contract is in coin
      try { const j = await (await fetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${coin}-USDT-SWAP`)).json(), d = j.data && j.data[0]; ctVal = d ? +d.ctVal * (+d.ctMult || 1) : null; } catch (e) { ctVal = null; }
      if (gen !== s.gen) return; if (!(ctVal > 0)) { s.st = "no " + coin + "-USDT swap"; s.coin = null; s.hold = Date.now() + 30000; return; }
    }
    let ws; try { ws = new WebSocket(k === "by" ? "wss://stream.bybit.com/v5/public/linear" : "wss://ws.okx.com/ws/v5/public"); } catch (e) { s.st = "blocked"; s.coin = null; s.hold = Date.now() + 30000; return; }
    s.ws = ws;
    ws.onopen = () => { if (gen !== s.gen) return; ws.send(JSON.stringify(k === "by" ? { op:"subscribe", args:["allLiquidation." + coin + "USDT"] } : { op:"subscribe", args:[{ channel:"liquidation-orders", instType:"SWAP" }] })); s.st = "live"; s.ping = setInterval(() => { try { ws.send(k === "by" ? '{"op":"ping"}' : "ping"); } catch (e) { /* closing */ } }, 20000); };
    ws.onmessage = e => { if (gen !== s.gen || e.data === "pong") return; let j; try { j = JSON.parse(e.data); } catch (x) { return; } for (const t of FUTSTACK.parseLiq(k, j, { coin, ctVal })) { FUTSTACK.addTrade(st, t); HOOKS.emit("liquidation", t); } };
    ws.onclose = () => { if (gen !== s.gen) return; clearInterval(s.ping); s.ws = null; s.st = "reconnecting"; s.retry = setTimeout(() => { if (gen === s.gen && typeof connected !== "undefined" && connected) lqConnect(k, coin); }, 3000); };
  }
  function lqManage() {
    const coin = (typeof accAsset === "function" ? accAsset() : "").replace(/[^A-Z0-9]/g, "");
    for (const k of ["by", "ok"]) { const s = LQ[k];
      if (typeof connected === "undefined" || !connected || !coin) { if (s.st !== "off") lqClose(k); continue; }
      if (s.coin !== coin && s.st !== "connecting" && Date.now() >= s.hold) lqConnect(k, coin); }
  }

  // ---- history: runs once a second while connected, whether or not the view is open ----
  setInterval(() => {
    const coinNow = (typeof accAsset === "function" ? accAsset() : "").replace(/[^A-Z0-9]/g, ""); histManage(coinNow); lqManage(); if (typeof connected !== "undefined" && connected) oiPoll(coinNow); if (typeof connected === "undefined" || !connected) return; const now = nowEx();
    for (let i = trades.length - 1; i >= 0; i--) {
      const t = trades[i]; if (t.t < watermark - 5000) break;
      if (seen.has(t) || t.bf) continue; seen.add(t); if (t.t > watermark) watermark = t.t;
      FUTSTACK.addTrade(st, t); if (t.liq) HOOKS.emit("liquidation", t);
    }
    FUTSTACK.setOi(st, "bn", M.bnOI); FUTSTACK.setOi(st, "hl", M.hlOI); FUTSTACK.stamp(st, now); FUTSTACK.prune(st, KEEP, now);
    for (const v of ["bn", "hl"]) {
      const src = v === "bn" ? heatBn : heatHl, last = src[src.length - 1], list = heats[v];
      if (last && last.t - lastHeat[v] >= 4900) { list.push(last); lastHeat[v] = last.t; }
      while (list.length && list[0].t < now - KEEP) list.shift();
    }
  }, 1000);

  const oiNote = () => { const v = bins.oiVenues; return (v && v.length ? v.map(x => ({ bn:"Binance", hl:"Hyperliquid", by:"Bybit", ok:"OKX" }[x])).join(" + ") : "none yet") + ` (Bybit ${OIX.by}${v && v.includes("by") ? "" : ", left out of this window"}, OKX ${OIX.ok}${v && v.includes("ok") ? "" : ", left out of this window: live only, no history the browser may read"})`; };
  const cfg = () => ({ minLiqUsd:Math.max(0, +g("fsMin").value || 0) }), liqAll = () => g("fsLiqAll").checked;
  const fmtOi = v => v == null ? "–" : fmtK(v);
  const pct = x => x == null ? "–" : (x >= 0 ? "+" : "") + (x * 100).toFixed(3) + "%";
  const sgn = x => (x >= 0 ? "+" : "-") + "$" + fmtK(Math.abs(x));
  const hhmm = t => { const d = new Date(t - clockOffset); return d.toTimeString().slice(0, 8); };

  function heatImage(list, bs, binMs, lo, hi, ph) {
    const n = bs.length, rows = Math.max(30, Math.min(160, Math.round(ph / 3))), rowSz = (hi - lo) / rows, t0 = bs[0].t, sum = new Float32Array(n * rows), cnt = new Uint16Array(n);
    for (const s of list) {
      const c = Math.floor((s.t - t0) / binMs); if (c < 0 || c >= n) continue; cnt[c]++; const a = s.arr;
      for (let i = 0; i < a.length; i++) { const q = a[i]; if (!q) continue; const r = Math.floor((hi - (s.lo + (i + .5) * s.base)) / rowSz); if (r >= 0 && r < rows) sum[r * n + c] += q; }
    }
    const nz = []; for (let c = 0; c < n; c++) if (cnt[c]) for (let r = 0; r < rows; r++) { const v = sum[r * n + c] / cnt[c]; if (v > 0) nz.push(v); }
    nz.sort((a, b) => a - b); const ref = Math.log1p(nz.length ? nz[Math.floor(nz.length * .98)] : 1) || 1;
    heatOff.width = n; heatOff.height = rows; const hc = heatOff.getContext("2d"), img = hc.createImageData(n, rows), px = img.data;
    for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) {
      const o = (r * n + c) * 4; if (!cnt[c]) { px[o + 3] = 0; continue; }
      const v = sum[r * n + c] / cnt[c], col = HEAT_LUT[Math.round((v ? Math.min(1, Math.log1p(v) / ref) : 0) * 255)]; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 235;
    }
    hc.putImageData(img, 0, 0); return heatOff;
  }

  function position() { const d = typeof ACC !== "undefined" && ACC.data; return d && d.positions ? d.positions.find(p => p.symbol === accSym() && p.qty) : null; }

  function draw() {
    const { ctx, w, h } = prep(cv), venue = g("fsVenue").value, win = +g("fsWin").value, binMs = +g("fsBin").value, t1 = nowEx();
    let all = FUTSTACK.aggregate(st, { venue, t0:t1 - win, t1, binMs, liqAll:liqAll() }); const first = all.findIndex(b => b.has);
    if (first < 0) { bins = []; geo = null; hits = []; return emptyMsg(ctx, w, h, connected ? "collecting… history starts when you press Connect" : "press Connect"); }
    const showProf = g("fsProf").checked, showStats = g("fsStats").checked, STAT_ROWS = 5, rowH = 12, stripH = showStats ? STAT_ROWS * rowH : 0;
    bins = all.slice(first); bins.oiVenues = all.oiVenues; const n = bins.length, L = 6, R = 64, PG = showProf ? 84 : 0, B = 16, gap = 6, avail = h - B - gap * (showStats ? 4 : 3) - stripH, hP = avail * .5, hL = avail * .14, hD = avail * .18, hO = avail - hP - hL - hD;
    const top = [4, 4 + hP + gap, 4 + hP + hL + gap * 2, 4 + hP + hL + hD + gap * 3, 4 + hP + hL + hD + hO + gap * 4], pw = w - L - R - PG, t0 = bins[0].t, span = n * binMs, bw = pw / n, bottom = showStats ? top[4] + stripH : top[3] + hO;
    const X = t => L + (t - t0) / span * pw, xc = j => L + (j + .5) * bw;
    geo = { L, pw, n, bw, top, hs:[hP, hL, hD, hO], h, bottom };
    hits = g("fsMark").checked ? FUTSTACK.highlights(bins, cfg()) : [];
    // price range
    let lo = Infinity, hi = -Infinity; for (const b of bins) if (b.o != null) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
    const pos = position(); if (pos && pos.entry) { lo = Math.min(lo, pos.entry); hi = Math.max(hi, pos.entry); }
    if (!isFinite(lo)) { lo = 0; hi = 1; } const pad = Math.max((hi - lo) * .06, hi * .00005); lo -= pad; hi += pad;
    const Yp = p => top[0] + (hi - p) / (hi - lo) * hP;
    // panel frames and titles
    ctx.fillStyle = TH.dim; ctx.textAlign = "left";
    const titles = ["", "Liquidations $ (" + (liqAll() ? "Binance + Bybit + OKX" : venue === "bn" ? "Binance" : venue === "hl" ? "Hyperliquid: no feed" : "Binance") + ")   ▲ shorts liquidated   ▼ longs liquidated", "Volume delta $  (taker buy − sell)", "Open interest (" + (bins.oiVenues && bins.oiVenues.length ? bins.oiVenues.map(x => x.toUpperCase()).join(" + ") : venue.toUpperCase()) + ", coin)   green = rising, red = falling"];
    for (let k = 0; k < 4; k++) { ctx.strokeStyle = TH.line; ctx.strokeRect(L + .5, top[k] + .5, pw, [hP, hL, hD, hO][k]); if (titles[k]) ctx.fillText(titles[k], L + 4, top[k] + 11); }
    // heatmap
    if (g("fsHeat").checked && venue !== "all") {
      const list = heats[venue], key = [venue, t0, n, binMs, lo.toFixed(2), hi.toFixed(2), Math.round(hP), list.length].join("|");
      if (list.length && key !== heatKey) { heatImg = heatImage(list, bins, binMs, lo, hi, hP); heatKey = key; }
      if (list.length && heatImg) { ctx.imageSmoothingEnabled = false; ctx.drawImage(heatImg, L, top[0], pw, hP); }
    }
    // price grid and candles
    const stp = niceStep((hi - lo) / 6); ctx.textAlign = "left";
    for (let p = Math.ceil(lo / stp) * stp; p <= hi; p += stp) { const y = Yp(p); ctx.strokeStyle = TH.a("hi", .12); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillStyle = TH.dim; ctx.fillText(fmt(p, stp < 1 ? 1 : 0), w - R + 4, y + 3.5); }
    for (let j = 0; j < n; j++) {
      const b = bins[j]; if (b.o == null) continue; const up = b.c >= b.o, col = up ? TH.buy : TH.sell, x = xc(j), bodyW = Math.max(1, bw * .7);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Yp(b.h)); ctx.lineTo(x, Yp(b.l)); ctx.stroke();
      ctx.fillRect(x - bodyW / 2, Math.min(Yp(b.o), Yp(b.c)), bodyW, Math.max(1, Math.abs(Yp(b.o) - Yp(b.c))));
    }
    // volume profile: volume at price over the shown window, buy part then sell part, the busiest price (POC) outlined
    if (showProf) {
      const key = [venue, t0, span, Math.floor(nowEx() / 5000)].join("|"); if (key !== profKey) { profData = FUTSTACK.profile(st, { venue, t0, t1:t0 + span }); profKey = key; }
      const rowsPx = new Map(); for (const r of profData.rows) { if (r.px < lo || r.px > hi) continue; const k = Math.floor(Yp(r.px) / 3), a = rowsPx.get(k) || { y:k * 3, b:0, s:0 }; a.b += r.b; a.s += r.s; rowsPx.set(k, a); }
      let mx = 0, poc = null; for (const a of rowsPx.values()) { const t = a.b + a.s; if (t > mx) { mx = t; poc = a; } }
      const x0 = L + pw + 8, wmax = PG - 12; ctx.fillStyle = TH.dim; ctx.fillText("volume profile", x0, top[0] + 11);
      if (mx > 0) {
        for (const a of rowsPx.values()) { const bw1 = a.b / mx * wmax, sw1 = a.s / mx * wmax; ctx.fillStyle = TH.a("buy", .8); ctx.fillRect(x0, a.y, bw1, 2.6); ctx.fillStyle = TH.a("sell", .8); ctx.fillRect(x0 + bw1, a.y, sw1, 2.6); }
        ctx.strokeStyle = TH.hi; ctx.lineWidth = 1; ctx.strokeRect(x0 - .5, poc.y - .5, (poc.b + poc.s) / mx * wmax + 1, 3.6);
        ctx.setLineDash([2, 5]); ctx.strokeStyle = TH.a("hi", .3); ctx.beginPath(); ctx.moveTo(L, poc.y + 1); ctx.lineTo(L + pw, poc.y + 1); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // my fills and entry price
    if (pos && pos.entry) { ctx.setLineDash([5, 4]); ctx.strokeStyle = TH.hi; ctx.beginPath(); ctx.moveTo(L, Yp(pos.entry)); ctx.lineTo(L + pw, Yp(pos.entry)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = TH.hi; ctx.fillText("entry " + fmt(pos.entry, 1), L + 4, Yp(pos.entry) - 3); }
    for (const f of fills) { if (f.t < t0 || !(f.px >= lo && f.px <= hi)) continue; const x = X(f.t), y = Yp(f.px), up = f.side === "BUY"; ctx.fillStyle = up ? TH.buy : TH.sell; ctx.strokeStyle = TH.hi; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y + (up ? 0 : 0)); ctx.lineTo(x - 6, y + (up ? 11 : -11)); ctx.lineTo(x + 6, y + (up ? 11 : -11)); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    const lastB = [...bins].reverse().find(b => b.c != null);
    if (lastB) { const y = Yp(lastB.c); ctx.fillStyle = TH.hi; ctx.fillRect(w - R + 1, y - 7, R - 2, 14); ctx.fillStyle = TH.ink; ctx.fillText(fmt(lastB.c, 1), w - R + 4, y + 3.5); }
    // liquidations: shorts liquidated (forced buys) up, longs liquidated (forced sells) down
    const mid = top[1] + hL / 2, maxL = Math.max(1, ...bins.map(b => Math.max(b.bl, b.sl))), half = hL / 2 - 14;
    ctx.strokeStyle = TH.edge; ctx.beginPath(); ctx.moveTo(L, mid); ctx.lineTo(L + pw, mid); ctx.stroke();
    for (let j = 0; j < n; j++) { const b = bins[j], x = xc(j) - Math.max(1, bw * .7) / 2, wd = Math.max(1, bw * .7); if (b.bl) { ctx.fillStyle = TH.buy; ctx.fillRect(x, mid - b.bl / maxL * half, wd, b.bl / maxL * half); } if (b.sl) { ctx.fillStyle = TH.sell; ctx.fillRect(x, mid, wd, b.sl / maxL * half); } }
    ctx.fillStyle = TH.dim; ctx.fillText(fmtK(maxL), w - R + 4, mid - half + 4); ctx.fillText("0", w - R + 4, mid + 3.5);
    // delta
    const midD = top[2] + hD / 2, maxD = Math.max(1, ...bins.map(b => Math.abs(b.delta))), halfD = hD / 2 - 14;
    ctx.strokeStyle = TH.edge; ctx.beginPath(); ctx.moveTo(L, midD); ctx.lineTo(L + pw, midD); ctx.stroke();
    for (let j = 0; j < n; j++) { const b = bins[j]; if (!b.has) continue; const x = xc(j) - Math.max(1, bw * .7) / 2, wd = Math.max(1, bw * .7), hh = Math.abs(b.delta) / maxD * halfD; ctx.fillStyle = b.delta >= 0 ? TH.buy : TH.sell; ctx.fillRect(x, b.delta >= 0 ? midD - hh : midD, wd, hh); }
    ctx.fillStyle = TH.dim; ctx.fillText("+" + fmtK(maxD), w - R + 4, midD - halfD + 4); ctx.fillText("-" + fmtK(maxD), w - R + 4, midD + halfD + 4); ctx.fillText("0", w - R + 4, midD + 3.5);
    // open interest
    let oLo = Infinity, oHi = -Infinity; for (const b of bins) if (b.oi != null) { if (b.oi < oLo) oLo = b.oi; if (b.oi > oHi) oHi = b.oi; }
    if (isFinite(oLo)) {
      const op = Math.max((oHi - oLo) * .15, oHi * .00002); oLo -= op; oHi += op; const Yo = v => top[3] + 14 + (oHi - v) / (oHi - oLo) * (hO - 20);
      ctx.lineWidth = 1.6; let pj = -1, dirCol = TH.dim;                                       // each segment is coloured by the direction of the change: rising = positions opening, falling = closing
      for (let j = 0; j < n; j++) { const b = bins[j]; if (b.oi == null) continue; if (pj >= 0 && j - pj <= 3) { const d = b.oi - bins[pj].oi; dirCol = d > 0 ? TH.buy : d < 0 ? TH.sell : TH.dim; ctx.strokeStyle = dirCol; ctx.beginPath(); ctx.moveTo(xc(pj), Yo(bins[pj].oi)); ctx.lineTo(xc(j), Yo(b.oi)); ctx.stroke(); } pj = j; } ctx.lineWidth = 1;
      ctx.fillStyle = TH.dim; ctx.fillText(fmtK(oHi - op), w - R + 4, top[3] + 18); ctx.fillText(fmtK(oLo + op), w - R + 4, top[3] + hO - 4);
      const lo2 = [...bins].reverse().find(b => b.oi != null); if (lo2) { const y = Yo(lo2.oi); ctx.fillStyle = dirCol === TH.dim ? TH.accent : dirCol; ctx.fillRect(w - R + 1, y - 7, R - 2, 14); ctx.fillStyle = TH.ink; ctx.fillText(fmtK(lo2.oi), w - R + 4, y + 3.5); }
    } else { ctx.fillStyle = TH.dim; ctx.textAlign = "center"; ctx.fillText("no open interest reading yet (needs the openInterest stream on)", L + pw / 2, top[3] + hO / 2); ctx.textAlign = "left"; }
    // bar stats: one row per measure, one cell per candle. Diverging rows (green up / red down) are scaled by the 90th percentile of the window; the others by the 95th.
    if (showStats) {
      const pc = (arr, q) => { const a = arr.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0; };
      const rowsDef = [["Δ share", b => b.dpct, true], ["OI Δ", b => b.doi, true], ["Volume", b => b.has ? b.vol : null, false], ["Trades", b => b.has ? b.n : null, false], ["Range", b => b.range, false]];
      rowsDef.forEach(([nm, fn, div], ri) => {
        const vals = bins.map(fn), ref = div ? pc(vals.map(v => v == null ? null : Math.abs(v)), .9) : pc(vals, .95), y = top[4] + ri * rowH;
        ctx.fillStyle = TH.dim; ctx.textAlign = "left"; ctx.fillText(nm, w - R + 4, y + rowH - 2);
        if (!(ref > 0)) return;
        for (let j = 0; j < n; j++) { const v = vals[j]; if (v == null) continue; const m = Math.min(1, Math.abs(v) / ref); ctx.fillStyle = div ? (v >= 0 ? TH.a("buy", .12 + .88 * m) : TH.a("sell", .12 + .88 * m)) : TH.a("accent", .08 + .92 * m); ctx.fillRect(L + j * bw, y, Math.ceil(bw) + .5, rowH - 1); }
      });
    }
    // time axis
    ctx.fillStyle = TH.dim; ctx.textAlign = "center"; const every = Math.max(1, Math.round(90 / bw));
    for (let j = 0; j < n; j += every) ctx.fillText(hhmm(bins[j].t).slice(0, binMs >= 60000 ? 5 : 8), xc(j), h - 4);
    ctx.textAlign = "left";
    // highlights: one cyan box through every panel, with the three checks above it
    for (const hl of hits) {
      const x0 = L + hl.i0 * bw - 2, x1 = L + (hl.i1 + 1 + Math.min(2, n - 1 - hl.i1)) * bw + 2, y0 = top[0] + 2, y1 = bottom - 1;
      ctx.strokeStyle = MARK; ctx.lineWidth = hl.strong ? 2.6 : 1.4; ctx.setLineDash(hl.strong ? [] : [5, 3]);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, y0, Math.max(8, x1 - x0), y1 - y0, 5); else ctx.rect(x0, y0, Math.max(8, x1 - x0), y1 - y0); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      const lab = [["LIQ", true], ["Δ", hl.checks.delta], ["OI", hl.checks.oi]]; let lx = Math.min(Math.max(L + 2, x0 + 3), L + pw - 112); const ly = top[0] + 22;
      ctx.font = "bold 11px ui-monospace,Menlo,Consolas,monospace";
      for (const [nm, okc] of lab) { const s = nm + (okc ? "✓" : "✗") + " "; ctx.fillStyle = TH.canvas; ctx.fillRect(lx - 1, ly - 10, ctx.measureText(s).width + 2, 13); ctx.fillStyle = okc ? MARK : TH.dim; ctx.fillText(s, lx, ly); lx += ctx.measureText(s).width; }
      ctx.font = "10.5px ui-monospace,Menlo,Consolas,monospace";
    }
    // where the backfilled history ends and live data starts
    if (st.bf && liveFrom != null && liveFrom > t0 && liveFrom < t0 + span) {
      const x = X(liveFrom); ctx.setLineDash([2, 4]); ctx.strokeStyle = TH.a("hi", .5); ctx.beginPath(); ctx.moveTo(x, top[0]); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = TH.dim; ctx.textAlign = "right"; ctx.fillText("backfilled ◂", x - 4, top[0] + hP - 6); ctx.textAlign = "left"; ctx.fillText("▸ live", x + 4, top[0] + hP - 6);
    }
    // crosshair
    if (hovX != null && hovX >= L && hovX <= L + pw) {
      const j = Math.min(n - 1, Math.floor((hovX - L) / bw)), x = xc(j); ctx.strokeStyle = TH.a("hi", .6); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, top[0]); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  const hoverText = j => {
    const b = bins[j]; if (!b) return "Move over the chart (or tap it) to read one candle.";
    const prev = bins.slice(0, j).reverse().find(x => x.oi != null), dOi = prev && b.oi != null && prev.oi > 0 ? (b.oi - prev.oi) / prev.oi : null, rd = FUTSTACK.reading(b.delta, dOi), hit = hits.find(x => j >= x.i0 && j <= x.i1 + 2);
    return `${hhmm(b.t)} · ${b.o != null ? `O ${fmt(b.o, 1)} H ${fmt(b.h, 1)} L ${fmt(b.l, 1)} C ${fmt(b.c, 1)}` : "no trades"} · liq shorts $${fmtK(b.bl)} / longs $${fmtK(b.sl)} · delta ${sgn(b.delta)}${b.dpct == null ? "" : " (" + (b.dpct * 100).toFixed(0) + "% of " + "$" + fmtK(b.vol) + ")"} · trades ${Math.round(b.n)}${b.range == null ? "" : " · range " + b.range.toFixed(1) + " bps"} · OI ${fmtOi(b.oi)} (${pct(dOi)}) · ${rd.text}${hit ? " · " + hit.text : ""}`;
  };
  function onPointer(e) { const r = cv.getBoundingClientRect(); hovX = e.clientX - r.left; if (geo && geo.n) { const j = Math.min(geo.n - 1, Math.max(0, Math.floor((hovX - geo.L) / geo.bw))); g("fsHover").textContent = hoverText(j); } requestAnimationFrame(draw); }
  cv.addEventListener("pointermove", onPointer); cv.addEventListener("pointerdown", onPointer);
  cv.addEventListener("pointerleave", () => { hovX = null; requestAnimationFrame(draw); });

  // ---- the live reading beside the chart ----
  const setHtml = (el, html) => { if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; } };
  function panels() {
    setHtml(g("fsLiqSrc"), `Liquidation feeds: Binance ${connected ? "(app feed)" : "off"} · Bybit ${LQ.by.st} · OKX ${LQ.ok.st} · Hyperliquid: its feed does not flag liquidations · Open interest: ${oiNote()}${bfMsg ? " · History: " + bfMsg : ""}`);
    if (!bins.length) { setHtml(g("fsCheck"), `<b>Reading</b><div class="note">Waiting for data.</div>`); setHtml(g("fsHits"), `<b>Boxed moments</b><div class="note">None yet.</div>`); return; }
    const n = Math.max(1, Math.ceil(300000 / (+g("fsBin").value))), s = FUTSTACK.summary(bins, n), cls = ok => ok ? "yes" : "no";
    const liqHit = s.bl + s.sl >= (cfg().minLiqUsd || 1), dHit = s.vol > 0 && Math.abs(s.delta) / s.vol > .1, oHit = s.oiPct != null && Math.abs(s.oiPct) >= .0002;
    setHtml(g("fsCheck"), `<b>Reading, last 5 minutes</b><div class="fs-ck">
      <div class="${cls(liqHit)}">Liquidations: shorts $${fmtK(s.bl)} · longs $${fmtK(s.sl)}</div>
      <div class="${cls(dHit)}">Volume delta: ${sgn(s.delta)} of $${fmtK(s.vol)} traded</div>
      <div class="${cls(oHit)}">Open interest: ${pct(s.oiPct)}</div>
      <div style="margin-top:4px"><b>${s.reading.text}</b></div></div>`);
    const list = [...hits].reverse().slice(0, 6).map(x => `<div class="fs-hit">${hhmm(x.t0).slice(0, 8)} · ${x.text}<br><span class="note" style="margin:0">${x.reading.text}</span></div>`).join("");
    setHtml(g("fsHits"), `<b>Boxed moments</b>${list || `<div class="note">None in this window. A box needs ≥ $${fmtK(cfg().minLiqUsd)} of liquidations in one candle, then checks delta and open interest.</div>`}`);
  }

  // ---- trade buttons ----
  function tradeUi() {
    if (ACC.mode === "sim") ACC.data = simSnapshot();
    const d = ACC.data, pos = position(), sz = +g("fsSize").value;
    g("fsAcct").textContent = ACC.mode ? "· account: " + ACC.mode.toUpperCase() + (ACC.mode === "live" ? " (REAL MONEY)" : "") : "· no account yet";
    g("fsStart").style.display = ACC.mode ? "none" : "";
    for (const id of ["fsBuy", "fsSell"]) g(id).disabled = !ACC.mode || !(sz > 0);
    g("fsClose").disabled = !pos;
    const px = M.bnBid && M.bnAsk ? (M.bnBid + M.bnAsk) / 2 : null;
    setHtml(g("fsPos"), !ACC.mode || !d ? "" : [["Position", pos ? `<span class="${pos.qty > 0 ? "ok" : "err"}">${pos.qty > 0 ? "Long" : "Short"} ${Math.abs(pos.qty)}</span> @ ${fmt(pos.entry, 1)}` : "flat"], ["Unrealized", pos ? `<span class="${pos.upnl >= 0 ? "ok" : "err"}">${pos.upnl >= 0 ? "+" : ""}${fmt(pos.upnl, 2)}</span>` : "–"],
      ["Wallet", "$" + fmt(d.balance.wallet, 2)], ["Price", px ? fmt(px, 1) : "–"]].map(([k, v]) => `<div class="metric"><span>${k}</span><b>${v}</b></div>`).join(""));
  }
  async function send(side, qtyUsd, reduceQty) {
    const msg = g("fsMsg"); const ref = side === "BUY" ? M.bnAsk : M.bnBid;
    if (!ref) { msg.className = "note err"; msg.textContent = "No live price yet; press Connect."; return; }
    const qty = reduceQty != null ? reduceQty : qtyUsd / ref; if (!(qty > 0)) { msg.className = "note err"; msg.textContent = "Enter a size."; return; }
    for (const id of ["fsBuy", "fsSell", "fsClose"]) g(id).disabled = true; msg.className = "note"; msg.textContent = "Sending…";
    try { const r = await placeOrder({ side, type:"MARKET", qty, price:ref, reduce:reduceQty != null }); fills.push({ t:nowEx(), side, px:ref }); msg.className = "note ok"; msg.textContent = "✓ " + side.toLowerCase() + " " + r.msg; }
    catch (e) { msg.className = "note err"; msg.textContent = e.message; }
    tradeUi(); draw();
  }
  g("fsBuy").onclick = () => send("BUY", +g("fsSize").value);
  g("fsSell").onclick = () => send("SELL", +g("fsSize").value);
  g("fsClose").onclick = () => { const p = position(); if (p) send(p.qty > 0 ? "SELL" : "BUY", 0, Math.abs(p.qty)); };
  g("fsStart").onclick = () => { g("simGo").click(); tradeUi(); };
  g("fsSize").oninput = tradeUi;
  for (const id of ["fsVenue", "fsWin", "fsBin", "fsHeat", "fsMark", "fsMin", "fsLiqAll", "fsProf", "fsStats"]) g(id).onchange = g(id).oninput = () => { heatKey = ""; futuresRender(); };

  window.futuresRender = function futuresRender() { try { draw(); panels(); tradeUi(); } catch (e) { console.error("futures", e); } };
  window.futuresRender.lq = LQ;                                             // read-only, for the Liquidations readout (liq-readout.js): the state of the Bybit and OKX sockets
  window.futuresRender.store = st;                                          // for tests: fill the store with simulated history from the console
})();
