# Analysis lab entries

One file per experiment, `lab_<YYYY-MM-DD>_<slug>.json`, kind `sv-lab-entry`. Written by the offline scripts (or by hand), dropped here, committed.
`node build.mjs` checks every entry (`LAB.validate` in `src/js/lab-core.js`; a bad entry aborts the build) and embeds them all in the page, so the Analysis > Lab tab shows them offline on a phone or a PC without running anything.

Entries hold results only, reduced and small (under 200 KB each), never raw data. Spec: `.scratch/analysis-lab/spec.md`.

## Shape

```
{ "kind": "sv-lab-entry", "version": 1,
  "id": "slug-with-dashes",            // same as the file's slug
  "title": "...", "date": "YYYY-MM-DD",
  "verdict": "confirmed | rejected | inconclusive | idea | sample",
  "verdictNote": "free text: what we conclude and how far to trust it",
  "question": "what we wanted to know",
  "tags": ["bars", "flow"],
  "data": { "files": ["session_....json.gz"], "range": "2026-10-20 .. 2026-10-28", "counts": { "bars": 1234 } },
  "method": { "summary": "...", "params": { }, "plan": ["fixed in advance: ...", "..."], "rerun": "node lab-....mjs ..." },
  "results": [ blocks ] }
```

Blocks (`type`): `text` {text}; `table` {title, columns[], rows[][]}; `bars` {title, unit, items[{label, value}]}; `series` {title, xLabel, yLabel, x[], y[]}.
Language: "associated with, after controlling for ...", not "causes", unless the design supports it. A rate or cluster under the minimum count is not reported as a finding.
