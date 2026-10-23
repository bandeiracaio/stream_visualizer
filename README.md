# Stream Visualizer

**A live order-flow workbench for Binance and Hyperliquid perpetuals, shipped as one HTML file, with a market "Reader" that measures its own assumptions and asks before it changes them.**

**Try it: https://bandeiracaio.github.io/stream_visualizer/** (always the newest release; works on a phone).

Open it in a browser, press **Connect**, and watch two venues' trades, books and liquidations side by side. No server, no install, no external assets, no account. The only network traffic is the public exchange feeds.

> Status: personal research tool under active development (numbered releases, one per finished step). Not financial advice; see [Safety](#safety).

---

## Why this exists

Most order-flow dashboards show you numbers and leave the interpretation to you. Most "signal" tools hide their thresholds in code and never tell you when the market stopped behaving the way those thresholds assume.

Stream Visualizer tries to do both jobs honestly:

1. **Show the raw tape well**: bubbles, CVD, heatmaps, imbalance, basis between venues, sweeps, beeswarm, treemap and more.
2. **Describe what is happening in neutral language**: "aggressor" and "passive side", never bull or bear, with an evidence checklist you can audit.
3. **Know its own limits**: every threshold the Reader uses is an explicit, measured *assumption*. When the data stops matching, the Reader flags drift, proposes a change, replays history to show what it would have done, and **waits for you to approve it**.

## Highlights

| | |
|---|---|
| **One file** | `stream-visualizer_vNNN.html`, self-contained. Open the hosted copy, or copy the file to any device. |
| **Two venues at once** | Binance USD-M futures and Hyperliquid, trades, books, liquidations, open interest, basis. |
| **Five areas** | Live (overview, charts, microstructure, visualizations, tape), Reader, Trade, Market, Diagnostics. |
| **Episode-based Reader** | Phenomena have a lifecycle (forming, active, fading, ended, resumable) with a back-dated start and a multi-variable evidence checklist. |
| **Self-revising** | A register of assumptions, per-variable drift detection, threshold proposals, replay verdicts, and an approval step. |
| **Flow landscape** | A 3D surface of where, and how long ago, buyers and sellers hit the book (price x age x net aggressor flow), with a playhead that walks through live history or a recorded session, and the Reader's episodes marked on the floor where and when they happened. |
| **Record and replay** | Save a live session to a file, load it on any device, replay it with different thresholds, and label episodes agree / disagree / missed. |
| **Auto-record** | Arm it and the app waits on a single price stream, then connects and records by itself when the market gets volatile (relative to its last hour, or above a fixed sigma), and saves the file when it calms down or hits a time limit. |
| **Saved recordings and Share** | Every saved session is also kept in the browser's own storage, with Share (the phone's share sheet: mail it to yourself, Drive, Quick Share), Download, Open and Delete. A phone that blocks an unattended download loses nothing. |
| **Live status in the header** | Chips next to Connect/Pause show whether data is streaming (or a venue went silent), whether auto-record is armed, learning, waiting or recording, whether the screen may sleep, and how many recordings are kept. |
| **Keeps watching while hidden** | The price feed behind auto-record runs in a Web Worker and the armed page holds a Web Lock, so a hidden tab learns and judges more reliably. For recordings, still keep the tab visible: the recording itself runs on the page. |
| **Recording quality** | Every saved session records how complete it is (minutes with data, longest silence, clock rate) and the Saved recordings list shows it, so a hollow file is obvious before you replay it. |
| **Health log** | A black box under Saved recordings that survives a reload: when the tab was hidden or frozen, timers stalled or the computer slept, a venue went silent, the price stream dropped, the screen lock was lost, or learning started over. Download it next to a recording that has holes, to see why. |
| **Knows when it is out of date** | The hosted page checks for a newer release and offers a Reload bar. It never reloads by itself, and asks twice while armed or recording. |
| **Pure, tested engine** | The Reader engine has no DOM and no timers, and 100+ simulator scenarios run on every build; a failing one aborts the build. |
| **Trading built in** | A simulated paper broker filled against live prices, Binance's own demo account, or a real-money Binance account behind an explicit acknowledgement. |

## Quick start

1. Open **https://bandeiracaio.github.io/stream_visualizer/** in Chrome, Edge, Firefox or Safari, on a PC or a phone. (Or download the newest `stream-visualizer_vNNN.html` from the repository root, highest number wins, and open the file.)
2. Press **Connect**. The header shows how many sockets are up (`2/2 sockets`) and a green `streaming N/s` chip once data flows.
3. Open the **Reader** tab and let it run. It calibrates for about two minutes before it detects anything.

Sessions, the register, your approvals and saved recordings are kept in the browser's own storage for that address; the hosted copy and a local file are separate stores. Export from the Reader tab when you want to move them; they are plain files.

### Collecting data unattended

