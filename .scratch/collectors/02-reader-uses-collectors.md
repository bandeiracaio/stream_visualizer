# Letting the Reader use the collectors: a design note

Status: DRAFT for discussion (2026-10-24). Nothing here is agreed. Nothing is built. Written after the first real collector data and the first offline analyses.

## Why
The collectors (`01-collectors.md`) log context the Reader never sees. The engine is pure, replayable and untouched by them on purpose. The question this note asks: is there a safe, testable path from "logged next to the recording" to "the Reader reads it", and what should come first? The honest starting point is that we do not know whether any collector helps any detector.

## What the first data says (2026-10-24)
- **Episodes are plentiful.** The 16 saved recordings (6.1 hours replayed with the current engine) hold 448 episode groups: absorption 135, exhaustion 116, burst 60, wall 137, about 70 an hour. Of these, only the 8 recordings from 23 Oct onwards carry any collector data (mostly telemetry); one, the 23:29 recording, carries all the collectors with a 30-minute lead-in.
- **"Outcome" does not vary for three of the four families.** Almost every absorption, exhaustion and burst ends `faded` (the engine's word for "the episode ended"), so it cannot separate good from bad detections. What varies is `resolution`, what the price did afterwards: absorption resolved-against 44 / resolved-with 34 / flat 46; exhaustion with 35 / against 27 / flat 48; burst with 14 / against 22 / flat 21. Walls vary in how they end: pulled 78, eaten 25, faded 18, left 12.
- **Context within one recording is shared.** All 27 groups of the 23:29 recording sit in the same slow context (open interest and the volatility index a little below their usual change; funding a little high). That describes the stretch, not the episode. Contrasts need many sessions in different regimes, and labels from you: no labels have been exported yet, so the labelled count is unknown.
- **The first real `hlLiq` records are all-coin liquidation fills seen from the counterparty's side** (PUMP, HYPE, NEAR), never BTC so far. Possibly a partial all-coin liquidation feed; BTC-relevant only when it happens on BTC.
- **A drifting level can fake a result.** The first evaluation "confirmed" open interest on 2.7 hours of one calm evening. Any use of collector data inside the Reader must survive the same scrutiny.

## Constraints we keep
- The engine stays pure, DOM-free and replayable. A detection never changes without your explicit approval (ADR 0001, 0003), proven by byte-comparing replays before and after.
- Collector data never changes a detection by itself. At most it is shown, then (much later, only on evidence) scored through the existing proposal and approval flow.
- No fishing: for each family, at most two hypotheses are written down before looking at labelled data, and a result needs both halves of the data (as in `analyze-collectors.mjs`).

## A ladder, each rung its own release, each only if the one below earned it
**Rung 1: show it (view only, no engine change).** On an episode card, a few chips with the collector context at detection (for example "open interest down vs its 30-minute mean", "Coinbase 3 bps above Binance", "volatility index low"): the feature's deviation from its own recent mean, as a word or a percentile against the last hours of the tape. And when you press agree or disagree, **the label stores a small snapshot of that context** (`ctx`, optional, backwards compatible). Why this first: the tape is pruned after 24 hours and a live label otherwise loses its context; a snapshot with each label is the only way the label set becomes analysable later. Cost: a card section and a label field. Risk: none to detections.

**Rung 2: measure it (offline, exists).** `analyze-episodes.mjs` over the labelled groups: agree against disagree, and result against result, per family, with the pre-written hypotheses below. Needs at least 6 agreed and 6 disagreed groups per family with the same feature; realistically 30 or more per family before a pattern means anything.

**Rung 3: put it in the checklist at weight zero (engine, byte-compare).** Each episode already has an evidence checklist (items with `ok`, a weight and a gate). A collector feature could become an item that is shown and never scored (weight 0, `gate:false`). It needs the engine to receive collector records in time order (a new input type; `feed()` already ignores unknown types, so old recordings replay the same). The byte-compare then proves that adding the item changes no detection, no stage, no outcome. Only worth building if rung 2 found a feature that is stable across sessions.

**Rung 4: let it count (only after rung 3, with many labels).** A weight above zero through the proposal and approval flow of the self-revising Reader (the same percentile maps and replay verdicts as thresholds). Nothing in this note decides that; it is listed so that rungs 1 to 3 are built with it possible.

## Candidate hypotheses (mine, to be argued with, not facts)
For each family one or two, written so that they could be wrong:

| Family | Hypothesis | Collector | Measured as |
|---|---|---|---|
| Absorption | The passive side holds longer when it is deep beyond the touch, and when other venues have not already moved | book depth (`bookBn`, `bookHl`: depth within 5 and 10 bps), venues (price gaps) | depth percentile and cross-venue gap at detection, against `resolution` (resolved-against = it held) |
| Exhaustion | A push into an extreme with funding already stretched in its direction and open interest building (a crowded side) reverses more often | derivs (funding, open interest, taker ratio) | funding and open-interest deviation at detection, against `resolution` |
| Burst | A burst with liquidations around (Binance `liq`, `hlLiq`) and open interest falling is forced flow and fades faster than one with open interest rising | derivs (`liq`), wallets (`hlLiq`), open interest | liquidation count in the minute before, open-interest deviation, against `resolution` |
| Wall | A wall is pulled more often when another venue's price is already moving away from it, and eaten more often when the wall is isolated rather than part of a deeper stack | venues, book depth | gap and depth at the wall's start, against `outcome` (pulled / eaten / left) |

What cannot be tested yet: anything on the wallets' positions (`walletsTop`) beyond liquidation prices; options skew against episodes (it moves too slowly for a seconds-long event, and is better judged against volatility, which `analyze-collectors.mjs` does).

## What would make us stop
If, with 30 or more labelled groups in a family and recordings from several different days, no pre-written hypothesis reaches the corrected threshold in both halves, that family gets no collector-based item, and we say so in the register of decisions. If no family gets one after a month, the collectors stay what they are (data for human analysis), and the weakest ones (wallets first) are switched off.

## Open questions for you
1. **How much labelling is realistic?** About 70 episode groups an hour are produced; 30 labelled per family is about 120 labels. Is that a week of evenings, or too much? (It decides whether rung 2 can ever say anything.)
2. **Which family matters most to you?** Starting with one family (and its two hypotheses) is far better than four.
3. **Rung 1 first, or analysis first?** Rung 1 changes the page (a card section, a label field) and fixes the pruned-context problem; the analysis could be run on the existing recordings with fresh labels from replays instead. I lean towards rung 1.
4. **Wallet addresses in labels and tapes:** the `liquidated` address in `hlLiq` and the followed wallets' addresses are in the data. Do you want them kept (needed to join with the trade stream), hashed, or dropped from `hlLiq` before any file is shared?
5. **Export your labels** (Reader tab, Export labels) into the repo folder, so the first counts per family are real.

## Rung 1 built (v067, 2026-10-24)
- **What it does:** an opened episode card shows a line of chips, "collector context at detection": each reading of the collectors (21 features, 17 of them shown) as its deviation from its own previous 30 minutes, listed when it is 1.5 standard deviations or more and a move worth seeing (a per-feature minimum: 0.2 bps of funding, 0.1% of open interest, 1 point of option vol, 0.5 bps of a cross-venue gap...), up to 6, strongest first; plus a chip with the Binance liquidations and the Hyperliquid liquidation fills of the minute before. Agree / disagree stores the same readings in the label (`ctx`, about 0.8 KB each).
- **Where the data comes from:** live, the last 75 minutes of records kept in memory (seeded from the tape on load); in a replay, the `ext` of the loaded session file, or, for a recording made on the page, the tape slice (30 minutes before the start).
- **What it deliberately is not:** no score, no colour that means good or bad, no effect on any detection (the engine, the episode layer and the register are untouched; `git diff` shows only `app.js`, `reader-tools.js`, `collectors.js`, `collectors-core.js` and the stylesheet).
- **Tried on real data:** the 23:29 recording replayed on localhost: all 27 groups got context (13 to 15 readings each; 6 groups with nothing unusual, 10 with one chip, up to 5 chips for one burst); the label stored 15 features. A first version flagged moves like funding +0.03 bps (many standard deviations of its own tiny jitter); the per-feature minimum fixes that.
- **Known limits:** the z-score uses the previous 30 minutes' own jitter, so a feature that barely moves can be flagged for a small move that does matter in its own unit and not flagged when it should be (a threshold that suits every feature does not exist; the minimums are a first guess). Labels made live more than 75 minutes after detection have no context (the card says so). The `ctx` snapshot is not yet read by `analyze-episodes.mjs` (it reads the session's `ext`); using the labels' own `ctx` is the natural next step so that live labels can be analysed without the recording.
