# Candidate trade systems, round two (S101..S350)

Date: 2026-11-04. Purpose: a second, larger pool of 250 automated trade-system designs for crypto perpetuals (mostly BTC, some ETH/majors), written to widen the distribution of ideas for each of the 7 parts for a later Monte Carlo-style study. Coverage, not curation: no ranking, and no system is claimed to have an edge. Thresholds are rough starting points, not tuned values.

Sources: no web research was done; everything is from the author's own knowledge of trading literature, market microstructure, and crypto mechanics (funding, liquidation engines, basis, expiry, session effects). Round one (`systems.md`, S001..S100) was read first, and these systems avoid its trigger/thesis combinations.

Every system has the 7 parts: (1) Context/regime, (2) Regions, (3) Trigger, (4) Thesis and invalidation, (5) Exit, (6) Risk and sizing, (7) Evaluation. "Uses repo" names existing components (Reader episodes absorption/exhaustion/burst/wall, sigma, collectors features such as dvol.vol, bnDerivs.fund, hlCtx.prem, bookBn.imbalance5, venues.coinbaseVsBinanceBps, optChain.skew5, futures-stack liquidation/delta/open-interest, paper broker); where a system needs data the repo does not have, that is stated in the field.

### S101 — Value-area-high rejection with delta divergence
- **Style tag**: volume-profile
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma, paper-broker
- **New vs round one**: 1,2,3,5,6,7
- **1 Context**: Prior-day value area computed (70% of volume); price inside the prior value area at the open; no scheduled event in the next hour.
- **2 Regions**: Prior-day value area high (VAH) and low (VAL) from a 30 min TPO/volume profile.
- **3 Trigger**: Price pokes above VAH by 0.1 to 0.4 sigma, then a 1 m bar closes back below VAH while cumulative delta over the poke made no new high (divergence): short. Mirror at VAL.
- **4 Thesis / invalidation**: Acceptance above VAH did not happen; the auction is rotating back to value. Invalid if two consecutive 5 m closes sit above VAH.
- **5 Exit**: Exit at prior-day POC (full), with a half taken at the mid between VAH and POC; break-even stop after the half.
- **6 Risk / sizing**: Stop structural: 0.2 sigma above the poke high. Size so the stop costs 0.4% equity; max 2 trades per day per side.
- **7 Evaluation**: Walk-forward: fit nothing, but report expectancy per calendar week over 12 weeks; kill if 4 of the last 6 weeks negative.
- **Part tags**: context=inside-prior-value; regions=value-area-edge; trigger=poke-reclaim-delta-div; thesis=value-rotation; exit=poc-target-partial; risk=structure-stop; eval=weekly-walk-forward

### S102 — Naked POC magnet
- **Style tag**: volume-profile
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,2,3,5,7
- **1 Context**: Always on, but only when a naked (untouched) POC from the last 5 sessions lies within 1.5 percent of price.
- **2 Regions**: Naked point of control of prior sessions (not revisited since formed).
- **3 Trigger**: Enter toward the nearest naked POC when price is 0.8 percent away and the last 30 min delta agrees with the direction; market order.
- **4 Thesis / invalidation**: Untouched POCs act as magnets because resting interest and memory cluster there. Invalid if price moves 0.5 percent away from the POC after entry.
- **5 Exit**: Exit when price touches the POC (limit), or after 6 h, whichever first.
- **6 Risk / sizing**: Stop at 0.5 percent adverse; fixed 0.3% equity risk; one position.
- **7 Evaluation**: Hit-rate of POC touched within 6 h versus a placebo level at the same distance on random days; at least 40 trades.
- **Part tags**: context=naked-poc-near; regions=naked-poc; trigger=distance-with-delta; thesis=level-magnet; exit=level-touch; risk=fixed-r; eval=placebo-level

### S103 — Single print fill
- **Style tag**: volume-profile
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,2,3,4,7
- **1 Context**: Session of a prior day had a single-print zone (price traversed fast, one TPO) still unfilled.
- **2 Regions**: Single-print zone in a prior session profile (a thin gap in volume).
- **3 Trigger**: Enter into the zone when price re-enters it from outside and the first 5 m bar inside has volume below the median; direction = through the zone.
- **4 Thesis / invalidation**: Thin volume areas are traversed fast; once inside, price should run to the far edge. Invalid if price stalls inside the zone for 3 bars with volume above median.
- **5 Exit**: Exit at far edge of the zone, or when 5 m volume exceeds twice its median (zone became accepted).
- **6 Risk / sizing**: Stop at the near edge of the zone; risk 0.5% equity; at most 1 trade per zone.
- **7 Evaluation**: Per-zone sample is small; evaluate pooled across 60 zones, bootstrap confidence on mean R, kill if the lower 80% bound is below zero.
- **Part tags**: context=unfilled-single-print; regions=single-print; trigger=zone-entry-thin-volume; thesis=thin-zone-traverse; exit=zone-far-edge; risk=structure-stop; eval=bootstrap-ci

### S104 — Anchored VWAP from the largest liquidation
- **Style tag**: liquidation
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack, sigma
- **New vs round one**: 1,2,3,6,7
- **1 Context**: After a liquidation spike confirmed by futures-stack highlights in the last 24 h.
- **2 Regions**: VWAP anchored at the bar of the largest liquidation spike in the last 24 h.
- **3 Trigger**: Price returns to the anchored VWAP from below/above and a 1 m close bounces back off it with delta turning in the bounce direction: enter with the bounce.
- **4 Thesis / invalidation**: Participants trapped by the liquidation cascade defend their average cost; the anchored VWAP acts as support/resistance. Invalid if a 5 m bar closes 0.4 sigma through it.
- **5 Exit**: Target previous swing; trail by 1 sigma of 1 m range once 1 R in profit.
- **6 Risk / sizing**: Stop 0.4 sigma through anchored VWAP; size by volatility target: 1 sigma stop equals 0.3% equity.
- **7 Evaluation**: Compare to plain session VWAP bounce with the same trigger (ablation on the anchor); at least 50 events; drop if no improvement.
- **Part tags**: context=post-liq-day; regions=anchored-vwap; trigger=vwap-bounce-delta; thesis=trapped-cost-defense; exit=trail-sigma; risk=vol-target-size; eval=anchor-ablation

### S105 — Opening range failure (UTC day)
- **Style tag**: time-event
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma, paper-broker
- **New vs round one**: 2,3,4,7
- **1 Context**: Active only from 00:30 to 04:00 UTC, after the first-30-minutes range has formed.
- **2 Regions**: First 30 minutes range of the UTC day (opening range, OR).
- **3 Trigger**: A break of OR high or low that fails: price re-enters the OR within 10 minutes with a 5 m close inside; enter back toward the OR middle.
- **4 Thesis / invalidation**: Failed breakouts at the open trap breakout traders. Invalid if price re-breaks the extreme.
- **5 Exit**: Exit at OR middle (half) and opposite OR edge (rest); hard time stop at 04:00 UTC.
- **6 Risk / sizing**: Stop beyond the failed extreme; 0.4% risk; max one trade per day.
- **7 Evaluation**: Report per-day results across 90 days with a sign test against 50 percent; kill if p above 0.3 after 90 days.
- **Part tags**: context=session-open-window; regions=opening-range; trigger=range-break-failure; thesis=trapped-breakout; exit=range-middle-edge; risk=structure-stop; eval=sign-test-days

### S106 — Liquidation cluster magnet (hyperliquid wallets)
- **Style tag**: wallet
- **Horizon tag**: hours
- **Uses repo**: collectors: wallets
- **New vs round one**: 1,2,3,5,6
- **1 Context**: Tracked top wallets hold concentrated liquidation prices within 1.5 percent of mark.
- **2 Regions**: Liquidation price clusters of the 10 biggest Hyperliquid traders (needs the wallets collector; positions only, no view of the rest of the market).
- **3 Trigger**: Enter toward the cluster when price is 1 percent away and the cluster notional is above its own 7 day median.
- **4 Thesis / invalidation**: Price tends to travel to hunt a visible liquidation cluster. Invalid if the wallet adds margin or closes (cluster disappears) before arrival.
- **5 Exit**: Exit just before the cluster price (0.1 percent short of it), or on cluster removal.
- **6 Risk / sizing**: Stop 0.6 percent adverse; size 0.3% risk; max leverage 3x.
- **7 Evaluation**: Event-study: price distance travelled to the cluster versus random distances; need 30 clusters.
- **Part tags**: context=wallet-cluster-near; regions=liq-cluster; trigger=cluster-approach; thesis=stop-hunt-magnet; exit=pre-cluster-exit; risk=fixed-r; eval=event-study-distance

### S107 — Max-pain pin on expiry day
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors: options
- **New vs round one**: 1,2,3,6,7
- **1 Context**: Deribit expiry day (08:00 UTC expiry) with open interest concentrated; ATM implied vol falling.
- **2 Regions**: Max pain strike and the highest open-interest strikes (Deribit chain, needs the options collector).
- **3 Trigger**: Between 04:00 and 07:30 UTC, if price is more than 1 percent from max pain, fade toward it with a limit entry at 0.7 percent distance.
- **4 Thesis / invalidation**: Dealer hedging pins price toward high OI strikes into expiry. Invalid if realized vol in the last hour exceeds implied vol by 30 percent.
- **5 Exit**: Exit at 07:55 UTC regardless, or max pain touch.
- **6 Risk / sizing**: Position flat across expiry; 0.2% risk; stop 0.8 percent; only expiry days.
- **7 Evaluation**: Sample is tiny (about 50 expiry days per year); bootstrap CI and report as exploratory with no kill before 30 expiry days.
- **Part tags**: context=options-expiry-day; regions=max-pain-strike; trigger=distance-limit-entry; thesis=expiry-pinning; exit=clock-exit; risk=small-fixed-stop; eval=small-sample-exploratory

### S108 — Funding-reset window squeeze reversal
- **Style tag**: derivatives-state
- **Horizon tag**: minutes
- **Uses repo**: collectors: derivs, calendar
- **New vs round one**: 1,2,3,6
- **1 Context**: Binance funding time within 15 min and absolute funding above 0.05 percent per 8 h.
- **2 Regions**: The funding timestamp itself (time region), not a price level.
- **3 Trigger**: Ten minutes before funding, enter against the paying side (short when funding strongly positive) if price has run in the paying side direction over 2 h.
- **4 Thesis / invalidation**: Crowd that pays does not want to pay and trims positions into the reset. Invalid if OI increases during the window.
- **5 Exit**: Exit 5 minutes after the funding timestamp.
- **6 Risk / sizing**: Fixed notional 0.5x equity; stop 1 sigma; skip if spread above 2 bps.
- **7 Evaluation**: Compare against same clock times on days with neutral funding; at least 60 cases.
- **Part tags**: context=pre-funding-window; regions=funding-clock; trigger=against-paying-side; thesis=funding-avoidance-trim; exit=clock-exit; risk=fixed-notional; eval=neutral-day-control

### S109 — Stacked imbalance continuation
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: none (needs footprint bars; repo has tape only)
- **New vs round one**: 1,3,5,7
- **1 Context**: Always on; skip the first minute after a 5 m bar close.
- **2 Regions**: None.
- **3 Trigger**: Three or more consecutive price levels in a 1 m footprint bar with ask-to-bid volume ratio above 3:1 (stacked buy imbalance), enter long at next bar open; mirror for sell.
- **4 Thesis / invalidation**: Stacked imbalances mark committed aggressors that defend the area. Invalid if the stacked zone is traded back through.
- **5 Exit**: Exit if the price trades back to the lowest stacked level, or after 8 bars.
- **6 Risk / sizing**: Stop at lowest stacked level minus a tick; risk 0.25%; max 3 per hour.
- **7 Evaluation**: Compare to un-stacked 3:1 single imbalance (ablation); 300 trades.
- **Part tags**: context=always-on; regions=none; trigger=stacked-imbalance; thesis=committed-aggressor-defense; exit=imbalance-level-fail; risk=structure-stop; eval=ablation

### S110 — Delta-price divergence at swing high
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:exhaustion
- **New vs round one**: 2,3,6,7
- **1 Context**: Only when an exhaustion episode is forming or active on the Reader.
- **2 Regions**: Last 2 h swing high or low.
- **3 Trigger**: New swing high with 5 m CVD lower than at the previous swing high; wait for the first lower 1 m high: short.
- **4 Thesis / invalidation**: Price advance without new net buying shows lack of participation. Invalid if CVD makes a new high.
- **5 Exit**: Exit when CVD makes a new low in the other direction, or 30 min.
- **6 Risk / sizing**: Risk 0.4% with stop above the swing; pyramid a second unit when CVD confirms down.
- **7 Evaluation**: Expectancy split by Reader episode present/absent (regime-split).
- **Part tags**: context=exhaustion-episode-present; regions=swing; trigger=cvd-divergence; thesis=participation-lacking; exit=flow-reversal; risk=pyramid-confirm; eval=regime-split

### S111 — Iceberg refill hold
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: none (needs order-level data; only aggregated depth in repo)
- **New vs round one**: 1,3,4,7
- **1 Context**: Spread at most 1 bp; no event for 30 minutes.
- **2 Regions**: Price level where more than 4 trades hit the same bid/ask while visible size refills.
- **3 Trigger**: Detect a level where traded volume exceeds 3x displayed size and the level holds: enter against the hitter with a 0.5 bp limit.
- **4 Thesis / invalidation**: A hidden passive order is absorbing flow; price will not break it. Invalid if the level breaks by 1 tick.
- **5 Exit**: Exit after 60 s or when refill stops.
- **6 Risk / sizing**: Stop 3 bps; size 0.2% risk; leverage 5x; cap 20 trades per hour.
- **7 Evaluation**: Fee-and-slippage stress at +1 bp and 2x latency; kill if edge vanishes at +1 bp.
- **Part tags**: context=tight-spread; regions=refill-level; trigger=iceberg-detect; thesis=hidden-passive-order; exit=refill-stops; risk=tick-stop-lever; eval=fee-stress

### S112 — Quote-pulling shock
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors: book
- **New vs round one**: 1,3,4,5,7
- **1 Context**: Depth within 5 bps was stable for the prior 5 minutes.
- **2 Regions**: None.
- **3 Trigger**: Depth within 5 bps drops 50 percent in 3 seconds on one side without trades: trade away from the pulled side.
- **4 Thesis / invalidation**: Liquidity withdrawal precedes a move away from the vacated side. Invalid if depth returns in 10 s.
- **5 Exit**: Exit when depth restored or 45 s.
- **6 Risk / sizing**: Stop 4 bps; 0.15% risk; max 10 per hour; cooldown 2 min.
- **7 Evaluation**: Latency stress: re-run with 500 ms and 1 s delay; keep only if positive at 1 s.
- **Part tags**: context=stable-depth; regions=none; trigger=depth-collapse; thesis=liquidity-withdrawal-precedes-move; exit=depth-restored; risk=cooldown-capped; eval=latency-stress

### S113 — Spread blowout fade
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors: book
- **New vs round one**: 1,3,6,7
- **1 Context**: Spread normally under 1 bp.
- **2 Regions**: None.
- **3 Trigger**: Spread widens above 5 bps for at least 2 s then starts narrowing; enter against the last 5 s price move.
- **4 Thesis / invalidation**: Wide spread signals momentary inventory panic; mean reversion of the mid. Invalid if spread re-widens.
- **5 Exit**: Exit at pre-blowout mid or 30 s.
- **6 Risk / sizing**: Limit orders only; stop 6 bps; 0.1% risk.
- **7 Evaluation**: Fill realism: model maker fill probability, compare gross to net; needs 100 events.
- **Part tags**: context=spread-normal; regions=none; trigger=spread-narrowing; thesis=inventory-panic-reversion; exit=pre-shock-mid; risk=limit-only; eval=fill-realism

### S114 — Burst-episode ride with flow-decay exit
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst, sigma, paper-broker
- **New vs round one**: 3,5,6,7
- **1 Context**: Reader burst episode reaches active while sigma is below its 7 day median (quiet market woke up).
- **2 Regions**: None.
- **3 Trigger**: Enter in the aggressor direction when a burst episode turns active and at least 3 of its evidence items are met.
- **4 Thesis / invalidation**: Aggression bursts from a quiet book carry a few more minutes. Invalid if the burst episode goes fading with price less than 0.5 sigma from entry.
- **5 Exit**: Exit when 30 s signed volume falls below 30 percent of its peak (flow-decay) or burst episode ends; no price target.
- **6 Risk / sizing**: Stop 1 sigma; Kelly-fraction sizing at one quarter Kelly from the last 100 trades (cap 1% risk).
- **7 Evaluation**: Deflated Sharpe over all burst threshold variants tried; need 150 trades; kill if deflated Sharpe below 0.
- **Part tags**: context=quiet-sigma-wakeup; regions=none; trigger=burst-ep; thesis=aggression-persists; exit=flow-decay; risk=quarter-kelly; eval=deflated-sharpe

### S115 — Wall pull-through
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall, collectors: book
- **New vs round one**: 3,4,5,7
- **1 Context**: Wall episode active on one side with wall size at least 5x the 5 bps median depth.
- **2 Regions**: The wall price.
- **3 Trigger**: When the wall episode goes fading because the wall is pulled (not traded), enter in the direction away from where the wall was, within 5 seconds.
- **4 Thesis / invalidation**: Spoof-like walls are pulled when real intent is the opposite way. Invalid if price returns to the wall price within 2 minutes.
- **5 Exit**: Exit at opposing wall (next wall episode on the other side) or 10 min.
- **6 Risk / sizing**: Stop at the old wall price; 0.3% risk.
- **7 Evaluation**: Compare to fading wall that ended by being traded through (control); need 80 events.
- **Part tags**: context=wall-episode-active; regions=wall; trigger=wall-pulled; thesis=spoof-reveal; exit=opposing-wall; risk=structure-stop; eval=pulled-vs-traded-control

### S116 — Absorption hold, size-up on confirmation
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption, sigma
- **New vs round one**: 3,6,7
- **1 Context**: Absorption episode forming or active; funding not extreme.
- **2 Regions**: Absorption price band reported by the episode.
- **3 Trigger**: Enter half size when absorption turns active; add the other half only if price holds the band for another 3 minutes.
- **4 Thesis / invalidation**: Passive side is defending; defense that persists is more reliable than defense just seen. Invalid if absorption ends and price leaves band.
- **5 Exit**: Exit on episode end, or at 1.2 sigma profit; give-back rule: close if open profit falls 40 percent from peak.
- **6 Risk / sizing**: Staged entry: half then half; total risk 0.5%; stop 0.6 sigma beyond band.
- **7 Evaluation**: Compare staged versus all-in entry on identical signals (paired difference), at least 80 signals.
- **Part tags**: context=absorption-episode; regions=absorption-band; trigger=absorption-staged; thesis=defense-persists; exit=give-back-rule; risk=staged-entry; eval=paired-entry-comparison

### S117 — Anti-martingale on wins
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 2,3,6,7
- **1 Context**: Trend context: price above 4 h VWAP and 1 h return positive.
- **2 Regions**: None.
- **3 Trigger**: Breaks of the prior 15 min high with volume above 1.5x median: long; after each winning trade the next size is 1.5x, capped at 3x; reset after a loss.
- **4 Thesis / invalidation**: Trends cluster so recent winners indicate the regime still holds. Invalid if two stops in a row.
- **5 Exit**: Trail by 1.2 sigma; time stop 40 min.
- **6 Risk / sizing**: Anti-martingale ladder (1x, 1.5x, 2.25x, 3x cap); hard stop 1 sigma; 3 consecutive losses end the day.
- **7 Evaluation**: Compare to flat sizing on identical entries; look at max drawdown and tail, not just mean; 200 trades.
- **Part tags**: context=above-4h-vwap-trend; regions=none; trigger=prior-high-break-volume; thesis=trend-clustering; exit=trailing; risk=anti-martingale; eval=sizing-ablation

### S118 — Drawdown-scaled mean reversion
- **Style tag**: mean-reversion
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **New vs round one**: 3,6,7
- **1 Context**: Balanced context (4 h range under 2 percent).
- **2 Regions**: Bollinger-style 2 sigma band around 1 h VWAP.
- **3 Trigger**: Fade a 15 m close outside the band when the next 1 m bar reverses.
- **4 Thesis / invalidation**: Short-term overshoots revert to VWAP in ranges. Invalid if 3 closes outside the band.
- **5 Exit**: Target VWAP; time stop 60 min.
- **6 Risk / sizing**: Size shrinks linearly with equity drawdown from peak (zero size at 8 percent drawdown); base risk 0.5%.
- **7 Evaluation**: Report equity curve with and without scaling (same trades), maximum drawdown and recovery time.
- **Part tags**: context=balanced; regions=vwap-band; trigger=band-outside-reverse; thesis=mean-revert; exit=target; risk=drawdown-scaled; eval=equity-curve-compare

### S119 — Time-of-day leverage
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,6,7
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Long-only buy at 21:00 UTC (US close), hold overnight into Asia open.
- **4 Thesis / invalidation**: Overnight drift pattern; weak but persistent seasonal. Invalid if 20 trade rolling mean is negative.
- **5 Exit**: Exit at 07:00 UTC.
- **6 Risk / sizing**: Leverage varies by time: 2x in the first hour then 1x; stop 3 percent.
- **7 Evaluation**: Seasonality check: out-of-sample on ETH and across months; deflated for number of hour windows tried (24).
- **Part tags**: context=always-on; regions=none; trigger=time-clock; thesis=seasonal-drift; exit=clock-exit; risk=time-varying-leverage; eval=multi-asset-oos

### S120 — Stop-only trend: wide stop, no target
- **Style tag**: momentum
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 5,6,7
- **1 Context**: Daily close above 20 day mean and below 3x ATR of recent range.
- **2 Regions**: None.
- **3 Trigger**: Enter long at daily close when price makes a 20 day high; short mirror.
- **4 Thesis / invalidation**: Slow trend persistence across days. Invalid if daily close below the 10 day low (long).
- **5 Exit**: Stop-only exit: chandelier stop at 3 ATR trailing; nothing else.
- **6 Risk / sizing**: Fixed fraction 1% risk; max leverage 2x; no new entry after 3 stop-outs in 10 days.
- **7 Evaluation**: Bootstrap CI on yearly Sharpe; at least 40 trades; compare with buy-and-hold.
- **Part tags**: context=above-20d-mean; regions=none; trigger=20d-high-break; thesis=trend-persist; exit=chandelier-stop-only; risk=loss-streak-shutdown; eval=bootstrap-ci

### S121 — CVD absorption at round number
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption
- **New vs round one**: 1,3,7
- **1 Context**: Absorption episode in last 2 min.
- **2 Regions**: Round numbers at 1000 spacing for BTC.
- **3 Trigger**: Price within 0.15 percent of a round thousand with absorption of sell aggression: long.
- **4 Thesis / invalidation**: Round numbers hold bids; absorption proves it. Invalid if 3 m close below the level by 0.2 percent.
- **5 Exit**: Exit at +0.6 percent or 30 min.
- **6 Risk / sizing**: Stop 0.3 percent; risk 0.4%.
- **7 Evaluation**: Test with level offset by 150 USD (placebo shift); need 100 events.
- **Part tags**: context=absorption-episode; regions=round-number; trigger=absorption-ep; thesis=level-defense; exit=target; risk=fixed-r; eval=level-shift-placebo

### S122 — Liquidation cascade exhaustion buy
- **Style tag**: liquidation
- **Horizon tag**: minutes
- **Uses repo**: futures-stack, collectors: derivs
- **New vs round one**: 3,5,7
- **1 Context**: Futures stack liquidation spike highlight confirmed (same-side delta, OI falling).
- **2 Regions**: Low of the cascade.
- **3 Trigger**: After the cascade, when liquidation rate falls to under 25 percent of peak and OI stabilizes for 60 s, buy the dip (sell after upward cascade).
- **4 Thesis / invalidation**: Forced selling is finished; remaining flow is organic. Invalid if a second liquidation spike occurs.
- **5 Exit**: Exit on liquidation-rate re-rise, or 45% retracement of the cascade.
- **6 Risk / sizing**: Stop below cascade low; risk 0.5%; max 1 per cascade.
- **7 Evaluation**: Event study across cascades: path to 1, 5, 15 min; at least 40 cascades; compare random dips of equal size.
- **Part tags**: context=post-cascade; regions=cascade-extreme; trigger=liq-rate-decay; thesis=forced-flow-ends; exit=retracement-target; risk=structure-stop; eval=event-study-random-dip

### S123 — Basis blowout fade
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,5,6
- **1 Context**: Perp basis (bnDerivs.basisBps) above its own 30 day 95th percentile.
- **2 Regions**: None.
- **3 Trigger**: Short when basis percentile >95 and price makes a lower 15 m high.
- **4 Thesis / invalidation**: Rich basis is leveraged long crowding; mean reversion follows. Invalid if basis rises further.
- **5 Exit**: Exit when basis percentile falls under 60.
- **6 Risk / sizing**: Size by basis z-score: 0.25% risk per z up to 3; stop 1.5 percent.
- **7 Evaluation**: Walk-forward: percentile threshold set on first half, tested on second.
- **Part tags**: context=basis-extreme; regions=none; trigger=lower-high-basis; thesis=crowding-unwind; exit=indicator-normalize; risk=signal-scaled-size; eval=walk-forward

### S124 — Cross-asset lag: ETH leads BTC
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors: venues
- **New vs round one**: 3,4,7
- **1 Context**: Always on, BTC spread under 1 bp.
- **2 Regions**: None.
- **3 Trigger**: ETH mark moves more than 2 sigma_ETH in 10 s while BTC moved under 0.5 sigma in the same 10 s: trade BTC in ETH direction.
- **4 Thesis / invalidation**: Beta propagation with lag. Invalid if BTC fails to move within 20 s.
- **5 Exit**: Exit after 30 s fixed or when BTC caught up.
- **6 Risk / sizing**: Stop 4 bps; 0.1% risk.
- **7 Evaluation**: Latency stress ladder 0 to 2 s; edge must survive 1 s.
- **Part tags**: context=always-on; regions=none; trigger=majors-lead; thesis=beta-propagation; exit=catch-up-exit; risk=fixed-r; eval=latency-stress

### S125 — Coinbase premium persistence
- **Style tag**: cross-venue
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors: venues
- **New vs round one**: 3,6,7
- **1 Context**: Coinbase vs Binance premium (venues.coinbaseVsBinanceBps) above 5 bps for 5 minutes.
- **2 Regions**: None.
- **3 Trigger**: Enter long when premium persists and widening; short when discount.
- **4 Thesis / invalidation**: US spot demand leads. Invalid if premium decays under 2 bps.
- **5 Exit**: Exit when premium returns under 2 bps.
- **6 Risk / sizing**: 0.3% risk; stop 0.5 percent; no trades during US open 5 minutes.
- **7 Evaluation**: Hold-out by month; require sign stable across 4 of 6 months.
- **Part tags**: context=premium-dislocation; regions=none; trigger=premium-persist; thesis=us-spot-leads; exit=indicator-normalize; risk=fixed-r; eval=month-sign-stability

### S126 — Single trade per day sniper
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,6,7
- **1 Context**: Only the first A+ setup of the UTC day: 4 h range break with 2x volume.
- **2 Regions**: Previous day high or low.
- **3 Trigger**: Enter on first retest of the broken previous day extreme.
- **4 Thesis / invalidation**: One shot only: avoid overtrading. Invalid if retest fails with close back inside.
- **5 Exit**: Target 2 R; if not hit by 12:00 UTC, exit.
- **6 Risk / sizing**: One trade per day, 1% risk, day finished after trade.
- **7 Evaluation**: Sample 120 days; evaluate monthly; kill if worse than 0.
- **Part tags**: context=always-on; regions=prior-hl; trigger=retest-after-break; thesis=breakout-retest; exit=target; risk=one-trade-per-day; eval=monthly-kill-rule

### S127 — CME gap fill
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none (CME prices not in repo; gap inferred from weekend perp move)
- **New vs round one**: 1,2,3,5,7
- **1 Context**: Monday 00:00 to 12:00 UTC only; weekend move at least 2 percent from Friday 22:00 UTC price.
- **2 Regions**: Friday close level (weekend gap edge).
- **3 Trigger**: Enter toward the Friday close when the first Monday 15 m bar closes in that direction with delta agreeing.
- **4 Thesis / invalidation**: Gaps tend to be filled as weekend thin-liquidity moves are retraced. Invalid if price extends 1 percent further away.
- **5 Exit**: Exit at Friday close touch; stop-and-reverse is not used; time exit Monday 20:00 UTC.
- **6 Risk / sizing**: Stop 1 percent beyond Monday high/low; 0.5% risk; at most 1 per week.
- **7 Evaluation**: Only about 50 cases per year: bootstrap CI and Bayesian fill probability with a flat prior; no kill before 25 trades.
- **Part tags**: context=weekend-gap; regions=weekly-close-level; trigger=monday-confirm-bar; thesis=gap-fill; exit=level-touch; risk=weekly-single-shot; eval=bayes-fill-rate

### S128 — Weekend thin-book range fade
- **Style tag**: mean-reversion
- **Horizon tag**: hours
- **Uses repo**: collectors: book, calendar
- **New vs round one**: 1,2,3,6
- **1 Context**: Saturday 00:00 to Sunday 20:00 UTC; depth within 10 bps under its weekday median.
- **2 Regions**: Weekend range from Friday 22:00 UTC.
- **3 Trigger**: Fade touches of the weekend range edges with a rejecting 5 m wick.
- **4 Thesis / invalidation**: Thin weekend books overshoot and recover. Invalid if the range expands twice its width.
- **5 Exit**: Exit at range middle; or 3 h.
- **6 Risk / sizing**: Size halved (liquidity thin) 0.25% risk; stop 0.6 percent; none if spread above 3 bps.
- **7 Evaluation**: Regime split weekend versus weekday for the same rule; need 60 weekend trades.
- **Part tags**: context=weekend-thin-book; regions=range-edge; trigger=wick-reject; thesis=overshoot-recovery; exit=range-middle; risk=halved-in-thin; eval=weekday-weekend-split

