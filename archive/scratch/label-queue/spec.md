# Label queue (v093)

Labels are the scarcest input, so going through episodes should take few taps.
- `src/js/label-queue-core.js` (`LABELQ`, pure, self-tested): groups oldest first by detection time, skipping forming ones, labelled ones and (optionally) families filtered out in the episode filter; `pick(groups, labelOf, currentId, dir, fams)` walks from the current group, wraps around, returns null when nothing is open.
- `src/js/label-queue.js` (view, loaded last): bar above the Timeline detail (`#lqBar`): "N unlabelled of M", prev / next, and "next after a label" (on by default, remembered in localStorage `sv-lq-auto`). Keys while no field has focus and the Reader view is on screen: right arrow or N next, left arrow or P previous, A agree, D disagree (a key press applies the label and moves on in the same tick). A tap on agree / disagree in the Timeline detail moves on after the label.
- Selecting a group opens the Timeline if it is folded (not saved) and sets the window to "all" when the group lies outside it.
- Label format, matching rule and the existing buttons are untouched: a label made through the queue is byte-for-byte the label made by hand.
- Tested in the browser with a simulated replay (keys and a real tap, phone width 390 px); not tried on a real phone or with a real recording.
