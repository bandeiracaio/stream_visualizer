# Pre-registration: book-depth continuation

Written 2026-11-05, before any test data for this family has been run. Do not edit after the first test run; add a dated note below instead. Sister document: `prereg-xv-fade-hl.md` (premium fade), tested separately.

## What is being tested
The 50 designs in `prereg-book-depth-designs.json` (ids in `prereg-book-depth-ids.json`): trigger `book-depth-and-wall-event` (order-book depth imbalance within 5 or 20 bps of the mid, at least thr in one direction for sustainSec seconds in a row, on Binance or Hyperliquid), thesis `continuation-momentum` (trade WITH the heavy side: long when bids are heavy, short when asks are), region none, a mix of six exits (elapsed-time-stop 13, flow-episode-or-book-state-exit 22, indicator-normalization-exit 5, trailing-or-ratchet-stop 5, fixed-distance-target 3, named-level-target 2), sigma-multiple stop. Parameters are frozen exactly as in that file; they come from sampler seed 6, n 700, balanced by trigger x thesis, harness with tick-price stop fills and flow cache v1. Regenerating the list with the command below reproduced the stored designs and parameters exactly.

## What was seen on dev (99 sessions, 48.7 hours, started before 2026-11-03T08:40Z)
- 1 s entry delay: gross +0.43 bps per trade, +0.37 over the random-entry null (20 repeats per design), 37 of 50 designs with a session-bootstrap interval above 0, none below; median 1410 trades per design.
- Delay: +0.38 over null at 1 s, +0.18 at 4 s, +0.07 at 10 s (10 repeats).
- The mirror trade (fade the heavy side) loses about the same: -0.44 gross, 0 above and 36 below.
- Holds across venue (bn +0.34, hl +0.43 over null), depth edge (5 bps +0.35, 20 bps +0.39), and rises with the threshold (+0.29, +0.38, +0.43 by band).
- Fees (Hyperliquid docs page, fetched 2026-11-04): base taker 0.045%, maker 0.015% per side; every taker scenario loses at this size. This pre-registration tests whether the effect exists, not whether it is tradable.

## Origin of the hypothesis (disclosed)
Found by searching 700 dev designs over 7 triggers and 6 exits (sampler seed 6) and reading the grouped results; the family was picked because it was the clearest cell. Only dev sessions were used. The hold-out sessions (2026-11-03T08:40Z to 2026-11-05T00:04:45Z, 44 sessions) were spent once for the Reader-episode fade family and looked at for the Hyperliquid venue pattern, but were not consulted for book depth, so they can serve as a first confirmation for this family. Selection from many cells means the dev numbers are likely overstated; the predictions below are set lower than dev for that reason.

## Predictions (written before the data)
1. At 1 s delay: mean gross over null of at least +0.25 bps (dev +0.37), at least 25 of 50 designs with an interval above 0, at most 2 below 0.
2. At 4 s delay: between 0 and +0.4 over null (dev +0.18).
3. At 10 s delay (not required): about 0.

## Procedure
Stage 1 (hold-out sessions, available now), then stage 2 (fresh sessions, at or after `fresh-cutoff.json`, 2026-11-05T00:04:45Z, once there are at least 30). Each stage: two runs only, 1 s (primary) and 4 s (sensitivity), 40 random-entry repeats.
`node design-harness.mjs --n 700 --balance --balance-by trig,thes --seed 6 --ids .scratch/trade-system/prereg-book-depth-ids.json --split holdout --confirm-holdout --null 40 --latency 1000 --out <file>` (and `--latency 4000`); stage 2 is the same with `--split fresh`.
Before a stage, re-run one design on dev and check it matches `results-seed6-wide.jsonl`. Report both stages whether or not they support the predictions. No design, parameter, threshold or cost change after seeing any test data. The two families (this one and the premium fade) are reported separately and neither result is used to pick or tune the other.

## What would count as failure
Over null at 1 s below +0.12 bps, or fewer than 15 of 50 designs with an interval above 0. Between failure and the predictions: inconclusive. A pass in stage 1 and a fail in stage 2 (or the reverse) is reported as inconclusive, not resolved by choosing the better stage.

## Note 2026-11-05: stage 1 run (hold-out, 44 sessions)
Reproducibility check before the run: two designs (M00001, M00278) on dev gave exactly the stored trade counts and mean gross. Both stage-1 runs were made once, with the registered command (40 repeats).
- 1 s delay: 37,056 trades, median 651 per design. Mean gross +0.48 bps, mean over null +0.44 (dev +0.37), 31 of 50 designs with an interval above 0 (dev 37), 0 below, 47 of 50 designs above their null mean.
- 4 s delay: 36,039 trades. Mean gross +0.27, over null +0.22 (dev +0.18), 16 of 50 above 0, 1 below.
- Against the registered predictions: prediction 1 met (over null >= +0.25: yes; >= 25/50 above 0: 31; <= 2 below: 0), prediction 2 met (0 to +0.4: +0.22). Failure criteria not met. Stage 1 PASSES.
- Venue split (not registered, descriptive): Hyperliquid designs over null +0.78 at 1 s and +0.54 at 4 s (15/18 above 0 at 1 s); Binance designs +0.24 at 1 s and +0.04 at 4 s. The dev split was bn +0.34 / hl +0.43. The Hyperliquid share of the result grew and the Binance share shrank; Hyperliquid's book snapshots in the recordings are sparse (about every 5 s) and its price history lags Binance by about 1 s (see prereg-xv-fade-hl.md), so the Hyperliquid part may not be independent of that lag.
- Design-level correlation of mean gross, dev vs hold-out: 0.34 (1 s), 0.30 (4 s).
- Caveat: this hold-out had already been used once for the Reader-episode fade family; the two tests are not independent of each other's data. Stage 2 (fresh sessions) is still to be run under the same criteria.

## Note 2026-11-05 (later)
The Binance and Hyperliquid designs of this family are registered separately for fresh data in prereg-book-depth-split.md. That document, not stage 2 above, is the confirmation test for the venue split.
