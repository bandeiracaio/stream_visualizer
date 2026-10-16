# 4. Sigma is the MAD of overlapping 15-second returns, divided by the square root of the lag

Status: accepted

"Sigma" is the scale of normal price movement, in bps per root second. Windows are measured in multiples of it (price progress,
distance to an extreme). It used to be the MAD of 1-second returns, which is zero whenever more than half of them are, so it sat on
its floor. It is now the MAD of overlapping returns over `sigmaLagMs` (15 s) divided by sqrt(lag), floored at 0.05 bps, and it
stays at the floor until 60 samples exist. 15 seconds is long enough that returns are rarely zero, and the estimate stays robust
to spikes (a standard deviation would not).

Because a scale can be wrong from the start, which a drift check never sees, price progress carries a static expectation in the
register: a typical |move| of 0.5 to 1.2 sigma and 5th/95th percentiles averaging 1.3 to 3.2 (the upper bounds were first 1.0 and 2.6, and were widened after measuring BTC, ETH and DOGE). The bands are settings logged when
changed. A quantity whose shape is known in advance should get the same treatment.

Consequence: changing how a quantity is measured changes what its references mean. Do it before data is collected, not after.
