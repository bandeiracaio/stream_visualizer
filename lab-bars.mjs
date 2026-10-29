// Analysis lab, step 2: event-time (dollar) bars from saved sessions. Offline, not part of the app.
// A bar closes when the Binance trades in it add up to `barUsd` of notional (so a busy minute has many bars and a quiet one few). Each bar carries a feature vector:
// taker flow (aggressor buy / sell, imbalance), price (open / high / low / close, return in bps and in sigmas), near-touch book depth and its imbalance, spread,
// Hyperliquid flow in the same window, Binance sweeps, how concentrated the bar is in one trade, time of day. Language: aggressor / passive side, no bull / bear.
//   - bars never span two sessions, and never span a silence (a gap of `gapSec` without a Binance trade drops the partial bar and starts over; the next bar says `gapBefore`);
//   - sigma is the ADR 0004 scale (q75 of the absolute deviation of overlapping 15 s returns / 1.1503 / sqrt(15), floored at 0.05 bps/sqrt(s)), taken CAUSALLY: from the 30 minutes
//     before the bar opens, never from data after it (the engine's extra blend with a fast estimate is not applied here);
//   - a bar's return runs from the previous bar's close (or its own open for the first bar after a start / gap), measured in sigmas of the elapsed time since then.
// Usage:  node lab-bars.mjs SESSION... [--bar-usd N] [--target-sec 10] [--out lab-data/bars.json] [--entry docs/lab/lab_DATE_bars.json] [--date YYYY-MM-DD]      |      --selftest
//   --bar-usd fixes the bar size; otherwise it is chosen from the data so a typical bar lasts about --target-sec seconds (rounded to 2 significant digits and printed).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quantile, median, mean, spearman, finite } from "./lab-stats.mjs";

export const PARAMS = { venue: "bn", targetSec: 10, gapSec: 60, depthLevels: 10, sigmaLagSec: 15, sigmaWinSec: 1800, sigmaMinN: 60, sigmaFloor: 0.05, q75k: 1.1503 };

// robust sigma (bps per root second) at grid second `idx`, from the overlapping `lag`-second returns that ended in the `win` seconds up to idx
function sigmaAt(grid, idx, P) {
  const lag = P.sigmaLagSec, r = [];
  for (let k = Math.max(lag, idx - P.sigmaWinSec + 1); k <= idx && k < grid.length; k++) { const a = grid[k - lag], b = grid[k]; if (a > 0 && b > 0) r.push(1e4 * Math.log(b / a)); }
  if (r.length < P.sigmaMinN) return P.sigmaFloor;
  const m = median(r), dev = r.map(x => Math.abs(x - m)), q = quantile(dev, 0.75);
  return Math.max(q / P.q75k / Math.sqrt(lag), P.sigmaFloor);
}
const notionalTop = (levels, n) => { let s = 0; for (let i = 0; i < levels.length && i < n; i++) s += levels[i][0] * levels[i][1]; return s; };

