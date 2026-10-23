# Blind review of the Reader's detections, 2026-10-22 13:31 UTC open

Replay of `session_BTC_202610221331` with `READER_ENGINE.replayEngine(inputs, {})`; no source files changed. The verdicts are suggestions for a human, not labels. Market-structure analysis only, not trading advice.

The replay gives 55 episodes: 16 burst, 11 exhaustion, 8 absorption and 20 wall. The 27 bursts and exhaustions are the set judged below.

## Assumptions

- **Price series:** the mid of each venue's own quote records (`q`). Each episode uses its own venue's series. The data ends at 14:30:30, so a 15-minute move is `na` for episodes ending after about 14:15.
- **Aggressor side:** the episode's `aggressor` field, which is the taker side. Checked against the data: buy prints sit at or above the ask 53,843 times against 2,533 below the bid on Binance, and the same pattern holds the other way for sells.
- **Signed move:** positive means price continued in the aggressor's direction. For buy aggressors a negative number means price fell afterwards. Moves are measured from `tEnd`.
- **Own measures:** taker notional by side recomputed from the `t` records over the episode span and the 30 s before detection, compared with the 60-180 s before detection. Distance from the 5-minute extreme of the mid was also measured.
- **Detector windows are longer than the episode span:** many readings cite windows such as "$6.4M in 84 s" for an episode that lasts 13 s. The reported start is back-dated only a few seconds. Span-based flow figures therefore understate what the detector saw, and verdicts that depend on them carry lower confidence.
- **What each family claims:**
  - Burst claims a spike in aggressive flow with price moving with it.
  - Exhaustion claims prior elevated aggression that has now faded, near an extreme, with price stalling.
  - A later price move is evidence, not proof.
- **Drift confound:** the hour was choppy and trending. Binance 5-minute returns were -27, +5, -29, +32, +20, -23 bps, and 1-minute return standard deviation was about 8 bps. Price fell roughly 60 bps between 13:34 and 13:50. Buy-side calls in 13:33-13:38 would "look right" from the trend alone, and sell-side calls would look like continuation.

## Ranked shortlist (exhaustions and bursts)

Times are the UTC start. Moves are 1 / 5 / 15 minutes in bps after `tEnd`, signed to the aggressor.

