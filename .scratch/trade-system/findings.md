# Trade-system design study: findings

Written 2026-11-05. Status (2026-11-10): dev and hold-out results in; the three pre-registered fresh-data tests (and the liquidation test) were closed without being run, no test-set outcome was looked at; the Trader's live record replaces them (`.scratch/trader/spec.md` section 9, decision 3).

## 1. Summary

We defined a trade system as seven parts (context, regions, trigger, thesis and invalidation, exit, risk and sizing, evaluation), had subagents generate 350 candidate systems, coded them into a taxonomy, built a sampler over the parts and a replay harness, and ran several thousand sampled designs over the saved BTC sessions against a random-entry null.

**Bottom line.** Short-horizon order-flow signals carry a small, real-looking edge: book-depth imbalance, the Hyperliquid-versus-Binance price premium and (more weakly) Reader-episode fades each predict the next few seconds by roughly 0.3 to 0.9 bps gross per trade, in the direction expected. The edge fades within about 10 seconds. It is one to two orders of magnitude below taker fees at either venue, and the one scenario where it clears costs (maker at both ends on a zero-fee tier) assumes fills the harness cannot model. **Nothing found is a tradable strategy.** The study is more useful as a measurement of short-term structure than as a source of a system.

What held up and what did not:

| Finding | Evidence | Status |
|---|---|---|
| Book-depth imbalance predicts the next seconds (go with the heavy side) | dev +0.37 bps over null, 37/50 designs above 0; hold-out +0.44, 31/50, 0 below; mirror trade loses by the same amount | Passed its registered stage 1; fresh test pending |
| Hyperliquid premium fade (HL converges toward Binance) | dev +0.83 over null at 1 s, 30/36 above 0; gone by 10 s | Pre-registered; fresh test pending |
| Reader-episode fade | dev +0.27 over null, 27/80 above 0; hold-out +0.17, weaker than my bar | Weak, partly replicated |
| Level rejection fade | +0.67 over null but only about 140 trades per design, 6/50 above 0 | Unconfirmed |
| Trade-flow, range break, price-move triggers | about 0 or gone by 4 s | No signal |
| One family improves another's trades | slope intervals include 0 almost everywhere | No evidence |

## 2. What was built