### S129 — US cash open fade
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 1,3,5,7
- **1 Context**: 13:30 UTC to 14:30 UTC (US equities open).
- **2 Regions**: Pre-open 30 min high and low.
- **3 Trigger**: If the first 5 minutes after 13:30 UTC move more than 1.5 sigma away from pre-open mean, fade after the first 1 m reversal bar.
- **4 Thesis / invalidation**: Opening burst overreaction by correlated flow. Invalid if second 5 min continues in the same direction.
- **5 Exit**: Exit after 20 min or at pre-open mean.
- **6 Risk / sizing**: Stop 1 sigma beyond 5 m extreme; 0.3% risk.
- **7 Evaluation**: Compare to same clock minute on holidays (no US open) as control.
- **Part tags**: context=us-open-window; regions=pre-open-range; trigger=open-burst-reverse; thesis=open-overreaction; exit=pre-open-mean; risk=fixed-r; eval=holiday-control

### S130 — Asia open drift follow
- **Style tag**: time-event
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 3,7
- **1 Context**: 00:00 to 01:00 UTC.
- **2 Regions**: None.
- **3 Trigger**: Join the direction of the first 15 minutes of the Asia open if return exceeds 0.4 percent.
- **4 Thesis / invalidation**: Asian participation introduces fresh directional flow. Invalid if the second 15 min fully retraces.
- **5 Exit**: Exit after 45 minutes.
- **6 Risk / sizing**: Fixed 1x equity; stop 0.6 percent.
- **7 Evaluation**: Day-of-week split; deflated for 3 sessions tested.
- **Part tags**: context=asia-open-window; regions=none; trigger=first-15m-return; thesis=session-flow-follow; exit=time-stop; risk=fixed-notional; eval=day-of-week-split

### S131 — Equal-highs sweep reclaim
- **Style tag**: liquidity-sweep
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 2,3,7
- **1 Context**: Always on.
- **2 Regions**: Equal highs/lows: two or more swing highs within 0.05 percent over 4 h.
- **3 Trigger**: Wick through equal highs by 0.1 to 0.3 percent then a 1 m close back below them: short.
- **4 Thesis / invalidation**: Stops stacked above equal highs get run, then price returns. Invalid if second close above.
- **5 Exit**: Target the low of the range formed; exit when 5 m closes above the sweep high.
- **6 Risk / sizing**: Stop above sweep wick; risk 0.4%.
- **7 Evaluation**: Ablation: same trigger without the equal-highs requirement.
- **Part tags**: context=always-on; regions=equal-highs-lows; trigger=equal-highs-wick-reclaim; thesis=equal-highs-stop-run; exit=range-low-target; risk=structure-stop; eval=ablation

### S132 — Weekly open bounce
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Not in first 6 h of the week.
- **2 Regions**: Weekly open price (Monday 00:00 UTC) and monthly open.
- **3 Trigger**: When price returns to the weekly open from above and prints a bullish 15 m closing bar with higher low: long; mirror.
- **4 Thesis / invalidation**: Weekly open is a reference level for positioning. Invalid if 1 h close under by 0.3 percent.
- **5 Exit**: Exit at prior week high or 12 h.
- **6 Risk / sizing**: Stop 0.4 percent under; 0.5% risk.
- **7 Evaluation**: Placebo: use weekly open shifted 12 hours; 40 touches.
- **Part tags**: context=always-on; regions=weekly-open; trigger=level-bounce-bar; thesis=reference-level-hold; exit=prior-week-extreme; risk=fixed-r; eval=level-shift-placebo

### S133 — Open interest ledge breakout
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors: derivs
- **New vs round one**: 2,3,7
- **1 Context**: OI flat (within 0.5 percent) for 2 h while price ranges.
- **2 Regions**: Range boundaries during OI compression.
- **3 Trigger**: Break of the range with OI rising 1 percent within 15 minutes: follow break.
- **4 Thesis / invalidation**: New positions opening on the break confirm commitment. Invalid if OI falls on retest.
- **5 Exit**: Trail under 15 m low; exit if OI falls 1 percent.
- **6 Risk / sizing**: Stop in range middle; 0.4% risk.
- **7 Evaluation**: Compare OI-confirmed vs unconfirmed breaks; 100 breaks.
- **Part tags**: context=oi-flat-range; regions=range-edge; trigger=break-with-oi-rise; thesis=commitment-confirm; exit=oi-fall-exit; risk=structure-stop; eval=confirmed-vs-unconfirmed

### S134 — Price up, OI down short squeeze fade
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack, collectors: derivs
- **New vs round one**: 3,4,5
- **1 Context**: Up move of at least 1.5 sigma in 30 min.
- **2 Regions**: Move high.
- **3 Trigger**: When price rises while OI falls (short covering) and delta turns negative, short the top.
- **4 Thesis / invalidation**: Short covering rallies run out when covering ends. Invalid if OI begins rising.
- **5 Exit**: Exit at 50 percent retracement or 40 min.
- **6 Risk / sizing**: Stop above move high; 0.4% risk.
- **7 Evaluation**: Futures-stack reading (delta x OI) tabulation: outcomes across the four readings.
- **Part tags**: context=short-cover-rally; regions=move-extreme; trigger=oi-down-delta-flip; thesis=covering-ends; exit=retracement-target; risk=structure-stop; eval=four-quadrant-table

### S135 — Price down, OI up trend continuation
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack
- **New vs round one**: 3,4
- **1 Context**: Down move 1.5 sigma in 30 min.
- **2 Regions**: None.
- **3 Trigger**: When price falls while OI rises and delta is negative, enter short on first 5 m pullback of 38 percent.
- **4 Thesis / invalidation**: Fresh shorts opening; flow continues. Invalid if OI falls 1 percent on pullback.
- **5 Exit**: Trail 1 sigma; exit at OI turn.
- **6 Risk / sizing**: 0.4% risk; stop above pullback high.
- **7 Evaluation**: Compare with same entries without OI condition.
- **Part tags**: context=downmove-oi-up; regions=none; trigger=pullback-entry; thesis=fresh-positions-follow; exit=oi-turn; risk=structure-stop; eval=ablation

### S136 — Long-short ratio contrarian extreme
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4,7
- **1 Context**: Top-trader long/short (ratios.topLS) in top 5 percent of 30 days.
- **2 Regions**: None.
- **3 Trigger**: Short when the account long/short ratio is >95th percentile and price is below the 1 h VWAP.
- **4 Thesis / invalidation**: Retail positioning extreme = crowded. Invalid if topLS and accountLS disagree strongly.
- **5 Exit**: Exit when ratio falls under median or 12 h.
- **6 Risk / sizing**: 0.3% risk; stop 1.2 percent.
- **7 Evaluation**: Expectancy by percentile bucket (monotonic test) rather than one threshold.
- **Part tags**: context=positioning-extreme; regions=vwap; trigger=below-vwap-after-extreme; thesis=crowding-unwind; exit=indicator-normalize; risk=fixed-r; eval=monotonic-bucket-test

### S137 — Taker ratio flip
- **Style tag**: derivatives-state
- **Horizon tag**: minutes
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,5
- **1 Context**: Taker buy/sell ratio changes sign relative to 1 within 5 min.
- **2 Regions**: None.
- **3 Trigger**: Enter in direction of taker majority after 3 consecutive 1 min readings.
- **4 Thesis / invalidation**: Takers are informed. Invalid if reading returns.
- **5 Exit**: Exit when ratio crosses back.
- **6 Risk / sizing**: 0.2% risk; stop 0.3 percent.
- **7 Evaluation**: Shuffle-time test.
- **Part tags**: context=always-on; regions=none; trigger=taker-ratio-flip; thesis=taker-informed; exit=ratio-cross-back; risk=fixed-r; eval=shuffled-time

### S138 — Hyperliquid premium shock
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4
- **1 Context**: Hyperliquid mark vs oracle premium (hlCtx.prem) more than 3 sigma of its minute-level history.
- **2 Regions**: None.
- **3 Trigger**: When the Hyperliquid premium spikes up (or down), trade Binance in that direction, because HL is assumed to lead.
- **4 Thesis / invalidation**: HL traders price information first. Invalid if premium fades within 5 s.
- **5 Exit**: Exit 30 s.
- **6 Risk / sizing**: 0.1% risk; stop 5 bps.
- **7 Evaluation**: Latency stress 0 to 3 s.
- **Part tags**: context=premium-spike; regions=none; trigger=prem-shock-lead; thesis=venue-lead; exit=time-stop; risk=fixed-r; eval=latency-stress

### S139 — Wallet position flip follow
- **Style tag**: wallet
- **Horizon tag**: hours
- **Uses repo**: collectors: wallets
- **New vs round one**: 3,6
- **1 Context**: At least 3 of 10 tracked wallets in the same position direction.
- **2 Regions**: None.
- **3 Trigger**: When the biggest tracked wallet reverses its net side with size above 20 percent of prior, follow the new side.
- **4 Thesis / invalidation**: Large informed wallet changes view. Invalid if they flip back within 1 hour.
- **5 Exit**: Exit on wallet flip back or 6 h.
- **6 Risk / sizing**: 0.3% risk; stop 1 percent; max leverage 3x.
- **7 Evaluation**: Count wallet flips; need 40; permutation vs random times.
- **Part tags**: context=wallet-consensus; regions=none; trigger=wallet-flip; thesis=informed-follow; exit=wallet-flip-back; risk=fixed-r; eval=permutation-times

### S140 — Volatility-contraction exit breakout
- **Style tag**: breakout
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **New vs round one**: 3,5,7
- **1 Context**: Sigma at its lowest decile of 24 h for at least 20 minutes.
- **2 Regions**: Compression range of the last 30 minutes.
- **3 Trigger**: Break of the compression range with 1 m volume above 2x median: enter in the break direction.
- **4 Thesis / invalidation**: Volatility expansion follows compression. Invalid if price returns inside the range within 3 bars.
- **5 Exit**: Exit when sigma (1 min realized) falls back below its 30 min median after expansion (volatility-contraction exit); no price target.
- **6 Risk / sizing**: Stop at range middle; risk 0.4%; max 3 trades per day.
- **7 Evaluation**: Walk-forward over 8 weeks; expectancy and MAE distribution shown; kill if average MAE exceeds 0.8 R.
- **Part tags**: context=vol-compressed; regions=compression-range; trigger=range-break-volume; thesis=vol-expansion; exit=vol-contraction-exit; risk=structure-stop; eval=mae-distribution

### S141 — Maximum adverse excursion exit rule
- **Style tag**: mean-reversion
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 5,6,7
- **1 Context**: Balanced context.
- **2 Regions**: VWAP deviation of 2 sigma.
- **3 Trigger**: Fade a 2 sigma VWAP deviation when 5 m RSI(14) is below 15 (or above 85) and the next 1 m bar reverses.
- **4 Thesis / invalidation**: Oversold or overbought extremes revert to value.
- **5 Exit**: Exit immediately if adverse excursion passes the 80th percentile of past winners MAE (data-derived), else target VWAP.
- **6 Risk / sizing**: MAE cap replaces a fixed stop; 0.4% risk at the cap; recomputed every 50 trades.
- **7 Evaluation**: Compare MAE-cap to fixed stop on same entries; require lower tail loss.
- **Part tags**: context=balanced; regions=vwap-band; trigger=vwap-dev-rsi-extreme; thesis=oversold-revert; exit=mae-percentile-cap; risk=mae-derived-stop; eval=stop-rule-compare

### S142 — Giving-back trailing profit lock
- **Style tag**: momentum
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 5,6
- **1 Context**: Trend context (1 h return > 1 sigma).
- **2 Regions**: None.
- **3 Trigger**: Enter on 15 minute high break.
- **4 Thesis / invalidation**: Trend persistence.
- **5 Exit**: Exit when open profit gives back 35 percent of its peak (once above 1 R); otherwise time stop 90 min.
- **6 Risk / sizing**: Stop 1 sigma; 0.5% risk.
- **7 Evaluation**: Sharpe vs fixed trail; 150 trades.
- **Part tags**: context=trend; regions=none; trigger=prior-high-break; thesis=continuation; exit=give-back-rule; risk=fixed-r; eval=exit-rule-compare

### S143 — Re-entry after stop-out
- **Style tag**: breakout
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 3,5,6
- **1 Context**: Always on.
- **2 Regions**: Range of last 2 h.
- **3 Trigger**: Break entry; if stopped out and price recovers the break level within 10 minutes, re-enter once at the same level.
- **4 Thesis / invalidation**: False stops are common near levels. Invalid if second stop.
- **5 Exit**: Target 2 R; second entry exit at 1 R.
- **6 Risk / sizing**: Max 2 attempts per level; total risk on level capped at 0.6% (both attempts combined).
- **7 Evaluation**: Ablation: with versus without re-entry, paired by level.
- **Part tags**: context=always-on; regions=range-edge; trigger=break-reentry; thesis=false-stop-recover; exit=target; risk=level-risk-cap; eval=ablation

### S144 — Partial exits on flow reversal
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst
- **New vs round one**: 5,6
- **1 Context**: Burst episode active.
- **2 Regions**: None.
- **3 Trigger**: Enter on the first pullback of 0.3 sigma lasting under 20 s after the burst episode turns active.
- **4 Thesis / invalidation**: A shallow dip inside an active burst is bought by the same aggressors.
- **5 Exit**: Take one third when signed flow weakens 50 percent, another third when it reverses sign for 20 s, final third trailing on 5 m low.
- **6 Risk / sizing**: Total risk 0.5%; stop 1 sigma.
- **7 Evaluation**: Per-leg attribution of PnL: which leg adds value.
- **Part tags**: context=burst-episode; regions=none; trigger=burst-dip-20s; thesis=burst-dip-bought; exit=flow-scaled-out; risk=fixed-r; eval=per-leg-attribution

### S145 — Opposing-wall exit trend rider
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall
- **New vs round one**: 5,7
- **1 Context**: Trend context.
- **2 Regions**: None.
- **3 Trigger**: Break of the 15 minute high while open interest rose over 0.5 percent in 10 minutes: long.
- **4 Thesis / invalidation**: Trend moves with new positions behind them extend.
- **5 Exit**: Exit when a wall episode becomes active on the opposing side within 0.3 percent ahead of price.
- **6 Risk / sizing**: 0.5% risk; stop 0.8 percent.
- **7 Evaluation**: Compare to same without wall exit.
- **Part tags**: context=trend; regions=none; trigger=high-break-oi-rise; thesis=oi-confirmed-trend; exit=opposing-wall; risk=fixed-r; eval=ablation

### S146 — Thesis-decay score exit
- **Style tag**: hybrid
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes:absorption, collectors: derivs
- **New vs round one**: 4,5,7
- **1 Context**: Absorption episode active.
- **2 Regions**: Absorption band.
- **3 Trigger**: Enter with absorption; at entry write checklist of 5 assumptions (episode active, OI not rising against, funding not extreme, delta aligned, spread normal).
- **4 Thesis / invalidation**: Each assumption is falsifiable and logged.
- **5 Exit**: Exit when 2 of 5 assumptions fail (thesis-decay score), rechecked every 10 s.
- **6 Risk / sizing**: 0.4% risk; stop 0.7 sigma.
- **7 Evaluation**: Calibration: probability of win by number of assumptions held.
- **Part tags**: context=absorption-episode; regions=absorption-band; trigger=absorption-ep; thesis=checklist-assumptions; exit=thesis-decay-score; risk=fixed-r; eval=calibration-by-score

### S147 — Delta-neutral basis harvest (cash and carry)
- **Style tag**: derivatives-state
- **Horizon tag**: multi-day
- **Uses repo**: collectors: derivs
- **New vs round one**: 1,3,4,5,6,7
- **1 Context**: Funding positive for 3 consecutive periods and annualized basis above 12 percent.
- **2 Regions**: None.
- **3 Trigger**: Long spot and short perp when annualized basis above threshold.
- **4 Thesis / invalidation**: Funding paid by longs is collected. Invalid if funding sign flips twice.
- **5 Exit**: Exit when annualized basis under 4 percent.
- **6 Risk / sizing**: Hedge ratio 1:1; leverage 1.5x on perp leg; margin buffer 30 percent; exit if distance to liquidation under 20 percent.
- **7 Evaluation**: Annualized net-of-fee carry vs T-bill; stress with exchange failure (assume 1 percent loss).
- **Part tags**: context=positive-funding-streak; regions=none; trigger=basis-threshold; thesis=carry-collection; exit=basis-normalize; risk=hedged-margin-buffer; eval=carry-vs-riskfree

### S148 — Funding differential arbitrage (Binance vs Hyperliquid)
- **Style tag**: cross-venue
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs, wallets
- **New vs round one**: 3,4,6,7
- **1 Context**: Funding spread between venues above 4 bps per 8 h net of fees (predicted funding across venues).
- **2 Regions**: None.
- **3 Trigger**: Short high-funding venue and long low-funding venue.
- **4 Thesis / invalidation**: Funding differential is paid. Invalid if spread closes.
- **5 Exit**: Exit when spread under 1 bp.
- **6 Risk / sizing**: Notional matched; max 2x per venue.
- **7 Evaluation**: Realized funding vs predicted; need 30 trades.
- **Part tags**: context=funding-spread; regions=none; trigger=funding-spread-open; thesis=funding-differential; exit=spread-close; risk=matched-notional; eval=realized-vs-predicted

### S149 — Perp vs spot dislocation (Binance spot)
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors: venues
- **New vs round one**: 3,4,7
- **1 Context**: Spot and perp mark spread above 8 bps.
- **2 Regions**: None.
- **3 Trigger**: Trade perp toward spot when basis deviation spikes.
- **4 Thesis / invalidation**: Short-lived dislocations close.
- **5 Exit**: Exit at basis within 2 bps.
- **6 Risk / sizing**: 0.2% risk; stop 6 bps.
- **7 Evaluation**: Fee stress: need 3 bps net.
- **Part tags**: context=basis-dislocation; regions=none; trigger=basis-spike; thesis=spot-perp-converge; exit=basis-converge; risk=fixed-r; eval=fee-stress

### S150 — Stablecoin depeg risk-off short
- **Style tag**: event
- **Horizon tag**: hours
- **Uses repo**: none (needs a stablecoin price feed, which the repo lacks)
- **New vs round one**: 1,3,4,5,7
- **1 Context**: USDT or USDC trades more than 30 bps from par on a major spot venue; spread on BTC perp still under 3 bps.
- **2 Regions**: None.
- **3 Trigger**: At detection, short BTC perp at market in proportion to the depeg size (30 bps = 1 unit, 100 bps = 2 units).
- **4 Thesis / invalidation**: Depeg triggers risk-off redemption flow and margin stress. Invalid if the peg restores within 15 minutes with BTC down under 0.3 percent.
- **5 Exit**: Exit when peg back within 10 bps, or after 6 h; no price target.
- **6 Risk / sizing**: Hard stop 1.5 percent; max 2 units; leverage 2x; at most 1 trade per episode.
- **7 Evaluation**: Rare-event study only: log every depeg of the last 3 years, report the path of BTC after, no kill rule, no claim before 10 events.
- **Part tags**: context=stablecoin-depeg; regions=none; trigger=peg-deviation; thesis=redemption-risk-off; exit=peg-restored; risk=signal-scaled-size; eval=rare-event-study

### S151 — Exchange outage queued-order release
- **Style tag**: event
- **Horizon tag**: minutes
- **Uses repo**: collectors: telemetry, venues
- **New vs round one**: 1,3,4,5,7
- **1 Context**: One major venue stops updating for over 20 s while the other venues stream normally (telemetry shows the silent feed).
- **2 Regions**: Price level on the silent venue at the moment its feed stopped.
- **3 Trigger**: On the quoting venues, take the side of the unusual one-sided taker flow seen during the silence.
- **4 Thesis / invalidation**: Orders pile up on the dead venue and are released on return, moving the remaining venues. Invalid if the venue returns with price within 5 bps of the frozen level.
- **5 Exit**: Exit 90 s after the venue resumes, or immediately if price touches the frozen level.
- **6 Risk / sizing**: Fixed 0.1% risk; stop 10 bps; 1 position; skip if the outage is on our own execution venue.
- **7 Evaluation**: Event study over logged outages; separate feed glitches from true outages; no kill before 15 events.
- **Part tags**: context=venue-outage; regions=frozen-level; trigger=venue-silence-flow; thesis=queued-orders-release; exit=resume-plus-delay; risk=small-fixed-stop; eval=rare-event-study

### S152 — Listing-day perp frenzy fade (alt, BTC hedge)
- **Style tag**: event
- **Horizon tag**: hours
- **Uses repo**: none (needs listing calendar)
- **New vs round one**: 1,3,4,5,6,7
- **1 Context**: A new perp of a mid-cap alt lists; the first hour volume exceeds 5x its pre-listing spot volume.
- **2 Regions**: Opening price of the new perp.
- **3 Trigger**: After the first 60 minutes, short the new perp if it is above its opening price and the 5 m delta turns negative; hedge with a BTC long of equal beta-adjusted notional.
- **4 Thesis / invalidation**: New listings spike on retail inflow and mean-revert as supply comes from unlockers. Invalid if price keeps making new highs on rising volume after hour two.
- **5 Exit**: Exit at 50 percent retrace of the listing run, or after 24 h.
- **6 Risk / sizing**: Hedged pair; total gross 1.5x; stop 25 percent of run on the alt leg; one listing at a time.
- **7 Evaluation**: Event study over at least 20 listings; hedged PnL, not raw; kill if median hedged return negative.
- **Part tags**: context=new-listing; regions=listing-open; trigger=post-hour-delta-turn; thesis=retail-spike-mean-revert; exit=retrace-target; risk=hedged-pair; eval=event-study-hedged

### S153 — Stop-and-reverse on failed breakout
- **Style tag**: breakout
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 3,5,6
- **1 Context**: Range context: the last 2 h range width under 1.5 percent.
- **2 Regions**: Range high and low.
- **3 Trigger**: Enter on a range break; if price closes back inside within 5 bars, reverse the position (stop-and-reverse) rather than only closing.
- **4 Thesis / invalidation**: The failure is information: trapped breakout traders fuel the reverse move.
- **5 Exit**: Reversed leg exits at the opposite range edge; first leg stopped by reversal itself.
- **6 Risk / sizing**: Each leg risks 0.3%; max one reversal per level; loss cap 0.8% per level.
- **7 Evaluation**: Compare to the same breakout stop-only; reversal contribution separately.
- **Part tags**: context=range-bound; regions=range-edge; trigger=break-then-reverse; thesis=failed-break-fuel; exit=stop-and-reverse; risk=level-risk-cap; eval=leg-attribution

### S154 — Value area acceptance breakout
- **Style tag**: volume-profile
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,2,3,7
- **1 Context**: Prior day was a balanced profile (value area width under 1.5 percent).
- **2 Regions**: Prior-day value area high and low.
- **3 Trigger**: Two consecutive 30 m closes outside the value area in the same direction: enter with the break at next bar open.
- **4 Thesis / invalidation**: Acceptance outside value signals a new value area and trend day. Invalid if price returns to the old value area and holds 2 bars.
- **5 Exit**: Exit at 2x value area width projection, or on return to value.
- **6 Risk / sizing**: Stop at the opposite value area side halfway; 0.5% risk.
- **7 Evaluation**: Compare to single-close breakouts (ablation on acceptance rule); 80 trades.
- **Part tags**: context=balanced-prior-profile; regions=value-area-edge; trigger=two-close-acceptance; thesis=value-migration; exit=projection-target; risk=structure-stop; eval=ablation

### S155 — POC rejection after volume spike
- **Style tag**: volume-profile
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 2,3,7
- **1 Context**: Session profile has a clear POC with 15 percent more volume than neighbours.
- **2 Regions**: Developing session POC.
- **3 Trigger**: Price retests developing POC from above with falling volume and a hammer-like 5 m close above it: long.
- **4 Thesis / invalidation**: Developing POC acts as session fair value. Invalid if 15 m close through by 0.2 percent.
- **5 Exit**: Exit at session high or 1.5 R.
- **6 Risk / sizing**: Stop 0.25 percent under POC; risk 0.4%.
- **7 Evaluation**: Per-session sample; 100 sessions; sign test across sessions.
- **Part tags**: context=clear-poc-session; regions=developing-poc; trigger=poc-retest-hammer; thesis=fair-value-hold; exit=session-high-target; risk=structure-stop; eval=sign-test-sessions

### S156 — Round-number magnet with stop-hunt
- **Style tag**: liquidity-sweep
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 3,4,7
- **1 Context**: Always on.
- **2 Regions**: Round numbers at multiples of 5000 for BTC.
- **3 Trigger**: Trade a wick through a 5000 multiple by at least 0.15 percent that closes back on the original side: fade the wick.
- **4 Thesis / invalidation**: Resting stops beyond round numbers get run, then price returns.
- **5 Exit**: Exit at the 5 m VWAP.
- **6 Risk / sizing**: Stop 0.2 percent beyond wick; 0.3% risk.
- **7 Evaluation**: Compare to multiples of 5000 plus 700 (placebo); 100 events.
- **Part tags**: context=always-on; regions=round-number; trigger=round-wick-reclaim; thesis=liquidity-grab; exit=vwap-target; risk=fixed-r; eval=level-shift-placebo

### S157 — Liquidation heat map edge approach
- **Style tag**: liquidation
- **Horizon tag**: minutes
- **Uses repo**: futures-stack
- **New vs round one**: 2,3,4
- **1 Context**: Futures-stack shows rising liquidation intensity on one side in the last 10 minutes.
- **2 Regions**: Estimated liquidation cluster price from the heat map of leverage tiers (approximate; the repo has realized liquidations only).
- **3 Trigger**: Enter in direction of the nearest cluster after a 2 m consolidation, expecting price to be pulled into it.
- **4 Thesis / invalidation**: Dense liquidation estimates attract price (liquidity targets).
- **5 Exit**: Exit on first liquidation spike confirmed (futures-stack highlight) at the cluster.
- **6 Risk / sizing**: Stop 0.5 percent; size 0.3% risk.
- **7 Evaluation**: Heat map estimates are approximate: test sensitivity to cluster definition (3 variants).
- **Part tags**: context=liq-intensity-rising; regions=estimated-liq-cluster; trigger=consolidation-toward-cluster; thesis=liquidity-target; exit=liq-spike-exit; risk=fixed-r; eval=definition-sensitivity

### S158 — Footprint delta flip at VWAP
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: none (footprint not in repo)
- **New vs round one**: 1,2,3,7
- **1 Context**: Session VWAP defined; price within 0.1 percent of it.
- **2 Regions**: Session VWAP.
- **3 Trigger**: Cumulative delta of the last 3 bars flips sign at VWAP touch with 2x average volume: trade with the flipped sign.
- **4 Thesis / invalidation**: Aggressors change side at fair value.
- **5 Exit**: Exit after 12 bars or on delta flip back.
- **6 Risk / sizing**: Stop 0.25 percent; 0.3% risk.
- **7 Evaluation**: Out-of-sample on ETH.
- **Part tags**: context=near-vwap; regions=vwap; trigger=delta-flip-at-level; thesis=aggressor-switch; exit=flow-reversal; risk=fixed-r; eval=cross-asset-oos

### S159 — Trade-size shift (large prints surge)
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: collectors: telemetry
- **New vs round one**: 1,3,4,7
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Average trade size over 60 s more than 2x its 1 h average while price moves under 0.3 sigma: join the side of the large prints once price breaks the 60 s range.
- **4 Thesis / invalidation**: Large participants begin to build positions quietly before price follows.
- **5 Exit**: Exit at 10 minutes or on size normalization.
- **6 Risk / sizing**: Stop 0.8 sigma; 0.3% risk.
- **7 Evaluation**: Shuffled-time baseline.
- **Part tags**: context=always-on; regions=none; trigger=trade-size-surge; thesis=stealth-accumulation; exit=size-normalization; risk=fixed-r; eval=shuffled-time

### S160 — Small-trade retail herding fade
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 1,3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: When trade count spikes 3x with average size under half the norm and price rallies 1 sigma, short the exhaustion.
- **4 Thesis / invalidation**: Retail herding at extremes.
- **5 Exit**: Exit at 50 percent retrace.
- **6 Risk / sizing**: 0.3% risk; stop above high.
- **7 Evaluation**: Control with rallies without herding.
- **Part tags**: context=always-on; regions=none; trigger=herd-spike; thesis=retail-herding; exit=retracement-target; risk=fixed-r; eval=matched-control

### S161 — Spoof wall flicker
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: reader-episodes:wall
- **New vs round one**: 1,3,4,7
- **1 Context**: Wall episode present with at least 3 appearances and disappearances in 60 s.
- **2 Regions**: The wall price.
- **3 Trigger**: Trade against the direction the wall suggests when it flickers.
- **4 Thesis / invalidation**: Flickering walls are spoofing, not support.
- **5 Exit**: Exit after 30 s.
- **6 Risk / sizing**: Stop 5 bps; 0.1% risk.
- **7 Evaluation**: Latency stress.
- **Part tags**: context=wall-flicker; regions=wall; trigger=wall-flicker; thesis=spoof-reveal; exit=time-stop; risk=fixed-r; eval=latency-stress

### S162 — Order book imbalance mean reversion
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors: book
- **New vs round one**: 3,5
- **1 Context**: Imbalance (bookBn.imbalance5) beyond +0.7 for over 10 s.
- **2 Regions**: None.
- **3 Trigger**: Fade the extreme imbalance if price did not follow.
- **4 Thesis / invalidation**: Imbalance without price move is a trap.
- **5 Exit**: Exit when imbalance returns under 0.3.
- **6 Risk / sizing**: 0.1% risk; stop 4 bps.
- **7 Evaluation**: Control with matching imbalance and price follow.
- **Part tags**: context=imbalance-extreme; regions=none; trigger=imbalance-no-follow; thesis=imbalance-trap; exit=indicator-normalize; risk=fixed-r; eval=matched-control

