// Parity of the system core (R2): the JS reference (src/js/js-cores/system-core.js, SYSTEM_JS) against the WebAssembly wrapper (src/js/system-core.js, SYSTEM). Called by parity.mjs (`node parity.mjs system`).
// A "dual" system runs every call on both and compares the results (deep, numbers by Object.is, object keys in the same order), and the state() of both after every call that changes one. Inputs:
//  (A) the system:* self-test, run through the dual (every create / step / filled / closed / end / state call of its scenarios);
//  (B) validate / id / create errors on valid and damaged definitions, size on odd numbers;
//  (C) seeded random systems (every trigger, context, region, invalidation and exit) on seeded random snapshot streams, with random fills, cancels, forced signals;
//  (D) the real thing: random systems and the seven default systems on the snapshots of the saved sessions recorded before 2026-11-16T00:00Z (the file NAME decides; a later file is never opened).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// the dual, evaluated in the context of the two versions: returns {create, validate, id, size} that call both
const DUAL = `(() => {
  const diffs = []; let calls = 0;
  const sdiff = (a, b, at) => {
    if (typeof a === "number" || typeof b === "number") return Object.is(a, b) ? null : at + ": " + (Object.is(a, -0) ? "-0" : a) + " vs " + (Object.is(b, -0) ? "-0" : b);
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b ? null : at + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b);
    if (Array.isArray(a) !== Array.isArray(b)) return at + ": array vs object";
    if (Array.isArray(a)) { if (a.length !== b.length) return at + ": length " + a.length + " vs " + b.length; for (let i = 0; i < a.length; i++) { const d = sdiff(a[i], b[i], at + "[" + i + "]"); if (d) return d; } return null; }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join("|") !== kb.join("|")) return at + ": keys [" + ka + "] vs [" + kb + "]";
    for (const k of ka) { const d = sdiff(a[k], b[k], at + "." + k); if (d) return d; }
    return null;
  };
  const tryCall = f => { try { return { v: f() }; } catch (e) { return { e: (e && e.name) || "?", m: String(e && e.message) }; } };
  const cmp = (label, ra, rb) => {
    calls++;
    let d = null;
    if (ra.e || rb.e) d = ra.e && rb.e ? (ra.e === rb.e && ra.m === rb.m ? null : "error " + ra.e + ": " + ra.m + " vs " + rb.e + ": " + rb.m) : "threw only on " + (ra.e ? "js: " + ra.e + " " + ra.m : "wasm: " + rb.e + " " + rb.m);
    else d = sdiff(ra.v, rb.v, "result");
    if (d) diffs.push(label + " " + d);
    return ra;
  };
  const both = (label, fa, fb) => cmp(label, tryCall(fa), tryCall(fb));
  const unwrap = r => { if (r.e) throw new Error(r.m); return r.v; };
  const create = (def, opt, createWasm) => {
    let a, b;
    const ra = tryCall(() => SYSTEM_JS.create(def, opt)), rb = tryCall(() => createWasm(def, opt));
    if (ra.e || rb.e) { cmp("create", ra.e ? ra : { v: 0 }, rb.e ? rb : { v: 0 }); throw new Error((ra.e ? ra : rb).m); }
    a = ra.v; b = rb.v;
    if (a.id !== b.id) diffs.push("create id " + a.id + " vs " + b.id);
    const state = label => both(label + " state", () => a.state(), () => b.state());
    const api = {
      def: a.def, id: a.id,
      step: snap => { const r = both("step", () => a.step(snap), () => b.step(snap)); state("step"); return unwrap(r); },
      force: sig => { both("force", () => a.force(sig), () => b.force(sig)); },
      filled: (px, t) => { const r = both("filled", () => a.filled(px, t), () => b.filled(px, t)); state("filled"); return unwrap(r); },
      cancelled: () => { both("cancelled", () => a.cancelled(), () => b.cancelled()); state("cancelled"); },
      closed: (px, t) => { const r = both("closed", () => a.closed(px, t), () => b.closed(px, t)); state("closed"); return unwrap(r); },
      end: snap => { const r = both("end", () => a.end(snap), () => b.end(snap)); state("end"); return unwrap(r); },
      state: () => unwrap(both("state", () => a.state(), () => b.state())),
      dispose: () => b.dispose(),
    };
    return api;
  };
  const validate = (def, w) => unwrap(both("validate", () => SYSTEM_JS.validate(def), () => w(def)));
  const id = (def, w) => unwrap(both("id", () => SYSTEM_JS.id(def), () => w(def)));
  const size = (e, r, s, p, w) => unwrap(both("size", () => SYSTEM_JS.size(e, r, s, p), () => w(e, r, s, p)));
  return { create, validate, id, size, diffs, get calls() { return calls; }, reset() { diffs.length = 0; calls = 0; } };
})()`;

