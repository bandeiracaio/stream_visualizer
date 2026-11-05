// sample-designs.mjs: Monte Carlo sampler of trade-system designs (offline, not part of the app).
// Spec: .scratch/trade-system/sampling-design.md. Pool: .scratch/trade-system/mapping-v3.csv.
//
//   node sample-designs.mjs --selftest
//   node sample-designs.mjs --n 2000 --seed 1 [--mix B:0.4,C:0.2,D:0.4] [--temper 1.5] [--smooth 4]
//        [--out designs.jsonl] [--implemented implemented.json] [--report]
//
// A design is one category in each slot: ctx, reg, trig, thes, exit, sz, stop, ev (+ horizon).
// Samplers: A pool bootstrap, B chained conditional, C uniform + compatibility rejection,
// D stratified (every category of a focal slot forced, rest by B). Descriptive tool: it never
// changes the app, the Reader or any detection.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POOL = path.join(HERE, ".scratch", "trade-system", "mapping-v3.csv");

export const SLOTS = ["ctx", "reg", "trig", "thes", "exit", "sz", "stop", "ev", "hor"];
const COL = { ctx: "p1_primary", reg: "p2_primary", trig: "p3_primary", thes: "p4_primary", exit: "p5_primary", sz: "p6a_primary", stop: "p6b_primary", ev: "p7_primary", hor: "horizon" };
// Chain order for sampler B: slot, parents it is conditioned on (backoff: all parents, then the first, then marginal).
const CHAIN = [
  ["trig", []], ["thes", ["trig"]], ["reg", ["trig"]], ["ctx", ["thes"]],
  ["exit", ["trig", "thes"]], ["stop", ["exit"]], ["hor", ["trig"]], ["sz", []], ["ev", []],
];

// ---- hard compatibility rules (DRAFT written by Claude from the category names, not yet reviewed by the user) ----
const NEEDS_LEVEL_TRIG = new Set(["level-rejection-bounce", "level-or-range-break", "sweep-or-failed-break-reclaim"]);
export const RULES = [
  ["R1 level trigger needs a region", d => d.reg === "none" && NEEDS_LEVEL_TRIG.has(d.trig)],
  ["R2 named-level target needs a region", d => d.exit === "named-level-target" && d.reg === "none"],
  ["R3 seconds horizon cannot use a calendar exit", d => d.hor === "seconds" && d.exit === "scheduled-clock-or-calendar-exit"],
  ["R4 multi-day horizon cannot use a book-depth trigger", d => d.hor === "multi-day" && d.trig === "book-depth-and-wall-event"],
  ["R5 indicator-normalization exit needs a trigger that defines a normal reading", d => d.exit === "indicator-normalization-exit" && !["cross-venue-or-asset-divergence", "trade-flow-signal", "book-depth-and-wall-event"].includes(d.trig)],
];
// extra rules applied only to runs restricted to implemented categories (testing runs): a region that nothing uses is a phantom slot
export const TEST_RULES = [
  ["T1 a region must be used by the trigger or the exit", d => d.reg !== "none" && !NEEDS_LEVEL_TRIG.has(d.trig) && d.exit !== "named-level-target"],
];
export function violated(d, extra = false) { return (extra ? RULES.concat(TEST_RULES) : RULES).filter(([, f]) => f(d)).map(([n]) => n); }

// ---- small utilities ----
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function parseCsv(txt) {
  const rows = []; let row = [], c = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(c); c = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && txt[i + 1] === "\n") i++; row.push(c); c = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else c += ch;
  }
  if (c !== "" || row.length) { row.push(c); rows.push(row); }
  return rows;
}
export function loadPool(file = POOL) {
  const t = parseCsv(fs.readFileSync(file, "utf8")); const h = t[0];
  const idx = {}; for (const s of SLOTS) { idx[s] = h.indexOf(COL[s]); if (idx[s] < 0) throw new Error("column missing: " + COL[s]); }
  return t.slice(1).map(r => { const d = { id: r[0] }; for (const s of SLOTS) d[s] = r[idx[s]]; return d; });
}
function weighted(r, entries) { // entries: [[key, weight]]
  let tot = 0; for (const [, w] of entries) tot += w;
  let x = r() * tot; for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
  return entries[entries.length - 1][0];
}

