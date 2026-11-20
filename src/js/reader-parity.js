"use strict";
// Parity of the Reader in Rust (READER_WASM) with the JS Reader (READER_ENGINE), for the build's self-test and lib/reader-parity.mjs. Not part of the page.
//   READER_PARITY.pair: an engine module with READER_ENGINE's API that drives both engines with the same calls and requires every read to give the same JSON text (key order
//     included); it returns the JS engine's value, so a self-test scenario judges the JS engine while the pair checks the WASM one against it. Listeners get the JS engine's
//     notifications; the WASM ones are compared with them at every read.
//   READER_PARITY.selftest(): every READER_SELFTEST scenario through the pair, then a full comparison of every engine the scenario made.
//   READER_PARITY.random(seed, opts): a random two-venue stream (trades with wallets, liquidations, sweeps, books with walls that come and go, gaps, resets, malformed inputs,
//     sensitivity and threshold changes, families switched off and on, closeEpisodes) with a full comparison after every phase. Returns {ok, detail, inputs, checks}.
const READER_PARITY = (() => {
  const J = JSON.stringify;
  function mismatch(what, x, y) {
    let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
    const cut = s => s.slice(Math.max(0, i - 160), i + 160);
    const e = new Error(`parity: ${what} differs at char ${i}\n          js:   ...${cut(x)}...\n          wasm: ...${cut(y)}...`); e.parity = true; throw e;
  }
  const cmp = (what, a, b) => { const x = J(a), y = J(b); if (x !== y) mismatch(what, x === undefined ? "undefined" : x, y === undefined ? "undefined" : y); return a; };
  let made = null;      // the pairs made since the last reset (selftest compares each in full at the end of its scenario)

  function create(userCfg) {
    const a = READER_ENGINE.create(userCfg), b = READER_WASM.create(userCfg);
    const p = { a, b, epA: [], epB: [], evA: [], evB: [] };
    if (made) made.push(p);
    const notes = () => { b.flush(); cmp("episode notifications", p.epA, p.epB); cmp("signal notifications", p.evA, p.evB); };
    const both = name => (...args) => { a[name](...args); b[name](...args); };
    const chk = name => (...args) => { const x = a[name](...args), y = b[name](...args); notes(); return cmp(name + "(" + args.map(v => J(v)).join(",") + ")", x, y); };
    const api = {
      cfg: a.cfg,
      onTrade: both("onTrade"), onQuote: both("onQuote"), onSweep: both("onSweep"), onBook: both("onBook"), advance: both("advance"), reset: both("reset"),
      setSensitivity: both("setSensitivity"), setDetector: both("setDetector"), setFamily: both("setFamily"), closeEpisodes: both("closeEpisodes"),
      startRecording: both("startRecording"), stopRecording: chk("stopRecording"), recording: chk("recording"), trimRecording: chk("trimRecording"),
      windowMs: chk("windowMs"), horizon: chk("horizon"), state: chk("state"), sigmaPeek: chk("sigmaPeek"), priceHistory: chk("priceHistory"),
      formingEpisodes: chk("formingEpisodes"), episodeGroups: chk("episodeGroups"), activeEpisodes: chk("activeEpisodes"),
      subscribe(fn) { const u1 = a.subscribe(e => { p.evA.push(J(e)); fn(e); }), u2 = b.subscribe(e => p.evB.push(J(e))); return () => { u1(); u2(); }; },
      subscribeEpisodes(fn) { const u1 = a.subscribeEpisodes((ep, ch) => { p.epA.push(J([ep, ch])); fn(ep, ch); }), u2 = b.subscribeEpisodes((ep, ch) => p.epB.push(J([ep, ch]))); return () => { u1(); u2(); }; },
      debug() {
        const da = a.debug(), db = b.debug();
        cmp("walls", [da.venues.bn.walls.size, da.venues.hl.walls.size], [db.venues.bn.walls.size, db.venues.hl.walls.size]);
        const two = name => (...args) => { const x = da[name](...args), y = db[name](...args); return cmp("debug()." + name + "(" + args.map(v => J(v)).join(",") + ")", x, y); };
        return { venues: da.venues, now: da.now, firstT: da.firstT, curStart: da.curStart, events: da.events, isCalibrated: two("isCalibrated"), stat: two("stat"), robustZ: two("robustZ"), sigmaBps: two("sigmaBps"), walletEvidence: two("walletEvidence"), typicalDepth: two("typicalDepth"), emit: da.emit };
      },
      pair: p,
    };
    Object.defineProperty(api, "events", { get: () => { const x = a.events, y = b.events; notes(); return cmp("events", x, y); } });
    Object.defineProperty(api, "episodes", { get: () => { const x = a.episodes, y = b.episodes; notes(); return cmp("episodes", x, y); } });
    return api;
  }
  // every read, in full
  function compareAll(p, where) {
    const { a, b } = p, w = s => (where ? where + ": " : "") + s;
    b.flush();
    cmp(w("episode notifications"), p.epA, p.epB); cmp(w("signal notifications"), p.evA, p.evB);
    cmp(w("events"), a.events, b.events); cmp(w("episodes"), a.episodes, b.episodes); cmp(w("episodeGroups"), a.episodeGroups(), b.episodeGroups());
    cmp(w("formingEpisodes"), a.formingEpisodes(), b.formingEpisodes()); cmp(w("activeEpisodes"), a.activeEpisodes(), b.activeEpisodes()); cmp(w("state"), a.state(), b.state());
    for (const v of ["bn", "hl"]) {
      cmp(w("priceHistory " + v), a.priceHistory(v), b.priceHistory(v)); cmp(w("sigmaPeek " + v), a.sigmaPeek(v), b.sigmaPeek(v));
      for (const hz of ["fast", "mid", "slow"]) cmp(w("horizon " + v + " " + hz), a.horizon(v, hz), b.horizon(v, hz));
    }
    for (const hz of ["fast", "mid", "slow"]) cmp(w("windowMs " + hz), a.windowMs(hz), b.windowMs(hz));
    cmp(w("isCalibrated"), a.debug().isCalibrated(), b.debug().isCalibrated());
  }
  function feed(e, inputs, i0, i1) { for (let i = i0; i < i1 && i < inputs.length; i++) { const r = inputs[i]; switch (r[0]) { case "t": e.onTrade(r[1]); break; case "q": e.onQuote(r[1], r[2], r[3], r[4]); break; case "b": e.onBook(r[1], r[2], r[3], r[4]); break; case "s": e.onSweep(r[1], r[2], r[3], r[4], r[5]); break; case "a": e.advance(r[1]); break; case "x": e.reset(); break; } } }
  const pair = { create, feed, replay: (inputs, cfg) => { const e = create(cfg); feed(e, inputs, 0, inputs.length); return e.events; }, replayEngine: (inputs, cfg) => { const e = create(cfg); feed(e, inputs, 0, inputs.length); return e; }, DEFAULTS: READER_ENGINE.DEFAULTS };

  function selftest() {
    const out = [];
    for (const sc of READER_SELFTEST.scenarios) {
      made = [];
      let ok = true, detail = "ok";
      try {
        const r = sc.run(pair);
        made.forEach((p, i) => compareAll(p, "engine " + (i + 1)));
        if (!r.ok) { ok = false; detail = "the JS engine fails the scenario under the pair: " + r.detail; }
      } catch (err) { ok = false; detail = String(err && err.parity ? err.message : (err && err.stack) || err); }
      const n = made.length;
      for (const p of made) p.b.dispose();
      made = null;
      if (!n && ok) continue;      // a scenario of another core (READER_SELFTEST also holds those): it made no Reader
      out.push({ name: "reader wasm parity: " + sc.name + " (" + "every read equal)", ok, detail });
    }
    return out;
  }

  // ---- random streams
  function random(seed, opts) {
    const o = Object.assign({ phases: 24, check: true }, opts), S = READER_SELFTEST, rand = S.rng(seed * 7919 + 13), pick = a => a[Math.floor(rand() * a.length)], chance = x => rand() < x;
    const variants = [{}, { sens: .6 }, { sens: 1.8 }, { ep: { horizons: ["fast", "mid"], famHorizons: { exhaustion: ["fast", "mid"] } } }, { sigmaFastN: 120, sigmaFastW: .5 }, { ep: { wallMinUsd: 0, wallEpisodeMs: 5000, wallMergeBps: 0 } },
      { warmupMs: 30000, ep: { enterHoldMs: 1000, resumeMs: 40000 } }, { maxEventsPerMin: 4, keepEvents: 30, ep: { keepEpisodes: 12, keepWalls: 5, traceCap: 20 } }, { absorbShare: .55, burstZ: 2, ep: { exhNear: 3, groupGapMs: 30000 } }, { horizons: { fast: 8000, mid: 40000, slow: 200000, extra: 2000 } }];
    const cfg = JSON.parse(J(pick(variants)));
    const e = create(cfg);
    let t = S.T0 + Math.floor(rand() * 1e6), checks = 0, inputs = 0;
    const mid = { bn: 82000 + rand() * 500, hl: 82000 + rand() * 500 }, walls = { bn: [], hl: [] }, users = ["0xaaaaaaaaaaaaaaaaaaaa1111", "0xbbbbbbbbbbbbbbbbbbbb2222", "0xcccccccccccccccccccc3333", "0xdddddddddddddddddddd4444"];
    const step = (p, ms) => {
      t += ms;
      for (const v of ["bn", "hl"]) {
        if (p.silent === v) continue;
        const dt = ms / 1000; mid[v] *= 1 + (p.drift * dt + (rand() - .5) * 2 * p.vol) / 1e4;
        const m = v === "hl" ? mid[v] * (1 + p.basis / 1e4) : mid[v];
        if (!p.noQuote) { e.onQuote(v, t + (chance(.1) ? -Math.floor(rand() * 3000) : 0), m - .05, m + .05); inputs++; }
        for (let k = S.poisson(rand, p.rate * dt); k > 0; k--) {
          const buy = rand() < p.buyP, q = p.size * (.5 + rand() * (chance(.05) ? 20 : 1)), px = buy ? m + .05 : m - .05;
          const tr = { t: t - (chance(.05) ? Math.floor(rand() * 400) : 0), v, side: buy ? "buy" : "sell", px: p.atLevel ? +px.toFixed(2) : chance(.2) ? +(px + (rand() - .5) * .3).toFixed(1) : px, q, ntl: px * q };
          if (v === "hl") tr.users = chance(p.wallet) ? [buy ? p.whale : pick(users), buy ? pick(users) : p.whale] : [pick(users), pick(users)];
          e.onTrade(tr); inputs++;
        }
        for (let k = S.poisson(rand, p.liq * dt); k > 0; k--) { const s = chance(.5) ? "buy" : "sell"; e.onTrade({ t, v, side: s, px: m, q: .5, ntl: m * .5, liq: true }); inputs++; }
        for (let k = S.poisson(rand, p.sweep * dt); k > 0; k--) { e.onSweep(v, t, chance(.5) ? "buy" : "sell", 50000, 3); inputs++; }
        if (!p.noBook && chance(.9)) {
          const bw = walls[v].filter(w => w.side === "bid"), aw = walls[v].filter(w => w.side === "ask");
          e.onBook(v, t, S.levels(m, -1, p.bidMult, bw, t), S.levels(m, 1, p.askMult, aw, t)); inputs++;
        }
      }
      if (chance(.02)) { e.advance(t + Math.floor(rand() * 500)); inputs++; }
    };
    const calm = { rate: 20, buyP: .5, drift: 0, vol: .3, size: .02, basis: 0, liq: 0, sweep: 0, bidMult: 1, askMult: 1, wallet: 0, whale: users[0], silent: null, noQuote: false, noBook: false };
    // what the episode families look for (the self-test's own patterns), mixed with anything at all
    const PATTERNS = [
      () => ({ rate: 120, buyP: pick([.08, .92]), vol: .02 }),                                                      // absorption: one side hits, price does not move
      () => ({ rate: 200, buyP: pick([.1, .9]), drift: pick([-6, 6]), liq: 3, sweep: 2, bidMult: .4, askMult: .4 }), // burst
      () => ({ rate: 200, buyP: .9, drift: 6, secs: 14, then: { rate: 12, vol: .05 } }),                             // exhaustion: a surge, then it fades near the high
      () => ({ rate: 200, buyP: .1, drift: -6, secs: 14, then: { rate: 12, vol: .05, drift: pick([0, 14]) } }),
      () => ({ vol: 0, secs: 75, wall: true }),                                                                     // a wall that stands long enough to be an episode
      () => ({ wallet: .8, rate: 60, buyP: pick([.2, .8]) }),                                                       // one wallet keeps hitting (Hyperliquid)
      () => ({ rate: 150, buyP: pick([.05, .95]), vol: 0, atLevel: true, wallet: .6 }),                             // fills keep landing on one visible level (refreshing level)
      () => ({}),
    ];
    const phase = () => {
      const r0 = rand() < .55 ? pick(PATTERNS)() : { rate: pick([5, 20, 60, 150, 300]), buyP: pick([.1, .3, .5, .5, .7, .92]), drift: pick([0, 0, 3, -3, 8, -8, 15]), vol: pick([0, .05, .3, .8]), size: pick([.01, .02, .1]), basis: pick([0, 2, -2]),
        liq: pick([0, 0, 1, 4]), sweep: pick([0, 0, 1, 3]), bidMult: pick([1, 1, .3, 3]), askMult: pick([1, 1, .3, 3]), wallet: pick([0, .3, .8]), whale: pick(users), silent: chance(.15) ? pick(["bn", "hl"]) : null,
        noQuote: chance(.05), noBook: chance(.05) };
      const p = Object.assign({}, calm, r0, { whale: pick(users) });
      if (p.wall) for (const v of ["bn", "hl"]) walls[v] = [{ side: chance(.5) ? "bid" : "ask", idx: 8 + Math.floor(rand() * 10), size: pick([6, 12, 40]) }];
      if (p.secs) {
        for (let i = 0; i < p.secs * 4; i++) step(p, 250);
        if (p.then) { const q = Object.assign({}, calm, p.then); for (let i = 0; i < 40 * 4; i++) step(q, 250); }
        if (p.wall) for (const v of ["bn", "hl"]) { if (chance(.5)) walls[v] = []; else for (const w of walls[v]) w.size *= pick([.2, .5]); }
        return;
      }
      for (const v of ["bn", "hl"]) {
        if (chance(.35)) walls[v].push({ side: chance(.5) ? "bid" : "ask", idx: Math.floor(rand() * 30), size: pick([3, 6, 12, 40]) });
        if (chance(.3)) walls[v] = walls[v].filter(() => chance(.5));
        for (const w of walls[v]) if (chance(.3)) w.size *= pick([.2, .5, 1.1, 1.5]);
      }
      const secs = pick([2, 5, 10, 20, 40, 90]), ms = pick([100, 250, 250, 400]);
      for (let i = 0; i < secs * 1000 / ms; i++) step(p, ms);
    };
    const extra = () => {
      const r = rand();
      if (r < .08) { t += pick([31000, 45000, 120000]); }                                      // a gap: the engine starts over softly
      else if (r < .11) { e.reset(); inputs++; }
      else if (r < .16) { e.setSensitivity(pick([.5, .8, 1, 1.5, 2, -1, "x"])); }
      else if (r < .2) { const f = pick(["absorption", "exhaustion", "burst", "wall"]); e.setFamily(f, false); phase(); e.setFamily(f, true); }
      else if (r < .23) { e.setDetector(pick(["wall_appears", "book_thin", "failed_poke", "refreshing_level", "nope"]), chance(.5)); }
      else if (r < .26) { e.closeEpisodes(chance(.5) ? undefined : t); }
      else if (r < .3) {                                                                         // malformed inputs
        e.onBook("bn", t, [], [[100, 1]]); e.onBook("hl", t, [[100, 0], [99, NaN], null, "12", 5], [[101, -1], "x", [102, "3"]]); e.onBook("zz", t, [[1, 1]], [[2, 1]]); e.onBook("bn", t, null, undefined);
        e.onTrade(null); e.onTrade({ t, v: "bn", side: "buy", px: -1, q: 1, ntl: 1 }); e.onTrade({ t, v: "hl", side: "sell", px: mid.hl, q: null, ntl: mid.hl, users: null }); e.onTrade({ t, v: "xx" });
        e.onQuote("bn", t, 100, 99); e.onQuote("hl", NaN, 1, 2); e.onSweep("zz", t, "buy", 1, 1); e.advance(-5); e.advance(null); inputs += 15;
      }
      else if (r < .33) { e.state(); e.formingEpisodes(); }
      else if (r < .36) { const d = e.debug(); d.sigmaBps(pick(["bn", "hl"])); d.robustZ(rand() * 1e5, pick(["bn", "hl"]), pick(["buy", "sell"]), 1); d.walletEvidence("hl", pick(["buy", "sell"]), t - 10000); d.stat(pick(["bn", "hl"]), pick(["buy", "sell", "ret"])); }
    };
    let detail = "ok", ok = true;
    const seen = new Set(), seenEv = new Set();
    try {
      for (let i = 0; i < 150 * 4; i++) step(calm, 250);      // the engine calibrates (two minutes) before it detects anything
      for (let i = 0; i < o.phases; i++) {
        phase(); if (chance(.5)) extra();
        if (o.check) { compareAll(e.pair, "seed " + seed + " phase " + i); checks++; }
        for (const x of e.pair.a.episodes) seen.add(x.family + "|" + x.id + "|" + x.tStart); for (const x of e.pair.a.events) seenEv.add(x.type + "|" + x.id + "|" + x.t);
      }
      compareAll(e.pair, "seed " + seed + " end"); checks++;
    } catch (err) { ok = false; detail = String(err && err.parity ? err.message : (err && err.stack) || err); }
    e.pair.b.dispose();
    const fam = {}; for (const k of seen) { const f = k.split("|")[0]; fam[f] = (fam[f] || 0) + 1; }
    const types = {}; for (const k of seenEv) { const f = k.split("|")[0]; types[f] = (types[f] || 0) + 1; }
    return { ok, detail, inputs, checks, cfg: J(cfg), episodes: seen.size, families: fam, events: seenEv.size, types };
  }
  return { pair, selftest, random, compareAll, cmp };
})();