export function loadSystemContexts(root, wasmBytes) {
  const text = p => fs.readFileSync(path.join(root, "src", p), "utf8");
  const ctx = vm.createContext({ atob, TextEncoder, TextDecoder, __SV_SYNC: true, console, structuredClone });
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name });
  run(text("js/wasm-loader.js").replace("__SV_WASM_B64__", () => wasmBytes.toString("base64")), "wasm-loader.js");
  for (const f of ["reader-episodes", "reader-engine"]) run(text("js/" + f + ".js"), f + ".js");
  const wrapper = text("js/system-core.js");
  run(text("js/js-cores/system-core.js"), "js-cores/system-core.js");
  run(wrapper, "system-core.js");
  // the same wrapper with its calls into the module replaced by calls to the dual (its self-test and facts then run unchanged)
  const patched = wrapper.replace("const SYSTEM = (() => {", "const SYSTEM_DUAL = (() => {")
    .replace('const validate = def => wasm("validate", def);', 'const validate = def => __dual.validate(def, def => wasm("validate", def));')
    .replace('const id = def => wasm("id", def);', 'const id = def => __dual.id(def, def => wasm("id", def));')
    .replace(/const size = \(equity, riskFrac, stopBps, price\) => \{.*\n/,'const size = (e, r, s, p) => __dual.size(e, r, s, p, (e, r, s, p) => SYSTEM.size(e, r, s, p));\n')
    .replace("function create(def, opt) {", "function create(def, opt) { return __dual.create(def, opt, SYSTEM.create); }\n  function create0(def, opt) {");
  if (patched.split("__dual").length < 5) throw new Error("parity-system: the wrapper's text changed, the dual patch no longer applies");
  vm.runInContext("globalThis.__dual = " + DUAL, ctx, { filename: "dual.js" });
  run(patched, "system-core(dual).js");
  return { ctx, run, dual: run("__dual"), SYSTEM_JS: run("SYSTEM_JS"), SYSTEM: run("SYSTEM"), SYSTEM_DUAL: run("SYSTEM_DUAL"), READER: run("READER_ENGINE") };
}

// ---------- seeded random ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FAM = ["absorption", "exhaustion", "burst", "wall"], STATES = ["quiet", "active", "wild"];
const mk = rand => ({
  pick: a => a[Math.floor(rand() * a.length)], chance: p => rand() < p, int: (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1)), num: (lo, hi, d = 2) => +(lo + rand() * (hi - lo)).toFixed(d) + 0,      // + 0: a -0 does not survive the JSON the module takes (see the wrapper), and no real second has one
  subset: a => { const o = a.filter(() => rand() < 0.5); return o.length ? o : [a[Math.floor(rand() * a.length)]]; },
});

