# Test pass: burst (hypothesis 3)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed. Everything below is a lead, not proof. No keep-or-drop conclusion is drawn. Language is neutral: aggressor side, no bull / bear.

Data: the 52 `session_BTC_*.json.gz` in the repo root, 25.1 h of span (v096 engine, default thresholds). Quality verdicts: 38 complete, 7 holes, 7 without a verdict. Results are given for ALL (52), NO-HOLES (45, 21.8 h) and COMPLETE (38, 18.9 h). No `reader_labels*.json` exist, so everything is label-free.

Plan (fixed before running): B1 census; B2 forward move at detection with a shift null; B3 splits by the evidence items at detection; B4 agreement with independent notional excursions; B5 clock. Not attempted: a time-of-day adjusted baseline (8 distinct days) and the Hawkes branching ratio (needs a kernel fit).

Method: each session replayed once through the engine with a read-only hook appended at `openEp` in an in-memory copy of `reader-episodes.js` (it logs the evidence items at the moment a burst opens; the files on disk are untouched). The hooked engine gave byte-identical episode groups to the plain engine on 3 sessions (not all 52, unlike the earlier passes). Sigma = whole-session robust 15 s sigma (`sigmaOf` of `reader-scoreboard.mjs`). Forward move is signed in the aggressor's direction (+ = price continued with the aggressor), venue = Binance when a group has it, otherwise Hyperliquid. Session-cluster bootstrap (1000) for intervals; null = anchors circularly shifted by at least 600 s against the true price path (K = 400); Holm within each table.

