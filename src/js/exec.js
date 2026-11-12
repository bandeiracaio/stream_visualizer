"use strict";
// Demo execution (Trader step 8, page side, thin). Runs EXEC (exec-core.js) against the connected Binance DEMO account: hands it the runner's rows (exeRows, called from trEmit), sends the requests it asks for through
// BROKER.binance (broker.js, the step 8 functions), hands the answers back, polls the position and open orders, keeps the mirror rows and the fault log (IndexedDB, runner.js) and the kill switch (this browser's storage).
// The decisions are in exec-core.js; nothing here decides a trade. It only runs when the connected account is the demo one (base URL checked here and again in the core) AND a connection check passed on this device in the last 24 hours.
// No key, secret or signature is read, stored or logged here: the keys stay in ACC (app.js) and only bnSigned touches them; errors carry Binance's code and message only.
const EXE = {m: null, filt: null, oneWay: null, oneWayAt: 0, quoteAt: 0, pollFails: 0, pollBusy: false, pollAt: 0, checking: false, err: "", starting: false, startAt: 0, openSaved: "", killed: store.get("exKill", false) === true, check: store.get("exCheck", null), lines: []};
const exe$ = id => document.getElementById(id);
const exeSleep = ms => new Promise(r => setTimeout(r, ms));
const exeDemo = () => ACC.mode === "demo" && EXEC.isDemoBase(ACC.base) && !!ACC.key;      // the demo host, or the local demo proxy the page verified at login (app.js loginBinance)
const exeCheckRecent = () => !!(EXE.check && EXE.check.ok && Date.now() - EXE.check.t < 86400000);
const exeEnabled = () => exeDemo() && exeCheckRecent();

// ----- errors: the exchange said no (a code) or nothing is known (timeout, dropped connection, server error)
const exeCode = e => { const m = /^Binance (-?\d+)/.exec(e && e.message || ""); return m ? +m[1] : null; };
function exeRes(e){
  const code = exeCode(e), text = String(e && e.message || e).slice(0, 200);
  if (code != null && code < 0 && code !== -1007 && code !== -1001) return {ok: false, code, err: text};
  return {ok: false, unknown: true, err: text};
}
const exeNotFound = e => { const c = exeCode(e); return c === -2013 || c === -2011 || /not exist|unknown order|no such/i.test(String(e && e.message || "")); };

// ----- the requests the core asks for -> BROKER.binance
async function exeFill(r){      // a market fill with what it really paid (the order response has no commission)
  let px = r.px, qty = r.qty, fee = null, est = false;
  if (qty > 0){
    for (let i = 0; i < 3 && fee == null; i++){ try{ const t = await BNB.tradesOf(r.id); if (t){ fee = t.fee; if (t.qty > 0){ px = t.px; qty = t.qty; } } }catch{} if (fee == null) await exeSleep(300); }
    if (fee == null){ fee = px * qty * 0.0005; est = true; }
  }
  return {px, qty, fee: fee || 0, feeEst: est, t: r.t || Date.now(), status: r.status};
}
async function exeRun(q){
  if (!exeDemo()) throw new Error("not the demo account");      // belt and braces: the core already refuses
  if (q.op === "market") return {ok: true, data: await exeFill(await BNB.marketCid({side: q.side, qtyStr: q.qtyStr, reduce: q.reduce, cid: q.cid}))};
  if (q.op === "stop"){ await BNB.stopAlgo({side: q.side, qtyStr: q.qtyStr, stopStr: q.stopStr, cid: q.cid}); return {ok: true, data: {}}; }
  if (q.op === "cancel"){ if (q.algo) await BNB.cancelAlgoCid(q.cid); else await BNB.cancelCid(q.cid); return {ok: true, data: {}}; }
  if (q.op === "lookup"){
    try{
      if (q.algo){ const r = await BNB.algoByCid(q.of), d = {found: true, status: r.status, px: r.px, qty: r.qty, t: r.t || Date.now(), fee: 0}; if (r.qty > 0 && r.orderId){ const f = await exeFill({id: r.orderId, px: r.px, qty: r.qty, t: r.t, status: r.status}); d.px = f.px; d.qty = f.qty; d.fee = f.fee; } return {ok: true, data: d}; }
      const r = await BNB.orderByCid(q.of); return {ok: true, data: Object.assign({found: true}, await exeFill(r))};
    }catch(e){ if (exeNotFound(e)) return {ok: true, data: {found: false}}; throw e; }
  }
  throw new Error("unknown request " + q.op);
}
function exeSend(q, m){
  let done = false;
  const deliver = res => { m.reply(q.id, res, Date.now()); if (EXE.m === m) exePump(); };
  const timer = setTimeout(() => { if (!done) deliver({ok: false, unknown: true, err: "no answer in 7 s"}); }, 7000);      // the real answer, if it comes later, is delivered too (the core knows how to take it)
  exeRun(q).then(d => { done = true; clearTimeout(timer); deliver(d); }, e => { done = true; clearTimeout(timer); deliver(exeRes(e)); });
}

