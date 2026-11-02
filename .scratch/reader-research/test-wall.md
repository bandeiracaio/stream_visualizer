# Test pass: wall (hypothesis 4)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed; no commit. Everything below is a lead, not proof. No keep-or-drop conclusion is drawn. Language is neutral: a wall's side is bid or ask; no bull / bear.

Data: the 52 `session_BTC_*.json.gz` in the repo root, 25.1 h of span. Quality verdicts: 38 complete, 7 holes, 7 without a verdict. Each result is given for ALL (52 sessions, 25.1 h), NO-HOLES (45, 21.8 h) and COMPLETE (38, 18.9 h). Where a table shows only ALL, the other two differ by about one percentage point or less (stated per section; the full per-subset output files are listed under Reproduce). No `reader_labels*.json` exist, so everything is label-free.

Read before this pass: `index.md` (hypothesis 4), `wall.md`, `test-exhaustion-absorption.md` (method, hook technique), `CLAUDE.md`, `CONTEXT.md`, `trackWalls` / `resolveWall` / `tradedThrough` / `noteVanished` in `reader-engine.js`, and `wallItems` / `wallUpdate` / `wallOpen` in `reader-episodes.js`.

## A. Facts about the data that change how the test must be read

1. **The visible book is very narrow.** Binance: 30 levels, bid side spans 0.37 / 0.61 / 1.16 bps (min / median / max over the sessions); pushes every 306 ms (all 52 sessions). Hyperliquid: 20 levels, spans 2.3 / 2.4 / 3.9 bps; **pushes every 5.4 s** (median gap 5374-5393 ms in every session). The engine's `wallBps` = 30 never binds. So "distance from mid" is 0-1 bps on Binance and 0-3 bps on Hyperliquid; the brief's "250 ms book" is true of Binance only (306 ms), and Hyperliquid walls are seen only at 5 s snapshots (a wall that comes and goes between two pushes is invisible; `tradedFrac` uses a 1.5 s window, shorter than one Hyperliquid push).
2. **The tracker keeps a wall alive while it is out of view.** `trackWalls` skips a wall whose price lies beyond the farthest visible level (`continue`), so it is neither updated nor resolved until the level is visible again. A wall that disappears while out of view is first seen "gone" when price brings the level back into view: that looks like "pulled as price approached" but is an observation effect. I flag these ("gap": resolution tick more than 2 s after the last observation) and report results with and without them. For Hyperliquid, with 5.4 s pushes, almost every resolution has a gap by this rule, so the gap flag is not informative there.
3. **Almost everything the tracker calls a wall is small and short-lived.** 987,093 walls tracked in 25.1 h (in at least one session a median level of about 0.003 BTC makes 8x the median a few hundred dollars); 633,127 (64%) are gone before the 2 s confirmation; 163,466 (16.6%) are confirmed. The dollar floor (`wallMinUsd`, $100k) and `wallMinMult` apply only when opening an episode.
4. **Hooked engine equals plain engine.** The hooks (read-only, injected into an in-memory copy of `reader-engine.js` at the three wall sites) produce byte-identical `episodeGroups()` to the unmodified engine in 52 of 52 sessions (`wcollect.mjs --check`).

## B. Task 1: wall outcome census

