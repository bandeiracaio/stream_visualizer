# Test pass: burst groups at opening (second burst pass, v096 engine)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed. Everything below is a lead, not proof. No keep-or-drop conclusion is drawn. Language is neutral: aggressor side, no bull / bear.

The first burst pass (`test-burst.md`, B1 to B8) covered the census, the forward move at detection, splits by evidence items, agreement with notional excursions, the clock, and the venue and horizon composition of groups (where it found a selection effect). This pass adds the two things the later passes on the other families used: a momentum control for the move that was under way before detection, and splits on the continuous quantities known at opening.

Data: the 52 `session_BTC_*.json.gz` in the repo root, 25.1 h of span, default thresholds. Quality verdicts: 38 complete, 7 holes, 7 without a verdict. Results are given for ALL (52), NO-HOLES (45, 21.8 h) and COMPLETE (38, 18.9 h). No `reader_labels*.json` exist, so everything is label-free.

Plan (fixed before running, saved as `burst2_plan.md` in the scratchpad): Z1 census; Z2 forward move at detection with a shift null and a momentum control; Z3 splits at opening (scored items move, liq, sweeps, thin, break, cross; flow z, price move so far and window notional by tercile; primary horizon; primary venue); Z4 opening score terciles and the number of passing scored items. The printed section headings of the output files say X1 to X4 (the script was derived from the exhaustion one). Not attempted: Hawkes branching ratio, a time-of-day baseline, depth removed from the far side beyond the `thin` item, collector joins, trade-level liquidation size.

Method: each session replayed once with a read-only hook appended at `openEp` in an in-memory copy of `reader-episodes.js`; it logs the items, quantities and facts of each burst episode at the moment it opens. The hooked engine gave byte-identical groups to the plain engine on 2 sessions (not all 52). The unit is the group; its items, quantities, venue and horizon are those of the group's primary (first-detected) episode, so every split uses only what was known at detection (the venue and horizon composition of a group is not used; see `test-burst.md` B6 to B8). Sigma = whole-session robust 15 s sigma. Forward move signed in the aggressor's direction (+ = price continued with the aggressor), on the primary episode's venue. Session-cluster bootstrap (1000) for intervals; shift null = anchors circularly shifted by at least 600 s against the true price path (K = 400); item differences use label permutation within session (1000); Holm within each table.

## Z1. Census (ALL)
- 429 groups = 17.1 per hour; per session min / median / max 0 / 6 / 30; 2 sessions with none (NO-HOLES 343 = 15.7 per hour, COMPLETE 325 = 17.2 per hour).
- Primary venue: Binance 261, Hyperliquid 168. Side: 214 buy, 215 sell. Primary horizon: mid 288, fast 141.
- Detection to end: p10 / median / p90 = 1 / 7 / 30 s; 12% end within 1 s; median back-dating 2 s.
- After-the-fact resolution: resolved-with 104, flat 145, resolved-against 169, none 11.
- Median values at opening: flow z 8.4, aggressor share 0.91, price move so far 2.29 sigma, window notional $2.4M; mean liquidations 0.40, mean sweeps 25.6.

## Z2. Forward move at detection (sigma, cluster CI, shift-null p, Holm over 4)

| H | n / sessions | mean [CI] | share above 0 | raw p | Holm | typical random \|move\| |
|---|---|---|---|---|---|---|
| 10 s | 426 / 50 | +0.158 [+0.038, +0.277] | .44 | .010 | .040 | .51 |
| 30 s | 418 / 50 | +0.068 [-0.037, +0.161] | .52 | .252 | .504 | .66 |
| 60 s | 411 / 50 | +0.105 [-0.013, +0.200] | .53 | .110 | .329 | .69 |
| 300 s | 367 / 43 | +0.005 [-0.195, +0.145] | .47 | .960 | .960 | .69 |

The 10 s mean reproduces `test-burst.md` B2 (+0.163). NO-HOLES: +0.121 [-0.022, +0.250] (Holm .39); COMPLETE +0.141 [+0.002, +0.281] (Holm .14). By primary venue at 10 s: Hyperliquid +0.275 [+0.108, +0.424] (n 166), Binance +0.082 [-0.129, +0.263] (n 260); the difference is +0.193 [-0.076, +0.472] (raw p .104). By side: buy +0.143, sell +0.172 at 10 s.

Momentum control. In the P seconds before detection price had already moved with the aggressor: mean +2.061 [+1.908, +2.247] sigma over 10 s, +1.532 [+1.413, +1.671] over 30 s, +1.388 [+1.286, +1.520] over 60 s. The slope of forward on prior move at random moments (random direction) is 0.04 to 0.06 at 10 to 60 s forward and about 0 at 300 s. Observed minus slope times prior move (residual, [CI]):

