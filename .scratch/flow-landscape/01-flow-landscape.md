# Flow landscape: a 3D view of the Reader's tape, with time as the fourth dimension

Status: built (v020).

## Goal
A picture a human can read in a second: where, and how long ago, buyers and sellers hit the book, as a coloured 3D surface, with a playhead
that walks through time. Inspired by a MATLAB-style surface plot (peaks and valleys over a floor). Read-only: it never feeds the engine.

## What was taken from the image, and what was not
- Taken: the 3D surface with signed height (peaks and valleys over a flat zero floor), a floor grid, labelled axes, rotation.
- Not taken: the rainbow colour map (it hides the one thing that matters, the sign; buy green and sell red already mean that everywhere in the app),
  the dense wire mesh, and any fixed viewpoint.

## Variables
- X: price relative to the venue's mid at the playhead, in bps (the range follows the window's trades and price path, rounded so it does not jitter).
- Y: age, seconds before the playhead (newest at the front edge).
- Z: net aggressor flow in that cell, $ (buy aggression positive, sell negative). Height and colour use the square root of the flow so small pockets stay visible next to big ones; the readout gives true dollars.
- 4th dimension: the playhead. Live follows the market; the slider or Play walks through the last 5 minutes (live) or a whole loaded session.
- On the floor: a dashed line for the mid now, and a white line for where the mid actually was, so a ridge that stays at one price while the white line stays put reads as absorption, and one that slides with the white line reads as flow that pushed price.
- Venue: BN + HL (each venue against its own mid, so the basis between them cancels), or one of them. Window 30 s, 60 s or 2 min.
- Reader episodes active at the playhead are listed under the picture (live, or a replayed session).
- (v026) Episodes are also drawn on the floor: a stripe along the age axis at the episode's price (walls thicker, ended ones faded), with a diamond where it was detected. Colours: absorption blue, exhaustion amber, burst purple, wall light grey. Price is the episode's `px` as an offset from its venue's mid at the playhead; one outside the price range sits on the edge, dashed. Marks come from `READER_LANDSCAPE.episodeMarks` (pure, self-tested) and only read the episode list.

## Safety for what exists
- New files only: `src/js/reader-landscape.js` (pure grid maths, self-tested) and `src/js/reader-landscape-view.js` (drawing). One new section in the Reader tab, a few CSS lines, and a build step that includes the pure file in the self-test.
- It reads `trades`, `midHist`, the loaded session and the episode list, and writes nothing to them. `renderReader` is wrapped; every call is guarded, so a failure here cannot stop the rest of the Reader tab.
- Engine, episodes, register, trading and feeds are untouched.

## Open
- Live history is limited to the 5 minutes the app keeps; a longer live buffer would need its own store.
- Z-axis uses a smoothed scale; true cell values are only in the readout.