// ----- rows, faults, what to keep across a reload
function exeStoreAdd(name, rows){
  if (!TRN.db) return;
  try{ const tx = TRN.db.transaction(name, "readwrite"), st = tx.objectStore(name); for (const r of rows) st.add(r); tx.onerror = () => { EXE.err = name + " write failed"; }; }
  catch(e){ EXE.err = name + " write failed"; console.error("exec", e); }
}
function exePump(){
  const m = EXE.m; if (!m) return;
  const d = m.drain();
  if (d.rows.length){ for (const r of d.rows) TRN.mirror.push(r); exeStoreAdd("mirror", d.rows); try{ PIPE.addExec(d.rows); }catch{} }
  if (d.faults.length){ for (const f of d.faults) TRN.faults.push(f); exeStoreAdd("faults", d.faults); for (const f of d.faults){ try{ hlNote("exec fault", {kind: f.kind, text: f.text}); }catch{} } }
  for (const q of d.reqs) exeSend(q, m);
  const o = m.snapshot().open, k = JSON.stringify(o); if (k !== EXE.openSaved){ EXE.openSaved = k; store.set("exOpen", o); }      // a reload must know a position of ours was open (ownership)
  if (d.rows.length || d.faults.length || d.reqs.length) exeRender();
}
function exeGuards(){
  const f = EXE.filt || {};
  return {quoteAgeMs: EXE.quoteAt ? performance.now() - EXE.quoteAt : null, offsetMs: clockOk ? clockOffset : null, oneWay: EXE.oneWay, readOk: EXE.pollFails < 3 && !EXE.checking, step: f.step, tick: f.tick, minQty: f.minQty, minNotional: f.minNotional};
}
function exeRows(rows){      // from trEmit: every row the runner wrote
  const m = EXE.m; if (!m) return;
  const g = exeGuards(), now = Date.now();
  for (const r of rows) if (r.k === "enter" || r.k === "exit" || r.k === "invalidate" || r.k === "trade") m.onRow(r, now, g);
  exePump();
}
{ const prev = trSink; trSink = snaps => { if (prev) prev(snaps); for (const s of snaps) if (s.age && s.age.bn != null) EXE.quoteAt = performance.now() - s.age.bn; }; }      // the Binance quote's age, for the entry guard

