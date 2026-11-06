# Arm mode view (v092)

Now > Arm mode: a screen to leave open while the app collects. Read-only; it renders once a second, only while the view is open; the one button is the header's Arm. Later additions to this screen have their own specs: "Ready to arm?" and "Last night" (`.scratch/overnight/spec.md`) and the re-arm bar (`.scratch/arm-memory/spec.md`).
- `src/js/arm-mode.js` (`AM`), sections `#amHero`, `#amAlerts`, `#amQuality`, `#amMarket`, `#amReader`, `#amRecs`, `#amHealth` in index.html, styles `.am-*`.

## Done when

- Headline is exactly one of: not armed / connected not armed / armed, waiting for feeds / armed learning (minutes learned of 15) / armed cooling down / armed watching / recording, with the clock, page and armed uptime.
- Needs attention is empty when all is well, otherwise one line per item, each with a tone:
  - bad: not connected; the browser reports no internet; the last save into the save folder failed; a header chip that is bad.
  - warn: connected but neither armed nor recording; the tab is hidden; armed without the wake lock held; the price stream dropped while armed; the save folder needs permission again; low disk space (its tone comes from `DISK.assess`, so it can be bad); a header chip that is warn. A chip whose text starts "armed" is left out.
  - info: no save folder chosen; 3 or more Health log notes (the page `load` note excluded) in the last 10 minutes.
  - The save-folder items appear only where the browser supports the folder API.
- Data quality shows venue silence and message rates, order book age, price stream, tab, wake lock, each collector's health, and the Disk space row below.
- Market now shows price, 5m/15m change, sigma ratio, market state with V/L/F/C readings, Reader activity.
- Reader shows calibration and active / forming episodes. Recordings shows the recording now, those saved this session (with folder and quality) and the save folder. Health log shows the latest notes.

## Disk space warning (v098)
- `src/js/disk-core.js` (pure, self-tested; `DISK`): `rate` (bytes an hour from recordings saved in the last 6 h) and `assess` (tone and text from room left and hours left). Done when: warn under 5 GB or 12 h, red under 2 GB or 4 h, and tone "off" with the text "not known" when the browser gives no estimate.
- `src/js/disk-watch.js` (`DW`): reads `navigator.storage.estimate()` once a minute (quota minus usage). A page cannot read the drive's free space; Chrome caps the quota by it, so the figure follows the drive down but reads lower (10.7 GB against 14.4 GB real on the first machine). The text says "about". Arm mode shows a "Disk space" row in Data quality and a warn / bad alert. Read-only.

## Out of scope, on purpose
- A keep-awake toggle of its own: Arm holds the wake lock.

## Open items
Tickets in `.scratch/arm-mode/issues/`: `01-notify-on-red.md` (a sound or notification when something turns red) and `02-disk-check-save-folder-drive.md` (the save folder's own drive).
