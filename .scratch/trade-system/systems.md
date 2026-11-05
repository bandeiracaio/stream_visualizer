# Candidate trade systems (S001..S100)

Date: 2026-11-03. Purpose: a deliberately varied pool of 100 automated trade-system designs for crypto perpetuals (mostly BTC), for a later Monte Carlo-style study of design choices. Coverage, not curation: no ranking, and no system is claimed to have an edge. Thresholds are rough starting points, not tuned values.

Every system is described by 7 parts: (1) Context/regime, (2) Regions, (3) Trigger, (4) Thesis and invalidation, (5) Exit, (6) Risk and sizing, (7) Evaluation. "Uses repo" names existing components (Reader episodes, sigma, collectors, futures stack, paper broker); anything the repo lacks is flagged "needs data not in repo". Sigma = scale of normal price movement (repo `sigmaBps`).

### S001 — Absorption at prior-day extreme
- **Style tag**: exhaustion-fade
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes:absorption, sigma, paper-broker
- **1 Context**: Balanced market-state (not trending); sigma not in top quintile of last 7 days.
- **2 Regions**: Within 0.3 sigma of prior-day high or low.
- **3 Trigger**: Absorption episode becomes active with the passive side holding at the region; enter in the passive side's direction.
- **4 Thesis / invalidation**: Aggressive flow is being absorbed by resting size so price stalls. Invalid if a 1 m bar closes 0.5 sigma beyond the region or the episode ends with no bounce.
- **5 Exit**: Target 1.5 sigma or VWAP, whichever is nearer; exit on episode end; 45 min time stop.
- **6 Risk / sizing**: Stop 0.7 sigma beyond region; risk 0.5% equity; 1 position; 2% daily loss cap; 20 min cooldown after a loss.
- **7 Evaluation**: Net expectancy in R, at least 60 trades; drop if expectancy <= 0 after 60; must beat random entries at the same regions.
- **Part tags**: context=balanced; regions=prior-hl; trigger=absorption-ep; thesis=mean-revert; exit=target; risk=fixed-r; eval=vs-random-entry

### S002 — Five-minute momentum, time stop only
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: When the last 5 min return exceeds +1.5 sigma (or below -1.5), enter in that direction at market.
- **4 Thesis / invalidation**: Short-term returns persist a few minutes. Invalid if the next 1 min return reverses more than 1 sigma.
- **5 Exit**: Pure time stop at 10 min.
- **6 Risk / sizing**: Hard stop 2 sigma; fixed notional 1x equity; one position; no cooldown.
- **7 Evaluation**: Mean net return per trade vs same system with shuffled entry times; at least 200 trades; drop if not above shuffled 95th percentile.
- **Part tags**: context=always-on; regions=none; trigger=price-break; thesis=continuation; exit=time-stop; risk=fixed-r; eval=shuffled-time

### S003 — Exhaustion fade after burst
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:exhaustion, reader-episodes:burst, sigma
- **1 Context**: Not within 15 min of a scheduled event; sigma above 7-day median.
- **2 Regions**: None required; price near a 30 min extreme.
- **3 Trigger**: Burst episode ends and an exhaustion episode is active in the same direction; fade it.
- **4 Thesis / invalidation**: The aggressor ran out of flow at the extreme. Invalid if the extreme is exceeded by 0.3 sigma.
- **5 Exit**: Half off at 0.8 sigma retrace, rest at 1.5 sigma or flow reversal; 20 min time stop.
- **6 Risk / sizing**: Stop at extreme + 0.3 sigma; stop distance equals 0.5% equity risk; 1 open; 3 losses in a row halts the day.
- **7 Evaluation**: Win rate and payoff; at least 50 episodes; drop if precision (agree labels) Wilson interval sits under 50%; baseline: fade at random times after a 1.5 sigma move.
- **Part tags**: context=vol-high; regions=none; trigger=exhaustion-ep; thesis=mean-revert; exit=scaled; risk=sigma-sized; eval=hit-rate-payoff

### S004 — Wall touch bounce
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall, collectors:wall-quality, collectors:book-depth
- **1 Context**: Wall quality high (persistent over 2 min, not flickering); spread normal.
- **2 Regions**: The wall price.
- **3 Trigger**: Price within 2 bps of a wall at least 5x median level size; passive limit entry on the near side.
- **4 Thesis / invalidation**: Real resting size defends the level. Invalid if the wall is pulled (size falls 50%) or price trades through by 1 bp.
- **5 Exit**: Target 1 sigma; immediate exit on wall pull.
- **6 Risk / sizing**: Stop 3 bps through the wall; risk 0.3%; max 2 positions on different walls.
- **7 Evaluation**: Net expectancy with a conservative fill model (filled only if traded through by one lot); at least 100 touches; drop if fill-adjusted expectancy < 0.
- **Part tags**: context=liquidity-thin; regions=wall; trigger=wall-ep; thesis=mean-revert; exit=thesis-fail; risk=fixed-r; eval=expectancy-baseline

### S005 — UTC opening range breakout
- **Style tag**: breakout
- **Horizon tag**: hours
- **Uses repo**: none
- **1 Context**: Skip if opening range width is under 0.5x or over 3x its 14 day median.
- **2 Regions**: High/low of first 60 min after 00:00 UTC.
- **3 Trigger**: First 5 m close beyond the range, in that direction.
- **4 Thesis / invalidation**: Early range sets the day's direction. Invalid if price closes back inside the range.
- **5 Exit**: Chandelier trail 2x range width; hard exit 20:00 UTC.
- **6 Risk / sizing**: Stop at range midpoint; 0.5% risk; one trade per day.
- **7 Evaluation**: Per-day return distribution, at least 120 days; baseline: same entry at random time of day.
- **Part tags**: context=balanced; regions=opening-range; trigger=price-break; thesis=continuation; exit=trailing; risk=fixed-r; eval=vs-random-entry

### S006 — Funding extreme unwind
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors:derivatives-context, collectors:market-state
- **1 Context**: Funding in top (or bottom) 5% of its 30 day range and open interest rising for 3 days.
- **2 Regions**: Prior 4 h swing low (high).
- **3 Trigger**: First 15 m close through the 4 h swing against the crowded side.
- **4 Thesis / invalidation**: The crowded side pays to hold and will be forced out. Invalid if funding normalises without a price move or price makes a new extreme.
- **5 Exit**: 30 min after the next funding print, or 2 sigma(1h) target.
- **6 Risk / sizing**: Stop beyond the 4 h extreme; 0.4% risk; 1 position; leverage 3x max.
- **7 Evaluation**: Mean return per signal; at least 40 (likely slow to reach); drop if the sign differs between first and second half; baseline random entry same hold.
- **Part tags**: context=funding-extreme; regions=swing; trigger=price-break; thesis=crowding-unwind; exit=time-stop; risk=low-lever; eval=ablation

### S007 — Liquidation spike fade
- **Style tag**: liquidation
- **Horizon tag**: minutes
- **Uses repo**: futures-stack, collectors:forced-flow
- **1 Context**: 5 s liquidation volume above 4x its 1 h median; not a trending state.
- **2 Regions**: None.
- **3 Trigger**: Futures-stack highlight (spike, same-side delta, falling open interest); enter opposite 30 s after the spike peak.
- **4 Thesis / invalidation**: Forced sellers are done and price overshoots. Invalid if a second spike at least half size appears within 2 min.
- **5 Exit**: Half the spike move retraced, or 15 min time stop.
- **6 Risk / sizing**: Stop at spike extreme + 0.2 sigma; 0.4% risk; 10 min lockout after exit.
- **7 Evaluation**: Net expectancy, at least 60 spikes (weeks of data); baseline: same entry after random 5 s bins with equal price move.
- **Part tags**: context=vol-high; regions=none; trigger=liq-spike; thesis=forced-flow-ends; exit=target; risk=fixed-r; eval=vs-random-entry

### S008 — Liquidation cascade ride
- **Style tag**: liquidation
- **Horizon tag**: seconds
- **Uses repo**: futures-stack, collectors:forced-flow, reader-episodes:burst
- **1 Context**: Burst episode active.
- **2 Regions**: None.
- **3 Trigger**: Two consecutive 5 s bins with liquidations above 3x median and same-side delta; enter with the cascade.
- **4 Thesis / invalidation**: Cascades self-feed through stops. Invalid if the next 5 s bin liquidations fall under 1x median.
- **5 Exit**: Liquidation rate halves, or 90 s.
- **6 Risk / sizing**: Stop 0.5 sigma; small size (0.2% risk) due to slippage; max 1.
- **7 Evaluation**: Net of 2x assumed slippage; at least 80 cascades; drop if slippage-adjusted expectancy <= 0.
- **Part tags**: context=vol-high; regions=none; trigger=liq-spike; thesis=continuation; exit=flow-reversal; risk=fixed-r; eval=expectancy-baseline

### S009 — Binance leads Hyperliquid
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors:extra-venues, collectors:who-moved-first
- **1 Context**: Spread normal on both venues; latency to both under 300 ms.
- **2 Regions**: None.
- **3 Trigger**: Binance mid moves 1 bp within 2 s while Hyperliquid has not; take Hyperliquid in that direction.
- **4 Thesis / invalidation**: Binance leads discovery and Hyperliquid catches up. Invalid if the gap does not close in 5 s.
- **5 Exit**: Gap closes or 5 s.
- **6 Risk / sizing**: Stop 3 bps; notional capped by Hyperliquid depth at 1 bp; max 1.
- **7 Evaluation**: Net of taker fees and measured latency; at least 500 signals; drop if mean < fee cost.
- **Part tags**: context=liquidity-thin; regions=none; trigger=leadlag; thesis=lead-propagates; exit=time-stop; risk=fixed-r; eval=expectancy-baseline

### S010 — Coinbase premium trend
- **Style tag**: cross-venue
- **Horizon tag**: hours
- **Uses repo**: collectors:extra-venues
- **1 Context**: US session (13:30-21:00 UTC).
- **2 Regions**: Session VWAP.
- **3 Trigger**: Coinbase minus Binance premium above its 7 day 80th percentile for 30 min with price above VWAP: long. Mirror for discount.
- **4 Thesis / invalidation**: US spot demand leads. Invalid if the premium returns to median.
- **5 Exit**: Premium back to median, or 21:00 UTC.
- **6 Risk / sizing**: Stop 1.5 sigma(1h); 0.5% risk; one position.
- **7 Evaluation**: Mean return per session vs always-long during US hours; at least 60 sessions.
- **Part tags**: context=session; regions=vwap; trigger=leadlag; thesis=lead-propagates; exit=thesis-fail; risk=fixed-r; eval=vs-buy-hold

