# Data collection checklist

For the first real collection weeks. Numbers come from the code defaults (`reader-register.js`, `auto-record-core.js`); if a default changes, change it here.

## What counts as a usable session

- **Length: at least 10 minutes** (`minSessionMs` 600000). Shorter sessions are stored but do not count toward baselines, drift or the static expectation.
- **A variable is judged only with 300 samples** (`minSamples`, `minLearned`); a family needs **3 episodes** (`minEpisodes`) before its thresholds are reviewed.
- **Drift needs history**: 5 reference sessions (`k`) before anything can differ, then 3 differing sessions in a row (`m`) to confirm. Plan for at least 5 counted sessions before expecting a drift flag, and about 8 before expecting a proposal.
- **Mix the conditions**: sessions are tagged by hour and weekday, so spread them (a calm weekend and a busy weekday are different data). A run longer than an hour is cut into hourly segments automatically.

## Before leaving the app running

1. Open the latest `stream-visualizer_vNNN.html` (check the version in the app against the newest file in the repo root).
2. Leave **warm-up** to finish (the Reader shows calibrating until it has enough data); nothing is recorded in the baselines before that.
3. Keep the tab visible or the screen awake. A hidden tab throttles timers, and a data gap ends the session.
4. For jumps in activity, **arm auto-record at least 15 minutes ahead** (it needs 15 minutes of prices for its hour baseline). It starts at 1.8x the hour's sigma (above the 0.4 floor) or above 1.2 bps per root second, stops after 5 calm minutes or 60 minutes, then downloads the file.
5. The app must be disconnected to arm auto-record; arming opens one price socket only.

## After a session

1. Reader tab: check the **Sessions** list shows the session as counted, and that no variable is stuck on `prior` that should be `learned`.
2. Look at any **drift flag**: acknowledge it if it is real market change, undo it if it was an anomaly (a test run, an outage).
3. Use agree / disagree / missed labels on episodes you watched; they are the only ground truth the replay can be judged against.
4. Keep the downloaded recording files together (they replay against the stored baseline snapshot, ADR 0002).

## Weekly review

1. Reader tab: export the **review report** and the **register**.
2. Read the report: *To review*, *Threshold proposals*, *Variables*, *Sessions*, *History*. Sigma-scale registers from before v012 are on the wrong scale; do not use them.
3. Approve or reset a proposed threshold; the app downloads a revision file. Drop it in `docs/revisions/`.
4. Before a release: `node fold.mjs --check`, then `node fold.mjs`, review the diff, `node build.mjs`, then `node build.mjs --release`.
5. Approving never changes a detection by itself; only an approved threshold does (ADR 0001, 0003).

## What not to expect yet

- A proposal from fewer than ~8 counted sessions, or from one market regime only.
- Anything about Hyperliquid tails or the fast sigma component until a recording contains a real jump in activity (the motivation for auto-record).
