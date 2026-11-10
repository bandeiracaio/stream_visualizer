# Test pass: absorption evidence items (second absorption pass)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed. Everything below is a lead, not proof. No keep-or-drop conclusion is drawn. Language is neutral: aggressor side and passive side.

The first absorption pass (`test-exhaustion-absorption.md`, section C) tested the impact-shortfall rule against the fixed stalled band. This pass asks a different question: at the moment a group is detected, do the scored evidence items separate what happens next?

Data: the 52 `session_BTC_*.json.gz` in the repo root, 25.1 h of span (v096 engine, default thresholds). Quality verdicts: 38 complete, 7 holes, 7 without a verdict. Results are given for ALL (52), NO-HOLES (45, 21.8 h) and COMPLETE (38, 18.9 h). No `reader_labels*.json` exist, so everything is label-free.

Plan (fixed before running, saved as `abs_plan.md` in the scratchpad):
- A1 census; A2 forward move at detection with a shift null; A3 splits by each scored item at opening; A4 opening score terciles and the number of passing scored items.
- The gate items (flow, stalled, recent) are true at opening by construction and cannot separate anything, so they are not split.
- Not attempted: the shortfall rule (done before), a time-of-day baseline, Hyperliquid per-level order count (not stored), OFI variants.

Method: each session replayed once with a read-only hook appended at `openEp` in an in-memory copy of `reader-episodes.js`; it logs the items and score of each absorption episode at the moment it opens. The hooked engine gave byte-identical groups to the plain engine on 2 sessions (not all 52). The unit is the group; its items, venue and horizon are those of the group's primary (first-detected) episode, so every split uses only what was known at detection (the composition of a group is not used; see `test-burst.md` B6 to B8 for why). Sigma = whole-session robust 15 s sigma. Forward move signed in the aggressor's direction (+ = price continued with the aggressor), on the primary episode's venue. Session-cluster bootstrap (1000) for intervals; shift null = anchors circularly shifted by at least 600 s against the true price path (K = 400); item differences use label permutation within session (1000), Holm over all 28 item tests.

## A1. Census (ALL)
- 779 groups = 31.1 per hour; per session min / median / max 0 / 14 / 43; one session with none (NO-HOLES 691 = 31.7 per hour, COMPLETE 654 = 34.5 per hour).
- Primary venue: Binance 368, Hyperliquid 411. Primary horizon: fast 434, mid 345. Side: 386 buy, 393 sell.
- Detection to end: p10 / median / p90 = 1 / 4 / 19 s; 23% end within 1 s. Median back-dating 2 s.
- After-the-fact resolution: resolved-with 213 (27%), flat 280 (36%), resolved-against 258 (33%), none 28.

## A2. Forward move at detection (sigma, cluster CI, shift-null p, Holm over 4)

| H | n / sessions | mean [CI] | share above 0 | raw p | Holm | typical random \|move\| |
|---|---|---|---|---|---|---|
| 10 s | 769 / 51 | -0.018 [-0.084, +0.039] | .38 | .693 | 1.00 | .51 |
| 30 s | 756 / 51 | -0.036 [-0.112, +0.039] | .45 | .434 | 1.00 | .66 |
| 60 s | 743 / 51 | -0.069 [-0.157, +0.012] | .47 | .145 | .58 | .69 |
| 300 s | 619 / 47 | -0.024 [-0.175, +0.112] | .47 | .701 | 1.00 | .69 |

NO-HOLES and COMPLETE agree (10 s -0.018 and -0.007; 60 s -0.056 and -0.045; all Holm 1.0). No continuation or reversal in the average. Splits by venue, horizon and side lie within noise; the one interval that excludes zero is Binance-primary at 60 s (-0.100 [-0.187, -0.008]), unadjusted among about 24 looks. This agrees with the first pass.

## A3. Item splits at opening (pass minus fail, mean forward move in sigma)

Pass rates at opening (ALL): intensity 51%, efficiency 86%, refill 77% (159 groups without a reading), fills 90%, level 46%, wallet 34% (Hyperliquid primaries only; 368 without a reading), cross 42%. Efficiency, refill and fills pass for most groups and can separate little.

Cells with the largest differences (ALL; others have |diff| under 0.2 or raw p above .15):

