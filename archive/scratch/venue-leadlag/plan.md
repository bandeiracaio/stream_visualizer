# Cross-venue lead-lag (exploratory, descriptive)

Status: EXPLORATORY and DESCRIPTIVE. It says where to look; it never keeps or drops anything and changes no detection. Not pre-registered: every session in `sessions/` was available to the author, no hold-out is kept, and nothing here is a test with a verdict. A change to this plan after the first full run is an amendment at the bottom of this file. Script: `analyze-venue-leadlag.mjs` (`--plan`, `--selftest`). Findings: `findings.md`.

## Questions

1. **Who moves first?** Per venue pair, at 1 s, 5 s and 30 s scales: does venue V's price change precede the Binance perp's, or follow it?
2. **Is that stable?** Across sessions (spread, not only a pooled number) and between volatile and calm stretches of a session.
3. **Does the gap predict?** Does a venue's price gap to the Binance perp (after removing its slow offset) predict the next 1 and 5 minutes of Binance perp movement, in sigmas, beyond what the last minute's Binance move already says?

## Data

- Binance perp and Hyperliquid mid: `q` inputs (millisecond stamps), last mid per second.
- Coinbase spot (`cb`), Binance spot (`bnS`), OKX spot (`okS`) and perp (`okP`), Bybit perp (`byL`): `venues` ext records. Bybit spot (`byS`) has a last price only (`l`), no book, and is used as such. These records are snapshots about every 2 s (median 1.99 s), each holding the last value seen with an `age` in ms; the script forward-fills a snapshot's value onto the 1 s grid for at most 4 s.
- Consequence: the 1 s scale is only resolvable for Binance perp vs Hyperliquid (event stamps). Every venue pair that goes through `venues` has a resolution of about 2 s, so its 1 s column is not read as a lead; its 5 s and 30 s columns are.
- One file at a time (read, reduce to 1 s grids, drop); a session without `venues` records counts only for the Binance / Hyperliquid pair. A session under 20 minutes of grid is skipped.

## Method A: lead-lag

- Reference = Binance perp mid. For venue V and scale s in {1, 5, 30} s: non-overlapping log returns r_V[i], r_B[i] over s-second blocks (the 1 s grid, blocks of s points).
- c(k) = Pearson correlation of r_V[i] with r_B[i+k]. Lead index A(s) = c(+1) - c(-1): positive means V moved first (V's block predicts Binance's next block more than Binance's block predicts V's), negative means Binance moved first. Also c(0) and the peak lag in -3..3 blocks are printed.
- Per session estimate with at least 100 blocks; volatile / calm: each block is labelled by the tercile of the trailing 300 s absolute Binance move (top third / bottom third, within the session); the correlation uses blocks of that label only (a lagged pair is kept when both blocks carry it).
- Spread: median, 25th and 75th percentile of A across sessions, share of sessions with A > 0. Uncertainty: (i) sign-flip test of the session A values about 0 (whole sessions flipped, 9999 draws, two-sided), (ii) session bootstrap 95% interval of the median (2000 draws). No claim is made from a single session.

## Method B: gap predicts the next Binance move

- Gap_V(t) = 1e4 * (ln mid_V - ln mid_B) in bps on a 10 s grid. Slow offset removed by subtracting the mean of the same gap over the trailing 600 s (the current point excluded), so a venue's standing basis (Coinbase is USD not USDT, perps carry funding) does not count; the deviation is what is tested. Needs 600 s of history, so each session loses its first 10 minutes.
- Outcome: the Binance perp's forward move at 60 s and 300 s in sigmas, `forwardMove(hist, t, H, 1, sigma)` from `src/js/scoreboard-core.js`, `sigma = sigmaOf(hist)` of the session (hist = the Binance mid once a second, as in `analyze-liquidations.mjs`).
- Control: both the deviation and the outcome are regressed on the Binance move of the previous 60 s (in sigmas, same function) within the session, and the Spearman rank correlation of the residuals is the statistic (partial rank correlation, as `analyze-collectors.mjs`). The venues move in step with Binance, so without this the gap mostly re-reports the last minute.
- Per session at least 60 usable points; then median and quartiles of the per-session rho, share positive, sign-flip two-sided p (9999 draws) and session-bootstrap 95% interval. 7 gaps x 2 horizons = 14 estimates: a Bonferroni line (0.05/14 = 0.0036) is printed next to each p so a lone small p is not read as a finding.

## Caveats written in advance

- Small sample: about 200 sessions of up to one hour; 30 s blocks give about 120 per session, noisy per session. Consecutive samples overlap (10 s grid with 60 and 300 s horizons), so the real number of independent points is far lower than the row count; the session-level tests treat each session as one draw to respect that, and sessions themselves are serially dependent (volatile hours cluster).
- Auto-recordings lean toward volatile stretches (about 150 of 212 files), so "typical" here means "typical of volatile-ish periods".
- Snapshot venues have clock skew and stale values (`age`, `lag` fields are recorded but not used to shift stamps); a lag below about 2 s through `venues` cannot be told from staleness.
- Nothing here is tradeable: no fees, no latency, no fill model.

## Amendments

(none yet)

### Amendment 1 (2026-11-08, after the first full run, which is kept as `report-v1-no-age-shift.txt`)

The first run showed Binance "first" against every venue at 1 s (A about -0.4) and by smaller amounts at 5 s. That cannot be told from sampling: the reference is event-stamped, while the `venues` series are 2 s snapshots forward-filled onto the grid, and the Hyperliquid quote stream (about 2.9 quotes a second) is slower than Binance's (about 5.6). Any staler series shows A < 0 against a fresher one. Changes, made after seeing that result and so exploratory like everything here:
1. Each venues value is placed at `record time - age` (its own `age` field, when it is a number under 30 s) instead of at the record time.
2. A placebo series `plc`: the Binance perp mid read at every venues record and forward-filled exactly like a venue. Its A is the size of the pure sampling artifact; a venue is read as leading or lagging only by how far it sits from the placebo, not from 0.
Unchanged: scales, regimes, tests. The 1 s column for snapshot venues stays unreadable (2 s resolution).
