# Market Reader - Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only **Reader** tab to `stream-visualizer.html` that runs a message-driven detection engine (volume-clock windows, state strip, event feed, wall/book detectors, capitulation/squeeze/breakout detectors) and keeps working in a hidden tab.

**Architecture:** A pure-logic engine (`READER_ENGINE`, no DOM, no timers) lives in its own `<script id="reader-engine">` block inside the HTML file. It is fed by thin hooks in the existing WebSocket handlers and advances only on exchange timestamps. A second block (`READER_SELFTEST`) holds a deterministic market simulator and named scenarios shared by Node tests and the browser. The Reader tab only renders engine state while visible. Node's built-in test runner extracts the two blocks from the HTML and tests them with no browser.

**Tech Stack:** Vanilla JS in the existing single HTML file (no dependencies). Node 24 `node:test` for logic tests. Chrome DevTools console for in-browser checks.

**Spec:** `docs/superpowers/specs/2026-10-09-market-reader-design.md` (read it first; this plan implements its Phase 1).

**Scope:** Spec Phase 1 only (section 12). Phases 2 (absorption, exhaustion, wallet evidence, chart markers) and 3 (multi-horizon consensus, cross-venue, sensitivity polish) get separate plans written after Phase 1's soak test, because their thresholds depend on what live data shows.

## Global Constraints

Copied from the spec; every task's requirements implicitly include these.

- Project: `stream-visualizer.html` (single file, no dependencies). No build step; no new runtime libraries.
- "The Reader's engine is therefore driven by incoming messages and exchange timestamps, never by timers or animation frames. Rendering is separate and only runs while the tab is visible."
- Read-only. "Never touches the order ticket or accounts."
- Live only: "Last 500 events in memory, gone on refresh." No persistence, no export, no alerts or sound.
- "For the first ~2 minutes after Connect (or an asset change) detectors are disarmed and the strip says 'calibrating'."
- "Every detector has a cooldown per (type, venue, side, price zone), default 5 s, and the feed has a global cap of 20 events per minute (lowest strength dropped first)."
- "All thresholds below are initial defaults to be tuned on live data." Defaults live in one place (`DEFAULTS`) and are never scattered as magic numbers.
- Hooks "never throw into the host handler" (wrapped in try/catch).
- Evidence strings are short, factual and numeric. The wording is "spoof-like", never an accusation.
- Windows are measured in normal-market activity (volume clock): fast = 15 s-worth, mid = 60 s-worth, slow = 300 s-worth, clamped to 3 s - 10 min.

## Deviations From The Spec (written back into the spec in Task 12)

1. **Wall pulled** is "less than 20% of the lost size traded at or through the wall's price in the last 1.5 s" instead of "no trade at or through its price and price not within one tick". Tick size is not known per venue; the traded-fraction rule covers the same case.
2. **Capitulation, squeeze and breakout run on Binance only** in Phase 1 (they need liquidations and Binance leads). Hyperliquid variants arrive with cross-venue work in Phase 3. Wall and book detectors run on both venues.
3. **Imbalance flip:** the first established lean is recorded silently; an event fires only when the lean changes sign.
4. **Soak test:** "visible vs hidden within 10%" is replaced by **replay determinism**: record the engine's inputs during a hidden-tab soak, replay them offline, and require identical events. The automation browser window cannot be made visible; an optional manual visible-tab comparison is described in Task 12.
5. **Heartbeat** advances the engine to `nowEx() - 1500` ms (a grace period for delivery latency) so slightly late trades still land in the right bucket.
6. **Sensitivity and per-detector toggles ship in Phase 1** (the engine support is a few lines and the Reader tab needs them to be useful); the spec listed sensitivity under Phase 3, which keeps only consensus and cross-venue work.

## Review Focus

Failure modes the spec implies but a straight reading would not test. Each has a test in the task that owns the code.

1. **A reconnect or long stall (gap over 30 s)** must not produce fake events, NaN or a crash; calibration restarts and old events stay. (Task 2)
2. **A quiet or empty market** (no trades, a single trade, zero baseline) must not divide by zero or emit events. (Tasks 3, 4, 8)
3. **Switching asset or pressing Connect** must clear walls, baselines and events from the previous asset so nothing stale appears. (Tasks 1, 9)
4. **Hyperliquid's replay of recent trades on subscribe** (flagged `bf` in the existing code) must not reach the engine, or Connect would look like a burst. (Task 9)
5. **Malformed books** (empty side, crossed book, zero or NaN sizes, fewer than 10 levels, unknown venue) must be ignored without throwing or inventing walls. (Task 6)

## File Structure

- **Modify** `stream-visualizer.html`:
  - `<script id="reader-engine">`: pure engine (`READER_ENGINE.create`, `READER_ENGINE.replay`). Inserted before the main `<script>`.
  - `<script id="reader-selftest">`: simulator + named scenarios (`READER_SELFTEST`). Inserted right after the engine block.
  - Main script: hooks, `READER` instance, heartbeat worker, tab rendering.
  - CSS, `TABS` entry, HTML sections for the Reader tab.
- **Create** `package.json` (test script), `tests/load-engine.js` (extracts the blocks into a Node `vm`), `tests/engine.test.js` (unit tests), `tests/scenarios.test.js` (runs every named scenario), `tests/replay.js` (soak replay checker).
- **Modify** `docs/superpowers/specs/2026-10-09-market-reader-design.md` (Task 12: record deviations).

**Testing note:** objects created inside the `vm` context come from a different realm, so `assert.deepStrictEqual` on raw engine objects fails on prototypes. Compare primitives, or `JSON.parse(JSON.stringify(x))`.

**Run tests with:** `npm test` (from the project folder). Expected final result for the plan: all tests pass.

---

### Task 1: Test harness and engine skeleton

**Files:**
- Create: `package.json`, `tests/load-engine.js`, `tests/engine.test.js`
- Modify: `stream-visualizer.html` (insert before the main `<script>`, near line 349)

**Interfaces:**
- Produces: `READER_ENGINE.create(cfg?) -> engine` with `engine.cfg`, `engine.reset()`, `engine.subscribe(fn) -> unsubscribe`, `engine.events` (getter, current array), `engine.debug() -> object` (test hook). `READER_ENGINE.DEFAULTS`.
- Anchors left in the engine for later tasks: `// -- anchor: inputs --`, `// -- anchor: debug additions --`, `// -- anchor: api additions --`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "stream-visualizer",
  "private": true,
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
```

- [ ] **Step 2: Create `tests/load-engine.js`**

```js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = path.join(__dirname, '..', 'stream-visualizer.html');

function block(html, id) {
  const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'));
  return m ? m[1] : null;
}

// Runs the engine (and, once it exists, the self-test block) in an isolated context, exactly as the page does.
function load() {
  const html = fs.readFileSync(HTML, 'utf8');
  const ctx = vm.createContext({ console });
  const engineSrc = block(html, 'reader-engine');
  if (!engineSrc) throw new Error('stream-visualizer.html has no <script id="reader-engine"> block');
  vm.runInContext(engineSrc, ctx, { filename: 'reader-engine' });
  const selfSrc = block(html, 'reader-selftest');
  if (selfSrc) vm.runInContext(selfSrc, ctx, { filename: 'reader-selftest' });
  return {
    engine: vm.runInContext('READER_ENGINE', ctx),
    selftest: selfSrc ? vm.runInContext('READER_SELFTEST', ctx) : null,
  };
}

module.exports = { load };
```

- [ ] **Step 3: Write the failing tests in `tests/engine.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load-engine');

const { engine: E, selftest: S } = load();
const T0 = 1700000000000; // a multiple of 250 ms, so bucket edges are easy to reason about

test('create() returns an engine with no events and default settings', () => {
  const e = E.create();
  assert.equal(e.events.length, 0);
  assert.equal(e.cfg.sens, 1);
  assert.equal(e.cfg.bucketMs, 250);
});

test('config overrides merge over defaults, including the nested detector and horizon maps', () => {
  const e = E.create({ cooldownMs: 1000, detectors: { wall_pulled: false }, horizons: { fast: 10000 } });
  assert.equal(e.cfg.cooldownMs, 1000);
  assert.equal(e.cfg.detectors.wall_pulled, false);
  assert.equal(e.cfg.detectors.wall_appears, true);
  assert.equal(e.cfg.horizons.fast, 10000);
  assert.equal(e.cfg.horizons.slow, 300000);
});