### S011 — DVOL spike fade
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors:options-lens
- **1 Context**: DVOL up more than 10% in 1 h.
- **2 Regions**: None.
- **3 Trigger**: Realised 1 h vol is below the implied hourly move; fade the last hour's direction at market.
- **4 Thesis / invalidation**: Implied vol overprices continuation. Invalid if realised vol exceeds implied hourly vol.
- **5 Exit**: 2 h time stop.
- **6 Risk / sizing**: Stop 1 implied-hourly sigma; 0.3% risk.
- **7 Evaluation**: Compare to fade on random hours; at least 50 spikes.
- **Part tags**: context=vol-high; regions=none; trigger=vol-shift; thesis=vol-mispriced; exit=time-stop; risk=fixed-r; eval=vs-random-entry

### S012 — Tracked-wallet consensus follow
- **Style tag**: wallet
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors:followed-wallets
- **1 Context**: At least 3 of the 10 tracked wallets act the same way within 10 min.
- **2 Regions**: None.
- **3 Trigger**: Net tracked notional change above a threshold in one direction; enter same direction.
- **4 Thesis / invalidation**: Large traders carry information or flow. Invalid if the same wallets reduce within 15 min.
- **5 Exit**: Wallets flatten, or 60 min.
- **6 Risk / sizing**: Stop 1.5 sigma; 0.3% risk; one position.
- **7 Evaluation**: Hit rate vs random direction at same times; at least 80 events. Caveat: wallet set is chosen with hindsight (selection bias).
- **Part tags**: context=always-on; regions=none; trigger=wallet-move; thesis=info-follow; exit=thesis-fail; risk=fixed-r; eval=vs-random-entry

### S013 — Wallet liquidation fade
- **Style tag**: wallet
- **Horizon tag**: minutes
- **Uses repo**: collectors:followed-wallets, collectors:forced-flow
- **1 Context**: A tracked wallet has a liquidation fill.
- **2 Regions**: None.
- **3 Trigger**: 20 s after the fill, enter against the liquidation direction.
- **4 Thesis / invalidation**: A forced market order pushes price past fair value. Invalid if more wallet liquidations follow within 60 s.
- **5 Exit**: 10 min time stop.
- **6 Risk / sizing**: Stop 0.8 sigma; 0.2% risk.
- **7 Evaluation**: Rare; need at least 30 events, otherwise report inconclusive.
- **Part tags**: context=always-on; regions=none; trigger=wallet-move; thesis=forced-flow-ends; exit=time-stop; risk=fixed-r; eval=expectancy-baseline

### S014 — Pre-event drift
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: collectors:event-clock
- **1 Context**: 2 h before US CPI / FOMC (calendar rule tags).
- **2 Regions**: None.
- **3 Trigger**: At T-2h go with the prior 24 h direction.
- **4 Thesis / invalidation**: Positioning drifts into events. Invalid if price crosses the 24 h open against the position.
- **5 Exit**: Close at T-1 min.
- **6 Risk / sizing**: Stop 1 sigma(2h); 0.3% risk.
- **7 Evaluation**: About 20 events a year: underpowered. Compare with same clock time on non-event days.
- **Part tags**: context=event-window; regions=none; trigger=time-clock; thesis=calendar-drift; exit=time-stop; risk=fixed-r; eval=vs-random-entry

### S015 — Post-event reversal
- **Style tag**: time-event
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors:event-clock, sigma
- **1 Context**: Within 10 min after a scheduled event.
- **2 Regions**: Pre-event price.
- **3 Trigger**: Event spike of at least 2 sigma, then 30% retrace; enter toward pre-event price.
- **4 Thesis / invalidation**: The knee-jerk overshoots. Invalid if price makes a new extreme.
- **5 Exit**: Pre-event price reached, or 40 min.
- **6 Risk / sizing**: Stop at new extreme; 0.3% risk.
- **7 Evaluation**: Few events; report wide intervals; pool all event types.
- **Part tags**: context=event-window; regions=swing; trigger=price-reject; thesis=mean-revert; exit=target; risk=fixed-r; eval=expectancy-baseline

### S016 — VWAP band reversion
- **Style tag**: mean-reversion
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **1 Context**: Balanced day (price crossed VWAP at least 3 times in 4 h).
- **2 Regions**: Session VWAP +/- 2 standard deviations.
- **3 Trigger**: Touch of outer band then a 1 m close back inside; trade toward VWAP.
- **4 Thesis / invalidation**: Price oscillates around fair value. Invalid if two 5 m closes outside the band.
- **5 Exit**: VWAP.
- **6 Risk / sizing**: Stop 0.5 sigma outside band; 0.4% risk; max 2.
- **7 Evaluation**: Expectancy by regime; at least 100 trades; must beat entering on touch with no confirmation.
- **Part tags**: context=balanced; regions=vwap; trigger=price-reject; thesis=mean-revert; exit=target; risk=fixed-r; eval=ablation

### S017 — Value area 80% rule
- **Style tag**: volume-profile
- **Horizon tag**: hours
- **Uses repo**: none (needs prior-day volume profile built from trades; not in repo)
- **1 Context**: Price opens outside prior day's value area.
- **2 Regions**: Prior VAH / VAL / POC.
- **3 Trigger**: Two consecutive 30 m closes back inside the value area; go toward the opposite edge.
- **4 Thesis / invalidation**: Acceptance inside targets the far edge. Invalid if price closes outside again.
- **5 Exit**: Opposite edge; half off at POC.
- **6 Risk / sizing**: Stop outside the re-entered edge; 0.5% risk; 1 position.
- **7 Evaluation**: Low frequency; at least 40 days; compare to coin-flip direction.
- **Part tags**: context=balanced; regions=value-area; trigger=price-reject; thesis=mean-revert; exit=scaled; risk=fixed-r; eval=vs-random-entry

### S018 — POC magnet with delta divergence
- **Style tag**: volume-profile
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none (developing POC computed from trades; not in repo)
- **1 Context**: Price at least 1.5 sigma(1h) from developing session POC; weak trend.
- **2 Regions**: Developing session POC.
- **3 Trigger**: New price extreme with lower cumulative delta than the prior extreme; enter toward POC.
- **4 Thesis / invalidation**: Price gravitates to the high-volume node. Invalid if volume builds at the new extreme.
- **5 Exit**: POC.
- **6 Risk / sizing**: Stop 0.8 sigma beyond the extreme; 0.4% risk.
- **7 Evaluation**: Net expectancy; at least 80 trades.
- **Part tags**: context=balanced; regions=poc; trigger=flow-imbalance; thesis=mean-revert; exit=target; risk=fixed-r; eval=expectancy-baseline

### S019 — Round-number stop run reclaim
- **Style tag**: liquidity-sweep
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **1 Context**: Volume at or above normal.
- **2 Regions**: Round numbers (every 1000 on BTC) and prior swing points.
- **3 Trigger**: Price pierces by 5-30 bps, then a 1 m bar closes back through; trade back across.
- **4 Thesis / invalidation**: Stops were taken with no follow-through. Invalid if price re-pierces and holds 2 bars.
- **5 Exit**: 1.2 sigma target or 20 min.
- **6 Risk / sizing**: Stop beyond sweep extreme; 0.4% risk.
- **7 Evaluation**: Frequent; at least 150; compare to random 1 m closes near levels.
- **Part tags**: context=always-on; regions=round-number; trigger=sweep-reclaim; thesis=liquidity-grab; exit=target; risk=fixed-r; eval=vs-random-entry

### S020 — Sweep with open-interest drop
- **Style tag**: liquidity-sweep
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack, collectors:derivatives-context
- **1 Context**: Any.
- **2 Regions**: Prior day high/low.
- **3 Trigger**: Break of the level where open interest drops during the break and price reclaims; trade back.
- **4 Thesis / invalidation**: The break was stops, not new conviction. Invalid if OI rises as the reclaim fails.
- **5 Exit**: Midpoint of prior day range; 1 h stop.
- **6 Risk / sizing**: Stop beyond sweep extreme; 0.4% risk; cap 1.
- **7 Evaluation**: Ablate the OI condition vs plain sweep; at least 60 trades each.
- **Part tags**: context=oi-state; regions=prior-hl; trigger=sweep-reclaim; thesis=liquidity-grab; exit=target; risk=fixed-r; eval=ablation

### S021 — Book imbalance scalp
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors:book-depth
- **1 Context**: Spread at most 1 tick; no event within 5 min.
- **2 Regions**: None.
- **3 Trigger**: Depth imbalance within 5 bps above 0.7 for 3 s; go with imbalance.
- **4 Thesis / invalidation**: Heavy bids predict small upward moves. Invalid if imbalance flips.
- **5 Exit**: 15 s time stop or imbalance flips.
- **6 Risk / sizing**: Stop 2 bps; maker-fee sizing; 1% daily loss cap.
- **7 Evaluation**: Mean per trade net of fees above 1 bp; thousands of trades needed.
- **Part tags**: context=liquidity-thin; regions=none; trigger=book-imbalance; thesis=info-follow; exit=flow-reversal; risk=capped-daily; eval=expectancy-baseline

### S022 — Burst continuation with OI confirmation
- **Style tag**: breakout
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst, futures-stack
- **1 Context**: Trending market-state; not at a prior extreme.
- **2 Regions**: None.
- **3 Trigger**: Burst active, cumulative delta confirms, open interest rises; follow.
- **4 Thesis / invalidation**: New positions enter on the aggressor side. Invalid if OI falls during continuation.
- **5 Exit**: Trail 0.7 sigma; flow-reversal exit.
- **6 Risk / sizing**: Stop 1 sigma; 0.4% risk.
- **7 Evaluation**: Compare against fading the same bursts (S003); at least 100 bursts.
- **Part tags**: context=trend; regions=none; trigger=burst-ep; thesis=continuation; exit=trailing; risk=sigma-sized; eval=ablation

