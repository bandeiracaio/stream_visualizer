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
- Publishing: the repo is public and `.github/workflows/pages.yml` serves the newest `stream-visualizer_vNNN.html` in the repo root as the GitHub Pages site (https://bandeiracaio.github.io/stream_visualizer/) on every push to `main`. So after `--release`, commit and push; unreleased `src/` work never goes live. Pages caches for about 10 minutes, so a phone may need a reload to see a new version.
- Line endings are mixed: `app.js`, `reader-episodes.js`, `reader-register.js`, `reader-tools.js` are CRLF, the rest LF. Edit without converting (Python `open(..., newline="")`), then check `git diff --stat`: a whole-file diff means the endings changed.
- Scope: each piece of work is its own step and its own release. UX steps leave the Reader engine, trading/paper-broker and feed logic alone; note anything else spotted instead of changing it. Feature steps (Overview, then the Reader redesign) may touch the engine, which must stay pure, DOM-free and replayable, with self-test scenarios added for new behaviour.
- Reader redesign direction (agreed): detect *episodes* (forming -> active -> fading -> ended, resumable) instead of one-off events; report detected time and back-dated start; multi-variable evidence checklist per episode; neutral participant language (aggressor / passive side), no bull/bear; first families: absorption, exhaustion, aggression burst, wall; validate with session record/replay, a span timeline, and agree/disagree labels.

- Self-revising Reader (specs in `.scratch/self-revising-reader/`, language in `CONTEXT.md`, decisions in `docs/adr/`): the Reader measures its own assumptions, flags drift, proposes threshold changes, and the user approves them. The register/drift/proposal code never changes a detection by itself; only an approved threshold does. Sigma (`sigmaBps`, the scale of normal price movement) and its static expectation are described in `docs/adr/0004` and `.scratch/self-revising-reader/04-sigma-scale.md`; old register files from before v012 are on the wrong scale. Before touching the episode layer's evidence cut-offs, byte-compare detections on simulated scenarios before and after (the refactors so far were proven this way).
- Weekly review: the user exports a review report and register from the Reader tab. Approving or resetting a threshold downloads a revision file; the user drops it into `docs/revisions/`. Before a release run `node fold.mjs --check`, then `node fold.mjs`, review the diff, `node build.mjs`, then `--release`. `fold.mjs` rewrites the matching defaults in `reader-engine.js` / `reader-episodes.js` and marks each file `Folded: yes`; it refuses a file that does not fit the current defaults.

## Source map

- `src/js/reader-drift.js` (pure): judges drift per variable from session summaries. `src/js/reader-proposals.js` (pure): percentile maps, threshold proposals, replay verdict. `src/js/reader-register.js` (pure): assumption register, baselines, sessions, drift history, proposals, approvals and overrides; fed by the engine. `LINKS` there maps each threshold to the quantity it is compared with.

- `src/js/reader-episodes.js` (pure): episode state machines and evidence checklists for absorption / exhaustion / burst / wall. Tunables in `READER_EPISODES.DEFAULTS` (also `READER.cfg.ep` at runtime). Recent detection changes: walls merge by price (`wallMergeBps`, `wallMergeMs`) and have a minimum size (`wallMinUsd`); exhaustion requires price near the extreme now (`exhNear`); flow z-scores use `zOtherFrac` and `zCap` (engine cfg). Fast and mid readings of one event are separate episodes on purpose; the groups layer (`groupGapMs`) presents them as one.
- `src/js/reader-engine.js` (pure): order-flow engine and the legacy one-off event detectors; drives the episode layer once a second. Recording is `startRecording({quoteMs})`; replay is `READER_ENGINE.replayEngine(inputs, cfg)`.
- `src/js/reader-landscape.js` (pure): grid maths for the Flow landscape (3D surface, playhead = time). `src/js/reader-landscape-view.js`: its drawing and controls; read-only, hooks `renderReader`, loaded last. Spec in `.scratch/flow-landscape/`.
- `src/js/reader-selftest.js`: simulator scenarios; the build runs them and fails if any fail. Add a scenario for any new engine behaviour.
- `src/js/overview.js`: Overview (home) view. `src/js/app.js`: feeds, charts, navigation, Reader cards. `src/js/reader-tools.js`: record/save/load/replay, threshold tuning, timeline, agree/disagree/missed labels (loaded last, called from `renderReader`).
- `src/js/auto-record-core.js` (pure, self-tested): volatility from the mark price and the start/stop decision of auto-record; `src/js/auto-record.js`: its view, loaded last. Spec in `.scratch/auto-record/`.
- `src/js/recordings.js`: Saved recordings (IndexedDB copy of every saved session; Share/Download/Open/Delete), loaded after auto-record. `src/js/status-core.js` (pure, self-tested): header status chips and the version comparison; `src/js/status-bar.js`: its view (chips next to Connect/Pause, "newer version" bar). `src/js/session-quality.js` (pure, self-tested): how complete a recording is (minutes with data, longest silence, clock rate); saved into every session file as `quality` (plus the page's `health` notes) and shown in Saved recordings. `src/js/health-log.js`: the Health log under Saved recordings, a black box kept in localStorage (tab hidden or frozen, timer gaps, computer sleep, page reopened, venue silent, price-stream drops, wake lock lost, learning restarted); read-only, loaded after status-bar.js. The build stamps `APP_VERSION` (`vNNN` for a release, `dev` otherwise); the page fetches `version.json` (written by the Pages workflow) to learn the newest release.
- Testing UI: serve `dist/` with `python -m http.server`, drive it with the Chrome tools; the window does not resize the viewport, so test phone width through a 390px iframe. Hidden tabs throttle requestAnimationFrame to ~1 fps, which makes rendering look stale.
