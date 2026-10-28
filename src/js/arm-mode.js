"use strict";
// Arm mode (view, Now > Arm mode): one screen to leave open while the app collects. Top: what the app is doing right now and anything that needs attention;
// below: quality of the data coming in, the market now, the Reader, recordings made this session and the Health log. Read-only: it looks at state owned by
// other files once a second (only while the view is open) and never changes a feed, a recording or a detection; the one button is the header's Arm.
// Loaded last, after the files whose state it reads (typeof guards keep it harmless if one is missing).
const AM = {t0:Date.now(), box:{}};
const am$ = id => document.getElementById(id);
const amEsc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
const amDur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? Math.floor(s / 3600) + "h " + String(Math.floor(s % 3600 / 60)).padStart(2, "0") + "m" : s >= 60 ? Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s" : s + "s"; };
const amAge = ms => ms == null ? "never" : ms < 1500 ? "now" : amDur(ms) + " ago";
const amSize = n => n <= 0 ? "0 KB" : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB";
const amClock = t => new Date(t).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
const amShort = l => l.split(/[:(]/)[0].trim();      // "Derivatives context: funding, ..." -> "Derivatives context"
const amTry = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch { return dflt; } };
const amDot = tone => `<span class="am-dot am-${tone}"></span>`;
const amRow = (label, value, tone) => `<div class="am-kv"><span>${label}</span><b${tone ? ` class="am-t-${tone}"` : ""}>${value}</b></div>`;
const amSet = (id, html) => { const el = am$(id); if (el && el.innerHTML !== html) el.innerHTML = html; };

