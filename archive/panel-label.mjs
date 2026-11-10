// Panel labelling (offline, not part of the app): several independent voters judge each Reader episode group from a BLINDED packet,
// and the votes are tallied. Triage only: the panel sorts groups into likely-real, likely-not and contested so the user labels the
// contested ones first. The user's own agree / disagree labels stay the only ground truth; a panel label has src "panel" and is never
// merged into reader_labels.json.
//
//   node panel-label.mjs packets --sessions 6 --n 20 --seed 1 --voters 5 --out panel/pilot     writes packets + one voter file per voter
//   node panel-label.mjs tally --dir panel/pilot [--labels reader_labels.json]                  reads votes_*.json, writes panel_labels.json
//   node panel-label.mjs --selftest
//
// What a voter sees (what the card shows, minus the Reader's own verdicts): family, venue, aggressor / passive side, the evidence
// checklist (label, met or not, value, gate), the Reader's one-line reading, start / end in seconds around detection, and the price
// path from 2 minutes before the start to the end of the episode (basis points from the start; sigma per root second for scale).
// What a voter does NOT see: outcome, resolution, resumptions, stage, ids, absolute times, session name, any price after the end, the
// user's labels, and other voters' votes. Each voter gets the packets in its own shuffled order.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEngine } from "./compare-detections.mjs";
import { readInput, rng } from "./analyze-collectors.mjs";
import { labelFor } from "./analyze-episodes.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const SB = vm.runInNewContext(fs.readFileSync(path.join(root, "src/js/scoreboard-core.js"), "utf8") + ";SCOREBOARD", {});

export const FORBIDDEN = ["outcome", "resolution", "resumedAt", "stage", "primary", "tDetected", "tStart", "tEnd", "tUpdate", "trace", "session", "label", "peak", "intensity", "facts"];
const MEMBER_KEEP = ["family", "venue", "horizon", "aggressor", "passive", "pulses", "reading"];
const PRE_MS = 120000, STEP_MS = 5000, MAX_POINTS = 90;

// ---------- packet
export function packetOf(g, hist, sigma, id) {
  const t0 = g.tStart, tEnd = g.tEnd || g.tUpdate || g.tDetected, tD = g.tDetected;
  const path = [];
  if (hist && hist.length) {
    const base = at(hist, t0);
    if (base != null) for (let t = t0 - PRE_MS; t <= tEnd && path.length < MAX_POINTS; t += STEP_MS) { const p = at(hist, t); if (p != null) path.push([Math.round((t - tD)/1000), +((p/base - 1)*1e4).toFixed(2)]); }
  }
  return {
    id,
    family: g.family,
    startSecFromDetection: Math.round((t0 - tD)/1000),
    endSecFromDetection: Math.round((tEnd - tD)/1000),
    sigmaBpsPerRootSec: +sigma.toFixed(3),
    priceBpsFromStart: path,                       // [seconds from detection, bps from the price at the start]
    members: (g.members || []).map(m => {
      const o = {}; for (const k of MEMBER_KEEP) if (m[k] != null) o[k] = m[k];
      if (m.wall) o.wall = { side: m.wall.side, peakSize: m.wall.peak, ratioToNormalDepth: m.wall.ratio, reposts: m.wall.reposts, tradedFraction: m.wall.tradedFrac };   // no absolute price, no end-state size
      o.evidence = (m.evidence || []).map(e => ({ item: e.label, met: !!e.ok, value: e.val, gate: !!e.gate, notApplicable: !!e.na }));
      return o;
    })
  };
}
function at(h, t) { let lo = 0, hi = h.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 && t - h[r][0] <= 2000 ? h[r][1] : null; }

// a packet may not carry any forbidden key or any outcome word at any depth
export function leaks(packet) {
  const found = [];
  (function walk(x, p) {
    if (Array.isArray(x)) x.forEach((v, i) => walk(v, p + "[" + i + "]"));
    else if (x && typeof x === "object") for (const k in x) { if (FORBIDDEN.includes(k)) found.push(p + "." + k); walk(x[k], p + "." + k); }
  })(packet, "packet");
  return found;
}

// ---------- tally
// Unanimity decides; any split is "contested" and goes to the user first. minAgree (--agree N) relaxes that to N votes.
export function tally(votesByVoter, minAgree) {
  // votesByVoter: [{voter, votes:[{id, real:boolean, confidence:0..1, reason}]}] -> per id
  const by = new Map();
  for (const v of votesByVoter) for (const x of v.votes || []) { if (!by.has(x.id)) by.set(x.id, []); by.get(x.id).push(x); }
  const out = [];
  for (const [id, xs] of by) {
    const yes = xs.filter(x => x.real === true).length, no = xs.filter(x => x.real === false).length, n = yes + no;
    const need = minAgree || n;
    const verdict = n === 0 ? "none" : yes >= need ? "real" : no >= need ? "not-real" : "contested";
    out.push({ id, n, yes, no, verdict, meanConfidence: n ? +(xs.reduce((a, x) => a + (x.confidence || 0), 0)/n).toFixed(2) : null });
  }
  return out;
}

