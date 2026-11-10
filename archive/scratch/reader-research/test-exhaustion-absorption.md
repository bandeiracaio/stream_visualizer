# Test pass: exhaustion (hypothesis 2) and absorption (hypothesis 1)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed. Everything below is a lead, not proof. No keep-or-drop conclusion is drawn.

Data: the 52 `session_BTC_*.json.gz` in the repo root, 25.1 h of recording span (by `t1 - t0`; the 23 h in the brief is the same data counted slightly differently). Quality verdicts: 38 complete, 7 holes, 7 without a verdict (older files). Every result is given for three subsets: ALL (52), NO-HOLES (45: complete + no verdict), COMPLETE (38). "Hollow" does not occur as a verdict in these files; "holes" is the only bad one. There are no `reader_labels*.json` files in the repo root, so everything is label-free (no precision/recall, no agree/disagree).

## A. The two open facts

1. Does the engine store or use Hyperliquid per-level order count `n`? **No.**
   - The page maps the HL book to `[price, size]` pairs and drops `n`: `src/js/app.js:564` (`hlBook[0].map(l=>[+l.px,+l.sz])`; the stream desc at `app.js:24` says "n orders per level" but `n` is not read anywhere).
   - The engine's `onBook` records and cleans only `l[0]`, `l[1]`: `src/js/reader-engine.js:77-78` (`clean`, `onBook`; recording is `rec.push(["b",vn,t,bids,asks])` with those pairs).
   - Confirmed in data: a recorded HL book input is `["b","hl",t,[[80102,13.76644],[80101,0.03134],...]` (two numbers per level). So saved sessions cannot answer anything about `n` (iceberg / order-count questions need a new recording field).
2. Is the flow z baseline time-of-day adjusted? **No.** `robustZ` (`reader-engine.js:46`) uses `stat()` (`:39`): median and MAD of a rolling array of the last 1800 one-second samples of the fast-window flow (`sample`, `:38`, `push(..., 1800)`) = the last 30 minutes. It resets on `softReset` (`:71`, `samples` and `stats` cleared) and returns 0 until 60 samples exist. The rate regime ratio uses a 30-minute EWMA (`baseTauMs:1800000`, `:5`, `:70`; `rateRatio :48`). Nothing keys on clock time.

## B. Exhaustion: does flow decay carry forward information beyond persistence of signed flow?

### Method
- Replay each session once through the unmodified engine with default thresholds, with a read-only hook injected into an in-memory copy of the episode source at the single line `const ev = EVAL[fam](vn, hz, side, t);` (the on-disk files are untouched). The hook records, for every 1 s tick, venue and side: decay ratio, z_was, was-share, `away`, `late`, plus the engine's own score. Verified that the hooked engine produces byte-identical episode groups to the plain engine on 4 sessions (`collect.mjs --check`: all `identical=true`).
- Exhaustion is evaluated on the mid horizon only (as in `famHorizons`). A row exists only when the previous window had at least `minTradesMid` (12) trades, so quiet periods are absent (selection to flag).
- Sign: forward move in sigmas, signed in the direction of the previously dominant aggressor side (+ = price continued with that side, - = reversal). Sigma = per-session robust 15 s sigma from `sigmaOf` of `reader-scoreboard.mjs` (whole-session, so slightly non-causal as a yardstick, same as the scoreboard). Horizons 10 / 30 / 60 / 300 s from a 1 s price grid per venue.
- Persistence base **A** = z_was >= 1.5 and was-share >= .55 (the "was elevated and dominant" gates). Decay stratum **G(d, near)** = A and ratio <= d and away <= near and late <= .5 (the remaining gate items, `exhDecay` = d, `exhNear` = near). Control **C(d, near)** = identical gates but ratio > d (flow persisted). So G vs C differs only in decay.
- Ticks sampled every 5 s (stride) to reduce overlap; 57,412 ticks (ALL).
- Intervals: 95% bootstrap resampling sessions (cluster). Null: circular shift of each session's price increments against the flow features (random shift of at least 600 s, one per session and venue, K = 1000), two-sided. Multiple comparisons: Holm within each table (primary 4 tests; venue split 8; decay sweep 20; near sweep 16). Raw p are shown beside corrected ones.
- Unconditional |move| at random moments (every 10 s, both venues), sigmas, median / mean: 10 s 0.45 / 0.70, 30 s 0.62 / 0.82, 60 s 0.65 / 0.85, 300 s 0.68 / 0.89.

