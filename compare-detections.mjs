// Offline regression check: replay the same saved sessions through two versions of the Reader (or one version under two configs) and report every difference in what was detected.
// Replaces the by-hand "byte-compare detections before and after" that every change to the episode layer is proven with. Reads the Reader exactly as the app runs it (src/js/*.js, loaded the way
// build.mjs does), so there is nothing to build first. Compares the episode GROUPS (what the cards show) and the legacy one-off SIGNALS, as exact JSON, so any change in a number counts.
// Usage:  node compare-detections.mjs SESSION... [--rev-a GITREV] [--rev-b GITREV] [--cfg-a a.json] [--cfg-b b.json] [--signals-only | --groups-only] [--json] [--limit N]      |      --selftest
//   A is the "before" side and B the "after" side. With no --rev the file is read from the working tree; --rev-a HEAD compares the working tree (B) with the last commit (A);
//   --rev-a v091tag --rev-b HEAD compares two commits. --cfg-a / --cfg-b are JSON engine configs (the same file --cfg of analyze-episodes.mjs takes), default thresholds when omitted.
//   SESSION is a session_*.json.gz or .json from the app. Exit code 0 when identical everywhere, 1 when anything differs, 2 on a usage error: usable in a script before a release.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readInput } from "./analyze-collectors.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_FILES = ["reader-drift", "reader-proposals", "reader-register", "reader-episodes", "reader-engine"];

// the Reader's own files, from the working tree or from a git revision (blobs are read with `git show`, so no checkout changes)
function sourceOf(rev, f) {
  const rel = "src/js/" + f + ".js";
  if (!rev) return fs.readFileSync(path.join(root, rel), "utf8");
  return execFileSync("git", ["show", rev + ":" + rel], { cwd:root, encoding:"utf8", maxBuffer:64*1024*1024 });
}
export function loadEngine(rev, extra = []) {
  const files = ENGINE_FILES.concat(extra), src = files.map(f => sourceOf(rev, f)).join("\n");
  return vm.runInNewContext(src + "\n;({E:READER_ENGINE" + (extra.length ? ",S:READER_SELFTEST" : "") + "})", {}, { timeout:300000 });
}

const key = g => [g.family, g.venues && g.venues.length > 1 ? "any" : g.venue, g.aggressor || (g.wall && g.wall.side) || "-", g.tStart].join("|");
const sigKey = s => [s.type, s.venue, s.dir, s.t].join("|");
const J = x => JSON.stringify(x);

// list of what each side detected for one session: groups and signals, as exact JSON per item
export function detect(E, inputs, cfg) {
  const e = E.replayEngine(inputs, cfg || undefined);
  return { groups:e.episodeGroups().map(g => ({ k:key(g), j:J(g), g })), signals:(e.events || []).map(s => ({ k:sigKey(s), j:J(s), g:s })) };
}
// the fields that differ between two versions of one item (top level only, with the two values)
function fieldDiff(a, b) {
  const out = {}, keys = new Set(Object.keys(a).concat(Object.keys(b)));
  for (const k of keys) if (J(a[k]) !== J(b[k])) out[k] = [a[k], b[k]];
  return out;
}
// A against B: items only in A, only in B, and items with the same key whose content differs. Items with a repeated key are paired in order.
export function compareLists(A, B) {
  const byKey = list => { const m = new Map(); for (const x of list) { if (!m.has(x.k)) m.set(x.k, []); m.get(x.k).push(x); } return m; };
  const ma = byKey(A), mb = byKey(B), res = { same:0, onlyA:[], onlyB:[], changed:[] };
  for (const [k, la] of ma) {
    const lb = mb.get(k) || [];
    la.forEach((x, i) => { const y = lb[i]; if (!y) res.onlyA.push(x); else if (x.j === y.j) res.same++; else res.changed.push({ k, fields:fieldDiff(x.g, y.g) }); });
    for (let i = la.length; i < lb.length; i++) res.onlyB.push(lb[i]);
  }
  for (const [k, lb] of mb) if (!ma.has(k)) lb.forEach(y => res.onlyB.push(y));
  return res;
}
export function compareSession(EA, EB, inputs, cfgA, cfgB, what = { groups:true, signals:true }) {
  const a = detect(EA, inputs, cfgA), b = detect(EB, inputs, cfgB), out = {};
  if (what.groups) out.groups = compareLists(a.groups, b.groups);
  if (what.signals) out.signals = compareLists(a.signals, b.signals);
  out.nA = { groups:a.groups.length, signals:a.signals.length }; out.nB = { groups:b.groups.length, signals:b.signals.length };
  out.identical = Object.keys(out).filter(k => k === "groups" || k === "signals").every(k => !out[k].onlyA.length && !out[k].onlyB.length && !out[k].changed.length);
  return out;
}