### S023 — Weekend range fade
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: collectors:market-state
- **1 Context**: Saturday-Sunday UTC, low volume.
- **2 Regions**: 24 h range edges.
- **3 Trigger**: Touch of the range edge at 90% of range; fade.
- **4 Thesis / invalidation**: Low participation keeps the range. Invalid if volume spikes 3x.
- **5 Exit**: Range midpoint.
- **6 Risk / sizing**: Stop 0.5 sigma outside range; 0.3% risk.
- **7 Evaluation**: At least 40 weekends; compare to same rule on weekdays.
- **Part tags**: context=session; regions=range-edge; trigger=price-reject; thesis=mean-revert; exit=target; risk=fixed-r; eval=ablation

### S024 — Asia open range break
- **Style tag**: time-event
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **1 Context**: First 30 min of the Asia open (00:00 UTC).
- **2 Regions**: Previous close and the open price.
- **3 Trigger**: Break of the first 15 min range; go with the break.
- **4 Thesis / invalidation**: Session open sets short-term bias. Invalid if price returns to the open.
- **5 Exit**: 60 min time stop.
- **6 Risk / sizing**: Stop at the other side of the range; 0.3% risk.
- **7 Evaluation**: Per session; at least 120.
- **Part tags**: context=session; regions=opening-range; trigger=price-break; thesis=continuation; exit=time-stop; risk=fixed-r; eval=vs-random-entry

### S025 — EMA trend filter (control)
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Long when price is above the 4 h EMA(50), flat otherwise.
- **4 Thesis / invalidation**: Trends persist. Invalid if drawdown exceeds buy and hold.
- **5 Exit**: Close below EMA.
- **6 Risk / sizing**: Hard stop 3%; 1x notional.
- **7 Evaluation**: Net return and drawdown vs buy and hold; at least 1 year.
- **Part tags**: context=always-on; regions=none; trigger=price-break; thesis=continuation; exit=thesis-fail; risk=low-lever; eval=vs-buy-hold

