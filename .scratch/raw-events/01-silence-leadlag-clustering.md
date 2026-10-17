# New raw events: silence, cross-venue lead/lag, trade clustering

Status: built (v019). Agreed in grilling 2026-10-17; where the build differs from the agreement it is listed under Built.

## Goal
Add raw (one-off) events that answer "something changed". Points, not states. Built only from data the engine already has.

## Decisions
- Raw events mark that something changed; they build nothing bigger yet (no episode families).
- Data: engine data only (trades, book, sigma, the other venue's price). No funding, open interest or mark price.
- Points only: every event is one timestamped, replayable fact. Durations wait until a shape earns an episode family.
- Thresholds are measured and linked in the register (revisable by the weekly review), not fixed numbers.
- Events appear in the existing raw-events list, each with its own filter chip. One self-test scenario per event. Nothing else changes.

## Events
1. **Silence started / silence ended** (per venue)
   - Quiet = the gap since the last trade on one venue, compared with that venue's own recent gaps (a high percentile of its gap distribution).
   - Two point events: started (the moment the gap crosses the threshold) and ended (when trading resumes, carrying the length).
   - Both venues quiet together is a separate, rarer event, not part of this step.
2. **Cross-venue lead/lag**
   - One venue moves at least k sigma (start k = 1.5, existing sigma) and the other crosses the same level within a follow window (start 1 s).
   - The event names the leader and the follower.
   - Compares changes in each venue's own price against its own recent level; the basis between venues is not an event.
   - k and the window go in the register.
3. **Trade clustering**
   - At least 8 trades within 2 s, same side, sizes within 5% of their median (start values; all three in the register).
   - Ignores clusters below a notional floor, measured as a percentile of that venue's trade notional.
   - The event records side, count and total notional.

## Open
- Exact register keys and `LINKS` entries for each new threshold.
- Before building: replay the saved BTC session and count how often each event would fire, to check none of them floods the list (walls already run at about 180 episodes an hour).

## Built (v019)
- Events: `silence_started`, `silence_ended`, `lead_lag`, `trade_cluster`; families `silence`, `leadlag`, `cluster` (chips in the raw-events list); detectors can be switched off like the others.
- Raw events are flagged `raw`, have ids `r1, r2, ...`, are outside the per-minute cap and have their own 500-event list limit, so every older detection and episode is unchanged. Proven by replaying the saved BTC session on v018 and v019: legacy events and the 146 episodes are byte-identical (ids aside).
- Differences from the agreement:
  - Lead/lag threshold is 3 sigma, not 1.5. On the BTC replay 1.5 gave 39 events in 25 minutes, about what chance gives; 3 gives 8. The follower must not have already moved 2 sigma in the same second.
  - Trade clustering means "in a row": the last 8 trades on a venue are all one side, inside 2 s, within 5% of their median size, each above the median notional. (The first reading, any 8 matching trades in the window, fired on coincidences in a busy tape.)
- BTC replay rates (25 min): silence 29 per venue pair-event (27 on Hyperliquid, whose limit sits on the 3 s floor), clusters 10, lead/lag 8.
- Not done: the thresholds are `cfg` values and are not yet linked in the register, so the weekly review cannot propose changes for them. That needs new measured quantities and links, its own step.