// ----- the exchange now: at start (reconcile) and every few seconds (poll)
async function exeRead(){
  const [net, orders] = await Promise.all([BNB.netPosition(), BNB.openAll()]);
  return {t: Date.now(), positions: Math.abs(net) > 1e-12 ? [net] : [], orders};
}
async function exeStart(m){
  EXE.starting = true; EXE.startAt = Date.now();
  try{
    EXE.filt = await loadFilters(); EXE.oneWay = await BNB.oneWay(); EXE.oneWayAt = Date.now();
    const x = await exeRead(), open = store.get("exOpen", null);
    if (EXE.m !== m) return;
    m.start(x, Date.now(), {savedOpen: !!open, savedSys: open && open.sys}); EXE.pollFails = 0; EXE.err = ""; exePump();
  }catch(e){ EXE.err = "cannot read the exchange: " + String(e.message).slice(0, 120); }
  finally{ EXE.starting = false; }
}
async function exePoll(){
  const m = EXE.m; if (!m || EXE.checking || EXE.pollBusy || !m.state().phase) return;
  EXE.pollBusy = true;
  try{
    if (Date.now() - EXE.oneWayAt > 60000){ EXE.oneWay = await BNB.oneWay(); EXE.oneWayAt = Date.now(); }
    const x = await exeRead(); if (EXE.m !== m) return;
    EXE.pollFails = 0; EXE.err = ""; m.poll(x, Date.now()); exePump();
  }catch(e){ EXE.pollFails++; EXE.err = "cannot read the exchange: " + String(e.message).slice(0, 120); }
  finally{ EXE.pollBusy = false; EXE.pollAt = Date.now(); }
}
// the lifecycle: one machine per demo connection, dropped on logout or when the check goes stale
function exeLife(){
  const on = exeEnabled() && TRN.loaded;
  if (!on){ if (EXE.m){ EXE.m = null; EXE.openSaved = ""; } return; }
  if (!EXE.m){ EXE.m = EXEC.create({base: ACC.base, saved: {killed: EXE.killed, faults: []}}); EXE.err = ""; }
  const m = EXE.m, s = m.state();
  if (s.state === "off" && s.why === "not started" && !EXE.starting && Date.now() - EXE.startAt > 5000) exeStart(m);
  else if (s.state !== "off"){ const holding = !!s.pos; if (Date.now() - EXE.pollAt > (holding ? 3000 : 10000)) exePoll(); }
  m.tick(Date.now()); exePump();
}
setInterval(exeLife, 500);
HOOKS.on("logout", () => { EXE.m = null; EXE.openSaved = ""; exeRender(); });      // the keys are gone: what was open is closed by the next connection (exOpen says it was ours)

// ----- the kill switch
function exeKill(){ EXE.killed = true; store.set("exKill", true); if (EXE.m){ EXE.m.kill(Date.now()); exePump(); } exeRender(); }
function exeUnkill(){ EXE.killed = false; store.set("exKill", false); if (EXE.m){ EXE.m.unkill(); } exeRender(); }
exe$("exKill").onclick = () => {
  if (!EXE.killed) return exeKill();      // no confirmation to turn it on
  if (confirm("Turn the kill switch off? Demo execution can open new positions again.")) exeUnkill();
};
exe$("exFaultClear").onclick = () => { if (EXE.m && confirm("Clear the fault and allow new entries? The fault stays in the fault log.")){ EXE.m.clearFault(); exeRender(); } };

