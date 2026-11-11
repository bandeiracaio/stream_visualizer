// Step 3 checks 2 and 3. Reads the frozen designs and the OLD harness's trades (baseline-trades.jsonl, written before the harness became a wrapper) and runs the same designs through the core
// on the dev split, in comparison mode (old look-ahead facts) and in normal (causal) mode. Never touches the hold-out or fresh split.
//   node .scratch/trader/step3/compare.mjs [--worked]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessions, splitSessions, holdoutCutoff, loadSnaps, runDesign, EXEC } from "../../../design-harness.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../../..");
const designs = JSON.parse(fs.readFileSync(path.join(HERE, "designs.json"), "utf8"));
const base = fs.readFileSync(path.join(HERE, "baseline-trades.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const all = listSessions(path.join(ROOT, "sessions")), dev = splitSessions(all, "dev", false, holdoutCutoff(all));
const t0 = Date.now(); for (const s of dev) loadSnaps(s); console.error(`snapshots for ${dev.length} dev sessions: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, f = (x, d = 2) => x == null ? "-" : x.toFixed(d);
const key = t => t.tIn + "|" + t.dir, EPS = 1e-9;
const same = (a, b) => a.exit === b.exit && a.tOut === b.tOut && Math.abs(a.gross - b.gross) < EPS;
const overlap = (a, b) => a.tIn <= b.tOut && b.tIn <= a.tOut;
const bySession = (list) => { const m = new Map(); for (const t of list) { if (!m.has(t.session)) m.set(t.session, []); m.get(t.session).push(t); } return m; };

const rows = {};      // trigger -> counters
const worked = [];
for (const d of designs) {
  const T = (rows[d.trig] ||= { designs: 0, old: 0, neu: 0, exact: 0, end: 0, gap: 0, follow: 0, other: 0, normalN: 0, same: 0, oldNet: [], newNet: [], sameOldNet: [], sameNewNet: [] });
  T.designs++;
  const oldT = base.filter(t => t.design === d.id), legacy = runDesign(d, dev, EXEC, null, { legacy: true }), normal = runDesign(d, dev, EXEC, null, {});
  const O = bySession(oldT), N = bySession(legacy);
  T.old += oldT.length; T.neu += legacy.length;
  for (const sess of new Set([...O.keys(), ...N.keys()])) {
    const ol = O.get(sess) || [], nl = N.get(sess) || [], nm = new Map(nl.map(t => [key(t), t])), used = new Set(), bad = [];
    for (const o of ol) { const n = nm.get(key(o)); if (n) { used.add(n); if (same(o, n)) T.exact++; else bad.push({ side: "diff", o, n, iv: n }); } else bad.push({ side: "old-only", o, iv: o }); }
    for (const n of nl) if (!used.has(n) && !ol.some(o => key(o) === key(n))) bad.push({ side: "new-only", n, iv: n });
    // causes: a new trade closed by the end of the data or a gap (the batch harness dropped it); then everything overlapping it or an explained trade (it held the position, or the old one did)
    const cause = new Map();
    const S = dev.find(x => x.file === sess), lastT = v => S.hist[v].length ? S.hist[v][S.hist[v].length - 1][0] : 0;
    // the batch harness dropped a trade whose whole hold time is not covered by the history (even if it would have exited earlier), or that met a gap before exiting: the core enters it and closes it early, or with end / gap
    for (const b of bad) if (b.n && b.side === "new-only") { if (b.n.exit === "end" || b.n.exit === "gap") cause.set(b, b.n.exit); else if (b.n.tIn + d.p.exit.holdSec * 1000 > lastT(b.n.venue)) cause.set(b, "end"); }
    let grew = true; while (grew) { grew = false; for (const b of bad) { if (cause.has(b)) continue; for (const c of cause.keys()) if (overlap(b.iv, c.iv)) { cause.set(b, "follow"); grew = true; break; } } }
    for (const b of bad) { const c = cause.get(b); if (c === "end") T.end++; else if (c === "gap") T.gap++; else if (c === "follow") T.follow++; else { T.other++; if (worked.filter(w => w.trig === d.trig).length < 3) worked.push({ design: d.id, trig: d.trig, session: sess, side: b.side, o: b.o && [b.o.tIn, b.o.tOut, b.o.dir, b.o.exit, +b.o.gross.toFixed(3)], n: b.n && [b.n.tIn, b.n.tOut, b.n.dir, b.n.exit, +b.n.gross.toFixed(3)], oldNear: ol.filter(x => Math.abs(x.tIn - (b.iv.tIn)) < 30000).map(x => [x.tIn, x.tOut, x.dir, x.exit, +x.gross.toFixed(3)]), newNear: nl.filter(x => Math.abs(x.tIn - (b.iv.tIn)) < 30000).map(x => [x.tIn, x.tOut, x.dir, x.exit, +x.gross.toFixed(3)]) }); } }
  }
  // normal mode against the old trades: the same trade = same session, direction and an entry within one second
  const nb = bySession(normal); T.normalN += normal.length; T.oldNet.push(...oldT.map(t => t.net)); T.newNet.push(...normal.map(t => t.net));
  for (const sess of new Set([...O.keys(), ...nb.keys()])) for (const o of O.get(sess) || []) { const n = (nb.get(sess) || []).find(x => x.dir === o.dir && Math.abs(x.tIn - o.tIn) <= 1000); if (n) { T.same++; T.sameOldNet.push(o.net); T.sameNewNet.push(n.net); } }
}
const hdr = (s) => console.log("\n" + s);
hdr("CHECK 2: comparison mode (old facts) against the baseline, per trigger. Causes: end / gap = trades the old harness dropped; follow = trades that overlap one of those (or follow one); other = anything else");
console.log("trigger".padEnd(36) + "designs  old   new  exact  end  gap follow other");
for (const [k, T] of Object.entries(rows)) console.log(k.padEnd(36) + [T.designs, T.old, T.neu, T.exact, T.end, T.gap, T.follow, T.other].map(x => String(x).padStart(5)).join(" ") + (k === "trade-flow-signal" ? "   (expected to differ: the median is causal even here)" : ""));
hdr("CHECK 3: normal (causal) mode against the baseline, per trigger");
console.log("trigger".padEnd(36) + "before after same | mean net before  after | on the same trades: before  after");
for (const [k, T] of Object.entries(rows)) console.log(k.padEnd(36) + [T.old, T.normalN, T.same].map(x => String(x).padStart(6)).join(" ") + " | " + f(mean(T.oldNet)).padStart(14) + f(mean(T.newNet)).padStart(8) + " | " + f(mean(T.sameOldNet)).padStart(26) + f(mean(T.sameNewNet)).padStart(8));
if (worked.length) { hdr("UNEXPLAINED DIFFERENCES (up to 3 per trigger)"); for (const w of worked) console.log(JSON.stringify(w)); }
