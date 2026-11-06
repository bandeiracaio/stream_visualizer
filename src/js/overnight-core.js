"use strict";
// Overnight run (pure, no DOM, no timers, no storage, no clock: the caller passes now): the "Ready to arm?" checklist and the "Last night" summary of Arm mode.
// preflight turns a plain description of the environment into checklist items; morning turns the saved recordings and Health log notes of a time window into a summary.
// Display only: nothing here changes a feed, a recording or a detection. Spec: .scratch/overnight/spec.md.
const OVERNIGHT = (() => {
  const HOUR = 3600000, PROBLEM_NOTE = /^(gap|silent|page frozen|wake lock lost|learning started over|auto-record not ready|price-stream drop|tab hidden|page error|promise error)/;
  // env: {online, newer (latest version string or null), connected, armed, hidden, wakeLockApi,
  //       folder:{supported, state:"ok"|"none"|"denied"|"failed", name}|null, disk:{tone,text}|null, persisted:true|false|null,
  //       battery:{charging, level 0..1}|null, collectors:{expected, active, slow:[label]}|null}
  // items: {id, tone:"ok"|"warn"|"bad"|"info", text, fix}; fix is what to do, empty when ok.
  function preflight(env) {
    const it = [], add = (id, tone, text, fix) => it.push({id, tone, text, fix:fix || ""});
    add("online", env.online === false ? "bad" : "ok", env.online === false ? "No internet connection" : "Online", env.online === false ? "Connect the computer or phone to the network." : "");
    add("version", env.newer ? "warn" : "ok", env.newer ? `A newer version (${env.newer}) is available` : "Latest version", env.newer ? "Reload the page (the bar at the top does it) before arming." : "");
    const f = env.folder;
    if (f && f.supported) {
      if (f.state === "ok") add("folder", "ok", `Save folder "${f.name || ""}" is allowed`);
      else if (f.state === "none") add("folder", "warn", "No save folder chosen: recordings are downloaded, and a phone may block that when nobody is looking", "Recordings, Saved, Choose folder.");
      else if (f.state === "denied") add("folder", "bad", `Save folder "${f.name || ""}" needs your OK again`, "Recordings, Saved, Allow (the browser takes the permission back after a reload).");
      else add("folder", "bad", "The last save into the folder failed", "Check that the folder still exists and has room, then choose it again.");
    }
    const d = env.disk;
    if (d) add("disk", d.tone === "bad" || d.tone === "warn" ? d.tone : "ok", "Disk space: " + d.text, d.tone === "bad" || d.tone === "warn" ? "Free some room or move the save folder: collecting stops when the drive is full." : "");
    if (env.persisted === false) add("persist", "warn", "Saved recordings may be deleted by the browser when storage runs low", "Keep a save folder, or install the page as an app / bookmark it so the browser grants persistent storage.");
    else if (env.persisted === true) add("persist", "ok", "Storage is persistent");
    const b = env.battery;
    if (b) {
      const pc = Math.round(b.level * 100);
      if (b.charging) add("power", "ok", `Charging (${pc}%)`);
      else add("power", pc < 50 ? "bad" : "warn", `On battery (${pc}%)`, "Plug it in and set the device not to sleep; a night on battery will not last.");
    }
    add("wake", env.wakeLockApi ? "ok" : "warn", env.wakeLockApi ? "Screen wake lock is available" : "This browser has no screen wake lock", env.wakeLockApi ? "" : "Turn the screen timeout off in the device settings, and set the computer not to sleep.");
    add("tab", env.hidden ? "warn" : "ok", env.hidden ? "This tab is hidden" : "Tab is visible", env.hidden ? "Keep it in front, or in its own window: a hidden tab has its timers slowed and can be frozen." : "");
    const c = env.collectors;
    if (c) add("collectors", c.slow && c.slow.length ? "warn" : c.expected && !c.active ? "warn" : "ok",
      c.slow && c.slow.length ? `Collectors slow or silent: ${c.slow.join(", ")}` : `${c.active} of ${c.expected} collectors active`,
      c.slow && c.slow.length ? "Recordings, Collectors shows each one's last record." : c.expected && !c.active ? "Switch them on in Recordings, Collectors." : "");
    if (env.armed) add("armed", "ok", "Armed");
    else if (env.connected) add("armed", "warn", "Feeds are connected, and arming needs them disconnected", "Press Disconnect, then Arm.");
    else add("armed", "info", "Not armed yet", "Press Arm when the rest is ready (it needs 15 minutes to learn a normal hour).");
    const bad = it.filter(x => x.tone === "bad").length, warn = it.filter(x => x.tone === "warn").length;
    return {items:it, bad, warn, ready:!bad && !warn, text:!bad && !warn ? "Ready" : (bad + warn) + " to check"};
  }

  // rows: saved recordings [{name, at, size, quality}] (quality as written by session-quality.js, may be null); notes: Health log events [{t, k}];
  // opts: {hours}; sq: {clean(q), line(q), colProblems(q)} (SQ in the page).
  function morning(rows, notes, now, opts, sq) {
    const hours = opts && opts.hours > 0 ? opts.hours : 24, from = now - hours * HOUR;
    const recs = rows.filter(r => r.at >= from && r.at <= now).sort((a, b) => a.at - b.at).map(r => {
      const q = r.quality, v = q && q.verdict;
      const tone = !q ? "info" : v === "hollow" || v === "empty" ? "bad" : sq.clean(q) ? "ok" : "warn";
      return {name:r.name, at:r.at, size:r.size || 0, tone, line:q ? sq.line(q) : "no quality information", problems:q ? sq.colProblems(q).map(p => p.id) : []};
    });
    const byCol = {}; for (const r of recs) for (const id of r.problems) byCol[id] = (byCol[id] || 0) + 1;
    const counts = {}; for (const e of notes || []) if (e.t >= from && e.t <= now && PROBLEM_NOTE.test(e.k)) counts[e.k] = (counts[e.k] || 0) + 1;
    const tones = {ok:0, warn:0, bad:0, info:0}; for (const r of recs) tones[r.tone]++;
    return {hours, n:recs.length, bytes:recs.reduce((a, r) => a + r.size, 0), recs, tones, collectorProblems:Object.keys(byCol).sort((a, b) => byCol[b] - byCol[a]).map(id => ({id, recordings:byCol[id]})),
      notes:Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(k => ({k, n:counts[k]}))};
  }

  function selftest() {
    const out = [], ok = (name, pass) => out.push({name:"overnight: " + name, ok:!!pass, detail:""});
    const good = {online:true, newer:null, connected:false, armed:false, hidden:false, wakeLockApi:true, folder:{supported:true, state:"ok", name:"sessions"}, disk:{tone:"ok", text:"40 GB free"}, persisted:true, battery:{charging:true, level:.8}, collectors:{expected:6, active:6, slow:[]}};
    const p = preflight(good), tone = (env, id) => preflight(Object.assign({}, good, env)).items.find(x => x.id === id);
    ok("everything fine: ready, only 'not armed yet' is informational", p.ready && p.text === "Ready" && p.items.find(x => x.id === "armed").tone === "info" && p.bad === 0 && p.warn === 0);
    ok("offline is bad, with a fix", tone({online:false}, "online").tone === "bad" && tone({online:false}, "online").fix !== "");
    ok("a newer version is a warning that names it", tone({newer:"v200"}, "version").tone === "warn" && /v200/.test(tone({newer:"v200"}, "version").text));
    ok("save folder: none warns, denied and failed are bad, an unsupported browser has no item", tone({folder:{supported:true, state:"none"}}, "folder").tone === "warn" && tone({folder:{supported:true, state:"denied", name:"x"}}, "folder").tone === "bad" && tone({folder:{supported:true, state:"failed"}}, "folder").tone === "bad" && preflight(Object.assign({}, good, {folder:{supported:false}})).items.every(x => x.id !== "folder") && preflight(Object.assign({}, good, {folder:null})).items.every(x => x.id !== "folder"));
    ok("low disk space is passed on; ok disk is ok", tone({disk:{tone:"bad", text:"1 GB"}}, "disk").tone === "bad" && tone({disk:{tone:"warn", text:"4 GB"}}, "disk").tone === "warn" && tone({}, "disk").tone === "ok");
    ok("storage that may be evicted warns; unknown is not shown", tone({persisted:false}, "persist").tone === "warn" && preflight(Object.assign({}, good, {persisted:null})).items.every(x => x.id !== "persist"));
    ok("power: charging ok; on battery warns, under 50% is bad; unknown is not shown", tone({}, "power").tone === "ok" && tone({battery:{charging:false, level:.8}}, "power").tone === "warn" && tone({battery:{charging:false, level:.3}}, "power").tone === "bad" && preflight(Object.assign({}, good, {battery:null})).items.every(x => x.id !== "power"));
    ok("hidden tab and missing wake lock warn", tone({hidden:true}, "tab").tone === "warn" && tone({wakeLockApi:false}, "wake").tone === "warn");
    ok("collectors: slow ones are named; none active when some are expected warns", /Binance/.test(tone({collectors:{expected:6, active:5, slow:["Binance book"]}}, "collectors").text) && tone({collectors:{expected:6, active:0, slow:[]}}, "collectors").tone === "warn");
    ok("connected and not armed: warns that arming needs a disconnect; armed is ok", tone({connected:true}, "armed").tone === "warn" && /Disconnect/.test(tone({connected:true}, "armed").fix) && tone({armed:true, connected:true}, "armed").tone === "ok");
    ok("one bad item makes it not ready and is counted", (() => { const r = preflight(Object.assign({}, good, {online:false, hidden:true})); return !r.ready && r.bad === 1 && r.warn === 1 && r.text === "2 to check"; })());
    const sq = {clean:q => q.verdict === "complete" && !(q.collectors && q.collectors.length), line:q => q.verdict + " line", colProblems:q => q.collectors || []};
    const H = HOUR, now = 100 * H, rows = [
      {name:"a", at:now - 2 * H, size:1000, quality:{verdict:"complete"}}, {name:"b", at:now - 5 * H, size:2000, quality:{verdict:"holes", collectors:[{id:"derivs"}]}},
      {name:"c", at:now - 30 * H, size:4000, quality:{verdict:"complete"}}, {name:"d", at:now - 1 * H, size:500, quality:{verdict:"hollow"}}, {name:"e", at:now - 3 * H, size:700, quality:null},
      {name:"f", at:now - 4 * H, size:100, quality:{verdict:"complete", collectors:[{id:"derivs"}, {id:"options"}]}}];
    const notes = [{t:now - H, k:"gap"}, {t:now - 2 * H, k:"gap"}, {t:now - 3 * H, k:"page frozen by the browser"}, {t:now - 4 * H, k:"load"}, {t:now - 40 * H, k:"gap"}, {t:now - H, k:"tab visible"}];
    const m = morning(rows, notes, now, {hours:24}, sq);
    ok("morning: only recordings inside the window, oldest first", m.n === 5 && m.recs[0].name === "b" && m.recs[m.n - 1].name === "d" && m.recs.every((r, i) => !i || r.at >= m.recs[i - 1].at));
    ok("morning: size is summed over the window", m.bytes === 1000 + 2000 + 500 + 700 + 100);
    ok("morning: tones: complete = ok, collector problems = warn, hollow = bad, no quality = info", m.tones.ok === 1 && m.tones.warn === 2 && m.tones.bad === 1 && m.tones.info === 1);
    ok("morning: collectors with problems are counted per recording, most first", m.collectorProblems[0].id === "derivs" && m.collectorProblems[0].recordings === 2 && m.collectorProblems[1].id === "options");
    ok("morning: only problem notes inside the window are counted", m.notes.length === 2 && m.notes[0].k === "gap" && m.notes[0].n === 2 && m.notes[1].k === "page frozen by the browser");
    ok("morning: a missing quality says so, a longer window takes in more", m.recs.find(r => r.name === "e").line === "no quality information" && morning(rows, notes, now, {hours:48}, sq).n === 6);
    return out;
  }
  return {preflight, morning, selftest, PROBLEM_NOTE};
})();
