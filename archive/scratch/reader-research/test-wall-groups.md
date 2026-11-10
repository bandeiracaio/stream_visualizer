# Test pass: wall groups (second wall pass, v096 engine)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed. Everything below is a lead, not proof. No keep-or-drop conclusion is drawn. Language is neutral: a wall's side is bid or ask; no bull / bear.

The first wall pass (`test-wall.md`) studied every tracked wall and a candidate set built to mimic the episode rules (v095 engine). This pass studies the wall groups the Reader actually shows after v096 (a wall that is already fading no longer opens a card), and asks what happens to price after a card opens and whether anything known at opening predicts how the wall ends.

Data: the 52 `session_BTC_*.json.gz` in the repo root, 25.1 h of span, default thresholds. Quality verdicts: 38 complete, 7 holes, 7 without a verdict. Results are given for ALL (52), NO-HOLES (45, 21.8 h) and COMPLETE (38, 18.9 h). No `reader_labels*.json` exist, so everything is label-free.

Plan (fixed before running, saved as `wall2_plan.md` in the scratchpad): W1 census; W2 forward move at detection with a shift null; W3 splits by features at opening; W4 outcome prediction at opening. Not attempted: wall lifetime survival against a shifted-size null, book-summary churn, cross-venue mirrored walls, Hyperliquid per-level order count (not stored). The forward move by outcome was not run: the outcome is learned after the anchor and would carry the look-ahead that made the "held" class in `test-wall.md` meaningless.

Method: each session replayed once with a read-only hook appended at `wallOpen` in an in-memory copy of `reader-episodes.js` (it logs what is known when a wall episode opens); the hooked engine gave byte-identical groups to the plain engine on 2 sessions (not all 52). The unit is the wall group (the groups layer does not merge walls, so one group is one episode). Sigma = whole-session robust 15 s sigma. Forward move is signed in the wall's reaction direction (bid wall = up, ask wall = down; negative = price moves toward and through the wall), on the wall's own venue. Session-cluster bootstrap (1000) for intervals; shift null = anchors circularly shifted by at least 600 s against the true price path (K = 400); feature differences use label permutation within session (1000); Holm within each table.

## W1. Census (ALL)
- 664 groups = 26.5 per hour; per session min / median / max 0 / 11 / 30; one session with none (NO-HOLES 582 = 26.7 per hour, COMPLETE 550 = 29.0 per hour).
- Venue: Binance 618, Hyperliquid 46. Side: 334 bid, 330 ask.
- Outcome: pulled 288, eaten 211, left 87, faded 73, gap 1, still open 4.
- Age at detection p10 / median / p90 = 62 / 107 / 453 s. Peak USD p10 / median / p90 = $117k / $236k / $1.2M. Ratio to the median level: median 810. Distance from mid: median 0.02 bps, p90 0.66 bps. Reposts of 2 or more: 35%.
- Detection to end: p10 / median / p90 = 0.3 / 3.7 / 35.6 s; 25% end within 1 s, 56% within 5 s.

## W2. Forward move at detection (sigma, cluster CI, shift-null p, Holm over 4)

| H | n / sessions | mean [CI] | share above 0 | raw p | Holm | typical random \|move\| |
|---|---|---|---|---|---|---|
| 10 s | 662 / 51 | **-0.492** [-0.580, -0.403] | .26 | .002 | .010 | .51 |
| 30 s | 653 / 51 | -0.312 [-0.400, -0.222] | .38 | .002 | .010 | .66 |
| 60 s | 643 / 51 | -0.281 [-0.381, -0.168] | .41 | .002 | .010 | .69 |
| 300 s | 544 / 46 | -0.082 [-0.178, +0.000] | .48 | .244 | .244 | .69 |

NO-HOLES: -0.491 / -0.312 / -0.277 at 10 / 30 / 60 s (Holm .010); COMPLETE -0.483 / -0.309 / -0.274. Binance and Hyperliquid, bid and ask walls all show the same sign (10 s: Binance -0.482, Hyperliquid -0.631 on n 46, bid -0.526, ask -0.458).

**Price was already moving toward the wall.** In the P seconds before detection the move in the reaction direction had a mean of -1.026 [-1.100, -0.940] sigma (P = 10 s), -1.008 (30 s) and -0.719 (60 s). Momentum alone does not explain the forward move: the slope of forward on prior move at random moments (random direction) is 0.04 to 0.06, which predicts -0.03 to -0.07 forward, against an observed -0.492; the residual at 10 s is -0.426 [-0.520, -0.336] (prior 10 s), -0.451 (prior 30 s), -0.461 (prior 60 s); at 30 s -0.26 to -0.27; at 60 s -0.22 to -0.24; at 300 s about -0.08 to -0.10 (intervals reach 0).

Reading (lead, not proof): a wall card opens as price is arriving at the level and continues toward and through it. That is consistent with `test-wall.md` section D, where the move after any touch of a level was the same as on a shifted price path (the arrival of price at a level, not a property of walls). It also fits the finding in the quick-ending investigation that the walls that end fastest sit at the touch and are mostly eaten. This pass does not separate a wall's effect from the effect of price arriving at a level; no distance-matched control was built. A related guess, not tested here, is that a card can open because the wall comes back into view as price approaches (the tracker keeps an out-of-view wall alive without updating it).

