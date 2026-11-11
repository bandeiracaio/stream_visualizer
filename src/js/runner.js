"use strict";
// Paper runner (Trader step 4, page side, thin): feeds the one-snapshot-a-second series from feeds.js (trSink) to RUNNER (runner-core.js), keeps the journal in its own IndexedDB database (sv-trader),
// and draws a read-only table in the Overview. Nothing here sends an order anywhere: the brokers, placeOrder, the Trading view and the hand-operated paper account (SIM) are not touched.
// Decisions come only from snapshots (made from input times), never from a timer here, so a hidden tab that delivers late gives the same rows. Runs while the page is connected and the asset is BTC.
const TRN = {on: store.get("trOn", true) !== false, runner: null, journal: [], loaded: false, db: null, lastT: 0, err: "", ev: null, evAt: 0, saved: 0};
const TR_CFG = {twins: 20, equity: 10000, feeBps: 5, riskCap: 0.02, seed: 1, gapMs: 30000};
const tr$ = id => document.getElementById(id);

// ----- storage: one object store, a journal row each
function trDb(){
  return new Promise((res, rej) => {
    try{
      const q = indexedDB.open("sv-trader", 1);
      q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains("rows")) q.result.createObjectStore("rows", {autoIncrement:true}); };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    }catch(e){ rej(e); }
  });
}
const trReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function trLoad(){
  try{
    TRN.db = await trDb();
    TRN.journal = await trReq(TRN.db.transaction("rows").objectStore("rows").getAll());
  }catch(e){ TRN.err = "journal storage unavailable, rows are kept in memory only"; TRN.db = null; console.error("trader", e); }
  TRN.loaded = true;
}
function trPersist(rows){
  if (!rows.length || !TRN.db) return;
  try{
    const tx = TRN.db.transaction("rows", "readwrite"), st = tx.objectStore("rows");
    for (const r of rows) st.add(r);
    tx.onerror = () => { TRN.err = "journal write failed"; };
    TRN.saved += rows.length;
  }catch(e){ TRN.err = "journal write failed"; console.error("trader", e); }
}

// ----- lifecycle
const trAsset = () => (typeof bnSym === "function" ? bnSym() : "").replace(/usdt$/, "").toUpperCase();
const trActive = () => TRN.on && TRN.loaded && connected && trAsset() === "BTC";
function trStart(){
  TRN.runner = RUNNER.create(Object.assign({systems: SYSTEMS_DEFAULT, journal: TRN.journal}, TR_CFG));
  trPersist(TRN.runner.fresh());      // positions that were open when the page closed
}
function trStop(){      // what is open cannot go on: it is closed as interrupted, the journal is kept and the next start begins again from it
  const r = TRN.runner; if (!r) return;
  trPersist(r.interrupt(TRN.lastT)); TRN.journal = r.rows(); TRN.runner = null; TRN.ev = null;
}
trSink = snaps => {
  if (!trActive()){ if (TRN.runner) trStop(); return; }
  for (const s of snaps){
    if (TRN.runner && TRN.lastT && s.t - TRN.lastT > TR_CFG.gapMs) trStop();      // a gap in the data: the rolling windows are stale, begin again
    if (!TRN.runner) trStart();
    trPersist(TRN.runner.step(s)); TRN.lastT = s.t;
  }
};
trLoad();