### S163 — Depth recovery after sweep
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors: book
- **New vs round one**: 3,4,5
- **1 Context**: After a market-order sweep of more than 1 sigma in 5 s.
- **2 Regions**: Sweep extreme.
- **3 Trigger**: When depth within 5 bps recovers above 80 percent of its prior level and price has retraced 20 percent, fade the sweep.
- **4 Thesis / invalidation**: Liquidity providers re-enter and bring price back.
- **5 Exit**: Exit at 60 percent retrace or 2 minutes.
- **6 Risk / sizing**: Stop 6 bps beyond extreme; 0.15% risk.
- **7 Evaluation**: Latency 1 s stress.
- **Part tags**: context=post-sweep; regions=sweep-extreme; trigger=depth-recovery; thesis=makers-return; exit=retracement-target; risk=fixed-r; eval=latency-stress

### S164 — Weekly range reversion with monthly bias
- **Style tag**: mean-reversion
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 1,2,3,5,6,7
- **1 Context**: Previous 7 days range under 12 percent; price above the monthly open sets long bias only.
- **2 Regions**: Prior week high and low; monthly open.
- **3 Trigger**: Buy a daily close within 20 percent of the prior week low if above monthly open; sell the mirror only when below.
- **4 Thesis / invalidation**: Weeks in a range rotate; the monthly open filters the dominant side. Invalid if a daily close breaks the weekly low by 1 percent.
- **5 Exit**: Exit at weekly midpoint; time stop 5 days.
- **6 Risk / sizing**: Stop 1 percent under weekly low; size 0.5% risk; 3x leverage cap; skip after 2 consecutive losses until the next Monday.
- **7 Evaluation**: Report on 2 years of days; permutation of monthly-open filter side; need 30 trades.
- **Part tags**: context=monthly-bias-range; regions=prior-week-extreme; trigger=daily-close-near-extreme; thesis=weekly-rotation; exit=midpoint-target; risk=streak-pause; eval=filter-permutation

### S165 — Monthly close seasonality
- **Style tag**: time-event
- **Horizon tag**: multi-day
- **Uses repo**: calendar
- **New vs round one**: 1,3,4,6,7
- **1 Context**: Last 3 days of calendar month through first 2 days of next month.
- **2 Regions**: None.
- **3 Trigger**: Buy at the close of the third last day of the month, hold.
- **4 Thesis / invalidation**: Month-end rebalancing flow supports prices.
- **5 Exit**: Exit at the close of day 2 of next month.
- **6 Risk / sizing**: Fixed 1x; no stop but 8 percent disaster stop.
- **7 Evaluation**: Needs about 50 months; permutation vs random 5-day windows; deflated by number of calendar windows tried.
- **Part tags**: context=month-end-window; regions=none; trigger=calendar-date; thesis=rebalancing-flow; exit=calendar-exit; risk=disaster-stop-only; eval=window-permutation

### S166 — Quarterly expiry volatility sell-off
- **Style tag**: options-vol
- **Horizon tag**: multi-day
- **Uses repo**: collectors: options
- **New vs round one**: 1,3,5,7
- **1 Context**: Final week before quarterly Deribit expiry with open interest above its 90 day median.
- **2 Regions**: Biggest-open-interest strikes.
- **3 Trigger**: Sell exposure (short) 3 days before expiry if ATM implied vol is rising faster than realized.
- **4 Thesis / invalidation**: Hedging unwinds around expiry raise vol.
- **5 Exit**: Exit at the day after expiry.
- **6 Risk / sizing**: Stop 4 percent; 0.5% risk.
- **7 Evaluation**: Only 4 events per year: pool BTC and ETH; report as anecdotal.
- **Part tags**: context=pre-quarterly-expiry; regions=high-oi-strike; trigger=iv-rise-vs-rv; thesis=hedge-unwind; exit=post-expiry-exit; risk=wide-fixed-stop; eval=anecdotal-pooled

### S167 — Skew spike contrarian
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors: options
- **New vs round one**: 3,4
- **1 Context**: Option skew (optChain.skew5) at 95th percentile of 30 days.
- **2 Regions**: None.
- **3 Trigger**: Buy BTC perp when put skew (25 delta) spikes to extreme and price is flat.
- **4 Thesis / invalidation**: Fear priced in options peaks near local lows.
- **5 Exit**: Exit when skew normalizes under median.
- **6 Risk / sizing**: 0.3% risk; stop 1.2 percent.
- **7 Evaluation**: Percentile buckets, monotonic test.
- **Part tags**: context=skew-extreme; regions=none; trigger=skew-spike; thesis=fear-peak; exit=indicator-normalize; risk=fixed-r; eval=monotonic-bucket-test

### S168 — DVOL jump momentum
- **Style tag**: options-vol
- **Horizon tag**: minutes
- **Uses repo**: collectors: options
- **New vs round one**: 3,4,5
- **1 Context**: DVOL (dvol.vol) rises more than 3 percent in 10 minutes.
- **2 Regions**: None.
- **3 Trigger**: Trade in the direction of the last 15 minute return when DVOL jumps.
- **4 Thesis / invalidation**: Implied vol jump marks informed flow into options with directional meaning.
- **5 Exit**: Exit when DVOL stops rising for 2 readings (10 s each) — a vol-flow exit.
- **6 Risk / sizing**: 0.3% risk; stop 0.7 percent.
- **7 Evaluation**: Shuffle DVOL series within day.
- **Part tags**: context=dvol-jump; regions=none; trigger=dvol-jump; thesis=informed-options-flow; exit=vol-stall-exit; risk=fixed-r; eval=shuffled-series

### S169 — Implied-vs-realized vol harvest
- **Style tag**: options-vol
- **Horizon tag**: multi-day
- **Uses repo**: collectors: options
- **New vs round one**: 3,4,5,6,7
- **1 Context**: ATM implied vol more than 25 percent above 7 day realized.
- **2 Regions**: None (linear perp only; this is a proxy where short-vol is approximated by fading range expansions).
- **3 Trigger**: Fade moves over 2 sigma on days when IV is rich relative to realized.
- **4 Thesis / invalidation**: IV premium implies overpriced tails; realized stays low.
- **5 Exit**: Exit at day end.
- **6 Risk / sizing**: Size inversely to IV/RV gap: smaller when the gap shrinks; stop 1.5 sigma.
- **7 Evaluation**: Compare to unconditional fade; note the repo has no option execution.
- **Part tags**: context=iv-rich; regions=none; trigger=big-move-fade; thesis=vol-risk-premium; exit=day-end; risk=signal-scaled-size; eval=conditional-vs-unconditional

### S170 — Venue-local liquidation fade
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: futures-stack, collectors: wallets
- **New vs round one**: 3,4,7
- **1 Context**: Binance liquidation spike confirmed while Hyperliquid has none.
- **2 Regions**: None.
- **3 Trigger**: Fade the move since the forced flow is venue specific.
- **4 Thesis / invalidation**: Venue-local forced flow does not move the global price for long.
- **5 Exit**: Exit after 5 minutes.
- **6 Risk / sizing**: 0.3% risk; stop 0.5 percent.
- **7 Evaluation**: Compare to both-venue spikes.
- **Part tags**: context=single-venue-liq; regions=none; trigger=venue-local-liq; thesis=local-forced-flow; exit=time-stop; risk=fixed-r; eval=both-venue-contrast

### S171 — Liquidation wave continuation
- **Style tag**: liquidation
- **Horizon tag**: minutes
- **Uses repo**: futures-stack
- **New vs round one**: 3,4,5
- **1 Context**: Liquidation spike on longs with OI falling.
- **2 Regions**: Spike low.
- **3 Trigger**: After a 2 m pause enter short with continuation.
- **4 Thesis / invalidation**: Cascades come in waves.
- **5 Exit**: Exit on 3 m delta flip.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Wave count.
- **Part tags**: context=liq-wave; regions=spike-extreme; trigger=pause-continuation; thesis=cascade-waves; exit=delta-flip; risk=fixed-r; eval=wave-count-study

### S172 — Sigma-band breakout with sizing by sigma rank
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 3,6
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: A 5 minute return above 1.5 sigma with spread under 1 bp: join it at the next bar open.
- **4 Thesis / invalidation**: Volatility-scaled momentum persists a few bars.
- **5 Exit**: Time stop 20 min.
- **6 Risk / sizing**: Size inversely proportional to current sigma percentile (smaller in high vol).
- **7 Evaluation**: Sharpe vs flat.
- **Part tags**: context=always-on; regions=none; trigger=sigma-return-clean-spread; thesis=vol-scaled-momentum; exit=time-stop; risk=sigma-rank-size; eval=sizing-ablation

### S173 — CVD level retest
- **Style tag**: microstructure
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Always on.
- **2 Regions**: CVD level: cumulative delta swing high/low on 1 h, mapped to price.
- **3 Trigger**: Retest of the price where CVD swing was formed: join the dominant delta direction.
- **4 Thesis / invalidation**: Positions made at CVD swings defend the price.
- **5 Exit**: Target prior swing.
- **6 Risk / sizing**: Stop 0.35 percent.
- **7 Evaluation**: Ablation.
- **Part tags**: context=always-on; regions=cvd-level; trigger=cvd-level-retest; thesis=level-defense; exit=target; risk=fixed-r; eval=ablation

### S174 — Exhaustion episode with price near extreme, two-leg exit
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:exhaustion, sigma
- **New vs round one**: 5,6,7
- **1 Context**: Exhaustion episode active (price near the extreme, as the exhNear rule requires); funding not extreme in the move direction.
- **2 Regions**: Extreme of the last 30 minutes.
- **3 Trigger**: Fade the move the moment the episode turns active and at least 3 evidence items are met.
- **4 Thesis / invalidation**: The aggressive side is spent. Invalid if the episode returns to forming without a price reversal or price makes a new extreme by 0.3 sigma.
- **5 Exit**: Leg 1: half off at 0.8 sigma; leg 2: exit when the episode ends or after 25 min, with stop moved to break-even after leg 1.
- **6 Risk / sizing**: Stop 0.5 sigma beyond the extreme; risk 0.4%; if leg 1 hits, risk-free remainder.
- **7 Evaluation**: Label-based: use the repo agree/disagree labels as ground truth; precision per day with Wilson interval; at least 40 labelled groups.
- **Part tags**: context=exhaustion-episode; regions=recent-extreme; trigger=exhaustion-ep; thesis=aggressor-spent; exit=two-leg-breakeven; risk=fixed-r; eval=label-precision-wilson

### S175 — Episode group consensus (fast and mid agree)
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption, exhaustion, burst, wall
- **New vs round one**: 3,7
- **1 Context**: Reader group layer shows at least two episode families in agreement within groupGapMs.
- **2 Regions**: None.
- **3 Trigger**: Enter when a group contains both an absorption and a wall episode on the same side.
- **4 Thesis / invalidation**: Independent evidence families agreeing raises odds. Invalid if any member ends against.
- **5 Exit**: Exit when the group ends.
- **6 Risk / sizing**: 0.5% risk; stop 0.7 sigma.
- **7 Evaluation**: Compare groups with 2 families vs 1 family: scoreboard from reader-scoreboard.
- **Part tags**: context=multi-family-group; regions=none; trigger=family-consensus; thesis=independent-evidence; exit=group-end; risk=fixed-r; eval=scoreboard-families

### S176 — Resumed-episode second chance
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:exhaustion
- **New vs round one**: 3,4
- **1 Context**: An episode that went fading and then resumed (resumable state).
- **2 Regions**: Same band as the first episode.
- **3 Trigger**: Enter only on resume, not on the first activation.
- **4 Thesis / invalidation**: A resumed episode shows the first pass was a pause, not an end.
- **5 Exit**: Exit when it ends the second time.
- **6 Risk / sizing**: 0.4% risk; stop 0.6 sigma.
- **7 Evaluation**: Compare first-activation vs resume entries; need 60 resumes.
- **Part tags**: context=resumed-episode; regions=episode-band; trigger=episode-resume; thesis=pause-not-end; exit=episode-end; risk=fixed-r; eval=first-vs-resume

### S177 — Late-fading absorption entry (contrarian to episode)
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption
- **New vs round one**: 3,4,5
- **1 Context**: Absorption episode in fading state.
- **2 Regions**: Absorption band.
- **3 Trigger**: Enter against the absorbed side once the episode fades: the passive side has run out of size.
- **4 Thesis / invalidation**: Absorbing side gets exhausted; the previous aggressor breaks through.
- **5 Exit**: Exit with a trailing 0.8 sigma stop; no target.
- **6 Risk / sizing**: Stop at band edge; 0.4% risk.
- **7 Evaluation**: Mirror test against standard absorption entry on the same episodes.
- **Part tags**: context=absorption-fading; regions=absorption-band; trigger=fading-flip; thesis=passive-exhausted; exit=trailing; risk=structure-stop; eval=mirror-test

### S178 — Wall absorbed then broken
- **Style tag**: breakout
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall, absorption
- **New vs round one**: 3,4
- **1 Context**: Wall episode on resistance.
- **2 Regions**: Wall price.
- **3 Trigger**: Enter long when price trades through the wall price and the wall episode ends via traded volume rather than pulling.
- **4 Thesis / invalidation**: Wall consumed means supply was exhausted.
- **5 Exit**: Exit at 1.2 sigma or when a new wall forms ahead.
- **6 Risk / sizing**: Stop under wall price; 0.4% risk.
- **7 Evaluation**: Vs pulled-wall control.
- **Part tags**: context=wall-episode; regions=wall; trigger=wall-consumed; thesis=supply-exhausted; exit=opposing-wall; risk=structure-stop; eval=pulled-vs-traded-control

### S179 — Wall as a stop level, trivial entry
- **Style tag**: price-action
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes:wall
- **New vs round one**: 1,6
- **1 Context**: Always on.
- **2 Regions**: Wall.
- **3 Trigger**: Enter long at any time price touches an active bid wall; the entry rule itself is trivial.
- **4 Thesis / invalidation**: Wall defends.
- **5 Exit**: Exit when the wall ends.
- **6 Risk / sizing**: Stop is wall price minus 3 bps — the wall defines the stop.
- **7 Evaluation**: Win-rate vs random touches.
- **Part tags**: context=always-on; regions=wall; trigger=wall-touch; thesis=wall-defends; exit=wall-end; risk=wall-anchored-stop; eval=vs-random-entry

### S180 — Pure time stop coin flip baseline
- **Style tag**: baseline
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 1,2,3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Enter long or short at random times (random side) once every 30 minutes.
- **4 Thesis / invalidation**: No thesis; this baseline measures the cost of trading.
- **5 Exit**: Time stop 10 minutes.
- **6 Risk / sizing**: Fixed 0.1% risk, 3 sigma stop.
- **7 Evaluation**: Used as the null: expected return equals minus fees; any system must exceed it.
- **Part tags**: context=always-on; regions=none; trigger=random-entry; thesis=none-baseline; exit=time-stop; risk=fixed-r; eval=cost-null

### S181 — Buy at 8 hour funding payment (always long)
- **Style tag**: time-event
- **Horizon tag**: multi-day
- **Uses repo**: calendar
- **New vs round one**: 3,4,7
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Buy at each negative funding timestamp.
- **4 Thesis / invalidation**: Negative funding pays longs.
- **5 Exit**: Exit after 8 h.
- **6 Risk / sizing**: Fixed notional; stop 2 percent.
- **7 Evaluation**: Include funding received in PnL explicitly.
- **Part tags**: context=always-on; regions=none; trigger=negative-funding-time; thesis=funding-income; exit=time-stop; risk=fixed-notional; eval=funding-inclusive

### S182 — Contrarian after three green daily candles
- **Style tag**: price-action
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 3,4
- **1 Context**: Three consecutive daily closes up each over 2 percent.
- **2 Regions**: None.
- **3 Trigger**: Short at the next 4 h close.
- **4 Thesis / invalidation**: Streak exhaustion.
- **5 Exit**: Exit after 3 days.
- **6 Risk / sizing**: 1x; stop 4 percent.
- **7 Evaluation**: Streak length buckets; needs 60 occurrences.
- **Part tags**: context=up-streak; regions=none; trigger=daily-streak; thesis=streak-exhaustion; exit=time-stop; risk=fixed-notional; eval=streak-buckets

### S183 — Gap between perp and index flash
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors: venues
- **New vs round one**: 3,4,7
- **1 Context**: Flash wick on one venue (over 15 bps in 2 s).
- **2 Regions**: Index price.
- **3 Trigger**: Trade other venues toward the index as flash reverts.
- **4 Thesis / invalidation**: Mark vs index dislocation closes.
- **5 Exit**: Exit at index.
- **6 Risk / sizing**: Stop 8 bps.
- **7 Evaluation**: Latency 1 s.
- **Part tags**: context=flash-dislocation; regions=index-level; trigger=wick-vs-index; thesis=dislocation-close; exit=level-touch; risk=fixed-r; eval=latency-stress

### S184 — Majors breadth momentum
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: collectors: venues
- **New vs round one**: 1,3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: When ETH, SOL, BNB, XRP, DOGE marks are all up over 3 sigma_i in 5 min while BTC lags: long BTC.
- **4 Thesis / invalidation**: Broad risk-on will pull the laggard.
- **5 Exit**: Exit when BTC return catches 70 percent of the majors average.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Out-of-sample on ETH as target.
- **Part tags**: context=breadth-up; regions=none; trigger=laggard-catchup; thesis=breadth-pull; exit=catch-up-exit; risk=fixed-r; eval=cross-asset-oos

### S185 — Dominance rotation
- **Style tag**: cross-venue
- **Horizon tag**: hours
- **Uses repo**: collectors: venues
- **New vs round one**: 1,3
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: ETH/BTC ratio breaks its 12 h high: long ETH short BTC.
- **4 Thesis / invalidation**: Rotation.
- **5 Exit**: Exit at 12 h.
- **6 Risk / sizing**: Pair; 0.5% risk on spread.
- **7 Evaluation**: Pair vs single-leg.
- **Part tags**: context=always-on; regions=ratio-high; trigger=ratio-break; thesis=rotation; exit=time-stop; risk=pair-spread; eval=pair-vs-single

### S186 — Anchored VWAP from the weekly open as trend filter
- **Style tag**: trend
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,2,3
- **1 Context**: Price above the anchored VWAP from Monday open.
- **2 Regions**: Anchored VWAP.
- **3 Trigger**: Pullbacks to AVWAP in uptrend: buy 5 m bounce.
- **4 Thesis / invalidation**: Dynamic support.
- **5 Exit**: Exit at prior high.
- **6 Risk / sizing**: Stop 0.3 percent under AVWAP.
- **7 Evaluation**: Out-of-sample 6 months.
- **Part tags**: context=above-weekly-avwap; regions=anchored-vwap; trigger=avwap-pullback; thesis=dynamic-support; exit=target; risk=fixed-r; eval=walk-forward

### S187 — Failed-auction single print rejection
- **Style tag**: volume-profile
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 2,3,4
- **1 Context**: Prior session closed with a poor high (flat top, many touches, low rotation).
- **2 Regions**: Prior session poor high or poor low.
- **3 Trigger**: Price revisits the poor high and prints two rejecting 15 m closes below it: short.
- **4 Thesis / invalidation**: Poor structure gets repaired by a revisit that then fails; sellers wait there. Invalid if a 1 h close above by 0.3 percent.
- **5 Exit**: Exit at developing session POC; time stop 3 h.
- **6 Risk / sizing**: Stop 0.3 percent above; 0.4% risk.
- **7 Evaluation**: Sample by sessions: need 40 poor highs; compare with ordinary highs.
- **Part tags**: context=poor-high-prior; regions=poor-high-low; trigger=revisit-two-rejects; thesis=structure-repair-fail; exit=poc-target; risk=fixed-r; eval=matched-control

### S188 — Naked prior-week VWAP touch
- **Style tag**: volume-profile
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Week 2 onward.
- **2 Regions**: Prior week VWAP and its 1 sigma bands.
- **3 Trigger**: Long on touch of prior-week VWAP from above with delta positive.
- **4 Thesis / invalidation**: Prior week fair value is remembered.
- **5 Exit**: Exit at prior day high.
- **6 Risk / sizing**: Stop 0.4 percent.
- **7 Evaluation**: Placebo shifted VWAP.
- **Part tags**: context=always-on; regions=prior-week-vwap; trigger=vwap-touch-delta; thesis=remembered-fair-value; exit=target; risk=fixed-r; eval=level-shift-placebo

### S189 — High-volume node stall
- **Style tag**: volume-profile
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 2,3,4
- **1 Context**: Always on.
- **2 Regions**: High volume node (HVN) of the last 3 days.
- **3 Trigger**: When price enters an HVN from a low volume node, expect deceleration: fade the entry if the 1 m range shrinks 50 percent inside.
- **4 Thesis / invalidation**: Volume nodes slow price.
- **5 Exit**: Exit at HVN far edge.
- **6 Risk / sizing**: Stop 0.3 percent.
- **7 Evaluation**: Node definition sensitivity.
- **Part tags**: context=always-on; regions=hvn; trigger=hvn-entry-slowdown; thesis=volume-node-friction; exit=node-edge; risk=fixed-r; eval=definition-sensitivity

### S190 — Low-volume node acceleration
- **Style tag**: volume-profile
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 2,3,4
- **1 Context**: Always on.
- **2 Regions**: Low volume node (LVN) between two HVNs.
- **3 Trigger**: Enter in the break direction when price enters an LVN with a 1 m close and volume rising.
- **4 Thesis / invalidation**: Price runs through thin areas.
- **5 Exit**: Exit at next HVN.
- **6 Risk / sizing**: Stop at LVN entry edge.
- **7 Evaluation**: Paired with HVN stall system as mirror.
- **Part tags**: context=always-on; regions=lvn; trigger=lvn-entry-accel; thesis=thin-node-traverse; exit=next-hvn; risk=structure-stop; eval=paired-mirror

### S191 — Volume-at-price absorption at day low
- **Style tag**: volume-profile
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes:absorption
- **New vs round one**: 2,3
- **1 Context**: Absorption episode active.
- **2 Regions**: Day low with a volume shelf.
- **3 Trigger**: Long when absorption occurs on a volume shelf at day low.
- **4 Thesis / invalidation**: Shelf plus absorption.
- **5 Exit**: Exit at VWAP.
- **6 Risk / sizing**: Stop below shelf.
- **7 Evaluation**: Ablation: shelf vs none.
- **Part tags**: context=absorption-episode; regions=volume-shelf; trigger=absorption-ep; thesis=shelf-defense; exit=vwap-target; risk=structure-stop; eval=ablation

### S192 — Sigma-multiple stop momentum scalp
- **Style tag**: momentum
- **Horizon tag**: seconds
- **Uses repo**: sigma
- **New vs round one**: 3,6
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Price moves 2 sigma (1 s sigma units) in 5 s: join.
- **4 Thesis / invalidation**: Short-term momentum.
- **5 Exit**: Exit 20 s.
- **6 Risk / sizing**: Stop exactly 1.5 sigma_1s; size = 0.1% risk / stop distance.
- **7 Evaluation**: Compare gross vs net; need 500 trades.
- **Part tags**: context=always-on; regions=none; trigger=sigma-burst; thesis=micro-momentum; exit=time-stop; risk=sigma-multiple-stop; eval=fee-stress

### S193 — Square-root-time stop
- **Style tag**: mean-reversion
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **New vs round one**: 5,6
- **1 Context**: Balanced.
- **2 Regions**: VWAP band.
- **3 Trigger**: Fall of 1.5 sigma over 15 minutes while cumulative delta rises (divergence): buy after a 1 m higher low.
- **4 Thesis / invalidation**: A fall that sellers do not support in flow reverts.
- **5 Exit**: Time stop; stop distance widens with sqrt(time): stop = k sigma sqrt(t).
- **6 Risk / sizing**: Widening stop; 0.4% risk at initial stop.
- **7 Evaluation**: Compare against fixed stop.
- **Part tags**: context=balanced; regions=vwap-band; trigger=fall-with-delta-divergence; thesis=divergent-fall-reverts; exit=time-stop; risk=sqrt-time-stop; eval=stop-rule-compare

### S194 — Volatility-targeted trend (daily)
- **Style tag**: trend
- **Horizon tag**: multi-day
- **Uses repo**: sigma
- **New vs round one**: 1,5,6,7
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Long if price above 50-day mean else flat.
- **4 Thesis / invalidation**: Slow trend.
- **5 Exit**: Exit on cross below mean.
- **6 Risk / sizing**: Position = 10 percent annualized vol target / realized vol; daily rebalance.
- **7 Evaluation**: Compare to buy-and-hold on drawdown-adjusted return; 3-year sample.
- **Part tags**: context=always-on; regions=none; trigger=ma-cross; thesis=trend-persist; exit=ma-cross-exit; risk=vol-target-daily; eval=drawdown-adjusted

### S195 — Kelly-sized breakout with fractional cap
- **Style tag**: breakout
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 6,7
- **1 Context**: Trend context.
- **2 Regions**: Range high.
- **3 Trigger**: Break with volume 2x.
- **4 Thesis / invalidation**: Momentum.
- **5 Exit**: Target 2 R, stop 1 R.
- **6 Risk / sizing**: Size = quarter Kelly of rolling 60-trade win rate and payoff, capped 1 percent.
- **7 Evaluation**: Check size sensitivity to estimation error by bootstrap.
- **Part tags**: context=trend; regions=range-edge; trigger=break-volume; thesis=continuation; exit=target; risk=quarter-kelly; eval=kelly-estimation-bootstrap

### S196 — Pyramiding on trend with break-even stop
- **Style tag**: trend
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 6
- **1 Context**: Trend.
- **2 Regions**: Swing high.
- **3 Trigger**: Add unit on each higher swing low confirmed.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Close all if stop at last swing low hit.
- **6 Risk / sizing**: Add up to 3 units; stop for all moves to prior swing low.
- **7 Evaluation**: Equity curve vs single unit.
- **Part tags**: context=trend; regions=swing; trigger=higher-low-add; thesis=trend-persist; exit=swing-stop; risk=pyramid-trend; eval=equity-curve-compare

### S197 — Three-engine book: trend, fade, carry
- **Style tag**: hybrid
- **Horizon tag**: hours
- **Uses repo**: sigma, collectors: derivs
- **New vs round one**: 1,3,6,7
- **1 Context**: Each engine has its own gate: trend engine on when 4 h return exceeds 1.5 sigma; fade engine on in balanced state; carry engine on when funding positive 3 periods.
- **2 Regions**: Engine-specific (4 h high for trend, VWAP band for fade, none for carry).
- **3 Trigger**: Trend engine enters on 1 h high break; fade engine on 2 sigma VWAP excursion reversal; carry engine shorts perp when funding above 0.04 percent.
- **4 Thesis / invalidation**: Three theses held separately so their errors are not correlated; each has its own invalidation.
- **5 Exit**: Each engine exits by its own rule (trail, VWAP, funding normalize).
- **6 Risk / sizing**: Portfolio risk budget: 1 percent equity total, split by inverse trailing volatility of each engine PnL; daily portfolio loss cap 2 percent; engine disabled when its correlation to another exceeds 0.6.
- **7 Evaluation**: Portfolio Sharpe versus best single engine; daily PnL correlation matrix; leave-one-engine-out ablation.
- **Part tags**: context=engine-gates; regions=engine-specific; trigger=three-engine-set; thesis=uncorrelated-errors; exit=per-engine; risk=portfolio-budget; eval=leave-one-out

### S198 — Quit-while-ahead momentum
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 6,7
- **1 Context**: Trend context (price above 4 h VWAP and 1 h return positive).
- **2 Regions**: Prior 15 minute high.
- **3 Trigger**: Break of the 1 h high with positive 15 m delta: long.
- **4 Thesis / invalidation**: Trend days extend once flow confirms the break.
- **5 Exit**: Trail 1 sigma; 30 min time stop.
- **6 Risk / sizing**: Stop after +3 R or -1.5 R for the day, whichever comes first (quit rule), 0.5% base risk.
- **7 Evaluation**: Compare daily distribution with and without the quit rule using the same entries.
- **Part tags**: context=above-4h-vwap-trend; regions=prior-high; trigger=hour-high-break-delta; thesis=trend-day-extends; exit=trailing; risk=daily-quit-rule; eval=cap-ablation

### S199 — Execution-edge test: maker versus taker
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: none
- **New vs round one**: 3,6,7
- **1 Context**: Spread 1 bp or less.
- **2 Regions**: Best bid/ask.
- **3 Trigger**: Post-only limit at the touch whenever 3 s book imbalance exceeds 0.6 on the bid side.
- **4 Thesis / invalidation**: Passive entries capture the spread; adverse selection is the cost.
- **5 Exit**: Exit via post-only at the ask, or market after 20 s.
- **6 Risk / sizing**: Fee tier assumptions explicit (maker rebate vs taker fee); 0.1% risk; inventory limit 1 position.
- **7 Evaluation**: Compare fill-weighted PnL: filled trades are adversely selected; report fill rate and post-fill drift.
- **Part tags**: context=tight-spread; regions=touch-quote; trigger=maker-on-imbalance; thesis=spread-capture; exit=post-only-exit; risk=inventory-limit; eval=adverse-selection-check

### S200 — Fee-tier-aware scalper
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: none
- **New vs round one**: 1,6,7
- **1 Context**: Only when 30 day volume pushes fee below 2 bps taker; otherwise off.
- **2 Regions**: None.
- **3 Trigger**: Enter on 3-second range break of at least 4 bps.
- **4 Thesis / invalidation**: Micro-momentum large enough to pay fees.
- **5 Exit**: Exit at 6 bps or 15 s.
- **6 Risk / sizing**: 0.1% risk; 5x leverage; cap 30 trades per hour.
- **7 Evaluation**: Break-even analysis: fee level at which expectancy hits zero; need that margin above 1 bp.
- **Part tags**: context=fee-tier-low; regions=none; trigger=three-sec-break; thesis=micro-momentum-above-fee; exit=target; risk=trade-rate-cap; eval=fee-breakeven

