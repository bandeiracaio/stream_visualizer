// Offline analysis: what did the collectors read when the Reader detected something, and does it differ between the episodes you agreed with and the ones you disagreed with?
// Replays each saved session through the Reader engine (the same code the app runs, default thresholds unless --cfg), takes the episode GROUPS (one per event: the fast and mid readings of
// one thing are one group, like the labels), and for every group looks up the newest collector record of each feature at the moment it was detected. A value is turned into a percentile
// against everything the collectors read in the data given (so "at 90" means: the feature was higher than 90% of the time). Then:
//   1. overview: groups per family and side, their outcomes, and how many you labelled;
//   2. context: per family, which features were unusually high or low when it fired (median percentile far from 50);
//   3. labels: per family, the mean percentile of the features in the groups you agreed with against those you disagreed with (permutation test, corrected for the number of features);
//   4. outcomes: the same for the two most common outcomes of a family.
// Descriptive and small-sample by nature: it never says "keep"; it says where to look. A few dozen labelled groups per family are needed before 3 and 4 print anything.
// Usage:  node analyze-episodes.mjs SESSION... [--labels reader_labels.json] [--tape tape_*.json]... [--cfg cfg.json] [--all] [--json]      |      --selftest
//   SESSION is a session_*.json.gz (it must carry `ext`, so it was saved with v053 or later). --tape adds collector data to the reference only (a whole night is a better
//   "usual" than the minutes around a recording). --labels is the file from "Export labels" in the Reader tab.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readInput, FEATURES, rng } from "./analyze-collectors.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
export const PLAN = { minGroups:5, minPerLabel:6, minRefValues:50, permutations:999, seed:4242, alpha:0.05, contextFlag:15, stepMs:10000 };
const COLLECT = vm.runInNewContext(fs.readFileSync(path.join(root, "src/js/collectors-core.js"), "utf8") + "\n;COLLECT", {});

function loadEngine(extra = []) {
  const files = ["reader-drift", "reader-proposals", "reader-register", "reader-episodes", "reader-engine", ...extra];
  return vm.runInNewContext(files.map(f => fs.readFileSync(path.join(root, "src/js/" + f + ".js"), "utf8")).join("\n") + "\n;({E:READER_ENGINE" + (extra.length ? ",S:READER_SELFTEST" : "") + "})", {}, { timeout:300000 });
}

// ---------- the same matching rule as the app's labels (reader-tools.js rtMatch / rtSide)
const rtSide = ep => ep.aggressor || (ep.wall && ep.wall.side) || "";
export function labelMatches(lb, ep) {
  if (ep.members) return ep.members.some(m => labelMatches(lb, m));
  return lb.family === ep.family && (lb.venue === "any" || lb.venue === ep.venue) && (!lb.side || !rtSide(ep) || lb.side === rtSide(ep)) && lb.t0 <= (ep.tEnd || ep.tUpdate || Infinity) && lb.t1 >= ep.tStart;
}
export function labelFor(labels, ep) { for (let i = labels.length - 1; i >= 0; i--) { const l = labels[i]; if (l.verdict !== "missed" && labelMatches(l, ep)) return l.verdict; } return null; }