| UTC | Family | Venue | Verdict (confidence) | 1/5/15 min | Reason |
|---|---|---|---|---|---|
| 13:34:45 #3 | burst, buy | bn | likely-right (high) | -20 / -51 / -67 | $37M of buys against $16M of sells, about 21x the prior 5-minute pace, 7 liquidations, +11.5 bps in 12 s. Price then fully reversed. |
| 13:35:04 #5 | burst, sell | bn | likely-right (high) | +14 / +42 / +56 | 73% sell share, about 7x the prior pace, -7.7 bps in 4 s. It came 19 s after #3, so it is a genuine whipsaw. |
| 14:05:04-20 #35/#36/#37 | burst, sell | bn + hl | likely-right (medium-high) | bn +4 / +16 / +6; hl +8 / +11 / +6 | 86-94% sell share, 4-7x the prior pace, price down on both venues. Three reports of one event. |
| 13:33:23 #1 | burst, buy | bn | likely-right (medium) | +5 / -25 / -43 | 76% buy share, about 9-10x the prior pace, +2.8 bps in 11 s. Weak price follow-through, then reversal. |
| 14:06:59 #41 | exhaustion, sell | hl | likely-right (medium) | 0 / -10 / -8 | Sell flow was about 57k$/s and went to zero in the last 30 s. Price rose about 10 bps afterwards. |
| 13:35:38 #8/#9 | exhaustion, buy | bn, hl | direction right, label doubtful (low-medium) | #8: +5 / -32 / -51 | Buyers' share fell to 24% / 12%, and price fell further. But price was already about 22 bps below the 5-minute high, which contradicts "near the high". Closer to sellers taking over. |
| 13:36:33 #16/#17 | exhaustion, buy | bn, hl | same as above (low-medium) | -16 / -34 / -56 | Buy pace was 0.25x / 0.12x of earlier, but price was 30 bps off the high. |
| 13:37:31 #18/#19 | exhaustion, buy | bn, hl | same as above (low-medium) | -21 / -30 / -54 | Same pattern, 5 s long, a third report of the same fade. |
| 13:37:53 #23 | burst, sell | hl | likely-right (low-medium) | +5 / +19 / +41 | 70-88% sell share, $3.4M against $0.5M, down 1.7 bps. Only about 1.3x the pace of an already-active sell-off. |
| 13:34:49 #4 | burst, buy | hl | unclear (low) | -18 / -44 / -59 | Echo of #3 on hl. The hl price only rose 2.6 bps, against 14 bps on bn. |
| 14:21:09 #48 | burst, buy | bn | unclear (medium) | -5 / -3 / na | Real flow (71% share, 4.5x) but price did not move (0.0 bps). More absorption than a burst. |
| 14:21:39 #49/#50 | burst, buy | bn, hl | unclear (medium) | #49: -10 / -11 / na | 5x pace, 71% share, price -1.1 bps during. Flow without price progress. |
| 14:05:37 #38 | burst, sell | hl | unclear (low) | +5 / +9 / +4 | 94% share, but only about 1.5x pace and -1.4 bps. Fragment of the 14:05 event. |
| 14:04:09 #29/#30 | burst, buy | bn | unclear, leaning wrong (low) | -17 / -32 / -19 | 81-84% buy share but only 1.0-1.5x pace. Price was flat during the episode, then fell 17-31 bps. The z figures (8,521 and 5,027) look degenerate. |
| 14:06:25 #39 | burst, sell | hl | likely-wrong (low) | +4 / +4 / -11 | Pace was 0.39x of the preceding minutes, so it is not a spike. |
| 13:39:06 #27 | exhaustion, buy | hl | likely-wrong (low) | 0 / -9 / -16 | Price was 56 bps below the 5-minute high, so "near the high" is false. Buy share was 32% and there was no prior surge. |
| 14:04:52 #34 | exhaustion, sell | hl | likely-wrong (medium-low) | +9 / +17 / +8 | Prior pace was about 0 and recent/prior was about 39x, so there was nothing to exhaust. Price kept falling. |
| 13:38:51 #26 | exhaustion, sell | hl | likely-wrong (medium) | +5 / +14 / +32 | Sell share 69%, pace 1.0x of before. Sellers were not fading and price kept falling. |
| 13:38:07 #25 | exhaustion, sell | hl | likely-wrong (medium) | +7 / +18 / +37 | Sell share 73%, pace 2.1x of before, and price continued down. |

