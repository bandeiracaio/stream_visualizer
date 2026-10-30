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
    return {spanMin:Math.round((last - first) / 6000) / 10, minutes:n, dataMinutes, longestGapSec:Math.round(gap / 1000), ticksPerMin, clock:Math.round(100 * Math.min(1, ticksPerMin / TICKS_PER_MINUTE)), verdict};
  }
  // one line for a list
  function line(q) {
    if (!q || q.verdict == null) return "";
    if (q.verdict === "empty") return "no data";
    return `${q.dataMinutes} of ${q.minutes} min with data` + (q.verdict === "complete" ? "" : `, longest silence ${q.longestGapSec} s`) + (q.clock < 80 ? `, clock at ${q.clock}%` : "");
  }
  return {of, line};
})();
