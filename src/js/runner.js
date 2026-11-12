"use strict";
// Paper runner (Trader step 4, page side, thin): feeds the one-snapshot-a-second series from feeds.js (trSink) to RUNNER (runner-core.js), keeps the journal in its own IndexedDB database (sv-trader),
// and exposes what the Trader home (trader-view.js) draws. Nothing here sends an order anywhere: the brokers, placeOrder, the Trading view and the hand-operated paper account (SIM) are not touched.
// Decisions come only from snapshots (made from input times), never from a timer here, so a hidden tab that delivers late gives the same rows. Runs while the page is connected and the asset is BTC.
const TRN = {on: store.get("trOn", true) !== false, driver: null, journal: [], loaded: false, db: null, lastT: 0, err: "", ev: null, evAt: 0, saved: 0, ready: null};      // ev, evAt: unused since step 5 (the view keeps its own cache)
Object.defineProperty(TRN, "runner", {get: () => TRN.driver ? TRN.driver.runner() : null});      // the runner now running (the Trader home reads its state and risk), null between runs and after a gap until the next snapshot
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
// Step 6a: the runner belongs to a RUN (chunk-core.js, run-record.js): it begins when the engine is reset (connect, a change of asset) and stops when the next reset or the disconnect comes. Whether it runs is decided once, at the
// run's start (switch on, journal loaded, asset BTC), and written into the recording, so a replay begins the same way. The gap rule (over 30 s without a snapshot: stop and begin again) is in RUNNER.driver (runner-core.js).
const trAsset = () => (typeof bnSym === "function" ? bnSym() : "").replace(/usdt$/, "").toUpperCase();
function trBegin(sym){      // at the start of a run; returns whether a runner is running
  TRN.driver = TRN.on && TRN.loaded && sym === "BTC" ? RUNNER.driver(Object.assign({systems: SYSTEMS_DEFAULT, journal: TRN.journal}, TR_CFG)) : null; TRN.lastT = 0;
  return !!TRN.driver;
}
function trEmit(rows){      // rows the runner wrote: to the journal's storage, to the page's list and to the chunk being recorded
  if (!rows.length) return;
  trPersist(rows); for (const r of rows) TRN.journal.push(r); PIPE.addRows(rows);
}
function trStop(){      // what is open cannot go on: it is closed as interrupted, the journal is kept and the next run begins again from it
  if (!TRN.driver) return;
  trEmit(TRN.driver.stop(TRN.lastT)); TRN.driver = null; TRN.ev = null;
}
trSink = snaps => {
  if (!TRN.driver) return;
  for (const s of snaps){ trEmit(TRN.driver.step(s)); TRN.lastT = s.t; }
};
TRN.ready = trLoad();      // the journal is read before a run can begin (the page waits for this before it reconnects after a reload)

// ----- what the Trader home (trader-view.js) uses
const trRows = () => TRN.journal;
function trSetOn(on){
  TRN.on = !!on; store.set("trOn", TRN.on); PIPE.touch("runner switch");      // a switch inside a run is something a replay cannot follow: the chunk says so
  if (!TRN.on) trStop(); else if (connected && !TRN.driver) trBegin(trAsset());
}
function trExportJournal(){
  const rows = trRows();
  const blob = new Blob([JSON.stringify({exported: new Date().toISOString(), config: TR_CFG, systems: SYSTEMS_DEFAULT.map(d => Object.assign({id: SYSTEM.id(d)}, d)), rows})], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trader-journal_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function trResetJournal(){
  if (!confirm("Delete the whole paper-systems journal (every trade, skip and twin trade) on this device? This cannot be undone.")) return false;
  PIPE.touch("journal reset"); TRN.driver = null; TRN.journal = []; TRN.ev = null; TRN.saved = 0;
  try{ if (TRN.db) await trReq(TRN.db.transaction("rows", "readwrite").objectStore("rows").clear()); }catch(e){ TRN.err = "reset failed"; console.error("trader", e); }
  return true;
}
