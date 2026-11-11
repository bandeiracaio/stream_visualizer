# 4. Sigma is the MAD of overlapping 15-second returns, divided by the square root of the lag

Status: accepted

"Sigma" is the scale of normal price movement, in bps per root second. Windows are measured in multiples of it (price progress,
distance to an extreme). It used to be the MAD of 1-second returns, which is zero whenever more than half of them are, so it sat on
its floor. It is now the robust spread of overlapping returns over `sigmaLagMs` (15 s) divided by sqrt(lag) (v014: the 75th percentile of absolute deviation from the median divided by 1.1503, because in quiet Hyperliquid 25-50% of 15 s returns are exactly zero and the MAD, the 50th percentile, underestimated: 0.90 vs std 1.44 over a 28-minute chunk), floored at 0.05 bps, and it
stays at the floor until 60 samples exist. 15 seconds is long enough that returns are rarely zero, and the estimate stays robust
to spikes (a standard deviation would not).

Removed 2026-11-10: the paragraph here described a static expectation on price progress kept in the assumption register (a typical |move| of 0.5 to 1.2 sigma). The register was removed with the self-revising Reader (ADR 0001 to 0003 are superseded), so the check no longer exists. The sigma definition above is unchanged.

Consequence: changing how a quantity is measured changes what its references mean. Do it before data is collected, not after.
