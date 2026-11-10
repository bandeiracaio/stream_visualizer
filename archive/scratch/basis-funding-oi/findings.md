# Basis, funding and open-interest pressure: findings (exploratory, descriptive)

Run 2026-11-08 with `node analyze-basis-funding.mjs` (plan and Amendment 1 in `plan.md`; the first run had a session-inclusion slip and is not used). 197 of 212 sessions usable (15 had too little price data). Sessions were read one at a time, 106 s. Nothing here keeps or drops anything.

## Reading
- **Part (a), the move after t: nothing survives both halves.** No feature reaches the Bonferroni line (p <= 0.00089, 56 tests) in the earlier half, so by the plan's rule nothing is "worth a look". Earlier-half correlations are all within |rho| < 0.08, i.e. indistinguishable from zero at this sample (about 580 independent 5-minute blocks per half; the power note says only about 0.11 and up is detectable).
- **Basis (bps) and its 5-minute change: no relation** to the size or direction of the 5 / 15 minute move (|rho| <= 0.1 in both halves). Per session the direction correlation leans negative at 15 min (median -0.14, 18% of 57 sessions positive), which the pooled halves do not show.
- **Open interest changes (Binance, Hyperliquid, Bybit, OKX), alone or as "does it continue" (`cont`): nothing.** All pooled |rho| <= 0.16; the few later-half values near 0.15 to 0.16 (Bybit `cont15` p=0.007, OKX `abs15` p=0.05) come from the v122-and-later sessions only (about 110 independent blocks per half), have no earlier-half support and are what 56 tests produce by chance.
- **Late half only, not confirmed:** `fundBn` and `fundSprBnHl` vs the direction (rho -0.08 / -0.15, p down to 0.0005), `fundSprBnBy` vs the size at 5 min (-0.21, p=0.0005), `lsTop` vs the size (-0.20, p=0.0005). The earlier half is near zero for every one of them (rho within +-0.07), so by the plan these are "early only"-style non-findings read backwards: a relation that is present in one half and absent in the other. The funding-vs-direction ones also lean the same way per session (median -0.2, about 70% of sessions negative, 43 sessions) and are the only ones worth a second look when more data exists; a regime change between the two halves is as likely an explanation as a feature.
- **Part (b), Binance liquidations in the next 5 minutes (151 sessions before the cutoff, 5,782 events, $392M): no feature predicts them** (all |rho| <= 0.21 with p > 0.13 in either half). The only flagged row is `liqPrev` (liquidations in the previous 5 minutes) at rho +0.39 / +0.43: liquidations cluster, which is the 30-second clustering rule seen from the other side and not a finding about positioning.
- **Funding spread and long-short ratios:** both change slowly (funding records every 60 s, ratios every 2 minutes), so a 10 s grid repeats the same value; the effective sample is smaller than the printed one (rows / 30).

## What this does and does not say
It says the plain, always-available readings (carry, positioning, OI change) do not predict next-5/15-minute price size or direction, or liquidation bursts, to the sensitivity of about 0.11 to 0.15. It does not say they are useless: at this power a real effect of 0.08 would be missed about 90% of the time.

## Caveats
- About 150 of 212 files are auto-recordings, so rows lean toward volatile stretches.
- About 10 days, one market regime; overlapping windows (p-values use circular shifts, the effective n is rows / 30).
- 56 tests in part (a): about 2.8 of 56 would show p < 0.05 by chance per half; the earlier half has none and the later half has 10 (funding, long-short and the late-only open-interest rows), which points at a difference between the halves, not at a feature.
- Bybit / OKX open interest exists only in files from v122 (about 2026-11-06 05:00 onward): 25 sessions and about 110 independent blocks per half.
- Part (b) uses only the exploration set (sessions before 2026-11-06T03:15Z). No liquidation statistic was computed on the registered test set, and `analyze-liquidations.mjs` and `analyze-wallets.mjs` were not run. Part (a) did use test-set sessions for price moves only (no liquidation outcome).
- The halves split by time on the rows that have the feature; per-session numbers use sessions with 150 or more rows.