### S201 — Tape-speed surge fade
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors: telemetry
- **New vs round one**: 1,3,4,5
- **1 Context**: Trades per second above 5x its 10 minute median but price range under 2 bps.
- **2 Regions**: None.
- **3 Trigger**: When the trade rate surges with no price progress for 5 s, enter against the side with more aggressor volume once the rate drops by half.
- **4 Thesis / invalidation**: Heavy activity without progress is absorption by passive size; the aggressor gives up.
- **5 Exit**: Exit 40 s after entry or on price progress of 3 bps in favour.
- **6 Risk / sizing**: Stop 4 bps; 0.1% risk; 10 trades per hour max.
- **7 Evaluation**: SPRT sequential test on net expectancy, stop at 200 trades if not accepted.
- **Part tags**: context=tape-speed-surge; regions=none; trigger=rate-surge-no-progress; thesis=activity-without-progress; exit=time-or-target; risk=trade-rate-cap; eval=sequential-sprt

### S202 — Aggressor run-length exhaustion
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: none
- **New vs round one**: 3,4,7
- **1 Context**: Spread 1 bp or less.
- **2 Regions**: None.
- **3 Trigger**: After 12 or more consecutive same-side aggressor prints with a cumulative move under 2 bps, enter on the opposite side at the next print.
- **4 Thesis / invalidation**: Run of same-side prints without price movement means the hitter is absorbed.
- **5 Exit**: Exit after 15 s.
- **6 Risk / sizing**: Stop 3 bps; 0.08% risk; leverage 8x.
- **7 Evaluation**: Run-length bucket test (6, 9, 12, 15): monotonic response required.
- **Part tags**: context=tight-spread; regions=none; trigger=same-side-run-length; thesis=run-absorbed; exit=time-stop; risk=high-lever-tiny-stop; eval=monotonic-bucket-test

### S203 — Large print drift
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: none
- **New vs round one**: 3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: After a single trade over 5 BTC that moves price by more than 1.5 bps, enter in its direction with a limit order.
- **4 Thesis / invalidation**: Block trades signal informed flow whose impact continues.
- **5 Exit**: Exit 30 s.
- **6 Risk / sizing**: Stop 3 bps; 0.1% risk.
- **7 Evaluation**: Event study around prints; compare with random prints of equal size without impact.
- **Part tags**: context=always-on; regions=none; trigger=block-print; thesis=block-impact-continues; exit=time-stop; risk=fixed-r; eval=event-study-random-dip

### S204 — Mark versus last price divergence
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors: telemetry
- **New vs round one**: 3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Mark and last differ by more than 5 bps for 3 s: trade last price toward mark.
- **4 Thesis / invalidation**: Last price reverts to mark (index based).
- **5 Exit**: Exit when gap under 1 bp.
- **6 Risk / sizing**: Stop 6 bps; 0.1% risk.
- **7 Evaluation**: Fee stress.
- **Part tags**: context=always-on; regions=mark-level; trigger=last-mark-gap; thesis=last-to-mark-revert; exit=gap-close; risk=fixed-r; eval=fee-stress

### S205 — Micro-price versus mid skew
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors: book
- **New vs round one**: 3,4
- **1 Context**: Spread 1 bp or less.
- **2 Regions**: None.
- **3 Trigger**: Micro-price (size-weighted mid) leans more than 0.4 spread-widths from mid: enter in that direction as a maker.
- **4 Thesis / invalidation**: Micro-price predicts the next tick.
- **5 Exit**: Exit after 10 s or on tick.
- **6 Risk / sizing**: Stop 2 bps.
- **7 Evaluation**: Latency stress.
- **Part tags**: context=tight-spread; regions=none; trigger=microprice-skew; thesis=next-tick-prediction; exit=tick-exit; risk=fixed-r; eval=latency-stress

### S206 — Queue depletion at the touch
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors: book
- **New vs round one**: 3,4
- **1 Context**: Touch size on the bid is under 25 percent of its 1 minute median.
- **2 Regions**: Best bid.
- **3 Trigger**: Sell when the best bid size is depleted without being refilled in 2 s.
- **4 Thesis / invalidation**: Thin touch breaks next.
- **5 Exit**: Exit after 20 s.
- **6 Risk / sizing**: Stop 3 bps.
- **7 Evaluation**: Fill realism.
- **Part tags**: context=thin-touch; regions=best-bid; trigger=touch-depletion; thesis=thin-touch-breaks; exit=time-stop; risk=fixed-r; eval=fill-realism

### S207 — Last seconds before the 1m candle close
- **Style tag**: time-event
- **Horizon tag**: seconds
- **Uses repo**: none
- **New vs round one**: 1,3,4
- **1 Context**: Always on.
- **2 Regions**: 1 minute bar high/low.
- **3 Trigger**: In the last 5 s of a 1 minute bar, if price is within 0.5 bp of the bar high, buy for a close at the high; sell the mirror.
- **4 Thesis / invalidation**: Algo flows chase candle close highs.
- **5 Exit**: Exit at 10 s after bar close.
- **6 Risk / sizing**: Stop 3 bps.
- **7 Evaluation**: Placebo on seconds 20-25 of the bar.
- **Part tags**: context=always-on; regions=bar-extreme; trigger=bar-close-clock; thesis=candle-close-chase; exit=clock-exit; risk=fixed-r; eval=placebo-time

### S208 — Funding-timestamp print volume
- **Style tag**: time-event
- **Horizon tag**: seconds
- **Uses repo**: collectors: calendar
- **New vs round one**: 1,3
- **1 Context**: Binance funding second.
- **2 Regions**: Mark price at 00:00:00, 08:00:00, 16:00:00 UTC.
- **3 Trigger**: Take the direction of the 10 s return after the funding timestamp for 60 s.
- **4 Thesis / invalidation**: Positions closed before funding re-open.
- **5 Exit**: Exit 60 s.
- **6 Risk / sizing**: 0.1% risk.
- **7 Evaluation**: Shuffled-time.
- **Part tags**: context=funding-second; regions=funding-clock; trigger=post-funding-return; thesis=reopen-flow; exit=time-stop; risk=fixed-r; eval=shuffled-time

### S209 — Premium index reversion (Hyperliquid)
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4
- **1 Context**: Hyperliquid premium (hlCtx.prem) above 20 bps.
- **2 Regions**: None.
- **3 Trigger**: Fade the premium by shorting HL.
- **4 Thesis / invalidation**: Premium reverts.
- **5 Exit**: Exit at under 5 bps.
- **6 Risk / sizing**: 0.2% risk.
- **7 Evaluation**: Walk-forward.
- **Part tags**: context=premium-extreme; regions=none; trigger=premium-fade; thesis=premium-revert; exit=indicator-normalize; risk=fixed-r; eval=walk-forward

### S210 — Spot-led squeeze
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: collectors: venues
- **New vs round one**: 3,4
- **1 Context**: Binance spot and Coinbase move 3 bps before perp.
- **2 Regions**: None.
- **3 Trigger**: Join the spot direction in perp.
- **4 Thesis / invalidation**: Spot leads in cash-driven moves.
- **5 Exit**: Exit 3 m.
- **6 Risk / sizing**: 0.2% risk.
- **7 Evaluation**: Latency.
- **Part tags**: context=always-on; regions=none; trigger=spot-leads-perp; thesis=spot-leads; exit=time-stop; risk=fixed-r; eval=latency-stress

### S211 — Volume climax reversal bar
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 2,3,5
- **1 Context**: Price moved 2 sigma in the last 20 minutes.
- **2 Regions**: Local extreme of the move.
- **3 Trigger**: A 1 m bar with volume above 4x its 30 bar median closes against the move (long lower wick over 60 percent of range): enter against the move.
- **4 Thesis / invalidation**: Climax volume marks capitulation or blow-off. Invalid if the next 3 bars make a new extreme.
- **5 Exit**: Exit at 50 percent retrace of the move; if not reached in 30 min, exit.
- **6 Risk / sizing**: Stop 0.3 sigma beyond the climax bar; risk 0.4%.
- **7 Evaluation**: Per-bar-sample count; 80 climaxes; compare to non-climax reversal bars.
- **Part tags**: context=extended-move; regions=move-extreme; trigger=volume-climax-bar; thesis=capitulation-blowoff; exit=retracement-target; risk=structure-stop; eval=matched-control

### S212 — NR7 expansion
- **Style tag**: breakout
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3,5
- **1 Context**: Today range is the narrowest of the last 7 days (NR7).
- **2 Regions**: Today high and low.
- **3 Trigger**: Place stop entries at both sides of the NR7 day range on the next day first hour; first one filled wins, other cancelled.
- **4 Thesis / invalidation**: Narrow day precedes expansion.
- **5 Exit**: Exit at 1.5 times the NR7 range, or the end of the day.
- **6 Risk / sizing**: Stop at opposite side of the NR7 range (inherent), risk 0.5%.
- **7 Evaluation**: Count of days; need 40 NR7; compare with random days.
- **Part tags**: context=nr7-day; regions=day-range; trigger=oco-stop-entries; thesis=range-expansion; exit=range-multiple; risk=structure-stop; eval=random-day-baseline

### S213 — Inside day breakout with daily delta
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Prior day is an inside day.
- **2 Regions**: Prior day high and low.
- **3 Trigger**: Enter on first break by 0.1 percent with positive daily delta in the break direction.
- **4 Thesis / invalidation**: Compression resolves with order flow.
- **5 Exit**: Trail at 3 h low; end of day exit.
- **6 Risk / sizing**: Stop prior mid; 0.5% risk.
- **7 Evaluation**: Inside-day sample.
- **Part tags**: context=inside-day; regions=prior-hl; trigger=break-with-delta; thesis=compression-resolve; exit=trailing; risk=structure-stop; eval=ablation

### S214 — Hourly open pullback
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Price above hourly open by more than 0.3 percent after 20 minutes.
- **2 Regions**: Hourly open.
- **3 Trigger**: Buy a pullback to the hourly open when 1 m delta turns positive.
- **4 Thesis / invalidation**: Hourly open acts as support in strong hours.
- **5 Exit**: Exit at hour close.
- **6 Risk / sizing**: Stop 0.15 percent below; 0.3% risk.
- **7 Evaluation**: Hour-of-day split.
- **Part tags**: context=hour-trend; regions=hourly-open; trigger=pullback-delta-turn; thesis=hourly-open-support; exit=clock-exit; risk=fixed-r; eval=hour-of-day-split

### S215 — 4 hour candle open trap
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3,4
- **1 Context**: Always on.
- **2 Regions**: 4 h candle open.
- **3 Trigger**: If the first hour of the 4 h candle makes a high break of the prior 4 h high that is reversed back below, short.
- **4 Thesis / invalidation**: Trap at the 4 h open.
- **5 Exit**: Exit at the 4 h open price.
- **6 Risk / sizing**: Stop above the false high.
- **7 Evaluation**: Placebo on non-open hours.
- **Part tags**: context=always-on; regions=4h-open; trigger=false-break-4h; thesis=bar-open-trap; exit=level-touch; risk=structure-stop; eval=placebo-time

### S216 — Wick-to-body rejection ladder
- **Style tag**: price-action
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 3,7
- **1 Context**: Always on.
- **2 Regions**: Daily VWAP.
- **3 Trigger**: A 5 m bar with a wick over 70 percent of its range at VWAP: enter with the wick.
- **4 Thesis / invalidation**: Rejection at fair value.
- **5 Exit**: Exit 6 bars.
- **6 Risk / sizing**: Stop beyond wick.
- **7 Evaluation**: Wick-ratio buckets.
- **Part tags**: context=always-on; regions=vwap; trigger=wick-ratio-bar; thesis=fair-value-reject; exit=time-stop; risk=structure-stop; eval=monotonic-bucket-test

### S217 — Judas swing at the London open
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,2,3,4
- **1 Context**: 07:00 to 11:00 UTC.
- **2 Regions**: Asia session high and low (00:00 to 07:00 UTC).
- **3 Trigger**: At London open a sweep of the Asia high or low followed by a reclaim: trade back toward the opposite Asia extreme.
- **4 Thesis / invalidation**: The early London move is a false move to take Asian stops.
- **5 Exit**: Exit at the opposite Asia extreme or 11:00 UTC.
- **6 Risk / sizing**: Stop beyond sweep; 0.4% risk.
- **7 Evaluation**: Day-level sample 150 days; sign test.
- **Part tags**: context=london-window; regions=asia-range; trigger=sweep-reclaim-session; thesis=judas-fake; exit=range-opposite-edge; risk=structure-stop; eval=sign-test-days

### S218 — New York lunch drift fade
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,3
- **1 Context**: 16:00 to 18:00 UTC.
- **2 Regions**: Morning range.
- **3 Trigger**: Fade breaks of the NY morning range during the low-activity lunch.
- **4 Thesis / invalidation**: Low participation reverts.
- **5 Exit**: Exit at range mid or 18:00.
- **6 Risk / sizing**: Stop 0.5 percent.
- **7 Evaluation**: Hour split.
- **Part tags**: context=ny-lunch-window; regions=range-edge; trigger=lunch-break-fade; thesis=low-participation-revert; exit=range-middle; risk=fixed-r; eval=hour-of-day-split

### S219 — Event-window first-five-minute breakout
- **Style tag**: event
- **Horizon tag**: minutes
- **Uses repo**: collectors: calendar
- **New vs round one**: 1,3,5
- **1 Context**: Scheduled US macro release (e.g. CPI) in progress; the repo calendar lacks macro dates, so they are a manual input.
- **2 Regions**: First 5 minute range after the release.
- **3 Trigger**: Enter on break of that range after 5 minutes.
- **4 Thesis / invalidation**: The first move after data is noise; the second stable.
- **5 Exit**: Exit after 30 min or at 2x range.
- **6 Risk / sizing**: Stop opposite range side; risk 0.3%; only 12 events per year.
- **7 Evaluation**: Small-sample: pooled bootstrapped CI.
- **Part tags**: context=macro-release; regions=post-release-range; trigger=range-break-after-wait; thesis=second-move-stable; exit=range-multiple; risk=structure-stop; eval=small-sample-exploratory

### S220 — Post-FOMC drift
- **Style tag**: event
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,3,5
- **1 Context**: FOMC release day.
- **2 Regions**: None.
- **3 Trigger**: Enter in the direction of the 2-hour return after the statement.
- **4 Thesis / invalidation**: Slow digestion.
- **5 Exit**: Exit end of day.
- **6 Risk / sizing**: Stop 1.5 percent.
- **7 Evaluation**: 8 events per year only; anecdotal.
- **Part tags**: context=fomc-day; regions=none; trigger=post-event-return; thesis=slow-digestion; exit=day-end; risk=wide-fixed-stop; eval=anecdotal-pooled

### S221 — Fibonacci retrace entry in trend
- **Style tag**: trend
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2
- **1 Context**: Trend context.
- **2 Regions**: 61.8 percent retrace of the last daily swing.
- **3 Trigger**: Buy rejection candle.
- **4 Thesis / invalidation**: Pullback ends.
- **5 Exit**: Exit at swing high.
- **6 Risk / sizing**: Stop 78.6 percent.
- **7 Evaluation**: Ablation with random retrace levels.
- **Part tags**: context=trend; regions=fib-retrace; trigger=retrace-reject-candle; thesis=pullback-end; exit=target; risk=structure-stop; eval=placebo-level

### S222 — Classic pivot points
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2
- **1 Context**: Always on.
- **2 Regions**: Daily pivot, R1, S1.
- **3 Trigger**: Fade first touch of R1 or S1 with 5 m rejection.
- **4 Thesis / invalidation**: Mean reversion at pivots.
- **5 Exit**: Exit at pivot.
- **6 Risk / sizing**: Stop 0.3 percent.
- **7 Evaluation**: Placebo shift.
- **Part tags**: context=always-on; regions=daily-pivots; trigger=pivot-touch-reject; thesis=pivot-revert; exit=target; risk=fixed-r; eval=level-shift-placebo

### S223 — 200-day mean proximity
- **Style tag**: trend
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 2
- **1 Context**: Always on.
- **2 Regions**: 200 day average.
- **3 Trigger**: Buy daily close back above 200 day average after being below for 10 days.
- **4 Thesis / invalidation**: Regime change.
- **5 Exit**: Exit on close below.
- **6 Risk / sizing**: Stop 5 percent.
- **7 Evaluation**: Few events: bootstrapped.
- **Part tags**: context=always-on; regions=ma-200; trigger=reclaim-ma; thesis=regime-change; exit=ma-cross-exit; risk=wide-fixed-stop; eval=bootstrap-ci

### S224 — Negative-gamma proxy momentum
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors: options
- **New vs round one**: 1,2,3,4,5
- **1 Context**: A rough dealer-gamma proxy built from Deribit open interest by strike (call OI above spot minus put OI below spot, signed) is negative; this is an approximation, not true dealer positioning.
- **2 Regions**: Strikes with the largest open interest on the nearest expiries.
- **3 Trigger**: Trade breaks of the 1 h range in the break direction while the gamma proxy is negative.
- **4 Thesis / invalidation**: Dealers short gamma hedge with the move, amplifying it. Invalid if the proxy turns positive after a strike roll.
- **5 Exit**: Exit when the proxy turns positive or after 3 h.
- **6 Risk / sizing**: Stop 0.8 percent; 0.4% risk; no entry within 1 h of expiry.
- **7 Evaluation**: Split by proxy sign: edge must exist only in the negative group (regime-split).
- **Part tags**: context=negative-gamma-proxy; regions=high-oi-strike; trigger=range-break-in-gamma; thesis=dealer-hedge-amplify; exit=regime-flip-exit; risk=fixed-r; eval=regime-split

### S225 — Positive-gamma proxy mean reversion
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors: options
- **New vs round one**: 1,2,3,4
- **1 Context**: Gamma proxy positive and ATM implied vol falling.
- **2 Regions**: Large-OI strikes act as pins.
- **3 Trigger**: Fade 0.6 percent moves away from the nearest big strike.
- **4 Thesis / invalidation**: Dealers long gamma hedge against moves, damping them.
- **5 Exit**: Exit at the strike.
- **6 Risk / sizing**: Stop 0.7 percent; 0.4% risk.
- **7 Evaluation**: Mirror of the negative-gamma system; both must work in their own regime to count.
- **Part tags**: context=positive-gamma-proxy; regions=high-oi-strike; trigger=fade-from-strike; thesis=dealer-hedge-dampen; exit=level-touch; risk=fixed-r; eval=regime-split

### S226 — Risk-reversal change trigger
- **Style tag**: options-vol
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors: options
- **New vs round one**: 3,4
- **1 Context**: ATM vol steady.
- **2 Regions**: None.
- **3 Trigger**: 25-delta skew (optChain.skew5) shifts by over 2 vol points in 30 minutes toward calls: long.
- **4 Thesis / invalidation**: Options traders chase upside.
- **5 Exit**: Exit when skew reverts half.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Shuffled-series.
- **Part tags**: context=always-on; regions=none; trigger=skew-shift; thesis=options-flow-informed; exit=indicator-normalize; risk=fixed-r; eval=shuffled-series

### S227 — Implied-move breach
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors: options
- **New vs round one**: 2,3,4
- **1 Context**: ATM implied vol known.
- **2 Regions**: Daily implied move bounds (spot +/- IV x sqrt(1/365)).
- **3 Trigger**: Fade price when it reaches 1.0 times the implied daily move before 12:00 UTC.
- **4 Thesis / invalidation**: Implied move is a fair daily range; stretched moves revert.
- **5 Exit**: Exit at the middle of the day move.
- **6 Risk / sizing**: Stop at 1.4 times implied move.
- **7 Evaluation**: Frequency of breaches calibration.
- **Part tags**: context=iv-known; regions=implied-move-bound; trigger=bound-reach-fade; thesis=implied-range-revert; exit=midpoint-target; risk=implied-move-stop; eval=calibration-coverage

### S228 — Realized breaks implied: follow
- **Style tag**: options-vol
- **Horizon tag**: hours
- **Uses repo**: collectors: options
- **New vs round one**: 2,3,4
- **1 Context**: Always on.
- **2 Regions**: Implied move bounds.
- **3 Trigger**: Join a close beyond 1.3 times the implied move after 12:00 UTC.
- **4 Thesis / invalidation**: Options mispriced: tail event.
- **5 Exit**: Trail.
- **6 Risk / sizing**: Stop at the bound.
- **7 Evaluation**: Mirror system.
- **Part tags**: context=always-on; regions=implied-move-bound; trigger=bound-break-follow; thesis=vol-underpriced; exit=trailing; risk=implied-move-stop; eval=paired-mirror

### S229 — Hyperliquid wallet liquidation fill follow
- **Style tag**: wallet
- **Horizon tag**: minutes
- **Uses repo**: collectors: wallets
- **New vs round one**: 3,4,5
- **1 Context**: At least one tracked wallet liquidation fill.
- **2 Regions**: Wallet liquidation price.
- **3 Trigger**: After a tracked wallet is liquidated, trade away from its direction after 2 minutes.
- **4 Thesis / invalidation**: Liquidated size reduces supply of that side; follow-through selling or buying ends.
- **5 Exit**: Exit 15 minutes.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Wallet-event study.
- **Part tags**: context=wallet-liquidated; regions=wallet-liq-price; trigger=wallet-liquidation; thesis=forced-flow-ends; exit=time-stop; risk=fixed-r; eval=event-study-random-dip

### S230 — Top-wallet add-on-dip follow
- **Style tag**: wallet
- **Horizon tag**: hours
- **Uses repo**: collectors: wallets
- **New vs round one**: 3,4
- **1 Context**: Price down 1.5 percent in 2 h.
- **2 Regions**: None.
- **3 Trigger**: Buy when 3 or more of the 10 tracked wallets increased long size during the dip.
- **4 Thesis / invalidation**: Informed wallets buy dips.
- **5 Exit**: Exit at 6 h or wallet reduces.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Permutation of wallet identity labels.
- **Part tags**: context=dip-with-wallets; regions=none; trigger=wallets-add-dip; thesis=informed-dip-buy; exit=wallet-reduce-exit; risk=fixed-r; eval=label-permutation

### S231 — Wallet funding vs market funding disagreement
- **Style tag**: wallet
- **Horizon tag**: hours
- **Uses repo**: collectors: wallets, derivs
- **New vs round one**: 3,4
- **1 Context**: Predicted funding across venues disagrees in sign.
- **2 Regions**: None.
- **3 Trigger**: Trade toward the venue whose funding is more negative.
- **4 Thesis / invalidation**: Mispriced funding.
- **5 Exit**: Exit funding agree.
- **6 Risk / sizing**: 0.2% risk.
- **7 Evaluation**: Realized funding.
- **Part tags**: context=funding-disagree; regions=none; trigger=funding-sign-disagree; thesis=mispriced-funding; exit=indicator-normalize; risk=fixed-r; eval=realized-vs-predicted

### S232 — Delta and OI divergence at highs
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack
- **New vs round one**: 3,4
- **1 Context**: New 4 h high.
- **2 Regions**: 4 h high.
- **3 Trigger**: Short when price makes a new high but OI decreases and delta is lower than at the previous high.
- **4 Thesis / invalidation**: Rally by short covering and no new longs.
- **5 Exit**: Exit at VWAP.
- **6 Risk / sizing**: Stop above.
- **7 Evaluation**: Four-quadrant table.
- **Part tags**: context=new-high; regions=swing; trigger=oi-delta-diverge; thesis=covering-rally; exit=vwap-target; risk=structure-stop; eval=four-quadrant-table

### S233 — Open-interest spike without price move
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4,5
- **1 Context**: Price within 0.3 percent over the last 20 min.
- **2 Regions**: Range.
- **3 Trigger**: OI rises 2 percent in 10 min and price stays flat; trade in the direction of the first break after.
- **4 Thesis / invalidation**: Positions are being built; breaks resolve in the direction of the larger side.
- **5 Exit**: Exit at 1.2 times range.
- **6 Risk / sizing**: Stop in the range middle.
- **7 Evaluation**: Ablation vs no OI.
- **Part tags**: context=oi-build-flat; regions=range-edge; trigger=break-after-oi-build; thesis=positions-built-resolve; exit=range-multiple; risk=structure-stop; eval=ablation

### S234 — Liquidation imbalance ratio
- **Style tag**: liquidation
- **Horizon tag**: tens-of-minutes
- **Uses repo**: futures-stack
- **New vs round one**: 3,4
- **1 Context**: Liquidations in the last 10 min > 3x median.
- **2 Regions**: None.
- **3 Trigger**: Enter with the side that has fewer liquidations after the ratio exceeds 4:1.
- **4 Thesis / invalidation**: One-sided liquidations signal crowded positioning mostly gone.
- **5 Exit**: Exit 30 min.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Shuffle.
- **Part tags**: context=liq-surge; regions=none; trigger=liq-side-ratio; thesis=crowd-cleared; exit=time-stop; risk=fixed-r; eval=shuffled-time

### S235 — Weekly cumulative funding extreme
- **Style tag**: derivatives-state
- **Horizon tag**: multi-day
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4,5
- **1 Context**: Funding summed over 7 days in the top decile of the last year.
- **2 Regions**: None.
- **3 Trigger**: Short at next daily lower high.
- **4 Thesis / invalidation**: Persistent payment erodes longs.
- **5 Exit**: Exit when cumulative funding mid.
- **6 Risk / sizing**: Stop 5 percent.
- **7 Evaluation**: Bucket test.
- **Part tags**: context=cum-funding-extreme; regions=none; trigger=daily-lower-high; thesis=funding-erosion; exit=indicator-normalize; risk=wide-fixed-stop; eval=monotonic-bucket-test

### S236 — Leverage ratio proxy (OI over volume)
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4
- **1 Context**: OI to 24 h volume ratio high.
- **2 Regions**: None.
- **3 Trigger**: Short on lower high.
- **4 Thesis / invalidation**: Fragile.
- **5 Exit**: Exit when ratio mid.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Percentile.
- **Part tags**: context=oi-volume-high; regions=none; trigger=lower-high; thesis=fragile-leverage; exit=indicator-normalize; risk=fixed-r; eval=monotonic-bucket-test

### S237 — Capped grid in a range
- **Style tag**: mean-reversion
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3,6,7
- **1 Context**: Balanced context for 6 hours with a 4 h range width of 1 to 2.5 percent.
- **2 Regions**: Range edges and 4 equal grid lines between them.
- **3 Trigger**: Place buy limits at the three lower grid lines and sell limits at the three upper lines; each fill sets its opposite order one grid up or down.
- **4 Thesis / invalidation**: The range holds so inventory cycles. Invalid if a 15 m close is outside the range by 0.5 percent.
- **5 Exit**: Per grid pair exit one step away; whole grid flattened when invalid.
- **6 Risk / sizing**: Max inventory 3 units, each 0.15% equity; total grid stop 1.2 percent beyond range; grid disabled for 12 h after a stop.
- **7 Evaluation**: Cycle count and inventory-at-stop statistics; compare against single-entry fade; need 30 grids.
- **Part tags**: context=balanced-range; regions=grid-lines; trigger=grid-fill; thesis=range-holds; exit=grid-step; risk=inventory-cap-grid; eval=inventory-at-stop

### S238 — Averaging down with a hard cap (deliberately martingale-like)
- **Style tag**: mean-reversion
- **Horizon tag**: hours
- **Uses repo**: sigma
- **New vs round one**: 3,5,6,7
- **1 Context**: Balanced and volatility under its 7 day median.
- **2 Regions**: Prior day low.
- **3 Trigger**: Buy at the prior day low; if price falls another 0.5 sigma add 1 unit again, at most twice.
- **4 Thesis / invalidation**: Support area; averaging lowers cost. Invalid if a third level is reached.
- **5 Exit**: Exit all at average cost plus 0.4 percent, or at the global stop.
- **6 Risk / sizing**: Units 1, 1, 2 (martingale-like) with total risk capped at 1 percent of equity; global stop 1.5 sigma below the third add; no new cycle for 24 h after a stop.
- **7 Evaluation**: Focus on the tail: report worst cycle loss and the ratio of average win to worst loss; kill if worst loss exceeds 3 average wins.
- **Part tags**: context=quiet-balanced; regions=prior-hl; trigger=level-buy-average-down; thesis=support-holds; exit=breakeven-plus; risk=capped-martingale; eval=tail-ratio

### S239 — Equity-curve trading filter
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 1,6,7
- **1 Context**: Trade the underlying only when system equity is above its own 20-trade moving average.
- **2 Regions**: None.
- **3 Trigger**: Underlying: 15 minute high break with volume 1.5x (long) or mirrored low (short).
- **4 Thesis / invalidation**: Edges decay in runs; skipping poor stretches avoids drawdown. Invalid if filter whipsaws more than 3 times a week.
- **5 Exit**: Trail 1 sigma; time stop 45 min.
- **6 Risk / sizing**: Fixed 0.4% risk while on; paper trades continue while off to recompute equity.
- **7 Evaluation**: Compare filtered and unfiltered equity curves by max drawdown and Calmar ratio over 300 trades.
- **Part tags**: context=system-equity-above-ma; regions=none; trigger=break-volume; thesis=edge-clusters-in-time; exit=trailing; risk=equity-curve-filter; eval=calmar-compare

### S240 — Conviction-scored sizing
- **Style tag**: hybrid
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes:absorption, wall, collectors: derivs
- **New vs round one**: 3,6,7
- **1 Context**: Absorption episode active.
- **2 Regions**: Absorption band.
- **3 Trigger**: Enter on absorption; score = number of satisfied evidence items (0 to 5) plus 1 for a supporting wall, 1 for funding not against.
- **4 Thesis / invalidation**: More confirming evidence means higher odds.
- **5 Exit**: Exit on episode end.
- **6 Risk / sizing**: Size proportional to score: 0.1% risk per point up to 0.7%; stop 0.6 sigma.
- **7 Evaluation**: Calibration: realized hit rate by score; sizes only justified if hit rate rises with score.
- **Part tags**: context=absorption-episode; regions=absorption-band; trigger=absorption-ep; thesis=more-evidence-better; exit=episode-end; risk=conviction-scaled; eval=calibration-by-score

