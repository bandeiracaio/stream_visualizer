# Coarse taxonomy for the 350 candidate trade systems

Purpose: replace the fragmented fine tags with 11 to 15 mechanism-based categories per part so per-part distributions can be counted. Categories are neutral: no category is ranked or claimed better. Every system gets one primary category per part (mutually exclusive, collectively exhaustive) and an optional secondary when a part clearly combines two mechanisms. Names below are exactly the names used in `mapping.csv`.

General rules
- Read the written text of the part, not the fine tag.
- Primary = the mechanism or information that does most of the work in that part; secondary only when a second mechanism is clearly part of the same text.
- No generic "other" bucket is used. "none" / "always-on" exist only because those parts can be genuinely empty.

## Part 1 Context / regime

| Category | Definition | Example systems |
|---|---|---|
| always-on | No gating at all, or only a trivial qualifier that is nearly always true. | S002, S025 |
| trend-state | Market is declared trending / persistent (trend filter, above a moving average or VWAP, higher timeframes aligned, trend day, Hurst). | S022, S063 |
| balance-range-state | Market is declared balanced, range-bound or rotating (inside value, range day, chop gate). | S016, S039 |
| volatility-or-activity-state | Gate on realised or implied volatility or activity level (high, low, compressed, spiking, regime switch, volume surge). | S003, S038 |
| book-liquidity-condition | Gate on order-book or execution conditions: spread, depth, thin or one-sided book, wall quality, tape speed, fee tier. | S004, S021 |
| clock-session-calendar | Gate on a time window: session, day of week, weekend, scheduled event, expiry day, funding window, month-end, halving phase. | S014, S105 |
| funding-basis-options-state | Gate on perp funding, basis, premium, long/short ratio, taker ratio, or option skew / gamma state. | S006, S028 |
| oi-liquidation-state | Gate on open-interest level or change, or on liquidation activity / aftermath (cascade, flush, post-liquidation day). | S007, S035 |
| reader-episode-state | Gate on a Reader episode (absorption, exhaustion, burst, wall) or an episode group being present, forming, fading or recently ended. | S008, S116 |
| price-location-or-path-state | Gate on where price is or how it got there: extended move, near a level or VWAP, streak, after a sweep, unfilled profile structure, below the daily open. | S027, S134 |
| cross-market-or-participant-state | Gate on other venues, assets or participants: premium or spread dislocation, venue agreement, breadth, correlation, tracked wallets, outage, depeg, listing. | S012, S059 |
| meta-or-composite-gate | Gate depends on the system itself or a composite: own equity curve, own recent losses / stop-out, engine router, multi-feature score, statistical regime (autocorrelation), overlay on another system. | S029, S239 |

Decision rules for ambiguous cases
- If several states are named, take the one that gates the trade most narrowly. A clock window plus a data state: take the data state unless the window is the whole point (e.g. "Sunday evening" -> clock).
- Reader-episode presence ("absorption episode active", "burst active") is always episode-state, even when funding or volatility is also mentioned (those become secondary).
- "Always on" with only a trivial qualifier (volume at or above normal, one trade per day, feed available) is always-on.
- A condition that is really the trigger restated (e.g. spread beyond 2 sd) is classed by what is observed (cross-market state), not as always-on.

## Part 2 Regions