// Build the bars of one session from its `inputs`. `barUsd` is the bar size. Returns {bars, dropped:{gap, tail}, trades}.
export function makeBars(inputs, barUsd, userP = {}, sessionIndex = 0) {
  const P = Object.assign({}, PARAMS, userP), V = P.venue, bars = [], dropped = { gap: 0, tail: 0 };
  let q = null, depth = null, hl = { buy: 0, sell: 0, n: 0 }, sw = { n: 0, usd: 0 }, cur = null, lastT = null, prev = null, gapNext = false, trades = 0;
  let s0 = null, grid = [], lastPx = null, lastIdx = -1;
  const resetWin = () => { hl = { buy: 0, sell: 0, n: 0 }; sw = { n: 0, usd: 0 }; };
  const stamp = (t, px) => {                                           // one price per second, carried forward over quiet seconds
    if (s0 === null) s0 = Math.floor(t / 1000) * 1000;
    const idx = Math.max(0, Math.floor((t - s0) / 1000));
    if (idx > lastIdx) { for (let k = lastIdx + 1; k < idx; k++) grid[k] = lastPx; lastIdx = idx; }
    grid[idx] = px; lastPx = px; return idx;
  };
  for (const r of inputs) {
    const k = r[0];
    if (k === "q" && r[1] === V) q = { bid: r[3], ask: r[4] };
    else if (k === "b" && r[1] === V && r[3] && r[3].length && r[4] && r[4].length) {
      const bid = notionalTop(r[3], P.depthLevels), ask = notionalTop(r[4], P.depthLevels); depth = { bid, ask, bestBid: r[3][0][0], bestAsk: r[4][0][0] };
    }
    else if (k === "s" && r[1] === V) { sw.n++; sw.usd += r[4] || 0; }
    else if (k === "t") {
      const x = r[1]; if (!x || !(x.px > 0) || !(x.ntl > 0) || !Number.isFinite(x.t)) continue;
      if (x.v === "hl") { if (x.side === "buy") hl.buy += x.ntl; else hl.sell += x.ntl; hl.n++; continue; }
      if (x.v !== V) continue;
      trades++;
      const idx = stamp(x.t, x.px);
      if (cur && lastT !== null && x.t - lastT > P.gapSec * 1000) { dropped.gap++; cur = null; prev = null; gapNext = true; resetWin(); }
      lastT = x.t;
      if (!cur) cur = { t0: x.t, o: x.px, h: x.px, l: x.px, c: x.px, n: 0, usd: 0, buy: 0, sell: 0, liq: 0, big: 0, sigma: sigmaAt(grid, idx, P), hour: ((x.t / 3600000) % 24) };
      cur.n++; cur.usd += x.ntl; if (x.side === "buy") cur.buy += x.ntl; else cur.sell += x.ntl; if (x.liq) cur.liq += x.ntl;
      if (x.ntl > cur.big) cur.big = x.ntl; if (x.px > cur.h) cur.h = x.px; if (x.px < cur.l) cur.l = x.px; cur.c = x.px; cur.t1 = x.t;
      if (cur.usd >= barUsd) {
        const from = prev ? prev.px : cur.o, fromT = prev ? prev.t1 : cur.t0, span = Math.max((cur.t1 - fromT) / 1000, 1);
        const mid = q && q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null, dTot = depth ? depth.bid + depth.ask : null;
        const retBps = 1e4 * Math.log(cur.c / from), flow = cur.buy + cur.sell, hlTot = hl.buy + hl.sell;
        const b = {
          s: sessionIndex, i: bars.length, t0: cur.t0, t1: cur.t1, dur: (cur.t1 - cur.t0) / 1000, gapBefore: gapNext,
          px: cur.c, o: cur.o, h: cur.h, l: cur.l, n: cur.n, usd: cur.usd, buy: cur.buy, sell: cur.sell, imb: flow > 0 ? (cur.buy - cur.sell) / flow : null, liq: cur.liq, big: cur.big / cur.usd,
          retBps, span, sigma: cur.sigma, retSig: retBps / (cur.sigma * Math.sqrt(span)), rangeBps: 1e4 * Math.log(cur.h / cur.l),
          spreadBps: mid ? 1e4 * (q.ask - q.bid) / mid : null,
          depth: dTot, depthImb: dTot > 0 ? (depth.bid - depth.ask) / dTot : null, depthChg: dTot > 0 && prev && prev.depth > 0 ? Math.log(dTot / prev.depth) : null,
          hlBuy: hl.buy, hlSell: hl.sell, hlImb: hlTot > 0 ? (hl.buy - hl.sell) / hlTot : null, hlN: hl.n, swN: sw.n, swUsd: sw.usd, hour: cur.hour
        };
        bars.push(b); prev = b; cur = null; gapNext = false; resetWin();
      }
    }
  }
  if (cur) dropped.tail++;
  return { bars, dropped, trades };
}

