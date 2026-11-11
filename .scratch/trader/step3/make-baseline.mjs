// Step 3 check 1: freeze 14 designs (two per trigger type, every exit type covered) and write the OLD harness's trades on the dev split.
// Run before design-harness.mjs becomes a wrapper (uses the old exports runDesign / loadSessionFacts). Never touches the hold-out or fresh split.
import fs from "node:fs";
import path from "node:path";
import { generate, loadPool } from "../../../sample-designs.mjs";
import { implemented, instantiate, runDesign, loadSessionFacts, splitSessions, holdoutCutoff, EXEC } from "../../../design-harness.mjs";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const TRIGS = Object.keys(implemented()).includes("trig") ? implemented().trig : [], EXITS = implemented().exit;
const cand = generate({ pool: loadPool(), n: 1500, seed: 1, implemented: implemented() }).designs.map(d => instantiate(d, 1));
const picked = [], coveredExit = new Set();
for (const t of TRIGS) {
  const mine = cand.filter(d => d.trig === t); const chosen = [];
  for (let k = 0; k < 2; k++) {
    const pool = mine.filter(d => !chosen.includes(d) && !(chosen.length && chosen[0].exit === d.exit) && !(chosen.length && chosen[0].hor === d.hor && false));
    pool.sort((a, b) => (coveredExit.has(a.exit) ? 1 : 0) - (coveredExit.has(b.exit) ? 1 : 0) || (a.hor === "seconds" ? 0 : 1) - (b.hor === "seconds" ? 0 : 1) * (k ? -1 : 1));
    const d = pool[0]; if (d) { chosen.push(d); coveredExit.add(d.exit); }
  }
  picked.push(...chosen);
}
const missing = EXITS.filter(e => !coveredExit.has(e)); console.error("triggers", TRIGS.length, "designs", picked.length, "missing exits", missing);
fs.writeFileSync(path.join(HERE, "designs.json"), JSON.stringify(picked, null, 1));
const all = loadSessionFacts(path.resolve("sessions")), dev = splitSessions(all, "dev", false, holdoutCutoff(all));
console.error("dev sessions", dev.length);
const out = [];
for (const d of picked) for (const t of runDesign(d, dev, EXEC)) out.push(JSON.stringify({ design: d.id, ...t }));
fs.writeFileSync(path.join(HERE, "baseline-trades.jsonl"), out.join("\n") + "\n");
console.error("trades", out.length);
for (const d of picked) console.error(d.id, d.trig.slice(0, 14), d.thes.slice(0, 5), d.exit.slice(0, 12), d.hor, JSON.stringify(d.p.trig), out.filter(l => l.startsWith('{"design":"' + d.id + '"')).length);
