// Overlap between three registered families, replayed from their frozen designs:
//   book  = prereg-book-depth-designs.json (50 designs, book-depth continuation; trade venues bn and hl)
//   prem  = prereg-xv-fade-hl-designs.json (36 designs, premium fade, hl)
//   read  = Reader-episode fade, the 80 designs of results-seed4-fillfix.jsonl (trades on bn and hl)
// usage: node overlap.mjs dev|holdout        (holdout needs the registered conditions; it is used here only descriptively)
// Per venue: exposure correlation (mean signed position per design, 1 s), P&L correlation (60 s buckets), entry coincidence within +-W s against a circular-shift chance level, direction agreement.
import fs from "fs";
const H = await import("file:///C:/Users/Caio/stream_visualizer/design-harness.mjs");
const which = process.argv[2] || "dev";
const D = "C:/Users/Caio/stream_visualizer/.scratch/trade-system/";
const all = H.loadSessionFacts("C:/Users/Caio/stream_visualizer/sessions"), cut = H.holdoutCutoff(all);
const sessions = H.splitSessions(all, which, true, cut, undefined, which === "fresh" || which === "holdout" ? H.freshCutoff(all) : null);
const rd = f => fs.readFileSync(f, "utf8").trim().split("\n").map(JSON.parse);
const fam = {
  book: JSON.parse(fs.readFileSync(D + "prereg-book-depth-designs.json", "utf8")),
  prem: JSON.parse(fs.readFileSync(D + "prereg-xv-fade-hl-designs.json", "utf8")),
  read: rd(D + "results-seed4-fillfix.jsonl").filter(r => r.trig === "reader-episode-event" && r.thes === "mean-reversion-overreaction").map(r => ({ id: r.id, trig: r.trig, thes: r.thes, exit: r.exit, hor: r.hor, p: r.p })),
};
const NAMES = Object.keys(fam), VEN = ["hl", "bn"];
console.log(which, "sessions", sessions.length, "designs", NAMES.map(k => k + " " + fam[k].length).join(", "));
const rng = (seed => () => { let t = (seed += 0x6D2B79F5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(12345);
// accumulators
const corr = () => ({ n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 });
const add = (c, x, y) => { c.n++; c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y; };
const val = c => { const mx = c.sx / c.n, my = c.sy / c.n, vx = c.sxx / c.n - mx * mx, vy = c.syy / c.n - my * my; return vx > 0 && vy > 0 ? (c.sxy / c.n - mx * my) / Math.sqrt(vx * vy) : NaN; };
const pairs = []; for (let i = 0; i < NAMES.length; i++) for (let j = i + 1; j < NAMES.length; j++) pairs.push([NAMES[i], NAMES[j]]);
const acc = {}; for (const v of VEN) for (const [a, b] of pairs) acc[v + a + b] = { exp: corr(), pnl: corr(), coin: { 5: { obs: 0, chance: 0, nA: 0, agree: 0, agreeChance: 0, nAgree: 0 }, 30: { obs: 0, chance: 0, nA: 0, agree: 0, agreeChance: 0, nAgree: 0 } } };
const stats = {}; for (const f of NAMES) for (const v of VEN) stats[f + v] = { trades: 0, gross: 0, entrySec: 0, expMean: 0, expN: 0 };
const SHIFTS = 40;
for (const s of sessions) {
  const data = {};      // data[f][v] = {E, P, ev:[{t,dir}]}
  for (const f of NAMES) {
    data[f] = {}; for (const v of VEN) { const n = s.hist[v].length; data[f][v] = { E: new Float64Array(n), P: new Float64Array(n), ev: [] }; }
    for (const d of fam[f]) for (const tr of H.runDesign(d, [s])) {
      const h = s.hist[tr.venue], a = H.priceAt(h, tr.tIn), b = H.priceAt(h, tr.tOut); if (!a || !b) continue;
      const o = data[f][tr.venue]; stats[f + tr.venue].trades++; stats[f + tr.venue].gross += tr.gross;
      for (let i = a[1]; i < b[1]; i++) { o.E[i] += tr.dir; if (i > a[1]) o.P[i] += tr.dir * (h[i][1] / h[i - 1][1] - 1) * 1e4; }
      o.ev.push({ t: Math.round((tr.tIn - h[0][0]) / 1000), dir: tr.dir });
    }
    for (const v of VEN) { const o = data[f][v], N = fam[f].length; for (let i = 0; i < o.E.length; i++) { o.E[i] /= N; o.P[i] /= N; stats[f + v].expMean += Math.abs(o.E[i]); stats[f + v].expN++; }
      const by = new Map(); for (const e of o.ev) by.set(e.t, (by.get(e.t) || 0) + e.dir); o.ev = [...by].map(([t, sd]) => ({ t, dir: sd > 0 ? 1 : sd < 0 ? -1 : 0 })).filter(e => e.dir !== 0).sort((x, y) => x.t - y.t); stats[f + v].entrySec += o.ev.length; }
  }
  for (const v of VEN) for (const [a, b] of pairs) {
    const A = data[a][v], B = data[b][v], n = A.E.length, c = acc[v + a + b];
    for (let i = 0; i < n; i++) add(c.exp, A.E[i], B.E[i]);
    for (let k = 0; k + 60 <= n; k += 60) { let pa = 0, pb = 0; for (let i = k; i < k + 60; i++) { pa += A.P[i]; pb += B.P[i]; } add(c.pnl, pa, pb); }
    const T = Math.round((s.hist[v][n - 1][0] - s.hist[v][0][0]) / 1000); if (T < 120 || !A.ev.length || !B.ev.length) continue;
    const near = (evs, t, W) => { let lo = 0, hi = evs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (evs[m].t < t - W) lo = m + 1; else hi = m; } let best = null, bd = Infinity; for (let i = lo; i < evs.length && evs[i].t <= t + W; i++) { const dd = Math.abs(evs[i].t - t); if (dd < bd) { bd = dd; best = evs[i]; } } return best; };
    for (const W of [5, 30]) {
      const q = c.coin[W]; q.nA += A.ev.length;
      for (const e of A.ev) { const m = near(B.ev, e.t, W); if (m) { q.obs++; q.nAgree++; if (m.dir === e.dir) q.agree++; } }
      let ch = 0, chN = 0, chAg = 0;
      for (let r = 0; r < SHIFTS; r++) { const off = 30 + Math.floor(rng() * (T - 60)), sh = B.ev.map(x => ({ t: (x.t + off) % T, dir: x.dir })).sort((x, y) => x.t - y.t); for (const e of A.ev) { const m = near(sh, e.t, W); if (m) { ch++; chN++; if (m.dir === e.dir) chAg++; } } }
      q.chance += ch / SHIFTS; q.agreeChance += chAg / SHIFTS;
    }
  }
}
const f2 = x => Number.isFinite(x) ? x.toFixed(2) : "n/a";
console.log("\nper family and venue: trades, mean gross bps, distinct entry seconds, mean |exposure|");
for (const f of NAMES) for (const v of VEN) { const st = stats[f + v]; if (st.trades) console.log(`  ${f} ${v}: trades ${st.trades}, gross ${f2(st.gross / st.trades)}, entry seconds ${st.entrySec}, mean |exposure| ${f2(st.expMean / st.expN)}`); }
console.log("\nCORRELATIONS (same venue): exposure at 1 s | P&L in 60 s buckets");
for (const v of VEN) for (const [a, b] of pairs) { const c = acc[v + a + b]; if (c.exp.n) console.log(`  ${v}: ${a} x ${b}: exposure ${f2(val(c.exp))} | P&L ${f2(val(c.pnl))} (${c.pnl.n} buckets)`); }
console.log("\nENTRY COINCIDENCE: share of A's entry seconds with a B entry within +-W s, against the share when B's entries are shifted at random inside the session; then how often the directions agree");
for (const v of VEN) for (const [a, b] of pairs) for (const dir of [[a, b], [b, a]]) { /* only A->B for the stored direction; B->A computed below */ break; }
for (const v of VEN) for (const [a, b] of pairs) { const c = acc[v + a + b]; for (const W of [5, 30]) { const q = c.coin[W]; if (!q.nA) continue; console.log(`  ${v}: ${a} -> ${b} within ${String(W).padStart(2)} s: observed ${(100 * q.obs / q.nA).toFixed(1)}% vs chance ${(100 * q.chance / q.nA).toFixed(1)}% (x${f2(q.obs / q.chance)}) | same direction when coincident: ${(100 * q.agree / Math.max(1, q.nAgree)).toFixed(0)}% (chance ${(100 * q.agreeChance / Math.max(1e-9, q.chance)).toFixed(0)}%)`); } }
