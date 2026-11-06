# Testing the UI in Chrome (reference)

- Testing UI: serve `dist/` with `python -m http.server`, drive it with the Chrome tools; the window does not resize the viewport, so test phone width through a 390px iframe. Hidden tabs throttle requestAnimationFrame to ~1 fps, which makes rendering look stale.
- Phone header width: phone header buttons use 5 px side padding so one row of controls fits a 360 px phone (the user's Galaxy M52 5G reports 360 or 412; not confirmed). Test with an iframe 15 px wider than the target (its own scrollbar takes about 15 px; a real phone has none).
