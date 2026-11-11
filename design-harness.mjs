// design-harness.mjs: replay a sampled trade-system design on saved sessions (offline, not part of the app).
// Spec: .scratch/trade-system/sampling-design.md (the sampler), .scratch/trader/spec.md section 3 (the system core).
// Since Trader step 3 this file holds no trading logic: a sampled design is converted to a system object (toSystem) and the trades come from running src/js/system-core.js (SYSTEM) over the
// session's snapshots, one second at a time, exactly as the page will run it live. The old batch version is archive/design-harness-batch.mjs.
//
//   node design-harness.mjs --selftest
//   node design-harness.mjs [--sessions sessions] [--split dev|holdout] [--confirm-holdout] [--n 100] [--seed 1] [--out results.jsonl] [--legacy-facts]
//   node design-harness.mjs --run-defaults [--sessions sessions] [--split dev] [--limit N] [--journal out.json]
//       runs the page's runner (RUNNER) with the seven default systems over each session's snapshots and prints RUNNER.evaluate. Its only purpose is to test the code (page against harness, Trader step 4);
//       the results are not evidence, and the hold-out and fresh splits are refused.
//   --legacy-facts: the comparison mode of step 3: the core is fed the old batch harness's look-ahead facts (whole-session sigma, end-of-session episode groups, no calibration or staleness gate)
//
// Execution model, same for every design: the entry is filled one latency after the trigger's time at the price then (newest price at most 2 s old; none = no trade), one position at a time,
// exits are filled at the price of the second that decides them (a target at its level, a time exit at the end of the hold), a fixed round-trip cost in bps. R = net bps / stop distance in bps.
// Descriptive only: no app, Reader or broker change. Hold-out: sessions are ordered by start time; the latest 30% are reserved and refused unless --confirm-holdout is given.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./compare-detections.mjs";
import { readInput } from "./lib/session-io.mjs";
import { sigmaOf } from "./lib/sigma.mjs";
import { rng, generate, loadPool } from "./sample-designs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPDIR = path.join(HERE, ".scratch", "trade-system", "cache-snap"), OLDCACHE = path.join(HERE, ".scratch", "trade-system", "cache");
export const EXEC = { latencyMs: 1000, costBps: 8, maxGapMs: 30000, holdoutShare: 0.3 };
export const SYSTEM = vm.runInNewContext(fs.readFileSync(path.join(HERE, "src/js/system-core.js"), "utf8") + "\n;SYSTEM", {});
// the paper runner (Trader step 4) and the seven default systems: the same files the page includes, in one context with their own SYSTEM
export const { RUNNER, SYSTEMS_DEFAULT } = vm.runInNewContext(["system-core", "systems-default", "runner-core"].map(f => fs.readFileSync(path.join(HERE, "src/js", f + ".js"), "utf8")).join("\n") + "\n;({ RUNNER, SYSTEMS_DEFAULT })", {});

// ---------- price helpers (history = [[t_ms, price]], one point a second) ----------
export function priceAt(h, t, within = 2000) {
  let lo = 0, hi = h.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r >= 0 && t - h[r][0] <= within ? [h[r][1], r] : null;
}
const priceAny = (h, t) => priceAt(h, t, Infinity);

// ---------- templates: category -> parameter draws (the sampler's side; what a category does is in SYSTEM) ----------
const logU = (r, lo, hi) => Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)));
const pick = (r, a) => a[Math.floor(r() * a.length)];
const FAMILIES = ["absorption", "exhaustion", "burst", "wall"];
export const HOLD_RANGE = { seconds: [10, 60], minutes: [60, 600] };      // sessions are short (about 15 minutes), so longer horizons are not testable yet
export const TEMPLATES = {
  ctx: { "always-on": { draw: () => ({}) } },
  reg: { "none": { draw: () => ({}) }, "range-or-session-box": { draw: r => ({ windowSec: Math.round(logU(r, 300, 1800)) }) } },
  sz: { "fixed-fraction-risk": { draw: () => ({}) } },
  trig: {
    "reader-episode-event": { draw: r => { const k = 1 + Math.floor(r() * 3), fams = FAMILIES.slice().sort(() => r() - 0.5).slice(0, k); return { families: fams.sort(), venue: pick(r, ["any", "bn", "hl"]) }; } },
    "price-move-or-distance-threshold": { draw: r => ({ lookSec: Math.round(logU(r, 10, 300)), m: +logU(r, 1, 4).toFixed(2), venue: pick(r, ["bn", "hl"]) }) },
    "cross-venue-or-asset-divergence": { draw: r => ({ baseSec: Math.round(logU(r, 60, 600)), minBps: +logU(r, 0.3, 3).toFixed(2), coolSec: Math.round(logU(r, 10, 120)), venue: pick(r, ["hl", "bn"]) }) },
    "trade-flow-signal": { draw: r => ({ lookSec: Math.round(logU(r, 10, 120)), share: +(0.5 + 0.4 * r()).toFixed(2), m: +logU(r, 2, 8).toFixed(2), venue: pick(r, ["bn", "hl"]) }) },
    "book-depth-and-wall-event": { draw: r => ({ edge: pick(r, [5, 20]), thr: +(0.3 + 0.5 * r()).toFixed(2), sustainSec: Math.round(logU(r, 1, 10)), coolSec: Math.round(logU(r, 10, 120)), venue: pick(r, ["bn", "hl"]) }) },
    "level-or-range-break": { draw: r => ({ brkBps: +(r() * 2).toFixed(2), coolSec: Math.round(logU(r, 10, 120)), venue: pick(r, ["bn", "hl"]) }) },
    "level-rejection-bounce": { draw: r => ({ tolBps: +logU(r, 0.2, 2).toFixed(2), rejBps: +logU(r, 1, 5).toFixed(2), lookSec: Math.round(logU(r, 5, 60)), coolSec: Math.round(logU(r, 10, 120)), venue: pick(r, ["bn", "hl"]) }) },
  },
  thes: { "continuation-momentum": { draw: () => ({ sign: +1 }) }, "mean-reversion-overreaction": { draw: () => ({ sign: -1 }) } },
  exit: {
    "elapsed-time-stop": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)) }; } },
    "flow-episode-or-book-state-exit": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor], k = 1 + Math.floor(r() * 3); return { holdSec: Math.round(logU(r, lo, hi)), families: FAMILIES.slice().sort(() => r() - 0.5).slice(0, k).sort() }; } },
    "fixed-distance-target": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)), tpK: +logU(r, 0.5, 3).toFixed(2) }; } },
    "trailing-or-ratchet-stop": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)), trailK: +logU(r, 0.5, 3).toFixed(2) }; } },
    "named-level-target": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)), frac: pick(r, [0.5, 1]) }; } },
    "indicator-normalization-exit": { draw: (r, d) => { const [lo, hi] = HOLD_RANGE[d.hor]; return { holdSec: Math.round(logU(r, lo, hi)) }; } },
  },
  stop: { "sigma-multiple-stop": { draw: r => ({ k: +logU(r, 0.5, 3).toFixed(2) }) } },
};
export function implemented() { const o = {}; for (const s in TEMPLATES) o[s] = Object.keys(TEMPLATES[s]); o.hor = Object.keys(HOLD_RANGE); return o; }

