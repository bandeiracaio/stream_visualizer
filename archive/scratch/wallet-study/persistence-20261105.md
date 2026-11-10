# Do hot wallets stay good? Exploratory follow-up (2026-11-05)

Script: `analyze-wallets-persistence.mjs` (`--selftest`: 6 checks). Written AFTER the registered result was seen (`result-20261105.md`: no feature passed); the registered plan is unchanged. Exploratory: every number below is a place to look, not evidence of an edge. Full output: `persistence-20261105.json`.

What was fixed before running: the score is the registered one (notional-weighted mean signed mid markout 10 s after a wallet's taker trades, in bps); eligibility 30 taker trades in period 1; hot cohort = top 10% of eligible wallets (257 of 2,573 in block A); period 2 = blocks B and C together ("later"); period-2 minimum 10 and 30 taker trades; a robust score (median per-trade markout) as a sensitivity check; rank correlation with a 2,000-shuffle permutation p-value; the hot cohort's pooled later markout against 1,000 random cohorts of the same size drawn from wallets with later data; a baseline over a shorter gap (first half of A against second half of A).

## Results (A -> later)

| period-2 minimum | score | wallets compared | rank correlation | permutation p | hot cohort later | rest later | random cohorts as good |
|---|---|---|---|---|---|---|---|
| 10 trades | dollar-weighted mean | 1,686 | 0.078 | 0.003 | 1.22 bps | 0.49 bps | 3.3% |
| 10 trades | median per trade | 1,686 | -0.004 | 0.88 | 1.24 bps | 0.55 bps | 4.1% |
| 30 trades | dollar-weighted mean | 1,348 | 0.134 | 0.0005 | 1.23 bps | 0.50 bps | 5.1% |
| 30 trades | median per trade | 1,348 | 0.044 | 0.10 | 1.24 bps | 0.55 bps | 4.9% |

By period-1 decile (best first), later pooled markout, 10-trade minimum: 1.21, 0.91, 0.80, -0.26, -0.01, 0.52, 0.19, -0.22, 0.46, 0.41 bps. The top three deciles keep about 1 bps (twice the typical taker's 0.5 bps); the other seven are about 0.2 and noisy.

## Baseline over a shorter gap (first half of A -> second half of A)

Rank correlation 0.08 to 0.17 (p about 0.0005 for the dollar-weighted score, 0.05 to 0.06 for the median), but the top-decile cohort (53 to 67 wallets with later data) did NOT keep its edge: pooled 0.16 to 0.57 bps later against 0.8 for the rest, and random cohorts do as well in 60 to 82% of draws.

## Reading

- Hot wallets stay good only weakly. The dollar-weighted score persists with a small rank correlation (0.08 to 0.13, against 0.52 reported in the paper over ten-day windows with at least 100 orders per wallet), and the median trade shows nothing: what persists is carried by large trades, so a few big prints per wallet can drive it.
- The hot cohort's later markout is about 1.2 bps against 0.5 for everyone else, and a random cohort of the same size matches it in 3 to 5% of draws: borderline, from four views of one comparison, and not reproduced in the shorter-gap baseline (where the top decile did no better than random).
- Every taker has a positive 10-second markout on this tape (about 0.5 bps): that is price impact, not skill, so the hot cohort's edge is about 0.7 bps above that, before any cost.
- This explains the null of the registered study: the cohort's edge is small, unstable and concentrated in big trades, and in a 5-minute window its signed flow is dominated by noise.
- Limits: 99 hours, mostly volatile stretches; wallet scores from 30 trades are noisy (a weak persistence can hide); the cohort definition is the registered one, not tuned.
