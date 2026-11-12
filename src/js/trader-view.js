"use strict";
// Trader home (Trader step 5a, page side, thin): draws what trader-core.js (TRADER) works out, in the first view ("overview", shown as "Trader"): the status line, one card per system with its seven parts,
// the detail of the selected system, the price chart with the trades and skipped triggers, and the journal. Display only: it reads the runner (runner.js) and the engine's price history and changes nothing in them.
// Cheap: the view model is rebuilt at most twice a second and only while the view is open (VIEWS.tick calls renderTrader only then); the chart redraws only when its data changed.
const TV = {sel: store.get("trSel", null), win: +store.get("trWin", 30) || 30, at: 0, evLen: -1, evAt: 0, ev: {}, tw: {}, drawKey: "", hits: [], jSys: store.get("trJSys", ""), jHtml: "", rowsHtml: "", detHtml: "", tipDefault: "Hover or tap a mark for its reason. Triangles are entries (up long, down short), squares are exits with their reason, diamonds are invalidations, ticks along the bottom are skipped triggers."};
const TV_SYS = SYSTEMS_DEFAULT.map(d => ({d, id: SYSTEM.id(d)})), TV_NAMES = Object.fromEntries(TV_SYS.map(x => [x.id, x.d.name]));
const tv$ = id => document.getElementById(id);
const tvEsc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const TV_GLYPH = {on: "●", wait: "◐", off: "○"}, TV_WORD = {on: "on", wait: "waiting", off: "off"};
if (!TV_NAMES[TV.sel]) TV.sel = null;
if (TV.jSys && !TV_NAMES[TV.jSys]) TV.jSys = "";
if (![5, 30, 120].includes(TV.win)) TV.win = 30;
tv$("trWin").value = String(TV.win);

// ----- the view model (heavy parts cached: the figures over the whole journal change slowly)
function tvEval(rows){
  const now = performance.now();
  if (rows.length < TV.evLen || (rows.length !== TV.evLen && now - TV.evAt > 2000)){ TV.ev = RUNNER.evaluate(rows); TV.tw = TRADER.twinMeans(rows); TV.evLen = rows.length; TV.evAt = now; }
}
function tvTime(t, full){
  const d = new Date(t), p = n => String(n).padStart(2, "0"), hm = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  return full ? p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + hm : hm;
}

// ----- one system
function tvTwinSvg(c){
  const tw = c.twins; if (!tw.length) return "";
  const vals = tw.concat(c.system != null ? [c.system] : [], [0]); let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-9){ hi += .05; lo -= .05; }
  const pad = (hi - lo) * .06; lo -= pad; hi += pad; const X = v => (4 + (v - lo) / (hi - lo) * 192).toFixed(1);
  const ticks = tw.map(v => `<line class="twt" x1="${X(v)}" x2="${X(v)}" y1="8" y2="17"/>`).join(""), mk = c.system != null ? `<path class="twm" d="M${+X(c.system) - 5} 1L${+X(c.system) + 5} 1L${X(c.system)} 10Z"/>` : "";
  const label = `${tw.length} twin${tw.length === 1 ? "" : "s"} with ${TRADER.MIN_TRADES} trades: mean R from ${TRADER.fx(Math.min(...tw), 3)} to ${TRADER.fx(Math.max(...tw), 3)}` + (c.system != null ? `; the system ${TRADER.fx(c.system, 3)}` : "");
  return `<svg class="twsvg" viewBox="0 0 200 24" role="img" aria-label="${tvEsc(label)}"><title>${tvEsc(label)}</title><line class="twb" x1="2" x2="198" y1="12.5" y2="12.5"/><line class="tw0" x1="${X(0)}" x2="${X(0)}" y1="3" y2="22"/>${ticks}${mk}</svg><span class="twcap">ticks: its ${tw.length} twins' mean R${c.system != null ? " · ▼ the system" : ""} · dashed: zero</span>`;
}
function tvCellHtml(c){
  let body;
  if (c.key === "evaluation" && c.ready) body = `${c.trades} trades · ${c.days} day${c.days === 1 ? "" : "s"} · mean <span class="${c.cls}">${TRADER.fx(c.meanNetBps, 2)} bps</span> · mean R <span class="${c.cls}">${TRADER.fx(c.meanR, 3)}</span> · ${tvEsc(c.place)}`;
  else body = tvEsc(c.text);
  return `<div class="trcell st-${c.st}" data-k="${c.key}"><span class="trlab">${c.label}</span><span class="trbody"><b class="sg">${TV_GLYPH[c.st]} ${TV_WORD[c.st]}</b> ${body}${c.key === "evaluation" ? tvTwinSvg(c) : ""}</span></div>`;
}
function tvSystemHtml(x, st, cells){
  const sel = TV.sel === x.id, o = st && st.open, pos = o ? (o.exiting ? "closing" : (o.dir > 0 ? "long" : "short") + " @ " + TRADER.pxs(o.px)) : "flat";
  return `<article class="trsys${sel ? " sel" : ""}" data-sys="${x.id}"><div class="trhead"><button class="trname" data-sys="${x.id}" aria-pressed="${sel}" title="Show this system on the chart and its detail">${tvEsc(x.d.name)}</button><span class="trbadge" title="stage">${tvEsc(x.d.stage)}</span><span class="trpos">${pos}</span></div><div class="trcells">${cells.map(tvCellHtml).join("")}</div></article>`;
}

