# Sigma scale: the measure of "normal price movement"

Status: built (v012).

## What was wrong
`sigmaBps` was the MAD (median absolute deviation) of 1-second returns. On a liquid pair the mid price sits on the same tick for
seconds, so most 1-second returns are exactly zero (BTC, 30-minute live session: 69% on Binance, 82% on Hyperliquid) and the MAD is
exactly 0. The estimate sat on its 0.05 bps floor for the whole run: a constant, not a volatility measure, 8-9x too small
(true 1-second spread about 0.45 bps Binance, 0.38 bps Hyperliquid). Everything measured "in sigmas" was inflated about 10x:
price progress had a typical |move| of 6-7.6 sigma and 5th/95th percentiles near +-17 (about 0.7 and +-1.64 expected for a random
walk). The absorption gate "price stalled" (absorbSigma .5) effectively required less than 0.1 bps of movement over 15 s, and the
burst "price moved" check (burstSigma 1.5) was true for almost any move. Detection never adapted to quieter or busier markets.
Square-root-of-time scaling itself held (std 0.45 bps at 1 s, 2.07 at 15 s, 3.85 at 60 s).

## Decisions (grilling, two rounds)
- Fix the estimator rather than rescale thresholds (so sigma adapts), with a static check as the acceptance test.
- What "right" looks like: price progress in sigmas has a typical |move| of 0.5 to 1.2 and 5th/95th percentiles averaging 1.3 to 3.2 (a random walk gives 0.67 and 1.64; markets trend a little). The upper bounds started at 1.0 and 2.6 and were widened after the ETH and DOGE recordings (see Evidence). These are register settings (`expMedLo/Hi`, `expTailLo/Hi`), tuned in the weekly review.
- Fix before the live week, so no references are built on the old scale.
- Estimator: MAD of overlapping returns over `sigmaLagMs` (15 s), divided by sqrt(lag), so it stays "bps per root second". It stays at the 0.05 floor until 60 samples exist.
- Global: legacy one-off detectors use the same sigma and change with it (one sigma in the engine).
- Thresholds keep their numbers (design intent); detections changed and were compared first by replaying the saved BTC session.
- Validation beyond BTC: ETH and DOGE recordings (15+ minutes each).
- The static check was built first and shown red on the old engine, then green on the new one.

## Evidence
BTC session (97,822 inputs):
- old sigma 0.050 on both venues; static check RED on all four (typical 6.0-7.6, tails +-16-17).
- new sigma 0.465 (Binance) and 0.372 (Hyperliquid) bps per root second; static check OK on all four (typical 0.76-0.81, tails +-1.76-2.15).
- episodes 109 -> 119: absorption 18 -> 25, exhaustion 24 -> 31, burst 7 -> 3, wall 60 -> 60 (walls do not use sigma).
Synthetic market with 72% zero 1-second returns: old engine sigma 0.05, typical 8.1, tails +-19 (red); new engine sigma 0.545 (true 0.68), typical 0.61, tails +-1.46 (green).

ETH (14 min) and DOGE (14 min), new sigma (old sigma was RED everywhere: typical 6-10, tails +-23-28):
- ETH Binance OK (0.93 / 2.44 and 0.68 / 2.31); ETH Hyperliquid just over on tails (2.71 and 2.62 against 2.6).
- DOGE Binance over on both: typical 1.11 / 1.09 (limit 1.0), tails 2.96 / 2.83 (limit 2.6). DOGE Hyperliquid had too little data.
- So the scale error (10x) is gone on all three symbols, and a residual 10-40% excess remains on ETH/DOGE. Probable causes: progress is sampled only when a window has at least 5 trades (busy moments move more than the 30-minute median), and these markets trend slightly over longer horizons (sigma per root second grows with the lag: DOGE 0.47 at 15 s, 0.67 at 30 s, 0.94 at 60 s).
- A longer lag does not help (30 s and 60 s lags were worse on ETH and DOGE), so the lag stays at 15 s.
- The bands (typical 0.5-1.0, tails 1.3-2.6) were written before measuring. The measured range across three symbols is typical 0.58-1.11 and tails 1.48-2.96. Decision (user): widen the upper bounds to 1.2 and 3.2. An old-style error (typical 6-10, tails 16-28) is still far outside.

## Consequences
- Old register files (including `reader_register_2026-10-16.json` saved before this change) hold price progress, gap and late progress on the wrong scale. Do not import them into v012 or later.
- One legacy self-test (squeeze inside the 5-minute range) built its range from +-150 bps swings; with an honest sigma that is high volatility. Its range and burst were rescaled to a realistic size (range +-50 bps, burst +42 bps); the scenario's intent is unchanged.
- `sigmaLagMs` is an engine setting, not a linked threshold.
- Thresholds that are in sigmas (absorbSigma, burstSigma, exhGap, pokeSigma) now mean what they say; whether the numbers are right is for labels and the weekly review.

## Not covered
Other quantities with a known shape could get the same kind of static expectation (z of the rate has a heavy tail by nature, so it is not covered). Only price progress has one for now.
