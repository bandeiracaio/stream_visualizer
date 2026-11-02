# Test pass: wall groups, arrival control and observed standing time (third wall pass, v096 engine)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed. Everything below is a lead, not proof. No keep-or-drop conclusion is drawn. Language is neutral: a wall's side is bid or ask; no bull / bear.

This follows `test-wall.md` (every tracked wall, v095) and `test-wall-groups.md` (the groups the Reader shows, v096). The second pass found that price moves toward and through the wall right after a card opens (-0.49 sigma at 10 s), that price had already moved toward the wall before the card opened, and that it could not separate "a wall" from "price arriving at a level". This pass adds a matched control for that, and checks how much of a wall's 60 s age was actually observed.

Data: the 52 `session_BTC_*.json.gz` in the repo root, 25.1 h of span, default thresholds. Quality verdicts: 38 complete, 7 holes, 7 without a verdict. Results are given for ALL (52), NO-HOLES (45) and COMPLETE (38). No `reader_labels*.json` exist, so everything is label-free.

Plan (fixed before running, saved as `wall3_plan.md` in the scratchpad): V1 observed standing time at opening; V2 forward move by observed standing; V3 arrival control from price data only. Not attempted: wall lifetime survival against a shifted-size null, book-summary churn, cross-venue mirrored walls, Hyperliquid per-level order count (not stored), and a control built from other book levels (needs per-level book reconstruction).

## V3. Arrival control (ALL; wall groups from `test-wall-groups.md`)
Method (script `wall3_ctl.mjs`, price histories only, no replay): for each wall group, controls are moments in the same venue on a 5 s grid, with a random direction, at least 120 s from any wall detection in the same session and venue, matched on the move in the wall's reaction direction (bid wall = up, ask wall = down) over the 10 s and over the 30 s before, each within 0.25 sigma; pooled over sessions, up to 20 controls per group. Paired difference wall group minus control mean, session-cluster bootstrap (2000), Holm over 4. Control pool: Binance 3956 moments, Hyperliquid 24632. 625 of 664 groups matched (39 had fewer than 5 controls); median 68 controls per matched group. Mean prior move of the matched wall groups: -0.875 sigma (10 s) and -0.924 sigma (30 s) in the reaction direction.

| H | n | wall groups [CI] | matched controls [CI] | difference [CI] | Holm |
|---|---|---|---|---|---|
| 10 s | 623 | -0.486 [-0.580, -0.394] | -0.043 [-0.067, -0.016] | **-0.443** [-0.553, -0.340] | .002 |
| 30 s | 614 | -0.315 [-0.409, -0.212] | -0.095 [-0.119, -0.071] | -0.220 [-0.320, -0.116] | .002 |
| 60 s | 606 | -0.268 [-0.367, -0.165] | -0.131 [-0.155, -0.105] | -0.137 [-0.241, -0.027] | .021 |
| 300 s | 514 | -0.067 [-0.162, +0.022] | -0.203 [-0.238, -0.164] | +0.136 [+0.034, +0.237] | .021 |

NO-HOLES (547 matched) and COMPLETE (512 matched): 10 s difference -0.426 and -0.404, 30 s -0.207 and -0.201 (Holm .002 to .005); 60 s -0.085 and -0.085 (Holm .141 and .154); 300 s +0.177 and +0.185 (Holm .005 and .002). By venue (ALL): Binance 10 s -0.435, Hyperliquid -0.550 (n 46); bid wall -0.497, ask wall -0.387; 300 s difference +0.227 for bid walls and +0.042 for ask walls.

Reading (lead, not proof): random moments with the same preceding move barely continue (-0.04 sigma at 10 s), so the move through the wall at detection is not explained by momentum alone; this narrows the reading in `test-wall-groups.md`. The controls reverse by about -0.20 sigma over 300 s after such a move while wall groups do not, which is where the positive 300 s difference comes from. The control carries no information about a wall or a level close to price, so it does not show that the wall itself causes the move: price arriving at the best level, or the removal of size at the touch moving the book, are not excluded.

## V1. Observed standing time at opening (ALL 664 wall groups)
Method (script `wall3_collect.mjs`, read-only hooks in an in-memory copy of `reader-engine.js` and `reader-episodes.js`; the hooked engine gave byte-identical groups to the plain engine on 3 sessions, not all 52): for every wall the hook sums the time between consecutive updates in which the level was visible and above the ratio threshold, ignoring gaps over 2 s; it also records the gap before the opening tick and the number of `wallUpdate` calls so far.

| | p10 | median | p90 |
|---|---|---|---|
| age since first sight (the 60 s rule counts this) | 62 s | 107 s | 453 s |
| observed standing | 0 s | 2 s | 20 s |
| observed share of age | 0.00 | 0.02 | 0.23 |