### S241 — Opposite-venue hedge on stop
- **Style tag**: breakout
- **Horizon tag**: minutes
- **Uses repo**: collectors: venues
- **New vs round one**: 5,6
- **1 Context**: Trend context.
- **2 Regions**: 4 h high.
- **3 Trigger**: Break entry on the main venue.
- **4 Thesis / invalidation**: Continuation.
- **5 Exit**: Instead of a stop order, hedge by opening an equal opposite position on another venue when the stop level is touched, then unwind both after 10 min.
- **6 Risk / sizing**: Hedge sizes equal; maximum hedged period 10 min; 0.4% risk to the stop level.
- **7 Evaluation**: Compare with plain stop exit: hedge cost and slippage.
- **Part tags**: context=trend; regions=prior-high; trigger=high-break; thesis=continuation; exit=hedge-instead-of-stop; risk=hedge-on-stop; eval=stop-cost-compare

### S242 — Scale-in at levels
- **Style tag**: mean-reversion
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 6
- **1 Context**: Balanced context.
- **2 Regions**: Three levels at 0.3, 0.6 and 0.9 percent beyond VWAP.
- **3 Trigger**: Buy a third at each level as price falls.
- **4 Thesis / invalidation**: Overshoot reverts.
- **5 Exit**: Exit all at VWAP or stop 1.2 percent beyond VWAP.
- **6 Risk / sizing**: Total risk 0.6% split into thirds; stop for all at 1.2 percent.
- **7 Evaluation**: Average entry vs single entry.
- **Part tags**: context=balanced; regions=vwap-band; trigger=scale-in-levels; thesis=mean-revert; exit=target; risk=scale-in-thirds; eval=entry-compare

### S243 — Risk-of-ruin-targeted size
- **Style tag**: trend
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 6,7
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Daily 55-day high break.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Chandelier 3 ATR.
- **6 Risk / sizing**: Size chosen each trade so that estimated risk of ruin (from last 100 trades) stays under 1 percent.
- **7 Evaluation**: Ruin probability trajectory; Monte Carlo of drawdown.
- **Part tags**: context=always-on; regions=none; trigger=55d-high-break; thesis=trend-persist; exit=chandelier-stop-only; risk=ruin-targeted; eval=ruin-probability

### S244 — ATR parity across BTC and ETH
- **Style tag**: trend
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 6,7
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Both assets above 20 day mean: long both.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Trailing 3 ATR on each.
- **6 Risk / sizing**: Equal ATR risk per asset (risk parity); gross limit 2x.
- **7 Evaluation**: Per-asset and portfolio Sharpe; out-of-sample asset: SOL.
- **Part tags**: context=both-above-20d-mean; regions=none; trigger=dual-asset-trend; thesis=trend-persist; exit=trailing; risk=atr-parity; eval=multi-asset-oos

### S245 — Contrarian to the Reader: trade against the fastest-looking signal
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst
- **New vs round one**: 3,4
- **1 Context**: Burst episode forming.
- **2 Regions**: None.
- **3 Trigger**: Fade a burst episode after 2 minutes if price progress is under 0.7 sigma.
- **4 Thesis / invalidation**: Weak bursts fail; most look strong at the start.
- **5 Exit**: Exit 8 min.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Compare fade vs follow on the same bursts (both signs reported).
- **Part tags**: context=burst-forming; regions=none; trigger=weak-burst-fade; thesis=weak-burst-fails; exit=time-stop; risk=fixed-r; eval=fade-vs-follow

### S246 — Only trade the second signal of the day
- **Style tag**: hybrid
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,3,6
- **1 Context**: Always on.
- **2 Regions**: Prior day extremes.
- **3 Trigger**: Take only the second sweep-and-reclaim of the UTC day.
- **4 Thesis / invalidation**: First signals are often noise; second filters.
- **5 Exit**: Target 1.5 R.
- **6 Risk / sizing**: One trade per day, 0.7% risk.
- **7 Evaluation**: Compare first vs second signal outcomes.
- **Part tags**: context=always-on; regions=prior-hl; trigger=nth-signal-of-day; thesis=signal-order-matters; exit=target; risk=one-trade-per-day; eval=first-vs-second

### S247 — Buy the worst hour
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 1,3,4
- **1 Context**: After the hour with the weakest return of the day.
- **2 Regions**: None.
- **3 Trigger**: At the start of the next hour buy.
- **4 Thesis / invalidation**: Overreaction in the previous hour.
- **5 Exit**: Exit at hour end.
- **6 Risk / sizing**: 0.2% risk.
- **7 Evaluation**: Placebo with a random hour.
- **Part tags**: context=post-worst-hour; regions=none; trigger=next-hour-after-worst; thesis=hourly-overreaction; exit=clock-exit; risk=fixed-r; eval=placebo-time

### S248 — Do nothing unless 3 venues agree
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: collectors: venues
- **New vs round one**: 1,3
- **1 Context**: Binance, Coinbase and Bybit prices all rising in the same 5 minutes.
- **2 Regions**: None.
- **3 Trigger**: Buy the agreed move.
- **4 Thesis / invalidation**: Agreement across venues means real flow, not local noise.
- **5 Exit**: Exit 20 min.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Ablation single venue.
- **Part tags**: context=three-venue-agree; regions=none; trigger=venue-consensus; thesis=real-not-local; exit=time-stop; risk=fixed-r; eval=ablation

### S249 — Wall merge strength ladder
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall
- **New vs round one**: 3,4,7
- **1 Context**: Wall episode active; the merged wall (by price within wallMergeBps) holds above wallMinUsd.
- **2 Regions**: Merged wall price.
- **3 Trigger**: Enter at the wall when 3 touches have happened without the wall shrinking more than 20 percent.
- **4 Thesis / invalidation**: A wall that survives touches is real and defended.
- **5 Exit**: Exit when the wall shrinks 50 percent or price moves 0.8 sigma.
- **6 Risk / sizing**: Stop 3 bps behind the wall; risk 0.3%.
- **7 Evaluation**: Wall quality buckets: touches survived vs outcome; need 60 walls.
- **Part tags**: context=wall-episode-active; regions=wall; trigger=wall-survives-touches; thesis=wall-defended-real; exit=wall-shrink-exit; risk=wall-anchored-stop; eval=quality-buckets

### S250 — Wall on both sides squeeze
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall
- **New vs round one**: 3,4,5
- **1 Context**: Active wall episodes above and below price within 0.5 percent.
- **2 Regions**: Both wall prices (a corridor).
- **3 Trigger**: Fade within the corridor, buy near the bid wall and sell near the ask wall.
- **4 Thesis / invalidation**: Corridors persist.
- **5 Exit**: Exit at the opposite wall minus 2 bps, or when either wall ends.
- **6 Risk / sizing**: Stop 3 bps beyond the wall; 0.3% risk.
- **7 Evaluation**: Corridor episodes sample; 40.
- **Part tags**: context=two-sided-walls; regions=wall-corridor; trigger=corridor-edge-fade; thesis=corridor-persists; exit=opposing-wall; risk=wall-anchored-stop; eval=small-sample-exploratory

### S251 — Burst into a wall
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst, wall
- **New vs round one**: 3,4,5
- **1 Context**: Burst episode active and a wall episode ahead within 0.4 percent.
- **2 Regions**: Wall price ahead.
- **3 Trigger**: Do not enter in the burst direction; fade at the wall once the burst loses speed.
- **4 Thesis / invalidation**: Bursts hitting walls stall.
- **5 Exit**: Exit at the pre-burst price.
- **6 Risk / sizing**: Stop beyond wall.
- **7 Evaluation**: Compare with bursts without walls.
- **Part tags**: context=burst-into-wall; regions=wall; trigger=burst-hits-wall; thesis=burst-stalls-at-wall; exit=level-touch; risk=structure-stop; eval=matched-control

### S252 — Burst with no wall and no absorption
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst, wall, absorption
- **New vs round one**: 3,4
- **1 Context**: Burst episode active; no wall or absorption episode in 0.5 percent.
- **2 Regions**: None.
- **3 Trigger**: Follow the burst.
- **4 Thesis / invalidation**: Free-running aggression.
- **5 Exit**: Exit when burst episode fades.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Compare with all bursts.
- **Part tags**: context=burst-clear-path; regions=none; trigger=clean-burst; thesis=free-run; exit=episode-end; risk=fixed-r; eval=ablation

### S253 — Absorption-then-burst reversal sequence
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption, burst
- **New vs round one**: 3,4
- **1 Context**: Absorption episode ended within the last 3 minutes.
- **2 Regions**: Absorption band.
- **3 Trigger**: A burst in the direction of the passive side after the absorption: enter.
- **4 Thesis / invalidation**: Passive side wins, then initiates.
- **5 Exit**: Exit at burst end.
- **6 Risk / sizing**: Stop under band.
- **7 Evaluation**: Sequence sample.
- **Part tags**: context=post-absorption; regions=absorption-band; trigger=absorption-then-burst; thesis=passive-turns-aggressor; exit=episode-end; risk=structure-stop; eval=sequence-study

### S254 — Exhaustion plus funding fade
- **Style tag**: hybrid
- **Horizon tag**: tens-of-minutes
- **Uses repo**: reader-episodes:exhaustion, collectors: derivs
- **New vs round one**: 3,4
- **1 Context**: Exhaustion active; funding in the extreme in the move direction.
- **2 Regions**: Move extreme.
- **3 Trigger**: Enter against.
- **4 Thesis / invalidation**: Crowd is paying.
- **5 Exit**: Exit episode end.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Compare with exhaustion without funding.
- **Part tags**: context=exhaustion-with-funding; regions=recent-extreme; trigger=exhaustion-ep; thesis=crowd-spent; exit=episode-end; risk=fixed-r; eval=ablation

### S255 — Order-flow z-score fade (zCap)
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-engine flow z-scores
- **New vs round one**: 3,4
- **1 Context**: Flow z-score (using zOtherFrac and zCap) above 3 in capped form.
- **2 Regions**: None.
- **3 Trigger**: Fade capped z-score extremes after z starts falling.
- **4 Thesis / invalidation**: Extreme flow is rare and mean reverts.
- **5 Exit**: Exit when z below 1.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Z bucket monotonic.
- **Part tags**: context=always-on; regions=none; trigger=flow-z-extreme-fall; thesis=flow-mean-reverts; exit=indicator-normalize; risk=fixed-r; eval=monotonic-bucket-test

### S256 — Iceberg proxy through repeated absorption
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption
- **New vs round one**: 3,4
- **1 Context**: Two absorption episodes at the same price within 20 min.
- **2 Regions**: Repeated absorption price.
- **3 Trigger**: Enter on the second absorption.
- **4 Thesis / invalidation**: Repeated absorption at a level signals a hidden large order.
- **5 Exit**: Exit 40 min.
- **6 Risk / sizing**: Stop 0.4 percent.
- **7 Evaluation**: Compare second vs first.
- **Part tags**: context=repeated-absorption; regions=repeat-absorption-price; trigger=second-absorption; thesis=hidden-large-order; exit=time-stop; risk=fixed-r; eval=first-vs-second

### S257 — Silent-tape drift
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: collectors: telemetry
- **New vs round one**: 1,3,4
- **1 Context**: Trades per second below 20 percent of median for 60 s.
- **2 Regions**: None.
- **3 Trigger**: When the tape resumes with 3 same-side prints over 2 bps total, join.
- **4 Thesis / invalidation**: After quiet, first aggressors lead.
- **5 Exit**: Exit 20 s.
- **6 Risk / sizing**: Stop 3 bps.
- **7 Evaluation**: Latency.
- **Part tags**: context=silent-tape; regions=none; trigger=first-aggressors-after-quiet; thesis=quiet-breaks-direction; exit=time-stop; risk=fixed-r; eval=latency-stress

### S258 — Overnight inventory gap fill
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,3,4
- **1 Context**: Asia session.
- **2 Regions**: Prior US close price.
- **3 Trigger**: Trade back toward US close if price is more than 1 percent away after 02:00 UTC.
- **4 Thesis / invalidation**: Gaps fill.
- **5 Exit**: Exit at the level or 07:00 UTC.
- **6 Risk / sizing**: Stop 0.7 percent beyond.
- **7 Evaluation**: Sample.
- **Part tags**: context=asia-session; regions=us-close-level; trigger=distance-from-close; thesis=gap-fill; exit=level-touch; risk=fixed-r; eval=window-permutation

### S259 — Weekly pin bar reversal
- **Style tag**: price-action
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Always on.
- **2 Regions**: Prior weekly candle extreme.
- **3 Trigger**: Enter at Monday open if the prior weekly candle is a pin bar (wick over 65 percent of range) at a 12-week extreme, in the direction of the wick rejection.
- **4 Thesis / invalidation**: Weekly rejection of an extreme.
- **5 Exit**: Exit at weekly midpoint of the pin or Friday close.
- **6 Risk / sizing**: Stop beyond the pin tip.
- **7 Evaluation**: Few events; pooled across BTC and ETH.
- **Part tags**: context=always-on; regions=weekly-extreme; trigger=weekly-pin-bar; thesis=weekly-rejection; exit=pin-midpoint; risk=structure-stop; eval=pooled-two-assets

### S260 — Halving-cycle phase tilt
- **Style tag**: time-event
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 1,3,4,6
- **1 Context**: Calendar months 12 to 18 after a halving.
- **2 Regions**: None.
- **3 Trigger**: Long-only buy on any weekly close above the 10 week mean in that phase.
- **4 Thesis / invalidation**: Supply shock narrative with lagged impact; possibly not repeating.
- **5 Exit**: Exit on a weekly close below the 10 week mean.
- **6 Risk / sizing**: Weekly rebalanced at 1x; 20 percent equity drawdown shutdown.
- **7 Evaluation**: Only 3 to 4 cycles: report as narrative, apply no kill rule; deflated heavily.
- **Part tags**: context=halving-phase; regions=none; trigger=weekly-close-above-mean; thesis=supply-shock-lag; exit=ma-cross-exit; risk=drawdown-shutdown; eval=few-cycles-narrative

### S261 — Post-liquidation-cascade multi-day bounce
- **Style tag**: liquidation
- **Horizon tag**: multi-day
- **Uses repo**: futures-stack
- **New vs round one**: 3,5
- **1 Context**: A daily liquidation total above its 95th percentile and a daily drop over 8 percent.
- **2 Regions**: Cascade low.
- **3 Trigger**: Buy the day after the daily close if the next day's first 4 h makes a higher low.
- **4 Thesis / invalidation**: Forced selling over; relief.
- **5 Exit**: Exit after 3 days or at 50 percent retrace.
- **6 Risk / sizing**: Stop below cascade low.
- **7 Evaluation**: Few events.
- **Part tags**: context=cascade-day; regions=cascade-extreme; trigger=next-day-higher-low; thesis=relief-after-forced; exit=retracement-target; risk=structure-stop; eval=small-sample-exploratory

### S262 — Daily OI and price compression breakout
- **Style tag**: derivatives-state
- **Horizon tag**: multi-day
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4
- **1 Context**: OI at a 30 day high and 10 day realized vol low.
- **2 Regions**: 10 day range.
- **3 Trigger**: Break in direction of daily close beyond range.
- **4 Thesis / invalidation**: Leverage plus compression resolves violently.
- **5 Exit**: Exit at 2 range widths.
- **6 Risk / sizing**: Stop opposite side.
- **7 Evaluation**: Few events.
- **Part tags**: context=oi-high-vol-low; regions=ten-day-range; trigger=range-break-leveraged; thesis=leverage-compression; exit=range-multiple; risk=structure-stop; eval=small-sample-exploratory

### S263 — Dispersion: majors above BTC
- **Style tag**: cross-venue
- **Horizon tag**: hours
- **Uses repo**: collectors: venues
- **New vs round one**: 3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: If four of five majors outperform BTC in 24 h by over 3 percent, short ETH versus BTC long.
- **4 Thesis / invalidation**: Altseason peaks.
- **5 Exit**: Exit 2 days.
- **6 Risk / sizing**: Pair.
- **7 Evaluation**: Pair sample.
- **Part tags**: context=majors-outperform; regions=none; trigger=breadth-peak; thesis=altseason-peak; exit=time-stop; risk=pair-spread; eval=pair-vs-single

### S264 — SOL beta lag
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: collectors: venues
- **New vs round one**: 3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: When BTC moves 1.5 sigma in 5 min and SOL moved under 0.5, trade SOL in BTC direction.
- **4 Thesis / invalidation**: High beta follows.
- **5 Exit**: Exit 10 min.
- **6 Risk / sizing**: Stop 0.8 percent.
- **7 Evaluation**: Out-of-sample on BNB.
- **Part tags**: context=always-on; regions=none; trigger=beta-lag; thesis=beta-follow; exit=time-stop; risk=fixed-r; eval=cross-asset-oos

### S265 — Funding sign flip with price confirmation
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,5
- **1 Context**: Funding changed from positive to negative.
- **2 Regions**: None.
- **3 Trigger**: Buy when price closes above the prior 4 h high after the flip.
- **4 Thesis / invalidation**: Crowd switches to shorts; squeeze.
- **5 Exit**: Exit when funding reverts positive.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Ablation.
- **Part tags**: context=funding-flip; regions=prior-high; trigger=high-close-after-flip; thesis=short-squeeze; exit=indicator-normalize; risk=fixed-r; eval=ablation

### S266 — Volatility regime switch: low to high
- **Style tag**: breakout
- **Horizon tag**: hours
- **Uses repo**: sigma
- **New vs round one**: 1,3,5
- **1 Context**: Sigma percentile moves from under 20 to over 60 within 1 h.
- **2 Regions**: Pre-switch range.
- **3 Trigger**: Trade in direction of the break that caused the switch.
- **4 Thesis / invalidation**: Regime change persists.
- **5 Exit**: Exit when sigma percentile back under 40.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Regime split.
- **Part tags**: context=vol-regime-switch; regions=pre-range; trigger=sigma-percentile-jump; thesis=regime-persist; exit=vol-contraction-exit; risk=fixed-r; eval=regime-split

### S267 — Volatility spike mean-reversion
- **Style tag**: mean-reversion
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **New vs round one**: 1,3,5
- **1 Context**: Sigma above its 99th percentile for 3 min.
- **2 Regions**: None.
- **3 Trigger**: Fade the move once sigma starts to decline.
- **4 Thesis / invalidation**: Vol spikes are transient.
- **5 Exit**: Exit when sigma falls to median.
- **6 Risk / sizing**: Stop 1 sigma.
- **7 Evaluation**: Percentile buckets.
- **Part tags**: context=vol-spike-decline; regions=none; trigger=sigma-fall-fade; thesis=vol-transient; exit=vol-contraction-exit; risk=sigma-multiple-stop; eval=monotonic-bucket-test

### S268 — Half-life aware time stop
- **Style tag**: mean-reversion
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **New vs round one**: 5,7
- **1 Context**: Balanced.
- **2 Regions**: VWAP band.
- **3 Trigger**: Fade 2 sigma excursions.
- **4 Thesis / invalidation**: Reversion with a half-life.
- **5 Exit**: Time stop equals 1.5 times the estimated half-life of VWAP deviation (re-estimated daily by AR(1)).
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Half-life estimate stability; compare to fixed 30 min.
- **Part tags**: context=balanced; regions=vwap-band; trigger=band-outside-reverse; thesis=half-life-revert; exit=half-life-time-stop; risk=fixed-r; eval=parameter-stability

### S269 — Thesis half-life expiry
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst
- **New vs round one**: 4,5
- **1 Context**: Burst episode active.
- **2 Regions**: None.
- **3 Trigger**: Enter with burst.
- **4 Thesis / invalidation**: Burst thesis has a half-life of 4 minutes measured from the history.
- **5 Exit**: Exit at one half-life if profit is under 0.3 sigma, otherwise at two.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Half-life calibration.
- **Part tags**: context=burst-episode; regions=none; trigger=burst-ep; thesis=half-life-bounded; exit=thesis-expiry-clock; risk=fixed-r; eval=calibration-by-score

### S270 — Ratchet stop at structure
- **Style tag**: trend
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 5,6
- **1 Context**: Trend.
- **2 Regions**: Swing lows.
- **3 Trigger**: Break of the prior 1 h high.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Ratchet the stop to each new 15 m swing low; no target.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Equity curve vs fixed trailing.
- **Part tags**: context=trend; regions=swing; trigger=prior-high-break; thesis=trend-persist; exit=structure-ratchet; risk=structure-stop; eval=exit-rule-compare

### S271 — Exit at next session open
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 5
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Buy after the daily low is made in the Asia session.
- **4 Thesis / invalidation**: Overnight.
- **5 Exit**: Exit at the next session open (London 07:00 UTC).
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Session split.
- **Part tags**: context=always-on; regions=session-low; trigger=session-low-confirm; thesis=session-bounce; exit=next-session-open; risk=fixed-r; eval=session-split

### S272 — Round-price digit clustering
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: none
- **New vs round one**: 2,3,4
- **1 Context**: Always on.
- **2 Regions**: Prices ending in 00 (x,x00) levels at the hundred.
- **3 Trigger**: Fade a touch of an exact hundred when the last 10 s move into it was over 2 bps and volume at the level stalls.
- **4 Thesis / invalidation**: Resting limit orders cluster at round hundreds.
- **5 Exit**: Exit 30 s.
- **6 Risk / sizing**: Stop 3 bps.
- **7 Evaluation**: Level shift placebo (x,x37).
- **Part tags**: context=always-on; regions=hundred-level; trigger=hundred-touch-stall; thesis=order-clustering; exit=time-stop; risk=fixed-r; eval=level-shift-placebo

### S273 — Hyperliquid-only liquidation follow
- **Style tag**: liquidation
- **Horizon tag**: seconds
- **Uses repo**: collectors: wallets
- **New vs round one**: 3,4
- **1 Context**: A liquidation fill on Hyperliquid.
- **2 Regions**: None.
- **3 Trigger**: Short immediately on a long-liquidation fill above 2 BTC notional-equivalent and exit 20 s.
- **4 Thesis / invalidation**: Forced market sell continues for seconds.
- **5 Exit**: Exit 20 s.
- **6 Risk / sizing**: 0.1% risk.
- **7 Evaluation**: Latency.
- **Part tags**: context=hl-liq-fill; regions=none; trigger=liq-fill-follow; thesis=forced-flow-continues; exit=time-stop; risk=fixed-r; eval=latency-stress

### S274 — Long liquidation exhaustion after 3 waves
- **Style tag**: liquidation
- **Horizon tag**: minutes
- **Uses repo**: futures-stack
- **New vs round one**: 3,5
- **1 Context**: Three liquidation spikes within 15 minutes.
- **2 Regions**: None.
- **3 Trigger**: Buy after the third.
- **4 Thesis / invalidation**: Three waves clear the leveraged longs.
- **5 Exit**: Exit at 50 percent retrace.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Wave count study.
- **Part tags**: context=three-liq-waves; regions=none; trigger=third-wave; thesis=crowd-cleared; exit=retracement-target; risk=fixed-r; eval=wave-count-study

### S275 — Insurance fund stress proxy
- **Style tag**: liquidation
- **Horizon tag**: hours
- **Uses repo**: none (insurance fund data not in repo)
- **New vs round one**: 1,3,4
- **1 Context**: Large cascade days.
- **2 Regions**: None.
- **3 Trigger**: After a day with a cascade above 1 percent of OI, avoid longs for 12 h; short the first bounce failing at 38 percent retrace.
- **4 Thesis / invalidation**: ADL and thin books keep pressure.
- **5 Exit**: Exit 12 h.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Cascade day sample.
- **Part tags**: context=post-cascade-day; regions=bounce-retrace; trigger=failed-bounce; thesis=residual-pressure; exit=time-stop; risk=fixed-r; eval=small-sample-exploratory

### S276 — Bid wall pulled before US open
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall
- **New vs round one**: 1,3,4
- **1 Context**: 13:00 to 13:30 UTC.
- **2 Regions**: Wall.
- **3 Trigger**: If an active bid wall disappears within 10 minutes before the open, short at 13:30.
- **4 Thesis / invalidation**: Large buyers withdraw ahead of volatility.
- **5 Exit**: Exit 13:50.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Control days without pulled wall.
- **Part tags**: context=pre-us-open; regions=wall; trigger=wall-pulled-pre-open; thesis=withdrawal-before-vol; exit=clock-exit; risk=fixed-r; eval=matched-control

### S277 — Sigma-normalized return reversal after 30 minutes
- **Style tag**: mean-reversion
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **New vs round one**: 3,5
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: 30 minute return beyond 2.5 sigma: fade 40 percent of it at once.
- **4 Thesis / invalidation**: Overreaction.
- **5 Exit**: Exit after 30 min.
- **6 Risk / sizing**: Stop 1.5 sigma.
- **7 Evaluation**: Percentile bucket.
- **Part tags**: context=always-on; regions=none; trigger=return-overreaction; thesis=overreaction-revert; exit=time-stop; risk=sigma-multiple-stop; eval=monotonic-bucket-test

### S278 — Reversal strength-gated by realized skew
- **Style tag**: mean-reversion
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 1,3
- **1 Context**: Skew of 1 minute returns in the last 30 min is positive over 0.5.
- **2 Regions**: None.
- **3 Trigger**: Fade upward spikes only.
- **4 Thesis / invalidation**: Positive skew indicates jumps up, not drift.
- **5 Exit**: Exit 10 min.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Regime split by skew.
- **Part tags**: context=return-skew-positive; regions=none; trigger=spike-fade; thesis=jump-not-drift; exit=time-stop; risk=fixed-r; eval=regime-split

### S279 — Serial correlation sign switch
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 1,3
- **1 Context**: Estimated lag-1 autocorrelation of 1 minute returns over 2 h; if positive trade momentum, if negative trade reversion.
- **2 Regions**: None.
- **3 Trigger**: Continue or fade the last 5 minute move depending on sign.
- **4 Thesis / invalidation**: Microstructure autocorrelation drifts between regimes.
- **5 Exit**: Exit 10 min.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Out-of-sample on ETH.
- **Part tags**: context=autocorr-sign; regions=none; trigger=sign-switch-trade; thesis=autocorr-regime; exit=time-stop; risk=fixed-r; eval=cross-asset-oos

### S280 — Hurst-exponent gate
- **Style tag**: trend
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1
- **1 Context**: Hurst estimate on 1 h returns above 0.55 over 24 h.
- **2 Regions**: None.
- **3 Trigger**: Breakout of 4 h high.
- **4 Thesis / invalidation**: Persistent regime.
- **5 Exit**: Trail.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Regime split.
- **Part tags**: context=hurst-persistent; regions=none; trigger=4h-high-break; thesis=persistent-regime; exit=trailing; risk=fixed-r; eval=regime-split

### S281 — Correlation breakdown BTC vs ETH
- **Style tag**: cross-venue
- **Horizon tag**: hours
- **Uses repo**: collectors: venues
- **New vs round one**: 1,3,4
- **1 Context**: 30 minute BTC/ETH correlation below 0.5 while normally above 0.9.
- **2 Regions**: None.
- **3 Trigger**: Trade the laggard toward the leader after correlation recovers above 0.7.
- **4 Thesis / invalidation**: Breakdowns are transient.
- **5 Exit**: Exit 2 h.
- **6 Risk / sizing**: Pair.
- **7 Evaluation**: Event sample.
- **Part tags**: context=correlation-breakdown; regions=none; trigger=corr-recovery; thesis=breakdown-transient; exit=time-stop; risk=pair-spread; eval=event-study-random-dip

### S282 — Bollinger squeeze direction by delta
- **Style tag**: breakout
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 3
- **1 Context**: Band width in the lowest decile of 7 days.
- **2 Regions**: Bands.
- **3 Trigger**: Break of band with 5 m delta sign agreeing.
- **4 Thesis / invalidation**: Delta shows who is pushing.
- **5 Exit**: Exit when price back to mean.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Ablation delta.
- **Part tags**: context=band-squeeze; regions=bollinger-band; trigger=band-break-delta; thesis=squeeze-direction; exit=mean-target; risk=fixed-r; eval=ablation

### S283 — Fear spike buy (perp premium negative)
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4
- **1 Context**: Basis negative (perp below spot) for the first time in 30 days.
- **2 Regions**: None.
- **3 Trigger**: Buy.
- **4 Thesis / invalidation**: Panic.
- **5 Exit**: Exit basis positive.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Rare.
- **Part tags**: context=basis-negative; regions=none; trigger=basis-turns-negative; thesis=panic-bottom; exit=indicator-normalize; risk=fixed-r; eval=rare-event-study

### S284 — Weekday weekend premium drift
- **Style tag**: time-event
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 1,3
- **1 Context**: Fri 21:00 UTC.
- **2 Regions**: None.
- **3 Trigger**: Buy Friday 21:00 UTC and sell Sunday 21:00 UTC.
- **4 Thesis / invalidation**: Weekend drift.
- **5 Exit**: Time exit.
- **6 Risk / sizing**: 1x.
- **7 Evaluation**: Out-of-sample year.
- **Part tags**: context=weekend-window; regions=none; trigger=friday-night-buy; thesis=weekend-drift; exit=calendar-exit; risk=fixed-notional; eval=out-of-sample-year

### S285 — Monday reversal of weekend move
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,3,4
- **1 Context**: Monday 08:00 to 12:00 UTC.
- **2 Regions**: Weekend range.
- **3 Trigger**: If the weekend move exceeded 2 percent, fade it on Monday.
- **4 Thesis / invalidation**: Thin liquidity overshoot.
- **5 Exit**: Exit Monday close.
- **6 Risk / sizing**: 0.5% risk.
- **7 Evaluation**: Weekend sample.
- **Part tags**: context=monday-after-weekend-move; regions=weekend-range; trigger=monday-fade; thesis=thin-overshoot; exit=clock-exit; risk=fixed-r; eval=window-permutation