// ----- the detail of the selected system
function tvBars(bars, colour){
  if (!bars.length) return `<div class="note">No closed trades yet, so no days.</div>`;
  const w = Math.max(bars.length * 44, 120), mid = 46, mx = Math.max(1e-9, ...bars.map(b => Math.abs(b.netBps)));
  const g = bars.map((b, i) => { const x = i * 44 + 8, hgt = Math.abs(b.netBps) / mx * 34, y = b.netBps >= 0 ? mid - hgt : mid, cls = !colour ? "b0" : b.netBps > 0 ? "bp" : b.netBps < 0 ? "bn" : "b0", ty = b.netBps >= 0 ? y - 3 : y + hgt + 10;
    return `<rect class="${cls}" x="${x}" y="${y.toFixed(1)}" width="28" height="${Math.max(1, hgt).toFixed(1)}"/><text x="${x + 14}" y="${ty.toFixed(1)}" text-anchor="middle">${TRADER.fx(b.netBps, 1)}</text><text class="dimt" x="${x + 14}" y="104" text-anchor="middle">${b.day.slice(5)}</text><text class="dimt" x="${x + 14}" y="114" text-anchor="middle">${b.trades} tr</text>`; }).join("");
  return `<svg class="trbars" viewBox="0 0 ${w} 118" role="img" aria-label="Net result per UTC day in bps, summed over the day's trades"><line x1="0" x2="${w}" y1="${mid}" y2="${mid}"/>${g}</svg>`;
}
function tvDetailHtml(x, ev, rows){
  const d = TRADER.describe(x.d), e = ev[x.id], order = ["time", "stop", "invalidate", "target", "trail", "norm", "flow", "gap", "end"];
  const by = e ? e.byReason : {}, reasons = order.filter(k => by[k]).concat(Object.keys(by).filter(k => !order.includes(k)));
  const chips = reasons.map(k => `<span>${tvEsc(k)} ${by[k]}</span>`).join("") + (e && e.interrupted ? `<span>interrupted ${e.interrupted} (not counted)</span>` : "");
  const sk = TRADER.skipSummary(rows, x.id), now = nowEx();
  return `<h3><span>${tvEsc(x.d.name)}: detail</span><button data-close="1" aria-label="Close the detail">✕</button></h3>`
    + `<dl class="trdl">${d.lines.map(l => `<dt>${l[0]}</dt><dd>${tvEsc(l[1])}</dd>`).join("")}<dt>Venue</dt><dd>${tvEsc(d.venue)}, stage ${tvEsc(d.stage)}</dd></dl>`
    + `<div class="note" style="margin-top:0">Closed trades by how they ended (an invalidation is counted apart from a stop)</div><div class="trchips">${chips || "<span>no closed trades yet</span>"}</div>`
    + `<div class="note" style="margin-top:0">Net result per day (bps, UTC day of the entry)${e && e.trades < TRADER.MIN_TRADES ? ": no colour until 20 trades" : ""}</div>${tvBars(TRADER.dayBars(rows, x.id), !!(e && e.trades >= TRADER.MIN_TRADES))}`
    + `<div class="note" style="margin-top:0">Skipped triggers, latest first</div>` + (sk.length ? `<table class="tt"><tr><th>reason</th><th>count</th><th>last</th><th>what it means</th></tr>${sk.map(s => `<tr><td>${tvEsc(s.reason)}</td><td>${s.n}</td><td>${TRADER.dur((now - s.last) / 1000)} ago</td><td style="white-space:normal">${tvEsc(s.words)}</td></tr>`).join("")}</table>` : `<div class="note">No trigger has been skipped yet.</div>`);
}

