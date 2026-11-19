# Rust migration: plan

Date: 2026-11-17. Status: proposal for the user's review. Nothing is built.

## 1. Goal

Move the pure logic of the page from JavaScript to Rust, compiled to WebAssembly (WASM), without losing what the project has now:

- One self-contained HTML file that works offline on a PC or a phone.
- Exact replay: the same inputs give the same detections and the same journal rows.
- A build that self-tests and fails loudly, and a release that CI can verify against `src/`.

The views, charts, CSS, sockets and storage stay in JavaScript.

## 2. Decisions

| Question | Decision | Why |
|---|---|---|
| Compiler target | `wasm32-unknown-unknown`, plain `extern "C"` exports and a hand-written JS loader (amended 2026-11-17: no `wasm-bindgen`, no `wasm-opt`) | Only `cargo` and the target are needed (CI, the hook, the other session); fewer pinned tools to keep reproducible. Calls pass JSON in and out (serde_json's shortest float form round-trips exactly, like `JSON.stringify`). |
| Emscripten | Not used | It is built for C/C++ code and desktop-like runtimes (file system, POSIX, threads). The cores need none of that. Revisit only if a C/C++ library is needed. |
| Single file | `build.mjs` inlines the `.wasm` as base64 and instantiates it from those bytes | Same as Emscripten's `SINGLE_FILE`, in a few lines. |
| UI in Rust (Leptos, Yew) | No | It would mean a rewrite of every view for little gain. |
| Math functions | During the port, the WASM imports `Math.exp`, `Math.log`, `Math.pow` (and any other transcendental function) from JS | Compiled libm and V8 may differ in the last bit; importing keeps detections byte-identical. Switching to compiled math later is an ADR with a new baseline. |
| Self-tests | The 370+ JS scenarios stay and run against the WASM build | The unchanged tests are the proof of the port. New Rust unit tests are allowed in addition, not instead. |
| Old JS cores | Kept beside the Rust ones until each port passes parity on the saved sessions, then deleted in its own step | Lets every step compare A against B. |

## 3. What moves and what stays

| Layer | Files | Plan |
|---|---|---|
| Pure cores | `reader-engine`, `reader-episodes`, `system-core`, `runner-core`, `exec-core`, `promotion-core`, `paper-broker-core`, `micro-core`, `market-core`, `chunk-core`, `history-core`, `session-quality` | Move to Rust, one per step (section 6). |
| Page glue | `feeds.js`, `runner.js`, `exec.js`, `recordings.js`, `folder-save.js`, collectors and the worker | Stay in JS; they call the WASM. Decisions inside them may move later. |
| Views | `app.js` charts, `trader-view`, `reader-cards`, `overview`, `trading-view`, `styles.css` | Stay in JS. |
| Offline scripts | `design-harness.mjs`, `compare-detections.mjs`, `sample-designs.mjs`, `episode-outcomes.mjs` | Call the same WASM from Node at first; a native Rust binary later (step R7). |

## 4. Repo layout

```
rust/
  Cargo.toml            workspace, toolchain pinned in rust-toolchain.toml
  crates/
    sv-core/            shared types (inputs, snapshots, rows), JS-math imports
    sv-promotion/       one crate per core, ported in the order of section 6
    ...
    sv-wasm/            the wasm-bindgen surface: one exported object per core
    sv-cli/             (R7) native replay tool
```

`src/js/<core>.js` becomes a thin wrapper that keeps the same global (`PROMO`, `RUNNER`, ...) and the same functions, and forwards to the WASM. Callers do not change.

## 5. Build, CI and checks

1. `build.mjs`:
   - runs `cargo build --release --target wasm32-unknown-unknown`, `wasm-bindgen --target no-modules` (or `web`), `wasm-opt -Oz`;
   - inlines the bytes as base64 in the page;
   - instantiates the WASM before any script that uses a core (synchronous `new WebAssembly.Module(bytes)` so the page's script order stays as it is);
   - then runs the self-test and the boot check as today.
2. `lib/page-boot.mjs`: the stub browser gets `WebAssembly` (Node has it).
3. Reproducible bytes: toolchain, `wasm-bindgen` and `wasm-opt` versions pinned; `--remap-path-prefix` so local paths do not leak into the binary. `node build.mjs --verify` must still give byte-equal pages on two machines.
4. `hooks/pre-commit` and `.github/workflows/pages.yml` install the pinned toolchain (CI caches it).
5. Size budget: the page may grow by at most 600 KB of base64. The build prints the WASM size.
6. The batch boundary: inputs go into the WASM in batches (per frame or per second), and results come back as plain arrays or JSON. No per-trade call across the boundary.

### Parity check for every port

Every step that ports a core must show, before its release:

- `node build.mjs` exits 0 with every JS scenario passing against the WASM build.
- The JS and Rust versions run side by side over every saved session (except the study's test set, section 7) and give identical outputs:
  - Reader cores: `node compare-detections.mjs` exits 0.
  - System, runner, broker and promotion: `design-harness.mjs --replay-run` journals are equal row for row with the JS version's.
  - Exec: the `exec:*` fake-exchange scenarios give identical request and row streams.
- A new script `parity.mjs` runs both versions over a list of inputs and prints a line per session (long scripts log a line per item, so slow is told from stuck).

## 6. Steps

One step and one release each, following the Release section of `CLAUDE.md`.

| Step | What | Done when |
|---|---|---|
| R0 | Toolchain and plumbing: `rust/` workspace, build steps, base64 inlining, boot check with WASM, CI and hook. Port **`promotion-core`** (small, pure, well tested) as the first core. | Page released; `PROMO` scenarios pass on WASM; `--verify` passes in CI. |
| R1 | `paper-broker-core`, `history-core`, `session-quality` | Their scenarios pass; parity over saved sessions. |
| R2 | `system-core` (facts accumulator and systems) | `system:*` scenarios pass; `design-harness.mjs` snapshots and trades identical. |
| R3 | `runner-core` (ledgers, twins, risk cap, evaluate) | `--replay-run` journals equal row for row; `trader:` scenarios pass. |
| R4 | `exec-core` | `exec:*` scenarios identical; no request leaves for a non-demo host (the `ALLOW_LIVE` guard is ported and tested). |
| R5 | `micro-core`, `market-core`, `chunk-core` | Scenarios pass; chunk boundaries identical on a replayed run. |
| R6 | `reader-engine`, `reader-episodes` (**not before the episode-outcomes run**, section 7) | `compare-detections.mjs` exits 0 on every saved session. |
| R7 | `sv-cli`: a native replay binary for the offline scripts | Its output equals the WASM output; the scripts get a `--native` switch. |
| R8 | Delete the JS cores that have passed parity; the wrappers stay | The build and every check still pass. |

R7 can go earlier if faster studies are the main need: it needs only the cores already ported.

## 7. Constraints

- **Episode-outcomes study** (`.scratch/episode-outcomes/plan.md`): its one test run is about 2026-12-07 and uses the registered script on today's engine. R6 waits until that run is done. The parity checks before then use the exploration recordings only, never the test set (every recording from 2026-11-16T00:00Z).
- **Trader step 8 and 9** go on in JS meanwhile; whichever core is being ported is frozen for its step, so the two lines of work do not collide.
- **Parallel sessions**: another Claude pushes releases; it needs the pinned toolchain before the first Rust release. Note it in `CLAUDE.md` under Build in R0.
- **Pure stays pure**: a Rust core gets no clock, no randomness and no I/O; time and seeds are passed in as today.

## 8. Risks

| Risk | Answer |
|---|---|
| Last-bit float differences (math functions, order of additions, sort ties, number to text) | Import JS math; keep the exact order of operations; stable sorts with the JS tie rule; format numbers on the JS side. Parity checks on every step. |
| Non-reproducible WASM bytes break `--verify` | Pinned versions, path remapping, a CI check on a second build. |
| Harder debugging on a phone | Keep the JS wrapper error messages; build with a name section in dev builds; panics map to a thrown JS error with the core's name. |
| Two languages in every later step | Views, glue and the docs stay in JS; Rust is limited to the cores. |
| The gain is small in the page (a few hundred inputs a second is not a bottleneck) | The plan is worth it mainly for type safety in the cores and speed in the offline studies (R7). If speed is the only reason, do R0 and R7 alone. |

## 9. Open questions

1. Is the goal speed in the studies, type safety, or both? If only speed, the plan reduces to R0, R2, R3, R6 and R7.
2. Native-only tools (R7) could also replace the Node scripts entirely. Keep Node as the driver, or move the scripts to Rust?
3. Should the size budget (600 KB) be lower for the phone?

## Amendment 1 (2026-11-19): what was learned in R0-R5

- **Committed wasm (v153).** A compile is not byte-identical across hosts (Linux and Windows differed by 832 bytes at v152), so `rust/sv.wasm` is committed with `rust/sv.wasm.src` (the hash of the `rust/` sources). CI never compiles; it fails on a stale hash.
- **Budget.** The 600 KB base64 budget does not hold; the new budget is about 1.1 MB base64 (about 825 KB of wasm), without `wasm-opt`.
- **Boundary cost decides what moves.** A call across JS and wasm with JSON costs about 5 to 10 µs. A core gains only when much work happens per call (R3: the runner steps 147 instances in one call, 2.7x faster than JS). Cores whose functions are small and called per input lose.
- **R5 not released.** MICRO, MARKET and CHUNK are per-input or trivial: every function measured was slower through wasm (for example `CHUNK.pipeline.input` 4 µs/s in JS against 186 µs/s; `MARKET.midRow` 0.2 against 31 µs/s). They stay in JS. The attempt (crate `sv-feed`, its parity and the benchmark) is kept in `.scratch/rust-migration/r5-attempt/` for reference.
- **R7 deferred until after R6.** A native replay tool needs the facts accumulator and the Reader engine in Rust; until R6, `design-harness.mjs` already runs the systems and runner on wasm faster than the JS reference.
- **R8 scope.** Delete the JS references only of the cores that moved (PROMO, PAPER, HIST, SQ, SYSTEM, RUNNER, EXEC).
