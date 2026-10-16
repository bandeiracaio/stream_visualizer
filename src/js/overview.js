"use strict";
// Overview (home): one phone-sized read of the market. Reads state owned by app.js; owns only its own 5 s history,
// because app.js prunes its histories to 5 minutes and the overview shows up to 15.
const OV = {hist:[], sym:null};
const OV_WINS = {"1m":60000, "5m":300000, "15m":900000};
const ov$ = id => document.getElementById(id);
const ovMid = () => M.bnBid && M.bnAsk ? (M.bnBid+M.bnAsk)/2 : (M.bnMark || null);
const ovHlMid = () => M.hlBid && M.hlAsk ? (M.hlBid+M.hlAsk)/2 : (M.hlMark || null);
const ovDec = px => px>=1000 ? 1 : px>=10 ? 2 : px>=1 ? 3 : 5;
const ovSpan = ms => ms>=3600000 ? (ms/3600000).toFixed(1)+"h" : ms>=60000 ? Math.round(ms/60000)+"m" : Math.round(ms/1000)+"s";
const ovSigned = (x, f) => x==null ? "–" : (x>=0?"+":"-") + f(Math.abs(x));
const ovCls = x => x==null || x===0 ? "" : x>0 ? "up" : "dn";

function ovSample(){
  try{
    if (!connected) return;
    const sym = bnSym(); if (OV.sym !== sym){ OV.sym = sym; OV.hist = []; }
    const px = ovMid(); if (!(px>0)) return;
    const hl = ovHlMid(), t = nowEx();
    OV.hist.push({t, px, oi:M.bnOI||null, cb:cvd.bn, ch:cvd.hl, bas:hl?hl-px:null});
    while (OV.hist.length && OV.hist[0].t < t-3900000) OV.hist.shift();
  }catch{}
}
setInterval(ovSample, 5000);

// oldest sample inside the window, or the oldest we have when the session is younger than the window
function ovBase(ms){
  const h = OV.hist; if (!h.length) return null;
  const t0 = nowEx()-ms, i = h.findIndex(x=>x.t>=t0);
  return h[i<0 ? h.length-1 : i];
}

