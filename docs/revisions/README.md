# Threshold revisions

One file per approved (or reset) threshold, written by the app (Reader tab, Threshold proposals) and dropped here.
Each has a `Folded:` line and a fenced JSON block. `node fold.mjs --check` shows what the next fold would change;
`node fold.mjs` applies it to the defaults in `src/js/reader-engine.js` and `src/js/reader-episodes.js` and marks the files
`Folded: yes`. Files with `Folded: yes` are history; keep them.
