"use strict";
// Paper runner (Trader step 4, page side, thin): feeds the one-snapshot-a-second series from feeds.js (trSink) to RUNNER (runner-core.js), keeps the journal in its own IndexedDB database (sv-trader),
// and the stage log (step 7: one entry per move of a system between paper / demo / live, in the same database), and exposes what the Trader home (trader-view.js) draws. Nothing here sends an order anywhere: the brokers, placeOrder, the Trading view and the hand-operated paper account (SIM) are not touched.
// Decisions come only from snapshots (made from input times), never from a timer here, so a hidden tab that delivers late gives the same rows. Runs while the page is connected and the asset is BTC.
const TRN = {on: store.get("trOn", true) !== false, driver: null, journal: [], stageLog: [], mirror: [], faults: [], loaded: false, db: null, lastT: 0, err: "", ev: null, evAt: 0, saved: 0, ready: null};      // ev, evAt: unused since step 5 (the view keeps its own cache)
Object.defineProperty(TRN, "runner", {get: () => TRN.driver ? TRN.driver.runner() : null});      // the runner now running (the Trader home reads its state and risk), null between runs and after a gap until the next snapshot
const TR_DEF = Object.fromEntries(SYSTEMS_DEFAULT.map(d => [SYSTEM.id(d), d]));
const TR_CFG = {twins: 20, equity: 10000, feeBps: 5, riskCap: 0.02, seed: 1, gapMs: 30000};
const tr$ = id => document.getElementById(id);