### Results (ALL 52 sessions)
Signed forward move (sigma), mean [cluster CI], raw shift p:

| Stratum | 10 s | 30 s | 60 s | 300 s | ticks (10 s) / sessions |
|---|---|---|---|---|---|
| A: persistence base | -0.017 [-0.053,+0.014] p .36 | -0.005 [-0.048,+0.043] p .85 | -0.004 [-0.061,+0.060] p .92 | -0.089 [-0.205,+0.008] p .041 | 10,823 / 51 |
| A, ratio <= .3 | -0.052 [-0.102,-0.009] p .011 | -0.052 [-0.105,+0.014] p .047 | -0.062 [-0.135,+0.018] p .068 | -0.157 [-0.238,-0.079] p .003 | 4,934 / 50 |
| A, ratio .3-.5 | +0.007 | +0.037 | +0.038 | -0.040 | 1,808 / 50 |
| A, ratio .5-.7 | +0.001 | -0.002 | +0.005 | -0.065 | 1,144 / 45 |
| A, ratio .7-1 | -0.066 | -0.057 | -0.002 | -0.091 | 982 / 44 |
| A, ratio > 1 | +0.062 [-0.027,+0.138] p .042 | +0.094 p .043 | +0.095 p .14 | +0.016 | 1,955 / 48 |

(Cells without CIs are in `exh_all.txt`; all have CIs including 0 except as marked.) The "unconditional drift" row is exactly 0 by construction: both sides are scored at every tick with opposite signs, so it only guards the code.

Primary contrast, G(.5, 1) minus C(.5, 1), both venues. Negative = after decay, less continuation than when flow persisted:

| H | G mean (n, sess) | C mean (n, sess) | diff [CI] | raw p | Holm (4) |
|---|---|---|---|---|---|
| 10 s | -0.095 (2274, 50) | +0.011 (1726, 49) | -0.107 [-0.181,-0.020] | .010 | **.040** |
| 30 s | -0.044 | +0.057 | -0.101 [-0.219,+0.031] | .094 | .189 |
| 60 s | -0.037 | +0.064 | -0.101 [-0.232,+0.065] | .142 | .189 |
| 300 s | -0.206 (1842, 46) | -0.026 (1470, 40) | -0.180 [-0.395,+0.065] | .063 | .189 |

Same contrast without holes (45 sessions): 10 s -0.109 [-0.195,+0.002] Holm .072; 30 s -0.093; 60 s -0.084; 300 s -0.199 [-0.432,+0.049] (Holm .177). Complete only (38): 10 s -0.122 [-0.214,-0.013] Holm .024; 30 s -0.106; 60 s -0.094; 300 s -0.211 [-0.468,+0.048] raw p .036, Holm .108. The conclusion does not depend on the hole sessions.

Venue split (primary cell): Binance 10 s -0.160 [-0.313,-0.019], 30 s -0.217 [-0.375,-0.061] (raw p .046 and .031, Holm over 8: .32 and .25); Hyperliquid 10 s -0.085, 30 s -0.053, 300 s -0.210 (all CIs include 0). Binance has far fewer ticks (649 vs 1625 in G at 10 s).

Sweep of `exhDecay` (near = 1), diff at 10 s: .3 -0.129 [-0.203,-0.055] (raw .002, Holm over 20 .040); .4 -0.106; .5 -0.107; .6 -0.121; .7 -0.131 (raw .003, Holm .057). At 30 / 60 / 300 s every diff is negative (about -0.09 to -0.14, 300 s up to -0.24 at d = .3) but no Holm value is below .16. The gradient is flat: the 0.5 setting is not visibly special (the diff barely changes between .3 and .7), but the stricter .3 has the largest effect size at each horizon. Sweep of `exhNear` (d = .5) at 10 s: .5 -0.074, 1 -0.107, 2 -0.098 (Holm .032), infinity -0.071; the near-the-extreme condition does not sharpen the contrast; looser is as good.

Inside A, a regression of the forward move on log(ratio), z_was and was-share (cluster CIs): coefficient on log(ratio) +0.045 [+0.015,+0.073] at 10 s, +0.051 [0.000,+0.098] at 30 s, +0.056 [-0.010,+0.113] at 60 s, +0.044 [-0.054,+0.144] at 300 s (sigma per e-fold of the ratio). z_was and was-share are about 0. Positive = weaker decay, more continuation, which is the sign exhaustion implies.