| Category | Definition | Example systems |
|---|---|---|
| none | No price region is required. | S002, S025 |
| prior-period-extreme | High / low (or open-range extreme) of a completed day, week or multi-day period, including multi-day channel highs. | S001, S033 |
| swing-or-recent-extreme | Swing high/low, recent extreme, move extreme, cascade / flush / sweep / session low, equal highs. | S055, S122 |
| range-or-session-box | Edges or middle of a range or box: compression range, opening range, session range, initial balance, grid range, day range, weekend range. | S005, S105 |
| average-price-or-band | VWAP (session, anchored, weekly), its bands, moving averages, Bollinger bands, means. | S016, S186 |
| volume-profile-level | Volume-profile structure: POC, value area, naked POC, HVN, LVN, single prints, volume shelf, poor highs. | S018, S101 |
| round-number-pivot-fib | Formula-defined levels: round numbers, hundreds, pivot points, Fibonacci retracements. | S019, S222 |
| book-wall-or-touch-level | A level defined by resting liquidity: wall, iceberg refill level, best bid / touch quote, liquidity void, wall corridor. | S004, S111 |
| reader-episode-level | A level or band reported by an episode: absorption band, burst origin / retrace, repeated-absorption price. | S085, S116 |
| positioning-derived-level | A level from positioning or derivatives data: liquidation clusters, wallet liquidation prices, max pain / high-OI strikes, OI-added levels. | S034, S107 |
| time-anchored-reference | A price or time fixed by the clock: daily / weekly / hourly / 4 h open, Friday or US close, funding timestamp, listing open, pre-event price. | S047, S132 |
| flow-indicator-or-pattern-level | A level from a flow indicator or chart pattern: CVD swing / trendline / zero line, delta POC, neckline, flipped support-resistance. | S287, S298 |
| reference-price-or-model-bound | Index or mark price, model-implied bound (implied move), ratio level, frozen price of a silent venue, own stop level. | S183, S227 |

Decision rules for ambiguous cases
- Classify by what defines the price (or time) level, not by its name in the text. VWAP-type and moving-average levels are average-price; session-defined boxes (opening range, Asia range, initial balance, weekend range) are range-or-session-box.
- Levels from the Reader (absorption band, burst origin) are episode-level; resting-size levels (walls, iceberg refill, best bid, voids) are book-level.
- If the text says "None" the region is none even when the trigger implies a level (e.g. price near a 30 min extreme without a named region -> none, secondary swing).

## Part 3 Trigger

| Category | Definition | Example systems |
|---|---|---|
| level-rejection-bounce | Price touches, retests or pulls back to a level / zone and entry is on the rejection or hold (wick, bar close, delta turn, pullback to MA). | S016, S063 |
| sweep-or-failed-break-reclaim | Price pierces a level (or breaks and fails) and returns; entry on the reclaim or reversal (stop run, spring, upthrust, failed breakout, stop-and-reverse). | S019, S033 |
| level-or-range-break | Intraday break or acceptance beyond a level, range, band or zone, with or without confirmation (volume, OI, delta); includes OCO ambushes. | S005, S062 |
| slow-trend-signal | Daily-or-slower systematic trend rule: N-day high / low, moving-average state or cross, Donchian. | S025, S301 |
| price-move-or-distance-threshold | Entry when a return, bar, excursion or distance from a reference exceeds a threshold, followed or faded. | S002, S083 |
| reader-episode-event | Entry on a Reader episode state change: absorption, exhaustion, burst (including bursts after / into other episodes, group consensus, resume). | S001, S114 |
| trade-flow-signal | Entry on signed trade flow: delta, CVD, imbalance, taker ratio, tape rate, trade size, run length, or their divergence from price. | S040, S110 |
| book-depth-and-wall-event | Entry on order-book state: depth imbalance, depth collapse / recovery, spread, queue, micro-price, wall touch / pull / consume, iceberg. | S021, S115 |
| derivatives-positioning-signal | Entry on funding, basis, premium, OI, long/short ratio changes or divergences (OI vs price), carry spreads. | S006, S092 |
| liquidation-event | Entry on liquidation spikes, waves, rate decay, other-venue or wallet liquidations, or approach to a liquidation cluster. | S007, S122 |
| wallet-position-move | Entry on tracked-wallet position changes (consensus, flips, adds, accumulation). | S012, S139 |
| cross-venue-or-asset-divergence | Entry on a difference between venues, contracts or assets: lead-lag, premium, spread, basis between instruments, ratio, breadth, pairs. | S009, S094 |
| options-and-volatility-signal | Entry on options-implied data (DVOL, skew, IV vs RV, gamma proxy) or on a volatility-state change (sigma percentile jump, spike decline). | S011, S167 |
| clock-calendar-or-scheduled-event | Entry at a clock time or after a calendar / exogenous event (session open, funding time, macro release, expiry, depeg, listing, gap time). | S014, S089 |
| composite-or-baseline-entry | Entry rule is trivial, random, structural or composite: random coin flip, buy-and-hold, grid / scale-in fills, score gate, nth-signal, three-engine set, mirror of another system. | S032, S334 |