// ----- what the screen shows
const exeAnyDemo = () => SYSTEMS_DEFAULT.some(d => { const s = trStage(SYSTEM.id(d)); return s === "demo" || s === "live"; });
function exeStateText(){
  if (!exeDemo()) return {state: "off", why: "no Binance demo account connected"};
  if (!exeCheckRecent()) return {state: "off", why: "run the connection check first (Account panel)"};
  if (!EXE.m) return {state: "off", why: "starting"};
  const s = EXE.m.state(); if (s.state === "off" && EXE.err) return {state: "off", why: EXE.err};
  return {state: s.state, why: s.state === "holding" ? "holding a position" : s.why};
}
function exeWhy(){      // "" when a demo system's trades are being mirrored; else why they fill on paper only (the Trader home badge)
  const s = exeStateText(); if (s.state === "ready" || s.state === "holding") return EXE.pollFails >= 3 ? "cannot read the exchange" : "";
  return s.state === "off" ? s.why : s.state === "killed" ? "kill switch" : s.state === "fault" ? "fault" : "blocked";
}
function exeStatus(){      // the line for the Trader home
  const s = exeStateText(), nf = TRN.faults.length;
  return "Execution: " + s.state + (s.why && s.state !== "holding" && s.state !== "ready" ? " (" + s.why + ")" : s.state === "holding" ? " (holding a position)" : "") + (EXE.pollFails >= 3 ? ", cannot read the exchange" : "") + " · faults " + nf + (nf ? " (last: " + TRN.faults[nf - 1].kind + ")" : "") + ".";
}
function exeRender(){
  const s = EXE.m ? EXE.m.state() : null, show = exeAnyDemo() || !!(s && s.pos) || EXE.killed, b = exe$("exKill");
  b.hidden = !show; b.setAttribute("aria-pressed", String(EXE.killed)); b.textContent = EXE.killed ? "Kill switch ON" : "Kill switch";
  b.title = EXE.killed ? "Execution is blocked. Press to turn it off (asks to confirm)." : "Block all demo execution, cancel the page's own orders and close its own position at market.";
  const fc = exe$("exFaultClear"); fc.hidden = !(s && s.state === "fault");
  exe$("exCheckOut").innerHTML = (EXE.lines.length ? EXE.lines : (EXE.check ? EXE.check.lines : [])).map(l => `<div class="exl ${l.ok ? "ok" : "no"}"><span aria-hidden="true">${l.ok ? "✓" : "✗"}</span> ${String(l.name).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]))}${l.text ? ": " + String(l.text).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c])) : ""}<span class="sr"> (${l.ok ? "passed" : "failed"})</span></div>`).join("")
    + (EXE.check && !EXE.checking ? `<div class="note" style="margin-top:4px">Last check ${EXE.check.ok ? "passed" : "FAILED"} at ${new Date(EXE.check.t).toLocaleString()}${EXE.check.ok && !exeCheckRecent() ? " (older than 24 hours: run it again)" : ""}.</div>` : "");
}
setInterval(exeRender, 1000);