// ----- storage: one object store of journal rows and one of stage-log entries (version 2 added the second)
function trDb(){
  return new Promise((res, rej) => {
    try{
      const q = indexedDB.open("sv-trader", 3);
      q.onupgradeneeded = () => { for (const n of ["rows", "stages", "mirror", "faults"]) if (!q.result.objectStoreNames.contains(n)) q.result.createObjectStore(n, {autoIncrement:true}); };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    }catch(e){ rej(e); }
  });
}
const trReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function trLoad(){
  try{
    TRN.db = await trDb();
    TRN.journal = await trReq(TRN.db.transaction("rows").objectStore("rows").getAll());
    TRN.stageLog = await trReq(TRN.db.transaction("stages").objectStore("stages").getAll());
    TRN.mirror = await trReq(TRN.db.transaction("mirror").objectStore("mirror").getAll());      // step 8: what the demo exchange did for each mirrored trade (exec.js)
    TRN.faults = await trReq(TRN.db.transaction("faults").objectStore("faults").getAll());     // step 8: the fault log, kept beside the stage log
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
  TRN.driver = TRN.on && TRN.loaded && sym === "BTC" ? RUNNER.driver(Object.assign({systems: SYSTEMS_DEFAULT, journal: TRN.journal, stages: PROMO.stages(TRN.stageLog)}, TR_CFG)) : null; TRN.lastT = 0;
  return !!TRN.driver;
}
function trEmit(rows){      // rows the runner wrote: to the journal's storage, to the page's list and to the chunk being recorded
  if (!rows.length) return;
  trPersist(rows); for (const r of rows) TRN.journal.push(r); PIPE.addRows(rows);
  for (const r of rows) if (r.k === "trade" && r.stage === "live" && !r.interrupted) trLossCheck(r.sys, r.t);
  if (typeof exeRows === "function") exeRows(rows);      // step 8: a demo-stage system's rows are mirrored onto the demo account (exec.js); it only reads them
}
function trStop(){      // what is open cannot go on: it is closed as interrupted, the journal is kept and the next run begins again from it
  if (!TRN.driver) return;
  trEmit(TRN.driver.stop(TRN.lastT)); TRN.driver = null; TRN.ev = null;
}
trSink = snaps => {
  if (!TRN.driver) return;
  for (const s of snaps){ trEmit(TRN.driver.step(s)); TRN.lastT = s.t; }
  if (TRN.driver){ const mv = TRN.driver.drain(); if (mv.length) PIPE.addMoves(mv); }      // the moves that took effect at these snapshots go into the chunk being recorded (a replay is handed them)
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
  const blob = new Blob([JSON.stringify({exported: new Date().toISOString(), config: TR_CFG, systems: SYSTEMS_DEFAULT.map(d => Object.assign({id: SYSTEM.id(d)}, d)), stageLog: TRN.stageLog, rows})], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trader-journal_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function trResetJournal(){
  if (!confirm("Delete the whole paper-systems journal (every trade, skip and twin trade) AND the stage log (every move between paper, demo and live, so every system goes back to its starting stage) AND the demo mirror rows on this device (the fault log is kept)? This cannot be undone.")) return false;
  // the fault log is NOT cleared below: step 9 needs a week without a fault, and a reset must not hide one
  PIPE.touch("journal reset"); TRN.driver = null; TRN.journal = []; TRN.stageLog = []; TRN.mirror = []; TRN.ev = null; TRN.saved = 0;
  try{ if (TRN.db){ const tx = TRN.db.transaction(["rows", "stages", "mirror"], "readwrite"); for (const n of ["rows", "stages", "mirror"]) tx.objectStore(n).clear(); await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } }catch(e){ TRN.err = "reset failed"; console.error("trader", e); }
  return true;
}

// ----- stages (step 7): the stage log and the moves. The rule is in promotion-core.js (PROMO); here a move is written to the log, stored, and handed to the running runner, which applies it at its next snapshot.
const trStage = id => PROMO.stageOf(TRN.stageLog, id, TR_DEF[id] ? TR_DEF[id].stage : "paper");      // the stage of a system now (the stage in systems-default.js is only the starting value)
function trAppendStage(e){      // one entry into the log, then to the runner; a replay is handed the move by the chunk (PIPE.addMoves, in trSink, once it has taken effect)
  TRN.stageLog.push(e);
  if (TRN.db){
    try{ const tx = TRN.db.transaction("stages", "readwrite"); tx.objectStore("stages").add(e); tx.onerror = () => { TRN.err = "stage log write failed"; }; }
    catch(err){ TRN.err = "stage log write failed"; console.error("trader", err); }
  }
  if (TRN.driver) TRN.driver.move({sys: e.sys, to: e.to});
}
// m: {sys, to, by: "user"|"auto", reason?, cap?}. Returns {ok, entry} or {ok: false, reason}; nothing is written when it is refused.
function trMove(m){
  const t = TRN.lastT || (typeof nowEx === "function" ? nowEx() : Date.now()), r = PROMO.apply(TRN.stageLog, Object.assign({t, start: TR_DEF[m.sys] ? TR_DEF[m.sys].stage : "paper"}, m), EXEC.merge(TRN.mirror.length ? TRN.journal.concat(TRN.mirror) : TRN.journal));      // demo trades filled on the exchange both ways read as demo trades (exec-core.js merge)
  if (!r.ok) return r;
  if (m.to === "demo" && m.by === "user" && typeof exeCheckRecent === "function" && !exeCheckRecent()) return {ok: false, reason: "a passed connection check on this device in the last 24 hours is needed first (Account panel, Binance demo, Run connection check)"};
  trAppendStage(r.entry); return r;
}
function trLossCheck(id, t){      // a live system that lost its limit in one UTC day goes back to paper by itself
  if (trStage(id) !== "live" || !TR_DEF[id]) return;
  const l = PROMO.lossLimit(TRN.journal, {id, riskFrac: TR_DEF[id].risk.riskFrac, equity0: TR_CFG.equity}, PROMO.capOf(TRN.stageLog, id), Math.floor((t || TRN.lastT || Date.now()) / PROMO.DAY));
  if (l.hit) trMove({sys: id, to: "paper", by: "auto", reason: "loss limit: $" + l.loss.toFixed(2) + " lost today, limit $" + l.limit.toFixed(2) + (l.which === "cap" ? " (its cap)" : " (3 times its risk per trade)")});
}
