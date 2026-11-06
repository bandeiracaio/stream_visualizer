# Perp liquidations and open interest, Bybit and OKX (collector `perpFlow`, v122)

Status: done. Display only: never a detector input; the Reader engine ignores collector records.

## Why
The Futures stack view already reads Bybit and OKX liquidations and open interest live, but nothing recorded them. Binance's own liquidation stream keeps only the latest liquidation per symbol per second, so a cascade is undercounted; Bybit (`allLiquidation`, every liquidation, 500 ms) and OKX (`liquidation-orders`) are the complete ones for the other two big perp venues. Open interest is the other half of the delta x open interest reading.

## What is recorded (fast collector: only while a recording is on or auto-record is armed, like `venues` / `tradeVol` / `bookPerp`)
- `liqPerp` `{v:"by"|"ok", rows:[{t, side, px, q}]}` for every message that carries liquidations of the coin. `t` exchange ms, `side` the side of the forced order (`sell` = a long was closed out), `px` bankruptcy price, `q` coin (OKX contracts x ctVal x ctMult). Dollars = px x q.
- `oiPerp` `{by:{oi, usd}, ok:{oi, usd}}` every 10 s: the latest open interest of each venue (coin and dollars); a venue with no reading yet is left out.

## How
`COLLECT.perpFlowSubs(coin)` (two sockets: Bybit `tickers.<C>USDT` + `allLiquidation.<C>USDT`; OKX `open-interest` + `liquidation-orders` on the plain URL = port 443, because OKX announced port 8443 will be retired), `COLLECT.perpFlow(coin, ct)` (`add(id, msg, now)` -> liquidation rows, keeps open interest; `sample()`), in `collectors-core.js`; sockets and the 10 s sample in `collectors-worker.js` (`perpStart` / `perpClose` / `perpSync` / `perpTick`); switch and status line in `collectors.js` (`colWhy`). Self-test scenario in `reader-selftest.js` with the message shapes captured live on 2026-11-05.

## Not here
No numeric features (no `FEATURES` / `FEATURE_ORDER` entry yet), no change to the Futures stack view, no OKX / Bybit funding (a separate small step), no Binance liquidation change.