Decision rules for ambiguous cases
- Class by the observation that fires entry, ignoring the context. If the trigger is a price event at a level, decide by what price does: rejects (level-rejection-bounce), pierces then returns (sweep-or-failed-break-reclaim), goes through and holds (level-or-range-break).
- Reader episode as the trigger -> reader-episode-event even if a level or funding gate is present (those become secondary).
- Liquidation events (own feed, other venues, tracked wallets liquidated, or approach to a liquidation cluster) -> liquidation-event; tracked-wallet position changes -> wallet-position-move.
- A pure derivatives reading (funding, basis, OI, long/short ratio) -> derivatives-positioning-signal; signed trade flow, CVD, delta, tape speed, trade size -> trade-flow-signal; depth, quotes, walls, spread, micro-price -> book-depth-and-wall-event.
- Daily-or-slower rule-based trend entries (N-day high, MA, Donchian) -> slow-trend-signal; intraday break of a level or range -> level-or-range-break.
- Return / distance thresholds (sigma moves, distance from VWAP or level, RSI extreme) -> price-move-or-distance-threshold; time-of-day entries and event reactions -> clock-calendar-or-scheduled-event.
- Always-long, random, grids, scale-in ladders, score gates and "nth signal" filters -> composite-or-baseline-entry.

## Part 4 Thesis / invalidation

| Category | Definition | Example systems |
|---|---|---|
| continuation-momentum | What moved keeps moving: trend, breakout, aggression, burst, compression resolving in the break direction. | S002, S022 |
| mean-reversion-overreaction | Price overshot value / its mean or is too far from a reference and reverts; reversion of a move or range. | S016, S083 |
| passive-defense-of-level | A resting or remembered level is defended (absorption, wall, iceberg, POC, reference level) so price holds or bounces. | S001, S004 |
| trap-and-stop-run | Stops or breakout traders were trapped / harvested by a false move and price returns. | S019, S039 |
| participant-exhaustion | A side (aggressor, passive defender, covering shorts, capitulating sellers, blow-off buyers) has run out of flow or size. | S003, S055 |
| crowding-unwind | Crowded or leveraged positioning (funding, OI, skew, wallets) is squeezed, trimmed or cleared. | S006, S028 |
| forced-flow-dynamics | Liquidation-driven flow continues, ends, propagates across venues, or leaves relief / residual pressure. | S007, S008 |
| informed-or-leading-flow | Another venue, asset, participant or data stream leads and price follows; flow carries information. | S009, S012 |
| convergence-arbitrage-carry | A spread, basis, premium or funding differential closes, or carry is collected. | S046, S087 |
| calendar-or-event-effect | A clock, session, seasonal, calendar or event-driven flow effect. | S014, S089 |
| level-magnet | Price is drawn to a level (POC, gap, max pain, liquidation cluster, round number, wall, VWAP). | S018, S081 |
| volatility-regime-claim | Volatility will expand, contract or is mispriced vs realised; dealer-gamma amplification or damping; compression precedes expansion. | S011, S038 |
| liquidity-microstructure-effect | Thin liquidity, quote withdrawal, spread, queue or impact effects move price briefly; spoof reveal; spread capture. | S021, S112 |
| meta-statistical-or-none | Claim is about the rule set or a statistic (filter adds value, evidence agreement, edge decay, autocorrelation regime, baseline with no thesis). | S032, S072 |