- Observed standing under 10 s: 526 groups (79%); under 30 s: 624 (94%); under 50 s: 647 (97%); only 17 groups have 50 s or more.
- The opening was the wall's first update after confirmation for 244 groups (37%); a gap over 2 s before the opening tick for 232 (35%), over 30 s for 179.
- NO-HOLES and COMPLETE: the same (median 2 s; under 30 s for 96% and 96%; first-update share 38%; gap over 2 s 36%).
- Outcomes (ALL): groups with under 30 s observed (n 624): pulled 274, eaten 200, left 81, faded 66; detection to end median 3.4 s, 26% within 1 s; pulled share 44%; median ratio 812; median distance 0.03 bps; Hyperliquid 7%. Groups with 50 s or more (n 17): pulled 5, eaten 6, left 3, faded 2.

Reading (lead, not proof): the 60 s rule (`wallEpisodeMs`, age counted from first sight) does not mean the wall stood in view for a minute: for most groups the wall was observed for a few seconds in total. The tracker keeps a wall alive while its level is outside the visible book (about 0.4 to 1.2 bps on Binance) or below the ratio threshold, without updating it, so most of the age is unobserved. I did not measure out-of-view time directly; the figures are consistent with a card opening when price brings a remembered level back into view, which also fits the prior-move finding in `test-wall-groups.md` and the quick endings at the touch. Observed standing is understated for Hyperliquid walls (7% of groups), whose book updates every 5 s, so every gap exceeds 2 s.

## V2. Forward move by observed standing
Groups with under 30 s observed (A) against 50 s or more (B), reaction direction, diff = B minus A, label permutation within session, Holm over 4. Only 17 groups are in B (9 in NO-HOLES and COMPLETE), so the comparison is not informative.

| H | A (n) | B (n) | diff [CI] | Holm |
|---|---|---|---|---|
| 10 s | -0.495 (622) | -0.737 (17) | -0.243 [-1.124, +0.294] | 1.00 |
| 30 s | -0.308 (613) | -0.629 (17) | -0.322 [-1.068, +0.331] | 1.00 |
| 60 s | -0.279 (606) | -0.167 (15) | +0.113 [-0.658, +0.877] | 1.00 |
| 300 s | -0.087 (516) | -0.101 (13) | -0.014 [-0.823, +1.385] | 1.00 |

NO-HOLES and COMPLETE, 10 s: -0.128 and -0.136 (intervals about +-1). Nothing can be said about whether walls that were observed for a full minute behave differently.

## Candidate variables
| Candidate | Tested? | Note |
|---|---|---|
| Distance-matched control for the move at arrival | Partly | V3 matches on the prior move only, not on a level near price |
| Out-of-view time of a wall before it opens | Partly | V1 measures observed standing; the position of the level (inside or outside the visible book) was not logged |
| Control built from other book levels at the touch | No | needs per-level book reconstruction |
| Wall lifetime survival against a shifted-size null | No | |
| Book-summary churn, cross-venue mirrored wall | No | |
| Hyperliquid per-level order count | No (cannot) | not stored |

## Caveats
- Sessions are not independent (8 distinct days; 16 of the 52 are 31-minute auto-recordings). The cluster bootstrap only partly addresses within-session structure; the control pool is drawn from the same sessions.
- Whole-session sigma is slightly non-causal as a yardstick; forward moves start at `tDetected`, when the card opened.
- The matched control uses only price history; matching tolerance 0.25 sigma on two windows; 39 groups unmatched.
- Observed standing is a lower bound for Hyperliquid walls (5 s book updates); Binance walls are 93% of groups.
- The standing-time hook was checked for identity on 3 of 52 sessions only.
- The 60 s rule is described here as measured; changing it is a design decision for a feature step (byte-compare and release), not a finding of this pass.

## Reproduce
Scripts in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\55a22191-e94f-46cf-bca0-b2341b91768c\scratchpad\`:
- `wall3_ctl.mjs <bcache> <wcache2> all|nohole|complete 2000`: V3 (outputs `wall3ctl_all.txt`, `wall3ctl_nohole.txt`, `wall3ctl_complete.txt`). `wcache2` is the wall group cache written by `wall2_collect.mjs` (see `test-wall-groups.md`); `bcache` is the per-session price history and sigma cache written by `burst_collect.mjs` (see `test-burst.md`).
- `wall3_collect.mjs <outdir> [--check]`: hooked replay with the standing-time bookkeeping (about 10 to 15 min).
- `wall3_an.mjs <bcache> <w3cache> all|nohole|complete 2000`: V1 and V2 (outputs `wall3_all.txt`, `wall3_nohole.txt`, `wall3_complete.txt`).
