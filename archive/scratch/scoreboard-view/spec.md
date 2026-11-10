# Scoreboard view (Review > Scoreboard)

Status: built (v119). Display only: never changes a detection.

## What
The numbers `reader-scoreboard.mjs` prints, readable in the app (phone included): per family, the price move after detection at 1 / 5 / 15 minutes in sigmas (median, share that went with the side, split by agree / disagree / not labelled, beside the typical |move| at random moments), precision with a 95% Wilson interval in total and per UTC day, and recall among what was called real.

## Done when
- Nothing replays by itself. Before the first Compute the view says "Press Compute to replay the saved recordings" (or "No saved recordings yet (Recordings, Saved)" when there are none).
- Compute replays the Saved recordings that are not cached yet, one at a time, with a status line "Replaying i/n: name" and a 30 ms pause between recordings so the page can draw. A recording that fails to replay is skipped with its message and the rest continue.
- Results are cached per recording and per thresholds (`rtCfg()`: the current ones, approved overrides included; the script uses defaults unless `--cfg`). A changed threshold replays everything again; a deleted recording drops out; otherwise only a new recording is replayed. Changing labels needs no replay: the summary is recomputed from the cached parts. The cache (`SBV.parts`, `sbvPartFor`) is shared with the Overnight view (`.scratch/overnight/spec.md`).
- Every number shows its n. A rate with fewer than 8 labelled groups reads "n N, too few for a rate (need 8 labelled)"; with no labels it reads "no labels yet".
- The script and the view use the same core, so their numbers cannot drift: `reader-scoreboard.mjs` output on saved sessions is identical to what it was before the maths moved, and the build self-test has scenarios for the core.

## Code
- `src/js/scoreboard-core.js` (pure, self-tested; `SCOREBOARD`): the maths moved out of the script. `sessionPart` (replay one session: groups, sigma, typical moves) and `summarize` (labels applied, families, recall) are separate so the view can replay one session at a time and keep each result. Label matching is injected (`{labelFor, labelMatches}`): the script passes the one in `analyze-episodes.mjs`, the app the one in `reader-tools.js`.
- `src/js/scoreboard-view.js`: sessions are the Saved recordings (IndexedDB, `RC.rows`), labels are `RT.labels`.

## Not here
Changing thresholds, keep / drop verdicts, replay inside a worker (the page is busy while a session replays; a night's session takes seconds, hence the one-at-a-time replay with a pause between).