// ---------- feature values from a session's collector records
const num = x => (typeof x === "number" && Number.isFinite(x) ? x : null);
function indexExt(records) { const by = {}; for (const r of records) (by[r[1]] ||= []).push(r); for (const k in by) by[k].sort((a, b) => a[2] - b[2]); return by; }
const maxAge = f => f.startsWith("ratios.") ? 900000 : Math.max(3*(COLLECT.EXPECT_MS[COLLECT.ownerOf(FEATURES[f][0])] || 60000), 120000);
function valueAt(by, f, t) {
  const rows = by[FEATURES[f][0]]; if (!rows || !rows.length) return null;
  let lo = 0, hi = rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m][2] <= t) lo = m + 1; else hi = m; }
  for (let i = lo - 1; i >= 0 && t - rows[i][2] <= maxAge(f); i--) { let x = null; try { x = FEATURES[f][1](rows[i][3] || {}); } catch {} if (num(x) != null) return x; else break; }
  return null;
}
// every feature's values in the data, one per step at most, sorted: the "usual" a value is compared with
export function reference(recordSets, step = PLAN.stepMs) {
  const ref = {};
  for (const recs of recordSets) {
    const by = indexExt(recs);
    for (const f in FEATURES) {
      let last = -Infinity; const out = (ref[f] ||= []);
      for (const r of by[FEATURES[f][0]] || []) { if (r[2] - last < step) continue; let x = null; try { x = FEATURES[f][1](r[3] || {}); } catch {} if (num(x) != null) { out.push(x); last = r[2]; } }
    }
  }
  for (const f in ref) ref[f].sort((a, b) => a - b);
  return ref;
}
export function percentile(sorted, v) {      // the share of the usual values below v (ties count half), 0 to 100
  const n = sorted.length; if (!n) return null;
  let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  const below = lo; hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
  return 100*(below + (lo - below)/2)/n;
}
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m])/2; };
const mean = a => a.reduce((x, y) => x + y, 0)/a.length;
export function contrast(a, b, K, seed) {      // difference of the mean percentiles (the median of a handful of values is too coarse a statistic), and a permutation p-value that shuffles which group each value belongs to
  if (!a.length || !b.length) return null;
  const d = mean(a) - mean(b), all = a.concat(b), rand = rng(seed); let ge = 0;
  for (let k = 0; k < K; k++) {
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand()*(i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    if (Math.abs(mean(all.slice(0, a.length)) - mean(all.slice(a.length))) >= Math.abs(d) - 1e-9) ge++;
  }
  return { diff:+d.toFixed(1), p:+((1 + ge)/(K + 1)).toFixed(4), na:a.length, nb:b.length };
}

// ---------- the analysis
export function analyzeEpisodes(sessions, labels, refRecords, cfg, E, plan = PLAN) {
  const refSets = sessions.map(s => s.records).concat(refRecords), ref = reference(refSets), nF = Object.keys(FEATURES).length, rows = [];
  sessions.forEach(s => {
    const by = indexExt(s.records), e = E.replayEngine(s.inputs, cfg || undefined);
    for (const g of e.episodeGroups()) {
      const ctx = {};
      for (const f in FEATURES) { const v = valueAt(by, f, g.tDetected), r = ref[f]; if (v != null && r && r.length >= plan.minRefValues) ctx[f] = +percentile(r, v).toFixed(1); }
      rows.push({ session:s.file, family:g.family, side:rtSide(g) || "-", venue:g.venues && g.venues.length > 1 ? "any" : g.venue, tDetected:g.tDetected, tStart:g.tStart, tEnd:g.tEnd || g.tUpdate, outcome:g.outcome || "-", resolution:g.resolution || "-", label:labelFor(labels, g), ctx });
    }
  });
  const families = {};
  for (const r of rows) (families[r.family] ||= []).push(r);
  const out = {};
  for (const fam in families) {
    const g = families[fam], o = { n:g.length, sides:{}, outcomes:{}, labelled:{ agree:0, disagree:0, none:0 }, context:[], labelContrast:[], outcomeContrast:[] };
    for (const r of g) { o.sides[r.side] = (o.sides[r.side] || 0) + 1; o.outcomes[r.outcome] = (o.outcomes[r.outcome] || 0) + 1; o.labelled[r.label || "none"]++; }
    for (const f in FEATURES) {
      const vals = g.filter(r => r.ctx[f] != null).map(r => r.ctx[f]);
      if (vals.length >= plan.minGroups) { const m = median(vals); o.context.push({ feature:f, n:vals.length, median:+m.toFixed(1), flag:Math.abs(m - 50) >= plan.contextFlag }); }
      const ag = g.filter(r => r.label === "agree" && r.ctx[f] != null).map(r => r.ctx[f]), dis = g.filter(r => r.label === "disagree" && r.ctx[f] != null).map(r => r.ctx[f]);
      if (ag.length >= plan.minPerLabel && dis.length >= plan.minPerLabel) { const c = contrast(ag, dis, plan.permutations, plan.seed); o.labelContrast.push(Object.assign({ feature:f, suggestive:c.p <= plan.alpha/nF }, c)); }
    }
    const top = Object.entries(o.outcomes).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
    if (top.length === 2) for (const f in FEATURES) {
      const x = g.filter(r => r.outcome === top[0] && r.ctx[f] != null).map(r => r.ctx[f]), y = g.filter(r => r.outcome === top[1] && r.ctx[f] != null).map(r => r.ctx[f]);
      if (x.length >= plan.minPerLabel && y.length >= plan.minPerLabel) { const c = contrast(x, y, plan.permutations, plan.seed + 1); o.outcomeContrast.push(Object.assign({ feature:f, a:top[0], b:top[1], suggestive:c.p <= plan.alpha/nF }, c)); }
    }
    o.context.sort((a, b) => Math.abs(b.median - 50) - Math.abs(a.median - 50));
    o.labelContrast.sort((a, b) => a.p - b.p || Math.abs(b.diff) - Math.abs(a.diff)); o.outcomeContrast.sort((a, b) => a.p - b.p || Math.abs(b.diff) - Math.abs(a.diff));
    out[fam] = o;
  }
  return { plan, groups:rows.length, sessions:sessions.length, families:out, rows };
}

function print(r, all) {
  const L = s => console.log(s);
  L("\n== " + r.groups + " episode groups in " + r.sessions + " session(s)   (plan: " + JSON.stringify(PLAN) + ")");
  if (!r.groups) return L("   nothing detected in these sessions");
  for (const fam in r.families) {
    const o = r.families[fam], lab = o.labelled;
    L("\n-- " + fam.toUpperCase() + ": " + o.n + " groups; sides " + JSON.stringify(o.sides) + "; outcomes " + JSON.stringify(o.outcomes) + "; labelled: " + lab.agree + " agree, " + lab.disagree + " disagree, " + lab.none + " not labelled");
    const ctx = o.context.filter(c => all || c.flag);
    L("   CONTEXT at detection (median percentile of the feature, 50 = usual" + (all ? "" : "; only those at least " + PLAN.contextFlag + " away") + ")");
    if (!ctx.length) L("   none" + (o.context.length ? "" : " (fewer than " + PLAN.minGroups + " groups with data)"));
    for (const c of ctx) L("   " + c.feature.padEnd(32) + String(c.median).padEnd(7) + "n " + c.n + (c.flag ? (c.median > 50 ? "   high" : "   low") : ""));
    L("   LABELS: agree vs disagree (difference of mean percentiles; p from " + PLAN.permutations + " shuffles; suggestive below " + PLAN.alpha + "/" + Object.keys(FEATURES).length + ")");
    if (!o.labelContrast.length) L("   not enough labels (need " + PLAN.minPerLabel + " agree and " + PLAN.minPerLabel + " disagree with the same feature)");
    for (const c of o.labelContrast.slice(0, all ? 99 : 6)) L("   " + c.feature.padEnd(32) + (c.diff >= 0 ? "+" : "") + String(c.diff).padEnd(7) + "p " + String(c.p).padEnd(8) + "n " + c.na + "/" + c.nb + (c.suggestive ? "   suggestive" : ""));
    if (o.outcomeContrast.length) {
      L("   OUTCOMES: " + o.outcomeContrast[0].a + " vs " + o.outcomeContrast[0].b);
      for (const c of o.outcomeContrast.slice(0, all ? 99 : 6)) L("   " + c.feature.padEnd(32) + (c.diff >= 0 ? "+" : "") + String(c.diff).padEnd(7) + "p " + String(c.p).padEnd(8) + "n " + c.na + "/" + c.nb + (c.suggestive ? "   suggestive" : ""));
    }
  }
}

// ---------- self-test: sessions simulated by the Reader's own test simulator, with collector data built to differ between agreed and disagreed episodes
function selfTest() {
  const { E, S } = loadEngine(["reader-landscape", "auto-record-core", "status-core", "session-quality", "collectors-core", "reader-selftest"]), R = COLLECT.rec, rnd = rng(11);
  const burst = { rate:200, buyP:.1, driftBps:-6, liqSell:3, sweepSell:2, bidMult:.4 }, sessions = [], labels = [], K = 14;
  for (let k = 0; k < K; k++) {
    const e = E.create(); e.startRecording();
    const base = S.T0 + k*3600000, a = S.sim(e, { t0:base, seconds:150, seed:3 + k }), b = S.sim(e, { t0:a.t, mid0:a.mid, seconds:12, seed:21 + k, params:() => burst }); S.sim(e, { t0:b.t, mid0:b.mid, seconds:40, seed:22 + k });
    const inputs = e.stopRecording(), g = E.replayEngine(inputs).episodeGroups()[0], agree = k % 2 === 0, t0 = base;
    const recs = [];
    for (let t = t0; t < t0 + 220000; t += 10000) {
      recs.push(R("dvol", t, { vol:50 + rnd()*4 + (t >= g.tDetected - 5000 ? (agree ? 25 : -25) : 0), idx:80000 }));      // differs between agreed and disagreed groups, only around detection
      recs.push(R("hlCtx", t, { fund:0.0001, oi:1000, prem:rnd()*1e-4 }));      // noise
    }
    sessions.push({ file:"sim" + k, records:recs, inputs });
    labels.push({ verdict:agree ? "agree" : "disagree", family:g.family, venue:"any", side:"sell", t0:g.tStart, t1:g.tEnd || g.tUpdate });
  }
  const plan = Object.assign({}, PLAN, { permutations:1999 }), res = analyzeEpisodes(sessions, labels, [], null, E, plan), f = res.families.burst || {}, dv = (f.labelContrast || []).find(c => c.feature === "dvol.vol"), pr = (f.labelContrast || []).find(c => c.feature === "hlCtx.prem");
  // context on its own: only the agreed sessions are analysed, the disagreed ones give the "usual" (their collector data is the reference)
  const only = analyzeEpisodes(sessions.filter((_, k) => k % 2 === 0), [], sessions.filter((_, k) => k % 2 === 1).map(s => s.records), null, E, plan), ctx = ((only.families.burst || {}).context || []).find(c => c.feature === "dvol.vol");
  // pieces
  const ref = [1, 2, 3, 4, 5, 5, 5, 6, 7, 8, 9, 10], c1 = contrast([90, 80, 85, 95, 88, 92], [20, 30, 25, 10, 15, 22], 499, 1), c2 = contrast([50, 52, 48, 51, 49, 50], [50, 51, 49, 52, 48, 50], 499, 1);
  const lbl = [{ verdict:"disagree", family:"wall", venue:"any", side:"buy", t0:0, t1:100 }, { verdict:"agree", family:"wall", venue:"bn", side:"buy", t0:0, t1:100 }, { verdict:"missed", family:"burst", venue:"any", side:"sell", t0:0, t1:100 }];
  const ep = { family:"wall", venue:"bn", wall:{ side:"buy" }, tStart:10, tEnd:50 }, grp = { members:[ { family:"burst", venue:"bn", aggressor:"sell", tStart:10, tEnd:50 } ] };
  const checks = [
    ["the simulator produced one group per session, all bursts", res.groups === K && f.n === K && res.families.burst.sides.sell === K],
    ["labels were matched to the groups the way the app matches them", f.labelled.agree === K/2 && f.labelled.disagree === K/2 && f.labelled.none === 0],
    ["the feature built to differ between agreed and disagreed groups is found, suggestive", dv && dv.diff > 30 && dv.suggestive && dv.na === K/2 && dv.nb === K/2],
    ["the noise feature is not suggestive", pr && !pr.suggestive],
    ["context: that feature reads far from the usual at detection (median percentile flagged)", ctx && ctx.n === K/2 && ctx.median > 65 && ctx.flag],
    ["percentile: below, inside, above and ties", percentile(ref, 0) === 0 && percentile(ref, 100) === 100 && Math.abs(percentile(ref, 5) - 100*(4 + 1.5)/12) < 1e-9 && percentile([], 1) === null],
    ["contrast: a clear difference is significant, none is not, and the answer repeats", c1.diff > 50 && c1.p <= 0.02 && c2.p > 0.2 && J(contrast([1, 2, 3], [4, 5, 6], 99, 5)) === J(contrast([1, 2, 3], [4, 5, 6], 99, 5)) && contrast([], [1], 9, 1) === null],
    ["label rule: the newest matching non-missed label wins; a missed label never labels a group; members match; the other side does not", labelFor(lbl, ep) === "agree" && labelFor([lbl[2]], grp) === null && labelFor(lbl.slice(2), { members:[{ family:"burst", venue:"bn", aggressor:"sell", tStart:10, tEnd:50 }] }) === null && labelFor([{ verdict:"agree", family:"burst", venue:"any", side:"sell", t0:0, t1:100 }], grp) === "agree" && labelFor([{ verdict:"agree", family:"burst", venue:"any", side:"buy", t0:0, t1:100 }], grp) === null],
  ];
  function J(x) { return JSON.stringify(x); }
  let bad = 0; for (const [name, ok] of checks) { console.log((ok ? "  pass  " : "  FAIL  ") + name); if (!ok) bad++; }
  if (bad) { console.log(J({ groups:res.groups, burst:{ n:f.n, labelled:f.labelled, labelContrast:(f.labelContrast || []).slice(0, 4), context:(f.context || []).slice(0, 3) } })); process.exit(1); }
  console.log("\nall " + checks.length + " checks passed");
}

// ---------- main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), take = flag => { const o = []; for (let i = 0; i < args.length; i++) if (args[i] === flag) { let j = i + 1; while (j < args.length && !args[j].startsWith("--")) o.push(args[j++]); } return o; };
  if (args.includes("--selftest")) selfTest();
  else {
    const flagged = new Set(["--labels", "--tape", "--cfg"]), skip = new Set();
    for (let i = 0; i < args.length; i++) if (flagged.has(args[i])) { let j = i; while (j < args.length && (j === i || !args[j].startsWith("--"))) skip.add(j++); }
    const files = args.filter((x, i) => !x.startsWith("--") && !skip.has(i));
    if (!files.length) { console.error("usage: node analyze-episodes.mjs SESSION... [--labels reader_labels.json] [--tape tape_*.json] [--cfg cfg.json] [--all] [--json]   |   --selftest"); process.exit(1); }
    const sessions = files.map(readInput).filter(s => s.kind === "session");
    if (!sessions.length) { console.error("no session files among the arguments (a tape has no recording to replay)"); process.exit(1); }
    const lf = take("--labels")[0], labels = lf ? JSON.parse(fs.readFileSync(lf, "utf8")).labels || [] : [], cf = take("--cfg")[0], cfg = cf ? JSON.parse(fs.readFileSync(cf, "utf8")) : null;
    const refRecords = take("--tape").map(readInput).map(t => t.records), { E } = loadEngine();
    const res = analyzeEpisodes(sessions, labels, refRecords, cfg, E);
    if (args.includes("--json")) console.log(JSON.stringify(res, null, 1)); else print(res, args.includes("--all"));
  }
}