// a design = sampler categories + parameter draws (seeded by the design id, so a design replays identically)
export function instantiate(design, seed = 1) {
  const r = rng((seed * 1000003 + Number(design.id.slice(1))) >>> 0), p = {};
  for (const slot of ["ctx", "reg", "trig", "thes", "exit", "stop", "sz"]) { const t = TEMPLATES[slot] && TEMPLATES[slot][design[slot]]; if (!t) throw new Error("no template for " + slot + "=" + design[slot]); p[slot] = t.draw(r, design); }
  return { ...design, p };
}

// ---------- a sampled design as a system object ----------
const TRIG = {
  "reader-episode-event": p => ({ type: "episode", families: p.families }),
  "price-move-or-distance-threshold": p => ({ type: "priceMove", lookSec: p.lookSec, m: p.m }),
  "cross-venue-or-asset-divergence": p => ({ type: "premium", baseSec: p.baseSec, minBps: p.minBps, coolSec: p.coolSec }),
  "trade-flow-signal": p => ({ type: "tradeFlow", lookSec: p.lookSec, share: p.share, m: p.m }),
  "book-depth-and-wall-event": p => ({ type: "bookDepth", edge: p.edge, thr: p.thr, sustainSec: p.sustainSec, coolSec: p.coolSec }),
  "level-or-range-break": p => ({ type: "rangeBreak", brkBps: p.brkBps, coolSec: p.coolSec }),
  "level-rejection-bounce": p => ({ type: "levelRejection", tolBps: p.tolBps, rejBps: p.rejBps, lookSec: p.lookSec, coolSec: p.coolSec }),
};
const EXITS = {
  "elapsed-time-stop": p => ({ type: "timed", holdSec: p.holdSec }),
  "flow-episode-or-book-state-exit": p => ({ type: "flowEpisode", holdSec: p.holdSec, families: p.families }),
  "fixed-distance-target": p => ({ type: "target", holdSec: p.holdSec, tpK: p.tpK }),
  "trailing-or-ratchet-stop": p => ({ type: "trailing", holdSec: p.holdSec, trailK: p.trailK }),
  "named-level-target": p => ({ type: "rangeLevel", holdSec: p.holdSec, frac: p.frac }),
  "indicator-normalization-exit": p => ({ type: "normalisation", holdSec: p.holdSec }),
};
export function toSystem(d) {
  const w = d.p.reg && d.p.reg.windowSec, sign = d.p.thes.sign;
  return {
    name: d.id, stage: "paper", venue: d.p.trig.venue,
    context: { type: "always" }, region: w ? { type: "rangeBox", windowSec: w } : { type: "none" },
    trigger: TRIG[d.trig](d.p.trig),
    thesis: { dir: sign > 0 ? "continuation" : "fade", text: d.thes + " on " + d.trig, invalidation: { type: "none" } },
    exit: EXITS[d.exit](d.p.exit), risk: { stopK: d.p.stop.k, riskFrac: 0.01 },
  };
}

