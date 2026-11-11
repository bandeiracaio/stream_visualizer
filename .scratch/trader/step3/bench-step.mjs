// Step 3 check 6b: 150 instances (the 14 frozen designs, repeated) stepping one second each, on the snapshots of one real session. Prints ms per second for all 150 together.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { listSessions, loadSnaps, toSystem, SYSTEM } from "../../../design-harness.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../../..");
const designs = JSON.parse(fs.readFileSync(path.join(HERE, "designs.json"), "utf8")), all = listSessions(path.join(ROOT, "sessions"));
const s = all.filter(x => x.t0 < 1793695215688).sort((a, b) => b.size - a.size)[0]; loadSnaps(s);       // the biggest dev session
const defs = []; for (let i = 0; i < 150; i++) { const d = toSystem(designs[i % designs.length]); defs.push(SYSTEM.validate(d).length ? null : d); }
const ok = defs.filter(Boolean), insts = ok.map(d => SYSTEM.create(d, { latencyMs: 1000 }));
let n = 0; const t0 = process.hrtime.bigint();
for (const x of s.snaps) { for (const i of insts) { const a = i.step(x); if (a.length) for (const it of a) { if (it.type === "enter") i.filled(x.px[it.venue] || 100, x.t); else if (it.type === "exit" || it.type === "invalidate") i.closed(x.px[it.venue] || 100, x.t); } } n++; }
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`${insts.length} instances, ${n} seconds (${s.file}): ${ms.toFixed(0)} ms total, ${(ms / n).toFixed(3)} ms per second for all ${insts.length}, ${(ms / n / insts.length * 1000).toFixed(1)} us per instance step`);