// a valid system definition drawn over the whole space; h0: the UTC hour of the stream's start (so an hours context is sometimes on)
function randDef(rand, h0) {
  const r = mk(rand), tt = r.pick(["episode", "priceMove", "premium", "tradeFlow", "bookDepth", "rangeBreak", "levelRejection"]);
  const trg = {
    episode: () => ({ type: "episode", families: r.subset(FAM) }), priceMove: () => ({ type: "priceMove", lookSec: r.int(5, 60), m: r.num(0.5, 3) }),
    premium: () => ({ type: "premium", baseSec: r.int(30, 120), minBps: r.num(0.2, 3), coolSec: r.int(0, 60) }), tradeFlow: () => ({ type: "tradeFlow", lookSec: r.int(5, 30), share: r.num(0.5, 0.95), m: r.num(1, 4) }),
    bookDepth: () => ({ type: "bookDepth", edge: r.pick([5, 20]), thr: r.num(0.2, 0.8), sustainSec: r.int(1, 6), coolSec: r.int(0, 60) }), rangeBreak: () => ({ type: "rangeBreak", brkBps: r.num(0, 2), coolSec: r.int(0, 60) }),
    levelRejection: () => ({ type: "levelRejection", tolBps: r.num(0.1, 2), rejBps: r.num(0.5, 5), lookSec: r.int(5, 30), coolSec: r.int(0, 60) }),
  }[tt]();
  const needsBox = tt === "rangeBreak" || tt === "levelRejection", reading = ["priceMove", "premium", "tradeFlow", "bookDepth"].includes(tt);
  const region = needsBox || r.chance(0.4) ? { type: "rangeBox", windowSec: r.int(20, 200) } : { type: "none" };
  const ctxT = r.pick(["always", "always", "sigmaBand", "hours", "marketState"]);
  const context = ctxT === "always" ? { type: "always" } : ctxT === "sigmaBand" ? { type: "sigmaBand", min: r.num(0, 0.4), max: r.num(0.6, 2) } : ctxT === "hours" ? { type: "hours", hours: [...new Set([r.chance(0.8) ? h0 : r.int(0, 23), r.int(0, 23), r.int(0, 23)])] } : { type: "marketState", states: r.subset(STATES) };
  const invs = ["none", "episodeAgainst"].concat(reading || tt === "rangeBreak" ? ["triggerReverses"] : [], needsBox ? ["region"] : []), inv = r.pick(invs);
  const exits = ["timed", "flowEpisode", "target", "trailing"].concat(region.type === "rangeBox" ? ["rangeLevel"] : [], reading ? ["normalisation"] : []), et = r.pick(exits), hold = r.int(10, 120);
  const exit = { timed: { type: "timed", holdSec: hold }, flowEpisode: { type: "flowEpisode", holdSec: hold, families: r.subset(FAM) }, target: { type: "target", holdSec: hold, tpK: r.num(0.3, 3) },
    trailing: { type: "trailing", holdSec: hold, trailK: r.num(0.3, 3) }, rangeLevel: { type: "rangeLevel", holdSec: hold, frac: r.pick([0.5, 1]) }, normalisation: { type: "normalisation", holdSec: hold } }[et];
  return { name: "r" + r.int(0, 99999), stage: r.pick(["paper", "demo", "live"]), venue: tt === "episode" ? r.pick(["any", "bn", "hl"]) : r.pick(["bn", "hl"]), context, region, trigger: trg,
    thesis: { dir: r.pick(["continuation", "fade"]), text: "t" + r.int(0, 9), invalidation: inv === "none" && r.chance(0.5) ? undefined : { type: inv } }, exit, risk: { stopK: r.num(0.5, 4), riskFrac: r.num(0.005, 0.02, 3) } };
}

