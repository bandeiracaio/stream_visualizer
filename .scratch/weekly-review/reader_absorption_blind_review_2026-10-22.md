# Blind review: absorption episodes, 22 Oct 2026 US open (BTC, bn and hl)

Market-structure analysis only, not trading advice. The verdicts are suggestions for a human. I added no labels to the app and wrote no files.

## 0. Method and assumptions

- **Detections.** I replayed with the current `src/js` (`replayEngine(inputs, {})`). The main file gives **8** absorption episodes. The quiet files give 26, 4, 13 and 6, as expected.
- **Price.** The mid of each venue's own quote records (`q`), taken as the last quote at or before a time. Forward moves are in bps and signed so that **positive means price continued in the aggressor's direction**.
- **Flow.** Trades (`t`) by notional. The `side` field is the taker side. Checked against the quotes, bn buys print at or above the ask 95% of the time and bn sells at or below the bid 95%. On hl it is only about 74%, because the hl quote lags the prints. So the "at touch" flag is unreliable on hl and I do not lean on it.
- **My windows.** Three, stated every time they matter:
  - **Engine window:** `[tDetected − facts.secs, tDetected]`. The engine stretches its "fast" (15 s) and "mid" (60 s) windows with activity. For these 8 episodes they came out at 8.5–88 s, and 3.75–240 s in the quiet files. I report share and move on this window, because a fixed 15 s or 60 s window misses what the detector looked at.
  - **Pre-30:** the 30 s before detection.
  - **Span:** `tStart..tEnd`. This is only 3–11 s long, so it holds little flow.
- **Typical move.** The median, p75 and p90 of |mid move| over all same-length windows in the same file and venue, sampled every 5 s. For hl: 1 min is 4.4 / 9.4 / 14.2 bps, 5 min is 13.3 / 23.1 / 32.4, and 15 min is 20.3 / 32.3 / 43.9. bn is almost the same.
- **Book.** Passive-side depth is the sum of book levels within 10 bps of mid. In practice this is only the **visible levels**. The bn book has 30 levels at a 0.1 tick (about 0.6 bps wide), and the hl book has 20 levels at a $1 tick (about 2.4 bps). Treat it as near-touch depth. hl book updates are sparse (median gap 5.4 s, p90 37 s, 316 updates in the hour), so hl "refill" often compares snapshots that are many seconds old.
- **Base time for follow-through.** `tDetected`. Values from `tEnd` differ by only a few tenths of a bp, except where noted.
- **Wallets.** hl `users` is read as [buyer, seller]. I inferred this from one pair of prints and did not prove it.