// ---------- rubric (written next to the packets so every voter and every rerun uses the same words)
export const RUBRIC = `Question for each packet: does the detector's claim describe a REAL, distinct market phenomenon of its family in this data, or is it noise / a weak or misdescribed pattern?
General: check the values behind each evidence item (a "met" flag is the detector's own claim); are the gate items convincing in size, not marginal; is the reading consistent with the price path; would a careful order-flow trader recognise it. Judge each packet alone; do not balance yes/no counts and do not assume most or few are real.
Wall (stricter): existing is not enough. A wall is real only if it MATTERED: it held long enough to be a level other traders could see and act on (seconds are not enough), AND either it was tested (a meaningful share traded into it, or reposted after being hit) or price visibly reacted to it. A wall that appeared and was pulled quickly with no trading into it and no price reaction is NOT real, however large. State in the reason which of held / tested / price reacted you relied on.`;

// ---------- commands
async function packets(args) {
  const nSessions = +args.sessions || 6, n = +args.n || 20, seed = +args.seed || 1, voters = +args.voters || 5, out = args.out || "panel/pilot";
  const dir = path.join(root, "sessions"), files = fs.readdirSync(dir).filter(f => /^session_.*\.json\.gz$/.test(f)).sort().slice(-nSessions);
  const E = loadEngine(null).E, all = [];
  for (const f of files) {
    const s = readInput(path.join(dir, f)), e = E.replayEngine(s.inputs);
    const hist = { bn: e.priceHistory("bn") || [], hl: e.priceHistory("hl") || [] }, sig = { bn: SB.sigmaOf(hist.bn), hl: SB.sigmaOf(hist.hl) };
    for (const g of e.episodeGroups()) {
      const vn = g.venues && g.venues.length > 1 ? "bn" : (g.venue || "bn");
      all.push({ file: f, g, p: packetOf(g, hist[vn], sig[vn], "") });
    }
  }
  const rand = rng(seed), byFam = {};
  for (const x of all) (byFam[x.g.family] ||= []).push(x);
  const fams = Object.keys(byFam).sort(), pick = [];
  for (const fam of fams) byFam[fam].sort(() => rand() - 0.5);
  for (let i = 0; pick.length < n && fams.some(f => byFam[f].length > i); i++) for (const fam of fams) if (pick.length < n && byFam[fam][i]) pick.push(byFam[fam][i]);   // round-robin over families
  pick.forEach((x, i) => { x.p.id = "P" + String(i + 1).padStart(3, "0"); });
  for (const x of pick) { const bad = leaks(x.p); if (bad.length) throw new Error("packet leaks " + bad.join(", ")); }
  fs.mkdirSync(path.join(root, out), { recursive: true });
  // the key (which packet is which group) stays out of the voters' folder
  const key = pick.map(x => ({ id: x.p.id, session: x.file, family: x.g.family, venue: x.g.venues && x.g.venues.length > 1 ? "any" : x.g.venue, side: SB.sideDir ? (x.g.aggressor || (x.g.wall && x.g.wall.side) || "-") : "-", t0: x.g.tStart, t1: x.g.tEnd || x.g.tUpdate, tDetected: x.g.tDetected }));
  fs.writeFileSync(path.join(root, out, "rubric.txt"), RUBRIC);
  fs.writeFileSync(path.join(root, out, "key.json"), JSON.stringify(key, null, 1));
  for (let v = 1; v <= voters; v++) {
    const r = rng(seed*1000 + v), order = pick.map(x => x.p).sort(() => r() - 0.5);
    fs.writeFileSync(path.join(root, out, "voter_" + v + ".json"), JSON.stringify(order));
  }
  console.log("groups found:", all.length, "(" + fams.map(f => f + " " + byFam[f].length).join(", ") + ")");
  console.log("sampled:", pick.length, "| voters:", voters, "| written to", out);
}

