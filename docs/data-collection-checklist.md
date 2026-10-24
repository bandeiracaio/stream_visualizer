# Data collection checklist

For the first real collection weeks. Numbers come from the code defaults (`reader-register.js`, `auto-record-core.js`); if a default changes, change it here.

## What counts as a usable session

- **Length: at least 10 minutes** (`minSessionMs` 600000). Shorter sessions are stored but do not count toward baselines, drift or the static expectation.
- **A variable is judged only with 300 samples** (`minSamples`, `minLearned`); a family needs **3 episodes** (`minEpisodes`) before its thresholds are reviewed.
- **Drift needs history**: 5 reference sessions (`k`) before anything can differ, then 3 differing sessions in a row (`m`) to confirm. Plan for at least 5 counted sessions before expecting a drift flag, and about 8 before expecting a proposal.
- **Mix the conditions**: sessions are tagged by hour and weekday, so spread them (a calm weekend and a busy weekday are different data). A run longer than an hour is cut into hourly segments automatically.

## Before leaving the app running

1. Open the latest `stream-visualizer_vNNN.html` (the version is the small tag next to the title, `vNNN`, or `dev` in a dev build; compare it with the newest file in the repo root. A page that is behind shows a "newer version" bar).
2. Leave **warm-up** to finish (the Reader shows calibrating until it has enough data); nothing is recorded in the baselines before that.
3. Keep the tab **visible**: its own Chrome window, in front, not minimized, not covered, not behind another tab, screen awake and the computer plugged in and set not to sleep. A hidden tab has its timers slowed to once a minute and can be frozen by the browser (seen on 2026-10-22: freezes of about 55 s a minute, price stream dropping every 2 minutes, learning restarting, and a recording that held 5 minutes of data in an hour). Chrome: turn off Memory Saver (`chrome://settings/performance`); the flags `chrome://flags` *Calculate window occlusion* and *Intensive wake up throttling* may also matter. The wake lock only works while the tab is visible.
4. For jumps in activity, **arm auto-record at least 15 minutes ahead** (it needs 15 minutes of prices for its hour baseline). It starts at 1.8x the hour's sigma (above the 0.4 floor) or above 1.2 bps per root second, stops after 5 calm minutes or 60 minutes, then downloads the file.
5. The app must be disconnected to arm auto-record; arming opens one price socket only. The **Arm** button is in the header next to Pause (it turns amber and says Disarm while armed; its answer shows next to it for a few seconds) and also in the Reader tab; both use the settings of the Reader tab.

## Unattended collection: how to tell it worked

- The header chips show `armed · waiting`, not `learning` after the first 15 minutes. If it keeps going back to `learning`, the tab is being throttled or frozen: open **Health log** (Reader tab, under Saved recordings) and look for `page frozen by the browser`, `gap`, `tab hidden`, `price-stream drop`, `wake lock lost`.
- Each saved recording shows a quality line in **Saved recordings** (`47 of 61 min with data, longest silence 60 s, clock at 43%`). It is amber when there are holes. A `hollow` file (fewer than half the minutes have data) is not worth analysing; keep its health log.
- An auto-recording also holds `pre`: the 30 minutes of Binance mark price before the trigger and the reading that fired it. Use it to see whether the trigger was late.
- Since v050 the price feed runs in a Web Worker and the armed page holds a Web Lock, so a hidden tab should keep learning; the recording itself still runs on the page and needs the visible window.
- Send the Health log (Download log) along with any recording that has holes.

## Collectors (since v053): data beyond the Reader's inputs

Collectors write records `["c", name, t, payload]` to a rolling 24 h tape on the device (IndexedDB `sv-tape`), and every saved session carries the matching slice as `ext` (from a minute before it started, or **30 minutes before the trigger for an auto-recording**, like its `pre` prices; newest records first, at most 8 MB). The Reader never sees them: they cannot change a detection (checked by byte-comparing detections on simulated sessions, v053 against v060). Nothing in the app analyses them yet; they are there to be read afterwards. Specs and exact record shapes: `.scratch/collectors/01-collectors.md`.

