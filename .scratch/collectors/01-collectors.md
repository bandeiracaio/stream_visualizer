# Collectors: data we do not collect yet

Status: agreed (2026-10-23). Framework and F self-telemetry built in v053; A derivatives context and the always-on worker built in v055; G calendar tags (rules only) in v056; B book depth summaries in v057; C extra venues in v058; E Hyperliquid wallet layer in v059; D options and volatility in v060 (the last on the list: all seven are built).

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

## Built in v056 (collector G, calendar tags: rules only)
- Decision (user, 2026-10-23): rule-based tags only. Scheduled macro releases (CPI, FOMC, jobs) follow no rule and are not collected; they need a hand-kept list or a calendar source, left for later.
- `COLLECT.calendar(t0, t1)` (pure, no network) returns `[{t, tags}]` for each instant in `(t0, t1]`, tags merged per instant. The always-on worker calls it every second from the last check, writes `["c", "cal", t, {tags}]` with `t` = the scheduled instant, and does not back-fill a gap over 6 h (the computer slept). A worker restart starts from "now", so no duplicates.
- Tags (UTC): `15m`, `1h`, `4h`, `1d`, `1w` (Monday 00:00), `1M` (the 1st), `funding` (00 / 08 / 16: the Binance 8 h rule; a symbol on another interval is not followed), `usOpen` / `usClose` (09:30 / 16:00 New York on weekdays, daylight saving followed through `Intl`; exchange holidays and early closes are NOT known), `optExp:daily|weekly|monthly|quarterly` (08:00 UTC every day; Friday weekly; last Friday of the month monthly; last Friday of Mar / Jun / Sep / Dec quarterly).
- The worker now gets `want:{derivs, calendar}` in its start message and restarts when the symbol or either switch changes; with only the calendar on it opens no socket and makes no request.

