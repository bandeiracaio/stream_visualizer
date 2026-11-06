# Wallet study: pre-registered plan

Registered 2026-11-05, before the first run on real sessions. Script: `analyze-wallets.mjs` (repo root, offline, `--selftest`, `--plan` prints the constants). This file and the script are committed together; the commit id is the registration. Descriptive and small-sample: the study says where to look, never keep or drop anything on its own.

## 1. Question

Does it help to know WHO is trading on Hyperliquid? Two sub-questions, both about the next 5 minutes of Hyperliquid mid price:

- **Volatility:** is the tape's concentration (one wallet or a few driving it, persistent market makers against everyone else, big block prints) related to how far price moves next?
- **Direction:** does the signed flow of wallets that were historically "good" (a hot cohort), or of persistent wallets versus event wallets, say anything about the next move beyond the anonymous signed flow?

Motivation: every Hyperliquid trade in the saved sessions carries both wallet addresses (`users: [buyer, seller]`); nothing in the Reader uses them. The closest published evidence is arXiv 2611.05218 (wallet-attributed L4 features added about 13% relative out-of-sample R^2 at a 1 s horizon for ridge, 6% for gradient boosting, on BTC, ETH and SOL over 7 test days; its own limitations include post-hoc choices and no multiplicity adjustment). Different horizon, different data, so this is a test of the idea on our tape, not a replication.

## 2. What was seen before registering (disclosure)

Seen, on all 166 sessions (98 recorded hours, 18 Oct to 5 Nov 2026): unconditional descriptive counts of the tape: 1.74 M Hyperliquid trades, 64,511 wallets; the top 10 takers hold 28.5% of taker dollars and the top 100 hold 60%; 385 wallets appear in at least half of the sessions and carry 21.5% of taker dollars; 34% of wallets appear in one session and carry 2.6%; per 5-minute window the median taker HHI is 0.16 (90th percentile 0.44), the median top-1 taker share 31%, about 176 distinct takers; trades of $10k to $100k carry 52% of dollars, $100k to $1M carry 33%. The thresholds below (a hot cohort needs 30 trades, 50 eligible wallets, a persistent wallet is seen in half of A's sessions, a block print is $100k) were set from these counts and from the paper, not from any price outcome.

NOT seen: any relationship between a wallet feature and a price outcome. The script has been run on synthetic tapes (self-test) and, for a parsing check only, on three real sessions where every block was too small to test (it printed "not enough data").

## 3. Data and units

- Sessions: every `sessions/session*.json(.gz)` present at registration (166 files), read with `readInput`. A later run on more sessions is a replication on new data and is reported separately (section 9).
- Per session: the Hyperliquid mid once a second from the recorded `q` records (`hl`), and the Hyperliquid taker trades (`t` records with `v:"hl"`, `users`, `side`, `ntl`). Taker = the buyer if `side` is `buy`, else the seller. Sigma of the session's Hyperliquid mid is `sigmaOf` of `src/js/scoreboard-core.js` (the Scoreboard's ruler, ADR 0004).
- Unit: a non-overlapping window of 300 s from the session's first quote, with at least 20 Hyperliquid trades. Outcome: the Hyperliquid mid move over the next 300 s in sigmas (`forwardMove`), signed (directional family) or absolute (volatility family). The window's own move (control) is the move across the window itself.

## 4. Split

Sessions are ordered by start time and cut by cumulative recorded hours: **A** = first 40% (learn wallet classes, never tested), **B** = next 30% (decide), **C** = last 30% (confirm). A session belongs wholly to the block it starts in. Block A is used only for the two wallet classes:

- **P persistent:** wallets seen on either side of a trade in at least half of A's sessions.
- **H hot:** among wallets with at least 30 taker trades in A (with a mid 10 s later), the top 10% by notional-weighted signed mid markout 10 s after each taker trade, in bps; needs at least 50 such wallets, else there is no hot cohort and the two hot features say "not enough data".

## 5. Features (11, all fixed)

