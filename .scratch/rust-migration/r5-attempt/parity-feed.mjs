// Parity of the R5 cores: market-core.js (MARKET), chunk-core.js (CHUNK) and micro-core.js (MICRO). Called by parity.mjs (`node parity.mjs market|chunk|micro|bench`).
// MARKET and CHUNK: the JS reference (src/js/js-cores/market-core.js, chunk-core.js: MARKET_JS, CHUNK_JS) against the WebAssembly wrappers. MICRO stayed JS whole (it is on the per-input path and its
// book arguments are too big to send as JSON), so `micro` only runs its self-test; `bench` prints the per-second cost table that the decision rests on.
// Inputs: (A) both self-tests, result lists compared; (B) seeded random calls of every function that moved (midRow, check, fileName, leftRunning), results compared with keys in the same ORDER and
// numbers by Object.is after the JS result is made JSON-like (as everything out of the module is); (C) real recordings from BEFORE 2026-11-16T00:00Z (the file NAME decides; a later file is never opened):
// every chunk file name and every run's check, and a replay of one recorded run (inputs fed through CHUNK_JS.pipeline and CHUNK.pipeline with a stub facts accumulator): identical chunk cuts and
// identical chunk file bytes (JSON.stringify of each chunk) on both, equal to the chunks as recorded (counts, first and last input of each).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";

const CUT = "202611160000";      // file names stamped from here on belong to the registered study's test set and are never opened
const norm = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === undefined) return undefined;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(x => { const n = norm(x); return n === undefined ? null : n; });
  const o = {}; for (const k of Object.keys(v)) { const n = norm(v[k]); if (n !== undefined) o[k] = n; } return o;
};
const sdiff = (a, b, at = "") => {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b) ? null : at + ": " + (Object.is(a, -0) ? "-0" : a) + " vs " + (Object.is(b, -0) ? "-0" : b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b ? null : at + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b);
  if (Array.isArray(a) !== Array.isArray(b)) return at + ": array vs object";
  if (Array.isArray(a)) { if (a.length !== b.length) return at + ": length " + a.length + " vs " + b.length; for (let i = 0; i < a.length; i++) { const d = sdiff(a[i], b[i], at + "[" + i + "]"); if (d) return d; } return null; }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("\u0001") !== kb.join("\u0001")) return at + ": keys [" + ka + "] vs [" + kb + "]";
  for (const k of ka) { const d = sdiff(a[k], b[k], at + "." + k); if (d) return d; }
  return null;
};
const tryCall = f => { try { return { v: f() }; } catch (e) { return { e: (e && e.name) || "?", m: String(e && e.message) }; } };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function loadFeed(root, wasmBytes) {
  const ctx = vm.createContext({ atob, TextEncoder, TextDecoder, __SV_SYNC: true, console, structuredClone });
  const text = p => fs.readFileSync(path.join(root, "src", p), "utf8"), run = (code, name) => vm.runInContext(code, ctx, { filename: name });
  run(text("js/wasm-loader.js").replace("__SV_WASM_B64__", () => wasmBytes.toString("base64")), "wasm-loader.js");
  for (const f of ["reader-episodes", "reader-engine", "system-core", "systems-default", "runner-core"]) run(text("js/" + f + ".js"), f + ".js");
  run(text("js/js-cores/chunk-core.js"), "js-cores/chunk-core.js"); run(text("js/chunk-core.js"), "chunk-core.js");
  run(text("js/js-cores/market-core.js"), "js-cores/market-core.js"); run(text("js/market-core.js"), "market-core.js");
  run(text("js/micro-core.js"), "micro-core.js");
  return { ctx, run, MARKET_JS: run("MARKET_JS"), MARKET: run("MARKET"), CHUNK_JS: run("CHUNK_JS"), CHUNK: run("CHUNK"), MICRO: run("MICRO") };
}

