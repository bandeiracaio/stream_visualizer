"use strict";
// Session quality (pure, no DOM): how complete a recording is. A recording can be an hour long on the clock and still hold almost no data
// when the tab was throttled or frozen, so every saved file carries this summary and the Saved recordings list shows it.
// An input is ["q", venue, t, bid, ask] | ["t", {t, ...}] | ["a", t] (the 250 ms clock tick) | ["s"|"b", venue, t, ...].
// Since R1 the figures run in WebAssembly (rust/crates/sv-quality, loaded by wasm-loader.js as SVWASM); the signatures and results are the ones the JS version had
// (that version is src/js/js-cores/session-quality.js, SQ_JS, and `node parity.mjs sq` compares the two). Here: `of` reduces the inputs to (kind, time) pairs (a recording is millions of rows and only those are read),
// `collectors` reduces the records to (name, time), objects whose key order JS decides are rebuilt from pairs and key lists, and the problem objects are built from the ids Rust returns.
// The cost: `of` sends one number per input as JSON (about 14 bytes per row).
const SQ = (() => {
  const wasm = (fn, o) => SVWASM.call("sq_" + fn, o);
  const enc = x => typeof x === "number" && !isFinite(x) ? String(x) : x;      // a non-finite number goes as its text
  const timeOf = r => r[0] === "t" ? (r[1] && r[1].t) : r[0] === "a" ? r[1] : r[2];
  function of(inputs) {
    const kinds = [], times = [];
    for (const r of inputs || []) { const t = +timeOf(r); kinds.push(r[0] === "q" || r[0] === "t" || r[0] === "a" ? r[0] : "o"); times.push(Number.isFinite(t) ? t : null); }
    return wasm("of", {kinds:kinds.join(""), times});
  }
  // The collectors beside the inputs (records ["c", name, t, payload] in `ext`): for each collector of `registry` ({id, records, expectMs}) the records written between from and to
  // (the recording itself; a lead-in is left out because the fast collectors only run from the trigger), the minutes that have one, and the longest silence. state: "none" (no record at all),
  // "holes" (a silence longer than three times its usual interval, at least 30 s) or "ok". A collector that writes more rarely than a third of the window is not judged. Pass only the
  // collectors that were meant to be running. Returns null for a window under two minutes.
  function collectors(ext, from, to, registry) {
    if (!Array.isArray(registry)) return null;
    const recs = [];
    for (const r of ext || []) { if (!Array.isArray(r) || r[0] !== "c") continue; const t = +r[2]; recs.push([String(r[1]), Number.isFinite(t) ? t : null]); }
    const r = wasm("collectors", {recs, from:enc(from), to:enc(to), registry});
    if (!r) return null;
    const out = {}; for (const [k, v] of r) out[k] = v;
    return out;
  }
  const keysOf = q => { const c = q && q.collectors; return c ? Object.keys(c) : []; };
  const colProblems = q => { const c = q && q.collectors; return c ? wasm("col_problems", {q, keys:Object.keys(c)}).map(id => Object.assign({id}, c[id])) : []; };
  // true when nothing is wrong with the inputs or the collectors (older files without `collectors` are judged on the inputs alone)
  const clean = q => wasm("clean", {q, keys:keysOf(q)});
  // one line for a list
  const line = q => wasm("line", {q, keys:keysOf(q)});
  // Hours recorded: one cell per hour (local clock; offMs = local offset from UTC), one row of 24 per day, the last row is today (cells still to come stay empty).
  // A recording covers [t0, t1] of its quality (files from before v111: [kept time - span, kept time]); overlaps count once. frac = share of the hour covered. last24 = hours recorded in the 24 hours before `now`.
  const HOUR = 3600000, DAY = 24 * HOUR;
  function coverage(rows, now, days, offMs) {
    const r = wasm("coverage", {rows:rows.map(x => ({at:x.at === undefined ? "NaN" : x.at, quality:x.quality && {t0:x.quality.t0, t1:x.quality.t1, spanMin:x.quality.spanMin}})), now:enc(now), days:enc(days), offMs:enc(offMs)});
    const d = x => typeof x === "string" ? Number(x) : x;      // NaN / Infinity / -0 come back as text
    return {slots:r.slots.map(x => ({start:d(x.start), frac:d(x.frac)})), hours:d(r.hours), last24:d(r.last24), days};
  }
  function selftest() {
    const out = [], ok = (name, pass) => out.push({name:"coverage: " + name, ok:!!pass, detail:""});
    { const H = HOUR, now = 100 * H + 30 * 60000, rows = [      // 100 h = day 4 at 04:00 UTC, so today's cells run from 96 h
        {at:90 * H, quality:{t0:88 * H, t1:90 * H}}, {at:90 * H, quality:{t0:89 * H, t1:91 * H}},
        {at:99 * H, quality:{spanMin:60}}, {at:50 * H, quality:null}, {at:100 * H, quality:{t0:100 * H, t1:100 * H + 30 * 60000}}];
      const c = coverage(rows, now, 2, 0), at = h => c.slots.find(x => x.start === h * H);
      ok("rows of 24 hourly cells, the last day starts at local midnight", c.slots.length === 48 && c.slots[24].start === 96 * H && c.slots[0].start === 72 * H);
      ok("overlapping recordings count once", [88, 89, 90].every(h => at(h).frac === 1) && at(87).frac === 0 && at(91).frac === 0);
      ok("older files use kept time minus span; no quality is skipped", at(98).frac === 1 && at(99).frac === 0 && c.hours === 3 + 1 + .5);
      ok("the current hour counts only what has happened; later cells are empty", at(100).frac === .5 && at(101).frac === 0);
      ok("last 24 h counts the window before now", c.last24 === 4.5 && coverage(rows, 125 * H, 2, 0).last24 === 0);
      ok("a local offset moves midnight", coverage(rows, now, 1, 2 * H).slots[0].start === 94 * H); }
    return out;
  }
  return {of, line, collectors, colProblems, clean, coverage, selftest};
})();