**Always on while the page is open** (they run in a worker, so a hidden tab does not slow them):
- `telemetry`: the page's feeds every 10 s while connected, and the worker's price stream while armed (`feeds`, `markPrice`).
- `derivs`: Binance premium index and open interest, Hyperliquid funding and open interest (every 15 s), long-short and taker ratios (new 5-minute point only), basis every 10 s, every liquidation (`bnDerivs`, `hlCtx`, `ratios`, `basis`, `liq`).
- `calendar`: funding times, candle closes, US open and close, options expiry, by rule (`cal`). Exchange holidays are not known.
- `wallets`: the 10 Hyperliquid wallets that traded the most in the coin over 15 minutes: their positions and liquidation prices every 30 s (first reading about 60 s after load), fills of theirs that carry a liquidation flag (see below), and predicted funding across venues (`walletsTop`, `hlLiq`, `fundPred`). Full wallet addresses are in these records.
- `options`: Deribit volatility index every 10 s and an option chain summary every 120 s, **BTC and ETH only** (`dvol`, `optChain`).

**Only while connected and recording** (`book`) or **while recording or auto-record is armed** (`venues`):
- `book`: depth within 1 / 5 / 10 / 20 bps, spread, touch size, size added and removed (`bookBn`, `bookHl`). Runs on the page, so a hidden tab thins it out.
- `venues`: Coinbase, Bybit, OKX, Binance spot and the majors' marks, once a second (`venues`). The page tells the worker when a recording starts or stops or auto-record is armed or disarmed, so a hidden tab may start it a few seconds late. This is what gives an auto-recording the cross-venue context from before the trigger. `book` cannot do that: it needs the full feeds connected, and an armed app listens to one price stream only.

Things to know:
- The collectors follow the **Symbol** box. Changing the symbol, or a switch, restarts the worker (the wallet ranking starts over). For a coin other than BTC, some venues do not list it and its sources are simply missing; `options` stays idle unless the coin is BTC or ETH.
- Switches, the record count, **Download tape** and **Clear tape** are in the Reader tab under Health log ("Collectors"). A file from Download tape is `tape_*.json`; keep it out of git (`.gitignore` covers `tape_*.json`, `health_*.json` and recordings).
- Rough size on the device (estimates from short live runs, not yet measured over a day): derivatives about 4 MB a day, wallets 3 to 5 MB, options about 2 MB, telemetry more while the app is connected; plus about 2 MB an hour each for `book` and `venues` while recording. A recording of an hour carries roughly 4 to 5 MB of `ext`.
- To check it is working (v064): each collector has a line under its switch in the Collectors list (Reader tab, under Health log): `N on the tape · last 3 s ago` in green is writing; amber means its last record is more than three times later than it should be (`slower than expected`) or nothing has been written long after the page opened; a plain grey line says why it is not expected to write now (`waits for a recording`, `waits for the app connected and recording`, `Deribit lists BTC and ETH only`, `off`). The calendar line says `starting…` until the first 15-minute mark. A source that fails also writes `collector error` to the Health log, at most once per 5 minutes per source. Download the tape and look at the record names above.
- A frozen page cannot write to the tape: the worker keeps collecting and the page writes the records when it thaws, with their own times.
- `hlLiq` was checked on real data (2026-10-24): the shape is as documented, but in all 11 records the followed wallet (`w`) is **not** the liquidated one (`liquidated`): it is the wallet taking the other side of a liquidation, in any coin (PUMP, HYPE, NEAR so far, not BTC). So `hlLiq` is a partial feed of Hyperliquid liquidations (those where a followed wallet is the counterparty), not a log of the followed wallets being liquidated.

## Reading the collector data afterwards