### S026 — Pairs lag: ETH follows BTC
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors:extra-venues (majors' marks)
- **1 Context**: ETH/BTC 30 min correlation above 0.8.
- **2 Regions**: None.
- **3 Trigger**: BTC moves 1.2 sigma(10s) and ETH moved under 0.4 of its expected beta move; trade ETH in BTC's direction.
- **4 Thesis / invalidation**: Majors follow BTC with a lag. Invalid if ETH moves opposite within 5 s.
- **5 Exit**: Beta-expected move reached or 20 s.
- **6 Risk / sizing**: Stop 1 ETH-sigma(10s); small size; max 1.
- **7 Evaluation**: Net of fees and ETH spread; at least 300 signals.
- **Part tags**: context=market-state-rule; regions=none; trigger=leadlag; thesis=lead-propagates; exit=target; risk=fixed-r; eval=expectancy-baseline

### S027 — Bybit/OKX open-interest divergence
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack (all venues OI), collectors:derivatives-context
- **1 Context**: Price at a 2 h high.
- **2 Regions**: 2 h high.
- **3 Trigger**: Price makes the new high while summed Bybit+OKX OI is falling and Binance OI flat; short.
- **4 Thesis / invalidation**: The new high is short-covering, not new longs. Invalid if OI rises within 10 min.
- **5 Exit**: Back to 2 h VWAP, or 45 min.
- **6 Risk / sizing**: Stop 0.4 sigma above high; 0.4% risk.
- **7 Evaluation**: OI is coin-denominated and one-sided; sample at least 60; compare with price-only version.
- **Part tags**: context=oi-state; regions=swing; trigger=exhaustion-ep; thesis=crowding-unwind; exit=target; risk=fixed-r; eval=ablation

### S028 — Basis compression long
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors:derivatives-context
- **1 Context**: Perp premium to index in bottom 10% of 14 days while funding is negative.
- **2 Regions**: None.
- **3 Trigger**: Premium starts rising for 3 consecutive 5 m reads; long.
- **4 Thesis / invalidation**: Shorts overcrowded; squeeze risk. Invalid if premium drops back below the low.
- **5 Exit**: Premium returns to median, or 4 h.
- **6 Risk / sizing**: Stop 1.5 sigma(1h); 0.3% risk; 2x leverage.
- **7 Evaluation**: Few signals; require 30; compare to unconditional long for 4 h.
- **Part tags**: context=funding-extreme; regions=none; trigger=funding-flip; thesis=crowding-unwind; exit=thesis-fail; risk=low-lever; eval=vs-buy-hold

### S029 — Market-state router: trend vs balance
- **Style tag**: hybrid
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors:market-state, reader-episodes:absorption, reader-episodes:burst, sigma
- **1 Context**: Market-state rule decides: trending uses burst-follow, balanced uses absorption fade; skip transitions.
- **2 Regions**: Session VWAP and 4 h range edges.
- **3 Trigger**: Burst active in trend; absorption active at range edge in balance.
- **4 Thesis / invalidation**: The right behaviour depends on state; invalid when state flips mid-trade.
- **5 Exit**: State flip exits at market; otherwise 1.5 sigma or 40 min.
- **6 Risk / sizing**: Stop 1 sigma; 0.4% risk; cooldown 15 min after a loss; 2% daily cap.
- **7 Evaluation**: Compare router vs each branch alone; at least 100 trades each; drop router if no branch gain.
- **Part tags**: context=market-state-rule; regions=range-edge; trigger=absorption-ep; thesis=mean-revert; exit=thesis-fail; risk=cooldown; eval=ablation

### S030 — Wall pull breakout
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall, collectors:wall-quality
- **1 Context**: Wall had quality score high for at least 5 min.
- **2 Regions**: The wall price.
- **3 Trigger**: Wall is consumed (traded through, not pulled) and price accepts 3 bps beyond it; go through.
- **4 Thesis / invalidation**: The defender is exhausted. Invalid if price returns behind the wall level within 1 min.
- **5 Exit**: Trail 0.5 sigma; time stop 20 min.
- **6 Risk / sizing**: Stop behind the wall; 0.3% risk.
- **7 Evaluation**: Compare to S004 on same walls (opposite side); at least 80 walls.
- **Part tags**: context=liquidity-thin; regions=wall; trigger=wall-ep; thesis=continuation; exit=trailing; risk=fixed-r; eval=ablation

### S031 — Spoof wall fade
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors:wall-quality, collectors:book-depth
- **1 Context**: Wall quality low (appears/disappears often).
- **2 Regions**: Level of the flickering wall.
- **3 Trigger**: Wall vanishes as price approaches within 3 bps; trade away from the former wall side.
- **4 Thesis / invalidation**: The wall was bait; real intent is on the opposite side. Invalid if price continues toward the wall level.
- **5 Exit**: 30 s time stop.
- **6 Risk / sizing**: Stop 2 bps; tiny size; 1% daily cap.
- **7 Evaluation**: Fee-sensitive; at least 400 events; drop if not above fee cost.
- **Part tags**: context=liquidity-thin; regions=wall; trigger=book-imbalance; thesis=liquidity-grab; exit=time-stop; risk=capped-daily; eval=expectancy-baseline

### S032 — Coin-flip entry, structure exit (control)
- **Style tag**: price-action
- **Horizon tag**: minutes
- **Uses repo**: sigma, paper-broker
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Random direction at random times (seeded), max one per 30 min.
- **4 Thesis / invalidation**: None beyond "entry is irrelevant"; used to measure how much exit and risk rules alone produce.
- **5 Exit**: Target 1 sigma / stop 1 sigma / 15 min.
- **6 Risk / sizing**: Fixed 0.3% risk.
- **7 Evaluation**: Expected near -fees; any other system's result is read against this control.
- **Part tags**: context=always-on; regions=none; trigger=time-clock; thesis=calendar-drift; exit=target; risk=fixed-r; eval=expectancy-baseline

### S033 — Prior week high/low reclaim
- **Style tag**: liquidity-sweep
- **Horizon tag**: hours
- **Uses repo**: none
- **1 Context**: Price within 1% of prior week high/low.
- **2 Regions**: Prior week high / low.
- **3 Trigger**: 4 h bar wick through the level closing back inside; trade back.
- **4 Thesis / invalidation**: Weekly level sweep traps breakout traders. Invalid if two 4 h closes beyond.
- **5 Exit**: Weekly midpoint; 24 h time stop.
- **6 Risk / sizing**: Stop beyond wick; 0.5% risk; one trade per week per side.
- **7 Evaluation**: About 50 per year; wide intervals; compare to random 4 h bars.
- **Part tags**: context=always-on; regions=prior-hl; trigger=sweep-reclaim; thesis=liquidity-grab; exit=target; risk=fixed-r; eval=vs-random-entry

### S034 — Liquidation cluster magnet
- **Style tag**: liquidation
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack; needs liquidation-heatmap data not in repo (cluster estimates from OI and leverage assumptions)
- **1 Context**: Estimated liquidation cluster within 1.5 sigma(1h).
- **2 Regions**: Estimated liquidation clusters.
- **3 Trigger**: Price drifts toward the cluster with rising delta in that direction; enter toward it.
- **4 Thesis / invalidation**: Price is drawn to liquidity. Invalid if drift stalls 0.5 sigma short with absorption.
- **5 Exit**: Close at cluster touch (partial) then reverse-fade remainder.
- **6 Risk / sizing**: Stop 0.7 sigma; 0.3% risk; heatmap is unverified so size small.
- **7 Evaluation**: Cluster estimates unreliable; validate estimate quality first; at least 60 touches.
- **Part tags**: context=oi-state; regions=liq-cluster; trigger=flow-imbalance; thesis=liquidity-grab; exit=scaled; risk=fixed-r; eval=ablation

### S035 — Post-liquidation OI rebuild
- **Style tag**: liquidation
- **Horizon tag**: hours
- **Uses repo**: futures-stack, collectors:derivatives-context
- **1 Context**: OI fell more than 3% in 1 h with a large price drop.
- **2 Regions**: Low of the flush.
- **3 Trigger**: OI starts rebuilding while price holds above the flush low for 30 min; long.
- **4 Thesis / invalidation**: Excess leverage cleared. Invalid if the flush low breaks.
- **5 Exit**: 50% retrace of the drop, or 6 h.
- **6 Risk / sizing**: Stop under flush low; 0.5% risk; 3x leverage max.
- **7 Evaluation**: Rare; at least 25 events; honest: may stay inconclusive.
- **Part tags**: context=oi-state; regions=swing; trigger=liq-spike; thesis=forced-flow-ends; exit=target; risk=low-lever; eval=expectancy-baseline

### S036 — Hourly seasonality
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: none
- **1 Context**: Fixed clock windows.
- **2 Regions**: None.
- **3 Trigger**: Long at 22:00 UTC, flat at 23:00 UTC (or whichever hour shows historical drift; hour chosen with a training half only).
- **4 Thesis / invalidation**: Intraday seasonality exists. Invalid on the held-out half.
- **5 Exit**: Time stop at fixed clock time.
- **6 Risk / sizing**: Stop 1.5 sigma(1h); fixed notional.
- **7 Evaluation**: Train/test split by dates; multiple-comparison correction across 24 hours; at least 250 days.
- **Part tags**: context=session; regions=none; trigger=time-clock; thesis=calendar-drift; exit=time-stop; risk=fixed-r; eval=shuffled-time

### S037 — Funding-print positioning
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: collectors:derivatives-context, collectors:event-clock
- **1 Context**: 15 min before funding settlement with absolute funding above 0.03%.
- **2 Regions**: None.
- **3 Trigger**: Enter against the paying side at T-10m (short if longs pay heavily).
- **4 Thesis / invalidation**: Payers close before settlement. Invalid if price grinds in the payers' favour.
- **5 Exit**: T+5m.
- **6 Risk / sizing**: Stop 0.8 sigma; 0.3% risk; do not hold through settlement to avoid paying funding.
- **7 Evaluation**: 3 prints a day; at least 150 qualifying; compare to same clock offset on small-funding days.
- **Part tags**: context=funding-extreme; regions=none; trigger=time-clock; thesis=crowding-unwind; exit=time-stop; risk=fixed-r; eval=ablation

### S038 — Inside-bar volatility compression breakout
- **Style tag**: breakout
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **1 Context**: Realised 30 m vol in bottom 20% of 7 days (compression).
- **2 Regions**: Range of the compression.
- **3 Trigger**: Close beyond the compression range by 0.2 sigma.
- **4 Thesis / invalidation**: Compression precedes expansion. Invalid if price re-enters range.
- **5 Exit**: Trail 1 sigma.
- **6 Risk / sizing**: Stop opposite range edge; 0.4% risk.
- **7 Evaluation**: Win rate is expected low; evaluate payoff skew; at least 100.
- **Part tags**: context=vol-low; regions=range-edge; trigger=price-break; thesis=continuation; exit=trailing; risk=fixed-r; eval=hit-rate-payoff

### S039 — Failed breakout trap
- **Style tag**: mean-reversion
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption, sigma
- **1 Context**: Range-bound for at least 2 h.
- **2 Regions**: Range edge.
- **3 Trigger**: Break of the edge with absorption episode active (breakout flow absorbed); fade into range.
- **4 Thesis / invalidation**: Breakout buyers trapped. Invalid if the absorption ends and price holds beyond edge.
- **5 Exit**: Range midpoint.
- **6 Risk / sizing**: Stop 0.5 sigma beyond break extreme; 0.4% risk.
- **7 Evaluation**: Compare to fading every edge break; at least 80.
- **Part tags**: context=balanced; regions=range-edge; trigger=absorption-ep; thesis=mean-revert; exit=target; risk=sigma-sized; eval=ablation

### S040 — Delta flip scalper
- **Style tag**: momentum
- **Horizon tag**: seconds
- **Uses repo**: futures-stack (delta bins)
- **1 Context**: Spread normal; volume above median.
- **2 Regions**: None.
- **3 Trigger**: Rolling 20 s delta changes sign with magnitude above 1 standard deviation; go with new sign.
- **4 Thesis / invalidation**: Flow regime flips lead micro price. Invalid if delta flips back inside 10 s.
- **5 Exit**: Flow reversal or 30 s.
- **6 Risk / sizing**: Stop 3 bps; daily cap 1%; max 1.
- **7 Evaluation**: Net of fees; thousands of trades; likely fee-bound.
- **Part tags**: context=always-on; regions=none; trigger=flow-imbalance; thesis=continuation; exit=flow-reversal; risk=capped-daily; eval=expectancy-baseline

### S041 — Hidden-flow follow (who moved first)
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: collectors:who-moved-first, collectors:extra-venues, reader-episodes:burst
- **1 Context**: Burst episode active.
- **2 Regions**: None.
- **3 Trigger**: Trade the burst only if the leading venue was Binance perp and not spot.
- **4 Thesis / invalidation**: Derivatives-led moves are more leveraged and continue less or more (unknown): the study decides sign. Invalid per backtest.
- **5 Exit**: 10 min time stop.
- **6 Risk / sizing**: Stop 1 sigma; 0.3% risk.
- **7 Evaluation**: Run both signs; report which holds on the confirming half only.
- **Part tags**: context=vol-high; regions=none; trigger=burst-ep; thesis=lead-propagates; exit=time-stop; risk=fixed-r; eval=ablation

### S042 — Late-session low-liquidity fade
- **Style tag**: mean-reversion
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors:market-state
- **1 Context**: 20:00-23:00 UTC, volume bottom third.
- **2 Regions**: VWAP.
- **3 Trigger**: Move of 1.2 sigma(30m) away from VWAP; fade.
- **4 Thesis / invalidation**: Thin moves lack conviction. Invalid if volume rises 2x.
- **5 Exit**: VWAP or 30 min.
- **6 Risk / sizing**: Stop 0.8 sigma further; 0.3% risk.
- **7 Evaluation**: At least 100; versus same rule in high volume.
- **Part tags**: context=liquidity-thin; regions=vwap; trigger=price-reject; thesis=mean-revert; exit=target; risk=fixed-r; eval=ablation

### S043 — Options skew sentiment lean
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors:options-lens
- **1 Context**: 25-delta put-call skew at 14 day extreme.
- **2 Regions**: None.
- **3 Trigger**: Skew extreme starts reverting (down 10% from peak): go in the direction opposite to skew bias.
- **4 Thesis / invalidation**: Extreme hedging demand fades. Invalid if skew re-extends.
- **5 Exit**: 6 h time stop.
- **6 Risk / sizing**: Stop 2 sigma(1h); 0.3% risk.
- **7 Evaluation**: Very few events; flagged as exploratory only.
- **Part tags**: context=vol-high; regions=none; trigger=vol-shift; thesis=crowding-unwind; exit=time-stop; risk=fixed-r; eval=expectancy-baseline

### S044 — DVOL compression, long gamma proxy
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors:options-lens
- **1 Context**: DVOL in bottom 10% of 30 days.
- **2 Regions**: 24 h range.
- **3 Trigger**: Break of 24 h range in either direction; follow.
- **4 Thesis / invalidation**: Cheap vol precedes expansion. Invalid if re-entry.
- **5 Exit**: Trail 1.5 sigma(1h).
- **6 Risk / sizing**: Stop opposite side; 0.4% risk.
- **7 Evaluation**: Compare with S038 (realised-vol version); at least 40.
- **Part tags**: context=vol-low; regions=range-edge; trigger=price-break; thesis=vol-mispriced; exit=trailing; risk=fixed-r; eval=ablation

### S045 — Wallet liquidation proximity hunt
- **Style tag**: wallet
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors:followed-wallets
- **1 Context**: A tracked wallet is leveraged with liquidation price within 1.5% of mark.
- **2 Regions**: Estimated wallet liquidation price.
- **3 Trigger**: Push toward that price with burst episode; join the burst.
- **4 Thesis / invalidation**: Known forced flow target draws price. Invalid if wallet adds margin.
- **5 Exit**: At liquidation price or wallet reduces.
- **6 Risk / sizing**: Stop 0.6 sigma; 0.2% risk.
- **7 Evaluation**: Rare; exploratory; at least 20.
- **Part tags**: context=oi-state; regions=liq-cluster; trigger=wallet-move; thesis=liquidity-grab; exit=thesis-fail; risk=fixed-r; eval=expectancy-baseline

### S046 — Hyperliquid funding vs Binance funding spread
- **Style tag**: cross-venue
- **Horizon tag**: hours
- **Uses repo**: collectors:derivatives-context, collectors:extra-venues
- **1 Context**: Funding spread between venues above 80th percentile.
- **2 Regions**: None.
- **3 Trigger**: Spread persists 1 h; short the higher-funding venue and long the lower (delta-neutral).
- **4 Thesis / invalidation**: Spread converges. Invalid if spread widens another 50%.
- **5 Exit**: Spread at median.
- **6 Risk / sizing**: Two legs equal notional; stop on spread; margin check; 1x leverage per leg.
- **7 Evaluation**: Net of two-leg fees; needs both venues tradable (repo only has paper broker for one); at least 30.
- **Part tags**: context=funding-extreme; regions=none; trigger=funding-flip; thesis=crowding-unwind; exit=target; risk=low-lever; eval=sharpe-net

### S047 — Gap fill after fast move (CME-style proxy)
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none (CME gaps need non-repo data)
- **1 Context**: Sunday evening UTC.
- **2 Regions**: Friday close price (proxied by Binance Friday 21:00 UTC).
- **3 Trigger**: Weekend move of more than 1.5% from the Friday proxy; trade toward it.
- **4 Thesis / invalidation**: Gaps tend to fill. Invalid if price moves further 1 sigma(4h).
- **5 Exit**: Fill or Tuesday 00:00 UTC.
- **6 Risk / sizing**: Stop 1 sigma(4h); 0.4% risk.
- **7 Evaluation**: 50 per year; compare to random weekday starts.
- **Part tags**: context=session; regions=prior-hl; trigger=price-reject; thesis=mean-revert; exit=time-stop; risk=fixed-r; eval=vs-random-entry

### S048 — Absorption plus wall confluence
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption, reader-episodes:wall, collectors:wall-quality, sigma
- **1 Context**: Not trending.
- **2 Regions**: Wall price.
- **3 Trigger**: Absorption active at the wall; enter passive side.
- **4 Thesis / invalidation**: Both stated and real intent align. Invalid if wall pulled or absorption ends.
- **5 Exit**: Scale: half at 0.8 sigma, rest trail 0.5 sigma.
- **6 Risk / sizing**: Stop 0.4 sigma beyond wall; 0.4% risk.
- **7 Evaluation**: Test whether confluence beats either alone (S001 and S004); at least 60.
- **Part tags**: context=balanced; regions=wall; trigger=absorption-ep; thesis=mean-revert; exit=scaled; risk=sigma-sized; eval=ablation

### S049 — Reader signals, label-gated
- **Style tag**: hybrid
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes (all four), user agree/disagree labels, paper-broker
- **1 Context**: Always.
- **2 Regions**: None.
- **3 Trigger**: Only episodes of families where past precision (Wilson lower bound) exceeded 50%.
- **4 Thesis / invalidation**: Past labelled precision persists. Invalid if rolling 20-label precision drops below 40%.
- **5 Exit**: Family-specific: episode end or 30 min.
- **6 Risk / sizing**: 0.25% risk; max 2.
- **7 Evaluation**: Forward only; gating family chosen using earlier labels, tested on later; at least 60 live-forward.
- **Part tags**: context=always-on; regions=none; trigger=exhaustion-ep; thesis=info-follow; exit=thesis-fail; risk=fixed-r; eval=ablation

### S050 — Fixed-grid scale-in mean reversion
- **Style tag**: mean-reversion
- **Horizon tag**: hours
- **Uses repo**: sigma
- **1 Context**: Balanced 4 h.
- **2 Regions**: 4 h mean.
- **3 Trigger**: Add one unit each 0.5 sigma away from mean up to 4 units; fade.
- **4 Thesis / invalidation**: Price returns to mean. Invalid at 3.5 sigma extension.
- **5 Exit**: Everything at mean or hard stop.
- **6 Risk / sizing**: Total risk 1%; hard stop at 4 sigma; daily cap 2%. Tail risk is heavy (grid blowups).
- **7 Evaluation**: Judge on worst drawdown and tail, not win rate; at least 100 cycles.
- **Part tags**: context=balanced; regions=vwap; trigger=price-reject; thesis=mean-revert; exit=scaled; risk=capped-daily; eval=sharpe-net

### S051 — Round-number magnet drift
- **Style tag**: price-action
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **1 Context**: Price within 0.6% of a 1000-multiple, low volatility.
- **2 Regions**: Round number.
- **3 Trigger**: Enter toward the round number when price is 0.3% away and 5 m momentum points at it.
- **4 Thesis / invalidation**: Orders cluster at round figures and pull price. Invalid if momentum stalls 0.15% short.
- **5 Exit**: Touch of the number (limit).
- **6 Risk / sizing**: Stop 0.25%; 0.3% risk.
- **7 Evaluation**: Compare to toward-random-level control; at least 100.
- **Part tags**: context=vol-low; regions=round-number; trigger=price-break; thesis=liquidity-grab; exit=target; risk=fixed-r; eval=vs-random-entry

### S052 — Round-number rejection
- **Style tag**: mean-reversion
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:exhaustion
- **1 Context**: Balanced.
- **2 Regions**: Round numbers.
- **3 Trigger**: Exhaustion episode active within 10 bps of a round number; fade.
- **4 Thesis / invalidation**: Round numbers hold resting orders and stops. Invalid if price closes 15 bps beyond.
- **5 Exit**: 1 sigma or 15 min.
- **6 Risk / sizing**: Stop 0.4 sigma beyond the number; 0.3% risk.
- **7 Evaluation**: Contrast with S019 (reclaim); compare to exhaustion away from round numbers.
- **Part tags**: context=balanced; regions=round-number; trigger=exhaustion-ep; thesis=mean-revert; exit=target; risk=fixed-r; eval=ablation

### S053 — Anti-system: fade my own recent losses
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: paper-broker
- **1 Context**: After any 3 consecutive losing paper trades of a base system.
- **2 Regions**: None.
- **3 Trigger**: Take the opposite of the base system's next signal.
- **4 Thesis / invalidation**: Base system's loss streaks mark regimes where it is wrong. Invalid if opposite also loses (just costs).
- **5 Exit**: Same as base exit, mirrored.
- **6 Risk / sizing**: Half size.
- **7 Evaluation**: Strongly prone to false pattern; require at least 80 streaks and out-of-time confirmation.
- **Part tags**: context=market-state-rule; regions=none; trigger=burst-ep; thesis=mean-revert; exit=time-stop; risk=cooldown; eval=shuffled-time

### S054 — Burst fade in thin books
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst, collectors:book-depth
- **1 Context**: Book depth within 10 bps is below 40% of its 24 h median.
- **2 Regions**: None.
- **3 Trigger**: Burst ends (fading state) with price 1.5 sigma from 15 min ago; fade.
- **4 Thesis / invalidation**: Thin-book spikes are impact, not information. Invalid if depth refills in the spike direction.
- **5 Exit**: Half retrace; 10 min.
- **6 Risk / sizing**: Stop 0.6 sigma; small size for slippage.
- **7 Evaluation**: At least 60; slippage 2x stress test.
- **Part tags**: context=liquidity-thin; regions=none; trigger=burst-ep; thesis=mean-revert; exit=target; risk=fixed-r; eval=expectancy-baseline

### S055 — Volume-delta divergence on 15 m
- **Style tag**: exhaustion-fade
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack
- **1 Context**: Not trending.
- **2 Regions**: Last 4 h swing extreme.
- **3 Trigger**: New swing extreme with 15 m delta less than half of previous extreme's delta.
- **4 Thesis / invalidation**: Fewer aggressive participants push the move. Invalid if delta catches up in next 15 min.
- **5 Exit**: 0.5 retrace of the swing, or 1 h.
- **6 Risk / sizing**: Stop 0.4 sigma; 0.4% risk.
- **7 Evaluation**: At least 100; vs divergence-agnostic fade of all new extremes.
- **Part tags**: context=balanced; regions=swing; trigger=flow-imbalance; thesis=mean-revert; exit=target; risk=fixed-r; eval=ablation

### S056 — Open-interest surge breakout
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack, collectors:derivatives-context
- **1 Context**: OI up at least 2% in 30 min.
- **2 Regions**: 1 h range edge.
- **3 Trigger**: Break of range edge while OI rises; follow.
- **4 Thesis / invalidation**: New money backing the move. Invalid if OI drops 1% after the break.
- **5 Exit**: Trail 0.8 sigma; exit on OI drop.
- **6 Risk / sizing**: Stop inside range; 0.4% risk.
- **7 Evaluation**: Ablate the OI condition; at least 100.
- **Part tags**: context=oi-state; regions=range-edge; trigger=price-break; thesis=continuation; exit=trailing; risk=fixed-r; eval=ablation

### S057 — Funding-flip entry
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors:derivatives-context
- **1 Context**: Funding crosses zero after 3 days of the other sign.
- **2 Regions**: None.
- **3 Trigger**: First 8 h after the flip, go in the direction of the new funding side's opposite (positive flip: short bias contrarian? study tests both signs).
- **4 Thesis / invalidation**: Sentiment turning points. No strong prior; invalid by out-of-time result.
- **5 Exit**: 12 h time stop.
- **6 Risk / sizing**: Stop 3%; 2x leverage.
- **7 Evaluation**: Few events a year; likely inconclusive; baseline buy-hold.
- **Part tags**: context=funding-extreme; regions=none; trigger=funding-flip; thesis=calendar-drift; exit=time-stop; risk=low-lever; eval=vs-buy-hold

### S058 — Bybit lead on liquidations
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: futures-stack (Bybit/OKX liquidations), collectors:extra-venues
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Bybit liquidation burst (3 in 5 s, one side) not yet seen on Binance; trade with the liquidation flow on Binance.
- **4 Thesis / invalidation**: Cascades propagate across venues. Invalid if Binance shows no liquidations in 10 s.
- **5 Exit**: 60 s.
- **6 Risk / sizing**: Stop 4 bps; small.
- **7 Evaluation**: At least 100; net of slippage.
- **Part tags**: context=always-on; regions=none; trigger=liq-spike; thesis=lead-propagates; exit=time-stop; risk=fixed-r; eval=expectancy-baseline

### S059 — Cross-venue spread convergence
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors:extra-venues
- **1 Context**: Spread between Coinbase and Binance beyond 2 standard deviations of the last hour.
- **2 Regions**: None.
- **3 Trigger**: Sell richer venue's instrument and buy cheaper (needs both; only Binance tradable in repo: approximate by trading Binance toward Coinbase).
- **4 Thesis / invalidation**: Spreads mean-revert. Invalid if spread widens another 1 sd.
- **5 Exit**: Spread at 0.5 sd or 2 min.
- **6 Risk / sizing**: Stop on spread; small.
- **7 Evaluation**: Net of fees; at least 200.
- **Part tags**: context=always-on; regions=none; trigger=leadlag; thesis=lead-propagates; exit=target; risk=fixed-r; eval=expectancy-baseline

### S060 — Whale accumulation drift
- **Style tag**: wallet
- **Horizon tag**: hours
- **Uses repo**: collectors:followed-wallets
- **1 Context**: Tracked wallets net long notional rises by 20% over 4 h.
- **2 Regions**: None.
- **3 Trigger**: Enter long at the next 15 m close above VWAP.
- **4 Thesis / invalidation**: Persistent large-trader positioning leads. Invalid if net falls back to start.
- **5 Exit**: Net long falls 10% from peak.
- **6 Risk / sizing**: Stop 1.5 sigma(4h); 0.4% risk.
- **7 Evaluation**: Hindsight caveat on wallet selection; evaluate only after wallets are fixed; at least 40.
- **Part tags**: context=always-on; regions=vwap; trigger=wallet-move; thesis=info-follow; exit=thesis-fail; risk=fixed-r; eval=vs-buy-hold

### S061 — Counter the wallets
- **Style tag**: wallet
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors:followed-wallets
- **1 Context**: Tracked wallets all at one side with price at 4 h extreme (crowded).
- **2 Regions**: 4 h extreme.
- **3 Trigger**: Exhaustion at extreme: fade the wallets.
- **4 Thesis / invalidation**: Even large wallets are crowded at the top. Invalid if wallets add.
- **5 Exit**: 45 min.
- **6 Risk / sizing**: Stop beyond extreme; 0.3% risk.
- **7 Evaluation**: Direct comparison with S012 on the same data (opposite sign); report both.
- **Part tags**: context=oi-state; regions=swing; trigger=wallet-move; thesis=crowding-unwind; exit=time-stop; risk=fixed-r; eval=ablation

### S062 — Sigma-normalised breakout with volume gate
- **Style tag**: breakout
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **1 Context**: Volume 1.5x 1 h median.
- **2 Regions**: 30 m high/low.
- **3 Trigger**: Close beyond 30 m extreme by 0.3 sigma.
- **4 Thesis / invalidation**: Volume validates breakouts. Invalid if price closes back inside in 5 m.
- **5 Exit**: Trail 0.8 sigma; 30 min cap.
- **6 Risk / sizing**: Stop 1 sigma; 0.4% risk.
- **7 Evaluation**: Without-volume ablation; at least 150.
- **Part tags**: context=vol-high; regions=range-edge; trigger=price-break; thesis=continuation; exit=trailing; risk=sigma-sized; eval=ablation

### S063 — Swing-point pullback in trend
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: collectors:market-state
- **1 Context**: Trending state up (higher highs, higher lows over 4 h).
- **2 Regions**: Last higher low / 38-62% retracement.
- **3 Trigger**: Pullback to 50% of last swing, bullish 5 m close; long.
- **4 Thesis / invalidation**: Trend resumes. Invalid if higher low breaks.
- **5 Exit**: Previous high retest then trail.
- **6 Risk / sizing**: Stop under the swing low; 0.5% risk.
- **7 Evaluation**: At least 80; vs buying random dips in an uptrend.
- **Part tags**: context=trend; regions=swing; trigger=price-reject; thesis=continuation; exit=trailing; risk=fixed-r; eval=vs-random-entry

### S064 — Double top/bottom at VWAP
- **Style tag**: price-action
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **1 Context**: Balanced.
- **2 Regions**: Session VWAP.
- **3 Trigger**: Second rejection of VWAP within 40 min within 0.1 sigma of the first extreme; fade.
- **4 Thesis / invalidation**: Level defended twice. Invalid if close beyond VWAP.
- **5 Exit**: Time stop 40 min or 1 sigma.
- **6 Risk / sizing**: Stop 0.5 sigma; 0.3% risk.
- **7 Evaluation**: Pattern recognition prone to data mining; need at least 120.
- **Part tags**: context=balanced; regions=vwap; trigger=price-reject; thesis=mean-revert; exit=time-stop; risk=fixed-r; eval=shuffled-time

### S065 — Naked POC retest
- **Style tag**: volume-profile
- **Horizon tag**: hours
- **Uses repo**: none (needs stored daily profiles)
- **1 Context**: A prior-day POC never retested.
- **2 Regions**: That POC.
- **3 Trigger**: Price reaches it; take reaction fade on first touch.
- **4 Thesis / invalidation**: Unfinished business attracts price then holds. Invalid on close through.
- **5 Exit**: 1.2 sigma.
- **6 Risk / sizing**: Stop 0.5 sigma; 0.4% risk.
- **7 Evaluation**: Few per month; at least 40.
- **Part tags**: context=balanced; regions=poc; trigger=price-reject; thesis=mean-revert; exit=target; risk=fixed-r; eval=expectancy-baseline

### S066 — Low-volume node rejection
- **Style tag**: volume-profile
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **1 Context**: Price moving between nodes.
- **2 Regions**: Low-volume node in the 3 day profile.
- **3 Trigger**: Price enters LVN: go through it toward next high-volume node (fast travel).
- **4 Thesis / invalidation**: Price accelerates through thin volume. Invalid if stalls inside LVN.
- **5 Exit**: Next HVN.
- **6 Risk / sizing**: Stop back at entry node; 0.4% risk.
- **7 Evaluation**: At least 60.
- **Part tags**: context=trend; regions=poc; trigger=price-break; thesis=continuation; exit=target; risk=fixed-r; eval=expectancy-baseline

### S067 — Quarter-hour close reversal
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: none
- **1 Context**: Always.
- **2 Regions**: None.
- **3 Trigger**: Last 2 min of each 15 m bar moved more than 1 sigma; fade at bar close.
- **4 Thesis / invalidation**: Bar-close algorithmic flows revert. Invalid in test half.
- **5 Exit**: 5 min.
- **6 Risk / sizing**: Stop 1 sigma; tiny.
- **7 Evaluation**: Many samples; 400+; multiple-comparison with other bar sizes.
- **Part tags**: context=always-on; regions=none; trigger=time-clock; thesis=mean-revert; exit=time-stop; risk=fixed-r; eval=shuffled-time

### S068 — Stop-run before event
- **Style tag**: liquidity-sweep
- **Horizon tag**: minutes
- **Uses repo**: collectors:event-clock
- **1 Context**: 30 min before scheduled data.
- **2 Regions**: Recent 2 h extremes.
- **3 Trigger**: Sweep of extreme with fast reclaim; trade reclaim.
- **4 Thesis / invalidation**: Pre-event positioning trap. Invalid if sweep continues.
- **5 Exit**: T-2min.
- **6 Risk / sizing**: Stop beyond sweep; 0.3% risk.
- **7 Evaluation**: Few; pooled across event types; at least 30.
- **Part tags**: context=event-window; regions=swing; trigger=sweep-reclaim; thesis=liquidity-grab; exit=time-stop; risk=fixed-r; eval=vs-random-entry

### S069 — Volatility target allocation (buy-and-hold variant)
- **Style tag**: momentum
- **Horizon tag**: hours
- **Uses repo**: sigma, paper-broker
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Long exposure rescaled every hour to target 40% annualised vol, up to 2x.
- **4 Thesis / invalidation**: Vol clustering lets risk targeting improve Sharpe. Invalid if Sharpe not above plain hold.
- **5 Exit**: No exit; rebalance only.
- **6 Risk / sizing**: Vol target; max 2x leverage; daily loss cap 5%.
- **7 Evaluation**: Net Sharpe vs buy and hold over at least 1 year.
- **Part tags**: context=always-on; regions=none; trigger=vol-shift; thesis=vol-mispriced; exit=stop-only; risk=vol-target; eval=sharpe-net

### S070 — Cooldown-heavy single daily trade
- **Style tag**: breakout
- **Horizon tag**: hours
- **Uses repo**: none
- **1 Context**: Once per day maximum.
- **2 Regions**: Prior day high/low.
- **3 Trigger**: First 1 h close beyond prior day high/low.
- **4 Thesis / invalidation**: Daily-level break continues. Invalid if reclaimed.
- **5 Exit**: End of day or trail 1.5 sigma(1h).
- **6 Risk / sizing**: Stop at the level; 0.5% risk; none after a loss that day.
- **7 Evaluation**: At least 150 days.
- **Part tags**: context=balanced; regions=prior-hl; trigger=price-break; thesis=continuation; exit=trailing; risk=cooldown; eval=vs-random-entry

### S071 — Exhaustion with wall behind
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:exhaustion, reader-episodes:wall
- **1 Context**: Vol normal.
- **2 Regions**: Wall within 5 bps beyond the extreme.
- **3 Trigger**: Exhaustion active and a wall on the far side prevents continuation; fade.
- **4 Thesis / invalidation**: Wall caps the move. Invalid if wall removed.
- **5 Exit**: Wall pulled or 1 sigma.
- **6 Risk / sizing**: Stop beyond wall; 0.4% risk.
- **7 Evaluation**: Versus exhaustion alone; at least 50.
- **Part tags**: context=balanced; regions=wall; trigger=exhaustion-ep; thesis=mean-revert; exit=thesis-fail; risk=fixed-r; eval=ablation

### S072 — Episode groups, two-speed agreement
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes (groups layer: fast and mid readings)
- **1 Context**: Always.
- **2 Regions**: None.
- **3 Trigger**: Enter only when fast and mid episodes of the same family and side overlap (one group).
- **4 Thesis / invalidation**: Agreement across speeds filters noise. Invalid if no better than single-speed.
- **5 Exit**: Group end.
- **6 Risk / sizing**: 0.3% risk; stop 1 sigma.
- **7 Evaluation**: Ablate against fast-only and mid-only; at least 60 groups per arm.
- **Part tags**: context=always-on; regions=none; trigger=absorption-ep; thesis=info-follow; exit=thesis-fail; risk=sigma-sized; eval=ablation

### S073 — Collector-context filtered burst
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst, collectors (context chips, COLLECT.context), futures-stack
- **1 Context**: At burst detection at least 2 collector features deviate by more than 1.5 sd.
- **2 Regions**: None.
- **3 Trigger**: Follow the burst.
- **4 Thesis / invalidation**: Unusual cross-data means real information. Invalid if no uplift versus bursts without unusual context.
- **5 Exit**: Trail 0.7 sigma.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Permutation test over 21 features with correction; at least 100 bursts.
- **Part tags**: context=market-state-rule; regions=none; trigger=burst-ep; thesis=info-follow; exit=trailing; risk=sigma-sized; eval=shuffled-time

### S074 — Small-cap majors rotation
- **Style tag**: momentum
- **Horizon tag**: hours
- **Uses repo**: collectors:extra-venues (majors' marks)
- **1 Context**: Always.
- **2 Regions**: None.
- **3 Trigger**: Hourly: long the major with strongest 4 h relative strength vs BTC; short weakest (market-neutral).
- **4 Thesis / invalidation**: Relative momentum persists. Invalid if spread reverses.
- **5 Exit**: Rebalance every 4 h.
- **6 Risk / sizing**: Dollar-neutral; 1x gross; needs multi-asset execution not in repo.
- **7 Evaluation**: Net of fees; at least 3 months; benchmark equal-weight.
- **Part tags**: context=always-on; regions=none; trigger=price-break; thesis=continuation; exit=time-stop; risk=vol-target; eval=sharpe-net

### S075 — Pure market-state filter, trivial entry
- **Style tag**: hybrid
- **Horizon tag**: hours
- **Uses repo**: collectors:market-state
- **1 Context**: Market-state reads strong trend up.
- **2 Regions**: None.
- **3 Trigger**: Long at market once per state change.
- **4 Thesis / invalidation**: The state label itself has information. Invalid if state flips.
- **5 Exit**: State flips.
- **6 Risk / sizing**: Stop 2%; 1x.
- **7 Evaluation**: Isolates whether the context part alone produces returns; vs always-long.
- **Part tags**: context=market-state-rule; regions=none; trigger=time-clock; thesis=continuation; exit=thesis-fail; risk=low-lever; eval=vs-buy-hold

### S076 — Trade-size clustering iceberg detector
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors:book-depth; needs per-order trade tape detail partly in repo
- **1 Context**: Spread 1 tick.
- **2 Regions**: Price level with repeated equal-size fills.
- **3 Trigger**: Same-size fills at the same price at least 8 times without the price moving (hidden size); trade away from the defended side.
- **4 Thesis / invalidation**: An iceberg is absorbing flow. Invalid if the level breaks.
- **5 Exit**: 45 s or level break.
- **6 Risk / sizing**: Stop 1.5 bps; tiny size; 1% daily cap.
- **7 Evaluation**: Fee-bound; at least 300 detections.
- **Part tags**: context=liquidity-thin; regions=wall; trigger=book-imbalance; thesis=mean-revert; exit=flow-reversal; risk=capped-daily; eval=expectancy-baseline

### S077 — Quote-pull volatility precursor
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors:book-depth
- **1 Context**: Any.
- **2 Regions**: None.
- **3 Trigger**: Depth within 5 bps drops 60% in 3 s on both sides; wait and join the first side to break 2 bps.
- **4 Thesis / invalidation**: Makers pull before moves. Invalid if nothing happens in 10 s.
- **5 Exit**: 30 s or 1 sigma(30s).
- **6 Risk / sizing**: Stop 3 bps; small.
- **7 Evaluation**: Count signals that precede a move vs random 3 s windows; at least 200.
- **Part tags**: context=liquidity-thin; regions=none; trigger=book-imbalance; thesis=vol-mispriced; exit=time-stop; risk=fixed-r; eval=vs-random-entry

### S078 — Failed auction retest
- **Style tag**: volume-profile
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **1 Context**: Day with range extension then rapid return.
- **2 Regions**: Extension extreme (single prints).
- **3 Trigger**: Price re-approaches single prints; fade back.
- **4 Thesis / invalidation**: Single prints mark rejection. Invalid on acceptance (two 15 m closes).
- **5 Exit**: POC.
- **6 Risk / sizing**: Stop beyond extreme; 0.4% risk.
- **7 Evaluation**: At least 50.
- **Part tags**: context=balanced; regions=value-area; trigger=price-reject; thesis=mean-revert; exit=target; risk=fixed-r; eval=expectancy-baseline

### S079 — Hyperliquid wallet leaderboard rotation
- **Style tag**: wallet
- **Horizon tag**: hours
- **Uses repo**: collectors:followed-wallets
- **1 Context**: Weekly.
- **2 Regions**: None.
- **3 Trigger**: Follow only the wallet with best trailing 7 day realised PnL among the 10 (re-ranked weekly).
- **4 Thesis / invalidation**: Skill persists. Invalid if rank has no persistence across weeks.
- **5 Exit**: Mirror their close.
- **6 Risk / sizing**: Fixed 0.3% risk; stop 2%.
- **7 Evaluation**: Test rank persistence first; at least 8 weeks.
- **Part tags**: context=always-on; regions=none; trigger=wallet-move; thesis=info-follow; exit=thesis-fail; risk=fixed-r; eval=shuffled-time

### S080 — Liquidity vacuum gap trade
- **Style tag**: breakout
- **Horizon tag**: seconds
- **Uses repo**: collectors:book-depth
- **1 Context**: Book on one side thin (top 5 bps under 30% of median).
- **2 Regions**: Price toward the thin side.
- **3 Trigger**: Aggressive trades hit thin side; follow.
- **4 Thesis / invalidation**: Little resistance. Invalid if depth refills.
- **5 Exit**: 20 s or depth refill.
- **6 Risk / sizing**: Stop 2 bps.
- **7 Evaluation**: Net of impact; at least 300.
- **Part tags**: context=liquidity-thin; regions=none; trigger=flow-imbalance; thesis=continuation; exit=flow-reversal; risk=fixed-r; eval=expectancy-baseline

### S081 — Gamma pin (expiry week)
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors:options-lens (chain summary)
- **1 Context**: Final 12 h before monthly Deribit expiry.
- **2 Regions**: Max-pain / largest open interest strike.
- **3 Trigger**: Price more than 0.5% from strike: trade toward it.
- **4 Thesis / invalidation**: Hedging flows pin price. Invalid if price trends through.
- **5 Exit**: Expiry time.
- **6 Risk / sizing**: Stop 0.8%; 0.3% risk.
- **7 Evaluation**: 12 per year; underpowered; use weekly and quarterly pooled.
- **Part tags**: context=event-window; regions=round-number; trigger=price-reject; thesis=mean-revert; exit=time-stop; risk=fixed-r; eval=expectancy-baseline

### S082 — Implied vs realised, fade breakout days
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors:options-lens, sigma
- **1 Context**: Realised daily range already exceeds DVOL-implied daily move by 1.2x before 12:00 UTC.
- **2 Regions**: Day extreme.
- **3 Trigger**: Fade at the day extreme with an exhaustion episode.
- **4 Thesis / invalidation**: Moves beyond implied range revert. Invalid if DVOL spikes with it.
- **5 Exit**: Half the day's range.
- **6 Risk / sizing**: Stop 0.4 sigma; 0.3% risk.
- **7 Evaluation**: At least 40.
- **Part tags**: context=vol-high; regions=swing; trigger=exhaustion-ep; thesis=vol-mispriced; exit=target; risk=fixed-r; eval=expectancy-baseline

### S083 — Always-short-the-spike
- **Style tag**: mean-reversion
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: 1 m return above +2.5 sigma; short at next open.
- **4 Thesis / invalidation**: Large one-minute spikes revert. Invalid if next 5 m continues.
- **5 Exit**: 5 min.
- **6 Risk / sizing**: Stop 1.5 sigma; 0.2% risk.
- **7 Evaluation**: Symmetric long version too; at least 150.
- **Part tags**: context=always-on; regions=none; trigger=price-reject; thesis=mean-revert; exit=time-stop; risk=fixed-r; eval=shuffled-time

### S084 — Skip-the-hour: only trade if nothing happened
- **Style tag**: price-action
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **1 Context**: No episode active and realised vol at bottom quartile for 1 h.
- **2 Regions**: 1 h range.
- **3 Trigger**: Range edge touch; fade.
- **4 Thesis / invalidation**: Quiet markets chop. Invalid if volume spikes.
- **5 Exit**: Midpoint.
- **6 Risk / sizing**: Stop 0.5 sigma; 0.3% risk.
- **7 Evaluation**: Maker-fee viable? Net after fees; at least 120.
- **Part tags**: context=vol-low; regions=range-edge; trigger=price-reject; thesis=mean-revert; exit=target; risk=fixed-r; eval=expectancy-baseline

### S085 — Momentum ignition after absorption ends
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption
- **1 Context**: Absorption was active at a level for over 5 min.
- **2 Regions**: Absorbed level.
- **3 Trigger**: Absorption ends and price leaves in the aggressor's direction by 0.3 sigma; follow.
- **4 Thesis / invalidation**: Passive defender gave up. Invalid if price returns.
- **5 Exit**: Trail 0.7 sigma.
- **6 Risk / sizing**: Stop back at the level; 0.4% risk.
- **7 Evaluation**: Opposite of S001 on same episodes; at least 60.
- **Part tags**: context=balanced; regions=poc; trigger=absorption-ep; thesis=continuation; exit=trailing; risk=fixed-r; eval=ablation

### S086 — Slow-and-large: daily close momentum
- **Style tag**: momentum
- **Horizon tag**: hours
- **Uses repo**: none
- **1 Context**: Daily.
- **2 Regions**: None.
- **3 Trigger**: Daily close above 20 day high: long at 00:00 UTC.
- **4 Thesis / invalidation**: Time-series trend. Invalid at 10-day-low close.
- **5 Exit**: Close below 10 day low.
- **6 Risk / sizing**: 1x or 2x; stop 8%.
- **7 Evaluation**: Few trades; years of data; vs buy-hold.
- **Part tags**: context=trend; regions=prior-hl; trigger=price-break; thesis=continuation; exit=trailing; risk=low-lever; eval=vs-buy-hold

### S087 — Delta-neutral funding harvest (carry)
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors:derivatives-context; spot leg not in repo
- **1 Context**: Annualised funding above 15%.
- **2 Regions**: None.
- **3 Trigger**: Long spot / short perp while funding exceeds threshold.
- **4 Thesis / invalidation**: Funding persists. Invalid when funding below 5% or basis blowout.
- **5 Exit**: Funding falls under threshold.
- **6 Risk / sizing**: 1x both legs; margin buffer 50%.
- **7 Evaluation**: Return minus fees and funding variance; vs cash yield.
- **Part tags**: context=funding-extreme; regions=none; trigger=funding-flip; thesis=crowding-unwind; exit=thesis-fail; risk=low-lever; eval=sharpe-net

### S088 — Liquidation heat toward OKX
- **Style tag**: liquidation
- **Horizon tag**: minutes
- **Uses repo**: futures-stack (OKX liquidations)
- **1 Context**: OKX liquidation notional is above 5x median in a minute while Binance is quiet.
- **2 Regions**: None.
- **3 Trigger**: Trade against OKX liquidation side on Binance after 15 s.
- **4 Thesis / invalidation**: Venue-local flush reverts via arbitrage. Invalid if Binance joins.
- **5 Exit**: 5 min.
- **6 Risk / sizing**: Stop 0.6 sigma.
- **7 Evaluation**: Rare; at least 30.
- **Part tags**: context=always-on; regions=none; trigger=liq-spike; thesis=forced-flow-ends; exit=time-stop; risk=fixed-r; eval=expectancy-baseline

### S089 — Overnight vs day drift
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none
- **1 Context**: Fixed windows.
- **2 Regions**: None.
- **3 Trigger**: Long US close to Asia close (21:00 to 08:00 UTC), flat otherwise.
- **4 Thesis / invalidation**: Overnight premium exists. Invalid on held-out months.
- **5 Exit**: Clock.
- **6 Risk / sizing**: 1x; stop 2.5%.
- **7 Evaluation**: Monthly stability; vs buy-hold and vs random 11 h windows.
- **Part tags**: context=session; regions=none; trigger=time-clock; thesis=calendar-drift; exit=time-stop; risk=low-lever; eval=shuffled-time

### S090 — Mid-wall magnet
- **Style tag**: microstructure
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes:wall, collectors:wall-quality
- **1 Context**: Large high-quality wall within 1 sigma(30m).
- **2 Regions**: Wall.
- **3 Trigger**: Trade toward wall (price drawn to it).
- **4 Thesis / invalidation**: Walls attract price; liquidity seeks liquidity. Invalid if wall pulled.
- **5 Exit**: 3 bps before the wall (limit).
- **6 Risk / sizing**: Stop 0.6 sigma; 0.3% risk.
- **7 Evaluation**: Contrast with S004 (bounce): same walls, opposite assumptions; at least 80.
- **Part tags**: context=liquidity-thin; regions=wall; trigger=wall-ep; thesis=liquidity-grab; exit=target; risk=fixed-r; eval=ablation

### S091 — Event-clock volatility straddle proxy
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: collectors:event-clock
- **1 Context**: 1 min before scheduled event.
- **2 Regions**: Price at T.
- **3 Trigger**: Two stop orders 0.4 sigma above and below; first filled direction.
- **4 Thesis / invalidation**: Event produces a directional move. Invalid if the second side fills (whipsaw).
- **5 Exit**: Trail 0.5 sigma or 10 min.
- **6 Risk / sizing**: One filled; the other cancelled; stop 0.6 sigma; slippage-sensitive.
- **7 Evaluation**: Includes slippage stress at 3x; ~20 events; inconclusive likely.
- **Part tags**: context=event-window; regions=none; trigger=price-break; thesis=continuation; exit=trailing; risk=fixed-r; eval=expectancy-baseline

### S092 — Open-interest trapped traders
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack, collectors:derivatives-context
- **1 Context**: Price up 1.5 sigma(1h) with OI up 3%, then price reverses 0.5 sigma.
- **2 Regions**: Breakout level.
- **3 Trigger**: Reversal through breakout level; short (trapped longs).
- **4 Thesis / invalidation**: New longs are underwater and will sell. Invalid if OI drops sharply without price follow.
- **5 Exit**: OI back to start or 1 h.
- **6 Risk / sizing**: Stop above reversal high; 0.4% risk.
- **7 Evaluation**: Mirror for downside; at least 60.
- **Part tags**: context=oi-state; regions=range-edge; trigger=sweep-reclaim; thesis=crowding-unwind; exit=target; risk=fixed-r; eval=ablation

### S093 — Reader quiet-period fade
- **Style tag**: mean-reversion
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes (all), sigma
- **1 Context**: No episode active for 20 min (quiet).
- **2 Regions**: VWAP.
- **3 Trigger**: 1 sigma extension from VWAP; fade with limit.
- **4 Thesis / invalidation**: With no flow evidence, extension reverts. Invalid if burst/absorption episode starts.
- **5 Exit**: Episode forms or VWAP.
- **6 Risk / sizing**: Stop 0.6 sigma; 0.3% risk.
- **7 Evaluation**: At least 100.
- **Part tags**: context=vol-low; regions=vwap; trigger=price-reject; thesis=mean-revert; exit=thesis-fail; risk=fixed-r; eval=ablation

### S094 — Cross-venue basis (Binance vs Hyperliquid) mean reversion
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: collectors:extra-venues
- **1 Context**: Basis between venues beyond 2 sd.
- **2 Regions**: None.
- **3 Trigger**: Trade Hyperliquid toward Binance.
- **4 Thesis / invalidation**: Basis noise. Invalid if basis trends.
- **5 Exit**: Basis at median or 3 min.
- **6 Risk / sizing**: Small; stop on basis 3 sd.
- **7 Evaluation**: Net of fees; at least 200.
- **Part tags**: context=liquidity-thin; regions=none; trigger=leadlag; thesis=mean-revert; exit=target; risk=fixed-r; eval=expectancy-baseline

### S095 — Last-hour cascade guard (defensive overlay)
- **Style tag**: hybrid
- **Horizon tag**: hours
- **Uses repo**: futures-stack, collectors:forced-flow, paper-broker
- **1 Context**: Overlay on a base system (say S025).
- **2 Regions**: None.
- **3 Trigger**: Flatten base system when liquidation spike detected; re-enter 15 min later.
- **4 Thesis / invalidation**: Avoiding cascades improves drawdown. Invalid if net return drops more than drawdown saved.
- **5 Exit**: Overlay logic only.
- **6 Risk / sizing**: Base sizing; overlay never adds risk.
- **7 Evaluation**: Base with vs without overlay; drawdown and net return.
- **Part tags**: context=vol-high; regions=none; trigger=liq-spike; thesis=forced-flow-ends; exit=thesis-fail; risk=low-lever; eval=ablation

### S096 — Contrarian: buy extreme fear funding plus DVOL peak
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors:derivatives-context, collectors:options-lens
- **1 Context**: Funding below 20th percentile AND DVOL above 90th percentile AND price down more than 8% in 24 h.
- **2 Regions**: 24 h low.
- **3 Trigger**: First 1 h close above prior 1 h high.
- **4 Thesis / invalidation**: Capitulation. Invalid if 24 h low breaks.
- **5 Exit**: 50% retrace or 12 h.
- **6 Risk / sizing**: Stop under 24 h low; 0.4% risk.
- **7 Evaluation**: Very rare; flagged anecdotal; do not conclude from fewer than 15.
- **Part tags**: context=funding-extreme; regions=swing; trigger=price-reject; thesis=crowding-unwind; exit=target; risk=fixed-r; eval=expectancy-baseline

### S097 — Trend-day continuation by time of day
- **Style tag**: momentum
- **Horizon tag**: hours
- **Uses repo**: collectors:market-state
- **1 Context**: By 14:00 UTC price has not crossed VWAP since open and range exceeded 1.5x median.
- **2 Regions**: VWAP.
- **3 Trigger**: Pullback to VWAP touched from the trend side; enter trend.
- **4 Thesis / invalidation**: Trend days keep going. Invalid on VWAP cross.
- **5 Exit**: Trail 1 sigma(1h) or 20:00 UTC.
- **6 Risk / sizing**: Stop below VWAP; 0.5% risk; 1 per day.
- **7 Evaluation**: At least 60 days.
- **Part tags**: context=trend; regions=vwap; trigger=price-reject; thesis=continuation; exit=trailing; risk=cooldown; eval=expectancy-baseline

### S098 — Seconds-level tick momentum, no filters
- **Style tag**: momentum
- **Horizon tag**: seconds
- **Uses repo**: none
- **1 Context**: Always.
- **2 Regions**: None.
- **3 Trigger**: Last 10 trades signed volume sum above 1.2 sd; go with it.
- **4 Thesis / invalidation**: Order flow persistence. Invalid if net of fees negative.
- **5 Exit**: 10 s.
- **6 Risk / sizing**: Stop 2 bps; maker/taker mix; daily cap 0.5%.
- **7 Evaluation**: Fee-bound; likely negative; kept as a floor control. Thousands of trades.
- **Part tags**: context=always-on; regions=none; trigger=flow-imbalance; thesis=continuation; exit=time-stop; risk=capped-daily; eval=expectancy-baseline

### S099 — Absorption plus funding crowd
- **Style tag**: hybrid
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes:absorption, collectors:derivatives-context, futures-stack
- **1 Context**: Funding extreme in direction opposite to the passive side.
- **2 Regions**: Prior day extreme.
- **3 Trigger**: Absorption active; enter passive side (crowd against it).
- **4 Thesis / invalidation**: Crowded side gets squeezed. Invalid if funding and OI both normalise without move.
- **5 Exit**: Scale at 1 and 2 sigma; time stop 1 h.
- **6 Risk / sizing**: Stop 0.6 sigma; 0.4% risk; leverage cap 3x.
- **7 Evaluation**: Versus S001; the funding gate must add expectancy; at least 60.
- **Part tags**: context=funding-extreme; regions=prior-hl; trigger=absorption-ep; thesis=crowding-unwind; exit=scaled; risk=low-lever; eval=ablation

### S100 — Tail-hedged ladder
- **Style tag**: hybrid
- **Horizon tag**: hours
- **Uses repo**: sigma, paper-broker
- **1 Context**: Always.
- **2 Regions**: Round numbers.
- **3 Trigger**: Resting buys every 1000 below price and sells every 1000 above, each with 0.4% target.
- **4 Thesis / invalidation**: Range-bound oscillation across round numbers. Invalid if price trends through 5 levels.
- **5 Exit**: Per-order target; global kill if equity down 3%.
- **6 Risk / sizing**: Cap 5 open orders; gross 2x; daily loss cap 3%.
- **7 Evaluation**: Look at worst drawdown across trending regimes; at least 6 months.
- **Part tags**: context=always-on; regions=round-number; trigger=price-reject; thesis=mean-revert; exit=target; risk=capped-daily; eval=sharpe-net

## Tag vocabulary

Counts computed by parsing this file (systems using any repo component: 82 of 100).

**style**: hybrid (11), time-event (9), momentum (8), derivatives-state (8), microstructure (7), cross-venue (7), mean-reversion (7), price-action (7), breakout (6), wallet (6), exhaustion-fade (5), liquidation (5), options-vol (5), volume-profile (5), liquidity-sweep (4)

**horizon**: hours (34), minutes (28), tens-of-minutes (26), seconds (12)

**context**: always-on (21), balanced (16), liquidity-thin (12), vol-high (9), funding-extreme (8), oi-state (8), session (6), event-window (5), trend (5), market-state-rule (5), vol-low (5)

**regions**: none (44), swing (10), range-edge (9), vwap (8), prior-hl (7), wall (7), round-number (5), poc (4), opening-range (2), value-area (2), liq-cluster (2)

**trigger**: price-reject (18), price-break (15), absorption-ep (7), time-clock (7), exhaustion-ep (6), liq-spike (6), wallet-move (6), flow-imbalance (6), leadlag (5), sweep-reclaim (5), burst-ep (5), book-imbalance (4), funding-flip (4), wall-ep (3), vol-shift (3)

**thesis**: mean-revert (30), continuation (22), crowding-unwind (11), liquidity-grab (9), info-follow (7), lead-propagates (6), forced-flow-ends (5), vol-mispriced (5), calendar-drift (5)

**exit**: target (31), time-stop (27), thesis-fail (16), trailing (14), scaled (6), flow-reversal (5), stop-only (1)

**risk**: fixed-r (68), low-lever (12), sigma-sized (7), capped-daily (7), cooldown (4), vol-target (2)

**eval**: expectancy-baseline (31), ablation (29), vs-random-entry (16), shuffled-time (9), vs-buy-hold (7), sharpe-net (6), hit-rate-payoff (2)
