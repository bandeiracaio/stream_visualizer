// Parity of the execution core (R4): the JS reference (src/js/js-cores/exec-core.js, EXEC_JS) against the WebAssembly wrapper (src/js/exec-core.js, EXEC). Called by parity.mjs (`node parity.mjs exec`).
// No network is ever used: the exchange is a fake one in this file (and in the self-test). Inputs:
//  (A) the exec:* self-test on both versions, every call it makes on a machine recorded (arguments, result, then state / snapshot / faults / debug / drain) and the two records compared;
//  (B) the guard: isDemoBase and `allowed` on every look-alike we could think of, on values that are not strings, and on thousands of mutated hosts; a machine that is not allowed must produce no request on either side;
//  (C) seeded random event sequences against a random fake exchange (rows, answers incl. errors / timeouts / unknown / late, ticks, polls with the exchange changing under the page, kill switch, faults, restarts with saved state):
//      after every call the return value, the drained requests / rows / faults and state / snapshot / faults / debug of both machines are compared;
//  (D) real journals: the rows of sessions/trader-journal_check4.json and of the paper runner (RUNNER) on the cached snapshots of saved recordings from BEFORE 2026-11-16T00:00Z (the file NAME decides; a later file is never opened),
//      turned into demo-stage rows and driven through both machines; then EXEC.merge on the real trade rows with mirror rows made from them.
// Comparison: numbers by Object.is, keys in the same ORDER; the JS side is first made JSON-like (NaN / Infinity become null, undefined properties are dropped), as everything out of the module is.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { rng, mk } from "./parity-system.mjs";
import { loadRunnerContexts } from "./parity-runner.mjs";

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
const clone = x => x === undefined ? undefined : structuredClone(x);

export function loadExecContexts(root, wasmBytes) {
  const ctx = vm.createContext({ atob, TextEncoder, TextDecoder, __SV_SYNC: true, console, structuredClone });
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name }), text = p => fs.readFileSync(path.join(root, "src", p), "utf8");
  run(text("js/wasm-loader.js").replace("__SV_WASM_B64__", () => wasmBytes.toString("base64")), "wasm-loader.js");
  run(text("js/js-cores/exec-core.js"), "js-cores/exec-core.js");
  run(text("js/exec-core.js"), "exec-core.js");
  return { ctx, run, EXEC_JS: run("EXEC_JS"), EXEC: run("EXEC") };
}

// a pair of machines (reference, wrapper) called in lockstep
function pair(E, base, saved, note, label) {
  let a, b;
  const ra = tryCall(() => E.EXEC_JS.create({ base, saved: clone(saved) })), rb = tryCall(() => E.EXEC.create({ base, saved: clone(saved) }));
  if (ra.e || rb.e) { if (!(ra.e && rb.e)) note(label + " create", "threw only on " + (ra.e ? "js " + ra.m : "wasm " + rb.m)); return null; }
  a = ra.v; b = rb.v;
  if (a.allowed !== b.allowed) note(label + " create", "allowed " + a.allowed + " vs " + b.allowed);
  const api = {
    a, b, calls: 0,
    call(fn, ...args) {
      api.calls++;
      const x = tryCall(() => a[fn](...clone(args))), y = tryCall(() => b[fn](...clone(args)));
      if (x.e || y.e) { if (!(x.e && y.e)) note(label + " " + fn, "threw only on " + (x.e ? "js " + x.m : "wasm " + y.m)); return { e: true }; }
      const d = sdiff(norm(x.v), norm(y.v), "ret"); if (d) note(label + " " + fn, d);
      return { v: x.v };
    },
    // everything observable, after a call: the requests / rows / faults handed out, the state, the snapshot, the fault log, the debug view
    check(what) {
      const x = a.drain(), y = b.drain();
      let d = sdiff(norm(x), norm(y), "drain"); if (d) note(label + " after " + what, d);
      for (const k of ["state", "snapshot", "faults", "debug"]) { d = sdiff(norm(a[k]()), norm(b[k]()), k); if (d) note(label + " after " + what, d); }
      return x;
    },
  };
  return api;
}

