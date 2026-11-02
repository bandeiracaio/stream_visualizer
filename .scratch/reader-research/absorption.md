# Absorption: literature pass

Source status key. VERIFIED = the page or abstract was fetched or returned by search this session. UNVERIFIED = cited from memory of the literature, not re-opened; check before relying on it. LOWER TRUST = practitioner material (none used in this file).

## 1. What the Reader does now (src/js/reader-episodes.js, evalAbsorption)
Per venue, horizon (fast / mid) and aggressor side. Gate items (all must hold): aggressor share of taker flow >= `absorbShare`; price progress in sigmas between -`absAdverse` (1) and +`absorbSigma` (0.5); still happening in the latest quarter-window (share >= .55, pace >= .5 of the window rate). Scored items: flow z >= `absorbZ`; path efficiency <= `absorbEfficiency`; passive-side depth refilled >= `absorbRefill` (no reading if the start depth was under `thinFrac` of typical); no single trade over `absConc` (.2) of flow; repeated fills at one level (`refreshMs`); one wallet dominates (Hyperliquid); other venue agrees. Enter at score .7 held 2 s. Price movement is normalised by sigma (bps per root second).

Observation: "stalled" is a fixed price band (<= 0.5 sigma), not conditioned on how much flow arrived. Strong flow with a 0.4 sigma move and weak flow with a 0.4 sigma move score the same on that item (the flow z item partly compensates).