// ---------- (C) a synthetic stream of snapshots ----------
function synthSnaps(rand, n, T0) {
  const r = mk(rand), out = []; let bn = 100 + r.num(0, 50), hl = bn * (1 + r.num(-0.0003, 0.0003, 5)), burstUntil = -1, imbUntil = -1, imbV = 0, gapUntil = -1, epN = 0, calib = r.int(0, 60), jump = 0;
  const active = [], sigma = { bn: r.num(0.1, 1.2), hl: r.num(0.1, 1.2) }, stIdx = r.int(0, 2), flowBase = r.num(5, 60);
  let st = r.chance(0.2) ? null : STATES[stIdx];
  for (let i = 0; i < n; i++) {
    if (r.chance(0.01)) { jump = r.pick([-1, 1]) * r.num(2, 30); } else if (jump && r.chance(0.5)) jump = 0;
    bn *= 1 + (rand() - 0.5) * 2e-5 + jump * 1e-4 * (r.chance(0.5) ? 1 : 0); hl = hl * (1 + (rand() - 0.5) * 2e-5) + (bn * (1 + r.num(-0.0004, 0.0004, 5)) - hl) * 0.1;
    if (i > burstUntil && r.chance(0.02)) burstUntil = i + r.int(3, 40);
    if (i > imbUntil && r.chance(0.03)) { imbUntil = i + r.int(2, 25); imbV = r.pick([-1, 1]) * r.num(0.3, 0.9, 3); }
    if (i > gapUntil && r.chance(0.004)) gapUntil = i + r.pick([1, 3, 12, 40]);
    const gap = i <= gapUntil, side = burstUntil >= i ? r.pick([1, 1, 1, -1]) : 0;
    const f = v => ({ buy: side > 0 ? flowBase * r.num(5, 30) : r.num(0, flowBase), sell: side < 0 ? flowBase * r.num(5, 30) : r.num(0, flowBase), liqBuy: r.chance(0.05) ? r.num(0, 50) : 0, liqSell: r.chance(0.05) ? r.num(0, 50) : 0 });
    const t = T0 + i * 1000, nw = [], ended = [];
    if (r.chance(0.04)) { const g = { id: "g" + (++epN), family: r.pick(FAM), venue: r.pick(["bn", "bn", "hl"]), side: r.pick([-1, 1, 1, -1, 0]), tDetected: t - r.int(0, 900) }; nw.push(g); active.push(g); }
    for (let k = active.length - 1; k >= 0; k--) if (r.chance(0.08)) { const g = active.splice(k, 1)[0]; ended.push({ ...g, tEnd: t }); }
    out.push({ t, px: { bn: gap && r.chance(0.7) ? null : +bn.toFixed(3), hl: r.chance(0.02) ? null : +hl.toFixed(3) }, sigma: { bn: sigma.bn * (1 + 0.1 * Math.sin(i / 30)), hl: sigma.hl }, calibrated: i >= calib,
      age: { bn: r.chance(0.03) ? r.pick([null, 5000, 40000]) : r.int(20, 900), hl: r.chance(0.03) ? r.pick([null, 5000]) : r.int(20, 900) }, flow: { bn: f("bn"), hl: f("hl") },
      imb: { bn: { 5: i <= imbUntil ? imbV : r.chance(0.2) ? null : r.num(-0.2, 0.2, 3), 20: r.chance(0.1) ? null : r.num(-0.5, 0.5, 3) }, hl: { 5: r.num(-0.3, 0.3, 3), 20: null } },
      episodes: { new: nw, ended, active: active.map(g => ({ ...g })) }, state: r.chance(0.01) ? (st = r.chance(0.2) ? null : r.pick(STATES)) : st });
    if (r.chance(0.003)) i += r.pick([20, 40]);      // a missing stretch
  }
  return out;
}

