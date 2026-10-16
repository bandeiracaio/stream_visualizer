# New evidence items (release v016)

Status: ready-for-agent
Blocked by: 01

## Goal
Add evidence the checklists lack, using only inputs the engine already has (no new feed).

## Decisions (grilling)
- Absorption: trade-size distribution (many small versus few large fills).
- Exhaustion: trade-count decay (count, not just notional, versus the window before).
- Wall: re-posting after being hit (iceberg-like behaviour).
- Every new item follows the register convention: a named tunable in `READER_EPISODES.DEFAULTS`, a `LINKS` entry in `reader-register.js`, a value in the episode's `quants`, and an observed baseline, so the self-revising loop has no unmeasured threshold.
- Weights and gate status chosen so existing scenarios are unchanged where the item cannot apply (item is `na` when its input is missing). Where a scenario's detections change, list each one and why in the release note.
- Reader tab only. No Overview, paper broker or feed changes.

## Acceptance
- New self-test scenarios per item (item true, item false, item n/a).
- Byte-compare detections before/after on all existing scenarios; document every difference.
- Register/drift/proposal paths handle the new variables; old register files still load.
- `node build.mjs` passes, then `--release` as v016.