- **350 generated systems** (`systems.md` S001 to S100, `systems-2.md` S101 to S350). Round two was told to widen under-used values, so its distribution deliberately differs from round one.
- **Taxonomy and mapping** (`taxonomy.md`, `mapping-v3.csv`): 12 to 15 coarse categories per part. Blind re-rating by a fresh agent matched the first mapping 88 to 100% per part, except evaluation (78%), which I rebuilt around "what is it compared against" and then matched 40 of 40 on a fresh sample. Both raters are the same model family, so this measures consistency, not correctness.
- **Pool facts** (350 systems): 40% use no region; continuation is the largest thesis (20%); fixed-fraction risk is 56% of sizing choices; 76 of the 210 possible trigger and thesis pairs occur (Cramer's V 0.56 between them), so independent sampling would produce incoherent designs.
- **Sampler** (`sample-designs.mjs`): pool bootstrap, chained conditional, uniform with compatibility rules, stratified; the hard rules are my draft and you have not reviewed them.
- **Replay harness** (`design-harness.mjs`): seven triggers (Reader episode, price move, cross-venue premium, trade flow, book depth, range break, level rejection), six exits (timed, flow-episode, fixed target, trailing, range-level target, indicator-normalisation), a range region, sigma-multiple stops.

**Execution model** (same for every design): entry one second after the signal at the quote mid, one position at a time per session, stops filled at the price seen when crossed, results in gross bps. **Baseline:** random-time, random-direction entries of the same designs with the same exits (20 to 40 repeats). **Intervals:** bootstrap over sessions, because trades in a session are not independent.

**Data:** BTC sessions only, recorded 2026-10-16 onward. Split by session start time: dev (99 sessions, 48.7 hours, before 2026-11-03T08:40Z), hold-out (44 sessions, up to 2026-11-05T00:04Z), fresh (after that; 1 so far). The cut times are in `holdout-cutoff.json` and `fresh-cutoff.json`.

## 3. Results in order

1. **First comparison** (320 designs, 2 triggers x 2 theses x 2 exits, dev): fading Reader episodes was the only group with signal, +0.27 bps over null with 27 of 80 designs above 0 and 1 below. A price-move trigger, which uses no Reader data, did not show it when fading (control). A flow-based exit added nothing over a timer. The edge was unchanged at a 4 s entry delay.
2. **Hold-out for the 80 frozen Reader-fade designs:** +0.17 over null at 1 s and +0.12 at 4 s, 9 to 19 of 80 above 0 (the lower count after the stop-fill fix). That is below the bar I set beforehand (+0.3 and about 40% positive), so the Reader fade replicated in direction but not in size. It concentrated on Hyperliquid (+0.62) with Binance and both-venue designs near 0.
3. **Hyperliquid investigation.** Its price history follows Binance by about one second (return correlation 0.55 at a one-second lag, 0.25 at none). Premium dislocation against the trailing mean predicts Hyperliquid's next moves in the converging direction, +0.9 bps when aligned and -0.6 when opposed, even for random entries.
4. **Premium fade as its own trigger** (dev, 36 designs on Hyperliquid): +0.92 bps gross, +0.83 over null, 30 of 36 above 0, none below, about 1,200 trades per design; insensitive to the threshold (0.3 to 3 bps); going with the dislocation loses by the mirror amount. It is a few seconds long: +0.83 over null at 1 s, +0.22 at 4 s, -0.06 at 10 s, -0.09 at 30 s.
5. **Executability and costs.** The recorded price is the quote mid; median spreads are 0.13 bps on Hyperliquid and 0.01 bps on Binance, so crossing the spread barely matters, and the convergence effect survives it (+0.56 aligned against -0.58 opposed). Fees, from the Hyperliquid docs page fetched on 2026-11-04: base taker 0.045% and maker 0.015% per side, top tier taker 0.024% and maker 0%, maker rebates up to 0.003%. Net of every taker scenario all 36 premium designs lose; at zero-fee maker both ends 35 of 36 are positive, but maker fills are not modelled and an edge that lasts a few seconds would not survive waiting for a passive fill. The Binance fee page returned no numbers.
6. **Wider run** (700 designs, 7 triggers, dev): book-depth continuation +0.37 over null (37 of 50 above 0, none below), fading it -0.45 (36 of 36 mirror designs below 0). Consistent across venue, depth edge, threshold and exit; stronger at higher thresholds; decays with delay (+0.38 at 1 s, +0.18 at 4 s, +0.07 at 10 s). Level-rejection fade +0.67 but thin (6 of 50 above 0). Trade-flow continuation +0.10, gone by 4 s.
7. **Book-depth stage 1 on the hold-out** (50 frozen designs): all registered criteria passed (see section 4).
8. **By venue.** Over null at 1 s / 4 s: Binance +0.36 / +0.18 on dev and +0.24 / +0.04 on hold-out; Hyperliquid +0.47 / +0.24 on dev and +0.78 / +0.54 on hold-out. A lag control (splitting trades by whether the other venue had already moved with them) leaves +0.46 (dev) and +0.38 (hold-out) over null on Hyperliquid where Binance had not moved, so the Hyperliquid result is not just catch-up to Binance. Random entries aligned with a prior Binance move earn about +0.55 on Hyperliquid by themselves, which is the lag effect.
9. **Overlap.** On Hyperliquid the book-depth and premium trades overlap heavily (exposure correlation 0.28 dev, 0.38 hold-out; 60 s P&L correlation 0.35, 0.46; same direction 78 to 80% when entries coincide), so they are largely one effect. Reader fades are nearly independent of both (exposure correlation about 0, P&L 0.00 to 0.17).
10. **Incremental information.** Conditioning one family's trades on another family's position at the signal does not reliably change gross (for example premium given book depth: 0.92 / 0.99 / 0.84 when aligned / flat / opposed). Only one difference from the random-entry baseline had an interval excluding 0 (premium given book depth, -0.66), meaning the book signal's predictive power is already contained in the premium signal. The test has little power (slope intervals about +-1 bp per unit of alignment), so this is "no evidence", not "evidence of none". Combining families adds trades, not per-trade edge.

## 4. Pre-registrations (written before the data they test)

| Document | Family | Predictions | Status |
|---|---|---|---|
| `prereg-xv-fade-hl.md` | Premium fade on Hyperliquid, 36 frozen designs | 1 s over null >= +0.4, >= 18/36 above 0, < 4 below; 4 s between 0 and +0.5 | Fresh test pending |
| `prereg-book-depth.md` | Book-depth continuation, 50 frozen designs | 1 s over null >= +0.25, >= 25/50 above 0, <= 2 below; 4 s 0 to +0.4 | **Stage 1 (hold-out) passed:** +0.44, 31/50, 0 below; 4 s +0.22. Stage 2 (fresh) pending |
| `prereg-book-depth-split.md` | The same designs split by venue (bn 32, hl 18), own verdicts; Hyperliquid also needs the lag-controlled over-null >= +0.20 | Binance 1 s >= +0.15, >= 12/32; Hyperliquid 1 s >= +0.30, >= 8/18 | Fresh test pending (the hold-out already saw the venue split) |

The fresh runs need at least 30 sessions starting at or after 2026-11-05T00:04:45Z. Procedure and failure criteria are in each document; the commands use `--designs-file` on the frozen design lists.

## 5. Errors found and fixed along the way

- **Optimistic stop fills.** Early runs filled stop-outs exactly at the stop price, which made every gross figure about 0.15 to 0.2 bps too high (the random-entry baseline sat at +0.2 instead of about 0). Fixed to fill at the tick price; comparisons against the baseline were unaffected, absolute gross figures changed.
- **Premium pre-registration not reproducible by regeneration.** After more triggers and exits were added, regenerating by seed gave 0 of 36 matching designs. The frozen parameters were safe; `--designs-file` now replays them directly (checked on two designs).
- **Fresh data leaking into the hold-out.** The hold-out had no upper bound, so a newly recorded session appeared as a 45th hold-out session. Fenced at the fresh cutoff; stage 1 used 44 sessions and is unaffected.
- **Things I stated wrongly and corrected:** the number and age of the sessions (it is 132 to 144 sessions over about three weeks, not 50 over two days); Hyperliquid's spread (0.13 bps, not 1.3); that the convergence effect "persists to 30 s" (it did for the premium measured at entry, but the premium trigger's own edge is gone by 10 s).

