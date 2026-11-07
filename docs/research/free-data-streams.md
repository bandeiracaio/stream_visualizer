# Best free data streams per venue

Research done 2026-11-05 (brainstorm, nothing built). Some official doc sites (new Binance docs, OKX, Coinbase) did not load for the fetcher, so a few points are second-hand; those are marked *(second-hand)* or *(unverified)*. Check the official page before building on any of them.

Update 2026-11-06: Bybit `allLiquidation` and Bybit/OKX open interest are already collected by the `perpFlow` collector (v122, `.scratch/perp-flow/spec.md`; records `liqPerp` and `oiPerp`, fast collector, only while recording or armed). Binance's `liq` record still comes from `@forceOrder` and undercounts cascades.

Related: our own count of how much data each venue has in the saved sessions (98 hours, 166 sessions, BTC, 18 Oct to 5 Nov 2026): Hyperliquid has about 10% of Binance's trade count and about 26% of its traded notional; Hyperliquid trades are about 3x larger (median $466 against $156) and all carry wallet addresses; Binance has 5,827 liquidation-flagged trades ($394M), Hyperliquid none. 158 of the 166 sessions are auto-recordings, so they lean toward volatile stretches.

## Best free source for each kind of data

| Data | Best free source | Why, and the catch |
|---|---|---|
| **Trades** | Binance `aggTrade` (biggest tape); Hyperliquid `trades` (wallet addresses) | Binance trades carry no wallet identity. |
| **Order book** | Binance `depth@100ms` with a REST snapshot; Bybit `orderbook` at 1 / 50 / 200 / 1000 levels (shallower pushes faster, 10 to 200 ms) | OKX tick-by-tick deep books need login at VIP level 4 or 5 *(second-hand)*; OKX `bbo-tbt` (top of book, 10 ms) looks free *(second-hand)*. Hyperliquid: 20 levels per block, about 0.5 s (5 levels with `fast`). |
| **Liquidations** | Bybit `allLiquidation`: every liquidation, pushed every 500 ms | Binance keeps only the latest liquidation per symbol per 1000 ms, so a cascade is undercounted. OKX has a free `liquidation-orders` channel (sampling unknown). Hyperliquid's public trades flag none. |
| **Open interest** | Bybit `tickers`: open interest and funding at 100 ms (deltas carry only changed fields) | OKX pushes open interest every 3 s *(second-hand)*. Binance: REST only as far as I could tell *(unverified)*. Hyperliquid: `activeAssetCtx`. |
| **Funding, mark, index** | Binance `markPrice` (1 to 3 s), Bybit `tickers`, Hyperliquid `activeAssetCtx` (one coin) or `allDexsAssetCtxs` (all markets in one subscription) | Funding intervals differ by venue; normalise them. |
| **Long/short and taker ratios** | Binance REST `/futures/data/*` | REST only. Open interest history is capped at about 30 days of 5-minute points. |
| **Options and implied vol** | Deribit (DVOL, option chain) | Raw (every-update) feeds need an authenticated connection; the 100 ms and aggregated feeds are open. |
| **Spot reference** | Coinbase `ticker` and `matches`; Binance spot | Coinbase `level2` and `full` reportedly need authentication since July 2023 *(second-hand)*. |
| **Who is trading** | Hyperliquid only: `users: [buyer, seller]` on every trade; fills with a `liquidation` object per wallet | No other venue publishes addresses. Per-wallet websocket subscriptions are limited to 10 wallets per IP. |

## Limits for free use

- **Binance:** 10 incoming messages per second per connection; a connection lasts 24 hours; stream cap probably 200 per connection for futures (one source said 1024) *(check)*.
- **Bybit:** no stream limits found in what was fetched.
- **OKX:** 3 connection requests per second per IP; 480 subscribe / unsubscribe / login requests per hour per connection; ping at least every 30 s.
- **Coinbase Exchange:** 8 requests per second per IP (bursts to 20); 100 client messages per second per IP; 10 subscriptions per product and channel.
- **Deribit:** about 3.3 subscribe calls per second sustained; up to 500 channels per call.
- **Hyperliquid:** per IP, 10 connections, 30 new connections a minute, 1000 subscriptions, 10 unique wallets in user subscriptions, 2000 messages a minute sent; REST 1200 weight a minute (`clearinghouseState` weighs 2, most other `info` calls 20).

## Free history (for testing ideas before collecting new live data)

