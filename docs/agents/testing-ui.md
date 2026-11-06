# Testing the UI in Chrome

Drive the built page with the Chrome tools. Each step is done when its check passes.

## Serve and open

1. `node build.mjs`. Done when it prints `wrote ...dist/stream-visualizer.html`.
2. Serve with `python -m http.server <port>`: from `dist/` for the app alone, or from the repo root when you also need a recording (the page is then `/dist/stream-visualizer.html` and the recordings are `/sessions/...`). Done when `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/stream-visualizer.html` prints 200 (with the repo-root server, `/dist/stream-visualizer.html`).
3. Open the page in a new tab. Done when the tab title is "Live Stream Visualizer".
4. When finished, close the tab and stop the server. On Windows: `Get-NetTCPConnection -LocalPort <port> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.

## Load a recording into the replay

A native file dialog cannot be driven, so load the file from the page itself. This needs the repo-root server.

1. In the page, `fetch('/sessions/<file>.json.gz')`, wrap the blob in a `File`, put it in a `DataTransfer`, assign it to `#rtLoad`'s `files`, and dispatch a `change` event.
2. Click `#rtReplay`. A replay of a large session takes tens of seconds and blocks the page the whole time, so a JS tool call made meanwhile times out; start the click with `setTimeout(..., 50)` and wait with separate calls.
3. Done when `RD().episodeGroups().length` is above 0.

A page reload loses the replay (and the next load takes as long), so avoid navigating away once it is loaded.

## Phone width

- The window does not resize the viewport. Test phone width through an iframe: 390 px for a generic phone.
- For a specific width, make the iframe 15 px wider than the target; its own scrollbar takes about 15 px and a real phone has none.
- Phone header buttons use 5 px side padding so one row of controls fits a 360 px phone.

## Why the page can look stale

A hidden or background tab throttles `requestAnimationFrame` to about 1 fps and slows timers, so rendering and one-second refreshes lag. Bring the tab to the front before concluding something is broken.
