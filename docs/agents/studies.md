# Offline studies and analysis scripts

Scripts at the repo root, not part of the app and never needing a release. Every one takes `--selftest`. `--plan` prints the plan fixed in advance (`analyze-collectors`, `analyze-wallets`, `analyze-liquidations`). The rules for pre-registered studies are in `CLAUDE.md`.

**Descriptive** below means: it says where to look, never keep or drop, and its numbers are small-sample.

Shared helpers, so a change to one reaches every script that imports it: `readInput`, `rng`, `FEATURES` in `analyze-collectors.mjs`; `loadEngine` in `compare-detections.mjs`; `labelMatches` / `labelFor` in `analyze-episodes.mjs`; `scoreboard` in `reader-scoreboard.mjs`; `sigmaOf` / `forwardMove` in `src/js/scoreboard-core.js` (read by `analyze-wallets`, `analyze-liquidations` and the scoreboard).

## Check a Reader change

- `compare-detections.mjs`: replays saved sessions through two versions of the Reader (working tree or any git revision via `--rev-a` / `--rev-b`, plus `--cfg-a` / `--cfg-b`) and reports every difference in the episode groups and signals as exact JSON; exit code 1 when anything differs. This is the "byte-compare detections before and after" check (`--rev-a HEAD` compares your edit with the last commit).
- `reader-scoreboard.mjs` (descriptive; `--cfg` tries other settings): per family, the price move after detection at 1 / 5 / 15 minutes in sigmas (signed in the side's direction, beside the typical |move| at random moments), precision (agree / (agree + disagree), Wilson interval, per day) and recall among what you called real (agree + missed; a missed label counts as found when the replay now has a matching group). A rate with fewer than 8 labelled groups is not shown.
- `reader-robustness.mjs` (descriptive; never changes a detection): the randomized-parameter test. Keeps the saved sessions fixed, draws many configurations with the episode thresholds each scaled by a random factor within `--spread` (default 25%, seeded; `--cfg` sets the centre, e.g. a proposed threshold), replays every session under each, and shows per family the base value and the 5th / 50th / 95th percentile of group count, forward move (sigmas) and precision (`--labels`), plus the share of runs that hold. A result that survives is not hanging on exact threshold values; a collapse means it is. Slow (one replay per session per run): start with few sessions or `--runs 20`.

## Collectors and episodes

- `analyze-collectors.mjs`: reads downloaded tapes (`tape_*.json`) and saved sessions (`session_*.json.gz`) and prints per-collector coverage, the lead-in of an auto-recording, numeric fields that never change, and an evaluation of 21 features against the next 5 minutes of Binance mark volatility under the fixed `PLAN` in the script: partial rank correlation controlling for the previous 5 minutes' volatility, circular-shift permutation p-values, a correction for the number of features, and a time split into a deciding half and a confirming half. `--merge` joins several tapes and sessions (identical records counted once); since 2026-11-08 it reads one session at a time and skips `inputs`, so all 212 sessions fit (about 5 minutes, 1.5 GB heap; a field's `distinct` count stops at 2000). The full result is in `.scratch/new-collector-gate/evaluation-20261108.md` (all 21 features: nothing). It takes record names and usual intervals from `COLLECT.OWNER` / `EXPECT_MS` (derived from `COLLECT.REGISTRY`, see `docs/agents/source-map.md` § Collectors); the `FEATURES` list inside it needs a line for a new collector.
- `analyze-episodes.mjs` (descriptive): replays saved sessions through the Reader engine (default thresholds, or `--cfg`), takes the episode groups, looks up what each collector read when each was detected (as a percentile against all collector data given; `--tape` adds reference data), and contrasts the groups you agreed with against those you disagreed with (`--labels reader_labels.json`, from Export labels) and the two most common outcomes of a family, with permutation p-values corrected for the number of features.

## Exploratory studies on the saved sessions (2026-11-08)

All descriptive, not pre-registered: they say where to look, never keep or drop. Each reads sessions one file at a time (the sessions are 584 MB gzipped), takes `--selftest`, and has its plan (with amendments) and findings beside it.

- `analyze-venue-leadlag.mjs` (`.scratch/venue-leadlag/`): which venue's price moves first (lead index at 1 / 5 / 30 s against the Binance perp, with a placebo of Binance sampled like the `venues` records) and whether a venue's price gap to Binance predicts its next 60 / 300 s move in sigmas. The 2 s `venues` cadence makes 1 s unreadable. At 5 s the Binance spot, Hyperliquid, OKX spot and Bybit spot lag the Binance perp; the gap predicts nothing.
- `analyze-basis-funding.mjs` (`.scratch/basis-funding-oi/`): basis, funding spreads, open-interest change and long/short ratios against the next 5 / 15 minute move (size, direction, continuation) and Binance liquidation dollars. Partial rank correlation controlling for past volatility, circular-shift permutation, an earlier half that explores and a later half that checks. Nothing confirmed; funding against direction is the only lead. The liquidation part uses only sessions before the liquidation plan's cutoff.
- `inventory-sessions.mjs` (`.scratch/data-inventory/`): one row per session (span, kind, quality, per-collector state, which collectors exist from when, liquidation counts, health gaps) and totals: what each kind of analysis can use. Counts only, no outcomes. It counts "after the cutoff" by `startedAt`, which may differ slightly from `analyze-liquidations.mjs`.

## Pre-registered studies

- `analyze-wallets.mjs`: the wallet study (plan `.scratch/wallet-study/plan.md`, registered 2026-11-05 before the first run on real sessions). Reads saved sessions, learns two wallet classes (persistent, hot by 10 s markout) on the first 40% of recorded hours, and tests 11 features of Hyperliquid taker wallets per 5-minute window against the next 5-minute move (sigmas) on the next 30% (decide, Holm-corrected) and last 30% (confirm).
- `analyze-wallets-persistence.mjs` (exploratory, written after the registered result; notes `.scratch/wallet-study/persistence-20261105.md`): asks whether wallets with a good 10-second markout in block A stay good in B + C (rank correlation, hot cohort against random cohorts, deciles, baseline A first half -> second half).
- `analyze-liquidations.mjs`: the liquidation reversal study (plan `.scratch/liquidation-study/plan.md`, registered 2026-11-06 before any test-set session existed). Only sessions that started after the plan's cutoff count (the 166 earlier sessions are the exploration set: their outcomes were seen). `--status` shows test sessions, clusters and pairs and no outcome, so progress can be watched. Uses `LIQ` (`src/js/liq-core.js`); Bybit and OKX liquidations come from the `liqPerp` records (v122 and later).

## Labelling

- `panel-label.mjs`: panel labelling for triage. `packets` builds blinded packets of episode groups (no outcome, resolution, stage, absolute time or price after the end) and a shuffled file per voter; subagent voters each write `votes_N.json`; `tally` counts a group real / not-real only when the voters are unanimous, otherwise contested (`--agree N` relaxes that), and writes `panel_labels.json` (`src: "panel"`, never merged into the user's labels). The wording the voters get is `RUBRIC` in the script (a wall counts only if it held and was tested or price reacted). Output goes to `panel/` (gitignored). To measure agreement with you, run `tally --labels reader_labels.json`.

## Trade-system study and data download

- `sample-designs.mjs` and `design-harness.mjs`: the trade-system Monte Carlo study. The sampler draws trade-system designs from the pool `.scratch/trade-system/mapping-v3.csv`; the harness replays one design (one trigger, one exit, one stop) on saved sessions. Spec `.scratch/trade-system/sampling-design.md`.
- `venue-volume-history.mjs`: downloads free public historical BTC trade data (no accounts or keys) and prints per-venue volume.