// ---- model: counts from the pool ----
export function buildModel(pool, { temper = 1, smooth = 4 } = {}) {
  const cats = {}; for (const s of SLOTS) cats[s] = [...new Set(pool.map(d => d[s]))].sort();
  const marg = {}; for (const s of SLOTS) { const c = {}; for (const k of cats[s]) c[k] = 0; for (const d of pool) c[d[s]]++; marg[s] = c; }
  const tempered = {}; for (const s of SLOTS) { const e = {}; let tot = 0; for (const k of cats[s]) { e[k] = Math.pow(marg[s][k] / pool.length, 1 / temper); tot += e[k]; } for (const k of cats[s]) e[k] /= tot; tempered[s] = e; }
  const cond = new Map(); // key slot|parents|values -> counts
  function table(slot, parents, vals) {
    const key = slot + "|" + parents.join(",") + "|" + vals.join("\u0001");
    if (!cond.has(key)) {
      const c = {}; for (const k of cats[slot]) c[k] = 0; let n = 0;
      for (const d of pool) if (parents.every((p, i) => d[p] === vals[i])) { c[d[slot]]++; n++; }
      cond.set(key, { c, n });
    }
    return cond.get(key);
  }
  // Smoothed P(slot | parents=vals), backing off to fewer parents and then the tempered marginal.
  function dist(slot, parents, vals) {
    let base = tempered[slot];
    for (let m = 0; m <= parents.length; m++) {
      if (m === 0) continue;
      const ps = parents.slice(0, m), vs = vals.slice(0, m); const { c, n } = table(slot, ps, vs);
      const next = {}; for (const k of cats[slot]) next[k] = (c[k] + smooth * base[k]) / (n + smooth);
      base = next;
    }
    return base;
  }
  return { cats, marg, tempered, dist, n: pool.length };
}

// ---- samplers ----
export function drawChain(model, r, forced = {}, allowed = null) {      // allowed: optional {slot: [categories]}; probabilities are restricted to them and renormalised
  const d = {};
  for (const [slot, parents] of CHAIN) {
    if (forced[slot] !== undefined) { d[slot] = forced[slot]; continue; }
    const p = model.dist(slot, parents, parents.map(x => d[x]));
    let ents = model.cats[slot].map(k => [k, p[k]]);
    if (allowed && allowed[slot]) { ents = ents.filter(([k]) => allowed[slot].includes(k)); if (!ents.length || ents.every(([, w]) => w <= 0)) ents = allowed[slot].map(k => [k, 1]); }
    d[slot] = weighted(r, ents);
  }
  return d;
}
function sampleA(model, pool, r) { const o = pool[Math.floor(r() * pool.length)]; const d = {}; for (const s of SLOTS) d[s] = o[s]; d.from = o.id; return d; }
function sampleC(model, r, allowed = null) { const d = {}; for (const s of SLOTS) { const c = allowed && allowed[s] ? allowed[s] : model.cats[s]; d[s] = c[Math.floor(r() * c.length)]; } return d; }