// ---------- sessions: headers, snapshots (cached), comparison-mode facts ----------
const engineHash = () => crypto.createHash("sha1").update(["reader-episodes", "reader-engine"].map(x => fs.readFileSync(path.join(HERE, "src/js", x + ".js"))).join("\n") + "|facts" + SYSTEM.FACTS_VERSION + "|late" + LATE_MS).digest("hex").slice(0, 12);
let ENGINE = null;
const LATE_MS = 300000;      // replay: a second's facts wait 5 minutes for late input (a recording can carry a backlog that late), so they are exactly what the timestamps say (see SYSTEM.facts)
// every BTC session's start time (header only, from the old fact caches when they exist, else one light read), oldest first. Snapshots are built later and only for the sessions asked for.
export function listSessions(dir, { limit = Infinity } = {}) {
  const files = fs.readdirSync(dir).filter(f => /^session_.*\.json(\.gz)?$/.test(f)).sort().slice(0, limit), out = [];
  for (const f of files) {
    const full = path.join(dir, f), st = fs.statSync(full); let h = null;
    try { const c = JSON.parse(fs.readFileSync(path.join(OLDCACHE, f + ".json"), "utf8")); if (c.t0 != null && c.sym) h = { sym: c.sym, t0: c.t0, t1: c.t1 }; } catch { /* no old cache */ }
    if (!h) { const s = readInput(full, true); h = { sym: s.sym, t0: s.t0, t1: s.t1 }; }
    out.push({ file: f, dir, size: st.size, ...h });
  }
  return out.filter(s => s.sym === "BTC").sort((a, b) => a.t0 - b.t0);
}
// the snapshot series of one session: from the cache, else replayed through the engine and facts accumulator. Sets s.snaps, s.finalGroups, s.hist, s.sigma.
export function loadSnaps(s) {
  if (s.snaps) return s;
  fs.mkdirSync(SNAPDIR, { recursive: true }); const cf = path.join(SNAPDIR, s.file + ".json"), hash = engineHash(); let c = null;
  try { const j = JSON.parse(fs.readFileSync(cf, "utf8")); if (j.v === 2 && j.hash === hash && j.size === s.size) c = j; } catch { /* rebuild */ }
  if (!c) {
    ENGINE ||= loadEngine(null).E; const inp = readInput(path.join(s.dir, s.file)).inputs, e = ENGINE.create(), F = SYSTEM.facts({ engine: e, lateMs: LATE_MS }), snaps = [];
    for (const r of inp) for (const x of F.feed(r)) snaps.push(x);
    for (const x of F.flush()) snaps.push(x);
    c = { v: 2, hash, size: s.size, file: s.file, snaps, finalGroups: F.finalGroups() }; fs.writeFileSync(cf, JSON.stringify(c));
  }
  s.snaps = c.snaps; s.finalGroups = c.finalGroups;
  s.hist = { bn: [], hl: [] }; for (const x of s.snaps) for (const v of ["bn", "hl"]) if (x.px[v] != null) s.hist[v].push([x.t, x.px[v]]);
  s.sigma = { bn: sigmaOf(s.hist.bn), hl: sigmaOf(s.hist.hl) };
  return s;
}
// the old batch harness's facts: whole-session sigma, groups as they are at the end of the session (first seen at the first second at or after their detection), no calibration or staleness gate
export function legacySnaps(s) {
  if (s.legacy) return s.legacy; loadSnaps(s);
  const snaps = s.snaps.map(x => ({ ...x, sigma: { bn: s.sigma.bn, hl: s.sigma.hl }, age: { bn: 0, hl: 0 }, calibrated: true, episodes: { new: [], ended: [], active: [] } }));
  const at = t => { let lo = 0, hi = snaps.length; while (lo < hi) { const m = (lo + hi) >> 1; if (snaps[m].t < t) lo = m + 1; else hi = m; } return lo; };
  for (const g of s.finalGroups.slice().sort((a, b) => a.tDetected - b.tDetected)) {
    const i = at(g.tDetected); if (i < snaps.length) snaps[i].episodes.new.push({ id: g.id, family: g.family, venue: g.venue, side: g.side, tDetected: g.tDetected });
    if (g.tEnd != null) { const j = at(g.tEnd); if (j < snaps.length) snaps[j].episodes.ended.push({ id: g.id, family: g.family, venue: g.venue, side: g.side, tDetected: g.tDetected, tEnd: g.tEnd }); }
  }
  return (s.legacy = snaps);
}

// ---------- run a system on one session ----------
// Drives SYSTEM with the execution model above. o.legacy: comparison facts. o.signals: forced trigger times (the random-entry null). o.collect: an array that receives the trigger's signals.
export function runSystem(def, s, ex = EXEC, o = {}) {
  loadSnaps(s); const snaps = o.legacy ? legacySnaps(s) : s.snaps, H = s.hist, trades = [];
  if (!snaps.length) return trades;
  const inst = SYSTEM.create(def, { latencyMs: ex.latencyMs, maxGapMs: ex.maxGapMs, signals: o.signals || null });
  let open = null;
  const finish = (it, reason) => {
    const p = open; open = null; if (!p) return;
    let px;
    if (reason === "target") px = p.p0 * (1 + p.dir * it.bps / 1e4);
    else { const a = priceAt(H[it.venue], it.tAt); if (a) px = a[0]; else { const b = priceAny(H[it.venue], it.tAt); px = b ? b[0] : p.p0; if (reason === "time") reason = "gap"; } }
    const gross = p.dir * (px / p.p0 - 1) * 1e4; trades.push({ tIn: p.tIn, tOut: it.tAt, dir: p.dir, gross, net: gross - ex.costBps, R: (gross - ex.costBps) / p.stopBps, exit: reason, stopBps: p.stopBps, session: s.file, venue: it.venue });
    inst.closed(px, it.tAt);
  };
  const handle = intents => {
    for (const it of intents) {
      if (it.type === "enter") {
        const tIn = it.tSig + ex.latencyMs, a = priceAt(H[it.venue], tIn);
        if (o.collect) o.collect.push({ t: it.tSig, venue: it.venue, side: it.dir / (def.thesis.dir === "fade" ? -1 : 1) });
        if (!a) { inst.cancelled(); continue; }
        const back = inst.filled(a[0], tIn); if (back.length) continue;      // void: a level target with no room behind the fill (the batch harness traded nothing)
        open = { dir: it.dir, p0: a[0], tIn, stopBps: it.stopBps };
      } else if (it.type === "skip") { if (o.collect && it.reason !== "no region yet") o.collect.push({ t: it.tSig, venue: it.venue, side: it.side }); }
      else if (it.type === "exit" || it.type === "invalidate") finish(it, it.reason);
    }
  };
  for (const x of snaps) { const a = inst.step(x); if (a.length) handle(a); }
  const last = snaps[snaps.length - 1]; handle(inst.end(last));
  return trades;
}

