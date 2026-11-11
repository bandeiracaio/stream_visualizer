# Offline scripts at the repo root

Scripts at the root are not part of the app and never need a release. Finished studies (collectors, wallets, liquidations, venue lead-lag, basis / funding / OI, inventory, labels, scoreboard) are in `archive/`; see `archive/README.md`. They may no longer run.

## Kept

- `compare-detections.mjs`: replays saved sessions through two versions of the Reader (working tree or a git revision via `--rev-a` / `--rev-b`, plus `--cfg-a` / `--cfg-b`) and reports every difference in the episode groups and signals as exact JSON; exit code 1 when anything differs. `--groups-only` / `--signals-only` restrict it. This is the "byte-compare detections before and after" check (`--rev-a HEAD` compares your edit with the last commit). `--selftest`.
- `design-harness.mjs` and `sample-designs.mjs`: the trade-system study. The sampler draws designs from `.scratch/trade-system/mapping-v3.csv`; the harness is a thin wrapper since Trader step 3: `toSystem(design)` converts a sampled design to a system object and `src/js/system-core.js` (`SYSTEM`) makes the trades from the session's snapshots (cached per session in `.scratch/trade-system/cache-snap/`), with the harness's execution model on top (entry one latency after the trigger, fixed round-trip cost). Same command line, hold-out protection and `--designs-file`; `--legacy-facts` is the comparison mode that feeds the core the old batch harness's look-ahead facts. Spec `.scratch/trade-system/sampling-design.md`. Both take `--selftest`. The old batch version is `archive/design-harness-batch.mjs` (may stop running).
- `build.mjs`: the build (see `CLAUDE.md`).

## Shared helpers (`lib/`)

- `lib/session-io.mjs`: `readInput` (session or tape file to `{records, inputs, ...}`).
- `lib/sigma.mjs`: `sigmaOf`, `sideDir`, `forwardMove` (sigma as in ADR 0004).
- `loadEngine` lives in `compare-detections.mjs`.

## Pre-registered studies

A plan lives in `.scratch/<study>/plan.md`; a change is an amendment in that file. The four registered tests that were never run are closed (amendment 2026-11-10); see `archive/README.md`.
