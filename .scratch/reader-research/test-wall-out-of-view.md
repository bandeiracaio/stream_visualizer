# Test pass: where a wall's level sat before its card opened (fourth wall pass, v096 engine)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed (hook identity checked on 3 sessions: identical groups). Everything below is a lead, not proof. Language is neutral: a wall's side is bid or ask.

This follows `test-wall-standing.md`, which found that most of a wall's 60 s age is unobserved and guessed the level was outside the visible book. This pass measures that directly.

Data: the 52 `session_BTC_*.json.gz` in the repo root, default thresholds, 664 wall groups (618 Binance, 46 Hyperliquid). Counts and medians only, no tests. Plan fixed before the full run (`wall4_plan.md` in the scratchpad).

## Method
A read-only hook on an in-memory copy of the engine classifies every tracked wall on every book update:
- seen: inside the `wallBps` window (30 bps) and at or above the ratio threshold (the only state in which the tracker updates the wall);
- deep: the level is beyond the last level of the book snapshot;
- below: the level is in the book but under the ratio threshold;
- outside: farther than `wallBps` (never occurred, the book is shallower than 30 bps).
The interval since the previous update is credited to the previous state. At opening the hook records time per state since first sight, the prior state, the length of the continuous seen run ending at the opening, and the distance from mid at first sight and at opening.

## R1. Time budget at opening (share of age, p10 / median / p90)
| | seen | deep | below |
|---|---|---|---|
| ALL (664) | 0.00 / 0.03 / 0.28 | 0.63 / 0.96 / 1.00 | 0.00 / 0.00 / 0.03 |
| Binance (618) | 0.00 / 0.02 / 0.23 | 0.70 / 0.97 / 1.00 | 0.00 / 0.00 / 0.02 |
| Hyperliquid (46) | 0.03 / 0.17 / 0.92 | 0.00 / 0.67 / 0.94 | 0.00 / 0.05 / 0.27 |

Age at opening: median 107 s (p10 62 s, p90 453 s). Seen share under 10%: 76% of groups (Binance 79%, Hyperliquid 37%); under 50%: 95%. Deep share of 50% or more: 93% (Binance 95%, Hyperliquid 63%).

## R2. Arrival
- Prior state at the opening tick: seen 443, deep 212, below 9. Binance: 417 / 196 / 5.
- Continuous seen run before opening (median 0.3 s; Hyperliquid 5.3 s): under 2 s in 80% (Binance 83%, Hyperliquid 43%), under 10 s in 93%.
- Distance from mid: at first sight median 0.46 bps, at opening 0.02 bps. First sighted farther than at opening: 70% (Binance 72%, Hyperliquid 48%).

## R3. Outcome by unseen share (counts)
| Group | n | pulled share | detection to end, median | within 1 s |
|---|---|---|---|---|
| ALL, seen over 50% of age | 32 | 47% | 21.7 s | 7% |
| ALL, seen 50% or less | 632 | 43% | 3.4 s | 26% |
| Binance, seen over 50% | 19 | 41% | 4.0 s | 12% |
| Binance, seen 50% or less | 599 | 42% | 3.1 s | 27% |
| Hyperliquid, seen over 50% | 13 | 54% | 36.2 s | 0% |
| Hyperliquid, seen 50% or less | 33 | 76% | 16.3 s | 0% |

Only 32 groups were seen for most of their age, so the comparison is thin.

## Reading (lead, not proof)
For Binance walls the 60 s rule (`wallEpisodeMs`, age counted from first sight) counts time when the level is not in the book snapshot at all. The median wall is out of the book for 97% of its age and is in view for about 2%. Most cards open on a tick where a level a few tenths of a bps beyond the book edge comes into view as price approaches (70% were first sighted farther from mid than at opening); the median continuous run in view before opening is 0.3 s. So the card means "a remembered level has just come into view with a large size", not "a large order has stood in view for a minute". This agrees with the prior-move and quick-ending findings in `test-wall-groups.md` and `test-wall-standing.md`. Hyperliquid differs (deeper book, 5 s updates): its walls are in view for a median 17% of age, and 43% open after a short run.

Not measured: whether the remembered size is still real when the level re-enters the book (the tracker uses the last size it saw); that needs the size at first re-sight against the size remembered. The `below` state is rare (0 to 5%), so the ratio threshold is not what hides walls.

## Candidate variables
| Candidate | Tested? | Note |
|---|---|---|
| Out-of-view time of a wall before it opens | Yes (this pass) | median 97% of age beyond the book (Binance) |
| Size at re-entry vs remembered size | No | hook can record size at first re-sight |
| Outcomes for walls first seen inside the book (born in view) vs remembered | Partly | only 32 groups were mostly in view |
| Age counted from the last time in view (design question for the 60 s rule) | No | would change detections; byte-compare and a feature step |

## Caveats
- Sessions are not independent (8 distinct days; 16 of 52 are 31-minute auto-recordings).
- Time is credited to the previous state, so a book gap (Binance depth cadence, Hyperliquid 5 s) is credited to that state.
- "Deep" means beyond the last level of the stored snapshot; its depth in bps was not logged per wall.
- Changing the 60 s rule is a design decision for a feature step (byte-compare and release), not a finding here.

## Reproduce
Scripts in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\8881805a-fcb3-464e-a1c0-21f8345290f7\scratchpad\`: `wall4_collect.mjs <outdir> [--check]` (hooked replay, about 15 min) and `wall4_an.mjs <outdir>` (output `wall4_all.txt`).
