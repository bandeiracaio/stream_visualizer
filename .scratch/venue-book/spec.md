# Perp book depth, Bybit and OKX (v107 candidate, collect / display only)

Goal: the same depth summaries the page writes for Binance (`bookBn`) and Hyperliquid (`bookHl`), for Bybit linear BTCUSDT and OKX BTC-USDT-SWAP, so the four perp venues are comparable. Reader engine, episode layer, broker and feeds are untouched.

## Collector
`bookPerp` (REGISTRY, owner worker, fast: sockets open only while a recording is on or auto-record is armed, like `venues` / `tradeVol`). Records `bookBy`, `bookOk`, every 10 s: `{mid, spr, tb, ta, reach:[bid,ask], d:{1|5|10|20:[bidBtc, askBtc]|null}, fl:{b,a}, rs}`. Same shape as `bookBn`; `fl` is summed over the 10 s since the last record (bookBn's is per second); `rs` = resyncs so far. Quantities are BTC; dollars = quantity x `mid`. Edges are `COLLECT.BOOK_EDGES` (1/5/10/20; 25 is not used because no venue's book reaches it reliably).

## Venues
- Bybit `orderbook.1000.BTCUSDT` (wss://stream.bybit.com/v5/public/linear): snapshot, then deltas by price level (size "0" removes). `u` rises by 1; anything else is a gap -> unsubscribe + subscribe (new snapshot). `u` = 1 is a restart, treated as a snapshot. 200 levels would reach only about 2.5 bps; 1000 levels reach about 25-30 bps (500 levels about 11).
- OKX `books` (wss://ws.okx.com/ws/v5/public, port 443; 8443 is being retired): 400 levels, about 7 bps. books5 is 5 levels (under 1 bp), useless; deeper channels (books50-l2-tbt, books-l2-tbt) need a login. `prevSeqId` must equal the last `seqId` else resync. Checksum (crc32 of the top 25 levels, original strings) is verified when sent, but the public endpoint always sends 0 (observed 183 of 183 messages), so that path is only self-tested. Sizes are contracts: BTC = sz x ctVal x ctMult (`okxCt`, fetched when the collector starts; without it the OKX book is skipped).
- The summary keeps the nearest 1000 (Bybit) / 400 (OKX) levels a side: a local book keeps stray far levels that are incomplete; `reach` is then the real window.

## Pure code (collectors-core.js)
`bookSubs`, `bookParse`, `perpBook` (apply / summary / stats / best), `crc32`, `bookCompare` (rows for the readout). Reuses `book` and `flowStat`; `mergeBook` not needed. Self-test: "collectors: perp books ...".

## View
Collectors tab, `colBook` under `colVol`: per perp venue depth within 5 bps (BTC and dollars), spread, bid share, age of the reading. No numeric features were added (FEATURES / FEATURE_ORDER / analyze-collectors.mjs untouched); `EXPECT_ORDER` gained `bookPerp`.

## Size
About 1.8 KB per minute per venue (3.6 KB/min, about 0.2 MB/hour) at 10 s: not heavy.
