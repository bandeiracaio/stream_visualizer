# Exhaustion: literature pass

Source status key. VERIFIED = fetched or returned by search this session. UNVERIFIED = from memory of the literature, not re-opened. LOWER TRUST = practitioner (none used here).

## 1. What the Reader does now (evalExhaustion, mid horizon only)
Gate: aggression of one side over the current window <= `exhDecay` (.5) of the previous window's; it was elevated before (z >= `exhWasZ` 1.5); it was the dominant side before (share >= .55); price still within `exhNear` (1 sigma) of the extreme; late-quarter price progress with the aggressor <= `absorbSigma`. Scored: made a new 5-minute extreme (within `exhGap`); recent failed poke; trade count down (<= .5); average trade size down (<= .75).

## 2. Definition in the literature
"Exhaustion" is a practitioner word. I found no academic paper that defines or tests it as an event. What the academic literature supplies is the dynamics that an exhaustion claim silently assumes:
- Order flow is persistent (long memory): signed order flow autocorrelation decays very slowly (Lillo and Farmer 2004; Bouchaud, Farmer, Lillo 2009 "How markets slowly digest changes in supply and demand"). UNVERIFIED this session. Consequence: a fall in one side's flow to half of the previous window's pace is not, by itself, evidence that the flow has ended; the base rate of continuation may be high. This is an inference for us to test, not a published result on crypto.
- Self-excitation: Hawkes processes model event clusters that decay after an excitation; Bacry, Mastromatteo, Muzy, "Hawkes processes in finance", Market Microstructure and Liquidity 2015, arXiv:1502.04592 (https://arxiv.org/abs/1502.04592) is a survey covering volatility, market stability and order-book dynamics. VERIFIED (abstract/listing). It gives a principled notion of "decay": the conditional intensity relaxes exponentially (or power law) toward baseline at a rate fitted from data, so "decay ratio <= .5" can be compared with the expected relaxation rather than an arbitrary number. The specific claim that fitted crypto kernels have a given half-life is UNSUPPORTED here.
- Transient impact: after a burst of buying or selling, part of the move is mechanical and reverts (Donier et al. 2015, arXiv:1412.0141, https://arxiv.org/abs/1412.0141, VERIFIED abstract: transient mechanical vs permanent informational impact, with a short-term mean-reverting term). That supports "reversal after a flow peak" as a testable effect, but with magnitude unknown for our instruments.
- "Failed poke" / false breakout has no academic definition that I found. The Reader's `lastPokeFail` is our own construct.

## 3. Variables and thresholds
Literature offers none for the event. For a model-based version: the Hawkes intensity lambda(t) of signed trades per side, baseline mu, branching ratio n (the share of events caused by earlier events), kernel decay rate beta. Practitioner thresholds (RSI divergence, volume climax) belong to technical analysis; I did not use them.

## 4. Failure modes and reliability
- Persistence of flow means false positives: flow falls and then resumes. The Reader already allows resumption (resumeMs) and records an outcome (resolved-with / against / flat after 30 s), which is the right instrument to measure this.
- The 5-minute extreme is a rolling window artefact; in a trending move almost every window has a "new extreme". The `extreme` item does not discriminate there.
- Halving relative to the previous window is regime dependent: after a very large window almost any normal window halves. Comparison against a baseline (z of the current rate) is more stable than against the previous window.
- Count and size items are affected by Binance aggTrade aggregation (same price and taker side within the stream interval merge; VERIFIED via search summary of https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Aggregate-Trade-Streams).
- No evidence found on the reliability of flow-exhaustion detectors in crypto perpetuals. UNSUPPORTED.

## 5. Checkable definition without labels
Define exhaustion as a conditional-expectation claim and test it, not as a pattern:
H: given signed-flow intensity z_was >= 1.5 in the previous window and a ratio rate/was <= r, the subsequent signed price move (aggressor direction, sigma units, 30-300 s) is lower than for control windows with the same z_was but ratio > r (continued flow).
Tests:
1. Stratify all windows (every 1 s tick on the mid horizon) by z_was and ratio. Report mean forward move and its block-bootstrap interval by session. The claim is supported only if the low-ratio stratum shows a significantly smaller (or negative) forward move than the high-ratio stratum.
2. Hawkes fit: per venue and side, fit an exponential-kernel Hawkes process on a session; define exhaustion as the observed intensity falling below the model's compensator-implied expectation (residual intensity). Compare detections with the ratio rule.
3. Randomisation: circular-shift the price series against the flow series (as analyze-collectors.mjs does) for a null.
4. Sensitivity: sweep `exhDecay` .3-.7 and report the forward-move contrast to see if .5 is anywhere special. Likely it is not.

## 6. Candidate variables
| Variable | Tag |
|---|---|
| Forward signed move after ratio-low windows vs ratio-high (the test above) | DOABLE TODAY |
| Hawkes branching ratio and decay rate per side and venue | DOABLE TODAY (trades with side) |
| Flow z of the current window (against baseline) instead of ratio to the previous window | DOABLE TODAY |
| Passive-side depth rebuilding near the extreme (book summaries, added/removed) | DOABLE TODAY |
| Open interest change during the push (new positions vs closing), basis and funding at the extreme | DOABLE TODAY (collectors; cadence of OI is slow, check) |
| Other venues still pushing (Coinbase, Bybit, OKX marks, spot) | DOABLE TODAY |
| Options context from Deribit (DVOL change) | DOABLE TODAY, BTC/ETH only; relevance to seconds-scale exhaustion is UNSUPPORTED |
| Trade-level liquidation size at the extreme (forced flow ending is the clearest exhaustion) | NEEDS NEW DATA |

## 7. Wishlist
- Trade-level liquidation size and side (Binance forceOrder is a sampled snapshot, see burst.md and new-families.md).
- Order-by-order book to see whether aggressors ran out of resting liquidity or stopped.
- More symbols to test the contrast with enough events; a single symbol over a few sessions is a small sample.