Does a low ratio mean the flow ended? `flowpersist.txt`: inside A, the next mid window's pace of the same side relative to the current one, by ratio bin: ratio <= .3: x1.58 (85% of cases still at least half the current pace; mean log ratio +0.57 [0.48,0.65]); .3-.5: x1.09 (79%); .5-.7: x0.81; .7-1: x0.66; > 1: x0.52 (51%). A low ratio is mostly a dip that is followed by flow returning (regression to the mean; there is selection on a low current window), so the ratio is a poor marker of "flow has ended". The forward-move difference exists in spite of that.

Current exhaustion episode groups (default cfg): 561 groups in the 52 sessions = 22.4 per hour; per session min / median / max 0 / 8.5 / 36; 4 sessions with none (all older sessions without a verdict). By side 266 buy / 295 sell; by venue set: Hyperliquid only 383, Binance only 93, both 85. Forward move at `tDetected` (side's direction, as in the scoreboard):

| H | n / sessions | mean [CI] | median | share with the side | raw shift p | typical random |move| (median / mean) |
|---|---|---|---|---|---|---|
| 10 s | 556 / 48 | -0.100 [-0.178,-0.022] | 0.000 | .34 | .037 | .45 / .70 |
| 30 s | 550 / 48 | +0.039 [-0.087,+0.153] | 0.000 | .46 | .465 | .62 / .82 |
| 60 s | 540 / 48 | +0.030 [-0.071,+0.143] | 0.000 | .49 | .649 | .65 / .85 |
| 300 s | 442 / 43 | -0.155 [-0.291,-0.020] | -0.247 | .40 | .011 | .68 / .89 |

Holm over these four: only 300 s remains (.044). Many 10-60 s moves are exactly zero (so the "share with the side" ignores ties and is not a hit rate). Without holes: 10 s -0.112, 300 s -0.190 (p .004); complete only: 10 s -0.117 (p .010), 300 s -0.192 (p .002); 38 sessions, none empty.

### Reading (lead, not proof)
- Persistence of signed flow, as such, does not predict a continuation of price after the window: the A base is about 0 at every horizon (only 300 s approaches -0.09). The exhaustion contrast is therefore not a case of "flow persists, price keeps going".
- Within A, decay does carry a small forward difference in the direction exhaustion implies: about -0.10 sigma at 10 s (survives Holm in ALL and COMPLETE, borderline in NO-HOLES), and a larger but noisier -0.18 to -0.21 sigma at 300 s that does not survive correction. The effect is about 15-25% of a typical |move| at the same horizon, with clusters of 40-50 sessions. It could be the transient (mechanical) reversal of a just-completed push (Donier et al.) rather than a statement about flow ending: the flow-persistence table shows flow mostly returns.
- The prediction in the research note ("a small contrast") is half right: the contrast is small in magnitude, but its sign is the one exhaustion needs, and at 10 s it is not nominally zero. It is not a claim that the family is useful: the current groups show a 300 s reversal of -0.155 sigma against a typical |move| of 0.68, and at 30 and 60 s nothing.
- Variables: the 10 s effect shows up identically for d from .3 to .7, so the cut-off is not where the information sits; `exhNear` does not add to it.

## C. Absorption: impact shortfall vs the fixed stalled band

### Method
- Same hooked replay. For every 1 s tick, venue (bn/hl), horizon (fast/mid), side, the hook stores flow share, flow z, progress, passive-depth refill, window buy / sell USD, open / close, the engine's sigma, and the decomposition of the engine's score (all items except `stalled` summed, and the `stalled` item's weight and state). That makes it possible to recompute the engine's score and gate with a different `stalled` item.
- Lambda (price move per signed taker USD) per venue, session and horizon: windows sampled without overlap (greedy: next window starts after the previous one ends), buy-side rows only (sell rows are the mirror image), both quantities divided by sigma * sqrt(window seconds), robust (Huber) regression through the origin. In sample (it uses each session's own windows, so each tick's fit includes its future): the result is an upper bound on how well a causal rolling fit could do. Median lambda x 1e6 (sigma-normalised units): bn fast 0.73, bn mid 0.67, hl fast 0.56, hl mid 0.85. In-sample R2 median: bn fast .46, bn mid .48, hl fast **.06**, hl mid .22: on Hyperliquid fast windows the signed flow barely predicts the move, so a shortfall is a poor concept there. First-half versus second-half fit ratio median 0.93-1.46 (stable on Binance, not on Hyperliquid fast).
- Shortfall S = progress in the aggressor's direction minus lambda * aggressor-signed net flow (all in the engine's sigma units).
- Calibration of k: among flow-gated windows (aggressor share >= .65 and z >= 2, i.e. `absorbShare`, `absorbZ`) the aggressor-signed net flow was permuted within each session / venue / horizon (prices kept) and S recomputed; k = minus the 5th percentile of the null S. Result: **k = 3.4 (bn fast), 4.3 (bn mid), 2.0 (hl fast), 3.2 (hl mid) sigma**. At that k the observed windows have shortfall beyond -k only 0.4% to 3.0% of the time (below the 5% the null has by construction): real flow is more informative about price than shuffled flow, so a shuffle-calibrated k is very strict. Observed shortfall distribution among gated windows: median +0.02 to +0.40, 5th / 10th percentile -1.5 to -2.3 / -1.0 to -1.7. Because the spec'd k is that strict, two sensitivity versions are also reported: (q10) k = minus the observed 10th percentile (1.2, 1.4, 1.0, 1.6) so the rule fires on about 10% of gated windows, and (k1) k = 1 sigma.
- Alternative evaluator inside the scratchpad: `S <= -k` replaces the `stalled` item's pass/fail (and the adverse cap `progress >= -1` is kept; a version without the cap is counted too), everything else as the engine. The episode lifecycle (enter .7 held 2 s, exit .45, end after 4 s, resume within 20 s, back-dating, grouping over venue and horizon within 10 s) is a replica of `reader-episodes.js step/openEp/endEp/groups`. **Validation: fed with the engine's own scores the replica reproduces the engine's absorption groups exactly (start, detection, end, venues, horizons, side) in 52 of 52 sessions** (45/45 and 38/38 in the other subsets).
- Forward move at `tDetected` in the aggressor's direction, and passive-side refill (the engine's own `refill`: passive depth now over passive depth at window start, absent when the start was thin), compared with matched controls: flow-gated windows on the same session / venue / horizon matched on flow z (3 per detection, random among the 12 nearest in z), outside +-30 s of any current or shortfall group. Control A = flow-gated only. Control B = flow-gated and inside the stalled band (-1 <= progress <= .5), which isolates what the other evidence items add. CIs: session-cluster bootstrap. Shift-null p only for the detection mean against 0.

