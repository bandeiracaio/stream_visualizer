# Stream Visualizer: domain language

**Episode**: one market phenomenon with a lifecycle (forming, active, fading, ended; resumable). Families: absorption, exhaustion, aggression burst, wall.

**Signal**: a point-in-time detection with no lifecycle (for example silence, lead/lag, trade clustering, or a one-off burst). Signals and episodes are separate layers, detected independently. Replaces the word "event". Avoid: event.

**Input**: one message from a feed (a trade, quote, book update or sweep) that the engine consumes and replay re-feeds. Avoid: event.

**Session**: one continuous live run of the app; runs under a minimum length do not count as evidence.

**Aggressor / passive side**: neutral participant language. No bull/bear.

**Z-score (flow)**: how far a venue's current taker flow on one side is from its own baseline, in robust spreads. The yardstick is the larger of the MAD, 10% of the median, and 10% of the other side's median (so a side that has hardly traded is not scored against nothing); the result is capped at 50 (v047).

**Stall (absorption)**: price has not progressed with the aggressor (at most 0.5 sigma) and has not clearly reversed against it (no more than 1 sigma, `absAdverse`, v049). A clear reversal is a different phenomenon.

**Wallet dominates / refill (absorption evidence)**: the wallet item needs the wallet to trade in at least 2 different seconds (`walletSecs`), because one big order split into many fills at one instant is a single trade; the refill item has no reading when the side's depth at the start of the window was under 60% of its usual depth, because a thin snapshot makes the ratio meaningless (v052).

**Wall region**: one resting wall seen at several nearby prices. Reported as a single wall episode: a new wall within 6 bps of an active one, or within 90 s of the last one's end, does not open another (v044). Walls under $100k notional are ignored (v045).

**Extreme (exhaustion)**: two separate checks. "Made a new 5-minute extreme" is evidence; "price still near that extreme" (within 1 sigma of it, measured when the episode fires) is required (v046).

**Sigma**: the scale of normal price movement, in bps per root second (the 75th percentile of the absolute deviation from the median of overlapping 15-second returns, divided by 1.1503 and by the square root of 15; not the MAD, see `docs/adr/0004`). Price progress and distances are measured in multiples of it (see `docs/adr/0004`).

**Recording**: the inputs the engine consumed over a stretch of time (plus the `ext` collector slice and `quality`), saved as one session file so it can be replayed. Made by hand (Record) or by auto-record. Saved recordings are the IndexedDB copies of those files. Not the same as a Session (one continuous live run of the app, which may hold several recordings).

**Arming**: switching auto-record on (header Arm). While armed it watches the mark-price volatility and starts and stops recordings by itself; it ends when disarmed by hand, when a recording is stopped by hand, when it hits `maxRuns`, or when the page closes. Armed is the state; Recording is what it produces.

**Run**: one auto-recording started within one arming, counted in `AR.runs`. An arming has 0 to `maxRuns` runs. A hand-made recording is not a run.
