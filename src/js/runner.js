"use strict";
// Paper runner (Trader step 4, page side, thin): feeds the one-snapshot-a-second series from feeds.js (trSink) to RUNNER (runner-core.js), keeps the journal in its own IndexedDB database (sv-trader),
// and exposes what the Trader home (trader-view.js) draws. Nothing here sends an order anywhere: the brokers, placeOrder, the Trading view and the hand-operated paper account (SIM) are not touched.
// Decisions come only from snapshots (made from input times), never from a timer here, so a hidden tab that delivers late gives the same rows. Runs while the page is connected and the asset is BTC.
const TRN = {on: store.get("trOn", true) !== false, runner: null, journal: [], loaded: false, db: null, lastT: 0, err: "", ev: null, evAt: 0, saved: 0};      // ev, evAt: unused since step 5 (the view keeps its own cache)
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

// ----- what the Trader home (trader-view.js) uses
const trRows = () => TRN.runner ? TRN.runner.rows() : TRN.journal;
function trSetOn(on){ TRN.on = !!on; store.set("trOn", TRN.on); if (!TRN.on) trStop(); }
function trExportJournal(){
  const rows = trRows();
  const blob = new Blob([JSON.stringify({exported: new Date().toISOString(), config: TR_CFG, systems: SYSTEMS_DEFAULT.map(d => Object.assign({id: SYSTEM.id(d)}, d)), rows})], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trader-journal_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function trResetJournal(){
  if (!confirm("Delete the whole paper-systems journal (every trade, skip and twin trade) on this device? This cannot be undone.")) return false;
  TRN.runner = null; TRN.journal = []; TRN.ev = null; TRN.saved = 0;
  try{ if (TRN.db) await trReq(TRN.db.transaction("rows", "readwrite").objectStore("rows").clear()); }catch(e){ TRN.err = "reset failed"; console.error("trader", e); }
  return true;
}