| item | H | pass (n) | fail (n) | diff [CI] | raw p | Holm (28) |
|---|---|---|---|---|---|---|
| efficiency | 10 s | +0.036 (657) | -0.333 (112) | +0.369 [+0.154, +0.557] | .003 | .084 |
| efficiency | 30 s | -0.008 | -0.202 | +0.194 [-0.050, +0.456] | .078 | 1.0 |
| efficiency | 60 s | -0.038 | -0.252 | +0.214 [-0.040, +0.480] | .060 | 1.0 |
| refill | 10 s | -0.077 (472) | +0.157 (140) | -0.234 [-0.450, -0.041] | .019 | .51 |
| fills | 30 s | -0.062 (679) | +0.195 (77) | -0.258 [-0.421, -0.036] | .072 | 1.0 |
| level | 30 s | -0.111 | +0.027 | -0.138 [-0.289, +0.004] | .133 | 1.0 |
| level | 60 s | -0.144 | -0.005 | -0.139 [-0.299, +0.025] | .118 | 1.0 |
| wallet | 10 s | +0.131 (138) | -0.045 (267) | +0.175 [-0.071, +0.410] | .080 | 1.0 |

NO-HOLES and COMPLETE: efficiency 10 s +0.312 [+0.092, +0.528] (Holm .22) and +0.291 [+0.038, +0.507] (Holm .34); refill 10 s -0.148 and -0.117 (intervals include 0); fills 30 s -0.238 and -0.196; level 30 / 60 s -0.100 / -0.096 and -0.090 / -0.094. Intensity, wallet and cross show nothing in any subset.

Reading (lead, not proof):
- Nothing survives the correction; the closest is efficiency at 10 s (Holm .084 in ALL, weaker without the hole sessions).
- Efficiency: the item fails when the price path is smooth (high path efficiency). Groups that fail it continue against the aggressor by about -0.33 sigma at 10 s, while groups that pass sit near zero. A plausible reading, not tested here, is that these are cases where price was already reversing (the gate allows up to 1 sigma against the aggressor) and the reversal carries on, which would be a reversal in progress, not evidence of absorption. Conditioning on the progress value at opening would test it.
- Refill, fills and level go in the direction absorption implies (more absorption evidence, less continuation); the differences are small (about 0.1 to 0.25 sigma) and not significant after correction.
- Resolution counts (resolved-with / flat / resolved-against) by pass and fail differ little for every item.

## A4. Opening score and number of passing scored items
- Score at opening: min / median / max 0.704 / 0.778 / 1.000; tercile cut points 0.74 and 0.80.
- Highest third (n 314 to 320): -0.027 [-0.147, +0.084] at 10 s, **-0.151 [-0.246, -0.060] at 30 s**, **-0.107 [-0.197, -0.011] at 60 s**, -0.083 [-0.206, +0.058] at 300 s. NO-HOLES -0.161 and -0.108 (30 and 60 s), COMPLETE -0.125 and -0.088. Lower and middle thirds lie within noise (-0.09 to +0.06). These intervals are not adjusted across the 12 cells.
- Number of passing scored items (3 to 6): no trend (means between -0.355, n 23, and +0.057 at 10 to 60 s).
- The size of the highest-third effect is about a quarter of a typical 30 s move. A mild reversal for the highest-scoring groups is the only thing the data suggests; it is not shown to be a property of the items.

## Candidate variables
| Candidate (absorption.md section 6) | Tested? | Note |
|---|---|---|
| Item-level separation at detection | Yes | A3 |
| Cross-venue response, quote OFI, multi-level OFI | No | `ext` and OFI builds not attempted |
| Passive-wallet identity, Hyperliquid per-level order count | No (cannot) | not stored |
| Time-of-day adjusted lambda | No (insufficient) | 8 distinct days |
| Efficiency conditioned on progress at opening | No | the explanation offered under A3 would be checked this way |

## Caveats
- Sessions are not independent (8 distinct days; 16 of the 52 are 31-minute auto-recordings). The cluster bootstrap and the 600 s shift null only partly address within-session structure.
- Whole-session sigma is slightly non-causal as a yardstick; forward moves start at `tDetected`, about 2 s after the evidence began.
- The tercile cut points come from the data.
- Items other than efficiency, fills and refill pass or fail close to half the time, so their strata are large; wallet and refill have many groups without a reading.
- The hook was checked for identity on 2 of 52 sessions only.
- Several tables show raw intervals beside a Holm value for only the A3 tests; the A4 cells and the A2 subgroup rows are uncorrected.

## Reproduce
Scripts in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\55a22191-e94f-46cf-bca0-b2341b91768c\scratchpad\`:
- `abs_collect.mjs <outdir> [--check]`: hooked replay, one cache file per session (about 10 min).
- `abs_an.mjs <bcache> <acache> all|nohole|complete 1000`: A1 to A4 (outputs `abs_all.txt`, `abs_nohole.txt`, `abs_complete.txt`). `bcache` is the per-session price history and sigma cache written by `burst_collect.mjs` (see `test-burst.md`). The plan is `abs_plan.md`.
