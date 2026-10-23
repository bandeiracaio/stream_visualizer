# Collectors: data we do not collect yet

Status: agreed (2026-10-23). Framework and F self-telemetry built in v053.

## Goal
Collect possibly useful data the app does not collect today, even where there is no event type or movement to attach it to yet. Log first,
interpret later. Motivation: the first real collection night showed how much context (latency, funding, open interest, who else is moving)
is missing when a recording is analysed afterwards.

## Decisions (user, 2026-10-23)
- **Sources:** free, public, no-key endpoints only (Binance and Hyperliquid first; later Coinbase, Bybit, OKX, Deribit). No accounts, no keys.
- **Where the data lives:** the same session file, as new input types (still replayable, covered by the quality and health notes). Each collector
  has its own on/off switch and a size budget (at most about 10 MB per hour compressed).
- **Always on or not:** slow collectors (about one point a second or slower) run all the time and keep a rolling 24 h tape on the device
  (IndexedDB, auto-pruned, Download/Share like recordings); the matching slice is attached to each recording. Fast collectors (book depth
  summaries, extra venues) run only while recording.
- **Collect only:** no new detectors, no UI beyond the Health log and the quality line. The engine ignores unknown input types. A self-test
  proves that adding collectors leaves every detection byte-identical.
- **Raw or summarized:** slow collectors store each raw sample (at most one record per poll or message); fast ones store a once-a-second
  summary while recording. The existing raw book stream is unchanged.
- **Where they run:** in the same Web Worker as the auto-record price feed, so they survive a hidden tab. REST polling no more often than every
  15 s. A collector that errors or is rate-limited only logs to the Health log and can never affect auto-record or a recording.
- **Judging them:** a monthly check of coverage, variance and whether a collector leads the next 5 minutes of volatility or movement. Drop the
  ones that show nothing.
- **Hygiene:** collected data and wallet addresses never enter git (recordings, tapes and registers are gitignored); tests use synthetic data.

## Candidates and build order (one collector per release)
1. **F self-telemetry:** exchange timestamp vs local arrival (latency, clock offset), message rate per stream, reconnects, gaps, out-of-order.
2. **A derivatives context:** funding and predicted funding, open interest, mark vs index (basis), the full liquidation stream with sizes,
   long/short and taker buy/sell ratios.
3. **G calendar tags:** funding times, hourly and daily candle closes, US open and close, options expiry, scheduled macro releases.
4. **B book depth summaries:** the book at 1/5/10/25 bps once a second, spread and touch size, update and cancel rates per side.
5. **C extra venues:** Coinbase, Bybit, OKX prices; perp-spot basis; a few majors for correlation.
6. **E Hyperliquid wallet layer:** per-wallet flow over time, the largest wallets' net position changes, HL liquidations and funding.
7. **D options and volatility:** Deribit volatility index, ATM implied vol, skew, strikes near expiry.

## First release (v053)
The collector framework plus F only: a registry of collectors, per-collector toggles, a new input type for their records (`["x", name, t, ...]`),
the size budget, the rolling tape, and the byte-identical guard test. Exact endpoints for each later collector are facts to verify for real
before that collector is built (for example Binance `markPrice` already carries funding and the index price; open interest and the long/short
ratios are REST; Hyperliquid has `metaAndAssetCtxs` on its info endpoint).

## Built in v053 (and two small deviations from the plan above)
- Records are `["c", name, t, payload]`, not `"x"` (the engine already uses `"x"` as its reset marker). They are attached to a saved session as `ext`, beside `inputs`, rather than mixed into `inputs`, because the tape slice is added at save time; the engine never sees them either way, and a self-test proves a replay with records among the inputs is identical.
- Telemetry runs in the worker while armed (the mark-price stream) and in the page while connected (every stream's rate, age, latency, late messages, clock offset, reconnects). The always-on worker for collectors that need no price socket comes with the next collector.

## Open
Nothing undecided. The exact record shapes and the tape's key layout are implementation details for v053.