Decision rules for ambiguous cases
- Class by the claimed reason the trade works, not by the label. "Mean-revert" tags are split: price too far from value (overreaction) vs a side running out of size (participant exhaustion) vs someone defending a level (passive defense) vs stops run then price returns (trap).
- Passive defence = a resting or remembered level holds because someone defends it (absorption, walls, icebergs, POC, weekly open). Participant exhaustion = aggressor or defender has run out (exhaustion, capitulation end, short-covering rally ends, wall consumed).
- Forced-flow dynamics covers any liquidation-driven claim (continues, ends, propagates). A liquidation cluster acting as a destination is level-magnet. Crowding unwind covers funding / OI / sentiment extremes being squeezed or trimmed.
- Venue lead / information claims (wallets, spot leads, options flow informed, CVD leads) -> informed-or-leading-flow; spread / basis / funding-differential closing -> convergence-arbitrage-carry.
- Thesis that the rule set has an edge as a statistical or structural claim (checklists, conjunction of weak signs, agreement filters, no thesis) -> meta-statistical-or-none.

## Part 5 Exit

| Category | Definition | Example systems |
|---|---|---|
| elapsed-time-stop | Close after a stated duration (seconds to days) or number of bars. | S002, S083 |
| scheduled-clock-or-calendar-exit | Close at a fixed clock time, session end, calendar date, hour or bar close. | S014, S089 |
| fixed-distance-target | Take profit at a distance in sigma, R, % or bps from entry. | S032, S126 |
| named-level-target | Close when price reaches a named level: VWAP, POC, range mid / edge, prior high, gap level, pivot, index. | S016, S018 |
| retracement-target | Close at a fraction (e.g. 50%) of the preceding move being retraced. | S035, S122 |
| trailing-or-ratchet-stop | Exit via trailing stop in sigma / ATR / swing structure, chandelier, give-back rule. | S005, S022 |
| indicator-normalization-exit | Close when a monitored metric returns to normal: funding, premium, spread, basis, OI, skew, volatility, ratio. | S010, S028 |
| trend-signal-or-stop-only-exit | Close on a slow trend-rule reversal (MA cross, channel, N-day low), chandelier-only, no exit, or disaster stop only. | S025, S301 |
| flow-episode-or-book-state-exit | Close when a Reader episode ends, flow reverses or decays, a wall ends or shrinks, depth is restored or the quote is pulled. | S072, S115 |
| thesis-state-exit | Close when the thesis state fails: wallet flips back, assumption checklist or score decays, state flips, overlay flattens. | S012, S146 |
| scaled-multi-leg-exit | Two or more legs with different exit rules (partial at a target, rest trailed or held). | S003, S101 |
| event-completion-exit | Close after a named event completes: funding payment, funding reset, peg restored, venue resumes. | S151, S311 |
| reverse-hedge-or-reenter-exit | Exit by reversing the position, hedging instead of stopping, or taking profit and re-entering. | S153, S241 |

Decision rules for ambiguous cases
- Class by the exit expected to do most of the closing; stops that are only protective belong to part 6. A target plus a time stop: the target (secondary time).
- A named price level (VWAP, POC, range mid, prior high, gap close, Friday close, opposite edge) is named-level-target; a distance in sigma / R / % is fixed-distance-target; a fraction of the move is retracement-target.
- Metric returning to normal (funding, premium, spread, basis, OI, skew, volatility, ratio) is indicator-normalization-exit; wallet flips, assumption failure, score decay, state flip are thesis-state-exit; Reader episode end, flow reversal / decay, wall end / pull, depth restored are flow-episode-or-book-state-exit.
- Two or more legs with different rules (half off then trail) -> scaled-multi-leg-exit.
- Daily-or-slower systems exiting on MA cross, channel, N-day low, chandelier-only, no exit or disaster stop -> trend-signal-or-stop-only-exit.

## Part 6 Risk / sizing (revised: two fields, 6a and 6b)

This section replaces the Part 6 of taxonomy v1 (a single field that mixed size and stop). The v1 version is kept in `taxonomy-v1.md`; the v1 value is kept in `mapping-v2.csv` as `p6_v1_primary`. Each system gets a primary and an optional secondary for 6a and for 6b, from the written Part 6 text (other parts only where Part 6 points to them).

### 6a Sizing rule

