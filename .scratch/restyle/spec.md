# Visual restyle

Status: direction chosen: B, Terminal (2026-10-24). Built: release 1 (tokens, controls, header, navigation) in v074 and release 2 (panels, last hard-coded colours) in v075. The accent question was left to me with contrast as the priority: amber accent kept, warnings moved to a redder orange.

## Goal
The layout is now organised (see `.scratch/app-reorganization/spec.md`). The look is not: 12 to 13 px text, dim grey headings, flat panels, inconsistent buttons. Restyle without changing what anything does.

## Decisions (grilling answers)
1. **Feel**: keep the dark mood. Improve readability and hierarchy: stronger contrast on dim text, clearer panel headings, aligned numbers (tabular), consistent buttons and inputs.
2. **Themes**: dark only for now. Every colour is a token (a CSS variable) so a light theme can be added later. The charts draw with their own colours in `app.js`; they stay as they are in this step.
3. **Fonts**: system fonts plus tabular numbers. No downloaded or embedded font (the app is one offline file).
4. **Scope**: styling only: colours, spacing, type sizes, borders, button and input looks, headings. Nothing about what a panel contains, the six areas, or chart colours. Buy green and sell red stay everywhere.
5. **Phone vs PC**: PC stays dense (it is an analysis tool); the phone gets larger text, at least 44 px touch targets and a little more room between panels.
6. **Delivery**: a throwaway comparison first, the user picks, then two releases: (1) shared tokens, controls and navigation; (2) the panels.

## The comparison prototype (throwaway)
`.scratch/restyle/prototype/`: three CSS-only variants applied over the real app plus a floating switcher (arrow keys, `?variant=orig|A|B|C`).
- **A "Quiet instrument"**: brighter text, 14 px base, soft 14 px panels, plain sentence-case headings, pale blue accent, wider sidebar.
- **B "Terminal"**: flat and dense, monospace everywhere, 2 px corners, hairline borders, amber upper-case headings, tight spacing.
- **C "Soft cards"**: roomy raised cards with gradient surfaces, pill buttons, violet accent, title-case headings, floating pill nav on the phone.

Build and open: `node build.mjs && node .scratch/restyle/prototype/make.mjs`, then open `dist/prototype-restyle.html?variant=A` (file or `python -m http.server` in `dist`). Connect for live numbers; load a saved recording (Recordings > Record > Load session, then Review > Replay) for Reader episodes; start the simulated account on Accounts for Trade.

## Findings from building it (apply to whichever is chosen)
- A header that uses `backdrop-filter` becomes the containing block of the fixed sidebar and bottom bar inside it, which collapses them. Do not put `backdrop-filter` (or `transform`, `filter`) on `header`.
- A variant's own button padding beats the phone media rule of the base CSS (higher specificity), so the six-item bottom bar overflowed until its padding was reset inside the phone media query. Keep the bottom bar's `flex:1 1 0; min-width:0`.
- The phone header wraps onto three rows (buttons, status pills, view row) and takes about 160 px with 40 px controls. The real restyle should shrink it (fewer pills on the phone, or a collapsed status row).
- Canvas panels keep a hard-coded near-black background (`#0a0d10`); in a lighter or tinted variant they would need their own token.

## After the pick
1. Release A: tokens (`:root` variables, type scale, spacing scale), buttons, inputs, header, navigation (sidebar and bottom bar), phone header.
2. Release B: panels (headings, metric tiles, tables, episode cards, accounts, history) and the remaining hard-coded colours in `styles.css`.
3. Capture the prototype on a throwaway branch (the full variant set is the primary source), keep only the chosen style in main.

## Chosen palette (v074; contrast against the three surfaces, WCAG ratios)
text #dbe3ea 14:1; dim #93a3af 7:1 (was 5:1); accent #ffb454 10:1; buy #3ddc84 10:1; sell #ff6b66 6.5:1; warn #ff8a4c 7.8:1; control edge #5f6e7d 3.5:1 (the 3:1 a control border needs); dark ink #07090b on every fill 7 to 11:1. `.badge` and the live-account badge now use dark ink on the sell fill (white on it was 3:1). Focus ring: 2 px accent outline on every control. Everything is a token in `:root`; panels still to move to tokens in release 2: the canvas and log backgrounds (`#0a0d10`), the review table borders (`#1e252e`), the live-account card border (`#7a2a26`).

## Contrast audit (v075)
A script in the page compared every visible text node with its real background (layers, transparency and opacity included) on every view, with live data, a replayed recording, the simulated account, an opened episode card and the settings sheet. After the fixes nothing is under 4.5:1 (3:1 for large text); the only things that were were disabled buttons and the cards of streams switched off, both dimmed by opacity, so their opacity was raised. Canvas text was covered by design in v076 (below), not by this script.

## Still open
- The phone header is about 140 px (three rows: controls, status, view row). A shorter header would need the status text shortened in `app.js` (a display change, not CSS).

## Chart colours (v076)
The charts now read the tokens through `TH` (top of `app.js`): axis text `--dim` (7:1, was 5:1), grid `--line`, axes and zero lines `--edge`, lines and labels `--text` / `--hi` (new token), text on fills `--ink`, chart background `--canvas`, buy / sell / BN / HL from their tokens (the same colours as the Aggressor-flow bars and the venue tags). About 100 literals replaced in `app.js`, `overview.js`, `reader-tools.js` and `reader-landscape-view.js`. The selected-episode band uses the accent; the landscape playhead and the timeline selection outline use `--hi`; a fading episode's outline and the preview ring use `--warn` (as on the episode card). Kept as literals on purpose (category palettes with a legend): episode families, raw-log stream colours, the bell-curve z colours, the fan scale and the waterfall; all measured at 3:1 or more against `--canvas` (4.5:1 for the log text); the two darkest ends of the fan scale were lightened (2.5 and 2.6 up to 3.5 and 3.25). Checked by eye on Charts, Visuals and the Reader timeline and landscape with live data and a replay; no console errors.
