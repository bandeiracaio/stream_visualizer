# Overnight run: "Ready to arm?" and "Last night" (Now > Arm mode)

Status: ready-for-agent. Display only: never changes a feed, a recording or a detection.

## Why
Everything downstream (scoreboard, collector analysis, weekly review) depends on good overnight data and labels. Arm mode already shows what is going wrong while armed (`amAlerts`); it does not tell you BEFORE you leave whether the night will work, nor summarise it AFTER.

## Ready to arm? (top of Arm mode)
A checklist, each item ok / warn / bad with the fix in words: online; newest version (header bar knows); save folder chosen and allowed (browsers that can save into a folder); disk space (`DW.assess`); persistent storage (`navigator.storage.persisted()`: recordings are not evicted); power (`navigator.getBattery()`: charging, level; absent on Firefox / Safari = skipped); wake lock supported; tab visible; collectors active (`COLLECT.health`); connected feeds (arming needs them disconnected); armed. Verdict line: "Ready" when nothing is warn or bad, else "N to check".

## Last night (Arm mode)
Saved recordings from the last N hours (12 / 24 / 48, default 24): how many, size, per recording the quality line and a tone (hollow or empty = bad, holes or a silent collector = warn), the collectors that had problems in how many recordings, and the Health log notes of the same window by kind (frozen, gap, silent, wake lock lost, price-stream drop, tab hidden...). Each recording has Open (loads it into the replay, goes to Review > Replay and labels). "Count episodes to label" replays the recordings of the window (shared cache with the Scoreboard view, same thresholds) and shows, per recording, groups and how many are not labelled yet.

## Code
`src/js/overnight-core.js` (pure, self-tested in the build; `OVERNIGHT.preflight(env)`, `OVERNIGHT.morning(rows, notes, now, opts, sq)`), `src/js/overnight-view.js` (gathers the environment, draws two sections in Arm mode, loaded after scoreboard-view.js).

## Not here
Sounds or notifications; changing any setting for you (it says what to change); checking Chrome's Memory Saver (a page cannot see it: a fixed hint line).