Arm **auto-record** (Reader tab, *Session, replay and labels*) and leave the tab open with the screen awake. It needs 15 minutes of prices to learn what a normal hour looks like, then starts a recording by itself when the market turns volatile and stops after 5 calm minutes or 60 minutes at most. On a phone, keep the tab in the foreground and the device charging; closing the tab or a sleeping phone ends the wait. The header chips tell you the state at a glance. A checklist for what counts as a usable session, and what to do after, is in [docs/data-collection-checklist.md](docs/data-collection-checklist.md).

## The Reader

The Reader turns streams of trades and book updates into **episodes**: one market phenomenon with a start, a middle, an end and the possibility of resuming.

| Family | What it looks for |
|---|---|
| **Absorption** | One side hits hard, price barely moves, the passive side refills. |
| **Exhaustion** | A previously dominant aggressor fades near an extreme while trade size and count shrink. It only fires while price is still within 1 sigma of that extreme (from v046). |
| **Aggression burst** | Abnormal one-sided flow with price actually moving and the other venue agreeing. |
| **Wall** | A large resting level appears, gets re-posted, eaten or pulled. Walls under $100k are ignored, and one resting region seen at nearby prices (6 bps) or re-appearing within 90 s of the last wall is one episode (from v044/v045). |

Each episode reports when it was *detected*, a *back-dated start*, and a checklist of the evidence that did or did not hold, across fast and mid horizons and both venues.

Alongside the episodes there is a layer of **signals**: one-off, point-in-time detections with no lifecycle. They include wall appears / pulled / eaten, thinning book, imbalance flip, spoof-like patterns, sweeps and liquidations, plus **silence** (a venue goes unusually quiet), **cross-venue lead/lag** (one venue moves first and the other follows within a second) and **trade clustering** (a run of same-size same-side prints). Signals are single timestamped facts that never alter episodes.

### Sigma: the ruler everything is measured with

Price moves are measured in *sigmas*: the scale of normal movement on that venue right now (the 75th percentile of absolute deviation of overlapping 15-second returns, scaled to bps per root second). Because a ruler can be wrong from the start, which drift checks never catch, price progress also carries a **static expectation** (a typical move of about 0.5 to 1.2 sigma, tails around 1.3 to 3.2) that is checked against everything seen so far. See [ADR 0004](docs/adr/0004-sigma-is-a-15-second-mad.md).

### The self-revising loop

```mermaid
flowchart LR
  A[Live or replayed data] --> B[Engine and episode layer]
  B --> C[Register: priors, learned baselines, per-session summaries]
  C --> D{Drift?}
  D -- "same direction in M sessions" --> E[Threshold proposal]
  E --> F[Replay verdict: what would have changed]
  F --> G{You approve?}
  G -- yes --> H[Approved override + revision file]
  G -- no --> I[Rejected, logged]
  H --> J[fold.mjs rewrites the defaults at release]
  J --> B
```

The rule that holds the whole design together: **the register, drift and proposal code never changes a detection by itself.** Only a threshold you approved does. Baselines update automatically; thresholds do not ([ADR 0001](docs/adr/0001-baselines-adopt-thresholds-need-approval.md)).

### Record, replay, label

- **Record** a session (optionally thinning quote updates), **save** it as `session_<SYM>_<time>.json.gz`, **load** it anywhere. Saving also keeps a copy in *Saved recordings*; **Share** sends it through the device's share sheet (mail, Drive, Quick Share), which needs the hosted HTTPS page.
- **Replay** with the current or edited thresholds and compare the episode counts.
- **Timeline** shows episodes as spans over the price line; mark each one **agree**, **disagree**, or add a **missed** label. Labels feed the weekly review.

## Weekly review

1. In the Reader tab, export the **review report** and the **register**.
2. Look at *To review*: drift flags, scale warnings, pending proposals.
3. Approve or reset a threshold; the app downloads a **revision file**. Drop it into `docs/revisions/`.
4. Before a release:

```bash
node fold.mjs --check      # preview what the next fold would change
node fold.mjs              # rewrite the matching defaults, mark files "Folded: yes"
node build.mjs             # self-test + dev build
node build.mjs --release   # next stream-visualizer_vNNN.html in the repo root
```

`fold.mjs` refuses a revision file that does not fit the current defaults. See [docs/revisions/README.md](docs/revisions/README.md) and [ADR 0003](docs/adr/0003-approved-thresholds-are-overrides-then-folded-by-script.md).

## Building from source

Requires only **Node.js** (no dependencies, no `npm install`).

```bash
node build.mjs                       # runs the Reader self-test, writes dist/stream-visualizer.html
node build.mjs --release             # writes the next stream-visualizer_vNNN.html (never overwrites)
node build.mjs --out some/file.html  # custom output path
```

The built HTML is generated. **Never edit it by hand**; change `src/` and rebuild.

