// Does family B's state add information to family A's trades? (same venue, frozen designs, latency 1 s)
//   book = prereg-book-depth-designs.json (50), prem = prereg-xv-fade-hl-designs.json (36, hl only), read = Reader fade (80, results-seed4-fillfix.jsonl)
// For every trade of A: x = A's direction times B's mean signed position (average over B's designs of +1/-1/0 for positions open) at the signal time (entry minus 1 s; only B trades already open and not yet closed count).
// x > 0: B was positioned the same way as A, x < 0: opposite, 0: B flat. Reported: A's mean gross by bucket of x, for A's real trades and for random-entry trades of the same designs (same exits),
// and the OLS slope of gross on x (real, null, difference) with a session-bootstrap interval. usage: node incremental.mjs dev|holdout
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
const NAMES = Object.keys(fam), VEN = ["hl", "bn"], NULLREPS = 3, TH = 0.05;
console.log(which, "sessions", sessions.length, "designs", NAMES.map(k => k + " " + fam[k].length).join(", "));
// rows[A][B][v] = { real: [], nul: [] } of {x, g, ses}
const rows = {}; for (const A of NAMES) { rows[A] = {}; for (const B of NAMES) if (A !== B) { rows[A][B] = {}; for (const v of VEN) rows[A][B][v] = { real: [], nul: [] }; } }
let si = 0;
for (const s of sessions) {
  si++;
  const E = {};      // E[f][v] exposure per second
  const trades = {}; // trades[f] real trades, trades[f+"N"] null trades
  for (const f of NAMES) {
    E[f] = {}; for (const v of VEN) E[f][v] = new Float64Array(s.hist[v].length);
    trades[f] = []; trades[f + "N"] = [];
    fam[f].forEach((d, di) => {
      for (const tr of H.runDesign(d, [s])) {
        trades[f].push(tr); const h = s.hist[tr.venue], a = H.priceAt(h, tr.tIn), b = H.priceAt(h, tr.tOut); if (!a || !b) continue;
        for (let i = a[1]; i < b[1]; i++) E[f][tr.venue][i] += tr.dir / fam[f].length;
      }
      for (let k = 0; k < NULLREPS; k++) for (const tr of H.runDesign(d, [s], H.EXEC, H.randomizer(1000003 * (si + 1) + di * 31 + k))) trades[f + "N"].push(tr);
    });
  }
  for (const A of NAMES) for (const B of NAMES) {
    if (A === B) continue;
    for (const [list, key] of [[trades[A], "real"], [trades[A + "N"], "nul"]]) for (const tr of list) {
      const h = s.hist[tr.venue], a = H.priceAt(h, tr.tIn - 1000); if (!a) continue;
      rows[A][B][tr.venue][key].push({ x: tr.dir * E[B][tr.venue][a[1]], g: tr.gross, ses: si });
    }
  }
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN, f2 = x => Number.isFinite(x) ? x.toFixed(2) : "n/a";
function slope(arr) { let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (const r of arr) { n++; sx += r.x; sy += r.g; sxx += r.x * r.x; sxy += r.x * r.g; } const den = n * sxx - sx * sx; return den > 0 ? (n * sxy - sx * sy) / den : NaN; }
const rnd = (seed => () => { let t = (seed += 0x6D2B79F5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(777);
function bootSlope(real, nul, B = 300) {
  const by = r => { const m = new Map(); for (const x of r) { if (!m.has(x.ses)) m.set(x.ses, []); m.get(x.ses).push(x); } return m; };
  const mr = by(real), mn = by(nul), keys = [...new Set([...mr.keys(), ...mn.keys()])]; const sr = [], dd = [];
  for (let b = 0; b < B; b++) { const pr = [], pn = []; for (let i = 0; i < keys.length; i++) { const k = keys[Math.floor(rnd() * keys.length)]; if (mr.has(k)) pr.push(...mr.get(k)); if (mn.has(k)) pn.push(...mn.get(k)); } const a = slope(pr), c = slope(pn); if (Number.isFinite(a)) { sr.push(a); if (Number.isFinite(c)) dd.push(a - c); } }
  sr.sort((a, b) => a - b); dd.sort((a, b) => a - b); const q = (v, p) => v[Math.floor(p * (v.length - 1))];
  return { real: [q(sr, .025), q(sr, .975)], diff: [q(dd, .025), q(dd, .975)] };
}
console.log(`\nA's trades split by what B was doing at the signal (aligned: B positioned the same way, x > ${TH}; opposed: x < -${TH}; flat otherwise). gross in bps; over null = real minus random-entry trades in the same bucket`);
for (const v of VEN) for (const A of NAMES) for (const B of NAMES) {
  if (A === B) continue; const r = rows[A][B][v]; if (!r.real.length) continue;
  if (A === "prem" && v === "bn" || B === "prem" && v === "bn") continue;
  const bucket = (arr, lo, hi) => arr.filter(t => t.x > lo && t.x <= hi);
  const parts = [["aligned", TH, Infinity], ["flat", -TH, TH], ["opposed", -Infinity, -TH]].map(([lab, lo, hi]) => { const a = bucket(r.real, lo, hi), b = bucket(r.nul, lo, hi); return `${lab} ${(100 * a.length / r.real.length).toFixed(0)}% g ${f2(mean(a.map(t => t.g)))} (null ${f2(mean(b.map(t => t.g)))}, over ${f2(mean(a.map(t => t.g)) - mean(b.map(t => t.g)))})`; });
  const ci = bootSlope(r.real, r.nul), sr = slope(r.real), sn = slope(r.nul);
  console.log(`${v} ${A} given ${B}: n ${r.real.length}\n   ${parts.join(" | ")}\n   slope of gross on x: real ${f2(sr)} [${f2(ci.real[0])}, ${f2(ci.real[1])}] | null ${f2(sn)} | real - null ${f2(sr - sn)} [${f2(ci.diff[0])}, ${f2(ci.diff[1])}]`);
}
