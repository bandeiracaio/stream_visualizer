# Arm mode view (v092)

Now > Arm mode: a screen to leave open while the app collects. Read-only; refreshes once a second only while open; the one button is the header's Arm.
- `src/js/arm-mode.js` (`AM`), sections `#amHero`, `#amAlerts`, `#amQuality`, `#amMarket`, `#amReader`, `#amRecs`, `#amHealth` in index.html, styles `.am-*`.
- Headline: not armed / connected not armed / armed learning / watching / cooling down / recording, with the clock, page and armed uptime.
- Needs attention: not connected, not armed, tab hidden, wake lock lost, offline, header chips that are warn/bad, price-stream drops, save folder problems, many Health log notes.
- Data quality: venue silence and message rates, order book age, price stream, tab, wake lock, each collector's health.
- Market now: price, 5m/15m change, sigma ratio, market state with V/L/F/C readings, Reader activity.
- Reader: calibration, active/forming episodes. Recordings: recording now, saved this session (with folder and quality), save folder. Health log: latest notes.
- Not done: no sound or notification when something turns red; no keep-awake toggle of its own (Arm holds the wake lock).

## Disk space warning (v098)
- `src/js/disk-core.js` (pure, self-tested; `DISK`): `rate` (bytes an hour from recordings saved in the last 6 h) and `assess` (tone and text from room left and hours left). Warn under 5 GB or 12 h, red under 2 GB or 4 h.
- `src/js/disk-watch.js` (`DW`): reads `navigator.storage.estimate()` once a minute (quota minus usage). A page cannot read the drive's free space; Chrome caps the quota by it, so the figure follows the drive down but reads lower (10.7 GB against 14.4 GB real on the first machine). The text says "about". Arm mode shows a "Disk space" row in Data quality and a warn / bad alert. Read-only.
- Not done: no check of the save folder's own drive when it is on another drive (the estimate is for the browser profile's drive); no sound or notification.