### S286 — Open-interest price profile retest
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs
- **New vs round one**: 2,3,4
- **1 Context**: OI changes tracked per 5 min bar for 48 h.
- **2 Regions**: Price levels where OI increased most (positions opened) over 48 h, a profile of OI added by price.
- **3 Trigger**: Retest of a high-OI-added level from the far side: trade through if price is losing on that level (positions underwater), i.e. long below a heavy short cluster only after it is reclaimed.
- **4 Thesis / invalidation**: Underwater positions create forced exits at their entry price (stop clusters).
- **5 Exit**: Exit 1 sigma beyond the level or 2 h.
- **6 Risk / sizing**: Stop 0.5 percent.
- **7 Evaluation**: Level shift placebo.
- **Part tags**: context=oi-profile-known; regions=oi-added-level; trigger=level-retest-reclaimed; thesis=underwater-positions-exit; exit=sigma-beyond-level; risk=fixed-r; eval=level-shift-placebo

### S287 — Delta profile point of control
- **Style tag**: microstructure
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Session of at least 6 hours.
- **2 Regions**: Price level with maximum net delta (buyers minus sellers) in the session.
- **3 Trigger**: Retest of the delta-POC from above: buy if the 5 m delta is positive at the touch.
- **4 Thesis / invalidation**: Aggressive buyers concentrated there defend it.
- **5 Exit**: Exit at session high.
- **6 Risk / sizing**: Stop 0.25 percent below.
- **7 Evaluation**: Compare with volume POC retests.
- **Part tags**: context=session-mature; regions=delta-poc; trigger=delta-poc-retest; thesis=aggressor-concentration-defend; exit=session-high-target; risk=fixed-r; eval=vs-volume-poc

### S288 — Initial balance extension
- **Style tag**: breakout
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3,5
- **1 Context**: First 60 minutes of the 08:00 UTC session defined.
- **2 Regions**: Initial balance (IB) high and low.
- **3 Trigger**: Break of the IB by 0.1 percent after 30 minutes with delta aligned: follow.
- **4 Thesis / invalidation**: Strong days extend IB multiples.
- **5 Exit**: Exit when price reaches 1x IB width beyond, or 12:00 UTC if not.
- **6 Risk / sizing**: Stop mid-IB.
- **7 Evaluation**: Day sample.
- **Part tags**: context=session-ib-formed; regions=initial-balance; trigger=ib-break-delta; thesis=ib-extension; exit=ib-multiple; risk=structure-stop; eval=sign-test-days

### S289 — UTC day-end rebalance fade
- **Style tag**: time-event
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 1,3,4
- **1 Context**: 23:00 to 23:55 UTC.
- **2 Regions**: Daily VWAP.
- **3 Trigger**: If price is more than 1.5 percent from daily VWAP at 23:00, fade toward it.
- **4 Thesis / invalidation**: End-of-day mean reversion to VWAP.
- **5 Exit**: Exit 23:55.
- **6 Risk / sizing**: Stop 0.7 percent.
- **7 Evaluation**: Hour placebo.
- **Part tags**: context=day-end-window; regions=vwap; trigger=day-end-distance-fade; thesis=day-end-revert; exit=clock-exit; risk=fixed-r; eval=placebo-time

### S290 — Daily open reclaim
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Price below the daily open for 3 hours.
- **2 Regions**: Daily open price.
- **3 Trigger**: Reclaim with a 15 m close above the daily open and positive delta: long.
- **4 Thesis / invalidation**: Trapped shorts.
- **5 Exit**: Exit at daily high.
- **6 Risk / sizing**: Stop 0.3 percent under.
- **7 Evaluation**: Placebo.
- **Part tags**: context=below-daily-open; regions=daily-open; trigger=daily-open-reclaim; thesis=trapped-shorts; exit=session-high-target; risk=fixed-r; eval=level-shift-placebo

### S291 — Low-vol OCO ambush
- **Style tag**: breakout
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **New vs round one**: 3,5,6
- **1 Context**: Sigma under the 10th percentile for 2 hours.
- **2 Regions**: Range of those 2 hours.
- **3 Trigger**: Pending stop orders both sides; cancel the other when one fills.
- **4 Thesis / invalidation**: Quiet precedes move.
- **5 Exit**: Exit at 2 sigma_longer measured by realized post-fill or 30 min.
- **6 Risk / sizing**: Stop other side of range; risk 0.3%; skip when spread above 2 bps.
- **7 Evaluation**: Count of whipsaws; kill if more than 50 percent of fills reverse in 5 min.
- **Part tags**: context=vol-low; regions=quiet-range; trigger=oco-pending; thesis=quiet-precedes-move; exit=sigma-target; risk=structure-stop; eval=whipsaw-rate

### S292 — Gap-without-volume exhaustion
- **Style tag**: exhaustion-fade
- **Horizon tag**: seconds
- **Uses repo**: none
- **New vs round one**: 3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Price jumps more than 6 bps in 1 s on trade volume under 20 percent of the recent 1 s volume (thin jump): fade.
- **4 Thesis / invalidation**: Thin-book jumps revert.
- **5 Exit**: Exit 15 s.
- **6 Risk / sizing**: Stop 5 bps.
- **7 Evaluation**: Latency.
- **Part tags**: context=always-on; regions=none; trigger=thin-jump; thesis=thin-jump-reverts; exit=time-stop; risk=fixed-r; eval=latency-stress

### S293 — CVD trendline break
- **Style tag**: microstructure
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Always on.
- **2 Regions**: Trendline on CVD over 2 h with 3 touches.
- **3 Trigger**: Break of the CVD trendline before price breaks its own.
- **4 Thesis / invalidation**: CVD leads price.
- **5 Exit**: Exit at price break or 30 min.
- **6 Risk / sizing**: Stop 0.4 percent.
- **7 Evaluation**: Compare with price trendline breaks.
- **Part tags**: context=always-on; regions=cvd-trendline; trigger=cvd-break-first; thesis=cvd-leads-price; exit=target; risk=fixed-r; eval=vs-price-trendline

### S294 — Bybit-first liquidations
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: futures-stack
- **New vs round one**: 3,4
- **1 Context**: Bybit liquidation feed available.
- **2 Regions**: None.
- **3 Trigger**: Bybit liquidation spike before Binance and OKX: trade in the liquidation direction on Binance.
- **4 Thesis / invalidation**: Cross-venue cascades propagate.
- **5 Exit**: Exit 30 s.
- **6 Risk / sizing**: Stop 5 bps.
- **7 Evaluation**: Latency.
- **Part tags**: context=always-on; regions=none; trigger=bybit-liq-first; thesis=cascade-propagation; exit=time-stop; risk=fixed-r; eval=latency-stress

### S295 — OKX open interest lead
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: futures-stack
- **New vs round one**: 3,4
- **1 Context**: OKX OI polled every 10 s.
- **2 Regions**: None.
- **3 Trigger**: OKX OI rises 1 percent in 3 min with Binance flat: trade in price direction.
- **4 Thesis / invalidation**: Venue-leading positioning.
- **5 Exit**: Exit 15 min.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Lead-lag study.
- **Part tags**: context=always-on; regions=none; trigger=okx-oi-lead; thesis=venue-leading-positioning; exit=time-stop; risk=fixed-r; eval=lead-lag-correlation

### S296 — Bybit versus Binance basis mean reversion
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors: venues
- **New vs round one**: 3,4
- **1 Context**: venues.bybitVsBinanceBps beyond 3 sigma of its hour.
- **2 Regions**: None.
- **3 Trigger**: Trade the cheaper venue.
- **4 Thesis / invalidation**: Venue spread reverts.
- **5 Exit**: Exit spread under 1 sigma.
- **6 Risk / sizing**: Stop 6 bps.
- **7 Evaluation**: Fee stress.
- **Part tags**: context=venue-spread-wide; regions=none; trigger=venue-spread-z; thesis=venue-spread-revert; exit=spread-close; risk=fixed-r; eval=fee-stress

### S297 — Liquidation price of a tracked wallet as target
- **Style tag**: wallet
- **Horizon tag**: hours
- **Uses repo**: collectors: wallets
- **New vs round one**: 2,3,4
- **1 Context**: A tracked wallet with a liquidation price within 3 percent.
- **2 Regions**: Wallet liquidation price.
- **3 Trigger**: Join the price move toward it when 1 h momentum points that way.
- **4 Thesis / invalidation**: Cascade at the liquidation attracts.
- **5 Exit**: Exit before liquidation price.
- **6 Risk / sizing**: Stop 0.7 percent.
- **7 Evaluation**: Count.
- **Part tags**: context=wallet-near-liq; regions=wallet-liq-price; trigger=momentum-toward-liq; thesis=liq-attraction; exit=pre-cluster-exit; risk=fixed-r; eval=event-study-distance

### S298 — Support-resistance flip retest
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Always on.
- **2 Regions**: Level that has been broken with a close and 1.5x volume.
- **3 Trigger**: Retest of the broken level from the other side with a rejection bar.
- **4 Thesis / invalidation**: Role reversal.
- **5 Exit**: Exit at 2 R.
- **6 Risk / sizing**: Stop beyond level.
- **7 Evaluation**: Ablation volume.
- **Part tags**: context=always-on; regions=flipped-level; trigger=flip-retest; thesis=role-reversal; exit=target; risk=structure-stop; eval=ablation

### S299 — Skewed market making around a wall
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:wall
- **New vs round one**: 3,5,6
- **1 Context**: Wall episode active on one side.
- **2 Regions**: Wall price.
- **3 Trigger**: Quote both sides, with the quote on the wall side kept tight and the other wide.
- **4 Thesis / invalidation**: Walls protect the inventory on one side.
- **5 Exit**: Quotes pulled when the wall ends.
- **6 Risk / sizing**: Inventory limit 2 units; stop on wall end; no more than 1 percent equity inventory.
- **7 Evaluation**: Spread capture minus adverse selection; need 5000 quotes.
- **Part tags**: context=wall-episode-active; regions=wall; trigger=quote-skewed-by-wall; thesis=wall-protects-inventory; exit=quote-pull; risk=inventory-limit; eval=adverse-selection-check

### S300 — Inventory-aware trend-gated maker
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 3,6
- **1 Context**: Chop only, trend gate off in strong trend.
- **2 Regions**: None.
- **3 Trigger**: Two-sided quotes 2 bps off mid.
- **4 Thesis / invalidation**: Spread.
- **5 Exit**: Inventory skew.
- **6 Risk / sizing**: Quotes shifted by inventory; stop at 3 units.
- **7 Evaluation**: PnL net of adverse selection.
- **Part tags**: context=chop-gate; regions=none; trigger=two-sided-quote; thesis=spread-capture; exit=inventory-flatten; risk=inventory-skew; eval=adverse-selection-check

### S301 — Donchian trend with volatility target
- **Style tag**: trend
- **Horizon tag**: multi-day
- **Uses repo**: sigma
- **New vs round one**: 1,3,6,7
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Daily close at a 40 day high: long; at a 40 day low: short.
- **4 Thesis / invalidation**: Trend persists; the simplest possible entry.
- **5 Exit**: Exit at 20 day opposite channel.
- **6 Risk / sizing**: Position scaled to hold 15 percent annualized volatility, rebalanced daily, 3x cap.
- **7 Evaluation**: Compare to buy and hold; require positive Sharpe in each of 3 sub-periods (regime-split by year).
- **Part tags**: context=always-on; regions=none; trigger=donchian-40; thesis=trend-persist; exit=channel-exit; risk=vol-target-daily; eval=subperiod-sharpe

### S302 — Buy and hold with disaster stop
- **Style tag**: trend
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 1,2,3,5
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Buy at the start of the test and never sell.
- **4 Thesis / invalidation**: Long-term drift; benchmark thesis.
- **5 Exit**: Stop-only: exit only if a 25 percent drawdown from entry is hit.
- **6 Risk / sizing**: Fixed 1x; no leverage.
- **7 Evaluation**: It is the benchmark every other system must beat after drawdown adjustment.
- **Part tags**: context=always-on; regions=none; trigger=buy-once; thesis=secular-drift; exit=disaster-stop-only; risk=unlevered; eval=benchmark-itself

### S303 — Short-only blow-off top sniper
- **Style tag**: exhaustion-fade
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4,6
- **1 Context**: Price up more than 15 percent in 3 days and funding in the top 5 percent.
- **2 Regions**: 3 day high.
- **3 Trigger**: Short the first 1 h close below the prior 1 h low after a new 3 day high.
- **4 Thesis / invalidation**: Parabolic moves end with a sharp break.
- **5 Exit**: Exit after 24 h or 50 percent of the run retraced.
- **6 Risk / sizing**: Stop above the 3 day high; risk 0.3%; short-only; after 2 losing tries the system rests 7 days.
- **7 Evaluation**: Few occurrences: pooled across BTC and ETH, exploratory.
- **Part tags**: context=parabolic-run; regions=multi-day-high; trigger=first-lower-hourly-low; thesis=parabolic-end; exit=retracement-target; risk=try-limit-rest; eval=pooled-two-assets

### S304 — Capitulation low long-only
- **Style tag**: exhaustion-fade
- **Horizon tag**: hours
- **Uses repo**: collectors: derivs, futures-stack
- **New vs round one**: 3,4,6
- **1 Context**: Price down more than 15 percent in 3 days, funding negative, liquidations at 99th percentile.
- **2 Regions**: 3 day low.
- **3 Trigger**: Buy 1 h close above prior 1 h high after a new 3 day low.
- **4 Thesis / invalidation**: Capitulation ends.
- **5 Exit**: Exit 24 h or 50 percent retrace.
- **6 Risk / sizing**: Stop below low; 0.3% risk; long-only.
- **7 Evaluation**: Exploratory pooled.
- **Part tags**: context=capitulation-run; regions=multi-day-low; trigger=first-higher-hourly-high; thesis=capitulation-end; exit=retracement-target; risk=try-limit-rest; eval=pooled-two-assets

### S305 — Spread-and-depth shock stand-aside filter with trivial entry
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: collectors: book
- **New vs round one**: 1,3
- **1 Context**: Trade only when spread under 1.5 bps and depth within 5 bps above 70 percent of median; otherwise flat.
- **2 Regions**: None.
- **3 Trigger**: Enter long at each 15 minute boundary.
- **4 Thesis / invalidation**: The entry is intentionally trivial to isolate the value of the filter.
- **5 Exit**: Exit next boundary.
- **6 Risk / sizing**: Fixed 0.1% risk; stop 0.4 percent.
- **7 Evaluation**: Compare the same trivial rule with and without the filter; filter must add value on its own.
- **Part tags**: context=depth-spread-ok; regions=none; trigger=clock-boundary-long; thesis=filter-only; exit=clock-exit; risk=fixed-r; eval=filter-isolation

### S306 — Context-only system: stand aside during first 5 min after hour
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 1,3
- **1 Context**: Never trade 5 minutes after the hour (typical data releases) or 5 minutes around funding.
- **2 Regions**: None.
- **3 Trigger**: Trend: join the 20 minute return direction every 20 min.
- **4 Thesis / invalidation**: Avoid noise windows.
- **5 Exit**: Exit after 20 min.
- **6 Risk / sizing**: 0.2% risk.
- **7 Evaluation**: With and without the blackout.
- **Part tags**: context=blackout-windows; regions=none; trigger=twenty-min-trend-join; thesis=avoid-noise; exit=time-stop; risk=fixed-r; eval=filter-isolation

### S307 — Pure region system: touch the daily VWAP
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,2,3
- **1 Context**: Always on.
- **2 Regions**: Daily VWAP.
- **3 Trigger**: Limit order at VWAP each day; either side by position of price.
- **4 Thesis / invalidation**: VWAP attracts.
- **5 Exit**: Exit at daily open.
- **6 Risk / sizing**: Stop 0.5 percent.
- **7 Evaluation**: Placebo.
- **Part tags**: context=always-on; regions=vwap; trigger=vwap-limit; thesis=vwap-attracts; exit=level-touch; risk=fixed-r; eval=level-shift-placebo

### S308 — Trigger-only: any 1.5 sigma 1 minute bar
- **Style tag**: momentum
- **Horizon tag**: seconds
- **Uses repo**: sigma
- **New vs round one**: 1,2,3
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Next-second entry in the direction of any 1 minute bar beyond 1.5 sigma.
- **4 Thesis / invalidation**: Bar continuation.
- **5 Exit**: Exit 30 s.
- **6 Risk / sizing**: Stop 1 sigma.
- **7 Evaluation**: Shuffled.
- **Part tags**: context=always-on; regions=none; trigger=one-minute-sigma-bar; thesis=bar-continuation; exit=time-stop; risk=sigma-multiple-stop; eval=shuffled-time

### S309 — Extreme risk: 25x leverage micro stops
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: none
- **New vs round one**: 6
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Break of 5 s high.
- **4 Thesis / invalidation**: Micro momentum.
- **5 Exit**: Stop 3 bps; target 5 bps.
- **6 Risk / sizing**: Leverage 25x with 3 bps stop; liquidation distance 400 bps; risk 0.05% per trade.
- **7 Evaluation**: Latency stress and slippage; kill if net negative at 0.5 bp extra slippage.
- **Part tags**: context=always-on; regions=none; trigger=five-sec-break; thesis=micro-momentum; exit=target; risk=high-leverage-micro-stop; eval=slippage-stress

### S310 — Low leverage swing 1x
- **Style tag**: trend
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 6
- **1 Context**: Always on.
- **2 Regions**: Weekly high.
- **3 Trigger**: Break.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Weekly trail.
- **6 Risk / sizing**: 1x leverage; no stop except weekly.
- **7 Evaluation**: Walk-forward.
- **Part tags**: context=always-on; regions=weekly-extreme; trigger=weekly-high-break; thesis=trend-persist; exit=weekly-trail; risk=unlevered; eval=walk-forward

### S311 — Hyperliquid hourly funding spike fade
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4,5
- **1 Context**: Hyperliquid funding (hlCtx.fund, paid hourly) above 3x its 7 day median.
- **2 Regions**: None.
- **3 Trigger**: Take the side that receives funding (short when funding is high positive) if price is flat over the last 30 min.
- **4 Thesis / invalidation**: Funding extremes get arbitraged away by capital quickly.
- **5 Exit**: Exit after the next funding payment or when funding halves.
- **6 Risk / sizing**: 0.3% risk; stop 0.5 percent.
- **7 Evaluation**: Funding-inclusive PnL, hit rate by bucket.
- **Part tags**: context=hourly-funding-spike; regions=none; trigger=funding-side-flat-price; thesis=funding-arbitraged-away; exit=funding-payment-exit; risk=fixed-r; eval=funding-inclusive

### S312 — Predicted-vs-current funding gap
- **Style tag**: derivatives-state
- **Horizon tag**: hours
- **Uses repo**: collectors: wallets, derivs
- **New vs round one**: 3,4
- **1 Context**: Predicted funding differs from current by more than 3 bps.
- **2 Regions**: None.
- **3 Trigger**: Position for the predicted funding direction: if predicted is much higher, short before the reset.
- **4 Thesis / invalidation**: The predicted rate is a leading estimate of positioning pressure.
- **5 Exit**: Exit after the funding reset.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Shuffle.
- **Part tags**: context=funding-prediction-gap; regions=funding-clock; trigger=predicted-minus-current; thesis=funding-pressure-leads; exit=post-reset-exit; risk=fixed-r; eval=shuffled-time

### S313 — Coinbase premium open spike fade
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: collectors: venues
- **New vs round one**: 1,3,4
- **1 Context**: 14:30 to 15:00 UTC (US ETF/equity open flows).
- **2 Regions**: None.
- **3 Trigger**: If the Coinbase premium (venues.coinbaseVsBinanceBps) spikes above 10 bps in the first 10 minutes, fade it.
- **4 Thesis / invalidation**: Opening institutional bids overshoot.
- **5 Exit**: Exit when premium under 3 bps.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Day sample.
- **Part tags**: context=us-open-window; regions=none; trigger=premium-open-spike; thesis=institutional-overshoot; exit=indicator-normalize; risk=fixed-r; eval=sign-test-days

### S314 — Burst pullback entry
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst, sigma
- **New vs round one**: 3,4,5
- **1 Context**: Burst episode ended; price moved over 1.5 sigma.
- **2 Regions**: Burst start and end prices.
- **3 Trigger**: Buy a 50 percent retracement of the burst move, if flow stays on the burst side.
- **4 Thesis / invalidation**: Burst direction is still dominant; the retrace is a discount.
- **5 Exit**: Exit at the burst end price or when retrace passes 80 percent.
- **6 Risk / sizing**: Stop 80 percent retrace; 0.4% risk.
- **7 Evaluation**: Compare with chase entries on the same bursts.
- **Part tags**: context=post-burst; regions=burst-retrace; trigger=burst-retrace-entry; thesis=discount-in-dominant-flow; exit=burst-end-target; risk=structure-stop; eval=chase-vs-pullback

### S315 — Burst echo
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst
- **New vs round one**: 3,4
- **1 Context**: A burst ended 3 to 10 minutes ago; second burst forming in the same direction.
- **2 Regions**: None.
- **3 Trigger**: Join the second burst.
- **4 Thesis / invalidation**: Repeated bursts mean a persistent participant.
- **5 Exit**: Exit at burst end.
- **6 Risk / sizing**: 0.4% risk; stop 0.8 sigma.
- **7 Evaluation**: Pairs of bursts sample.
- **Part tags**: context=second-burst; regions=none; trigger=burst-echo; thesis=persistent-participant; exit=episode-end; risk=fixed-r; eval=sequence-study

### S316 — Fade your own stop-out
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 3,4,6
- **1 Context**: After any system stop-out within 3 minutes.
- **2 Regions**: The stopped level.
- **3 Trigger**: Take the opposite side if price returns across the stopped level within 3 minutes.
- **4 Thesis / invalidation**: Stops cluster near obvious levels; my stop is where others are.
- **5 Exit**: Exit at the entry level of the original trade.
- **6 Risk / sizing**: Risk 0.2% (half normal); one try per stop.
- **7 Evaluation**: Attribute PnL of reversal trades separately.
- **Part tags**: context=just-stopped; regions=own-stop-level; trigger=stop-recross; thesis=stop-cluster-run; exit=original-entry-level; risk=half-size-rebound; eval=leg-attribution

### S317 — Post-expiry volatility release
- **Style tag**: options-vol
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors: calendar, options
- **New vs round one**: 1,3,5
- **1 Context**: 08:00 to 10:00 UTC on Deribit expiry days.
- **2 Regions**: Expiry-day pin level (max pain).
- **3 Trigger**: After 08:00 UTC, a break of the 30 minute range away from max pain: follow.
- **4 Thesis / invalidation**: Pin released after expiry; volatility returns.
- **5 Exit**: Exit at 90 min or 1.5 range.
- **6 Risk / sizing**: Stop inside range.
- **7 Evaluation**: Expiry days only.
- **Part tags**: context=post-expiry; regions=max-pain-strike; trigger=post-expiry-break; thesis=pin-release; exit=range-multiple; risk=structure-stop; eval=small-sample-exploratory

### S318 — New week range break
- **Style tag**: breakout
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Monday 04:00 UTC.
- **2 Regions**: Monday 00:00 to 04:00 UTC range.
- **3 Trigger**: Break of this range.
- **4 Thesis / invalidation**: Weekly direction set early.
- **5 Exit**: Exit Wednesday.
- **6 Risk / sizing**: Stop mid.
- **7 Evaluation**: Weeks 80.
- **Part tags**: context=monday-after-open; regions=new-week-range; trigger=range-break; thesis=weekly-direction-early; exit=calendar-exit; risk=structure-stop; eval=weekly-walk-forward

### S319 — Asia squeeze continuation at London
- **Style tag**: breakout
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Asia range (00:00 to 07:00 UTC) narrow under 1.2 percent.
- **2 Regions**: Asia range.
- **3 Trigger**: Break of Asia range with a 15 m close after 07:00 UTC: follow.
- **4 Thesis / invalidation**: Compression released by London flow.
- **5 Exit**: Exit 11:00 UTC.
- **6 Risk / sizing**: Stop in range middle.
- **7 Evaluation**: Compare with Judas system.
- **Part tags**: context=asia-narrow; regions=asia-range; trigger=london-break-follow; thesis=compression-release; exit=clock-exit; risk=structure-stop; eval=paired-mirror

### S320 — Weekly VWAP exhaustion
- **Style tag**: exhaustion-fade
- **Horizon tag**: hours
- **Uses repo**: reader-episodes:exhaustion
- **New vs round one**: 2,3
- **1 Context**: Price more than 2.5 percent from weekly VWAP.
- **2 Regions**: Weekly VWAP.
- **3 Trigger**: Short an exhaustion episode extreme above weekly VWAP.
- **4 Thesis / invalidation**: Far from weekly value; reversion.
- **5 Exit**: Exit at weekly VWAP.
- **6 Risk / sizing**: Stop 0.5 sigma beyond.
- **7 Evaluation**: Scoreboard.
- **Part tags**: context=far-from-weekly-vwap; regions=weekly-vwap; trigger=exhaustion-ep; thesis=value-revert; exit=target; risk=structure-stop; eval=scoreboard-families

### S321 — Intraday ETH/BTC ratio reversion
- **Style tag**: cross-venue
- **Horizon tag**: hours
- **Uses repo**: collectors: venues
- **New vs round one**: 3,4
- **1 Context**: Always on.
- **2 Regions**: ETH/BTC ratio 24 h mean.
- **3 Trigger**: Fade ratio z-score above 2.5.
- **4 Thesis / invalidation**: Pair mean reverts.
- **5 Exit**: Exit z under 0.5.
- **6 Risk / sizing**: Pair.
- **7 Evaluation**: Hedge ratio check.
- **Part tags**: context=always-on; regions=ratio-mean; trigger=ratio-z-fade; thesis=pair-revert; exit=indicator-normalize; risk=pair-spread; eval=pair-vs-single

### S322 — Taker ratio extreme revert
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4
- **1 Context**: Taker buy/sell ratio (ratios.taker) beyond 1.4 for 10 min.
- **2 Regions**: None.
- **3 Trigger**: Fade after price stalls.
- **4 Thesis / invalidation**: Taker aggression exhausted.
- **5 Exit**: Exit ratio under 1.1.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Bucket.
- **Part tags**: context=taker-extreme; regions=none; trigger=taker-extreme-stall; thesis=aggression-exhausted; exit=indicator-normalize; risk=fixed-r; eval=monotonic-bucket-test

### S323 — Volume dry-up pullback
- **Style tag**: trend
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 3,4
- **1 Context**: Trend context.
- **2 Regions**: 20 EMA on 5 m.
- **3 Trigger**: Buy a pullback to EMA on declining volume (below 60 percent of median).
- **4 Thesis / invalidation**: Healthy pullbacks are quiet.
- **5 Exit**: Exit prior high.
- **6 Risk / sizing**: Stop under swing.
- **7 Evaluation**: Ablation volume.
- **Part tags**: context=trend; regions=moving-average; trigger=quiet-pullback; thesis=healthy-pullback; exit=target; risk=structure-stop; eval=ablation

### S324 — Higher-timeframe aligned pullback
- **Style tag**: trend
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,3
- **1 Context**: 4 h and daily trend both up.
- **2 Regions**: 1 h swing low.
- **3 Trigger**: Buy 15 m higher low.
- **4 Thesis / invalidation**: Alignment.
- **5 Exit**: Trail.
- **6 Risk / sizing**: Stop under.
- **7 Evaluation**: Regime split.
- **Part tags**: context=mtf-aligned; regions=swing; trigger=higher-low; thesis=timeframe-alignment; exit=trailing; risk=structure-stop; eval=regime-split

### S325 — Coin-margined versus USDT-margined basis
- **Style tag**: cross-venue
- **Horizon tag**: minutes
- **Uses repo**: none (coin-margined feed not in repo)
- **New vs round one**: 3,4
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Trade when the two contracts differ over 4 bps.
- **4 Thesis / invalidation**: Converges.
- **5 Exit**: Exit converge.
- **6 Risk / sizing**: Matched.
- **7 Evaluation**: Fee stress.
- **Part tags**: context=always-on; regions=none; trigger=contract-spread; thesis=contract-converge; exit=spread-close; risk=matched-notional; eval=fee-stress

### S326 — Trend-day hold to close
- **Style tag**: trend
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,5
- **1 Context**: By 10:00 UTC price is more than 1.2 percent from daily open and monotonic.
- **2 Regions**: Daily open.
- **3 Trigger**: Join at 10:00 UTC.
- **4 Thesis / invalidation**: Trend days persist.
- **5 Exit**: Exit 23:30 UTC.
- **6 Risk / sizing**: Stop daily open.
- **7 Evaluation**: Day sample.
- **Part tags**: context=trend-day-detected; regions=daily-open; trigger=ten-utc-join; thesis=trend-day-persist; exit=day-end-exit; risk=structure-stop; eval=sign-test-days

### S327 — Range-day sell-the-range
- **Style tag**: mean-reversion
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1
- **1 Context**: By 10:00 UTC price within 0.5 percent of daily open.
- **2 Regions**: Day range.
- **3 Trigger**: Fade extremes of day range.
- **4 Thesis / invalidation**: Range day.
- **5 Exit**: Exit mid.
- **6 Risk / sizing**: Stop outside.
- **7 Evaluation**: Day sample.
- **Part tags**: context=range-day-detected; regions=day-range; trigger=range-extreme-fade; thesis=range-day-persist; exit=range-middle; risk=structure-stop; eval=sign-test-days