| Category | Definition | Example systems |
|---|---|---|
| fixed-fraction-risk | Size is set so that a stop-out costs a stated fixed fraction of equity (e.g. "0.4% risk"). Genuine default of the pool. | S030, S003 |
| fixed-notional-leverage-or-exposure-cap | Size is a fixed notional, a fixed leverage multiple (1x, 2x), a gross or inventory cap, or a depth-capped notional, with no risk-per-trade fraction stated. | S002, S299 |
| volatility-targeted-size | Position size scaled to a volatility target, sigma percentile, ATR parity or inverse-volatility budget. | S194, S172 |
| signal-or-regime-scaled-size | Size scaled by signal strength, score, z-score, liquidity regime, valuation gap or gap risk. | S123, S240 |
| performance-adaptive-sizing | Size depends on the system own track record: Kelly, posterior, ruin target, drawdown scaling, anti-martingale ladder, MAE-derived cap. | S114, S335 |
| staged-entries-pyramid-grid | Position built in several units: scale-in, pyramid, grid, martingale-like adds, risk split across units. | S116, S237 |
| explicit-leverage-design | Leverage itself is the design variable: leverage that varies by time or volatility, or very high leverage with a micro stop and a liquidation-distance check. | S119, S309 |
| hedged-or-paired-sizing | Two or more legs sized against each other: delta-neutral, pairs, matched notional, hedge ratio, margin buffer. | S046, S152 |
| loss-limit-cooldown-rules | The distinctive sizing-level content is a set of loss or frequency limits: daily loss cap, cooldown, loss-streak shutdown, trade-rate or per-level caps, quit rule; either the only rule, or two or more of them beside a plain risk percent. | S001, S198 |
| size-unspecified-or-vague | Part 6 gives no size, or only a vague one ("small", "tiny", "base sizing"), or only a stop. | S080, S173 |

Decision rule for 6a (apply in this order; the first that fits is the primary, the next one that fits is the secondary)
1. A multi-unit build (staged, pyramid, grid, martingale-like) -> staged-entries-pyramid-grid.
2. Legs sized against each other (pair, hedge, matched notional) -> hedged-or-paired-sizing; but a pair with an explicit risk percent on its own leg is fixed-fraction-risk with hedged as secondary.
3. Size driven by the system's own results (Kelly, posterior, drawdown, ruin, anti-martingale, MAE) -> performance-adaptive-sizing.
4. Size driven by volatility level (target, percentile, ATR parity, inverse volatility) -> volatility-targeted-size.
5. Size driven by a signal, score, z-score or regime other than volatility -> signal-or-regime-scaled-size.
6. Leverage that varies, or leverage as the headline with a micro stop -> explicit-leverage-design. Plain "risk X%, max leverage 3x" is not this: it is fixed-fraction-risk, with the leverage cap as secondary.
7. Two or more distinct loss or frequency rules (daily cap, cooldown, loss-streak halt, trade-rate or per-period cap, per-level cap, quit rule), or such rules as the only rule -> loss-limit-cooldown-rules. One such rule beside a stated risk percent stays secondary.
8. A stated percent of equity at risk -> fixed-fraction-risk.
9. Fixed notional, 1x, gross or inventory caps -> fixed-notional-leverage-or-exposure-cap.
10. Otherwise size-unspecified-or-vague.
Tie-breaks: a stated number beats a vague word ("small"); "small size" next to a stated risk percent is fixed-fraction-risk. Position-count limits ("max 1") are not sizing on their own.

### 6b Stop type