## Full output
```

== (a) the move after t
   197 sessions, 35591 rows (about 1186 independent); the rows that have a feature are split in time into an earlier and a later half; 56 tests, Bonferroni line p <= 0.00089
   feature         target   early (explore)    late (check)       n early/late (eff)   per session: n med [q1 q3] share>0   flag
   basisBps        abs5     +0.000 p=0.9970      -0.069 p=0.3300      17348/17349 (578/578)   73 -0.01 [-0.13 0.13] 47%   
   basisBps        abs15    +0.023 p=0.5420      -0.098 p=0.2245      11684/11684 (389/389)   57 -0.02 [-0.17 0.15] 47%   
   basisBps        sgn5     -0.005 p=0.8735      -0.026 p=0.3945      17348/17349 (578/578)   73 -0.08 [-0.28 0.10] 36%   
   basisBps        sgn15    +0.047 p=0.3460      -0.085 p=0.1250      11684/11684 (389/389)   57 -0.14 [-0.27 -0.03] 18%   
   basisChg5       abs5     -0.015 p=0.4550      +0.018 p=0.3690      17348/17349 (578/578)   73 -0.04 [-0.12 0.17] 48%   
   basisChg5       abs15    +0.025 p=0.3305      +0.006 p=0.8005      11684/11684 (389/389)   57 -0.01 [-0.15 0.11] 47%   
   basisChg5       sgn5     -0.014 p=0.5320      +0.023 p=0.2940      17348/17349 (578/578)   73 0.02 [-0.16 0.14] 51%   
   basisChg5       sgn15    +0.000 p=0.9950      -0.004 p=0.8695      11684/11684 (389/389)   57 -0.08 [-0.17 0.06] 35%   
   fundBn          abs5     +0.004 p=0.8835      -0.085 p=0.5275      17348/17349 (578/578)   43 0.02 [-0.17 0.20] 53%   
   fundBn          abs15    +0.033 p=0.5660      -0.082 p=0.6390      11684/11684 (389/389)   30 -0.03 [-0.39 0.18] 50%   
   fundBn          sgn5     +0.023 p=0.6255      -0.076 p=0.0005      17348/17349 (578/578)   43 -0.21 [-0.36 -0.01] 26%   
   fundBn          sgn15    +0.059 p=0.2980      -0.134 p=0.0090      11684/11684 (389/389)   30 -0.25 [-0.64 0.04] 30%   
   fundSprBnHl     abs5     +0.018 p=0.5680      -0.075 p=0.4080      17348/17349 (578/578)   47 -0.01 [-0.18 0.18] 49%   
   fundSprBnHl     abs15    +0.073 p=0.2125      -0.079 p=0.6290      11684/11684 (389/389)   33 -0.14 [-0.39 0.22] 42%   
   fundSprBnHl     sgn5     +0.002 p=0.9605      -0.065 p=0.0095      17348/17349 (578/578)   47 -0.18 [-0.34 0.03] 30%   
   fundSprBnHl     sgn15    +0.048 p=0.4575      -0.129 p=0.0105      11684/11684 (389/389)   33 -0.13 [-0.47 0.31] 42%   
   fundSprBnBy     abs5     +0.023 p=0.3980      -0.210 p=0.0005      17348/17349 (578/578)   57 0.07 [-0.20 0.20] 58%   
   fundSprBnBy     abs15    +0.046 p=0.3450      -0.262 p=0.0215      11684/11684 (389/389)   44 0.00 [-0.24 0.24] 52%   
   fundSprBnBy     sgn5     -0.043 p=0.1940      -0.040 p=0.6250      17348/17349 (578/578)   57 -0.02 [-0.24 0.20] 44%   
   fundSprBnBy     sgn15    -0.071 p=0.1955      +0.013 p=0.8985      11684/11684 (389/389)   44 -0.06 [-0.36 0.51] 48%   
   oiChgBn5        abs5     +0.021 p=0.4250      -0.007 p=0.8075      17334/17334 (578/578)   73 0.09 [-0.12 0.16] 62%   
   oiChgBn5        abs15    +0.027 p=0.5095      +0.010 p=0.8015      11669/11670 (389/389)   57 -0.02 [-0.15 0.21] 44%   
   oiChgBn5        sgn5     -0.019 p=0.5135      +0.016 p=0.6185      17334/17334 (578/578)   73 0.04 [-0.18 0.22] 53%   
   oiChgBn5        sgn15    -0.032 p=0.4910      +0.053 p=0.2760      11669/11670 (389/389)   57 0.04 [-0.22 0.36] 60%   
   oiChgBn5        cont5    +0.018 p=0.4555      +0.021 p=0.4310      17263/17264 (575/575)   72 0.02 [-0.15 0.17] 56%   
   oiChgBn5        cont15   +0.022 p=0.4940      +0.050 p=0.1270      11633/11633 (388/388)   57 0.03 [-0.17 0.18] 53%   
   oiChgHl5        abs5     +0.002 p=0.9435      +0.022 p=0.4285      17334/17334 (578/578)   73 0.01 [-0.14 0.15] 52%   
   oiChgHl5        abs15    +0.045 p=0.2315      -0.012 p=0.7915      11669/11670 (389/389)   57 0.01 [-0.21 0.17] 53%   
   oiChgHl5        sgn5     -0.049 p=0.1090      -0.031 p=0.3440      17334/17334 (578/578)   73 -0.08 [-0.25 0.09] 36%   
   oiChgHl5        sgn15    -0.016 p=0.7095      -0.018 p=0.6910      11669/11670 (389/389)   57 -0.09 [-0.29 0.09] 35%   
   oiChgHl5        cont5    +0.037 p=0.1430      -0.001 p=0.9845      17263/17264 (575/575)   72 0.03 [-0.13 0.18] 57%   
   oiChgHl5        cont15   +0.017 p=0.5525      -0.030 p=0.3535      11633/11633 (388/388)   57 0.03 [-0.14 0.18] 60%   
   oiChgBy5        abs5     +0.031 p=0.4755      +0.079 p=0.1485       4746/4747  (158/158)   25 0.07 [-0.09 0.22] 64%   
   oiChgBy5        abs15    -0.002 p=0.9750      +0.120 p=0.1205       3366/3367  (112/112)   18 -0.04 [-0.33 0.18] 50%   
   oiChgBy5        sgn5     +0.032 p=0.5830      +0.106 p=0.0950       4746/4747  (158/158)   25 0.07 [-0.08 0.26] 56%   
   oiChgBy5        sgn15    -0.003 p=0.9790      +0.110 p=0.1215       3366/3367  (112/112)   18 0.10 [-0.03 0.21] 67%   
   oiChgBy5        cont5    -0.062 p=0.1705      +0.032 p=0.5535       4688/4689  (156/156)   24 -0.06 [-0.15 0.13] 42%   
   oiChgBy5        cont15   +0.017 p=0.7840      +0.160 p=0.0070       3335/3335  (111/111)   18 0.02 [-0.13 0.19] 56%   
   oiChgOk5        abs5     +0.050 p=0.2470      +0.071 p=0.2205       4746/4747  (158/158)   25 -0.08 [-0.16 0.13] 44%   
   oiChgOk5        abs15    +0.005 p=0.9375      +0.159 p=0.0495       3366/3367  (112/112)   18 -0.02 [-0.17 0.05] 44%   
   oiChgOk5        sgn5     +0.039 p=0.5515      +0.032 p=0.6385       4746/4747  (158/158)   25 -0.04 [-0.10 0.23] 48%   
   oiChgOk5        sgn15    +0.047 p=0.5025      +0.057 p=0.4750       3366/3367  (112/112)   18 0.07 [-0.04 0.16] 61%   
   oiChgOk5        cont5    -0.043 p=0.3105      +0.028 p=0.5855       4688/4689  (156/156)   24 -0.06 [-0.14 0.07] 38%   
   oiChgOk5        cont15   -0.011 p=0.8725      +0.111 p=0.1570       3335/3335  (111/111)   18 -0.00 [-0.13 0.08] 50%   
   lsAcct          abs5     +0.028 p=0.4465      +0.026 p=0.9130      17341/17342 (578/578)   73 -0.04 [-0.21 0.13] 42%   
   lsAcct          abs15    +0.029 p=0.5590      +0.035 p=0.9115      11680/11680 (389/389)   57 0.00 [-0.26 0.22] 51%   
   lsAcct          sgn5     +0.038 p=0.3645      +0.043 p=0.5690      17341/17342 (578/578)   73 0.00 [-0.28 0.22] 51%   
   lsAcct          sgn15    +0.080 p=0.3325      +0.087 p=0.5010      11680/11680 (389/389)   57 -0.11 [-0.35 0.29] 46%   
   lsTop           abs5     +0.002 p=0.9620      -0.204 p=0.0005      17341/17342 (578/578)   73 0.09 [-0.13 0.24] 63%   
   lsTop           abs15    +0.028 p=0.6760      -0.265 p=0.0210      11680/11680 (389/389)   57 -0.09 [-0.29 0.21] 42%   
   lsTop           sgn5     +0.010 p=0.7500      -0.007 p=0.9340      17341/17342 (578/578)   73 0.07 [-0.17 0.27] 59%   
   lsTop           sgn15    +0.026 p=0.7115      +0.076 p=0.6310      11680/11680 (389/389)   57 0.16 [-0.20 0.39] 67%   
   lsTaker         abs5     +0.028 p=0.2770      +0.007 p=0.7970      17341/17342 (578/578)   73 0.04 [-0.11 0.14] 58%   
   lsTaker         abs15    -0.047 p=0.2385      +0.035 p=0.3665      11680/11680 (389/389)   57 -0.01 [-0.28 0.23] 49%   
   lsTaker         sgn5     -0.042 p=0.1930      -0.061 p=0.0540      17341/17342 (578/578)   73 -0.07 [-0.28 0.11] 36%   
   lsTaker         sgn15    +0.005 p=0.9085      -0.045 p=0.3485      11680/11680 (389/389)   57 -0.12 [-0.35 0.22] 42%   

== (b) Binance liquidations in the next 5 minutes (sessions before the cutoff only)
   151 sessions, 26098 rows (about 870 independent); the rows that have a feature are split in time into an earlier and a later half; 11 tests, Bonferroni line p <= 0.00455
   feature         target   early (explore)    late (check)       n early/late (eff)   per session: n med [q1 q3] share>0   flag
   basisBps        liqNext  +0.002 p=0.9845      +0.049 p=0.7395      12621/12621 (421/421)   49 0.02 [-0.17 0.22] 53%   
   basisChg5       liqNext  -0.011 p=0.6665      +0.033 p=0.1340      12621/12621 (421/421)   49 0.01 [-0.15 0.17] 51%   
   fundBn          liqNext  +0.014 p=0.8850      +0.156 p=0.3780      12621/12621 (421/421)   22 0.02 [-0.26 0.26] 55%   
   fundSprBnHl     liqNext  +0.014 p=0.8735      +0.033 p=0.9120      12621/12621 (421/421)   26 0.02 [-0.24 0.28] 54%   
   fundSprBnBy     liqNext  -0.109 p=0.1995      +0.140 p=0.4305      12621/12621 (421/421)   33 0.02 [-0.25 0.27] 55%   
   oiChgBn5        liqNext  -0.018 p=0.6790      +0.034 p=0.4865      12607/12607 (420/420)   48 -0.06 [-0.31 0.13] 48%   
   oiChgHl5        liqNext  -0.008 p=0.8615      +0.049 p=0.2080      12607/12607 (420/420)   48 0.01 [-0.14 0.19] 56%   
   lsAcct          liqNext  -0.114 p=0.4145      +0.163 p=0.1500      12616/12617 (421/421)   49 -0.05 [-0.30 0.28] 47%   
   lsTop           liqNext  +0.012 p=0.8235      +0.214 p=0.2475      12616/12617 (421/421)   49 0.12 [-0.10 0.27] 71%   
   lsTaker         liqNext  -0.001 p=0.9745      +0.030 p=0.5005      12616/12617 (421/421)   49 0.13 [-0.06 0.24] 67%   
   liqPrev         liqNext  +0.385 p=0.0005      +0.430 p=0.0005      13034/13034 (434/434)   51 -0.03 [-0.17 0.14] 49%   WORTH A LOOK

Binance liquidation trades in the exploration sessions: 5782 events, $392,294,415, 151 sessions.
```