## B1. Census (ALL)
- 429 burst groups = 17.1 per hour; per session min / median / max 0 / 6 / 30; 2 sessions with none.
- Venue set: Binance only 142, Hyperliquid only 132, both 155. Side: 214 buy, 215 sell. Horizon: fast only 80, mid only 210, both 139.
- Detection to end: p10 / median / p90 = 1 / 7 / 30 s; 12% end within 1 s of detection (NO-HOLES 11%, COMPLETE 11%). Median back-dating (`tDetected - tStart`) 2 s.
- After-the-fact resolution (price move in the 30 s after the group faded, at the group's venue): resolved-with 104 (25%), flat 145 (35%), resolved-against 169 (40%), none 11. More groups end with price moving against the aggressor than with it. Descriptive only; not tested against a null.

## B2. Forward move at detection (mean sigma, cluster CI, shift-null p, Holm over 4)

| H | ALL n/sessions | mean [CI] | raw p | Holm | typical random \|move\| (median) |
|---|---|---|---|---|---|
| 10 s | 426 / 50 | +0.163 [+0.024, +0.288] | .007 | **.030** | .51 |
| 30 s | 418 / 50 | +0.062 [-0.037, +0.150] | .299 | .599 | .66 |
| 60 s | 411 / 50 | +0.098 [+0.001, +0.192] | .152 | .456 | .69 |
| 300 s | 367 / 43 | +0.000 [-0.172, +0.143] | 1.000 | 1.000 | .69 |

The 10 s effect is not robust to the subset: NO-HOLES +0.128 [-0.029, +0.264] Holm .18; COMPLETE +0.148 [-0.002, +0.277] Holm .08. Share of moves above zero is .45 to .52 at every horizon. So after a burst is detected there is at most a small continuation at 10 s (about a third of a typical move), and nothing at 30 s or later. Detection already comes after the price moved (see B3).

By venue set (shown to flag a difference): at 10 s Binance only -0.251 (n 141), Hyperliquid only +0.123 (n 131), both +0.575 (n 154); at 60 s -0.120 / -0.017 / +0.397. **This difference is mostly an artefact of how groups are formed; see B6.** Do not read "both venues" as predictive from this table.

## B3. Splits by the evidence at detection (diff = pass minus fail; Holm over 16)
- Pass counts at detection: `move` (price moved with the aggressor) 407 of 429, `break` (through the 5-minute extreme) 323, `cross` (other venue agrees) 254, `liq` 39. The `move` item passes for 95% of groups, so it hardly separates anything; `liq` passes for 9%.
- No cell is near significance: every Holm value is 1.000; the smallest raw p is .101 (`cross`, 10 s: diff -0.216 [-0.479, +0.044], other venue agreeing goes with a smaller continuation). Intervals are wide (n of 20 to 40 in the small strata).
- Liquidations present (n 39): forward 300 s -0.285, interval of the difference [-0.819, +0.247]. Not resolved.

## B4. Agreement with independent notional excursions (no labels)
Excursion = a 15 s sliding taker-notional window of one venue and side at or above the session's own percentile (merged within 30 s). A burst group agrees when its span (+-15 s) overlaps an excursion on the same side and one of its venues.

| percentile | excursions | precision (groups overlapping) | chance level | recall (excursions overlapped) |
|---|---|---|---|---|
| 99 | 369 | 37% (158 / 429) | 9% | 47% |
| 99.5 | 264 | 26% | 6% | 47% |
| 99.9 | 210 | 21% | 4% | 46% |

Same picture in NO-HOLES and COMPLETE (precision 37% / 37%, recall 44% / 48% at the 99th). Reading: burst groups land on large-notional windows well above chance, and about half of the largest windows have no burst group. The two are not meant to agree: the engine scores flow against its own 30-minute baseline with a share gate and trade-count minimums, while the excursions use a whole-session percentile. A disagreement is a place to look, not an error.

## B5. Clock (UTC; descriptive, detections cluster so p is optimistic)
- Within +-2 min of a full hour: 38 of 429 detections (8.9%) against 6.1% of recorded seconds, binomial p .026.
- Within +-2 min of 00 / 08 / 16 UTC: 8 of 429 (1.9%) against 0.8%, p .027 (about 3.4 expected).
- Holm over these two: .052 each. NO-HOLES and COMPLETE similar (8.5% / 8.9% and 2.3% / 2.5%).
- The per-hour table (bursts per recorded hour, 4 to 38) is noise at 8 distinct days and is not read.
A small excess near round times is the only thing the data suggests; it is not significant after correction and cannot tell a scheduled-time effect from chance.

## B6. The venue contrast: intervals, then the anchor check
Intervals first (script `burst_venue.mjs`, every group scored on the same price path, session-cluster bootstrap, label-permutation p, Holm over 12 per path). Anchored at the group's `tDetected` the groups seen on both venues look strong: +0.575 [+0.346, +0.790] at 10 s on the Binance path and +0.870 [+0.617, +1.122] on the Hyperliquid path, +0.40 to +0.60 at 60 s. Both minus Binance-only on the Binance path: +0.826 [+0.553, +1.110] at 10 s, Holm .006 (NO-HOLES and COMPLETE the same). Hyperliquid-only minus Binance-only is weak (+0.287 [+0.033, +0.535], Holm .096 on the Binance path, +0.024 on the Hyperliquid path). Groups seen on both venues also last longer (median 17 s against 3 s for Binance only and 6 s for Hyperliquid only).

Why that cannot be read as information available at detection. In `groups()` the group's `tDetected` is the earliest member's, but a group counts as "both venues" as soon as a second venue's episode joins within the grouping gap, possibly seconds later. So the label is known only after the anchor. Check (script `burst_anch.mjs`, member detection times from a second replay): the delay between the first detection and the moment both venues had an episode has p10 / median / p90 of 0 / 3 / 16 s (ALL; NO-HOLES 0 / 3 / 15; COMPLETE 1 / 3 / 17); only 32% of both-venue groups are complete within 1 s, 63% within 5 s, 20% need more than 10 s.

Anchored at the moment both venues are known, the continuation disappears (ALL, mean sigma [cluster CI]):

| path | H | from `tDetected` | anchored at "both known" |
|---|---|---|---|
| Binance | 10 s | +0.575 | -0.003 [-0.264, +0.240] |
| Binance | 60 s | +0.397 | +0.008 [-0.209, +0.220] |
| Hyperliquid | 10 s | +0.870 | +0.159 [-0.079, +0.365] |
| Hyperliquid | 60 s | +0.603 | +0.127 [-0.085, +0.332] |

Both minus a single-venue set, anchored: every Holm value is 1.000 (Binance path, both minus Binance-only: +0.248 [-0.068, +0.540] at 10 s). Matched control (single-venue groups anchored with delays drawn from the both-venue groups and kept only if still active then): both minus Binance-only +0.345 [+0.058, +0.623] at 10 s, raw p .057, Holm .46; every other cell has an interval including 0 and Holm of .5 or more. NO-HOLES and COMPLETE reproduce this (anchored Binance-path 10 s +0.050 and +0.045).

Reading (lead, not proof): the large continuation after "both venues" is selection. The label is learned about 3 s (median) after the first detection, and the price had moved on by then. From the moment it is known there is no measurable continuation in this sample; a small remainder (up to about +0.3 sigma at 10 s against Binance-only groups under the matched control) is not resolved after correction. Binance-only groups are slightly negative at 10 s (-0.251 [-0.432, -0.065], raw shift p .015, Holm .36), not established.

## B7. The same check on the other grouped families (ALL 52 sessions only)
Scripts `grp_members.mjs` (one replay recording every non-wall group's members) and `grp_anch.mjs <cachedir> <memberdir> <family> venue|horizon all 1000`. Same method as B6: a multi-valued group (both venues, or fast and mid horizons) is anchored at the moment its composition was complete (the latest of the first detections per value), single-valued groups at `tDetected`, plus a matched control (single-valued groups anchored with the multi-valued groups' delays and kept only if still active). Cluster bootstrap CIs, label-permutation p, Holm within each block. NO-HOLES and COMPLETE were run for exhaustion venues only (see the exhaustion bullet below).

Delay until the composition was complete (median; share above 10 s): burst venues 3 s (20%), burst horizons 5 s (27%), absorption horizons 5 s (27%), absorption venues 8 s (41%), exhaustion venues 5 s (32%). Median duration of multi-valued groups is 12 to 22 s against 2 to 6 s for single-valued ones.

| family, split | from `tDetected`, multi minus single | anchored at composition complete |
|---|---|---|
| burst, venues (check on the new pipeline) | both minus Binance-only +0.826 at 10 s, Holm .016 | +0.248 [-0.057, +0.541], Holm 1.0; matched control +0.334 [+0.034, +0.602], Holm 1.0 |
| burst, horizons | both minus fast +0.762 at 10 s (Holm .008), both minus mid +0.701 (Holm .008) | +0.169 [-0.213, +0.484] and +0.108 [-0.131, +0.369], Holm 1.0; matched control +0.318 and +0.276 [+0.045, +0.519] (raw p .076 and .047, Holm .53 and .38) |
| absorption, venues | all differences within +-0.2, Holm 1.0 | the same, Holm 1.0 |
| absorption, horizons | all Holm 1.0 | one raw hint, both minus mid -0.234 [-0.454, +0.006] at 30 s (raw p .025, Holm .20) |
| exhaustion, venues | both minus Binance-only -0.139 at 10 s (Binance path), Holm 1.0 | see below |

Reading (lead, not proof):
- Burst: the horizon split has the same selection effect as the venue split. Groups that run on both horizons look much stronger from `tDetected` and show no corrected difference once the moment the composition was known is used.
- Absorption: no contrast in either form, so there is nothing for the selection to inflate. The composition is learned late (venues: 41% of groups need over 10 s).
- Exhaustion: from the moment both venues have an episode, price moves against the dominant side: -0.166 [-0.343, -0.011] sigma at 10 s on the Binance path and -0.325 [-0.509, -0.192] on the Hyperliquid path (interval unadjusted). Against Binance-only groups on the Hyperliquid path: -0.345 [-0.565, -0.186], raw p .010, Holm .16 (matched control -0.336, raw p .005, Holm .08); against Hyperliquid-only -0.174 [-0.390, -0.009], Holm 1.0. Anchoring made this stronger, not weaker (the unanchored contrast is about -0.14 and not significant), so it is not an artefact of the late label, but it does not survive correction and is a small sample (85 groups). The sign is the one exhaustion implies (reversal). Unresolved.
- Exhaustion venues on the other subsets (NO-HOLES 73 both-venue groups, COMPLETE 71): the lead keeps its sign and weakens. "Both" groups anchored at 10 s on the Hyperliquid path: -0.320 [-0.515, -0.179] and -0.309 [-0.537, -0.155] (ALL -0.325); on the Binance path -0.151 [-0.359, +0.024] and -0.138 [-0.345, +0.040] (the interval now includes 0; ALL [-0.343, -0.011]). Both minus Binance-only, Hyperliquid path, 10 s: -0.343 [-0.622, -0.128] raw p .031, Holm .50 (NO-HOLES) and -0.323 [-0.630, -0.107] raw p .043, Holm .70 (COMPLETE) against raw p .010, Holm .16 in ALL; matched control the same (Holm .51 and .60). Both minus Hyperliquid-only: -0.149 and -0.133, intervals include 0. Unanchored contrasts (kept at `tDetected`) are null (-0.07 to +0.17, intervals include 0). At 300 s the anchored "both" mean is about -0.22 to -0.25 in both subsets, but single-venue exhaustion groups also lean negative at 300 s (see test-exhaustion-absorption.md), so that is not specific to "both". Net: the reversal after both venues are known is steady in size (about -0.3 sigma on the Hyperliquid path) but is not shown to differ from single-venue groups once corrected for the number of tests; it is a small sample (71 to 85 groups) and stays unresolved.
- Use: the group labels shown in the app (venues, horizons) are accurate summaries but are known late. Any filter or analysis built on them has to anchor at the time the label became known. The earlier absorption and exhaustion tests anchored at `tDetected` and did not split by composition, so they are unaffected. `reader-scoreboard.mjs` picks the price path from the group's venue set, which is known late; the size of that effect was not measured.

## Candidate variables
| Candidate (burst.md section 6) | Tested? | Note |
|---|---|---|
| Seasonal (time-of-day) baseline | No (insufficient) | 8 distinct days; B5 is the weak substitute |
| Hawkes branching ratio | No | not implemented |
| Depth removed from the far side (`thin`) | Partly | the item exists; its split was not run, only move / liq / cross / break |
| Event clock as a prior | Partly | B5 round times only; collector calendar tags not joined |
| Open interest change after the burst | No | collector cadence not joined |
| Followed wallets inside the burst | No | |
| Trade-level liquidation size | No (NEEDS NEW DATA) | |

## Caveats
- Sessions are not independent (8 distinct days; 16 of the 52 are 31-minute auto-recordings). The cluster bootstrap and the 600 s shift null only partly address within-session structure.
- Whole-session sigma is slightly non-causal as a yardstick.
- Forward moves start at `tDetected`, which is about 2 s after the evidence began; the first seconds of a continuation or reversal sit inside the lag.
- Venue choice for forward moves (Binance when present) matters given the venue-set contrast in B2.
- The hook was checked for identity on 3 of 52 sessions only.
- Group counts are per group (fast and mid readings of one event are one group); stratum sizes are small in B3.

## Reproduce
Scripts in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\55a22191-e94f-46cf-bca0-b2341b91768c\scratchpad\`:
- `burst_collect.mjs <outdir> [--check]`: hooked replay, writes one cache file per session (about 10 min); `--check` compares hooked and plain groups on 3 sessions.
- `burst_an.mjs <cachedir> all|nohole|complete 1000`: prints B1 to B5 (outputs saved as `burst_all.txt`, `burst_nohole.txt`, `burst_complete.txt`). The plan is `burst_plan.md` in the same folder.
- `burst_venue.mjs <cachedir> all|nohole|complete 2000`: B6 intervals (`burstv_*.txt`).
- `burst_members.mjs <outdir>`: second replay, writes each group's member venues and detection times (about 10 min). `burst_anch.mjs <cachedir> <memberdir> all|nohole|complete 2000`: B6 anchor check (`burstA_*.txt`). Note the anchor check was not in the plan fixed before running; it was added after the venue interval looked too strong, and its results are reported in full, including the part that reversed the earlier reading.