### Counts (ALL 52 sessions, 25.1 h)

| Rule | groups | per hour | per session min / median / max | overlap with current |
|---|---|---|---|---|
| current (stalled band, engine) | 779 | 31.1 | 0 / 13.5 / 43 | - |
| shortfall, k from the null (spec) | 13 | 0.5 | 0 / 0 / 3 (10 sessions) | 10 of 779 current matched; 9 of 13 shortfall matched; drops 769, adds 4 |
| shortfall, k = observed q10 | 82 | 3.3 | 0 / 1 / 6 (32 sessions) | 58 of 779 matched; 56 of 82; drops 721, adds 26 |
| shortfall, k = 1 sigma | 132 | 5.3 | 0 / 2 / 8 (34 sessions) | 93 of 779; 91 of 132; drops 686, adds 41 |

Without the adverse cap the counts are 22 / 124 / 181. Under all three k the shortfall rule keeps (by group count) 2-17% of what the current rule detects; the current band fires at about 6 to 60 times the rate of the shortfall rule. NO-HOLES: 691 current groups (31.7/h) vs 12 / 68 / 115; COMPLETE: 654 (34.5/h) vs 12 / 63 / 111. The shape is the same.

### Forward move and refill (ALL; mean in sigma; control B in brackets where it changes the reading)