// ----- the journal
function tvJournalHtml(rows){
  const lines = TRADER.journal(rows, {sys: TV.jSys || null, skips: tv$("trJSkips").checked, names: TV_NAMES, limit: 200}), day = Math.floor(nowEx() / 86400000);
  if (!lines.length) return `<div class="note" style="margin-top:0">No trades yet. A trade appears here when a system closes one; tick "skips" to see the triggers a system did not take.</div>`;
  const f = (x, d) => x == null ? "–" : TRADER.fx(x, d), cls = x => x == null || x === 0 ? "" : x > 0 ? "up" : "dn";
  return `<div style="overflow-x:auto"><table class="tt trj"><tr><th>time</th><th>system</th><th>side</th><th class="jx">entry</th><th class="jx">exit</th><th>net bps</th><th>R</th><th>reason</th></tr>` + lines.map(l =>
    `<tr><td>${tvTime(l.t, Math.floor(l.t / 86400000) !== day)}</td><td>${tvEsc(l.name)}</td><td>${l.dir > 0 ? "long" : l.dir < 0 ? "short" : "–"}</td><td class="jx">${l.entryPx == null ? "–" : TRADER.pxs(l.entryPx)}</td><td class="jx">${l.exitPx == null ? "–" : TRADER.pxs(l.exitPx)}</td><td class="${cls(l.netBps)}">${f(l.netBps, 2)}</td><td class="${cls(l.R)}">${f(l.R, 2)}</td><td class="rs">${l.kind === "skip" ? "skipped: " : ""}${tvEsc(l.reason)}</td></tr>`).join("") + `</table></div>`;
}

