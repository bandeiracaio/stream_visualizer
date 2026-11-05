// Descriptive check: for the 50 pre-registered book-depth designs, split each trade by whether the OTHER venue had already moved in the trade's direction during the 5 s before the signal.
// If the Hyperliquid edge is just Hyperliquid catching up to Binance, it should sit in the "other venue already moved with us" bucket and vanish where it had not.
// usage: node book-lag.mjs dev|holdout|fresh [lookback seconds]   (holdout and fresh need the registered conditions: see prereg-book-depth-split.md)
import fs from "fs";
const H = await import("file:///C:/Users/Caio/stream_visualizer/design-harness.mjs");
const SD = await import("file:///C:/Users/Caio/stream_visualizer/sample-designs.mjs");
const which = process.argv[2] || "dev", LB = Number(process.argv[3] || 5);
const D = "C:/Users/Caio/stream_visualizer/.scratch/trade-system/";
const all = H.loadSessionFacts("C:/Users/Caio/stream_visualizer/sessions"), cut = H.holdoutCutoff(all);
const sessions = H.splitSessions(all, which, true, cut, undefined, which === "fresh" ? H.freshCutoff(all) : null), byFile = Object.fromEntries(sessions.map(s => [s.file, s]));
const ids = new Set(JSON.parse(fs.readFileSync(D + "prereg-book-depth-ids.json", "utf8")));
const n = 700, seed = 6; let designs = SD.generate({ pool: SD.loadPool(), n: n * 12, seed, implemented: H.implemented() }).designs;
const cellOf = d => d.trig + " | " + d.thes, cells = new Set(designs.map(cellOf)), per = Math.ceil(n / cells.size), cnt = {}, keep = [];
for (const d of designs) { const c = cellOf(d); cnt[c] = (cnt[c] || 0) + 1; if (cnt[c] <= per) keep.push(d); }
designs = keep.slice(0, n).map(x => H.instantiate(x, seed)).filter(d => ids.has(d.id));
console.log(which, "sessions", sessions.length, "designs", designs.length, "lookback", LB, "s");
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN, fx = x => x.toFixed(2);
function enrich(tr) {
  const s = byFile[tr.session], other = tr.venue === "hl" ? "bn" : "hl", ho = s.hist[other], tS = tr.tIn - 1000;
  const a = H.priceAt(ho, tS), b = H.priceAt(ho, tS - LB * 1000); if (!a || !b) return null;
  return { venue: tr.venue, gross: tr.gross, pre: tr.dir * (a[0] / b[0] - 1) * 1e4, session: tr.session };
}
const real = [], nul = [];
designs.forEach((d, di) => {
  for (const t of H.runDesign(d, sessions)) { const r = enrich(t); if (r) real.push(r); }
  for (let k = 0; k < 4; k++) for (const t of H.runDesign(d, sessions, H.EXEC, H.randomizer(6 * 7919 + di * 31 + k))) { const r = enrich(t); if (r) nul.push(r); }
});
console.log("trades real", real.length, "null", nul.length);
const B = [["other venue moved AGAINST the trade (pre < -0.2 bps)", x => x < -0.2], ["other venue flat (|pre| <= 0.2)", x => Math.abs(x) <= 0.2], ["other venue moved WITH the trade (pre > 0.2)", x => x > 0.2]];
for (const v of ["hl", "bn"]) {
  console.log(`\ntrades on ${v} (other venue = ${v === "hl" ? "bn" : "hl"}): gross by what the other venue did in the previous ${LB} s`);
  { const f = x => x <= 0.2, a = real.filter(r => r.venue === v && f(r.pre)), b = nul.filter(r => r.venue === v && f(r.pre)); console.log(`  REGISTERED LAG CONTROL (other venue did not move with the trade, pre <= 0.2): real n ${a.length} gross ${fx(mean(a.map(r => r.gross)))} | null gross ${fx(mean(b.map(r => r.gross)))} | over null ${fx(mean(a.map(r => r.gross)) - mean(b.map(r => r.gross)))}`); }
  for (const [lab, f] of B) { const a = real.filter(r => r.venue === v && f(r.pre)), b = nul.filter(r => r.venue === v && f(r.pre)); console.log(`  ${lab.padEnd(58)} real n ${String(a.length).padStart(6)} (${(100 * a.length / real.filter(r => r.venue === v).length).toFixed(0)}%) gross ${fx(mean(a.map(r => r.gross)))} | null n ${String(b.length).padStart(6)} gross ${fx(mean(b.map(r => r.gross)))} | over null ${fx(mean(a.map(r => r.gross)) - mean(b.map(r => r.gross)))}`); }
}