## 2. Definition in the literature
No paper defines "absorption" as a named event. The usable academic content is the price-impact relation, from which absorption is the *shortfall* of impact:
- Order flow imbalance (OFI) over an interval, built from changes at the best bid and ask (limit adds, cancels and market orders), is linearly related to the price change, with a slope inversely proportional to market depth. Cont, Kukanov, Stoikov, "The Price Impact of Order Book Events", J. Financial Econometrics 12(1), 2014, arXiv:1011.6402 (https://arxiv.org/abs/1011.6402). VERIFIED (abstract). They also report the trade-volume (square-root style) relation is noisier and less robust than the OFI relation. VERIFIED (abstract).
- Impact is partly transient and the visible book is not the whole supply: Donier, Bonart, Mastromatteo, Bouchaud, "A fully consistent, minimal model for non-linear market impact", Quantitative Finance 15(7), 2015, arXiv:1412.0141 (https://arxiv.org/abs/1412.0141). The model works on a *latent* order book (intentions of slower traders) that is locally linear; the authors split price into a transient "mechanical" part and a permanent "informational" part. VERIFIED (abstract). Implication: the depth that matters for "how far should this flow have moved price" is not only the 20-30 displayed levels.
- Hidden liquidity (iceberg orders) is the mechanism most often meant by "absorption" at the tape level: Frey and Sandas, "The Impact of Iceberg Orders in Limit Order Books", Quarterly Journal of Finance 7(3), 2017 (earlier CFR WP 09-06, https://www.cfr-cologne.de/download/workingpaper/cfr-09-06.pdf). Equity data (Xetra). Reported: hidden liquidity associated with greater liquidity, volume and smaller price impact. VERIFIED (search summary of abstract; full text not read). See new-families.md.
- Square-root and propagator literature (Bouchaud, Farmer, Lillo, "How markets slowly digest changes in supply and demand", 2009; Bouchaud, Gefen, Potters, Wyart 2004): UNVERIFIED this session; supports the claim that impact depends on flow relative to a liquidity scale and decays.

I found no peer-reviewed source that gives a threshold for "absorbed". Thresholds in the Reader (0.5 sigma, share .6, etc.) are our own choices; nothing in the literature supports or contradicts them. The source for "stalled" should be a model of expected impact, not a fixed band.

## 3. Variables and thresholds in the literature
- OFI at best level: e_n = I{P_bid_n >= P_bid_{n-1}} q_bid_n - I{P_bid_n <= P_bid_{n-1}} q_bid_{n-1} - I{P_ask_n <= P_ask_{n-1}} q_ask_n + I{P_ask_n >= P_ask_{n-1}} q_ask_{n-1}, summed over the interval (formula as I recall it from CKS; UNVERIFIED in detail, confirm in the PDF).
- Price change regressed on OFI with a per-interval depth-dependent slope (CKS: slope ~ 1/depth, interval of order 10 s in their data). Crypto perpetuals: not tested in the paper (equities only). Transfer to crypto is an assumption.
- No thresholds are given; the paper is a regression, not a detector.

## 4. Failure modes and reliability
- Flow-only measures ignore passive adds and cancels, which CKS show carry the larger part of the imbalance; a trade-only "stalled" test can fire when the book simply thinned and refilled (or fire falsely when the passive side pulled).
- Taker side classification on exchanges that give it (Binance aggTrade buyer-is-maker flag, Hyperliquid `side`) is exact, so no Lee-Ready error. Binance aggTrade merges trades at the same price and taker side within the stream window; USD-M excludes insurance fund and ADL trades (VERIFIED via search summary of https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Aggregate-Trade-Streams; wording not read directly). Trade counts and "no single large trade" (`absConc`) are therefore affected by that aggregation.
- Sigma: normal movement is estimated from the venue's own history; absorption in a slow regime is easy to call because a small move is less than 0.5 sigma only when sigma is large. Not a literature point; an internal observation.
- No reliability study of absorption detectors on crypto perpetuals found. UNSUPPORTED.

## 5. Checkable definition without labels
Impact-shortfall definition. For each window w on a venue: (a) estimate lambda, the price change per unit signed taker volume (or per unit OFI), from a rolling or prior-session fit by robust regression; (b) expected move E = lambda * signed volume; (c) shortfall S = (observed move - E) in sigma units, signed against the aggressor. Absorption = flow z high AND S <= -k (k from the null below).
Tests, none needing labels:
1. Null calibration: shuffle windows' signed volumes across the session (keep prices) and recompute S; choose k so the null rate is, say, 5%. Report the observed rate per family of windows vs the null (permutation).
2. Predictive check: conditional on detection, mean price path at +10, +30, +60 s in sigma, signed with the aggressor, versus matched controls (same flow z decile, no shortfall). Report with block bootstrap by session (small sample caveat).
3. Mechanism check: passive depth on the absorbing side should be replenished more than in matched controls (refill ratio), and on Hyperliquid the resting orders' `n` (number of orders) should not fall.
4. Replay stability: byte-compare against current absorption detections (compare-detections.mjs) to see overlap.

## 6. Candidate variables
| Variable | Tag |
|---|---|
| Rolling lambda (price change per signed taker USD) per venue, shortfall S | DOABLE TODAY (trades + quotes) |
| Quote-based OFI from best bid/ask size changes at 100 ms (approximation of CKS e_n: size changes between quote updates net several events) | DOABLE TODAY |
| Multi-level OFI (top 5 or 10 levels) from 250 ms depth snapshots | DOABLE TODAY (Cont's paper uses best level; deeper levels are a later extension, UNVERIFIED) |
| Depth added/removed at the touch from collector book summaries (edges 1/5/10/20 bps), refill ratio over the window | DOABLE TODAY |
| Hyperliquid per-level order count `n` (l2Book WsLevel has `n`, VERIFIED: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) | DOABLE TODAY only if the engine stores `n`; not checked, confirm in reader-engine.js |
| Hyperliquid buyer/seller wallets per trade (`users`, VERIFIED same page) to test whether the passive side is one wallet | DOABLE TODAY (already used as the wallet item for the aggressor) |
| Other venues' price response to the same flow (Coinbase, Bybit, OKX, spot) | DOABLE TODAY (collector `ext`) |
| Time-of-day-adjusted lambda | DOABLE TODAY (needs several sessions) |

## 7. Wishlist (NEEDS NEW DATA, no code)
- Order-by-order book and queue position: separates cancels from fills, iceberg refills from new orders, and shows who is absorbing.
- Binance 100 ms depth diffs (depth stream with update ids): exact OFI instead of snapshot-netted OFI.
- Deeper levels than 30 / 20 and a latent-liquidity proxy (for example a long-run average of resting size by distance).
- More symbols, to estimate lambda across instruments.
