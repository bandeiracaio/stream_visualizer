"use strict";
// Liquidations (view, Now > Market and tape): what is being liquidated right now on Binance, Bybit and OKX, as clusters (events within 30 s), the last 30 minutes in one-minute bars, and for each cluster
// the price move before it and after it, in sigmas, signed in the direction the forced orders pushed. The events come from the same live feeds the Futures stack reads (the page's Binance feed, and Bybit
// and OKX sockets opened while the app is connected), through the "liquidation" hook; the maths is in liq-core.js. Display only: it opens no socket and touches no feed, recording or detection.
const LQV = {ev:[], keepMs:6*3600e3, cap:30000, sigma:null, sigmaAt:0, minUsd:25000};
const lqv$ = id => document.getElementById(id);
const lqvEsc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
HOOKS.on("liquidation", t => {
  if (!t || !(t.ntl > 0) || (t.side !== "buy" && t.side !== "sell")) return;
  LQV.ev.push({t:t.t, v:t.v, side:t.side, ntl:t.ntl});
  if (LQV.ev.length > LQV.cap) LQV.ev.splice(0, LQV.ev.length - LQV.cap);
});
function lqvSigma(now) {      // the Binance mid's sigma, bps per root second, refreshed once a minute (scoreboard-core's ruler)
  if (now - LQV.sigmaAt < 60000) return LQV.sigma; LQV.sigmaAt = now;
  const h = READER.priceHistory("bn"); LQV.sigma = h && h.length >= 300 ? SCOREBOARD.sigmaOf(h) : null; return LQV.sigma;
}
const lqvAgo = ms => { const s = Math.max(0, Math.round(ms/1000)); return s < 90 ? s + " s" : s < 5400 ? Math.round(s/60) + " min" : (s/3600).toFixed(1) + " h"; };
const lqvTime = t => new Date(t).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
const lqvMove = m => m == null ? "–" : `<span class="${m >= 0.3 ? "lq-cont" : m <= -0.3 ? "lq-back" : ""}">${m >= 0 ? "+" : ""}${m.toFixed(2)}</span>`;
function lqvSource(k) {
  const lq = typeof futuresRender === "function" && futuresRender.lq ? futuresRender.lq[k] : null, name = LIQ.NAME[k];
  if (k === "bn") return `<span class="lq-src ${connected ? "on" : ""}">${name} ${connected ? "live" : "off"}</span>`;
  const st = lq ? lq.st : "off"; return `<span class="lq-src ${st === "live" ? "on" : ""}">${name} ${lqvEsc(st)}</span>`;
}
function lqvRender() {
  if (typeof tab === "undefined" || tab !== "market") return;
  const box = lqv$("lqBox"); if (!box) return;
  const now = Date.now(), cut = now - LQV.keepMs; while (LQV.ev.length && LQV.ev[0].t < cut) LQV.ev.shift();
  const sum = LIQ.summary(LQV.ev, now, 900000), per = LIQ.VENUES.map(v => {
    const p = sum.per[v]; return `<div class="metric"><span>${LIQ.NAME[v]}, 15 min</span><b>${LIQ.usd(p.sell + p.buy)}</b><span class="stat">longs ${LIQ.usd(p.sell)} · shorts ${LIQ.usd(p.buy)} · ${p.n} ev</span></div>`; }).join("");
  const bk = LIQ.buckets(LQV.ev, now, 30*60000, 60000), mx = Math.max(1, ...bk.map(b => Math.max(b.sell, b.buy)));
  const bars = bk.map(b => `<div class="lq-col" title="${lqvTime(b.t)} · longs liquidated ${LIQ.usd(b.sell)} · shorts liquidated ${LIQ.usd(b.buy)}"><div class="lq-up"><i style="height:${(100*b.buy/mx).toFixed(1)}%"></i></div><div class="lq-dn"><i style="height:${(100*b.sell/mx).toFixed(1)}%"></i></div></div>`).join("");
  const cl = LIQ.clusters(LQV.ev).filter(c => c.ntl >= LQV.minUsd && c.t1 >= now - 2*3600e3).reverse().slice(0, 14);
  const sg = lqvSigma(now), h = sg ? READER.priceHistory("bn") : null;
  const rows = cl.map(c => {
    const m = sg ? LIQ.moves(h, c, sg, now, SCOREBOARD.forwardMove) : {pre:null, after60:null, after300:null, soFar:null}, act = LIQ.active(c, now);
    const after = m.after60 != null ? lqvMove(m.after60) : m.soFar && m.soFar.move != null ? lqvMove(m.soFar.move) + ` <span class="stat">${m.soFar.sec} s</span>` : "–";
    return `<tr class="${c.tier}"><td>${lqvTime(c.t0)}</td><td>${act ? '<b class="lq-now">forming</b> ' : ""}${lqvAgo(now - c.t1)} ago</td><td class="${c.dom === "sell" ? "lq-l" : "lq-s"}">${LIQ.sideText(c)}${c.domShare < 0.9 ? " (mixed)" : ""}</td><td><b>${LIQ.usd(c.ntl)}</b></td><td>${c.n}</td><td>${LIQ.mix(c)}</td><td>${lqvMove(m.pre)}</td><td>${after}</td><td>${lqvMove(m.after300)}</td></tr>`;
  }).join("");
  const off = typeof connected === "undefined" || !connected;
  box.innerHTML = `<div class="lq-src-row">${LIQ.VENUES.map(lqvSource).join("")}${LQV.ev.length ? `<span class="stat">${LQV.ev.length.toLocaleString("en-US")} liquidations seen since the page started, newest ${lqvAgo(now - LQV.ev[LQV.ev.length - 1].t)} ago</span>` : ""}</div>
    ${off ? `<div class="note" style="margin-top:0">Not connected: the liquidation feeds run while the app is connected. An armed or recording session still keeps Binance, Bybit and OKX liquidations in its file.</div>` : ""}
    <div class="metrics">${per}<div class="metric"><span>All three, 15 min</span><b>${LIQ.usd(sum.total)}</b><span class="stat">longs ${LIQ.usd(sum.sell)} · shorts ${LIQ.usd(sum.buy)}</span></div></div>
    <div class="stat" style="margin-top:6px">Last 30 minutes, one bar a minute (up: shorts liquidated, forced buys · down: longs liquidated, forced sells; each side scaled to the biggest minute, ${LIQ.usd(mx)})</div>
    <div class="lq-bars">${bars}</div>
    <div class="stat" style="margin-top:8px">Clusters of at least <select id="lqMin"><option value="25000">$25k</option><option value="100000">$100k</option><option value="1000000">$1M</option></select> in the last 2 hours (events within ${LIQ.GAP_MS/1000} s of each other), newest first</div>
    <div style="overflow-x:auto">${rows ? `<table class="tt lq-tab"><thead><tr><th>start</th><th>state</th><th>who</th><th>$</th><th>events</th><th>venues</th><th>5 min before</th><th>after</th><th>after 5 min</th></tr></thead><tbody>${rows}</tbody></table>${sg ? "" : `<div class="stat">Price moves appear after about 5 minutes of Binance price history.</div>`}` : `<div class="note">No cluster of that size in the last 2 hours${sg ? "" : " (price history is still short, moves need about 5 minutes)"}.</div>`}</div>
    <div class="note">Price moves are in sigmas of the Binance mid (the Scoreboard's ruler, about 0.7 is a typical minute), signed in the direction the liquidations pushed: <span class="lq-cont">plus</span> = price kept moving that way, <span class="lq-back">minus</span> = it came back. "after" is the first minute once a cluster has ended (and "so far" before that). Binance reports at most one liquidation per symbol per second, so its dollars are a lower bound; Bybit and OKX report every one. Bybit and OKX feeds are the same ones the Futures stack uses.</div>`;
  const sel = lqv$("lqMin"); if (sel) { sel.value = String(LQV.minUsd); sel.onchange = () => { LQV.minUsd = +sel.value; lqvRender(); }; }
}
setInterval(lqvRender, 1000);