// the tap of the self-test: a recording proxy over a machine; both versions' records are compared
function tapper(log) {
  let n = 0;
  return m => {
    const id = n++, w = { allowed: m.allowed };
    for (const fn of ["debug", "onRow", "reply", "tick", "start", "poll", "kill", "unkill", "clearFault", "drain", "state", "snapshot", "faults"]) {
      w[fn] = (...args) => {
        const before = clone(args), r = m[fn](...args);
        if (fn === "drain") log.push([id, fn, norm(r)]);
        else if (!["debug", "state", "snapshot", "faults"].includes(fn)) { log.push([id, fn, norm(before), norm(r)]); log.push([id, "state", norm(m.state()), norm(m.snapshot()), norm(m.faults()), norm(m.debug())]); }
        else log.push([id, fn, norm(r)]);
        return r;
      };
    }
    return w;
  };
}

// ----- the fake exchange of the random runs (not the self-test's): positions, resting stops, a book of fills, random faults
function fakeExchange(rand) {
  const pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  const S = { px: 100, pos: 0, stops: [], book: {}, foreign: [], partial: 1, slip: 0.05, down: 0, lastNow: 0 };
  const fill = (side, qty, px, now) => { S.pos = +(S.pos + (side === "BUY" ? qty : -qty)).toFixed(9); return { px, qty, fee: px * qty * 0.0005, t: now, status: "FILLED" }; };
  const out = [];      // answers on their way: {at, id, a}
  S.setPx = (px, now) => { S.px = px; for (const s of S.stops.slice()) if (s.side === "SELL" ? px <= s.trig : px >= s.trig) { S.stops.splice(S.stops.indexOf(s), 1); S.book[s.cid] = Object.assign(fill(s.side, s.qty, s.trig - (s.side === "SELL" ? S.slip : -S.slip), now), { status: "TRIGGERED" }); } };
  S.snap = now => {
    const o = { t: now, positions: S.pos === 0 ? [] : [S.pos], orders: S.stops.map(s => ({ cid: s.cid, algo: true })).concat(S.foreign) };
    if (chance(0.03)) delete o.t; if (chance(0.02)) o.positions = [S.pos / 2, S.pos / 2];
    if (chance(0.03)) o.orders.push({ cid: pick(["svx_zz_1_s1", "manual-2", "", null, "SVX_x"]), algo: chance(0.5) });
    return o;
  };
  S.handle = (r, now) => {
    const reply = (a, delay) => out.push({ at: now + (delay == null ? 50 : delay), id: r.id, a });
    const b = chance(0.2) ? pick(["lost", "silent", "reject", "slow", "unknown", "slow", "reject"]) : null;
    if (S.down > now) { if (b === "lost" || chance(0.5)) return; return reply({ ok: false, unknown: true, err: "timeout" }); }
    if (b === "lost") return;
    let a;
    if (r.op === "market") {
      if (r.reduce && (S.pos === 0 || Math.sign(S.pos) === (r.side === "BUY" ? 1 : -1))) a = { ok: false, code: -2022, err: "-2022 ReduceOnly rejected" };
      else if (b === "reject") a = pick([{ ok: false, code: -4003, err: "-4003 quantity less than zero" }, { ok: false, err: "rejected" }, { ok: false, code: -1013 }]);
      else if (b === "unknown") a = { ok: false, unknown: true, err: "no answer in 7 s" };
      else { const q = r.reduce ? Math.min(r.qty, Math.abs(S.pos)) : r.qty * S.partial, px = r.side === "BUY" ? S.px + S.slip : S.px - S.slip, f = fill(r.side, q, px, now); S.book[r.cid] = f; a = { ok: true, data: chance(0.1) ? Object.assign({}, f, { fee: undefined }) : chance(0.05) ? Object.assign({}, f, { t: undefined }) : f }; }
    } else if (r.op === "stop") {
      const bad = r.side === "SELL" ? r.stopPx >= S.px : r.stopPx <= S.px;
      if (b === "reject" || bad) a = { ok: false, code: -2021, err: "-2021 Order would immediately trigger" };
      else if (b === "unknown") a = { ok: false, unknown: true, err: "timeout" };
      else { S.stops.push({ cid: r.cid, side: r.side, qty: r.qty, trig: r.stopPx }); a = { ok: true, data: {} }; }
    } else if (r.op === "cancel") {
      const i = S.stops.findIndex(s => s.cid === r.cid);
      if (b === "reject") a = pick([{ ok: false, code: -1000, err: "-1000 internal error" }, { ok: false, err: "x", code: undefined }]);
      else if (b === "unknown") a = { ok: false, unknown: true, err: "timeout" };
      else if (i >= 0) { S.stops.splice(i, 1); a = { ok: true, data: {} }; } else a = pick([{ ok: false, code: -2011, err: "-2011 Unknown order sent" }, { ok: false, code: -2013, err: "Order does not exist" }, { ok: false, err: "No such order" }]);
    } else {
      const s = S.stops.find(x => x.cid === r.of), f = S.book[r.of];
      a = f ? { ok: true, data: Object.assign({ found: true }, f) } : s ? { ok: true, data: { found: true, status: pick(["NEW", "PARTIALLY_FILLED", "CANCELED", "REJECTED", "EXPIRED", "new"]) } } : { ok: true, data: { found: chance(0.1) ? 0 : false } };
      if (chance(0.05) && f) a.data.qty = 0;
      if (b === "reject" || b === "unknown") a = { ok: false, unknown: true, err: "timeout" };
    }
    if (b === "silent") return;
    reply(a, b === "slow" ? 2000 + Math.floor(rand() * 10000) : null);
  };
  S.due = now => { const d = out.filter(z => z.at <= now); for (const z of d) out.splice(out.indexOf(z), 1); return d; };
  S.pending = () => out.length;
  return S;
}

