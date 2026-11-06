# Re-arm prompt (v124)

Why: a reload, a browser restart or a closed tab silently ends an armed page, and the night's collection with it (found 2026-11-06: the chain of 21 hourly recordings ended at 20:05 local on a still-volatile market, nothing restarted, no cue anywhere). The armed state lives only in the page.

What:
- While the page is armed it keeps `ar.armed` = `{on, since, last, runs}` in the browser's storage (`store`, key `sv1:ar.armed`): written when it becomes armed, refreshed every 10 s and when a recording finishes. A deliberate Disarm, or an arming that finishes (maximum recordings), clears it AT THAT MOMENT (not on every tick, so a page that disarmed earlier cannot wipe another page's flag).
- A page that loads and finds the flag while not armed shows a bar under the header (`#armBar`): "Auto-record was armed (last seen 00:28, 6.0 h ago, 4 recordings made), and this page is not armed: nothing is being recorded automatically." with Re-arm now (presses the header Arm button) and Dismiss (clears the flag). It writes `armed page ended` to the Health log once per page (the morning summary counts it among the problem notes).
- No bar while another page of the app is armed (it holds the Web Lock `sv-armed`; checked every 5 s), while this page is armed, after Dismiss, or when the flag is older than a week or from the future.
- Closing a tab that was armed leaves the flag, so the next page to load (or another open tab, once the lock is gone) shows the bar.

Code: `src/js/arm-memory-core.js` (pure, 12 self-test checks in the build; `ARMMEM.step / prompt / text`), `src/js/arm-memory.js` (view, one-second tick), `#armBar` in `index.html`, styles in `styles.css`. Auto-record itself is untouched.

Not here: re-arming without a click (a browser restart restoring the tab would need the page to arm on its own; arming needs the user's OK for the wake lock and the save folder permission, and it was left as a prompt on purpose). Possible next step: an optional "re-arm automatically when this page opens" setting.
