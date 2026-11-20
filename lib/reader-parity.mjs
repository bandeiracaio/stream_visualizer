// Parity of the Reader in Rust/WebAssembly with the JS Reader: node lib/reader-parity.mjs [--seeds N] [--from S] [--phases P] [--selftest-only | --random-only] [--quiet]
// Builds rust/ when its sources changed (as node build.mjs does), loads the page's own files in a fresh context and runs READER_PARITY (src/js/reader-parity.js):
// every self-test scenario through the paired engine, then N random streams (default 40). Exit 0 when every read was equal, 1 otherwise.
// The build runs the same check with fewer seeds; this is the long run.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildWasm } from "./wasm-build.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// the files the build's self-test loads (READER_SELFTEST's scenario list also holds the other pure cores' scenarios), then the WASM Reader and the parity harness
export const READER_FILES = ["wasm-loader", "reader-episodes", "reader-engine", "system-core", "systems-default", "runner-core", "chunk-core", "promotion-core", "exec-core", "trader-core", "status-core", "session-quality",
  "history-core", "collectors-core", "disk-core", "paper-broker-core", "broker", "market-core", "micro-core", "hooks", "views", "reader-selftest", "reader-wasm", "reader-parity"];
// the Reader's files and the WASM, loaded the way the page loads them (Node instantiates synchronously)
export function loadReaders({ quiet = true } = {}) {
  const b64 = buildWasm(root, { quiet }).toString("base64");
  const src = READER_FILES.map(f => { const s = fs.readFileSync(path.join(root, "src/js", f + ".js"), "utf8"); return f === "wasm-loader" ? s.replace("__SV_WASM_B64__", () => b64) : s; }).join("\n");
  return vm.runInNewContext(src + "\n;({E:READER_ENGINE, W:READER_WASM, P:READER_PARITY, S:READER_SELFTEST, SVWASM})", { atob, TextEncoder, TextDecoder, __SV_SYNC: true, FinalizationRegistry }, { timeout: 3600000 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; }, has = k => process.argv.includes(k);
  const seeds = arg("--seeds", 40), from = arg("--from", 1), phases = arg("--phases", 24), quiet = has("--quiet");
  const { P } = loadReaders({ quiet: false });
  let bad = 0, n = 0;
  const t0 = Date.now();
  if (!has("--random-only")) {
    for (const r of P.selftest()) { n++; if (!r.ok) bad++; if (!r.ok || !quiet) console.log((r.ok ? "  pass  " : "  FAIL  ") + r.name + (r.ok ? "" : "\n        " + r.detail)); }
  }
  if (!has("--selftest-only")) {
    let inputs = 0, checks = 0; const fams = {};
    for (let s = from; s < from + seeds; s++) {
      const r = P.random(s, { phases }); n++; inputs += r.inputs; checks += r.checks; for (const [k, v] of Object.entries(Object.assign({}, r.families, r.types))) fams[k] = (fams[k] || 0) + v;
      if (!r.ok) bad++;
      if (!r.ok || !quiet) console.log((r.ok ? "  pass  " : "  FAIL  ") + `random stream ${s}: ${r.inputs} inputs, ${r.checks} full comparisons` + (r.ok ? `, ${r.episodes} episodes ${JSON.stringify(r.families)}, ${r.events} signals ${JSON.stringify(r.types)}, cfg ${r.cfg}` : "\n        cfg " + r.cfg + "\n        " + r.detail));
    }
    console.log(`random streams: ${seeds} seeds from ${from}, ${inputs} inputs, ${checks} full comparisons, episodes and signals seen ${JSON.stringify(fams)}`);
  }
  console.log(`${n - bad}/${n} equal (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(bad ? 1 : 0);
}
