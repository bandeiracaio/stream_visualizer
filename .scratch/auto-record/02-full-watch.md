# Auto-record, full watch (decided 2026-10-26)

Status: step 1 built and tested (v087); steps 2-4 not started.

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
