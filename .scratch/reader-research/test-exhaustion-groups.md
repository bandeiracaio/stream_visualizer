# Test pass: exhaustion groups (second exhaustion pass, v096 engine)

Status: measurement only. Nothing under `src/`, the root `*.mjs` tools, `dist/` or a release html was edited; no detection changed. Everything below is a lead, not proof. No keep-or-drop conclusion is drawn. Language is neutral: aggressor side, no bull / bear.

The first exhaustion pass (`test-exhaustion-absorption.md`, section B) stratified every 1 s tick by flow decay and compared forward moves. The burst note (`test-burst.md` B7) looked at the two-venue composition of exhaustion groups. This pass studies the exhaustion groups the Reader shows, at detection: what price does afterwards, whether that is more than the momentum already in place, and whether anything known at opening separates outcomes.

Data: the 52 `session_BTC_*.json.gz` in the repo root, 25.1 h of span, default thresholds. Quality verdicts: 38 complete, 7 holes, 7 without a verdict. Results are given for ALL (52), NO-HOLES (45, 21.8 h) and COMPLETE (38, 18.9 h). No `reader_labels*.json` exist, so everything is label-free.

Plan (fixed before running, saved as `exh2_plan.md` in the scratchpad): X1 census; X2 forward move at detection with a shift null and a momentum control; X3 splits by the scored items and three continuous quantities at opening; X4 opening score terciles and the number of passing scored items. Not attempted: Hawkes residual intensity, passive-side depth rebuilding, open interest / funding at the extreme, other venues still pushing, trade-level liquidation size.

Method: each session replayed once with a read-only hook appended at `openEp` in an in-memory copy of `reader-episodes.js`; it logs the items and quantities of each exhaustion episode at the moment it opens. The hooked engine gave byte-identical groups to the plain engine on 2 sessions (not all 52). The unit is the group; its items, quantities and venue are those of the group's primary (first-detected) episode, so every split uses only what was known at detection (the venue composition of a group is not used; see `test-burst.md` B6 to B8). Exhaustion runs on the mid horizon only. Sigma = whole-session robust 15 s sigma. Forward move signed in the direction of the previously dominant aggressor (+ = price continued with that side; exhaustion predicts negative), on the primary episode's venue. Session-cluster bootstrap (1000) for intervals; shift null = anchors circularly shifted by at least 600 s against the true price path (K = 400); item differences use label permutation within session (1000); Holm within each table.

## X1. Census (ALL)
- 561 groups = 22.4 per hour; per session min / median / max 0 / 9 / 36; 4 sessions with none (NO-HOLES 464 = 21.3 per hour, COMPLETE 449 = 23.7 per hour).
- Primary venue: Hyperliquid 411, Binance 150. Side: 266 buy, 295 sell.
- Detection to end: p10 / median / p90 = 1 / 5 / 46 s; 17% end within 1 s; median back-dating 2 s.
- After-the-fact resolution: resolved-with 171 (31%), flat 221 (40%), resolved-against 151 (27%), none 18.
- Median values at opening: decay ratio 0.20, earlier flow z 5.2, earlier share 0.86, distance from the extreme 0.45 sigma, trade-count ratio 0.63, trade-size ratio 0.51.

## X2. Forward move at detection (sigma, cluster CI, shift-null p, Holm over 4)

| H | n / sessions | mean [CI] | share above 0 | raw p | Holm | typical random \|move\| |
|---|---|---|---|---|---|---|
| 10 s | 556 / 48 | -0.099 [-0.181, -0.016] | .33 | .080 | .319 | .51 |
| 30 s | 549 / 48 | +0.037 [-0.079, +0.165] | .46 | .589 | 1.00 | .66 |
| 60 s | 539 / 48 | +0.029 [-0.074, +0.136] | .49 | .768 | 1.00 | .69 |
| 300 s | 440 / 43 | -0.159 [-0.290, -0.014] | .39 | .367 | 1.00 | .69 |

The point estimates reproduce the first pass (10 s -0.100, 300 s -0.155). The shift-null p values here are weaker (.08 and .37 against .037 and .011 there): this pass shifts the anchors against the true price path, the first pass shifted price increments against the flow features, so the two nulls are not the same test. NO-HOLES -0.112 at 10 s (Holm .22) and COMPLETE -0.117 (Holm .18); the 30 and 60 s means are about zero in all subsets.

By primary venue: Hyperliquid -0.141 [-0.243, -0.033] at 10 s and -0.180 [-0.329, -0.031] at 300 s (n 406 and 310); Binance +0.015 and -0.110 (intervals include 0). NO-HOLES and COMPLETE: Hyperliquid -0.152 / -0.205 and -0.156 / -0.200. By side: 10 s buy -0.131, sell -0.070; 300 s buy -0.096, sell -0.221 [-0.417, -0.047].

Momentum control (script prints it under X2). Before detection price had pushed with the dominant side: mean +0.597 [+0.503, +0.685] sigma over the 60 s before, +0.877 [+0.764, +1.021] over the 300 s before. The slope of forward on prior move at random moments (random direction) is small (0.04 to 0.06 at 10 to 60 s; -0.02 to -0.08 at 300 s). Observed minus slope times push:

| push window | forward 10 s | forward 30 s | forward 60 s | forward 300 s |
|---|---|---|---|---|
| 60 s | -0.125 [-0.203, -0.042] | +0.005 [-0.114, +0.126] | -0.007 [-0.118, +0.112] | -0.147 [-0.286, -0.011] |
| 300 s | -0.077 [-0.158, +0.005] | +0.045 [-0.071, +0.178] | +0.041 [-0.071, +0.155] | -0.075 [-0.227, +0.074] |

NO-HOLES and COMPLETE, 10 s residual against the 60 s push: -0.132 and -0.139; against the 300 s push: -0.083 and -0.091 [-0.180, -0.009] (the NO-HOLES interval includes 0).

Reading (lead, not proof): after an exhaustion group opens, price on average moves a little against the previously dominant side at 10 s (about a fifth of a typical 10 s move) and again at 300 s, with nothing at 30 and 60 s. The 10 s reversal remains after removing the momentum a 60 s push would predict, and shrinks and loses significance when the push is measured over 300 s. It is concentrated in Hyperliquid-primary groups. Under this pass's null nothing survives correction.

## X3. Splits at opening (A minus B, mean forward move; Holm over 28 tests)
Splits: scored items extreme, poke, count, size (pass against fail); decay ratio low (0.13 or below) against high (0.27 or above); earlier flow z top (8.8 or above) against bottom (3.1 or below); distance from the extreme top (0.64 or above) against bottom (0.22 or below); Hyperliquid against Binance primary. The gate items (decay, was, dominant, atExtreme, stalled) are true at opening by construction.

Pass rates: extreme 95% (534 of 561), size 76%, count 29%, poke 9% (49). Every Holm value is 1.00 in ALL; in NO-HOLES and COMPLETE the smallest are .64 and .61 (raw p .020 and .019). The smallest raw p values in ALL: size at 60 s (pass minus fail -0.250 [-0.499, +0.025], .078), count at 300 s (+0.271 [+0.028, +0.525], .083), extreme at 60 s (+0.472 [-0.025, +0.987], .085 on 27 failing groups). Decay ratio, flow z, distance and venue show nothing at any horizon. Nothing at opening separates the forward move.

## X4. Opening score and number of passing scored items
- The score at opening is almost constant: min / median / max 0.731 / 0.808 / 1.000, with the 1/3 and 2/3 cut points at the same value (0.81), so terciles are degenerate (the middle group is empty). The "high" group (n 438) is -0.114 [-0.190, -0.036] at 10 s and -0.170 [-0.311, -0.018] at 300 s, which restates the overall result.
- By number of passing scored items: 1 item +0.073 / +0.195 / +0.256 / -0.065 at 10 / 30 / 60 / 300 s (n 91); 2 items -0.187 / -0.017 / +0.005 / -0.254 (n 325); 3 items -0.029 / +0.056 / -0.055 / -0.058 (n 133). No consistent trend.

## Candidate variables
| Candidate (exhaustion.md section 6) | Tested? | Note |
|---|---|---|
| Forward move by decay ratio strata | Yes | first pass; here by decay tercile at opening (X3) |
| Flow z of the current window instead of the ratio | No | the engine's decay item compares with the previous window; the earlier-window z is split here |
| Hawkes branching ratio / residual intensity | No | |
| Passive-side depth rebuilding near the extreme | No | |
| Open interest, basis, funding at the extreme; other venues pushing; Deribit | No | collector join not attempted |
| Trade-level liquidation size | No (NEEDS NEW DATA) | |

## Caveats
- Sessions are not independent (8 distinct days; 16 of the 52 are 31-minute auto-recordings). The cluster bootstrap and the 600 s shift null only partly address within-session structure.
- Whole-session sigma is slightly non-causal as a yardstick; forward moves start at `tDetected`, about 2 s after the evidence began.
- The shift null used here differs from the first pass's; compare the point estimates, not the p values, across the two notes.
- The momentum control uses a pooled slope from random moments; the result depends on the push window (60 s against 300 s).
- Hyperliquid is the primary venue in 73% of groups; the Binance-primary stratum is 150 groups.
- The hook was checked for identity on 2 of 52 sessions only.
- The score and item thresholds at opening are discrete (many groups share a score), which limits what the X4 tercile split can show.

## Reproduce
Scripts in the scratchpad `C:\Users\Caio\AppData\Local\Temp\claude\C--Users-Caio-stream-visualizer\55a22191-e94f-46cf-bca0-b2341b91768c\scratchpad\`:
- `exh2_collect.mjs <outdir> [--check]`: hooked replay, one cache file per session (about 10 min).
- `exh2_an.mjs <bcache> <xcache> all|nohole|complete 1000`: X1 to X4 and the momentum control (outputs `exh2_all.txt`, `exh2_nohole.txt`, `exh2_complete.txt`). `bcache` is the per-session price history and sigma cache written by `burst_collect.mjs` (see `test-burst.md`).
