# Auto-record, full watch (decided 2026-10-26)

Status: steps 1-2 done (v087, v088); step 3 built (v089); step 4 not started.

## Why
The first Arm (01) watches only the Binance mark price volatility with one socket. Problems: it starts late (5 minutes of movement must
accumulate), the minutes before the trigger exist only as mark price, it is blind to events that do not move price much (absorption, walls,
forced flow), the stop is a calm timer that can cut an aftermath, and the 10 minute cooldown can miss the next event.

## Decisions (user, 2026-10-26)
- Armed means "full watch": the feeds and the Reader engine run while armed, with a rolling buffer of the real inputs (default 10 minutes).
  Costs more CPU and battery than the light Arm; meant for a PC or a charging phone.
- Out of scope on purpose: another coin or venue (e.g. ETH) triggering the recording of the coin being watched.

## Steps (each its own release)
1. v087 Lead-in: arming connects the feeds itself and keeps a rolling `preMin` (10) minutes of inputs; a start keeps them in the file.
   Same volatility trigger and stop. After a recording it stays connected and buffers again.
2. Reader trigger and stop: a forming/active episode (not only volatility) starts a recording; stop when no episode is active or fading
   and volatility is calm, instead of the calm timer alone.
3. Collector triggers: forced-flow burst, venue gap, funding / open interest jump, from the collector readings already kept.
4. Cooldown: shorter, or none while the market is still unsettled (market state).

## Step 1 details
- Engine: `trimRecording(tMs)` drops recorded inputs older than tMs (head of the log). Pure; self-tested.
- The rolling buffer is the engine's own recording, started when armed and trimmed every tick; at a start it becomes the recording
  (`RT.rec` adopted; the file's `startedAt` stays the trigger time, the inputs begin up to `preMin` minutes earlier).
- Arm no longer requires Disconnect. If the app was disconnected, Arm connects and disarming (or the last recording) disconnects again.
- Disconnecting by hand while waiting disarms. Arming during a manual recording is refused.
- The price worker (volatility reading) is unchanged; a hidden tab still slows the page's own feeds (see Health log), the lead-in
  inherits that and session quality shows it.

## Step 2 details (v088)
- Setting `epTrig` (default on, box "also start on a Reader episode"). `AUTOREC.step(st, v, t, cfg, ep)` takes `ep = {active, live}`: Reader episodes that are active, and active or fading, walls left out (a wall can stand for hours).
- Start: an active episode starts a recording in a calm market too (why "episode"); it still needs the 15 minute baseline, and the cooldown still applies.
- Stop: a recording does not count as calm while an episode is live; the calm timer (calmMin) starts when the last one has ended and volatility is calm. maxMin still caps it.
- Also fixes v087: one status separator was saved as a single byte instead of UTF-8.

## Step 3 details (v089)
- Setting `colTrig` (default on, box "also start on forced flow or a stressed market"). `ep.col` is true when the market state (`colStateLive`, rules v1, unchanged) reads forced flow (`L`: at least $500k liquidated in a minute and 10x the usual, in the last 5 minutes) or "stressed" (two of volatility index, forced flow, venue gap). Why "collectors".
- The venue gap alone does not trigger (its rule is 1.5 sd of the last 30 minutes, which noise reaches often). Funding and open interest do not trigger either: they are a slow regime, not an event, and would keep it recording for hours.
- A recording does not count as calm while `ep.col` holds; forced flow lasts at most 5 minutes after the last liquidation, maxMin still caps it.
- Needs the collectors' records in memory (`CL.recent`, filled while armed by the always-on worker and the page); with none, the state reads unknown and nothing triggers.