## Built in v057 (collector B, book depth summaries)
- **What the recording already had:** `["b", venue, t, bids, asks]` every 250 ms, but shallow: Binance 30 levels is under 1 bp for BTC (tick 0.1) and Hyperliquid's default 20 levels reach about 2.4 bps. So depth beyond the touch is the new information here, not a copy of the raw book.
- **Deviation from the plan:** the edges are 1 / 5 / 10 / **20** bps, not 25. Measured live (BTC): Binance's REST snapshot (limit 1000, the maximum on futures) reaches about 15-17 bps; Hyperliquid `l2Book` with `nSigFigs:4` (20 buckets of $10, about 1.2 bps each) reaches about 24 bps. 25 is out of reach of both; 20 is reachable on Hyperliquid, and Binance reports `null` for it. `null` means "the data does not reach that far", never zero.
- **Runs on the page, only while connected and recording** (it needs the page's books; this is the "fast collector" case). Once a second: `bookBn` = `{mid, spr (bps), tb, ta (size at the best bid / ask), reach:[bid, ask] (bps), d:{edge:[bidQty, askQty]}, fl:{b, a}}` and `bookHl` = the same without `fl`, plus `coarse:[edges taken from the bucketed book]` and `cAge`. Quantities are in coins. On a hidden tab the page's timers slow down, so it thins out (the recording needs the visible window anyway).
- **Binance reach is the snapshot's reach, not the farthest level seen:** the local book also holds stray far levels that diffs touched (seen at 9876 bps), so the book's own farthest level says nothing about coverage. `collectors.js` notes the snapshot's farthest bid and ask the moment a new book appears (that runs on every update, recording or not) and reports the distance from the current mid to those.
- **Hyperliquid:** the exact 20 levels give the 1 bp edge and the touch; a `nSigFigs:4` REST poll every 2 s (rests 5 min on HTTP 429, errors to the Health log once per 5 minutes) gives the deeper edges, so those are bucket-resolution only (`coarse` lists them). The coarse settings are tuned for BTC; a low-priced coin gets coarser buckets.
- **Flow (`fl`):** size added and removed within 20 bps of the mid per side, per second, from Binance's incremental updates: `add` / `rem` (coins), `nAdd` (new level), `nUp` (level grew), `nRed` (level shrank), `nDel` (level gone). "Removed" is a cancel or a trade; the two cannot be told apart from the book. It is read by wrapping `bnDepth` (called as before, never changed, observation inside try/catch).
- Size: about 0.55 KB a second for both books, so about 2 MB an hour, inside the 10 MB an hour rule.

## Verified endpoints for collector C, extra venues (checked live 2026-10-23, BTC; also from a browser origin in Chrome)
All public WebSockets, no key. A browser page and a worker connect to every one of them.
- **Coinbase** `wss://ws-feed.exchange.coinbase.com`, subscribe `{type:"subscribe", product_ids:["BTC-USD"], channels:["ticker"]}`: `price`, `best_bid`, `best_ask`, `time` (microsecond ISO string) on every trade.
- **Bybit perp** `wss://stream.bybit.com/v5/public/linear`, `{op:"subscribe", args:["tickers.BTCUSDT"]}`: a snapshot, then **deltas carrying only the changed fields** (merge them); fields `bid1Price`, `ask1Price`, `lastPrice`, `markPrice`, `indexPrice`, `fundingRate`, with `ts`. Wants a `{op:"ping"}` every 20 s.
- **Bybit spot** `.../v5/public/spot`: the ticker has only `lastPrice` (and `usdIndexPrice`), no bid or ask.
- **OKX** `wss://ws.okx.com:8443/ws/v5/public`: channels `tickers` for `BTC-USDT-SWAP` and `BTC-USDT` (bid, ask, last, `ts`), `mark-price` for the swap, `index-tickers` for the pair. Wants the text `ping` every 20 s (answers `pong`, not JSON).
- **Binance spot** `wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker`: bid, ask and sizes, no event time.
- **Majors** `wss://fstream.binance.com/market/stream?streams=ethusdt@markPrice@1s/...`: mark price with event time. (`!markPrice@arr@1s` for every symbol was tried and is far too much: hundreds of symbols a second.)
- REST for the same data exists but is not used: Bybit and OKX REST sent no CORS header, so a page could not call them.

## Built in v058 (collector C, extra venues)
- **Runs in the always-on worker, but only while a recording is on** (the fast-collector rule): the page tells the worker `{t:"rec", on}` within a second of a recording starting or stopping; the worker opens the six sockets then and closes them when it stops. Nothing is recorded or connected otherwise. With the symbol changed or the switch toggled the worker restarts as before.
- **Record** `["c", "venues", t, {...}]` once a second, one entry per source that has spoken: `cb` Coinbase spot, `byL` Bybit perp, `byS` Bybit spot (last only), `okS` OKX swap, `okP` OKX spot, `bnS` Binance spot (bid and ask), `maj` (eth / sol / bnb / xrp / doge marks; the watched coin is left out). Fields: `b` bid, `a` ask, `l` last, `m` mark, `i` index, `f` funding rate, `age` (ms since the source last sent anything) and `lag` (local time minus the exchange's own time, where it sends one: this holds the clock offset too). Sizes are not kept; the book collector covers depth.
- **Not computed here:** the perp-spot basis and the correlation. The raw quotes are kept so both can be worked out afterwards (Binance's own mark, index and basis are in the `basis` record).
- A silent socket (30 s) is closed and reopened, a closed one is reopened after 5 s, notes go to the Health log at most once per 5 minutes per socket.
- Measured live: about 500 bytes a record, so about 1.8 MB an hour. With book depth (about 2 MB an hour) a 60-minute recording is near the old 5 MB file budget, so `FILE_BUDGET` is now 8 MB.
- **For a coin other than BTC** a venue may not list it (Coinbase has no `-USD` for many); that source simply never appears. Coins whose Binance symbol is not `<COIN>USDT` are not handled.

## Verified endpoints for collector E, Hyperliquid wallets (checked live 2026-10-23, BTC)
- **Per-wallet flow is already collected:** every `trades` message names both wallets (`users:[buyer, seller]`) and every recording stores them in its `["t", ...]` inputs. Nothing new was needed for that item.
- `POST /info {type:"clearinghouseState", user}`: about 0.3 s, `access-control-allow-origin: *`. Gives `marginSummary` (accountValue, totalMarginUsed) and `assetPositions[].position` with `coin`, `szi` (signed size), `entryPx`, `liquidationPx`, `leverage`, `unrealizedPnl`.
- WebSocket `{type:"userFills", user}`: a first message with `isSnapshot:true` (old fills, large) and then live fills of that wallet on any coin, each with `dir`, `closedPnl`, `startPosition` and, for a liquidation, a `liquidation:{liquidatedUser, markPx, method}` object. Twelve users on one socket were accepted without an error (the documented limit is about 10).
- `POST /info {type:"predictedFundings"}`: 64 KB, rows `[coin, [[venue, {fundingRate, nextFundingTime, fundingIntervalHours}], ...]]` with venues `BinPerp`, `HlPerp`, `BybitPerp`.
- **Not usable:** `userFills` over REST (644 KB for one wallet, 1.6 s), `liquidatable` (empty), the leaderboard (38 MB, no CORS header), and there is no public global liquidation feed.
- **Not seen live:** a liquidation fill. The liquidation object's shape is from Hyperliquid's documentation and is covered only by a synthetic self-test; check the first real `hlLiq` record against it.

## Built in v059 (collector E, Hyperliquid wallets; decisions: full addresses, always on)
- **Always on** in the worker (slow collector), one extra socket `wss://api.hyperliquid.xyz/ws`. Switch: "wallets". With the symbol changed or the switch toggled the worker restarts and the ranking starts over.
- **Ranking:** every `trades` fill credits both wallets with its notional; the 10 with the most notional in the last 15 minutes are followed. This favours market makers and bots (there is no public ranking by position size). Trade replays on subscribe count (they carry their own times). Polling starts 60 s after the worker starts, so the ranking has data.
- **`walletsTop`** every 30 s, only for wallets whose position changed (size, entry, leverage or liquidation price), plus a refresh of each wallet every 5 minutes: `{rows:[{w (full address), n (15 min notional, $), sz (signed size in this coin, 0 = none), e (entry), lq (liquidation price), lev, up (unrealised PnL on it), av (account value), mg (margin used)}]}`. Wallets that join the top 10 are subscribed to `userFills` and polled; those that leave are unsubscribed.
- **`hlLiq`**: one record per live fill that carries a `liquidation` object, for the followed wallets only, on any coin: `{w, coin, side, px, sz, t, dir, pnl, start, liquidated, mark, method}`. Snapshots are ignored.
- **`fundPred`** every 60 s: `{Bin:[rate, next time, interval h], Hl:[...], Bybit:[...]}` for the coin.
- Cost: about 60 request weight a minute of the 1200 allowed. Size: measured about 1.5 KB per `walletsTop` record, so 3 to 5 MB a day when the wallets are busy (more than first estimated: the 42-character address is a quarter of each row).
- **Hygiene:** addresses live only in data files. `.gitignore` now also covers `tape_*.json` and `health_*.json` (recordings and registers were already covered).

## Verified endpoints for collector D, options and volatility (checked live 2026-10-23)
Deribit's public API, no key. REST under `https://www.deribit.com/api/v2/public/`; the CORS header echoes the page's `Origin` (a request without an Origin, such as curl, shows none; it worked from a Chrome page on localhost). WebSocket `wss://www.deribit.com/ws/api/v2` (JSON-RPC, no CORS issue).
- `get_book_summary_by_currency?currency=BTC&kind=option`: every listed option (930 for BTC, 12 expiries): `instrument_name` (`BTC-27NOV26-73000-P`), `mark_iv` (percent), `bid_price`, `ask_price`, `open_interest` and `volume` (coins), `underlying_price` (the expiry's forward), `estimated_delivery_price` (the index). 415 KB of JSON, sent compressed over HTTP. There are no greeks in it (those need one `ticker` call per instrument), so skew is taken by moneyness, not by delta.
- Channels `deribit_volatility_index.btc_usd` (DVOL, the 30-day implied vol index, a push every few seconds) and `deribit_price_index.btc_usd`. Same for `eth_usd`.
- Not used: `get_instruments` (812 KB, not needed), `get_volatility_index_data` (history; the push is enough), `ticker` per instrument (greeks, bid / ask IV).
- Options and a volatility index exist for BTC and ETH only here; for any other coin the collector writes one Health log note and stays idle.

## Built in v060 (collector D, options and volatility)
- **Always on** in the worker (slow collector), switch "options". One socket for the two index channels, one request every 120 s for the chain.
- **`dvol`** every 10 s: `{vol (DVOL, percent), idx (Deribit index price), vAge, iAge (ms since each was last pushed)}`.
- **`optChain`** every 120 s: `{u (index), exps:[...], tot}`. For the 5 nearest expiries still to come: `x` (label, e.g. `27NOV26`; expiry is 08:00 UTC), `dte` (days), `f` (forward), `atm` (implied vol at the strike nearest the forward, call and put averaged), `s` (out-of-the-money implied vol at -10, -5, +5, +10 % of the forward: a put below, a call above, nearest listed strike within 3 %, otherwise null), `oc` / `op` (call / put open interest, coins), `vc` / `vp` (call / put 24 h volume, coins), `pin` (the 5 strikes with the most open interest, call plus put, `[strike, coins]`). `tot` adds `oc`, `op`, `vc`, `vp` over every expiry.
- About 1.2 KB a chain record, so about 1 MB a day, plus `dvol` about 0.9 MB a day. The chain download is about 400 KB uncompressed every 120 s (compressed on the wire).
- A request that fails or is rate limited rests that source for 5 minutes (HTTP 429), and is noted in the Health log at most once per 5 minutes.

## Status
All seven candidates (F, A, G, B, C, E, D) are built. The remaining step in the spec is the monthly judgement: coverage, variance, and whether each collector leads the next 5 minutes of volatility or movement; drop the ones that show nothing.

## Changed in v063 (context before an auto-recording's trigger)
- Motivation (user, 2026-10-24): when a recording turns on, the best information possible should be in the file. The collectors cannot feed the Reader engine (by design); what they can do is travel with the recording.
- **Lead-in:** `colSlice(t0, leadMs)`; a session saved with auto-record's `pre` takes the tape from 30 minutes before the trigger (it was one minute before the start for every session). The slow collectors (derivatives, wallets, options, calendar, telemetry) were already filling the tape all along, so a night recording now carries their 30 minutes of context. A hand-made recording still takes one minute. The newest-first file budget (8 MB) drops the oldest records first if a file runs over.
- **Venues while armed:** the page tells the worker `{t:"rec", on}` when a recording is on OR auto-record is armed, so the extra venues' sockets are open for the wait and the lead-in has cross-venue quotes. This replaces "only while recording" for `venues`; the cost is the six sockets and about 2 MB an hour on the tape for as long as auto-record is armed (a night is about 15 MB; the tape keeps 24 h).
- **Book depth stays recording-only:** it reads the app's full Binance book, which only exists with the feeds connected, and an armed app listens to one price stream by design.

## Changed in v064 (a status line per collector)
- The Collectors list (Reader tab, under Health log) now shows, under each switch, whether that collector is writing: records on the tape, time since its last one, green when it is within three times its usual interval, amber when slower or silent for long after the page opened, grey with the reason when it is not expected to write now (switch off, needs a recording, needs the app connected, Deribit has no options for the coin, worker not running). Telemetry waits for the app to be connected or armed; the calendar says "starting..." until its first 15-minute mark.
- `COLLECT.OWNER` maps every record name to its collector, `COLLECT.EXPECT_MS` gives the usual interval, `COLLECT.tally` / `health` / `ageText` are pure and self-tested. A new record name must be added to `OWNER`, or it is written to the tape but counted under no collector (a self-test checks that every collector owns at least one name).
- The list used to be rebuilt on every record; it is now built once and only the status texts update, once a second.

## Offline analysis (analyze-collectors.mjs, 2026-10-24)
The monthly judgement ("coverage, variance, and whether a collector leads the next 5 minutes of volatility") has a first tool: `analyze-collectors.mjs` at the repo root. It is not part of the app (no release). Coverage, lead-in and the constant-field check are exact; the lead test is a Spearman rank correlation between a feature taken at a record's time and the realised volatility (and absolute move) of the Binance mark over the following horizon (default 5 minutes), built from the 10-second `basis` marks. It is descriptive only. Real conclusions need weeks of data, several regimes, and a better test than overlapping windows (blocked or subsampled windows, partial correlations against current volatility, so that a feature is not credited just for echoing the volatility we already have). Those are the next steps when there is data to look at.
Self-checks: `node analyze-collectors.mjs --selftest` builds a synthetic tape (a volatility index that leads by construction, a noise field, a constant field, a gap) and checks the numbers.
