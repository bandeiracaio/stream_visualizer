# Liquidation reversal study: pre-registered plan

Registered 2026-11-06, before any test-set session existed. Script: `analyze-liquidations.mjs` (repo root, offline, `--selftest`, `--status`, `--plan`). This file and the script are committed together; the commit id is the registration. Descriptive and small-sample: it says where to look, never keep or drop anything on its own.

## 1. Question

After a big one-sided liquidation cluster (Binance + Bybit + OKX), does the Binance mid price come back against the liquidations, more than after other moments whose recent price path looks the same but have no liquidation cluster nearby?

This is a question about what happens next, not about causes: a cluster may mark a trending or exhausted state, and no matching on price alone separates that from the liquidations themselves (section 8). The result would describe what the Reader's user can expect after a cluster.

## 2. What was seen before registering (disclosure)

On the 166 sessions recorded up to 2026-11-05 (98 hours, Binance liquidations only, no Bybit / OKX data), a descriptive look (`exploration-20261105.md`) showed, for the 242 clusters of at least $100k: price had moved about 1.1 sigma in the liquidation direction in the 5 minutes before (92% of clusters), and then moved back by a median 0.67 sigma in the minute after the cluster ended (74% reversed), 0.53 at 5 minutes and 0.34 at 15 minutes. A first matched-control attempt (same session, no liquidation anywhere nearby) found almost no controls and was inconclusive. Those sessions are the EXPLORATION set: the outcomes were seen, so they cannot confirm anything. After that look: the cluster threshold ($100k, 30 s), the choice to pool controls over sessions, and the matching tolerances were fixed using only counts of how many controls exist (not outcomes); on the exploration sessions 92%, 91% and 90% of clusters get at least 20 matched controls at 1, 5 and 15 minutes. The script's self-test was written and corrected on synthetic tapes (two generator mistakes, found because a no-effect tape gave false reversals, are described in the commit history of the script).

NOT seen: any session that started after the cutoff below. Those sessions are the TEST set, and the first real run uses them once.

## 3. Test set

Sessions in `sessions/` that started at or after `PLAN.cutoffIso` (2026-11-06T03:15:00Z). The primary variant uses the sessions that carry Bybit and OKX liquidations (`oiPerp` records present, from v122); the Binance-only variant uses all test sessions. `--status` prints counts of sessions, clusters and pairs and NO outcome, so progress can be watched without peeking; the test refuses to run before the primary variant has 60 clusters and 30 pairs (about a day of the recording rate seen so far, see section 8).

## 4. Definitions (all in `PLAN`)

- **Events:** Binance liquidations from the session inputs; Bybit and OKX from `liqPerp` rows (dollars = price x size). Side = side of the forced order: `sell` = a long was liquidated = price pushed down.
- **Cluster:** events within 30 s of each other (`LIQ.clusters`, `src/js/liq-core.js`). **Primary cluster:** at least $100k and at least 90% of the dollars on one side.
- **Price:** the Binance mid once a second from the recorded quotes; moves in sigmas of the session (`sigmaOf` / `forwardMove`, `src/js/scoreboard-core.js`), signed in the direction the liquidations pushed, so a negative move after the cluster is a reversal. Before: the 5 minutes and the last minute before the cluster's start. After: 60 s (primary), 300 s and 900 s from the cluster's end.
- **Controls:** a 10-second grid of moments over all test sessions of the variant, whose 5-minute move (in the cluster's direction) is within 0.3 sigma of the cluster's and whose last-minute move is within 0.6 sigma of the cluster's, with no cluster of at least $25k overlapping [5 minutes before, horizon after]. At least 20 controls are required per cluster and horizon (a seeded sample of at most 200 is kept).

## 5. Tests and decision rule

- **Primary (T2, 60 s, three-venue clusters):** per cluster, the move after it minus the median move after its controls; statistic = the median of those differences over the clusters with controls. Two one-sided p-values (alternative: the median is below zero): by flipping the sign of whole sessions' differences (9,999 times) and by resampling whole sessions (2,000 times). **Verdict `REVERSAL beyond matched controls`** only if the median difference is negative and both p-values are at most 0.05, with at least 60 clusters and 30 pairs; otherwise `no reversal beyond matched controls`, or `not enough data`.
- **Secondary, reported but not part of the verdict:** the same at 300 s and 900 s (Holm over the two, using the larger of the two p-values); the Binance-only variant (comparable with the exploration); the share of clusters that reversed with a Wilson interval; the rank correlation of log cluster dollars with the 1-minute move given the move before (descriptive only).
- The run is made ONCE with this plan; results go to `.scratch/liquidation-study/result-YYYYMMDD.json` and `.md`. Nothing is added, redefined or re-thresholded afterwards; a change is a new registration (section 10) and its results are exploratory.

## 6. What the self-test shows (synthetic tapes)

A planted reversal after clusters at random times is found (median difference about -1.7 sigma, p about 0.001); on eight tapes with no reversal, at most one of eight reads a reversal at the 5% level and the differences stay near zero; sessions before the cutoff are excluded; a session without Bybit / OKX records is excluded from the three-venue variant; `--status` prints no outcome; the study is deterministic; too little data says so.

## 7. Power

At about 2.5 Binance-only clusters of at least $100k per recorded hour in the exploration data (the three-venue count will be higher: Bybit and OKX add dollars, so more clusters pass $100k, but also more moments are excluded as controls), 60 clusters take about a day of recording; the interval of the median difference narrows with the square root of the clusters, so a reversal of about half a sigma beyond controls (the size seen in the exploration) should be visible in 100 clusters, and a smaller one will not be.

## 8. Known limitations

- A cluster may mark a trending or exhausted state; matching on the last 5 minutes and last minute does not remove that. A difference from the controls describes what follows a cluster, not what the liquidations cause.
- Part of a 1-minute reversal can be the temporary price impact of the last forced orders fading, not information.
- Clusters overlap in time (a cascade makes several) and come from few days of mostly volatility-triggered recording; the session-level sign flips and resampling respect that, the controls are pooled and treated as fixed.
- Binance reports at most one liquidation per symbol per second, so its dollars are a lower bound; Bybit and OKX report every one. The three-venue variant is the better measure and has no exploration counterpart.
- Controls are from the same recording period as the clusters, so a market-wide regime shared by both is not separated.

## 9. Stage 2 (not part of this registration)

Liquidation features on open interest (`oiPerp`: does open interest fall at the cluster?), liquidation proximity of followed wallets, other horizons and sides separately, and a replication on sessions recorded after the first run.

## 10. Amendments

None yet. Format: date, what changed, why, and whether any test-set result had been seen.

## 11. How to run

```
node analyze-liquidations.mjs --selftest   # 9 checks on synthetic tapes
node analyze-liquidations.mjs --status     # counts only: test sessions, clusters, pairs
node analyze-liquidations.mjs              # the test, once, when --status shows enough; add --json for everything
```
