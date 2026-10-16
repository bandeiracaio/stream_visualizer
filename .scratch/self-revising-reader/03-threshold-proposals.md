# Self-revising Reader, Part 3: threshold proposals, replay comparison, revision log

Status: 3a built (v009), 3b built (v010), 3c built (v011). Part 3 is complete.

## Decisions (grilling rounds 1-2 of Part 3)
- Derivation: register the quantities detectors compare against thresholds; a proposal is the same-percentile rule (where the current number sat in the old reference, moved to the same percentile of the new one). Clamped to the new reference's observed p1-p99 range so it never extrapolates. Direction is irrelevant to the rule (it is a percentile, not a tail).
- Evidence base: several saved session files loaded at once; a proposal is replayed over all of them against all labels; results aggregated and per session.
- Triggers: a confirmed drift in a linked quantity, or in what the Reader outputs (episodes started per hour and median episode length, per family). Labels judge a proposal; they never trigger one.
- Measured every calibrated second, unconditionally, both sides pooled, whenever the window had enough trades to be evaluated.
- Readiness: "safe" when no label count gets worse across >= 2 sessions and >= 10 labels, else "unproven". Either can be approved; the verdict is written into the revision file.
- Approval: local override in browser storage plus a dated file `docs/revisions/YYYY-MM-DD-<slug>.md`; the next release folds it into the code defaults and the override clears.
- One pending proposal per threshold; a proposal exists only after a confirmed drift on its linked quantity and a built reference.
- ADR 2 amended (snapshot is provenance; replay toggles threshold sets).

## 3a (built, passive)
- The hard-coded evidence cut-offs are named in `READER_EPISODES.DEFAULTS`: recentShare .55, recentPace .5, crossShare .6, crossZ 2, burstLiq 2, burstSweeps 3, exhDecay .5, exhWasZ 1.5, exhWasShare .55, exhGap 1, exhSize .75. Proven behaviour-neutral: identical events and episodes on six simulated scenarios before and after (byte-compared).
- Registered per venue and horizon (fast, mid): aggressor share, rate z, price progress, path efficiency, depth refill, recent share, recent pace, liquidations, sweeps, cross-venue z, decay, prior-window z, prior dominant share, gap to the 5-minute extreme, late progress, trade-size ratio; plus the largest book level vs the median level (per venue).
- Registered per segment: episodes started per hour and median episode length, per family (4 families).
- `LINKS` in `reader-register.js` maps 20 thresholds to their quantity. Known imperfection: `absorbSigma` is also used for the cross-venue progress check and the exhaustion "late progress"; it is linked to `prog` only.
- The drift judge has a scalar path (firing rate, length): reference median and IQR of the last K segment values, unit never below a quarter of the median and at least 1; new settings `scalarShift` 1.5 and `minEpisodes` 3.
- Not linked (legacy one-off detectors, untouched): inline numbers in `bursts()` and the legacy event detectors.

## 3b (built, v010)
Decisions added in grilling round 3b:
- A proposal appears at confirmation, built from the drifted sessions pooled as "new" (provisional). Value stays frozen; "Recompute" rebuilds it from the first K sessions after the drift. Undo on the drift withdraws its proposals; Acknowledge keeps them; they expire after 30 days of exchange time.
- Tails: each segment keeps its 10 largest and smallest values for the linked quantities (latest 60 segments), so a threshold beyond p99 is placed from real extremes.
- A drift in any horizon or venue triggers it; the proposed value is the median across venues and horizons; each linked threshold gets its own proposal (one pending per threshold; a newer confirmation supersedes).
- A rejected proposal is recorded (optional reason) and not re-proposed for the same drift.
- A firing-rate drift builds proposals from the same time split; if the linked quantities did not move enough, the drift gets a note ("points at structure, for the weekly review") and no proposal.
- Replay check: up to 8 files, streamed one at a time (current thresholds, each proposal, and all pending proposals together, each in chunks with progress). Only counts are kept. Recordings are tagged before/after the drift by their first input time vs the first drifted session.
- Verdict "safe" needs: >= 2 recordings, >= 10 of your labels inside them, no label count worse, firing rate no farther from the usual, at least one recording from after the drift, and a change of 50% or less. Otherwise "unproven" and the failed conditions are listed.
- Which families a threshold affects (for the firing-rate check) is the `fams` field of each LINKS entry (read from the code: crossShare is only used by absorption, absorbSigma by absorption and exhaustion).

Code: `src/js/reader-proposals.js` (pure: percentile maps, build, verdict), register (proposals, tails, recompute/reject/oldRates), engine `feed` (chunked replay), `reader-tools.js` (panel, replay runner, report section).
Caveats: an unlabeled recording gives firing-rate evidence only; with fewer than 10 labels no proposal can reach "safe". Replay time scales with recording length (about 3 s per 30 minutes per configuration on a PC).

## 3c (built, v011)
Decisions from grilling rounds 3c:
- Approve applies the value at once on this device (no segment cut, no reference restart). Guard instead: a drift in a family's rate or length that follows an approval touching that family is labelled "follows your approval of X" and makes no proposals; the one segment containing the approval is left out of that family's output votes. Market-side variables are untouched.
- Approve is enabled only after a replay check for the proposal's current revision (and since the last approval, which makes every other check stale). "Unproven" needs a second tap that lists the failed conditions. "Approve all together" needs a fresh together-replay and records one group.
- Revision file: Markdown with a fenced JSON block (kind "approval" or "revert"), `docs/revisions/YYYY-MM-DD-<key>[-<group>].md`, `Folded: no` until folded.
- Overrides live in the register state (browser storage); register export carries them; import lists them and applies only on agreement. An override wins over a changed built-in default (both shown); it clears itself when equal to the default.
- Reset to default per override, with an optional reason, downloads a revert file.
- `node fold.mjs [--check] [--root DIR]` applies unfolded files in time order, only if each default still holds the file's `from`; nothing is written unless every file fits.
- Tested: register approve/reset/settle/import/save-load and the follows-approval guard in self-tests; the browser flow (disabled until checked, arm and confirm, override applied and persisted across reload, stale checks, revert file, import prompt); `fold.mjs` on a synthetic folder (approval, revert, idempotence, stale file refused). Fixed a bug found that way: the source writes `.65`, not `0.65`.

Not done: pulling revision files onto a second device without a release; approving drift settings or structure (weekly review matters).