function print(results, limit) {
  const L = s => console.log(s);
  let bad = 0;
  for (const r of results) {
    L("\n" + r.file + ": " + (r.cmp.identical ? "identical" : "DIFFERENT") + "   (A " + r.cmp.nA.groups + " groups / " + r.cmp.nA.signals + " signals;  B " + r.cmp.nB.groups + " / " + r.cmp.nB.signals + ")");
    if (r.cmp.identical) continue;
    bad++;
    for (const part of ["groups", "signals"]) {
      const c = r.cmp[part]; if (!c) continue;
      if (!c.onlyA.length && !c.onlyB.length && !c.changed.length) continue;
      L("  " + part.toUpperCase() + ": " + c.same + " same, " + c.changed.length + " changed, " + c.onlyA.length + " only in A, " + c.onlyB.length + " only in B");
      c.onlyA.slice(0, limit).forEach(x => L("    only in A  " + x.k));
      c.onlyB.slice(0, limit).forEach(x => L("    only in B  " + x.k));
      c.changed.slice(0, limit).forEach(x => { L("    changed    " + x.k); for (const f in x.fields) L("      " + f + ": " + J(x.fields[f][0]).slice(0, 80) + "  ->  " + J(x.fields[f][1]).slice(0, 80)); });
      const more = c.onlyA.length + c.onlyB.length + c.changed.length - 3*limit; if (more > 0 && (c.onlyA.length > limit || c.onlyB.length > limit || c.changed.length > limit)) L("    ... more (raise --limit)");
    }
  }
  L("\n" + (bad ? bad + " of " + results.length + " session(s) differ" : "all " + results.length + " session(s) identical"));
  return bad;
}

