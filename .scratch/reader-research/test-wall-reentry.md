# Test pass: wall size at re-entry into the book (fifth wall pass, v096 engine)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed (hook identity checked on 3 sessions: identical groups). Everything below is a lead, not proof. Language is neutral: a wall's side is bid or ask.

This follows `test-wall-out-of-view.md`, which found that a Binance wall is beyond the last book level for a median 97% of its 60 s age and that a card opens when a remembered level comes into view. It left one question open: is the remembered size still real when the level re-enters?

Data: the 52 `session_BTC_*.json.gz` in the repo root, default thresholds, 664 wall groups (618 Binance, 46 Hyperliquid). Counts and medians only, no tests. Plan fixed before the full run (`wall5_plan.md` in the scratchpad).

## Method
The wall4 hook (state per book pass: seen / deep / below) plus two records. (a) Each time a tracked wall is updated after being in a non-seen state: the size the tracker remembered (the last size it held), the peak so far, and the size now. (b) Each time the tracker resolves a wall: confirmed or not, the state on the pass before, size, peak, age. S2 and S3 use confirmed walls aged 60 s or more at resolve.

## S1. Opened wall groups: size at the last re-entry before opening (p10 / median / p90)
| | groups | now / remembered | now / peak | now under 0.9x remembered | over 1.1x |
|---|---|---|---|---|---|
| ALL | 664 (657 had a re-entry) | 0.80 / 1.47 / 39.9 | 0.63 / 1.33 / 39.9 | 14% | 57% |
| Binance | 618 (615) | 0.81 / 1.65 / 44.8 | 0.63 / 1.47 / 41.8 | 14% | 59% |
| Hyperliquid | 46 (42) | 0.76 / 1.00 / 1.67 | 0.63 / 0.93 / 1.36 | 17% | 26% |

- Re-entries before opening (ALL): none 7, one 355, two 146, three or more 156. Last re-entry came from "deep" in 622 groups and from "below" in 35.
- Size at opening over peak (ALL): 0.76 / 1.00 / 1.00.

## S2 and S3. Every confirmed wall aged 60 s or more when the tracker resolved it
| | resolved | opened as cards | state on the pass before: seen / deep / below | size at resolve / peak (p10 / median / p90) |
|---|---|---|---|---|
| ALL | 16447 | 664 | 3843 / 12212 / 392 | 0.00 / 0.00 / 0.12 |
| Binance | 16068 | 618 | 3747 / 12028 / 293 | 0.00 / 0.00 / 0.11 |
| Hyperliquid | 379 | 46 | 96 / 184 / 99 | 0.00 / 0.05 / 0.25 |

- Resolved on the first pass after an out-of-view stretch: 12604 (77%); resolved while in view: 3843 (23%). Binance 77% / 23%, Hyperliquid 75% / 25%.
- Size at resolve over peak: after an out-of-view stretch 0.00 / 0.00 / 0.11; in view 0.00 / 0.00 / 0.15.
- Level gone entirely (size 0) at resolve: after an out-of-view stretch 45% (Binance 46%, Hyperliquid 17%); in view 67% (Binance 68%, Hyperliquid 49%).

## Reading (lead, not proof)
- For the walls that did become cards, the size at re-entry was usually not smaller than remembered: the median is 1.5x (Binance 1.65x) and above the previous peak (median 1.3x). Only 14% were under 0.9x of the remembered size. This is a survivor view: a card can only open if the wall is seen at or above the ratio threshold and not fading, so walls that were thinner or gone at re-entry are absent from S1 by construction.
- S2 gives the other side. Of the confirmed walls that reached 60 s, about 16.4k were resolved against 664 that became cards (about 4%). Three quarters were resolved on the first pass after the level came back into the book, and most had lost nearly all of their peak: median size at resolve is 0, and 45% of those were gone entirely. So a large share of remembered walls no longer exist by the time the book reaches them; this is the same population in which the tracker could have said "wall" for a minute without ever seeing it.
- The two readings fit together: the 60 s rule lets through walls that were last seen long ago. The few that become cards are the ones still present (and larger) when price brings them into view, which also fits the prior-move and quick-ending findings.
- S2 counts tracker walls, not cards: adjacent levels of one resting region are separate tracker walls (cards merge them by `wallMergeBps`), and many are below `wallMinUsd` or over the per-side cap. The 16.4k to 664 ratio is therefore not a hit rate.

## Candidate variables
| Candidate | Tested? | Note |
|---|---|---|
| Size at re-entry vs remembered size | Yes (this pass) | median 1.5x for cards; 14% under 0.9x |
| Staleness of the remembered size (time since last seen) vs size at re-entry | No | the hook stores both; a dose-response split is cheap |
| Re-entry resolve rate among walls that would pass the card gates (ratio, `wallMinUsd`, region merge) | No | needs the gates applied to the S2 population |
| Age counted from the last time in view (design question for the 60 s rule) | No | would change detections; byte-compare and a feature step |

## Caveats
- Sessions are not independent (8 distinct days; 16 of 52 are 31-minute auto-recordings).
- "Remembered" is the last size the tracker held while the wall was seen or below; its age at re-entry (often minutes) was not split out here.
- A larger size now than remembered can also mean the median level used for the ratio changed with price; the ratio itself was not compared.
- Resolve is only evaluated when the level is inside the book snapshot, so S2 cannot contain walls that stayed beyond the book until the session ended.
- Changing the 60 s rule is a design decision for a feature step (byte-compare and release), not a finding here.

## Reproduce
Scripts in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\8881805a-fcb3-464e-a1c0-21f8345290f7\scratchpad\`: `wall5_collect.mjs <outdir> [--check]` (hooked replay, about 15 min) and `wall5_an.mjs <outdir>` (output `wall5_all.txt`).
