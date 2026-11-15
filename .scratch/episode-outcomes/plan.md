# Episode outcomes: registered plan

Registered 2026-11-15, before any data of the test set exists. A change to this file after that is a dated amendment at the end, never an edit above it.

## 1. Question

Is a detected absorption or exhaustion followed by a price move that differs from what follows a comparable moment with no detection, and is the difference large enough to trade as a taker?

This replaces the user's agree / disagree labels as the measure of a good detection: a detection is good if the price afterwards says so. No trade system is part of this study.

## 2. What is already known (disclosed)

- Trade-system study (`.scratch/trade-system/findings.md`): fading Reader episodes, entered 1 s after the signal and held for seconds to a few minutes, earned +0.27 bps over random entries on dev and +0.17 on the hold-out. Taker fees are about 8 bps a round trip.
- Horizons past ten minutes were never tested. Recordings before 2026-11-12 are separate sessions of about 30 minutes, so they could not be.
- Web search of 2026-11-15 (search summaries only, sources not read in full): order-flow imbalance is documented as explaining the price change of the same window, not the next one; vendors of absorption tools say the same event ends in reversal or continuation depending on context; one preprint reports order flow adding information mainly when liquidity is stressed; no paper was found that tests absorption detection against later returns in crypto.

## 3. Data

- **Test set:** recordings made by the page's continuous recording whose inputs are at or after 2026-11-16T00:00:00Z, BTC, read as runs (the chunks of a run replayed in order from the first).
- **Exploration set:** everything recorded before that time. It is used to build and check the script and to estimate power. Any outcome seen on it is exploratory and is not evidence.
- **Detections:** made offline by replaying each run through the Reader as it stands at commit `5c10923` (`reader-engine.js`, `reader-episodes.js`, default configuration). The page's version at recording time does not matter; a later change to the Reader does not change this study.
- **Unit:** one episode group (what a card shows) of family absorption or exhaustion. Aggression bursts are reported beside them and are not part of the verdict. Walls are left out.

## 4. Measurement

For every episode group:

- **Direction:** +1 when the group's aggressor is the buyer, -1 when the seller. A positive result means the price went with the aggressor.
- **Start:** the Binance quote mid at the first quote at or after `tDetected` + 2,000 ms (the demo hour measured 1.5 to 2.5 s from signal to fill). Never the back-dated `tStart`, which is not known at the time.
- **Horizons:** 10 s, 30 s, 1 min, 5 min, 15 min, 60 min after the start.
- **Result:** direction x (mid at start + horizon / mid at start - 1), in bps. An episode whose run ends before the horizon has no result at that horizon and is counted as dropped.

### Controls

Each episode gets 20 control moments, drawn by a seeded generator from the one-a-second snapshots of the same run, and measured the same way with the episode's direction.

- **Matched control (primary):** within 2 hours of the episode; the engine's Binance sigma within a factor of 1.5 of the episode's; and the Binance move of the preceding 60 s, signed by the episode's direction and in sigma units, within 0.5 of the episode's. This asks whether the detection says more than "the price just moved this much in this volatility".
- **Plain control (secondary):** the same without the preceding-move condition.
- With fewer than 20 candidates the time condition widens to the whole run; with fewer than 5 the episode is dropped and counted. A control may fall on another episode: controls are moments, not quiet moments.

### Statistic

- D = the episode's result minus the mean result of its controls.
- For each family and horizon: the mean of D over episodes.
- Interval: bootstrap over UTC days (10,000 resamples, fixed seed), because episodes of one day are not independent and long horizons overlap.
- **Primary cells:** 2 families x 6 horizons = 12, against the matched control. Each is judged on its 99.5% interval (12 cells at 5% overall). The 95% interval is reported beside it.
- Two-sided: neither reversal nor continuation is assumed.

## 5. Verdicts (fixed now)

Costs: 8 bps fees a round trip plus 3 bps slip (demo hour: entry +0.5, exit +2.7) = 11 bps.

| Verdict | Condition |
|---|---|
| **Trade candidate** | a primary cell whose mean D is at least 11 bps away from 0 at the lower end of its 95% interval |
| **Alive** | a primary cell with mean D at least 3 bps away from 0 and a 99.5% interval that excludes 0 |
| **Closed** | no primary cell alive, and the 95% interval at 5 min is no wider than 3 bps either side for both families |
| **Underpowered** | no primary cell alive and the 5 min interval is wider than that |

- "Alive" or "trade candidate" names a cell picked as the best of twelve, so it leads to a new registered test of that one cell on new data before anything is built on it.
- "Closed" means: absorption and exhaustion as the Reader detects them stay a description of the tape, and are not pursued as a trigger.

### Predictions

- 10 s, 30 s and 1 min: mean D within 1 bps of 0 for both families (the earlier study, restated).
- 5 min, 15 min and 60 min: no prediction; this is the untested part.

## 6. Registered splits (secondary)

Reported for every horizon, each on a 99.5% interval, and able to give "alive" only for a later registered test, never a verdict here. Quartiles are taken on the test set's own values, which uses no outcome.

1. **Size:** the top quarter of episodes by the lead member's size (absorption: `facts.rate$`; exhaustion: `facts.zWas`).
2. **Stress:** the top quarter by Binance sigma at detection (a proxy for stressed liquidity).
3. **Venue:** episodes seen on Binance only, on Hyperliquid only, on both.

Anything else (single evidence items, hours, other features) is exploratory and labelled so.

## 7. When the test is run

Once, when both hold:

- 21 UTC days in the test set with at least 12 recorded hours each;
- at least 300 episodes with a 5 min result in each of the two families.

If that is not reached by 2026-12-31, it is run then and the verdict can only be "alive", "trade candidate" or "underpowered".

Before the run, only these may be looked at on the test set: hours recorded, number of runs, number of episodes per family. No result, no price after an episode.

The day and episode counts may be raised by an amendment, using only the exploration set's spread of control results and those counts, until the first test result is computed. They may not be lowered.

## 8. Steps

1. Build `episode-outcomes.mjs` at the repo root (offline, prints a line per run). Its self-test plants a known effect in synthetic inputs and recovers it, and gives 0 where none is planted.
2. Run it on the exploration set: check the numbers by hand on a few episodes, and report the spread of control results per horizon (the power estimate).
3. Leave the page recording into `sessions/`. A reload ends a run, so reload only for a release that is needed.
4. Run the test once, with the registered command written here by amendment after step 2.
5. Write `results.md` in this folder, whatever it shows, with the dropped counts.

## 9. Limits known now

- One asset, one period of at most seven weeks.
- A run that ends early drops its last episodes at long horizons; if disconnects come with volatile moments, the 60 min cells lean toward calm ones.
- The Binance mid is the price; spread and fees enter only through the 11 bps bar.
- The preceding-move match uses one window (60 s); a different window could give a different control.
- The Reader's thresholds were tuned earlier from the user's labels on part of the exploration period, not on outcomes.