// ---------- run a design on sessions ----------
export function runDesign(d, sessions, ex = EXEC, nullDraw = null, o = {}) {
  const def = toSystem(d); if (SYSTEM.validate(def).length) return [];      // a design the core cannot run (a level trigger without a region, ...) trades nothing, as before
  const trades = [];
  for (const s of sessions) {
    if (!nullDraw) { trades.push(...runSystem(def, s, ex, o)); continue; }
    d._sig ||= new Map(); const key = (o.legacy ? "L" : "N") + s.file; let sig = d._sig.get(key);
    if (!sig) { sig = []; runSystem(def, s, ex, { ...o, collect: sig }); sig.sort((a, b) => a.t - b.t); d._sig.set(key, sig); }
    loadSnaps(s); const forced = nullDraw(s, sig); trades.push(...runSystem(def, s, ex, { ...o, signals: forced }));
  }
  return trades;
}
// null: same number of signals, at random moments of each session on the same venue, random direction
export function randomizer(seed) {
  const r = rng(seed);
  return (s, sig) => sig.map(e => { const h = s.hist[e.venue]; if (!h || h.length < 2) return e; return { t: h[0][0] + r() * (h[h.length - 1][0] - h[0][0]), venue: e.venue, side: r() < 0.5 ? 1 : -1 }; }).sort((a, b) => a.t - b.t);
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function summarize(trades, seed = 1, boots = 300) {
  const R = trades.map(t => t.R), G = trades.map(t => t.gross), n = R.length;
  const out = { n, meanR: mean(R), medianR: median(R), hit: n ? R.filter(x => x > 0).length / n : null, meanGrossBps: mean(G), medianGrossBps: median(G), stopShare: n ? trades.filter(t => t.exit === "stop").length / n : null, sessions: new Set(trades.map(t => t.session)).size };
  // trades inside one session are not independent: bootstrap over sessions (R and gross bps)
  const by = {}; for (const t of trades) (by[t.session] ||= []).push(t);
  const ses = Object.values(by), rr = rng(seed + 17);
  if (ses.length >= 3) {
    const mR = [], mG = [];
    for (let b = 0; b < boots; b++) { let sr = 0, sg = 0, c = 0; for (let i = 0; i < ses.length; i++) { const x = ses[Math.floor(rr() * ses.length)]; for (const t of x) { sr += t.R; sg += t.gross; c++; } } mR.push(c ? sr / c : 0); mG.push(c ? sg / c : 0); }
    mR.sort((a, b) => a - b); mG.sort((a, b) => a - b); const q = (m, f) => m[Math.floor(f * boots)];
    out.ci = [q(mR, 0.025), q(mR, 0.975)]; out.ciGross = [q(mG, 0.025), q(mG, 0.975)];
  } else { out.ci = null; out.ciGross = null; }
  return out;
}

export function splitSessions(all, which, confirm = false, cutT = null, share = EXEC.holdoutShare, freshT = null) {
  // cutT (ms): fixed start-time cut; sessions starting before it are dev. Without it the latest `share` of the list is the hold-out (only for tests: it moves as sessions are added).
  const cut = cutT == null ? null : cutT, i = Math.floor(all.length * (1 - share));
  const dev = cut == null ? all.slice(0, i) : all.filter(s => s.t0 < cut), hold = cut == null ? all.slice(i) : all.filter(s => s.t0 >= cut && (freshT == null || s.t0 < freshT));      // the hold-out ends where the fresh data begins, so new sessions never leak into it
  if (which === "dev") return dev;
  if (which === "holdout") { if (!confirm) throw new Error("hold-out sessions are reserved: pass --confirm-holdout only for final candidates"); return hold; }
  if (which === "fresh") { if (!confirm) throw new Error("fresh sessions are reserved for pre-registered tests: pass --confirm-holdout"); if (freshT == null) throw new Error("no fresh cutoff"); return all.filter(x => x.t0 >= freshT); }
  if (which === "all") { if (!confirm) throw new Error("'all' includes the hold-out: pass --confirm-holdout"); return all; }
  throw new Error("--split must be dev, holdout or all");
}
// fresh data = sessions that start after the newest session that existed when the cutoff file was written; used only for pre-registered tests (see .scratch/trade-system/prereg-*.md)
export function freshCutoff(all, file = path.join(HERE, ".scratch", "trade-system", "fresh-cutoff.json")) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).cutT; } catch { /* first use */ }
  const cutT = Math.max(...all.map(x => x.t1)) + 1;
  fs.writeFileSync(file, JSON.stringify({ cutT, iso: new Date(cutT).toISOString(), createdFromSessions: all.length, note: "sessions starting at or after cutT are fresh data for pre-registered tests only; do not edit" }, null, 1)); return cutT;
}
// the hold-out cut is written once, then reused, so new sessions never move sessions between dev and hold-out
export function holdoutCutoff(all, file = path.join(HERE, ".scratch", "trade-system", "holdout-cutoff.json")) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).cutT; } catch { /* first use */ }
  const cutT = all[Math.floor(all.length * (1 - EXEC.holdoutShare))].t0;
  fs.writeFileSync(file, JSON.stringify({ cutT, iso: new Date(cutT).toISOString(), createdFromSessions: all.length, note: "sessions starting at or after cutT are the hold-out; do not edit" }, null, 1)); return cutT;
}