// ---------- the driver: step a dual instance through snapshots, fill like a replay does, report what happened ----------
function drive(inst, snaps, rand, o = {}) {
  const r = mk(rand), H = { bn: [], hl: [] }, seen = { enter: 0, skip: 0, exit: 0, invalidate: 0, void: 0, reasons: {}, trades: 0 };
  const priceAt = (v, t, within = 2000) => { const h = H[v]; let lo = 0, hi = h.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 0 && t - h[k][0] <= within ? h[k][1] : null; };
  const handle = (its, snap) => {
    for (const it of its) {
      seen[it.type]++; if (it.reason) seen.reasons[it.reason] = (seen.reasons[it.reason] || 0) + 1; if (it.void) seen.void++;
      if (it.type === "enter") {
        const tIn = it.tSig + 1000, px = priceAt(it.venue, tIn);
        if (px == null || r.chance(0.05)) { inst.cancelled(); continue; }
        handle(inst.filled(px, tIn), snap);
      } else if (it.type === "exit" || it.type === "invalidate") {
        if (it.void) continue;
        const px = it.px != null ? it.px : priceAt(it.venue, it.tAt, 1e12);
        if (px != null && r.chance(0.95)) { const tr = inst.closed(px, it.tAt); if (tr) seen.trades++; }
      }
    }
  };
  let i = 0;
  for (const s of snaps) {
    for (const v of ["bn", "hl"]) if (s.px[v] != null) H[v].push([s.t, s.px[v]]);
    if (o.force && r.chance(o.force)) inst.force({ t: s.t - r.int(0, 3) * 1000, side: r.pick([-1, 1]), venue: r.chance(0.3) ? r.pick(["bn", "hl"]) : undefined });
    handle(inst.step(s), s);
    if (r.chance(0.002)) inst.cancelled();      // a stray cancel
    if (r.chance(0.002)) inst.closed(s.px.bn || 1, s.t);      // a stray close
    if (r.chance(0.003)) handle(inst.end(s), s);
    i++;
  }
  handle(inst.end(snaps[snaps.length - 1]), snaps[snaps.length - 1]);
  return seen;
}

const addSeen = (a, b) => { for (const k of ["enter", "skip", "exit", "invalidate", "void", "trades"]) a[k] = (a[k] || 0) + b[k]; a.reasons ||= {}; for (const [k, v] of Object.entries(b.reasons)) a.reasons[k] = (a.reasons[k] || 0) + v; return a; };

