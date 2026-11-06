## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Words used here

- **pure**: no DOM, timers or storage, replayable, self-tested by `node build.mjs`.
- **display only**: changes what is shown; the Reader engine, feeds and paper broker are untouched.

## Build

The app ships as ONE self-contained HTML file (offline-capable from a phone or PC, no external assets). Edit `src/` (`index.html` with `<!--@include path-->` markers, `styles.css`, `js/*.js`); `build.mjs` writes the built page, so the built HTML is only ever produced by the build.

- `node build.mjs` runs the Reader self-test, compiles every included `.js` file (a syntax error in a page file aborts the build; the self-test alone does not parse them), then writes `dist/stream-visualizer.html` (dev build).
- `node build.mjs --release` writes the next `stream-visualizer_vNNN.html` into `releases/` (never overwrites an existing version; the number is the highest in `releases/` or the repo root, plus one).
- Folders: `releases/` holds every released page (v001 onward); `sessions/` holds the saved recordings (`session_*.json.gz`, gitignored; point the app's save folder at it: Recordings, Saved, Choose folder); `prompt-builder.html` (repo root) is a single-file page for building prompts to give other Claudes, read from `docs/agents/matt-pocock-skills.md` and regenerated from it.
- Line endings are mixed: `app.js`, `reader-episodes.js`, `reader-register.js`, `reader-tools.js` are CRLF, `reader-selftest.js` is CRLF with some LF lines, the rest LF. Edit without converting (Python `open(..., newline="")`), then check `git diff --stat`: a whole-file diff means the endings changed.
- Scope: each piece of work is its own step and its own release. UX steps leave the Reader engine, trading / paper-broker and feed logic alone; note anything else spotted instead of changing it. Feature steps (Overview, then the Reader redesign) may touch the engine, which stays pure, with a self-test scenario for each new behaviour.

## Release

After each finished step, so the user always has an up-to-date single file. Another Claude also pushes releases. Done = the pushed commit is on `origin/main` and `releases/` holds the new page.

1. `git fetch`; if `origin/main` is ahead, rebase on it first. Done when `git status -sb` shows you are not behind.
2. `node build.mjs` exits 0.
3. `git diff --stat` shows no whole-file diff (line endings kept).
4. `node build.mjs --release` prints the new `releases/stream-visualizer_vNNN.html`.
5. Commit and push to `main`. The repo is public and `.github/workflows/pages.yml` serves the newest release at https://bandeiracaio.github.io/stream_visualizer/ on every push to `main`; unreleased `src/` work never goes live. Pages caches about 10 minutes, so a phone may need a reload.

## Weekly review

1. The user exports a review report and register from the Reader tab; approving or resetting a threshold downloads a revision file, and the user drops it into `docs/revisions/`.
2. `node fold.mjs --check` passes (it refuses a file that does not fit the current defaults).
3. `node fold.mjs` rewrites the matching defaults in `reader-engine.js` / `reader-episodes.js` and marks each file `Folded: yes`; review the diff.
4. `node build.mjs`, then the Release steps.

## Reader rules

- Self-revising Reader: the register / drift / proposal code never changes a detection by itself; only an approved threshold does (`docs/adr/0001`, `0003`). Language in `CONTEXT.md`, specs in `.scratch/self-revising-reader/`, sigma in `docs/adr/0004`. Register files from before v012 are on the wrong scale.
- Before touching the episode layer's evidence cut-offs, run `node compare-detections.mjs --rev-a HEAD`: exit 0 means detections are byte-identical on the saved sessions, exit 1 lists every difference.
- Participants are the aggressor / passive side (neutral language).

## Extension seams

- A late-loaded module extends an owner's function with `HOOKS.on(name, fn)` (`src/js/hooks.js`).
- A new view is one `VIEWS.register({...})` in `app.js` (`src/js/views.js`).
- A new collector is one `COLLECT.REGISTRY` entry plus one `CONTRIB` entry in `collectors-core.js`; its features also go in `FEATURE_ORDER` (a self-test fails otherwise).

## UI rules

- Every colour is a token in `:root` of `styles.css`; the chart canvases read the same tokens through `TH` at the top of `app.js`.
- Contrast: body text 14:1, dimmest text 7:1, accent / buy / sell / warn 6.5:1, a control's border 3:1; keep text `opacity` at .75 or above.
- `header` carries no `backdrop-filter`, `transform` or `filter` (it holds the fixed sidebar and bottom bar).
- The phone header is two rows, about 95 px.

## Pre-registered studies

- A registered plan lives in `.scratch/<study>/plan.md`; a change to it is an amendment in that file.
- `analyze-wallets.mjs` runs once on real sessions. `analyze-liquidations.mjs` runs its test once, when the three-venue variant has 60 clusters and 30 pairs (`--status` prints counts only).

## Where to look

Reference that is read when you touch the area, not every session:

- Reader engine, episodes, drift, scoreboard, label queue: `docs/agents/source-map.md` § Reader.
- Navigation, account, order history, Overview, arm, restyle, headers and the Look: § App shell and views.
- Recording, auto-record, collectors, worker, tape, session quality: § Recording and collectors.
- Futures stack, liquidations readout: § Market views.
- How `HOOKS`, `VIEWS`, `feeds.js`, `COLLECT.REGISTRY` and `reader-review.js` fit: § Seams.
- Analysis scripts at the repo root (`analyze-*.mjs`, `compare-detections.mjs`, `reader-scoreboard.mjs`, `reader-robustness.mjs`): `docs/agents/studies.md`.
- Testing the UI in Chrome and at phone width: `docs/agents/testing-ui.md`.
- Terms: `CONTEXT.md`. Decisions: `docs/adr/`. Specs: `.scratch/<feature>/spec.md`.
