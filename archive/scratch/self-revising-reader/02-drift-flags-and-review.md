# Self-revising Reader, Part 2: drift flags + review screen

Status: built (v008). Detections are untouched; the judge only reads session summaries.

## Decisions (grilling rounds 1-3 of Part 2)
- Reference: the K=5 counted sessions just before the candidate, frozen while a drift is building; plus the written prior where one exists (share, ret).
- Unit of evidence: the session segment (seconds are autocorrelated). Effect size from 6 quantiles.
- Differs if: median shift > 0.5 IQR, OR spread ratio outside [0.6, 1.667], OR p5/p95 tail shift > 1 IQR (reference IQR).
- M=3 differing sessions in a row confirm a drift. The reference then restarts from those sessions and needs K again. User can acknowledge or undo (undo drops the sessions as an anomaly).
- Scope: the seven measured variables only. Detector firing-rate drift is the next addition.
- Time of day: start hour/weekday stored per session; no regime split. Weekly review looks for flags that line up with the hour.
- Runs are cut into 1 h segments (own run id shown); a session needs >= 10 min, a variable >= 300 samples, to vote.
- Running segment is previewed against the band, labelled as not voting.
- Settings are editable on the review screen; each change is logged (old -> new, date).
- Badge on the Reader group for unacknowledged drifts; nothing on Overview.
- Weekly report: "Export review report" writes a markdown file to drop into `.scratch/`, with an exported register next to it.

## Code
- `src/js/reader-drift.js` (pure): `evaluate`, `judge`, `effect`.
- `src/js/reader-register.js`: segments, run id, hour/dow, history, settings, `review()`, `ack()`, `undo()`, `setSetting()`.
- `src/js/reader-tools.js`: review panel, settings, history, report, badge.

## Not yet
- Per-variable min-sample value (300) is a first guess; tune in the weekly review.
- Report layout is a first draft; revise after the first real week.
- Next: Part 3 (threshold proposals + replay comparison + dated revision log in the repo), and detector firing-rate drift.
