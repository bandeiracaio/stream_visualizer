"use strict";
// Reader episode cards and their filters (display only). Loaded BEFORE app.js, which owns renderReader, the startup restore of the saved filters
// and the call to rdInit(); reader-tools.js and collectors.js read epFilter / epOpen / epLast / rdView / RD at run time.
// ---------- market reader: tab ----------
const rdFilter = {family:new Set(), venue:new Set(), min:0};
const epFilter = {family:new Set(), horizon:new Set(), minWallMs:0}, epOpen = new Set(), epLast = {};
const rdView = {engine:null};                      // a replayed engine while viewing a recorded session, else null (live)
const RD = () => rdView.engine || READER;
const rdEsc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
const rdMs = ms => ms >= 10000 ? (ms/1000).toFixed(0)+"s" : (ms/1000).toFixed(1)+"s";
function rdInit(){
  const chip = (kind,v) => `<button class="chip" data-kind="${kind}" data-v="${v}">${v}</button>`;
  $("rdChips").innerHTML = ["wall","book","absorption","exhaustion"].map(f=>chip("family",f)).join("") + ["bn","hl"].map(v=>chip("venue",v)).join("");
  $("rdChips").onclick = e => { const b=e.target.closest("button"); if(!b)return; const set=rdFilter[b.dataset.kind]; set.has(b.dataset.v)?set.delete(b.dataset.v):set.add(b.dataset.v); b.classList.toggle("on",set.has(b.dataset.v)); renderReader(); };
  $("epMinAge").onchange = () => { epFilter.minWallMs = +$("epMinAge").value; store.set("epMinAge", epFilter.minWallMs); renderReader(); };
  $("rdMin").oninput = () => { rdFilter.min=+$("rdMin").value; renderReader(); };
  $("rdSens").onchange = () => READER.setSensitivity(+$("rdSens").value);
  const ec = (kind,v) => `<button class="chip" data-kind="${kind}" data-v="${v}">${v}</button>`;
  $("epChips").innerHTML = Object.keys(READER_EPISODES.FAMILY_LABEL).map(f=>ec("family",f)).join("") + READER_EPISODES.DEFAULTS.horizons.map(h=>ec("horizon",h)).join("");
  $("epChips").onclick = e => { const b=e.target.closest("button"); if(!b)return; const set=epFilter[b.dataset.kind]; set.has(b.dataset.v)?set.delete(b.dataset.v):set.add(b.dataset.v); b.classList.toggle("on",set.has(b.dataset.v)); store.set("epf",{family:[...epFilter.family],horizon:[...epFilter.horizon]}); renderReader(); };
  $("epFamilies").innerHTML = Object.entries(READER_EPISODES.FAMILY_LABEL).map(([k,l])=>`<label><input type="checkbox" data-f="${k}" checked> ${l}</label>`).join("");
  $("epFamilies").onchange = e => { const f=e.target.dataset.f; if(f){ READER.setFamily(f,e.target.checked); store.set("epOff",[...$("epFamilies").querySelectorAll("input[data-f]")].filter(c=>!c.checked).map(c=>c.dataset.f)); } };
  for (const id of ["epActive","epDone"]) $(id).onclick = e => { const c=e.target.closest(".ep"); if(!c)return; const k=c.dataset.id; epOpen.has(k)?epOpen.delete(k):epOpen.add(k); epLast[id]=null; renderReader(); };
  $("rdDetectors").innerHTML = Object.keys(READER.cfg.detectors).map(k=>`<label><input type="checkbox" data-d="${k}" checked> ${k.replace(/_/g," ")}</label>`).join("");
  $("rdDetectors").onchange = e => { const d=e.target.dataset.d; if(d)READER.setDetector(d,e.target.checked); };
}
const epSide = x => x==="buy" ? "buyers" : "sellers";
function epWho(ep){
  if (ep.family==="wall") return `<span class="who">passive <i class="${ep.passive}">${epSide(ep.passive)}</i> (${ep.wall.side} wall)</span>`;
  return `<span class="who">aggressor <i class="${ep.aggressor}">${epSide(ep.aggressor)}</i>${ep.passive ? ` · passive <i class="${ep.passive}">${epSide(ep.passive)}</i>` : ""}</span>`;
}
function epEvidence(ep){
  return `<table class="evid">` + (ep.stage==="ended" && ep.peakEvidence ? ep.peakEvidence : ep.evidence).map(i=>`<tr class="${i.na?"na":i.ok?"ok":"no"}"><td><i class="tick"></i></td><td>${i.label}${i.gate?' <span class="gate" title="must hold for the episode to exist">required</span>':""}</td><td>${i.val}</td></tr>`).join("") + `</table>`;
}
const RES_TEXT = {"resolved-with":"price then went with the aggressor", "resolved-against":"price then went against the aggressor", flat:"price then stayed flat"};
function epResolution(ep){ return ep.resolution ? ` · ${RES_TEXT[ep.resolution]} (${ep.resolutionSigma>=0?"+":""}${ep.resolutionSigma.toFixed(1)}σ in ${Math.round(READER.cfg.ep.outcomeLookMs/1000)} s)` : ""; }
function epMembers(g){
  if (!g.members || g.members.length<2) return "";
  return `<div class="epmeta stat">seen as ${g.members.length} episodes:</div>` + g.members.map(m=>`<div class="epmeta stat">${m.venue.toUpperCase()} ${m.horizon} · ${m.stage} · began ${hhmmss(m.tStart).slice(0,8)}${m.stage==="ended" ? ` · lasted ${rdMs(m.tEnd-m.tStart)}` : ""} · peak ${Math.round(m.peak*100)}%</div>`).join("");
}
function epCard(ep, now, compact){
  const timing = ep.stage==="ended" ? `${hhmmss(ep.tStart).slice(0,8)} · lasted ${rdMs(ep.tEnd-ep.tStart)} · ${ep.outcome}${epResolution(ep)}`
    : `began ${rdMs(now-ep.tStart)} ago${ep.tDetected ? ` · detected ${rdMs(now-ep.tDetected)} ago` : " · not yet confirmed"}`;
  return `<div class="ep ${ep.stage}" data-id="${ep.id}"><div class="eph"><b>${READER_EPISODES.FAMILY_LABEL[ep.family]}</b> ${(ep.venues||[ep.venue]).map(v=>`<span class="venue v-${v}">${v.toUpperCase()}</span>`).join("")}${(ep.horizons||[ep.horizon]).map(h=>`<span class="chip">${h}</span>`).join("")} <span class="stg">${ep.stage}</span>${ep.pulses>1 ? ` <span class="chip">${ep.pulses} pulses</span>` : ""} ${epWho(ep)}</div>`
    + (compact ? "" : `<div class="epbar"><i style="width:${Math.round(ep.intensity*100)}%"></i></div>`)
    + `<div class="epread">${ep.stage==="ended" && ep.peakReading ? "At its peak: " + ep.peakReading : ep.reading}</div><div class="epmeta stat">${timing} · peak ${Math.round(ep.peak*100)}%</div>${epOpen.has(String(ep.id)) ? epEvidence(ep) + epMembers(ep) + (typeof epCtxBar==="function" ? epCtxBar(ep) : "") : ""}</div>`;
}
// Display only: a wall card is hidden until it has lasted minWallMs after detection (an ended one needs to have lasted that long). The Reader still detects and records every wall.
const epShortWall = (e, now) => e.family==="wall" && epFilter.minWallMs > 0 && e.tDetected != null && ((e.tEnd != null ? e.tEnd : now) - e.tDetected) < epFilter.minWallMs;
function renderEpisodes(s){
  const keep = e => !epShortWall(e, s.now) && (!epFilter.family.size || epFilter.family.has(e.family)) && (!epFilter.horizon.size || (e.horizons||[e.horizon]).some(h=>epFilter.horizon.has(h)) || e.horizon==="book");
  const groups = RD().episodeGroups();
  const live = groups.filter(g=>g.stage!=="ended").concat(RD().formingEpisodes()).filter(keep).sort((a,b)=>(a.stage==="forming")-(b.stage==="forming") || b.intensity-a.intensity);
  const done = groups.filter(g=>g.stage==="ended" && keep(g)).slice(-40).reverse();
  const put = (id, html) => { if (epLast[id] !== html){ epLast[id] = html; $(id).innerHTML = html; } };   // only touch the DOM when something changed, so taps are not lost
  put("epActive", live.length ? live.map(e=>epCard(e, s.now)).join("") : `<div class="note" style="margin:0">${!connected ? "Not connected." : !s.calibrated ? "Calibrating: episodes arm after about two minutes of data." : "No active episodes: nothing matches a pattern right now."}</div>`);
  put("epDone", done.length ? done.map(e=>epCard(e, s.now, true)).join("") : `<div class="note" style="margin:0">Finished episodes appear here.</div>`);
}
