# Collector evaluation over all saved sessions (2026-11-08)

First full run of `node analyze-collectors.mjs sessions/*.gz --merge` (the plan in the script, `PLAN`, unchanged). The run in `power-2026-11-06.md` could not finish (out of memory). `--merge` now reads one file at a time, so it does.

## What changed in the script
- `--merge` streams: one session at a time, `inputs` (the bulk of a file) never kept, identical records counted once by a hash of the record, and only what the analysis needs is held: the full records of the 9 collectors the features read, every record's time (coverage), and running field statistics (`fieldAcc`).
- Not merging is untouched (same code path). Checked on 4 sessions against `git HEAD`: the default output is byte-identical (coverage, constants, evaluation). With `--fields` / `--json` two things differ: `distinct` stops counting at 2000 (shown `2001+`), and the sd of a constant field is 0 instead of rounding noise such as 2.9e-16. The "never changes" check is unaffected.
- Full run: 212 files, 1,231,023 distinct records, about 5 minutes, peak heap 1.5 GB (`--max-old-space-size=3500`).

## Data
47,585 mark prices over 375.9 h on 10 calendar days (23 Oct to 8 Nov); the plan's 24 h / 2 day minimum is met, so the verdicts are not "rehearsal". Volatility 0.58 to 3.24 bps per 10 s step (10th to 90th percentile). Collector coverage is 35% of the minutes in that window for most collectors (the recordings are not continuous), 9 to 14% for the newer ones (`tradeVol`, `vol24`, `bookPerp`, `perpFlow`).

## Result
**No feature is confirmed, and none is even "promising"**: all 21 are "nothing". The first half (the deciding one, p <= 0.05/21 and |rho| >= 0.08) passes none; the smallest first-half p is 0.069.

Plain reading, with the power caveat below: no tested collector feature adds anything about the next 5 minutes of volatility beyond the previous 5 minutes' volatility, at the effect sizes this data can see.

Things worth a look, not results (all failed the deciding half, so the plan says not to act on them):
- `bookHl.spread` has a negative partial rho in both halves (-0.14, -0.19; second half p 0.001), the only feature with the same sign and a small p in both. The first half missed the corrected threshold (p 0.076).
- `bookBn.spread` (-0.13, p 0.001) and `bookBn.depth5` (+0.09, p 0.001) are significant in the second half only, with the opposite or no sign in the first.
- `bnDerivs.fund` is -0.12 in the first half and about 0 in the second.

Spread features have a huge raw rho (-0.54, -0.31) that disappears after controlling for past volatility: they mirror current volatility, which is what the control is for.

## Caveats
- Power: `power-2026-11-06.md` says the confirming half sees correlations of about 0.11 and above at 80% power, and a true 0.08 effect passes both halves only about 9% of the time. 376 h of marks is more than the 113 h that note used, but the sample is still far below the roughly 390 recorded hours it asks for to see 0.08 in the deciding half. "Nothing" means no effect of 0.15 or more, not no effect.
- 158 of the sessions are auto-recordings, so the data leans toward volatile stretches; the 35% minute coverage means long gaps between recordings, and a feature's 30-minute mean is lost at each gap.
- The feature rows with few samples (`ratios.*` 3,661, `optChain.*` 3,996) are slow collectors and have less power.
- The hash used to count records once could in theory drop a distinct record (about 1 in 10^12 per pair); 1,231,023 records make that negligible.
- Sessions from before the collectors existed (16 to 22 Oct) hold no collector records and add nothing here.
- Constant fields found (never change over the whole run): `bookBn.rs`, `bookBy.rs`, `bookOk.rs`, `feeds.feeds.bn.oi.late`, `feeds.feeds.hl.ctx.late`; all are 0 (a count of resets or late items, so a constant 0 is the healthy reading, not a broken collector).