// ----- the connection check: a fixed script on the demo account, each line pass or fail, stored with its time
async function exeRunCheck(){
  const out = exe$("exCheckMsg"), lines = []; EXE.lines = lines;
  const line = (name, ok, text) => { lines.push({name, ok: !!ok, text: text || ""}); exeRender(); return !!ok; };
  if (!exeDemo()) return line("Binance demo account connected", false, "connect the demo account first (keys are typed into this page only)");
  if (EXE.m && EXE.m.state().pos) return line("page holds no position", false, "a mirrored position is open");
  EXE.checking = true; exeRender();
  const id = Date.now().toString(36), cid = r => "svx_chk" + id + "_" + r;
  let held = 0, f = null, px = 0, stopCid = null, allOk = true;
  const step = async (name, fn) => { if (!allOk) return; try{ const t = await fn(); if (!line(name, t !== false && !(t && t.fail), t && typeof t === "string" ? t : t && t.fail ? t.fail : "")) allOk = false; }catch(e){ line(name, false, String(e.message).slice(0, 160)); allOk = false; } };
  try{
    await step("read balance, position and position mode", async () => {
      f = await loadFilters(); const sn = await BNB.snapshot(), net = await BNB.netPosition(), one = await BNB.oneWay(), ords = await BNB.openAll();
      if (!one) return {fail: "hedge mode is on; the page needs one-way mode"};
      if (Math.abs(net) > 1e-12 || ords.length) return {fail: "the account is not flat (" + net + " position, " + ords.length + " open orders); close them first"};
      const r = await fetch(ACC.base + "/fapi/v1/ticker/price?symbol=" + accSym()); px = +(await r.json()).price; if (!(px > 0)) return {fail: "no price"};
      return `wallet ${fmt(sn.balance.wallet, 2)} USDT, flat, one-way mode, price ${px}`;
    });
    let qty = 0, qs = "";
    await step("a minimum-size market buy fills", async () => {
      qty = Math.max(f.minQty, Math.ceil(Math.max(f.minNotional || 5, 5) * 1.5 / px / f.step) * f.step); qs = qty.toFixed(decOf(f.step));
      const r = await exeFill(await BNB.marketCid({side: "BUY", qtyStr: qs, reduce: false, cid: cid("e")})); held = r.qty;
      return r.qty > 0 ? `bought ${r.qty} at ${r.px}, fee ${r.fee.toFixed(4)}${r.feeEst ? " (estimated)" : ""}` : {fail: "not filled"};
    });
    await step("a reduce-only stop is placed and seen in the open orders", async () => {
      stopCid = cid("s"); const sp = Math.round(px * 0.9 / f.tick) * f.tick;
      await BNB.stopAlgo({side: "SELL", qtyStr: qs, stopStr: sp.toFixed(decOf(f.tick)), cid: stopCid}); await exeSleep(500);
      const o = await BNB.openAll(); return o.some(x => x.cid === stopCid && x.algo) ? "seen as an algo order at " + sp.toFixed(decOf(f.tick)) : {fail: "not in the open orders list (check the algo open-orders path)"};
    });
    await step("the stop is cancelled and gone", async () => { await BNB.cancelAlgoCid(stopCid); await exeSleep(500); const o = await BNB.openAll(); return o.some(x => x.cid === stopCid) ? {fail: "still listed"} : "gone"; });
    await step("a stop with a price that must be rejected is rejected (and the rejection is seen)", async () => {
      const bad = Math.round(px * 1.1 / f.tick) * f.tick, c2 = cid("b"); let rej = null;
      try{ await BNB.stopAlgo({side: "SELL", qtyStr: qs, stopStr: bad.toFixed(decOf(f.tick)), cid: c2}); }catch(e){ rej = e; }
      if (!rej){ try{ await BNB.cancelAlgoCid(c2); }catch{} return {fail: "it was ACCEPTED: the rejection path cannot be trusted"}; }
      const r = exeRes(rej); return r.ok === false && !r.unknown ? "rejected: " + r.err : {fail: "no clear answer: " + r.err};
    });
  }catch(e){ line("check", false, String(e.message).slice(0, 160)); allOk = false; }
  // whatever happened above, the account is brought back flat before the last lines
  try{
    if (held > 0 || !allOk){
      try{ const net = await BNB.netPosition(); if (Math.abs(net) > 1e-12){ const ds = (Math.abs(net)).toFixed(decOf(f ? f.step : 0.001)); await exeFill(await BNB.marketCid({side: net > 0 ? "SELL" : "BUY", qtyStr: ds, reduce: true, cid: cid("x")})); line("the position is closed with a reduce-only market order", true, "closed " + net); } }catch(e){ line("the position is closed with a reduce-only market order", false, String(e.message).slice(0, 160)); allOk = false; }
      try{ if (stopCid) await BNB.cancelAlgoCid(stopCid); }catch{}
    }
    await exeSleep(600);
    const net = await BNB.netPosition(), o = await BNB.openAll(), own = o.filter(x => x.cid && x.cid.startsWith("svx_"));
    if (!line("the account is flat with no open order of the page's at the end", Math.abs(net) < 1e-12 && !own.length, Math.abs(net) < 1e-12 && !own.length ? "" : net + " position, " + own.length + " open orders")) allOk = false;
  }catch(e){ line("the account is flat at the end", false, String(e.message).slice(0, 160)); allOk = false; }
  EXE.checking = false;
  EXE.check = {t: Date.now(), ok: allOk, lines: lines.slice()}; store.set("exCheck", EXE.check); EXE.lines = [];
  out.textContent = allOk ? "Connection check passed." : "Connection check FAILED: see the lines."; out.className = "acc-msg " + (allOk ? "ok" : "err");
  exeRender();
}
exe$("exCheckGo").onclick = () => { if (EXE.checking) return; exe$("exCheckMsg").textContent = "Running…"; exeRunCheck(); };
exeRender();
