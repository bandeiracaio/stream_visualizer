// Builds the Rust cores (rust/) into one .wasm for build.mjs and parity.mjs. Needs only cargo and the wasm32-unknown-unknown target.
// The bytes must not depend on the machine: paths are remapped (CARGO_ENCODED_RUSTFLAGS) and the path separators that remain in panic-location strings
// are normalised to "/" (a Windows build writes a backslash), so a Linux CI build and a Windows build give the same bytes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// root: the repo root. Returns the wasm bytes (Buffer). Exits the process with a clear message when cargo fails.
export function buildWasm(root, { quiet = false } = {}) {
  const rustDir = path.join(root, "rust"), pin = (fs.readFileSync(path.join(rustDir, "rust-toolchain.toml"), "utf8").match(/channel\s*=\s*"([^"]+)"/) || [])[1];
  const help = "\nInstall Rust (https://rustup.rs), then:  rustup toolchain install " + pin + " --profile minimal --target wasm32-unknown-unknown\n(rust/rust-toolchain.toml pins the version; on Windows without the MSVC build tools use the -x86_64-pc-windows-gnu toolchain).";
  const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), ".cargo");
  const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: [`--remap-path-prefix=${cargoHome}=/cargo`, `--remap-path-prefix=${rustDir}=/sv`].join("\x1f") };
  if (process.platform === "win32" && !env.RUSTUP_TOOLCHAIN) {      // the pinned toolchain defaults to the MSVC host, which needs Visual Studio's linker; any installed toolchain of the same rustc version does (the wasm is the same)
    const list = spawnSync("rustup", ["toolchain", "list"], { encoding: "utf8" }), have = new Set((list.stdout || "").split("\n").map(l => l.split(" ")[0]));      // only installed ones: asking rustc for a missing toolchain would install it
    for (const t of [pin + "-x86_64-pc-windows-gnu", "stable-x86_64-pc-windows-gnu", pin + "-x86_64-pc-windows-msvc"].filter(t => have.has(t))) {
      const v = spawnSync("rustc", ["--version"], { env: { ...env, RUSTUP_TOOLCHAIN: t }, encoding: "utf8" });
      if (v.status === 0 && v.stdout.startsWith("rustc " + pin + " ")) { env.RUSTUP_TOOLCHAIN = t; break; }
    }
  }
  const r = spawnSync("cargo", ["build", "--release", "--locked", "--target", "wasm32-unknown-unknown"], { cwd: rustDir, env, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.error || r.status !== 0) {
    const out = r.error ? (r.error.code === "ENOENT" ? "cargo was not found on PATH." : String(r.error)) : (r.stderr || "").split("\n").slice(-30).join("\n");
    console.error("\ncargo build of rust/ failed:\n" + out + (/can't find crate for .(core|std)./.test(r.stderr || "") ? "\nThe wasm32-unknown-unknown target is missing: rustup target add wasm32-unknown-unknown" : "") + help + "\nbuild aborted.");
    process.exit(1);
  }
  const buf = fs.readFileSync(path.join(rustDir, "target", "wasm32-unknown-unknown", "release", "sv_wasm.wasm"));
  const fixed = Buffer.from(buf.toString("latin1").replace(/[\x20-\x7e]{8,}?\.rs/g, s => s.replace(/\\/g, "/")), "latin1");
  if (fixed.length !== buf.length) throw new Error("wasm path normalisation changed the length");
  if (!quiet) console.log(`  wasm: ${fixed.length} bytes (${Math.ceil(fixed.length / 3) * 4} base64) from rust/`);
  return fixed;
}