// ---------- self test ----------
function selftest() {
  let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok  ", m); };
  const ex = { latencyMs: 1000, costBps: 8, maxGapMs: 30000 }, T0 = 1e12;
  // a synthetic session: price per second for bn (and hl), flows, groups
  const mkSess = (file, bn, over = {}) => {
    const snaps = bn.map((p, i) => ({ t: T0 + i * 1000, px: { bn: p, hl: over.hl ? over.hl[i] : null }, sigma: { bn: 0.05, hl: 0.05 }, age: { bn: 0, hl: 0 }, calibrated: true,
      flow: { bn: { buy: 0, sell: 0, liqBuy: 0, liqSell: 0 }, hl: { buy: 0, sell: 0, liqBuy: 0, liqSell: 0 } }, imb: { bn: { 5: null, 20: null }, hl: { 5: null, 20: null } }, episodes: { new: [], ended: [], active: [] }, state: null }));
    for (const g of over.groups || []) { const i = Math.ceil((g.tDetected - T0) / 1000); snaps[i].episodes.new.push(g); }
    const s = { file, snaps, finalGroups: [] }; s.hist = { bn: [], hl: [] }; for (const x of snaps) for (const v of ["bn", "hl"]) if (x.px[v] != null) s.hist[v].push([x.t, x.px[v]]); s.sigma = { bn: 0.05, hl: 0.05 }; return s;
  };
  const mk = f => { const a = []; for (let i = 0; i <= 600; i++) a.push(f(i)); return a; };
  const up = mk(i => 100 * (1 + i * 1e-5)), flat = mk(() => 100);
  const D = (trig, p, exit, pe, k = 3, sign = 1, extra = {}) => ({ id: "M00001", trig, thes: sign > 0 ? "continuation-momentum" : "mean-reversion-overreaction", exit, hor: "seconds", p: { ctx: {}, reg: extra.reg || {}, trig: p, thes: { sign }, exit: pe, stop: { k }, sz: {} } });
  const epi = (t, side = "buy", fam = "burst", id = "g" + t) => ({ id, family: fam, venue: "bn", side: side === "buy" ? 1 : -1, tDetected: t });
  const dEp = (pe, exit = "elapsed-time-stop", sign = 1, k = 3) => D("reader-episode-event", { families: ["burst"], venue: "any" }, exit, pe, k, sign);
  const sess = mkSess("x", up, { groups: [epi(T0 + 10000), epi(T0 + 20000), epi(T0 + 200000)] });
  let tr = runDesign(dEp({ holdSec: 60 }), [sess], ex); ok(tr.length === 2 && tr[0].dir === 1, "second signal inside an open position is skipped (2 trades of 3 signals)");
  ok(Math.abs(tr[0].gross - 6) < 0.2 && tr[0].exit === "time" && tr[0].tIn === T0 + 11000 && tr[0].tOut === T0 + 71000, "entry one latency after the signal, time exit after the hold (" + tr[0].gross.toFixed(2) + " bps)");
  tr = runDesign(dEp({ holdSec: 60 }, "elapsed-time-stop", -1, 30), [sess], ex); ok(tr.length >= 1 && tr.every(x => x.dir === -1 && x.gross < -5), "mean-reversion thesis trades against the episode");
  ok(runDesign(D("reader-episode-event", { families: ["wall"], venue: "any" }, "elapsed-time-stop", { holdSec: 60 }), [sess], ex).length === 0, "family filter is respected");
  const flatS = mkSess("f", flat, { groups: [epi(T0 + 10000)] }); tr = runDesign(dEp({ holdSec: 60 }), [flatS], ex); ok(tr.length === 1 && tr[0].net === -8 && Math.abs(tr[0].R + 8 / (3 * 0.05 * Math.sqrt(60))) < 1e-9, "flat price: gross 0, net equals minus the cost, R uses the stop distance");
  const crash = mkSess("c", mk(i => i < 20 ? 100 : 99), { groups: [epi(T0 + 5000)] }); tr = runDesign(dEp({ holdSec: 100 }, "elapsed-time-stop", 1, 30), [crash], ex); ok(tr.length === 1 && tr[0].exit === "stop" && Math.abs(tr[0].gross + 100) < 1e-6, "a stop gapped through is filled at the tick price (-100 bps), not at the stop level");
  ok(runDesign(dEp({ holdSec: 100 }, "elapsed-time-stop", -1, 30), [crash], ex)[0].exit === "time", "short through the same crash is not stopped and profits");
  const endS = mkSess("e", flat, { groups: [epi(T0 + 590000)] }); tr = runDesign(dEp({ holdSec: 60 }), [endS], ex); ok(tr.length === 1 && tr[0].exit === "end", "data ending before the hold time closes the trade with reason end (the batch harness dropped it)");
  const gapS = mkSess("g", flat, { groups: [epi(T0 + 50000)] }); gapS.snaps.splice(100, 100); gapS.hist.bn.splice(100, 100); tr = runDesign(dEp({ holdSec: 300 }), [gapS], ex); ok(tr.length === 1 && tr[0].exit === "gap", "a gap in the prices closes the trade with reason gap");
  // determinism and summary
  const s3 = [sess, { ...sess, file: "y" }, { ...sess, file: "z" }], s1 = summarize(runDesign(dEp({ holdSec: 60 }), s3, ex), 1), s2 = summarize(runDesign(dEp({ holdSec: 60 }), s3, ex), 1);
  ok(JSON.stringify(s1) === JSON.stringify(s2) && s1.n === 6 && s1.sessions === 3, "summary is deterministic (" + s1.n + " trades)");
  // the random-entry null keeps the signal count and is seeded
  const sg = [{ t: T0 + 10000, venue: "bn", side: 1 }, { t: T0 + 20000, venue: "bn", side: 1 }, { t: T0 + 200000, venue: "bn", side: 1 }], a = randomizer(5)(sess, sg), b = randomizer(5)(sess, sg);
  ok(JSON.stringify(a) === JSON.stringify(b) && a.length === 3, "random-entry null keeps the signal count and is seeded");
  { const d = dEp({ holdSec: 60 }), n1 = runDesign(d, [sess], ex, randomizer(7)), n2 = runDesign(d, [sess], ex, randomizer(7)); ok(JSON.stringify(n1) === JSON.stringify(n2) && n1.length >= 1, "a null run through the core is seeded (" + n1.length + " trades)"); }
  // toSystem and instantiate
  const des = instantiate({ id: "M00001", ctx: "always-on", reg: "none", trig: "reader-episode-event", thes: "continuation-momentum", exit: "elapsed-time-stop", stop: "sigma-multiple-stop", sz: "fixed-fraction-risk", hor: "minutes" }, 1);
  ok(des.p.exit.holdSec >= 60 && des.p.exit.holdSec <= 600 && des.p.stop.k >= 0.5 && des.p.stop.k <= 3, "parameters are drawn inside their ranges");
  ok(SYSTEM.validate(toSystem(des)).length === 0 && toSystem(des).venue === des.p.trig.venue, "a sampled design converts to a valid system");
  const g = generate({ pool: loadPool(), n: 60, seed: 4, implemented: implemented() }).designs.map(x => instantiate(x, 1));
  ok(g.length === 60 && g.every(x => implemented().trig.includes(x.trig) && implemented().exit.includes(x.exit)), "sampler draws only implemented categories");
  ok(new Set(g.map(x => x.trig)).size >= 5 && new Set(g.map(x => x.exit)).size >= 4, "most triggers and exits are drawn (" + new Set(g.map(x => x.trig)).size + " triggers, " + new Set(g.map(x => x.exit)).size + " exits in 60 designs)");
  const NEEDS = ["level-or-range-break", "level-rejection-bounce"];
  ok(g.every(x => !(NEEDS.includes(x.trig) && x.reg === "none") && !(x.exit === "named-level-target" && x.reg === "none") && !(x.exit === "indicator-normalization-exit" && !["cross-venue-or-asset-divergence", "trade-flow-signal", "book-depth-and-wall-event"].includes(x.trig))), "sampled designs respect the region and normalisation rules");
  ok(g.every(x => { const v = SYSTEM.validate(toSystem(x)); return v.length === 0 || (x.reg !== "none" && !NEEDS.includes(x.trig) && x.exit !== "named-level-target"); }), "every sampled design is a valid system (or carries an unused region)");
  ok(runDesign(D("price-move-or-distance-threshold", { lookSec: 20, m: 2, venue: "bn" }, "indicator-normalization-exit", { holdSec: 60 }), [flatS], ex).length === 0, "a trigger without a normaliser trades nothing under a normalisation exit");
  // price-move trigger on a jump
  const jump = mkSess("j", mk(i => i < 100 ? 100 : 100.1)); tr = runDesign(D("price-move-or-distance-threshold", { lookSec: 20, m: 2, venue: "bn" }, "elapsed-time-stop", { holdSec: 30 }, 3), [jump], ex); ok(tr.length >= 1 && tr[0].dir === 1 && tr[0].tIn === T0 + 101000, "price-move trigger fires on the jump, side up, one latency later");
  // flow exit
  const fl = mkSess("fl", flat, { groups: [epi(T0 + 10000), epi(T0 + 50000, "sell"), { id: "w", family: "wall", venue: "bn", side: 1, tDetected: T0 + 30000 }] });
  const dF = dEp({ holdSec: 200, families: ["burst", "wall"] }, "flow-episode-or-book-state-exit"); tr = runDesign(dF, [fl], ex); ok(tr.length === 1 && tr[0].exit === "flow" && tr[0].tOut === T0 + 51000, "opposite-side episode (sell burst) exits one latency later; the supportive bid wall does not");
  // hold-out guard
  const fake = Array.from({ length: 10 }, (_, i) => ({ t0: i })); ok(splitSessions(fake, "dev").length === 7, "dev split is the earliest 70%");
  let threw = false; try { splitSessions(fake, "holdout"); } catch { threw = true; } ok(threw, "hold-out is refused without --confirm-holdout");
  ok(splitSessions(fake, "holdout", true).length === 3 && splitSessions(fake, "holdout", true)[0].t0 === 7, "hold-out is the latest 30%");
  const grown = fake.concat([{ t0: 10 }, { t0: 11 }]); ok(splitSessions(grown, "dev", false, 7).length === 7 && splitSessions(grown, "holdout", true, 7).length === 5, "with a fixed cut, new sessions land in the hold-out and dev does not move");
  const fresh = [{ t0: 1, t1: 5 }, { t0: 6, t1: 9 }, { t0: 12, t1: 15 }]; ok(splitSessions(fresh, "fresh", true, null, undefined, 10).length === 1, "fresh split keeps only sessions starting at or after the fresh cutoff");
  { const gg = [{ t0: 1 }, { t0: 8 }, { t0: 11 }, { t0: 14 }]; ok(splitSessions(gg, "holdout", true, 7, undefined, 12).length === 2 && splitSessions(gg, "fresh", true, 7, undefined, 12).length === 1, "hold-out ends at the fresh cutoff: the newest session is fresh, not hold-out"); }
  let thr2 = false; try { splitSessions(fresh, "fresh", false, null, undefined, 10); } catch { thr2 = true; } ok(thr2, "fresh data is refused without --confirm-holdout");
  console.log(fail ? fail + " FAILED" : "all passed"); process.exit(fail ? 1 : 0);
}

