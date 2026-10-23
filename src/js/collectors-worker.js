// Always-on collectors, run in a Web Worker (the page puts collectors-core.js before this file and starts it from collectors.js, whether or not
// auto-record is armed). Why a worker: its timers and sockets are not slowed with a hidden tab. It reads public endpoints only (no keys),
// posts {t:"col", rec} for each record and {t:"note", k, d} for the Health log, and never touches anything else. An error or a rate limit
// stops only the source concerned. Collector "derivs": Binance premium index + open interest (15 s), Hyperliquid funding / open interest
// (15 s), long-short and taker ratios (60 s), and from one stream the basis (10 s) and every liquidation. Collector "calendar": a record at every
// scheduled instant (COLLECT.calendar, by rule, no network). The page says which collectors are on in the start message: {t:"start", sym, want:{derivs, calendar}}.
let on = false, gen = 0, sym = "btc", want = {}, ws = null, lastMsg = 0, timer = null, mk = null, prevRatios = null, lastCal = 0;
const last = {}, busy = {}, hold = {}, said = {};
const BN = "https://fapi.binance.com", HLI = "https://api.hyperliquid.xyz/info";
const post = m => self.postMessage(m);
const col = (name, t, payload) => post({t:"col", rec:COLLECT.rec(name, t, payload)});
function say(name, err) {      // one note per source per 5 minutes: an outage must not fill the log
  const now = Date.now(); if (said[name] && now - said[name] < 300000) return; said[name] = now;
  post({t:"note", k:"collector error", d:{collector:name, err:String(err && err.message || err)}});
}
async function getJson(name, url, init) {
  const r = await fetch(url, Object.assign({cache:"no-store"}, init));
  if (r.status === 429 || r.status === 418) { hold[name] = Date.now() + COLLECT.BACKOFF_MS; throw new Error("HTTP " + r.status + ", resting 5 min"); }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function run(name, fn) {
  if (busy[name] || (hold[name] && hold[name] > Date.now())) return;
  busy[name] = true;
  try { await fn(); } catch (e) { say(name, e); } finally { busy[name] = false; }
}
const first = rs => { const f = rs.find(r => r.status === "rejected"); return f ? f.reason : new Error("no usable answer"); };

async function pollPremium() {
  const s = sym.toUpperCase() + "USDT", g = gen, t = Date.now();
  const rs = await Promise.allSettled([getJson("bnDerivs", `${BN}/fapi/v1/premiumIndex?symbol=${s}`), getJson("bnDerivs", `${BN}/fapi/v1/openInterest?symbol=${s}`)]);
  if (!on || g !== gen) return;
  const p = rs[0].status === "fulfilled" ? COLLECT.premium(rs[0].value) : null, o = rs[1].status === "fulfilled" ? COLLECT.openInterest(rs[1].value) : null;
  if (!p && !o) throw first(rs);
  col("bnDerivs", t, {prem:p, oi:o});
}
async function pollHl() {
  const g = gen, t = Date.now();
  const j = await getJson("hlCtx", HLI, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({type:"metaAndAssetCtxs"})});
  if (!on || g !== gen) return;
  const c = COLLECT.hlCtx(j, sym.toUpperCase()); if (!c) throw new Error("no usable answer for " + sym.toUpperCase());
  col("hlCtx", t, c);
}
async function pollRatios() {
  const s = sym.toUpperCase() + "USDT", g = gen, t = Date.now(), q = `symbol=${s}&period=5m&limit=1`;
  const rs = await Promise.allSettled([getJson("ratios", `${BN}/futures/data/globalLongShortAccountRatio?${q}`), getJson("ratios", `${BN}/futures/data/topLongShortPositionRatio?${q}`), getJson("ratios", `${BN}/futures/data/takerlongshortRatio?${q}`)]);
  if (!on || g !== gen) return;
  const ok = (i, kind) => rs[i].status === "fulfilled" ? COLLECT.ratioPoint(kind, rs[i].value) : null;
  const cur = {acct:ok(0, "acct"), top:ok(1, "top"), taker:ok(2, "taker")};
  if (!cur.acct && !cur.top && !cur.taker) throw first(rs);
  if (COLLECT.ratiosChanged(prevRatios, cur)) { prevRatios = cur; col("ratios", t, cur); }
}

function open() {
  const g = gen, s = sym.toLowerCase(); let w;
  try { w = new WebSocket(`wss://fstream.binance.com/market/stream?streams=${s}usdt@markPrice@1s/${s}usdt@forceOrder`); } catch (e) { say("stream", e); return; }
  ws = w; lastMsg = Date.now();
  w.onmessage = ev => {
    try {
      const d = JSON.parse(ev.data).data; lastMsg = Date.now();
      const f = COLLECT.force(d); if (f) return col("liq", lastMsg, f);
      const b = COLLECT.basis(d); if (b) mk = b;
    } catch {}
  };
  w.onclose = () => { if (!on || g !== gen) return; say("stream", "closed, reopening"); setTimeout(() => { if (on && g === gen) open(); }, 5000); };
}
function tick() {
  if (!on) return;
  const now = Date.now();
  if (want.derivs && ws && now - lastMsg > 15000) try { ws.close(); } catch {}      // silent without closing: close it so onclose reopens it
  if (want.calendar) {      // a gap longer than 6 h (the computer slept) is not back-filled
    for (const c of COLLECT.calendar(Math.max(lastCal, now - 6*3600000), now)) col("cal", c.t, {tags:c.tags});
    lastCal = now;
  }
  if (!want.derivs) return;
  const E = COLLECT.EVERY;
  if (COLLECT.due(last.prem, now, E.prem)) { last.prem = now; run("bnDerivs", pollPremium); }
  if (COLLECT.due(last.hl, now, E.hl)) { last.hl = now; run("hlCtx", pollHl); }
  if (COLLECT.due(last.ratios, now, E.ratios)) { last.ratios = now; run("ratios", pollRatios); }
  if (mk && now - lastMsg < 15000 && COLLECT.due(last.basis, now, E.basis)) { last.basis = now; col("basis", now, mk); }
}
self.onmessage = ev => {
  const m = ev.data;
  if (m.t === "start") { on = true; gen++; sym = String(m.sym || "btc"); want = m.want || {derivs:true}; mk = null; prevRatios = null; lastCal = Date.now(); for (const k of [last, busy, hold, said]) for (const i in k) delete k[i]; if (want.derivs) open(); clearInterval(timer); timer = setInterval(tick, 1000); tick(); }
  else if (m.t === "stop") { on = false; gen++; clearInterval(timer); try { if (ws) ws.close(); } catch {} ws = null; }
};