## W3. Splits by features at opening (A minus B, mean forward move; Holm over all 32 tests)
Splits: two or more reposts against fewer; at the touch (under 0.1 bps) against further; distance above or below the median (0.02 bps); ratio top against bottom tercile; peak USD top against bottom tercile; age at detection above or below the median (107 s); Hyperliquid against Binance; ask wall against bid wall.

Every Holm value is 1.00 except the side difference at 300 s (ask minus bid -0.214 [-0.429, -0.003], raw p .025, Holm .80; NO-HOLES -0.163, COMPLETE -0.166, raw p about .09). The smallest other raw p values: ratio top against bottom tercile at 60 s +0.177 [-0.040, +0.415] (raw p .090) and 300 s +0.224 [-0.040, +0.521] (.099); age above median at 10 s -0.162 [-0.372, +0.030] (.078); reposts at 10 s +0.156 [-0.030, +0.354] (.163). Nothing at opening separates the forward move.

## W4. Outcome prediction at opening (AUC for "pulled" against eaten, faded and left; Holm over 6)
Ended groups 659: pulled 288, other 371 (eaten 211, left 87, faded 73). AUC above .5 means a higher value goes with pulled.

| feature | median pulled / other | AUC [CI] | perm p | Holm |
|---|---|---|---|---|
| log10 ratio | 2.85 / 2.94 | 0.407 [0.363, 0.451] | .003 | .020 |
| log10 peak USD | 5.35 / 5.41 | 0.463 [0.418, 0.504] | .279 | .84 |
| distance bps | 0.01 / 0.06 | 0.507 [0.468, 0.548] | .711 | .84 |
| reposts | 1 / 1 | 0.580 [0.532, 0.625] | .010 | .040 |
| age at detection s | 104.5 / 111.1 | 0.472 [0.422, 0.519] | .412 | .84 |
| venue (Hyperliquid = 1) | 0 / 0 | 0.537 [0.522, 0.551] | .003 | .020 |

NO-HOLES: ratio 0.402 (Holm .020), reposts 0.580 (Holm .066), venue 0.537 (Holm .050). COMPLETE: ratio 0.404 (Holm .020), reposts 0.574 (Holm .066), venue 0.534 (Holm .066).

Reading (lead, not proof): a higher ratio goes with fewer pulled outcomes (the effect size is small to moderate: a randomly chosen pulled wall has a lower ratio than a randomly chosen other wall about 59% of the time); more reposts and Hyperliquid walls go with more pulled outcomes, with reposts surviving correction in ALL but not in the other subsets. Peak size, distance and age do not separate. The ratio and venue results reproduce `test-wall.md` section E (AUC 0.399 and 0.545 on the v095 candidate set). Because the engine opens a card only for a ratio of 12 or more, the ratio finding is within an already filtered population. The intact item is now true at opening by construction (v096) and was not tested.

## Candidate variables
| Candidate (wall.md section 6) | Tested? | Note |
|---|---|---|
| Pull-before-touch rate by distance | Partly | first wall pass; here only the outcome split |
| Wall quality items at detection | Yes | W3 and W4 |
| Wall lifetime survival against a shifted-size null | No | stored trace is per wall, not per level |
| Book-summary churn near the wall | No | `ext` not joined |
| Cross-venue mirrored wall | No | |
| Hyperliquid per-level order count | No (cannot) | not stored |
| Distance-matched control for the move at arrival | No | would separate wall effect from price arriving at a level |

## Caveats
- Sessions are not independent (8 distinct days; 16 of the 52 are 31-minute auto-recordings). The cluster bootstrap and the 600 s shift null only partly address within-session structure; adjacent walls and repeated approaches in one move are dependent.
- Whole-session sigma is slightly non-causal as a yardstick; forward moves start at `tDetected`, which is when the card opened, not when price started toward the wall.
- The W2 shift null compares the move against random times, not against random moments at which price is arriving at a level; the prior-move check addresses momentum only.
- Binance walls dominate (93%); Hyperliquid results rest on 46 groups and a book that updates every 5 s.
- The hook was checked for identity on 2 of 52 sessions only.
- The per-subset tables show the headline cells; the full outputs are in the scratchpad.

## Reproduce
Scripts in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\55a22191-e94f-46cf-bca0-b2341b91768c\scratchpad\`:
- `wall2_collect.mjs <outdir> [--check]`: hooked replay, one cache file per session (about 10 min).
- `wall2_an.mjs <bcache> <wcache2> all|nohole|complete 1000`: W1 to W4 (outputs `wall2_all.txt`, `wall2_nohole.txt`, `wall2_complete.txt`). `bcache` is the per-session price history and sigma cache written by `burst_collect.mjs` (see `test-burst.md`).
- `wall2_pre.mjs <bcache> <wcache2> all 2000`: the prior-move check under W2.