Summary:
- **Clear cases:** the large bursts (#3, #5, the 14:05 cluster) match the market well on flow, share and price.
- **Sell-side exhaustions:** #25, #26 and #34 conflict with the market (aggression not fading, price continued).
- **Buy-side exhaustions:** the 13:35-13:37 calls are right about direction but are the least reliable because of the trend, and each was reported a second time on hl.
- **Out of scope but worth a look:** absorption #31 (hl sell, 14:04:14) says sellers were absorbed, yet price fell 16 bps in the next minute and 27 bps in five.

## Duplicates

Same family and venue within 10 s:
- **#23 / #24** (hl sell burst, 13:37:53-54): one event, started 1 s apart.
- **#29 / #30** (bn buy burst, 14:04:09): identical start and end. One event.
- **#36 / #37** (hl sell burst, 14:05:04-07): overlapping. Together with bn #35 this is one event reported three times.
- **#42 / #43** (hl buy absorption): 10 s apart, probably one structure.
- **#3 / #5** (bn buy then sell burst): not duplicates, a real reversal.
- **#26 / #27** (hl sell then buy exhaustion): opposite sides, not duplicates.

Cross-venue, same family and side, start within 5 s. The bn/hl pairs are the same market event measured on two venues; whether to count them as one is a policy choice:
- **#3 / #4**, **#8 / #9**, **#16 / #17**, **#18 / #19**, **#35 / #36 / #37**, **#49 / #50**.

If only same-venue repeats are collapsed, 27 exhaustions and bursts reduce to about 22 distinct events, and to about 17 if cross-venue echoes are also merged.

## Walls

**Open hour:** 20 walls, all on bn, durations 61-380 s, median 76 s. Outcomes: 11 eaten, 6 pulled, 2 gap, 1 faded. Merging same-side walls that overlap within 5 s gives 6 clusters (sizes 9, 1, 2, 3, 3, 2):
- **13:31:31-13:37:51:** a bid cluster of 9, including prices 81832 and 81832.5, 81784, 81783.8 and 81786.5, which are one region reported many times.
- **13:58:29-14:00:08:** 1 wall.
- **14:03:18-14:04:23:** 2 walls.
- **14:19:53-14:21:07:** 3 ask walls.
- **14:21:04-14:22:16:** 3 bid walls.
- **14:26:34-14:29:23:** 2 ask walls.

**Size and censoring:**
- **The clear wall is #6.** 51 BTC on the bid at 81880, held 63 s, 95% of the departing size traded through. This matches the sell burst #5 and the sell-off.
- **Many walls are tiny.** Peak sizes below 1 BTC (about $80k) are 8 of 20 (for example 0.047, 0.061, 0.5 BTC); only 7 of 20 are 4 BTC or larger. Multiples of the median level (up to 20,818x) look inflated by a very thin median level on the 0.1-tick Binance book.
- **Ids 20 and 22 started seconds after the recording began.** They may have been resting before it, so their ages and durations are cut off at the start.

**Calm files.** Session length is the first-to-last quote span (an assumption).

| File | Length | Walls | Clusters | Median duration | Cluster sizes |
|---|---|---|---|---|---|
| 0600 | 16 min | 36 | 4 | 106 s | 13, 10, 9, 4 |
| 0634 | 8 min | 23 | 2 | 179 s | 18, 5 |
| 0709 | 19 min | 56 | 7 | 134 s | 11, 12, 1, 4, 16, 10, 2 |
| 0914 | 59 min | 5 | 2 | 96 s | 3, 2 |
| open | 59 min | 20 | 6 | 76 s | 9, 1, 2, 3, 3, 2 |

The 0600 file contains one wall with an invalid end time (negative duration), excluded from the median.

**Does the count look too high?** In the open hour, 20 episodes for about 6 distinct structures looks high, by roughly 2-3x. The early calm files are worse, with 2.3-2.9 walls per minute against 0.34 in the open. A volatile hour should not have fewer walls than three quiet ones. This looks like fragmentation of one resting region into several nearby price levels, not a regime effect. 0914 is the exception at 0.08 per minute.

## What I could not tell, and why

- **Book state.** I read detections and flow, not the full order book at each moment, so I could not confirm that a wall was a genuine large resting order rather than a stack of small levels.
- **The "near the 5-minute extreme" claim.** My own measure puts the buy exhaustions 22-33 bps below the 5-minute high at detection. The detector may use a different lookback or the trade price. Unresolved, so exhaustion verdicts that rely on it carry low confidence.
- **Window mismatch.** The detector reports windows (up to 84 s) longer than the episode span, so my own flow figures may understate its evidence. Verdicts for #24, #38 and #39 are the most affected.
- **Degenerate z-scores.** Values like 8,521 and 290,906 on #29, #30 and #31 suggest a near-zero baseline in that part of the session.
- **Outcome as proof.** One hour with a persistent downtrend is a single regime, so "detector right" cannot be separated from "price drifted that way". Fifteen-minute outcomes are missing for episodes after 14:15.
- **Calm-file lengths.** Inferred from quote timestamps. If a file started earlier than its first quote, the walls-per-minute rates are slightly off.