// ----- the chart
function tvPrices(){ try{ return READER.priceHistory("bn") || []; }catch{ return []; } }
function tvIdxAt(ph, t){ let lo = 0, hi = ph.length; while (lo < hi){ const m = (lo + hi) >> 1; if (ph[m][0] < t) lo = m + 1; else hi = m; } return lo; }
function tvChartData(rows, st){
  const ph = tvPrices(), win = TV.win * 60000, last = ph.length ? ph[ph.length - 1][0] : nowEx(), t1 = last, t0 = t1 - win, i0 = tvIdxAt(ph, t0), pts = ph.slice(i0);
  const x = TV.sel ? TV_SYS.find(s => s.id === TV.sel) : null, priceAt = t => { const i = tvIdxAt(ph, t); return i < ph.length ? ph[i][1] : null; };
  const items = TRADER.markers(rows, x ? x.id : null, t0, t1, priceAt);
  let box = [], pos = null;
  if (x && x.d.region.type === "rangeBox"){ const W = x.d.region.windowSec * 1000; box = TRADER.boxSeries(ph.slice(tvIdxAt(ph, t0 - W)), x.d.region.windowSec, t0, t1); }
  const s = x && st ? st.find(q => q.id === x.id) : null; if (s && s.inst && s.inst.position && !s.inst.position.pending) pos = s.inst.position;
  return {x, t0, t1, pts, items, box, pos, lastPx: pts.length ? pts[pts.length - 1][1] : null};
}
function tvDrawChart(m){
  const cv = tv$("trChart"), {ctx, w, h} = prep(cv); TV.hits = [];
  if (w < 30 || h < 30) return;
  const L = 6, R = 64, T = 8, B = 34, pw = w - L - R, ph = h - T - B, span = m.t1 - m.t0;
  if (!m.pts.length && !m.items.some(i => i.px != null || i.px0 != null)){ emptyMsg(ctx, w, h, "no price yet: press Connect"); return; }
  let lo = Infinity, hi = -Infinity; const see = p => { if (typeof p === "number" && isFinite(p)){ if (p < lo) lo = p; if (p > hi) hi = p; } };
  for (const p of m.pts) see(p[1]);
  for (const i of m.items){ see(i.px); see(i.px0); see(i.px1); } for (const b of m.box){ see(b.hi); see(b.lo); } if (m.pos){ see(m.pos.stopPx); see(m.pos.targetPx); }
  if (!(hi > lo)){ hi += 1; lo -= 1; } const pad = (hi - lo) * .06; lo -= pad; hi += pad;
  const X = t => L + (t - m.t0) / span * pw, Y = p => T + (1 - (p - lo) / (hi - lo)) * ph, dec = hi - lo > 50 ? 1 : hi - lo > 5 ? 2 : 3;
  // grid and axes
  ctx.lineWidth = 1; ctx.textAlign = "left"; ctx.fillStyle = TH.dim; ctx.strokeStyle = TH.line;
  const step = niceStep((hi - lo) / 4);
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step){ const y = Math.round(Y(p)) + .5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(p.toFixed(dec), L + pw + 4, y + 3.5); }
  const tick = TV.win <= 5 ? 60000 : TV.win <= 30 ? 300000 : 1200000; ctx.textAlign = "center";
  for (let t = Math.ceil(m.t0 / tick) * tick; t <= m.t1; t += tick){ const x = Math.round(X(t)) + .5; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.fillText(tvTime(t).slice(0, 5), x, h - 5); }
  // the range box
  if (m.box.length > 1){
    ctx.beginPath(); m.box.forEach((b, i) => i ? ctx.lineTo(X(b.t), Y(b.hi)) : ctx.moveTo(X(b.t), Y(b.hi))); for (let i = m.box.length - 1; i >= 0; i--) ctx.lineTo(X(m.box[i].t), Y(m.box[i].lo)); ctx.closePath();
    ctx.fillStyle = TH.a("accent", .10); ctx.fill(); ctx.strokeStyle = TH.accent; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    for (const k of ["hi", "lo"]){ ctx.beginPath(); m.box.forEach((b, i) => i ? ctx.lineTo(X(b.t), Y(b[k])) : ctx.moveTo(X(b.t), Y(b[k]))); ctx.stroke(); } ctx.setLineDash([]);
    ctx.fillStyle = TH.accent; ctx.textAlign = "left"; ctx.fillText("range box", L + 4, Y(m.box[0].hi) - 4 < T + 8 ? T + 10 : Y(m.box[0].hi) - 4);
  }
  // the price
  if (m.pts.length > 1){ ctx.beginPath(); m.pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))); ctx.strokeStyle = TH.text; ctx.lineWidth = 1.2; ctx.stroke(); }
  // the stop and target of the open position
  if (m.pos){
    ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.textAlign = "left";
    if (typeof m.pos.stopPx === "number"){ ctx.strokeStyle = TH.sell; ctx.fillStyle = TH.sell; ctx.beginPath(); ctx.moveTo(L, Y(m.pos.stopPx)); ctx.lineTo(L + pw, Y(m.pos.stopPx)); ctx.stroke(); ctx.fillText("stop " + m.pos.stopPx.toFixed(dec), L + 4, Y(m.pos.stopPx) - 3); }
    if (typeof m.pos.targetPx === "number"){ ctx.strokeStyle = TH.buy; ctx.fillStyle = TH.buy; ctx.beginPath(); ctx.moveTo(L, Y(m.pos.targetPx)); ctx.lineTo(L + pw, Y(m.pos.targetPx)); ctx.stroke(); ctx.fillText("target " + m.pos.targetPx.toFixed(dec), L + 4, Y(m.pos.targetPx) - 3); }
    ctx.setLineDash([]);
  }
  // trades: a line from entry to exit coloured by the result (dashed while open: warn if interrupted), entries as triangles, exits as squares with their reason
  const res = n => n == null ? TH.hi : n > 0 ? TH.buy : n < 0 ? TH.sell : TH.hi, hit = (x, y, text) => TV.hits.push({x, y, text});
  for (const i of m.items) if (i.kind === "line"){
    const x0 = X(i.t0), y0 = Y(i.px0), end = i.t1 == null, x1 = end ? L + pw : X(i.t1), y1 = end ? (m.lastPx != null ? Y(m.lastPx) : y0) : Y(i.px1);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = i.interrupted ? TH.warn : res(i.netBps); ctx.lineWidth = 2; ctx.setLineDash(end ? [5, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    if (end){ ctx.fillStyle = i.interrupted ? TH.warn : TH.hi; ctx.textAlign = "right"; ctx.fillText(i.interrupted ? "interrupted" : "open", L + pw - 3, y1 - 5); }
  }
  ctx.textAlign = "left";
  for (const i of m.items){
    if (i.kind === "entry"){
      const ln = m.items.find(q => q.kind === "line" && q.pid === i.pid), col = ln && ln.interrupted ? TH.warn : res(ln ? ln.netBps : null), x = X(i.t), y = Y(i.px), up = i.dir > 0;
      ctx.beginPath(); ctx.moveTo(x, y + (up ? -7 : 7)); ctx.lineTo(x - 5, y + (up ? 3 : -3)); ctx.lineTo(x + 5, y + (up ? 3 : -3)); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = TH.canvas; ctx.lineWidth = 1; ctx.stroke();
      hit(x, y, `Entry ${up ? "long" : "short"}${m.x ? "" : " (" + (TV_NAMES[i.sys] || "") + ")"} ${tvTime(i.t)} at ${TRADER.pxs(i.px)}, stop ${TRADER.fa(i.stopBps, 1)} bps. ${i.thesis || ""}`);
    } else if (i.kind === "exit"){
      const x = X(i.t), y = Y(i.px), col = res(i.netBps);
      ctx.fillStyle = col; ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeStyle = TH.canvas; ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      ctx.fillStyle = TH.text; ctx.textAlign = x > L + pw - 40 ? "right" : "left"; ctx.fillText(i.label, x + (x > L + pw - 40 ? -6 : 6), y - 6);
      hit(x, y, `Exit by ${i.reason}${m.x ? "" : " (" + (TV_NAMES[i.sys] || "") + ")"} ${tvTime(i.t)} at ${TRADER.pxs(i.px)}: net ${TRADER.fx(i.netBps, 2)} bps, R ${TRADER.fx(i.R, 2)}.`);
    } else if (i.kind === "invalidate" && i.px != null){
      const x = X(i.t), y = Y(i.px);
      ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.strokeStyle = TH.warn; ctx.lineWidth = 2; ctx.stroke();
      hit(x, y, `Invalidated ${tvTime(i.t)}: ${i.why || "the thesis no longer held"}. The trade was closed at market (counted apart from a stop).`);
    }
  }
  ctx.textAlign = "left";
  // skipped triggers along the time axis
  const sy = h - B + 4; ctx.strokeStyle = TH.accent; ctx.lineWidth = 2; ctx.fillStyle = TH.dim;
  const sk = m.items.filter(i => i.kind === "skip");
  for (const i of sk){ const x = Math.round(X(i.t)) + .5; ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x, sy + 9); ctx.stroke(); TV.hits.push({x, y: sy + 4, skip: true, t: i.t, reason: i.reason}); }
  ctx.lineWidth = 1;
}
function tvTip(ev){
  const cv = tv$("trChart"), r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top; let best = null, bd = 1e9, near = [];
  for (const q of TV.hits){
    if (q.skip){ if (Math.abs(q.x - x) <= 6 && Math.abs(q.y - y) <= 14){ near.push(q); } continue; }
    const d = Math.hypot(q.x - x, q.y - y); if (d < 11 && d < bd){ bd = d; best = q; }
  }
  const tip = tv$("trTip");
  if (best) tip.textContent = best.text;
  else if (near.length){ const c = {}; for (const q of near) c[q.reason] = (c[q.reason] || 0) + 1; tip.textContent = "Skipped trigger" + (near.length > 1 ? "s" : "") + " around " + tvTime(near[0].t) + ": " + Object.entries(c).map(([k, n]) => k + (n > 1 ? " ×" + n : "") + (TRADER.SKIP_WORDS[k] ? " (" + TRADER.SKIP_WORDS[k] + ")" : "")).join("; ") + "."; }
  else if (ev.type !== "click" && ev.pointerType === "mouse") tip.textContent = TV.tipDefault;
}
tv$("trChart").addEventListener("pointermove", e => { if (e.pointerType === "mouse") tvTip(e); });
tv$("trChart").addEventListener("click", tvTip);

