// Trader core (Trader step 5a): turns system definitions, the runner's state, RUNNER.evaluate, journal rows and a price history into what the Trader home draws:
// the seven cells of a system's row, the chart's marker list, the journal lines, plain-word descriptions of a definition, the status line. Pure: no DOM, timers, storage or clock
// (the caller passes the time). Display only: it reads, it decides nothing. The view file (trader-view.js) only puts this on the page.
// Spec: .scratch/trader/spec.md section 8 step 5, prompt prompts/05-trader-home.md.
const TRADER = (() => {
  "use strict";
  const MIN_TRADES = 20, MIN_TWINS = 15, DAY = 86400000;
  const num = x => typeof x === "number" && isFinite(x);
  const fx = (x, d) => !num(x) ? "–" : (x >= 0 ? "+" : "-") + Math.abs(x).toFixed(d);      // signed, so a result is never only a colour
  const fa = (x, d) => num(x) ? x.toFixed(d) : "–";
  const pxs = p => !num(p) ? "–" : p.toFixed(p >= 1000 ? 2 : p >= 1 ? 4 : 6);
  const dur = s => { s = Math.max(0, Math.round(s)); if (s < 60) return s + " s"; if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return m + " min" + (r ? " " + r + " s" : ""); } const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h + " h" + (m ? " " + m + " min" : ""); };
  const usd = x => { if (!num(x)) return "–"; const a = Math.abs(x), s = x < 0 ? "-" : ""; return s + "$" + (a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "k" : a.toFixed(0)); };
  const venueName = v => v === "bn" ? "Binance" : v === "hl" ? "Hyperliquid" : "either venue";
  const up = s => s > 0 ? "up" : "down";
  const EXIT_SHORT = { time: "time", stop: "stop", target: "target", trail: "trail", norm: "norm", flow: "flow", invalidate: "inv", gap: "gap", end: "end", interrupted: "int" };
  const SKIP_WORDS = { "context off": "the system's context was off", "risk cap": "taking it would put open risk above the cap", "in position": "the system already had a position", "no quote": "no fresh Binance quote to fill at",
    "not calibrated": "the Reader was still calibrating", "stale price": "the price was too old", "no region yet": "the range box was not ready", "no size": "the size came to zero", "no room": "no room left to the range level" };

  // ---------- plain words ----------
  function describe(def) {
    const c = def.context, r = def.region, t = def.trigger, th = def.thesis, x = def.exit, k = def.risk, inv = (th.invalidation || { type: "none" });
    const context = c.type === "always" ? "always on" : c.type === "sigmaBand" ? "sigma between " + c.min + " and " + c.max + " bps" : c.type === "hours" ? "UTC hours " + c.hours.join(", ") : "market state is " + c.states.join(" or ");
    const region = r.type === "rangeBox" ? "the high and low of the last " + dur(r.windowSec) : "none";
    let trigger;
    switch (t.type) {
      case "episode": trigger = "the Reader sees " + t.families.join(" or ") + " on " + venueName(def.venue === "bn" || def.venue === "hl" ? def.venue : "any"); break;
      case "priceMove": trigger = "price moves " + t.m + " sigma or more in " + dur(t.lookSec); break;
      case "premium": trigger = "Hyperliquid trades at least " + t.minBps + " bp above or below Binance, compared with its own last " + dur(t.baseSec); break;
      case "tradeFlow": trigger = "net taker flow over " + dur(t.lookSec) + " is at least " + Math.round(t.share * 100) + "% one way and " + t.m + " times its usual size"; break;
      case "bookDepth": trigger = "book depth within " + t.edge + " bps at least " + t.thr + " one way for " + t.sustainSec + " s"; break;
      case "rangeBreak": trigger = "price leaves the range by at least " + t.brkBps + " bp"; break;
      default: trigger = "price touches the range edge (within " + t.tolBps + " bp) and turns back " + t.rejBps + " bps within " + dur(t.lookSec); break;
    }
    const cool = num(t.coolSec) && t.coolSec > 0 ? "waits " + dur(t.coolSec) + " before the next one" : "";
    const dirWords = th.dir === "fade" ? "against it (fade)" : "with it (continuation)";
    const invalidation = inv.type === "none" ? "none besides the stop and the exit" : inv.type === "triggerReverses" ? "the trigger's reading reverses" : inv.type === "episodeAgainst" ? "a Reader episode appears or ends against the trade"
      : t.type === "rangeBreak" ? "price falls back inside the range" : "price breaks out of the range";
    const holdTxt = dur(x.holdSec);
    const exit = x.type === "timed" ? "closes after " + holdTxt : x.type === "flowEpisode" ? "closes on an opposing " + x.families.join(" or ") + " episode, at most " + holdTxt : x.type === "target" ? "target " + x.tpK + " sigma, at most " + holdTxt
      : x.type === "trailing" ? "trails " + x.trailK + " sigma from the best, at most " + holdTxt : x.type === "rangeLevel" ? "target at the " + (x.frac === 1 ? "far edge" : "middle") + " of the range, at most " + holdTxt : "closes when the reading normalises, at most " + holdTxt;
    const risk = "stop at " + k.stopK + " sigma over the hold; risks " + +(k.riskFrac * 100).toFixed(3) + "% of equity per trade";
    return { name: def.name, stage: def.stage, venue: venueName(def.venue), context, region, trigger, cool, direction: dirWords, thesis: th.text, invalidation, exit, risk,
      lines: [["Context", context], ["Region", region], ["Trigger", trigger + (cool ? "; " + cool : "")], ["Thesis", dirWords + ". " + th.text], ["Invalidation", invalidation], ["Exit", exit], ["Risk", risk]] };
  }

  // ---------- the seven cells ----------
  // in: {def, inst (SYSTEM instance state() or null when the runner is not running), led (RUNNER.state() entry or null), ev (RUNNER.evaluate result for this system or null), twins (the twins' mean R, only those with 20 trades), t (now, ms)}
  // out: seven {key, label, st: "on" | "wait" | "off", text, ...}. on = doing something now, wait = armed or building, off = blocked or not applicable. The words say it too, colour is never the only cue.
  const LABELS = [["context", "Context"], ["region", "Region"], ["trigger", "Trigger"], ["thesis", "Thesis"], ["exit", "Exit"], ["risk", "Risk"], ["evaluation", "Evaluation"]];
  function cells(i) {
    const def = i.def, d = describe(def), I = i.inst, L = i.led, P = I && I.position, O = L && L.open, t = i.t, out = {};
    const run = !!I;
    // context
    out.context = !run ? { st: "off", text: "not running · " + d.context } : I.context.on ? { st: "on", text: d.context } : { st: "off", text: "off: " + (I.context.why || "no reason given") };
    // region
    if (def.region.type === "none") out.region = { st: "off", text: "none" };
    else if (!run) out.region = { st: "off", text: "not running · " + d.region };
    else { const R = I.region; if (R.ready && num(R.hi) && num(R.lo)) out.region = { st: "on", text: "low " + pxs(R.lo) + " · high " + pxs(R.hi) + " · " + fa((R.hi / R.lo - 1) * 1e4, 1) + " bps wide", lo: R.lo, hi: R.hi };
      else { const left = Math.max(0, def.region.windowSec - ((L && L.secs) || 0)); out.region = { st: "wait", text: "building, about " + dur(left) + " left" }; } }
    // trigger
    out.trigger = !run ? { st: "off", text: "not running · " + d.trigger } : triggerCell(def, I, t);
    // thesis
    const invTxt = d.invalidation === "none besides the stop and the exit" ? "no invalidation" : "wrong if " + d.invalidation;
    out.thesis = P ? { st: "on", text: (P.dir > 0 ? "long" : "short") + ", " + (def.thesis.dir === "fade" ? "against" : "with") + " the move: " + def.thesis.text }
      : { st: run ? "wait" : "off", text: (def.thesis.dir === "fade" ? "fade" : "with it") + " · " + invTxt };
    // exit
    if (!P) out.exit = { st: "off", text: "flat · " + d.exit };
    else if (P.pending) out.exit = { st: "wait", text: "entering, waiting for the fill" };
    else if (O && O.exiting) out.exit = { st: "on", text: "closing: " + (EXIT_SHORT[O.exiting] || O.exiting) };
    else {
      const bits = [num(P.tEnd) ? dur((P.tEnd - t) / 1000) + " left" : "open"];
      if (num(P.targetPx)) bits.push("target " + pxs(P.targetPx));
      if (num(P.trailBps)) bits.push("trail " + fa(P.trailBps, 1) + " bps from the best (best " + fx(P.best, 1) + ")");
      if (def.exit.type === "flowEpisode") bits.push("or an opposing " + def.exit.families.join(" / ") + " episode");
      out.exit = { st: "on", text: bits.join(" · ") };
    }
    // risk
    const rf = def.risk.riskFrac, eq = L && num(L.equity) ? L.equity : null;
    if (P && !P.pending && O) { const risk = O.notional * P.stopBps / 1e4; out.risk = { st: "on", text: "stop " + fa(P.stopBps, 1) + " bps (" + pxs(P.stopPx) + ") · size " + usd(O.notional) + " · $" + fa(risk, 2) + " at risk" }; }
    else out.risk = { st: run ? "wait" : "off", text: "risks " + +(rf * 100).toFixed(3) + "% of equity" + (eq != null ? " ($" + fa(eq * rf, 2) + ")" : "") + " per trade · stop " + def.risk.stopK + " sigma over the hold" };
    // evaluation
    out.evaluation = evaluationCell(i);
    return LABELS.map(([key, label]) => Object.assign({ key, label }, out[key]));
  }
  function triggerCell(def, I, t) {
    const T = I.trigger, ty = def.trigger.type, rd = T.reading, thr = T.threshold, side = T.side, p = def.trigger;
    const last = Math.max(T.lastEnter ? T.lastEnter.t : -Infinity, T.lastSkip ? T.lastSkip.t : -Infinity);
    const since = isFinite(last) ? "last fired " + dur((t - last) / 1000) + " ago" : "none fired yet";
    if (ty === "episode" || ty === "levelRejection") return { st: "wait", text: since };
    const met = side !== 0, sd = met ? " · " + up(side) : "";
    let txt;
    if (ty === "priceMove") txt = !num(rd) ? "no reading yet" : "move " + fx(rd, 1) + " bps, needs " + fa(thr, 1) + " either way" + sd;
    else if (ty === "premium") txt = !num(rd) ? "no reading yet (needs " + dur(p.baseSec) + " of history)" : "premium " + fx(rd, 2) + " bps against its last " + dur(p.baseSec) + ", needs " + fa(p.minBps, 1) + sd;
    else if (ty === "tradeFlow") txt = !num(rd) ? "no reading yet" : thr == null ? "net flow " + usd(rd) + ", learning the usual size" : "net flow " + usd(rd) + ", needs " + usd(thr) + " and " + Math.round(p.share * 100) + "% one way" + sd;
    else if (ty === "bookDepth") txt = !num(rd) ? "no book reading" : "depth " + fx(rd, 2) + " within " + p.edge + " bps, needs " + fa(p.thr, 2) + sd;
    else txt = rd == null ? "waiting for the box" : met ? "outside the box by " + fa(Math.abs(rd), 1) + " bps, needs " + fa(p.brkBps, 1) + sd : "inside the box, or less than " + fa(p.brkBps, 1) + " bps out";
    return { st: met ? "on" : "wait", text: txt, met };
  }
  function evaluationCell(i) {
    const e = i.ev || { trades: 0, days: 0, meanNetBps: null, meanR: null, twinPercentile: null, twinsWithEnough: 0 }, tw = (i.twins || []).slice().sort((a, b) => a - b);
    if (e.trades < MIN_TRADES) return { st: "off", ready: false, trades: e.trades, text: "too few trades (" + e.trades + " of " + MIN_TRADES + ")" + (e.trades ? " · " + e.days + " day" + (e.days === 1 ? "" : "s") + " · mean " + fx(e.meanNetBps, 2) + " bps" : ""), twins: tw, system: null, pct: null };
    const place = e.twinPercentile != null ? "p" + Math.round(e.twinPercentile) + " among its twins" : "twins: " + tw.length + " of " + MIN_TWINS + " have " + MIN_TRADES + " trades";
    return { st: "on", ready: true, trades: e.trades, days: e.days, meanNetBps: e.meanNetBps, meanR: e.meanR, cls: e.meanNetBps > 0 ? "up" : e.meanNetBps < 0 ? "dn" : "", twins: tw, system: e.meanR, pct: e.twinPercentile, place,
      text: e.trades + " trades · " + e.days + " day" + (e.days === 1 ? "" : "s") + " · mean " + fx(e.meanNetBps, 2) + " bps · mean R " + fx(e.meanR, 3) + " · " + place };
  }

  // the twins' mean R per system, only twins with 20 trades (the ticks on the line)
  function twinMeans(rows) {
    const by = new Map();
    for (const r of rows) if (r.k === "twin") { let s = by.get(r.sys); if (!s) { s = new Map(); by.set(r.sys, s); } let a = s.get(r.n); if (!a) { a = []; s.set(r.n, a); } a.push(r.R); }
    const res = {};
    for (const [id, s] of by) { const m = []; for (const a of s.values()) if (a.length >= MIN_TRADES) m.push(a.reduce((x, y) => x + y, 0) / a.length); res[id] = m; }
    return res;
  }

  // ---------- chart: markers ----------
  // rows: the journal; id: a system id or null for all; [t0, t1]: the window; priceAt(t): optional price lookup for an invalidation whose trade has not closed.
  // items: {kind: "line", pid, sys, t0, px0, t1 (null = still open), px1, dir, netBps, R, open, interrupted, reason}, {kind: "entry", ...}, {kind: "exit", ...}, {kind: "invalidate", t, px, why, pid}, {kind: "skip", t, reason, sys} (only for one system)
  function markers(rows, id, t0, t1, priceAt) {
    const enters = new Map(), trades = new Map(), inv = [], skips = [];
    for (const r of rows) {
      if (id != null && r.sys !== id) continue;
      if (r.k === "enter") enters.set(r.pid, r);
      else if (r.k === "trade") trades.set(r.pid, r);
      else if (r.k === "invalidate") inv.push(r);
      else if (r.k === "skip" && id != null && r.t >= t0 && r.t <= t1) skips.push({ kind: "skip", t: r.t, reason: r.reason, sys: r.sys });
    }
    const items = [];
    for (const [pid, e] of enters) {
      const tr = trades.get(pid), tIn = e.t, tOut = tr && !tr.interrupted ? tr.tOut : null;
      if (tIn > t1 || (tOut != null && tOut < t0)) continue;
      const open = !tr || !!tr.interrupted, interrupted = !!(tr && tr.interrupted);
      items.push({ kind: "line", pid, sys: e.sys, t0: tIn, px0: e.px, t1: tOut, px1: tr && !interrupted ? tr.exitPx : null, dir: e.dir, netBps: tr && !interrupted ? tr.netBps : null, R: tr && !interrupted ? tr.R : null, open, interrupted, reason: tr ? tr.reason : null });
      items.push({ kind: "entry", pid, sys: e.sys, t: tIn, px: e.px, dir: e.dir, thesis: e.thesis, stopBps: e.stopBps });
      if (tr && !interrupted && tOut != null) items.push({ kind: "exit", pid, sys: e.sys, t: tOut, px: tr.exitPx, reason: tr.reason, label: EXIT_SHORT[tr.reason] || tr.reason, netBps: tr.netBps, R: tr.R, dir: e.dir });
    }
    for (const r of inv) {
      if (r.t < t0 || r.t > t1) continue;
      const tr = trades.get(r.pid), px = tr && num(tr.exitPx) ? tr.exitPx : priceAt ? priceAt(r.t) : null;
      items.push({ kind: "invalidate", pid: r.pid, sys: r.sys, t: r.t, px: px == null ? null : px, why: r.why || "" });
    }
    for (const s of skips) items.push(s);
    return items;
  }
  // the range box as it was at each price point: the high and low of the points in the windowSec before it (the point itself not yet in), like the system core. ph = [[t, px]] in time order.
  function boxSeries(ph, windowSec, t0, t1) {
    const W = windowSec * 1000, out = [], hiT = [], hiP = [], loT = [], loP = []; let hh = 0, lh = 0;
    for (const [t, p] of ph) {
      const cut = t - W; while (hh < hiT.length && hiT[hh] < cut) hh++; while (lh < loT.length && loT[lh] < cut) lh++;
      if (t >= t0 && t <= t1 && hh < hiT.length && lh < loT.length) out.push({ t, hi: hiP[hh], lo: loP[lh] });
      while (hiT.length > hh && hiP[hiP.length - 1] <= p) { hiT.pop(); hiP.pop(); } hiT.push(t); hiP.push(p);
      while (loT.length > lh && loP[loP.length - 1] >= p) { loT.pop(); loP.pop(); } loT.push(t); loP.push(p);
    }
    return out;
  }

  // ---------- detail and journal ----------
  function dayBars(rows, id, maxDays) {
    const by = new Map();
    for (const r of rows) if (r.k === "trade" && r.sys === id && !r.interrupted) { const d = Math.floor(r.tIn / DAY); let s = by.get(d); if (!s) { s = { day: new Date(d * DAY).toISOString().slice(0, 10), netBps: 0, trades: 0 }; by.set(d, s); } s.netBps += r.netBps; s.trades++; }
    const a = Array.from(by.entries()).sort((x, y) => x[0] - y[0]).map(e => e[1]); return a.slice(-(maxDays || 14));
  }
  function skipSummary(rows, id, max) {
    const by = new Map();
    for (const r of rows) if (r.k === "skip" && r.sys === id) { let s = by.get(r.reason); if (!s) { s = { reason: r.reason, n: 0, last: 0, words: SKIP_WORDS[r.reason] || "" }; by.set(r.reason, s); } s.n++; if (r.t > s.last) s.last = r.t; }
    return Array.from(by.values()).sort((a, b) => b.last - a.last).slice(0, max || 6);
  }
  // the latest lines, newest first: closed trades (an interrupted one has no figures), positions still open, and with skips: skipped triggers
  function journal(rows, o) {
    o = o || {}; const limit = o.limit || 200, names = o.names || {}, id = o.sys == null ? null : o.sys, closed = new Set(), lines = [];
    for (let k = rows.length - 1; k >= 0 && lines.length < limit; k--) {
      const r = rows[k]; if (id != null && r.sys !== id) continue;
      if (r.k === "trade") { closed.add(r.pid); lines.push(r.interrupted ? { t: r.t, sys: r.sys, name: names[r.sys] || r.sys, kind: "trade", dir: r.dir, entryPx: r.entryPx, exitPx: null, netBps: null, R: null, reason: "interrupted" }
        : { t: r.t, sys: r.sys, name: names[r.sys] || r.sys, kind: "trade", dir: r.dir, entryPx: r.entryPx, exitPx: r.exitPx, netBps: r.netBps, R: r.R, reason: r.reason }); }
      else if (r.k === "enter" && !closed.has(r.pid)) lines.push({ t: r.t, sys: r.sys, name: names[r.sys] || r.sys, kind: "open", dir: r.dir, entryPx: r.px, exitPx: null, netBps: null, R: null, reason: "open" });
      else if (r.k === "skip" && o.skips) lines.push({ t: r.t, sys: r.sys, name: names[r.sys] || r.sys, kind: "skip", dir: 0, entryPx: null, exitPx: null, netBps: null, R: null, reason: r.reason });
    }
    return lines.sort((a, b) => b.t - a.t);
  }
  // the status line. in: {loaded, on, connected, asset, running, ageSec, twins, feeBps, openRisk, riskCap, interrupted, err}
  function status(s) {
    let t;
    if (!s.loaded) t = "loading the journal"; else if (!s.on) t = "off: the run switch is off"; else if (!s.connected) t = "not running: not connected"; else if (s.asset !== "BTC") t = "off: the runner trades BTC only (the asset is " + s.asset + ")";
    else if (!s.running) t = "waiting for the first second of data";
    else t = "running · paper, " + s.feeBps + " bps a side · open risk " + fa(s.openRisk * 100, 2) + "% of a " + fa(s.riskCap * 100, 2) + "% cap · last snapshot " + dur(s.ageSec || 0) + " ago";
    if (s.interrupted) t += " · " + s.interrupted + " position" + (s.interrupted > 1 ? "s" : "") + " interrupted by a reload or a gap (left out of the figures)";
    if (s.err) t += " · " + s.err;
    return t;
  }

  // ---------- self-test: scenarios named trader:* ----------
  function selftest() {
    const res = [], ok = (name, c, detail) => res.push({ name: "trader:" + name, ok: !!c, detail: c ? "" : String(detail || "") });
    const D = typeof SYSTEMS_DEFAULT !== "undefined" ? SYSTEMS_DEFAULT : [], T = 1.7e12;
    const mk = (over, o2) => Object.assign({ name: "t", stage: "paper", venue: "bn", context: { type: "always" }, region: { type: "none" }, trigger: { type: "priceMove", lookSec: 10, m: 2 }, thesis: { dir: "continuation", text: "x", invalidation: { type: "none" } }, exit: { type: "timed", holdSec: 30 }, risk: { stopK: 2, riskFrac: 0.005 } }, over, o2);
    const inst = (o) => Object.assign({ id: "S1", context: { type: "always", on: true, why: "" }, region: { type: "none" }, trigger: { type: "priceMove", reading: null, threshold: null, side: 0, lastSkip: null, lastEnter: null }, position: null, counts: {} }, o);
    const led = (o) => Object.assign({ id: "S1", equity: 10000, triggers: 0, secs: 100, open: null }, o);
    const C = (def, I, L, ev, twins) => { const c = cells({ def, inst: I, led: L, ev, twins, t: T }); return Object.fromEntries(c.map(x => [x.key, x])); };
    // ----- plain words
    const words = D.map(describe), allText = words.map(w => w.lines.map(l => l.join(" ")).join(" ")).join(" ");
    ok("plain words: every default describes all seven parts, with no gaps", D.length === 7 && words.every(w => w.lines.length === 7 && w.lines.every(l => l[1] && l[1].length > 2)) && !/undefined|NaN|\[object/.test(allText), allText.slice(0, 300));
    ok("plain words: book depth in the owner's words", words[0].trigger === "book depth within 5 bps at least 0.6 one way for 3 s" && words[0].cool === "waits 30 s before the next one" && words[0].invalidation === "the trigger's reading reverses", JSON.stringify(words[0]));
    ok("plain words: premium, episode, range break, level rejection, priceMove each name their numbers", /1 bp.*5 min/.test(words[1].trigger) && /absorption or exhaustion/.test(words[2].trigger) && /1 bp/.test(words[3].trigger) && words[3].region === "the high and low of the last 15 min" && /1 bps within 30 s/.test(words[4].trigger) === false && /turns back 2 bps within 30 s/.test(words[4].trigger) && /2 sigma or more in 5 min/.test(words[5].trigger), JSON.stringify([words[1].trigger, words[3].trigger, words[4].trigger, words[5].trigger]));
    ok("plain words: the other triggers, exits, contexts and invalidations", [mk({ trigger: { type: "tradeFlow", lookSec: 20, share: 0.7, m: 3, coolSec: 0 } }), mk({ context: { type: "sigmaBand", min: 0.2, max: 1 } }), mk({ context: { type: "hours", hours: [1, 2] } }), mk({ context: { type: "marketState", states: ["calm"] } }),
      mk({ exit: { type: "target", holdSec: 60, tpK: 2 } }), mk({ exit: { type: "trailing", holdSec: 60, trailK: 1 } }), mk({ exit: { type: "flowEpisode", holdSec: 60, families: ["burst"] } }), mk({ exit: { type: "normalisation", holdSec: 90 } }), mk({ region: { type: "rangeBox", windowSec: 600 }, exit: { type: "rangeLevel", holdSec: 60, frac: 0.5 }, trigger: { type: "rangeBreak", brkBps: 1, coolSec: 5 }, thesis: { dir: "fade", text: "y", invalidation: { type: "region" } } })]
      .map(d => describe(d)).every(w => w.lines.every(l => l[1].length > 2) && !/undefined|NaN/.test(JSON.stringify(w))));
    // ----- cells: order, labels
    const base = C(mk(), inst(), led(), null, []);
    ok("cells: seven, in the fixed order with their labels", Object.keys(base).join() === "context,region,trigger,thesis,exit,risk,evaluation" && cells({ def: mk(), inst: inst(), led: led(), ev: null, twins: [], t: T }).map(x => x.label).join() === "Context,Region,Trigger,Thesis,Exit,Risk,Evaluation");
    // context
    ok("context cell: on, off with its reason, not running", base.context.st === "on" && C(mk(), inst({ context: { type: "marketState", on: false, why: "market state wild not allowed" } }), led(), null, []).context.text === "off: market state wild not allowed" && C(mk(), inst({ context: { type: "marketState", on: false, why: "market state wild not allowed" } }), led(), null, []).context.st === "off" && /^not running/.test(C(mk(), null, null, null, []).context.text) && C(mk(), null, null, null, []).context.st === "off");
    // region
    const rb = mk({ region: { type: "rangeBox", windowSec: 900 }, trigger: { type: "rangeBreak", brkBps: 1, coolSec: 60 } });
    ok("region cell: none; building with the seconds left; ready with the box's low and high", C(mk(), inst(), led(), null, []).region.text === "none" && C(rb, inst({ region: { type: "rangeBox", windowSec: 900, ready: false } }), led({ secs: 300 }), null, []).region.text === "building, about 10 min left" && C(rb, inst({ region: { type: "rangeBox", windowSec: 900, ready: false } }), led({ secs: 300 }), null, []).region.st === "wait"
      && (x => x.st === "on" && /low 99900\.00 · high 100100\.00 · 20\.0 bps wide/.test(x.text))(C(rb, inst({ region: { type: "rangeBox", windowSec: 900, hi: 100100, lo: 99900, ready: true } }), led(), null, []).region), JSON.stringify(C(rb, inst({ region: { type: "rangeBox", windowSec: 900, hi: 100100, lo: 99900, ready: true } }), led(), null, []).region));
    // trigger
    const trg = (def, o) => C(def, inst({ trigger: Object.assign({ type: def.trigger.type, reading: null, threshold: null, side: 0, lastSkip: null, lastEnter: null }, o) }), led(), null, []).trigger;
    ok("trigger cell, priceMove: no reading, below, across the threshold with its side", trg(mk(), {}).text === "no reading yet" && trg(mk(), { reading: 1.2, threshold: 3.4 }).st === "wait" && /move \+1\.2 bps, needs 3\.4 either way/.test(trg(mk(), { reading: 1.2, threshold: 3.4 }).text) && trg(mk(), { reading: -4, threshold: 3.4, side: -1 }).st === "on" && /· down$/.test(trg(mk(), { reading: -4, threshold: 3.4, side: -1 }).text));
    ok("trigger cell, bookDepth against its threshold, premium, tradeFlow", /depth \+0\.42 within 5 bps, needs 0\.60$/.test(trg(D[0], { reading: 0.42, threshold: 0.6 }).text) && /depth \+0\.70.*· up$/.test(trg(D[0], { reading: 0.7, threshold: 0.6, side: 1 }).text) && /premium \+0\.80 bps against its last 5 min, needs 1\.0/.test(trg(D[1], { reading: 0.8, threshold: 1 }).text)
      && /needs \$2\.0k and 70% one way/.test(trg(mk({ trigger: { type: "tradeFlow", lookSec: 20, share: 0.7, m: 3, coolSec: 0 } }), { reading: 1500, threshold: 2000 }).text) && /learning the usual size/.test(trg(mk({ trigger: { type: "tradeFlow", lookSec: 20, share: 0.7, m: 3, coolSec: 0 } }), { reading: 1500, threshold: null }).text));
    ok("trigger cell, rangeBreak: waiting for the box, inside, outside with its side", trg(rb, {}).text === "waiting for the box" && /inside the box/.test(trg(rb, { reading: 0, threshold: 1 }).text) && /outside the box by 1\.5 bps, needs 1\.0 · up/.test(trg(rb, { reading: 1.5, threshold: 1, side: 1 }).text) && trg(rb, { reading: 1.5, threshold: 1, side: 1 }).st === "on");
    ok("trigger cell, no continuous reading (episode, level rejection): time since the last one fired, or none yet", trg(D[2], {}).text === "none fired yet" && trg(D[2], { lastEnter: { t: T - 95000 } }).text === "last fired 1 min 35 s ago" && trg(D[4], { lastSkip: { t: T - 20000, reason: "x" }, lastEnter: { t: T - 400000 } }).text === "last fired 20 s ago" && trg(D[2], {}).st === "wait");
    // thesis
    ok("thesis cell: with it or fade and the invalidation rule; in a position the sentence of the thesis", C(D[0], inst(), led(), null, []).thesis.text === "with it · wrong if the trigger's reading reverses" && C(D[1], inst(), led(), null, []).thesis.text === "fade · no invalidation" && C(rb, inst(), led(), null, []).thesis.st === "wait"
      && (x => x.st === "on" && /^long, with the move: x$/.test(x.text))(C(mk(), inst({ position: { pending: false, dir: 1, tIn: T, tEnd: T + 30000, stopBps: 10, stopPx: 99.9, entryPx: 100 } }), led({ open: { dir: 1, px: 100, tIn: T, notional: 5000, exiting: null } }), null, []).thesis));
    // exit
    const pos = o => Object.assign({ pending: false, dir: 1, venue: "bn", entryPx: 100, tIn: T - 8000, tEnd: T + 22000, stopBps: 12.4, stopPx: 99.876, targetPx: null, trailBps: null, best: 0 }, o), lopen = o => led({ open: Object.assign({ dir: 1, px: 100, tIn: T - 8000, notional: 4032.26, exiting: null }, o) });
    ok("exit cell: flat, entering, time left with target / trail, closing", C(mk(), inst(), led(), null, []).exit.text === "flat · closes after 30 s" && C(mk(), inst({ position: pos({ pending: true }) }), led(), null, []).exit.text === "entering, waiting for the fill" && C(mk(), inst({ position: pos() }), lopen(), null, []).exit.text === "22 s left"
      && /22 s left · target 100\.50/.test(C(mk(), inst({ position: pos({ targetPx: 100.5 }) }), lopen(), null, []).exit.text) && /trail 8\.0 bps from the best \(best \+3\.5\)/.test(C(mk(), inst({ position: pos({ trailBps: 8, best: 3.5 }) }), lopen(), null, []).exit.text) && C(mk(), inst({ position: pos() }), lopen({ exiting: "stop" }), null, []).exit.text === "closing: stop" && C(mk(), inst({ position: pos() }), lopen(), null, []).exit.st === "on" && C(mk(), inst(), led(), null, []).exit.st === "off");
    // risk
    ok("risk cell: flat shows the rule and the dollars; in a position the stop in bps and price, the size and the dollars at risk", C(mk(), inst(), led(), null, []).risk.text === "risks 0.5% of equity ($50.00) per trade · stop 2 sigma over the hold" && C(mk(), inst({ position: pos() }), lopen(), null, []).risk.text === "stop 12.4 bps (99.8760) · size $4.0k · $5.00 at risk", C(mk(), inst({ position: pos() }), lopen(), null, []).risk.text);
    // evaluation
    const ev = (n, o) => Object.assign({ trades: n, days: 3, meanNetBps: -1.5, meanR: -0.1, twinPercentile: null, twinsWithEnough: 4 }, o);
    const e19 = C(mk(), inst(), led(), ev(19), [0.1, 0.2]).evaluation, e20 = C(mk(), inst(), led(), ev(20, { twinPercentile: 72.5 }), [0.1, 0.2, -0.3]).evaluation, e20b = C(mk(), inst(), led(), ev(20), Array.from({ length: 4 }, (_, k) => k / 10)).evaluation;
    ok("evaluation cell, under 20 trades: the words, no mean R, no percentile, no system marker, no colour", /^too few trades \(19 of 20\)/.test(e19.text) && !/mean R|p\d/.test(e19.text) && e19.ready === false && e19.twins.join() === "0.1,0.2" && e19.system === null && e19.pct === null && !e19.cls && C(mk(), inst(), led(), null, []).evaluation.text === "too few trades (0 of 20)", JSON.stringify(e19));
    ok("evaluation cell, 20 trades: mean R and place among twins; with fewer than 15 twins ready it says how many; the twins' ticks are handed over sorted", e20.ready && /20 trades · 3 days · mean -1\.50 bps · mean R -0\.100 · p73 among its twins/.test(e20.text) && e20.cls === "dn" && e20.twins.join() === "-0.3,0.1,0.2" && e20.system === -0.1 && /twins: 4 of 15 have 20 trades/.test(e20b.text) && e20b.pct === null, e20.text + " | " + e20b.text);
    // twin means
    { const rows = []; for (let n = 0; n < 3; n++) for (let k = 0; k < (n === 2 ? 19 : 20); k++) rows.push({ k: "twin", sys: "A", n, R: n }); const m = twinMeans(rows); ok("twin means: a mean R per twin with 20 trades, a twin with 19 is left out", m.A && m.A.join() === "0,1"); }
    // ----- the runner's journal drives the rest: a small synthetic one
    const A = "SA", B = "SB", rows = [
      { k: "enter", sys: A, t: T + 1000, pid: "p1", dir: 1, px: 100, stopBps: 10, thesis: "x" }, { k: "exit", sys: A, t: T + 31000, pid: "p1", reason: "time" },
      { k: "trade", sys: A, t: T + 31000, pid: "p1", tIn: T + 1000, tOut: T + 31000, dir: 1, entryPx: 100, exitPx: 100.1, netBps: 5, R: 0.5, reason: "time" },
      { k: "skip", sys: A, t: T + 40000, reason: "context off" }, { k: "skip", sys: A, t: T + 50000, reason: "in position" }, { k: "skip", sys: B, t: T + 51000, reason: "risk cap" },
      { k: "enter", sys: A, t: T + 60000, pid: "p2", dir: -1, px: 100.2, stopBps: 10, thesis: "x" }, { k: "invalidate", sys: A, t: T + 70000, pid: "p2", reason: "invalidate", why: "triggerReverses" },
      { k: "trade", sys: A, t: T + 70000, pid: "p2", tIn: T + 60000, tOut: T + 70000, dir: -1, entryPx: 100.2, exitPx: 100.3, netBps: -11, R: -1.1, reason: "invalidate" },
      { k: "enter", sys: B, t: T + 80000, pid: "p3", dir: 1, px: 100.3, stopBps: 10, thesis: "y" }, { k: "trade", sys: B, t: T + 80000, pid: "p3", tIn: T + 80000, tOut: null, dir: 1, entryPx: 100.3, reason: "interrupted", interrupted: true },
      { k: "enter", sys: A, t: T + 100000, pid: "p4", dir: 1, px: 100.4, stopBps: 10, thesis: "x" }, { k: "twin", sys: A, t: T + 100000, n: 0, tIn: T, netBps: 1, R: 0.1, usd: 1, reason: "time" }];
    const kinds = a => a.map(x => x.kind + (x.reason ? ":" + x.reason : "")).join();
    const mA = markers(rows, A, T, T + 200000, null), lines = mA.filter(x => x.kind === "line");
    ok("markers: entry, exit with its reason, a line joining them with the result, per trade", mA.filter(x => x.kind === "entry").length === 3 && mA.filter(x => x.kind === "exit").map(x => x.label).join() === "time,inv" && lines.length === 3 && lines[0].netBps === 5 && lines[0].t1 === T + 31000 && lines[0].open === false && lines[1].netBps === -11, kinds(mA));
    ok("markers: an invalidation is its own marker, apart from the exit, at the trade's exit price", mA.filter(x => x.kind === "invalidate").length === 1 && mA.find(x => x.kind === "invalidate").px === 100.3 && mA.find(x => x.kind === "invalidate").why === "triggerReverses" && mA.filter(x => x.kind === "exit" && x.reason === "invalidate").length === 1);
    ok("markers: skips as marks with their reasons for one system, and none for all systems", mA.filter(x => x.kind === "skip").map(x => x.reason).join() === "context off,in position" && markers(rows, null, T, T + 200000, null).every(x => x.kind !== "skip") && markers(rows, null, T, T + 200000, null).filter(x => x.kind === "entry").length === 4);
    ok("markers: a position still open is drawn open-ended", lines[2].open === true && lines[2].t1 === null && lines[2].px1 === null && lines[2].interrupted === false && mA.filter(x => x.kind === "exit").length === 2);
    { const mB = markers(rows, B, T, T + 200000, null), ln = mB.find(x => x.kind === "line"); ok("markers: an interrupted trade is drawn open-ended, with no exit and no result", ln.open && ln.interrupted && ln.t1 === null && ln.netBps === null && !mB.some(x => x.kind === "exit")); }
    ok("markers: only what is inside the window; an invalidation priced from the history when its trade has not closed", markers(rows, A, T + 35000, T + 65000, null).filter(x => x.kind === "entry").map(x => x.pid).join() === "p2" && (x => x.length === 1 && x[0].px === 7)(markers(rows.filter(r => r.k !== "trade"), A, T, T + 200000, () => 7).filter(x => x.kind === "invalidate")));
    // box series
    { const ph = []; for (let s = 0; s < 100; s++) ph.push([T + s * 1000, s < 50 ? 100 : 110]); const b = boxSeries(ph, 10, T + 40000, T + 99000), at = t => b.find(x => x.t === T + t * 1000);
      ok("box series: the high and low of the window before each point, the point itself not yet in", at(45).hi === 100 && at(45).lo === 100 && at(50).hi === 100 && at(51).hi === 110 && at(51).lo === 100 && at(61).lo === 110 && at(61).hi === 110 && b.length === 60, JSON.stringify([at(50), at(51), at(61)])); }
    // detail and journal
    { const bars = dayBars(rows, A), sk = skipSummary(rows, A);
      ok("day bars: net result per UTC day of the entry, interrupted ones left out", bars.length === 1 && bars[0].netBps === -6 && bars[0].trades === 2 && dayBars(rows, B).length === 0, JSON.stringify(bars));
      ok("skip summary: reasons with their counts, latest first", sk.map(x => x.reason + ":" + x.n).join() === "in position:1,context off:1" && skipSummary(rows, B)[0].reason === "risk cap" && skipSummary(rows, B)[0].words.length > 10); }
    { const j = journal(rows, { names: { SA: "Alpha", SB: "Beta" } }), js = journal(rows, { skips: true }), jb = journal(rows, { sys: B });
      ok("journal: newest first; closed trades, positions still open, an interrupted one without figures; skips only when asked", j.map(x => x.kind + ":" + x.reason).join() === "open:open,trade:interrupted,trade:invalidate,trade:time" && j[0].name === "Alpha" && j[1].netBps === null && j[1].exitPx === null && js.length === 7 && js.filter(x => x.kind === "skip").length === 3 && jb.length === 1 && jb.every(x => x.sys === B), j.map(x => x.kind + ":" + x.reason).join());
      const many = []; for (let k = 0; k < 500; k++) many.push({ k: "trade", sys: A, t: T + k, pid: "q" + k, tIn: T + k, tOut: T + k, dir: 1, entryPx: 1, exitPx: 1, netBps: 1, R: 1, reason: "time" });
      ok("journal: at most the latest 200 lines", journal(many).length === 200 && journal(many)[0].t === T + 499 && journal(many)[199].t === T + 300); }
    // status
    { const s = o => status(Object.assign({ loaded: true, on: true, connected: true, asset: "BTC", running: true, ageSec: 2, feeBps: 5, openRisk: 0.005, riskCap: 0.02, interrupted: 0, err: "" }, o));
      ok("status line: running with open risk against the cap; each reason it is not running; interrupted positions", s({}) === "running · paper, 5 bps a side · open risk 0.50% of a 2.00% cap · last snapshot 2 s ago" && /loading/.test(s({ loaded: false })) && /switch is off/.test(s({ on: false })) && /not connected/.test(s({ connected: false })) && /BTC only.*ETH/.test(s({ asset: "ETH" })) && /first second/.test(s({ running: false })) && /2 positions interrupted/.test(s({ interrupted: 2 })), s({})); }
    return res;
  }

  return { describe, cells, twinMeans, markers, boxSeries, dayBars, skipSummary, journal, status, selftest, LABELS, EXIT_SHORT, SKIP_WORDS, MIN_TRADES, MIN_TWINS, fx, fa, pxs, dur, usd };
})();
