// Builds the single self-contained HTML file from src/.
//   node build.mjs            -> dist/stream-visualizer.html   (dev build)
//   node build.mjs --release  -> stream-visualizer_vNNN.html   (next free version, never overwrites)
//   node build.mjs --out FILE -> FILE
// The Reader self-test runs first; a failing scenario aborts the build. Every included .js file must also compile (a syntax error aborts it).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = p => path.join(root, "src", p);
const read = p => fs.readFileSync(src(p), "utf8");

function selfTest() {
  const code = read("js/reader-drift.js") + "\n" + read("js/reader-proposals.js") + "\n" + read("js/reader-register.js") + "\n" + read("js/reader-episodes.js") + "\n" + read("js/reader-engine.js") + "\n" + read("js/reader-landscape.js") + "\n" + read("js/auto-record-core.js") + "\n" + read("js/status-core.js") + "\n" + read("js/session-quality.js") + "\n" + read("js/history-core.js") + "\n" + read("js/collectors-core.js") + "\n" + read("js/label-queue-core.js") + "\n" + read("js/reader-selftest.js") + "\n;READER_SELFTEST.run(READER_ENGINE);";
  const results = vm.runInNewContext(code, {}, { timeout: 120000 });
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

function nextRelease() {
  const nums = fs.readdirSync(root).map(f => f.match(/^stream-visualizer_v(\d+)\.html$/)).filter(Boolean).map(m => +m[1]);
  return path.join(root, `stream-visualizer_v${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}.html`);
}

const args = process.argv.slice(2);
if (args.includes("--out") && !args[args.indexOf("--out") + 1]) { console.error("--out needs a file path"); process.exit(1); }
selfTest();
const out = args.includes("--out") ? path.resolve(args[args.indexOf("--out") + 1])
          : args.includes("--release") ? nextRelease()
          : path.join(root, "dist", "stream-visualizer.html");
const version = (path.basename(out).match(/^stream-visualizer_(v\d+)\.html$/) || [, "dev"])[1];     // stamped into the page so it can tell when a newer release is published
const html = assemble().replace("__APP_VERSION__", version);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`\nwrote ${out} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