// recorded chunk files of the registered cut (names only decide)
function sessionFiles(root) {
  const dir = path.join(root, "sessions");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^session_.*_run\d+-c\d+\.json(\.gz)?$/.test(n) && (n.match(/_(\d{12})_run/) || [])[1] < CUT).sort() : [];
}
const readChunk = f => { let b = fs.readFileSync(f); if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); return JSON.parse(b.toString("utf8")); };

export async function feed(root, wasmBytes, st, N, SEED, opts) {
  const which = opts.which, X = loadFeed(root, wasmBytes), rand = rng(SEED);
  const pick = a => a[Math.floor(rand() * a.length)], int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const compare = (label, count, cases) => {
    const diffs = [];
    for (const c of cases) { const a = tryCall(c.js), b = tryCall(c.wasm); let d = null;
      if (a.e || b.e) d = a.e && b.e ? (a.e === b.e && a.m === b.m ? null : `threw ${a.e}: ${a.m} vs ${b.e}: ${b.m}`) : a.e ? `js threw ${a.e}: ${a.m}` : `wasm threw ${b.e}: ${b.m}`;
      else d = sdiff(norm(a.v), norm(b.v));
      if (d) diffs.push(c.what + " -> " + d); }
    st.report(label, count, diffs);
  };

  // ---------- micro: unchanged JS
  if (which === "micro" || which === "all") {
    const r = X.MICRO.selftest(), bad = r.filter(x => !x.ok);
    st.report(`micro: stays JS whole (see bench); its ${r.length} self-test scenarios run on the page's file`, r.length, bad.map(x => x.name + ": " + x.detail));
  }
  if (which === "micro") return;

  // ---------- market
  if (which === "market" || which === "all") {
    const a = X.MARKET_JS.selftest(), b = X.MARKET.selftest();
    st.report("market: self-test results of both versions (names, ok, detail)", a.length, sdiff(a, b) ? [sdiff(a, b)] : b.filter(x => !x.ok).map(x => x.name));
    const px = () => pick([null, undefined, 0, NaN, -1, 1, 100, 100.5, 65000.1 + rand(), 1e-7, 1e15, Infinity, "12", true, 12345.678901234567 * rand()]);
    const cases = [];
    for (let i = 0; i < N * 20; i++) {
      const realistic = rand() < 0.5, M = realistic ? { bnBid: 65000 + rand(), bnAsk: 65001 + rand(), hlBid: rand() < 0.2 ? null : 65000 + rand(), hlAsk: rand() < 0.2 ? null : 65001 + rand() } : { bnBid: px(), bnAsk: px(), hlBid: px(), hlAsk: px() };
      if (!realistic && rand() < 0.3) delete M[pick(Object.keys(M))];
      if (!realistic) for (const k of Object.keys(M)) if (typeof M[k] === "string" || typeof M[k] === "boolean" || M[k] === Infinity) M[k] = rand() < 0.5 ? 100 : null;      // edge: see the header of market-core.js
      const t = pick([0, 1, 1.7e12 + int(0, 1e6), 1.7e12 + rand()]);
      cases.push({ what: JSON.stringify(M) + " t=" + t, js: () => X.MARKET_JS.midRow(M, t), wasm: () => X.MARKET.midRow(M, t) });
    }
    compare("market: midRow on random quotes (null, 0, NaN, missing, one venue, large and tiny)", cases.length, cases);
    const fn = [];
    for (let i = 0; i < N; i++) {
      const M = { bnBid: 100 + rand(), bnAsk: 101 + rand() }; const cv = { bn: rand() * 1e6 - 5e5, hl: rand() * 1e6 - 5e5 };
      const tr = { t: int(1, 1e9), v: pick(["bn", "hl"]), side: pick(["buy", "sell"]), ntl: rand() * 1e5, liq: rand() < 0.1, bf: rand() < 0.1 };
      fn.push({ what: "kept-JS functions are the same code", js: () => [X.MARKET_JS.stampMid({ ...tr }, M), X.MARKET_JS.bumpCvd({ ...cv }, tr), X.MARKET_JS.cvdRow(cv, 5), X.MARKET_JS.freshQuotes()], wasm: () => [X.MARKET.stampMid({ ...tr }, M), X.MARKET.bumpCvd({ ...cv }, tr), X.MARKET.cvdRow(cv, 5), X.MARKET.freshQuotes()] });
    }
    compare("market: stampMid, bumpCvd, cvdRow, freshQuotes (JS in both; guards the shared code)", fn.length, fn);
    const kept = ["KEEP", "MID_MS", "CVD_MS"].filter(k => X.MARKET[k] !== X.MARKET_JS[k]);
    st.report("market: constants", 3, kept.map(k => k + " differs"));
  }

  // ---------- chunk
  if (which === "chunk" || which === "all") {
    const a = X.CHUNK_JS.selftest(), b = X.CHUNK.selftest();
    st.report("chunk: self-test results of both versions (names, ok, detail)", a.length, sdiff(a, b) ? [sdiff(a, b)] : b.filter(x => !x.ok).map(x => x.name));
    const cases = [];
    // check
    for (let i = 0; i < N * 4; i++) {
      const n = int(0, 12), base = pick([0, 0, 1, 5, -2, 3.5]), cs = []; let s = base;
      for (let k = 0; k < n; k++) { s += pick([1, 1, 1, 2, 3, 0, 7]); cs.push({ seq: s }); }
      cs.sort(() => rand() - 0.5);
      cases.push({ what: "check " + JSON.stringify(cs.map(c => c.seq)), js: () => X.CHUNK_JS.check(cs), wasm: () => X.CHUNK.check(cs) });
    }
    // fileName
    const syms = ["BTC", "ETH", "", undefined, null, "BT C/US-D_T", "bTc_1", "ÅBC", "a.b", "😀x", "X", 0, "A".repeat(40), "-_-"];
    for (let i = 0; i < N * 4; i++) {
      const c = { sym: pick(syms), startedAt: pick([undefined, 0, null, NaN, 1.7e12 + int(0, 1e10), 1.7e12 + rand(), -1e12, 8.64e15, 8.64e15 + 1, 253402300800000, 3e13, 1e11 * rand()]), run: pick(["20261112130503", 20261112130503, "r1", "", undefined, "a b"]), seq: pick([0, 1, 12, 123, 1234, 99999, "7", "x", -3, 1.5, undefined]) };
      const gz = pick([true, false, undefined, 1, 0]);
      cases.push({ what: "fileName " + JSON.stringify(c) + " " + gz, js: () => X.CHUNK_JS.fileName(c, gz), wasm: () => X.CHUNK.fileName(c, gz) });
    }
    // leftRunning
    for (let i = 0; i < N * 6; i++) {
      const env = {};
      const set = (k, v) => { if (rand() < 0.9) env[k] = v; };
      set("connected", pick([true, false, true, 0, 1, undefined])); set("recOn", pick([true, false, true]));
      set("folder", pick([null, undefined, { supported: false }, { supported: true, state: "ok", name: pick(["sessions", "", undefined, 5]) }, { supported: true, state: "none" }, { supported: true, state: "denied" }, { supported: true, state: "failed" }, { supported: true, state: pick([undefined, "weird"]) }]));
      set("disk", pick([null, { tone: "ok", text: "40 GB" }, { tone: "warn", text: "9 GB" }, { tone: "bad", text: "1 GB" }, { tone: "info", text: "é" }]));
      set("battery", pick([null, { charging: true, level: 1 }, { charging: false, level: rand() }, { charging: false, level: 0.5 }, { charging: false, level: 0.495 }, { charging: false, level: 0.005 }, { charging: false, level: 0.4949999 }, { charging: true, level: 0.2 }]));
      set("wakeApi", pick([true, false, undefined])); set("wake", pick([true, false, undefined]));
      set("newer", pick([null, "v200", undefined, ""])); set("persisted", pick([true, false, undefined]));
      cases.push({ what: "leftRunning " + JSON.stringify(env), js: () => X.CHUNK_JS.leftRunning(env), wasm: () => X.CHUNK.leftRunning(env) });
    }
    compare("chunk: check, fileName (incl. invalid and out-of-range dates, odd symbols) and leftRunning on random inputs", cases.length, cases);

    // real recordings
    const files = sessionFiles(root);
    if (opts.only === "synthetic" || !files.length) { console.log("chunk: no saved sessions before 2026-11-16 used"); }
    else {
      const byRun = {}; for (const n of files) { const run = n.match(/_run(\d+)-c/)[1]; (byRun[run] = byRun[run] || []).push(n); }
      const runs = Object.keys(byRun), names = files;
      // the file name of every recorded chunk: read its header fields (kind, sym, startedAt, run, seq) and check that both versions rebuild the stored name's pattern identically
      let k = 0; const nameCases = [];
      for (const n of names) {
        const lim = opts.limit ? opts.limit : 0; if (lim && k++ >= lim) break;
        const c = readChunk(path.join(root, "sessions", n)); c.inputs = undefined; c.rows = undefined; c.exec = undefined; c.ext = undefined;
        const gz = n.endsWith(".gz");
        nameCases.push({ what: n, js: () => X.CHUNK_JS.fileName(c, gz), wasm: () => X.CHUNK.fileName(c, gz) });
        console.log(`  name check ${n}: ${X.CHUNK.fileName(c, gz)}`);
      }
      compare(`chunk: fileName of ${nameCases.length} recorded chunk files before 2026-11-16`, nameCases.length, nameCases);
      const chk = runs.map(run => { const cs = byRun[run].map(n => ({ seq: +n.match(/-c(\d+)/)[1] })); return { what: "check run " + run, js: () => X.CHUNK_JS.check(cs), wasm: () => X.CHUNK.check(cs) }; });
      compare(`chunk: check on the ${runs.length} recorded runs`, chk.length, chk);

      // replay of recorded runs: cuts and chunk bytes
      const want = (opts.run ? [opts.run] : runs).filter(r => byRun[r]);      // default: every recorded run before the cut
      for (const run of want) {
        const chunks = byRun[run].map(n => readChunk(path.join(root, "sessions", n))).sort((a, b) => a.seq - b.seq), inputs = [].concat(...chunks.map(c => c.inputs));
        const make = CH => {
          const got = [], F = { feed: () => [], reset() {} }, p = CH.pipeline({ facts: F, onChunk: c => got.push(c) }), c0 = chunks[0];
          p.reset(); p.begin({ id: c0.run, sym: c0.sym, startedAt: c0.startedAt, runner: c0.runner, engineCfg: c0.engineCfg, lateMs: c0.lateMs });
          for (const r of inputs) p.input(r);
          const last = chunks[chunks.length - 1]; p.end(last.final, last.why); return got;
        };
        const jsC = make(X.CHUNK_JS), wC = make(X.CHUNK);
        const diffs = [];
        if (jsC.length !== wC.length) diffs.push(`chunk count ${jsC.length} vs ${wC.length}`);
        for (let i = 0; i < Math.min(jsC.length, wC.length); i++) {
          const a = JSON.stringify(jsC[i]), b = JSON.stringify(wC[i]); if (a !== b) diffs.push(`chunk ${i}: bytes differ (${a.length} vs ${b.length})`);
          if (X.CHUNK_JS.fileName(jsC[i], true) !== X.CHUNK.fileName(wC[i], true)) diffs.push(`chunk ${i}: file name`);
        }
        // against the recording itself: the same cuts (the first and last input of each and the count; startedAt and run as recorded)
        if (wC.length !== chunks.length) diffs.push(`recorded ${chunks.length} chunks, replay ${wC.length}`);
        else wC.forEach((c, i) => { const s = chunks[i]; if (c.inputs.length !== s.inputs.length || JSON.stringify(c.inputs[0]) !== JSON.stringify(s.inputs[0]) || JSON.stringify(c.inputs[c.inputs.length - 1]) !== JSON.stringify(s.inputs[s.inputs.length - 1]) || c.t0 !== s.t0 || c.t1 !== s.t1) diffs.push(`chunk ${i}: cut differs from the recording (${c.inputs.length} vs ${s.inputs.length} inputs)`); });
        console.log(`  run ${run}: ${inputs.length} inputs -> ${wC.length} chunks (${wC.map(c => c.inputs.length).join(", ")} inputs)`);
        st.report(`chunk: run ${run} replayed through the pipeline of both versions: cuts, chunk bytes and file names equal, and equal to the recording`, inputs.length, diffs);
      }
    }
  }
}

