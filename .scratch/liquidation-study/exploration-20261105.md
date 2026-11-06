# Liquidation data: first look (2026-11-05, exploratory, descriptive)

Run on the 166 saved sessions (98 recorded hours, 18 Oct to 5 Nov 2026) with throwaway scripts (not committed). Nothing here is a test: these numbers generated a hypothesis, and the same sessions cannot confirm it (see the last section).

## What the sessions hold
- Binance liquidation events (forceOrder, at most one per symbol per second): 5,827 in the inputs ($394M, 59.5 an hour); 9,663 `liq` collector records (always-on, includes lead-ins). Hyperliquid: 14,185 `hlLiq` records (fills of followed wallets only, a partial feed); the Hyperliquid trades carry no liquidation flag. Bybit / OKX liquidations and open interest (`liqPerp`, `oiPerp`, v122): none yet, no session was recorded after the release.
- Open interest: `bnDerivs` / `hlCtx` every 15 s; `ratios` (long-short, taker) every 5 minutes.

## What Binance liquidation events look like
- Event size: median $3.8k, 90th percentile $95k, 99th percentile $984k, largest $11.8M. 68% of dollars are sell-side (longs liquidated), in a falling-price period.
- Clusters (events within 30 s of each other): 1,320. Median $6.8k, 90th percentile $249k, 99th percentile $7.1M, largest $42M; median 2 events, 90th percentile 10, largest 128; median duration 3 s, 90th percentile 49 s. The top 5% of clusters hold 86% of liquidation dollars. 98% of clusters are one-sided (90% or more of dollars on one side).

## Price context of the 242 clusters of at least $100k (Binance mid, in sigmas, signed in the liquidation's direction: longs liquidated = down)
- The 5 minutes before the cluster: median +1.11 sigma, 92% of clusters (liquidations follow a move: expected).
- After the cluster ends: median -0.67 sigma at 1 minute (26% continued), -0.53 at 5 minutes (36%), -0.34 at 15 minutes (41%), against typical absolute moves of 0.69 / 0.70 / 0.65 sigma. In words: price tends to bounce back against the liquidations, about one typical move within a minute.
- Open interest across a cluster (15 s resolution): median change -0.004%, 53% negative: nothing visible at that resolution.

## What this does not tell
- Whether the reversal is specific to liquidations or any move of that size reverts. A matched-control comparison (same session, same-direction prior move within 0.3 sigma, no liquidation nearby) found only 14, 7 and 2 control pairs at 1, 5 and 15 minutes for the $100k clusters and none for $1M: in these volatile sessions a 1-sigma move without a liquidation nearby is rare. Inconclusive.
- Part of a 1-minute reversal can be the temporary price impact of the last forced orders fading, not information.
- 242 clusters overlap in time (a cascade makes several), from 11 days of mostly volatility-triggered recording.

## Consequence
The outcomes after clusters have now been seen on all existing sessions, so a confirming test of "reversal after liquidation clusters" must use sessions recorded after this date (which also carry the complete Bybit and OKX liquidations and open interest from v122). About 2.5 clusters of at least $100k an hour were recorded, so roughly 100 take about two days of recording.
