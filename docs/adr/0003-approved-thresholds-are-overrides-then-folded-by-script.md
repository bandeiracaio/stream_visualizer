# 3. Approved thresholds are local overrides, recorded in dated files, folded into the defaults by a script

Status: accepted

Approving a proposal applies the value at once as a local override on that device and downloads a revision file
(Markdown plus a fenced JSON block) that the user commits to `docs/revisions/`. Resetting an override downloads a revert file.
`node fold.mjs` later rewrites the matching defaults in the source and marks each file folded, so the next release carries the
value to every device. The register export carries overrides, but an import only lists them and applies them after the user agrees.

Why: the app is one file on two devices and browser storage does not sync, so the release is the transport. A script
(rather than a hand edit or a build-time layer) leaves a reviewable diff, stays correct across 20 keys and two config
objects, and refuses a file that does not fit the current defaults.

Consequences: an override clears itself only when it equals the built-in default; if a release changes a default the user has
overridden, the override wins and the panel shows both. A drift in a family's firing rate that follows an approval touching
that family is labelled as expected and makes no proposals, and the segment containing the approval does not vote on that
family's output.