**Data quality caveat that affects everything.** The main file has no quotes or trades for about 57–60% of the hour. Quote coverage is bn 40% and hl 43%. There are many simultaneous silent stretches of 25–280 s on both venues, for example hl 14:07:28 for 278 s, and a 60 s hole at each `:29` for most of the hour. The recorder or feed was clearly starved (my guess is a hidden or throttled tab, but I can't tell). The quiet files 0600, 0634 and 0709 have 100% coverage. 0914 has only 8% on bn and 83% on hl. Forward quotes at +1, +5 and +15 min were sometimes 20–214 s old. Examples: #16 at +5 min was 107 s stale, #28 at +15 min was 214 s stale, and #8 at +5 min was 63 s stale. Treat those figures as approximate.

## 1. The open's 8 absorption episodes

All episodes ended with outcome "faded", pulses = 1. The "Peak evidence" column shows only the items that failed at the peak; every other item passed. "Last evidence" shows the items that passed at the final update. Flow, stalled and recent are gates. A "—" means that item passed at the peak or was n/a.

| # | Venue, side, horizon | tStart / tDet UTC | Engine window | Peak evidence, items that failed | Last evidence, items that passed |
|---|---|---|---|---|---|
| 2 | bn buy fast | 13:34:10 / :12 | 8.5 s | — | flow 68%, intensity z 2.3, fills 6%, level, cross 67% |
| 8 | hl sell fast | 13:36:31 / :33 | 18.5 s | cross 54% | flow 81%, intensity z 3.6, refill 156%, fills, level, wallet 84% |
| 9 | hl buy mid | 13:37:46 / :48 | 19 s | efficiency 0.31, cross 32% | stalled −2.2σ, intensity z 2.8, refill 206%, fills, level, wallet 52% |
| 16 | hl sell mid | 14:04:14 / :16 | 15.3 s | fills 22%, level no, cross 22% | flow 97%, stalled +0.4σ, intensity z 50 (capped), efficiency 0.10, refill 177%, wallet 97% |
| 24 | bn buy mid | 14:06:52 / :56 | 57.5 s | intensity z 0.2, efficiency 0.28, cross 44% | stalled −1.8σ, refill 45% (failed), fills, level |
| 26 | hl buy mid | 14:07:04 / :06 | 88 s | intensity z 0.7, efficiency 0.27, level no | recent 100%, refill 295%, fills (flow 34% failed) |
| 27 | hl buy fast | 14:07:20 / :22 | 27.8 s | level no | flow 81%, intensity z 10.3, refill 102%, fills, wallet 89%, cross 76% |
| 28 | hl sell mid | 14:17:02 / :04 | 65 s | intensity z 0.9, cross 59% | flow 80%, recent 97%, wallet 50% |

## 2. Per-episode judgement, ranked from most to least supported

"Share" is the aggressor's share of taker flow, with the engine window first, then pre-30 or the span. "Stall" is my signed move in the engine window; a positive value means price moved with the aggressor. "Refill" is my end-over-start passive depth (start of window → at detection → at end), with the engine's own peak refill figure in brackets. "Fwd" is the follow-through at +1, +5 and +15 min from detection, with the aggressor's direction as positive.

| Rank | # | Time, venue, side, horizon | Verdict (confidence) | Share (engine / pre-30 / span) | Stall (vs typical) | Refill | Fwd +1 / +5 / +15 min (bps) | Reason |
|---|---|---|---|---|---|---|---|---|
| 1 | 9 | 13:37:46 hl buy mid | **likely-right, weak (55%)** | 69% / 52% / 2% | −5.4 bps (adverse; 1-min typical median 4.4); the detector's own progress was −2.2σ | 4.4 → 100.6 BTC (×23; engine 385%) | −17.2 / −27.1 / −49.8 | Buyers got $1.75M of market buys and price fell. The thesis held at every horizon (−17 bps in 1 min is above the p90 of 14). But price did not "stall"; it was driven down, and a $4.4M sell burst followed. It is better described as buyers failing and reversing than as a stall. |
| 2 | 2 | 13:34:10 bn buy fast | unclear (45%) | 60% / 62% / 70% | +2.6 bps (15 s) vs median 1.1, p75 3.7; span −1.6 bps. Within normal | 6.1 → 14.8 → 2.4 BTC (0.39; engine 135%). Net thinned | +8.5 / −29.4 / −48.0 | There was real two-sided volume at the open ($12.6M in 15 s) and price was flat, but buyers were not clearly dominant (62%, below the 65% threshold). Price continued with the buyers by 8.5 bps in the first minute, then fell 29 bps and 48 bps. Those reversals are above the p90 of the 5-min and 15-min typical moves, which supports the thesis only at a delay. The "continued right after" red flag is present but small. |
| 3 | 27 | 14:07:20 hl buy fast | unclear (45%) | 99% / 99% / 1% | +3.8 bps over 28 s (+0.4 in 15 s) | 28.6 → 79.6 → 42 BTC (1.48; engine 226%) | −1.5 / +8.2 / +6.9 | One $1.36M buy sweep at 14:07:17. Price rose about 1.5 bps and then gave it all back, which looks like genuine absorption. But it is a single print cluster, not "keeps hitting". Over 1 minute price sat 1.5 bps below the level, then drifted up 8 bps in 5 min, which is ordinary (5-min median 13). |
| 4 | 28 | 14:17:02 hl sell mid | unclear (40%) | 69% / 83% / 92% | +3.7 bps (down) vs median 4.4 | 142.6 → 158 → 192 BTC (1.35; engine 184%) | +3.7 / −21.0 / n.a. | Small flow ($0.6M in 65 s) with a strong bid book. A $2.5M sell sweep then arrived at 14:17:14 and price drifted down only about 3.7 bps in a minute. By 5 min price had risen 21 bps against the sellers (about p75). The data does not show whether the book held under that sweep. |
| 5 | 8 | 13:36:31 hl sell fast | **likely-wrong (55%)** | 75% / 66% / 50% | +1.2 bps (engine window), +3.1 bps in 15 s (median 0.2, p75 3.4) | 85.9 → 25.7 BTC (0.30; engine 160%). Thinned, not refilled | +1.1 / +27.1 / +51.3 | A $1.7M sell sweep took price down about 3 bps and the bid depth fell 70%. After a brief bounce of 5.7 bps in 30 s, price kept falling with the sellers: −27 bps in 5 min (above p75) and −51 bps in 15 min (above p90). That is continuation, not absorption. |
| 6 | 24 | 14:06:52 bn buy mid | **likely-wrong (55%)** | 56% / 72% / 36% | −10.0 bps (adverse; 60 s median 5.0, p75 8.5, p90 13.4) | 12.6 → 8.4 → 5.1 BTC (0.41; engine 85% then 45%) | +1.5 / +5.2 / +20.1 | Buyers were not dominant (56% in its window; the detector's own last reading was 52%). The 10 bps adverse move is a drop to a lower level straight after a 20 s silent stretch (14:06:29 + 20 s), not a stall against flow. Price later continued with the buyers, +20 bps in 15 min (above the 15-min median). The "absorption" is mostly a gap artefact. |
| 7 | 26 | 14:07:04 hl buy mid | **likely-wrong (60%)** | 28% / 86% (of $146k) / 84% (of $119k) | −8.8 bps (adverse), straddling a 10 s hl silence and a 6 bps jump | 41 → 29 → 86 BTC (2.1; engine 81%) | +0.2 / +9.3 / +15.1 | The window stretched to 88 s and ended with buyers at 28–34% (they had been 89% at the peak). The dominant tiny flow is $126k in 30 s, nothing unusual. Price then continued with the buyers. |
| 8 | 16 | 14:04:14 hl sell mid | **likely-wrong (60%)** | 97% / 97% / 95% (of $114k) | −1.8 bps (engine window), −0.9 bps pre-30 | 64 → 172 → 136 BTC (2.12; engine 235%) | +16.7 / +28.9 / +22.2 | See section 3. |

Summary: 1 likely-right (weak), 3 unclear, 4 likely-wrong. None is a strong likely-right.

## 3. The 14:04:14 hl sell case, in detail

**What the data shows.**

- **One print cluster.** At **14:04:12.520** one taker (wallet `0x4b6265…`, which appears in every one of 110 prints at that timestamp) sold **about $4.29M (about 52 BTC)** at $81,875 / $81,874. About 50 maker wallets took the other side, with one resting bid of $1.0M. This is a single multi-fill market order, not flow that keeps hitting. The rest of the 30 s before detection was about $0.2M.
- **Where the shares come from.** The 97% sell share, the "wallet 98% dominates" tick and the z 50 (the cap) are all that one print cluster. z is pinned at the cap, so it is uninformative. The "wallet" item firing is trivially true when one order is the whole flow. "Fills spread over many fills" correctly failed at 22% (one $1M print).
- **Reported times are after the event.** The sweep was at 14:04:12.5, the episode start (back-dated) is 14:04:14, and detection is 14:04:16. The episode's own span contains only $114k of flow.
- **Price at the time.** hl mid was about 81,877 at 14:04:14, 1.5 s after the sweep. A $4.3M sell moved the mid by roughly nothing: slippage was about $1. That is a real absorption of that single order. Bid depth in the visible levels was 130–172 BTC right after, against 32–58 BTC in the minute before. So the passive side did hold and refill in the first 10–20 s. The hl book is sampled at about 5–35 s, so I can't see inside those seconds.
- **After.**

| Time | hl mid | Move from detection (sell-signed) |
|---|---|---|
| 14:04:24 | 81,849.5 | +3.4 bps |
| 14:04:34 | 81,862.5 | bounce |
| 14:04:44 | 81,802.5 | +9 |
| 14:05:04–14 | 81,740 | **+16.7 at +1 min** |
| +5 min | | +28.9 |
| +15 min | | +22.2 |

A **second sell sweep of $1.55M** (largest print $400k) hit at 14:05:04–14. It, not the first sweep, drove the move to 81,740. Bid depth thinned to 55–87 BTC before that.

- **bn at the same time.** bn buys outweighed bn sells in the 30 s before detection ($3.78M against $0.74M). The hl sells of $4.3M roughly mirror that, so this may be a hedged or arbitrage leg and not directional selling. I can't prove that.

**Verdict: likely-wrong, 60%.** The previous review's numbers (16 bps in a minute, 27 in five) reproduce: I get 16.7 and 28.9. A 1-minute move of 16.7 bps is above the p90 of hl 1-minute moves (14.2), and 28.9 bps in 5 min is between p75 and p90. That is a continued move with the aggressor right after, which counts against the thesis.

In fairness to the detector, the first $4.3M order really was absorbed with no slippage, and the bid refilled. What failed is the claim that sellers were absorbed over time, because a fresh $1.5M sweep a minute later went through. As a description of the one order it is accurate. As a signal that the sellers' side is exhausted, it was wrong here. Whether one episode on an isolated sweep deserves the label "absorption" is a design question for the human.

## 4. Duplicates, echoes and distinct events

**Main file.**

| Check | Result |
|---|---|
| Same venue and side, overlapping or starting within 10 s | None. 8 → 8. |
| Cross-venue echo within 15 s | #24 (bn) and #26 (hl), buy, starts 12 s apart. Flow doesn't confirm it: hl buyers were 28–34%. |
| Same hl event seen twice | #26 and #27 start 16 s apart but carry the identical `px` and `pxStart` (81,640.5 / 81,671.5). #27 is a re-read of the sweep that landed after #26. |

The 8 episodes reduce to **7** by the mechanical rule, or **6** distinct events by my reading: #2, #8, #9, #16, {#24, #26, #27}, #28.

**Quiet files** (same-side union within 10 s, either venue):

| File | Raw | Same-venue merged | Cross-venue merged |
|---|---|---|---|
| 0600 | 26 | 18 | 14 |
| 0634 | 4 | 3 | 3 |
| 0709 | 13 | 12 | 11 |
| 0914 | 6 | 3 | 2 |
| Quiet total | 49 | 36 | **30** |

The fast and mid readings of one event, and bn and hl at the same moment, are common in the quiet hours (for example #1/#2 and #3/#4 at 06:02, #21–#23 at 06:09, #23/#24 at 07:27). In the open they are rare.

## 5. Evidence audit

Passes at the **peak** (the best moment) and at the **last** update, over the 57 absorption episodes in all five files (8 + 49). Wallet is hl-only and cross is n/a without the other venue, so their denominators are lower.

| Item | Gate | Pass at peak | Pass at last | Assessment |
|---|---|---|---|---|
| flow (share ≥ 65%) | yes | 57/57 | 37/57 | Always passes at peak by construction (gate). Informative only at the end. |
| stalled (progress ≤ 0.5σ) | yes | 57/57 | 42/57 | Always passes at peak. **Misleading:** the test is one-sided, so a strongly adverse move passes it. Last values reached −2.2σ (#9), −1.8σ (#24) and −1.2σ (#26). A reversal looks like a stall. |
| recent | yes | 57/57 | 9/57 | Pass at peak by construction. The low last count is just the fade. Uninformative as evidence. |
| intensity (z ≥ absorbZ) | no | 20/57 | 13/57 | Works, but about 35 of 57 episodes have z < 1 at peak, so most "absorptions" have no unusually heavy flow. One value is pinned at the cap: z 50 on #16. Other large values (17.6, 17.9, 23.7, 26.4) are plausible. |
| efficiency | no | 47/57 | 23/57 | Passes in most cases, so adds little at peak. |
| refill (≥ 80%) | no | 53/56 | 39/53 | Nearly always passes. Peak values run from 81% to **4,684%** (0709 #?) and 385%, 469%, 349%. They compare a thin visible book at two moments, and on hl against snapshots 5–37 s apart. Treat this as near-degenerate. One episode is n/a. |
| fills (no large print) | no | 51/57 | 51/57 | Passes except where one big sweep dominates (#16, 22%). It is the only item that exposed the single-order nature of #16. Useful. |
| level (repeated fills) | no | 23/57 | 12/57 | Varies. Informative. |
| wallet | no | 31/35 | 28/35 | Passes mostly. **Misleading** when one taker is the whole flow (#16), since dominance is then trivial. hl-only, so scoring is asymmetric. |
| cross | no | 37/57 | 21/57 | Varies. In the main file it passed only 3/8 at peak. |

## 6. Quiet-hour comparison

| File | Length | Quote coverage (bn / hl) | Raw absorptions | Per minute | Distinct events (cross-venue merged) | Side split buy / sell |
|---|---|---|---|---|---|---|
| Open 13:31 | 60.1 min | 40% / 43% | 8 | 0.13 | 6–8 | 5 / 3 |
| 0600 | 16.0 | 100% / 100% | 26 | 1.63 | 14 | 23 / 3 |
| 0634 | 8.0 | 100% / 100% | 4 | 0.50 | 3 | 4 / 0 |
| 0709 | 19.0 | 100% / 100% | 13 | 0.68 | 11 | 5 / 8 |
| 0914 | 60.0 | 8% / 83% | 6 | 0.10 | 2 | 6 / 0 |

- **Open versus quiet.** On raw counts the open produced about 3.6 times fewer absorptions per minute (0.13 against 0.48 pooled over the 103 quiet minutes). That comparison is distorted. The open's recording is missing about 57% of the hour, and 0914 is missing most of bn. On the covered minutes only, the open is about 0.3 per minute against about 1.0 in the fully covered 0600, 0634 and 0709 files. The open is still lower, but I can't say by how much. This matches the intuition that heavy flow makes it harder for a "stall" to persist, but I can't confirm that.
- **Quiet-hour evidence.** The audit pattern is the same as at the open. Peak z is mostly near 0 (values between −1.0 and +0.6 in 17 of the 26 in the 0600 file). Stalled values are about ±0.0–0.5σ, since the market barely moved. Refill passes almost always (peak 24/25, 11/13, 4/4, 6/6) with one extreme value of 4,684%. Cross passes 18/26, 8/13, 2/4 and 6/6.
- **Direction skew.** In the quiet files 38 of 49 are buy-aggressor (and 0634 and 0914 are all buy). In the main file it is 5 of 8. I did not investigate why.
- **Window stretch.** In quiet markets the engine's "fast" window can stretch to 60 s and "mid" to 240 s (for example 0600 #14, #28 and #34 at 240 s). A reading over 240 s is a different claim from "a stall in 60 s".

## 7. What I could not tell, and why

- **Single regime, tiny sample.** 8 episodes in one hour at one open, plus 49 in short quiet files from the same day. No conclusion about rates or accuracy generalises. The verdicts rest on one or two events each.
- **Missing data in the main file.** About 57–60% of the hour has no quotes or trades. Several episodes (#24, #26, #27) sit next to a gap, and their "stall" or adverse move may be a gap jump. Forward moves at +5 and +15 min use quotes up to 214 s old. I could not tell what caused the gaps.
- **Book data.** I can read book updates, but only the visible levels (bn 30 at 0.1 tick ≈ 0.6 bps, hl 20 at $1 ≈ 2.4 bps). hl snapshots arrive every 5–37 s, so I could not see whether bids held inside a sweep or only before and after. My refill and the engine's refill measure different moments, so they disagree (for example #2: mine 0.39, engine 135% at peak; #8: mine 0.30, engine 160%).
- **Window mismatches.** The engine windows are stretched (8.5–88 s here, up to 240 s in quiet files), and the engine measures price from trade buckets, not from quote mids. My shares differ from the engine's by a few points as a result (for example #2: 60% against 68–69%, #9: 59% on a fixed 60 s window against the engine's 69–70% on 19 s). I report both. The previous review's lesson applies: a verdict that shifts with the window is weak evidence.
- **Tick timing.** The back-dated start has 1 s resolution plus a 2 s hold, so a start can fall after the event (#16).
- **Hedged or arbitrage flow.** I can't tell whether a large hl sweep is directional or one leg of a hedge (suggested for #16 by bn buying $3.8M at the same time). I did not confirm it, and it would weaken any reading of it as an aggressor signal.
- **Price move is evidence, not proof.** The follow-through numbers are small samples with fat tails. For comparison, 15-min |move| has a median of about 20 bps, so +20 bps in 15 min (#24) or −48 bps (#2) tells little about causality.