| Category | Definition | Example systems |
|---|---|---|
| structure-anchored-stop | Stop placed relative to a named price reference: level, extreme, wick, sweep, range edge or middle, band, wall, VWAP, POC, swing, retracement of the move. An offset in sigma, bps or percent beyond the reference does not change the class. | S005, S030 |
| sigma-multiple-stop | Stop at a multiple of sigma, ATR or implied move from entry, with no named price reference. | S002, S010 |
| fixed-percent-stop | Stop at a fixed percent distance from entry (written as % or percent), including wide percentages. | S025, S102 |
| fixed-bps-stop | Stop at a fixed distance in basis points from entry (tick-scale, microstructure systems). | S009, S111 |
| spread-or-relationship-stop | Stop defined on a spread, basis or pair relationship instead of one price. | S046, S094 |
| state-or-inventory-triggered-stop | Protective exit defined by a non-price state: wall end, inventory units, distance to liquidation. | S299, S147 |
| adaptive-or-data-derived-stop | Stop distance learned from data or changing over time: MAE-derived cap, widening stop. | S141, S193 |
| no-price-stop-or-disaster-only | Part 6 states there is no per-trade price stop, or only an explicit disaster stop. | S165, S310 |
| unspecified | Part 6 text does not say where the stop is (only a risk percent, a size, or a bare word such as "Stop above"). | S171, S232 |

Decision rule for 6b
1. If Part 6 says there is no price stop (or only a disaster stop) -> no-price-stop-or-disaster-only.
2. A stop defined on a spread, basis or pair -> spread-or-relationship-stop; defined by a non-price state -> state-or-inventory-triggered-stop; learned or changing distance -> adaptive-or-data-derived-stop (secondary when the stop also has a starting reference).
3. A named price reference (even with an offset) -> structure-anchored-stop. A retracement fraction of the move counts as a reference.
4. Otherwise by the unit written, measured from entry: sigma / ATR / implied move -> sigma-multiple-stop; percent -> fixed-percent-stop; bps -> fixed-bps-stop.
5. A quit rule, cooldown or "stop after N losses" is not a price stop. If nothing above applies -> unspecified. Unspecified is used only when the Part 6 text does not say.
Secondary 6b is used rarely (only when a second mechanism is written).

## Part 7 Evaluation (revised v3)

This section replaces v2's Part 7 (14 categories); the old text is kept in `taxonomy-v2.md`. Reason: a second rater matched v2 only 78% of the time because many plans combine methods. v3 has 11 categories organised by one question: **what is the main thing the evaluation compares the result against, or which main check does it rely on?** Names are those used in `mapping-v3.csv` (`p7_primary`, `p7_secondary`; the v2 value is kept in `p7_v2_primary`).

| # | Category | One-line definition | Examples |
|---|---|---|---|
| 1 | label-or-scoreboard-precision | Judged with the repo labels or scoreboard (agree / disagree precision, Wilson interval, per-family scoreboard). | S174, S329 |
| 2 | random-or-placebo-baseline | Against artificial or non-event controls: random or shuffled entries, times, days, directions, shifted or placebo levels or clocks, coin-flip, same clock on non-event days, label permutation. | S121, S226 |
| 3 | passive-benchmark-comparison | Against a passive or reference strategy: buy-and-hold, cash or T-bill, always-long, equal-weight, or the system that serves as the null for all others. | S194, S302 |
| 4 | variant-or-component-comparison | Against its own variants or other rules on the same data: ablation (with / without a condition), per-leg attribution, mirror or opposite, fade vs follow, another numbered system, exit / stop / sizing alternatives, matched natural events lacking the feature, definition sensitivity (variants of a definition). | S020, S104 |
| 5 | out-of-time-or-asset-validation | Against unseen data: walk-forward, hold-out, train / test, other asset, out-of-sample year or months, sign or parameter stability across periods. | S125, S158 |
| 6 | regime-or-subgroup-split | Result split by regime, session, hour, weekday or weekend, volume level, event present / absent; the kill rule is about the subgroups. | S128, S214 |
| 7 | tail-or-failure-profile | Decision is made on drawdown, tail loss, worst cycle, MAE, ruin probability, whipsaw or failure rate. | S238, S243 |
| 8 | cost-and-execution-stress | Decision is made net of fees, latency, slippage, fill realism, adverse selection, impact, funding or fee break-even, with nothing else compared. | S124, S149 |
| 9 | dose-response-or-calibration | Buckets, percentiles, monotonic response, calibration by score, quadrant tables: does the outcome change with signal strength. | S136, S240 |
| 10 | statistical-test-on-effect | A formal test on the effect itself: bootstrap interval, sign test, deflated Sharpe, SPRT, Bayesian posterior, multiple-comparison correction, with no external comparator. | S105, S201 |
| 11 | descriptive-or-no-comparison | No comparator and no specific check: sample-size requirement only, plain net expectancy / hit rate / payoff, event study of the path, rare-event or anecdotal reporting, "X sample" or "X count". | S018, S150 |

