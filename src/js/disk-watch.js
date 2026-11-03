"use strict";
// Disk space watch (view side of disk-core.js): asks the browser for its storage estimate once a minute and keeps the latest reading in DW for the Arm mode screen
// (a row in Data quality, and an alert when it is low). Read-only: it never writes, deletes or changes a recording, a feed or a detection. Loaded after label-queue.js; arm-mode.js
// reads `DW` through a typeof guard, so the screen is unharmed if this file is missing or the browser has no estimate.
const DW = {free:null, at:0, last:null};
DW.assess = () => {
  if (DW.free == null) return null;
  const rows = typeof RC !== "undefined" && RC.rows ? RC.rows : [];
  return DISK.assess(DW.free, DISK.rate(rows, Date.now()));
};
async function dwPoll() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const e = await navigator.storage.estimate();
    if (e && e.quota > 0) { DW.free = Math.max(0, e.quota - (e.usage || 0)); DW.at = Date.now(); const a = DW.assess(); if (a && a.tone !== (DW.last && DW.last.tone)) DW.last = a; }
  } catch {}
}
dwPoll(); setInterval(dwPoll, 60000);