// ---------- cli ----------
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf("--" + k); return i < 0 ? d : args[i + 1]; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes("--selftest")) selftest();
  else if (args.includes("--run-defaults")) {
    const split = arg("split", "dev"); if (split !== "dev") { console.error("--run-defaults reads the dev split only (the hold-out and fresh data are never read here)"); process.exit(2); }
    const one = arg("file", null);      // --file one.json.gz: that one session only, whatever its split (a code-parity test of the page's runner against its own journal; read once, no results are used)
    const dir = path.resolve(HERE, arg("sessions", "sessions")), lim = Number(arg("limit", Infinity));
    const sessions = one ? [{ file: path.basename(one), dir: path.dirname(path.resolve(one)), size: fs.statSync(one).size }] : (a => splitSessions(a, "dev", false, holdoutCutoff(a)).slice(0, lim))(listSessions(dir));
    console.log("TEST OF THE CODE ONLY: the default systems on " + sessions.length + " saved dev sessions through the page's runner. These sessions were seen while the systems were designed; the numbers are not evidence and are not used for promotion.");
    let journal = []; const t0 = Date.now();
    for (const s of sessions) {
      loadSnaps(s); if (!s.snaps.length) continue;
      const r = RUNNER.create({ systems: SYSTEMS_DEFAULT, twins: 20, equity: 10000, feeBps: 5, riskCap: 0.02, seed: 1, journal });      // one runner a session (the page starts a new one after a gap); the journal and equity carry over
      console.error("[" + (sessions.indexOf(s) + 1) + "/" + sessions.length + "] " + s.file + ": " + s.snaps.length + " snapshots");
      for (const x of s.snaps) r.step(x);
      r.interrupt(s.snaps[s.snaps.length - 1].t); journal = r.rows(); s.snaps = null; s.hist = null; s.legacy = null;
    }
    const ev = RUNNER.evaluate(journal), f = (x, d = 2) => x == null ? "-" : x.toFixed(d);
    console.error("runner done in " + ((Date.now() - t0) / 1000).toFixed(0) + " s, " + journal.length + " journal rows");
    console.log("system".padEnd(22) + "trades  days  net bps       R  pos days  vs twins  interrupted  by reason");
    for (const d of SYSTEMS_DEFAULT) { const e = ev[SYSTEM.id(d)] || { trades: 0, days: 0, byReason: {}, interrupted: 0 };
      console.log(d.name.padEnd(22) + String(e.trades).padStart(6) + String(e.days).padStart(6) + f(e.meanNetBps).padStart(9) + f(e.meanR, 3).padStart(8) + (e.posDayShare == null ? "-" : (100 * e.posDayShare).toFixed(0) + "%").padStart(10) + (e.twinPercentile == null ? "too few" : "p" + e.twinPercentile.toFixed(0)).padStart(10) + String(e.interrupted).padStart(13) + "  " + JSON.stringify(e.byReason)); }
    if (arg("journal", null)) fs.writeFileSync(arg("journal"), JSON.stringify(journal));
  }
  else {
    const dir = path.resolve(HERE, arg("sessions", "sessions")), seed = Number(arg("seed", 1)), n = Number(arg("n", 100)), nullReps = Number(arg("null", 20));
    const costs = arg("costs", "0,2,4,8").split(",").map(Number), split = arg("split", "dev"), legacy = args.includes("--legacy-facts");
    const ex = { ...EXEC, latencyMs: Number(arg("latency", EXEC.latencyMs)) };      // entry delay after a signal, ms
    const t0 = Date.now(), all = listSessions(dir), sessions = splitSessions(all, split, args.includes("--confirm-holdout"), holdoutCutoff(all), undefined, split === "fresh" || split === "holdout" ? freshCutoff(all) : null);
    if (!sessions.length) { console.error(`no sessions in the '${split}' split yet`); process.exit(3); }
    console.error(`sessions: ${all.length} BTC total, ${sessions.length} in '${split}' split (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    // --balance: the same number of designs in every cell of trigger x thesis x exit, drawn from a larger sample
    // --designs-file frozen.json: replay exactly these designs (id, trig, thes, exit, hor, p) instead of drawing them; used by pre-registrations, which must not depend on the sampler's current categories
    let designs;
    if (arg("designs-file", null)) designs = JSON.parse(fs.readFileSync(arg("designs-file"), "utf8")).map(d => ({ sampler: "frozen", ...d }));
    else {
      designs = generate({ pool: loadPool(), n: args.includes("--balance") ? n * 12 : n, seed, implemented: implemented() }).designs;
      if (args.includes("--balance")) {
        const by = arg("balance-by", "trig,thes,exit").split(","), cellOf = d => by.map(k => d[k]).join(" | "), cells = new Set(designs.map(cellOf)), per = Math.ceil(n / cells.size), cnt = {}, keep = [];
        for (const d of designs) { const c = cellOf(d); cnt[c] = (cnt[c] || 0) + 1; if (cnt[c] <= per) keep.push(d); }
        designs = keep.slice(0, n);
      }
      // --only key=value,...: keep designs with those categories (keys trig, thes, exit, stop, hor). The list is built exactly as without the filter, so a design keeps its id and parameters.
      if (arg("only", null)) { const f = Object.fromEntries(arg("only").split(",").map(x => x.split("="))); designs = designs.filter(d => Object.entries(f).every(([k, v]) => d[k] === v)); }
      if (arg("ids", null)) { const ids = new Set(JSON.parse(fs.readFileSync(arg("ids"), "utf8"))); designs = designs.filter(d => ids.has(d.id)); }      // --ids file.json: a JSON array of design ids (pre-registered lists)
    }
    if (!arg("designs-file", null)) designs = designs.map(x => instantiate(x, seed));
    { const tf = Date.now(); let k = 0; for (const x of sessions) { loadSnaps(x); k++; } console.error(`snapshots ready for ${k} sessions (${((Date.now() - tf) / 1000).toFixed(0)} s)`); }
    const rows = [], tr0 = Date.now(), o = { legacy };
    for (const d of designs) {
      const tr = runDesign(d, sessions, ex, null, o), sm = summarize(tr, seed), nul = [];
      for (let k = 0; k < nullReps; k++) { const t = runDesign(d, sessions, ex, randomizer(seed * 7919 + Number(d.id.slice(1)) * 31 + k), o); if (t.length) nul.push(mean(t.map(x => x.gross))); }
      const better = nul.filter(x => x >= sm.meanGrossBps).length, p = nul.length ? (1 + better) / (1 + nul.length) : null;      // share of random-entry runs at least as good (gross bps), one-sided
      nul.sort((a, b) => a - b);
      rows.push({ id: d.id, sampler: d.sampler, trig: d.trig, thes: d.thes, exit: d.exit, hor: d.hor, p: d.p, ...sm, netBps: Object.fromEntries(costs.map(c => [c, sm.meanGrossBps == null ? null : sm.meanGrossBps - c])), null: nul.length ? { mean: mean(nul), lo: nul[Math.floor(0.05 * (nul.length - 1))], hi: nul[Math.ceil(0.95 * (nul.length - 1))], p } : null });
    }
    console.error(`designs run in ${((Date.now() - tr0) / 1000).toFixed(0)} s`);
    const out = arg("out", null); if (out) fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    console.log(`designs ${rows.length}; trades total ${rows.reduce((a, r) => a + r.n, 0)}; split ${split}; null reps ${nullReps}; latency ${ex.latencyMs} ms${legacy ? "; legacy facts" : ""}`);
    const f = (x, d = 2) => x == null ? "-" : x.toFixed(d);
    const group = (label, keyFn) => {
      const keys = [...new Set(rows.map(keyFn))].sort();
      console.log(`\n${label}:  designs | mean gross bps | gross minus null | null p<=0.05 (chance) | CI above 0 | CI below 0 | best gross`);
      for (const k of keys) {
        const g = rows.filter(r => keyFn(r) === k && r.null); if (!g.length) continue;
        const gross = g.map(r => r.meanGrossBps), ex = g.map(r => r.meanGrossBps - r.null.mean);
        console.log(`  ${k.padEnd(62)} ${String(g.length).padStart(4)} | ${f(mean(gross)).padStart(5)} | ${f(mean(ex)).padStart(5)} | ${String(g.filter(r => r.null.p <= 0.05).length).padStart(3)} (${f(0.05 * g.length, 1)}) | ${String(g.filter(r => r.ciGross && r.ciGross[0] > 0).length).padStart(3)} | ${String(g.filter(r => r.ciGross && r.ciGross[1] < 0).length).padStart(3)} | ${f(Math.max(...gross)).padStart(5)}`);
      }
    };
    group("by trigger", r => r.trig); group("by thesis", r => r.thes); group("by exit", r => r.exit);
    group("by trigger x thesis", r => r.trig + " | " + r.thes); group("by trigger x thesis x exit", r => r.trig + " | " + r.thes + " | " + r.exit);
    console.log("\ntop 8 designs by gross bps:");
    for (const r of rows.slice().sort((a, b) => b.meanGrossBps - a.meanGrossBps).slice(0, 8)) console.log(`${r.id} ${r.thes.slice(0, 5)} ${r.trig.slice(0, 5)} ${JSON.stringify(r.p.trig)} exit ${r.exit.slice(0, 4)} ${JSON.stringify(r.p.exit)} k ${r.p.stop.k} | n ${r.n} gross ${f(r.meanGrossBps)} ci ${r.ciGross ? r.ciGross.map(x => f(x)).join("..") : "-"} | null ${f(r.null && r.null.mean)} p ${f(r.null && r.null.p, 2)}`);
  }
}
