# Cross-venue lead-lag: findings (exploratory, descriptive, 2026-11-08)

Plan and caveats: `plan.md` (read its Amendment 1). Script: `analyze-venue-leadlag.mjs`. Full table: `report.txt` (first run before the amendment: `report-v1-no-age-shift.txt`; per-session numbers: `per-session.json`). **Small-sample, exploratory, nothing here is a test with a verdict or a trading edge.** 192 sessions analysed (187 with the venues collector, 20 files skipped as under 20 minutes), 130.6 grid hours, a large share auto-recordings (volatile-biased).

## What was done
- Reference = Binance perp mid (event stamped). Lead index A = c(+1) - c(-1) of non-overlapping block returns at 1 / 5 / 30 s; A < 0: Binance moved first. Per session, then median [q25, q75], share of sessions above 0, sign-flip p and bootstrap CI across sessions.
- Gap: each venue's deviation from Binance (minus its trailing 10-minute mean) against Binance's next 60 s / 300 s move in sigmas, partial Spearman controlling for the last 60 s move.
- Amendment 1 (made after seeing the first run): snapshots placed at `record time - age`, plus a placebo (Binance perp itself sampled like a venue).

## 1. Who moves first: mostly "the snapshot data is later", with a smaller real remainder at 5 s
Median A across sessions, all regimes:

| venue | 1 s | 5 s | 5 s minus placebo | sessions with A > 0 (5 s) |
|---|---|---|---|---|
| Hyperliquid perp | -0.45 | -0.21 | -0.15 | 1% |
| Binance spot | -0.43 | -0.25 | -0.19 | 2% |
| OKX spot | -0.45 | -0.19 | -0.13 | 1% |
| Bybit spot (last) | -0.43 | -0.16 | -0.10 | 2% |
| OKX perp | -0.43 | -0.14 | -0.08 | 2% |
| Bybit perp | -0.40 | -0.10 | -0.04 | 9% |
| Coinbase spot | -0.34 | -0.07 | -0.01 | 14% |
| PLACEBO (Binance sampled like venues) | -0.29 | -0.06 | 0 | 2% |

- **The 1 s column is not a lead.** The placebo, which is Binance itself, already scores -0.29 at 1 s purely from 2 s snapshots forward-filled. Snapshot venues cannot be read at 1 s. Hyperliquid uses event stamps but its quote stream is slower (about 2.9 against 5.6 quotes a second in the one session checked, and the stored mid changes rarely), so its -0.45 may also be partly its own update rate, not price discovery.
- **At 5 s, after subtracting the placebo, Binance perp leads Binance spot (-0.19), Hyperliquid (-0.15), OKX spot (-0.13) and Bybit spot (-0.10) in 98-99% of sessions; OKX perp (-0.08) a little; Bybit perp (-0.04) and Coinbase (-0.01) are about in step with it.** Coinbase's edge over the placebo at 5 s is the smallest of all; read as "no sign Binance leads Coinbase at 5 s", not "Coinbase leads". The ordering fits that Binance spot, OKX/Bybit spot and Hyperliquid are slower (staler) feeds, not necessarily that they are less informed.
- 30 s: medians are -0.01 to -0.07 (placebo -0.01). Only 55 sessions have 100 or more 30 s blocks; per-regime 30 s cells are empty. Not informative.
- Stable across sessions: the sign is negative in at least 85% of sessions for every venue at 5 s (Coinbase 85%, Bybit perp 91%, the rest 97% or more). The sign-flip p of 0.0001 is the floor of 9999 draws and says only the sign is consistent, not that the size is exact; many sessions are consecutive hours of one market, so they are not independent.
- Volatile vs calm thirds (5 s): no meaningful difference (e.g. Hyperliquid -0.21 vs -0.20, Binance spot -0.20 vs -0.21, Coinbase -0.07 vs -0.06, placebo -0.05 vs -0.05). Nothing in the "leader depends on the regime" direction.

## 2. Does the gap predict Binance's next move: no sign of it
Partial Spearman rho, median over about 186 sessions (placebo excluded): all venues within -0.035 to +0.02, at 60 s and 300 s, e.g. Coinbase +0.019 at 60 s (p 0.03, CI -0.003 to +0.045), Hyperliquid -0.035 at 300 s (p 0.03). Share of sessions positive 0.44-0.55. None survives the Bonferroni line (p < 0.0036 for 14 estimates); the smallest raw p are about 0.03. The spread across sessions (q25 to q75 about -0.1 to +0.1) is far larger than the medians.
- The placebo shows a real artifact in this design: Binance sampled stale against itself gets a *negative* rho of -0.09 (60 s) and -0.16 (300 s) even after controlling for the last minute, so a staleness gap leaks a small negative bias that the control does not fully remove. A venue's true median is therefore, if anything, a little above what is printed. The artifact is smaller than the sessions' own spread but means the near-zero medians cannot be called "exactly zero".
- Power: the per-session sample is a few hundred overlapping points, the effect sizes looked for were of the order of the plan's earlier collector test (about 0.1 or more). Between -0.035 and +0.02 the data say any median effect larger than about 0.05 is unlikely at these horizons, in this window, for this definition of gap; not that no gap information exists (a larger gap or a conditional use, for example only with a very large deviation, was not tested).

## Caveats
- Everything above is volatile-biased (about 150 of 212 files are auto-recordings), 23 Oct to 8 Nov 2026 only.
- Snapshot cadence (about 2 s), `age` semantics (assumed: age of the last message at snapshot time) and clock skew limit anything under about 2 s. The `venues` collector cannot answer "who moves first on a 1 s scale" at all.
- Binance is the reference by choice; the table says how others compare with it, not how Coinbase compares with Bybit.
- The gap partial correlation uses overlapping 10 s samples; session-level tests treat each session as one draw, but neighbouring sessions overlap in market conditions.

## What I'd do next
1. If the 1 s question matters, add event-stamped quote collection per venue (one `q`-style stream each for Coinbase, Bybit, OKX) so a lead below 2 s can be measured; today only Binance and Hyperliquid have it.
2. Repeat Section 1 as pairs not tied to Binance (Coinbase vs Bybit perp, OKX perp vs Bybit perp) on the 5 s scale.
3. Test the gap conditionally (rare large deviations, calm vs volatile, after liquidation clusters) on a pre-registered plan, using the placebo as the baseline; the unconditional medians here do not justify it by themselves.