Rule used (the engine's own, `resolveWall`): a wall resolves when its size falls to 30% of its peak; `frac` = size traded through the level in the last 1.5 s / size lost. Confirmed walls (>= 2 s): eaten if frac >= .6, pulled if < .2, else faded. Not-yet-confirmed walls that vanish: counted separately (they only feed `spoof_like`). "Unresolved" = never resolved (left the visible range, soft reset, or end of session).

### B1. All tracked walls, ALL sessions (n = 987,093)

| venue | n | eaten | pulled | faded | gone < 2 s (pulled-like / other) | unresolved |
|---|---|---|---|---|---|---|
| Binance | 973,413 | 3.9% | 11.4% | 0.7% | 55.9% / 25.4% | 2.6% |
| Hyperliquid | 13,680 | 0.3% | 11.5% | 0.2% | 72.0% / 9.1% | 6.9% |

### B2. Confirmed walls (n = 163,466; 161,740 Binance, 1,726 Hyperliquid), ALL

| venue | eaten | pulled | faded | unresolved |
|---|---|---|---|---|
| Binance | 23.7% | 68.7% | 4.3% | 3.2% |
| Hyperliquid | 2.2% | 90.8% | 1.8% | 5.2% |

By peak size (USD):

| peak USD | n | eaten | pulled | faded |
|---|---|---|---|---|
| < 10k | 42,825 | 38.6% | 56.6% | 1.3% |
| 10-30k | 29,552 | 26.0% | 67.6% | 2.8% |
| 30-100k | 39,412 | 17.9% | 75.0% | 3.6% |
| 100-300k | 26,359 | 15.9% | 74.7% | 6.4% |
| >= 300k | 25,318 | 11.8% | 76.0% | 9.8% |

By ratio at peak (size over median level):

| ratio | n | eaten | pulled | faded |
|---|---|---|---|---|
| < 12 | 6,206 | 35.9% | 59.7% | 0.9% |
| 12-20 | 14,534 | 31.0% | 64.0% | 1.2% |
| 20-50 | 34,584 | 29.3% | 65.5% | 1.5% |
| 50-200 | 44,698 | 22.7% | 71.0% | 2.9% |
| >= 200 | 63,444 | 18.0% | 71.5% | 7.8% |

By age (first seen to resolution or last seen):

| age s | n | eaten | pulled | faded |
|---|---|---|---|---|
| < 10 | 104,000 | 22.0% | 70.1% | 4.4% |
| 10-60 | 42,740 | 25.8% | 66.4% | 4.4% |
| 60-300 | 12,501 | 25.8% | 69.3% | 3.5% |
| 300-1800 | 3,918 | 30.0% | 65.7% | 2.8% |
| >= 1800 | 307 (5 sessions) | 44.3% | 51.1% | 3.9% |

By distance from mid when first seen (bps; Binance and Hyperliquid pooled, so the last bucket is almost all Hyperliquid):

| dist bps | n | eaten | pulled | faded |
|---|---|---|---|---|
| < 0.1 | 38,876 | 20.1% | 70.5% | 6.8% |
| 0.1-0.25 | 23,833 | 25.0% | 68.9% | 2.7% |
| 0.25-0.5 | 54,832 | 21.9% | 71.0% | 3.2% |
| 0.5-1 | 43,834 | 28.1% | 64.6% | 4.3% |
| 1-2 | 1,136 | 25.0% | 67.0% | 5.2% |
| >= 2 | 955 | 1.7% | 91.6% | 1.2% |

Pulled share of resolved confirmed walls, session-cluster bootstrap 95% interval: all 71.3% [68.0, 74.2] (112,723 / 158,141); Binance 71.0% [67.8, 73.9]; Hyperliquid 95.8% [94.2, 97.1]; peak >= $100k 77.5% [75.1, 79.8]; peak >= $100k and ratio >= 12 77.2% [74.8, 79.6]. NO-HOLES 71.0% [67.3, 74.1]; COMPLETE 71.3% [67.6, 74.5].

### B3. How much of "pulled" is an artefact of the label (new, ALL)
- Found gone after an unobserved gap > 2 s: 19.0% of the engine-pulled walls (18.1% of all resolved).
- Using the traded-through volume in the last 10 s instead of 1.5 s: only 0.8% of engine-pulled walls would be "eaten" (>= 60%) and 2.8% would reach 20%. Over the wall's whole life: 1.2% >= 60%, 3.6% >= 20%. So the short window is **not** what makes walls look pulled; 96.4% of "pulled" walls had under 20% of the lost size traded through at any time in their life (68.7% of all resolved walls).
- Pulled and seen vanishing without a gap: 55.6% of all resolved walls.

### B4. Hazard by current distance (confirmed walls, observed time only, ALL)
Resolutions per 1000 s of observed exposure, by current distance of mid from the wall:

| Binance dist bps | exposure s | pulled | pulled per 1000 s [cluster CI] | share pulled of resolved |
|---|---|---|---|---|
| < 0.1 | 232,014 | 21,417 | 92 [86, 100] | 55.9% |
| 0.1-0.25 | 135,671 | 15,455 | 114 [109, 120] | 68.6% |
| 0.25-0.5 | 282,739 | 40,836 | 144 [136, 153] | 77.9% |
| 0.5-1 | 143,436 | 33,161 | 231 [217, 246] | 77.4% |

Hyperliquid pulled per 1000 s: 429 [365, 503] below 0.1 bps, 404 [349, 473] at 2 bps and more; share pulled 93-98%. The farther the wall is from mid, the higher the pull rate (about 2.5x from < 0.1 to 0.5-1 bps on Binance): walls nearest to price are pulled least per unit time. Opposite to a simple "walls are pulled as price comes near".

### B5. Wall episode groups the Reader shows (default cfg)
| subset | groups | per hour | per session min / median / max | sessions with none |
|---|---|---|---|---|
| ALL | 824 | **32.9** | 0 / 14.5 / 40 | 1 |
| NO-HOLES | 715 | 32.8 | 0 / 14 / 40 | 1 |
| COMPLETE | 679 | 35.9 | 2 / 17.5 / 40 | 0 |

Outcome of the 824 groups (ALL): pulled 470 (57.0%), eaten 184 (22.3%), faded 83 (10.1%), left 79 (9.6%), still open at the end 7, gap 1. By venue: Binance 764 (eaten 23.6%, pulled 56.3%, faded 10.6%), Hyperliquid 60 (6.7%, 66.7%, 3.3%). By ratio at close: < 12 n 19, 12-20 n 75 (84% pulled), 20-50 n 106 (86% pulled), 50-200 n 181 (72%), >= 200 n 443 (39% pulled, 34% eaten). By peak USD: < 300k n 301, 300k-1M n 377, 1M-3M n 120, >= 3M n 26.

**Timing of the groups (new finding).** For the 817 ended wall groups, median time from detection to end is 1.8 s; **44.9% end within 1 s of being detected, 67.1% within 5 s, 98.5% within 60 s**; median age at detection (`tDetected - tStart`) is 96 s. Of the groups that ended within 1 s of detection, 271 were pulled, 71 eaten, 25 faded. NO-HOLES 44.8% / 68.1%; COMPLETE 45.1% / 68.6%. In the engine `wallUpdate` runs inside the first loop of `trackWalls` with the current size (still above 8x median even after a collapse) before `resolveWall` closes it in the second loop of the same tick, and the opening test uses the current ratio, so a wall can open and close in one tick. I did not trace each case to the code path; the cause of the large share is **not established** here (a candidate: the per-side cap `wallMaxActive` delaying opening until neighbours close). It means for roughly 4 of 9 wall cards the Reader first shows the wall when it is already ending.

## C. Task 2: approach analysis

### Method
- Tracked walls: confirmed (>= 2 s) walls; set `all` = every confirmed wall, set `big` = peak >= $100k and ratio >= 12 (episode-sized, before the 60 s age and merge rules). Distances use the 1 s trade-price path; X in {0.5, 1, 2} bps (Binance's whole visible window is 0.4-1.2 bps, so X = 2 is "any visible wall" on Binance).
- Approach event, mode `out`: first time price moves from farther than X to within X while the wall is tracked. Mode `in`: wall first seen already within X (counted from 2 s after birth). From the approach, a 120 s window. Touch = a trade at or through the level (1 s grid of min / max trade price per venue).
- Classes: **P** pulled before touch (wall resolved inside the window with no trade at the level); **Q** = P minus walls found gone after an observation gap (seen vanishing); **C** touched then eaten (engine frac >= .6); **T** touched then gone, not eaten; **H** touched and still there at the end of the window; **R** no touch, still there; **X** tracking ended (excluded from shares).
- Null (the "what looks pulled by chance" question): same walls with their own size and lifetime traces (so the 250 ms / 306 ms sampling and the flicker of levels are fully present), but price and trades circularly shifted by a random shift of at least 600 s (K = 400 shifts, drawn per session, pooled over sessions per iteration). A shuffled-size null on the book is not possible (levels are not stored per wall except through the size trace), and shuffling sizes would destroy the persistence that defines a wall; this shift null keeps everything except the alignment between the wall's life and the price path. p < 0.002 means no null iteration was as extreme (1/401).
- Intervals: session-cluster bootstrap. Multiple comparisons: Holm over the 12 both-venue P tests: p 0.030 for all except one (0.185).

### Results (ALL; both venues; share of approached walls that are P or Q)

| set | mode | X bps | events | P real [CI] | P null mean [2.5, 97.5] | Q real [CI] | Q null |
|---|---|---|---|---|---|---|---|
| all | out | 0.5 | 50,244 | 28.8% [25.8, 31.9] | 13.6% [13.0, 14.1] | 18.4% [17.0, 19.6] | 10.5% [10.0, 10.9] |
| all | out | 1 | 49,844 | 41.4% [37.9, 45.2] | 23.0% [22.0, 23.9] | 23.2% [22.2, 24.2] | 16.4% [15.7, 17.1] |
| all | out | 2 | 37,421 | 42.0% [39.0, 45.3] | 33.6% [32.1, 35.1] | 21.8% [20.7, 23.0] | 21.7% [20.8, 22.7] (p .87) |
| big | out | 0.5 | 15,577 | 23.9% [21.5, 26.4] | 13.2% [12.4, 14.0] | 16.6% [15.5, 17.8] | 10.8% |
| big | out | 1 | 15,851 | 40.6% [37.6, 43.9] | 22.7% [21.2, 23.9] | 27.5% [26.4, 28.7] | 17.6% |
| big | out | 2 | 12,345 | 44.6% [41.9, 47.6] | 33.7% [31.8, 35.7] | 29.0% [27.5, 30.3] | 24.0% |
| all | in | 0.5 / 1 / 2 | 109k / 147k / 156k | 50.5 / 49.2 / 48.3% | 45.8 / 48.0 / 48.6% (p .185 at 2) | 43.4 / 41.8 / 40.9% | 41.5 / 42.9 / 43.4% |
| big | in | 0.5 / 1 / 2 | 37k / 46k / 49k | 33.7 / 34.0 / 33.6% | 35.0 / 38.1 / 39.3% | 29.2 / 29.4 / 29.0% | 32.3 / 35.0 / 36.1% |

Remaining classes (all, out, X = 1): C 14,937, T 11,979, H 116, R 2,156, X 761.

NO-HOLES and COMPLETE reproduce the same picture (all, out, X = 1: P 40.9% vs null 22.5% in both; Q 23.0% vs 16.2%; X = 2 Q 21.8% vs 21.7%, p .76 / .58). Hyperliquid alone (ALL): out, X = 1: P 36.3% [29.0, 43.6] on 589 events, X = 2: 57.4%; its Q is about 1-3% only because of the 5.4 s push interval (see A.2). Per-venue counts are in the output file.

### Reading (lead, not proof)
- When price comes to within 0.5-1 bps of a wall from farther away, a pulled-before-touch outcome is about 1.8x as common as the same classification gives when the price path is shifted (P 28.8% vs 13.6% at 0.5 bps; 41.4% vs 23.0% at 1 bps). Part of that is the observation effect: restricting to walls seen vanishing, the excess shrinks (Q 18.4% vs 10.5%, 23.2% vs 16.4%) and is gone at X = 2 bps (21.8% vs 21.7%). So there remains an excess of walls seen being removed as price approaches within about 1 bps, roughly +6 to +8 percentage points, and none visible at 2 bps; the P / Q gap (about 10 to 18 points) is the "found gone on return" effect.
- For walls that were already within X when first seen (`in`), the pulled share is not above the null (it is at or below it, e.g. big, X = 1: 34.0% vs 38.1%). The hazard table agrees: nearer walls are pulled less per unit time.
- The "chance" level of a pulled-looking outcome is large. With a 306 ms Binance book and levels that flicker, 10-17% (Q) to 13-34% (P) of approached walls look pulled when the approach is unrelated to the wall.
- The sets are heavily overlapping (adjacent levels, one price excursion touches many walls), so the events are far fewer in independent terms than the counts; the cluster intervals use sessions only and do not remove that dependence within session.

## D. Task 3: forward move after the wall event

Sigma = per-session robust 15 s sigma (`sigmaOf` of `reader-scoreboard.mjs`), the same yardstick as before. Signed in the wall's expected-reaction direction: bid wall = up, ask wall = down. The move "in the direction the wall would have blocked" is the negative of the column (toward the wall). Events deduped to one per venue, side and class per 30 s. Null: the price path shifted by at least 600 s against the same anchors and the same classification (K = 400). Typical |move| at random moments (every 10 s, mean over both venues): 10 s 0.72, 30 s 0.84, 60 s 0.87, 300 s 0.89 sigma. Holm over 20 tests per table.

Anchors: P / Q at the time the wall was seen gone; C at the time it was seen gone after being eaten; **A (new, no look-ahead)** at the first trade through the level, for every wall that gets touched, whatever happens next; H at the first touch but selected on still standing 120 s later.

**H is shown only to demonstrate a bias**: requiring the wall to survive means price cannot trade through it, so a reflected move is forced by the selection (H: +1.1 sigma at 10 s, 96% of events on the reaction side at 30-60 s). It must not be read as reflection. A is the fair version.

Set all, mode out, X = 1 bps, ALL (mean sigma [cluster CI]; null mean):

| class | n (sessions) | 10 s | 30 s | 60 s | 300 s |
|---|---|---|---|---|---|
| P | 3,449 (51) | -0.220 [-0.273, -0.170]; null +0.018 | -0.119 [-0.153, -0.087]; +0.020 | -0.096 [-0.131, -0.059]; +0.013 | -0.055 [-0.085, -0.025]; +0.006 |
| Q (seen vanishing) | 2,980 (51) | -0.196 [-0.243, -0.155]; +0.020 | -0.101 [-0.134, -0.073]; +0.023 | -0.076 [-0.108, -0.046]; +0.013 | -0.041 [-0.074, -0.008]; +0.002 (p .07) |
| C (eaten) | 2,485 (51) | -0.373 [-0.447, -0.302]; -0.043 | -0.211 [-0.249, -0.170]; -0.023 | -0.148 [-0.183, -0.115]; -0.017 | -0.063 [-0.097, -0.030]; -0.001 (Holm .105) |
| A (any touch) | 3,282 (51) | -0.411 [-0.497, -0.333]; **null -0.380** (p .117) | -0.245 [-0.291, -0.203]; -0.218 (p .060) | -0.174 [-0.210, -0.141]; -0.165 (p .48) | -0.071 [-0.107, -0.040]; -0.062 (p .55) |

Shift-null p for P, Q (10-60 s), C (10-60 s) are all 0.002 (Holm 0.050); A has no cell below Holm 0.35.

Reading (lead, not proof):
- **Reflection is not seen in aggregate.** For walls that get touched (A), the move in the reaction direction is -0.41 sigma at 10 s, but the same classification on a shifted price path gives -0.38: it is what the arrival of price at a level looks like (price was moving toward it, and a trade through the level means it kept going briefly). The difference is 0.03 sigma, p .12. At 30-300 s it is 0.03 or less. In other words, once the selection on future survival is removed, a wall being touched does not carry a measurably different outcome from a random level being touched at that distance.
- After a wall is seen removed (P / Q) while price is within 1 bps, price moves on average **toward where the wall was** (against its reaction direction): -0.20 sigma at 10 s, about 25-30% of a typical |move|, decaying to -0.04 / -0.06 at 300 s (null about 0). Share of events on the reaction side 33-35% at 10 s. Prior-move control (`w_pre.mjs`, undeduped events): in the 10 s before the wall was seen gone, price had already moved -0.6 sigma toward the wall (Q), and the generic forward-on-prior slope at random moments (b = 0.06 at 10 s) explains only about -0.04 of the -0.15 forward drift; residual -0.11 sigma at 10 s, -0.06 at 30 s, -0.05 at 60 s. So the drift is not only momentum, but the direction is the same as the approach.
- After a wall is eaten (C): -0.37 sigma at 10 s (null -0.04), continuing in the direction it failed to block, to about -0.06 at 300 s.
- Other cells (`in` mode, X = 0.5 / 2, big, NO-HOLES, COMPLETE) show the same signs and similar sizes; mode `in` is weaker (P about -0.06 at 10 s vs null +0.05). NO-HOLES / COMPLETE: Q at 10 s -0.190 [-0.238, -0.144] / -0.189 [-0.238, -0.140]; A -0.384 vs null -0.358 (p .19) / -0.380 vs -0.358 (p .28).

## E. Task 4: reliability of the wall quality items (detection time, no look-ahead)

Candidates: for each confirmed wall, the first trace point at least 60 s after birth and before its resolution tick, with ratio >= 12 and running peak >= $100k, i.e. what `wallUpdate` would see when it opens an episode (without the per-side cap and the merge rules). 1,486 candidates in 51 sessions (ALL; 1,302 NO-HOLES; 1,218 COMPLETE). A first version of this table used the point where the wall had already collapsed (look-ahead: "intact" median .13 for pulled walls); that is fixed here (the first eligible point must precede the resolution tick; 33 and 17 such cases are dropped in two example sessions, the count per session is in the output).

Outcomes after detection (ALL): eaten 540 (36.3%), pulled 712 (47.9%), faded 162 (10.9%), none 72 (4.8%).

Item pass rates at detection: size item (>= 8x median) 100% and held item (>= 2 s) 100% **by construction** (the episode only opens after 60 s and at ratio >= 12): they cannot separate anything. Intact (>= 60% of peak) 83.4%; repost (>= 2) 22.7%.

Outcome pulled (engine rule) vs not pulled (712 positives; 51 sessions). AUC > .5: higher feature goes with pulled. Cluster CI; permutation p (outcome shuffled within session, 300 shuffles); Holm over 7 features:

| feature | median pulled / not | AUC [cluster CI] | perm p | Holm |
|---|---|---|---|---|
| log10 ratio | 2.75 / 2.88 | 0.399 [0.361, 0.434] | .003 | .023 |
| log10 peak USD | 5.31 / 5.39 | 0.458 [0.430, 0.494] | .010 | .040 |
| size vs own peak (intact) | 1.00 / 1.00 | 0.521 [0.494, 0.545] | .186 | .186 |
| reposts so far | 1 / 1 | 0.547 [0.522, 0.573] | .023 | .070 |
| distance bps | 0.28 / 0.25 | 0.529 [0.498, 0.562] | .053 | .106 |
| age at detection s | 123 / 138 | 0.458 [0.428, 0.489] | .007 | .033 |
| venue (HL = 1) | 0 / 0 | 0.545 [0.533, 0.559] | .003 | .023 |

NO-HOLES: ratio 0.386, peak USD 0.457, age 0.445, venue 0.549 (Holm .023-.027), intact .519, reposts .544, distance .534 (not significant). COMPLETE: ratio 0.387, age 0.445, venue 0.548 (Holm .023-.033), peak USD 0.460 (Holm .066), others not significant.

Outcome gone within 300 s of detection vs still standing 300 s later (positives 1,389 of 1,415): no feature has Holm < 0.67 in ALL (AUC 0.41-0.57 with intervals of about +-0.1); `intact` 0.567 [0.443, 0.697]; none survives correction. NO-HOLES and COMPLETE the same.

Reading (lead, not proof): the strongest separation is a **higher ratio and a bigger dollar size going with fewer pulled outcomes** (AUC 0.40 and 0.46, i.e. 0.60 and 0.54 in the reverse direction), small to moderate; the distance and repost items do not separate (intervals include .5 after correction); the size and held items cannot, by construction. The "pulled share rises with size" seen in the census (B2, which sorts by peak and ratio over the whole life) is the opposite of this and comes from the confirmed population, where the biggest levels also flicker most; the two tables are not the same population (the candidates have stood 60 s with ratio >= 12). Sixty-second survival at ratio >= 12 and $100k is itself a strong filter: the candidates are 1,486 of 163,466 confirmed walls (0.9%).

## F. Task 5: Hyperliquid per-level order count `n` and followed wallets

- `n` is not stored (confirmed in the previous pass: `app.js:564` maps each level to `[px, sz]`, `reader-engine.js` `clean` / `onBook` keep two numbers; recorded books hold pairs). What it would add: (1) one order versus many at a level (a level of 20 orders of 1.0 is not one wall); (2) a pulled wall that was one order is a cancel by one participant, and a drop in `n` with a smaller drop in size is a few of many cancelling; (3) refills (n rises, size returns) separate repost from an iceberg-like slice. It would not fix the 5.4 s push interval, which is the larger limit on Hyperliquid walls here.
- Followed wallets: the wallet layer (v059) holds positions and liquidation fills of the 10 biggest traders, not resting orders (`wall.md`: "resting orders are not in the trade feed"). The question "is the resting side one wallet" cannot be answered from these files, and with 10 wallets it cannot cover most walls; not tested.

## G. Task 6: candidates from wall.md section 6 and 5

| Candidate | Tested? | Note |
|---|---|---|
| Pull-before-touch rate and distance at pull, from levels and trades | Yes | C and B4. Rate by distance bucket (hazard) and share by approach threshold with a shift null |
| Approach test by distance bucket vs null (wall.md 5.2) | Yes | C, with the observation-gap split |
| Price test: signed move after held vs pulled vs consumed (wall.md 5.3) | Yes | D; "held" cannot be tested without look-ahead (H is biased), so A (any touch) is the fair version |
| Wall lifetime survival vs a circular-shift null of per-level sizes (wall.md 5.1) | No | the stored trace is per tracked wall, not per level, so a per-level size shift was not built; the age table (B2) and hazard (B4) give raw survival only |
| `tradedFrac` distribution vs a replay at shuffled depth (wall.md 5.4) | Partly | replaced by the shifted-price null, and by checking the 1.5 s window against 10 s and whole-life windows (B3) |
| Hyperliquid `n` | No (cannot) | not stored (F) |
| Followed-wallet resting activity / wall creation by a followed wallet | No | the data holds fills and positions, not resting orders (F) |
| Book summaries (added / removed size at 1 / 5 / 10 / 20 bps edges) to measure churn near the wall | No | the summaries are in `ext` (from v057), not joined here; also at 20 bps they are far wider than the visible book (0.4-3 bps), so they cannot see the wall's own levels |
| Cross-venue same-price wall (mirrored on the other venue) | No | needs a price alignment between a USD-quoted perp and a differently quoted venue plus the other venue's book; not attempted |
| Order-id identity, queue position, levels beyond 30 / 20 | No (NEEDS NEW DATA) | |
| Multi-wall clustering (many walls at once) | Not asked | note: one price excursion touches many adjacent walls, so events are heavily dependent |

## Caveats
- Dependence: adjacent levels, repeated approaches, overlapping windows; sessions are not independent (8 days, 16 of the 52 are 31-minute auto-recordings). The cluster bootstrap and the 600 s shift null only partly address within-session regime structure. Counts of events are far larger than the number of independent episodes.
- The tracker's walls are mostly tiny and short-lived (A.3); the population of the census is not the population of walls a person would call walls. The `big` set and the candidate set approximate the episode-sized ones.
- A level can sit out of the visible range, unobserved, and be resolved only on return (A.2); the Hyperliquid book arrives every 5.4 s (A.1), so Hyperliquid walls are seen only at snapshots, its gap flag is uninformative and its pulled share (91-96%) cannot be separated from the possibility that a level came and went between pushes. Hyperliquid carries 1% of confirmed walls here.
- Touch uses a 1 s grid of min / max trade price (so the first trade through the level is at most 1 s late); distances use trade prices, not the book mid (half-spread about 0.05-0.1 bps on Binance, which is comparable with the 0.5 bps threshold).
- Forward moves use a whole-session sigma (slightly non-causal as a yardstick); `tDetected`-style anchors are the time the wall was seen gone, which is after the removal itself (up to one book push, 0.3 s on Binance, 5.4 s on Hyperliquid).
- The null shifts the price path against the walls' size traces, so it controls for the flicker rate of the book but not for any dependence of both on a common regime inside a session.
- The shift-null and permutation p-values have a floor of 1/401 (shift null, K = 400) and 1/301 (feature permutations, 300); p "< 0.002" means no null draw reached the real value.
- The first candidate table looked at a collapsed state (look-ahead) and was corrected before the numbers above (noted in E); the H class has a built-in look-ahead and is labelled.

## Reproduce
All scripts are in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\b7c74217-84dd-44c3-a6ab-49a46a09a8c6\scratchpad\` (run with `node <script>` from there; they import the repo's `analyze-collectors.mjs` and `reader-scoreboard.mjs` read-only and inject hooks into in-memory copies of `src/js/reader-*.js`; nothing on disk in the repo is changed).
1. `node wcollect.mjs --check` : hooked replay of the 52 sessions at default cfg; writes `wcache/<session>.json` (all tracked walls with a 0.5 s size / mid trace, resolutions, wall groups, trades) and prints `identical=true/false` against the plain engine (log `wcollect_log.txt`: 52 of 52 identical). About 12 min.
2. `node w_main.mjs 400` : census rows, approach classification (real and K = 400 shifted-null iterations), forward moves, hazard exposure, candidates; writes `wrows/<session>.json` (about 12 min).
3. `node w_cand.mjs` : recomputes the detection-time candidates without look-ahead (patches `wrows`).
4. `node w_report.mjs <all|nohole|complete> census hazard approach forward rel` : prints the tables (saved as `wrep_<subset>.txt`, `wrepA_<subset>.txt` approach, `wrepF_<subset>.txt` forward with the A / Q classes, `wrep_rel_<subset>.txt`; note that the forward section inside `wrep_<subset>.txt` is the older one without A / Q: use `wrepF_*`).
5. `node w_pre.mjs all Q 1 out` (also `P`, `A`) : prior-move control (`wpre_*.txt`).
6. `node bookgaps.mjs` : book push interval and visible-book width per session (`bookgaps.json`).
