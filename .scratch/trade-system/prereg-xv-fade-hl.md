# Pre-registration: cross-venue premium fade on Hyperliquid

Written 2026-11-04, before any fresh data exists. Do not edit after the first fresh run; add a dated note below instead.

## What is being tested
The 36 designs in `prereg-xv-fade-hl-designs.json` (ids in `prereg-xv-fade-hl-ids.json`): trigger `cross-venue-or-asset-divergence` traded on Hyperliquid, thesis `mean-reversion-overreaction` (fade the dislocation: go short hl when its premium over Binance is above its trailing mean by at least minBps, long when below), exit `elapsed-time-stop` or `flow-episode-or-book-state-exit`, stop `sigma-multiple-stop`. Parameters are frozen exactly as in that file; they come from sampler seed 5, n 360, balanced, harness version with tick-price stop fills.

## What was seen on dev (99 sessions, 48.7 hours, started before 2026-11-03T08:40Z)
- 1 s entry delay: gross +0.92 bps per trade, +0.83 over the random-entry null, 30 of 36 designs with a session-bootstrap interval above 0, none below. About 37 trades per design per hour of data.
- Entry delay 4 s: +0.32 gross, +0.22 over null, 23/36 above 0. 10 s: +0.04 / -0.06 over null, 11/36. 30 s: +0.02 / -0.09, 5/36. The effect is a few seconds long.
- Mirror image (going with the dislocation) loses about the same amount.
- Fees (Hyperliquid docs page, fetched 2026-11-04): base tier taker 0.045%, maker 0.015%; top tier taker 0.024%, maker 0%; maker rebates up to -0.003%. Net of any taker scenario every design loses; only maker+maker at zero fee is positive, and the harness does not model maker fills.

## Origin of the hypothesis (disclosed)
The idea that Hyperliquid converges toward Binance came from looking at the hold-out result of the Reader-episode fade family (edge concentrated on venue hl). That hold-out (sessions from 2026-11-03T08:40Z to 2026-11-05T00:04Z, 44 sessions) is therefore NOT a clean test of this family and is not used for it. Only sessions that start at or after the fresh cutoff (`fresh-cutoff.json`, 2026-11-05T00:04:45Z) count.

## Predictions (written before the data)
1. At 1 s delay: mean gross over null of at least +0.4 bps (dev: +0.83), and at least half of the designs (18 of 36) with an interval above 0, with fewer than 4 below 0.
2. At 4 s delay: positive but smaller (dev: +0.22); predicted between 0 and +0.5.
3. Continuation designs (not part of this list) are not tested.

## Procedure
- Run only when there are at least 30 fresh sessions (about 15 hours).
- Two runs, no others: 1 s delay (primary) and 4 s delay (sensitivity).
  `node design-harness.mjs --n 360 --balance --seed 5 --ids .scratch/trade-system/prereg-xv-fade-hl-ids.json --split fresh --confirm-holdout --null 40 --latency 1000 --out <file>` and the same with `--latency 4000`.
- The harness code at the time of the run must give the same dev numbers as above for the same designs (re-run one design on dev as a check, or compare against `results-seed5-3trig.jsonl`).
- Report the result whether or not it supports the predictions. No parameter, design, threshold or cost change after seeing fresh data.

## What would count as failure
Over-null at 1 s below +0.2 bps, or fewer than 12 of 36 designs with an interval above 0. A result between those and the predictions is reported as inconclusive.

## Note 2026-11-05 (later): how to replay the frozen designs
The command above regenerates designs with `--seed 5 --ids ...`. After this document was written the harness gained more triggers, exits and a region template, which changed what the sampler draws: regenerating with the current code no longer reproduces these 36 designs (0 of 36 identical when checked). The frozen parameters are unaffected. The fresh-data run must therefore use the frozen file instead:
`node design-harness.mjs --designs-file .scratch/trade-system/prereg-xv-fade-hl-designs.json --split fresh --confirm-holdout --null 40 --latency 1000 --out <file>` (and `--latency 4000`).
Checked on dev: two designs (M00010, M00316) replayed from the file give exactly the stored trade counts and mean gross of `results-seed5-3trig.jsonl`. The `--ids` filter does not apply with `--designs-file`.
