# Basis, funding and open-interest pressure (exploratory, descriptive)

Written 2026-11-08 BEFORE the script was run on the saved sessions. Status: **exploratory / descriptive**. It says where to look; it never keeps or drops anything, changes no detection and is not a pre-registered test (those are `analyze-wallets` and `analyze-liquidations`). A change to this plan is an amendment at the bottom of this file. Script: `analyze-basis-funding.mjs` (`--plan`, `--selftest`).

## Question
Do the positioning and carry readings the collectors already record say anything about what Binance BTC price does next?
- (a) the size and direction of the move in the next 5 and 15 minutes (sigmas);
- (b) whether a Binance liquidation burst follows.

## Data
Saved sessions, read ONE FILE AT A TIME (sessions/ is 584 MB gz; a full merge ran out of memory before). Per session only a compact table of 10 s rows is kept.
- Price: Binance quote mid from `inputs`, one point a second. Sigma per session: `SCOREBOARD.sigmaOf` (src/js/scoreboard-core.js); moves: `forwardMove`. So a move is in the same ruler as the Reader's scoreboard.
- Features at time t (latest record at or before t, rejected when stale: 60 s, funding 180 s, ratios 300 s):
  1. `basisBps` (record `basis`, bps), 2. `basisChg5` (change over the last 5 min, bps)
  3. `fundBn` (Binance predicted funding, bps per 8 h; record `fundPred`)
  4. `fundSprBnHl` (Binance minus Hyperliquid, both put on a per-8 h scale by their interval), 5. `fundSprBnBy` (Binance minus Bybit)
  6. `oiChgBn5` (% change of Binance open interest over 5 min; `bnDerivs`), 7. `oiChgHl5` (`hlCtx`)
  8. `oiChgBy5`, 9. `oiChgOk5` (Bybit / OKX open interest in coin, 5 min; `oiPerp`, only in sessions from v122, i.e. mostly after 2026-11-06)
  10. `lsAcct`, 11. `lsTop`, 12. `lsTaker` (log of Binance account / top-trader / taker long-short ratios; `ratios`).
- Control: previous 5-minute volatility (root mean square of the 10 s returns, in sigmas).

## Part (a): the move after t
Targets at 5 and 15 min: `abs` (|move|, a size), `sgn` (signed move, a direction), and for the four open-interest features `cont` (move times the sign of the last 5 minutes' return: does it continue). Test = partial rank correlation of feature and target given previous volatility, with a circular-shift permutation p-value (1999 shifts; the same method as `analyze-collectors.mjs`; plain p-values would be meaningless because the windows overlap). Rows with a stale or missing feature are left out of that test only.
- Split: all rows of all sessions in time order; the EARLIER half (equal rows) explores, the LATER half checks. A result is read as "worth a look" only if the earlier half has p <= 0.05 / number of tests AND the later half has the same sign with p <= 0.05. Anything else is noise or unknown (power is small: see `.scratch/new-collector-gate/power-2026-11-06.md`).
- Per-session spread: the same partial correlation inside each session (at least 150 rows), reported as median, quartiles and the share of sessions above 0; this is the check that one long session is not carrying the result.
- Effective sample: rows / 30 (a 5-minute horizon on a 10 s step), printed beside every n.

## Part (b): liquidation bursts
Target: dollars of Binance liquidation trades (the `liq` flag on trades in `inputs`) in the next 5 minutes. Features as above except the Bybit / OKX ones; a `liqPrev5` comparator (dollars in the last 5 minutes) is shown so you can see how much a feature adds over "liquidations just happened". Same control, same test.
- ONLY sessions that started BEFORE the liquidation study cutoff (2026-11-06T03:15:00Z, `.scratch/liquidation-study/plan.md`) are used: the exploration set, whose outcomes were seen. Sessions after it are the registered test set; this script computes no liquidation statistic on them and `analyze-liquidations.mjs` is not run.
- Bybit / OKX liquidations (`liqPerp`) exist only after the cutoff, so they are not used.

## Caveats written in advance
Auto-recordings lean toward volatile stretches (about 150 of 212 files); samples are small and heavily overlapping; the data is about 10 days of one market regime; 56 tests are run so some will look good by chance; nothing here is a trading result and none of it is an out-of-sample test.

## Amendments
(none)

### Amendment 1 (2026-11-08, after a first full run that included a mistake)
The first run dropped every session with fewer than 300 rows (a 60-minute recording yields about 300 rows after the 5-minute look-back and the 5-minute horizon, so only 55 of 197 sessions were kept). That was a coding slip, not a plan choice: a session is now included when it has at least 30 rows (`minSessionRows / 5`); `minRows` (300) stays the minimum for one half of one test, and a session needs 150 rows to enter the per-session spread. The first run's numbers are not used. No feature, target, test or threshold changed.
