"use strict";
// Live status chips for the header (pure, no DOM, no timers): turns a snapshot of the app's state into a short list of chips
// {id, text, tone, title}. tone is "ok" | "warn" | "bad" | "info". The view (status-bar.js) gathers the snapshot once a second and draws the chips.
const STATUS = (() => {
  const STALL_MS = 5000;                                   // a connected venue with no message for this long is called silent
  const dur = ms => { const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : m ? m + ":" + String(s % 60).padStart(2, "0") : s + " s"; };
  // i = {connected, paused, online, venues:{bn:{on, ageMs, rate}, hl:{...}}, cr:{on, seq, fail, err, wake}, kept, folder}
  // folder (optional): the save folder as the app sees it, {state:"ok" | "none" | "denied" | "failed", err}; "none" = a browser that can save into a folder has none chosen, "denied" = it lost the browser's permission, "failed" = the last write failed
  // ageMs: ms since that venue's last message (null = none yet); rate: messages per second over the last few seconds.
  function chips(i) {
    const out = [], vs = Object.keys(i.venues || {});
    if (i.online === false) out.push({id:"net", text:"no network", tone:"bad", title:"The browser reports it is offline"});
    else if (i.connected) {
      if (i.paused) out.push({id:"data", text:"paused", tone:"warn", title:"Drawing is paused; the feeds keep running"});
      else {
        const silent = vs.filter(v => i.venues[v].on && (i.venues[v].ageMs == null || i.venues[v].ageMs > STALL_MS));
        const rate = vs.reduce((a, v) => a + (i.venues[v].on ? i.venues[v].rate || 0 : 0), 0);
        if (silent.length) out.push({id:"data", text:silent.map(v => v.toUpperCase() + " silent" + (i.venues[v].ageMs == null ? "" : " " + dur(i.venues[v].ageMs))).join(", "), tone:"bad", title:"No messages from this venue for over " + STALL_MS / 1000 + " s"});
        else out.push({id:"data", text:"streaming " + Math.round(rate) + "/s", tone:"ok", title:"Messages per second across the connected feeds"});
      }
    }
    if (i.cr && i.cr.on) {
      out.push({id:"cr", text:"REC run, chunk " + i.cr.seq, tone:"info", title:"Continuous recording: everything the Reader consumes is recorded in 30-minute chunks (Recordings)"});
      if (i.cr.wake === false) out.push({id:"wake", text:"screen may sleep", tone:"warn", title:"The screen wake lock is not held; a sleeping device ends the recording"});
    }
    if (i.cr && i.cr.fail > 0) out.push({id:"crfail", text:"chunk save failed", tone:"bad", title:"A chunk could not be saved (" + (i.cr.err || "unknown") + "). The run goes on; the next chunk says the previous one is missing. See the Health log."});
    const f = i.folder;
    if (f && i.cr && i.cr.on) {      // only while something is going to be saved: a lost folder means chunks stay in the browser's storage only (24 hours)
      if (f.state === "denied") out.push({id:"folder", text:"save folder needs OK", tone:"bad", title:"The browser took back write access to the save folder (usually after the page reloaded). Chunks are kept in this browser for 24 hours only until you press Allow (Recordings, Saved recordings)."});
      else if (f.state === "failed") out.push({id:"folder", text:"last save failed", tone:"bad", title:"The last write into the save folder failed (" + (f.err || "unknown error") + "); that chunk is only in this browser's storage."});
      else if (f.state === "none") out.push({id:"folder", text:"no save folder", tone:"info", title:"No save folder is chosen: chunks are kept only in this browser for 24 hours (Recordings, Saved recordings, Choose folder)."});
    }
    if (i.kept > 0) out.push({id:"kept", text:i.kept + " saved", tone:"info", title:"Recordings kept on this device (Recordings, Saved recordings)"});
    return out;
  }
  const num = v => { const m = /^v(\d+)$/.exec(String(v || "")); return m ? +m[1] : null; };
  // true when the published version is newer than the running one; a dev build (no number) never asks to update
  const newer = (current, latest) => { const c = num(current), l = num(latest); return c != null && l != null && l > c; };
  return {chips, newer, dur, STALL_MS};
})();