`node analyze-collectors.mjs tape_*.json session_*.json.gz` (from the repo root; add `--fields` for every numeric field, `--horizon 600` for a 10-minute look-ahead, `--json` for machine output). Per file it prints:
- **Coverage** per collector: records, share of minutes with data, longest gap, and how many gaps were within three times the usual interval. Low numbers mean the page was frozen or the collector was off.
- **Lead-in** (sessions only): how many minutes before the start each collector's data reaches. An auto-recording should show about 30 for the always-on collectors; it is flagged when under 25. Venues (from arming) and book depth (from the start of the recording) are not flagged.
- **Fields that never change**: a collector reading a constant tells you nothing (some are expected, for example a funding rate that does not move for hours).
- **Evaluation** (the monthly judgement's tool): each of 21 features (volatility index, funding, basis, book imbalance, cross-venue price gaps, option skew...) against the volatility of the Binance mark over the next 5 minutes, **controlling for the volatility of the previous 5 minutes** (volatility clusters, so a feature that only mirrors it would look predictive without being so). The plan is fixed in the script and printed with every result: partial rank correlation; permutation p-values that respect the autocorrelation; a correction for testing 21 features; and the data split in time, where the first half decides and the second must agree. Each feature enters as its **deviation from its own mean of the previous 30 minutes** (a level that drifts all night, such as open interest, funding or a volatility index, would otherwise pass by drifting alongside the volatility). A feature is `CONFIRMED` only if both halves agree, `promising, not confirmed in the second half` if only the first does, `nothing`, or `not enough data`. It needs the `basis` collector for many hours: use `--merge` with all the `tape_*.json` and `session_*.json.gz` files (identical records are counted once). Under 24 hours of marks, or on fewer than 2 calendar days, every verdict is labelled `rehearsal only (...)` and the output says so; it also warns if the volatility barely moved. What it cannot tell: a feature that knows the present volatility sooner than five minutes of price history (an implied-volatility index, say) will show up as predictive; read that as "knows the present sooner", which can still be useful, not as a forecast.

### Collector context on the episode cards (v067)
Open an episode card (tap it): above "your call" a line says **collector context at detection**. Each chip is one collector reading that was unusual when the episode was detected: how far it was from its own mean of the previous 30 minutes, in standard deviations (1.5 or more) and large enough to matter (a funding rate that moved 0.03 bps does not show). Amber with ▲ means higher than usual, blue with ▼ lower; the amount is in the chip, and the exact numbers are in its tooltip. A `liquidations N BN · M HL` chip counts Binance liquidations and Hyperliquid liquidation fills in the minute before. "nothing unusual" means the readings were within 1.5 standard deviations. "none at that time" means the collectors were off, or the data does not reach back that far (the cards live read the last 75 minutes in memory; in a replay, the session's own collector records, so only recordings saved with v053 or later, and best with v063 or later).
When you press **agree** or **disagree**, the same readings are stored inside the label (`ctx`), because the tape is pruned after 24 hours and the label is not. Export labels includes them. This is display only: it changes no detection.

### Collector context against your labels: `analyze-episodes.mjs`
`node analyze-episodes.mjs session_*.json.gz --labels reader_labels.json --tape tape_*.json` replays each saved session through the Reader (the same code as the app; default thresholds, or `--cfg file.json`), takes one entry per event (the fast and mid readings of one thing are one group, as with labels), and for each family prints:
- the groups, their sides and outcomes, and how many you labelled (`Export labels` in the Reader tab gives `reader_labels.json`; only sessions saved with v053 or later carry `ext`);
- **context**: features that were unusually high or low when it fired: the percentile of the feature's deviation from its own 30-minute mean (median at least 15 from 50), against everything the collectors read in the data given; `--tape` adds a whole night as the "usual". Slow levels (funding, open interest, a volatility index) would otherwise sit at the same extreme for a whole recording and say nothing about any episode in it;
- **labels**: the mean percentile of each feature in the groups you agreed with against those you disagreed with, with a permutation p-value; `suggestive` only below 0.05 / 21;
- **results**: the same for the two most common results of the family. For a wall the result is how it ended (pulled, eaten, left); for the other families every episode "faded" (ended), so the result is what the price did afterwards (resolved with the aggressor, against it, or flat).
It needs a few dozen labelled groups per family before the last two sections print anything (at least 6 agree and 6 disagree with the same feature). Your labels are the only ground truth, so label as you watch. It describes and points; it does not tell you to keep or drop a collector.

## After a session

1. Reader tab: check the **Sessions** list shows the session as counted, and that no variable is stuck on `prior` that should be `learned`.
2. Look at any **drift flag**: acknowledge it if it is real market change, undo it if it was an anomaly (a test run, an outage).
3. Use agree / disagree / missed labels on episodes you watched; they are the only ground truth the replay can be judged against.
4. Keep the downloaded recording files together (they replay against the stored baseline snapshot, ADR 0002). The collector data travels inside each file as `ext`.

## Weekly review

1. Reader tab: export the **review report** and the **register**.
2. Read the report: *To review*, *Threshold proposals*, *Variables*, *Sessions*, *History*. Sigma-scale registers from before v012 are on the wrong scale; do not use them.
3. Approve or reset a proposed threshold; the app downloads a revision file. Drop it in `docs/revisions/`.
4. Before a release: `node fold.mjs --check`, then `node fold.mjs`, review the diff, `node build.mjs`, then `node build.mjs --release`.
5. Approving never changes a detection by itself; only an approved threshold does (ADR 0001, 0003).

## What not to expect yet

- A proposal from fewer than ~8 counted sessions, or from one market regime only.
- Any use of the collector data inside the app. The judgement of whether a collector is worth keeping (coverage, variance, whether it leads the next 5 minutes of volatility or movement) needs a few weeks of recordings and an offline script that does not exist yet.
- Anything about Hyperliquid tails or the fast sigma component until a recording contains a real jump in activity (the motivation for auto-record).
