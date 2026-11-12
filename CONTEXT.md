# Stream Visualizer: domain language

**Episode**: one market phenomenon with a lifecycle (forming, active, fading, ended; resumable). Families: absorption, exhaustion, aggression burst, wall.

**Signal**: a point-in-time detection with no lifecycle (for example a wall appearing, a thin book or an imbalance flip). Signals and episodes are separate layers, detected independently. Replaces the word "event". Avoid: event.

**Input**: one message from a feed (a trade, quote, book update or sweep) that the engine consumes and replay re-feeds. Avoid: event.

**Session**: one continuous live run of the app; runs under a minimum length do not count as evidence.

**Aggressor / passive side**: neutral participant language. No bull/bear.

**Z-score (flow)**: how far a venue's current taker flow on one side is from its own baseline, in robust spreads. The yardstick is the larger of the MAD, 10% of the median, and 10% of the other side's median (so a side that has hardly traded is not scored against nothing); the result is capped at 50 (v047).

**Stall (absorption)**: price has not progressed with the aggressor (at most 0.5 sigma) and has not clearly reversed against it (no more than 1 sigma, `absAdverse`, v049). A clear reversal is a different phenomenon.

**Wallet dominates / refill (absorption evidence)**: the wallet item needs the wallet to trade in at least 2 different seconds (`walletSecs`), because one big order split into many fills at one instant is a single trade; the refill item has no reading when the side's depth at the start of the window was under 60% of its usual depth, because a thin snapshot makes the ratio meaningless (v052).

**Wall region**: one resting wall seen at several nearby prices. Reported as a single wall episode: a new wall within 6 bps of an active one, or within 90 s of the last one's end, does not open another (v044). Walls under $100k notional are ignored (v045).

**Extreme (exhaustion)**: two separate checks. "Made a new 5-minute extreme" is evidence; "price still near that extreme" (within 1 sigma of it, measured when the episode fires) is required (v046).

**Sigma**: the scale of normal price movement, in bps per root second (the 75th percentile of the absolute deviation from the median of overlapping 15-second returns, divided by 1.1503 and by the square root of 15; not the MAD, see `docs/adr/0004`). Price progress and distances are measured in multiples of it (see `docs/adr/0004`).

**Recording**: the inputs the engine consumed, in chunks (see Chunk), each saved as one session file (plus the `ext` collector slice, `quality` and the paper runner's journal rows of that stretch) so it can be replayed. The page records everything it consumes while connected; one switch turns it off. Saved recordings are the IndexedDB copies of those files (the newest 24 hours) and the files in the save folder. Not the same as a Session (one continuous live run of the app).


**Run**: what lies between two resets of the engine (a connect, a change of asset, a page load) or ends at a disconnect. At the start of a run the engine, the facts accumulator and the paper runner are all new, so replaying the run's chunks gives the page's journal row for row. A page that closes without a disconnect leaves a run cut short.

**Chunk**: one cut of a run's input stream, made when an input's own time is 30 minutes after the chunk's first input, or at 600,000 inputs (never by a timer, so a hidden tab cuts in the same place). It is a session file with the run's id, its number in the run, the runner's configuration and the journal rows written during the chunk. No input is lost or repeated between two chunks of a run.

**Stage**: where a trade system stands: paper, demo or live. Every trade row records the stage the system had when the trade was entered and where it was filled (`fill`, paper until demo execution exists). Moves between stages are kept in the stage log.

**Promotion**: a move up one stage, by the user and never automatic, allowed only when the system meets the fixed rule (spec 4.7) counted on trades the page made live since its last move into the stage; live also needs a dollar cap. A move down to paper is always allowed and restarts the count; a live system is moved down by itself on a one-day loss limit.

**Twin**: a random-entry copy of a system (same context, region, exit, stop and sizing; entries at random times and directions at the system's own trigger rate), paper only, 20 per system. A system's result is read against its twins' results.
