"use strict";
// Trading view: the module catalog / layout (add, remove, bring back), the order ticket and the Trading panels. Display only; orders go through
// placeOrder / cancelOrder / cancelAll in app.js. Loaded BEFORE app.js (whose startup restores the layout), so nothing here may run at load that needs
// an app.js name: the two listeners are wired by tradingInit(), which app.js calls where they used to be.
// ---------- trading tab: modular workspace ----------
const TMODS = [["t-ticket","Order ticket"],["t-pos","Positions"],["t-orders","Open orders"],["t-bal","Balance"],["t-fills","Recent fills"]];
let TAB_LABEL = null;       // built from TABS (app.js) on first use, since this file loads first
let tkSide = "BUY";
function buildModCatalog(){
  const sel = $("addMod"); sel.innerHTML = '<option value="">+ add module…</option>';
  const g1 = document.createElement("optgroup"); g1.label = "Trading";
  for (const [id, nm] of TMODS){ const o = document.createElement("option"); o.value = id; o.textContent = nm; o.disabled = !!$(id+"-mod"); g1.appendChild(o); }
  sel.appendChild(g1);
  const groups = {};
  document.querySelectorAll("main section[data-mid]").forEach(sec=>{
    const home = sec.dataset.home || sec.dataset.tab, o = document.createElement("option");
    o.value = sec.dataset.mid; o.textContent = sec.dataset.title; o.disabled = !!sec.dataset.home;
    (groups[home] ||= document.createElement("optgroup")).appendChild(o);
  });
  for (const [k, g] of Object.entries(groups)){ g.label = (TAB_LABEL ||= Object.fromEntries(TABS))[k] || k; sel.appendChild(g); }
}
function tagViewSections(){
  let i = 0;
  document.querySelectorAll("main > section").forEach(sec=>{
    const t = sec.dataset.tab; if (!t || t==="trading" || t==="history" || sec.classList.contains("ph")) return;
    const h2 = sec.querySelector("h2"); if (!h2) return;
    sec.dataset.mid = "v-"+(i++); sec.dataset.title = (h2.childNodes[0].textContent || "").trim() || "panel";
  });
}
function rmButton(onClick){ const b = document.createElement("button"); b.className = "rm"; b.textContent = "✕"; b.title = "remove from Trading"; b.onclick = onClick; return b; }
function addModule(id){
  if (!id) return;
  if (id.startsWith("t-")){
    if ($(id+"-mod")) return;
    const sec = document.createElement("section"); sec.id = id+"-mod"; sec.dataset.tab = "trading";
    const name = TMODS.find(m=>m[0]===id)[1];
    sec.innerHTML = `<h2>${name}</h2><div class="tbody"></div>`;
    sec.querySelector("h2").appendChild(rmButton(()=>{ sec.remove(); afterLayout(); }));
    $("tgrid").appendChild(sec);                                  // must be in the document before the ticket looks up its inputs
    if (id==="t-ticket") buildTicket(sec.querySelector(".tbody"));
  } else {
    const sec = document.querySelector(`main section[data-mid="${id}"]`); if (!sec || sec.dataset.home) return;
    const ph = document.createElement("section"); ph.className = "ph"; ph.dataset.tab = sec.dataset.tab;
    ph.innerHTML = `<div class="note" style="margin:0">“${sec.dataset.title}” is in the Trading tab. </div>`;
    const back = document.createElement("button"); back.textContent = "bring back"; ph.querySelector(".note").appendChild(back);
    const restore = () => { sec.dataset.tab = sec.dataset.home; delete sec.dataset.home; sec.querySelector("h2 > .rm")?.remove(); ph.replaceWith(sec); afterLayout(); };
    back.onclick = restore;
    sec.replaceWith(ph); sec.dataset.home = sec.dataset.tab; sec.dataset.tab = "trading";
    sec.querySelector("h2").appendChild(rmButton(restore));
    $("tgrid").appendChild(sec);
  }
  afterLayout();
}
let restoring = false;
function afterLayout(){
  $("tEmpty").style.display = $("tgrid").children.length ? "none" : ""; buildModCatalog(); setTab(tab);
  if (!restoring) store.set("tmods", [...$("tgrid").children].map(sec => sec.id ? sec.id.replace(/-mod$/, "") : sec.dataset.mid));
}