## 6. Limits

- Most numbers come from dev data and from picking the clearest cells among many designs; dev figures are likely overstated, which is why the registered predictions sit below them.
- Designs share signals, so counts of "designs above 0" are not independent findings.
- The random-entry baseline uses only 20 to 40 repeats.
- The hold-out has now served two families (Reader fade and book depth), so those two tests are not independent of each other's data.
- Some saved sessions are auto-recordings started by a volatility trigger; I have not measured their share, so the sample may lean toward active periods. All sessions are BTC, 30 minutes long at the median (up to 60), and only two venues are used for signals.
- Maker fills, fees at the user's actual tier and market impact are not modelled. Binance fees were not checked.
- The taxonomy's reliability was checked by a second rater from the same model family.
- The four compatibility rules in the sampler were written by me and not reviewed.

## 7. What is open

1. **Fresh-data tests.** Record at least 30 more sessions, then run the three registered tests, two runs each (1 s and 4 s), and report them whatever they show.
2. **The Hyperliquid part of book depth** could be tied to the one-second history lag in ways the 5 s lag control does not fully remove; the fresh test separates the two venues.
3. **Maker economics.** The only scenario that clears costs needs passive fills; modelling them needs order-book queue data the recordings do not have in a usable form.
4. **Unexplored parts of the design space:** other context filters, regions beyond the range box (value area, prior-day levels), thesis types, horizons beyond ten minutes, sizing rules, ETH and the majors.

## 8. Files (all under `.scratch/trade-system/` unless noted)

`systems.md`, `systems-2.md`, `taxonomy.md`, `mapping-v3.csv`, `distributions.md`, `sampling-design.md`; `results-seed*.jsonl` and `.log` (run outputs), `stage1-book-depth-*.jsonl`, `holdout-reader-fade-*.jsonl`; the three `prereg-*.md` with their design and id files; `holdout-cutoff.json`, `fresh-cutoff.json`; `scripts/book-lag.mjs`, `scripts/overlap.mjs`, `scripts/incremental.mjs`. At the repo root: `sample-designs.mjs` and `design-harness.mjs` (both with `--selftest`). Regenerable caches are gitignored.
