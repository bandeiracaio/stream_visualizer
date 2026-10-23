// Auto-record's price feed, run in a Web Worker (the page puts this text after auto-record-core.js and starts it as a worker).
// Why a worker: a hidden tab has its timers slowed to once a minute and can be frozen, which starved the page's own price socket and made
// auto-record start its 15 minutes of learning over. A worker keeps its own timers and socket, so the price history keeps building.
// It owns the socket, the reconnects, the 15 s silence check and the volatility reading; the page only reads the result and decides.
let ws = null, on = false, gen = 0, url = "", cfg = {}, h = null, lastMsg = 0, tickTimer = null;
const post = m => self.postMessage(m);
function open() {
  const g = gen; let s;
  try { s = new WebSocket(url); } catch (err) { post({t:"error", msg:String(err && err.message || err)}); return; }
  ws = s; lastMsg = Date.now(); const opened = lastMsg;
  s.onmessage = ev => { try { const j = JSON.parse(ev.data), d = j.data || j; if (d && d.p){ lastMsg = Date.now(); AUTOREC.push(h, lastMsg, +d.p); } } catch {} };
  s.onclose = () => {
    if (!on || g !== gen) return;
    post({t:"drop", d:{at:Date.now(), upMs:Date.now() - opened, silentMs:Date.now() - lastMsg}});
    setTimeout(() => { if (on && g === gen) open(); }, 5000);
  };
}
function tick() {
  if (!on) return;
  if (ws && Date.now() - lastMsg > 15000) try { ws.close(); } catch {}      // a socket that went silent without closing: close it so onclose reopens it
  const now = Date.now();
  post({t:"vol", v:AUTOREC.vol(h, cfg, now), lastMsg, ws:ws ? ws.readyState : -1, at:now});
}
self.onmessage = ev => {
  const m = ev.data;
  if (m.t === "start") { on = true; gen++; url = m.url; cfg = m.cfg || {}; h = AUTOREC.createHistory(); open(); clearInterval(tickTimer); tickTimer = setInterval(tick, 2000); tick(); }
  else if (m.t === "cfg") cfg = m.cfg || {};
  else if (m.t === "dump") post({t:"trace", rows:AUTOREC.dump(h, Date.now(), m.secs || 1800)});
  else if (m.t === "close") { try { if (ws) ws.close(); } catch {} }
  else if (m.t === "stop") { on = false; gen++; clearInterval(tickTimer); try { if (ws) ws.close(); } catch {} ws = null; }
};
