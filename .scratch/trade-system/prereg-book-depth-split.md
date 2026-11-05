# Pre-registration: book-depth continuation, Binance and Hyperliquid tested separately

Written 2026-11-05, before any fresh data exists. Do not edit after the first test run; add a dated note instead. This splits the family of `prereg-book-depth.md` (50 designs) into two families judged on their own: the 32 designs that trade Binance (`prereg-book-depth-bn-ids.json`) and the 18 that trade Hyperliquid (`prereg-book-depth-hl-ids.json`). Designs and parameters are the frozen ones in `prereg-book-depth-designs.json`; nothing changes.

## Why a separate test
Stage 1 of the parent registration (hold-out, 44 sessions) passed overall, but its venue split was looked at afterwards: Hyperliquid +0.78 over null at 1 s and +0.54 at 4 s, Binance +0.24 and +0.04. So the venue split can no longer be tested on that hold-out. The only clean data is fresh sessions: those starting at or after `fresh-cutoff.json` (2026-11-05T00:04:45Z), once there are at least 30.

## What was seen (bps over the random-entry null, mean over designs)
| | dev 1 s | dev 4 s | dev 10 s | hold-out 1 s | hold-out 4 s |
|---|---|---|---|---|---|
| Binance, 32 designs | +0.36 (23/32 above 0) | +0.18 (13/32) | +0.08 (6/32) | +0.24 (16/32) | +0.04 (3/32, 1 below) |
| Hyperliquid, 18 designs | +0.47 (14/18) | +0.24 (9/18) | +0.10 (4/18, 1 below) | +0.78 (15/18) | +0.54 (13/18) |
No design interval was below 0 at 1 s on either venue in either dataset.

## Lag control (descriptive, dev and hold-out; computed before this registration)
Concern: Hyperliquid's price history lags Binance by about 1 s, so a Hyperliquid trade that goes with a Binance move that already happened could look good without the book signal. Check (`scripts/book-lag.mjs`): split each trade by whether the other venue had moved in the trade's direction during the 5 s before the signal, and compare with random-entry trades in the same bucket.
- Hyperliquid trades, over null: dev: other venue moved against +0.20, flat +0.51, moved with +0.03; hold-out: +0.36, +0.33, +0.32. Where the other venue had not moved with the trade (against or flat, pre <= +0.2 bps): dev +0.46, hold-out +0.38.
- Binance trades (other venue = Hyperliquid), same bucket (pre <= +0.2): dev +0.29, hold-out +0.17.
- Random-entry trades aligned with a prior Binance move earn about +0.55 on Hyperliquid on their own: the lag effect exists independently of the book signal. In dev the book signal added nothing on top of it where Binance had already moved (+0.03), but added +0.3 to +0.5 where it had not.

## Predictions (written before the data; set below dev and hold-out)
**Binance family (32 designs)**
1. 1 s delay: mean over null >= +0.15 bps; at least 12 of 32 designs with an interval above 0; at most 2 below 0.
2. 4 s delay: mean over null between -0.10 and +0.20 (it decays toward 0).
**Hyperliquid family (18 designs)**
1. 1 s delay: mean over null >= +0.30 bps; at least 8 of 18 with an interval above 0; at most 1 below 0.
2. 4 s delay: mean over null >= +0.15.
3. Lag control (`node .scratch/trade-system/scripts/book-lag.mjs fresh 5`, line "REGISTERED LAG CONTROL" for hl): over null in the bucket where Binance had not moved with the trade (pre <= 0.2) of at least +0.20 bps.

## Failure
Binance: 1 s over null below +0.08, or fewer than 8 of 32 designs above 0.
Hyperliquid: 1 s over null below +0.15, or fewer than 5 of 18 above 0, or lag-controlled over null below +0.10.
Between the thresholds: inconclusive. Each family gets its own verdict; a pass for one and a fail for the other is reported as exactly that. Only the 1 s results decide pass/fail; 4 s is reported as sensitivity.

## Procedure
Once at least 30 fresh sessions exist. Two harness runs on all 50 ids (1 s and 4 s, 40 random-entry repeats), then split by the venue in each design's parameters; one run of the lag-control script (1 s signal, 5 s lookback).
`node design-harness.mjs --n 700 --balance --balance-by trig,thes --seed 6 --ids .scratch/trade-system/prereg-book-depth-ids.json --split fresh --confirm-holdout --null 40 --latency 1000 --out <file>` (and `--latency 4000`).
Before running, re-run two designs on dev and check they match `results-seed6-wide.jsonl` (this was done for M00001 and M00278 on 2026-11-05). No design, parameter, threshold or cost change after seeing fresh data.
