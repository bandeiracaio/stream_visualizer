"use strict";
// Session quality (pure, no DOM): how complete a recording is. A recording can be an hour long on the clock and still hold almost no data
// when the tab was throttled or frozen, so every saved file carries this summary and the Saved recordings list shows it.
// An input is ["q", venue, t, bid, ask] | ["t", {t, ...}] | ["a", t] (the 250 ms clock tick) | ["s"|"b", venue, t, ...].
const SQ = (() => {
  const MIN_PER_MINUTE = 20, TICKS_PER_MINUTE = 240;      // fewer than 20 quotes and trades in a minute counts as no data; a healthy clock ticks 4 times a second
  const timeOf = r => r[0] === "t" ? (r[1] && r[1].t) : r[0] === "a" ? r[1] : r[2];
  function of(inputs) {
    const ts = [], ticks = [];
    let first = Infinity, last = -Infinity;
    for (const r of inputs || []) {
      const t = +timeOf(r); if (!Number.isFinite(t)) continue;
      if (t < first) first = t; if (t > last) last = t;
      if (r[0] === "q" || r[0] === "t") ts.push(t);
      else if (r[0] === "a") ticks.push(t);
    }
    if (!Number.isFinite(first) || last <= first) return {spanMin:0, minutes:0, dataMinutes:0, longestGapSec:0, ticksPerMin:0, verdict:"empty"};
    const n = Math.max(1, Math.ceil((last - first) / 60000)), data = new Array(n).fill(0), tk = new Array(n).fill(0);
    for (const t of ts) data[Math.min(n - 1, Math.floor((t - first) / 60000))]++;
    for (const t of ticks) tk[Math.min(n - 1, Math.floor((t - first) / 60000))]++;
    ts.sort((a, b) => a - b);
    let gap = Math.max(0, ts.length ? ts[0] - first : last - first);
    for (let i = 1; i < ts.length; i++) gap = Math.max(gap, ts[i] - ts[i - 1]);
    gap = Math.max(gap, ts.length ? last - ts[ts.length - 1] : 0);
    const tail = Math.min(1, ((last - first) - (n - 1) * 60000) / 60000);   // the last minute is usually a sliver: it needs only its share of the quotes
    const dataMinutes = data.filter((c, i) => c >= MIN_PER_MINUTE * (i === n - 1 ? tail : 1)).length, sorted = tk.slice().sort((a, b) => a - b), ticksPerMin = sorted[sorted.length >> 1];
    const verdict = dataMinutes < n * .5 ? "hollow" : dataMinutes < n || gap > 60000 ? "holes" : "complete";
    return {t0:first, t1:last, spanMin:Math.round((last - first) / 6000) / 10, minutes:n, dataMinutes, longestGapSec:Math.round(gap / 1000), ticksPerMin, clock:Math.round(100 * Math.min(1, ticksPerMin / TICKS_PER_MINUTE)), verdict};
  }
  // The collectors beside the inputs (records ["c", name, t, payload] in `ext`): for each collector of `registry` ({id, records, expectMs}) the records written between from and to
  // (the recording itself; a lead-in is left out because the fast collectors only run from the trigger), the minutes that have one, and the longest silence. state: "none" (no record at all),
  // "holes" (a silence longer than three times its usual interval, at least 30 s) or "ok". A collector that writes more rarely than a third of the window is not judged. Pass only the
  // collectors that were meant to be running. Returns null for a window under two minutes.
  const COL_MIN_WINDOW_MS = 120000, COL_FLOOR_MS = 30000;
  function collectors(ext, from, to, registry) {
    if (!Array.isArray(registry) || !(to - from >= COL_MIN_WINDOW_MS)) return null;
    const owner = {}; for (const c of registry) for (const n of c.records) owner[n] = c.id;
    const times = {};
    for (const r of ext || []) { if (!Array.isArray(r) || r[0] !== "c") continue; const id = owner[r[1]], t = +r[2]; if (id && t >= from && t <= to) (times[id] || (times[id] = [])).push(t); }
    const total = Math.max(1, Math.ceil((to - from) / 60000)), out = {};
    for (const c of registry) {
      if (!(c.expectMs * 3 <= to - from)) continue;
      const a = (times[c.id] || []).sort((x, y) => x - y), mins = new Set(a.map(t => Math.min(total - 1, Math.floor((t - from) / 60000))));
      let gap = a.length ? a[0] - from : to - from;
      for (let i = 1; i < a.length; i++) gap = Math.max(gap, a[i] - a[i - 1]);
      if (a.length) gap = Math.max(gap, to - a[a.length - 1]);
      out[c.id] = {n:a.length, min:mins.size, of:total, gapSec:Math.round(gap / 1000), state:!a.length ? "none" : gap > Math.max(3 * c.expectMs, COL_FLOOR_MS) ? "holes" : "ok"};
    }
    return out;
  }
  const colProblems = q => { const c = q && q.collectors; return c ? Object.keys(c).filter(id => c[id].state !== "ok").map(id => Object.assign({id}, c[id])) : []; };
  const span = s => s >= 120 ? Math.round(s / 60) + " min" : s + " s";
  // true when nothing is wrong with the inputs or the collectors (older files without `collectors` are judged on the inputs alone)
  const clean = q => !!q && q.verdict === "complete" && colProblems(q).length === 0;
  // one line for a list
  function line(q) {
    if (!q || q.verdict == null) return "";
    if (q.verdict === "empty") return "no data";
    const bad = colProblems(q);
    return `${q.dataMinutes} of ${q.minutes} min with data` + (q.verdict === "complete" ? "" : `, longest silence ${q.longestGapSec} s`) + (q.clock < 80 ? `, clock at ${q.clock}%` : "")
      + (bad.length ? "; collectors: " + bad.map(b => b.state === "none" ? `${b.id} no data` : `${b.id} silent ${span(b.gapSec)}`).join(", ") : "");
  }
  // Hours recorded: one cell per hour (local clock; offMs = local offset from UTC), one row of 24 per day, the last row is today (cells still to come stay empty).
  // A recording covers [t0, t1] of its quality (files from before v111: [kept time - span, kept time]); overlaps count once. frac = share of the hour covered. last24 = hours recorded in the 24 hours before `now`.
  const HOUR = 3600000, DAY = 24 * HOUR;
  function coverage(rows, now, days, offMs) {
    const iv = [];
    for (const r of rows) {
      const q = r.quality; if (!q) continue;
      const a = q.t0 && q.t1 ? q.t0 : q.spanMin ? r.at - q.spanMin * 60000 : 0, b = q.t0 && q.t1 ? q.t1 : r.at;
      if (a && b > a) iv.push([a, b]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    const un = []; for (const [a, b] of iv) { const l = un[un.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else un.push([a, b]); }
    const within = (s, e) => { let cov = 0; for (const [a, b] of un) { if (b <= s) continue; if (a >= e) break; cov += Math.min(b, e) - Math.max(a, s); } return cov; };
    const first = Math.floor((now + offMs) / DAY) * DAY - offMs - (days - 1) * DAY, slots = [];
    let total = 0;
    for (let i = 0; i < days * 24; i++) { const s = first + i * HOUR, cov = within(s, s + HOUR); total += cov; slots.push({start:s, frac:Math.min(1, cov / HOUR)}); }
    return {slots, hours:total / HOUR, last24:within(now - DAY, now) / HOUR, days};
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