### Decision procedure (assign p7_primary, then p7_secondary)

Step 0. Split the Part 7 text into clauses at ";" or sentence ends. A clause is **decisive** if it contains a kill or decision word: "drop if", "kill if", "must", "require" (not "require at least N"), "keep only", "only justified", "should fail", "stop at", "judge on", "look at", "focus on". Clauses that only give a sample size ("at least N", "need N", "thousands of trades") or a caveat never decide.

Step 1. Apply the checks below **in this order** to the decisive clauses; the first check that applies is the primary. If no decisive clause names any check, use the whole text and pick the **first-listed check** among categories 1 to 6 and 9 (the comparators); categories 7, 8 and 10 are metrics and win only if no comparator is named.
1. Repo labels, agree / disagree, scoreboard or precision -> label-or-scoreboard-precision.
2. Random, shuffled, permuted, placebo, shifted or offset level / clock, coin-flip, same clock on non-event days or holidays -> random-or-placebo-baseline.
3. Buy-and-hold, cash, T-bill, always-long, equal-weight, "the benchmark" or "the null" -> passive-benchmark-comparison. ("Sharpe vs flat" means flat sizing, so category 4.)
4. Ablation, with / without, mirror, opposite sign, another system or rule (S-number), exit / stop / sizing variant, per-leg attribution, matched natural events without the feature, a "control" built from natural events, definition variants -> variant-or-component-comparison.
5. Walk-forward, hold-out, out-of-sample, other asset, confirming half, stability across months or sub-periods -> out-of-time-or-asset-validation.
6. Split by regime, session, hour, weekday / weekend, volume level, event present / absent -> regime-or-subgroup-split.
7. Drawdown, tail, worst loss, MAE, ruin, whipsaw, failure rate, Calmar -> tail-or-failure-profile.
8. Fees, latency, slippage, fill, adverse selection, impact, break-even, funding-inclusive PnL -> cost-and-execution-stress.
9. Buckets, percentiles, monotonic, calibration, quadrant table -> dose-response-or-calibration.
10. Bootstrap, sign test, deflated Sharpe, SPRT, Bayesian, multiple testing -> statistical-test-on-effect.
11. Nothing above (counts, plain expectancy, event study, rare / anecdotal / exploratory) -> descriptive-or-no-comparison.

Step 2. Secondary = the next check, by the same order (decisive clauses first, then the rest of the text), that is present and differs from the primary; empty if none, and always empty when the primary is category 11.

Tie-breaking rules (from the nine disagreement cases)
- An "event study" or "exploratory" label never beats a named comparator: "event study ... versus random distances" is category 2; a bare "event study" is category 11.
- A named comparator beats the metric it is judged on: "compare filtered vs unfiltered by max drawdown" is category 4 (secondary 7). Only when the kill or judging clause is itself in tail terms ("judge on worst drawdown", "kill if average MAE > 0.8 R") is it category 7.
- A kill clause beats a descriptive prefix: "expectancy by regime ... must beat entering on touch with no confirmation" is category 4 (secondary 6); "walk-forward ... kill if average MAE exceeds" is category 7 (secondary 5); "compare to buy and hold; require positive Sharpe in each sub-period" is category 5 (secondary 3).
- Sensitivity to a definition (variants of the definition) is category 4; a placebo (shifted or random level) is category 2.
- Bare "net of fees / slippage / latency" with nothing compared is category 8, not 11; "Net expectancy; at least N trades" with no fee point is category 11.
- A unit word ("per session", "day sample", "weekend sample") is not a split; with no comparison it is category 11.
