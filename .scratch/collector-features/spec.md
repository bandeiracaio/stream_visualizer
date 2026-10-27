# Features from the collected data: plan

Status: DRAFT (2026-10-26). Agreed with the user: build areas 1 to 4 of the brainstorm. Each release is one step. Everything is display or analysis only: the engine, the episode layer, the register and every detection stay untouched (byte-compare on simulated scenarios before and after, as for v067).

Already there (v067, `.scratch/collectors/02-reader-uses-collectors.md`): chips on an opened episode card with each collector reading's deviation from its own previous 30 minutes, a cross-venue gap chip, a liquidation count chip, and `ctx` stored in agree / disagree labels. The steps below add to that; they do not replace it.

Honest limit: about one hour of collector data exists. Every step shows or records evidence; none claims an edge. Verdict words stay "rehearsal only" until `analyze-*` says otherwise.

## Pure logic first
Each step puts its maths in `collectors-core.js` (the `COLLECT` object) or a new pure file with `--selftest`-style scenarios in the build, and its drawing in a view file. Features that read slow series use the same "deviation from own trailing mean" idea as `COLLECT.context`.

## Releases (in this order; each is its own commit and `--release`)

### A. Cross-venue lead / lag on episode cards (area 1)
- Question answered: when an episode was detected, which venue's mark moved first, with, or after Binance perps?
- Input: `venues` records (Coinbase, Bybit, OKX, Binance spot) and the majors' marks in `ext` / tape.
- Output: one chip per venue in the opened card ("Coinbase led by ~2 s", "Bybit with", "OKX no move"), computed over the 60 s before detection. A venue with too little data shows "no reading", never a guess.
- Stored in the label `ctx` as an extra key, backwards compatible.

### B. Liquidation attribution (area 1)
- Question: was the episode forced flow? Today only a count chip exists.
- Tag an episode "liquidation-driven" when Binance `liq` or `hlLiq` notional in the window around detection is unusual against its own trailing hour. The tag is a chip with the numbers beside it, no colour judgement.
- Caveat kept visible: `hlLiq` is the counterparty of a liquidation, in any coin; only BTC fills count for a BTC session.

### C. Wall quality (area 1)
- Question: is a wall big against normal depth, and was it pulled before price arrived?
- Input: book depth summaries (`bookBn`, `bookHl`, edges 1/5/10/20 bps) around the wall's span.
- Output: chips "wall = N x usual depth at 5 bps", "depth at that edge fell X% before touch". Needs depth records inside the wall's span; shows "no reading" when recording-only data is missing (live book depth exists only while recording).

### D. Market state strip (area 2)
- Combine DVOL, funding, open interest change, basis and cross-venue dispersion into a few named states (working names: calm, crowded, stressed), each state a fixed written rule with its numbers visible, not a fitted model.
- Shown on the Overview card and as a track under the Review timeline. Labels and episode groups carry the state at detection so `analyze-episodes.mjs` can slice by it.
- Rules written before looking at data; any later change is a new version of the rule, noted here.

### E. Event-risk clock (area 2)
- Countdown to the next funding time, options expiry and tagged macro slot, from `COLLECT.calendar`. Overview card plus a chip on episodes detected within a set window of one.

### F. Hyperliquid smart-flow panel (area 3)
- Net change in the top 10 traders' positions over the last N minutes beside the price, plus a crowd-vs-whales row (their net direction against aggregate taker flow).
- Caveat on screen: wallet fills in liquidation are the counterparty's, not the liquidated trader's.

### G. Options lens (area 4)
- Realized sigma (the register's measure) against DVOL, as a ratio with a plain word ("realized above implied"). Skew shift from the moneyness skew that already exists. Overview card and a Review track.
- Real 25-delta skew stays out (one request per option; its own spec).

## Not in this plan
The learning loops (hypothesis tracker, label-aware proposals, morning digest) wait for real data and labels. Rungs 3 and 4 of the ladder in `02-reader-uses-collectors.md` (engine reads collectors) stay closed.

## Order of work and why
A, B, C share the card-chip code and the label `ctx`, so they go first. D needs one more column of data in the labels, which A to C add. E, F, G are independent views and can follow in any order.

## Each release must
1. add self-tests for its pure functions (including "no data" and "stale data" cases);
2. byte-compare Reader detections on the simulated scenarios before and after;
3. check `git diff --stat` for CRLF damage;
4. be tried on the real auto-recordings in the repo root (the two that carry all collectors) and on a 390 px iframe;
5. note what it showed in this file.

## A built (v079, 2026-10-26)
- `COLLECT.venueLead(rows, tMs)` (pure, self-tested) and `leadText`; `context()` returns it as `lead`. Row "who moved first (vs Binance spot)" under the context chips (`epLeadBar` in `collectors.js`); label `ctx.lead = {ref, move, v:{venue:[seconds led (negative: lagged; null: no timing), move in bps]}}`.
- Reference is Binance **spot**, not the perp: the perp is not in `ext`. Venues are compared by their change over the 60 s before detection, never by level (Coinbase is USD, perps carry a basis).
- Timing is the first time a venue covered half of its own move; records come about once a second, so "with it" = within 2 s. Plain chips, no colour meaning good or bad.
- Found on the real recordings (02:29 and 03:50 UTC, 24 Oct): the first version gave "led by 34 s" on slow drifts where each venue happened to step at a different moment. Fixed: the reference's 25% to 75% stretch must take at most 40% of the window, otherwise the row says "gradual move, no timing". Also "no clear move" below 2 bps, and "too few readings" without Binance spot.
- Still noisy by nature: first-passage on stepped prices, 1 s clock. Treat a lead of a few seconds as a hint, not a measurement.
- Engine, episode layer and register untouched (`git diff`: `collectors-core.js`, `collectors.js`, `reader-selftest.js` only), so no detection byte-compare was needed; the 135 self-test scenarios pass.

## B built (v080, 2026-10-26)
- `COLLECT.liqDriven(recs, tMs, {coin})` (pure, self-tested), returned by `context()` as `liqx`; chip `epLiqChip` on the card replaces the v067 count chip. The label gets `ctx.lq = {bn:[sell,buy], hl:[sell,buy], x, other, tag}` in dollars (the old `ctx.liq` counts stay).
- Rule, written before looking at episodes: "liquidation-driven" = at least $500k forced in the 60 s before detection AND at least 10 times the average minute of the previous hour (when under 10 minutes of earlier data exist, the floor alone). Floor chosen from the overall distribution of 60 s windows in the first 17 recordings (76% of windows empty, p95 $64k, p99 $3.6M), not from episodes or labels. Any change to the rule is a new version, noted here.
- Counts: Binance `liq` of the symbol (side SELL = a long forced to sell); Hyperliquid `hlLiq` only in the session's own coin (the followed wallet is the counterparty: it BOUGHT when the liquidated trader was forced to sell). Fills in other coins are only counted ("N Hyperliquid fills in other coins"), as a rough stress gauge.
- On the 17 recordings the rule fires on 1.2% of 30 s moments (14 of 1,188), six distinct stretches in about 10 hours; the biggest, 15:16 UTC on 24 Oct, was $12.5M of forced sells (Binance $7.3M, Hyperliquid $5.2M).
- Limit: auto-recordings carry about 30 minutes of lead-in, so the "previous hour" is usually 20 to 30 minutes; the chip says how many minutes it used. Binance's forced-order feed is throttled to about one event a second per symbol, so its dollar totals are a floor.
- Engine, episode layer and register untouched.
