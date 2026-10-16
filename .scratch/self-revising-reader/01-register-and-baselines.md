# Self-revising Reader, Part 1: assumption register + passive baselines

Status: needs-triage (inventory below awaits the user's sign-off before build)

## Goal
The Reader should revise what it believes when data differs from what it expected, and only when sure.
Part 1 makes the beliefs explicit and measures them. It changes NO detection behaviour.

Roadmap (each its own step and release):
1. This step: register + passive baseline measurement.
2. Drift flags + review screen (expected vs observed, sample count, persistence across sessions).
3. Threshold proposals + replay comparison + revision log.

## Decisions (from the grilling session)
- Register holds market assumptions only (not tuning/UI constants); new ones are added when a family starts using them.
- Entry = name, written prior, learned baseline, sample count, prior|learned marker. One baseline per variable per venue, no regimes.
- Baseline = quantile sketch (p5/25/50/75/95/99), not mean/sd.
- Session = one continuous live run; runs under a minimum length don't vote. Minimum length: TBD in Part 2.
- Evidence bar (Part 2): statistical difference over min events AND agreement across >= 3 sessions. The bar itself is a register entry.
- Baselines adopt automatically; detection thresholds are proposed and need user approval.
- Replay defaults to the baseline snapshot stored with the recording; toggle reruns under current baselines.
- Persistence: browser storage + export/import; accepted revisions also logged as dated files in the repo.

## Existing baseline machinery (found in code, build on it)
`reader-engine.js` already keeps rolling samples (1800 each, ~30 min) per venue for `buy` rate, `sell` rate, `ret` (4-bucket return, bps),
summarised as median + MAD (`stat`, `robustZ`, `sigmaBps`), valid from n>=30 (z needs n>=60), after `warmupMs` 120 s.
It also keeps `depthRing` (30 samples of bid/ask depth). So today's "learned" baseline is short-memory, per-run, not persisted,
and summarised by median/MAD only. Part 1 adds persistence and quantile sketches alongside it.

## Inventory (draft, for sign-off)

### Market assumptions (candidates for the register)
Used by the four episode families (reader-episodes.js) or the burst/absorb detectors:

| Assumption | Where | Current value | Observable to baseline |
|---|---|---|---|
| Normal price movement | `sigmaBps` (floor .05) | median/MAD of 4-bucket return | return distribution per venue |
| Normal buy/sell aggression rate | `robustZ(...,"buy"/"sell")` | MAD-based z | trades-per-second notional, fast window |
| Burst is abnormal at | `burstZ` | 3 | z of rate |
| Absorption intensity abnormal at | `absorbZ` | 2 | z of rate |
| One side dominates when share is | `burstShare` .7, `absorbShare` .65, recent() .55 | fixed | aggressor share per window |
| Price "stalled" when progress under | `absorbSigma` .5 (also stalled item) | fixed | progress in sigma units |
| Absorption efficiency | `absorbEfficiency` .25 | fixed | path efficiency distribution |
| Passive depth refills to | `absorbRefill` .8 | fixed | depth ratio after pressure |
| Aggression "decayed" when ratio under | exhaustion `decay` .5 | fixed | window-over-window rate ratio |
| Elevated before when z over | exhaustion `was` 1.5 | fixed | z of previous window |
| Avg trade size shrinking under | `size` .75 | fixed | size ratio distribution |
| Liquidations / sweeps count as many at | `liq` >=2, `sweeps` >=3 | fixed | counts per window |
| Other venue agrees when z over | `cross` 2 | fixed | cross-venue z |
| A wall is big at | `wallRatio` 8, `wallMinMult` 1.5, `wallBps` 30, `wallMinLevels` 10 | fixed | level-size / median-level distribution, spread, depth |
| Thin book at | `thinFrac` .6, `thinBps` 10 | fixed | depth vs typical |
| Imbalance enter/exit | `imbEnter` .35, `imbExit` .15 | fixed | top-of-book imbalance distribution |
| Spoof-like pulls | `spoofCount` 3 in `spoofSpanMs` 5 s | fixed | wall add/pull frequency |
| Min trades for a window to count | `minTradesFast` 5, `minTradesMid` 12 | fixed | trades per window |

### Tuning, NOT assumptions (stay plain config)
`bucketMs`, `keepMs`, `warmupMs`, `baseTauMs`, horizons, `minWindowMs`, `maxWindowMs`, `gapResetMs`, `cooldownMs`, `maxEventsPerMin`,
`keepEvents`, `sens`, `keepEpisodes`, `keepWalls`, `wallMaxActive`, `traceCap`, `refreshMs`, `pokeMs`, `*HoldMs`, `resumeMs`,
`enterScore`, `formScore`, `exitScore`, `wallConfirmMs`, `wallStaleMs`, `wallEpisodeMs`, `endExpireMs`, detector on/off flags.

Note: hysteresis scores (`enterScore` etc.) are borderline. They encode how much evidence we demand, not a market fact, so they go
through the proposal path in Part 3, not the register.

### Open questions for the user
1. Confirm the split above (anything in "tuning" you think is really an assumption, or vice versa?).
2. Which variables to measure first. Recommendation: start with the ones that already have a data stream (rate, ret/sigma, depth,
   share, size ratio) and add wall-size and imbalance sketches next.

## Part 1 scope (proposed)
- Pure module `reader-register.js` (DOM-free): register definition, quantile sketch, prior|learned handover, serialise/restore.
- Engine feeds observations to the register each second; no detector reads from it yet.
- Recordings embed a register snapshot (so Part 3 replay can default to it).
- Export/import of the register file; passive display (read-only list) in Reader tools.
- Self-test scenarios: sketch accuracy vs known distribution, handover prior->learned at the sample floor, serialise round-trip,
  replay determinism unchanged (existing scenarios must still pass with detections identical).
- Not in scope: drift detection, thresholds changing, any UI beyond a read-only list.