// Generate n designs. mix like {B:.4,C:.2,D:.4}. implemented: optional {slot:[allowed categories]} for testing runs.
export function generate({ pool, n, seed = 1, mix = { B: 0.4, C: 0.2, D: 0.4 }, temper = 1.5, smooth = 4, implemented = null, maxTries = 200 }) {
  const model = buildModel(pool, { temper, smooth }); const r = rng(seed);
  const stats = { rejected: {}, tries: 0, accepted: 0, noPartner: 0 };
  const okImpl = d => !implemented || SLOTS.every(s => !implemented[s] || implemented[s].includes(d[s]));
  const allowedCats = {}; for (const s of SLOTS) allowedCats[s] = (implemented && implemented[s]) ? model.cats[s].filter(k => implemented[s].includes(k)) : model.cats[s];
  const focal = ["ctx", "reg", "trig", "thes", "exit", "stop"]; // slots with strata
  const strata = []; for (const s of focal) for (const k of allowedCats[s]) strata.push([s, k]);
  const out = [];
  let strataI = 0;
  const kinds = Object.entries(mix).filter(([, w]) => w > 0);
  while (out.length < n) {
    const kind = weighted(r, kinds); let d = null, tag = kind;
    for (let t = 0; t < maxTries && !d; t++) {
      stats.tries++;
      let c;
      if (kind === "A") c = sampleA(model, pool, r);
      else if (kind === "C") c = sampleC(model, r, allowedCats);
      else if (kind === "D") { const [s, k] = strata[strataI % strata.length]; c = drawChain(model, r, { [s]: k }, allowedCats); c._focal = s + "=" + k; }
      else c = drawChain(model, r, {}, allowedCats);
      const v = violated(c, !!implemented);
      if (v.length) { for (const x of v) stats.rejected[x] = (stats.rejected[x] || 0) + 1; continue; }
      if (!okImpl(c)) { stats.rejected["not-implemented"] = (stats.rejected["not-implemented"] || 0) + 1; continue; }
      d = c;
    }
    if (!d) { stats.noPartner++; if (kind === "D") strataI++; continue; }
    if (kind === "D") strataI++;
    out.push({ id: "M" + String(out.length + 1).padStart(5, "0"), sampler: tag, ...d }); stats.accepted++;
  }
  return { designs: out, stats, model };
}

// ---- reporting ----
export function distribution(rows, slot) { const c = {}; for (const d of rows) c[d[slot]] = (c[d[slot]] || 0) + 1; return c; }
export function cramersV(rows, a, b) {
  const n = rows.length, ca = {}, cb = {}, cab = {};
  for (const d of rows) { ca[d[a]] = (ca[d[a]] || 0) + 1; cb[d[b]] = (cb[d[b]] || 0) + 1; const k = d[a] + "\u0001" + d[b]; cab[k] = (cab[k] || 0) + 1; }
  let chi = 0; for (const x in ca) for (const y in cb) { const e = ca[x] * cb[y] / n; const o = cab[x + "\u0001" + y] || 0; chi += (o - e) ** 2 / e; }
  const k = Math.min(Object.keys(ca).length, Object.keys(cb).length) - 1; return k > 0 ? Math.sqrt(chi / (n * k)) : 0;
}
function report(pool, designs, stats) {
  const L = [];
  L.push(`designs ${designs.length}; draws ${stats.tries}; rejected ${JSON.stringify(stats.rejected)}; strata without a partner ${stats.noPartner}`);
  const by = {}; for (const d of designs) by[d.sampler] = (by[d.sampler] || 0) + 1; L.push("by sampler " + JSON.stringify(by));
  for (const s of SLOTS) {
    const a = distribution(pool, s), b = distribution(designs, s);
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => (b[y] || 0) - (b[x] || 0));
    L.push(`\n${s}: category  pool%  sampled%`);
    for (const k of keys) L.push(`  ${k.padEnd(44)} ${(100 * (a[k] || 0) / pool.length).toFixed(1).padStart(5)}  ${(100 * (b[k] || 0) / designs.length).toFixed(1).padStart(5)}`);
  }
  L.push(`\ntrig x thes Cramer's V: pool ${cramersV(pool, "trig", "thes").toFixed(2)}, sampled ${cramersV(designs, "trig", "thes").toFixed(2)}`);
  return L.join("\n");
}

