# Market store: map and notes (step: arch/market-store)

Globals live in `src/js/app.js` (scripts share one scope; views, feeds, collectors read them by name). Shapes are unchanged by this step.

## Who writes what (grep of src/js, selftest excluded)

| Global | Writers | Readers |
|---|---|---|
| `M` (quotes, marks, OI, liqs) | `feeds.js` only (bn.bookTicker, bn.markPrice, bn.forceOrder `M.liqs++ / liqUsd +=`, OI poll `M.bnOI`, hl.bbo, hl.ctx); `app.js` `resetMarket()` | app.js, overview, futures-view/core, trading-view, micro-core, collectors-core, reader-engine/episodes/tools/drift, history-core, liq-core, broker (about 16 files) |
| `trades` | `app.js` only: `addTrade` push, `prune` (reassign), connect reset, `bnSrc` change filter, `sym` change reset | app.js, collectors-core, futures-*, reader-landscape(-view), reader-engine/episodes/register/tools, session-quality, order-history, paper-broker-core (most of these hit a local variable named `trades`, not the global; the global is read in views and app.js) |
| `cvd` | `app.js`: `addTrade` (now MARKET.bumpCvd), connect/sym reset (reassign), `bnSrc` change (`cvd.bn = 0`) | overview.js, app.js charts |
| `cvdHist` | `app.js`: 500 ms sampler, prune, resets | app.js charts |
| `midHist` | `app.js`: 250 ms sampler, prune, resets | app.js, reader-landscape-view |
| `health` | `feeds.js`: `bnReconnects++`, `hlReconnects++`, `hlReplays++`; `app.js` reset on connect | arm-mode, collectors(-core), health-log, overnight-view, reader-tools |
| `KEEP` | none (constant) | app.js |

Workers (`collectors-worker.js`, `auto-record-worker.js`) are separate threads and never touch these globals (their `trades` hits are their own websockets). No bridge writes market globals.

## What moved into `src/js/market-core.js` (MARKET, pure, self-tested)

KEEP (5 min), MID_MS 250, CVD_MS 500, `freshQuotes/freshCvd/freshHealth` (reset values), `stampMid`, `bumpCvd`, `midRow`, `cvdRow`, `prune(now, trades, midHist, cvdHist)` (sorts trades, returns new arrays, same as before). app.js keeps the `let`s, the timers and the `MI.*` pruning (MICRO data, not in this step). Behaviour is identical: same order of operations in `addTrade` (READER.onTrade, stampMid, push, simOnTrade, bumpCvd).

## Known leftover (direct writers, deliberately not moved)

- `feeds.js`: every `M.x = ...` assignment in bookTicker, markPrice, forceOrder (`M.liqs++`, `M.liqUsd +=`), OI poll, hl.bbo, hl.ctx; `health.*++` in connect/replay paths. These are plain field setters on the live object; a door would only rename them.
- `app.js`: array reassignments on connect, `sym` change and `bnSrc` change (`trades = trades.filter(...)`, `cvd.bn = 0; cvdHist = []`); these need `let` rebinding because readers hold the names.
- `prune` still reassigns the three `let` arrays via destructuring.
- `resetMarket()` does not clear `bnBidSz/bnAskSz/hlBidSz/hlAskSz` (pre-existing; kept identical).
