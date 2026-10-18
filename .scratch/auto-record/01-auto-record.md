# Auto-record on volatility

Status: built (v031), relative floor added (v032).

## Goal
Leave the app waiting at almost no cost, and have it start a session recording when the market turns volatile, keep recording while it
lasts (up to a limit), then save the file. Motivation: the recorded sessions so far are calm; the open questions (Hyperliquid tails, whether
the fast sigma component helps) need a recording that contains a jump in activity.

## Decisions (user, 2026-10-18)
- Trigger: both a relative and an absolute condition, either is enough. Relative: the last 5 minutes are 1.8x as volatile as the last hour.
  Absolute: the last 5 minutes are above 1.2 bps per root second (BTC is about 0.5 on a normal day). All settable in the Reader tab, remembered.
  v032: the relative trigger only counts above a floor of 0.4 (fixed, not in the UI). The first real run (2026-10-18, Sunday) fired on a dead-calm
  market (sigma ~0.18, which is 1.8x of ~0.10) and recorded 10 useless minutes.
- Stop: after N minutes calm (default 5; below both exit levels, 1.3x and 0.8) or after at most X minutes (default 60), whichever comes first.

## How it works
- Volatility is the Reader's own sigma scale (ADR 0004): robust spread of overlapping 15 s returns over the square root of the lag, on the
  Binance mark price once a second. `src/js/auto-record-core.js` (pure, self-tested; part of the build's self-test) holds the history, the
  estimator and the start/stop decision. `src/js/auto-record.js` is the view.
- Waiting costs one websocket (`@markPrice@1s`, same route setting as the app) and a small calculation every 5 s. No other feeds, no Reader
  engine, no drawing. The app must be disconnected to arm, so nothing else runs.
- It needs 15 minutes of prices before it can judge (the "last hour" baseline), so arm it well before the expected volatility.
- On a start it presses Connect (if it was disconnected) and Record, with a longer recording limit (maximum + 2 minutes, up to 2,000,000 inputs;
  a manual recording still stops at 30 minutes). On a stop it stops the recording, downloads the file, and disconnects again if it connected.
- The screen wake lock is requested while armed (re-requested when the tab becomes visible). The page itself is what records, so the tab has to stay open.

## Limits
- The recording starts at the trigger (plus connection time); the minutes before it are not captured. The replay's 2-minute warm-up comes out of
  the start of the recording.
- The slow baseline (the hour) includes the volatile stretch itself, so on a long volatile day the relative trigger fades; the absolute one does not.
- A recording of hours is large (about 1.3 MB gzipped per 30 minutes of BTC).
- Closing the tab, a phone going to sleep, or losing the network ends the wait (a dropped stream is reopened after 5 s; history gaps of a few
  seconds are tolerated).