| id | family | definition (per window) |
|---|---|---|
| hhi | V | sum of squared shares of taker dollars |
| top1 | V | taker dollars of the biggest taker over all taker dollars |
| persistShare | V | taker dollars of class P over all |
| blockShare | V | dollars in trades of at least $100k over all |
| nTakers | V | log of the number of distinct taker wallets |
| flow | D | (taker buy dollars minus sell dollars) over all: the anonymous baseline |
| flowP | D | signed taker dollars of class P over all taker dollars |
| flowE | D | signed taker dollars of the other wallets over all taker dollars |
| flowH | D | signed taker dollars of class H over all taker dollars |
| breadthH | D | distinct hot buyers minus distinct hot sellers |
| netP | D | net buying of class P wallets over both sides of every trade, over all dollars |

No direction is asserted for any feature; every test is two-sided. Expected from the literature: flowH and breadthH positive. Known property, stated now: `flowH`, `flowP`, `flowE` are divided by total taker dollars, which block prints of other wallets dilute; `breadthH` is size-free.

## 6. Tests and decision rules

- **Statistic:** partial rank correlation of the feature with the outcome, controlling for: V family, the window's own absolute move and log total dollars; D family, the window's own signed move, and for all D features except `flow` also `flow` (so they must add to the anonymous flow).
- **p-value:** 999 circular-shift permutations of the feature (shifts of at least 5% of the block, keeping the series' own autocorrelation), two-sided; seed 20261105 + feature index (+1000 for C).
- **B decides:** Holm correction across the 11 features; a feature passes B if Holm p <= 0.05 and |rho| >= 0.08.
- **C confirms:** the same sign, raw p <= 0.05 and |rho| >= 0.08.
- **Verdict:** `CONFIRMED` (B and C), `promising, not confirmed in C` (B only), `nothing`, or `not enough data` (a block under 100 windows, no variation, or no hot cohort).
- **Power:** each session loses its last 10 minutes to the forward window and the median session is about 30 minutes, so roughly 800 windows exist in total and B and C will have a couple of hundred each (the first real run prints the exact numbers). With Holm over 11 features the smallest |rho| that can pass B is about 0.18 at 250 windows (raw p about 0.0045, standard error about 0.063). A feature weaker than that will read "nothing" whether or not it is real.

## 7. Reporting

Every row is reported, including "nothing"; the full JSON goes to `.scratch/wallet-study/result-YYYYMMDD.json` and a short write-up to `.scratch/wallet-study/result-YYYYMMDD.md`. The run is made ONCE with this plan. Nothing is added, redefined or re-thresholded after seeing the results; a change is a new registration (section 10) and its results are labelled exploratory. A `CONFIRMED` feature is a hypothesis for the Reader, never a trading claim.

## 8. Known limitations

- Sessions are 158 of 166 auto-recordings, started because volatility rose: relationships may only hold in volatile regimes. 98 hours over 11 days, against the paper's 27 continuous days.
- Wallet classes come from block A (older) and are applied to B and C: a market maker that left is still in P; a wallet that turned informed later is not in H.
- No TWAP or liquidation exclusion (the tape does not flag them), unlike the paper. A wallet address is a pseudonym, not a person; one entity can run many.
- The mid is the recorded quote once a second; markouts use the last quote at or before the trade (at most 2 s old).
- Windows come from sessions only, so shifted series cross session gaps.

## 9. Stage 2 (not part of this registration)

Order slicing / TWAP detection (a wallet repeating similar sizes at regular intervals), liquidation features from the Bybit and OKX data recorded since v122 (`liqPerp`, `oiPerp`), liquidation proximity of followed wallets, and a replication on the sessions recorded after the registration date.

## 10. Amendments

None yet. Format: date, what changed, why, and whether any real-data result had been seen.

## 11. How to run

```
node analyze-wallets.mjs --selftest        # 18 checks on synthetic tapes (a planted signal is found; five null tapes find nothing)
node analyze-wallets.mjs --plan            # the constants and the feature list
node analyze-wallets.mjs                   # the study on sessions/ (a minute or two); add --json for the full result
```
