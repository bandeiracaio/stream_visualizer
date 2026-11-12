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
- Folders: `releases/` holds only the newest released page (older ones are GitHub Releases assets: tag `archive-v001-vNNN`, then one `vNNN` each); `sessions/` holds the saved recordings (`session_*.json.gz`, gitignored; point the app's save folder at it: Recordings, Saved recordings, Choose folder); `prompt-builder.html` (repo root) is a single-file page for building prompts to give other Claudes, read from `docs/agents/matt-pocock-skills.md` and regenerated from it.
- Line endings are mixed: `app.js`, `reader-episodes.js`, `reader-register.js`, `reader-tools.js` are CRLF, `reader-selftest.js` is CRLF with some LF lines, the rest LF. Edit without converting (Python `open(..., newline="")`), then check `git diff --stat`: a whole-file diff means the endings changed.
- `hooks/pre-commit` (tracked) fails a commit that changes a file's line-ending style or breaks `node build.mjs`. Enable it once per clone: `git config core.hooksPath hooks`. Bypass: `git commit --no-verify`.
- Scope: each piece of work is its own step and its own release. UX steps leave the Reader engine, trading / paper-broker and feed logic alone; note anything else spotted instead of changing it. Feature steps (Overview, then the Reader redesign) may touch the engine, which stays pure, with a self-test scenario for each new behaviour.

## Release

After each finished step, so the user always has an up-to-date single file. Another Claude also pushes releases. Done = the pushed commit is on `origin/main` and `releases/` holds the new page.

1. `git fetch`; if `origin/main` is ahead, rebase on it first. Done when `git status -sb` shows you are not behind.
2. `node build.mjs` exits 0.
3. `git diff --stat` shows no whole-file diff (line endings kept).
4. `node build.mjs --release` prints the new `releases/stream-visualizer_vNNN.html` and deletes the previous file from `releases/`.
5. `node build.mjs --verify` exits 0 (the release file equals a build of `src/`; CI runs the same check).
6. Commit and push to `main`. The repo is public and `.github/workflows/pages.yml` serves the newest release at https://bandeiracaio.github.io/stream_visualizer/ on every push to `main`; unreleased `src/` work never goes live. CI deploys only a release that passes the self-test and matches `src/`, and attaches it to a GitHub Release `vNNN`. A failed Actions run means the site was NOT updated: check `gh run list --limit 3`. Pages caches about 10 minutes, so a phone may need a reload.

## Reader rules

- Before touching the episode layer's evidence cut-offs, run `node compare-detections.mjs --rev-a HEAD`: exit 0 means detections are byte-identical on the saved sessions, exit 1 lists every difference.
- Participants are the aggressor / passive side (neutral language).

## UI rules

- Every colour is a token in `:root` of `styles.css`; the chart canvases read the same tokens through `TH` at the top of `app.js`.
- Contrast: body text 14:1, dimmest text 7:1, accent / buy / sell / warn 6.5:1, a control's border 3:1; keep text `opacity` at .75 or above.
- `header` carries no `backdrop-filter`, `transform` or `filter` (it holds the fixed sidebar and bottom bar).
- The phone header is two rows, about 95 px.

## Pre-registered studies

- A registered plan lives in `.scratch/<study>/plan.md`; a change to it is an amendment in that file.
- The studies that were registered before v135 are archived and closed (`archive/README.md`); none is open.

## Where to look

Reference that is read when you touch the area, not every session:

- Reader engine, episodes, replay and timeline: `docs/agents/source-map.md` § Reader.
- Navigation, account, order history, Overview, restyle, headers and the Look: § App shell and views.
- Continuous recording (chunks, runs, `--replay-run`), collectors, worker, tape, session quality: § Recording and collectors.
- How `HOOKS`, `VIEWS`, `feeds.js` and `COLLECT.REGISTRY` fit: § Seams.
- Scripts at the repo root (`compare-detections.mjs`, `design-harness.mjs` including `--replay-run` for recorded chunks, `sample-designs.mjs`): `docs/agents/studies.md`. Closed studies and their scripts: `archive/README.md`.
- Testing the UI in Chrome and at phone width: `docs/agents/testing-ui.md`.
- Terms: `CONTEXT.md`. Decisions: `docs/adr/`. Specs: `.scratch/<feature>/spec.md`.
