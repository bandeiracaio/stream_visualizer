# Market Reader tab - design

Date: 2026-10-09 · Status: draft for review · Project: `stream-visualizer.html` (single file, no dependencies)

## 1. Goal

A new tab, **Reader**, that watches the live Binance and Hyperliquid feeds continuously and detects named order-flow behaviours (absorption, exhaustion, capitulation/squeezes/breakouts, wall and book events), shows them as a live event feed with plain-English evidence, and summarises who is in control per time horizon.

It automates the tape-reading method studied from two courses (Level 2 + time & sales + order-book depth; judging how aggressive buyers and sellers are; spotting large participants through refreshing, hidden and absorbed orders). It describes order-flow behaviour. It does not give buy/sell advice.

## 2. Decisions (from the interview)

| Topic | Decision |
|---|---|
| Output | Event detector with a state strip. No numeric -10..+10 score in v1. |
| Patterns | Absorption, exhaustion, capitulation/squeezes/breakouts, wall and book events. |
| Venues | Both. Binance leads (it is far larger); Hyperliquid adds order counts per level, buyer/seller wallets, and divergence checks. |
| Time horizon | Dynamic: an adaptive window **and** several horizons at once. |
| Runtime | Must keep working in a hidden or minimised tab. |
| Trading link | Read-only. Never touches the order ticket or accounts. |
| Memory | Live only. Last 500 events in memory, gone on refresh. |

Non-goals: alerts or sound, persistence/export, machine learning, order placement, other exchanges.

## 3. Constraint that shapes the architecture

Chrome throttles timers in hidden tabs (measured in testing: `setInterval` ran at about 1 per second instead of the intended 4) and does not deliver animation frames to them (browser behaviour; charts stayed stale in testing). WebSocket messages, however, kept arriving normally (hundreds of trades received while hidden). The existing page samples history on timers, so it degrades in the background. **The Reader's engine is therefore driven by incoming messages and exchange timestamps, never by timers or animation frames.** Rendering is separate and only runs while the tab is visible.

## 4. Architecture

```
 WebSocket handlers (existing)            Reader engine (new, always on)            Reader tab (new, render only)
 bnHandle / hlHandle / addTrade   --->    event-time buckets (250 ms)     --->      state strip
 bnDepth / hl.l2Book / addSweep           rolling horizons (volume clock)           event feed + chart markers
 bn.forceOrder, bookTicker                feature extraction -> detectors           controls (toggles, sensitivity)
                                          event store (ring of 500)
```

- **Hooks.** One call per message type from the existing handlers: trade (`addTrade`), best bid/offer (`bn.bookTicker`, `hl.bbo`), Binance book diff applied (`bnDepth`), Hyperliquid book snapshot (`hl.l2Book`), liquidation (`bn.forceOrder`), sweep (`addSweep`). Hooks are no-ops until the Reader is enabled and never throw into the host handler (wrapped in try/catch).
- **Event-time clock.** The engine's "now" is the latest exchange timestamp seen (corrected with the existing `clockOffset`). When a message's time crosses a 250 ms boundary the engine closes the elapsed buckets, filling any gap with empty buckets that carry the last book state forward. This keeps results correct even if the tab was stalled.
- **Heartbeat.** A small inline Web Worker posts a tick every 250 ms so buckets still close when no trades arrive. If the worker is unavailable, buckets close on the next message (same result, slightly later). The tab shows a "feed stale" badge when no message has arrived for longer than a per-stream threshold (reusing the existing `STREAMS[].gap`).
- **Visibility.** Rendering is driven by the existing `frame()` loop only when the Reader tab (or a moved Reader panel) is visible. The engine never depends on it.

## 5. Dynamic windows (volume clock)

A fixed number of seconds means different things in a dead market and in a panic. The Reader measures windows in **normal-market activity** instead.

- Baseline `B`: long-run (about 30 min, warmed up from the first 2 min) EWMA of traded $/s per venue.
- Three horizons, each a target amount of *baseline activity*: fast = 15 s-worth, mid = 60 s-worth, slow = 300 s-worth.
- Actual window length = nominal length / (current rate / `B`), clamped to 3 s - 10 min. When the market runs 4x faster than normal the fast window shrinks to about 4 s; in a dead market it stretches.
- All z-scores use **robust statistics** (median and MAD of the same feature over the last ~30 min), so thresholds adapt to the asset (BTC, ETH, alts) and to the session.
- **Calibrating.** For the first ~2 minutes after Connect (or an asset change) detectors are disarmed and the strip says "calibrating".
- **Consensus.** The strip shows the side in control per horizon and flags conflicts (e.g. fast bearish, slow bullish).

## 6. Features computed per bucket and per venue

Buy $, sell $, trade count, largest trade, high/low/close of mid, spread, resting depth within +/-10 bps (bid and ask), top-10 imbalance, liquidation $ (Binance), sweep count and $ by side, price levels traded at, Hyperliquid orders-per-level and buyer/seller wallets. Horizon aggregates are sums over buckets in the window; derived values: net delta, taker share, intensity z, price displacement in units of window sigma, efficiency ratio (|net move| / path length).

## 7. Detectors

All thresholds below are **initial defaults to be tuned on live data**. Every detector has a cooldown per (type, venue, side, price zone), default 5 s, and the feed has a global cap of 20 events per minute (lowest strength dropped first).

**Wall and book events**
- *Wall appears:* a level within 30 bps of mid with size >= 8x the median of the top 20 levels, persisting >= 2 s.
- *Wall pulled:* a wall loses >= 70% of its size with no trade at or through its price in the last 1 s and price not within one tick of it.
- *Wall eaten:* a wall is consumed with traded volume at that price accounting for >= 60% of the lost size.
- *Book thinning:* same-side depth within 10 bps falls >= 40% in 3 s versus its 30 s median.
- *Imbalance flip:* top-10 imbalance crosses +/-0.35 and holds 3 s (with hysteresis).
- *Spoof-like pattern:* >= 3 walls appear and vanish on one side within 5 s near the touch. Wording is "spoof-like", never an accusation.