// ---- what is the app doing: one headline and a colour
function amHeadline(now) {
  if (!connected) return AR.on ? {text:"ARMED, WAITING FOR FEEDS", sub:"auto-record is on but the feeds are not connected", tone:"warn"} : {text:"NOT ARMED", sub:"press Arm to watch and record automatically", tone:"warn"};
  if (RT.rec) { const n = amTry(() => READER.recording().n, 0); return {text:"RECORDING", sub:`${amDur(now - RT.rec.t0)} so far · ${n.toLocaleString("en-US")} inputs${AR.on && AR.st ? " · started by auto-record" : ""}`, tone:"rec"}; }
  if (!AR.on) return {text:"CONNECTED, NOT ARMED", sub:"the feeds run, but nothing will record by itself: press Arm", tone:"warn"};
  const v = AR.v;
  if (!v || !v.ready) return {text:"ARMED, LEARNING", sub:`learning what a normal hour looks like: ${v ? Math.min(15, Math.round(v.nSlow / 60)) : 0} of 15 min`, tone:"info"};
  if (AR.st && AR.st.mode === "waiting" && AR.st.until > now) return {text:"ARMED, COOLING DOWN", sub:`recording ${AR.runs} finished · can start again in ${amDur(AR.st.until - now)}`, tone:"info"};
  return {text:"ARMED, WATCHING", sub:`waiting for a volatile stretch, a Reader episode or forced flow · lead-in ${amDur(AR.leadMs || 0)} of ${AR.cfg ? AR.cfg.preMin : "?"} min kept`, tone:"ok"};
}
// ---- things that need a person (empty = all well)
function amAlerts(now, snap) {
  const out = [];
  if (!connected) out.push(["bad", "Not connected: no data is coming in"]);
  else if (!AR.on && !RT.rec) out.push(["warn", "Not armed: nothing will be recorded automatically"]);
  if (document.hidden) out.push(["warn", "This tab is hidden: the browser slows its timers. Keep it visible (or its own window)"]);
  if (AR.on && !AR.lock) out.push(["warn", "The screen/wake lock is not held: the computer may sleep"]);
  if (!navigator.onLine) out.push(["bad", "The browser reports no internet connection"]);
  if (snap) for (const c of amTry(() => STATUS.chips(snap), [])) if ((c.tone === "bad" || c.tone === "warn") && !/^armed/.test(c.text)) out.push([c.tone, c.text.replace(/<[^>]+>/g, "") + (c.title ? " — " + c.title : "")]);
  if (AR.on && AR.drops && AR.drops.length) out.push(["warn", `The price stream dropped ${AR.drops.length}x, last at ${amClock(AR.drops[AR.drops.length - 1].at)}`]);
  if (typeof FS !== "undefined" && FS.supported) {
    if (!FS.dir) out.push(["info", "No save folder chosen: recordings are downloaded (Recordings, Saved, Choose folder)"]);
    else if (FS.perm !== "granted") out.push(["warn", `Save folder "${FS.name}" needs your OK again (Recordings, Saved, Allow): recordings are downloaded meanwhile`]);
    else if (FS.log.length && !FS.log[0].ok) out.push(["bad", `The last save into the folder failed (${FS.log[0].err}); it was downloaded instead`]);
  }
  const ago = amTry(() => HL.ev.filter(e => e.t > now - 600000 && e.k !== "load").length, 0);
  if (ago >= 3) out.push(["info", `${ago} Health log notes in the last 10 minutes`]);
  return out;
}
// ---- cards
function amQuality(now, snap) {
  let h = "";
  for (const v of ["bn", "hl"]) {
    const x = snap.venues[v], name = v === "bn" ? "Binance" : "Hyperliquid", st = am$(v + "State") ? am$(v + "State").textContent.trim() : "";
    const tone = !x.on ? "off" : x.ageMs == null ? "warn" : x.ageMs > 5000 ? "bad" : "ok";
    h += amRow(amDot(tone) + name, !x.on ? "off" : `${st} · last ${amAge(x.ageMs)} · ${Math.round(x.rate)} msg/s`, tone === "bad" ? "bad" : tone === "warn" ? "warn" : "");
  }
  const bk = amTry(() => READER.state().bookAgeMs, null);
  if (bk) h += amRow("Order books", `BN ${bk.bn == null ? "–" : amAge(bk.bn)} · HL ${bk.hl == null ? "–" : amAge(bk.hl)}`);
  const px = AR.on ? (AR.worker ? now - (AR.volAt || 0) : now - (AR.lastMsg || 0)) : null;
  h += amRow("Price stream", !AR.on ? "off (not armed)" : AR.v && AR.v.ready && px != null && px < 20000 ? `ok · ${AR.worker ? "worker" : "page"} · ${AR.drops.length} drop${AR.drops.length === 1 ? "" : "s"}` : AR.v && !AR.v.ready && AR.v.nSlow < AR.cfg.minSlow ? `learning (${Math.min(15, Math.round(AR.v.nSlow / 60))} of 15 min)` : "stalled", AR.on && AR.v && AR.v.nSlow >= AR.cfg.minSlow && !(AR.v.ready && px < 20000) ? "warn" : "");
  h += amRow("Tab", document.hidden ? "hidden (slowed)" : "visible", document.hidden ? "warn" : "");
  h += amRow("Wake lock", AR.on ? (AR.lock ? "held" : "lost") : "–", AR.on && !AR.lock ? "warn" : "");
  if (typeof COLLECT !== "undefined" && typeof CL !== "undefined") {
    const rows = COLLECT.REGISTRY.map(c => { const s = CL.stat[c.id], hh = COLLECT.health({on:colOn(c.id), why:colWhy(c.id), n:s ? s.n : 0, ageMs:s && s.last ? now - s.last : null, expectMs:COLLECT.EXPECT_MS[c.id] || 60000, sinceMs:now - CL.t0}); return {c, hh}; });
    const live = rows.filter(r => r.hh.tone === "ok").length, bad = rows.filter(r => r.hh.tone === "warn");
    h += `<div class="am-sub">Collectors: ${live} of ${rows.filter(r => r.hh.tone !== "off").length} active · ${CL.count.toLocaleString("en-US")} records on the tape</div>`;
    h += rows.map(r => `<div class="am-chip" title="${amEsc(r.c.label + " — " + r.hh.text)}">${amDot(r.hh.tone === "ok" ? "ok" : r.hh.tone === "warn" ? "bad" : r.hh.tone === "info" ? "info" : "off")}${amEsc(amShort(r.c.label))}</div>`).join("");
    if (bad.length) h += `<div class="note">Slow or silent: ${bad.map(r => amEsc(amShort(r.c.label))).join(", ")} (see Recordings, Collectors)</div>`;
  }
  return h;
}
function amMarket(now) {
  const px = amTry(ovMid, null), v = AR.on ? AR.v : null;
  let h = amRow("Price", px ? fmt(px, ovDec(px)) : "–");
  for (const [k, ms] of [["5m", 300000], ["15m", 900000]]) { const b = amTry(() => ovBase(ms), null); h += amRow("Change " + k, b && px ? ovSigned((px / b.px - 1) * 100, a => a.toFixed(2)) + "%" : "–", b && px ? (px > b.px ? "up" : px < b.px ? "dn" : "") : ""); }
  h += amRow("Volatility (sigma)", v && v.ready ? `${v.fast.toFixed(2)} bps · x${v.ratio.toFixed(2)} of the hour` : AR.on ? "learning" : "needs Arm", v && v.ready && v.ratio >= 1.5 ? "warn" : "");
  const st = amTry(() => colStateLive(), null);
  if (st) {
    const tone = st.s === "stressed" ? "bad" : st.s === "unsettled" || st.s === "crowded" ? "warn" : st.s === "calm" ? "ok" : "";
    h += amRow("Market state", st.s + (st.i ? ` (${st.i})` : ""), tone);
    h += `<div class="am-sub">${Object.entries(ST_IND).map(([k, t]) => `<span class="am-chip">${amDot(st.ind[k] === true ? "bad" : st.ind[k] === false ? "ok" : "off")}${t}: ${st.ind[k] === true ? "yes" : st.ind[k] === false ? "no" : "no reading"}</span>`).join("")}</div>`;
  } else h += amRow("Market state", "no collector data yet");
  const rs = amTry(() => READER.state(), null);
  if (rs) h += amRow("Activity", `${rs.regime} (x${rs.ratio.toFixed(2)} of its normal rate) · ${rs.eventsPerMin} events/min`);
  return h;
}
function amReader(now) {
  const rs = amTry(() => READER.state(), null); if (!rs) return `<div class="note">Reader not running.</div>`;
  let h = amRow("Calibration", rs.calibrated ? "done" : `${Math.round(rs.calibratingPct * 100)}% (needs about 2 minutes of data)`, rs.calibrated ? "ok" : "warn");
  const act = amTry(() => READER.activeEpisodes(), []), form = amTry(() => READER.formingEpisodes().length, 0), grp = amTry(() => READER.episodeGroups().length, 0);
  h += amRow("Episodes", `${act.length} active · ${form} forming · ${grp} groups since the page started`);
  h += act.length ? act.slice(0, 6).map(e => `<div class="am-ep"><b>${amEsc(e.family)}</b> ${amEsc(e.kind || "")} · ${amEsc(e.venue || "")} ${amEsc(e.horizon || "")}${e.aggressor ? " · aggressor " + amEsc(e.aggressor) : ""} · ${e.stage} · ${amAge(now - e.tDetected)}</div>`).join("") + (act.length > 6 ? `<div class="note">+${act.length - 6} more (Reader tab)</div>` : "") : `<div class="note">No active episode right now.</div>`;
  return h;
}
function amRecordings(now) {
  const rows = typeof RC !== "undefined" ? RC.rows.filter(r => r.at >= AM.t0) : [], all = typeof RC !== "undefined" ? RC.rows.length : 0;
  let h = amRow("Now recording", RT.rec ? `yes, ${amDur(now - RT.rec.t0)}` : "no", RT.rec ? "rec" : "");
  if (AR.on) h += amRow("Auto-record", `${AR.runs} finished this arming${AR.cfg ? " (up to " + AR.cfg.maxRuns + ")" : ""}`);
  h += amRow("Saved this session", `${rows.length} file${rows.length === 1 ? "" : "s"} · ${amSize(rows.reduce((a, r) => a + r.size, 0))}`, rows.length ? "ok" : "");
  h += amRow("Kept on this device", `${all} file${all === 1 ? "" : "s"} in total`);
  if (typeof FS !== "undefined" && FS.supported) h += amRow("Save folder", !FS.dir ? "none (downloads)" : FS.perm !== "granted" ? `"${amEsc(FS.name)}" needs OK` : `"${amEsc(FS.name)}" · ${FS.log.filter(r => r.ok).length} written`, FS.dir && FS.perm === "granted" ? "ok" : "warn");
  const inFolder = n => typeof FS !== "undefined" && FS.log.some(r => r.ok && r.name === n);
  h += rows.length ? rows.slice(0, 8).map(r => `<div class="am-ep"><b>${amClock(r.at)}</b> ${amEsc(r.name)} · ${amSize(r.size)}${inFolder(r.name) ? " · in folder" : ""}${r.quality ? ` · <span class="${r.quality.verdict === "complete" ? "" : "am-t-warn"}">${amEsc(amTry(() => SQ.line(r.quality), ""))}</span>` : ""}</div>`).join("") : `<div class="note">Nothing saved since this page opened.</div>`;
  return h;
}
function amHealth(now) {
  const ev = amTry(() => HL.ev.filter(e => e.k !== "load"), []), hr = ev.filter(e => e.t > now - 3600000).length;
  let h = amRow("Notes in the last hour", String(hr), hr >= 5 ? "warn" : "");
  h += ev.length ? ev.slice(-6).reverse().map(e => `<div class="am-ep"><b>${amClock(e.t)}</b> ${amEsc(amTry(() => hlText(e), e.k))}</div>`).join("") : `<div class="note">The Health log is empty.</div>`;
  return h;
}
function amRender() {
  if (tab !== "armmode") return;
  const now = Date.now(), snap = amTry(sbSnapshot, null), hd = amHeadline(now), al = amAlerts(now, snap);
  amSet("amHero", `<div class="am-hero am-h-${hd.tone}"><div><div class="am-big">${hd.text}</div><div class="am-subline">${amEsc(hd.sub)}</div></div>`
    + `<div class="am-side"><div class="am-clock">${new Date(now).toLocaleTimeString()}</div><div class="stat">page open ${amDur(now - AM.t0)}${AR.on ? " · armed " + amDur(now - AR.t0) : ""} · ${typeof APP_VERSION !== "undefined" ? APP_VERSION : ""}</div>`
    + `<button id="amArm">${AR.on ? "Disarm" : "Arm"}</button></div></div>`);
  amSet("amAlerts", al.length ? al.map(([t, m]) => `<div class="am-alert am-a-${t}">${amDot(t === "info" ? "info" : t)}${amEsc(m)}</div>`).join("") : `<div class="am-alert am-a-ok">${amDot("ok")}Everything looks fine: data is flowing, nothing needs attention.</div>`);
  if (snap) amSet("amQuality", amQuality(now, snap));
  amSet("amMarket", amTry(() => amMarket(now), ""));
  amSet("amReader", amTry(() => amReader(now), ""));
  amSet("amRecs", amTry(() => amRecordings(now), ""));
  amSet("amHealth", amTry(() => amHealth(now), ""));
}
document.addEventListener("click", e => { if (e.target && e.target.id === "amArm") { const b = am$("arHdr"); if (b) b.click(); } });
setInterval(amRender, 1000); amRender();