To try the dev build locally (the hosted page checks for updates; a local copy does not):

```bash
cd dist && python -m http.server 8765    # then open http://localhost:8765/stream-visualizer.html
```

## Publishing

The repository is public and serves GitHub Pages. `.github/workflows/pages.yml` runs on every push to `main` and publishes the **newest** `stream-visualizer_vNNN.html` in the repo root as the site, plus a `version.json` the page reads to offer updates. So the flow is: `node build.mjs --release`, commit, push. Unreleased work in `src/` never goes live. GitHub caches the page for about ten minutes, so a phone may need a reload.

## Testing

`node build.mjs` runs 100+ simulator scenarios in a sandbox before writing anything and aborts on the first failure. They cover each detector and episode family, the register, drift, proposals, replay determinism, the sigma estimator and static expectation, save/load round trips, the signals, the header status logic, and the register's scale mark, including a check that adding signals leaves every older detection and episode **byte-identical** on a recorded session.

Rule of thumb in this repo: any new engine behaviour ships with a scenario, and any change to evidence cut-offs is byte-compared on simulated and recorded data before and after.

## Project layout

```
src/
  index.html            page skeleton, with <!--@include path--> markers
  styles.css
  js/
    app.js              feeds, charts, navigation, Reader cards
    overview.js         Overview (home) view
    reader-engine.js    pure order-flow engine + one-off detectors (replayable)
    reader-episodes.js  pure episode state machines and evidence checklists
    reader-register.js  assumption register, baselines, sessions, approvals
    reader-drift.js     pure drift judgement per variable
    reader-proposals.js pure percentile maps, proposals, replay verdict
    reader-tools.js     record / save / load / replay, timeline, labels
    reader-landscape.js pure grid maths for the Flow landscape (3D tape surface)
    reader-landscape-view.js  the 3D drawing, playhead and controls
    auto-record-core.js pure volatility estimate and start/stop decision for auto-record
    auto-record.js      its view: arming, the price stream, saving
    recordings.js       saved recordings: IndexedDB copies with Share / Download / Open / Delete
    status-core.js      pure header status chips and the version comparison
    status-bar.js       its view: chips next to Connect/Pause, the "newer version" bar
    reader-selftest.js  simulator scenarios (run by the build)
.github/workflows/     Pages deploy (newest release becomes the site)
build.mjs               self-test + single-file assembler
fold.mjs                folds approved revisions into the defaults
docs/adr/               architecture decision records
docs/revisions/         approved threshold revisions (history)
docs/data-collection-checklist.md   what to do before, during and after collecting data
.scratch/               local specs and issues (one folder per feature)
CONTEXT.md              the domain language
```

## Design principles

- **One file, offline-capable.** No external assets, ever.
- **A pure engine.** The Reader has no DOM and no timers; exchange timestamps drive its clock, so any recording replays identically.
- **Neutral language.** Aggressor and passive side, not bull and bear.
- **Assumptions are first-class.** Named, written down, measured, and revisable, but only with approval.
- **Refactors are proven, not trusted.** Before and after replays are compared byte for byte.

The vocabulary (episode, register, baseline, drift, revision, sigma, expectation) is defined in [CONTEXT.md](CONTEXT.md); the decisions behind it are in [docs/adr/](docs/adr/).

## Data sources

Public market data only, read directly by your browser:

- Binance USD-M futures: `fstream.binance.com` (WebSocket) and `fapi.binance.com` (REST: depth snapshot, open interest, server time).
- Hyperliquid: `api.hyperliquid.xyz/ws`.

Nothing is relayed through any server of ours. There is no backend: GitHub Pages only serves the static page, and recordings, registers and keys never leave your browser unless you share a file yourself.

## Safety

- This is a research and visualization tool. **Nothing here is financial advice**, and detections are descriptions of what the tape did, not predictions.
- The **simulated paper** broker sends nothing anywhere.
- The **Binance demo** account uses keys you create in Binance Demo Trading and talks to `demo-fapi.binance.com`. API keys are typed into the page and used only from your browser (never stored, never sent anywhere but Binance); the page is public, so only enter keys on an address you trust, and give them the narrowest permissions possible (no withdrawals) and never use a key you cannot afford to lose.
- The **Binance live** option places real orders with real money. It is off until you enter keys and tick the acknowledgement that you are responsible for them. Use it at your own risk, and prefer the paper broker or the demo account while testing.

## Contributing

This is a personal project and external changes are not being actively sought, but issues and ideas are welcome. By sending a change you agree it is released under the MIT license. If you do send a change: edit `src/` (not the built file), run `node build.mjs`, add a self-test scenario for new engine behaviour, and keep UX changes separate from engine, trading and feed changes (one step, one release).

## License

[MIT](LICENSE): use, copy, modify and share it freely, with no warranty. This is a research tool, not financial advice; see [Safety](#safety).
