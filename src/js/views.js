"use strict";
// Views (pure, no DOM): the one registry of what the page can show. A view is what data-tab on a <section> names.
// VIEWS.area(id, label) declares a navigation area (in display order). VIEWS.register({id, label, area, slot, minIntervalMs, render, onOpen}):
//   area/label  where it sits in the navigation (registration order = display order inside the area).
//   slot        views sharing a slot share one render function and one throttle (default: its own id); the first registration
//               of a slot that gives `render` + `minIntervalMs` defines them. A slot is drawn once per tick when ANY of its views is visible.
//   onOpen      called when the view is opened (setTab). Late-loaded modules add more with VIEWS.onOpen(id, fn).
// VIEWS.tick(ts, isVisible) draws due slots in first-registration order. Not in the registry: the dirty-flag block (market / tape / raw) and renderSlow.
const VIEWS = (() => {
  const areas = [], views = [], slots = new Map(), opens = Object.create(null), labels = Object.create(null);
  function area(id, label) { areas.push({ id, label, views: [] }); }
  function onOpen(id, fn) { (opens[id] || (opens[id] = [])).push(fn); }
  function register(v) {
    const a = areas.find(x => x.id === v.area); if (!a) throw new Error("views: unknown area " + v.area);
    a.views.push(v.id); views.push(v.id); labels[v.id] = v.label;
    const slot = v.slot || v.id;
    let s = slots.get(slot); if (!s) { s = { ids: [], render: null, ms: 0, last: 0 }; slots.set(slot, s); }
    s.ids.push(v.id);
    if (v.render) { s.render = v.render; s.ms = v.minIntervalMs || 0; }
    if (v.onOpen) onOpen(v.id, v.onOpen);
  }
  function open(id) { for (const fn of (opens[id] || []).slice()) { try { fn(id); } catch (err) { if (typeof console !== "undefined") console.error("view open " + id + ":", err); } } }
  function tick(ts, isVisible) {
    for (const s of slots.values()) {
      if (s.render && s.ids.some(isVisible) && ts - s.last > s.ms) { s.last = ts; s.render(); }
    }
  }
  const groups = () => areas.map(a => [a.id, a.label, a.views.slice()]);
  const tabs = () => views.map(id => [id, labels[id]]);
  return { area, register, onOpen, open, tick, groups, tabs };
})();
