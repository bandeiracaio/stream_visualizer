# Stream Visualizer: domain language

**Episode**: one market phenomenon with a lifecycle (forming, active, fading, ended; resumable). Families: absorption, exhaustion, aggression burst, wall.

**Signal**: a point-in-time detection with no lifecycle (for example silence, lead/lag, trade clustering, or a one-off burst). Signals and episodes are separate layers, detected independently. Replaces the word "event". Avoid: event.

**Input**: one message from a feed (a trade, quote, book update or sweep) that the engine consumes and replay re-feeds. Avoid: event.

**Assumption**: a claim about how the market normally behaves that a detector relies on (e.g. "normal price movement is X bps"). Not a tuning constant.

**Register**: the explicit list of assumptions, each with a written prior and a learned baseline.

**Prior**: the value we wrote down in advance. **Learned**: the value measured from observed data once enough samples exist.

**Baseline**: the robust summary of a variable per venue (quantile sketch plus sample count).

**Session**: one continuous live run of the app; runs under a minimum length do not count as evidence.

**Drift**: observed data differing from an assumption, with enough events and agreement across sessions to be sure.

**Revision**: an accepted change to an assumption or threshold. Baselines are revised automatically; detection thresholds only with user approval (see `docs/adr/`).

**Aggressor / passive side**: neutral participant language. No bull/bear.

**Sigma**: the scale of normal price movement, in bps per root second (the MAD of overlapping 15-second returns divided by the square root of 15). Price progress and distances are measured in multiples of it (see `docs/adr/0004`).

**Expectation**: a shape a measured quantity must have if our assumption about it is right, written in advance and checked against everything seen so far (for example, price progress in sigmas should have a typical move of about 0.7 and tails near 1.6). It catches an assumption that was wrong from the start, which drift never does.
