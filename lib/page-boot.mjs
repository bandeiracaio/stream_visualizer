// Page boot check, run by build.mjs on the assembled page: the scripts that touch the page have no self-test, and they share globals by name across
// <script> tags, so their load order is a dependency nothing else checks. This runs every script of the built page, in order, in one context with a
// stub browser, then runs each timer / frame callback they registered once, and runs the collectors' worker source in a stub worker.
// It catches: a name used at load time before the script that defines it, a renamed global, an exception at startup or in the first tick.
// It does not catch: anything that needs real data, a real DOM or a user action (docs/agents/testing-ui.md covers those by hand).
// `guards`: every name the page reads as `typeof name === "function"` must be a function once all scripts are loaded; a rename would otherwise
// switch the guarded feature off without an error.
import vm from "node:vm";

// One object that answers anything: any property is itself, it can be called and constructed, it is empty when looped over, 0 as a number and "" as text.
// The properties code walks until null (firstChild, parentNode, ...) are null, so a "remove every child" loop ends.
function universal() {
  const END = new Set(["firstChild", "lastChild", "nextSibling", "previousSibling", "parentNode", "nextElementSibling", "previousElementSibling", "then", "onmessage", "onerror"]);
  const U = new Proxy(function () {}, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return hint => hint === "number" ? 0 : "";
      if (k === Symbol.iterator) return function* () {};
      if (typeof k === "symbol") return undefined;
      if (END.has(k)) return null;
      if (k === "length" || k === "size") return 0;
      return U;
    },
    set() { return true; },
    has() { return true; },
    apply() { return U; },
    construct() { return U; },
  });
  return U;
}

function browser(errors, timers) {
  const U = universal(), ls = new Map();
  const later = kind => f => { timers.push([kind, f]); return 0; };
  const g = {
    console: { log() {}, warn() {}, info() {}, debug() {}, error(...a) { errors.push("console.error: " + a.map(x => x && x.stack ? x.stack.split("\n").slice(0, 3).join(" | ") : String(x)).join(" ").slice(0, 400)); } },
    document: U, navigator: U, indexedDB: U, screen: U, history: U, caches: U, crypto: U,
    localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); }, key: i => [...ls.keys()][i] ?? null, get length() { return ls.size; } },
    location: { protocol: "http:", href: "http://localhost/", search: "", hash: "", hostname: "localhost", origin: "http://localhost", pathname: "/" },
    getComputedStyle: () => ({ getPropertyValue: () => "#123456" }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setTimeout: later("timeout"), setInterval: later("interval"), requestAnimationFrame: later("frame"), clearTimeout() {}, clearInterval() {}, cancelAnimationFrame() {}, queueMicrotask() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, postMessage() {}, importScripts() {},
    fetch: () => new Promise(() => {}), confirm: () => false, alert() {}, prompt: () => null,
    WebSocket: U, Worker: U, Blob: U, URL: U, Image: U, Audio: U, AudioContext: U, Notification: U, BroadcastChannel: U, ResizeObserver: U, IntersectionObserver: U, MutationObserver: U,
    CompressionStream: U, DecompressionStream: U, Response: U, FileReader: U, File: U,
    TextEncoder, TextDecoder, AbortController, structuredClone, performance: { now: () => Date.now() }, devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
  };
  g.window = g; g.self = g; g.globalThis = g;
  return vm.createContext(g);
}

const short = e => e && e.stack ? (e.name || "Error") + ": " + e.message + "\n          " + e.stack.split("\n").slice(0, 3).join("\n          ") : String(e);

function runAll(ctx, list, errors, timers) {
  for (const [name, body] of list) {
    try { new vm.Script(body, { filename: name }).runInContext(ctx, { timeout: 20000 }); }
    catch (e) { errors.push(name + ": " + short(e)); }
  }
  let ran = 0;
  for (const [kind, f] of timers.splice(0)) {      // the first tick of each timer the page started; what those callbacks schedule in turn is not run
    if (typeof f !== "function") continue;
    ran++; ctx.__cb = f;
    try { const r = vm.runInContext("__cb(0)", ctx, { timeout: 5000 }); if (r && typeof r.then === "function") r.then(null, e => errors.push("first " + kind + " callback (async): " + short(e))); }
    catch (e) { errors.push("first " + kind + " callback: " + short(e)); }
  }
  return ran;
}

// html: the assembled page. Resolves to [{name, ok, detail}] in the shape of the self-test results.
// nameOf(body): optional, the source file of a script body (build.mjs knows it).
export async function pageBoot(html, nameOf) {
  const res = [], tags = [...html.matchAll(/<script([^>]*)>\n?([\s\S]*?)<\/script>/g)];
  // a script is named by its source file when the caller knows it, else by its id or the start of its first comment
  const idOf = (attrs, i, body) => (nameOf && nameOf(body)) || (attrs.match(/id="([^"]+)"/) || body.match(/^(?:"use strict";\s*)?\/\/[\s-]*([^\n:(]{1,40})/) || [, "script " + (i + 1)])[1].trim();
  const page = [], workers = [];
  tags.forEach((m, i) => (/type="text\/plain"/.test(m[1]) ? workers : page).push([idOf(m[1], i, m[2]), m[2]]));
  const settle = () => new Promise(r => setTimeout(r, 200));      // an async callback rejects a moment later
  const stray = [], onStray = e => stray.push("rejected promise: " + short(e));
  process.on("unhandledRejection", onStray);

  let errors = [], timers = [];
  const ctx = browser(errors, timers), ran = runAll(ctx, page, errors, timers);
  await settle(); errors.push(...stray.splice(0));
  res.push({ name: `page: ${page.length} scripts load in order and their ${ran} first callbacks run, in a stub browser`, ok: !errors.length, detail: errors.join("\n        ") });

  const names = new Set(); for (const [, body] of page) for (const m of body.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*[!=]==?\s*"function"/g)) names.add(m[1]);
  const missing = [...names].filter(n => { try { return vm.runInContext("typeof " + n, ctx) !== "function"; } catch { return true; } });
  res.push({ name: `page: the ${names.size} names read through a typeof guard are functions`, ok: !missing.length, detail: "not a function once the page has loaded: " + missing.join(", ") });

  for (const [name, body] of workers) {
    errors = []; timers = [];
    const ran2 = runAll(browser(errors, timers), [[name, body]], errors, timers);
    await settle(); errors.push(...stray.splice(0));
    res.push({ name: `page: worker source ${name} loads and its ${ran2} first callbacks run, in a stub worker`, ok: !errors.length, detail: errors.join("\n        ") });
  }
  process.off("unhandledRejection", onStray);
  return res;
}
