# Wall: literature pass

Source status key. VERIFIED = fetched or returned by search this session. UNVERIFIED = from memory, not re-opened. LOWER TRUST = practitioner (none used).

## 1. What the Reader does now (wallItems, wallUpdate; the engine's wall tracker feeds it)
A wall is a resting level whose size is at least `wallRatio` (th) times the median level and (for opening an episode) `wallMinMult` (1.5) times that, at least `wallMinUsd` ($100k) at peak, stood for `wallEpisodeMs` (60 s) after birth, within `wallMaxActive` (2) per side and venue. Walls within `wallMergeBps` (6 bps) of an active one, or within `wallMergeMs` (90 s) of the last one ending nearby, merge. Items: size vs median, held `wallConfirmMs`, still >= `wallFadeFrac` (.6) of peak, refilled after being hit (`wallReposts` >= 2). Close reports `tradedFrac` (share of departed size that was traded through; the rest counts as pulled). Passive side only, no aggressor.

## 2. Definition in the literature
- There is no standard definition of a "wall". The literature that matters is about (a) displayed vs hidden liquidity and (b) manipulation by orders not meant to execute.
- Spoofing and layering: a model of an investor who places and cancels orders to move the book and sell at a better price: Cartea, Jaimungal, Wang, "Spoofing and price manipulation in order-driven markets", Applied Mathematical Finance 27(1-2), 2020 (https://ideas.repec.org/a/taf/apmtfi/v27y2020i1-2p67-98.html). VERIFIED (listing and summary; volume and pages as listed by IDEAS, another source gave different pagination: check the DOI 10.1080/1350486X.2020.1726783). The strategy exploits that price responds to volume imbalance (consistent with Cont, Kukanov, Stoikov, arXiv:1011.6402, VERIFIED abstract). In simulations the spoofer's selling raised the average price by about 52 cents over a five-minute program (Oxford preprint summary; model result, not market evidence).
- Detection: Tao, Day, Ling, Drapeau, "On Detecting Spoofing Strategies in High Frequency Trading", arXiv:2009.14818 (https://arxiv.org/abs/2009.14818). VERIFIED (abstract): a multilevel order-book imbalance model calibrated to TMX level 2 data, with monitoring based on the Wasserstein distance. It is a model-based monitoring proposal, not a validated classifier. Evidence of false positive rate: not found. UNSUPPORTED.
- Whether visible size predicts price direction: the order-book-imbalance literature (for example Cartea, Donnelly, Jaimungal, "Enhancing trading strategies with order book signals", Applied Mathematical Finance 2018) is UNVERIFIED this session. Cont et al. show depth sets the impact slope; they do not show that a resting large order protects a price.
- Legal definition of spoofing (bid or offer with the intent to cancel before execution) turns on intent, which no feed reveals. UNVERIFIED here (statute not opened). Practical consequence: from public data we can only detect "pulled before touched", never intent.

## 3. Variables and thresholds
No threshold in the sources. Variables the spoofing literature uses: multi-level volume imbalance, cancellation rate, order lifetime, distance from touch, opposite-side execution while the large order rests. The Reader's `wallRatio` (size over median level) and `wallMinUsd` are our own.

## 4. Failure modes and reliability
- A level that looks like a wall may be many orders; Hyperliquid l2Book gives `n`, the number of orders at a level (VERIFIED, https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions); Binance depth does not. A single order vs many orders changes how a wall should be read.
- Snapshots at 250 ms (Binance 30 levels) and one push per block at least 0.5 s apart (Hyperliquid, VERIFIED: "pushed on each block that is at least 0.5 since last push") cannot distinguish a cancel from an execution that happened between pushes except by matching against trades (the engine's `tradedFrac` does this). Hyperliquid also offers a `fast` option of 5 levels vs 20 (VERIFIED).
- A thin median level inflates the ratio; the Reader already added a dollar floor (v045). Median choice is not from literature.
- Walls move: a resting order that is re-posted one tick away (iceberg-like refill or a repricing algorithm) looks like a pull plus a new wall; the merge rule handles part of this.
- Reliability of wall detection as a predictor of price support or resistance: not found in sources; contested in practitioner circles. UNSUPPORTED.

## 5. Checkable definition without labels
Wall = persistent local excess of resting size. Test of whether the structure carries information, from data only:
1. Persistence null: the survival time of levels above the ratio threshold vs a null built from circularly shifted per-level sizes. If survival is no longer than the null, "walls" are noise.
2. Approach test: when mid comes within d bps of a wall, what fraction is (a) hit and held, (b) hit and consumed, (c) pulled before touch (size falls with no matching trades). Report by distance bucket, venue and wall quality. The "pulled" share is the spoof-like rate; report as a pattern, not as intent.
3. Price test: signed mid movement after the approach for held vs pulled walls, controlling for the volatility of the period. A genuine effect should show reflection after held walls.
4. Compare tradedFrac distribution with a replay of the same data at shuffled depth; check the match of wall creation with followed wallets on Hyperliquid (is the resting side one wallet?).

## 6. Candidate variables
| Variable | Tag |
|---|---|
| Pull-before-touch rate and distance at pull (size removed with no trades at the level, from 250 ms levels and trades) | DOABLE TODAY |
| Per-level order count `n` on Hyperliquid | DOABLE TODAY only if the engine stores it; not checked |
| Wall lifetime survival vs null | DOABLE TODAY |
| Book summaries (added/removed size at 1/5/10/20 bps edges) to measure churn around the wall | DOABLE TODAY |
| Followed-wallet resting activity (Hyperliquid wallet layer) | DOABLE TODAY partly (positions and fills; resting orders are not in the trade feed) |
| Cross-venue same-price wall (mirrored on the other venue) | DOABLE TODAY |
| Order-by-order identity: same order id resting, partial fills, cancel timestamps | NEEDS NEW DATA |
| Queue position and the size ahead of a given order | NEEDS NEW DATA |
| Levels beyond 30 / 20, for walls far from the touch | NEEDS NEW DATA |

## 7. Wishlist
- Binance diff depth with update ids (100 ms), to separate adds, cancels and fills exactly.
- Hyperliquid order-level data (open orders by user are queryable per address, not for the whole book; coverage would need a node feed). Not verified: confirm what the public API offers.
- More symbols.
