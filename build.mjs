// Builds the single self-contained HTML file from src/.
//   node build.mjs            -> dist/stream-visualizer.html   (dev build)
//   node build.mjs --release  -> stream-visualizer_vNNN.html   (next free version, never overwrites)
//   node build.mjs --out FILE -> FILE
//   node build.mjs --version NNN --out FILE -> FILE stamped as vNNN (rebuilds a release from src/)
//   node build.mjs --verify   -> rebuilds the newest releases/ file from src/ and compares it byte for byte; exit 1 on a difference
// --release deletes the previous release file from releases/ (older ones live in GitHub Releases).
// The Reader self-test runs first; a failing scenario aborts the build. Every included .js file must also compile (a syntax error aborts it).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = p => path.join(root, "src", p);
const read = p => fs.readFileSync(src(p), "utf8");

async function selfTest() {
  const code = read("js/reader-episodes.js") + "\n" + read("js/reader-engine.js") + "\n" + read("js/system-core.js") + "\n" + read("js/auto-record-core.js") + "\n" + read("js/status-core.js") + "\n" + read("js/session-quality.js") + "\n" + read("js/history-core.js") + "\n" + read("js/collectors-core.js") + "\n" + read("js/disk-core.js") + "\n" + read("js/paper-broker-core.js") + "\n" + read("js/broker.js") + "\n" + read("js/market-core.js") + "\n" + read("js/micro-core.js") + "\n" + read("js/overnight-core.js") + "\n" + read("js/arm-memory-core.js") + "\n" + read("js/hooks.js") + "\n" + read("js/views.js") + "\n" +read("js/reader-selftest.js") + "\n;BROKER.selftest().then(bk => READER_SELFTEST.run(READER_ENGINE).concat(SYSTEM.selftest(READER_ENGINE), PAPER.selftest(), OVERNIGHT.selftest(), MICRO.selftest(), MARKET.selftest(), ARMMEM.selftest(), bk));";
  const results = await vm.runInNewContext(code, {}, { timeout: 120000 });
  const bad = results.filter(r => !r.ok);
  for (const r of results) console.log((r.ok ? "  pass  " : "  FAIL  ") + r.name + (r.ok ? "" : "\n        " + r.detail));
  if (bad.length) { console.error(`\n${bad.length}/${results.length} self-test scenarios failed; build aborted.`); process.exit(1); }
}

// The self-test only runs the pure files, so a syntax error in a page file (app.js, a view, a worker source) would pass it and break the page. Compile each included script (not run) to catch that.
function syntaxCheck(name, body) {
  try { new vm.Script(body, { filename: "src/" + name }); }
  catch (e) { console.error("\nsyntax error in src/" + name + ": " + e.message + "\n" + (e.stack || "").split("\n").slice(0, 4).join("\n") + "\nbuild aborted."); process.exit(1); }
}

function assemble() {
  return read("index.html").split("\n").map(line => {
    const m = line.match(/^<!--@include (\S+)-->$/);
    if (!m) return line;
    const body = read(m[1]);
    if (/<\/script/i.test(body)) throw new Error(`${m[1]} contains "</script", which would end the inline script early`);
    if (m[1].endsWith(".js")) syntaxCheck(m[1], body);
    return body;
  }).join("\n");
}

const releaseDir = path.join(root, "releases");      // every stream-visualizer_vNNN.html lives here (until v098 they sat in the repo root)
function nextRelease() {
  const names = d => fs.existsSync(d) ? fs.readdirSync(d) : [];      // the root is scanned too, so a stray old-style file in it still counts and a number is never reused
  const nums = [...names(root), ...names(releaseDir)].map(f => f.match(/^stream-visualizer_v(\d+)\.html$/)).filter(Boolean).map(m => +m[1]);
  return path.join(releaseDir, `stream-visualizer_v${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}.html`);
}

const args = process.argv.slice(2);
const argVal = f => args[args.indexOf(f) + 1];
if (args.includes("--out") && !argVal("--out")) { console.error("--out needs a file path"); process.exit(1); }
if (args.includes("--version") && !/^\d+$/.test(argVal("--version") || "")) { console.error("--version needs a number, e.g. --version 132"); process.exit(1); }
const stamp = (html, version) => html.replace("__APP_VERSION__", version);

if (args.includes("--verify")) {
  const files = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).filter(f => /^stream-visualizer_v\d+\.html$/.test(f)).sort() : [];
  if (!files.length) { console.error("verify: no release file in releases/"); process.exit(1); }
  const name = files[files.length - 1], committed = fs.readFileSync(path.join(releaseDir, name));
  await selfTest();
  const rebuilt = Buffer.from(stamp(assemble(), name.match(/_(v\d+)\.html$/)[1]));
  if (rebuilt.equals(committed)) { console.log(`\nverify: releases/${name} matches src/ (${committed.length} bytes)`); process.exit(0); }
  let i = 0; while (i < rebuilt.length && i < committed.length && rebuilt[i] === committed[i]) i++;
  const hex = b => b.subarray(i, i + 16).toString("hex") + "  " + JSON.stringify(b.subarray(i, i + 16).toString("latin1"));
  console.error(`\nverify FAILED: releases/${name} does not match a build of src/\n  committed: ${committed.length} bytes\n  rebuilt:   ${rebuilt.length} bytes\n  first difference at byte ${i}\n  committed: ${hex(committed)}\n  rebuilt:   ${hex(rebuilt)}`);
  process.exit(1);
}

await selfTest();
const out = args.includes("--out") ? path.resolve(argVal("--out"))
          : args.includes("--release") ? nextRelease()
          : path.join(root, "dist", "stream-visualizer.html");
const version = args.includes("--version") ? "v" + String(argVal("--version")).padStart(3, "0")
              : (path.basename(out).match(/^stream-visualizer_(v\d+)\.html$/) || [, "dev"])[1];     // stamped into the page so it can tell when a newer release is published
const html = stamp(assemble(), version);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
if (args.includes("--release") && fs.existsSync(releaseDir))      // only the newest release stays in git; the new file is written first, so a failure never leaves releases/ empty
  for (const f of fs.readdirSync(releaseDir)) if (/^stream-visualizer_v\d+\.html$/.test(f) && f !== path.basename(out)) fs.unlinkSync(path.join(releaseDir, f));
console.log(`\nwrote ${out} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
