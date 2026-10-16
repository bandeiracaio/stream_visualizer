# New evidence items (release v016)

Status: built (v016)
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

## As built
- Absorption `fills` (weight 1, not a gate): the largest single trade (either side, from the ring buckets' `maxTrade`) as a share of the window's flow must be at most `absConc` .2. Quantity `conc`. Either-side is a limit: the buckets do not keep the largest trade per side.
- Exhaustion `count` (weight 1, not a gate): trades in this window over trades in the window before, at most `exhCount` .5. Quantity `countRatio`. Counts both sides, for the same reason.
- Wall `repost` (display only: wall episodes are not scored from their items): the wall dipped to `wallDip` .7 of its peak or lower and came back to `wallBack` .9 or more, counted on the engine's wall tracker (`reposts`); the item needs `wallReposts` 2. Quantity `reposts`, observed once a second per live wall episode (`reposts.book`).
- Register: `conc` and `countRatio` added to `QDEF` (fast and mid), `reposts.book` added, three new `LINKS` (`absConc`, `exhCount`, `wallReposts`). They draw from a second seeded generator (`seed2`, saved in the register file as an optional field), so older variables' samples are unchanged. Old register files load as before.
- No item is `n/a`: each input exists whenever its family is evaluated.
- Defaults are plain `key:value` entries, so `fold.mjs` can rewrite them (tried on a copy: `absConc` .2 -> .15).
- Byte-compare of the 66 older self-test scenarios against v014: legacy events identical, episode timing and outcomes identical, register snapshots of the older variables identical. Only episode scores moved: bid-wall-eaten absorption (mid) .90 -> .83, absorption in the resume/3a/3b scenarios .90 -> .91, exhaustion (fast) .76 -> .78. No threshold was crossed differently.
- 4 new scenarios (77 in total pass). Live page checked: the absorption fills row, the wall re-post count and the new register rows appear.
- The default thresholds are guesses written before measuring (in simulated data the largest trade is under 1% of the flow, so `fills` passes easily). Real sessions decide whether they need a revision.
