# Data collection checklist

How to leave the page collecting, and how to tell afterwards that it worked. Rewritten 2026-11-15 for continuous recording (v142 and later); the earlier version described arming, the register and agree / disagree labels, all removed.

## Before leaving it running

1. Open the newest page (the hosted one, or `releases/stream-visualizer_vNNN.html`). A page that is behind shows a "newer version" bar.
2. Press **Connect**. The page records by itself while connected; the header chip reads `REC run, chunk N`.
3. Point the save folder at `sessions/`: Recordings, Saved recordings, Choose folder. Chrome asks for the permission again after a restart; the chip `save folder needs OK` says so.
4. Open Recordings, **Left running**, and clear every line that is not green: recording on, connected, save folder, disk room, persistent storage, power, wake lock, newer version.
5. Keep the computer plugged in and set not to sleep. The tab may be hidden: the page holds a Web Lock and the collectors run in a worker.

## While it runs

- A chunk is saved every 30 minutes of data into the save folder (all of them) and into the browser's storage (the newest 24 hours).
- **A reload ends the run.** The open chunk is cut short and the next run starts with a new engine, so the two minutes of calibration repeat and results that need the minutes after the cut are lost. Reload only for a release you need.
- While the episode-outcomes study is open (`.scratch/episode-outcomes/plan.md`): do not open, replay or analyse recordings from 2026-11-16 on, apart from `node episode-outcomes.mjs sessions --count`.

## How to tell it worked

- **Saved recordings** shows a quality line per file (`47 of 61 min with data, longest silence 60 s`), amber when there are holes. A `hollow` file (fewer than half the minutes have data) is not worth analysing.
- The **Hours recorded** grid shows one cell per hour.
- The **Health log** (under Saved recordings) says why a file has holes: tab frozen, timers stalled, computer asleep, venue silent, socket closed. Download it next to a recording that has holes.
- `node design-harness.mjs --replay-run sessions/` replays each run and checks the paper journal equals the page's.
- `node episode-outcomes.mjs sessions --count` prints the hours per day and the number of episodes, and looks at nothing else.

## Collectors

Records beside the Reader's inputs go to a rolling 24 h tape on the device and into every saved chunk as `ext`: self-telemetry, derivatives context (Binance and Hyperliquid), calendar tags, book depth summaries, venue prices and the Deribit volatility index. Switches and counts are in Recordings, under Collectors. A line in green is writing; amber means its last record is more than three times later than it should be.

## What a good detection is

There are no labels. Whether an episode was a good detection is measured by the price afterwards against matched control moments (`episode-outcomes.mjs`), under a plan registered before the data exists.