function ovLine(cv, vals, color){
  const {ctx,w,h} = prep(cv); if (vals.length<2 || w<2) return;
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi===lo){ hi+=1; lo-=1; }
  const X = i => i/(vals.length-1)*(w-4)+2, Y = v => h-3-(v-lo)/(hi-lo)*(h-6);
  ctx.beginPath(); vals.forEach((v,i)=>i ? ctx.lineTo(X(i),Y(v)) : ctx.moveTo(X(i),Y(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.lineTo(X(vals.length-1), h); ctx.lineTo(X(0), h); ctx.closePath(); ctx.globalAlpha = .12; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(X(vals.length-1), Y(vals[vals.length-1]), 2.6, 0, 7); ctx.fillStyle = color; ctx.fill();
}

function renderOverview(){
  const px = ovMid(), win = +ov$("ovWin").value, wl = Object.keys(OV_WINS).find(k=>OV_WINS[k]===win) || "5m", rs = READER.state();
  ov$("ovSym").textContent = (ov$("sym").value.trim().toUpperCase() || "–") + " perp";
  ov$("ovStatus").textContent = connected ? `BN ${ov$("bnState").textContent} · HL ${ov$("hlState").textContent}` : "not connected — press Connect";
  ov$("ovPx").textContent = px ? fmt(px, ovDec(px)) : "–";

  // price change chips
  ov$("ovChg").innerHTML = Object.entries(OV_WINS).map(([k,ms])=>{
    const b = ovBase(ms); if (!b || !px) return `<span class="chg">${k} –</span>`;
    const pct = (px/b.px-1)*100, span = nowEx()-b.t, part = span < ms*.8;
    return `<span class="chg ${ovCls(pct)}${part?" part":""}" title="${part?"only "+ovSpan(span)+" of history so far":""}">${k} ${ovSigned(pct, a=>a.toFixed(2))}%${part?" ("+ovSpan(span)+")":""}</span>`;
  }).join("");
  const line = OV.hist.filter(x=>x.t >= nowEx()-900000).map(x=>x.px); if (px) line.push(px);
  ovLine(ov$("ovSpark"), line, line.length>1 && line[line.length-1]<line[0] ? "#e5534b" : "#2fbf71");

  // market numbers
  const b = ovBase(win), age = b ? nowEx()-b.t : 0, part = b && age < win*.8, tag = part ? ovSpan(age) : wl;
  const cb = b ? cvd.bn-b.cb : null, ch = b ? cvd.hl-b.ch : null, oiChg = b && b.oi && M.bnOI ? (M.bnOI/b.oi-1)*100 : null;
  const hl = ovHlMid(), basis = px && hl ? hl-px : null, nf = M.bnNextFund ? M.bnNextFund-Date.now() : null;
  const item = (k, v, sub, cls) => `<div class="metric"><span>${k}</span><b class="${cls||""}">${v}</b>${sub?`<small>${sub}</small>`:""}</div>`;
  ov$("ovMetrics").innerHTML = [
    item(`BN CVD Δ ${tag}`, ovSigned(cb, a=>"$"+fmtK(a)), "taker buy − sell", ovCls(cb)),
    item(`HL CVD Δ ${tag}`, ovSigned(ch, a=>"$"+fmtK(a)), "taker buy − sell", ovCls(ch)),
    item("Basis HL − BN", basis==null ? "–" : ovSigned(basis, a=>fmt(a,ovDec(px))), basis==null ? "" : ovSigned(basis/px*1e4, a=>a.toFixed(1))+" bps", ovCls(basis)),
    item("BN funding (8h)", M.bnFund==null ? "–" : (M.bnFund*100).toFixed(4)+"%", nf>0 ? "next in "+ovSpan(nf) : "", ovCls(M.bnFund)),
    item("HL funding (1h)", M.hlFund==null ? "–" : (M.hlFund*100).toFixed(4)+"%", "", ovCls(M.hlFund)),
    item("BN open interest", M.bnOI ? fmtK(M.bnOI) : "–", oiChg==null ? "" : ovSigned(oiChg, a=>a.toFixed(2))+"% / "+tag, ovCls(oiChg)),
    item("Activity", rs.calibrated ? rs.regime : "calibrating", rs.calibrated ? "x"+rs.ratio.toFixed(2)+" of normal flow" : Math.round(rs.calibratingPct*100)+"% of warm-up", rs.regime==="hot" && rs.calibrated ? "dn" : ""),
  ].join("");

  // Reader: the strongest active episodes, in plain language
  const act = READER.activeEpisodes().sort((x,y)=>y.intensity-x.intensity).slice(0,3);
  const lastEnded = READER.episodes.filter(e=>e.stage==="ended").slice(-1)[0];
  ov$("ovReader").innerHTML = act.length ? act.map(e=>`<div class="ovev ${e.stage}"><span class="stat">${ovSpan(Math.max(0,rs.now-e.tStart))}</span> <b>${READER_EPISODES.FAMILY_LABEL[e.family]}</b> <span class="venue v-${e.venue}">${e.venue.toUpperCase()}</span> <span class="chip">${e.horizon}</span> <span class="stg">${e.stage}</span><div class="ovevd">${e.reading}</div></div>`).join("")
    : `<div class="note" style="margin:0">${!connected ? "Not connected." : !rs.calibrated ? "Calibrating: detectors arm after about two minutes of data." : "Quiet: no active episodes."}${lastEnded ? ` Last: ${READER_EPISODES.FAMILY_LABEL[lastEnded.family].toLowerCase()} (${lastEnded.venue.toUpperCase()}) ended ${ovSpan(Math.max(0,rs.now-lastEnded.tEnd))} ago.` : ""}</div>`;

  // Account
  if (ACC.mode==="sim") ACC.data = simSnapshot();
  const d = ACC.data;
  if (!ACC.mode || !d) ov$("ovAcc").innerHTML = `<div class="note" style="margin:0">No account connected.</div>`;
  else {
    const up = d.balance.upnl, pos = d.positions.slice(0,3);
    ov$("ovAcc").innerHTML = `<div class="metrics"><div class="metric"><span>wallet</span><b>$${fmt(d.balance.wallet,2)}</b></div>`
      + `<div class="metric"><span>unrealized PnL</span><b class="${ovCls(up)}">${ovSigned(up, a=>"$"+fmt(a,2))}</b></div></div>`
      + (pos.length ? `<table class="tt" style="margin-top:6px">${pos.map(p=>`<tr><td>${p.symbol}</td><td>${p.qty>0?"long":"short"} ${Math.abs(p.qty)}</td><td class="${ovCls(p.upnl)}">${ovSigned(p.upnl, a=>"$"+fmt(a,2))}</td></tr>`).join("")}</table>` : `<div class="note">No open positions.</div>`);
  }
}
ov$("ovWin").onchange = () => { if (typeof visible==="function" && visible("overview")) renderOverview(); };
ov$("ovOpenReader").onclick = () => setTab("reader");
ov$("ovOpenAcc").onclick = () => setTab("accounts");
