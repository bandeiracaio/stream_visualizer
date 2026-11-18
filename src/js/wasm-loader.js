// WebAssembly loader: the Rust cores (rust/, built into the page by build.mjs as base64) behind one global, SVWASM.
//   SVWASM.call("promo_eligibility", obj) -> the result object (JSON in, JSON out; export sv_promo_eligibility). Throws Error("wasm core promo: ...") on a bad input, a trap or a panic.
//   SVWASM.ready  -> a promise that resolves when the module is instantiated (rejects if it cannot be).
// Why async in the page: Chrome refuses a synchronous new WebAssembly.Module(bytes) on the main thread above a small size, so the page compiles with WebAssembly.instantiate (this file is the
// FIRST script, so compiling starts at once). A call before it resolves throws; nothing calls a core while the page loads (a user action, a connect or a view render comes first), and the boot check
// in build.mjs runs every script synchronously and fails the build if anything does. Node (build self-test, scripts) sets __SV_SYNC and instantiates at once.
// The ABI (memory, result block, errors, NaN rule): rust/crates/sv-core/src/lib.rs. A worker that needs a core must include this file and its own copy of the bytes (collectors-worker does not use one yet).
const SVWASM = (() => {
  "use strict";
  const B64 = "__SV_WASM_B64__";      // build.mjs puts the .wasm bytes here
  const dec = new TextDecoder(), enc = new TextEncoder();
  let inst = null, panicText = "", failure = null;
  const imports = {
    env: {
      exp: Math.exp, log: Math.log, pow: Math.pow, log1p: Math.log1p, expm1: Math.expm1,      // the host's own math, so results equal the JS cores bit for bit
      sv_panic: (p, n) => { panicText = dec.decode(new Uint8Array(inst.exports.memory.buffer, p, n)); },
    },
  };
  const bytes = () => { const s = atob(B64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  let ready;
  if (typeof __SV_SYNC !== "undefined" && __SV_SYNC) {
    inst = new WebAssembly.Instance(new WebAssembly.Module(bytes()), imports);
    ready = Promise.resolve();
  } else {
    ready = WebAssembly.instantiate(bytes(), imports).then(r => { inst = r.instance; }, e => { failure = e; throw e; });
    ready.catch(() => {});      // a failed load is reported by the first call (and by whoever awaits ready), not as an unhandled rejection
  }

  function call(name, obj) {
    const core = String(name).split("_")[0], fail = m => new Error("wasm core " + core + ": " + m);
    if (!inst) throw fail(failure ? "WebAssembly failed to load: " + failure.message : "WebAssembly is not ready yet (await SVWASM.ready)");
    const ex = inst.exports, fn = ex["sv_" + name];
    if (!fn) throw fail("no export sv_" + name);
    const input = enc.encode(JSON.stringify(obj === undefined ? null : obj)), p = ex.sv_alloc(input.length);
    let r = 0, n = 0;
    try {
      new Uint8Array(ex.memory.buffer, p, input.length).set(input);      // read memory.buffer after sv_alloc: the allocation may have grown the memory
      panicText = "";
      try { r = fn(p, input.length); }
      catch (e) { throw fail(panicText || (e && e.message) || String(e)); }
    } finally { ex.sv_free(p, input.length); }
    const mem = new Uint8Array(ex.memory.buffer);
    n = new DataView(ex.memory.buffer).getUint32(r, true);
    const status = mem[r + 4], text = dec.decode(mem.subarray(r + 5, r + 4 + n));
    ex.sv_free(r, 4 + n);
    if (status !== 0) throw fail(text);
    return JSON.parse(text);
  }

  return { call, ready, get loaded() { return !!inst; } };
})();