// ---- self test ----
function selftest() {
  let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok  ", m); };
  const pool = loadPool(); ok(pool.length === 350, "pool has 350 systems");
  const g1 = generate({ pool, n: 600, seed: 7 }), g2 = generate({ pool, n: 600, seed: 7 }), g3 = generate({ pool, n: 600, seed: 8 });
  ok(JSON.stringify(g1.designs) === JSON.stringify(g2.designs), "same seed gives identical designs");
  ok(JSON.stringify(g1.designs) !== JSON.stringify(g3.designs), "different seed gives different designs");
  ok(g1.designs.every(d => violated(d).length === 0), "no design violates a hard rule");
  ok(g1.designs.every(d => SLOTS.every(s => g1.model.cats[s].includes(d[s]))), "every category is valid");
  const B = generate({ pool, n: 1500, seed: 3, mix: { B: 1 }, temper: 1 }).designs;
  ok(cramersV(B, "trig", "thes") > 0.3, "chained sampler keeps trigger/thesis dependence (V " + cramersV(B, "trig", "thes").toFixed(2) + ")");
  const C = generate({ pool, n: 1500, seed: 3, mix: { C: 1 } }).designs;
  ok(cramersV(C, "trig", "thes") < cramersV(B, "trig", "thes"), "uniform sampler is less dependent than the chained one");
  const A = generate({ pool, n: 1500, seed: 3, mix: { A: 1 } }).designs; const dA = distribution(A, "trig"), dP = distribution(pool, "trig");
  ok(Object.keys(dP).every(k => Math.abs((dA[k] || 0) / 1500 - dP[k] / 350) < 0.06), "bootstrap marginals match the pool");
  const Dg = generate({ pool, n: 1200, seed: 5, mix: { D: 1 } }).designs; const dt = distribution(Dg, "trig");
  const minTrig = Math.min(...Object.values(dt)); ok(Object.keys(dt).length === g1.model.cats.trig.length && minTrig >= 15, "stratified run covers every trigger category (min " + minTrig + ")");
  const impl = { trig: ["reader-episode-event", "trade-flow-signal"], stop: ["sigma-multiple-stop"] };
  const T = generate({ pool, n: 200, seed: 9, implemented: impl }).designs;
  ok(T.every(d => impl.trig.includes(d.trig) && impl.stop.includes(d.stop)), "implemented filter is respected");
  const tmp = buildModel(pool, { temper: 1 }), flat = buildModel(pool, { temper: 3 }); const top = k => Math.max(...Object.values(k.tempered.reg));
  ok(top(flat) < top(tmp), "higher tempering flattens the marginal");
  ok(rng(1)() === rng(1)(), "rng is deterministic");
  console.log(fail ? fail + " FAILED" : "all passed"); process.exit(fail ? 1 : 0);
}

// ---- cli ----
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf("--" + k); return i < 0 ? d : args[i + 1]; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes("--selftest")) selftest();
  else {
    const pool = loadPool();
    const mix = {}; for (const part of arg("mix", "B:0.4,C:0.2,D:0.4").split(",")) { const [k, w] = part.split(":"); mix[k] = Number(w); }
    const impl = arg("implemented", null) ? JSON.parse(fs.readFileSync(arg("implemented"), "utf8")) : null;
    const { designs, stats } = generate({ pool, n: Number(arg("n", 1000)), seed: Number(arg("seed", 1)), mix, temper: Number(arg("temper", 1.5)), smooth: Number(arg("smooth", 4)), implemented: impl });
    const out = arg("out", null);
    if (out) fs.writeFileSync(out, `{"header":{"seed":${Number(arg("seed", 1))},"mix":${JSON.stringify(mix)},"temper":${Number(arg("temper", 1.5))},"smooth":${Number(arg("smooth", 4))},"pool":"mapping-v3.csv","rules":${JSON.stringify(RULES.map(r => r[0]))}}}\n` + designs.map(d => JSON.stringify(d)).join("\n") + "\n");
    if (args.includes("--report") || !out) console.log(report(pool, designs, stats));
    else console.log("wrote " + designs.length + " designs to " + out);
  }
}
