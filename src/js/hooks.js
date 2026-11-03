"use strict";
// Hooks (pure, no DOM): the one way a late-loaded module extends an owner's function without reassigning the owner's global.
// The owner (app.js) calls HOOKS.emit(name, ...args) at a fixed point; modules call HOOKS.on(name, fn). Subscribers run in the order
// they subscribed (= script load order); an error in one is logged and does not stop the owner or the other subscribers.
// Names in use: "renderReader" (end of renderReader), "logout" (end of logout), "bnDepth" (start of bnDepth, arg d).
const HOOKS = (() => {
  const subs = Object.create(null);
  function on(name, fn) { (subs[name] || (subs[name] = [])).push(fn); }
  function emit(name, ...args) {
    const list = subs[name]; if (!list) return;
    for (const fn of list.slice()) { try { fn(...args); } catch (err) { if (typeof console !== "undefined") console.error("hook " + name + ":", err); } }
  }
  return { on, emit };
})();