| Set | n groups | H | detections mean [CI] | controls A mean | diff vs A [CI] | diff vs B [CI] |
|---|---|---|---|---|---|---|
| current | 779 (51 sessions) | 10 s | -0.018 [-0.085,+0.049] | +0.149 | -0.167 [-0.265,-0.067] | -0.073 [-0.219,+0.055] |
| | | 30 s | -0.036 [-0.120,+0.035] | +0.155 | -0.190 [-0.297,-0.086] | -0.084 [-0.268,+0.062] |
| | | 60 s | -0.068 [-0.154,+0.013] | +0.151 | -0.219 [-0.369,-0.082] | -0.100 [-0.272,+0.048] |
| shortfall, k = q10 | 82 (32) | 10 s | +0.299 [-0.154,+0.796] (shift p .007) | +0.117 | +0.182 [-0.220,+0.617] | +0.367 [-0.113,+0.843] |
| | | 30 s | +0.152 [-0.190,+0.490] (p .18) | +0.152 | 0.000 | +0.137 [-0.228,+0.502] |
| | | 60 s | +0.068 [-0.261,+0.394] (p .59) | +0.242 | -0.175 | +0.057 |
| shortfall, k = 1 | 132 (34) | 60 s | -0.146 [-0.380,+0.104] | +0.362 | -0.508 [-0.757,-0.272] | -0.205 [-0.546,+0.135] |
| shortfall, k = spec | 13 (10) | 10-60 s | +0.09 / -0.02 / +0.02, CIs span about +-0.6 | | no usable interval | |

Shift-null p for the current detections' mean against 0: .63, .38, .11 (10 / 30 / 60 s): no average continuation or reversal after a current detection, relative to price noise. Control A (flow-gated windows outside detections) continues with the aggressor by +0.15 sigma; the current detections do not, so detection removes a momentum effect; but against control B (same flow, also stalled, no detection) the difference is -0.07 to -0.10 with intervals that include 0, so what the non-band evidence items add to the forward move is not resolved. The "shortfall only" groups (added by the rule): n 26 (q10), 41 (k1), too few to say anything (forward mean +0.63 / +0.50 / +0.37 for q10, intervals about +-1).

Refill (passive depth now / at window start), current detections vs control B: **1.37 vs 1.01**, share >= .8 .77 vs .51, difference of means +0.366 [+0.222,+0.616] (n 620 / 1649). This is partly by construction: refill >= `absorbRefill` is a scored item (weight 1.5 of about 12.5) so detections are selected for it. For the shortfall rule at q10: .98 vs 1.05 (control B), diff -0.067 [-0.287,+0.232]; at k = 1: 1.05 vs 1.05, diff +0.004 [-0.192,+0.224]; at the spec k: 1.43 vs 0.96 on n = 12 (CI [-0.18,+1.53]). The shortfall detections do not show higher passive refill than matched controls except in the 12-group spec case.

### Reading (lead, not proof)
- The hypothesis predicted: fewer detections in thin flow, more in heavy flow with small moves, higher refill in detections than controls. Measured: with k set by the shuffle null the rule is very strict (13 groups) and 0.4-3% of gated windows exceed it; with looser k it detects 10-17% as many groups as the band, mostly where the band also fires (91 of 132 at k = 1), and the groups it adds are few and do not show a refill advantage. The expected refill difference is not seen for shortfall detections (it is seen for the current ones, partly because refill is in the score).
- The forward moves after shortfall detections are not reversals; at q10 the 10 s mean is +0.30 sigma (continuation, shift p .007 raw) and nothing at 30 / 60 s. The current detections show a mild negative at 60 s (-0.07) that is not distinguishable from zero. Neither rule's forward move is large next to a typical |move| of 0.45-0.65.
- Practical limit of the test: the shortfall rule depends on lambda, which here is in sample and unstable on Hyperliquid fast windows (R2 .06); a causal rolling lambda would plausibly do no better than reported (not tested). Binance windows (R2 about .46) are where a shortfall is meaningful.

## D. Which candidate variables were testable