// ---------- self-test: simulated sessions through the Reader's own simulator
function selfTest() {
  const { E, S } = loadEngine(null, ["reader-landscape", "auto-record-core", "status-core", "session-quality", "collectors-core", "reader-selftest"]);
  const burst = { rate:200, buyP:.1, driftBps:-6, liqSell:3, sweepSell:2, bidMult:.4 }, sessions = [];
  for (let k = 0; k < 3; k++) {
    const e = E.create(); e.startRecording();
    const a = S.sim(e, { t0:S.T0 + k*3600000, seconds:150, seed:3 + k }), b = S.sim(e, { t0:a.t, mid0:a.mid, seconds:12, seed:21 + k, params:() => burst }); S.sim(e, { t0:b.t, mid0:b.mid, seconds:40, seed:22 + k });
    sessions.push(e.stopRecording());
  }
  const all = { groups:true, signals:true };
  const same = sessions.map(inp => compareSession(E, E, inp, null, null, all));
  // a different engine config must show up as a difference (low sensitivity raises every threshold)
  const diff = sessions.map(inp => compareSession(E, E, inp, null, { sens:0.1 }, all));
  // HEAD is this very file's revision when committed; without git history the check is skipped rather than failed
  let gitOk = true; try { execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd:root, stdio:"ignore" }); } catch { gitOk = false; }
  const viaGit = gitOk ? (() => { try { const EH = loadEngine("HEAD").E; return compareSession(EH, EH, sessions[0], null, null, all).identical; } catch { return false; } })() : true;
  // list comparison on hand-made items
  const mk = (k, v) => ({ k, j:J(v), g:v }), cl = compareLists([mk("a", { x:1 }), mk("a", { x:2 }), mk("b", { x:1 }), mk("c", { x:1 })], [mk("a", { x:1 }), mk("a", { x:3 }), mk("c", { x:1 }), mk("d", { x:1 })]);
  const checks = [
    ["the simulator detected something to compare", sessions.every(inp => detect(E, inp).groups.length + detect(E, inp).signals.length > 0)],
    ["the same engine and config on the same inputs is identical", same.every(r => r.identical)],
    ["a different config is reported as different, with what changed", diff.some(r => !r.identical && (r.groups.onlyA.length + r.groups.changed.length + r.signals.onlyA.length + r.signals.changed.length) > 0)],
    ["a git revision loads and replays identically to itself", viaGit],
    ["lists: same, changed (same key, different content), only in A, only in B", cl.same === 2 && cl.changed.length === 1 && cl.changed[0].k === "a" && cl.onlyA.length === 1 && cl.onlyA[0].k === "b" && cl.onlyB.length === 1 && cl.onlyB[0].k === "d"],
    ["a changed field is named with both values", J(fieldDiff({ x:1, y:2 }, { x:1, y:3 })) === '{"y":[2,3]}'],
  ];
  let bad = 0; for (const [name, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + name); if (!ok) bad++; }
  if (bad) process.exit(1);
  console.log("\nall " + checks.length + " checks passed");
}

// ---------- main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), val = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const valued = new Set(["--rev-a", "--rev-b", "--cfg-a", "--cfg-b", "--limit"]), files = args.filter((x, i) => !x.startsWith("--") && !valued.has(args[i - 1]));
  if (args.includes("--selftest")) selfTest();
  else if (!files.length) { console.error("usage: node compare-detections.mjs SESSION... [--rev-a GITREV] [--rev-b GITREV] [--cfg-a a.json] [--cfg-b b.json] [--signals-only | --groups-only] [--json] [--limit N]   |   --selftest"); process.exit(2); }
  else {
    const cfgOf = f => f ? JSON.parse(fs.readFileSync(f, "utf8")) : null, what = { groups:!args.includes("--signals-only"), signals:!args.includes("--groups-only") };
    const { E:EA } = loadEngine(val("--rev-a")), { E:EB } = loadEngine(val("--rev-b")), cfgA = cfgOf(val("--cfg-a")), cfgB = cfgOf(val("--cfg-b")), limit = Number(val("--limit")) || 5;
    const results = files.map(f => { const s = readInput(f); if (s.kind !== "session") { console.error(f + ": not a session file"); process.exit(2); } return { file:f, cmp:compareSession(EA, EB, s.inputs, cfgA, cfgB, what) }; });
    if (args.includes("--json")) { console.log(J(results.map(r => ({ file:r.file, identical:r.cmp.identical, nA:r.cmp.nA, nB:r.cmp.nB, groups:r.cmp.groups && { same:r.cmp.groups.same, onlyA:r.cmp.groups.onlyA.map(x => x.k), onlyB:r.cmp.groups.onlyB.map(x => x.k), changed:r.cmp.groups.changed }, signals:r.cmp.signals && { same:r.cmp.signals.same, onlyA:r.cmp.signals.onlyA.map(x => x.k), onlyB:r.cmp.signals.onlyB.map(x => x.k), changed:r.cmp.signals.changed } })), null, 1)); process.exit(results.every(r => r.cmp.identical) ? 0 : 1); }
    process.exit(print(results, limit) ? 1 : 0);
  }
}
