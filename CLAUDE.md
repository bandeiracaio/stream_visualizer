## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Build

The app ships as ONE self-contained HTML file (must run offline-capable from a phone or PC, no external assets). Source lives in `src/` (`index.html` with `<!--@include path-->` markers, `styles.css`, `js/*.js`). Never edit the built HTML by hand.

- `node build.mjs` runs the Reader self-test, then writes `dist/stream-visualizer.html` (dev build).
- `node build.mjs --release` writes the next `stream-visualizer_vNNN.html` in the repo root (never overwrites an existing version). Release after each finished step so the user always has an up-to-date single file.
- Scope: each piece of work is its own step and its own release. UX steps leave the Reader engine, trading/paper-broker and feed logic alone; note anything else spotted instead of changing it. Feature steps (Overview, then the Reader redesign) may touch the engine, which must stay pure, DOM-free and replayable, with self-test scenarios added for new behaviour.
- Reader redesign direction (agreed): detect *episodes* (forming -> active -> fading -> ended, resumable) instead of one-off events; report detected time and back-dated start; multi-variable evidence checklist per episode; neutral participant language (aggressor / passive side), no bull/bear; first families: absorption, exhaustion, aggression burst, wall; validate with session record/replay, a span timeline, and agree/disagree labels.

- Self-revising Reader (specs in `.scratch/self-revising-reader/`, language in `CONTEXT.md`, decisions in `docs/adr/`): the Reader measures its own assumptions, flags drift, proposes threshold changes, and the user approves them. The register/drift/proposal code never changes a detection by itself; only an approved threshold does. Sigma (`sigmaBps`, the scale of normal price movement) and its static expectation are described in `docs/adr/0004` and `.scratch/self-revising-reader/04-sigma-scale.md`; old register files from before v012 are on the wrong scale. Before touching the episode layer's evidence cut-offs, byte-compare detections on simulated scenarios before and after (the refactors so far were proven this way).
- Weekly review: the user exports a review report and register from the Reader tab. Approving or resetting a threshold downloads a revision file; the user drops it into `docs/revisions/`. Before a release run `node fold.mjs --check`, then `node fold.mjs`, review the diff, `node build.mjs`, then `--release`. `fold.mjs` rewrites the matching defaults in `reader-engine.js` / `reader-episodes.js` and marks each file `Folded: yes`; it refuses a file that does not fit the current defaults.

## Source map

- `src/js/reader-drift.js` (pure): judges drift per variable from session summaries. `src/js/reader-proposals.js` (pure): percentile maps, threshold proposals, replay verdict. `src/js/reader-register.js` (pure): assumption register, baselines, sessions, drift history, proposals, approvals and overrides; fed by the engine. `LINKS` there maps each threshold to the quantity it is compared with.

- `src/js/reader-episodes.js` (pure): episode state machines and evidence checklists for absorption / exhaustion / burst / wall. Tunables in `READER_EPISODES.DEFAULTS` (also `READER.cfg.ep` at runtime).
- `src/js/reader-engine.js` (pure): order-flow engine and the legacy one-off event detectors; drives the episode layer once a second. Recording is `startRecording({quoteMs})`; replay is `READER_ENGINE.replayEngine(inputs, cfg)`.
- `src/js/reader-selftest.js`: simulator scenarios; the build runs them and fails if any fail. Add a scenario for any new engine behaviour.
- `src/js/overview.js`: Overview (home) view. `src/js/app.js`: feeds, charts, navigation, Reader cards. `src/js/reader-tools.js`: record/save/load/replay, threshold tuning, timeline, agree/disagree/missed labels (loaded last, called from `renderReader`).
- Testing UI: serve `dist/` with `python -m http.server`, drive it with the Chrome tools; the window does not resize the viewport, so test phone width through a 390px iframe. Hidden tabs throttle requestAnimationFrame to ~1 fps, which makes rendering look stale.
