# Collectors: data we do not collect yet

Status: agreed (2026-10-23). Framework and F self-telemetry built in v053; A derivatives context and the always-on worker built in v055.

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

## Verified endpoints for collector A, derivatives context (checked live 2026-10-23, BTCUSDT)
All answer 200 with `Access-Control-Allow-Origin: *`, so the page and the worker can call them from the browser, no key.
- **Binance `GET /fapi/v1/premiumIndex?symbol=`**: markPrice, indexPrice, estimatedSettlePrice, lastFundingRate, interestRate, nextFundingTime (weight 1, shows in `x-mbx-used-weight-1m`).
- **Binance `GET /fapi/v1/openInterest?symbol=`**: openInterest in coins, with its own time.
- **Binance `GET /futures/data/openInterestHist | globalLongShortAccountRatio | topLongShortPositionRatio | takerlongshortRatio`** (`period=5m`): one point per 5 minutes, so polling more than once a minute is waste. takerlongshortRatio is buyVol / sellVol per 5 minutes.
- **Binance `@markPrice@1s` (stream)** already carries mark `p`, index `i`, funding `r` and next funding `T`: basis costs no extra request, and the worker already reads this stream.
- **Binance `@forceOrder` (stream, `/market/stream?streams=`)**: liquidations as `{e:"forceOrder", o:{S, q, p, ap, z, X, T}}`; 2 in about 80 s on BTC. Not on REST: `/fapi/v1/allForceOrders` returns 404 now. The page already subscribes to it (app.js `bn.forceOrder`), but the worker's socket does not.
- **Hyperliquid `POST /info {"type":"metaAndAssetCtxs"}`**: per asset funding, openInterest, premium, oraclePx, markPx, midPx, dayNtlVlm. Index 0 of the universe is BTC.
- **Not found / left for later:** Hyperliquid liquidations (belongs to collector E, wallet layer); Binance predicted funding is `estimatedSettlePrice`/premium only, not a separate field.

## Built in v055 (collector A, and the always-on worker)
- **Always-on worker:** `collectors-worker.js` (embedded as `#colWorkerSrc`, with `collectors-core.js`) is started by `collectors.js` as soon as the page loads, whether or not auto-record is armed or the app is connected. It is separate from auto-record's price worker, which is unchanged. It restarts when the symbol changes and stops when its switch is turned off. If workers are unavailable or it errors, it only writes to the Health log; there is no retry loop (reload the page).
- **Records** (all `["c", name, t, payload]`): `bnDerivs` every 15 s (premium index + open interest, either part `null` if it failed), `hlCtx` every 15 s (Hyperliquid funding, open interest, premium, oracle, mark, mid), `ratios` every 60 s but only when a new 5 minute point arrived (account long-short, top-trader position long-short, taker buy/sell), `basis` every 10 s (mark, index, funding, next funding, basis in bps, from the `@markPrice@1s` stream), `liq` one per liquidation (from `@forceOrder`). About 3.7 MB a day measured live (70 s run: 2965 bytes, before any liquidation).
- **Failure isolation:** one failing source logs `collector error` to the Health log at most once per 5 minutes and the others carry on; HTTP 429 / 418 rests that source for 5 minutes.
- **Stream:** one socket `wss://fstream.binance.com/market/stream?streams=<sym>usdt@markPrice@1s/<sym>usdt@forceOrder`, reopened after 5 s, closed and reopened after 15 s of silence.
- **Frozen page:** the worker keeps running, but the tape is written by the page, so records posted while the page is frozen are written when it thaws (they carry their own time).
