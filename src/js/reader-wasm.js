"use strict";
// The Reader as Rust/WebAssembly (R6, rust/crates/sv-reader): the same engine and episode layer as reader-engine.js + reader-episodes.js, behind the same API as READER_ENGINE
// (create / replay / replayEngine / feed / DEFAULTS, and on an engine: the input methods, events, episodes, episodeGroups, formingEpisodes, activeEpisodes, state, horizon, windowMs,
// sigmaPeek, priceHistory, cfg, setSensitivity / setDetector / setFamily, closeEpisodes, subscribe / subscribeEpisodes, debug, the recording methods), and dispose().
// Until the episode-outcomes test run (plan amendment 2, .scratch/rust-migration/plan.md) the page keeps the JS engine: this is used by the self-test (parity with the JS engine on every
// scenario and on random streams) and by the offline scripts (compare-detections.mjs --wasm-b, --engine wasm).
//
// Boundary: an input does not cross on its own. Inputs are queued (copied at call time, the recording format) and cross in one call with the queries that need them, so the cost is
// one JSON crossing per batch. A read (events, episodes, state, ...) flushes the queue first and is cached until the next input. Differences from the JS engine, all in how it is
// driven, none in what it detects: listeners (subscribe, subscribeEpisodes) are called when the queue is flushed, not inside the input call (each gets the episode or signal as it was at
// that moment); a NaN in an input crosses as null (a recorded session already carries null); objects returned are copies, so a change to one does not reach the engine;
// debug() offers the read functions and a summary of the venues (debug().venues.bn.walls.size), not the internal objects; debug().emit is not available.
// cfg is a live view of the configuration: a change to it (READER.cfg.ep.x = 1) is sent to the engine before the next input, as the JS engine reads its cfg live.
const READER_WASM = (() => {
  const call = (fn, text) => SVWASM.callText("reader_" + fn, text);
  const numRep = (k, v) => typeof v === "number" && !Number.isFinite(v) ? String(v) : v;      // NaN and +/-Infinity as text in the cfg (the engine reads them as +x)
  const wire = cfg => Object.assign({}, cfg, { horizons: Object.entries(cfg.horizons || {}) });     // a JSON object would lose the order of the horizons (state() lists them in it)
  const reg = typeof FinalizationRegistry === "function" ? new FinalizationRegistry(h => { try { if (SVWASM.loaded) call("drop", '{"h":' + h + '}'); } catch (e) { /* the module is gone */ } }) : null;
  const FLUSH_AT = 20000;
  const lvl = a => Array.isArray(a) ? a.map(l => l && typeof l !== "string" ? [l[0], l[1]] : l) : a;      // the engine reads only l[0] and l[1], so a copy of those keeps a later change by the caller out

  function mergeCfg(userCfg) {      // exactly as READER_ENGINE.create builds it
    const E = READER_ENGINE.DEFAULTS, P = READER_EPISODES.DEFAULTS, u = userCfg || {};
    const cfg = Object.assign({}, E, u);
    cfg.detectors = Object.assign({}, E.detectors, u.detectors || {});
    cfg.horizons = Object.assign({}, E.horizons, u.horizons || {});
    cfg.ep = Object.assign({}, P, u.ep || {});
    cfg.ep.horizons = ((u.ep && u.ep.horizons) || P.horizons).slice();
    cfg.ep.famHorizons = Object.assign({}, P.famHorizons, (u.ep && u.ep.famHorizons) || {});
    cfg.ep.families = Object.assign({}, P.families, (u.ep && u.ep.families) || {});
    return cfg;
  }

  function create(userCfg) {
    const raw = mergeCfg(userCfg);
    let h = call("create", JSON.stringify({ cfg: wire(raw) }, numRep)).h;
    const token = {};
    if (reg) reg.register(token, h, token);
    let queue = [], cache = new Map(), rec = null, recQ = {}, recQuoteMs = 0;
    const listeners = [], epListeners = [];
    let listening = "";
    const op = x => { queue.push(x); cache.clear(); if (queue.length >= FLUSH_AT) run([]); };
    const cfgOp = () => { const x = ["cfg", JSON.parse(JSON.stringify(wire(raw), numRep))]; cache.clear(); if (queue.length && queue[queue.length - 1][0] === "cfg") queue[queue.length - 1] = x; else queue.push(x); };
    function syncListen() { const s = (epListeners.length ? 1 : 0) + "" + (listeners.length ? 1 : 0); if (s !== listening) { listening = s; op(["listen", !!epListeners.length, !!listeners.length]); } }
    // the operations queued so far, then the queries; listeners are told what happened in between
    function run(qs) {
      if (!h) throw new Error("wasm core reader: the engine was disposed");
      const ops = queue; queue = [];
      const out = call("run", JSON.stringify({ h, ops, q: qs }));
      for (const n of out.notes) {
        if (n.ev) for (const fn of listeners.slice()) try { fn(n.ev); } catch (err) { /* as the JS engine: a listener cannot stop the engine */ }
        if (n.ep) for (const fn of epListeners.slice()) try { fn(n.ep, n.ch); } catch (err) { /* idem */ }
      }
      return out.r;
    }
    function q(key, query) { if (cache.has(key)) return cache.get(key); const r = run([query])[0]; cache.set(key, r); return r; }      // a read that does not move the engine
    function qm(query) { cache.clear(); return run([query])[0]; }                                                                         // one that can (the statistics cache)

    // the live cfg: a change anywhere in it is sent before the next input
    const proxies = new WeakMap();
    function view(o) {
      if (o === null || typeof o !== "object") return o;
      if (proxies.has(o)) return proxies.get(o);
      const p = new Proxy(o, {
        get: (t, k) => view(t[k]),
        set: (t, k, v) => { t[k] = v; cfgOp(); return true; },
        deleteProperty: (t, k) => { delete t[k]; cfgOp(); return true; },
      });
      proxies.set(o, p);
      return p;
    }
    const cfg = view(raw);

    function onTrade(tr) {
      const x = tr ? { t: tr.t, v: tr.v, side: tr.side, px: tr.px, q: tr.q, ntl: tr.ntl, liq: !!tr.liq, users: tr.users } : tr;
      if (rec) rec.push(["t", x]);
      op(["t", x]);
    }
    function onQuote(vn, t, bid, ask) {
      if (rec && (!recQuoteMs || !(t - recQ[vn] < recQuoteMs))) { rec.push(["q", vn, t, bid, ask]); recQ[vn] = t; }
      op(["q", vn, t, bid, ask]);
    }
    function onSweep(vn, t, side, ntl, levels) { if (rec) rec.push(["s", vn, t, side, ntl, levels]); op(["s", vn, t, side, ntl, levels]); }
    function onBook(vn, t, bids, asks) { if (rec) rec.push(["b", vn, t, bids, asks]); op(["b", vn, t, lvl(bids), lvl(asks)]); }
    function advance(t) { if (rec) rec.push(["a", t]); op(["a", t]); }
    function reset() { if (rec) rec.push(["x"]); op(["x"]); }
    function subscribe(fn) { listeners.push(fn); syncListen(); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); syncListen(); }; }
    function subscribeEpisodes(fn) { epListeners.push(fn); syncListen(); return () => { const i = epListeners.indexOf(fn); if (i >= 0) epListeners.splice(i, 1); syncListen(); }; }
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    function setSensitivity(x) { cfg.sens = clamp(Number(x) > 0 ? Number(x) : 1, .5, 2); }
    function setDetector(name, on) { if (Object.prototype.hasOwnProperty.call(raw.detectors, name)) cfg.detectors[name] = !!on; }
    function setFamily(name, on) { if (!Object.prototype.hasOwnProperty.call(raw.ep.families, name)) return; raw.ep.families[name] = !!on; op(["fam", name, !!on]); }
    function closeEpisodes(t) { op(["close", t == null ? null : t]); }

    const api = {
      cfg, reset, subscribe, onTrade, onQuote, onSweep, onBook, advance, setSensitivity, setDetector, subscribeEpisodes, setFamily, closeEpisodes,
      windowMs: name => q("w|" + name, ["windowMs", name]),
      horizon: (vn, name) => q("h|" + vn + "|" + name, ["horizon", vn, name]),
      state: () => q("state", ["state"]),
      sigmaPeek: vn => q("sp|" + vn, ["sigmaPeek", vn]),
      priceHistory: vn => q("ph|" + vn, ["priceHistory", vn]),
      formingEpisodes: () => q("forming", ["forming"]),
      episodeGroups: () => q("groups", ["groups"]),
      activeEpisodes: () => q("active", ["active"]),
      debug: () => {
        const d = q("debug", ["debug"]), venues = {};
        for (const v of ["bn", "hl"]) venues[v] = Object.assign({}, d.venues[v], { walls: { size: d.venues[v].walls } });
        return { venues, now: d.now, firstT: d.firstT, curStart: d.curStart, get events() { return api.events; },
          isCalibrated: () => q("cal", ["isCalibrated"]), stat: (vn, k) => qm(["stat", vn, k]), robustZ: (x, vn, key, floor) => qm(["robustZ", x, vn, key, floor]), sigmaBps: vn => qm(["sigmaBps", vn]),
          walletEvidence: (vn, side, since) => q("we|" + vn + "|" + side + "|" + since, ["walletEvidence", vn, side, since]), typicalDepth: (vn, side) => q("td|" + vn + "|" + side, ["typicalDepth", vn, side]),
          emit: () => { throw new Error("wasm core reader: debug().emit is not available"); } };
      },
      startRecording: o => { rec = []; recQ = {}; recQuoteMs = (o && o.quoteMs) || 0; },
      stopRecording: () => { const r = rec || []; rec = null; return r; },
      recording: () => ({ on: !!rec, n: rec ? rec.length : 0 }),
      trimRecording: t => { if (!rec) return 0; let i = 0; for (; i < rec.length; i++) { const r = rec[i], k = r[0], x = k === "t" ? (r[1] && r[1].t) : k === "a" ? r[1] : k === "x" ? null : r[2]; if (x != null && x >= t) break; } if (i) rec.splice(0, i); return i; },
      flush: () => { if (queue.length) run([]); },
      dispose: () => { if (!h) return; if (reg) reg.unregister(token); try { call("drop", '{"h":' + h + '}'); } finally { h = 0; } },
      wasm: true,
    };
    Object.defineProperty(api, "events", { get: () => q("events", ["events"]) });
    Object.defineProperty(api, "episodes", { get: () => q("episodes", ["episodes"]) });
    return api;
  }
  function feed(e, inputs, i0, i1) { for (let i = i0; i < i1 && i < inputs.length; i++) { const r = inputs[i]; switch (r[0]) { case "t": e.onTrade(r[1]); break; case "q": e.onQuote(r[1], r[2], r[3], r[4]); break; case "b": e.onBook(r[1], r[2], r[3], r[4]); break; case "s": e.onSweep(r[1], r[2], r[3], r[4], r[5]); break; case "a": e.advance(r[1]); break; case "x": e.reset(); break; } } }
  function replay(inputs, userCfg) { const e = create(userCfg); feed(e, inputs, 0, inputs.length); const ev = e.events; e.dispose(); return ev; }
  function replayEngine(inputs, userCfg) { const e = create(userCfg); feed(e, inputs, 0, inputs.length); return e; }
  return { create, replay, replayEngine, feed, get DEFAULTS() { return READER_ENGINE.DEFAULTS; } };
})();