// ----- a random event list: rows of a runner, the kill switch, a fault cleared, and the start of execution
function randomEvents(rand, n) {
  const pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  const ev = []; let t = 1000, pidN = 0; const open = [];
  const g = () => {
    if (chance(0.85)) return { quoteAgeMs: 100, offsetMs: 10, oneWay: true, step: pick([0.001, 0.01, 0.1]), tick: pick([0.1, 0.01, 0.05]), minQty: 0.001, minNotional: pick([5, 0, undefined]) };
    const o = { quoteAgeMs: pick([100, 100, 100, 2999, 3000, 3001, null, undefined]), offsetMs: pick([10, 10, 10, 1000, 1001, -1000, -1500, null]), oneWay: pick([true, true, true, true, false, undefined, 1]), readOk: pick([undefined, undefined, true, true, false, 0]),
      step: pick([0.001, 0.001, 0.01, 0.1, 1, 0.0001, 1e-7, 0.5]), tick: pick([0.1, 0.1, 0.01, 1, 0.05, 0.0001]), minQty: pick([0.001, 0.001, 0.01, 1, 5]), minNotional: pick([5, 5, 0, undefined, 100, 1e6]) };
    for (const k of Object.keys(o)) if (chance(0.02)) delete o[k]; return o;
  };
  ev.push({ t, kind: "start", extra: chance(0.7) ? {} : { savedOpen: chance(0.5), savedSys: pick(["A", "B", undefined, ""]) }, resetPx: true });
  for (let i = 0; i < n; i++) {
    t += pick([200, 500, 1000, 1000, 3000, 7000, 15000, 40000]);
    const k = rand();
    if (k < 0.3) { const sys = pick(["A", "A", "B"]), p = sys + ":" + (++pidN) + "@" + t; open.push({ sys, pid: p }); ev.push({ t, kind: "row", row: { k: "enter", sys, t: t - 1000 * pick([0, 0, 1, 2]), pid: p, dir: pick([1, 1, -1]), px: pick([100, 100, 100, 99.97, 3.3333, 20000]), qty: pick([1, 1, 0.37, 100, 1e-5, 60, 0.0123456]), notional: 100, stopBps: pick([50, 50, 6.4, 120, 0.5, 1000]), thesis: "x", trigger: "t", tSig: t, stage: pick(["demo", "demo", "demo", "demo", "paper", "live", undefined]), fill: "paper" }, g: chance(0.9) ? g() : pick([undefined, null, {}, g()]) }); }
    else if (k < 0.55 && open.length) { const o = chance(0.9) ? pick(open) : { sys: "A", pid: "nope" }; ev.push({ t, kind: "row", row: { k: pick(["exit", "exit", "invalidate"]), sys: o.sys, t: t - pick([0, 0, 0, 6000, 12000]), pid: o.pid, reason: pick(["time", "stop", "target", "end", "gap", "invalidate", undefined, "x"]) }, g: g() }); }
    else if (k < 0.75 && open.length) { const i = Math.floor(rand() * open.length), o = chance(0.9) ? open.splice(i, 1)[0] : { sys: "B", pid: "zzz" }, intr = chance(0.12); ev.push({ t, kind: "row", row: Object.assign({ k: "trade", sys: o.sys, t, pid: o.pid, tIn: t - 5000, tOut: t, dir: 1, qty: 1, notional: 100, entryPx: 100, exitPx: pick([100.2, 99.7, 100, undefined]), grossBps: 20, feesBps: 10, netBps: pick([10, -5, 0, undefined, null]), R: 0.2, usd: 0.1, stopBps: 50, reason: intr ? "interrupted" : "time", stage: "demo", fill: "paper" }, intr ? { interrupted: true } : {}), g: g() }); if (chance(0.5)) ev.push({ t: t + 1, kind: "clear" }); }
    else if (k < 0.8) ev.push({ t, kind: pick(["kill", "unkill", "unkill", "unkill", "clear", "clear", "clear", "clear"]) });
    else if (k < 0.83) ev.push({ t, kind: "start", extra: chance(0.5) ? {} : { savedOpen: chance(0.5), savedSys: pick(["A", "B"]) } });
    else if (k < 0.9) ev.push({ t, kind: "px", px: pick([99, 98, 101, 102, 95, 100, 105]) });
    else if (k < 0.93) ev.push({ t, kind: "ext", what: pick(["bump", "vanish", "down", "foreign", "unforeign", "flatten"]) });
    else ev.push({ t, kind: "wait" });
  }
  return ev;
}

