# Overnight run: "Ready to arm?" and "Last night" (Now > Arm mode)

Status: built (v120); the "Hours recorded" grid was added in v121. Display only: never changes a feed, a recording or a detection.

## Why
Everything downstream (scoreboard, collector analysis, weekly review) depends on good overnight data and labels. Arm mode already shows what is going wrong while armed (`amAlerts`); it does not tell you BEFORE you leave whether the night will work, nor summarise it AFTER.

## Done when: "Ready to arm?" (top of Arm mode)
A checklist; every item that is not ok says the fix in words. Items and their tones:
- online: bad when the browser reports no internet.
- newest version (the header bar knows): warn when a newer one exists.
- save folder, only in browsers that can save into a folder: ok when allowed; warn when none is chosen; bad when it needs permission again; bad when the last save failed.
- disk space (`DW.assess`): its warn or bad passes through, otherwise ok.
- persistent storage (`navigator.storage.persisted()`, recordings are not evicted): ok when true, warn when false, no item when the browser does not say.
- power (`navigator.getBattery()`; no item where it is absent, as on Firefox / Safari): ok when charging; on battery, bad under 50% and warn from 50%.
- wake lock supported: warn when the browser has none.
- tab visible: warn when hidden.
- collectors active (`COLLECT.health`): warn when any is slow or silent, or when some are expected and none is active.
- armed: ok when armed; warn when the feeds are connected (arming needs them disconnected); info "not armed yet" otherwise.

The verdict line reads "Ready" when no item is warn or bad, otherwise "N to check", N being the count of bad and warn items.

## Done when: "Last night" (Arm mode)
- The window is the last 12, 24 or 48 hours (default 24).
- Each saved recording in it, oldest first, shows its name, size, quality line and a tone: bad when its verdict is hollow or empty, warn when it is not clean (holes or a silent collector), info when it has no quality information, ok otherwise. Open loads it into the replay and goes to Review > Replay and labels.
- The summary shows how many recordings and their total size, the collectors that had problems and in how many recordings, and the Health log notes of the same window counted by kind: gap, silent, page frozen, wake lock lost, learning started over, auto-record not ready, price-stream drop, tab hidden, page error, promise error, armed page ended.
- "Count episodes to label" replays the recordings of the window (shared cache with the Scoreboard view, same thresholds) and shows, per recording, the groups and how many are not labelled yet.

## Done when: "Hours recorded" (v121, Recordings > Saved)
- A grid with one row per day and 24 cells per row (local clock); a brighter cell means more of that hour was recorded. A selector offers today / 3 days / 7 days (default 7).
- Above it: hours recorded in the last 24 hours and in the chosen period.
- Overlapping recordings count once; a file without quality information is skipped; a file from before v111 counts as its kept time minus its span.

## Code
`src/js/overnight-core.js` (pure, self-tested in the build; `OVERNIGHT.preflight(env)`, `OVERNIGHT.morning(rows, notes, now, opts, sq)`, `OVERNIGHT.coverage(rows, now, days, offMs)`), `src/js/overnight-view.js` (gathers the environment, draws the two Arm mode sections, loaded after scoreboard-view.js), and `rcCoverage` in `src/js/recordings.js` (draws the grid).

## Not here
Sounds or notifications; changing any setting for you (it says what to change); checking Chrome's Memory Saver (a page cannot see it: a fixed hint line).
