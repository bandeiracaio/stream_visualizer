# Analysis lab (Analysis area)

Status: draft, agreed direction, nothing built yet.

A lab where the user and the agent keep the analysis of our data. Goal now: turn raw / semi-treated data (saved sessions, tapes, collector `ext`) into microstructure bars and price / volume events, and find enough patterns in space (feature space) and time (when they recur) to cluster them. Goal later: predict price. Quantitative and discretionary are both welcome; the user prefers statistical and causal thinking.

## Decisions (from the user)

- **Heavy compute runs offline on the PC** (Node `.mjs` scripts in the repo root, like `analyze-*.mjs`). The app never has to run an experiment.
- **Conclusions are stored as files and shown in the app on phone or PC** without re-running anything. The tab is a viewer of stored results (read-only, display only, no effect on the engine or detections).
- **Unit of analysis: microstructure bars + events.** Raw feeds become event-time bars (dollar / volume bars, not only clock time) with a feature vector each, plus tagged price / volume events. Clusters are made over bars and events.
- **Findings are notes files in the repo**, exported / imported like weekly-review revisions, versioned in git.

## Pieces

1. `lab-core.mjs`-style shared pure core (self-tested), importable by the scripts and, for the parts the viewer needs (formatting, reading entries), by a browser file. Same pattern as `COLLECT.FEATURES`: one list of bar features, shared.
2. **Bars** (`lab-bars.mjs`): from a session's `inputs` (+ `ext`): dollar-bar boundaries, per bar: duration, signed taker flow (aggressor / passive side language, no bull/bear), imbalance, trade count, depth near the touch and its change, spread, return in sigmas (sigma per `docs/adr/0004`), realised volatility, collector context where present.
3. **Events** (`lab-events.mjs`): price jumps (sigma-scaled), volume spikes, sweeps, depth collapses / refills; each with time, size, and the bar it sits in. Separate from Reader episodes and signals (the engine stays untouched); the lab may compare against them.
4. **Clustering and pattern search** (`lab-cluster.mjs`): standardise features (robust), reduce if needed, cluster bars and events (start simple: k-means / hierarchical with stability across seeds and across time halves), and describe each cluster: size, typical features, when in the day it occurs, how it follows another cluster (transition matrix), forward move distribution in sigmas at fixed horizons. Small-sample honesty as elsewhere: a rate or cluster below a minimum count is not reported as a finding.
5. **Causal / statistical checks**: a plan fixed in advance for each experiment (as `PLAN` in `analyze-collectors.mjs`), permutation tests that respect autocorrelation, correction for the number of things tried, a deciding half and a confirming half in time, controls for the obvious confounder (the previous window's volatility). Language: "associated with, after controlling for", not "causes", unless an intervention-like design supports it.
6. **Lab notebook entries**: one JSON file per experiment in `docs/lab/` (`lab_<date>_<slug>.json`, kind `sv-lab-entry`): question, data used (files, time range, counts), method and parameters (enough to re-run), compact results (tables, small series, cluster summaries, chart data already reduced), the plan and whether it held on the confirming half, and a free-text verdict by the user / agent (`confirmed`, `rejected`, `inconclusive`, `idea`). Small by design (results only, never raw data), so the app can bundle them.
7. **Analysis tab** (new area `Analysis` in `GROUPS`, view reads entries, display only): list of entries with verdict and date, an entry page (question, method, results as tables / charts, verdict, how to re-run), filters by verdict. Entries are baked into the release at build time (build reads `docs/lab/*.json`, like the other included sources), so they work offline on a phone. Import of a new entry file in the app is a later nicety, the repo flow is first.

## Steps (each its own release, UX steps leave the engine alone)

1. Entry format + viewer: `docs/lab/` schema, build embeds entries, Analysis area with list and entry page, one hand-written sample entry (clearly marked as a sample). No computation.
2. Bars: `lab-bars.mjs` from a saved session, self-test on a simulated session (known flow gives known bars), writes a first entry (bar coverage and feature distributions on real recordings).
3. Events: `lab-events.mjs`, self-test, an entry with event counts and how they relate to Reader episodes.
4. Clustering: `lab-cluster.mjs`, stability checks, first entry with clusters, transitions and forward moves, with the fixed plan and the confirming half.
5. Discretionary layer: user labels on clusters / bars ("this is what I call X"), stored in entries.
6. Later: prediction experiments on top (forward move given cluster and context), with the same plan discipline.

## Open points

- Which venue is the primary price for bars (Binance mark vs trades), and bar size (dollar value per symbol, chosen from the data so a bar is about N seconds typical).
- How much recorded data exists to cluster (check coverage with `analyze-collectors.mjs` before step 2).
- Whether charts in entries are drawn by the app from reduced data (preferred, themed, offline) or stored as images (no).
