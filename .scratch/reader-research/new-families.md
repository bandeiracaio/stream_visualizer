# Candidate new families: what our data could support

Source status key. VERIFIED = fetched or returned by search this session. UNVERIFIED = from memory, not re-opened. LOWER TRUST = practitioner (none used).

Neutral wording throughout: aggressor side, passive side. A family needs a label-free definition (section "test") before any code.

## A. Iceberg / hidden liquidity
- Literature: Frey and Sandas, "The Impact of Iceberg Orders in Limit Order Books", Quarterly Journal of Finance 7(3), 2017 (CFR WP 09-06: https://www.cfr-cologne.de/download/workingpaper/cfr-09-06.pdf). VERIFIED (search summary of abstract; full text not read): icebergs let traders advertise intent while limiting expected price impact; limit orders earn a profit in books without icebergs but a loss in books with them. De Winne and D'Hondt, "Hide-and-Seek in the Market: Placing and Detecting Hidden Orders", Review of Finance 11(4), 2007: bibliographic details confirmed, methods NOT read. One citing paper attributes 27.2% (CAC40) and 20.4% (BEL20) hidden liquidity shares to De Winne and D'Hondt: SECONDHAND, UNVERIFIED.
- Detection idea (general, the specific rule is UNVERIFIED against the papers): at a price, executed volume exceeds the displayed size before the trades, or the displayed size is replenished to the same value after each fill, repeatedly.
- Our data: trades with side and price, depth at 250 ms (Binance 30 levels / Hyperliquid 20), book summaries. Refill after a trade at the touch is observable at 250 ms resolution; with block-quantised Hyperliquid pushes (at least 0.5 s apart, VERIFIED) it is coarser. Whether Binance USD-M offers a native iceberg order type: not verified; do not assume the same mechanism as equity venues. Algorithmic slicing (TWAP-like) by one wallet is visible on Hyperliquid because trades carry `users: [buyer, seller]` (VERIFIED, https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions).
- Failure modes: refill by different participants looks identical to an iceberg in an anonymous book on Binance; 250 ms snapshots net several events.
- Test without labels: count cases where cumulative taker volume at a price in a short window exceeds the best displayed size at the start plus observed adds; compare against a shuffled-depth null. Hyperliquid check: the same wallet on the passive side across the refills.
- Verdict: PARTLY DOABLE TODAY (a "repeated refill at a level" proxy exists in the absorption `level` item; a strict iceberg claim needs order ids). Strict identification NEEDS NEW DATA (order-by-order, queue position).

## B. Spoofing / layering (pattern only)
- Literature: Cartea, Jaimungal, Wang, Applied Mathematical Finance 27(1-2), 2020 (https://ideas.repec.org/a/taf/apmtfi/v27y2020i1-2p67-98.html), VERIFIED listing; Tao, Day, Ling, Drapeau, arXiv:2009.14818 (https://arxiv.org/abs/2009.14818), VERIFIED abstract (imbalance model, Wasserstein monitoring, TMX level 2). Intent is not observable; regulators' definition rests on it (statute not opened, UNVERIFIED).
- Pattern: large size added on one side, price moves toward it, opposite-side execution, large size cancelled without trading. Needs per-order cancellation timing.
- Our data: only level sizes at 250 ms (Binance) or per block (Hyperliquid); no order ids. A "large size appears and disappears untouched within N seconds near the touch" pattern is observable, and it is the wall `left` outcome with low `tradedFrac` today.
- Failure modes: most pulls are legitimate (market makers repricing); a pull rate is a base rate, not evidence of misconduct. No false-positive rate for any detector found. UNSUPPORTED.
- Test: report the pulled-before-touch share by distance and size, against a shuffled null; do not label individual episodes.
- Verdict: pattern proxy DOABLE TODAY inside the wall family (a subtype, not a new family). Genuine layering detection NEEDS NEW DATA (order-by-order with cancel times; multiple levels by one participant).

## C. Sweeps
- Literature: no academic definition of a "sweep" on a single-book crypto venue was found. The regulatory notion of intermarket sweep orders is an equity-market-structure term and does not transfer. Definition used by the engine (sweep summaries) is internal.
- Objective definition: one taker order that consumes liquidity across at least k price levels. On Binance, an aggTrade merges fills of the same price and taker side in one stream interval and carries first/last trade ids (VERIFIED via search summary of the aggTrade page; field meanings not read directly), so a multi-level sweep appears as several aggTrades at successive prices with near-equal timestamps. Check against the depth snapshot before and after: levels removed equals the sum of traded size.
- Test without labels: compare detected sweep counts with levels-removed computed from the 250 ms depth and trades; mismatch rate shows what the summary misses.
- Verdict: DOABLE TODAY; already an item in burst (`sweeps`). A standalone family would need a definition of size scaled to local depth (sweep as a share of depth within X bps).

## D. Liquidation cascades
- Exchange facts. Binance USD-M forceOrder stream: for each symbol only the latest liquidation order within 1000 ms is pushed as a snapshot; no push when there is none (VERIFIED via search summary of https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Liquidation-Order-Streams; the page was not read directly because the fetch returned a landing page). So Binance counts are a lower bound and size is partial.
- Hyperliquid: liquidations first attempt a full close by market orders into the book; positions above 100k USDC send only 20% as a market liquidation order, then a 30 s cooldown per user in which market orders cover the whole position; below 2/3 of maintenance margin a backstop liquidation goes through the liquidator vault; liquidations use a mark price that combines external CEX prices with Hyperliquid's book state (VERIFIED, https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations; secondary sources conflicted on details and were ignored). Fills carry an optional `liquidation` field with liquidatedUser, markPx and method (VERIFIED, subscriptions page) but only in userFills for an address, so our followed wallets only.
- Theory: loss spirals and forced selling feeding back (Brunnermeier and Pedersen, "Market liquidity and funding liquidity", RFS 2009): UNVERIFIED this session. I found no peer-reviewed measurement of crypto perpetual cascade dynamics that I could verify; treat practitioner dashboards as LOWER TRUST and unused.
- Testable structure: Hyperliquid partial liquidations should recur about every 30 s per large position; Binance and Hyperliquid forced flow on the same side should coincide with open interest falling.
- Objective cascade definition: within a window, forced-flow count (Binance snapshots plus followed-wallet liquidation fills) above a high quantile of its own history, same side, price move beyond k sigma in that direction, AND open interest down over the window (positions closed, not opened). The OI drop is the label-free confirmation. Open interest cadence in the collector limits this to minutes (check).
- Verdict: DOABLE TODAY at coarse resolution (count and side, lower bound; OI and funding from the collector; followed-wallet liquidation fills). Notional-weighted cascades NEED NEW DATA (trade-level liquidation size on Binance beyond the 1 s snapshot, full-market Hyperliquid liquidation feed).

## Wishlist (NEEDS NEW DATA)
- Order-by-order book with ids and cancel timestamps (icebergs, spoof patterns).
- Binance 100 ms depth diffs; deeper levels.
- Complete liquidation records with size on both venues.
- More symbols, to separate market-wide cascades from symbol-specific ones.