function buildTicket(el){
  el.innerHTML = `<div class="ticket">
    <div class="tk-side"><button class="buy act" data-side="BUY">Buy / Long</button><button class="sell" data-side="SELL">Sell / Short</button></div>
    <div class="row"><select id="tkType"><option value="MARKET">Market</option><option value="LIMIT">Limit</option></select>
      <input id="tkQty" type="number" step="any" min="0" placeholder="size"><select id="tkUnit"><option value="usd">USD</option><option value="base">BTC</option></select></div>
    <div class="row" id="tkPxRow" style="display:none"><input id="tkPx" type="number" step="any" placeholder="limit price"><button data-px="bid">bid</button><button data-px="mid">mid</button><button data-px="ask">ask</button></div>
    <label class="row"><input id="tkReduce" type="checkbox"> reduce-only</label>
    <div class="tk-info" id="tkInfo"></div>
    <button id="tkSubmit" class="primary">Place order</button>
    <div class="note" id="tkStatus"></div></div>`;
  el.querySelectorAll(".tk-side button").forEach(b => b.onclick = () => { tkSide = b.dataset.side; el.querySelectorAll(".tk-side button").forEach(x=>x.classList.toggle("act", x===b)); renderTicket(); });
  $("tkType").onchange = () => { $("tkPxRow").style.display = $("tkType").value==="LIMIT" ? "" : "none"; renderTicket(); };
  el.querySelectorAll("[data-px]").forEach(b => b.onclick = () => {
    const k = b.dataset.px, v = k==="bid" ? M.bnBid : k==="ask" ? M.bnAsk : (M.bnBid && M.bnAsk ? (M.bnBid+M.bnAsk)/2 : null);
    if (v) $("tkPx").value = v; renderTicket(); });
  $("tkQty").oninput = $("tkPx").oninput = $("tkUnit").onchange = renderTicket;
  $("tkSubmit").onclick = async () => {
    const st = $("tkStatus"), type = $("tkType").value, raw = +$("tkQty").value;
    const ref = type==="LIMIT" ? +$("tkPx").value : (tkSide==="BUY" ? M.bnAsk : M.bnBid);
    if (!raw){ st.className = "note err"; st.textContent = "Enter a size."; return; }
    if (!ref){ st.className = "note err"; st.textContent = type==="LIMIT" ? "Enter a limit price." : "No live price yet; press Connect."; return; }
    const qty = $("tkUnit").value==="usd" ? raw/ref : raw;
    $("tkSubmit").disabled = true; st.className = "note"; st.textContent = "Sending…";
    try{ const r = await placeOrder({side:tkSide, type, qty, price:ref, reduce:$("tkReduce").checked}); st.className = "note ok"; st.textContent = "✓ " + r.msg; }
    catch(e){ st.className = "note err"; st.textContent = e.message; }
    $("tkSubmit").disabled = false;
  };
  renderTicket();
}
function renderTicket(){
  if (!$("tkInfo")) return;
  const unit = $("tkUnit"); unit.options[1].textContent = accAsset();
  const type = $("tkType").value, raw = +$("tkQty").value, ref = type==="LIMIT" ? +$("tkPx").value : (tkSide==="BUY" ? M.bnAsk : M.bnBid);
  const qty = ref ? (unit.value==="usd" ? raw/ref : raw) : 0;
  $("tkInfo").innerHTML = `bid ${fmt(M.bnBid,1)} · ask ${fmt(M.bnAsk,1)}<br>${raw && ref ? `≈ ${qty.toFixed(5)} ${accAsset()} · $${fmt(qty*ref,2)}` : ""}<br>account: ${ACC.mode ? ACC.mode.toUpperCase() : "none (account button)"}`;
  const btn = $("tkSubmit"); btn.textContent = `${tkSide==="BUY"?"Buy":"Sell"} ${type==="LIMIT"?"limit":"market"}${ACC.mode==="live"?" · REAL":""}`;
  btn.style.background = tkSide==="BUY" ? "var(--buy)" : "var(--sell)"; btn.style.borderColor = btn.style.background;
}
function noAcc(el){ el.innerHTML = `<div class="note">No account connected. Log in with the account button in the header.</div>`; }
function renderTrading(){
  if (ACC.mode==="sim") ACC.data = simSnapshot();
  const d = ACC.data, stMsg = ACC.status ? `<div class="note err">${ACC.status}</div>` : "";
  renderTicket();
  const body = id => $(id+"-mod")?.querySelector(".tbody");
  let el;
  if ((el = body("t-bal"))){
    if (!ACC.mode || !d) noAcc(el); else {
      const eq = d.balance.wallet + d.balance.upnl;
      el.innerHTML = `<div class="metrics">${[["Account", ACC.mode.toUpperCase()], ["Wallet", "$"+fmt(d.balance.wallet,2)], ["Unrealized PnL", `<span class="${d.balance.upnl>=0?"ok":"err"}">${d.balance.upnl>=0?"+":""}${fmt(d.balance.upnl,2)}</span>`],
        ["Equity", "$"+fmt(eq,2)], ["Available", "$"+fmt(d.balance.available,2)]].map(([k,v])=>`<div class="metric"><span>${k}</span><b>${v}</b></div>`).join("")}</div>${stMsg}`;
    }
  }
  if ((el = body("t-pos"))){
    if (!ACC.mode || !d) noAcc(el); else el.innerHTML = d.positions.length ? `<table class="tt"><tr><th>symbol</th><th>size</th><th>entry</th><th>mark</th><th>uPnL</th><th>liq</th><th></th></tr>` +
      d.positions.map(p=>`<tr><td>${p.symbol}</td><td class="${p.qty>0?"ok":"err"}">${p.qty>0?"+":""}${p.qty}</td><td>${fmt(p.entry,1)}</td><td>${fmt(p.mark,1)}</td>
        <td class="${p.upnl>=0?"ok":"err"}">${p.upnl>=0?"+":""}${fmt(p.upnl,2)}</td><td>${p.liq?fmt(p.liq,1):"–"}</td><td>${p.symbol===accSym() ? `<button data-close="${p.qty}">close</button>` : `<span class="note" title="switch the asset in the header to close it">switch asset</span>`}</td></tr>`).join("") + `</table>${stMsg}` : `<div class="note">No open position on ${accSym()}.</div>${stMsg}`;
  }
  if ((el = body("t-orders"))){
    if (!ACC.mode || !d) noAcc(el); else el.innerHTML = d.orders.length ? `<table class="tt"><tr><th>side</th><th>type</th><th>price</th><th>qty</th><th>filled</th><th></th></tr>` +
      d.orders.map(o=>`<tr><td class="${o.side==="BUY"?"ok":"err"}">${o.side}${o.reduce?" (R)":""}</td><td>${o.type}</td><td>${fmt(o.price,1)}</td><td>${o.qty}</td><td>${o.filled||0}</td><td><button data-cancel="${o.id}">cancel</button></td></tr>`).join("") +
      `</table><div class="row" style="margin-top:6px"><button data-cancelall="1">cancel all</button></div>${stMsg}` : `<div class="note">No open orders on ${accSym()}.</div>${stMsg}`;
  }
  if ((el = body("t-fills"))){
    if (!ACC.mode || !d) noAcc(el); else el.innerHTML = d.fills.length ? `<div class="tape" style="height:220px"><table class="tt"><tr><th>time</th><th>side</th><th>price</th><th>qty</th><th>fee</th><th>realized</th></tr>` +
      d.fills.slice(0,40).map(f=>`<tr><td>${hhmmss(f.t)}</td><td class="${f.side==="BUY"?"ok":"err"}">${f.side}</td><td>${fmt(f.price,1)}</td><td>${f.qty}</td><td>${fmt(f.fee,3)}</td><td class="${f.pnl>=0?"ok":"err"}">${f.pnl?fmt(f.pnl,2):""}</td></tr>`).join("") + `</table></div>` : `<div class="note">No fills yet.</div>`;
  }
}

function tradingInit(){
  $("addMod").onchange = e => { addModule(e.target.value); e.target.value = ""; };
  $("tgrid").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    try{
      if (b.dataset.close){
        const q = +b.dataset.close, side = q>0 ? "SELL" : "BUY", ref = side==="BUY" ? M.bnAsk : M.bnBid;
        if (!ref) throw new Error("no live price; press Connect");
        await placeOrder({side, type:"MARKET", qty:Math.abs(q), price:ref, reduce:true});
      } else if (b.dataset.cancel) await cancelOrder(isNaN(+b.dataset.cancel) ? b.dataset.cancel : +b.dataset.cancel);
      else if (b.dataset.cancelall) await cancelAll();
    }catch(err){ if (err.message!=="cancelled") alert(err.message); }
  });
}