### S328 — Wyckoff spring on low volume
- **Style tag**: liquidity-sweep
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3,4,5
- **1 Context**: A trading range of at least 6 hours with at least 3 touches of the bottom.
- **2 Regions**: Range low.
- **3 Trigger**: A wick below the range low by 0.1 to 0.4 percent on volume under 80 percent of the range average, then a close back inside: long.
- **4 Thesis / invalidation**: Low-volume breakdown means no supply; the spring is a shakeout.
- **5 Exit**: Exit at range high or when volume on the next rally is below the spring volume (no demand).
- **6 Risk / sizing**: Stop below the spring low; risk 0.5%.
- **7 Evaluation**: Compare low-volume springs to high-volume ones (the latter should fail); 40 each.
- **Part tags**: context=established-range; regions=range-low; trigger=low-volume-spring; thesis=no-supply-shakeout; exit=no-demand-exit; risk=structure-stop; eval=volume-contrast

### S329 — Upthrust with absorption
- **Style tag**: exhaustion-fade
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:absorption
- **New vs round one**: 2,3,4
- **1 Context**: Established range.
- **2 Regions**: Range high.
- **3 Trigger**: Wick above range high with an absorption episode of the buy aggression: short on close back inside.
- **4 Thesis / invalidation**: Buyers absorbed at the high; breakout fails.
- **5 Exit**: Exit at range midpoint, then trail.
- **6 Risk / sizing**: Stop above wick.
- **7 Evaluation**: Reader-based labels: precision per day.
- **Part tags**: context=established-range; regions=range-high; trigger=upthrust-absorption; thesis=breakout-absorbed; exit=midpoint-then-trail; risk=structure-stop; eval=label-precision-wilson

### S330 — Momentum ignition then quote pull fade
- **Style tag**: microstructure
- **Horizon tag**: seconds
- **Uses repo**: reader-episodes:burst, collectors: book
- **New vs round one**: 3,4,7
- **1 Context**: Burst episode starts and depth collapses on the opposite side in the same 5 s.
- **2 Regions**: None.
- **3 Trigger**: Fade the burst after 10 s when depth returns.
- **4 Thesis / invalidation**: Ignition: someone pushes price to trigger others and exits.
- **5 Exit**: Exit 45 s.
- **6 Risk / sizing**: Stop 5 bps.
- **7 Evaluation**: Latency.
- **Part tags**: context=burst-with-depth-collapse; regions=none; trigger=ignition-fade; thesis=ignition-exit; exit=time-stop; risk=fixed-r; eval=latency-stress

### S331 — Both-sides quote pull volatility entry
- **Style tag**: breakout
- **Horizon tag**: seconds
- **Uses repo**: collectors: book
- **New vs round one**: 3,4
- **1 Context**: Depth on both sides drops 40 percent within 3 s.
- **2 Regions**: None.
- **3 Trigger**: Follow the first aggressive trade direction after the pull.
- **4 Thesis / invalidation**: Makers stepped away before a move.
- **5 Exit**: Exit 40 s.
- **6 Risk / sizing**: Stop 5 bps.
- **7 Evaluation**: Latency.
- **Part tags**: context=symmetric-depth-collapse; regions=none; trigger=first-trade-after-pull; thesis=makers-know; exit=time-stop; risk=fixed-r; eval=latency-stress

### S332 — Cumulative delta zero-cross
- **Style tag**: microstructure
- **Horizon tag**: tens-of-minutes
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Session of 4 hours or more.
- **2 Regions**: Session cumulative delta zero line.
- **3 Trigger**: Long when session CVD crosses zero upward while price is above VWAP.
- **4 Thesis / invalidation**: Control flips to buyers.
- **5 Exit**: Exit when CVD below zero.
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Ablation VWAP.
- **Part tags**: context=session-mature; regions=cvd-zero; trigger=cvd-zero-cross; thesis=control-flip; exit=indicator-cross-back; risk=fixed-r; eval=ablation

### S333 — Sunday evening re-open
- **Style tag**: time-event
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 1,3
- **1 Context**: Sunday 20:00 to 23:00 UTC.
- **2 Regions**: Friday close and weekend range.
- **3 Trigger**: Follow the first hour after Sunday 20:00 UTC when it breaks the weekend range.
- **4 Thesis / invalidation**: Institutions return.
- **5 Exit**: Exit Monday 08:00.
- **6 Risk / sizing**: Stop in range.
- **7 Evaluation**: Week sample.
- **Part tags**: context=sunday-evening; regions=weekend-range; trigger=sunday-range-break; thesis=institutions-return; exit=clock-exit; risk=structure-stop; eval=weekly-walk-forward

### S334 — Score-gated entry (4 of 6 conditions)
- **Style tag**: hybrid
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma, collectors: derivs
- **New vs round one**: 3,4,7
- **1 Context**: Always on.
- **2 Regions**: VWAP.
- **3 Trigger**: Enter long only when at least 4 of 6 hold: above VWAP, OI rising, funding not extreme, delta positive, sigma not top decile, spread normal.
- **4 Thesis / invalidation**: The conditions are weak individually; the conjunction is the thesis.
- **5 Exit**: Exit when fewer than 3 hold (score decay).
- **6 Risk / sizing**: 0.4% risk.
- **7 Evaluation**: Score-bucket calibration, and count combinations tried (multiple testing).
- **Part tags**: context=score-gate; regions=vwap; trigger=score-at-least-four; thesis=conjunction-of-weak-signs; exit=score-decay; risk=fixed-r; eval=calibration-by-score

### S335 — Bayesian win-probability sizing
- **Style tag**: hybrid
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 6,7
- **1 Context**: Always on.
- **2 Regions**: Prior day extremes.
- **3 Trigger**: Sweep and reclaim.
- **4 Thesis / invalidation**: Liquidity grab.
- **5 Exit**: Target 1.5 R.
- **6 Risk / sizing**: Size from a Beta posterior of win rate (starts at 0.5, updated per trade); size zero while the lower 20 percent bound of expectancy is negative.
- **7 Evaluation**: Posterior expectancy track record and size path.
- **Part tags**: context=always-on; regions=prior-hl; trigger=sweep-reclaim-prior; thesis=liquidity-grab; exit=target; risk=posterior-sized; eval=bayesian-posterior

### S336 — Sigma-regime leverage ladder
- **Style tag**: breakout
- **Horizon tag**: hours
- **Uses repo**: sigma
- **New vs round one**: 6
- **1 Context**: Always on.
- **2 Regions**: Daily range.
- **3 Trigger**: Break of the 4 h high.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Trail 1 sigma.
- **6 Risk / sizing**: Leverage 4x when sigma is in the bottom quintile, 2x mid, 1x top quintile.
- **7 Evaluation**: Compare to constant leverage with equal average leverage.
- **Part tags**: context=always-on; regions=range-edge; trigger=4h-break; thesis=continuation; exit=trailing; risk=sigma-leverage-ladder; eval=equal-avg-leverage-compare

### S337 — Cooldown scaled by recent stops
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 6
- **1 Context**: Trend.
- **2 Regions**: 15 m high.
- **3 Trigger**: Break.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Trail.
- **6 Risk / sizing**: After a stop, wait (2 minutes times the number of stops in the last hour) before the next entry.
- **7 Evaluation**: Whipsaw statistics.
- **Part tags**: context=trend; regions=prior-high; trigger=high-break; thesis=trend-clustering; exit=trailing; risk=adaptive-cooldown; eval=whipsaw-rate

### S338 — Take profit and re-enter on same trend
- **Style tag**: trend
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 5
- **1 Context**: Trend.
- **2 Regions**: Swing.
- **3 Trigger**: Break.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Close at 2 R; re-enter at next higher low if trend structure intact (max 3 cycles).
- **6 Risk / sizing**: 0.4% risk per cycle; 1% total per trend.
- **7 Evaluation**: Cycle statistics.
- **Part tags**: context=trend; regions=swing; trigger=break-then-reentry; thesis=trend-persist; exit=take-profit-reenter; risk=trend-risk-cap; eval=cycle-statistics

### S339 — Head and shoulders neckline
- **Style tag**: price-action
- **Horizon tag**: hours
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Always on.
- **2 Regions**: Neckline from the pattern.
- **3 Trigger**: Neckline break with volume 1.5x.
- **4 Thesis / invalidation**: Pattern.
- **5 Exit**: Measured move.
- **6 Risk / sizing**: Stop above right shoulder.
- **7 Evaluation**: Pattern detection ablation.
- **Part tags**: context=always-on; regions=neckline; trigger=neckline-break; thesis=distribution-pattern; exit=measured-move; risk=structure-stop; eval=pattern-placebo

### S340 — Momentum divergence on RSI at weekly extreme
- **Style tag**: mean-reversion
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 2,3
- **1 Context**: Weekly timeframe.
- **2 Regions**: Weekly extreme.
- **3 Trigger**: RSI divergence.
- **4 Thesis / invalidation**: Divergence.
- **5 Exit**: Exit weekly mid.
- **6 Risk / sizing**: Stop beyond.
- **7 Evaluation**: Few events.
- **Part tags**: context=weekly-extreme; regions=weekly-extreme; trigger=rsi-divergence; thesis=divergence-reversal; exit=midpoint-target; risk=structure-stop; eval=small-sample-exploratory

### S341 — Two-venue first-touch at level
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors: venues
- **New vs round one**: 2,3,4
- **1 Context**: Level defined (daily open).
- **2 Regions**: Daily open.
- **3 Trigger**: Coinbase touches the level first, trade Binance in the touch direction.
- **4 Thesis / invalidation**: US venue leads.
- **5 Exit**: Exit 20 s.
- **6 Risk / sizing**: Stop 4 bps.
- **7 Evaluation**: Latency.
- **Part tags**: context=level-near; regions=daily-open; trigger=first-touch-venue; thesis=us-leads; exit=time-stop; risk=fixed-r; eval=latency-stress

### S342 — Order-flow re-test of burst origin
- **Style tag**: momentum
- **Horizon tag**: minutes
- **Uses repo**: reader-episodes:burst
- **New vs round one**: 2,3
- **1 Context**: Burst ended.
- **2 Regions**: Burst origin price.
- **3 Trigger**: Return to origin and hold.
- **4 Thesis / invalidation**: Origin acts as a base.
- **5 Exit**: Target burst end.
- **6 Risk / sizing**: Stop under origin.
- **7 Evaluation**: Compare vs chase.
- **Part tags**: context=post-burst; regions=burst-origin; trigger=origin-retest; thesis=origin-base; exit=burst-end-target; risk=structure-stop; eval=chase-vs-pullback

### S343 — Thin-side liquidity void run
- **Style tag**: microstructure
- **Horizon tag**: minutes
- **Uses repo**: collectors: book
- **New vs round one**: 3,4,5
- **1 Context**: Depth within 25 bps on one side is under 40 percent of the other side for 2 minutes.
- **2 Regions**: Price levels with little resting size (a void) on the thin side.
- **3 Trigger**: Enter toward the thin side on the first 1 m close that moves 0.1 percent that way.
- **4 Thesis / invalidation**: Price travels through voids with little resistance.
- **5 Exit**: Exit when depth within 5 bps on that side recovers above 80 percent of median.
- **6 Risk / sizing**: Stop 0.3 percent; 0.3% risk.
- **7 Evaluation**: Void definition sensitivity (25 vs 10 bps window).
- **Part tags**: context=asymmetric-depth; regions=liquidity-void; trigger=void-direction-close; thesis=void-traverse; exit=depth-recovery-exit; risk=fixed-r; eval=definition-sensitivity

### S344 — Hyperliquid depth leads Binance
- **Style tag**: cross-venue
- **Horizon tag**: seconds
- **Uses repo**: collectors: book
- **New vs round one**: 3,4
- **1 Context**: Hyperliquid book imbalance (bookHl.imbalance5) beyond +/-0.6 while Binance is balanced.
- **2 Regions**: None.
- **3 Trigger**: Trade Binance in the direction of the HL imbalance.
- **4 Thesis / invalidation**: HL traders are faster informed.
- **5 Exit**: Exit 20 s.
- **6 Risk / sizing**: Stop 4 bps; 0.1% risk.
- **7 Evaluation**: Latency stress ladder.
- **Part tags**: context=hl-imbalance-only; regions=none; trigger=hl-imbalance-lead; thesis=hl-informed; exit=time-stop; risk=fixed-r; eval=latency-stress

### S345 — Approach-speed round-number test
- **Style tag**: price-action
- **Horizon tag**: minutes
- **Uses repo**: sigma
- **New vs round one**: 2,3,4
- **1 Context**: Always on.
- **2 Regions**: Round thousands.
- **3 Trigger**: If price approaches a round thousand in under 2 minutes with a 1.5 sigma impulse, expect a breakthrough: follow; if slowly (over 15 minutes, under 0.5 sigma impulse), fade at the level.
- **4 Thesis / invalidation**: Impulse approach carries momentum; slow approach meets resting orders.
- **5 Exit**: Exit 15 min.
- **6 Risk / sizing**: Stop 0.25 percent.
- **7 Evaluation**: Compare fast and slow groups.
- **Part tags**: context=always-on; regions=round-number; trigger=approach-speed; thesis=momentum-versus-resting; exit=time-stop; risk=fixed-r; eval=group-contrast

### S346 — Book resilience gate
- **Style tag**: breakout
- **Horizon tag**: minutes
- **Uses repo**: collectors: book
- **New vs round one**: 1,3
- **1 Context**: Depth refill ratio after a trade burst (depth 5 s later / depth before) under 0.6.
- **2 Regions**: None.
- **3 Trigger**: Break of 30 minute high.
- **4 Thesis / invalidation**: When books refill slowly, breaks run further.
- **5 Exit**: Exit trailing 1 sigma.
- **6 Risk / sizing**: 0.3% risk.
- **7 Evaluation**: Resilience bucket test.
- **Part tags**: context=low-book-resilience; regions=range-edge; trigger=high-break-slow-refill; thesis=thin-recovery-extends; exit=trailing; risk=fixed-r; eval=monotonic-bucket-test

### S347 — Grind detection
- **Style tag**: trend
- **Horizon tag**: tens-of-minutes
- **Uses repo**: sigma
- **New vs round one**: 3,4,5
- **1 Context**: A steady drift of over 0.8 percent in 90 min with realized sigma under its median.
- **2 Regions**: None.
- **3 Trigger**: Join the grind on the next 5 m pullback of 0.1 percent.
- **4 Thesis / invalidation**: Low-vol grinds are driven by persistent passive-to-aggressive conversion.
- **5 Exit**: Exit if 5 m sigma doubles (the grind has become a spike) or after 90 minutes.
- **6 Risk / sizing**: Stop 0.35 percent; 0.4% risk.
- **7 Evaluation**: Compare grinds with high-vol drifts of the same size.
- **Part tags**: context=low-vol-drift; regions=none; trigger=grind-pullback; thesis=persistent-conversion; exit=vol-expansion-exit; risk=fixed-r; eval=matched-control

### S348 — Last five minutes of the UTC day
- **Style tag**: time-event
- **Horizon tag**: minutes
- **Uses repo**: none
- **New vs round one**: 1,3,4
- **1 Context**: 23:55 to 00:05 UTC.
- **2 Regions**: Daily close.
- **3 Trigger**: Join the direction of buy/sell imbalance over the last 30 minutes of the day into the close.
- **4 Thesis / invalidation**: Index and fund marks use the daily close; flows concentrate.
- **5 Exit**: Exit 00:05.
- **6 Risk / sizing**: 0.2% risk.
- **7 Evaluation**: Placebo clock.
- **Part tags**: context=day-close-window; regions=daily-close; trigger=close-imbalance-join; thesis=mark-the-close; exit=clock-exit; risk=fixed-r; eval=placebo-time

### S349 — Open interest drop after a flush, re-long
- **Style tag**: derivatives-state
- **Horizon tag**: tens-of-minutes
- **Uses repo**: collectors: derivs
- **New vs round one**: 3,4,5
- **1 Context**: OI fell more than 4 percent in 30 min with price down.
- **2 Regions**: Flush low.
- **3 Trigger**: When OI stops falling for 5 min and funding turns lower, buy.
- **4 Thesis / invalidation**: Leverage washed; healthier base.
- **5 Exit**: Exit funding up or OI rebuilds fast above 3 percent.
- **6 Risk / sizing**: Stop under low.
- **7 Evaluation**: Flush event study.
- **Part tags**: context=post-flush; regions=flush-low; trigger=oi-stabilize-funding-lower; thesis=leverage-washed; exit=oi-rebuild-exit; risk=structure-stop; eval=event-study-random-dip

### S350 — Tail-hedged trend (small option-like loss cap)
- **Style tag**: trend
- **Horizon tag**: multi-day
- **Uses repo**: none
- **New vs round one**: 5,6
- **1 Context**: Always on.
- **2 Regions**: None.
- **3 Trigger**: Daily 30 day high.
- **4 Thesis / invalidation**: Trend.
- **5 Exit**: Exit by weekly close below 10 week mean.
- **6 Risk / sizing**: Position sizing 1x with an extra hedge: every trade reduces size by 40 percent on any one day move of -5 percent (gap protection).
- **7 Evaluation**: Drawdown profile in gap days.
- **Part tags**: context=always-on; regions=none; trigger=30d-high; thesis=trend-persist; exit=weekly-ma-exit; risk=gap-day-size-cut; eval=gap-day-drawdown

## Tag vocabulary

Counts computed by parsing this file with a node script (systems S101..S350). Round-one comparison uses the Part tags lines of `systems.md`.

**style**: microstructure (35), cross-venue (23), time-event (22), derivatives-state (20), trend (18), breakout (16), hybrid (16), momentum (16), price-action (15), mean-reversion (14), options-vol (11), exhaustion-fade (10), volume-profile (10), liquidation (9), wallet (6), event (5), liquidity-sweep (3), baseline (1)

**horizon**: minutes (82), hours (74), tens-of-minutes (38), seconds (33), multi-day (23)

Systems using at least one existing repo component or collector: about 154 of 250.

**context** (165 distinct): always-on (58), trend (10), absorption-episode (5), balanced (5), tight-spread (4), wall-episode-active (3), above-4h-vwap-trend (2), burst-episode (2), established-range (2), post-burst (2), session-mature (2), us-open-window (2), above-20d-mean (1), above-weekly-avwap (1), absorption-fading (1), asia-narrow (1), asia-open-window (1), asia-session (1), asymmetric-depth (1), autocorr-sign (1), balanced-prior-profile (1), balanced-range (1), band-squeeze (1), basis-dislocation (1), basis-extreme (1), basis-negative (1), below-daily-open (1), blackout-windows (1), both-above-20d-mean (1), breadth-up (1), burst-clear-path (1), burst-forming (1), burst-into-wall (1), burst-with-depth-collapse (1), capitulation-run (1), cascade-day (1), chop-gate (1), clear-poc-session (1), correlation-breakdown (1), cum-funding-extreme (1), day-close-window (1), day-end-window (1), depth-spread-ok (1), dip-with-wallets (1), downmove-oi-up (1), dvol-jump (1), engine-gates (1), exhaustion-episode (1), exhaustion-episode-present (1), exhaustion-with-funding (1), extended-move (1), far-from-weekly-vwap (1), fee-tier-low (1), flash-dislocation (1), fomc-day (1), funding-disagree (1), funding-flip (1), funding-prediction-gap (1), funding-second (1), funding-spread (1), halving-phase (1), hl-imbalance-only (1), hl-liq-fill (1), hour-trend (1), hourly-funding-spike (1), hurst-persistent (1), imbalance-extreme (1), inside-day (1), inside-prior-value (1), iv-known (1), iv-rich (1), just-stopped (1), level-near (1), liq-intensity-rising (1), liq-surge (1), liq-wave (1), london-window (1), low-book-resilience (1), low-vol-drift (1), macro-release (1), majors-outperform (1), monday-after-open (1), monday-after-weekend-move (1), month-end-window (1), monthly-bias-range (1), mtf-aligned (1), multi-family-group (1), naked-poc-near (1), near-vwap (1), negative-gamma-proxy (1), new-high (1), new-listing (1), nr7-day (1), ny-lunch-window (1), oi-build-flat (1), oi-flat-range (1), oi-high-vol-low (1), oi-profile-known (1), oi-volume-high (1), options-expiry-day (1), parabolic-run (1), poor-high-prior (1), positioning-extreme (1), positive-funding-streak (1), positive-gamma-proxy (1), post-absorption (1), post-cascade (1), post-cascade-day (1), post-expiry (1), post-flush (1), post-liq-day (1), post-sweep (1), post-worst-hour (1), pre-funding-window (1), pre-quarterly-expiry (1), pre-us-open (1), premium-dislocation (1), premium-extreme (1), premium-spike (1), quiet-balanced (1), quiet-sigma-wakeup (1), range-bound (1), range-day-detected (1), repeated-absorption (1), resumed-episode (1), return-skew-positive (1), score-gate (1), second-burst (1), session-ib-formed (1), session-open-window (1), short-cover-rally (1), silent-tape (1), single-venue-liq (1), skew-extreme (1), spread-normal (1), stable-depth (1), stablecoin-depeg (1), sunday-evening (1), symmetric-depth-collapse (1), system-equity-above-ma (1), taker-extreme (1), tape-speed-surge (1), thin-touch (1), three-liq-waves (1), three-venue-agree (1), trend-day-detected (1), two-sided-walls (1), unfilled-single-print (1), up-streak (1), venue-outage (1), venue-spread-wide (1), vol-compressed (1), vol-low (1), vol-regime-switch (1), vol-spike-decline (1), wall-episode (1), wall-flicker (1), wallet-cluster-near (1), wallet-consensus (1), wallet-liquidated (1), wallet-near-liq (1), weekend-gap (1), weekend-thin-book (1), weekend-window (1), weekly-extreme (1)

New in round two for context (161): above-20d-mean, above-4h-vwap-trend, above-weekly-avwap, absorption-episode, absorption-fading, asia-narrow, asia-open-window, asia-session, asymmetric-depth, autocorr-sign, balanced-prior-profile, balanced-range, band-squeeze, basis-dislocation, basis-extreme, basis-negative, below-daily-open, blackout-windows, both-above-20d-mean, breadth-up, burst-clear-path, burst-episode, burst-forming, burst-into-wall, burst-with-depth-collapse, capitulation-run, cascade-day, chop-gate, clear-poc-session, correlation-breakdown, cum-funding-extreme, day-close-window, day-end-window, depth-spread-ok, dip-with-wallets, downmove-oi-up, dvol-jump, engine-gates, established-range, exhaustion-episode, exhaustion-episode-present, exhaustion-with-funding, extended-move, far-from-weekly-vwap, fee-tier-low, flash-dislocation, fomc-day, funding-disagree, funding-flip, funding-prediction-gap, funding-second, funding-spread, halving-phase, hl-imbalance-only, hl-liq-fill, hour-trend, hourly-funding-spike, hurst-persistent, imbalance-extreme, inside-day, inside-prior-value, iv-known, iv-rich, just-stopped, level-near, liq-intensity-rising, liq-surge, liq-wave, london-window, low-book-resilience, low-vol-drift, macro-release, majors-outperform, monday-after-open, monday-after-weekend-move, month-end-window, monthly-bias-range, mtf-aligned, multi-family-group, naked-poc-near, near-vwap, negative-gamma-proxy, new-high, new-listing, nr7-day, ny-lunch-window, oi-build-flat, oi-flat-range, oi-high-vol-low, oi-profile-known, oi-volume-high, options-expiry-day, parabolic-run, poor-high-prior, positioning-extreme, positive-funding-streak, positive-gamma-proxy, post-absorption, post-burst, post-cascade, post-cascade-day, post-expiry, post-flush, post-liq-day, post-sweep, post-worst-hour, pre-funding-window, pre-quarterly-expiry, pre-us-open, premium-dislocation, premium-extreme, premium-spike, quiet-balanced, quiet-sigma-wakeup, range-bound, range-day-detected, repeated-absorption, resumed-episode, return-skew-positive, score-gate, second-burst, session-ib-formed, session-mature, session-open-window, short-cover-rally, silent-tape, single-venue-liq, skew-extreme, spread-normal, stable-depth, stablecoin-depeg, sunday-evening, symmetric-depth-collapse, system-equity-above-ma, taker-extreme, tape-speed-surge, thin-touch, three-liq-waves, three-venue-agree, tight-spread, trend-day-detected, two-sided-walls, unfilled-single-print, up-streak, us-open-window, venue-outage, venue-spread-wide, vol-compressed, vol-regime-switch, vol-spike-decline, wall-episode, wall-episode-active, wall-flicker, wallet-cluster-near, wallet-consensus, wallet-liquidated, wallet-near-liq, weekend-gap, weekend-thin-book, weekend-window, weekly-extreme

**regions** (94 distinct): none (96), range-edge (9), wall (8), swing (6), vwap (6), absorption-band (5), prior-hl (5), vwap-band (5), prior-high (4), daily-open (3), funding-clock (3), high-oi-strike (3), round-number (3), weekly-extreme (3), anchored-vwap (2), asia-range (2), cascade-extreme (2), day-range (2), implied-move-bound (2), max-pain-strike (2), move-extreme (2), recent-extreme (2), value-area-edge (2), wallet-liq-price (2), weekend-range (2), 4h-open (1), bar-extreme (1), best-bid (1), bollinger-band (1), bounce-retrace (1), burst-origin (1), burst-retrace (1), compression-range (1), cvd-level (1), cvd-trendline (1), cvd-zero (1), daily-close (1), daily-pivots (1), delta-poc (1), developing-poc (1), engine-specific (1), episode-band (1), equal-highs-lows (1), estimated-liq-cluster (1), fib-retrace (1), flipped-level (1), flush-low (1), frozen-level (1), grid-lines (1), hourly-open (1), hundred-level (1), hvn (1), index-level (1), initial-balance (1), liq-cluster (1), liquidity-void (1), listing-open (1), lvn (1), ma-200 (1), mark-level (1), moving-average (1), multi-day-high (1), multi-day-low (1), naked-poc (1), neckline (1), new-week-range (1), oi-added-level (1), opening-range (1), own-stop-level (1), poor-high-low (1), post-release-range (1), pre-open-range (1), pre-range (1), prior-week-extreme (1), prior-week-vwap (1), quiet-range (1), range-high (1), range-low (1), ratio-high (1), ratio-mean (1), refill-level (1), repeat-absorption-price (1), session-low (1), single-print (1), spike-extreme (1), sweep-extreme (1), ten-day-range (1), touch-quote (1), us-close-level (1), volume-shelf (1), wall-corridor (1), weekly-close-level (1), weekly-open (1), weekly-vwap (1)

New in round two for regions (85): 4h-open, absorption-band, anchored-vwap, asia-range, bar-extreme, best-bid, bollinger-band, bounce-retrace, burst-origin, burst-retrace, cascade-extreme, compression-range, cvd-level, cvd-trendline, cvd-zero, daily-close, daily-open, daily-pivots, day-range, delta-poc, developing-poc, engine-specific, episode-band, equal-highs-lows, estimated-liq-cluster, fib-retrace, flipped-level, flush-low, frozen-level, funding-clock, grid-lines, high-oi-strike, hourly-open, hundred-level, hvn, implied-move-bound, index-level, initial-balance, liquidity-void, listing-open, lvn, ma-200, mark-level, max-pain-strike, move-extreme, moving-average, multi-day-high, multi-day-low, naked-poc, neckline, new-week-range, oi-added-level, own-stop-level, poor-high-low, post-release-range, pre-open-range, pre-range, prior-high, prior-week-extreme, prior-week-vwap, quiet-range, range-high, range-low, ratio-high, ratio-mean, recent-extreme, refill-level, repeat-absorption-price, session-low, single-print, spike-extreme, sweep-extreme, ten-day-range, touch-quote, us-close-level, value-area-edge, volume-shelf, vwap-band, wall-corridor, wallet-liq-price, weekend-range, weekly-close-level, weekly-extreme, weekly-open, weekly-vwap