// ----- the table
const trEsc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function trStatus(){
  if (!TRN.loaded) return "loading the journal";
  if (!TRN.on) return "off (the run box is unticked)";
  if (!connected) return "not running: not connected";
  if (trAsset() !== "BTC") return "off: the runner trades BTC only (the asset is " + trAsset() + ")";
  if (!TRN.runner) return "waiting for the first second of data";
  const age = Math.max(0, Math.round((nowEx() - TRN.lastT) / 1000));
  return "running on paper, " + SYSTEMS_DEFAULT.length + " systems with " + TR_CFG.twins + " random-entry twins each, " + TR_CFG.feeBps + " bps fee a side · last snapshot " + age + " s ago";
}
function trRender(){
  const stat = tr$("trStat"), box = tr$("trOn"); if (!stat) return;
  box.checked = TRN.on;
  const rows = TRN.runner ? TRN.runner.rows() : TRN.journal, now = Date.now();
  if (!TRN.ev || now - TRN.evAt > 2000 || TRN.evRows !== rows.length){ TRN.ev = RUNNER.evaluate(rows); TRN.evAt = now; TRN.evRows = rows.length; }
  const st = TRN.runner ? TRN.runner.state() : [], byId = {}; for (const s of st) byId[s.id] = s;
  const f = (x, d) => x == null ? "–" : (x >= 0 ? "+" : "-") + Math.abs(x).toFixed(d), cls = x => x == null || x === 0 ? "" : x > 0 ? "up" : "dn";
  let interrupted = 0; for (const k in TRN.ev) interrupted += TRN.ev[k].interrupted;
  stat.textContent = trStatus() + (TRN.err ? " · " + TRN.err : "") + (interrupted ? " · " + interrupted + " position" + (interrupted > 1 ? "s" : "") + " interrupted by a reload or a gap (left out of the figures)" : "");
  tr$("trTable").innerHTML = `<table class="tt"><tr><th>system</th><th>position</th><th>trades</th><th>days</th><th>mean net bps</th><th>mean R</th><th>vs twins</th><th>last skip</th></tr>`
    + SYSTEMS_DEFAULT.map(d => {
      const id = SYSTEM.id(d), e = TRN.ev[id] || {trades:0, days:0, meanNetBps:null, meanR:null, twinPercentile:null, twinsWithEnough:0, lastSkip:null}, s = byId[id], o = s && s.open;
      const pos = o ? (o.exiting ? "closing" : (o.dir > 0 ? "long" : "short") + " @ " + fmt(o.px, 2) + " · " + Math.max(0, Math.round((nowEx() - o.tIn) / 1000)) + " s") : "flat";
      const vs = e.twinPercentile != null ? "p" + Math.round(e.twinPercentile) : "too few trades (" + e.trades + " of 20, " + e.twinsWithEnough + " of 15 twins)";
      const sk = e.lastSkip ? trEsc(e.lastSkip.reason) + " · " + Math.max(0, Math.round((nowEx() - e.lastSkip.t) / 1000)) + " s ago" : "–";
      return `<tr title="${trEsc(d.thesis.text)}"><td>${trEsc(d.name)}</td><td>${pos}</td><td>${e.trades}</td><td>${e.days}</td><td class="${cls(e.meanNetBps)}">${f(e.meanNetBps, 2)}</td><td class="${cls(e.meanR)}">${f(e.meanR, 3)}</td><td>${vs}</td><td>${sk}</td></tr>`;
    }).join("") + `</table>`;
}
HOOKS.on("renderOverview", trRender);

// ----- controls
tr$("trOn").onchange = () => { TRN.on = tr$("trOn").checked; store.set("trOn", TRN.on); if (!TRN.on) trStop(); trRender(); };
tr$("trExport").onclick = () => {
  const rows = TRN.runner ? TRN.runner.rows() : TRN.journal;
  const blob = new Blob([JSON.stringify({exported: new Date().toISOString(), config: TR_CFG, systems: SYSTEMS_DEFAULT.map(d => Object.assign({id: SYSTEM.id(d)}, d)), rows})], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trader-journal_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
tr$("trReset").onclick = async () => {
  if (!confirm("Delete the whole paper-systems journal (every trade, skip and twin trade) on this device? This cannot be undone.")) return;
  TRN.runner = null; TRN.journal = []; TRN.ev = null; TRN.saved = 0;
  try{ if (TRN.db) await trReq(TRN.db.transaction("rows", "readwrite").objectStore("rows").clear()); }catch(e){ TRN.err = "reset failed"; console.error("trader", e); }
  trRender();
};