export async function system(root, wasmBytes, st, cases, seed, opts = {}) {
  const { ctx, run, dual, SYSTEM_JS, SYSTEM, SYSTEM_DUAL, READER } = loadSystemContexts(root, wasmBytes);
  const report = (label, count, extra = "") => { const diffs = dual.diffs.slice(); st.report(label + extra, count, diffs); dual.reset(); };
  const clone = x => structuredClone(x);
  const onlyReal = opts.only === "real";
  // (A) the self-test, run through the dual
  if (!onlyReal) { const a = SYSTEM_JS.selftest(READER), b = SYSTEM_DUAL.selftest(READER), w = SYSTEM.selftest(READER), bad = [];
    a.forEach((x, i) => { if (!x.ok || !b[i].ok || !w[i].ok || x.name !== b[i].name) bad.push(`${x.name}: js ok=${x.ok}, dual ok=${b[i].ok}, wasm ok=${w[i].ok}`); });
    if (a.length !== b.length || a.length !== w.length) bad.push(`scenario count ${a.length} / ${b.length} / ${w.length}`);
    const calls = dual.calls; st.report(`system self-test (${a.length} scenarios on JS, WASM and through the dual: ${calls} calls compared)`, calls, bad.concat(dual.diffs)); dual.reset(); }
  // (B) validate, id, create errors, size
  if (!onlyReal) { const rand = rng(seed * 7919), r = mk(rand), BATCH = 250, junk = () => r.pick([null, "x", "", -1, 0, 1, 1e9, -0, true, false, [], {}, [1, 2], { type: "x" }, "bn", "hl", 5, 20, 0.5, 23, 24]);
    const damage = d => { d = clone(d); const n = r.int(1, 3); for (let k = 0; k < n; k++) { let o = d, path = []; while (o && typeof o === "object") { const keys = Object.keys(o); if (!keys.length || (path.length && r.chance(0.35))) break; const key = r.pick(keys); path.push([o, key]); o = o[key]; }
        if (!path.length) continue; const [par, key] = path[path.length - 1]; if (r.chance(0.4)) { if (Array.isArray(par)) par.splice(+key, 1); else delete par[key]; } else par[key] = junk(); /* (a hole in an array is not JSON: JSON.stringify prints it as null while Array#every skips it) */ } return d; };
    for (let from = 0; from < cases; from += BATCH) {
      const n = Math.min(BATCH, cases - from); let created = 0;
      for (let i = 0; i < n; i++) {
        const d0 = randDef(rand, r.int(0, 23)), d = r.chance(0.7) ? damage(d0) : d0, before = dual.diffs.length;
        SYSTEM_DUAL.validate(d); SYSTEM_DUAL.id(d);
        try { SYSTEM_DUAL.create(d, r.chance(0.3) ? { latencyMs: r.pick([0, 1000, null]), staleMs: r.pick([3000, 500, null]), maxGapMs: r.pick([30000, 5000]), minRoomBps: r.pick([0.2, 0, 3]) } : undefined); created++; } catch (e) { /* the same error on both, checked */ }
        if (dual.diffs.length > before) dual.diffs[dual.diffs.length - 1] += "  def=" + JSON.stringify(d);
      }
      for (const v of [null, undefined, 5, "x", [], {}, [1]]) { SYSTEM_DUAL.validate(v); }
      report(`system validate / id / create #${from}-${from + n - 1} (seed ${seed}, ${created} created, the rest refused with the same message)`, n);
    }
    const odd = [0, 1, -1, 0.01, 1e4, 1e-9, NaN, Infinity, -Infinity, null, undefined, "5", "x", -0, 1e300, 5, 50000, 10000, 0.0005], rs = rng(seed * 31);
    for (let i = 0; i < 400; i++) { const p = () => odd[Math.floor(rs() * odd.length)]; SYSTEM_DUAL.size(p(), p(), p(), p()); }
    report("system size on odd numbers (NaN, Infinity, -0, null, undefined, strings)", 400); }
  // (C) seeded random systems on seeded random streams
  const total = {};
  if (!onlyReal) { const rand = rng(seed * 104729), r = mk(rand), nSys = Math.min(cases, 400), BATCH = 50;
    for (let from = 0; from < nSys; from += BATCH) {
      const n = Math.min(BATCH, nSys - from), seen = {};
      for (let i = 0; i < n; i++) {
        const T0 = 1.7e12 + r.int(0, 23) * 3600000 + r.int(0, 3599) * 1000, h0 = new Date(T0).getUTCHours(), def = randDef(rand, h0), snaps = synthSnaps(rand, r.int(400, 1500), T0);
        const mode = r.pick(["plain", "plain", "plain", "forced", "signals"]); let opt = r.chance(0.5) ? undefined : { latencyMs: r.pick([0, 1000]), maxGapMs: r.pick([30000, 8000]), staleMs: r.pick([3000, 1000, 600]), minRoomBps: r.pick([0.2, 0, 2]), flowWindowSec: r.pick([1800, 120]), minFlowReadings: r.pick([30, 5, 0]) };
        if (mode === "forced") opt = Object.assign({}, opt, { forced: true });
        if (mode === "signals") opt = Object.assign({}, opt, { signals: Array.from({ length: r.int(0, 25) }, () => ({ t: T0 + r.int(0, 1400) * 1000, side: r.pick([-1, 1]), venue: r.chance(0.3) ? r.pick(["bn", "hl"]) : undefined })) });
        let inst; try { inst = SYSTEM_DUAL.create(def, opt); } catch (e) { dual.diffs.push("create of a valid system failed: " + e.message + " " + JSON.stringify(def)); continue; }
        addSeen(seen, drive(inst, snaps, rand, { force: mode === "forced" ? 0.05 : 0 })); inst.dispose();
      }
      addSeen(total, seen);
      report(`system random systems #${from}-${from + n - 1} on random streams (seed ${seed}; enter ${seen.enter}, skip ${seen.skip}, exit ${seen.exit}, invalidate ${seen.invalidate}, void ${seen.void}, trades ${seen.trades})`, n);
    }
    console.log("coverage of the random runs: " + JSON.stringify(total)); }
  // (D) real recordings before 2026-11-16: the snapshots the harness cached (or makes from the session file, which is read only if its NAME is before the cut)
  const CUT = "202611160000", dir = path.join(root, "sessions"), snapDir = path.join(root, ".scratch", "trade-system", "cache-snap");
  if (fs.existsSync(dir)) {
    const H = await import("../design-harness.mjs"), defaults = H.SYSTEMS_DEFAULT;
    const names = fs.readdirSync(dir).filter(f => /^session_.*\.json\.gz$/.test(f)).filter(f => { const m = f.match(/_(\d{12})/); return m && m[1] < CUT; }).sort();
    const cached = names.filter(f => fs.existsSync(path.join(snapDir, f + ".json"))), files = (opts.allSessions ? names : cached).slice(0, opts.limit || Infinity);
    console.log(`real recordings: ${names.length} session files are before 2026-11-16, ${cached.length} have cached snapshots; using ${files.length}${opts.allSessions ? "" : " (--all-sessions also builds the rest)"}; the later ones are not opened`);
    const rand = rng(seed * 15485863), r = mk(rand), perSession = opts.designs ?? 24; let nf = 0, steps = 0, nsys = 0, jsMs = 0, wasmMs = 0; const seenAll = {}, t0 = Date.now(), badAll = [];
    for (const f of files) {
      nf++;
      const s = H.loadSnaps({ file: f, dir, size: fs.statSync(path.join(dir, f)).size }), snaps = s.snaps;
      if (!snaps.length) { console.log(`  ${nf}/${files.length} ${f}: no snapshots`); continue; }
      const h0 = new Date(snaps[0].t).getUTCHours(), defs = defaults.map(d => ({ d, mode: "plain" })).concat(Array.from({ length: perSession }, (_, i) => ({ d: randDef(rand, h0), mode: i % 6 === 5 ? "forced" : i % 6 === 4 ? "signals" : "plain" })));
      const seen = {}; let sysN = 0;
      for (const { d, mode } of defs) {
        let opt = r.chance(0.5) ? undefined : { latencyMs: 1000, maxGapMs: 30000 };
        if (mode === "forced") opt = Object.assign({}, opt, { forced: true });
        if (mode === "signals") opt = Object.assign({}, opt, { signals: Array.from({ length: r.int(0, 40) }, () => ({ t: snaps[0].t + r.int(0, snaps.length - 1) * 1000, side: r.pick([-1, 1]), venue: r.pick(["bn", "hl"]) })) });
        let inst; try { inst = SYSTEM_DUAL.create(d, opt); } catch (e) { dual.diffs.push(`create failed on ${f}: ${e.message}`); continue; }
        addSeen(seen, drive(inst, snaps, rand, { force: mode === "forced" ? 0.01 : 0 })); inst.dispose(); sysN++;
      }
      addSeen(seenAll, seen); steps += snaps.length * sysN; nsys += sysN;
      const diffs = dual.diffs.slice(); dual.reset(); badAll.push(...diffs.map(x => f + ": " + x));
      console.log(`  ${nf}/${files.length} ${f}: ${snaps.length} snapshots x ${sysN} systems, enter ${seen.enter}, exit ${seen.exit}, invalidate ${seen.invalidate}, skip ${seen.skip}, trades ${seen.trades}, ${diffs.length ? "DIFF" : "same"}`);
      for (const d of diffs.slice(0, 3)) console.log("      " + d.slice(0, 700));
    }
    st.report(`real recordings before 2026-11-16 (${files.length} sessions, ${nsys} systems, ${steps} system-seconds, every intent and every state compared)`, steps, badAll);
    console.log("coverage of the real runs: " + JSON.stringify(seenAll) + ` (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } else console.log("skip  real recordings: sessions/ not found");
}
export { randDef, drive, rng, mk, synthSnaps };