// run an event list through a pair of machines and a fake exchange
function runSim(E, rand, label, note, { base, saved, events, tail = 90000, pollEvery = 3000 }) {
  const P = pair(E, base, saved, note, label); if (!P) return null;
  const X = fakeExchange(rand), pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  let now = events.length ? events[0].t - 1 : 0, nextPoll = now, ei = 0; const seen = { reqs: 0, rows: 0, faults: 0, statuses: {} };
  const pump = what => {
    const d = P.check(what); if (!d || !d.reqs) return;
    seen.reqs += d.reqs.length; seen.rows += d.rows.length; seen.faults += d.faults.length; for (const r of d.rows) seen.statuses[r.status] = (seen.statuses[r.status] || 0) + 1;
    for (const q of d.reqs) X.handle(q, now);
  };
  const stepTime = to => {
    while (now < to) {
      now = Math.min(to, now + pick([50, 100, 100, 300, 1000, 1500]));
      if (chance(0.3)) X.setPx(X.px + (rand() - 0.5) * pick([0.2, 1, 3]), now);
      for (const z of X.due(now)) { P.call("reply", z.id, z.a, now); pump("reply"); }
      if (chance(0.02)) { P.call("reply", Math.floor(rand() * 40) + 1, pick([{ ok: true, data: { px: 100, qty: 1 } }, { ok: false, unknown: true }, { ok: false, err: "x" }, { ok: true }]), now); pump("stray reply"); }
      P.call("tick", now); pump("tick");
      if (now >= nextPoll) { nextPoll = now + pollEvery; P.call("poll", X.snap(now), now); pump("poll"); }
    }
  };
  for (const e of events) {
    stepTime(e.t - 1); now = e.t;
    if (e.kind === "start") P.call("start", X.snap(now), now, e.extra);
    else if (e.kind === "row") { if (e.trackPx && e.row.k === "enter") X.px = e.row.px; P.call("onRow", e.row, now, e.g); }
    else if (e.kind === "kill") P.call("kill", now);
    else if (e.kind === "unkill") P.call("unkill");
    else if (e.kind === "clear") P.call("clearFault");
    else if (e.kind === "px") X.setPx(e.px, now);
    else if (e.kind === "ext") { if (e.what === "bump") X.pos += pick([1, -1, 3]); else if (e.what === "vanish") X.stops.length = 0; else if (e.what === "down") X.down = now + pick([8000, 16000, 45000]); else if (e.what === "foreign") X.foreign = [{ cid: "manual-1", algo: false }]; else if (e.what === "unforeign") X.foreign = []; else X.pos = 0; }
    pump(e.kind);
  }
  stepTime(now + tail);
  P.call("snapshot"); P.check("end");
  if (P.a.dispose) P.a.dispose?.(); P.b.dispose();
  return { P, seen };
}

