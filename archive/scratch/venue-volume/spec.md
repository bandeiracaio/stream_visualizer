# Venue trade volume (v106 candidate, display / collect only)

Goal: measure each venue's traded BTC volume and market share. Public sockets and tickers, no keys. The Reader engine, episode layer, broker and existing feeds are untouched.

## Collectors (REGISTRY, owner "worker", collectors-worker.js)
- `tradeVol` (fast, like `venues`: sockets open only while a recording is on or auto-record is armed). Record `["c","tv",t,{t0, v:{id:[[sec-t0, buyUsd, sellUsd, buyQty, sellQty, n], ...]}}]`, written every 10 s with the closed one-second buckets (2 s hold-back); non-empty seconds only, dollars whole, quantities 5 decimals.
- `vol24` (slow, always on, every 60 s). Record `["c","vol24",t,{bnF:usd, bnS, byF, byS, okF, okS, cbS, hlF}]` (24 h dollar volume per venue id; a venue that fails is left out).

Venue ids: venue letters + F (perp / futures) or S (spot): bnF, bnS (Binance), byF, byS (Bybit), okF (OKX swap), okS (OKX spot), cbS (Coinbase BTC-USD), hlF (Hyperliquid perp).

## Aggressor side ("b" = taker bought, "s" = taker sold)
- Binance aggTrade (perp and spot): `m` = buyer is maker. m true -> "s", false -> "b".
- Bybit publicTrade: `S` is the taker's side.
- OKX trades: `side` is the taker's side. Swap `sz` is contracts: qty = sz x ctVal x ctMult (from /api/v5/public/instruments; BTC-USDT-SWAP is 0.01 BTC). Without a contract size the swap is skipped, never guessed.
- Coinbase matches: `side` is the MAKER's side, so it is inverted (maker "sell" -> taker "b"). `last_match` (snapshot on subscribe) is ignored. Not checked against live data (documented behaviour only).
- Hyperliquid trades: `side` "B"/"A" is the taker's side. Checked against userFills `crossed` (taker flag) for one live trade.
Dollars = price x quantity; USDT and USD are treated as the same dollar (Coinbase is USD).

## 24 h volume per venue
Binance `quoteVolume`; Bybit `turnover24h`; OKX swap `volCcy24h` (coins) x last, OKX spot `volCcy24h` (already USDT); Coinbase `volume` (coins) x `last`; Hyperliquid `dayNtlVlm`.

## Pure code (collectors-core.js, self-tested)
`tradeSubs`, `okxCt`, `tradeParse`, `tradeBook` (add: dedupe by id+trade id, any order, late trade goes into the oldest open second; flush), `tradeRows`, `tradeShare` (share of dollars per venue over a window, perp / spot), `vol24Parse`, `vol24Share`. Self-test: "collectors: venue trade volume ...".

## View
Collectors tab: table under the list (`colVol` in collectors.js): per venue 24 h dollars, 24 h share, share over the last 5 minutes of traded dollars (only while tv is written), buy / sell % by aggressor; header line with perp vs spot split.

## Size
About 10 KB per minute of "tv" (about 0.6 MB per hour) in a busy 40 s sample (6.4 rows a second over 8 venues). The session budget is still FILE_BUDGET (newest records win).
