# Aggression burst: literature pass

Source status key. VERIFIED = fetched or returned by search this session. UNVERIFIED = from memory, not re-opened. LOWER TRUST = practitioner (none used).

## 1. What the Reader does now (evalBurst)
Gate: flow rate z >= `burstZ` (th), aggressor share >= `burstShare`, still happening in the latest quarter-window. Scored: price moved with the aggressor >= `burstSigma`; liquidations >= `burstLiq` (2); multi-level sweeps >= `burstSweeps` (3); far side of the book thinned; broke the 5-minute extreme; other venue z >= `crossZ` (2). Flow z uses a robust yardstick (max of MAD, 10% of median, 10% of other side's median), capped at 50.

## 2. Definition in the literature
- Clustering and self-excitation of trades: Hawkes processes. Survey: Bacry, Mastromatteo, Muzy, "Hawkes processes in finance", arXiv:1502.04592 (https://arxiv.org/abs/1502.04592), VERIFIED (listing/abstract). A burst is then a period where the conditional intensity is well above baseline, and the branching ratio (share of trades triggered by earlier trades) measures how endogenous it is. Hardiman, Bercot, Bouchaud "Critical reflexivity in financial markets" reports branching ratios near 1 for futures: UNVERIFIED (a search did not return it; do not cite numbers).
- Flow persistence (Lillo and Farmer 2004; Bouchaud et al. 2009): UNVERIFIED this session.
- Flow toxicity (VPIN): Easley, Lopez de Prado, O'Hara, "Flow toxicity and liquidity in a high-frequency world", Review of Financial Studies 2012: not re-opened (UNVERIFIED). Critique: Andersen and Bondarenko, "VPIN and the Flash Crash: A Comment", Journal of Financial Markets 17, 2014 (https://papers.ssrn.com/abstract=2062450); VERIFIED via search summary: VPIN is a weak predictor of short-run volatility, did not peak before the flash crash, and its predictive content comes mainly from its mechanical relation with trading intensity; it depends on how trades are bucketed. The original authors replied ("VPIN and the Flash Crash: A rejoinder"), contesting the critique. CONTESTED. Relevance: a z-score on taker flow is largely a trading-intensity measure; do not read it as information content.
- Linear impact (Cont, Kukanov, Stoikov, arXiv:1011.6402, https://arxiv.org/abs/1011.6402, VERIFIED abstract): price change tracks order flow imbalance, with slope ~ 1/depth. So a burst that moves price may be a thin book, not a large flow; `thin` and `move` items matter.

I found no source defining a threshold for "burst". All Reader thresholds are internal.

## 3. Variables used
Hawkes: baseline intensity mu, excitation kernel, branching ratio. Impact: signed flow and depth. Practitioner variants use trades per second or notional per second over a rolling mean plus k standard deviations (LOWER TRUST, not cited).

## 4. Failure modes and reliability
- Intensity of trading has strong intraday seasonality and volatility clustering; a z against a session-wide baseline fires at scheduled times (macro releases, funding times, open of other markets). Whether the engine's baseline is time-of-day adjusted was not checked for this note. UNVERIFIED either way.
- Binance aggTrade merges same-price, same-side trades in the stream interval, so counts understate fills and `minTrades` thresholds count aggregates. Hyperliquid trades arrive per block, so timing is quantised by block time (not verified here).
- Liquidation counts are a LOWER BOUND on Binance: the forceOrder stream pushes only the latest liquidation order per symbol within each 1000 ms window, and nothing if none (VERIFIED, https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Liquidation-Order-Streams, via search summary). Thus `burstLiq >= 2` counts one per second at most; a heavy cascade is capped at about 1 count per second per symbol.
- Hyperliquid fills carry an optional `liquidation` object (liquidatedUser, markPx, method market or backstop), but only through userFills for a given address (VERIFIED, subscriptions page). The engine's liquidation counts for Hyperliquid presumably come from followed wallets only; coverage is partial.
- Sweep counts depend on how the engine segments a single taker order across levels; not validated here.

## 5. Checkable definition without labels
Burst = intensity excursion beyond what a self-exciting model with seasonal baseline predicts.
1. Fit per venue and side a Hawkes model (or simpler: compare Fano factor of 1 s counts in sliding 15 s windows vs a Poisson with the seasonal baseline). A burst window is one where the count exceeds the Poisson 99.9% bound.
2. Compare the Reader's burst episodes to those windows: precision (episodes inside excursions) and recall (excursions with an episode). Differences show where z and gating disagree.
3. Forward test: forward move 0-60 s in sigma, signed, for burst windows with and without price response at detection (`move` item), against matched controls. Expect continuation or reversal to differ; report both without assuming direction.
4. Cross-venue lead-lag: which venue's intensity rises first; test with circular shift for significance.

## 6. Candidate variables
| Variable | Tag |
|---|---|
| Hawkes branching ratio (endogeneity) of the burst as an evidence item | DOABLE TODAY |
| Seasonal (time-of-day) baseline for flow rate | DOABLE TODAY (needs multiple sessions) |
| Depth removed from the far side during the burst (book summaries) | DOABLE TODAY |
| Event clock: scheduled releases and funding times as a prior | DOABLE TODAY (collector calendar tags) |
| Open interest change after the burst (new vs forced positions) | DOABLE TODAY (collector derivatives context; cadence limited) |
| Followed wallets' fills inside the burst (Hyperliquid) | DOABLE TODAY |
| Trade-level liquidation size inside the burst | NEEDS NEW DATA |
| Full-resolution Binance liquidation feed (not 1 per second snapshot) | NEEDS NEW DATA (not available in the public stream per docs) |

## 7. Wishlist
- Per-trade liquidation flags and sizes on both venues.
- Order-by-order book for exact sweep depth and who was consumed.
- More symbols for cross-sectional bursts (common market-wide bursts vs symbol-specific).
