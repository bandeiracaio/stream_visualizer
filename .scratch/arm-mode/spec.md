# Arm mode view (v092)

Now > Arm mode: a screen to leave open while the app collects. Read-only; refreshes once a second only while open; the one button is the header's Arm.
- `src/js/arm-mode.js` (`AM`), sections `#amHero`, `#amAlerts`, `#amQuality`, `#amMarket`, `#amReader`, `#amRecs`, `#amHealth` in index.html, styles `.am-*`.
- Headline: not armed / connected not armed / armed learning / watching / cooling down / recording, with the clock, page and armed uptime.
- Needs attention: not connected, not armed, tab hidden, wake lock lost, offline, header chips that are warn/bad, price-stream drops, save folder problems, many Health log notes.
- Data quality: venue silence and message rates, order book age, price stream, tab, wake lock, each collector's health.
- Market now: price, 5m/15m change, sigma ratio, market state with V/L/F/C readings, Reader activity.
- Reader: calibration, active/forming episodes. Recordings: recording now, saved this session (with folder and quality), save folder. Health log: latest notes.
- Not done: no sound or notification when something turns red; no keep-awake toggle of its own (Arm holds the wake lock).