// ---------- bench: the per-second cost table on a real recorded run (before 2026-11-16)
export async function bench(root, wasmBytes, opts) {
  const X = loadFeed(root, wasmBytes), files = sessionFiles(root), run = opts.run || "20261112130503", n = files.find(f => f.includes("run" + run + "-c000"));
  if (!n) { console.log("bench: run " + run + " is not in sessions/"); return; }
  const c = readChunk(path.join(root, "sessions", n)), inputs = c.inputs, secs = (c.t1 - c.t0) / 1000;
  const kinds = {}; for (const r of inputs) kinds[r[0]] = (kinds[r[0]] || 0) + 1;
  const bnTrades = inputs.filter(r => r[0] === "t" && r[1] && r[1].v === "bn").length;
  const rate = k => (kinds[k] || 0) / secs;
  console.log(`bench on ${n}: ${secs.toFixed(0)} s, inputs/s: ${Object.entries(kinds).map(([k, v]) => k + " " + (v / secs).toFixed(1)).join(", ")}; Binance trades/s ${(bnTrades / secs).toFixed(1)}`);
  const time = (f, N) => { for (let i = 0; i < Math.min(N, 200); i++) f(i); const t = process.hrtime.bigint(); for (let i = 0; i < N; i++) f(i); return Number(process.hrtime.bigint() - t) / N / 1000; };      // microseconds per call
  const call = X.run("(name, o) => SVWASM.call(name, o)");
  const M = { bnBid: 65000, bnAsk: 65000.1, bnBidSz: 1.2, bnAskSz: 2.3, hlBid: 64999.5, hlAsk: 65000.5, hlBidSz: 1, hlAskSz: 1 };
  // a realistic depth book (Binance @depth: about 1000 levels as a Map of price text -> size), a Hyperliquid book of 20 levels a side
  const bids = new Map(), asks = new Map(); for (let i = 0; i < 500; i++) { bids.set((65000 - i * 0.1).toFixed(1), Math.random() * 5); asks.set((65000.1 + i * 0.1).toFixed(1), Math.random() * 5); }
  const bn = { ready: true, bids, asks }, hl = [Array.from({ length: 20 }, (_, i) => ({ px: "" + (64999 - i), sz: "" + Math.random() })), Array.from({ length: 20 }, (_, i) => ({ px: "" + (65001 + i), sz: "" + Math.random() }))];
  const tr = { t: 1, v: "bn", side: "buy", px: 65000, q: 1, ntl: 65000, liq: false, bf: false }, cvd = { bn: 0, hl: 0 };
  const mi = X.MICRO.create({}), mi2 = X.MICRO.create({});
  const rows = [];
  const add = (name, perSec, js, wasmPath, note) => rows.push({ name, perSec, js, wasmPath, note });
  // per second: the rate comes from the recording
  const midJs = time(() => X.MARKET_JS.midRow(M, 5), 20000), midW = time(() => X.MARKET.midRow(M, 5), 20000);
  add("MARKET.midRow (ported)", 4, midJs, midW, "250 ms timer");
  const cvdJs = time(() => X.MARKET_JS.cvdRow(cvd, 5), 20000);
  add("MARKET.cvdRow (kept JS: no logic)", 2, cvdJs, call("feed_mid_row", { bb: 1, ba: 2, hb: 1, ha: 2 }) && time(() => call("feed_mid_row", { bb: 1, ba: 2, hb: 1, ha: 2 }), 20000), "500 ms timer; a call would carry the same boundary floor as midRow");
  const stJs = time(() => { X.MARKET_JS.stampMid({ ...tr }, M); X.MARKET_JS.bumpCvd(cvd, tr); }, 100000), stW = time(() => call("feed_mid_row", { bb: M.bnBid, ba: M.bnAsk, hb: 1, ha: 2 }), 20000);
  add("MARKET.stampMid + bumpCvd (kept JS)", (kinds.t || 0) / secs, stJs, stW, "per trade; a wasm call would also have to hand the trade object back");
  const inJs = time(i => { const p = X.CHUNK_JS.pipeline({ facts: { feed: () => [], reset() {} }, onChunk() {} }); p.reset(); p.begin({ id: "r", sym: "B", startedAt: 1, runner: { on: false } }); for (let k = 0; k < 1000; k++) p.input(inputs[(i * 1000 + k) % inputs.length]); }, 30) / 1000;
  add("CHUNK.pipeline.input (kept JS; facts stubbed)", inputs.length / secs, inJs, call("feed_mid_row", { bb: 1, ba: 2, hb: 1, ha: 2 }) && time(() => call("feed_mid_row", { bb: 1, ba: 2, hb: 1, ha: 2 }), 20000), "every input; a wasm call per input is the boundary floor, plus the recorded array stays in JS");
  add("CHUNK.fileName (ported)", 1 / 1800, time(() => X.CHUNK_JS.fileName(c, true), 5000), time(() => X.CHUNK.fileName(c, true), 5000), "once per chunk");
  const env = { connected: true, recOn: true, folder: { supported: true, state: "ok", name: "sessions" }, disk: { tone: "ok", text: "40 GB" }, battery: { charging: true, level: 1 }, wakeApi: true, wake: true, newer: null, persisted: true };
  add("CHUNK.leftRunning (ported)", 0.5, time(() => X.CHUNK_JS.leftRunning(env), 20000), time(() => X.CHUNK.leftRunning(env), 20000), "2 s timer");
  add("MICRO.sample (kept JS)", 4, time(i => { mi.sample(i, bn, hl, M); if (mi.hist.length > 400) mi.reset(); }, 3000), time(() => { call("sq_of", { kinds: "q", times: [1], pad: { b: [...bids], a: [...asks], hl, M } }); }, 500), "250 ms timer; wasm figure = the two books as JSON and a call that only skips them (the floor: the real parse, sort, heat and the result come on top)");
  add("MICRO.bnTopN(30) for the Reader (kept JS)", 4, time(() => X.MICRO.bnTopN(bn, 30), 5000), time(() => { call("sq_of", { kinds: "q", times: [1], pad: { b: [...bids], a: [...asks] } }); }, 500), "at most once per 250 ms per venue (rdBook); wasm figure = the book as JSON and a call that only skips it");
  add("MICRO.bnSweepFeed (kept JS)", bnTrades / secs, time(i => { mi2.bnSweepFeed({ t: Math.floor(i / 3), side: "buy", px: 65000 + (i % 3), q: 1, ntl: 65000 }); if (mi2.sweeps.length > 250) mi2.reset(); }, 100000), time(() => call("feed_mid_row", { bb: 1, ba: 2, hb: 1, ha: 2 }), 20000), "per Binance trade");
  console.log("\nfunction".padEnd(48) + "calls/s".padStart(9) + "JS us".padStart(10) + "WASM us".padStart(10) + "JS us/s".padStart(10) + "WASM us/s".padStart(11));
  for (const r of rows) console.log(r.name.padEnd(47) + " " + r.perSec.toFixed(r.perSec < 1 ? 4 : 1).padStart(8) + r.js.toFixed(2).padStart(10) + r.wasmPath.toFixed(2).padStart(10) + (r.js * r.perSec).toFixed(1).padStart(10) + (r.wasmPath * r.perSec).toFixed(1).padStart(11) + "   " + r.note);
}
