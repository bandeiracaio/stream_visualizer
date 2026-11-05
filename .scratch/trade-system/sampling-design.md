# Monte Carlo sampling design (draft)

Date: 2026-11-04. Status: draft for discussion, nothing implemented.
Inputs: `mapping-v3.csv` (350 systems, 8 category slots), `taxonomy.md`, `distributions.md`.

## 0. What the sampling is for

Two different goals, which need different samplers. Pick which one(s) we run.

- **Goal D (describe)**: the distribution of design choices for each of the 7 parts. Answers "what ideas exist, what is common, what is missing". Needs no market data.
- **Goal T (test)**: instantiate sampled designs as concrete rules, replay them on recorded sessions, and estimate how outcomes vary with each part's category. Answers "which choices matter". Needs market data, and has a high risk of fooling ourselves (section 6).

## 1. The unit being sampled

A **design** = one category for each of 7 slots: context, regions, trigger, thesis, exit, sizing (6a), stop (6b), plus a horizon. Evaluation (part 7) is a protocol, not trading behaviour: it never changes the trades. So for goal T it is **fixed** to one common protocol (same sessions, same baselines, same cost model) for every design; it is only sampled for goal D.

Sizing is also fixed for goal T (one R per trade), since 56% of the pool is fixed-fraction anyway and varying size just rescales results. The stop type still varies.

So goal T samples 6 behavioural slots plus horizon: context, regions, trigger, thesis, exit, stop.

## 2. Why independent sampling is not enough

Cramér's V between slots (350 systems; biased upward in small samples, so values near 0.2-0.3 may be noise):

- trigger x thesis 0.56 (76 of 210 cells occupied)
- context x thesis 0.48, trigger x exit 0.48, context x trigger 0.46
- regions x trigger 0.38, thesis x exit 0.38
- most other pairs 0.25-0.35, regions x sizing lowest at 0.19

Drawing each slot independently from its marginal would produce incoherent designs (for example a liquidation-event trigger with a calendar-effect thesis and a level-magnet exit) and would put most of the sample in combinations nobody would build. Joint structure matters most for trigger/thesis/exit/context.

## 3. Samplers (run several, compare)

**A. Pool bootstrap.** Resample whole systems (all slots together) from the 350. Reproduces the idea pool exactly. Baseline for goal D; for goal T it only re-tests ideas already proposed.

**B. Chained conditional sampler (main one).** Sample in dependency order:
1. trigger ~ marginal (tempered, see section 4)
2. thesis | trigger
3. regions | trigger
4. context | thesis
5. exit | trigger, thesis
6. stop | exit
Each conditional is the empirical table from the pool, smoothed: P(x | parent) = (n(x, parent) + a * P(x)) / (n(parent) + a), with a about 3-5 so sparse cells fall back to the marginal. This keeps coherent combinations likely while still allowing unseen ones.

**C. Maximum-entropy sampler.** Each slot uniform over its categories, then rejected by the compatibility rules (section 5). Explores the space the pool under-covers; many results will be junk, which is why the rules matter.

**D. Stratified oversample.** Force every category of every slot to appear at least m times (m about 30 for goal T, to estimate marginal effects) by drawing the focal slot first and the rest from sampler B. Use to estimate "category X versus the rest".

Suggested mix for goal T: 40% B, 20% C, 40% D (strata). A for reporting only.

## 4. Tempering

Pool marginals are heavy on a few categories (regions none 40%, continuation 20%). Sample from p_i^(1/T) normalised, T = 1 reproduces the pool, T = 2 flattens toward uniform. Choose T per run and report it. Default T = 1.5.

## 5. Compatibility rules

Hard rules (reject the draw), written once as a table and reviewed by hand:
- required data not available in the repo (for example footprint bars, CME, wallet history beyond the collectors): the category is **not implementable now**. Keep it for goal D; exclude from goal T.
- regions = none with a level-rejection or level-break trigger: incoherent (the trigger needs a level). Similar rules for exits that need a level when none exists.
- exit = named-level target needs a region that supplies a level.
- horizon inconsistent with exit (a seconds horizon with a 6 h time stop).
Soft constraints are carried by the conditional tables in B. The rules table is a separate file (`compat-rules.md`) and each rejection is counted and reported, since a high rejection rate for one category is itself a finding.

## 6. Turning a design into something runnable (goal T only)

1. Each implementable category gets a **template**: what it computes from the repo (Reader episodes, sigma, collectors, futures stack, book data) and **parameter ranges** (thresholds in sigma units, windows in seconds/minutes), drawn log-uniform or uniform per parameter. A design is therefore category choices plus parameter draws; the Monte Carlo is over both.
2. Execution model fixed for all designs: next-tick fill with fee and slippage, one position at a time, 1R risk.
3. Replay on the recorded sessions (about 50 files, 277 MB in `sessions/`, covering roughly 2 days from 2026-11-03/04; check the exact span before relying on it).

## 7. Analysis of results

- **Marginal effect per category**: mean and spread of an outcome (expectancy in R, trade count, hit rate) over designs having that category, versus designs without it. A mixed or additive model over the slots, so one category is not credited for what its partners did.
- **Noise floor**: include null designs (same context/region/exit/stop but random entry times, matched in count) so every effect is read against what randomness produces. A category is interesting only if its effect clears the null distribution.
- **Multiple testing**: thousands of designs times about 70 categories will produce spurious winners. Correct (permutation over design labels) and split time: sampled designs and model fitting on the first part of the data, confirmation on the later part, never touching it before.
- **Sample size reality check**: about 2 days of data gives few independent trades per design, and trades within an episode are correlated. Expect wide intervals; the first runs will say where to look, not what to keep.
- **Reporting**: per-slot category distributions of the sampled set (to confirm the sampler does what it should), then outcome distributions per category.

## 8. Reproducibility

Seeded generator (seed stored in the output header), design list written before any replay, sampler version and tempering recorded, rejected draws counted. All sampling code offline (a script at the repo root like the other `*.mjs` analysis tools), not part of the app, with a `--selftest`.

## 9. Open decisions

1. Goal D only, or also goal T?
2. If T: which categories to implement first as templates (those using Reader episodes, sigma and collectors are cheapest).
3. Tempering default and the strata minimum m.
4. Who writes the compatibility rules: me from the taxonomy, a subagent, or you.
5. Hold-out: reserve the most recent data now, before anything is sampled.
