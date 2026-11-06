# Scoreboard view (Review > Scoreboard)

Status: ready-for-agent. Display only: never changes a detection.

## What
The numbers `reader-scoreboard.mjs` prints, readable in the app (phone included): per family, the price move after detection at 1 / 5 / 15 minutes in sigmas (median, share that went with the side, split by agree / disagree / not labelled, beside the typical |move| at random moments), precision with a 95% Wilson interval in total and per UTC day, and recall among what was called real.

## How
- `src/js/scoreboard-core.js` (pure, self-tested; `SCOREBOARD`): the maths moved out of the script. `sessionPart` (replay one session: groups, sigma, typical moves) and `summarize` (labels applied, families, recall) are separate so the view can replay one session at a time and keep each result. The script imports the same core, so the two cannot drift. Label matching is injected (`{labelFor, labelMatches}`): the script passes the one in `analyze-episodes.mjs`, the app the one in `reader-tools.js`.
- `src/js/scoreboard-view.js`: sessions are the Saved recordings (IndexedDB, `RC.rows`), labels `RT.labels`, thresholds `rtCfg()` (the current ones, approved overrides included; the script uses defaults unless `--cfg`). A "Compute" button (never automatic: a night's session takes seconds to replay). Parts are cached per file and thresholds, so only a new recording is replayed next time; changing labels needs no replay.
- Small samples are the rule: every number shows its n; a rate with fewer than 8 labelled groups says "too few".

## Not here
Changing thresholds, keep / drop verdicts, replay inside a worker (the page is busy while a session replays; sessions are replayed one at a time with a yield between them).

## Checks
Script output on saved sessions identical before and after the move; build self-test scenarios for the core.