function tallyCmd(args) {
  const d = path.join(root, args.dir || "panel/pilot"), key = JSON.parse(fs.readFileSync(path.join(d, "key.json"), "utf8"));
  const votes = fs.readdirSync(d).filter(f => /^votes_\d+\.json$/.test(f)).map(f => ({ voter: f, votes: JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) }));
  const t = tally(votes, args.agree ? +args.agree : 0), byId = new Map(t.map(x => [x.id, x]));
  const labels = args.labels ? JSON.parse(fs.readFileSync(args.labels, "utf8")) : [];
  const rows = key.map(k => ({ ...k, ...(byId.get(k.id) || { n: 0, verdict: "none" }) }));
  const panel = rows.filter(r => r.verdict === "real" || r.verdict === "not-real").map(r => ({ id: "panel." + r.id, verdict: r.verdict === "real" ? "agree" : "disagree", family: r.family, venue: r.venue, side: r.side, t0: r.t0, t1: r.t1, src: "panel", votes: { yes: r.yes, no: r.no } }));
  fs.writeFileSync(path.join(d, "panel_labels.json"), JSON.stringify(panel, null, 1));
  const c = { real: 0, "not-real": 0, contested: 0, none: 0 }; for (const r of rows) c[r.verdict]++;
  console.log("voters:", votes.length, "| groups:", rows.length, "|", JSON.stringify(c));
  for (const fam of [...new Set(rows.map(r => r.family))].sort()) { const f = rows.filter(r => r.family === fam); console.log("  " + fam.padEnd(12), "real", f.filter(r => r.verdict === "real").length, "not-real", f.filter(r => r.verdict === "not-real").length, "contested", f.filter(r => r.verdict === "contested").length); }
  if (labels.length) {
    let a = 0, n = 0; const miss = [];
    for (const r of rows) { const mine = labelFor(labels, { family: r.family, venue: r.venue, aggressor: r.side, wall: { side: r.side }, tStart: r.t0, tEnd: r.t1, members: [] }); if (!mine || (r.verdict !== "real" && r.verdict !== "not-real")) continue; n++; if ((mine === "agree") === (r.verdict === "real")) a++; else miss.push(r.id); }
    console.log("against your labels:", n ? a + " of " + n + " decided groups match" : "no group has both your label and a decided panel verdict", miss.length ? "| differ: " + miss.join(", ") : "");
  } else console.log("no --labels given: agreement with you was not measured");
}

function selftest() {
  const T0 = 1000000, g = { family: "absorption", tStart: T0, tDetected: T0 + 3000, tEnd: T0 + 9000, outcome: "faded", resolution: "x", members: [{ id: 1, family: "absorption", venue: "bn", aggressor: "sell", passive: "buy", stage: "ended", outcome: "faded", resumedAt: [], tStart: T0, peak: 1, reading: "r", evidence: [{ k: "flow", label: "flow", ok: true, val: "60%", gate: true }] }] };
  const hist = []; for (let t = T0 - 200000; t <= T0 + 100000; t += 1000) hist.push([t, 100 + (t - T0)/1e6]);
  const p = packetOf(g, hist, 0.5, "P001"), s = JSON.stringify(p);
  const checks = [
    ["no forbidden key or outcome word in a packet", leaks(p).length === 0 && !/faded|resolution|resumedAt|outcome/.test(s)],
    ["a packet that does carry a forbidden key is caught", leaks({ a: { outcome: "x" } }).length === 1],
    ["evidence and the Reader's reading are kept", p.members[0].evidence[0].met === true && p.members[0].reading === "r"],
    ["price path starts before the start and ends at the end of the episode, in seconds from detection", p.priceBpsFromStart[0][0] === -123 && p.priceBpsFromStart.at(-1)[0] === 2],
    ["nothing after the end of the episode is in the path", p.priceBpsFromStart.every(x => x[0] <= 6)],
    ["unanimity decides: 5-0 real, 0-5 not-real, 3-2 and 1-4 contested; --agree 3 lets 3-2 decide", (() => {
      const v = (a) => ({ votes: a.map(r => ({ id: "x", real: r })) }), T = (arr, k) => tally(arr.map(r => v([r])), k)[0].verdict;
      return T([true, true, true, true, true]) === "real" && T([false, false, false, false, false]) === "not-real" && T([true, true, true, false, false]) === "contested" && T([true, false, false, false, false]) === "contested" && T([true, true, true, false, false], 3) === "real";
    })()],
    ["the wall rule is in the rubric", /MATTERED/.test(RUBRIC) && /pulled quickly/.test(RUBRIC)],
    ["an id without votes is reported as none by the CLI path (empty tally)", tally([]).length === 0]
  ];
  let bad = 0; for (const [name, ok] of checks) { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; }
  process.exit(bad ? 1 : 0);
}

const argv = process.argv.slice(2);
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) { const k = argv[i].slice(2); args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; }
  if (args.selftest) selftest(); else if (argv[0] === "packets") await packets(args); else if (argv[0] === "tally") tallyCmd(args); else console.log("usage: packets | tally | --selftest (see the top of this file)");
}