**Capitulation, squeezes, breakouts**
- *Capitulation:* fast-horizon sell intensity z >= 3, sell share >= 70%, price down >= 1.5 sigma, plus at least two of: >= 2 sell-side liquidations, >= 3 sell sweeps, bid depth thinning.
- *Selling exhausted ("panic ending"):* after a capitulation, sell intensity falls below 40% of its peak for >= 3 s, no new low for 3 s, and bid depth recovers >= 30%. Bullish.
- *Squeeze / breakout:* mirror of capitulation (buy burst, buy share, short-liquidations, buy sweeps, ask depth thinning); breakout additionally requires price taking out the 5-minute high.

**Absorption**
- *Passive absorption:* taker share >= 65% one way and intensity z >= 2 while displacement <= 0.5 sigma (efficiency ratio <= 0.25) and the resisting side's depth is replenishing (>= 80% of earlier). Bullish if sellers are absorbed, bearish if buyers are.
- *Refreshing level:* >= 4 trades at one price with cumulative taker $ >= 5x the visible size at that level at the first trade (iceberg-style).
- *One-wallet pressure (Hyperliquid):* one wallet on one side accounts for >= 40% of $ over the window with >= 6 trades. Also attached as evidence to the two events above. Wallets are shown truncated.

**Exhaustion**
- *Buyer (seller) exhaustion:* price makes a new window high (low) while buy (sell) intensity z in the last third of the window has fallen >= 50% versus the first third, median trade size is shrinking, and there is >= 1 failed poke.
- *Failed poke:* price exceeds the prior swing by > 0.5 sigma and returns inside within 5 s.

**Cross-venue**
- *Unconfirmed move:* Hyperliquid moves >= 1.5 sigma in the fast window while Binance moves < 0.5 sigma. Marked weaker.
- *Basis stretch:* HL-BN basis z-score > 2.5 (reuses the existing basis series).

## 8. Event schema

`{ id, t (exchange ms), type, family, dir: "bull"|"bear"|"neutral", venue: "bn"|"hl"|"both", px, horizon: "fast"|"mid"|"slow"|"book", strength 0..1, evidence: string, refs: {...} }`

Evidence strings are short, factual and numeric, e.g. "sellers hit 2.4M in 6 s (z 3.8), price -0.2 sigma, bid depth refilled 91%".

## 9. The tab

A new `Reader` entry in `TABS`, with `data-tab="reader"` sections built like the existing ones (so they also work with the "move to Trading tab" modules).
1. **State strip:** calibrating/active status; per horizon (fast/mid/slow) the side in control and the current window length in seconds; activity regime (calm / active / hot); last notable event.
2. **Event feed:** newest first, colour-coded bull/bear/neutral, type, venue, price, horizon, strength bar, one-line evidence. Filter chips by family and venue, and a minimum-strength slider.
3. **Price chart with event markers** (same drawing style as the existing bubble chart).
4. **Controls:** per-detector on/off and a Low/Medium/High sensitivity that scales the thresholds.
5. **Engine health:** events per minute, bucket lag, per-stream freshness.

## 10. Performance and memory

Binance flow can reach hundreds of messages per second. Engine work per message is O(1) amortised (incremental top-of-book structures; the 1000-level Binance book is not re-sorted per bucket). Memory: ring buffer of 500 events; features kept for about 30 min at 250 ms (about 7,200 buckets per venue, a few numbers each). The engine is capped at a CPU budget of about 5% of one core during soak tests.

## 11. Testing

- **Scenario tests** with synthetic event generators fed straight into the engine, no network: a fake absorption, a fake exhaustion, a fake capitulation followed by recovery, a wall that is pulled, a wall that is eaten, a quiet market that must produce nothing. Run with `READER.selfTest()` from the console.
- **Live soak (browser automation):** 10 minutes connected on BTC and on ETH; no exceptions; <= 20 events per minute; and event counts within 10% between a **visible** and a **hidden** tab, to prove the background requirement.
- **Regression:** the existing tabs and the paper-trading flows keep passing the checks used for the earlier bug fixes.

## 12. Build order

1. **Phase 1:** engine, event-time buckets, volume clock and horizons, state strip, event feed, wall and book detectors, capitulation/squeeze/breakout. Exit: scenario tests pass; soak test passes.
2. **Phase 2:** absorption and exhaustion with Hyperliquid wallet evidence, chart markers. Exit: scenario tests pass and a manual review of about 30 live events judges most of them sensible.
3. **Phase 3:** multi-horizon consensus and conflicts, cross-venue detectors, sensitivity control. Exit: soak test passes with all detectors on.

## 13. Risks and open questions

- Thresholds will need tuning on live data; Phase 2 detectors (absorption, exhaustion) are the hardest to get right and may produce false alarms at first.
- Binance sweeps are a heuristic (same millisecond and side); Hyperliquid sweeps are exact. Evidence strings say which.
- Hyperliquid's book is 20 levels deep, so wall detection there only covers the near book.
- The page's existing history samplers (`microHist`, `cvdHist`, heatmap) still use timers and stay sparse in a hidden tab. Moving them to the same event-time approach is **out of scope** here and would be a separate follow-up.
- Wallet addresses are public, pseudonymous on-chain data; the tab shows them truncated and does not try to identify anyone.

## 14. Out of scope

Alerts or sound, saving or exporting events, backtesting, order placement or ticket pre-fill, other exchanges, a numeric pressure score.
