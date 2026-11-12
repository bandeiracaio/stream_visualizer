# Account panel is too narrow: the Binance live card looks wrong on screen

Status: needs-triage
Reported: 2026-11-12, by the user, with a screenshot (PC, Account ▾ panel scrolled down).

## What the user saw

The Account switch panel (`#accSwitchPanel`, header caret ▾) is a narrow column. Its cards (Simulated paper, Binance demo, Binance live — real money) sit in a grid (`.acc-grid`) that is too narrow for them: the "Binance live — real money" card ends up under the others in a half-width column with a lot of empty space beside it, and the demo card, now longer (proxy address field, connection check button and its seven result lines, added in v145 and v146), is much taller than its neighbours. The live card reads as strange and cut off.

## Wanted

- The panel uses the width it has (or is wider on a PC) so the three cards are readable side by side or stacked cleanly, never a half-filled column.
- The live card stays clearly separate and clearly red (its warning must stay legible), and its fields are fully visible without scrolling sideways.
- The demo card's check result lines do not stretch the other cards.
- Phone width (390 px) still works; header rules in CLAUDE.md hold (two rows, no `backdrop-filter` / `transform` / `filter` on `header`; the panel lives inside `header`).

## Notes

- Where: `src/index.html` (`#accSwitchPanel`, `.acc-grid`, `.acc-card`), `src/styles.css`. Display only.
- Check with `docs/agents/testing-ui.md` at PC width and in the 390 px iframe.
- Related: the demo card grew in step 8 (v145/v146); the connection check output is `#exCheckOut`.

## Comments
