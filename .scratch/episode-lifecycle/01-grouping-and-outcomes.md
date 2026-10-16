# Episode groups and end outcomes (release v015)

Status: built (v015)

## Goal
One real phenomenon shows up once in the timeline and cards, not once per venue and horizon, and each ended episode says what price did afterwards.

## Decisions (grilling)
- Order: this step first (lifecycle), evidence items second (02), so a change in detections can be attributed.
- Per-track episodes (family|venue|horizon|side) stay exactly as they are. The register, drift and proposals depend on them, and the byte-compare rule is easiest to satisfy that way.
- Add a derived **group** layer linking per-track episodes of the same family and aggressor side that overlap in time across `bn`/`hl` (cross-venue) and `fast`/`mid` (cross-horizon). Timeline and Reader cards show one row per group, with members listed inside.
- Agree/disagree/missed labels attach to the group. The group stores its primary (earliest-detected) episode id so labels stay replayable; old labels on single episodes still load.
- New end outcome, attached after the fact and never feeding back into any detection: `resolved-with`, `resolved-against`, `flat`, measured on price progress in sigmas over a look-ahead window. New tunables: `outcomeLookMs` 30000, `outcomeFlatSigma` 0.5. Wall outcomes keep their existing meaning.
- Old recordings, registers, reviews and label files load unchanged; every new field is optional.
- Out of scope: resume (`resumeMs`) per family/horizon and start back-dating changes; leave to register tuning.

## Acceptance
- Self-test scenarios: a phenomenon on both venues yields one group with two members; fast+mid of one phenomenon yields one group; unrelated episodes stay separate; outcomes tagged correctly for with/against/flat price paths; a v014-shaped record loads.
- Before/after byte-compare of per-track detections on all simulated scenarios: identical (groups and outcomes are additive). Any difference is a bug.
- Group overlap rule (time overlap tolerance) is a named tunable in `DEFAULTS`, documented here when chosen.
- `node build.mjs` passes, then `--release` as v015. UX steps outside the Reader tab untouched.

## As built
- `groupGapMs` 10000 (overlap tolerance), `outcomeLookMs` 30000, `outcomeFlatSigma` .5 in `READER_EPISODES.DEFAULTS`. Not in the register `LINKS`: they are not detection thresholds.
- The end tag is `resolution` / `resolutionSigma` on the episode (the existing `outcome` field keeps its meaning: faded, pulled, gap...). Only episodes that ended `faded` are tagged; gap/closed/disabled and walls are not. It uses the engine's 1 s price history (`priceAt`). A resumed episode loses its tag.
- Groups: `engine.episodeGroups()`, derived on every call. Edges need the same family and aggressor, a different venue or horizon, and overlapping spans within `groupGapMs`. Id is `g<primary id>`, primary = earliest detected. Walls are groups of one.
- Labels on a group use venue `any` when it spans venues, plus an optional `group` field; matching still goes through any member, so old labels work.
- Proof: 66 existing self-test scenarios dumped (events, per-track episodes, register snapshot) before and after: byte-identical. 7 new scenarios added.
- Live page checked (v014-style simulated session fed into the real dev build in Chrome): group cards, member breakdown, resolution text, timeline bars, tapping a bar, and agree on a group (label matched both member episodes) all work. The "episode resumes" clearing of a resolution is coded but has no scenario. A v014-shaped record needs no migration because no stored format changed.