- **Binance public data** (data.binance.vision): aggTrades, trades and klines confirmed for USD-M and COIN-M. Other datasets (book ticker, depth, open-interest metrics, liquidations) *(unverified)*.
- **Hyperliquid S3 archive:** 20-level book snapshots, asset contexts (bucket `hyperliquid-archive`) and fills (`hl-mainnet-node-data`); requester pays, a few dollars for everything; uploads not guaranteed timely or complete. 19 known data traps are listed at github.com/alpenmilch411/hyperliquid-archive-notes (zeros used for missing data, a funding scale change in June 2023, negative open interest, no liquidation feed).
- **Coinalyze API:** open interest, funding and liquidation history across exchanges; reported free at 40 calls a minute; sources disagree on whether a key is needed *(check)*.
- **CoinGlass:** free tier is real-time endpoints only (about 10,000 calls a month), no history. Not useful here.

## What is not free

- Hyperliquid's global liquidations and order-level (L4) book: they need your own node (16 vCPUs, 128 GB RAM, 500 GB disk, about 100 GB of logs a day, Ubuntu 24.04, no backfill).
- OKX's deepest tick-by-tick book.
- Deribit's raw feeds.
- Full historical order-book depth.
- A complete Binance liquidation count.

## A free design that fits our app

1. **Always streaming (core):** Binance `aggTrade`, `depth@100ms`, `markPrice`; Hyperliquid `trades` and `l2Book`; Bybit `tickers` and `allLiquidation`.
2. **Cheap extras:** OKX `liquidation-orders`, `open-interest`, `bbo-tbt`; Deribit DVOL; Coinbase spot `ticker` as a reference price.
3. **Polled:** Binance long/short and taker ratios every 5 minutes; Hyperliquid wallet positions (`clearinghouseState`, weight 2) for a few hundred wallets.
4. **Offline:** Binance public data, the Hyperliquid archive and Coinalyze, to test ideas on history.

Read: the free tier is already richer than the app uses. The biggest gains are not a venue switch but (a) Bybit's complete liquidation stream in place of Binance's undercounted one, (b) Bybit's open interest, (c) Hyperliquid's wallet-level tape, with Binance kept as the main price and depth reference.

## Hyperliquid in particular (brainstorm, 2026-11-05)

Strengths: wallet-attributed trades, per-fill liquidation detail (per wallet), whole-market asset contexts in one subscription, a self-run node with the full L4 book and every fill, a cheap historical archive. Weaknesses against Binance: about 6 to 8% of global perp volume and about 8% of open interest (mid-2026 reports, different methodologies); a thinner tape; a 37-minute API outage in July 2025 and an hour-long RPC block stall in May 2026; trading needs wallet signing. Leaning: Hyperliquid-first with a thin Binance reference, not Hyperliquid-only. Ideas for new information from raw Hyperliquid data: who the aggressor is (wallet concentration of taker volume), a real liquidation map from followed wallets' positions, wall ownership and quality (node), a full liquidation feed (node fills), cross-market breadth (all-market contexts, builder-deployed markets), TWAP and bridge flows of big wallets, and backtests on the archive.

## Sources

- Bybit: [orderbook](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook), [all-liquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation), [ticker](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker)
- Binance: [liquidation streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Liquidation-Order-Streams), [market streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams), [connection limits](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Connect), [open interest statistics](https://developers.binance.com/docs/zh-CN/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics), [public data repo](https://github.com/binance/binance-public-data/)
- OKX: [API docs](https://www.okx.com/docs-v5/en/), [public channels (third party)](https://www.mintlify.com/tiagosiebler/okx-api/websocket-client/public-channels)
- Coinbase: [Exchange websocket rate limits](https://docs.cdp.coinbase.com/exchange/websocket-feed/rate-limits)
- Deribit: [market-data best practices](https://docs.deribit.com/articles/market-data-collection-best-practices)
- Hyperliquid: [websocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions), [rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits), [node](https://github.com/hyperliquid-dex/node), [order book server](https://github.com/hyperliquid-dex/order_book_server), [archive traps](https://github.com/alpenmilch411/hyperliquid-archive-notes), [historical data guide](https://0xarchive.io/resources/market-data-guides/hyperliquid-historical-data), [order book data: L2, L4 and history](https://ironflow.sh/guides/hyperliquid-order-book-data)
- Market share and reliability: [record share of global perps (The Block)](https://www.theblock.co/news/markets/2026-06-03-hyperliquid-record-share-global-perps-market-hip-3-tops-62-billion-monthly-volume-403384), [record open interest share](https://coinpaprika.com/news/hyperliquid-hits-record-83-share-global/), [July 2025 API outage](https://www.theblock.co/post/364798/hyperliquid-outage-api-traffic-spike-not-hack-vulnerability-exploit), [May 2026 block stall](https://isdown.app/status/quicknode/incidents/589271-hyperliquid-mainnet-hypercore-block-height-stalled-at-998-059-177)
- Aggregators: [Coinalyze review](https://plisio.net/cybersecurity/coinalyze-review), [CoinGlass data API guide](https://coinglass.com/learn/crypto-data-api-en)