test('subscribe returns an unsubscribe function; reset empties the events array', () => {
  const e = E.create();
  const off = e.subscribe(() => {});
  assert.equal(typeof off, 'function');
  off();
  e.debug().events.push({ id: 1 });
  e.reset();
  assert.equal(e.events.length, 0);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test`
Expected: FAIL with `stream-visualizer.html has no <script id="reader-engine"> block`.

- [ ] **Step 5: Insert the engine skeleton**

In `stream-visualizer.html`, replace these three lines (they are unique):

```
<script>
"use strict";
// ---------- stream catalogue ----------
```

with:

```html
<script id="reader-engine">
"use strict";
// Market Reader engine: pure logic, no DOM, no timers. It advances only on the events it is fed (exchange time, ms).
const READER_ENGINE = (() => {
  const DEFAULTS = {
    bucketMs: 250, keepMs: 1800000, warmupMs: 120000, baseTauMs: 1800000,
    horizons: { fast: 15000, mid: 60000, slow: 300000 }, minWindowMs: 3000, maxWindowMs: 600000,
    gapResetMs: 30000, cooldownMs: 5000, maxEventsPerMin: 20, keepEvents: 500, sens: 1,
    detectors: {
      wall_appears: true, wall_pulled: true, wall_eaten: true, book_thin: true, imbalance_flip: true, spoof_like: true,
      capitulation: true, selling_exhausted: true, squeeze: true, breakout: true,
    },
    // walls and book
    wallRatio: 8, wallMinLevels: 10, wallBps: 30, wallConfirmMs: 2000, wallDropFrac: 0.7, wallEatFrac: 0.6, wallPulledFrac: 0.2,
    thinFrac: 0.6, thinBps: 10, imbTop: 10, imbEnter: 0.35, imbExit: 0.15, imbHoldMs: 3000, spoofCount: 3, spoofSpanMs: 5000,
    // bursts
    burstZ: 3, burstShare: 0.7, burstSigma: 1.5, burstSupports: 2, endFrac: 0.4, endHoldMs: 3000, endBookRecover: 1.3, endExpireMs: 120000,
  };
  const VENUES = ["bn", "hl"];
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const clamp01 = x => clamp(x, 0, 1);
  const push = (arr, x, cap) => { arr.push(x); if (arr.length > cap) arr.shift(); };
  const money = x => x >= 1e6 ? (x / 1e6).toFixed(1) + "M" : x >= 1e3 ? Math.round(x / 1e3) + "k" : x.toFixed(0);

  function create(userCfg) {
    const cfg = Object.assign({}, DEFAULTS, userCfg || {});
    cfg.detectors = Object.assign({}, DEFAULTS.detectors, (userCfg && userCfg.detectors) || {});
    cfg.horizons = Object.assign({}, DEFAULTS.horizons, (userCfg && userCfg.horizons) || {});
    const th = k => cfg[k] / cfg.sens;           // thresholds that get easier to reach as sensitivity rises
    const listeners = [];
    const dbg = {};
    let events, seq, now, firstT, curStart, venues, lastEmit;

    function mkVenue() {
      return {
        px: null, mid: null, spread: null, cur: null, ring: [],
        base: 0, baseN: 0, samples: { buy: [], sell: [], ret: [] }, stats: {},
        depth: { bid: 0, ask: 0 }, depthRing: { bid: [], ask: [] }, imb: 0, bookMid: null,
        bids: [], asks: [], bookT: 0, recent: [], walls: new Map(), vanished: [],
        imbState: 0, imbPending: 0, imbPendingSince: 0, lastImbLean: 0, cap: null, sqLockUntil: 0,
      };
    }
    function reset() {
      events = []; seq = 0; now = 0; firstT = null; curStart = null; lastEmit = new Map();
      venues = { bn: mkVenue(), hl: mkVenue() };
    }
    function subscribe(fn) {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    }
    // -- anchor: inputs --

    reset();
    const api = { cfg, reset, subscribe, debug: () => Object.assign({ venues, now, firstT, curStart, events }, dbg) };
    Object.defineProperty(api, "events", { get: () => events });
    // -- anchor: debug additions --
    // -- anchor: api additions --
    return api;
  }
  return { create, DEFAULTS };
})();
</script>
<script>
"use strict";
// ---------- stream catalogue ----------
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test`
Expected: PASS, 3 tests.

- [ ] **Step 7: Smoke-check the page still loads**

Run: `node -e "const h=require('fs').readFileSync('stream-visualizer.html','utf8'); console.log((h.match(/<script/g)||[]).length + ' script tags')"`
Expected: `2 script tags`.

- [ ] **Step 8: Commit**

```bash
git add package.json tests/load-engine.js tests/engine.test.js stream-visualizer.html
git commit -m "feat(reader): test harness and engine skeleton

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Event-time buckets, clock, gap handling

**Files:**
- Modify: `stream-visualizer.html` (engine block: replace `// -- anchor: inputs --` and the `// -- anchor: api additions --` line)
- Test: `tests/engine.test.js` (append)

**Interfaces:**
- Consumes: Task 1 skeleton (`mkVenue`, `reset`, `cfg`, `venues`, `now`, `firstT`, `curStart`).
- Produces (all on the engine): `onTrade({t, v, side, px, q, ntl, liq?})`, `onQuote(v, t, bid, ask)`, `onSweep(v, t, side, ntl, levels)`, `advance(t)`. Internal: `tick(t)`, `openBucket`, `closeBucket`, `softReset(t)`, `onSecond(t)` (empty stub now; Task 3 replaces it). A closed bucket is `{t0, buy, sell, n, maxTrade, open, hi, lo, close, liqBuyN, liqSellN, sweepBuyN, sweepSellN, bidDepth, askDepth, spread}`; `debug().venues.bn.ring` holds them oldest-first.

- [ ] **Step 1: Write the failing tests (append to `tests/engine.test.js`)**

```js
const buy = (t, ntl = 100, v = 'bn') => ({ t, v, side: 'buy', px: 100, q: ntl / 100, ntl });
const sell = (t, ntl = 100, v = 'bn') => ({ t, v, side: 'sell', px: 100, q: ntl / 100, ntl });

test('trades inside one 250 ms bucket are summed; crossing the boundary closes it', () => {
  const e = E.create();
  e.onTrade(buy(T0 + 10, 100));
  e.onTrade(sell(T0 + 200, 200));
  assert.equal(e.debug().venues.bn.ring.length, 0);
  e.onTrade(buy(T0 + 260, 50));
  const ring = e.debug().venues.bn.ring;
  assert.equal(ring.length, 1);
  assert.equal(ring[0].buy, 100);
  assert.equal(ring[0].sell, 200);
  assert.equal(ring[0].n, 2);
  assert.equal(ring[0].maxTrade, 200);
});

test('a silent gap is filled with empty buckets', () => {
  const e = E.create();
  e.onTrade(buy(T0, 100));
  e.onTrade(buy(T0 + 1000, 100));
  const ring = e.debug().venues.bn.ring;
  assert.equal(ring.length, 4);
  assert.equal(ring[0].buy, 100);
  assert.equal(ring[1].buy + ring[1].sell, 0);
  assert.equal(ring[3].buy + ring[3].sell, 0);
});

test('a late trade is counted in the current bucket instead of being lost', () => {
  const e = E.create();
  e.onTrade(buy(T0 + 1000, 100));
  e.onTrade(buy(T0 + 100, 70));
  assert.equal(e.debug().venues.bn.cur.buy, 170);
});

test('a gap over 30 s soft-resets the buckets and baselines but keeps events (review focus 1)', () => {
  const e = E.create();
  e.onTrade(buy(T0, 100));
  e.onTrade(buy(T0 + 1000, 100));
  e.debug().events.push({ id: 99, type: 'keep_me' });
  e.onTrade(buy(T0 + 40000, 100));
  const v = e.debug().venues.bn;
  assert.equal(v.ring.length, 0);
  assert.equal(v.baseN, 0);
  assert.equal(e.events.length, 1);
  assert.equal(e.debug().firstT, T0 + 40000);
  assert.equal(v.cur.buy, 100);
});

test('bad inputs are ignored without throwing', () => {
  const e = E.create();
  assert.doesNotThrow(() => {
    e.onTrade(null); e.onTrade({}); e.onTrade({ t: T0, v: 'zz', side: 'buy', px: 1, q: 1, ntl: 1 });
    e.onTrade({ t: NaN, v: 'bn', side: 'buy', px: 1, q: 1, ntl: 1 }); e.onTrade(buy(T0, NaN)); e.onTrade(buy(T0, -5));
    e.onQuote('bn', T0, NaN, 5); e.onQuote('bn', T0, 5, 4); e.onSweep('zz', T0, 'buy', 1, 2); e.advance(NaN);
  });
  assert.equal(e.debug().venues.bn.ring.length, 0);
});

test('liquidations count as evidence only, never as traded volume', () => {
  const e = E.create();
  e.onTrade(Object.assign(sell(T0 + 10, 500), { liq: true }));
  e.onTrade(Object.assign(buy(T0 + 20, 700), { liq: true }));
  e.onTrade(buy(T0 + 300, 1));
  const b = e.debug().venues.bn.ring[0];
  assert.equal(b.liqSellN, 1);
  assert.equal(b.liqBuyN, 1);
  assert.equal(b.buy + b.sell, 0);
});

test('quotes set mid, spread and the bucket high/low; sweeps are counted by side', () => {
  const e = E.create();
  e.onQuote('bn', T0 + 10, 99, 101);
  e.onQuote('bn', T0 + 20, 100, 102);
  e.onSweep('bn', T0 + 30, 'sell', 5000, 3);
  e.onSweep('bn', T0 + 40, 'buy', 5000, 2);
  e.onQuote('bn', T0 + 300, 100, 102);
  const b = e.debug().venues.bn.ring[0];
  assert.equal(b.open, 100);
  assert.equal(b.hi, 101);
  assert.equal(b.lo, 100);
  assert.equal(b.close, 101);
  assert.equal(b.sweepSellN, 1);
  assert.equal(b.sweepBuyN, 1);
  assert.equal(e.debug().venues.bn.spread, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL (`e.onTrade is not a function`).

- [ ] **Step 3: Implement**

In the engine, replace the line `    // -- anchor: inputs --` with:

```js
    function openBucket(v, t0) {
      const p = v.px;
      v.cur = { t0, buy: 0, sell: 0, n: 0, maxTrade: 0, open: p, hi: p, lo: p, close: p,
                liqBuyN: 0, liqSellN: 0, sweepBuyN: 0, sweepSellN: 0,
                bidDepth: v.depth.bid, askDepth: v.depth.ask, spread: v.spread };
    }
    function touch(v, p) {
      if (!(p > 0)) return;
      v.px = p;
      const c = v.cur;
      if (c.open == null) { c.open = c.hi = c.lo = p; } else { if (p > c.hi) c.hi = p; if (p < c.lo) c.lo = p; }
      c.close = p;
    }
    function onSecond() {}                       // replaced in Task 3
    function closeBucket() {
      const endT = curStart + cfg.bucketMs;
      for (const k of VENUES) {
        const v = venues[k], c = v.cur;
        if (v.px != null) c.close = v.px;
        c.bidDepth = v.depth.bid; c.askDepth = v.depth.ask; c.spread = v.spread;
        v.ring.push(c);
        const keep = Math.ceil(cfg.keepMs / cfg.bucketMs);
        if (v.ring.length > keep) v.ring.splice(0, v.ring.length - keep);
        const rate = (c.buy + c.sell) / (cfg.bucketMs / 1000);
        v.baseN++;
        const a = Math.max(1 / v.baseN, 1 - Math.exp(-cfg.bucketMs / cfg.baseTauMs));
        v.base += a * (rate - v.base);
      }
      if (Math.floor(endT / 1000) !== Math.floor((endT - cfg.bucketMs) / 1000)) onSecond(endT);
    }
    function softReset(t) {                      // a long stall (reconnect): drop history, keep events, recalibrate
      for (const k of VENUES) {
        Object.assign(venues[k], {
          ring: [], base: 0, baseN: 0, samples: { buy: [], sell: [], ret: [] }, stats: {},
          depthRing: { bid: [], ask: [] }, recent: [], walls: new Map(), vanished: [],
          cap: null, imbState: 0, imbPending: 0, imbPendingSince: 0, sqLockUntil: 0,
        });
      }
      firstT = t;
      curStart = Math.floor(t / cfg.bucketMs) * cfg.bucketMs;
      for (const k of VENUES) openBucket(venues[k], curStart);
    }
    function tick(t) {
      if (!(t > 0)) return;
      if (curStart == null) {
        firstT = t; now = t; curStart = Math.floor(t / cfg.bucketMs) * cfg.bucketMs;
        for (const k of VENUES) openBucket(venues[k], curStart);
        return;
      }
      if (t <= now) return;                      // never move backwards; late events join the open bucket
      now = t;
      if (t - (curStart + cfg.bucketMs) > cfg.gapResetMs) { softReset(t); return; }
      while (t >= curStart + cfg.bucketMs) {
        closeBucket();
        curStart += cfg.bucketMs;
        for (const k of VENUES) openBucket(venues[k], curStart);
      }
    }
    function onTrade(tr) {
      if (!tr || !VENUES.includes(tr.v) || !(tr.ntl > 0) || !(tr.px > 0) || !(tr.t > 0)) return;
      tick(tr.t);
      const v = venues[tr.v], c = v.cur;
      if (tr.liq) { if (tr.side === "buy") c.liqBuyN++; else c.liqSellN++; return; }
      if (tr.side === "buy") c.buy += tr.ntl; else c.sell += tr.ntl;
      c.n++;
      if (tr.ntl > c.maxTrade) c.maxTrade = tr.ntl;
      if (v.mid == null) touch(v, tr.px);        // no quotes yet: the price series comes from trades
      v.recent.push({ t: tr.t, px: tr.px, q: tr.q, side: tr.side });
      while (v.recent.length && v.recent[0].t < now - 5000) v.recent.shift();
    }
    function onQuote(vn, t, bid, ask) {
      if (!VENUES.includes(vn) || !(bid > 0) || !(ask > 0) || ask < bid || !(t > 0)) return;
      tick(t);
      const v = venues[vn];
      v.mid = (bid + ask) / 2; v.spread = ask - bid;
      touch(v, v.mid);
    }
    function onSweep(vn, t, side, ntl, levels) {
      if (!VENUES.includes(vn) || !(t > 0)) return;
      tick(t);
      const c = venues[vn].cur;
      if (side === "buy") c.sweepBuyN++; else c.sweepSellN++;
    }
    function advance(t) { tick(t); }             // heartbeat: closes buckets when no messages arrive
```

and replace the line `    // -- anchor: api additions --` with:

```js
    Object.assign(api, { onTrade, onQuote, onSweep, advance });
    // -- anchor: api additions --
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add stream-visualizer.html tests/engine.test.js
git commit -m "feat(reader): event-time buckets, gap handling, input guards

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Simulator scaffold, baseline, calibration, robust statistics

**Files:**
- Modify: `stream-visualizer.html` (engine: `onSecond` stub + new functions; new `<script id="reader-selftest">` block placed right after the engine block)
- Create: `tests/scenarios.test.js`
- Test: `tests/engine.test.js` (append)

**Interfaces:**
- Consumes: Task 2 (`closeBucket` calls `onSecond(endT)` once per exchange second; `v.base`, `v.baseN`, `v.ring`).
- Produces (engine): `isCalibrated()`, `sample(vn)`, `stat(v, key) -> {n, med, mad, at}`, `robustZ(x, vn, key, floor) -> number`, `sigmaBps(vn)`; all reachable from tests through `debug()` (`isCalibrated`, `stat(vn,key)`, `robustZ`, `sigmaBps`). Per venue `samples.{buy,sell,ret}` (1 s samples, max 1800) and `depthRing.{bid,ask}` (max 30).
- Produces (selftest): `READER_SELFTEST = { T0, rng, poisson, levels, sim, scenarios, run }`. `sim(engine, opts)` drives an engine with a deterministic Binance-like stream and returns `{t, mid}` so phases can be chained. `scenarios` is an array of `{name, run(Eng) -> {ok, detail}}`; `run(Eng)` returns `[{name, ok, detail}]`.
- Anchors: engine `// -- anchor: rate samples --`, `// -- anchor: detectors per second --`; selftest `// -- anchor: scenarios --`.

- [ ] **Step 1: Write the failing tests (append to `tests/engine.test.js`)**

```js
test('detectors stay disarmed for the first two minutes, then arm', () => {
  const a = E.create(); S.sim(a, { seconds: 100 });
  assert.equal(a.debug().isCalibrated(), false);
  const b = E.create(); S.sim(b, { seconds: 130 });
  assert.equal(b.debug().isCalibrated(), true);
});

test('baseline $/s converges to the simulated traded rate (about 20 trades/s x $1,640)', () => {
  const e = E.create(); S.sim(e, { seconds: 130 });
  const base = e.debug().venues.bn.base;
  assert.ok(base > 28000 && base < 38000, 'base was ' + base);
});

test('one-second samples accumulate and are capped', () => {
  const e = E.create(); S.sim(e, { seconds: 130 });
  const v = e.debug().venues.bn;
  assert.ok(v.samples.ret.length > 100, 'ret samples: ' + v.samples.ret.length);
  assert.ok(v.depthRing.bid.length <= 30);
});

test('robust stats use median and scaled MAD', () => {
  const e = E.create();
  const arr = e.debug().venues.bn.samples.ret;
  for (let i = 0; i <= 100; i++) arr.push(i);
  const s = e.debug().stat('bn', 'ret');
  assert.equal(s.med, 50);
  assert.ok(Math.abs(s.mad - 37.065) < 0.01, 'mad ' + s.mad);
  const z = e.debug().robustZ(150, 'bn', 'ret', 0.05);
  assert.ok(z > 2.6 && z < 2.8, 'z ' + z);
});

test('z-scores are 0 until there are enough samples, and never divide by zero', () => {
  const e = E.create();
  assert.equal(e.debug().robustZ(1e9, 'bn', 'sell', 1), 0);
  const arr = e.debug().venues.bn.samples.sell;
  for (let i = 0; i < 100; i++) arr.push(0);   // a dead market: median 0, MAD 0
  const z = e.debug().robustZ(5000, 'bn', 'sell', 1);
  assert.ok(Number.isFinite(z) && z > 100, 'z ' + z);
  assert.ok(e.debug().sigmaBps('bn') >= 0.05);
});
```

- [ ] **Step 2: Create `tests/scenarios.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load-engine');

const { engine: E, selftest: S } = load();

if (!S) throw new Error('stream-visualizer.html has no <script id="reader-selftest"> block');

for (const sc of S.scenarios) {
  test('scenario: ' + sc.name, () => {
    const r = sc.run(E);
    assert.ok(r.ok, r.detail);
  });
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test`
Expected: FAIL (`S` is null: `Cannot read properties of null (reading 'sim')`, and `scenarios.test.js` throws the missing-block error).

- [ ] **Step 4: Add the self-test block**

In `stream-visualizer.html`, immediately after the line `</script>` that closes `<script id="reader-engine">` (and before the `<script>` that starts the main script), insert:

```html
<script id="reader-selftest">
"use strict";
// Deterministic market simulator and named scenarios, shared by the Node tests and the in-page READER.selfTest().
const READER_SELFTEST = (() => {
  const T0 = 1700000000000;                      // a multiple of 250 ms
  function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  function poisson(rand, lam) {
    if (lam <= 0) return 0;
    if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * (rand() + rand() + rand() - 1.5) * 2));
    const L = Math.exp(-lam); let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }
  // 30 book levels on one side of mid; `walls` = [{idx, size}] overrides individual level sizes
  function levels(mid, dir, mult, walls, t) {
    const out = [];
    for (let i = 0; i < 30; i++) out.push([+(mid + dir * (0.05 + 0.1 * i)).toFixed(2), 0.5 * mult * (1 + 0.1 * Math.sin(i * 1.7 + t / 1000))]);
    for (const w of walls) if (w.idx >= 0 && w.idx < 30) out[w.idx][1] = w.size;
    return out;
  }
  // Drives `engine` with a Binance-like stream. params(sec, mid) may return any of the keys in `base` below.
  function sim(engine, opts) {
    const o = Object.assign({ t0: T0, mid0: 82000, seed: 7, seconds: 150, stepMs: 250, venue: "bn", params: () => ({}) }, opts);
    const rand = rng(o.seed), dt = o.stepMs / 1000, steps = Math.round(o.seconds * 1000 / o.stepMs);
    let t = o.t0, mid = o.mid0;
    for (let i = 0; i < steps; i++) {
      t += o.stepMs;
      const p = Object.assign({ rate: 20, buyP: 0.5, driftBps: 0, vol: 0.3, size: 0.02, bidMult: 1, askMult: 1,
        bidWalls: [], askWalls: [], liqSell: 0, liqBuy: 0, sweepSell: 0, sweepBuy: 0, trades: [] }, o.params((t - o.t0) / 1000, mid));
      mid *= 1 + (p.driftBps * dt + (rand() - 0.5) * 2 * p.vol) / 1e4;
      engine.onQuote(o.venue, t, mid - 0.05, mid + 0.05);
      for (let k = poisson(rand, p.rate * dt); k > 0; k--) {
        const b = rand() < p.buyP, q = p.size * (0.5 + rand()), px = b ? mid + 0.05 : mid - 0.05;
        engine.onTrade({ t, v: o.venue, side: b ? "buy" : "sell", px, q, ntl: px * q });
      }
      for (const tr of p.trades) engine.onTrade(Object.assign({ t, v: o.venue }, tr));
      for (let k = poisson(rand, p.liqSell * dt); k > 0; k--) engine.onTrade({ t, v: o.venue, side: "sell", px: mid - 0.05, q: 0.5, ntl: (mid - 0.05) * 0.5, liq: true });
      for (let k = poisson(rand, p.liqBuy * dt); k > 0; k--) engine.onTrade({ t, v: o.venue, side: "buy", px: mid + 0.05, q: 0.5, ntl: (mid + 0.05) * 0.5, liq: true });
      for (let k = poisson(rand, p.sweepSell * dt); k > 0; k--) engine.onSweep(o.venue, t, "sell", 50000, 3);
      for (let k = poisson(rand, p.sweepBuy * dt); k > 0; k--) engine.onSweep(o.venue, t, "buy", 50000, 3);
      engine.onBook(o.venue, t, levels(mid, -1, p.bidMult, p.bidWalls, t), levels(mid, 1, p.askMult, p.askWalls, t));
    }
    return { t, mid };
  }
  const scenarios = [];
  const add = (name, run) => scenarios.push({ name, run });
  const calm = (e, seconds) => sim(e, { seconds: seconds || 150, seed: 3 });
  const has = (e, type, dir) => e.events.some(x => x.type === type && (!dir || x.dir === dir));
  const result = (ok, e, want) => ({ ok, detail: ok ? "ok" : "wanted " + want + "; got [" + Array.from(e.events, x => x.type + ":" + x.dir).join(", ") + "]" });
  // -- anchor: scenarios --
  function run(Eng) {
    return scenarios.map(sc => {
      try { const r = sc.run(Eng); return { name: sc.name, ok: !!r.ok, detail: r.detail }; }
      catch (err) { return { name: sc.name, ok: false, detail: String(err && err.stack || err) }; }
    });
  }
  return { T0, rng, poisson, levels, sim, scenarios, run };
})();
</script>
```

Note: `sim` calls `engine.onBook`, which is only implemented in Task 6. Until then, give the engine a harmless placeholder so Tasks 3 to 5 can run: in the engine, directly under `function advance(t) { tick(t); }`, add `function onBook() {}      // replaced in Task 6`. It is exposed on the API in Task 4 (`Object.assign(api, {..., onBook, ...})`).

- [ ] **Step 5: Implement baseline, calibration, samples, stats in the engine**

Replace the engine's stub line `    function onSecond() {}                       // replaced in Task 3` with:

```js
    function isCalibrated() { return firstT != null && now - firstT >= cfg.warmupMs && venues.bn.baseN > 0; }
    function sample(vn) {
      const v = venues[vn], r = v.ring;
      if (r.length < 8) return;
      // -- anchor: rate samples --
      const n = r.length;
      if (n > 4 && r[n - 5].close > 0) push(v.samples.ret, (r[n - 1].close / r[n - 5].close - 1) * 1e4, 1800);
      push(v.depthRing.bid, v.depth.bid, 30); push(v.depthRing.ask, v.depth.ask, 30);
    }
    function stat(v, key) {
      const arr = v.samples[key], c = v.stats[key];
      if (arr.length < 30) return { n: arr.length, med: 0, mad: 0, at: now };
      if (c && now - c.at < 5000) return c;
      const s = arr.slice().sort((a, b) => a - b), med = s[s.length >> 1];
      const dev = s.map(x => Math.abs(x - med)).sort((a, b) => a - b);
      return (v.stats[key] = { n: arr.length, med, mad: 1.4826 * dev[dev.length >> 1], at: now });
    }
    function robustZ(x, vn, key, floor) {
      const st = stat(venues[vn], key);
      if (st.n < 60) return 0;
      return (x - st.med) / Math.max(st.mad, 0.1 * Math.abs(st.med), floor);
    }
    function sigmaBps(vn) { return Math.max(stat(venues[vn], "ret").mad, 0.05); }
    function onSecond(t) {
      for (const k of VENUES) sample(k);
      if (!isCalibrated()) return;
      // -- anchor: detectors per second --
    }
```

and replace the line `    // -- anchor: debug additions --` with:

```js
    Object.assign(dbg, { isCalibrated, stat: (vn, k) => stat(venues[vn], k), robustZ, sigmaBps });
    // -- anchor: debug additions --
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test`
Expected: PASS (15 tests; `scenarios.test.js` reports 0 scenarios, which is fine for now).

- [ ] **Step 7: Commit**

```bash
git add stream-visualizer.html tests/engine.test.js tests/scenarios.test.js
git commit -m "feat(reader): simulator scaffold, baseline, calibration, robust stats

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Volume clock, horizons, state snapshot

**Files:**
- Modify: `stream-visualizer.html` (engine: replace `// -- anchor: rate samples --` and the `Object.assign(api, {...})` line)
- Test: `tests/engine.test.js` (append)

**Interfaces:**
- Consumes: Task 3 (`sample`, `venues.bn.base`, ring of closed buckets).
- Produces (engine API): `windowMs(name) -> ms` (name is `"fast" | "mid" | "slow"`), `horizon(vn, name) -> {ms, buy, sell, n, maxTrade, hi, lo, open, close, liqBuyN, liqSellN, sweepBuyN, sweepSellN, share, delta} | null` (`share` = buy share 0..1), `state() -> {calibrated, calibratingPct, now, ratio, regime: "calm"|"active"|"hot", horizons: {fast|mid|slow: {ms, share, delta, side: "buyers"|"sellers"|"balanced"} | null}, eventsPerMin, last, bookAgeMs: {bn, hl}}`.

- [ ] **Step 1: Write the failing tests (append to `tests/engine.test.js`)**

```js
function calmEngine(seconds) { const e = E.create(); const a = S.sim(e, { seconds: seconds || 130 }); return { e, a }; }

test('in a normal market the fast window is about its nominal 15 s', () => {
  const { e } = calmEngine();
  const w = e.windowMs('fast');
  assert.ok(w > 12000 && w < 19000, 'window ' + w);
});

test('in a fast market the windows shrink (volume clock), but never below the minimum', () => {
  const { e, a } = calmEngine();
  S.sim(e, { t0: a.t, mid0: a.mid, seconds: 10, seed: 8, params: () => ({ rate: 80 }) });
  const w = e.windowMs('fast');
  assert.ok(w < 6000 && w >= 3000, 'window ' + w);
  S.sim(e, { t0: a.t + 10000, mid0: a.mid, seconds: 10, seed: 9, params: () => ({ rate: 400 }) });
  assert.ok(e.windowMs('fast') >= 3000);
});

test('in a quiet market the windows stretch', () => {
  const { e, a } = calmEngine();
  S.sim(e, { t0: a.t, mid0: a.mid, seconds: 30, seed: 8, params: () => ({ rate: 5 }) });
  assert.ok(e.windowMs('fast') > 40000, 'window ' + e.windowMs('fast'));
});

test('horizon() aggregates the last window of buckets', () => {
  const { e } = calmEngine();
  const h = e.horizon('bn', 'fast');
  const expected = 32800 * (h.ms / 1000);
  assert.ok(h.buy + h.sell > 0.7 * expected && h.buy + h.sell < 1.3 * expected, 'flow ' + (h.buy + h.sell) + ' vs ' + expected);
  assert.ok(h.share > 0.3 && h.share < 0.7);
  assert.ok(h.hi >= h.lo && h.open > 0 && h.close > 0);
});

test('with no data, horizon() is null and state() is finite everywhere (review focus 2)', () => {
  const e = E.create();
  assert.equal(e.horizon('bn', 'fast'), null);
  const s = e.state();
  assert.equal(s.calibrated, false);
  assert.equal(s.ratio, 1);
  assert.equal(s.horizons.fast, null);
  assert.equal(s.eventsPerMin, 0);
  assert.equal(s.last, null);
  assert.equal(JSON.stringify(s).includes('NaN'), false);
});

test('state() names the side in control and the regime', () => {
  const { e, a } = calmEngine();
  S.sim(e, { t0: a.t, mid0: a.mid, seconds: 20, seed: 8, params: () => ({ buyP: 0.9 }) });
  const s = e.state();
  assert.equal(s.horizons.fast.side, 'buyers');
  assert.ok(['calm', 'active', 'hot'].includes(s.regime));
});

test('one-second rate samples feed the robust statistics', () => {
  const { e } = calmEngine();
  const v = e.debug().venues.bn;
  assert.ok(v.samples.sell.length > 100 && v.samples.buy.length > 100);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL (`e.windowMs is not a function`).

- [ ] **Step 3: Implement**

Replace the line `      // -- anchor: rate samples --` (inside `sample`) with:

```js
      const h = horizon(vn, "fast");
      if (h) { const s = h.ms / 1000; push(v.samples.buy, h.buy / s, 1800); push(v.samples.sell, h.sell / s, 1800); }
```

Then, directly above the line `    function onSecond(t) {`, add:

```js
    function rateRatio() {                       // recent Binance flow vs its long-run baseline, 0.25 .. 4
      const v = venues.bn, r = v.ring, n = Math.min(r.length, 20);
      if (n < 4 || !(v.base > 0)) return 1;
      let s = 0;
      for (let i = r.length - n; i < r.length; i++) s += r[i].buy + r[i].sell;
      return clamp((s / (n * cfg.bucketMs / 1000)) / v.base, 0.25, 4);
    }
    function windowMs(name) {
      const nominal = cfg.horizons[name];
      if (!(nominal > 0)) return NaN;
      return clamp(nominal / rateRatio(), cfg.minWindowMs, cfg.maxWindowMs);
    }
    function horizon(vn, name) {
      const v = venues[vn], r = v.ring;
      if (!r.length) return null;
      const ms = windowMs(name);
      if (!(ms > 0)) return null;
      const n = clamp(Math.round(ms / cfg.bucketMs), 1, r.length);
      const h = { ms: n * cfg.bucketMs, buy: 0, sell: 0, n: 0, maxTrade: 0, hi: -Infinity, lo: Infinity, open: null, close: null,
                  liqBuyN: 0, liqSellN: 0, sweepBuyN: 0, sweepSellN: 0 };
      for (let i = r.length - n; i < r.length; i++) {
        const b = r[i];
        h.buy += b.buy; h.sell += b.sell; h.n += b.n;
        if (b.maxTrade > h.maxTrade) h.maxTrade = b.maxTrade;
        if (b.hi != null) { if (b.hi > h.hi) h.hi = b.hi; if (b.lo < h.lo) h.lo = b.lo; if (h.open == null) h.open = b.open; h.close = b.close; }
        h.liqBuyN += b.liqBuyN; h.liqSellN += b.liqSellN; h.sweepBuyN += b.sweepBuyN; h.sweepSellN += b.sweepSellN;
      }
      if (h.open == null) return null;
      const tot = h.buy + h.sell;
      h.share = tot > 0 ? h.buy / tot : 0.5; h.delta = h.buy - h.sell;
      return h;
    }
    function state() {
      const bn = venues.bn, hl = venues.hl, ratio = rateRatio();
      const out = {
        calibrated: isCalibrated(), calibratingPct: firstT == null ? 0 : clamp01((now - firstT) / cfg.warmupMs), now, ratio,
        regime: ratio < 0.7 ? "calm" : ratio < 1.8 ? "active" : "hot", horizons: {},
        eventsPerMin: events.filter(x => x.t > now - 60000).length, last: events.length ? events[events.length - 1] : null,
        bookAgeMs: { bn: bn.bookT ? now - bn.bookT : null, hl: hl.bookT ? now - hl.bookT : null },
      };
      for (const k of Object.keys(cfg.horizons)) {
        const h = horizon("bn", k);
        out.horizons[k] = h ? { ms: h.ms, share: h.share, delta: h.delta, side: h.share >= 0.6 ? "buyers" : h.share <= 0.4 ? "sellers" : "balanced" } : null;
      }
      return out;
    }
```

Replace `    Object.assign(api, { onTrade, onQuote, onSweep, advance });` with:

```js
    Object.assign(api, { onTrade, onQuote, onSweep, advance, onBook, windowMs, horizon, state });
```

(`onBook` is already declared as a placeholder; this exposes it so `sim()` works.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (22 tests).

- [ ] **Step 5: Commit**

```bash
git add stream-visualizer.html tests/engine.test.js
git commit -m "feat(reader): volume-clock horizons and state snapshot

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Event pipeline (cooldown, rate cap, store, subscribers)

**Files:**
- Modify: `stream-visualizer.html` (engine: add `emit`, `setSensitivity`, `setDetector`; extend `dbg` and `api`)
- Test: `tests/engine.test.js` (append)

**Interfaces:**
- Consumes: Task 4 (`isCalibrated`, `events`, `lastEmit`, `listeners`, `now`).
- Produces: `emit(e) -> storedEvent | null` (internal; exposed as `debug().emit`). Event shape stored: `{id, t, type, family, dir: "bull"|"bear"|"neutral", venue, px, horizon, strength (0..1), evidence, refs}`. Public: `api.setSensitivity(x)` (clamped 0.5..2), `api.setDetector(name, on)` (ignores unknown names).

- [ ] **Step 1: Write the failing tests (append to `tests/engine.test.js`)**

```js
const mk = (type, px, strength, extra) => Object.assign({ type, family: 'wall', dir: 'bull', venue: 'bn', px, horizon: 'book', strength: strength == null ? 0.5 : strength, evidence: 'x', refs: {} }, extra || {});

test('emit refuses events before calibration', () => {
  const e = E.create();
  assert.equal(e.debug().emit(mk('wall_appears', 82000)), null);
  assert.equal(e.events.length, 0);
});

test('emit stores, numbers and announces an event', () => {
  const { e } = calmEngine();
  const heard = []; e.subscribe(x => heard.push(x.id));
  const r = e.debug().emit(mk('wall_appears', 82000));
  assert.equal(r.id, 1);
  assert.equal(e.events.length, 1);
  assert.equal(heard.length, 1);
  assert.equal(heard[0], 1);
  assert.equal(r.t, e.debug().now);
});

test('a disabled detector emits nothing; unknown names are ignored', () => {
  const { e } = calmEngine();
  e.setDetector('wall_appears', false);
  assert.equal(e.debug().emit(mk('wall_appears', 82000)), null);
  e.setDetector('wall_appears', true);
  assert.ok(e.debug().emit(mk('wall_appears', 82000)));
  assert.doesNotThrow(() => e.setDetector('no_such_detector', true));
  assert.equal(e.cfg.detectors.no_such_detector, undefined);
  assert.equal(e.debug().emit(mk('no_such_type', 82000)), null);
});

test('cooldown drops a repeat in the same zone but not another zone, side, or a later time', () => {
  const { e } = calmEngine();
  const now = e.debug().now, emit = e.debug().emit;
  assert.ok(emit(mk('wall_appears', 82000)));
  assert.equal(emit(mk('wall_appears', 82000)), null);
  assert.ok(emit(mk('wall_appears', 83000)));                               // another price zone
  assert.ok(emit(mk('wall_appears', 82000, 0.5, { dir: 'bear' })));        // another side
  assert.ok(emit(mk('wall_appears', 82000, 0.5, { t: now + 6000 })));      // after the 5 s cooldown
});

test('rate cap: at most 20 events per minute, the weakest is dropped first', () => {
  const { e } = calmEngine();
  const emit = e.debug().emit, t = e.debug().now;
  for (let i = 0; i < 20; i++) assert.ok(emit(mk('wall_appears', 80000 + i * 100, 0.5)));
  assert.equal(emit(mk('wall_appears', 90000, 0.4)), null);
  assert.ok(emit(mk('wall_appears', 91000, 0.9)));
  assert.equal(e.events.filter(x => x.t > t - 60000).length, 20);
  assert.equal(e.events.filter(x => x.strength === 0.9).length, 1);
});

test('strength is clamped to 0..1, and a throwing subscriber cannot stop the engine', () => {
  const { e } = calmEngine();
  e.subscribe(() => { throw new Error('boom'); });
  const r = e.debug().emit(mk('wall_appears', 82000, 7));
  assert.equal(r.strength, 1);
  const r2 = e.debug().emit(mk('wall_appears', 83000, -3));
  assert.equal(r2.strength, 0);
});

test('keepEvents trims the store; sensitivity is clamped', () => {
  const e = E.create({ keepEvents: 5, maxEventsPerMin: 1000 });
  S.sim(e, { seconds: 130 });
  for (let i = 0; i < 9; i++) e.debug().emit(mk('wall_appears', 80000 + i * 100));
  assert.equal(e.events.length, 5);
  e.setSensitivity(99); assert.equal(e.cfg.sens, 2);
  e.setSensitivity(0); assert.equal(e.cfg.sens, 1);          // invalid input falls back to the default
  e.setSensitivity(0.1); assert.equal(e.cfg.sens, 0.5);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL (`e.debug().emit is not a function`).

- [ ] **Step 3: Implement**

Directly above `function onSecond(t) {`, add:

```js
    function emit(e) {
      if (!isCalibrated() || !cfg.detectors[e.type]) return null;
      e.strength = clamp01(Number(e.strength) || 0);
      if (!(e.t > 0)) e.t = now;
      const zone = e.px > 0 ? Math.round(Math.log(e.px) / 2e-4) : 0;          // 2 bps price zones
      const key = e.type + "|" + e.venue + "|" + e.dir + "|" + zone, last = lastEmit.get(key);
      if (last != null && e.t - last < cfg.cooldownMs) return null;
      const recent = events.filter(x => x.t > e.t - 60000);
      if (recent.length >= cfg.maxEventsPerMin) {
        let weakest = recent[0];
        for (const x of recent) if (x.strength < weakest.strength) weakest = x;
        if (e.strength <= weakest.strength) return null;
        events.splice(events.indexOf(weakest), 1);
      }
      lastEmit.set(key, e.t);
      e.id = ++seq;
      events.push(e);
      if (events.length > cfg.keepEvents) events.shift();
      for (const fn of listeners) { try { fn(e); } catch (err) { /* a bad listener must never stop the engine */ } }
      return e;
    }
    function setSensitivity(x) { cfg.sens = clamp(Number(x) > 0 ? Number(x) : 1, 0.5, 2); }
    function setDetector(name, on) { if (Object.prototype.hasOwnProperty.call(cfg.detectors, name)) cfg.detectors[name] = !!on; }
```

Replace `    // -- anchor: debug additions --` with:

```js
    Object.assign(dbg, { emit });
    // -- anchor: debug additions --
```

Replace `    Object.assign(api, { onTrade, onQuote, onSweep, advance, onBook, windowMs, horizon, state });` with:

```js
    Object.assign(api, { onTrade, onQuote, onSweep, advance, onBook, windowMs, horizon, state, setSensitivity, setDetector });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (29 tests).

- [ ] **Step 5: Commit**

```bash
git add stream-visualizer.html tests/engine.test.js
git commit -m "feat(reader): event pipeline with cooldown, rate cap and subscribers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wall and book detectors

**Files:**
- Modify: `stream-visualizer.html` (engine: replace the `onBook` placeholder; add wall/imbalance/thinning code; add the per-second thinning call; selftest: add six scenarios)

**Interfaces:**
- Consumes: Task 5 `emit`; Task 4 `state`; Task 3 `onSecond` anchor `// -- anchor: detectors per second --`; Task 2 `tick`, `v.recent`.
- Produces: `onBook(vn, t, bids, asks)` where `bids`/`asks` are arrays of `[price, size]` (any order; bad rows are dropped; at most the best ~50 levels are needed). Event types emitted: `wall_appears`, `wall_pulled`, `wall_eaten`, `book_thin`, `imbalance_flip`, `spoof_like`. Per venue state: `bids`, `asks`, `bookT`, `bookMid`, `depth`, `imb`, `walls` (Map), `vanished`.

- [ ] **Step 1: Write the failing scenarios**

In the self-test block, replace `  // -- anchor: scenarios --` with:

```js
  add("bid wall appears, then is pulled", E => {
    const e = E.create(), a = calm(e);
    const b = sim(e, { t0: a.t, mid0: a.mid, seconds: 5, seed: 11, params: () => ({ vol: 0, bidWalls: [{ idx: 12, size: 6 }] }) });
    sim(e, { t0: b.t, mid0: b.mid, seconds: 4, seed: 12, params: () => ({ vol: 0 }) });
    const ok = e.events.some(x => x.type === "wall_appears" && x.dir === "bull" && x.venue === "bn")
            && e.events.some(x => x.type === "wall_pulled" && x.dir === "bear" && x.venue === "bn");
    return result(ok, e, "wall_appears:bull then wall_pulled:bear");
  });
  add("bid wall is eaten by sellers", E => {
    const e = E.create(), a = calm(e);
    const b = sim(e, { t0: a.t, mid0: a.mid, seconds: 5, seed: 11, params: () => ({ vol: 0, bidWalls: [{ idx: 12, size: 6 }] }) });
    const px = b.mid - 1.3;
    sim(e, { t0: b.t, mid0: b.mid, seconds: 3, seed: 12, params: sec => ({ vol: 0, trades: sec < 0.3 ? [{ side: "sell", px, q: 5, ntl: px * 5 }] : [] }) });
    return result(has(e, "wall_eaten", "bear") && !has(e, "wall_pulled"), e, "wall_eaten:bear and no wall_pulled");
  });
  add("thin bid depth is flagged", E => {
    const e = E.create(), a = calm(e);
    sim(e, { t0: a.t, mid0: a.mid, seconds: 6, seed: 13, params: () => ({ bidMult: 0.3 }) });
    return result(has(e, "book_thin", "bear"), e, "book_thin:bear");
  });
  add("book imbalance flips from bids to asks", E => {
    const e = E.create(), a = calm(e);
    const b = sim(e, { t0: a.t, mid0: a.mid, seconds: 6, seed: 14, params: () => ({ bidMult: 3 }) });
    const flipsBefore = e.events.filter(x => x.type === "imbalance_flip").length;
    sim(e, { t0: b.t, mid0: b.mid, seconds: 6, seed: 15, params: () => ({ askMult: 3 }) });
    return result(flipsBefore === 0 && has(e, "imbalance_flip", "bear"), e, "no flip on the first lean, then imbalance_flip:bear");
  });
  add("spoof-like walls are flagged", E => {
    const e = E.create(), a = calm(e);
    sim(e, { t0: a.t, mid0: a.mid, seconds: 6, seed: 16, params: sec => ({ vol: 0,
      bidWalls: sec < 1 ? [{ idx: 10, size: 6 }] : sec >= 1.5 && sec < 2.5 ? [{ idx: 14, size: 6 }] : sec >= 3 && sec < 4 ? [{ idx: 18, size: 6 }] : [] }) });
    return result(has(e, "spoof_like") && !has(e, "wall_appears"), e, "spoof_like and no confirmed wall");
  });
  add("malformed books are ignored", E => {
    const e = E.create(), a = calm(e, 130), before = e.events.length;
    try {
      e.onBook("bn", a.t + 250, [], [[100, 1]]);                                  // empty side
      e.onBook("bn", a.t + 500, [[101, 1]], [[100, 1]]);                          // crossed
      e.onBook("bn", a.t + 750, [[100, 0], [99, NaN], null], [[101, -1], "x"]);   // zero, NaN, negative, junk rows
      e.onBook("bn", a.t + 1000, [[100, 1], [99, 50]], [[101, 1], [102, 1]]);     // fewer than 10 levels
      e.onBook("zz", a.t + 1250, [[100, 1]], [[101, 1]]);                         // unknown venue
      e.onBook("bn", a.t + 1500, null, undefined);
    } catch (err) { return { ok: false, detail: "threw: " + err.message }; }
    return result(e.events.length === before && e.debug().venues.bn.walls.size === 0, e, "no events and no walls");
  });
  // -- anchor: scenarios --
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL: 5 of the 6 new scenarios fail (the malformed-books one may already pass because `onBook` is a no-op; that is fine, it must keep passing after the real implementation).

- [ ] **Step 3: Implement**

Replace the line `    function onBook() {}      // replaced in Task 6` with the following block:

```js
    function clean(levels, desc) {
      const out = [];
      for (const l of levels) {
        if (!l) continue;
        const p = +l[0], q = +l[1];
        if (Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0) out.push([p, q]);
      }
      out.sort((a, b) => desc ? b[0] - a[0] : a[0] - b[0]);
      return out;
    }
    function onBook(vn, t, bids, asks) {
      if (!VENUES.includes(vn) || !Array.isArray(bids) || !Array.isArray(asks) || !(t > 0)) return;
      const b = clean(bids, true), a = clean(asks, false);
      if (!b.length || !a.length || a[0][0] <= b[0][0]) return;      // empty side or crossed book: ignore this snapshot
      tick(t);
      const v = venues[vn], mid = (b[0][0] + a[0][0]) / 2, lim = mid * cfg.thinBps / 1e4;
      v.bids = b; v.asks = a; v.bookT = t; v.bookMid = mid;
      let bd = 0, ad = 0, sb = 0, sa = 0;
      for (const l of b) { if (mid - l[0] > lim) break; bd += l[1]; }
      for (const l of a) { if (l[0] - mid > lim) break; ad += l[1]; }
      for (let i = 0; i < cfg.imbTop; i++) { if (b[i]) sb += b[i][1]; if (a[i]) sa += a[i][1]; }
      v.depth = { bid: bd, ask: ad };
      v.imb = sb + sa > 0 ? (sb - sa) / (sb + sa) : 0;
      trackWalls(vn, t, mid);
      trackImbalance(vn, t);
    }
    const wallStrength = ratio => clamp01(0.3 + 0.7 * clamp01((ratio - th("wallRatio")) / (2 * th("wallRatio"))));
    function tradedThrough(v, w, t, ms) {        // size traded at or through the wall's price in the last `ms`
      let s = 0;
      for (const x of v.recent) {
        if (x.t < t - ms) continue;
        if (w.side === "bid" ? (x.side === "sell" && x.px <= w.px) : (x.side === "buy" && x.px >= w.px)) s += x.q;
      }
      return s;
    }
    function wallEvent(vn, t, w, type, dir, text) {
      return emit({ t, type, family: "wall", dir, venue: vn, px: w.px, horizon: "book", strength: wallStrength(w.ratio), evidence: text,
                    refs: { side: w.side, size: w.size, ratio: w.ratio } });
    }
    function noteVanished(vn, w, t) {            // a candidate wall that came and went within the confirm time
      const v = venues[vn];
      v.vanished.push({ t, side: w.side });
      v.vanished = v.vanished.filter(x => t - x.t <= cfg.spoofSpanMs);
      const same = v.vanished.filter(x => x.side === w.side);
      if (same.length < cfg.spoofCount) return;
      v.vanished = v.vanished.filter(x => x.side !== w.side);
      emit({ t, type: "spoof_like", family: "wall", dir: "neutral", venue: vn, px: w.px, horizon: "book", strength: 0.5,
             evidence: `${same.length} ${w.side}-side walls appeared and vanished within ${cfg.spoofSpanMs / 1000} s with no trades`, refs: {} });
    }
    function resolveWall(vn, w, size, t) {
      const v = venues[vn], lost = Math.max(0, w.peak - size);
      const frac = lost > 0 ? tradedThrough(v, w, t, 1500) / lost : 0;
      if (!w.confirmed) { if (frac < cfg.wallPulledFrac) noteVanished(vn, w, t); return; }
      const where = `${w.side} wall at ${w.px} (${w.ratio.toFixed(1)}x median)`, dir = w.side === "bid" ? "bear" : "bull";
      if (frac >= cfg.wallEatFrac) wallEvent(vn, t, w, "wall_eaten", dir, `${where} was eaten: ${(frac * 100).toFixed(0)}% of its size traded through`);
      else if (frac < cfg.wallPulledFrac) wallEvent(vn, t, w, "wall_pulled", dir, `${where} vanished with only ${(frac * 100).toFixed(0)}% of its size traded`);
    }
    function trackWalls(vn, t, mid) {
      const v = venues[vn], limit = mid * cfg.wallBps / 1e4;
      for (const side of ["bid", "ask"]) {
        const lv = side === "bid" ? v.bids : v.asks;
        if (lv.length < cfg.wallMinLevels) continue;
        const sizes = lv.slice(0, 20).map(l => l[1]).sort((a, b) => a - b), med = sizes[sizes.length >> 1];
        if (!(med > 0)) continue;
        const seen = new Set();
        for (const [px, sz] of lv) {
          if (Math.abs(px - mid) > limit) break;
          if (sz < th("wallRatio") * med) continue;
          const key = side + "|" + px;
          seen.add(key);
          let w = v.walls.get(key);
          if (!w) { w = { side, px, born: t, peak: sz, size: sz, ratio: sz / med, confirmed: false }; v.walls.set(key, w); }
          else { w.size = sz; if (sz > w.peak) w.peak = sz; w.ratio = Math.max(w.ratio, sz / med); }
          if (!w.confirmed && t - w.born >= cfg.wallConfirmMs) {
            w.confirmed = true;
            wallEvent(vn, t, w, "wall_appears", side === "bid" ? "bull" : "bear", `${side} wall ${w.ratio.toFixed(1)}x the median level at ${w.px}, held ${((t - w.born) / 1000).toFixed(1)} s`);
          }
        }
        const far = lv[lv.length - 1][0];
        for (const [key, w] of v.walls) {
          if (w.side !== side) continue;
          const cur = lv.find(l => l[0] === w.px);
          if (!cur && (side === "bid" ? w.px < far : w.px > far)) continue;   // the level fell outside the visible book: unknown, not vanished
          const size = cur ? cur[1] : 0;
          if (size <= w.peak * (1 - cfg.wallDropFrac)) { resolveWall(vn, w, size, t); v.walls.delete(key); }
          else if (!seen.has(key)) w.size = size;
        }
      }
    }
    function trackImbalance(vn, t) {
      const v = venues[vn], imb = v.imb;
      const target = imb >= th("imbEnter") ? 1 : imb <= -th("imbEnter") ? -1 : Math.abs(imb) < cfg.imbExit ? 0 : v.imbState;   // hysteresis
      if (target !== v.imbPending) { v.imbPending = target; v.imbPendingSince = t; }
      if (target === v.imbState || t - v.imbPendingSince < cfg.imbHoldMs) return;
      v.imbState = target;
      if (target === 0) return;
      const flipped = v.lastImbLean !== 0 && v.lastImbLean !== target;
      v.lastImbLean = target;                    // the first lean is recorded silently; only a change of sign is an event
      if (flipped) emit({ t, type: "imbalance_flip", family: "book", dir: target > 0 ? "bull" : "bear", venue: vn, px: v.bookMid, horizon: "book",
        strength: 0.3 + Math.abs(imb), refs: { imb },
        evidence: `top-${cfg.imbTop} book imbalance flipped to ${(imb * 100).toFixed(0)}% (${target > 0 ? "bids" : "asks"} heavier), held ${cfg.imbHoldMs / 1000} s` });
    }
    function detectThinning(vn, t) {
      const v = venues[vn];
      for (const side of ["bid", "ask"]) {
        const ring = v.depthRing[side];
        if (ring.length < 15) continue;
        const s = ring.slice().sort((a, b) => a - b), med = s[s.length >> 1], cur = v.depth[side];
        if (med > 0 && cur < cfg.thinFrac * med)
          emit({ t, type: "book_thin", family: "book", dir: side === "bid" ? "bear" : "bull", venue: vn, px: v.bookMid || v.px, horizon: "book",
            strength: 0.3 + (1 - cur / (cfg.thinFrac * med)), refs: { cur, med },
            evidence: `${side} depth within ${cfg.thinBps} bps fell to ${(100 * cur / med).toFixed(0)}% of its 30 s median` });
      }
    }
```

Replace `      // -- anchor: detectors per second --` with:

```js
      for (const k of VENUES) detectThinning(k, t);
      // -- anchor: detectors per second --
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (35 tests, including 6 new scenarios). If a scenario fails by a small margin, first decide whether the **engine rule** is wrong or the **scenario magnitude** is unrealistic. Never loosen a threshold just to pass; if a default must change, change it in `DEFAULTS` and record why under "Risks" in the spec.

- [ ] **Step 5: Commit**

```bash
git add stream-visualizer.html
git commit -m "feat(reader): wall, book thinning, imbalance and spoof-like detectors

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Capitulation, squeeze and breakout detectors

**Files:**
- Modify: `stream-visualizer.html` (engine: add burst code and the per-second call; selftest: add three scenarios)

**Interfaces:**
- Consumes: Task 4 `horizon`, `sigmaBps`/`robustZ` (Task 3), `depthRing`/`depth` (Task 6), `emit` (Task 5).
- Produces: events `capitulation` (dir `bear`), `selling_exhausted` (dir `bull`), `squeeze` (dir `bull`), `breakout` (dir `bull`); all `family: "burst"`, `venue: "bn"`, `horizon: "fast"`. Per venue state `cap` (`{t, peak, low, lowT, bidTrough, calmSince}` while a capitulation episode is open) and `sqLockUntil` (15 s lock after a squeeze/breakout).

- [ ] **Step 1: Write the failing scenarios**

In the self-test block, replace `  // -- anchor: scenarios --` with:

```js
  add("capitulation, then selling exhausted", E => {
    const e = E.create(), a = calm(e);
    const b = sim(e, { t0: a.t, mid0: a.mid, seconds: 12, seed: 21, params: () => ({ rate: 200, buyP: 0.1, driftBps: -6, liqSell: 3, sweepSell: 2, bidMult: 0.4 }) });
    sim(e, { t0: b.t, mid0: b.mid, seconds: 15, seed: 22, params: () => ({ driftBps: 0.2 }) });
    const i = e.events.findIndex(x => x.type === "capitulation" && x.dir === "bear");
    const j = e.events.findIndex(x => x.type === "selling_exhausted" && x.dir === "bull");
    return result(i >= 0 && j > i, e, "capitulation:bear followed by selling_exhausted:bull");
  });
  add("squeeze that stays inside the 5-minute range", E => {
    const e = E.create();
    const a = sim(e, { seconds: 150, seed: 3, params: sec => ({ driftBps: sec < 50 ? 3 : sec < 110 ? -2.5 : 0 }) });
    sim(e, { t0: a.t, mid0: a.mid, seconds: 12, seed: 31, params: () => ({ rate: 200, buyP: 0.9, driftBps: 6, liqBuy: 3, sweepBuy: 2, askMult: 0.4 }) });
    return result(has(e, "squeeze", "bull") && !has(e, "breakout"), e, "squeeze:bull and no breakout");
  });
  add("breakout through the 5-minute high", E => {
    const e = E.create(), a = calm(e);
    sim(e, { t0: a.t, mid0: a.mid, seconds: 12, seed: 32, params: () => ({ rate: 200, buyP: 0.9, driftBps: 6, liqBuy: 3, sweepBuy: 2, askMult: 0.4 }) });
    return result(has(e, "breakout", "bull") && !has(e, "squeeze"), e, "breakout:bull and no squeeze");
  });
  // -- anchor: scenarios --
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL: the three new scenarios report events missing.

- [ ] **Step 3: Implement**

Directly above `    function onSecond(t) {` add:

```js
    function depthThinned(vn, side) {
      const ring = venues[vn].depthRing[side];
      if (ring.length < 15) return false;
      const s = ring.slice().sort((a, b) => a - b), med = s[s.length >> 1];
      return med > 0 && venues[vn].depth[side] < cfg.thinFrac * med;
    }
    function priorHigh(vn, skipBuckets) {        // highest price in the ~5 minutes before the current window
      const r = venues[vn].ring;
      let hi = -Infinity;
      for (let i = Math.max(0, r.length - skipBuckets - 1200); i < r.length - skipBuckets; i++) if (r[i].hi != null && r[i].hi > hi) hi = r[i].hi;
      return hi;
    }
    const burstStrength = (z, sup, dz) => 0.4 + 0.1 * (z - th("burstZ")) + 0.15 * (sup - cfg.burstSupports) + 0.02 * (Math.abs(dz) - th("burstSigma"));
    function bursts(t) {                         // Binance only in Phase 1: it leads, and it publishes liquidations
      const vn = "bn", v = venues.bn, h = horizon(vn, "fast");
      if (!h || h.n < 5 || !(h.open > 0) || !(h.buy + h.sell > 0)) return;
      const secs = h.ms / 1000, sellRate = h.sell / secs, buyRate = h.buy / secs, px = h.close;
      const zS = robustZ(sellRate, vn, "sell", 1), zB = robustZ(buyRate, vn, "buy", 1);
      const dz = ((h.close / h.open - 1) * 1e4) / (sigmaBps(vn) * Math.sqrt(secs));
      if (v.cap) {                               // an open capitulation: watch for the selling to end
        const c = v.cap;
        c.peak = Math.max(c.peak, sellRate); c.bidTrough = Math.min(c.bidTrough, v.depth.bid);
        if (px < c.low) { c.low = px; c.lowT = t; }
        if (sellRate < cfg.endFrac * c.peak) { if (!c.calmSince) c.calmSince = t; } else c.calmSince = 0;
        if (c.calmSince && t - c.calmSince >= cfg.endHoldMs && t - c.lowT >= cfg.endHoldMs && v.depth.bid >= c.bidTrough * cfg.endBookRecover) {
          emit({ t, type: "selling_exhausted", family: "burst", dir: "bull", venue: vn, px, horizon: "fast", strength: 0.6, refs: {},
            evidence: `sell flow fell to ${(100 * sellRate / c.peak).toFixed(0)}% of its peak, no new low for ${((t - c.lowT) / 1000).toFixed(0)} s, bid depth recovered to ${(100 * v.depth.bid / Math.max(c.bidTrough, 1e-9)).toFixed(0)}% of its trough` });
          v.cap = null;
        } else if (t - c.t > cfg.endExpireMs) v.cap = null;
      } else if (zS >= th("burstZ") && 1 - h.share >= cfg.burstShare && dz <= -th("burstSigma")) {
        const sup = Number(h.liqSellN >= 2) + Number(h.sweepSellN >= 3) + Number(depthThinned(vn, "bid"));
        if (sup >= cfg.burstSupports) {
          const e = emit({ t, type: "capitulation", family: "burst", dir: "bear", venue: vn, px, horizon: "fast", strength: burstStrength(zS, sup, dz), refs: { zS, dz, sup },
            evidence: `sellers hit $${money(h.sell)} in ${secs.toFixed(1)} s (z ${zS.toFixed(1)}), price ${dz.toFixed(1)} sigma, ${h.liqSellN} sell liquidations, ${h.sweepSellN} sell sweeps` });
          if (e) v.cap = { t, peak: sellRate, low: h.lo, lowT: t, bidTrough: v.depth.bid, calmSince: 0 };
        }
      }
      if (t >= v.sqLockUntil && zB >= th("burstZ") && h.share >= cfg.burstShare && dz >= th("burstSigma")) {
        const sup = Number(h.liqBuyN >= 2) + Number(h.sweepBuyN >= 3) + Number(depthThinned(vn, "ask"));
        if (sup >= cfg.burstSupports) {
          const brk = h.hi > priorHigh(vn, Math.round(h.ms / cfg.bucketMs));
          const e = emit({ t, type: brk ? "breakout" : "squeeze", family: "burst", dir: "bull", venue: vn, px, horizon: "fast", strength: burstStrength(zB, sup, dz), refs: { zB, dz, sup },
            evidence: `buyers lifted $${money(h.buy)} in ${secs.toFixed(1)} s (z ${zB.toFixed(1)}), price +${dz.toFixed(1)} sigma, ${h.liqBuyN} buy liquidations, ${h.sweepBuyN} buy sweeps${brk ? ", through the 5-minute high" : ""}` });
          if (e) v.sqLockUntil = t + 15000;
        }
      }
    }
```

Replace `      // -- anchor: detectors per second --` with:

```js
      bursts(t);
      // -- anchor: detectors per second --
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (38 tests). Same rule as Task 6 if a scenario is borderline: fix the engine only if the rule is wrong, never loosen a default just to pass.

- [ ] **Step 5: Commit**

```bash
git add stream-visualizer.html
git commit -m "feat(reader): capitulation, selling-exhausted, squeeze and breakout detectors

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Robustness, quiet-market guarantee, recording and replay

**Files:**
- Modify: `stream-visualizer.html` (engine: recording, `replay`; selftest: one scenario)
- Create: `tests/replay.js`
- Test: `tests/engine.test.js` (append)

**Interfaces:**
- Consumes: every engine input method (Tasks 2 and 6).
- Produces: `engine.startRecording()`, `engine.stopRecording() -> inputs[]`, `READER_ENGINE.replay(inputs, cfg?) -> events[]`. An input is one of `["t", {t,v,side,px,q,ntl,liq}]`, `["q", vn,t,bid,ask]`, `["b", vn,t,bids,asks]`, `["s", vn,t,side,ntl,levels]`, `["a", t]`, `["x"]` (reset). `node tests/replay.js <file.json>` where the file is `{inputs, events, cfg}`; exit code 0 and the text `identical: true` when a replay reproduces the recorded events exactly.

- [ ] **Step 1: Write the failing tests (append to `tests/engine.test.js`)**

```js
test('engine source never touches timers, the DOM, the wall clock or randomness', () => {
  const fs = require('node:fs'), path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'stream-visualizer.html'), 'utf8');
  const src = html.match(/<script id="reader-engine">([\s\S]*?)<\/script>/)[1];
  const stripped = src.replace(/\/\/.*$/gm, '');          // comments may mention these words
  // word boundaries matter: the engine legitimately has names like windowMs
  for (const bad of [/\bsetInterval\b/, /\bsetTimeout\b/, /\brequestAnimationFrame\b/, /\bdocument\b/, /\bwindow\b/, /\bDate\.now\b/, /\bnew Date\b/, /\bperformance\b/, /\bMath\.random\b/, /\bfetch\(/]) {
    assert.equal(bad.test(stripped), false, 'engine must not use ' + bad);
  }
});

test('a fuzz of random and hostile inputs never throws and never leaves NaN in the state (review focus 2)', () => {
  const e = E.create(), r = S.rng(99);
  let t = T0;
  const junk = [null, undefined, NaN, -1, 0, 1e18, 'x', {}, [], Infinity];
  const pick = () => junk[Math.floor(r() * junk.length)];
  assert.doesNotThrow(() => {
    for (let i = 0; i < 4000; i++) {
      t += Math.floor(r() * 400);
      const px = 100 + r() * 5, ok = r() < 0.7;
      switch (Math.floor(r() * 5)) {
        case 0: e.onTrade({ t, v: ok ? 'bn' : pick(), side: r() < 0.5 ? 'buy' : 'sell', px: ok ? px : pick(), q: 1, ntl: ok ? px : pick() }); break;
        case 1: e.onQuote(ok ? 'bn' : pick(), t, ok ? px - 0.1 : pick(), ok ? px + 0.1 : pick()); break;
        case 2: e.onBook(ok ? 'hl' : pick(), t, ok ? [[px - 0.1, 5], [px - 0.2, 5]] : pick(), ok ? [[px + 0.1, 5]] : pick()); break;
        case 3: e.onSweep(ok ? 'bn' : pick(), t, 'buy', pick(), 2); break;
        default: e.advance(ok ? t : pick());
      }
    }
  });
  assert.equal(JSON.stringify(e.state()).includes('NaN'), false);
});

function recordedBurst() {
  const e = E.create(); e.startRecording();
  const a = S.sim(e, { seconds: 150, seed: 3 });
  S.sim(e, { t0: a.t, mid0: a.mid, seconds: 12, seed: 21, params: () => ({ rate: 200, buyP: 0.1, driftBps: -6, liqSell: 3, sweepSell: 2, bidMult: 0.4 }) });
  return { e, inputs: e.stopRecording() };
}
const evKey = x => [x.id, x.t, x.type, x.dir, x.venue, x.px, x.strength.toFixed(6), x.evidence].join('|');

test('replaying recorded inputs reproduces the events exactly (what makes background operation provable)', () => {
  const { e, inputs } = recordedBurst();
  assert.ok(e.events.length > 0);
  const replayed = E.replay(JSON.parse(JSON.stringify(inputs)));      // the JSON round-trip is what a soak recording goes through
  assert.equal(Array.from(replayed, evKey).join('\n'), Array.from(e.events, evKey).join('\n'));
});

test('a reset during recording is replayed too', () => {
  const e = E.create(); e.startRecording();
  S.sim(e, { seconds: 140, seed: 3 });
  e.reset();
  S.sim(e, { t0: T0 + 200000, seconds: 10, seed: 4 });
  const inputs = e.stopRecording();
  assert.ok(inputs.some(x => x[0] === 'x'));
  assert.equal(Array.from(E.replay(inputs), evKey).join('\n'), Array.from(e.events, evKey).join('\n'));
});

test('tests/replay.js verifies a recording file end to end', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
  const { e, inputs } = recordedBurst();
  const file = path.join(os.tmpdir(), 'reader-recording-test.json');
  fs.writeFileSync(file, JSON.stringify({ inputs, events: e.events, cfg: e.cfg }));
  const out = cp.execFileSync(process.execPath, [path.join(__dirname, 'replay.js'), file], { encoding: 'utf8' });
  fs.unlinkSync(file);
  assert.match(out, /identical: true/);
});
```

- [ ] **Step 2: Add the quiet-market scenario (fails to compile its way in until implemented, but should already pass)**

In the self-test block, replace `  // -- anchor: scenarios --` with:

```js
  add("quiet market produces no events", E => {
    const e = E.create();
    sim(e, { seconds: 300, seed: 5 });
    return result(e.events.length === 0, e, "no events at all");
  });
  // -- anchor: scenarios --
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npm test`
Expected: FAIL: `e.startRecording is not a function`, and `E.replay is not a function`. (The purity test and the fuzz test should already pass; if the purity test fails, remove the forbidden call from the engine rather than weakening the test. The quiet scenario passes only if Tasks 6 and 7 are right; if it fails, you have a false-positive bug.)

- [ ] **Step 4: Implement recording and replay**

Replace `    let events, seq, now, firstT, curStart, venues, lastEmit;` with:

```js
    let events, seq, now, firstT, curStart, venues, lastEmit, rec = null;
```

Replace the first line of `reset()`:

```js
      events = []; seq = 0; now = 0; firstT = null; curStart = null; lastEmit = new Map();
```

with:

```js
      if (rec) rec.push(["x"]);
      events = []; seq = 0; now = 0; firstT = null; curStart = null; lastEmit = new Map();
```

Replace the four input functions `onTrade`, `onQuote`, `onSweep` and `advance` (Task 2 versions) by adding one recording line as the **first statement** of each, so even rejected junk is recorded and replays identically:

```js
    // onTrade:   if (rec) rec.push(["t", tr ? { t: tr.t, v: tr.v, side: tr.side, px: tr.px, q: tr.q, ntl: tr.ntl, liq: !!tr.liq } : tr]);
    // onQuote:   if (rec) rec.push(["q", vn, t, bid, ask]);
    // onSweep:   if (rec) rec.push(["s", vn, t, side, ntl, levels]);
    // advance:   if (rec) rec.push(["a", t]);
    // onBook (Task 6 version): if (rec) rec.push(["b", vn, t, bids, asks]);
```

Concretely, the first lines become:

```js
    function onTrade(tr) {
      if (rec) rec.push(["t", tr ? { t: tr.t, v: tr.v, side: tr.side, px: tr.px, q: tr.q, ntl: tr.ntl, liq: !!tr.liq } : tr]);
      if (!tr || !VENUES.includes(tr.v) || !(tr.ntl > 0) || !(tr.px > 0) || !(tr.t > 0)) return;
```

```js
    function onQuote(vn, t, bid, ask) {
      if (rec) rec.push(["q", vn, t, bid, ask]);
      if (!VENUES.includes(vn) || !(bid > 0) || !(ask > 0) || ask < bid || !(t > 0)) return;
```

```js
    function onSweep(vn, t, side, ntl, levels) {
      if (rec) rec.push(["s", vn, t, side, ntl, levels]);
      if (!VENUES.includes(vn) || !(t > 0)) return;
```

```js
    function advance(t) { if (rec) rec.push(["a", t]); tick(t); }             // heartbeat: closes buckets when no messages arrive
```

```js
    function onBook(vn, t, bids, asks) {
      if (rec) rec.push(["b", vn, t, bids, asks]);
      if (!VENUES.includes(vn) || !Array.isArray(bids) || !Array.isArray(asks) || !(t > 0)) return;
```

Add to the API (replace `    // -- anchor: api additions --` with):

```js
    Object.assign(api, { startRecording: () => { rec = []; }, stopRecording: () => { const r = rec || []; rec = null; return r; } });
    // -- anchor: api additions --
```

Replace the last lines of the engine:

```js
  return { create, DEFAULTS };
})();
```

with:

```js
  // Feeds recorded inputs to a fresh engine. Pure functions of their inputs: same inputs, same events.
  function replay(inputs, userCfg) {
    const e = create(userCfg);
    for (const r of inputs) {
      switch (r[0]) {
        case "t": e.onTrade(r[1]); break;
        case "q": e.onQuote(r[1], r[2], r[3], r[4]); break;
        case "b": e.onBook(r[1], r[2], r[3], r[4]); break;
        case "s": e.onSweep(r[1], r[2], r[3], r[4], r[5]); break;
        case "a": e.advance(r[1]); break;
        case "x": e.reset(); break;
      }
    }
    return e.events;
  }
  return { create, replay, DEFAULTS };
})();
```

- [ ] **Step 5: Create `tests/replay.js`**

```js
// Usage: node tests/replay.js recording.json
// Replays the recorded inputs through a fresh engine and requires the same events as the live run.
const fs = require('node:fs');
const { load } = require('./load-engine');

const file = process.argv[2];
if (!file) { console.error('usage: node tests/replay.js recording.json'); process.exit(2); }

const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
const { engine: E } = load();
const replayed = E.replay(rec.inputs, rec.cfg);
const key = e => [e.id, e.t, e.type, e.dir, e.venue, e.px, Number(e.strength).toFixed(6), e.evidence].join('|');
const a = rec.events.map(key), b = Array.from(replayed, key);
const same = a.length === b.length && a.every((x, i) => x === b[i]);

console.log(`inputs: ${rec.inputs.length}, live events: ${a.length}, replayed events: ${b.length}, identical: ${same}`);
if (!same) {
  const i = a.findIndex((x, k) => x !== b[k]);
  console.log('first difference at index', i, '\n  live:    ', a[i], '\n  replayed:', b[i]);
  process.exit(1);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test`
Expected: PASS (all unit tests plus 11 scenarios, including the quiet-market one).

- [ ] **Step 7: Commit**

```bash
git add stream-visualizer.html tests/engine.test.js tests/replay.js
git commit -m "feat(reader): recording and deterministic replay, purity and fuzz tests, quiet-market scenario

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Host integration (hooks, reset, book sampling)

**Files:**
- Modify: `stream-visualizer.html` (main script only)
- Create: `tests/hooks.test.js`

**Interfaces:**
- Consumes: the engine API (`onTrade`, `onQuote`, `onBook`, `onSweep`, `reset`, `selfTest`).
- Produces (main script globals): `READER` (the live engine instance, plus `READER.selfTest()`), `rdSafe(fn)`, `rdLastBook`, `rdWorker` (declared here, used by Task 11), `rdBook(venue, t)`, `topN(map, n, desc)`, `bnTopN(n)`.

- [ ] **Step 1: Write the failing contract test `tests/hooks.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'stream-visualizer.html'), 'utf8');
const main = html.slice(html.lastIndexOf('<script>'));
const count = (s, re) => (s.match(re) || []).length;

test('every feed handler reaches the reader through a guarded hook', () => {
  assert.match(main, /const READER = READER_ENGINE\.create\(\)/);
  assert.match(main, /const rdSafe = /);
  assert.match(main, /if \(!t\.bf\) rdSafe\(\(\) => READER\.onTrade\(t\)\)/, 'HL replay trades (bf) must not reach the engine');
  assert.match(main, /READER\.onQuote\("bn", evt, M\.bnBid, M\.bnAsk\)/);
  assert.match(main, /READER\.onQuote\("hl", d\.time, M\.hlBid, M\.hlAsk\)/);
  assert.match(main, /rdBook\("bn", d\.T \|\| d\.E\)/);
  assert.match(main, /rdBook\("hl", d\.time\)/);
  assert.match(main, /READER\.onSweep\(v, t, side,/);
});

test('Connect and an asset change both reset the reader (review focus 3)', () => {
  assert.equal(count(main, /READER\.reset\(\)/g), 2);
});

test('the book is sampled by exchange time and the Binance book is never fully sorted per snapshot', () => {
  assert.match(main, /t - rdLastBook\[v\] >= 250/);
  assert.match(main, /function topN\(map, n, desc\)/);
  assert.match(main, /bnTopN\(30\)/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL in `tests/hooks.test.js` (no `READER` in the main script yet).

- [ ] **Step 3: Add the book helpers**

Replace the line `function bnTop(){` (unique) with:

```js
function topN(map, n, desc){                     // best-first top n [price, size] from a Map<priceString, size> in one pass, no full sort
  const out = [];
  for (const [p, q] of map){
    const px = +p; let i = out.length;
    while (i > 0 && (desc ? out[i-1][0] < px : out[i-1][0] > px)) i--;
    if (i < n){ out.splice(i, 0, [px, q]); if (out.length > n) out.pop(); }
  }
  return out;
}
function bnTopN(n){ return bnBook && bnBook.ready && bnBook.bids.size && bnBook.asks.size ? {bids: topN(bnBook.bids, n, true), asks: topN(bnBook.asks, n, false)} : null; }
function bnTop(){
```

- [ ] **Step 4: Add the reader instance and hooks**

Replace the line `// ---------- Binance ----------` (unique) with:

```js
// ---------- market reader: instance and hooks ----------
const READER = READER_ENGINE.create();
READER.selfTest = () => READER_SELFTEST.run(READER_ENGINE);
const rdSafe = fn => { try{ fn(); }catch(e){ console.error("reader", e); } };   // a reader bug must never break a feed handler
const rdLastBook = {bn:0, hl:0};
let rdWorker = null;                             // heartbeat worker (Task 11)
function rdBook(v, t){                           // at most one book snapshot per 250 ms per venue, judged by exchange time
  rdSafe(() => {
    if (!(t - rdLastBook[v] >= 250)) return;
    rdLastBook[v] = t;
    const b = v==="bn" ? bnTopN(30) : hlTop();
    if (b) READER.onBook(v, t, b.bids, b.asks);
  });
}

// ---------- Binance ----------
```

Then make these exact replacements (each old string is unique in the file):

1. `function addTrade(t){\n  if (t.mid == null){` becomes
```js
function addTrade(t){
  if (!t.bf) rdSafe(() => READER.onTrade(t));     // HL replays recent trades on subscribe (bf): not live flow
  if (t.mid == null){
```
2. In `bnHandle`, the line `    case "bn.bookTicker": evt = d.T || d.E; M.bnBid=+d.b; M.bnAsk=+d.a; M.bnBidSz=+d.B; M.bnAskSz=+d.A; break;` becomes
```js
    case "bn.bookTicker": evt = d.T || d.E; M.bnBid=+d.b; M.bnAsk=+d.a; M.bnBidSz=+d.B; M.bnAskSz=+d.A; rdSafe(() => READER.onQuote("bn", evt, M.bnBid, M.bnAsk)); break;
```
3. In `hlHandle`, the `case "hl.bbo":` line (ending `M.hlAskSz=+d.bbo[1].sz; } break;`) becomes the same line with `rdSafe(() => READER.onQuote("hl", d.time, M.hlBid, M.hlAsk)); break;` instead of the final `break;`.
4. `    case "hl.l2Book": evt = d.time; hlBook = d.levels; hlBookT = Date.now(); break;` becomes
```js
    case "hl.l2Book": evt = d.time; hlBook = d.levels; hlBookT = Date.now(); rdBook("hl", d.time); break;
```
5. At the end of `bnDepth`, `  b.lastU = d.u;\n}\nfunction bnResync()` becomes
```js
  b.lastU = d.u;
  rdBook("bn", d.T || d.E);
}
function bnResync()
```
6. In `addSweep`, the line `  if (sweeps.length > 300) sweeps.shift();` becomes
```js
  if (sweeps.length > 300) sweeps.shift();
  rdSafe(() => READER.onSweep(v, t, side, fills.reduce((a, f) => a + f.ntl, 0), pxs.size));
```
7. In the Connect handler, `  resetMarket(); Object.assign(health, {bnReconnects:0, hlReconnects:0, hlReplays:0});` becomes
```js
  resetMarket(); Object.assign(health, {bnReconnects:0, hlReconnects:0, hlReplays:0});
  READER.reset(); rdLastBook.bn = rdLastBook.hl = 0;
```
8. In the asset-change handler, `resetMarket(); hlBook=null; bnConnect(); hlConnect(); } };` becomes
```js
resetMarket(); READER.reset(); rdLastBook.bn = rdLastBook.hl = 0; hlBook=null; bnConnect(); hlConnect(); } };
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS (including the 3 hook contract tests).

- [ ] **Step 6: Verify live in the browser (cannot be unit-tested)**

1. In the project folder run: `python -m http.server 8765` and open `http://127.0.0.1:8765/stream-visualizer.html` in Chrome (keep the DevTools console open).
2. Press **Connect**, wait 20 seconds, then paste in the console:

```js
(() => { const d = READER.debug(), hl = d.venues.hl, bn = d.venues.bn;
  const sum = v => v.ring.reduce((a, b) => a + b.buy + b.sell, 0) + v.cur.buy + v.cur.sell;
  const live = trades.filter(t => t.v === 'hl' && !t.bf && !t.liq).reduce((a, t) => a + t.ntl, 0);
  const bf = trades.filter(t => t.v === 'hl' && t.bf).reduce((a, t) => a + t.ntl, 0);
  return { bnBuckets: bn.ring.length, hlBuckets: hl.ring.length, bnBookLevels: bn.bids.length, hlBookLevels: hl.bids.length,
           hlEngineNtl: Math.round(sum(hl)), hlLiveNtl: Math.round(live), hlBackfillNtl: Math.round(bf), calibrating: READER.state().calibratingPct }; })()
```

Expected: both bucket counts above 40; `bnBookLevels` 30 and `hlBookLevels` 20 or fewer; `hlEngineNtl` within about 10% of `hlLiveNtl` and **not** near `hlLiveNtl + hlBackfillNtl` (review focus 4); `calibrating` between 0 and 1.

3. Run `READER.selfTest().every(r => r.ok)`. Expected: `true`.
4. Change the asset box to `ETH` and wait 2 s, then run `[READER.events.length, READER.state().calibratingPct < 0.1, READER.debug().venues.bn.walls.size]`. Expected: `[0, true, 0]` (review focus 3).
5. Confirm no red errors in the console.

- [ ] **Step 7: Commit**

```bash
git add stream-visualizer.html tests/hooks.test.js
git commit -m "feat(reader): guarded feed hooks, book sampling, resets

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The Reader tab (state strip, event feed, controls, health)

**Files:**
- Modify: `stream-visualizer.html` (CSS, `TABS`, HTML sections, main script)
- Create: `tests/ui.test.js`

**Interfaces:**
- Consumes: `READER.state()`, `READER.events`, `READER.cfg.detectors`, `READER.setSensitivity`, `READER.setDetector` (Tasks 4 and 5); `status(s)`, `S`, `visible()`, `fmt`, `hhmmss` (existing); `rdWorker` (Task 9).
- Produces: `renderReader()` (idempotent, cheap, called only while visible), `rdInit()`, `rdFilter = {family:Set, venue:Set, min:number}`. DOM ids: `rdStatus`, `rdSens`, `rdStrip`, `rdChips`, `rdMin`, `rdFeed`, `rdDetectors`, `rdHealth`.

- [ ] **Step 1: Write the failing contract test `tests/ui.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'stream-visualizer.html'), 'utf8');
const count = re => (html.match(re) || []).length;

test('the Reader tab is registered and has its sections', () => {
  assert.match(html, /\["reader","Reader"\]/);
  assert.ok(count(/<section data-tab="reader"/g) >= 4, 'expected at least 4 reader sections');
});

test('every id the render code uses exists exactly once', () => {
  for (const id of ['rdStatus', 'rdSens', 'rdStrip', 'rdChips', 'rdMin', 'rdFeed', 'rdDetectors', 'rdHealth']) {
    assert.equal(count(new RegExp('id="' + id + '"', 'g')), 1, id);
  }
});

test('the reader is rendered only while visible, and initialised once', () => {
  assert.match(html, /if \(visible\("reader"\) && ts - lastReader > 250\)/);
  assert.equal(count(/rdInit\(\);/g), 1, 'rdInit() must be called exactly once');
  assert.match(html, /rdInit\(\); buildCards\(\);/);
});

test('detector toggles are generated from the engine config, not hard-coded', () => {
  assert.match(html, /Object\.keys\(READER\.cfg\.detectors\)/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL in `tests/ui.test.js`.

- [ ] **Step 3: Add the CSS**

Replace the line `</style>` (unique) with:

```css
.rd-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px}
.rd-card{background:var(--panel2);border-radius:8px;padding:8px}.rd-card span{display:block;color:var(--dim);font-size:11px}
.rd-card b{font-family:var(--mono);font-size:14px;font-weight:500}.rd-card.buy b{color:var(--buy)}.rd-card.sell b{color:var(--sell)}
.rd-feed td{padding:3px 6px;text-align:left}.rd-feed th{text-align:left}
.rd-feed tr.bull td:first-child{border-left:3px solid var(--buy)}.rd-feed tr.bear td:first-child{border-left:3px solid var(--sell)}.rd-feed tr.neutral td:first-child{border-left:3px solid var(--warn)}
.rd-str{display:inline-block;height:6px;border-radius:3px;background:var(--accent);vertical-align:middle}
.rd-det{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px}.rd-det label{display:flex;gap:6px;align-items:center;font-size:12px}
.chip{padding:2px 8px;font-size:11px}.chip.on{border-color:var(--accent);color:var(--accent)}
</style>
```

- [ ] **Step 4: Register the tab and add the HTML sections**

Replace the `TABS` line's start `const TABS = [["charts","Charts"],["micro","Micro"],` with:

```js
const TABS = [["charts","Charts"],["micro","Micro"],["reader","Reader"],
```

(keep the rest of the line unchanged). Then replace the line `  <section data-tab="trading" class="full tcontainer">` (unique) with:

```html
  <section data-tab="reader" class="full">
    <h2>Market reader <span class="ctl"><span id="rdStatus" class="stat">calibrating…</span>
      <label>sensitivity <select id="rdSens"><option value="0.75">low</option><option value="1" selected>medium</option><option value="1.25">high</option></select></label></span></h2>
    <div id="rdStrip" class="rd-strip"></div>
    <div class="note">Read-only. Windows are measured in normal-market activity (a volume clock): they shrink when the market is fast and stretch when it is slow. Detectors arm after about 2 minutes of data. Evidence describes order-flow behaviour; it is not advice.</div>
  </section>

  <section data-tab="reader" class="full">
    <h2>Events <span class="ctl"><span id="rdChips"></span> min strength <input id="rdMin" type="range" min="0" max="1" step="0.05" value="0" style="width:90px"></span></h2>
    <div class="tape" style="height:420px"><table id="rdFeed" class="rd-feed"></table></div>
  </section>

  <section data-tab="reader">
    <h2>Detectors</h2>
    <div id="rdDetectors" class="rd-det"></div>
  </section>

  <section data-tab="reader">
    <h2>Engine health</h2>
    <div class="metrics" id="rdHealth"></div>
  </section>

  <section data-tab="trading" class="full tcontainer">
```

- [ ] **Step 5: Add the render code**

Replace the line `buildCards(); renderMetrics(); tagViewSections(); buildModCatalog(); renderAccount(); setTab("charts");` with:

```js
rdInit(); buildCards(); renderMetrics(); tagViewSections(); buildModCatalog(); renderAccount(); setTab("charts");
```

and, directly above the line `// ---------- loops ----------`, add:

```js
// ---------- market reader: tab ----------
const rdFilter = {family:new Set(), venue:new Set(), min:0};
const rdEsc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
const rdMs = ms => ms >= 10000 ? (ms/1000).toFixed(0)+"s" : (ms/1000).toFixed(1)+"s";
function rdInit(){
  const chip = (kind, v) => `<button class="chip" data-kind="${kind}" data-v="${v}">${v}</button>`;
  $("rdChips").innerHTML = ["wall","book","burst"].map(f => chip("family", f)).join("") + ["bn","hl"].map(v => chip("venue", v)).join("");
  $("rdChips").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const set = rdFilter[b.dataset.kind];
    set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
    b.classList.toggle("on", set.has(b.dataset.v)); renderReader();
  };
  $("rdMin").oninput = () => { rdFilter.min = +$("rdMin").value; renderReader(); };
  $("rdSens").onchange = () => READER.setSensitivity(+$("rdSens").value);
  $("rdDetectors").innerHTML = Object.keys(READER.cfg.detectors).map(k => `<label><input type="checkbox" data-d="${k}" checked> ${k.replace(/_/g," ")}</label>`).join("");
  $("rdDetectors").onchange = e => { const d = e.target.dataset.d; if (d) READER.setDetector(d, e.target.checked); };
}
function renderReader(){
  const s = READER.state(), card = (k, v, cls) => `<div class="rd-card ${cls||""}"><span>${k}</span><b>${v}</b></div>`;
  $("rdStatus").textContent = s.calibrated ? "armed" : `calibrating ${(s.calibratingPct*100).toFixed(0)}%`;
  $("rdStrip").innerHTML = [card("activity", `${s.regime} (x${s.ratio.toFixed(2)})`)].concat(["fast","mid","slow"].map(k => {
    const h = s.horizons[k];
    return h ? card(`${k} · window ${rdMs(h.ms)}`, `${h.side} (${(h.share*100).toFixed(0)}% buy)`, h.side==="buyers" ? "buy" : h.side==="sellers" ? "sell" : "") : card(k, "–");
  })).concat([card("last event", s.last ? `${s.last.type.replace(/_/g," ")} · ${s.last.dir}` : "none")]).join("");
  const rows = READER.events.slice().reverse().filter(e =>
    (!rdFilter.family.size || rdFilter.family.has(e.family)) && (!rdFilter.venue.size || rdFilter.venue.has(e.venue)) && e.strength >= rdFilter.min).slice(0, 100);
  $("rdFeed").innerHTML = `<tr><th>time</th><th>type</th><th>venue</th><th>price</th><th>horizon</th><th>strength</th><th>evidence</th></tr>` +
    rows.map(e => `<tr class="${e.dir}"><td>${hhmmss(e.t)}</td><td>${e.type.replace(/_/g," ")}</td><td><span class="venue v-${e.venue}">${e.venue.toUpperCase()}</span></td>
      <td>${fmt(e.px,1)}</td><td>${e.horizon}</td><td><i class="rd-str" style="width:${Math.round(e.strength*60)}px"></i> ${(e.strength*100).toFixed(0)}</td>
      <td style="white-space:normal">${rdEsc(e.evidence)}</td></tr>`).join("");
  const hs = ["bn.trade","bn.depth","bn.bookTicker","hl.trades","hl.l2Book","hl.bbo"].map(id => [id.replace("."," "), S[id].on ? (status(S[id]) || "–") : "off"]);
  hs.push(["events / min", s.eventsPerMin], ["BN book age", s.bookAgeMs.bn == null ? "–" : s.bookAgeMs.bn + " ms"],
          ["HL book age", s.bookAgeMs.hl == null ? "–" : s.bookAgeMs.hl + " ms"], ["heartbeat", rdWorker ? "on" : "off"]);
  $("rdHealth").innerHTML = hs.map(([k, v]) => `<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("");
}

// ---------- loops ----------
```

Then in the frame loop make two edits. Replace `let lastFast = 0, lastChart = 0, lastMicro = 0, lastViz = 0, lastTrade = 0;` with:

```js
let lastFast = 0, lastChart = 0, lastMicro = 0, lastViz = 0, lastTrade = 0, lastReader = 0;
```

and replace the line `    if (visible("viz") && ts - lastViz > 400){ lastViz = ts; renderViz(); }` with:

```js
    if (visible("viz") && ts - lastViz > 400){ lastViz = ts; renderViz(); }
    if (visible("reader") && ts - lastReader > 250){ lastReader = ts; renderReader(); }
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test`
Expected: PASS (including `tests/ui.test.js`).

- [ ] **Step 7: Verify in the browser**

Reload the page, press **Connect**, open the **Reader** tab. Expected: the strip shows `calibrating N%` counting up to 100% over about 2 minutes (the status label at the top right of the panel too), then `armed`; four cards (activity, fast, mid, slow) plus "last event"; the feed fills when detectors fire; the family and venue chips filter the feed; the minimum-strength slider hides weak events; unticking a detector box stops that type; the **Engine health** panel shows streams as `live`. Console: `READER.state().calibrated` becomes `true`. No red console errors.

- [ ] **Step 8: Commit**

```bash
git add stream-visualizer.html tests/ui.test.js
git commit -m "feat(reader): Reader tab with state strip, event feed, controls and health

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Heartbeat worker and stale-feed visibility

**Files:**
- Modify: `stream-visualizer.html` (main script)
- Test: `tests/hooks.test.js` (append)

**Interfaces:**
- Consumes: `rdWorker` (declared in Task 9), `READER.advance`, `nowEx()` (existing, exchange-time estimate).
- Produces: `rdStartHeartbeat()`, `rdStopHeartbeat()`. The worker posts a message every 250 ms; each message calls `READER.advance(nowEx() - 1500)`.

- [ ] **Step 1: Write the failing test (append to `tests/hooks.test.js`)**

```js
test('a heartbeat worker advances the engine, with a latency grace, and is started and stopped with the connection', () => {
  assert.match(main, /function rdStartHeartbeat\(\)/);
  assert.match(main, /READER\.advance\(nowEx\(\) - 1500\)/);
  assert.match(main, /new Worker\(url\)/);
  assert.equal(count(main, /rdStartHeartbeat\(\);/g), 1, 'started once, in the Connect handler');
  assert.equal(count(main, /rdStopHeartbeat\(\);/g), 2, 'stopped in the disconnect branch and at the top of rdStartHeartbeat');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL (no `rdStartHeartbeat`).

- [ ] **Step 3: Implement**

Directly below the line `let rdWorker = null;                             // heartbeat worker (Task 11)` (Task 9) replace that line with:

```js
let rdWorker = null;                             // heartbeat: closes buckets when feeds go quiet; works even when timers on the page are throttled
function rdStopHeartbeat(){ if (rdWorker){ try{ rdWorker.terminate(); URL.revokeObjectURL(rdWorker._url); }catch{} rdWorker = null; } }
function rdStartHeartbeat(){
  rdStopHeartbeat();
  try{
    const url = URL.createObjectURL(new Blob(["setInterval(()=>postMessage(0),250)"], {type:"text/javascript"}));
    rdWorker = new Worker(url); rdWorker._url = url;
    rdWorker.onmessage = () => rdSafe(() => READER.advance(nowEx() - 1500));   // 1.5 s grace so slightly late trades still land in the right bucket
  }catch(e){ rdWorker = null; }                  // no worker (blocked context): the engine still advances on every message
}
```

In the Connect handler, replace `  bnConnect(); hlConnect();\n  $("go").textContent="Disconnect";` with:

```js
  bnConnect(); hlConnect(); rdStartHeartbeat();
  $("go").textContent="Disconnect";
```

and in the disconnect branch replace `    connected=false; bnDisconnect(); hlDisconnect(); clearInterval(clockTimer);` with:

```js
    connected=false; bnDisconnect(); hlDisconnect(); clearInterval(clockTimer); rdStopHeartbeat();
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Reload, press **Connect**, then run in the console:

```js
(async () => { let n = 0; const f = READER.advance; READER.advance = t => { n++; return f(t); };
  await new Promise(r => setTimeout(r, 5000)); READER.advance = f;
  return { heartbeatCalls: n, worker: !!rdWorker }; })()
```

Expected: `worker: true` and `heartbeatCalls` at least 4 (about 20 when the tab is in the foreground, fewer when throttled). Press **Disconnect** and check `rdWorker === null`. The **Engine health** panel shows `heartbeat on` while connected.

- [ ] **Step 6: Commit**

```bash
git add stream-visualizer.html tests/hooks.test.js
git commit -m "feat(reader): heartbeat worker so buckets close when feeds go quiet

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end verification, soak test, spec update

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-market-reader-design.md`
- No product code unless a check below fails (then fix at the root cause, add a test first, and re-run everything).

**Exit criteria (from the spec, Phase 1):** scenario tests pass; the soak test passes.

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: every test passes (unit, scenarios, hooks, ui). Record the count.

- [ ] **Step 2: Regression of the existing page (browser)**

With the page connected for at least 15 seconds, paste:

```js
(async () => {
  const errs = []; addEventListener('error', e => errs.push(e.message));
  const _ce = console.error; console.error = (...a) => { errs.push(a.map(String).join(' ').slice(0, 160)); _ce(...a); };
  document.getElementById('simGo').click();
  const fns = { drawBubbles, drawCvd, renderFlow, renderMicro, renderMetrics, renderBooks, renderTape, renderCards, renderHealth, renderLog, renderInspector, renderTrading, renderReader };
  const failed = {};
  for (const t of ['charts','micro','reader','viz','trading','accounts','market','tape','streams','health','raw','all']) {
    setTab(t); await new Promise(r => setTimeout(r, 250));
    if (visible('viz')) renderViz();
    for (const [n, f] of Object.entries(fns)) { try { f(); } catch (e) { (failed[n] ||= []).push(e.message.slice(0, 80)); } }
  }
  const ask = M.bnAsk;
  const buy = await placeOrder({ side: 'BUY', type: 'MARKET', qty: 300 / ask, price: ask, reduce: false });
  const close = await placeOrder({ side: 'SELL', type: 'MARKET', qty: SIM.positions[accSym()].qty, price: M.bnBid, reduce: true });
  return { failed, errs, buy: buy.msg, close: close.msg, flat: SIM.positions[accSym()].qty === 0 };
})()
```

Expected: `failed: {}`, `errs: []`, both fills reported, `flat: true`.

- [ ] **Step 3: Scenario self-test in the page**

Run `READER.selfTest()`. Expected: every entry has `ok: true` (11 scenarios).

- [ ] **Step 4: Soak test with recording (about 10 minutes, tab in the background)**

1. Reload, press **Connect**, and in the console run `READER.startRecording()` immediately (before the first events arrive).
2. Switch to **another tab or window** so this tab is hidden, and leave it for 10 minutes.
3. Come back and run:

```js
(() => { const inputs = READER.stopRecording();
  const blob = new Blob([JSON.stringify({ inputs, events: READER.events, cfg: READER.cfg })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'reader-recording.json'; a.click();
  return { inputs: inputs.length, events: READER.events.length, state: READER.state() }; })()
```

4. Move the downloaded file into the project folder and run: `node tests/replay.js reader-recording.json`
   Expected: `identical: true`. This proves the engine's output depends only on the inputs it received, so background throttling cannot change its results.
5. Check from the printed state: `eventsPerMin` never above 20; the event count is plausible for 10 minutes (a handful to a few hundred); the console shows no red errors; `READER.state().calibrated` is `true`.
6. **Optional manual parity check:** repeat with the tab visible for 10 minutes and compare event-type counts with the hidden run. They will differ because the market differs; look only for the same kinds of events and no event storms.

- [ ] **Step 5: Engine CPU cost**

With the page connected and the Reader tab hidden, run:

```js
(async () => { let ms = 0; const wrap = k => { const f = READER[k]; READER[k] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { ms += performance.now() - t0; } }; return () => { READER[k] = f; }; };
  const undo = ['onTrade','onQuote','onBook','onSweep','advance'].map(wrap);
  await new Promise(r => setTimeout(r, 30000)); undo.forEach(u => u());
  return { engineMsPer30s: Math.round(ms), percentOfOneCore: +(ms / 300).toFixed(2) }; })()
```

Expected: `percentOfOneCore` below 5 (the spec's budget). If it is higher, profile `onBook`/`trackWalls` first.

- [ ] **Step 6: Update the spec with the five deviations and the status**

Run this once from the project folder:

```bash
python - <<'EOF'
from pathlib import Path
p = Path("docs/superpowers/specs/2026-10-09-market-reader-design.md"); s = p.read_text(encoding="utf-8")
def swap(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new)
swap("Status: draft for review", "Status: approved; Phase 1 implemented (see docs/superpowers/plans/2026-10-09-market-reader-phase1.md)")
swap("- *Wall pulled:* a wall loses >= 70% of its size with no trade at or through its price in the last 1 s and price not within one tick of it.",
     "- *Wall pulled:* a wall loses >= 70% of its size and less than 20% of the lost size traded at or through its price in the last 1.5 s. (Replaces the earlier \"not within one tick\" test; tick size is not known per venue.)")
swap("- *Imbalance flip:* top-10 imbalance crosses +/-0.35 and holds 3 s (with hysteresis).",
     "- *Imbalance flip:* top-10 imbalance crosses +/-0.35 and holds 3 s (with hysteresis). The first lean is recorded silently; an event fires only when the lean changes sign.")
swap("**Capitulation, squeezes, breakouts**", "**Capitulation, squeezes, breakouts** (Binance only in Phase 1; Hyperliquid variants arrive with the cross-venue work in Phase 3)")
swap("A small inline Web Worker posts a tick every 250 ms so buckets still close when no trades arrive.",
     "A small inline Web Worker posts a tick every 250 ms so buckets still close when no trades arrive; each tick advances the engine to `nowEx() - 1500 ms` (a grace period for delivery latency).")
swap("and event counts within 10% between a **visible** and a **hidden** tab, to prove the background requirement.",
     "and **replay determinism**: the engine's inputs recorded during a hidden-tab soak are replayed offline (`node tests/replay.js`) and must reproduce the same events exactly, which proves background throttling cannot change results. An optional manual visible-tab run checks for the same kinds of events and no event storms.")
swap("3. **Phase 3:** multi-horizon consensus and conflicts, cross-venue detectors, sensitivity control.",
     "3. **Phase 3:** multi-horizon consensus and conflicts, cross-venue detectors. (Per-detector toggles and the Low/Medium/High sensitivity control already shipped in Phase 1.)")
p.write_text(s, encoding="utf-8"); print("spec updated")
EOF
```

Expected: `spec updated`.

- [ ] **Step 7: Final commit**

```bash
git add docs/superpowers/specs/2026-10-09-market-reader-design.md
git commit -m "docs(reader): record Phase 1 deviations and soak method in the spec

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git log --oneline | head -20
```

Expected: a clean history with one commit per task. Phase 1 is done when Steps 1 to 5 all meet their expected results. Phases 2 and 3 get their own plans, written from what the soak test shows.