**trigger** (240 distinct): absorption-ep (4), exhaustion-ep (3), band-outside-reverse (2), break-volume (2), burst-ep (2), high-break (2), prior-high-break (2), 20d-high-break (1), 30d-high (1), 4h-break (1), 4h-high-break (1), 55d-high-break (1), absorption-staged (1), absorption-then-burst (1), against-paying-side (1), approach-speed (1), avwap-pullback (1), band-break-delta (1), bar-close-clock (1), basis-spike (1), basis-threshold (1), basis-turns-negative (1), below-vwap-after-extreme (1), beta-lag (1), big-move-fade (1), block-print (1), bound-break-follow (1), bound-reach-fade (1), breadth-peak (1), break-after-oi-build (1), break-reentry (1), break-then-reentry (1), break-then-reverse (1), break-with-delta (1), break-with-oi-rise (1), burst-dip-20s (1), burst-echo (1), burst-hits-wall (1), burst-retrace-entry (1), buy-once (1), bybit-liq-first (1), calendar-date (1), clean-burst (1), clock-boundary-long (1), close-imbalance-join (1), cluster-approach (1), consolidation-toward-cluster (1), contract-spread (1), corr-recovery (1), corridor-edge-fade (1), cvd-break-first (1), cvd-divergence (1), cvd-level-retest (1), cvd-zero-cross (1), daily-close-near-extreme (1), daily-lower-high (1), daily-open-reclaim (1), daily-streak (1), day-end-distance-fade (1), delta-flip-at-level (1), delta-poc-retest (1), depth-collapse (1), depth-recovery (1), distance-from-close (1), distance-limit-entry (1), distance-with-delta (1), donchian-40 (1), dual-asset-trend (1), dvol-jump (1), episode-resume (1), equal-highs-wick-reclaim (1), fade-from-strike (1), fading-flip (1), failed-bounce (1), fall-with-delta-divergence (1), false-break-4h (1), family-consensus (1), first-15m-return (1), first-aggressors-after-quiet (1), first-higher-hourly-high (1), first-lower-hourly-low (1), first-touch-venue (1), first-trade-after-pull (1), five-sec-break (1), flip-retest (1), flow-z-extreme-fall (1), friday-night-buy (1), funding-side-flat-price (1), funding-sign-disagree (1), funding-spread-open (1), grid-fill (1), grind-pullback (1), herd-spike (1), high-break-oi-rise (1), high-break-slow-refill (1), high-close-after-flip (1), higher-low (1), higher-low-add (1), hl-imbalance-lead (1), hour-high-break-delta (1), hundred-touch-stall (1), hvn-entry-slowdown (1), ib-break-delta (1), iceberg-detect (1), ignition-fade (1), imbalance-no-follow (1), iv-rise-vs-rv (1), laggard-catchup (1), last-mark-gap (1), level-bounce-bar (1), level-buy-average-down (1), level-retest-reclaimed (1), liq-fill-follow (1), liq-rate-decay (1), liq-side-ratio (1), london-break-follow (1), low-volume-spring (1), lower-high (1), lower-high-basis (1), lunch-break-fade (1), lvn-entry-accel (1), ma-cross (1), majors-lead (1), maker-on-imbalance (1), microprice-skew (1), momentum-toward-liq (1), monday-confirm-bar (1), monday-fade (1), neckline-break (1), negative-funding-time (1), next-day-higher-low (1), next-hour-after-worst (1), nth-signal-of-day (1), oco-pending (1), oco-stop-entries (1), oi-delta-diverge (1), oi-down-delta-flip (1), oi-stabilize-funding-lower (1), okx-oi-lead (1), one-minute-sigma-bar (1), open-burst-reverse (1), origin-retest (1), pause-continuation (1), peg-deviation (1), pivot-touch-reject (1), poc-retest-hammer (1), poke-reclaim-delta-div (1), post-event-return (1), post-expiry-break (1), post-funding-return (1), post-hour-delta-turn (1), predicted-minus-current (1), prem-shock-lead (1), premium-fade (1), premium-open-spike (1), premium-persist (1), prior-high-break-volume (1), pullback-delta-turn (1), pullback-entry (1), quiet-pullback (1), quote-skewed-by-wall (1), random-entry (1), range-break (1), range-break-after-wait (1), range-break-failure (1), range-break-in-gamma (1), range-break-leveraged (1), range-break-volume (1), range-extreme-fade (1), rate-surge-no-progress (1), ratio-break (1), ratio-z-fade (1), reclaim-ma (1), retest-after-break (1), retrace-reject-candle (1), return-overreaction (1), revisit-two-rejects (1), round-wick-reclaim (1), rsi-divergence (1), same-side-run-length (1), scale-in-levels (1), score-at-least-four (1), second-absorption (1), session-low-confirm (1), sigma-burst (1), sigma-fall-fade (1), sigma-percentile-jump (1), sigma-return-clean-spread (1), sign-switch-trade (1), skew-shift (1), skew-spike (1), spike-fade (1), spot-leads-perp (1), spread-narrowing (1), stacked-imbalance (1), stop-recross (1), sunday-range-break (1), sweep-reclaim-prior (1), sweep-reclaim-session (1), taker-extreme-stall (1), taker-ratio-flip (1), ten-utc-join (1), thin-jump (1), third-wave (1), three-engine-set (1), three-sec-break (1), time-clock (1), touch-depletion (1), trade-size-surge (1), twenty-min-trend-join (1), two-close-acceptance (1), two-sided-quote (1), upthrust-absorption (1), venue-consensus (1), venue-local-liq (1), venue-silence-flow (1), venue-spread-z (1), void-direction-close (1), volume-climax-bar (1), vwap-bounce-delta (1), vwap-dev-rsi-extreme (1), vwap-limit (1), vwap-touch-delta (1), wall-consumed (1), wall-flicker (1), wall-pulled (1), wall-pulled-pre-open (1), wall-survives-touches (1), wall-touch (1), wallet-flip (1), wallet-liquidation (1), wallets-add-dip (1), weak-burst-fade (1), weekly-close-above-mean (1), weekly-high-break (1), weekly-pin-bar (1), wick-ratio-bar (1), wick-reject (1), wick-vs-index (1), zone-entry-thin-volume (1)

New in round two for trigger (236): 20d-high-break, 30d-high, 4h-break, 4h-high-break, 55d-high-break, absorption-staged, absorption-then-burst, against-paying-side, approach-speed, avwap-pullback, band-break-delta, band-outside-reverse, bar-close-clock, basis-spike, basis-threshold, basis-turns-negative, below-vwap-after-extreme, beta-lag, big-move-fade, block-print, bound-break-follow, bound-reach-fade, breadth-peak, break-after-oi-build, break-reentry, break-then-reentry, break-then-reverse, break-volume, break-with-delta, break-with-oi-rise, burst-dip-20s, burst-echo, burst-hits-wall, burst-retrace-entry, buy-once, bybit-liq-first, calendar-date, clean-burst, clock-boundary-long, close-imbalance-join, cluster-approach, consolidation-toward-cluster, contract-spread, corr-recovery, corridor-edge-fade, cvd-break-first, cvd-divergence, cvd-level-retest, cvd-zero-cross, daily-close-near-extreme, daily-lower-high, daily-open-reclaim, daily-streak, day-end-distance-fade, delta-flip-at-level, delta-poc-retest, depth-collapse, depth-recovery, distance-from-close, distance-limit-entry, distance-with-delta, donchian-40, dual-asset-trend, dvol-jump, episode-resume, equal-highs-wick-reclaim, fade-from-strike, fading-flip, failed-bounce, fall-with-delta-divergence, false-break-4h, family-consensus, first-15m-return, first-aggressors-after-quiet, first-higher-hourly-high, first-lower-hourly-low, first-touch-venue, first-trade-after-pull, five-sec-break, flip-retest, flow-z-extreme-fall, friday-night-buy, funding-side-flat-price, funding-sign-disagree, funding-spread-open, grid-fill, grind-pullback, herd-spike, high-break, high-break-oi-rise, high-break-slow-refill, high-close-after-flip, higher-low, higher-low-add, hl-imbalance-lead, hour-high-break-delta, hundred-touch-stall, hvn-entry-slowdown, ib-break-delta, iceberg-detect, ignition-fade, imbalance-no-follow, iv-rise-vs-rv, laggard-catchup, last-mark-gap, level-bounce-bar, level-buy-average-down, level-retest-reclaimed, liq-fill-follow, liq-rate-decay, liq-side-ratio, london-break-follow, low-volume-spring, lower-high, lower-high-basis, lunch-break-fade, lvn-entry-accel, ma-cross, majors-lead, maker-on-imbalance, microprice-skew, momentum-toward-liq, monday-confirm-bar, monday-fade, neckline-break, negative-funding-time, next-day-higher-low, next-hour-after-worst, nth-signal-of-day, oco-pending, oco-stop-entries, oi-delta-diverge, oi-down-delta-flip, oi-stabilize-funding-lower, okx-oi-lead, one-minute-sigma-bar, open-burst-reverse, origin-retest, pause-continuation, peg-deviation, pivot-touch-reject, poc-retest-hammer, poke-reclaim-delta-div, post-event-return, post-expiry-break, post-funding-return, post-hour-delta-turn, predicted-minus-current, prem-shock-lead, premium-fade, premium-open-spike, premium-persist, prior-high-break, prior-high-break-volume, pullback-delta-turn, pullback-entry, quiet-pullback, quote-skewed-by-wall, random-entry, range-break, range-break-after-wait, range-break-failure, range-break-in-gamma, range-break-leveraged, range-break-volume, range-extreme-fade, rate-surge-no-progress, ratio-break, ratio-z-fade, reclaim-ma, retest-after-break, retrace-reject-candle, return-overreaction, revisit-two-rejects, round-wick-reclaim, rsi-divergence, same-side-run-length, scale-in-levels, score-at-least-four, second-absorption, session-low-confirm, sigma-burst, sigma-fall-fade, sigma-percentile-jump, sigma-return-clean-spread, sign-switch-trade, skew-shift, skew-spike, spike-fade, spot-leads-perp, spread-narrowing, stacked-imbalance, stop-recross, sunday-range-break, sweep-reclaim-prior, sweep-reclaim-session, taker-extreme-stall, taker-ratio-flip, ten-utc-join, thin-jump, third-wave, three-engine-set, three-sec-break, touch-depletion, trade-size-surge, twenty-min-trend-join, two-close-acceptance, two-sided-quote, upthrust-absorption, venue-consensus, venue-local-liq, venue-silence-flow, venue-spread-z, void-direction-close, volume-climax-bar, vwap-bounce-delta, vwap-dev-rsi-extreme, vwap-limit, vwap-touch-delta, wall-consumed, wall-flicker, wall-pulled, wall-pulled-pre-open, wall-survives-touches, wall-touch, wallet-flip, wallet-liquidation, wallets-add-dip, weak-burst-fade, weekly-close-above-mean, weekly-high-break, weekly-pin-bar, wick-ratio-bar, wick-reject, wick-vs-index, zone-entry-thin-volume

**thesis** (227 distinct): trend-persist (10), continuation (4), crowd-cleared (2), crowding-unwind (2), forced-flow-ends (2), gap-fill (2), level-defense (2), liquidity-grab (2), mean-revert (2), micro-momentum (2), spoof-reveal (2), spread-capture (2), trend-clustering (2), activity-without-progress (1), aggression-exhausted (1), aggression-persists (1), aggressor-concentration-defend (1), aggressor-spent (1), aggressor-switch (1), altseason-peak (1), autocorr-regime (1), avoid-noise (1), bar-continuation (1), bar-open-trap (1), beta-follow (1), beta-propagation (1), block-impact-continues (1), breadth-pull (1), breakdown-transient (1), breakout-absorbed (1), breakout-retest (1), burst-dip-bought (1), burst-stalls-at-wall (1), candle-close-chase (1), capitulation-blowoff (1), capitulation-end (1), carry-collection (1), cascade-propagation (1), cascade-waves (1), checklist-assumptions (1), commitment-confirm (1), committed-aggressor-defense (1), compression-release (1), compression-resolve (1), conjunction-of-weak-signs (1), contract-converge (1), control-flip (1), corridor-persists (1), covering-ends (1), covering-rally (1), crowd-spent (1), cvd-leads-price (1), day-end-revert (1), dealer-hedge-amplify (1), dealer-hedge-dampen (1), defense-persists (1), discount-in-dominant-flow (1), dislocation-close (1), distribution-pattern (1), divergence-reversal (1), divergent-fall-reverts (1), dynamic-support (1), edge-clusters-in-time (1), equal-highs-stop-run (1), expiry-pinning (1), failed-break-fuel (1), fair-value-hold (1), fair-value-reject (1), false-stop-recover (1), fear-peak (1), filter-only (1), flow-mean-reverts (1), forced-flow-continues (1), fragile-leverage (1), free-run (1), fresh-positions-follow (1), funding-arbitraged-away (1), funding-avoidance-trim (1), funding-differential (1), funding-erosion (1), funding-income (1), funding-pressure-leads (1), half-life-bounded (1), half-life-revert (1), healthy-pullback (1), hedge-unwind (1), hidden-large-order (1), hidden-passive-order (1), hl-informed (1), hourly-open-support (1), hourly-overreaction (1), ib-extension (1), ignition-exit (1), imbalance-trap (1), implied-range-revert (1), independent-evidence (1), informed-dip-buy (1), informed-follow (1), informed-options-flow (1), institutional-overshoot (1), institutions-return (1), inventory-panic-reversion (1), judas-fake (1), jump-not-drift (1), last-to-mark-revert (1), level-magnet (1), leverage-compression (1), leverage-washed (1), liq-attraction (1), liquidity-target (1), liquidity-withdrawal-precedes-move (1), local-forced-flow (1), low-participation-revert (1), makers-know (1), makers-return (1), mark-the-close (1), micro-momentum-above-fee (1), mispriced-funding (1), momentum-versus-resting (1), more-evidence-better (1), next-tick-prediction (1), no-supply-shakeout (1), none-baseline (1), oi-confirmed-trend (1), open-overreaction (1), options-flow-informed (1), order-clustering (1), origin-base (1), overreaction-revert (1), overshoot-recovery (1), oversold-revert (1), pair-revert (1), panic-bottom (1), parabolic-end (1), participation-lacking (1), passive-exhausted (1), passive-turns-aggressor (1), pause-not-end (1), persistent-conversion (1), persistent-participant (1), persistent-regime (1), pin-release (1), pivot-revert (1), positions-built-resolve (1), premium-revert (1), pullback-end (1), queued-orders-release (1), quiet-breaks-direction (1), quiet-precedes-move (1), range-day-persist (1), range-expansion (1), range-holds (1), real-not-local (1), rebalancing-flow (1), redemption-risk-off (1), reference-level-hold (1), regime-change (1), regime-persist (1), relief-after-forced (1), remembered-fair-value (1), reopen-flow (1), residual-pressure (1), retail-herding (1), retail-spike-mean-revert (1), role-reversal (1), rotation (1), run-absorbed (1), seasonal-drift (1), second-move-stable (1), secular-drift (1), session-bounce (1), session-flow-follow (1), shelf-defense (1), short-squeeze (1), signal-order-matters (1), slow-digestion (1), spot-leads (1), spot-perp-converge (1), squeeze-direction (1), stealth-accumulation (1), stop-cluster-run (1), stop-hunt-magnet (1), streak-exhaustion (1), structure-repair-fail (1), supply-exhausted (1), supply-shock-lag (1), support-holds (1), taker-informed (1), thin-jump-reverts (1), thin-node-traverse (1), thin-overshoot (1), thin-recovery-extends (1), thin-touch-breaks (1), thin-zone-traverse (1), timeframe-alignment (1), trapped-breakout (1), trapped-cost-defense (1), trapped-shorts (1), trend-day-extends (1), trend-day-persist (1), uncorrelated-errors (1), underwater-positions-exit (1), us-leads (1), us-spot-leads (1), value-migration (1), value-revert (1), value-rotation (1), venue-lead (1), venue-leading-positioning (1), venue-spread-revert (1), void-traverse (1), vol-expansion (1), vol-risk-premium (1), vol-scaled-momentum (1), vol-transient (1), vol-underpriced (1), volume-node-friction (1), vwap-attracts (1), wall-defended-real (1), wall-defends (1), wall-protects-inventory (1), weak-burst-fails (1), weekend-drift (1), weekly-direction-early (1), weekly-rejection (1), weekly-rotation (1), withdrawal-before-vol (1)

New in round two for thesis (222): activity-without-progress, aggression-exhausted, aggression-persists, aggressor-concentration-defend, aggressor-spent, aggressor-switch, altseason-peak, autocorr-regime, avoid-noise, bar-continuation, bar-open-trap, beta-follow, beta-propagation, block-impact-continues, breadth-pull, breakdown-transient, breakout-absorbed, breakout-retest, burst-dip-bought, burst-stalls-at-wall, candle-close-chase, capitulation-blowoff, capitulation-end, carry-collection, cascade-propagation, cascade-waves, checklist-assumptions, commitment-confirm, committed-aggressor-defense, compression-release, compression-resolve, conjunction-of-weak-signs, contract-converge, control-flip, corridor-persists, covering-ends, covering-rally, crowd-cleared, crowd-spent, cvd-leads-price, day-end-revert, dealer-hedge-amplify, dealer-hedge-dampen, defense-persists, discount-in-dominant-flow, dislocation-close, distribution-pattern, divergence-reversal, divergent-fall-reverts, dynamic-support, edge-clusters-in-time, equal-highs-stop-run, expiry-pinning, failed-break-fuel, fair-value-hold, fair-value-reject, false-stop-recover, fear-peak, filter-only, flow-mean-reverts, forced-flow-continues, fragile-leverage, free-run, fresh-positions-follow, funding-arbitraged-away, funding-avoidance-trim, funding-differential, funding-erosion, funding-income, funding-pressure-leads, gap-fill, half-life-bounded, half-life-revert, healthy-pullback, hedge-unwind, hidden-large-order, hidden-passive-order, hl-informed, hourly-open-support, hourly-overreaction, ib-extension, ignition-exit, imbalance-trap, implied-range-revert, independent-evidence, informed-dip-buy, informed-follow, informed-options-flow, institutional-overshoot, institutions-return, inventory-panic-reversion, judas-fake, jump-not-drift, last-to-mark-revert, level-defense, level-magnet, leverage-compression, leverage-washed, liq-attraction, liquidity-target, liquidity-withdrawal-precedes-move, local-forced-flow, low-participation-revert, makers-know, makers-return, mark-the-close, micro-momentum, micro-momentum-above-fee, mispriced-funding, momentum-versus-resting, more-evidence-better, next-tick-prediction, no-supply-shakeout, none-baseline, oi-confirmed-trend, open-overreaction, options-flow-informed, order-clustering, origin-base, overreaction-revert, overshoot-recovery, oversold-revert, pair-revert, panic-bottom, parabolic-end, participation-lacking, passive-exhausted, passive-turns-aggressor, pause-not-end, persistent-conversion, persistent-participant, persistent-regime, pin-release, pivot-revert, positions-built-resolve, premium-revert, pullback-end, queued-orders-release, quiet-breaks-direction, quiet-precedes-move, range-day-persist, range-expansion, range-holds, real-not-local, rebalancing-flow, redemption-risk-off, reference-level-hold, regime-change, regime-persist, relief-after-forced, remembered-fair-value, reopen-flow, residual-pressure, retail-herding, retail-spike-mean-revert, role-reversal, rotation, run-absorbed, seasonal-drift, second-move-stable, secular-drift, session-bounce, session-flow-follow, shelf-defense, short-squeeze, signal-order-matters, slow-digestion, spoof-reveal, spot-leads, spot-perp-converge, spread-capture, squeeze-direction, stealth-accumulation, stop-cluster-run, stop-hunt-magnet, streak-exhaustion, structure-repair-fail, supply-exhausted, supply-shock-lag, support-holds, taker-informed, thin-jump-reverts, thin-node-traverse, thin-overshoot, thin-recovery-extends, thin-touch-breaks, thin-zone-traverse, timeframe-alignment, trapped-breakout, trapped-cost-defense, trapped-shorts, trend-clustering, trend-day-extends, trend-day-persist, trend-persist, uncorrelated-errors, underwater-positions-exit, us-leads, us-spot-leads, value-migration, value-revert, value-rotation, venue-lead, venue-leading-positioning, venue-spread-revert, void-traverse, vol-expansion, vol-risk-premium, vol-scaled-momentum, vol-transient, vol-underpriced, volume-node-friction, vwap-attracts, wall-defended-real, wall-defends, wall-protects-inventory, weak-burst-fails, weekend-drift, weekly-direction-early, weekly-rejection, weekly-rotation, withdrawal-before-vol

**exit** (103 distinct): time-stop (42), target (19), indicator-normalize (16), clock-exit (13), trailing (12), retracement-target (9), level-touch (8), episode-end (6), range-multiple (5), opposing-wall (4), calendar-exit (3), ma-cross-exit (3), midpoint-target (3), range-middle (3), session-high-target (3), spread-close (3), vol-contraction-exit (3), vwap-target (3), burst-end-target (2), catch-up-exit (2), chandelier-stop-only (2), day-end (2), flow-reversal (2), give-back-rule (2), pre-cluster-exit (2), basis-converge (1), basis-normalize (1), breakeven-plus (1), channel-exit (1), day-end-exit (1), delta-flip (1), depth-recovery-exit (1), depth-restored (1), disaster-stop-only (1), flow-decay (1), flow-scaled-out (1), funding-payment-exit (1), gap-close (1), grid-step (1), group-end (1), half-life-time-stop (1), hedge-instead-of-stop (1), ib-multiple (1), imbalance-level-fail (1), indicator-cross-back (1), inventory-flatten (1), liq-spike-exit (1), mae-percentile-cap (1), mean-target (1), measured-move (1), midpoint-then-trail (1), next-hvn (1), next-session-open (1), no-demand-exit (1), node-edge (1), oi-fall-exit (1), oi-rebuild-exit (1), oi-turn (1), original-entry-level (1), peg-restored (1), per-engine (1), pin-midpoint (1), poc-target (1), poc-target-partial (1), post-expiry-exit (1), post-only-exit (1), post-reset-exit (1), pre-open-mean (1), pre-shock-mid (1), prior-week-extreme (1), projection-target (1), quote-pull (1), range-low-target (1), range-middle-edge (1), range-opposite-edge (1), ratio-cross-back (1), refill-stops (1), regime-flip-exit (1), resume-plus-delay (1), retrace-target (1), score-decay (1), sigma-beyond-level (1), sigma-target (1), size-normalization (1), stop-and-reverse (1), structure-ratchet (1), swing-stop (1), take-profit-reenter (1), thesis-decay-score (1), thesis-expiry-clock (1), tick-exit (1), time-or-target (1), trail-sigma (1), two-leg-breakeven (1), vol-expansion-exit (1), vol-stall-exit (1), wall-end (1), wall-shrink-exit (1), wallet-flip-back (1), wallet-reduce-exit (1), weekly-ma-exit (1), weekly-trail (1), zone-far-edge (1)

New in round two for exit (99): basis-converge, basis-normalize, breakeven-plus, burst-end-target, calendar-exit, catch-up-exit, chandelier-stop-only, channel-exit, clock-exit, day-end, day-end-exit, delta-flip, depth-recovery-exit, depth-restored, disaster-stop-only, episode-end, flow-decay, flow-scaled-out, funding-payment-exit, gap-close, give-back-rule, grid-step, group-end, half-life-time-stop, hedge-instead-of-stop, ib-multiple, imbalance-level-fail, indicator-cross-back, indicator-normalize, inventory-flatten, level-touch, liq-spike-exit, ma-cross-exit, mae-percentile-cap, mean-target, measured-move, midpoint-target, midpoint-then-trail, next-hvn, next-session-open, no-demand-exit, node-edge, oi-fall-exit, oi-rebuild-exit, oi-turn, opposing-wall, original-entry-level, peg-restored, per-engine, pin-midpoint, poc-target, poc-target-partial, post-expiry-exit, post-only-exit, post-reset-exit, pre-cluster-exit, pre-open-mean, pre-shock-mid, prior-week-extreme, projection-target, quote-pull, range-low-target, range-middle, range-middle-edge, range-multiple, range-opposite-edge, ratio-cross-back, refill-stops, regime-flip-exit, resume-plus-delay, retrace-target, retracement-target, score-decay, session-high-target, sigma-beyond-level, sigma-target, size-normalization, spread-close, stop-and-reverse, structure-ratchet, swing-stop, take-profit-reenter, thesis-decay-score, thesis-expiry-clock, tick-exit, time-or-target, trail-sigma, two-leg-breakeven, vol-contraction-exit, vol-expansion-exit, vol-stall-exit, vwap-target, wall-end, wall-shrink-exit, wallet-flip-back, wallet-reduce-exit, weekly-ma-exit, weekly-trail, zone-far-edge

**risk** (59 distinct): fixed-r (113), structure-stop (52), fixed-notional (5), pair-spread (4), sigma-multiple-stop (4), wide-fixed-stop (4), signal-scaled-size (3), wall-anchored-stop (3), implied-move-stop (2), inventory-limit (2), level-risk-cap (2), matched-notional (2), one-trade-per-day (2), quarter-kelly (2), small-fixed-stop (2), trade-rate-cap (2), try-limit-rest (2), unlevered (2), vol-target-daily (2), adaptive-cooldown (1), anti-martingale (1), atr-parity (1), capped-martingale (1), conviction-scaled (1), cooldown-capped (1), daily-quit-rule (1), disaster-stop-only (1), drawdown-scaled (1), drawdown-shutdown (1), equity-curve-filter (1), gap-day-size-cut (1), half-size-rebound (1), halved-in-thin (1), hedge-on-stop (1), hedged-margin-buffer (1), hedged-pair (1), high-lever-tiny-stop (1), high-leverage-micro-stop (1), inventory-cap-grid (1), inventory-skew (1), limit-only (1), loss-streak-shutdown (1), mae-derived-stop (1), portfolio-budget (1), posterior-sized (1), pyramid-confirm (1), pyramid-trend (1), ruin-targeted (1), scale-in-thirds (1), sigma-leverage-ladder (1), sigma-rank-size (1), sqrt-time-stop (1), staged-entry (1), streak-pause (1), tick-stop-lever (1), time-varying-leverage (1), trend-risk-cap (1), vol-target-size (1), weekly-single-shot (1)

New in round two for risk (58): adaptive-cooldown, anti-martingale, atr-parity, capped-martingale, conviction-scaled, cooldown-capped, daily-quit-rule, disaster-stop-only, drawdown-scaled, drawdown-shutdown, equity-curve-filter, fixed-notional, gap-day-size-cut, half-size-rebound, halved-in-thin, hedge-on-stop, hedged-margin-buffer, hedged-pair, high-lever-tiny-stop, high-leverage-micro-stop, implied-move-stop, inventory-cap-grid, inventory-limit, inventory-skew, level-risk-cap, limit-only, loss-streak-shutdown, mae-derived-stop, matched-notional, one-trade-per-day, pair-spread, portfolio-budget, posterior-sized, pyramid-confirm, pyramid-trend, quarter-kelly, ruin-targeted, scale-in-thirds, sigma-leverage-ladder, sigma-multiple-stop, sigma-rank-size, signal-scaled-size, small-fixed-stop, sqrt-time-stop, staged-entry, streak-pause, structure-stop, tick-stop-lever, time-varying-leverage, trade-rate-cap, trend-risk-cap, try-limit-rest, unlevered, vol-target-daily, vol-target-size, wall-anchored-stop, weekly-single-shot, wide-fixed-stop

**eval** (107 distinct): ablation (18), latency-stress (16), monotonic-bucket-test (11), level-shift-placebo (9), small-sample-exploratory (8), matched-control (7), regime-split (7), fee-stress (6), shuffled-time (6), sign-test-days (6), event-study-random-dip (5), placebo-time (5), calibration-by-score (4), cross-asset-oos (4), walk-forward (4), adverse-selection-check (3), bootstrap-ci (3), definition-sensitivity (3), pair-vs-single (3), paired-mirror (3), pooled-two-assets (3), rare-event-study (3), weekly-walk-forward (3), window-permutation (3), anecdotal-pooled (2), chase-vs-pullback (2), equity-curve-compare (2), event-study-distance (2), exit-rule-compare (2), fill-realism (2), filter-isolation (2), first-vs-second (2), four-quadrant-table (2), funding-inclusive (2), hour-of-day-split (2), label-precision-wilson (2), leg-attribution (2), multi-asset-oos (2), placebo-level (2), pulled-vs-traded-control (2), realized-vs-predicted (2), scoreboard-families (2), sequence-study (2), shuffled-series (2), sizing-ablation (2), stop-rule-compare (2), wave-count-study (2), whipsaw-rate (2), anchor-ablation (1), bayes-fill-rate (1), bayesian-posterior (1), benchmark-itself (1), both-venue-contrast (1), calibration-coverage (1), calmar-compare (1), cap-ablation (1), carry-vs-riskfree (1), conditional-vs-unconditional (1), confirmed-vs-unconfirmed (1), cost-null (1), cycle-statistics (1), day-of-week-split (1), deflated-sharpe (1), drawdown-adjusted (1), entry-compare (1), equal-avg-leverage-compare (1), event-study-hedged (1), fade-vs-follow (1), fee-breakeven (1), few-cycles-narrative (1), filter-permutation (1), first-vs-resume (1), gap-day-drawdown (1), group-contrast (1), holiday-control (1), inventory-at-stop (1), kelly-estimation-bootstrap (1), label-permutation (1), lead-lag-correlation (1), leave-one-out (1), mae-distribution (1), mirror-test (1), month-sign-stability (1), monthly-kill-rule (1), neutral-day-control (1), out-of-sample-year (1), paired-entry-comparison (1), parameter-stability (1), pattern-placebo (1), per-leg-attribution (1), permutation-times (1), quality-buckets (1), random-day-baseline (1), ruin-probability (1), sequential-sprt (1), session-split (1), sign-test-sessions (1), slippage-stress (1), stop-cost-compare (1), streak-buckets (1), subperiod-sharpe (1), tail-ratio (1), volume-contrast (1), vs-price-trendline (1), vs-random-entry (1), vs-volume-poc (1), weekday-weekend-split (1)

New in round two for eval (104): adverse-selection-check, anchor-ablation, anecdotal-pooled, bayes-fill-rate, bayesian-posterior, benchmark-itself, bootstrap-ci, both-venue-contrast, calibration-by-score, calibration-coverage, calmar-compare, cap-ablation, carry-vs-riskfree, chase-vs-pullback, conditional-vs-unconditional, confirmed-vs-unconfirmed, cost-null, cross-asset-oos, cycle-statistics, day-of-week-split, definition-sensitivity, deflated-sharpe, drawdown-adjusted, entry-compare, equal-avg-leverage-compare, equity-curve-compare, event-study-distance, event-study-hedged, event-study-random-dip, exit-rule-compare, fade-vs-follow, fee-breakeven, fee-stress, few-cycles-narrative, fill-realism, filter-isolation, filter-permutation, first-vs-resume, first-vs-second, four-quadrant-table, funding-inclusive, gap-day-drawdown, group-contrast, holiday-control, hour-of-day-split, inventory-at-stop, kelly-estimation-bootstrap, label-permutation, label-precision-wilson, latency-stress, lead-lag-correlation, leave-one-out, leg-attribution, level-shift-placebo, mae-distribution, matched-control, mirror-test, monotonic-bucket-test, month-sign-stability, monthly-kill-rule, multi-asset-oos, neutral-day-control, out-of-sample-year, pair-vs-single, paired-entry-comparison, paired-mirror, parameter-stability, pattern-placebo, per-leg-attribution, permutation-times, placebo-level, placebo-time, pooled-two-assets, pulled-vs-traded-control, quality-buckets, random-day-baseline, rare-event-study, realized-vs-predicted, regime-split, ruin-probability, scoreboard-families, sequence-study, sequential-sprt, session-split, shuffled-series, sign-test-days, sign-test-sessions, sizing-ablation, slippage-stress, small-sample-exploratory, stop-cost-compare, stop-rule-compare, streak-buckets, subperiod-sharpe, tail-ratio, volume-contrast, vs-price-trendline, vs-volume-poc, walk-forward, wave-count-study, weekday-weekend-split, weekly-walk-forward, whipsaw-rate, window-permutation