// the bar size that gives about targetSec seconds per bar: Binance notional per second of data across all sessions, times targetSec, rounded to 2 significant digits
export function chooseBarUsd(sessions, targetSec, venue = PARAMS.venue) {
  let usd = 0, sec = 0;
  for (const s of sessions) {
    let t0 = Infinity, t1 = -Infinity, u = 0;
    for (const r of s.inputs) if (r[0] === "t" && r[1] && r[1].v === venue && r[1].ntl > 0) { u += r[1].ntl; if (r[1].t < t0) t0 = r[1].t; if (r[1].t > t1) t1 = r[1].t; }
    if (t1 > t0) { usd += u; sec += (t1 - t0) / 1000; }
  }
  if (!(sec > 0)) return null;
  const raw = usd / sec * targetSec, mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

// ---------- the feature list (used for the entry's distribution table; the same names are the keys of a bar)
export const FEATURES = [
  ["dur", "duration (s)"], ["n", "trades"], ["imb", "taker-flow imbalance"], ["retBps", "return (bps)"], ["retSig", "return (sigmas)"], ["rangeBps", "range (bps)"],
  ["big", "largest trade share"], ["spreadBps", "spread (bps)"], ["depth", "top-10 depth (USD)"], ["depthImb", "depth imbalance"], ["depthChg", "depth change (log)"],
  ["hlImb", "Hyperliquid flow imbalance"], ["swN", "Binance sweeps"], ["sigma", "sigma (bps/√s)"]
];

function summarise(allBars, sessions, barUsd, dropped, P) {
  const col = f => allBars.map(b => b[f]);
  const q5 = a => [quantile(a, 0.05), quantile(a, 0.25), quantile(a, 0.5), quantile(a, 0.75), quantile(a, 0.95)];
  const missing = f => 1 - finite(col(f)).length / Math.max(1, allBars.length);
  const hours = new Array(24).fill(0); for (const b of allBars) hours[Math.floor(b.hour) % 24]++;
  const nextRet = [], nowImb = [], prevSig = [], sameSession = (a, b) => b && a.s === b.s && !b.gapBefore;
  for (let i = 0; i + 1 < allBars.length; i++) if (sameSession(allBars[i], allBars[i + 1])) { nowImb.push(allBars[i].imb); nextRet.push(allBars[i + 1].retSig); prevSig.push(allBars[i].retSig); }
  const cImbRet = spearman(allBars.map(b => b.imb), allBars.map(b => b.retSig)), cImbNext = spearman(nowImb, nextRet), cRetNext = spearman(prevSig, nextRet);
  const lags = [1, 2, 3, 5, 10, 20].map(L => {                         // dependence between a bar and the one L bars later, within one session and without a gap in between
    const a = [], b = [], c = [];
    for (let i = 0; i + L < allBars.length; i++) { let fine = true; for (let k = 1; k <= L; k++) if (allBars[i + k].s !== allBars[i].s || allBars[i + k].gapBefore) { fine = false; break; } if (fine) { a.push(allBars[i].imb); b.push(allBars[i + L].retSig); c.push(allBars[i].retSig); } }
    return [L, a.length, spearman(a, b), spearman(c, b)];
  });
  const floorShare = allBars.filter(b => b.sigma <= PARAMS.sigmaFloor).length / Math.max(1, allBars.length), zeroDur = allBars.filter(b => b.dur === 0).length / Math.max(1, allBars.length);
  const dur = col("dur"), perSession = sessions.map((s, i) => allBars.filter(b => b.s === i).length);
  return { q5, missing, hours, cImbRet, cImbNext, cRetNext, dur, perSession, lags, floorShare, zeroDur };
}

function buildEntry(sessions, allBars, barUsd, dropped, date, files) {
  const S = summarise(allBars, sessions, barUsd, dropped, PARAMS), r2 = x => x == null ? null : Math.round(x * 1000) / 1000;
  const minutes = sessions.reduce((s, x) => s + ((x.quality && x.quality.dataMinutes) || 0), 0);
  return {
    kind: "sv-lab-entry", version: 1, id: "bars-coverage-" + date, title: "Event-time bars from saved sessions: coverage and feature distributions", date, verdict: "inconclusive", tags: ["bars", "data", "flow"],
    verdictNote: "The bars are built correctly as far as we can check: flow imbalance moves with the same bar's return (rho " + r2(S.cImbRet) + "), no bar spans a session or a long silence, and the spread, trade counts and sizes match what the market looks like. But the second check fixed in advance FAILED: we expected the next bar's return to be nearly unrelated to this bar's flow and return, and it is not (rho " + r2(S.cImbNext) + " and " + r2(S.cRetNext) + "). Consecutive bars tile one continuous trade stream, so a burst of orders can be cut into several bars; the dependence may be that slicing rather than anything tradable, and the pairs overlap in time so no p-value is claimed. The lag table below shows how far it reaches. To be examined with a proper plan before anything is built on it. Near-touch depth is the top 10 levels (Binance snapshots hold only about 0.5 bps of the book); wider depth lives in the collector data and comes later.",
    question: "Can our saved sessions be turned into event-time bars with a sensible feature vector, and what do the bars look like (size, duration, flow, price, depth, time of day)?",
    data: { files, range: new Date(Math.min(...allBars.map(b => b.t0))).toISOString().slice(0, 10) + " .. " + new Date(Math.max(...allBars.map(b => b.t1))).toISOString().slice(0, 10), counts: { sessions: sessions.length, dataMinutes: minutes, bars: allBars.length, partialDroppedAtGap: dropped.gap, partialDroppedAtEnd: dropped.tail } },
    method: {
      summary: "Dollar bars on Binance trades: a bar closes when its trades add up to the bar size, so activity sets the clock. Bar size chosen from the data so a bar lasts about " + PARAMS.targetSec + " s on average (the median is " + r2(median(S.dur)) + " s: activity comes in bursts, so most bars are short and a few are long; " + Math.round(S.zeroDur * 1000) / 10 + "% close within the same millisecond) (" + Math.round(barUsd).toLocaleString("en-US") + " USD). Per bar: aggressor flow and imbalance, OHLC, return in bps and in sigmas (ADR 0004 scale, from the previous 30 minutes only), near-touch depth and its imbalance and change, spread, Hyperliquid flow in the same window, Binance sweeps, largest-trade share, hour of day. Bars never span sessions or a silence over " + PARAMS.gapSec + " s.",
      params: { barUsd: Math.round(barUsd), venue: PARAMS.venue, targetSec: PARAMS.targetSec, gapSec: PARAMS.gapSec, depthLevels: PARAMS.depthLevels, sigmaLagSec: PARAMS.sigmaLagSec, sigmaWinSec: PARAMS.sigmaWinSec },
      plan: ["Bar size is decided from the data before looking at any relationship, and is not tuned afterwards.", "Sanity checks fixed in advance: flow imbalance should correlate positively with the same bar's return; the next bar's return should be nearly unrelated to this bar's flow (did not hold, see the verdict).", "Rank (Spearman) correlation, descriptive only; no test is claimed in this entry."],
      rerun: "node lab-bars.mjs session_*.json.gz --entry docs/lab/lab_" + date + "_bars-coverage.json --date " + date
    },
    results: [
      { type: "text", text: "Bars are descriptive. A correlation here is a check that the bars are built correctly, not a market finding." },
      { type: "table", title: "Feature distributions over all bars (5th / 25th / 50th / 75th / 95th percentile, share missing)", columns: ["feature", "p5", "p25", "median", "p75", "p95", "missing"], rows: FEATURES.map(([f, name]) => [name, ...S.q5(col(allBars, f)).map(r2Safe), r2(S.missing(f))]) },
      { type: "table", title: "Sanity checks (Spearman rank correlation)", columns: ["pair", "rho", "pairs"], rows: [["flow imbalance vs the same bar's return (sigmas)", r2(S.cImbRet), finite(allBars.map(b => b.imb)).length], ["flow imbalance vs the NEXT bar's return", r2(S.cImbNext), allBars.length], ["this bar's return vs the NEXT bar's return", r2(S.cRetNext), allBars.length]] },
      { type: "table", title: "How far the dependence reaches: a bar vs the bar L bars later (Spearman)", columns: ["L bars later", "pairs", "flow imbalance vs that return", "return vs that return"], rows: S.lags.map(l => [l[0], l[1], r2(l[2]), r2(l[3])]) },
      { type: "text", text: Math.round(S.floorShare * 1000) / 10 + "% of bars sit at the sigma floor (the first ~75 s of a session, before 60 returns exist); their return in sigmas is not comparable with the rest." },
      { type: "series", title: "Bars by hour of day (UTC): when our recordings were active", xLabel: "hour (UTC)", yLabel: "bars", x: S.hours.map((_, h) => h), y: S.hours },
      { type: "bars", title: "Bars per session", unit: "bars", items: S.perSession.map((n, i) => ({ label: "s" + (i + 1), value: n })) }
    ]
  };
}
const col = (a, f) => a.map(b => b[f]);
const r2Safe = x => x == null ? null : Math.round(x * 1000) / 1000;

// ---------- the self-test: a made-up session whose bars we can work out by hand
export function selftest() {
  const bad = [], ok = (c, m) => { if (!c) bad.push(m); }, near = (a, b, e = 1e-6) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
  const T0 = 1_700_000_000_000, trade = (t, side, px, ntl, v = "bn", liq = false) => ["t", { t, v, side, px, q: ntl / px, ntl, liq }];
  const book = (t, bid, ask, qty = 1) => ["b", "bn", t, [[bid, qty], [bid - 1, qty]], [[ask, qty], [ask + 1, qty]]];
  const inp = [
    ["q", "bn", T0, 99.9, 100.1], book(T0, 99.9, 100.1, 2),
    trade(T0 + 100, "buy", 100, 600), trade(T0 + 200, "sell", 100, 200),
    ["t", { t: T0 + 250, v: "hl", side: "buy", px: 100, q: 3, ntl: 300 }], ["t", { t: T0 + 260, v: "hl", side: "sell", px: 100, q: 1, ntl: 100 }], ["s", "bn", T0 + 270, "buy", 5000, 3],
    trade(T0 + 300, "buy", 101, 300),                                                                                   // bar 1 closes at 1100 USD >= 1000: buy 900 sell 200
    ["q", "bn", T0 + 400, 100.9, 101.1], book(T0 + 400, 100.9, 101.1, 4),
    trade(T0 + 500, "sell", 100, 400, "bn", true), trade(T0 + 600, "sell", 99, 700),                                  // bar 2: sell 1100 (400 liquidation), return from 101 to 99
    trade(T0 + 700, "buy", 99, 300),                                                                                    // partial (300), then a 2 minute silence drops it
    trade(T0 + 130_000, "buy", 99, 1000),                                                                               // bar 3 after the gap: one trade, gapBefore
    trade(T0 + 131_000, "sell", 99, 500)                                                                                // partial at the end: dropped
  ];
  const r = makeBars(inp, 1000), b = r.bars;
  ok(b.length === 3, "three bars, got " + b.length);
  if (b.length === 3) {
    ok(near(b[0].usd, 1100) && near(b[0].buy, 900) && near(b[0].sell, 200) && near(b[0].imb, 700 / 1100) && b[0].n === 3, "bar 1 flow");
    ok(b[0].o === 100 && b[0].h === 101 && b[0].l === 100 && b[0].px === 101 && near(b[0].retBps, 1e4 * Math.log(101 / 100)) && near(b[0].rangeBps, 1e4 * Math.log(101 / 100)), "bar 1 price");
    ok(near(b[0].hlBuy, 300) && near(b[0].hlSell, 100) && near(b[0].hlImb, 0.5) && b[0].hlN === 2 && b[0].swN === 1 && near(b[0].swUsd, 5000), "bar 1 hyperliquid and sweeps");
    ok(near(b[0].spreadBps, 1e4 * 0.2 / 100) && near(b[0].depth, (99.9 + 98.9 + 100.1 + 101.1) * 2) && near(b[0].depthImb, (397.6 - 402.4) / 800) && b[0].depthChg === null, "bar 1 spread and depth (book taken before the bar closed)");
    ok(near(b[1].sell, 1100) && near(b[1].liq, 400) && near(b[1].imb, -1) && near(b[1].big, 700 / 1100), "bar 2 flow, liquidation, largest trade");
    ok(near(b[1].retBps, 1e4 * Math.log(99 / 101)) && near(b[1].span, 1) && b[1].hlN === 0 && b[1].hlImb === null && b[1].swN === 0, "bar 2 return runs from the previous close; empty windows are null / 0");
    ok(near(b[1].depth, (100.9 + 99.9 + 101.1 + 102.1) * 4) && near(b[1].depthChg, Math.log(((100.9 + 99.9 + 101.1 + 102.1) * 4) / ((99.9 + 98.9 + 100.1 + 101.1) * 2))), "bar 2 depth and its change");
    ok(b[2].gapBefore === true && b[1].gapBefore === false && near(b[2].retBps, 0) && b[2].n === 1, "bar 3 follows a gap: flagged, and its return starts from its own open");
    ok(b.every(x => x.sigma === PARAMS.sigmaFloor), "sigma stays at the floor until enough returns exist");
  }
  ok(r.dropped.gap === 1 && r.dropped.tail === 1, "one partial dropped at the gap, one at the end: " + JSON.stringify(r.dropped));
  const two = makeBars(inp.concat(inp.map(x => x[0] === "t" ? ["t", Object.assign({}, x[1], { t: x[1].t + 1e7 })] : x[0] === "q" || x[0] === "b" ? [x[0], x[1], x[2] + 1e7, ...x.slice(3)] : x)), 1000);
  ok(two.bars.length === 6 && two.bars[3].gapBefore === true, "a repeated session produces its bars again and the join counts as a gap");
  // sigma becomes causal and real once there are enough returns: a long quiet stretch then a jump must not leak into the bar that contains the jump
  const calm = []; let px = 100; for (let s = 0; s < 400; s++) { px *= 1 + (s % 2 ? 1 : -1) * 0.0001; calm.push(trade(T0 + s * 1000, s % 2 ? "buy" : "sell", px, 1000)); }
  calm.push(trade(T0 + 400_000, "buy", px * 1.02, 1000));
  const cb = makeBars(calm, 1000).bars, last = cb[cb.length - 1], before = cb[cb.length - 2];
  ok(cb.length === 401 && last.sigma > PARAMS.sigmaFloor && near(last.sigma, before.sigma, 0.5) && Math.abs(last.retSig) > 10, "sigma from the past only: the jump bar is a big move in the sigma of the calm before it (retSig " + (last && last.retSig) + ")");
  const cu = chooseBarUsd([{ inputs: [trade(T0, "buy", 100, 100), trade(T0 + 10_000, "buy", 100, 900)] }], 10);
  ok(cu === 1000, "bar size: 1000 USD traded over 10 s, target 10 s per bar -> 1000 USD, got " + cu);
  return bad;
}

// ---------- command line
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), val = (n, d) => args.includes(n) ? args[args.indexOf(n) + 1] : d;
  if (args.includes("--selftest")) { const bad = selftest(); if (bad.length) { console.error("FAIL:\n  " + bad.join("\n  ")); process.exit(1); } console.log("lab-bars selftest: ok"); process.exit(0); }
  const files = []; for (let i = 0; i < args.length; i++) { if (args[i].startsWith("--")) { i++; continue; } files.push(args[i]); }
  if (!files.length) { console.error("usage: node lab-bars.mjs SESSION... [--bar-usd N] [--target-sec 10] [--out FILE] [--entry FILE] [--date YYYY-MM-DD]   |   --selftest"); process.exit(1); }
  const { readInput } = await import("./analyze-collectors.mjs");
  PARAMS.targetSec = +val("--target-sec", PARAMS.targetSec);
  let sessions = files.map(readInput).filter(s => s.kind === "session").sort((a, b) => a.t0 - b.t0);
  // a recording saved twice (or two files over the same minutes) would count its bars twice: keep the first and say so
  const kept = []; let skipped = 0; for (const s of sessions) { const last = kept[kept.length - 1]; if (last && s.t0 < last.t1) { skipped++; console.error("skipping " + path.basename(s.file) + ": overlaps " + path.basename(last.file)); continue; } kept.push(s); }
  sessions = kept;
  const barUsd = +val("--bar-usd", 0) || chooseBarUsd(sessions, PARAMS.targetSec);
  if (!barUsd) { console.error("no Binance trades in these files"); process.exit(1); }
  const all = [], dropped = { gap: 0, tail: 0 }; let trades = 0;
  sessions.forEach((s, i) => { const r = makeBars(s.inputs, barUsd, {}, i); all.push(...r.bars); dropped.gap += r.dropped.gap; dropped.tail += r.dropped.tail; trades += r.trades; });
  const dur = all.map(b => b.dur);
  console.log(`${sessions.length} sessions (${skipped} skipped as overlapping), ${trades} Binance trades -> ${all.length} bars of ${Math.round(barUsd).toLocaleString("en-US")} USD; duration median ${median(dur).toFixed(1)} s, p5 ${quantile(dur, .05).toFixed(1)}, p95 ${quantile(dur, .95).toFixed(1)}; dropped ${dropped.gap} at a gap, ${dropped.tail} at the end`);
  const out = val("--out", "lab-data/bars.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ kind: "sv-lab-bars", version: 1, params: Object.assign({}, PARAMS, { barUsd }), files: sessions.map(s => path.basename(s.file)), dropped, bars: all }));
  console.log("wrote " + out);
  const entry = val("--entry", null);
  if (entry) {
    const date = val("--date", new Date().toISOString().slice(0, 10)), e = buildEntry(sessions, all, barUsd, dropped, date, sessions.map(s => path.basename(s.file)));
    fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, JSON.stringify(e, null, 1) + "\n"); console.log("wrote " + entry + " (" + (Buffer.byteLength(JSON.stringify(e)) / 1024).toFixed(1) + " KB)");
  }
}