// ----- render (the view's slot render calls this; it throttles itself)
function renderTrader(force){
  const now = performance.now(); if (!force && now - TV.at < 450) return; TV.at = now;
  try{
    const rows = trRows(), run = TRN.runner, st = run ? run.state() : [], byId = Object.fromEntries(st.map(s => [s.id, s])), rk = run ? run.risk() : null;
    tvEval(rows);
    let interrupted = 0; for (const k in TV.ev) interrupted += TV.ev[k].interrupted;
    tv$("trOn").checked = TRN.on;
    tv$("trStat").textContent = TRADER.status({loaded: TRN.loaded, on: TRN.on, connected, asset: trAsset(), running: !!run, ageSec: Math.max(0, Math.round((nowEx() - TRN.lastT) / 1000)), feeBps: TR_CFG.feeBps, openRisk: rk ? rk.open : 0, riskCap: TR_CFG.riskCap, interrupted, err: TRN.err});
    // one card per system
    const t = nowEx(), html = TV_SYS.map(x => { const s = byId[x.id]; return tvSystemHtml(x, s, TRADER.cells({def: x.d, inst: s ? s.inst : null, led: s || null, ev: TV.ev[x.id] || null, twins: TV.tw[x.id] || [], t})); }).join("");
    if (html !== TV.rowsHtml){
      const keep = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("trname") ? document.activeElement.dataset.sys : null;
      TV.rowsHtml = html; tv$("trRows").innerHTML = html; if (keep){ const b = tv$("trRows").querySelector(`.trname[data-sys="${keep}"]`); if (b) b.focus(); }
    }
    // the detail of the selected system
    const det = tv$("trDetail"), x = TV.sel ? TV_SYS.find(q => q.id === TV.sel) : null;
    if (!x){ det.hidden = true; TV.detHtml = ""; }
    else { const dh = tvDetailHtml(x, TV.ev, rows); if (dh !== TV.detHtml){ TV.detHtml = dh; det.innerHTML = dh; } det.hidden = false; }
    // the chart: redraws only when its data changed
    tv$("trChartFor").textContent = x ? x.d.name : "all seven systems";
    const m = tvChartData(rows, st), cv = tv$("trChart"), p = m.pos, key = [TV.sel, TV.win, m.t1, rows.length, cv.clientWidth, cv.clientHeight, p ? p.entryPx + ":" + p.stopPx + ":" + p.targetPx : "", TH.canvas].join("|");
    if (key !== TV.drawKey){ TV.drawKey = key; tvDrawChart(m); }
    if (!tv$("trTip").textContent) tv$("trTip").textContent = TV.tipDefault;
    // the journal
    const sel = tv$("trJSys"); if (!sel.options.length){ sel.innerHTML = `<option value="">all systems</option>` + TV_SYS.map(q => `<option value="${q.id}">${tvEsc(q.d.name)}</option>`).join(""); }
    sel.value = TV.jSys;
    const jh = tvJournalHtml(rows); if (jh !== TV.jHtml){ TV.jHtml = jh; tv$("trJournal").innerHTML = jh; }
  }catch(e){ console.error("trader view", e); }
}

// ----- controls
function tvSelect(id){ TV.sel = id; store.set("trSel", id); TV.drawKey = ""; renderTrader(true); }
tv$("trRows").addEventListener("click", e => { const a = e.target.closest(".trsys"); if (!a) return; tvSelect(a.dataset.sys === TV.sel ? null : a.dataset.sys); });
tv$("trDetail").addEventListener("click", e => { if (e.target.closest("[data-close]")) tvSelect(null); });
tv$("trWin").onchange = () => { TV.win = +tv$("trWin").value; store.set("trWin", TV.win); TV.drawKey = ""; renderTrader(true); };
tv$("trJSys").onchange = () => { TV.jSys = tv$("trJSys").value; store.set("trJSys", TV.jSys); renderTrader(true); };
tv$("trJSkips").onchange = () => renderTrader(true);
tv$("trOn").onchange = () => { trSetOn(tv$("trOn").checked); renderTrader(true); };
tv$("trExport").onclick = trExportJournal;
tv$("trReset").onclick = async () => { if (await trResetJournal()){ TV.evLen = -1; renderTrader(true); } };
VIEWS.onOpen("overview", () => { TV.drawKey = ""; renderTrader(true); });