export async function exec(root, wasmBytes, st, cases, seed, opts = {}) {
  const E = loadExecContexts(root, wasmBytes), diffs = [];
  const note = (label, d) => { if (diffs.length < 40) diffs.push(label + " " + d); else if (diffs.length === 40) diffs.push("... more"); };
  const flush = (label, count) => st.report(label, count, diffs.splice(0));

  // (A) the self-test, every call recorded
  if (opts.only !== "real") {
    const la = [], lb = [], ja = E.EXEC_JS.selftest(tapper(la)), wa = E.EXEC.selftest(tapper(lb)), bad = [];
    if (ja.length !== wa.length) bad.push(`scenario count ${ja.length} / ${wa.length}`);
    ja.forEach((x, i) => { if (!wa[i] || !x.ok || !wa[i].ok || x.name !== wa[i].name) bad.push(`${x.name}: js ok=${x.ok}, wasm ok=${wa[i] && wa[i].ok} ${wa[i] && wa[i].detail}`); });
    if (la.length !== lb.length) bad.push(`recorded calls ${la.length} / ${lb.length}`);
    for (let i = 0; i < Math.min(la.length, lb.length) && bad.length < 10; i++) { const d = sdiff(la[i], lb[i], "call#" + i + " " + la[i][1]); if (d) bad.push(d); }
    st.report(`exec self-test (${ja.length} scenarios on both versions; ${la.length} machine calls recorded and compared: arguments, results, state, snapshot, faults, debug, drained requests and rows)`, la.length, bad);
  }

  // (B) the guard
  if (opts.only !== "real") {
    const good = ["https://demo-fapi.binance.com", "http://127.0.0.1:8787", "http://localhost:9000", "http://localhost:80", "http://127.0.0.1:00", "http://127.0.0.1:65535"];
    const bad = ["https://fapi.binance.com", "https://demo-fapi.binance.com.evil.example", "https://demo-fapi.binance.com@evil.example", "https://evil@demo-fapi.binance.com", "https://demo-fapi.binance.com.", "https://demo-fapi.binance.com:443", "https://demo-fapi.binance.com/",
      "http://demo-fapi.binance.com", "HTTPS://DEMO-FAPI.BINANCE.COM", "https://Demo-Fapi.binance.com", " https://demo-fapi.binance.com", "https://demo-fapi.binance.com\n", "https://demo-fapi.binance.com\\@evil.example", "https://evil.example#demo-fapi.binance.com", "https://testnet.binancefuture.com",
      "http://127.0.0.1.evil.example:8787", "http://localhost:8787/x", "https://127.0.0.1:8787", "http://127.0.0.1", "http://127.0.0.1:1", "http://127.0.0.1:123456", "http://127.0.0.1:8787\n", "http://127.0.0.1:８７８７", "http://evil.example/http://127.0.0.1:8787", "http://127.0.0.1@evil.example:8787",
      "http://evil@127.0.0.1:8787", "http://localhost.:8787", "http://LOCALHOST:8787", "http://[::1]:8787", "http://0.0.0.0:8787", "http://127.1:8787", "https://fapi.binance.com.local:8787", "", "undefined", "null", "[object Object]"];
    const others = [undefined, null, 5, true, {}, [], ["http://localhost:8787"], ["https://demo-fapi.binance.com"], { toString: () => "http://127.0.0.1:8787" }, { toString: () => "https://demo-fapi.binance.com" }, new String("https://demo-fapi.binance.com"), new String("http://127.0.0.1:8787"), new URL("http://127.0.0.1:8787/"), new URL("https://demo-fapi.binance.com")];
    const inputs = [...good, ...bad, ...others];
    // mutations of the good ones (and of the live host): insert, delete, replace, upper-case one character, append / prepend a few suspicious pieces
    const rand = rng(seed * 7919), pick = a => a[Math.floor(rand() * a.length)], bits = ["@", ".", ":", "/", "\\", "#", "?", " ", "\n", "\t", "0", "9", "a", "​", "０", "evil.example", "@evil.example", ".evil.example", "http://", "https://", "demo-", "-fapi", ":8787", "[", "%2e", "%40"];
    const seedHosts = [...good, "https://fapi.binance.com"];
    for (let i = 0; i < Math.max(4000, cases * 8); i++) {
      let s = pick(seedHosts); const n = 1 + Math.floor(rand() * 3);
      for (let j = 0; j < n; j++) { const k = Math.floor(rand() * (s.length + 1)), m = rand(); s = m < 0.4 ? s.slice(0, k) + pick(bits) + s.slice(k) : m < 0.6 ? s.slice(0, k) + s.slice(k + 1 + Math.floor(rand() * 3)) : m < 0.75 ? s.slice(0, k) + (s[k] || "").toUpperCase() + s.slice(k + 1) : m < 0.9 ? s + pick(bits) : pick(bits) + s; }
      inputs.push(s);
    }
    let allowedCount = 0;
    for (const [i, b] of inputs.entries()) {
      const x = tryCall(() => E.EXEC_JS.isDemoBase(b)), y = tryCall(() => E.EXEC.isDemoBase(b));
      if (x.e || y.e) { if (!(x.e && y.e)) note("isDemoBase " + String(b).slice(0, 60), "threw only on " + (x.e ? "js" : "wasm")); continue; }
      if (x.v !== y.v) note("isDemoBase", JSON.stringify(String(b)) + " js " + x.v + " vs wasm " + y.v);
      const ca = tryCall(() => E.EXEC_JS.create({ base: b })), cb = tryCall(() => E.EXEC.create({ base: b }));
      if (ca.e || cb.e) { if (!(ca.e && cb.e)) note("create " + String(b).slice(0, 60), "threw only on " + (ca.e ? "js" : "wasm")); continue; }
      if (ca.v.allowed !== cb.v.allowed) note("allowed", JSON.stringify(String(b)) + " js " + ca.v.allowed + " vs wasm " + cb.v.allowed);
      if (cb.v.allowed) allowedCount++;
      if (i < 120 || !cb.v.allowed && i % 40 === 0) {      // a machine that is not allowed makes no request, whatever is done to it (both sides); one that is allowed asks for the same
        const P = pair(E, b, {}, note, "guard"); if (!P) continue;
        P.call("start", { t: 1, positions: [0.4], orders: [{ cid: "svx_a_1_s1", algo: true }] }, 1000, { savedOpen: true, savedSys: "A" }); P.check("start");
        P.call("start", { t: 1, positions: [], orders: [] }, 1100, {}); P.check("start");
        P.call("onRow", { k: "enter", sys: "A", t: 1000, pid: "A:1", dir: 1, px: 100, qty: 1, stopBps: 50, stage: "demo" }, 1200, { quoteAgeMs: 1, offsetMs: 1, oneWay: true, step: 0.001, tick: 0.1, minQty: 0.001, minNotional: 5 });
        P.call("kill", 1300); P.call("tick", 30000); P.call("poll", { t: 2, positions: [1], orders: [] }, 31000);
        const da = P.a.drain(), db = P.b.drain();
        if (!cb.v.allowed && (da.reqs.length || db.reqs.length)) note("guard", JSON.stringify(String(b)) + " not allowed but made requests: js " + da.reqs.length + ", wasm " + db.reqs.length);
        if (cb.v.allowed !== (b === "https://demo-fapi.binance.com" || /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(String(b)))) note("guard", "allowed differs from the rule for " + JSON.stringify(String(b)));
        P.b.dispose();
      }
    }
    for (const b of ["https://fapi.binance.com", "https://fapi.binance.com/", "https://dapi.binance.com", "https://api.binance.com", "wss://fstream.binance.com"]) { if (E.EXEC.isDemoBase(b) || E.EXEC.create({ base: b }).allowed) note("live", b + " counts as the demo base"); }
    if (E.EXEC.ALLOW_LIVE !== false || E.EXEC_JS.ALLOW_LIVE !== false) note("live", "ALLOW_LIVE is not false");
    flush(`exec guard: isDemoBase and allowed on ${inputs.length} bases (${good.length} good, ${bad.length} look-alikes, ${others.length} non-strings, the rest mutations; ${allowedCount} allowed), non-allowed machines driven through every call produce no request`, inputs.length);
  }

  // (C) random sequences
  if (opts.only !== "real") {
    const rand = rng(seed * 104729), pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p, nSeq = Math.max(1000, cases * 3), BATCH = 250;
    const tot = { reqs: 0, rows: 0, faults: 0, calls: 0, statuses: {} };
    for (let from = 0; from < nSeq; from += BATCH) {
      const n = Math.min(BATCH, nSeq - from);
      for (let c = 0; c < n; c++) {
        const base = chance(0.9) ? pick(["https://demo-fapi.binance.com", "https://demo-fapi.binance.com", "http://127.0.0.1:8787"]) : pick(["https://fapi.binance.com", "https://demo-fapi.binance.com.evil.example", undefined]);
        const saved = chance(0.3) ? { killed: chance(0.5), faults: chance(0.5) ? [{ t: 5, kind: "old", text: "x" }, { t: 6, kind: "older", text: "" }] : [] } : undefined;
        const events = randomEvents(rand, 25 + Math.floor(rand() * 60));
        const r = runSim(E, rand, `seq#${from + c}`, note, { base, saved, events, tail: pick([30000, 90000]) });
        if (r) { tot.reqs += r.seen.reqs; tot.rows += r.seen.rows; tot.faults += r.seen.faults; tot.calls += r.P.calls; for (const [k, v] of Object.entries(r.seen.statuses)) tot.statuses[k] = (tot.statuses[k] || 0) + v; }
      }
      flush(`exec random sequences #${from}-${from + n - 1} (seed ${seed})`, n);
    }
    console.log("coverage of the random runs: " + JSON.stringify(tot));
  }

  // (D) real journals
  const journals = [];
  const j4 = path.join(root, "sessions", "trader-journal_check4.json");
  if (fs.existsSync(j4)) journals.push({ name: "trader-journal_check4.json", rows: JSON.parse(fs.readFileSync(j4, "utf8")).rows.filter(r => r.k !== "twin") });
  const CUT = "202611160000", dir = path.join(root, "sessions"), snapDir = path.join(root, ".scratch", "trade-system", "cache-snap");
  if (fs.existsSync(dir)) {
    const names = fs.readdirSync(dir).filter(f => /^session_.*\.json\.gz$/.test(f)).filter(f => { const m = f.match(/_(\d{12})/); return m && m[1] < CUT; }).sort();
    const cached = names.filter(f => fs.existsSync(path.join(snapDir, f + ".json"))), want = opts.limit || 4;
    const files = cached.filter((f, i) => i % Math.max(1, Math.floor(cached.length / want)) === 0).slice(0, want);
    console.log(`real recordings: ${names.length} session files are before 2026-11-16, ${cached.length} have cached snapshots; running the paper runner on ${files.length} of them for journals; the later ones are not opened`);
    if (files.length) {
      const R = loadRunnerContexts(root, wasmBytes), H = await import("../design-harness.mjs");
      for (const f of files) {
        const s = H.loadSnaps({ file: f, dir, size: fs.statSync(path.join(dir, f)).size }), run = R.RUNNER.create({ systems: R.DEFAULTS, twins: 0, equity: 10000, feeBps: 5, riskCap: 0.02, seed: 1 });
        for (const x of s.snaps) run.step(x);
        run.interrupt(s.snaps[s.snaps.length - 1].t);
        journals.push({ name: f, rows: clone(run.rows().filter(r => r.k === "enter" || r.k === "exit" || r.k === "invalidate" || r.k === "trade")) }); run.dispose(); s.snaps = null;
      }
    }
  }
  for (const [ji, jr] of journals.entries()) {
    const rand = rng(seed * 31 + ji), pick = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
    const G = { quoteAgeMs: 100, offsetMs: 10, oneWay: true, step: 0.00001, tick: 0.1, minQty: 0.00001, minNotional: 5 };
    const rows = jr.rows.filter(r => ["enter", "exit", "invalidate", "trade"].includes(r.k)).map(r => Object.assign(clone(r), r.k === "enter" ? { stage: "demo" } : {}));
    rows.sort((a, b) => a.t - b.t);
    let nEnter = 0, nTrade = 0;
    for (const sub of [0, 1]) {      // 0: every row at its own time; 1: the same rows with a little delay and a random exchange (faults, losses)
      const events = [{ t: rows.length ? rows[0].t - 1000 : 0, kind: "start", extra: {} }];
      for (const r of rows) { events.push({ t: r.t + (sub ? Math.floor(rand() * 2000) : 50), kind: "row", row: r, trackPx: true, g: Object.assign({}, G, sub && chance(0.1) ? { quoteAgeMs: 4000 } : {}) }); if (!sub) { if (r.k === "enter") nEnter++; if (r.k === "trade") nTrade++; } }
      events.sort((a, b) => a.t - b.t);
      const rr = rng(seed + ji * 7 + sub);
      const res = runSim(E, rr, `${jr.name} #${sub}`, note, { base: "https://demo-fapi.binance.com", saved: undefined, events, tail: 60000, pollEvery: 3000 });
      void res;
    }
    // EXEC.merge on the real rows: no mirror (the same array back), mirror rows from the trades, mirror rows of other fills
    const trades = jr.rows.filter(r => r.k === "trade"), fake = [];
    for (const t of trades) { if (chance(0.5)) fake.push({ k: "mirror", sys: t.sys, t: t.t + 100, pid: t.pid, status: pick(["filled", "filled", "paper", "failed", "interrupted"]), fill: pick(["demo", "demo", "demo", "paper"]), netBps: pick([t.netBps - 1, t.netBps + 2.5, -3, 0, undefined, null, "5"]), dir: t.dir, notes: [] }); }
    const withMirror = jr.rows.concat(fake), a = E.EXEC_JS.merge(clone(withMirror)), b = E.EXEC.merge(clone(withMirror));
    let d = sdiff(norm(a), norm(b), "merge"); if (d) note(jr.name + " merge", d);
    const same = jr.rows, ra = E.EXEC_JS.merge(same), rb = E.EXEC.merge(same);
    if ((ra === same) !== (rb === same)) note(jr.name + " merge", "the array is not returned as it is when no mirror row has a demo fill");
    flush(`exec real journal ${jr.name}: ${rows.length} runner rows (${nEnter} enters, ${nTrade} trades) driven through both machines twice (once on a clean fake exchange, once on a faulty one), then merge with ${fake.length} mirror rows over ${trades.length} trades`, rows.length * 2 + trades.length);
  }
  if (!journals.length) console.log("skip  real journals: none found");
}