| Candidate (DOABLE TODAY in the research files) | Tested? | Note |
|---|---|---|
| Exhaustion: forward signed move by z_was x ratio strata (exhaustion.md 5.1) | Yes | B above, with shift null and Holm |
| Exhaustion: sweep `exhDecay` .3-.7, `exhNear`; circular-shift null | Yes | tick-level, so no re-replay was needed (the quantities are cfg-independent) |
| Exhaustion: flow z of the current window instead of ratio to the previous | No | the stored rows hold z_was, not the current window's z; easy to add to the hook |
| Exhaustion: Hawkes branching ratio / residual intensity | No | not implemented; needs per-trade series per side and a kernel fit, not attempted |
| Exhaustion: passive-side depth rebuilding near the extreme | No | refill is stored for absorption evaluations only |
| Exhaustion: open interest, basis, funding at the extreme; other venues pushing; Deribit | No | the `ext` tape cadence (OI slower than the 10-300 s horizons) and the cross-venue marks were not joined to the ticks; not attempted here |
| Exhaustion: trade-level liquidation size | No (NEEDS NEW DATA) | |
| Absorption: lambda per venue and session, shortfall in sigma, k from a shuffle null | Yes | in-sample lambda; shuffle of aggressor-signed net flow among gated windows |
| Absorption: forward 10/30/60 s and passive refill vs matched controls | Yes | detections and two control definitions |
| Absorption: byte-comparable group lists for the alternative evaluator | Yes | `absorb_groups_<subset>.json` (current vs three k's, per session, exact fields) |
| Absorption: quote-based OFI at 100 ms; multi-level OFI from 250 ms depth | No | the `q` and `b` input records exist but the OFI build was not attempted in this pass |
| Absorption: Hyperliquid per-level order count `n` | No (cannot) | not stored anywhere (section A) |
| Absorption: Hyperliquid wallet dominance on the passive side | No | the engine's wallet item (aggressor side) is already inside the score; the passive wallet is not in the data |
| Absorption: other venues' response (Coinbase, Bybit, OKX, spot) | No | `ext` not joined |
| Absorption / any: time-of-day adjusted lambda or baseline | No (insufficient) | 8 distinct days and clustered session times; no causal rolling fit either |

## Caveats
- Overlapping windows: ticks and detections are highly dependent; the 5 s stride does not fix that; the session-cluster bootstrap and the shift null address it only partly (shifts of at least 600 s inside one session keep within-session regime structure).
- Sessions are not independent (same days, same regimes; 31 minute auto-recordings on 10-29 are 16 of the 52); only 8 distinct days. 4 sessions never produced an exhaustion group.
- Sigma for forward moves is a whole-session yardstick (as in `reader-scoreboard.mjs`); the engine's own sigma at the time is used inside the absorption shortfall. Price gaps (hole sessions) are treated as zero movement in the shifted series.
- Control A is easy to beat by construction (momentum windows); control B is the fairer one; refill is in the detection score.
- Group forward moves use `tDetected`, which is at least 2 s after the evidence began; the first seconds of any reversal are inside the lag.
- Numbers shown with a raw p are not corrected unless "Holm" is given.

## Reproduce
Scripts (scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\b7c74217-84dd-44c3-a6ab-49a46a09a8c6\scratchpad\`):
- `collect.mjs`: hooked replay, writes `cache/<session>.json` (about 6-8 min for all 52; shard it). `collect_check.mjs` + `CACHE_DIR=<dir>`: same with `--check` (hooked vs plain groups byte-compare).
- `lib.mjs`: loading, price grids, circular shift, bootstrap, Holm.
- `exh.mjs`: `node exh.mjs all|nohole|complete 1000` -> outputs saved as `exh_all.txt`, `exh_nohole.txt`, `exh_complete.txt`.
- `flowpersist.mjs` -> `flowpersist.txt`.
- `absorb.mjs`: `node absorb.mjs all|nohole|complete 1000` -> `ab_all.txt`, `ab_nohole.txt`, `ab_complete.txt`, and `absorb_groups_<subset>.json` (keys `lists.current`, `lists.null5`, `lists.q10`, `lists.fix1`, per session `groups` with family / aggressor / venues / horizons / tStart / tDetected / tEnd).
Commands, in order:
```
cd <scratchpad>
node collect.mjs                      # all sessions (the repo root is read; nothing is written there)
CACHE_DIR=$PWD/chk node collect_check.mjs --check <session.json.gz> ...   # engine identity check
node exh.mjs all 1000 > exh_all.txt ; node exh.mjs nohole 1000 > exh_nohole.txt ; node exh.mjs complete 1000 > exh_complete.txt
node flowpersist.mjs > flowpersist.txt
node absorb.mjs all 1000 > ab_all.txt  (and nohole, complete)
```
To compare group lists byte for byte: load two arrays from `absorb_groups_all.json` (for example `lists.current` and `lists.q10`) and compare `JSON.stringify` per session.