| prior move window | forward 10 s | forward 30 s | forward 60 s | forward 300 s |
|---|---|---|---|---|
| 10 s | +0.025 [-0.110, +0.157] | -0.029 [-0.135, +0.065] | +0.002 [-0.107, +0.101] | -0.006 [-0.180, +0.136] |
| 30 s | +0.094 [-0.032, +0.211] | +0.011 [-0.088, +0.106] | +0.018 [-0.093, +0.106] | +0.014 [-0.150, +0.159] |
| 60 s | +0.098 [-0.029, +0.221] | -0.004 [-0.106, +0.084] | +0.024 [-0.078, +0.115] | +0.031 [-0.164, +0.176] |

NO-HOLES and COMPLETE, 10 s residual: +0.002 / +0.062 / +0.072 and +0.013 / +0.077 / +0.086 (prior window 10 / 30 / 60 s), all intervals include 0.

Reading (lead, not proof): after a burst opens there is at most a small continuation at 10 s (about 0.15 sigma, under a third of a typical 10 s move), and nothing at 30 s or later after correction. Most of the 10 s continuation is what the move already under way would predict: against the 10 s prior move the residual is +0.025; against the 30 and 60 s prior moves it is about +0.09 to +0.10 with intervals that include 0. A small remainder on Hyperliquid-primary groups is not separated from the venue difference.

## Z3. Splits at opening (A minus B, mean forward move; Holm over all tests)
Strata sizes (ALL): move pass 407 / fail 22; liq 39 / 390; sweeps 413 / 16 (too few fails, not tested); thin 144 / 285; break 323 / 106; cross 254 / 172; flow z top 143 (13.2 or above) / bottom 144 (5.8 or below); price move so far top (2.76 or above) / bottom (1.93 or below); window notional top ($4.37M or above) / bottom ($1.26M or below); mid 288 / fast 141 primary horizon; Hyperliquid 168 / Binance 261 primary.

Every Holm value is 1.00 in ALL; in NO-HOLES and COMPLETE the smallest are .47 and .79 (raw p .013 and .022). The smallest raw p values in ALL:
- `thin` (far side of the book thinned) at 10 s: pass +0.344 against fail +0.064, difference +0.280 [+0.035, +0.579], raw p .016 (Holm .64).
- Window notional top against bottom tercile at 30 s: -0.304 [-0.629, +0.033], raw p .024; at 60 s -0.220 (raw p .062); at 300 s -0.446 [-0.812, -0.067], raw p .134. Larger bursts lean toward less continuation.
- `cross` (other venue agrees) at 10 s: -0.220 [-0.444, +0.041], raw p .052.
- `break` at 300 s: -0.276 [-0.686, +0.138], raw p .099; Hyperliquid against Binance primary at 10 s: +0.193, raw p .104.
Flow z, price move so far, liquidations, the move item and the primary horizon show nothing at any horizon. Nothing at opening separates the forward move.

## Z4. Opening score and number of passing scored items
- The score at opening is bunched: min / median / max 0.739 / 0.826 / 1.000, tercile cut points 0.76 and 0.84; the low tercile holds a single group, the middle 213, the high 212 (10 s: +0.181 [+0.023, +0.343] and +0.138 [-0.075, +0.318]), so terciles say nothing here.
- By number of passing scored items (3, 4, 5 of the 6): 10 s +0.148 / +0.171 / +0.149 (n 195 / 177 / 49); 300 s +0.175 / -0.097 / -0.215. No consistent trend.

## Candidate variables
| Candidate (burst.md section 6) | Tested? | Note |
|---|---|---|
| Hawkes branching ratio | No | |
| Seasonal (time-of-day) baseline | No (insufficient) | 8 distinct days; the clock check is in `test-burst.md` B5 |
| Depth removed from the far side during the burst | Partly | the `thin` item, Z3 |
| Event clock as a prior | Partly | `test-burst.md` B5 |
| Open interest after the burst; followed wallets inside the burst | No | collector join not attempted |
| Trade-level liquidation size | No (NEEDS NEW DATA) | |

## Caveats
- Sessions are not independent (8 distinct days; 16 of the 52 are 31-minute auto-recordings). The cluster bootstrap and the 600 s shift null only partly address within-session structure.
- Whole-session sigma is slightly non-causal as a yardstick; forward moves start at `tDetected`, about 2 s after the evidence began.
- The momentum control uses a pooled slope from random moments with a random direction; the 10 s residual depends on the prior-move window (+0.03 against 10 s, about +0.10 against 30 and 60 s).
- The `move` and `sweeps` items pass for 95% and 96% of groups, so their fail strata are small.
- The score is nearly constant, so the opening-score split is uninformative.
- The hook was checked for identity on 2 of 52 sessions only.

## Reproduce
Scripts in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\55a22191-e94f-46cf-bca0-b2341b91768c\scratchpad\`:
- `burst2_collect.mjs <outdir> [--check]`: hooked replay, one cache file per session (about 10 min).
- `burst2_an.mjs <bcache> <zcache> all|nohole|complete 1000`: Z1 to Z4 and the momentum control (outputs `burst2_all.txt`, `burst2_nohole.txt`, `burst2_complete.txt`). `bcache` is the per-session price history and sigma cache written by `burst_collect.mjs` (see `test-burst.md`).
