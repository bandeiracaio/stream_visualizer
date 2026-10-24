# App reorganization: six areas by what you are doing

Status: built (v068 navigation shell, v069 Record panel split, v070 Overview dashboard). Agreed in a grilling session, 2026-10-24.

## Goal
The app is hard to find things in: 12 views in 5 groups organised by data type, overlapping names (Reader, Raw, Streams, Health, Collectors, Saved
recordings), and one Reader panel ("Session, replay and labels") that mixes eight unrelated jobs. Reorganise it by *what the user is doing*, on phone and PC.

## Rules (fixed)
- **Nothing is removed.** Every panel, control and feature stays; this only moves, renames and regroups.
- Structure, grouping and naming only. The current dark theme, colours, fonts and panel styling stay; a restyle is a later step.
- UX steps leave the Reader engine, episode layer, trading / paper-broker and feed logic alone; note anything else spotted instead of changing it.
- Detections must not change. Before and after each step, byte-compare Reader detections on the simulated scenarios (the build self-test must pass).
- One step per release (`node build.mjs --release`), checked at 390px (iframe) and at desktop width before release.

## Main jobs (user's order)
Watch the live market; review Reader episodes and label them; record and keep recordings healthy; weekly review (drift, proposals, approvals); trade; look at collector data.
Phone: glance at the market, arm, check status. PC: review, labelling, weekly review, trading.

## Structure
| Area | Views |
|---|---|
| **Now** | Overview (dashboard), Charts, Microstructure (was Micro), Visuals (was Visualizations), Tape, Market (Market state + Books) |
| **Reader** | Episodes (market reader status, Episodes now, Timeline, Flow landscape, Finished episodes), Signals (one-off detectors + Detectors list) |
| **Review** | Replay and labels (Replay with current settings, Back to live, Episode thresholds, Your labels, score), Drift (Drift review), Assumptions (What the Reader assumes) |
| **Recordings** | Record (manual Record, Auto-record settings and Arm, Save / Load session), Saved (Saved recordings), Health log, Collectors |
| **Trade** | Trading (module workspace), Accounts |
| **System** | Streams, Feed health, Raw (Raw messages + Inspector), Engine (Engine health) |

Moves from today: Market group merges into Now; the "Session, replay and labels" panel splits between Recordings and Review (replay stays with Review because it is how thresholds are compared); Engine health moves from Reader to System; Diagnostics becomes System.
The Trading workspace's "move a panel into Trading" feature keeps working and now lists panels by their new area names.

## Navigation
- Phone: fixed bottom bar, six equal items, icon + short label, no overflow menu. A sub-row appears only when an area has several views.
- PC: the same six areas as a left sidebar.
- Header on every screen, compact: connection (Connect / Pause), asset, Arm, account badge, version / "newer version" bar. The detailed status chips move to System.
- The last view of each area is remembered (existing `lastView` store keeps working; migrate old view ids to the new ones).

## Overview
A read-only dashboard of summary cards, each linking into its area: market glance, current episodes, recording / armed state, account balance. No controls of its own.

## Steps (each its own release)
1. **Navigation shell.** New bottom bar / sidebar, six areas, compact header, existing panels regrouped under the new names. The mega-panel stays whole (in Recordings or Review, whichever the shell puts it in first; temporary).
2. **Split the mega-panel** into the Recordings and Review views as in the table. `reader-tools.js`, `auto-record.js`, `recordings.js`, `health-log.js`, `collectors.js` look their elements up by id, so ids stay stable; verify each script still finds its elements.
3. **Overview dashboard and polish.**

## Out of scope (noted, not done here)
- Visual restyle (own step later).
- Order history and richer account info (spot, all balances, fills across symbols, income / funding history, order history). Today's Accounts / Trading show only open orders, the last 30 fills of the selected symbol and the USDT wallet. Own feature spec later.
- Removing or merging any feature (decide one at a time later).

## Open for the build
- Which icon for each area (simple inline SVG, no external assets: the file must stay self-contained).
- The mega-panel's interim home in step 1.
- A hash or other deep link per view is not decided; not required.
