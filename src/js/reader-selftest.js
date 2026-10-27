"use strict";
const READER_SELFTEST=(()=>{
  const T0=1700000000000;
  function rng(seed){let s=seed>>>0;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
  function poisson(rand,lam){if(lam<=0)return 0;if(lam>30)return Math.max(0,Math.round(lam+Math.sqrt(lam)*(rand()+rand()+rand()-1.5)*2));const L=Math.exp(-lam);let k=0,p=1;do{k++;p*=rand();}while(p>L);return k-1;}
  function levels(mid,dir,mult,walls,t){const out=[];for(let i=0;i<30;i++)out.push([+(mid+dir*(.05+.1*i)).toFixed(2),.5*mult*(1+.1*Math.sin(i*1.7+t/1000))]);for(const w of walls)if(w.idx>=0&&w.idx<30)out[w.idx][1]=w.size;return out;}
  function sim(engine,opts){const o=Object.assign({t0:T0,mid0:82000,seed:7,seconds:150,stepMs:250,venue:"bn",params:()=>({})},opts),rand=rng(o.seed),dt=o.stepMs/1000,steps=Math.round(o.seconds*1000/o.stepMs);let t=o.t0,mid=o.mid0;for(let i=0;i<steps;i++){t+=o.stepMs;const p=Object.assign({rate:20,buyP:.5,driftBps:0,vol:.3,size:.02,bidMult:1,askMult:1,bidWalls:[],askWalls:[],liqSell:0,liqBuy:0,sweepSell:0,sweepBuy:0,trades:[]},o.params((t-o.t0)/1000,mid));mid*=1+(p.driftBps*dt+(rand()-.5)*2*p.vol)/1e4;engine.onQuote(o.venue,t,mid-.05,mid+.05);for(let k=poisson(rand,p.rate*dt);k>0;k--){const b=rand()<p.buyP,q=p.size*(.5+rand()),px=b?mid+.05:mid-.05;engine.onTrade({t,v:o.venue,side:b?"buy":"sell",px,q,ntl:px*q});}for(const tr of p.trades)engine.onTrade(Object.assign({t,v:o.venue},tr));for(let k=poisson(rand,p.liqSell*dt);k>0;k--)engine.onTrade({t,v:o.venue,side:"sell",px:mid-.05,q:.5,ntl:(mid-.05)*.5,liq:true});for(let k=poisson(rand,p.liqBuy*dt);k>0;k--)engine.onTrade({t,v:o.venue,side:"buy",px:mid+.05,q:.5,ntl:(mid+.05)*.5,liq:true});for(let k=poisson(rand,p.sweepSell*dt);k>0;k--)engine.onSweep(o.venue,t,"sell",50000,3);for(let k=poisson(rand,p.sweepBuy*dt);k>0;k--)engine.onSweep(o.venue,t,"buy",50000,3);engine.onBook(o.venue,t,levels(mid,-1,p.bidMult,p.bidWalls,t),levels(mid,1,p.askMult,p.askWalls,t));}return {t,mid};}
  const scenarios=[];
  const add=(name,run)=>scenarios.push({name,run});
  const calm=(e,seconds)=>sim(e,{seconds:seconds||150,seed:3});
  const has=(e,type,dir)=>e.events.some(x=>x.type===type&&(!dir||x.dir===dir));
  const result=(ok,e,want)=>({ok,detail:ok?"ok":`wanted ${want}; got [${Array.from(e.events,x=>x.type+":"+x.dir).join(", ")}]`});
  add("bid wall appears, then is pulled",E=>{const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:5,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})});sim(e,{t0:b.t,mid0:b.mid,seconds:4,seed:12,params:()=>({vol:0})});const ok=has(e,"wall_appears","bull")&&has(e,"wall_pulled","bear");return result(ok,e,"wall_appears:bull then wall_pulled:bear");});
  add("bid wall is eaten by sellers",E=>{const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:5,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})}),px=b.mid-1.3;sim(e,{t0:b.t,mid0:b.mid,seconds:3,seed:12,params:sec=>({vol:0,trades:sec<.3?[{side:"sell",px,q:5,ntl:px*5}]:[]})});return result(has(e,"wall_eaten","bear")&&!has(e,"wall_pulled"),e,"wall_eaten:bear and no wall_pulled");});
  add("thin bid depth is flagged",E=>{const e=E.create(),a=calm(e);sim(e,{t0:a.t,mid0:a.mid,seconds:6,seed:13,params:()=>({bidMult:.3})});return result(has(e,"book_thin","bear"),e,"book_thin:bear");});
  add("book imbalance flips from bids to asks",E=>{const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:6,seed:14,params:()=>({bidMult:3})}),before=e.events.filter(x=>x.type==="imbalance_flip").length;sim(e,{t0:b.t,mid0:b.mid,seconds:6,seed:15,params:()=>({askMult:3})});return result(before===0&&has(e,"imbalance_flip","bear"),e,"imbalance_flip:bear");});
  add("spoof-like walls are flagged",E=>{const e=E.create(),a=calm(e);sim(e,{t0:a.t,mid0:a.mid,seconds:6,seed:16,params:sec=>({vol:0,bidWalls:sec<1?[{idx:10,size:6}]:sec>=1.5&&sec<2.5?[{idx:14,size:6}]:sec>=3&&sec<4?[{idx:18,size:6}]:[]})});return result(has(e,"spoof_like")&&!has(e,"wall_appears"),e,"spoof_like and no confirmed wall");});
  add("malformed books are ignored",E=>{const e=E.create(),a=calm(e,130),before=e.events.length;try{e.onBook("bn",a.t+250,[],[[100,1]]);e.onBook("bn",a.t+500,[[101,1]],[[100,1]]);e.onBook("bn",a.t+750,[[100,0],[99,NaN],null],[[101,-1],"x"]);e.onBook("bn",a.t+1000,[[100,1],[99,50]],[[101,1],[102,1]]);e.onBook("zz",a.t+1250,[[100,1]],[[101,1]]);e.onBook("bn",a.t+1500,null,undefined);}catch(err){return{ok:false,detail:"threw: "+err.message};}return result(e.events.length===before&&e.debug().venues.bn.walls.size===0,e,"no events and no walls");});
  add("capitulation, then selling exhausted",E=>{const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>({rate:200,buyP:.1,driftBps:-6,liqSell:3,sweepSell:2,bidMult:.4})});sim(e,{t0:b.t,mid0:b.mid,seconds:24,seed:22,params:()=>({driftBps:.2})});const i=e.events.findIndex(x=>x.type==="capitulation"&&x.dir==="bear"),j=e.events.findIndex(x=>x.type==="selling_exhausted"&&x.dir==="bull");return result(i>=0&&j>i,e,"capitulation:bear followed by selling_exhausted:bull");});
  add("squeeze that stays inside the 5-minute range",E=>{const e=E.create(),a=sim(e,{seconds:150,seed:3,params:sec=>({driftBps:sec<50?1:sec<110?-.8:0})});sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:31,params:()=>({rate:200,buyP:.9,driftBps:3.5,liqBuy:3,sweepBuy:2,askMult:.4})});return result(has(e,"squeeze","bull")&&!has(e,"breakout"),e,"squeeze:bull and no breakout");});
  add("breakout through the 5-minute high",E=>{const e=E.create(),a=calm(e);sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:32,params:()=>({rate:200,buyP:.9,driftBps:6,liqBuy:3,sweepBuy:2,askMult:.4})});return result(has(e,"breakout","bull")&&!has(e,"squeeze"),e,"breakout:bull and no squeeze");});
  add("quiet market produces no signals",E=>{const e=E.create();sim(e,{seconds:300,seed:5});return result(e.events.length===0,e,"no signals at all");});
  // ---- episodes: lifecycle (forming -> active -> fading -> ended, resumable), several variables, neutral language ----
  const eps=(e,family,pred)=>e.episodes.filter(x=>x.family===family&&(!pred||pred(x)));
  const epResult=(ok,e,want)=>({ok,detail:ok?"ok":`wanted ${want}; got [${Array.from(e.episodes,x=>`${x.family}/${x.venue}/${x.horizon}:${x.aggressor}:${x.stage}:${x.outcome}`).join(", ")}]`});
  const burstSell={rate:200,buyP:.1,driftBps:-6,liqSell:3,sweepSell:2,bidMult:.4};
  const heavySell={rate:120,buyP:.08,vol:.02};
  add("absorption episode: back-dated start, resumes after a short lull, ends when the flow stops",E=>{
    const e=E.create(),a=calm(e),h1=sim(e,{t0:a.t,mid0:a.mid,seconds:20,seed:41,params:()=>heavySell}),l=sim(e,{t0:h1.t,mid0:h1.mid,seconds:6,seed:42,params:()=>({rate:20})});
    const h2=sim(e,{t0:l.t,mid0:l.mid,seconds:12,seed:43,params:()=>heavySell});sim(e,{t0:h2.t,mid0:h2.mid,seconds:40,seed:44});
    const x=eps(e,"absorption",p=>p.venue==="bn"&&p.horizon==="fast"&&p.aggressor==="sell")[0];
    return epResult(!!x&&x.passive==="buy"&&x.tStart<x.tDetected&&x.pulses>=2&&x.stage==="ended"&&x.tEnd<=h2.t+8000&&x.dir===undefined&&/absorbed/.test(x.peakReading)&&x.peakEvidence.length>0,e,"one fast sell-absorption episode: start before detection, resumed (pulses>=2), ended within 8 s of the flow stopping, no bull/bear field");
  });
  add("burst episode: aggressive sellers, ends soon after the burst stops",E=>{
    const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:22});
    const x=eps(e,"burst",p=>p.horizon==="fast"&&p.aggressor==="sell")[0];
    return epResult(!!x&&x.stage==="ended"&&x.tEnd<=b.t+6000&&x.tStart<=x.tDetected&&/sellers/.test(x.reading)&&x.evidence.some(i=>i.k==="liq"&&i.ok),e,"a fast burst episode by sellers, ended within 6 s of the burst, with the liquidation evidence confirmed");
  });
  add("wall episode: opens once the wall has stood long enough, start back-dated, ends pulled",E=>{
    const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:75,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})});sim(e,{t0:b.t,mid0:b.mid,seconds:4,seed:12,params:()=>({vol:0})});
    const x=eps(e,"wall")[0];
    return epResult(!!x&&x.passive==="buy"&&x.stage==="ended"&&x.outcome==="pulled"&&x.tDetected-x.tStart>=60000&&eps(e,"wall").length===1&&x.wall.size<x.wall.peak*.5,e,"exactly one bid wall episode, started when the wall appeared (>= 60 s before detection), ended pulled");
  });
  add("wall episodes: the same resting region re-appearing nearby after the last wall ended is not a second episode; a distant one, or one with merging off, is",E=>{
    const run=(idx,cfg)=>{const e=E.create(cfg?{ep:cfg}:{}),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:75,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})}),g=sim(e,{t0:b.t,mid0:b.mid,seconds:4,seed:12,params:()=>({vol:0})});sim(e,{t0:g.t,mid0:g.mid,seconds:75,seed:13,params:()=>({vol:0,bidWalls:[{idx,size:6}]})});return eps(e,"wall").length;};
    const near=run(13),tight=run(13,{wallMergeBps:.03}),far=run(16,{wallMergeBps:.03}),off=run(13,{wallMergeBps:0,wallMergeMs:0});      // the simulated book's levels are 0.1 apart on 82000, so a tighter merge distance stands in for a distant wall
    return{ok:near===1&&tight===1&&far===2&&off===2,detail:JSON.stringify({near,tight,far,off})};
  });
  add("wall episodes: a wall below the minimum notional does not open an episode",E=>{
    const run=cfg=>{const e=E.create({ep:cfg}),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:75,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})});sim(e,{t0:b.t,mid0:b.mid,seconds:4,seed:12,params:()=>({vol:0})});return eps(e,"wall").length;};
    const big=run({wallMinUsd:1e9}),zero=run({wallMinUsd:0});
    return{ok:big===0&&zero===1,detail:JSON.stringify({big,zero})};
  });
  add("exhaustion: only counts while price is still near the extreme; after the price has already come back it does not fire (a wide setting restores it)",E=>{
    const run=(cfg,back)=>{const e=E.create({ep:Object.assign({famHorizons:{exhaustion:["fast"]}},cfg)}),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:14,seed:31,params:()=>({rate:200,buyP:.9,driftBps:6})});sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:32,params:()=>({rate:12,vol:.05,driftBps:back?-14:0})});return eps(e,"exhaustion",p=>p.aggressor==="buy").length;};
    const near=run({},false),back=run({},true),wide=run({exhNear:1e9},true);
    return{ok:near>0&&back===0&&wide>0,detail:JSON.stringify({near,back,wide})};
  });
  add("z-score: capped at 50, and a side's yardstick can come from the other side's level",E=>{
    const z=(cfg,x)=>{const e=E.create(cfg);calm(e,200);return e.debug().robustZ(x,"bn","buy",1);};
    const huge=z({},1e13),low=z({zCap:5},1e13),plain=z({zOtherFrac:0,zCap:1e9},3e6),wide=z({zOtherFrac:50,zCap:1e9},3e6);
    return{ok:huge===50&&low===5&&wide<plain&&wide>0,detail:JSON.stringify({huge,low,plain,wide})};
  });
  add("absorption: a clear move against the aggressor is a reversal, not a stall (a wide setting restores it)",E=>{
    const run=(cfg,drift)=>{const e=E.create({ep:cfg}),a=calm(e);sim(e,{t0:a.t,mid0:a.mid,seconds:20,seed:41,params:()=>Object.assign({},heavySell,{driftBps:drift})});return eps(e,"absorption",p=>p.venue==="bn"&&p.aggressor==="sell").length;};
    const flat=run({},0),up=run({},14),wide=run({absAdverse:1e9},14);
    return{ok:flat>0&&up===0&&wide>0,detail:JSON.stringify({flat,up,wide})};
  });
  add("session quality: a complete recording, one with a silent stretch, and a hollow one are told apart",E=>{
    const make=(minutes,skip)=>{const out=[];for(let s=0;s<minutes*60;s++){const m=Math.floor(s/60);if(skip&&skip(m))continue;for(let k=0;k<4;k++)out.push(["a",T0+s*1000+k*250]);for(let k=0;k<5;k++)out.push(k<3?["q","bn",T0+s*1000+k*200,100,101]:["t",{t:T0+s*1000+k*200,v:"bn",side:"buy",px:100,q:1,ntl:100}]);}return out;};
    const ok=SQ.of(make(5)),holes=SQ.of(make(6,m=>m===2)),hollow=SQ.of(make(6,m=>m!==0&&m!==5)),none=SQ.of([]);
    return{ok:ok.verdict==="complete"&&ok.dataMinutes===ok.minutes&&holes.verdict==="holes"&&holes.longestGapSec>=60&&hollow.verdict==="hollow"&&none.verdict==="empty"&&/silence/.test(SQ.line(holes))&&SQ.line(ok)===`${ok.minutes} of ${ok.minutes} min with data`,detail:JSON.stringify({ok,holes,hollow})};
  });
  add("autorec: dump returns the last seconds of prices as pairs, leaving out missed seconds",E=>{
    const A=AUTOREC,h=A.createHistory();let t=T0;for(let i=0;i<300;i++){t+=1000;if(i>=100&&i<120)continue;A.push(h,t,82000+i);}
    const d=A.dump(h,t,200),all=A.dump(h,t,4000);
    return{ok:d.length===180&&d[d.length-1][1]===82299&&d.every((p,i)=>i===0||p[0]>d[i-1][0])&&all.length===280&&A.dump(A.createHistory(),t,50).length===0,detail:JSON.stringify({n:d.length,all:all.length,last:d[d.length-1]})};
  });
  add("wallet: one order split into many fills at one instant is not a wallet that keeps hitting; fills over several seconds are",E=>{
    const run=(spread)=>{const e=E.create(),a=calm(e);for(let i=0;i<12;i++)e.onTrade({t:a.t+(spread?i*700:50),v:"hl",side:"sell",px:a.mid,q:1,ntl:a.mid,users:["0xbuyer"+i,"0xsellerAAAAAA"]});return e.debug().walletEvidence("hl","sell",a.t-1000);};
    const one=run(false),many=run(true);
    return{ok:!one&&!!many&&many.share>.9,detail:JSON.stringify({one,many})};
  });
  add("collectors: feed telemetry is computed from two samples; a worker stream gives lag, rate and gap; records are validated",E=>{
    const prev={a:{total:100,bytes:1,late:2,last:0,maxLat:50,lats:[]}},cur={a:{total:160,bytes:2,late:5,last:T0-400,maxLat:900,lats:[10,20,30,40,200]},b:{total:0,lats:[]}};
    const f=COLLECT.feeds(prev,cur,T0,10000),st=COLLECT.streamStat();
    st.note(T0-100,T0);st.note(T0+900,T0+1000);st.note(T0+3910,T0+4000);const w=st.take(T0+4500,5000),again=st.take(T0+9500,5000);
    return{ok:f.a.n===60&&f.a.hz===6&&f.a.ageMs===400&&f.a.late===3&&f.a.latMed===30&&f.a.latP90===200&&!f.b&&w.n===3&&w.hz===.6&&w.lagMed===100&&w.gapMs===3000&&w.ageMs===500&&again.n===0&&again.gapMs===0&&COLLECT.isRec(COLLECT.rec("x",T0,{}))&&!COLLECT.isRec(["t",{}])&&!COLLECT.isRec(["c","x","no"]),detail:JSON.stringify({f,w,again})};
  });
  add("collectors: the tape is pruned to its window, sliced for a session, and fitted to the file budget",E=>{
    const recs=[];for(let i=0;i<100;i++)recs.push(COLLECT.rec("feeds",T0+i*10000,{n:i,pad:"x".repeat(50)}));
    const now=T0+99*10000,pr=COLLECT.prune(recs,now,200000),sl=COLLECT.slice(recs,T0+100000,T0+200000),ft=COLLECT.fit(recs,1500);
    return{ok:pr.length===21&&sl.length===11&&ft.length>5&&ft.length<30&&ft[ft.length-1]===recs[99]&&JSON.stringify(ft).length<=1500&&COLLECT.fit(recs,1e9).length===100,detail:JSON.stringify({pr:pr.length,sl:sl.length,ft:ft.length})};
  });
  add("collectors: derivatives readers parse the real answer shapes and refuse unusable ones",E=>{
    const pr=COLLECT.premium({symbol:"BTCUSDT",markPrice:"80667.20261594",indexPrice:"80708.63673913",estimatedSettlePrice:"80784.82",lastFundingRate:"0.00003407",nextFundingTime:1792800000000,time:1792797389000});
    const oi=COLLECT.openInterest({symbol:"BTCUSDT",openInterest:"92836.854",time:1792797387450});
    const acct=COLLECT.ratioPoint("acct",[{longAccount:"0.6",shortAccount:"0.4",longShortRatio:"1.5",timestamp:1},{longAccount:"0.6785",shortAccount:"0.3215",longShortRatio:"2.1104",timestamp:1792796700000}]);
    const tk=COLLECT.ratioPoint("taker",[{buySellRatio:"0.4378",sellVol:"810.197",buyVol:"354.68",timestamp:1792796700000}]);
    const hl=COLLECT.hlCtx([{universe:[{name:"ETH"},{name:"BTC"}]},[{markPx:"1"},{funding:"0.0000125",openInterest:"44627.99",premium:"-0.00015",oraclePx:"80702.0",markPx:"80688.7",midPx:"80689.5"}]],"BTC");
    const fo=COLLECT.force({e:"forceOrder",E:1,o:{s:"BTCUSDT",S:"BUY",q:"0.039",p:"81115.10",ap:"80803.10",X:"FILLED",z:"0.039",T:1792797483260}});
    const bs=COLLECT.basis({e:"markPriceUpdate",p:"80782.5",i:"80817.3426",r:"0.00003376",T:1792800000000});
    const bad=[COLLECT.premium({}),COLLECT.premium(null),COLLECT.openInterest({openInterest:"x"}),COLLECT.ratioPoint("acct",[]),COLLECT.ratioPoint("taker",[{buyVol:"1"}]),COLLECT.hlCtx([{universe:[{name:"ETH"}]},[{markPx:"1"}]],"BTC"),COLLECT.hlCtx({},"BTC"),COLLECT.force({e:"markPriceUpdate"}),COLLECT.force({e:"forceOrder",o:{S:"BUY"}}),COLLECT.basis({p:"1"})];
    return{ok:pr.mark===80667.20261594&&pr.fund===.00003407&&pr.next===1792800000000&&oi.oi===92836.854&&acct.ratio===2.1104&&acct.ts===1792796700000&&tk.buy===354.68&&tk.sell===810.197&&hl.fund===.0000125&&hl.mark===80688.7&&hl.oi===44627.99&&fo.side==="BUY"&&fo.qty===.039&&fo.px===80803.1&&bs.bps===-4.31&&bad.every(x=>x===null),detail:JSON.stringify({pr,oi,acct,tk,hl,fo,bs,bad})};
  });
  add("collectors: ratios are recorded only when a new 5 minute point arrives; polls are due on their own schedule",E=>{
    const a={acct:{ts:1},top:{ts:1},taker:{ts:1}},same={acct:{ts:1},top:{ts:1},taker:{ts:1}},moved={acct:{ts:2},top:{ts:1},taker:{ts:1}},lost={acct:null,top:{ts:1},taker:{ts:1}};
    const E_=COLLECT.EVERY;
    return{ok:COLLECT.ratiosChanged(null,a)&&!COLLECT.ratiosChanged(a,same)&&COLLECT.ratiosChanged(a,moved)&&COLLECT.ratiosChanged(a,lost)&&COLLECT.due(0,T0,E_.prem)&&!COLLECT.due(T0,T0+14999,E_.prem)&&COLLECT.due(T0,T0+15000,E_.prem)&&!COLLECT.due(T0,T0+59999,E_.ratios)&&COLLECT.due(T0,T0+60000,E_.ratios)&&COLLECT.BACKOFF_MS===300000&&COLLECT.REGISTRY.some(c=>c.id==="derivs"&&c.on),detail:JSON.stringify(E_)};
  });
  add("collectors: calendar tags follow the rules (closes, funding, US session with daylight saving, options expiry kinds)",E=>{
    const U=(y,m,d,h,mi)=>Date.UTC(y,m-1,d,h||0,mi||0),at=(c,t)=>{const x=c.find(e=>e.t===t);return x?x.tags:[]};
    const fri=COLLECT.calendar(U(2026,10,23,7,59),U(2026,10,23,20,0));         // Friday 23 Oct 2026, still summer time in New York
    const mon=COLLECT.calendar(U(2026,10,25,23,59),U(2026,10,26,0,0));         // Monday 00:00 UTC: week close
    const mth=COLLECT.calendar(U(2026,10,31,23,59),U(2026,11,1,0,0));          // Sunday 1 Nov 00:00 UTC: month close, no US session
    const win=COLLECT.calendar(U(2026,11,2,14,0),U(2026,11,2,21,0));           // Monday 2 Nov: winter time, open 14:30 and close 21:00 UTC
    const mo=COLLECT.calendar(U(2026,10,30,7,0),U(2026,10,30,9,0)),q=COLLECT.calendar(U(2026,12,25,7,0),U(2026,12,25,9,0)),dly=COLLECT.calendar(U(2026,10,27,7,0),U(2026,10,27,9,0));
    const sat=COLLECT.calendar(U(2026,10,24,0,0),U(2026,10,25,23,0)),once=COLLECT.calendar(U(2026,10,23,7,59),U(2026,10,23,8,0)),none=COLLECT.calendar(U(2026,10,23,8,0),U(2026,10,23,8,0));
    const has=(a,...t)=>t.every(x=>a.includes(x));
    const f8=at(fri,U(2026,10,23,8)),f20=at(fri,U(2026,10,23,20)),m0=at(mon,U(2026,10,26)),n0=at(mth,U(2026,11,1));
    return{ok:has(f8,"15m","1h","4h","funding","optExp:weekly")&&has(at(fri,U(2026,10,23,13,30)),"usOpen","15m")&&has(f20,"usClose","1h","4h")&&!f20.includes("funding")&&has(m0,"1h","4h","1d","1w","funding")&&!m0.includes("1M")&&has(n0,"1d","1M")&&!n0.includes("1w")&&!n0.some(x=>x.startsWith("us"))&&has(at(win,U(2026,11,2,14,30)),"usOpen")&&has(at(win,U(2026,11,2,21)),"usClose")&&has(at(mo,U(2026,10,30,8)),"optExp:monthly")&&has(at(q,U(2026,12,25,8)),"optExp:quarterly")&&has(at(dly,U(2026,10,27,8)),"optExp:daily")&&!sat.some(e=>e.tags.some(x=>x.startsWith("us")))&&once.length===1&&once[0].t===U(2026,10,23,8)&&none.length===0&&COLLECT.REGISTRY.some(c=>c.id==="calendar"&&c.on),detail:JSON.stringify({fri:fri.filter(e=>e.tags.length>1||e.tags.some(x=>x!=="15m")),mon,mth,win:win.filter(e=>e.tags.some(x=>x!=="15m")),mo:mo.filter(e=>e.tags.length>1),q:q.filter(e=>e.tags.length>1),dly:dly.filter(e=>e.tags.length>1)})};
  });
  add("collectors: book depth sums levels within each edge, says null where the data does not reach, and tops a fine book up from a coarse one",E=>{
    const bids=[[99.995,1],[99.96,2],[99.5,4],[99,8]],asks=[[100.005,1.5],[100.04,2.5],[100.5,5]];
    const b=COLLECT.book(bids,asks),short=COLLECT.book(bids,asks.slice(0,2)),bad=[COLLECT.book([],asks),COLLECT.book(bids,[]),COLLECT.book([[101,1]],[[100,1]])];
    const fine=COLLECT.book(bids.slice(0,2),asks.slice(0,2)),coarse=COLLECT.book([[99.92,3],[99.5,4]],[[100.08,3.5],[100.5,5]],COLLECT.BOOK_EDGES),m=COLLECT.mergeBook(fine,coarse),alone=COLLECT.mergeBook(fine,null);
    const J=JSON.stringify;
    return{ok:b.mid===100&&b.spr===1&&b.tb===1&&b.ta===1.5&&J(b.reach)==="[100,50]"&&J(b.d["1"])==="[1,1.5]"&&J(b.d["5"])==="[3,4]"&&J(b.d["20"])==="[3,4]"&&J(short.d["1"])==="[1,1.5]"&&J(short.d["5"])==="[3,null]"&&J(short.d["20"])==="[3,null]"&&bad.every(x=>x===null)&&m&&J(m.d["1"])==="[1,1.5]"&&J(m.d["10"])==="[3,3.5]"&&J(m.d["20"])==="[3,3.5]"&&J(m.coarse)==="[5,10,20]"&&J(COLLECT.book(bids,asks,null,[10,10]).d)===J({"1":[1,1.5],"5":[3,4],"10":[3,4],"20":[null,null]})&&alone.d["20"][0]===null&&alone.coarse.length===0,detail:J({b,short,m,alone})};
  });
  add("collectors: book flow counts size added and removed near the touch only, and resets when taken",E=>{
    const f=COLLECT.flowStat(25);
    f.note("b",null,2,1);f.note("b",2,5,1);f.note("b",5,1,1);f.note("b",1,0,1);f.note("b",3,3,1);f.note("b",1,9,30);f.note("a",0,4,-2);f.note("a",4,1,2);
    const r=f.take(),again=f.take();
    return{ok:r.b.nAdd===1&&r.b.nUp===1&&r.b.nRed===1&&r.b.nDel===1&&r.b.add===5&&r.b.rem===5&&r.a.nAdd===1&&r.a.add===4&&r.a.nRed===1&&r.a.rem===3&&again.b.add===0&&again.a.nAdd===0&&COLLECT.REGISTRY.some(c=>c.id==="book"&&c.speed==="fast"),detail:JSON.stringify({r,again})};
  });
  add("collectors: extra venues: sockets per coin, real message shapes parsed, partial Bybit updates merged, ages and lags in the record",E=>{
    const J=JSON.stringify,P=COLLECT.venueParse,subs=COLLECT.venueSubs("btc"),eth=COLLECT.venueSubs("ETH");
    const cb=P("cb",{type:"ticker",product_id:"BTC-USD",price:"80993.52",best_bid:"80993.51",best_ask:"80993.52",time:"2026-10-23T23:48:10.644540Z"});
    const by1=P("byL",{topic:"tickers.BTCUSDT",type:"snapshot",ts:1000,data:{symbol:"BTCUSDT",lastPrice:"81058.90",markPrice:"81059.93",indexPrice:"81102.51",fundingRate:"0.0000649",bid1Price:"81058.80",ask1Price:"81058.90"}});
    const by2=P("byL",{topic:"tickers.BTCUSDT",type:"delta",ts:1100,data:{symbol:"BTCUSDT",bid1Price:"81054.70",bid1Size:"0.976"}});
    const okT=P("ok",{arg:{channel:"tickers",instId:"BTC-USDT-SWAP"},data:[{instType:"SWAP",bidPx:"81053.8",askPx:"81053.9",last:"81053.8",ts:"1792799310072"}]});
    const okP=P("ok",{arg:{channel:"tickers",instId:"BTC-USDT"},data:[{instType:"SPOT",bidPx:"81090.4",askPx:"81090.5",last:"81090.5",ts:"1792799310171"}]});
    const okM=P("ok",{arg:{channel:"mark-price",instId:"BTC-USDT-SWAP"},data:[{markPx:"81053.5",ts:"1792799310183"}]});
    const okI=P("ok",{arg:{channel:"index-tickers",instId:"BTC-USDT"},data:[{idxPx:"81095.4",ts:"1792799310081"}]});
    const bn=P("bnS",{stream:"btcusdt@bookTicker",data:{u:1,s:"BTCUSDT",b:"81105.85000000",B:"2.3",a:"81105.86000000",A:"2.9"}});
    const mj=P("maj",{stream:"ethusdt@markPrice@1s",data:{e:"markPriceUpdate",E:5000,s:"ETHUSDT",p:"3100.50000000"}});
    const junk=[P("cb",{type:"subscriptions"}),P("byL",{success:true,op:"subscribe"}),P("ok",{event:"subscribe",arg:{channel:"tickers"}}),P("bnS",{result:null}),P("maj",{data:{e:"x"}}),P("cb",null),P("zz",{})];
    const st={};COLLECT.venueApply(st,by1,10000);COLLECT.venueApply(st,by2,10200);COLLECT.venueApply(st,mj,10300);COLLECT.venueApply(st,mj&&{src:"maj",set:{sol:150.5},e:null},10400);COLLECT.venueApply(st,null,1);
    const r=COLLECT.venueRecord(st,11000),none=COLLECT.venueRecord({},1);
    return{ok:subs.length===6&&subs[0].sub.product_ids[0]==="BTC-USD"&&subs[1].sub.args[0]==="tickers.BTCUSDT"&&subs[3].sub.args[3].instId==="BTC-USDT"&&subs[4].url.endsWith("btcusdt@bookTicker")&&subs[5].url.includes("ethusdt@markPrice@1s")&&subs[5].url.includes("dogeusdt@markPrice@1s")&&!eth[5].url.includes("ethusdt")&&eth[5].url.includes("btc"+"usdt")===false&&!!subs[3].ping&&subs[1].ping.op==="ping"
      &&cb.src==="cb"&&cb.set.b===80993.51&&cb.set.a===80993.52&&cb.set.l===80993.52&&cb.e===Date.parse("2026-10-23T23:48:10.644Z")
      &&by1.set.m===81059.93&&by1.set.i===81102.51&&by1.set.f===.0000649&&J(Object.keys(by2.set))==='["b"]'&&by2.set.b===81054.7
      &&okT.src==="okS"&&okT.set.b===81053.8&&okP.src==="okP"&&okP.set.a===81090.5&&okM.src==="okS"&&okM.set.m===81053.5&&okI.src==="okS"&&okI.set.i===81095.4
      &&bn.src==="bnS"&&bn.set.b===81105.85&&bn.e===null&&mj.src==="maj"&&mj.set.eth===3100.5&&junk.every(x=>x===null)
      &&r.byL.b===81054.7&&r.byL.m===81059.93&&r.byL.age===800&&r.byL.lag===9100&&r.maj.eth===3100.5&&r.maj.sol===150.5&&r.maj.age===600&&r.maj.lag===undefined&&none===null&&COLLECT.REGISTRY.some(c=>c.id==="venues"&&c.speed==="fast"),detail:J({cb,by1,by2,okT,bn,mj,r,eth5:eth[5].url})};
  });
  add("collectors: wallets: ranking over a window, position read from clearinghouseState, change rule, liquidation fills, predicted funding",E=>{
    const J=JSON.stringify,tr=COLLECT.walletTracker(1000);
    tr.note(100,["A","B"],500,100);tr.note(200,["A","C"],300,200);tr.note(300,["D","B"],100,300);tr.note(0,["Z"],-5,300);tr.note(0,"x",5,300);tr.note(NaN,["Q"],5,300);
    const top=tr.top(2,300),all=tr.top(10,300),later=tr.top(10,1250),empty=tr.top(10,5000);
    const pos=COLLECT.walletPosition({marginSummary:{accountValue:"22336.099666",totalMarginUsed:"16120.992149"},assetPositions:[{type:"oneWay",position:{coin:"ETH",szi:"2"}},{type:"oneWay",position:{coin:"BTC",szi:"1.53554",leverage:{type:"cross",value:20},entryPx:"81417.1",unrealizedPnl:"-370.23201",liquidationPx:"22313.3773732013"}}]},"BTC");
    const flat=COLLECT.walletPosition({marginSummary:{accountValue:"10",totalMarginUsed:"0"},assetPositions:[]},"BTC"),badPos=[COLLECT.walletPosition({},"BTC"),COLLECT.walletPosition(null,"BTC")];
    const ch=(a,b,age)=>COLLECT.walletChanged(a,b,age),p2=Object.assign({},pos,{av:99});
    const msg=live=>({channel:"userFills",data:Object.assign(live,{user:"0xabc",fills:[{coin:"BTC",px:"81000",sz:"0.5",side:"A",time:5,dir:"Close Long",closedPnl:"-3",startPosition:"0.5"},{coin:"ETH",px:"3000.5",sz:"2",side:"A",time:6,dir:"Close Long",closedPnl:"-9",startPosition:"2",liquidation:{liquidatedUser:"0xabc",markPx:"3001",method:"market"}}]})});
    const lf=COLLECT.liqFills(msg({isSnapshot:false})),snap=COLLECT.liqFills(msg({isSnapshot:true})),other=[COLLECT.liqFills({channel:"trades",data:[]}),COLLECT.liqFills(null),COLLECT.liqFills({channel:"userFills",data:{}})];
    const pf=COLLECT.predictedFunding([["ETH",[["HlPerp",{fundingRate:"0.1",nextFundingTime:1,fundingIntervalHours:1}]]],["BTC",[["BinPerp",{fundingRate:"0.00005",nextFundingTime:1792800000000,fundingIntervalHours:4}],["HlPerp",{fundingRate:"0.0000125",nextFundingTime:1792796400000,fundingIntervalHours:1}],["Odd",{}]]]],"BTC");
    return{ok:J(top)==='[{"w":"A","n":800},{"w":"B","n":600}]'&&all.length===4&&J(later.map(x=>x.w))==='["B","D"]'&&later[1].n===100&&empty.length===0&&tr.size()===0
      &&pos.sz===1.53554&&pos.e===81417.1&&pos.lq===22313.3773732013&&pos.lev===20&&pos.up===-370.23201&&pos.av===22336&&pos.mg===16121&&flat.sz===0&&flat.e===null&&flat.lq===null&&badPos.every(x=>x===null)
      &&ch(null,pos,0)&&!ch(pos,p2,1000)&&ch(pos,Object.assign({},pos,{sz:2}),1000)&&ch(pos,Object.assign({},pos,{lq:1}),1000)&&ch(pos,p2,COLLECT.WALLET_REFRESH_MS)
      &&lf.length===1&&lf[0].coin==="ETH"&&lf[0].w==="0xabc"&&lf[0].liquidated==="0xabc"&&lf[0].mark===3001&&lf[0].px===3000.5&&snap.length===0&&other.every(x=>x.length===0)
      &&J(pf)==='{"Bin":[0.00005,1792800000000,4],"Hl":[0.0000125,1792796400000,1]}'&&COLLECT.predictedFunding([],"BTC")===null&&COLLECT.predictedFunding([["ETH",[]]],"BTC")===null&&COLLECT.REGISTRY.some(c=>c.id==="wallets"&&c.speed==="slow"),detail:J({top,all,later,pos,flat,lf,pf})};
  });
  add("collectors: options chain: expiry names, at-the-money vol, skew by moneyness, open interest and busiest strikes per expiry",E=>{
    const J=JSON.stringify,now=Date.UTC(2026,9,24,8,0,0);
    const mk=(exp,k,cp,iv,oi,vol,F)=>({instrument_name:"BTC-"+exp+"-"+k+"-"+cp,mark_iv:iv,open_interest:oi,volume:vol,underlying_price:F,estimated_delivery_price:81000});
    const ks=[80,90,95,100,105,110,120],puts={80:60,90:50,95:45,100:39,105:37,110:38,120:44},calls={80:55,90:48,95:44,100:41,105:38,110:39,120:45};
    const chain=[];for(const k of ks){chain.push(mk("27OCT26",k,"P",puts[k],k===90?30:1,2,100));chain.push(mk("27OCT26",k,"C",calls[k],k===110?20:2,3,100));}
    chain.push(mk("30OCT26",100,"C",33,5,1,102),mk("30OCT26",100,"P",31,6,1,102),mk("23OCT26",100,"C",99,9,9,100),{instrument_name:"BTC-PERPETUAL"},{instrument_name:"BTC-27OCT26-x-C"},null);
    for(const x of ["1NOV26","2NOV26","3NOV26","4NOV26","5NOV26"])chain.push(mk(x,100,"C",30,1,1,100));
    const c=COLLECT.optionsChain(chain,now),e=c.exps[0],e2=c.exps[1];
    const on=COLLECT.optName("BTC-5NOV26-73000.5-P"),bad=[COLLECT.optName("BTC-PERPETUAL"),COLLECT.optName("BTC-27XXX26-1-C"),COLLECT.optName(null)];
    return{ok:c.u===81000&&c.exps.length===5&&J(c.exps.map(x=>x.x))==='["27OCT26","30OCT26","1NOV26","2NOV26","3NOV26"]'&&e.dte===3&&e.f===100&&e.atm===40&&e.s["-10"]===50&&e.s["-5"]===45&&e.s["5"]===38&&e.s["10"]===39
      &&e.op===30+1*6&&e.oc===2*6+20&&e.vp===14&&e.vc===21&&J(e.pin[0])==='[90,32]'&&J(e.pin[1])==='[110,21]'&&e.pin.length===5
      &&e2.dte===6&&e2.atm===32&&e2.s["-10"]===null&&e2.s["5"]===null&&c.tot.oc>0&&c.tot.op===36+6&&on.k===73000.5&&on.cp==="P"&&on.t===Date.UTC(2026,10,5,8)&&bad.every(x=>x===null)
      &&COLLECT.optionsChain([],now)===null&&COLLECT.optionsChain(null,now)===null&&COLLECT.optionsChain([mk("23OCT26",100,"C",30,1,1,100)],now)===null
      &&COLLECT.deribitCoin("btc")==="BTC"&&COLLECT.deribitCoin("ETH")==="ETH"&&COLLECT.deribitCoin("sol")===null&&COLLECT.REGISTRY.some(x=>x.id==="options"&&x.speed==="slow"),detail:J({u:c.u,e,e2,tot:c.tot,names:c.exps.map(x=>x.x)})};
  });
  add("collectors: status lines: records are attributed to their collector, and a quiet or idle collector is told apart from a working one",E=>{
    const J=JSON.stringify,R=COLLECT.rec,recs=[R("feeds",100,{}),R("feeds",300,{}),R("markPrice",200,{}),R("bookBn",50,{}),R("venues",70,{}),R("nope",999,{}),["t",{}],["c","cal"],R("cal",400,{})];
    const t=COLLECT.tally(recs),H=COLLECT.health;
    const ok=H({on:true,why:null,n:1234,ageMs:3000,expectMs:60000,sinceMs:1e6}),slow=H({on:true,why:null,n:5,ageMs:400000,expectMs:60000,sinceMs:1e6});
    const idle=H({on:true,why:"waits for a recording",n:0,ageMs:null,expectMs:10000,sinceMs:1e6}),idleN=H({on:true,why:"waits for a recording",n:2500,ageMs:9e6,expectMs:10000,sinceMs:1e6});
    const start=H({on:true,why:null,n:0,ageMs:null,expectMs:60000,sinceMs:20000}),silent=H({on:true,why:null,n:0,ageMs:null,expectMs:60000,sinceMs:400000}),off=H({on:false,why:null,n:9,ageMs:1,expectMs:1,sinceMs:1});
    const owners=Object.values(COLLECT.OWNER);
    return{ok:J(t.telemetry)==='{"n":3,"last":300}'&&t.book.n===1&&t.venues.last===70&&t.calendar.n===1&&Object.keys(t).length===4&&COLLECT.ownerOf("hlLiq")==="wallets"&&COLLECT.ownerOf("zzz")===null
      &&ok.tone==="ok"&&ok.text==="1,234 on the tape · last 3 s ago"&&slow.tone==="warn"&&/slower than expected/.test(slow.text)&&idle.tone==="idle"&&idle.text==="waits for a recording"&&idleN.text==="waits for a recording · 2,500 on the tape"
      &&start.tone==="info"&&silent.tone==="warn"&&off.tone==="off"&&off.text==="off"
      &&COLLECT.ageText(4000)==="4 s"&&COLLECT.ageText(120000)==="2 min"&&COLLECT.ageText(7200000)==="2 h"
      &&COLLECT.REGISTRY.every(c=>owners.includes(c.id)&&COLLECT.EXPECT_MS[c.id]>0),detail:J({t,ok,slow,idle,idleN,start,silent,off})};
  });
  add("collectors: context at a moment: a feature far from its own recent mean is unusual, a constant one that moves is too, stale or future readings are ignored, liquidations are counted",E=>{
    const R=COLLECT.rec,recs=[],T=T0,J=JSON.stringify;
    for(let i=0;i<=240;i++){const t=T+i*10000;      // 40 minutes
      recs.push(R("dvol",t,{vol:(i<234?50+Math.sin(i)*.3:60),idx:1}));
      recs.push(R("hlCtx",t,{fund:i<239?0.0000125:0.0001125,oi:1000+Math.cos(i)*2,prem:Math.sin(i*2)*1e-5}));
      recs.push(R("bookBn",t,{spr:0.01,d:{"5":[10,10]}}));}
    recs.push(R("optChain",T+10000,{exps:[{atm:30,s:{"-5":40,"5":35}}]}));      // one old reading only
    const now=T+40*60000-5000;
    recs.push(R("dvol",now+10000,{vol:999,idx:1}));      // in the future of `now`
    recs.push(R("liq",now-30000,{}),R("liq",now-31000,{}),R("liq",now-90000,{}),R("hlLiq",now-10000,{}));
    const c=COLLECT.context(recs,now),by=f=>c.items.find(x=>x.f===f),early=COLLECT.context(recs,T+20*60000),none=COLLECT.context([],now);
    return{ok:c.items.length>=3&&c.items[0].f==="hlCtx.fund"&&c.items[1].f==="dvol.vol"&&by("dvol.vol").unusual&&by("dvol.vol").z>5&&/^\+(19|20|21|22)(\.\d)?%$/.test(by("dvol.vol").text)
      &&by("hlCtx.fund")&&by("hlCtx.fund").unusual&&by("hlCtx.fund").z===99&&by("hlCtx.fund").text==="+1 bps"
      &&by("bookBn.depth5")&&!by("bookBn.depth5").unusual&&by("bookBn.depth5").z===0&&!by("optChain.atmVol")&&by("dvol.vol").x===60
      &&c.liq.bn===2&&c.liq.hl===1&&early.items.length>=2&&!early.items.find(x=>x.f==="dvol.vol").unusual&&none.items.length===0&&none.liq.bn===0
      &&c.items.every((x,i,a)=>!i||Math.abs(a[i-1].z)>=Math.abs(x.z))&&COLLECT.REGISTRY.length===7&&Object.keys(COLLECT.FEATURES).length===21,
      detail:J({n:c.items.length,top:c.items.slice(0,4).map(x=>[x.f,x.z,x.text,x.unusual]),liq:c.liq,early:early.items.length})};
  });
  add("collectors: who moved first: a venue that covered half of the move earlier led, one within 2 s is with it, a flat or silent one is named, and no clear or only a gradual move says so",E=>{
    const R=COLLECT.rec,J=JSON.stringify,T=T0,tMs=T+60000;
    const ramp=(s,st,base,sg,len)=>base*(1+sg*6e-4*Math.min(1,Math.max(0,(s-st)/(len||21))));
    const mk=(sg,o)=>{o=o||{};const recs=[];for(let i=0;i<=60;i++){const s=i,q=(b,st,age)=>{const p=ramp(s,o.slow?st-20:st,b,sg,o.slow?70:0);return{b:p-.5,a:p+.5,age:age==null?50:age};};
      const v={bnS:q(80000,20),cb:q(80100,14),byL:q(80020,20),okS:q(80010,26),okP:q(80030,-100)};if(o.stale)v.bnS.age=9000;if(o.flat)for(const k in v)v[k]=q(80000,-100);recs.push(R("venues",T+i*1000,v));}
      recs.push(R("venues",tMs+5000,{bnS:{b:1,a:2,age:1}}));return recs;};      // the last record is in the future
    const up=COLLECT.venueLead(mk(1),tMs),dn=COLLECT.venueLead(mk(-1),tMs),flat=COLLECT.venueLead(mk(1,{flat:1}),tMs),stale=COLLECT.venueLead(mk(1,{stale:1}),tMs),slow=COLLECT.venueLead(mk(1,{slow:1}),tMs),empty=COLLECT.venueLead([R("dvol",T,{vol:1})],tMs);
    const kinds=r=>r.items.map(x=>x.src+":"+x.kind+":"+x.lead).join(",");
    const ctx=COLLECT.context(mk(1),tMs);
    return{ok:up.ref==="bnS"&&up.move>5.9&&up.move<6.1&&kinds(up)==="cb:led:6,byL:with:0,okS:lagged:-6,okP:flat:undefined"&&kinds(dn)===kinds(up)&&dn.move<-5.9
      &&flat.none==="no clear move"&&slow.none==="gradual move, no timing"&&flat.items.length===0&&stale.none==="too few readings from Binance spot"&&empty===null&&COLLECT.venueLead([],tMs)===null
      &&COLLECT.leadText(up.items[0])==="Coinbase led by ~6 s"&&COLLECT.leadText(up.items[2])==="OKX swap lagged by ~6 s"&&COLLECT.leadText(up.items[1])==="Bybit perp with it"&&COLLECT.leadText(up.items[3])==="OKX spot flat"
      &&ctx.lead&&ctx.lead.items.length===4&&COLLECT.context([],tMs).lead===null,detail:J({slow:slow.none,up:kinds(up),dn:kinds(dn),flat,stale,ctx:ctx.lead&&ctx.lead.items.length})};
  });
  add("collectors: forced flow: Binance and own-coin Hyperliquid liquidations in the minute before are summed by side, the tag needs the floor and ten times the hour's pace, other coins are only counted",E=>{
    const R=COLLECT.rec,J=JSON.stringify,T=T0,tMs=T+3600000;
    const bn=(t,side,qty,px)=>R("liq",t,{side,qty,px,status:"FILLED"}),hl=(t,coin,side,sz,px)=>R("hlLiq",t,{w:"0xa",coin,side,sz,px,liquidated:"0xb"});
    const base=[R("feeds",T,{})];      // data reaches back an hour
    for(let m=0;m<50;m+=5)base.push(bn(T+m*60000+1000,"SELL",1,80000));      // a quiet hour: 10 small ones, 80k each, 800k in 60 minutes (about 13k a minute)
    const spike=base.concat([bn(tMs-30000,"SELL",5,80000),hl(tMs-20000,"BTC","B",4,80000),hl(tMs-10000,"ETH","B",50,2300),bn(tMs+5000,"SELL",99,80000),bn(tMs-70000,"SELL",1,80000)]);      // the last two: in the future, and just outside the window (counts as history)
    const a=COLLECT.liqDriven(spike,tMs,{coin:"BTC"}),small=COLLECT.liqDriven(base.concat([bn(tMs-30000,"SELL",2,80000)]),tMs),buy=COLLECT.liqDriven(base.concat([bn(tMs-30000,"BUY",8,80000)]),tMs);
    const busy=[R("feeds",T,{})];for(let m=0;m<59;m++)busy.push(bn(T+m*60000+1000,"SELL",20,80000));      // always liquidating: 1.6M a minute
    const hot=COLLECT.liqDriven(busy.concat([bn(tMs-30000,"SELL",10,80000)]),tMs),short=COLLECT.liqDriven([R("feeds",tMs-120000,{}),bn(tMs-30000,"SELL",10,80000)],tMs),none=COLLECT.liqDriven([],tMs);
    const eth=COLLECT.liqDriven([R("feeds",T,{}),hl(tMs-5000,"ETH","B",300,2300)],tMs,{coin:"BTC"});
    return{ok:a.usd===720000&&a.bn.sell===400000&&a.bn.n===1&&a.hl.sell===320000&&a.hl.buy===0&&a.other===1&&a.side==="sells"&&a.tag&&a.x>40&&a.avg<20000&&a.histMin===59
      &&!small.tag&&small.usd===160000&&buy.tag&&buy.side==="buys"&&buy.buy===640000&&!hot.tag&&hot.usd===800000&&hot.x<1&&short.tag&&short.avg===null&&short.histMin<10
      &&none.usd===0&&none.side===null&&!none.tag&&!eth.tag&&eth.usd===0&&eth.other===1&&COLLECT.context([],tMs).liqx.usd===0&&COLLECT.usdText(1234567)==="$1.2M"&&COLLECT.usdText(48500)==="$49k"&&COLLECT.usdText(950)==="$950",
      detail:J({a,small:small.usd,hot:[hot.tag,hot.x],short:[short.tag,short.avg,short.histMin],eth})};
  });
  add("collectors: wall quality: share of the edge's depth, depth against usual, and what it did by the end; named verdicts; no reading says why",E=>{
    const R=COLLECT.rec,J=JSON.stringify,T=T0,tS=T+35*60000,tE=tS+60000;
    const mk=(dEnd,midEnd,o)=>{o=o||{};const recs=[];for(let t=T;t<=tS+120000;t+=o.step||2000){const late=t>=tS+50000,mid=t>=tS+30000?midEnd:80000,dep=t<tS?10:late?dEnd:14;
      const e=x=>({"1":[o.nullBid?null:x,x],"5":[x*3,x*3],"10":[x*5,x*5],"20":[x*8,x*8]});if(t>=(o.from||T))recs.push(R(o.name||"bookBn",t,{mid,spr:.01,d:e(dep)}));}return recs;};
    const g=(o)=>Object.assign({venue:"bn",wall:{side:"bid",px:79996,peak:4},tStart:tS,tEnd:tE,tUpdate:tE},o||{});
    const Q=COLLECT.wallQuality,pulled=Q(mk(3,80030),g()),atWall=Q(mk(3,80010),g()),held=Q(mk(13,80000),g()),part=Q(mk(9,80000),g());
    const ask=Q(mk(3,79980),g({wall:{side:"ask",px:80004,peak:4}})),open=Q(mk(3,80030),g({tEnd:null})),far=Q(mk(3,80030),g({wall:{side:"bid",px:79700,peak:4}})),nul=Q(mk(3,80030,{nullBid:1}),g());
    const brief=Q(mk(3,80030,{from:tS-30000}),g()),weak=Q(mk(3,80030),g({wall:{side:"bid",px:79996,peak:1}})),none=Q([],g()),late=Q(mk(3,80030,{from:tS+60000}),g()),other=Q(mk(3,80030,{name:"bookHl"}),g()),hl=Q(mk(3,80030,{name:"bookHl"}),g({venue:"hl"})),nowall=Q(mk(3,80030),{venue:"bn"});
    return{ok:pulled.verdict==="pulled before price arrived"&&pulled.edge===1&&pulled.share===.29&&pulled.usual===10&&pulled.x===1.4&&pulled.depth0===14&&pulled.end.depth===3&&pulled.end.ret===.21&&pulled.end.dist>4&&!pulled.open
      &&atWall.verdict==="gone with price at the wall"&&atWall.end.dist>1&&atWall.end.dist<2&&held.verdict==="depth held"&&part.verdict==="partly gone"
      &&ask.verdict==="pulled before price arrived"&&ask.end.dist>2.9&&ask.depth0===14&&open.open===true&&open.verdict==="pulled before price arrived"
      &&/beyond the 20 bps/.test(far.none)&&/did not reach 1 bps on that side/.test(nul.none)&&brief.usual===null&&brief.x===null&&brief.share===.29&&brief.verdict
      &&/no book records/.test(none.none)&&/no book records/.test(other.none)===true&&/no book record within 10 s/.test(late.none)&&hl.verdict&&nowall===null&&weak.weak===true&&weak.verdict===null&&weak.end.ret===.21&&pulled.weak===false,
      detail:J({pulled,atWall:atWall.end,far:far.none,nul:nul.none,brief:[brief.usual,brief.x],late:late.none,other:other.none})};
  });
  add("collectors: market state (rules v1): two of volatility / forced flow / venue gap is stressed, funding with open interest is crowded, one is unsettled, none is calm, too few readings is unknown",E=>{
    const R=COLLECT.rec,J=JSON.stringify,T=T0,now=T+40*60000-5000;
    const mk=o=>{const recs=[];for(let i=0;i<=240;i++){const t=T+i*10000,late=i>=234;
      recs.push(R("dvol",t,{vol:late&&o.V?60:50+Math.sin(i)*.3,idx:1}));
      recs.push(R("hlCtx",t,{fund:late&&o.C?0.0001125:0.0000125+Math.sin(i)*1e-7,oi:1000+(late&&o.C?10:0)+Math.cos(i)*2,prem:0}));
      if(!o.noVen)recs.push(R("venues",t,{bnS:{b:80000,a:80000.02,age:50},cb:{l:80000+(late&&o.F?8:Math.sin(i)*.4),age:50}}));}
      if(o.L){for(let m=0;m<40;m+=5)recs.push(R("liq",T+m*60000+1000,{side:"SELL",qty:1,px:80000}));recs.push(R("liq",now-90000,{side:"SELL",qty:9,px:80000}));}      // a quiet hour, then 720k forced a minute and a half before
      return recs;};
    const st=o=>COLLECT.marketState(mk(o),now,{coin:"BTC"});
    const all=st({V:1,L:1,F:1,C:1}),two=st({V:1,F:1}),crowd=st({C:1}),one=st({V:1}),calm=st({}),oneL=st({L:1}),few=st({noVen:1}),none=COLLECT.marketState([],now),early=COLLECT.marketState(mk({V:1,F:1,C:1}),T+20*60000);
    const series=COLLECT.marketStateSeries(mk({V:1,F:1}),T+36*60000,T+39*60000,60000,{coin:"BTC"});
    return{ok:all.s==="stressed"&&all.i==="VLFC"&&two.s==="stressed"&&two.i==="VF"&&crowd.s==="crowded"&&crowd.i==="C"&&one.s==="unsettled"&&one.i==="V"&&oneL.s==="unsettled"&&oneL.i==="L"
      &&calm.s==="calm"&&calm.i===""&&calm.n===4&&few.n===3&&few.ind.F===null&&few.s==="calm"&&none.s==="unknown"&&none.n===0&&all.v===1&&COLLECT.STATE_VERSION===1
      &&early.s!=="stressed"&&series.length===4&&series[0].t===T+36*60000&&series[3].s==="stressed"&&series[0].s==="calm",
      detail:J({all:[all.s,all.i],two:[two.s,two.i],crowd:[crowd.s,crowd.i],one:[one.s,one.i],oneL:[oneL.s,oneL.i],calm:[calm.s,calm.n],few:[few.s,few.n,few.ind],none:none.s,early:early.s,series:series.map(x=>x.s+x.i)})};
  });
  add("collectors: event clock: next funding, expiry, bigger expiry and US stock event by rule (daylight saving followed); events near a moment with their offset; macro releases are not invented",E=>{
    const J=JSON.stringify,U=Date.UTC,mon=U(2026,9,26,6,30),c=COLLECT.eventClock(mon);      // Monday 26 Oct 2026, 06:30 UTC, New York still on summer time
    const n1=COLLECT.eventsNear(U(2026,9,26,8,3),600000),n2=COLLECT.eventsNear(U(2026,9,26,8,20),600000),n3=COLLECT.eventsNear(U(2026,9,26,13,35),600000),tue=COLLECT.eventClock(U(2026,10,3,6,0)),sat=COLLECT.eventClock(U(2026,9,24,12,0)),fri=COLLECT.eventClock(U(2026,9,30,7,0)),q=COLLECT.eventClock(U(2026,11,20,12,0));
    const tags=a=>a.map(x=>x.tag+":"+x.off/1000).join(",");
    return{ok:c.funding.t===U(2026,9,26,8)&&c.funding.in===90*60000&&c.expiry.tag==="optExp:daily"&&c.expiry.t===U(2026,9,26,8)&&c.bigger.tag==="optExp:monthly"&&c.bigger.t===U(2026,9,30,8)
      &&c.stocks.tag==="usOpen"&&c.stocks.t===U(2026,9,26,13,30)&&tue.stocks.t===U(2026,10,3,14,30)&&sat.stocks.tag==="usOpen"&&sat.stocks.t===U(2026,9,26,13,30)
      &&tags(n1)==="funding:180,optExp:daily:180"&&n2.length===0&&tags(n3)==="usOpen:300"&&fri.expiry.tag==="optExp:monthly"&&fri.bigger===null&&q.bigger.tag==="optExp:quarterly"&&q.bigger.t===U(2026,11,25,8)
      &&COLLECT.evSpan(90*60000)==="1 h 30 min"&&COLLECT.evSpan(45*60000)==="45 min"&&COLLECT.evSpan(3*86400000+5*3600000)==="3 d 5 h"&&!JSON.stringify(c).match(/cpi|fomc/i),
      detail:J({c:[c.funding.in,c.expiry.tag,c.bigger&&c.bigger.tag,c.stocks.tag,c.stocks.t-mon],n1:tags(n1),n3:tags(n3),tue:tue.stocks.t-U(2026,10,3,6),sat:sat.stocks.t,fri:fri.expiry.tag,q:q.bigger&&q.bigger.tag})};
  });
  add("collectors: options lens: realized volatility from 1-minute returns against the index, fixed words, too little price or a stale index is no reading, skew shift, and the series",E=>{
    const R=COLLECT.rec,J=JSON.stringify,T=Math.ceil(T0/60000)*60000,now=T+40*60000;
    const px=(m,from)=>{const a=[];let p=80000;for(let k=0;k<=40;k++){const mm=typeof m==="function"?m(k):m;p*=Math.exp((k%2?1:-1)*mm);if(!from||k>=from)a.push([T+k*60000,p]);}return a;};      // alternating returns of size m: realized vol is m * sqrt(525960) * 100 percent
    const dv=(v,t)=>[R("dvol",t==null?now-30000:t,{vol:v,idx:1})];
    const opt=(late)=>{const a=[];for(let i=0;i<=20;i++)a.push(R("optChain",T+i*120000,{exps:[{atm:40,s:{"-5":i>=19&&late?44:40,"5":35}}]}));return a;};
    const hi=COLLECT.volLens(dv(50),px(.001),now),lo=COLLECT.volLens(dv(50),px(.0005),now),mid=COLLECT.volLens(dv(50),px(.0007),now),few=COLLECT.volLens(dv(50),px(.001,25),now),stale=COLLECT.volLens(dv(50,now-600000),px(.001),now),nopx=COLLECT.volLens(dv(50),[],now);
    const sk=COLLECT.volLens(opt(true).concat(dv(50)),px(.001),now),flat=COLLECT.volLens(opt(false).concat(dv(50)),px(.001),now),future=COLLECT.volLens(dv(50,now+1000),px(.001),now);
    const dvs=[];for(let k=20;k<=40;k++)dvs.push(R("dvol",T+k*60000,{vol:k<33?100:30,idx:1}));const ser=COLLECT.lensSeries(dvs,px(.0007),T+30*60000,now,300000);      // the index falls from 100 to 30 at minute 33
    return{ok:hi.realized>72.4&&hi.realized<72.7&&hi.ratio>1.44&&hi.ratio<1.46&&hi.word==="above"&&hi.implied===50&&hi.n>=29&&lo.word==="below"&&lo.realized>36.2&&lo.realized<36.4&&mid.word==="inline"&&mid.ratio>1&&mid.ratio<1.05
      &&few.realized===null&&few.ratio===null&&few.word===null&&few.implied===50&&stale.implied===null&&stale.ratio===null&&stale.realized>72&&nopx.realized===null&&future.implied===null
      &&sk.skew&&sk.skew.x===9&&sk.skew.side==="puts richer"&&sk.skew.unusual===true&&flat.skew&&flat.skew.x===5&&flat.skew.unusual===false&&hi.skew===null
      &&ser.length===3&&ser[0].t===T+30*60000&&ser[0].w==="below"&&ser[1].w==="above"&&ser[2].w==="above"&&ser.every(x=>x.ratio!=null)&&COLLECT.LENS_TEXT.above==="realized above implied",
      detail:J({hi:[hi.realized,hi.ratio,hi.word,hi.n],lo:[lo.realized,lo.word],mid:[mid.ratio,mid.word],few:few.n,stale:[stale.implied,stale.ratio],sk:sk.skew,flat:flat.skew,future:future.implied,ser:ser.map(x=>x.w+":"+x.ratio)})};
  });
  add("collectors: followed wallets: net position and the change over matched wallets only, stale readings drop out, the crowd's taker flow, fixed words, and the series",E=>{
    const R=COLLECT.rec,J=JSON.stringify,T=T0,t=T+30*60000,P=80000;
    const row=(w,sz)=>({w,sz,e:80000,lq:null,lev:3,up:0,av:1e7,n:1});
    const recs=[R("walletsTop",t-600000,{rows:[row("a",10),row("b",-5),row("c",2)]}),R("walletsTop",t-300000,{rows:[row("a",10),row("b",-5)]}),R("walletsTop",t-60000,{rows:[row("a",30),row("b",-5),row("d",-8)]}),R("dvol",t,{vol:1,idx:1})];      // c drops out, d appears
    const w=COLLECT.whaleFlow(recs,t,{px:P,crowdNet:-3e6}),flatW=COLLECT.whaleFlow(recs,t,{px:P,crowdNet:2e5,floorUsd:5e7}),noPx=COLLECT.whaleFlow(recs,t,{crowdNet:1e6}),none=COLLECT.whaleFlow([],t,{px:P}),stale=COLLECT.whaleFlow(recs,t+3600000,{px:P});
    const trades=[],push=(tt,side,ntl,liq)=>trades.push(["t",{t:tt,v:"hl",side,px:P,q:ntl/P,ntl,liq:!!liq}]);
    push(t-500000,"buy",3e6);push(t-400000,"sell",1e6);push(t-300000,"buy",5e5,true);push(t-100000,"sell",2e6);trades.push(["t",{t:t-100000,v:"bn",side:"buy",px:P,q:1,ntl:P}]);trades.push(["q","bn",1,2,3]);
    const tk=COLLECT.takerNet(trades,"hl",t-600000,t),ix=COLLECT.crowdIndex(trades,"hl"),ca=COLLECT.crowdNetAt(ix,t-600000,t),cb=COLLECT.crowdNetAt(ix,t-450000,t-350000);
    const ser=COLLECT.whaleSeries(recs,ix,t-120000,t,60000,{px:P});
    return{ok:w.n===3&&w.longs===1&&w.shorts===2&&w.net===17&&w.netUsd===17*P&&w.matched===2&&w.delta===20&&w.deltaUsd===20*P&&w.whales==="buying"&&w.crowd==="selling"&&w.relation==="opposite directions"
      &&flatW.whales==="flat"&&flatW.crowd==="flat"&&flatW.relation==="one side flat"&&noPx.whales===null&&noPx.deltaUsd===null&&noPx.crowd==="buying"&&noPx.relation===null&&none===null&&stale===null
      &&tk.net===-2e6+2e6-0&&tk.gross===6e6&&tk.n===3&&ca.net===tk.net&&ca.gross===tk.gross&&cb.net===-1e6&&ser.length===3&&ser[2].w==="buying"&&ser[2].c==="flat"&&ser[0].w===null,
      detail:J({w,flatW:[flatW.whales,flatW.crowd],noPx:[noPx.whales,noPx.crowd],tk,ca,cb,ser:ser.map(x=>x.w+"/"+x.c)})};
  });
  add("recording: trimming drops the inputs older than the cutoff and keeps the rest in order (a rolling lead-in)",E=>{
    const e=E.create();e.startRecording();const a=calm(e,200),cut=a.t-60000,n0=e.recording().n,drop=e.trimRecording(cut),n1=e.recording().n,again=e.trimRecording(cut);
    const r=e.stopRecording(),tm=x=>x[0]==="t"?x[1]&&x[1].t:x[0]==="a"?x[1]:x[0]==="x"?null:x[2],ts=r.map(tm).filter(x=>x!=null);
    const none=E.create().trimRecording(cut);
    return{ok:drop>0&&n1===n0-drop&&again===0&&ts.length>0&&Math.min(...ts)>=cut&&none===0&&E.replayEngine(r).events!=null,detail:`${n0} inputs, ${drop} dropped, ${n1} kept`};
  });
  add("collectors: records among the inputs change no detection and no session quality",E=>{
    const e=E.create();e.startRecording();const a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:22});
    const inputs=e.stopRecording(),mixed=[];inputs.forEach((r,i)=>{mixed.push(r);if(i%40===0)mixed.push(COLLECT.rec("feeds",T0+i,{src:"page",feeds:{bn:{n:1}}}));});
    const sig=x=>JSON.stringify(E.replayEngine(x).episodes.map(p=>[p.family,p.venue,p.aggressor,p.tStart,p.tEnd,p.stage,p.outcome]));
    return{ok:mixed.length>inputs.length&&sig(inputs)===sig(mixed)&&sig(inputs).length>10&&SQ.of(inputs).dataMinutes===SQ.of(mixed).dataMinutes,detail:`${inputs.length} inputs, ${mixed.length} with records`};
  });
  add("flickering walls (a few seconds) do not become episodes",E=>{
    const e=E.create(),a=calm(e);let t=a.t,mid=a.mid;
    for(let i=0;i<4;i++){const w=sim(e,{t0:t,mid0:mid,seconds:6,seed:50+i,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})}),g=sim(e,{t0:w.t,mid0:w.mid,seconds:3,seed:60+i,params:()=>({vol:0})});t=g.t;mid=g.mid;}
    return epResult(eps(e,"wall").length===0,e,"no wall episodes from walls that last only 6 s");
  });
  add("wall episodes wait for calibration",E=>{
    const e=E.create();sim(e,{seconds:60,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})});
    return epResult(e.episodes.length===0,e,"no episodes while the engine is still calibrating");
  });
  add("exhaustion episode after a buying surge fades; none for the side that never led; fast horizon is off by default",E=>{
    const run=cfg=>{const e=E.create(cfg),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:14,seed:31,params:()=>({rate:200,buyP:.9,driftBps:6})});sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:32,params:()=>({rate:12,vol:.05})});return e;};
    const e=run({ep:{famHorizons:{exhaustion:["fast"]}}}),d=run();
    return epResult(eps(e,"exhaustion",p=>p.aggressor==="buy").length>0&&eps(e,"exhaustion",p=>p.aggressor==="sell").length===0&&eps(d,"exhaustion",p=>p.horizon==="fast").length===0,e,"a buy exhaustion episode (fast enabled), none for sellers, and no fast exhaustion with default settings");
  });
  add("quiet market produces no episodes",E=>{const e=E.create();sim(e,{seconds:300,seed:5});return epResult(e.episodes.length===0,e,"no episodes at all");});
  add("a data gap ends every open episode as 'gap'",E=>{
    const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});e.advance(b.t+45000);
    return epResult(e.episodes.length>0&&e.episodes.every(x=>x.stage==="ended")&&e.episodes.some(x=>x.outcome==="gap"),e,"all episodes ended, at least one with outcome gap");
  });
  add("replaying recorded inputs reproduces the same episodes",E=>{
    const e=E.create();e.startRecording();const a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:30,seed:22});
    const r=E.replayEngine(e.stopRecording()),sig=l=>l.map(p=>[p.family,p.venue,p.horizon,p.aggressor,p.tStart,p.tDetected,p.tEnd,p.stage,p.pulses].join("|")).join(";");
    return epResult(e.episodes.length>0&&sig(e.episodes)===sig(r.episodes),e,"the replayed engine to hold identical episodes");
  });
  add("a decimated recording is much smaller and still replays the burst",E=>{
    const raw=E.create(),dec=E.create();raw.startRecording();dec.startRecording({quoteMs:100});
    for(const e of [raw,dec]){const a=sim(e,{seconds:150,seed:3,stepMs:50}),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,stepMs:50,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:30,seed:22,stepMs:50});}
    const rr=raw.stopRecording(),dr=dec.stopRecording(),q=r=>r.filter(x=>x[0]==="q").length,rep=E.replayEngine(dr);
    return epResult(q(dr)<q(rr)*.6&&rep.episodes.some(x=>x.family==="burst"&&x.aggressor==="sell"),dec,`decimated quotes (${q(dr)}) well under raw (${q(rr)}) and a replayed sell burst`);
  });
  add("price history is kept once a second",E=>{
    const e=E.create();sim(e,{seconds:60,seed:5});const h=e.priceHistory("bn");
    return epResult(h.length>=55&&h.length<=61&&h.every((x,i)=>i===0||x[0]-h[i-1][0]===1000),e,"about 60 one-second price points");
  });
  // ---- episode groups and end resolutions (derived after the fact; the per-track episodes above are untouched) ----
  const grp=(e,family,pred)=>e.episodeGroups().filter(g=>g.family===family&&(!pred||pred(g)));
  const grpSig=e=>e.episodeGroups().map(g=>[g.id,g.members.map(m=>m.id).join("+"),g.stage,g.tStart,g.tEnd,g.resolution,g.resolutionSigma==null?"":g.resolutionSigma.toFixed(6)].join("|")).join(";");
  const grpResult=(ok,e,want)=>({ok,detail:ok?"ok":`wanted ${want}; got groups [${e.episodeGroups().map(g=>`${g.id}:${g.family}:${g.aggressor}:${g.venues}:${g.horizons}:${g.members.length}:${g.stage}:${g.resolution}`).join(", ")}] from [${Array.from(e.episodes,x=>`${x.id}:${x.family}/${x.venue}/${x.horizon}`).join(", ")}]`});
  add("group: one burst seen on the fast and mid horizons is one group of two; the episodes underneath stay separate",E=>{
    const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:22});
    const g=grp(e,"burst",p=>p.aggressor==="sell"),x=g[0];
    return grpResult(g.length===1&&x.members.length===2&&x.horizons.join()==="fast,mid"&&x.venues.join()==="bn"&&eps(e,"burst",p=>p.aggressor==="sell").length===2&&x.id==="g"+x.primary&&x.tStart===Math.min(...x.members.map(m=>m.tStart)),e,"one sell-burst group with two members (fast, mid) and two separate episodes");
  });
  add("group: the same phenomenon on both venues joins; opposite sides and far-apart repeats do not",E=>{
    const e=E.create(),a=sim(e,{seconds:150,seed:3}),a2=sim(e,{t0:a.t,mid0:a.mid,venue:"hl",seconds:150,seed:3});
    const b=sim(e,{t0:a2.t,mid0:a2.mid,seconds:20,seed:41,params:()=>heavySell}),c=sim(e,{t0:b.t,mid0:b.mid,venue:"hl",seconds:20,seed:42,params:()=>heavySell});
    const d=sim(e,{t0:c.t,mid0:c.mid,seconds:60,seed:44}),f=sim(e,{t0:d.t,mid0:d.mid,seconds:20,seed:45,params:()=>({rate:120,buyP:.92,vol:.02})}),h=sim(e,{t0:f.t,mid0:f.mid,seconds:40,seed:46});
    const g=grp(e,"absorption"),sell=g.filter(p=>p.aggressor==="sell"),buy=g.filter(p=>p.aggressor==="buy");
    return grpResult(sell.length>=1&&sell.some(p=>p.venues.length===2)&&sell.every(p=>p.members.every(m=>m.aggressor==="sell"))&&buy.every(p=>p.members.every(m=>m.aggressor==="buy"))&&g.length<eps(e,"absorption").length&&h.t>0,e,"a sell absorption group over bn and hl, never mixing buyers and sellers");
  });
  add("group: bursts a minute apart are separate groups",E=>{
    const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell}),c=sim(e,{t0:b.t,mid0:b.mid,seconds:70,seed:22}),d=sim(e,{t0:c.t,mid0:c.mid,seconds:12,seed:23,params:()=>burstSell});sim(e,{t0:d.t,mid0:d.mid,seconds:40,seed:24});
    const g=grp(e,"burst",p=>p.aggressor==="sell");
    return grpResult(g.length===2&&g[0].tEnd<g[1].tStart-10000,e,"two sell-burst groups, the first ended more than 10 s before the second began");
  });
  add("group: a wall is a group of one",E=>{
    const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:75,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})});sim(e,{t0:b.t,mid0:b.mid,seconds:4,seed:12,params:()=>({vol:0})});
    const g=grp(e,"wall");
    return grpResult(g.length===1&&g[0].members.length===1&&g[0].wall&&g[0].resolution===null,e,"exactly one wall group with one member and no price resolution");
  });
  add("resolution: price keeps going with the aggressor, goes back against it, or stays put after an episode fades",E=>{
    const run=drift=>{const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:60,seed:22,params:()=>({driftBps:drift})});return e;};
    const pick=e=>eps(e,"burst",p=>p.horizon==="fast"&&p.aggressor==="sell")[0],w=pick(run(-1.5)),n=pick(run(1.5)),f=pick(run(0));
    return epResult(!!w&&!!n&&!!f&&w.outcome==="faded"&&w.resolution==="resolved-with"&&n.resolution==="resolved-against"&&f.resolution==="flat"&&w.resolutionSigma>0&&n.resolutionSigma<0,run(0),`with/against/flat after the burst; got ${[w,n,f].map(x=>x&&x.resolution+":"+(x.resolutionSigma==null?"":x.resolutionSigma.toFixed(2)))}`);
  });
  add("resolution: it waits for the look-ahead, is skipped when the data has a gap,",E=>{
    const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell}),c=sim(e,{t0:b.t,mid0:b.mid,seconds:14,seed:22}),x=eps(e,"burst",p=>p.horizon==="fast"&&p.aggressor==="sell")[0];
    const early=x&&x.stage==="ended"&&x.resolution==null&&c.t<x.tEnd+30000;
    const g=E.create(),ga=calm(g),gb=sim(g,{t0:ga.t,mid0:ga.mid,seconds:12,seed:21,params:()=>burstSell});sim(g,{t0:gb.t,mid0:gb.mid,seconds:8,seed:22});g.advance(gb.t+90000);
    return epResult(!!early&&g.episodes.length>0&&g.episodes.every(p=>p.resolution==null),e,"no resolution yet 14 s after the end, and none at all across a data gap");
  });
  add("groups and resolutions replay identically from recorded inputs",E=>{
    const e=E.create();e.startRecording();const a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:60,seed:22});
    const r=E.replayEngine(e.stopRecording());
    return grpResult(e.episodeGroups().length>0&&grpSig(e)===grpSig(r)&&e.episodeGroups().some(g=>g.resolution),e,"the replayed engine to hold identical groups and resolutions");
  });
  // ---- new evidence items (v016): fills (absorption), trade count (exhaustion), re-posts (wall) ----
  const atStart=(e,fam,pred)=>{const out=[];e.subscribeEpisodes((x,ch)=>{if(ch==="started"&&x.family===fam&&(!pred||pred(x)))out.push({ep:x,items:x.evidence.map(i=>Object.assign({},i))});});return out;};
  const itemOf=(snap,k)=>snap&&snap.items.find(i=>i.k===k);
  add("absorption: flow spread over many small fills passes the 'fills' item; one huge trade in the window fails it",E=>{
    const run=lump=>{const e=E.create(),a=calm(e),got=atStart(e,"absorption",p=>p.venue==="bn"&&p.horizon==="fast"&&p.aggressor==="sell");
      const h=sim(e,{t0:a.t,mid0:a.mid,seconds:20,seed:41,params:(sec,mid)=>Object.assign({},heavySell,{trades:lump&&sec>1.9&&sec<2.1?[{side:"sell",px:mid-.05,q:60,ntl:60*(mid-.05)}]:[]})});sim(e,{t0:h.t,mid0:h.mid,seconds:40,seed:44});return {e,s:got[0]};};
    const a=run(false),b=run(true),fa=itemOf(a.s,"fills"),fb=itemOf(b.s,"fills");
    return epResult(!!fa&&!!fb&&fa.ok&&!fa.na&&!fb.ok&&fa.w===1&&!fa.gate,b.e,`fills true without the lump (${fa&&fa.val}) and false with it (${fb&&fb.val})`);
  });
  add("exhaustion: trade count falling passes the 'count' item; the same notional fade with the same number of trades fails it",E=>{
    const run=after=>{const e=E.create({ep:{famHorizons:{exhaustion:["fast"]}}}),a=calm(e),got=atStart(e,"exhaustion",p=>p.aggressor==="buy"),b=sim(e,{t0:a.t,mid0:a.mid,seconds:14,seed:31,params:()=>({rate:200,buyP:.9,driftBps:6})});sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:32,params:()=>after});return {e,s:got[0]};};
    const fall=run({rate:12,vol:.05}),same=run({rate:200,buyP:.5,vol:.05,size:.012}),ff=itemOf(fall.s,"count"),fs=itemOf(same.s,"count");
    return epResult(!!ff&&ff.ok&&!ff.gate&&(!fs||!fs.ok),same.e,`count true when trades thin out (${ff&&ff.val}) and not when the trade count holds (${fs&&fs.val})`);
  });
  add("wall: re-posts are counted when a wall is hit and refilled; the item needs two",E=>{
    const run=dips=>{const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:90,seed:11,params:sec=>({vol:0,bidWalls:[{idx:12,size:(dips>0&&sec>65&&sec<68)||(dips>1&&sec>72&&sec<75)?3.5:6}]})});sim(e,{t0:b.t,mid0:b.mid,seconds:4,seed:12,params:()=>({vol:0})});return e;};
    const one=eps(run(1),"wall")[0],two=eps(run(2),"wall")[0],none=eps(run(0),"wall")[0],it=x=>x&&x.evidence.find(i=>i.k==="repost");
    return epResult(!!one&&!!two&&!!none&&it(none).val==="0"&&it(one).val==="1"&&!it(one).ok&&it(two).val==="2"&&it(two).ok&&two.wall.reposts===2,run(2),`0 re-posts without a dip, 1 (item false) after one dip, 2 (item true) after two; got ${[none,one,two].map(x=>x&&it(x).val+":"+it(x).ok+":"+x.wall.reposts)}`);
  });
  add("register: the new quantities are measured (fills, trade count, wall re-posts)",E=>{
    const e=E.create(),a=calm(e),h=sim(e,{t0:a.t,mid0:a.mid,seconds:20,seed:41,params:()=>heavySell}),b=sim(e,{t0:h.t,mid0:h.mid,seconds:14,seed:31,params:()=>({rate:200,buyP:.9,driftBps:6})}),w=sim(e,{t0:b.t,mid0:b.mid,seconds:90,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})});sim(e,{t0:w.t,mid0:w.mid,seconds:4,seed:12,params:()=>({vol:0})});
    const v=e.register.snapshot().vars,n=k=>v[k]?v[k].n:0,L=READER_REGISTER.LINKS.map(l=>l.k);
    return{ok:n("bn|conc.fast")>20&&n("bn|countRatio.mid")>10&&n("bn|reposts.book")>5&&["absConc","exhCount","wallReposts"].every(k=>L.includes(k)),detail:`conc ${n("bn|conc.fast")}, count ${n("bn|countRatio.mid")}, reposts ${n("bn|reposts.book")}; links ${L.slice(-3)}`};
  });
  // ---- assumption register (Part 1: measures only) ----
  const R=READER_REGISTER, snapSig=s=>JSON.stringify(s);
  add("register: quantile sketch reads known quantiles from a bounded sample",E=>{
    const r=R.create({cap:512,minLearned:300}),rand=rng(9);for(let i=0;i<20000;i++)r.observe(T0+i*1000,"bn",{share:rand()});
    const q=r.snapshot().vars["bn|share"].q,want=R.QS,err=Math.max(...q.map((x,i)=>Math.abs(x-want[i])));
    return{ok:err<.06&&r.save().cum["bn|share"].res.length===512,detail:err<.06?"ok":`max quantile error ${err.toFixed(3)} (want < .06) or sample not bounded`};
  });
  add("register: prior until enough samples, then learned; no prior stays 'none'",E=>{
    const r=R.create({minLearned:300});r.observe(T0,"bn",{share:.6,buyRate:100});
    const a=[r.status("bn","share"),r.status("bn","buyRate")];
    for(let i=1;i<400;i++)r.observe(T0+i*1000,"bn",{share:.5,buyRate:100});
    const b=[r.status("bn","share"),r.status("bn","buyRate")];
    return{ok:a.join()==="prior,none"&&b.join()==="learned,learned",detail:`before ${a}, after ${b}`};
  });
  add("register: save and load round-trips and keeps learning; bad input is refused",E=>{
    const r=R.create();for(let i=0;i<500;i++)r.observe(T0+i*1000,"hl",{ret:Math.sin(i)});r.endSession();
    const copy=JSON.parse(JSON.stringify(r.save())),r2=R.create({},copy);
    const same=snapSig(r.snapshot())===snapSig(r2.snapshot())&&r2.sessions.length===1,bad=R.create(),refused=!bad.load({v:2})&&!bad.load(null)&&!bad.load({v:1,cum:{"bn|ret":{n:1,res:["x"]}}})||Object.keys(bad.save().cum).length===0;
    r2.observe(T0+9e5,"hl",{ret:1});
    return{ok:same&&refused&&r2.snapshot().vars["hl|ret"].n===501,detail:`same=${same} refused=${refused}`};
  });
  add("register: a page closed mid-run is stored as a finished session on load",E=>{
    const r=R.create({minSessionMs:600000});for(let i=0;i<30;i++)r.observe(T0+i*1000,"bn",{share:.5});
    const r2=R.create({minSessionMs:600000},JSON.parse(JSON.stringify(r.save()))),s=r2.sessions[0];
    return{ok:r2.sessions.length===1&&s.durationMs===29000&&s.counts===false,detail:JSON.stringify(s&&{d:s.durationMs,c:s.counts})};
  });
  add("register: the engine measures every calibrated second and a data gap ends the session",E=>{
    const e=E.create(),a=sim(e,{seconds:300,seed:5}),n0=e.register.snapshot().vars["bn|share"];
    e.advance(a.t+45000);
    const s=e.register.sessions;
    return{ok:!!n0&&n0.n>=150&&n0.n<=190&&s.length===1&&s[0].durationMs>=170000&&e.register.snapshot().vars["bn|buyRate"].n>=150,detail:`n=${n0&&n0.n}; sessions=${s.length} ${s[0]&&s[0].durationMs}`};
  });
  add("register: it never changes a detection (a taught register gives identical signals and episodes)",E=>{
    const run=state=>{const e=E.create(state?{register:state}:undefined),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:30,seed:22});return e;};
    const taught=R.create();for(let i=0;i<5000;i++)taught.observe(T0+i*1000,"bn",{buyRate:1e9,sellRate:1e9,share:.99,ret:50,depthBid:1e-9,depthAsk:1e-9,spreadBps:99});
    const x=run(),y=run(taught.save()),sig=e=>e.events.map(v=>v.type+v.t).join()+"|"+e.episodes.map(p=>[p.family,p.tStart,p.tEnd,p.stage].join(":")).join();
    return{ok:x.episodes.length>0&&sig(x)===sig(y),detail:"signals or episodes differ when the register was pre-loaded"};
  });
  add("register: replaying recorded inputs reproduces the same baselines",E=>{
    const e=E.create();e.startRecording();const a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:30,seed:22});
    const r=E.replayEngine(e.stopRecording());
    return{ok:snapSig(e.register.snapshot())===snapSig(r.register.snapshot()),detail:"snapshots differ after replay"};
  });
  // ---- drift judge (Part 2) ----
  const D=READER_DRIFT, KEY="bn|share", S0=Object.assign({},READER_REGISTER.DEFAULTS);
  const qOf=(c,w)=>[c-1.7*w,c-.7*w,c,c+.7*w,c+1.7*w,c+2.3*w];                       // a quantile summary centred on c, spread w
  const ses=(i,q,o)=>Object.assign({id:1000*i,start:1000*i,end:1000*i+3600000,durationMs:3600000,run:i,sum:{[KEY]:{n:3000,q}}},o||{});
  const seq=(...qs)=>qs.map((q,i)=>ses(i+1,q)), calmQ=()=>qOf(.5,.1);
  const judged=(list,o)=>D.evaluate(list,S0,[KEY],o)[KEY];
  add("drift: nothing is judged until the reference has K sessions",E=>{
    const j=judged(seq(calmQ(),calmQ(),calmQ(),calmQ()));
    return{ok:j.state==="building"&&j.refN===4&&j.refQ===null&&j.confs.length===0,detail:JSON.stringify({s:j.state,n:j.refN})};
  });
  add("drift: a stable market stays ok",E=>{
    const j=judged(seq(...Array.from({length:12},(_,i)=>qOf(.5+(i%3-1)*.01,.1))));
    return{ok:j.state==="ok"&&j.confs.length===0&&j.refN===5&&j.points.length===12,detail:JSON.stringify({s:j.state,c:j.confs.length})};
  });
  add("drift: M differing sessions in a row confirm one drift, back-dated to the first, and the reference restarts",E=>{
    const j=judged(seq(...Array(5).fill(0).map(calmQ),qOf(.8,.1),qOf(.8,.1),qOf(.8,.1)));
    return{ok:j.confs.length===1&&j.confs[0].from===6000&&j.confs[0].sessions.length===3&&/median/.test(j.confs[0].reasons[0])&&j.state==="building"&&j.refN===3,detail:JSON.stringify({c:j.confs.map(c=>c.from),s:j.state,n:j.refN})};
  });
  add("drift: an interrupted streak is only watched, never confirmed",E=>{
    const j=judged(seq(...Array(5).fill(0).map(calmQ),qOf(.8,.1),qOf(.8,.1),calmQ()));
    const w=judged(seq(...Array(5).fill(0).map(calmQ),qOf(.8,.1),qOf(.8,.1)));
    return{ok:j.confs.length===0&&j.state==="ok"&&w.state==="watching"&&w.streak===2&&w.confs.length===0,detail:JSON.stringify({a:j.state,b:w.state,s:w.streak})};
  });
  add("drift: a width change alone and a tail change alone each count",E=>{
    const wide=judged(seq(...Array(5).fill(0).map(calmQ),qOf(.5,.3),qOf(.5,.3),qOf(.5,.3))),tail=judged(seq(...Array(5).fill(0).map(calmQ),[.33,.43,.5,.57,.5+.7+.2*3.5,.5+.9+.2*3.5],[.33,.43,.5,.57,1.9,2.1],[.33,.43,.5,.57,1.9,2.1]));
    return{ok:wide.confs.length===1&&/spread/.test(wide.confs[0].reasons.join())&&tail.confs.length===1&&/tail/.test(tail.confs[0].reasons.join()),detail:JSON.stringify({w:wide.confs.map(c=>c.reasons),t:tail.confs.map(c=>c.reasons)})};
  });
  add("drift: short sessions and thin samples do not vote",E=>{
    const list=seq(...Array(5).fill(0).map(calmQ));list.push(ses(6,qOf(.9,.1),{durationMs:120000}),ses(7,qOf(.9,.1),{sum:{[KEY]:{n:20,q:qOf(.9,.1)}}}),ses(8,qOf(.9,.1),{durationMs:120000}));
    const j=judged(list);
    return{ok:j.state==="ok"&&j.confs.length===0&&j.points.length===5,detail:JSON.stringify({s:j.state,p:j.points.length})};
  });
  add("drift: undoing a confirmation drops those sessions as an anomaly",E=>{
    const list=seq(...Array(5).fill(0).map(calmQ),qOf(.8,.1),qOf(.8,.1),qOf(.8,.1),calmQ(),calmQ()),j=judged(list),id=j.confs[0].id;
    const u=judged(list,{undone:new Set([id])});
    return{ok:j.confs.length===1&&u.confs.length===0&&u.points.every(p=>p.q[2]<.6)&&u.state==="ok",detail:JSON.stringify({before:j.confs.length,after:u.confs.length,s:u.state})};
  });
  add("drift: the written prior is compared with the learned reference",E=>{
    const j=judged(seq(...Array(6).fill(0).map(()=>qOf(.8,.1))),{priors:{[KEY]:{median:.5}}});
    return{ok:j.priorOff&&Math.abs(j.priorGap)>1,detail:JSON.stringify({gap:j.priorGap})};
  });
  add("drift: the running segment is previewed against the reference without voting",E=>{
    const j=judged(seq(...Array(5).fill(0).map(calmQ)),{cur:{[KEY]:qOf(.9,.1)}});
    return{ok:j.preview&&j.preview.drifted&&j.confs.length===0&&j.state==="ok",detail:JSON.stringify(j.preview)};
  });
  add("register: a long run is cut into hourly segments that share a run id",E=>{
    const r=R.create();for(let i=0;i<=12600;i++)r.observe(T0+i*1000,"bn",{share:.5,buyRate:100});r.endSession();
    const s=r.sessions;
    return{ok:s.length===4&&s.every(x=>x.run===T0)&&s[0].durationMs===3599000+1000-1000&&s[3].durationMs>=1000*1790&&s[0].hour===new Date(T0).getUTCHours(),detail:JSON.stringify(s.map(x=>[x.durationMs,x.run]))};
  });
  add("register: drifts are noted once in the history; acknowledge, undo and settings are recorded",E=>{
    const r=R.create({segmentMs:3000000,minSessionMs:600000,minSamples:100}),level=[.5,.5,.5,.5,.5,.8,.8,.8];let t=T0;
    for(const c of level){for(let i=0;i<2900;i++){r.observe(t,"bn",{share:c+((i*7)%10-5)*.01});t+=1000;}t+=60000;r.endSession();}
    const d1=r.history.filter(h=>h.type==="drift"),rv1=r.review(),id=d1[0]&&d1[0].id;
    r.ack(id);const rv2=r.review();r.setSetting("k",4,t);r.setSetting("zzz",1,t);
    const copy=R.create({},JSON.parse(JSON.stringify(r.save()))),u=copy.undo(id);
    return{ok:d1.length===1&&rv1.unacked===1&&rv2.unacked===0&&r.history.some(h=>h.type==="setting"&&h.key==="k"&&h.from===5&&h.to===4)&&!r.history.some(h=>h.key==="zzz")&&copy.cfg.k===4&&u&&copy.history.find(h=>h.id===id).undone,detail:JSON.stringify({d:d1.length,u1:rv1.unacked,u2:rv2.unacked,k:copy.cfg.k})};
  });
  // ---- Part 3a: compared quantities, firing rate, linked thresholds ----
  add("3a: evidence cut-offs that used to be inline are named config and actually drive the evidence",E=>{
    const run=cfg=>{const e=E.create(cfg),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:22});return eps(e,"burst",p=>p.horizon==="fast"&&p.aggressor==="sell")[0];};
    const d=READER_EPISODES.DEFAULTS,x=run(),y=run({ep:{burstLiq:99}}),liq=ep=>ep&&ep.peakEvidence.find(i=>i.k==="liq");
    const named=["recentShare","recentPace","crossShare","crossZ","burstLiq","burstSweeps","exhDecay","exhWasZ","exhWasShare","exhGap","exhSize"].every(k=>typeof d[k]==="number");
    return{ok:named&&x&&liq(x).ok&&(!y||!liq(y).ok),detail:"named="+named+" liq ok by default="+(x&&liq(x).ok)};
  });
  add("3a: every linked threshold exists in the config and points at a registered quantity",E=>{
    const e=E.create(),ids=new Set(R.VARS.map(v=>v.q||v.id)),bad=R.LINKS.filter(l=>{const v=l.at==="ep"?e.cfg.ep[l.k]:e.cfg[l.k];return typeof v!=="number"||!ids.has(l.q)||!R.VARS.some(d=>d.q===l.q);});
    return{ok:bad.length===0&&e.register.claims(e.cfg).every(c=>typeof c.value==="number"),detail:"bad links: "+bad.map(l=>l.k)};
  });
  add("3a: the engine registers the quantities detectors compare, per venue and horizon, and the wall multiple",E=>{
    const e=E.create(),a=calm(e,200),b=sim(e,{t0:a.t,mid0:a.mid,seconds:20,seed:41,params:()=>heavySell});sim(e,{t0:b.t,mid0:b.mid,seconds:20,seed:44,params:()=>({bidWalls:[{idx:12,size:6}]})});
    const v=e.register.snapshot().vars,want=["bn|share.fast","bn|z.fast","bn|prog.fast","bn|eff.fast","bn|refill.fast","bn|recentShare.fast","bn|liq.fast","bn|share.mid","bn|decay.mid","bn|wallMult"],miss=want.filter(k=>!v[k]||!(v[k].n>0));
    return{ok:miss.length===0&&v["bn|wallMult"].q[4]>1,detail:"missing: "+miss};
  });
  add("3a: a finished segment keeps how often each family fired and how long its episodes lasted",E=>{
    const e=E.create(),a=calm(e,150),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell}),c=sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:22});e.advance(c.t+45000);
    const s=e.register.sessions[0],r=s&&s.sum["all|rate.burst"],d=s&&s.sum["all|dur.burst"];
    return{ok:!!r&&r.n>=1&&Math.abs(r.v-r.n/(s.durationMs/3600000))<r.v*1e-4+1e-3&&!!d&&d.v>0&&s.sum["all|rate.wall"].v===0,detail:JSON.stringify({r,d})};
  });
  add("3a: a scalar (episodes per hour) drifts only when it moves well beyond its usual, and a quiet zero stays quiet",E=>{
    const k="all|rate.burst",sc=(i,v)=>ses(i,[0,0,0,0,0,0],{sum:{[k]:{n:Math.round(v),v}}}),rates=a=>D.evaluate(a.map((v,i)=>sc(i+1,v)),S0,[k])[k];
    const quiet=rates([0,1,0,0,1,0,1,0]),surge=rates([4,5,4,5,4,12,13,12]),mild=rates([4,5,4,5,4,5,6,5]);
    return{ok:quiet.confs.length===0&&surge.confs.length===1&&mild.confs.length===0&&surge.scalar&&surge.refV===null,detail:JSON.stringify({q:quiet.confs.length,s:surge.confs.length,m:mild.confs.length})};
  });
  add("3a: the new quantities do not change a detection (register pre-loaded with extreme values gives identical output)",E=>{
    const run=state=>{const e=E.create(state?{register:state}:undefined),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:30,seed:22});return e;};
    const t=R.create();for(let i=0;i<4000;i++)t.observe(T0+i*1000,"bn",{"z.fast":1e6,"share.fast":.99,"wallMult":1e6});
    const sig=e=>e.events.map(v=>v.type+v.t).join()+"|"+e.episodes.map(p=>[p.family,p.tStart,p.tEnd,p.stage,p.peak].join(":")).join();
    return{ok:sig(run())===sig(run(t.save())),detail:"output differs"};
  });
  // ---- Part 3b: tails, percentile maps, proposals, verdict ----
  const P=READER_PROPOSALS, uni=(seed,lo,hi)=>{const r=rng(seed);return()=>lo+(hi-lo)*r();};
  const segFeed=(r,t0,gen,key,n)=>{let t=t0;for(let i=0;i<(n||2900);i++){r.observe(t,"bn",{[key||"share.fast"]:gen()});t+=1000;}r.endSession();return t+60000;};
  add("3b: each segment keeps its 10 largest and smallest values for linked quantities only; old segments drop them",E=>{
    const r=R.create(),g=uni(4,0,1),seen=[];let t=T0;for(let i=0;i<3000;i++){const x=g();seen.push(x);r.observe(t,"bn",{"share.fast":x,buyRate:x});t+=1000;}r.endSession();
    const c=r.sessions[0].sum["bn|share.fast"],sorted=seen.slice().sort((a,b)=>a-b);
    const r2=R.create();let u=T0;for(let i=0;i<62;i++){r2.observe(u,"bn",{"share.fast":.5});r2.observe(u+1000,"bn",{"share.fast":.6});r2.endSession();u+=100000;}
    const s2=r2.sessions;
    return{ok:c.hi.length===10&&c.lo.length===10&&Math.abs(c.hi[9]-sorted[2999])<1e-5&&Math.abs(c.lo[0]-sorted[0])<1e-5&&!r.sessions[0].sum["bn|buyRate"].hi&&!s2[0].sum["bn|share.fast"].hi&&!!s2[61].sum["bn|share.fast"].hi,detail:JSON.stringify({hi:c.hi.length,old:!!s2[0].sum["bn|share.fast"].hi})};
  });
  add("3b: the pooled distribution places a value, and a value at a percentile, including beyond p99",E=>{
    const r=R.create({segmentMs:3000000,minSamples:100}),g=uni(8,0,1);let t=T0;for(let i=0;i<5;i++)t=segFeed(r,t,g);
    const items=r.sessions.map(x=>({q:x.sum["bn|share.fast"].q,n:x.sum["bn|share.fast"].n,hi:x.sum["bn|share.fast"].hi,lo:x.sum["bn|share.fast"].lo})),pts=P.cdfPoints(items),noTail=P.cdfPoints(items.map(x=>({q:x.q,n:x.n})));
    const a=P.pctOf(pts,.999),b=P.valueAt(pts,.9995),c=P.pctOf(pts,.5),d=P.pctOf(noTail,.999);
    return{ok:Math.abs(a-.999)<.002&&Math.abs(b-.9995)<.002&&Math.abs(c-.5)<.02&&d<=.99+1e-9,detail:JSON.stringify({a,b,c,d})};
  });
  add("3b: a proposal keeps the percentile: a threshold at the old p99.9 lands at the new p99.9",E=>{
    const feed=(seed,hi)=>{const r=R.create({segmentMs:3000000,minSamples:100}),g=uni(seed,0,hi);let t=T0;for(let i=0;i<5;i++)t=segFeed(r,t,g);return r.sessions.map(x=>({q:x.sum["bn|share.fast"].q,n:x.sum["bn|share.fast"].n,hi:x.sum["bn|share.fast"].hi,lo:x.sum["bn|share.fast"].lo}));};
    const old=feed(1,1),neu=feed(2,2),link={k:"t",int:false},x=P.build(link,[{key:"k",old,neu}],.999),y=P.build(link,[{key:"k",old,neu}],.9),z=P.build(link,[{key:"k",old,neu:old}],.9);
    return{ok:Math.abs(x.to-1.998)<.02&&Math.abs(y.to-1.8)<.06&&x.large&&z.to===null,detail:JSON.stringify({x:x.to,y:y.to,z:z.to})};
  });
  const mk=(o,st)=>R.create(Object.assign({segmentMs:3000000,minSamples:100,minEpisodes:1,getThreshold:l=>({absorbShare:.9,burstShare:.9,crossShare:.9}[l.k]||1)},o),st);
  const driftRun=(r,drifted)=>{let t=T0;const g1=uni(11,0,1),g2=uni(12,0,2);for(let i=0;i<5;i++)t=segFeed(r,t,g1);for(let i=0;i<drifted;i++)t=segFeed(r,t,g2);return t;};
  add("3b: a confirmed drift in a linked quantity makes one provisional proposal per linked threshold",E=>{
    const r=mk();driftRun(r,3);const ps=r.proposals.filter(p=>p.status==="pending");
    return{ok:ps.length===3&&ps.every(p=>p.provisional&&p.q==="share"&&Math.abs(p.to-1.8)<.1&&p.large&&p.from===.9)&&ps.map(p=>p.k).sort().join()==="absorbShare,burstShare,crossShare",detail:JSON.stringify(ps.map(p=>[p.k,p.to]))};
  });
  add("3b: a two-session streak makes no proposal",E=>{const r=mk();driftRun(r,2);return{ok:r.proposals.length===0,detail:String(r.proposals.length)};});
  add("3b: reject suppresses the same drift; undoing the drift withdraws the rest; the value stays frozen until recompute",E=>{
    const r=mk();let t=driftRun(r,3);const a=r.proposals.find(p=>p.k==="absorbShare"),frozen=a.to;
    r.reject(a.id,"not now");const rej=r.proposals.find(p=>p.id===a.id).status==="rejected"&&r.proposals.find(p=>p.id===a.id).reason==="not now";
    t=segFeed(r,t,uni(13,0,2));t=segFeed(r,t,uni(14,0,2));
    const same=r.proposals.length===3&&r.proposals.find(p=>p.k==="burstShare").to===frozen;
    const okRe=r.recompute(r.proposals.find(p=>p.k==="burstShare").id),b=r.proposals.find(p=>p.k==="burstShare");
    const d=r.history.find(h=>h.type==="drift");r.undo(d.id);const left=r.proposals.filter(p=>p.status==="pending").length;
    return{ok:rej&&same&&okRe&&b.rev===1&&b.provisional===false&&left===0&&r.proposals.find(p=>p.id===a.id).status==="rejected",detail:JSON.stringify({rej,same,okRe,rev:b.rev,prov:b.provisional,left})};
  });
  add("3b: a newer confirmation supersedes a pending proposal, and an old one expires after 30 days",E=>{
    const r=mk();let t=driftRun(r,3);const first=r.proposals.filter(p=>p.status==="pending").length;
    const g3=uni(15,0,6);for(let i=0;i<8;i++)t=segFeed(r,t,g3);
    const rv=r.review(),pend=rv.proposals.filter(p=>p.status==="pending"),sup=rv.proposals.filter(p=>p.status==="superseded").length;
    r.observe(t+31*86400000,"bn",{"share.fast":.5});r.observe(t+31*86400000+1000,"bn",{"share.fast":.5});r.endSession();
    const ex=r.review().proposals.filter(p=>p.status==="expired").length;
    return{ok:first===3&&sup>=1&&pend.length>=1&&ex===pend.length,detail:JSON.stringify({first,sup,pend:pend.length,ex})};
  });
  add("3b: a firing-rate drift whose linked quantities did not move makes no proposal and says why",E=>{
    const r=mk(),g=uni(21,0,1);let t=T0;
    for(let i=0;i<8;i++){const t1=t;let u=t;for(let j=0;j<2900;j++){r.observe(u,"bn",{"share.fast":g()});u+=1000;}const n=i<5?2:10;for(let k=0;k<n;k++){r.noteEpisode("burst","started");r.noteEpisode("burst","ended",20000);}r.endSession();t=u+60000;}
    const d=r.history.find(h=>h.type==="drift"&&h.key==="all|rate.burst");
    return{ok:!!d&&r.proposals.length===0&&/structure/.test(d.note),detail:JSON.stringify(d&&d.note)};
  });
  add("3b: proposals survive save and load; the usual firing rate is the median before the drift",E=>{
    const r=mk();let t=T0;const g=uni(31,0,1);
    for(let i=0;i<5;i++){let u=t;for(let j=0;j<2900;j++){r.observe(u,"bn",{"share.fast":g()});u+=1000;}for(let k=0;k<3;k++)r.noteEpisode("absorption","started");r.endSession();t=u+60000;}
    const g2=uni(32,0,2);for(let i=0;i<3;i++)t=segFeed(r,t,g2);
    const c=mk({},JSON.parse(JSON.stringify(r.save()))),id=r.proposals[0].id,pid=r.proposals.find(p=>p.k==="absorbShare"&&p.status==="pending").id,usual=c.oldRates(pid);
    return{ok:c.proposals.length===r.proposals.length&&c.proposals.length>=3&&c.proposals[0].id===id&&Math.abs(usual.absorption-3/(2899/3600))<.05,detail:JSON.stringify({usual,n:c.proposals.length,m:r.proposals.length})};
  });
  const run1=(tag,l,eps,hours)=>({tag,labels:l,eps,hours:hours||1});
  const L0={a:5,aF:5,dn:2,dS:1,m:3,mD:1};
  const prop0={families:["burst"],large:false};
  add("3b: the verdict is safe only when every condition holds, and names what is missing",E=>{
    const base=[run1("before",L0,{burst:6}),run1("after",L0,{burst:12})],better=[run1("before",L0,{burst:5}),run1("after",L0,{burst:8})];
    const ok=P.verdict({proposal:prop0,base,prop:better,oldRates:{burst:5}});
    const noAfter=P.verdict({proposal:prop0,base:[base[0],run1("before",L0,{burst:12})],prop:[better[0],run1("before",L0,{burst:8})],oldRates:{burst:5}});
    const fewLabels=P.verdict({proposal:prop0,base:base.map(r=>run1(r.tag,{a:1,aF:1,dn:0,dS:0,m:0,mD:0},r.eps)),prop:better.map(r=>run1(r.tag,{a:1,aF:1,dn:0,dS:0,m:0,mD:0},r.eps)),oldRates:{burst:5}});
    const worseLab=P.verdict({proposal:prop0,base,prop:[run1("before",{...L0,aF:4},{burst:5}),run1("after",L0,{burst:8})],oldRates:{burst:5}});
    const flood=P.verdict({proposal:prop0,base,prop:[run1("before",L0,{burst:20}),run1("after",L0,{burst:30})],oldRates:{burst:5}});
    const large=P.verdict({proposal:{...prop0,large:true},base,prop:better,oldRates:{burst:5}}),noOld=P.verdict({proposal:prop0,base,prop:better,oldRates:{}});
    const bad=(v,k)=>v.verdict==="unproven"&&v.conds.filter(c=>!c.ok).map(c=>c.k).join()===k;
    return{ok:ok.verdict==="safe"&&bad(noAfter,"after")&&bad(fewLabels,"labels")&&bad(worseLab,"noWorse")&&bad(flood,"rate")&&bad(large,"size")&&bad(noOld,"rate"),detail:JSON.stringify([ok.verdict,noAfter.conds.map(c=>c.ok),flood.conds.map(c=>c.ok)])};
  });
  add("3b: replay in chunks equals a one-shot replay, and a root threshold override changes what is detected",E=>{
    const e=E.create();e.startRecording();const a=calm(e),h1=sim(e,{t0:a.t,mid0:a.mid,seconds:20,seed:41,params:()=>heavySell});sim(e,{t0:h1.t,mid0:h1.mid,seconds:30,seed:44});const inputs=e.stopRecording();
    const whole=E.replayEngine(inputs),ch=E.create();for(let i=0;i<inputs.length;i+=777)E.feed(ch,inputs,i,i+777);
    const sig=x=>x.episodes.map(p=>[p.family,p.tStart,p.tEnd,p.stage].join(":")).join(),strict=E.replayEngine(inputs,{absorbShare:.99});
    return{ok:whole.episodes.length>0&&sig(whole)===sig(ch)&&strict.episodes.filter(p=>p.family==="absorption").length<whole.episodes.filter(p=>p.family==="absorption").length,detail:"chunked or override differs"};
  });
  // ---- Part 3c: approval, overrides, revert, and the guard against flagging our own change ----
  const DEF={absorbShare:.65,burstShare:.7,crossShare:.6};
  const mk3=(o,st)=>R.create(Object.assign({segmentMs:3000000,minSamples:100,minEpisodes:1,getThreshold:l=>({absorbShare:.9,burstShare:.9,crossShare:.9}[l.k]||1),getDefault:l=>DEF[l.k]!==undefined?DEF[l.k]:1},o),st);
  add("3c: approving makes a local override, records it, and leaves the other proposals pending",E=>{
    const r=mk3();driftRun(r,3);const ids=r.proposals.filter(p=>p.status==="pending").map(p=>p.id),a=ids.find(i=>i.startsWith("absorbShare")),e0=r.epoch;
    const done=r.approve([a],{group:"g1"}),o=r.overrides.absorbShare,h=r.history.filter(x=>x.type==="approval");
    return{ok:done.length===1&&o&&o.builtIn===.65&&o.value===done[0].to&&done[0].status==="approved"&&r.epoch===e0+1&&h.length===1&&h[0].group==="g1"&&r.proposals.filter(p=>p.status==="pending").length===2&&r.approvals[0].status==="approved",detail:JSON.stringify({o,e0,e:r.epoch})};
  });
  add("3c: reset returns a revert record, clears the override and marks the approval reverted; an equal override settles away",E=>{
    const r=mk3();driftRun(r,3);r.approve([r.proposals.find(p=>p.k==="burstShare"&&p.status==="pending").id]);
    const rv=r.resetOverride("burstShare","too noisy"),again=r.resetOverride("burstShare");
    r.approve([r.proposals.find(p=>p.k==="crossShare"&&p.status==="pending").id]);r.overrides.crossShare.value=.6;const gone=r.settleOverrides();
    return{ok:rv&&rv.from>.7&&rv.to===.7&&rv.reason==="too noisy"&&again===null&&!r.overrides.burstShare&&r.approvals.find(a=>a.k==="burstShare").status==="reverted"&&r.history.some(h=>h.type==="revert"&&h.k==="burstShare")&&gone.join()==="crossShare"&&!r.overrides.crossShare,detail:JSON.stringify({rv,gone})};
  });
  add("3c: overrides, approvals and the epoch survive save and load; a load without overrides keeps the current ones; imports only add known keys",E=>{
    const r=mk3();driftRun(r,3);r.approve([r.proposals.find(p=>p.k==="absorbShare"&&p.status==="pending").id],{group:"g2"});
    const st=JSON.parse(JSON.stringify(r.save())),c=mk3({},st),keep=mk3();keep.applyOverrides({absorbShare:{value:.8}});const st2=JSON.parse(JSON.stringify(r.save()));delete st2.overrides;keep.load(st2);
    const imp=mk3(),done=imp.applyOverrides({absorbShare:{value:.8,at:5},bogus:{value:1},burstShare:{value:NaN}});
    return{ok:c.overrides.absorbShare.value===r.overrides.absorbShare.value&&c.approvals.length===1&&c.epoch===r.epoch&&keep.overrides.absorbShare&&done.join()==="absorbShare"&&imp.overrides.absorbShare.imported===true&&imp.history.some(h=>h.type==="import"),detail:JSON.stringify(done)};
  });
  const rateRun=(r,approveAt)=>{
    const g=uni(41,0,1);let t=T0;
    for(let i=0;i<9;i++){
      let u=t;for(let j=0;j<2900;j++){r.observe(u,"bn",{"share.fast":g()});if(i===approveAt&&j===1000)r.recordApproval({id:"x@y",k:"burstZ",families:["burst"],from:3,to:3.2,at:u,group:null});u+=1000;}
      const n=i<5?2:10;for(let k=0;k<n;k++){r.noteEpisode("burst","started");r.noteEpisode("burst","ended",20000);}r.endSession();t=u+60000;
    }
  };
  add("3c: a firing-rate drift that follows our own approval is labelled and makes no proposals; the mixed segment does not vote",E=>{
    const r=mk3();rateRun(r,5);                                                    // approval lands inside the 6th segment
    const d=r.history.find(h=>h.type==="drift"&&h.key==="all|rate.burst"),mixed=r.sessions[5].mixed,ctrl=mk3();rateRun(ctrl,-1);
    const dc=ctrl.history.find(h=>h.type==="drift"&&h.key==="all|rate.burst"),pts=r.review().keys["all|rate.burst"].points.map(p=>p.id);
    return{ok:!!d&&!!mixed&&mixed[0]==="burst"&&d.followsApproval==="x@y"&&/Follows your approval/.test(d.note)&&r.proposals.length===0&&!!dc&&!dc.followsApproval&&!/Follows/.test(dc.note||"")&&!pts.includes(r.sessions[5].id)&&d.from===r.sessions[6].id,detail:JSON.stringify({d:d&&d.note,mixed,from:d&&d.from,s6:r.sessions[6].id})};
  });
  add("3c: an approval outside the family's own output does not hide an unrelated drift",E=>{
    const r=mk3();rateRun(r,-1);r.recordApproval({id:"q",k:"wallRatio",families:["wall"],from:8,to:9,at:T0+1,group:null});
    const d=r.history.find(h=>h.type==="drift"&&h.key==="all|rate.burst");
    return{ok:!!d&&!d.followsApproval,detail:JSON.stringify(d&&d.note)};
  });
  // ---- sigma: the scale of normal price movement, and the static expectation that would have caught it being wrong ----
  const gauss=g=>{let x=0;for(let i=0;i<12;i++)x+=g();return x-6;};
  // a market whose mid rarely moves but jumps when it does: most 1-second returns are exactly zero (as on Binance BTC and Hyperliquid)
  function jumpSim(e,o){
    o=Object.assign({t0:T0,seconds:600,seed:5,pJump:.08,jumpBps:1.2,rate:20,mid0:82000},o);const rand=rng(o.seed);let t=o.t0,mid=o.mid0;
    for(let i=0;i<o.seconds*4;i++){t+=250;if(rand()<o.pJump)mid*=1+gauss(rand)*o.jumpBps/1e4;e.onQuote("bn",t,mid-.05,mid+.05);
      for(let k=poisson(rand,o.rate*.25);k>0;k--){const b=rand()<.5,q=.02*(.5+rand()),px=b?mid+.05:mid-.05;e.onTrade({t,v:"bn",side:b?"buy":"sell",px,q,ntl:px*q});}
      e.onBook("bn",t,levels(mid,-1,1,[],t),levels(mid,1,1,[],t));}
    return {t,mid};
  }
  const zeroShare=e=>{const h=e.priceHistory("bn").map(x=>x[1]);let z=0,n=0;for(let i=1;i<h.length;i++){n++;if(h[i]===h[i-1])z++;}return z/n;};
  const normal=(seed,scale,n)=>{const g=rng(seed),a=[];for(let i=0;i<n;i++)a.push(gauss(g)*scale);return a;};
  add("sigma: a market where most 1-second returns are zero still gets an honest sigma, and the static expectation holds",E=>{
    const e=E.create(),a=jumpSim(e,{seconds:900}),sg=e.debug().sigmaBps("bn"),true1=Math.sqrt(.08*4)*1.2,ex=e.register.expectations().filter(x=>x.key==="bn|prog.fast")[0],zs=zeroShare(e);
    return{ok:zs>.5&&sg>.5*true1&&sg<1.5*true1&&ex.ready&&ex.ok,detail:JSON.stringify({zeroShare:+zs.toFixed(2),sigma:+sg.toFixed(3),true1:+true1.toFixed(3),ex:{ready:ex.ready,ok:ex.ok,medAbs:ex.medAbs,tail:ex.tail}})};
  });
  add("sigma: a market with about 30% zero returns (quiet Hyperliquid) is not underestimated",E=>{
    const e=E.create(),o={seconds:900,pJump:.26,jumpBps:1},x=jumpSim(e,o),sg=e.debug().sigmaBps("bn"),true1=Math.sqrt(.26*4)*1,zs=zeroShare(e);
    return{ok:zs>.15&&zs<.6&&sg>.75*true1&&sg<1.25*true1,detail:JSON.stringify({zeroShare:+zs.toFixed(2),sigma:+sg.toFixed(3),true1:+true1.toFixed(3)})};
  });
  add("sigma: until there is enough history it stays at the floor instead of guessing",E=>{
    const e=E.create();jumpSim(e,{seconds:40});return{ok:e.debug().sigmaBps("bn")===.05,detail:String(e.debug().sigmaBps("bn"))};
  });
  add("expectation: a sigma that is far too small is flagged, too large is flagged, about right passes, too little data waits",E=>{
    const mk=(vals)=>{const r=R.create({minLearned:300});vals.forEach((v,i)=>r.observe(T0+i*1000,"bn",{"prog.fast":v}));return r.expectations().filter(x=>x.key==="bn|prog.fast")[0];};
    const right=mk(normal(1,1,2000)),tiny=mk(normal(2,10,2000)),huge=mk(normal(3,.1,2000)),few=mk(normal(4,1,50));
    return{ok:right.ok&&right.ready&&!tiny.ok&&/typical/.test(tiny.reasons[0])&&/percentiles/.test(tiny.reasons[1])&&!huge.ok&&!few.ready&&few.ok,detail:JSON.stringify({right:[right.medAbs,right.tail],tiny:tiny.reasons.length,huge:huge.reasons.length,few:few.ready})};
  });
  add("expectation: the bands are settings, written to the history when changed, and a failing expectation is part of the review",E=>{
    const r=R.create({minLearned:300});normal(7,3,2000).forEach((v,i)=>r.observe(T0+i*1000,"bn",{"prog.fast":v}));
    const before=r.review().expectations.filter(x=>x.key==="bn|prog.fast")[0];r.setSetting("expMedHi",3,5);r.setSetting("expTailHi",6,5);
    const after=r.review().expectations.filter(x=>x.key==="bn|prog.fast")[0];
    return{ok:!before.ok&&after.ok&&r.history.filter(h=>h.type==="setting").length===2&&R.SETTABLE.includes("expTailLo"),detail:JSON.stringify({b:before.reasons,a:after.reasons})};
  });
  add("expectation: a short test or simulator session never sets off the scale check; counted sessions do, also after save and load",E=>{
    const feed=(r,t0,vals)=>vals.forEach((v,i)=>r.observe(t0+i*1000,"bn",{"prog.fast":v}));
    const get=r=>r.expectations().filter(x=>x.key==="bn|prog.fast")[0];
    const r=R.create({minLearned:300});feed(r,T0,normal(5,10,400));r.endSession();const shortOnly=get(r);
    feed(r,T0+1e6,normal(6,1,1000));const live=get(r);r.endSession();const done=get(r);
    const r2=R.create({minLearned:300},r.save());const again=get(r2);
    const bad=R.create({minLearned:300});feed(bad,T0,normal(7,10,1000));bad.endSession();const wild=get(bad);
    return{ok:!shortOnly.ready&&live.ready&&live.ok&&done.ready&&done.ok&&again.ok&&wild.ready&&!wild.ok,detail:JSON.stringify({shortOnly:shortOnly.ready,live:live.ok,done:done.ok,again:again.ok,wild:wild.ok})};
  });
  // ---- raw signals (v019): silence, trade clustering, cross-venue lead/lag ----
  const rawOf=(e,type)=>e.events.filter(x=>x.raw&&x.type===type);
  add("raw: a venue that goes quiet gets silence_started, and silence_ended when trading resumes",E=>{
    const e=E.create(),a=calm(e);let t=a.t;for(let i=0;i<6;i++){t+=1000;e.advance(t);}
    const started=rawOf(e,"silence_started"),open=started.length===1&&started[0].venue==="bn"&&rawOf(e,"silence_ended").length===0;
    e.onTrade({t:t+500,v:"bn",side:"buy",px:a.mid,q:.02,ntl:a.mid*.02});const ended=rawOf(e,"silence_ended");
    return{ok:open&&ended.length===1&&ended[0].refs.gapMs>=3000,detail:JSON.stringify({started:started.length,open,ended:ended.length})};
  });
  add("raw: a few seconds of silence at a normal pace, or a quiet start, does not fire",E=>{
    const e=E.create(),a=calm(e);let t=a.t;for(let i=0;i<2;i++){t+=1000;e.advance(t);}
    const q=E.create();let u=T0;for(let i=0;i<5;i++){u+=1000;q.advance(u);}
    return{ok:rawOf(e,"silence_started").length===0&&q.events.length===0,detail:String(e.events.length)};
  });
  add("raw: eight same-size same-side trades in a row make a trade_cluster; mixed sizes, a flip of side or too few do not",E=>{
    const mk=(n,sizes,side)=>{const e=E.create(),a=calm(e);for(let i=0;i<n;i++)e.onTrade({t:a.t+100*(i+1),v:"bn",side:side?side(i):"buy",px:a.mid,q:sizes(i),ntl:a.mid*sizes(i)});return e;};
    const yes=mk(9,()=>.04),mixed=mk(9,i=>.03+.02*(i%2)),few=mk(5,()=>.04),flip=mk(9,()=>.04,i=>i===4?"sell":"buy"),c=rawOf(yes,"trade_cluster");
    return{ok:c.length===1&&c[0].refs.side==="buy"&&c[0].refs.count===8&&!rawOf(mixed,"trade_cluster").length&&!rawOf(few,"trade_cluster").length&&!rawOf(flip,"trade_cluster").length,detail:JSON.stringify({yes:c.length,mixed:rawOf(mixed,"trade_cluster").length,few:rawOf(few,"trade_cluster").length,flip:rawOf(flip,"trade_cluster").length})};
  });
  function twin(e,o){const rand=rng(o.seed||5),n=Math.round(o.seconds*4);let t=o.t0,bn=o.mid0,hl=o.hl0||o.mid0;
    for(let i=0;i<n;i++){t+=250;const x=o.jump?o.jump((t-o.t0)/1000):{bn:0,hl:0};bn*=1+((rand()-.5)*.6+x.bn/4)/1e4;hl*=1+((rand()-.5)*.6+x.hl/4)/1e4;
      e.onQuote("bn",t,bn-.05,bn+.05);e.onQuote("hl",t,hl-.05,hl+.05);
      e.onTrade({t,v:"bn",side:rand()<.5?"buy":"sell",px:bn,q:.02,ntl:bn*.02});e.onTrade({t,v:"hl",side:rand()<.5?"buy":"sell",px:hl,q:.02,ntl:hl*.02});}
    return{t,bn,hl};}
  add("raw: one venue jumps and the other follows a second later gives lead_lag naming the leader",E=>{
    const e=E.create(),a=twin(e,{t0:T0,mid0:82000,seconds:150}),b=twin(e,{t0:a.t,mid0:a.bn,hl0:a.hl,seconds:4,seed:6,jump:s=>s>=1&&s<2?{bn:6,hl:0}:s>=2&&s<3?{bn:0,hl:6}:{bn:0,hl:0}}),r=rawOf(e,"lead_lag");
    return{ok:r.length>=1&&r[0].refs.leader==="bn"&&r[0].refs.follower==="hl"&&r[0].dir==="bull",detail:JSON.stringify(r.map(x=>x.refs))};
  });
  add("raw: both venues jumping together, or only one moving, is not lead_lag",E=>{
    const e=E.create(),a=twin(e,{t0:T0,mid0:82000,seconds:150}),b=twin(e,{t0:a.t,mid0:a.bn,hl0:a.hl,seconds:4,seed:6,jump:s=>s>=1&&s<2?{bn:6,hl:6}:{bn:0,hl:0}});
    const f=E.create(),c=twin(f,{t0:T0,mid0:82000,seconds:150}),d=twin(f,{t0:c.t,mid0:c.bn,hl0:c.hl,seconds:4,seed:6,jump:s=>s>=1&&s<2?{bn:6,hl:0}:{bn:0,hl:0}});
    return{ok:!rawOf(e,"lead_lag").length&&!rawOf(f,"lead_lag").length,detail:JSON.stringify({both:rawOf(e,"lead_lag").length,one:rawOf(f,"lead_lag").length})};
  });
  add("raw: the new signals leave every older detection and episode exactly as it was, and never count toward the per-minute cap",E=>{
    const run=(on)=>{const e=E.create({detectors:{silence_started:on,silence_ended:on,lead_lag:on,trade_cluster:on}}),a=calm(e);sim(e,{t0:a.t,mid0:a.mid,seconds:5,seed:11,params:()=>({vol:0,bidWalls:[{idx:12,size:6}]})});return e;};
    const on=run(true),off=run(false),strip=x=>JSON.stringify(x.events.filter(y=>!y.raw),(k,v)=>k==="id"?undefined:v);
    return{ok:strip(on)===strip(off)&&JSON.stringify(on.episodes)===JSON.stringify(off.episodes)&&off.events.every(x=>!x.raw),detail:"legacy signals or episodes differ with the raw events on"};
  });
  // ---- flow landscape (v020): the pure grid behind the 3D view ----
  const LS=READER_LANDSCAPE;
  add("landscape: buying above the mid and selling below it land in the right cells with the right sign, and totals add up",E=>{
    const src={trades:[{t:T0+59000,v:"bn",side:"buy",px:100.02,ntl:300},{t:T0+59500,v:"bn",side:"sell",px:99.98,ntl:200},{t:T0+30000,v:"bn",side:"buy",px:100.02,ntl:50},{t:T0+59900,v:"bn",side:"buy",px:105,ntl:999}],mid:()=>100};
    const g=LS.grid(src,T0+60000,{venue:"bn",halfBps:4,xBins:41,yBins:24,spanMs:60000}),at=(xBps,ageS)=>g.z[Math.floor(ageS/60*24)*41+Math.floor((xBps+4)/8*41)];
    return{ok:at(2,1)===300&&at(-2,.5)===-200&&at(2,30)===50&&g.clipped===1&&g.buy===350&&g.sell===200&&g.net===150&&g.peakBuy.z===300&&g.peakSell.z===-200,detail:JSON.stringify({a:at(2,1),b:at(-2,.5),c:at(2,30),clipped:g.clipped,buy:g.buy,sell:g.sell})};
  });
  add("landscape: a steady price makes a ridge along time, a trend makes a diagonal, and the price path ends at the playhead",E=>{
    const steady=[],trend=[];for(let s=0;s<60;s++){steady.push({t:T0+s*1000+500,v:"bn",side:"buy",px:100.02,ntl:100});trend.push({t:T0+s*1000+500,v:"bn",side:"buy",px:100+s*.0005,ntl:100});}
    const midTrend=(v,t)=>100+Math.max(0,(t-T0)/1000)*.0005,gs=LS.grid({trades:steady,mid:()=>100},T0+60000,{venue:"bn",halfBps:4}),cols=new Set();
    for(let j=0;j<gs.ny;j++)for(let i=0;i<gs.nx;i++)if(gs.z[j*gs.nx+i]>0)cols.add(i);
    const gt=LS.grid({trades:trend,mid:midTrend},T0+60000,{venue:"bn",halfBps:4}),cols2=new Set();
    for(let j=0;j<gt.ny;j++)for(let i=0;i<gt.nx;i++)if(gt.z[j*gt.nx+i]>0)cols2.add(i);
    const p=gt.path;
    return{ok:cols.size===1&&cols2.size>=4&&p[0]>p[p.length-1]*0-1&&p[p.length-1]<-.5&&gt.moveBps>.5&&Math.abs(p[0])<Math.abs(p[p.length-1]),detail:JSON.stringify({cols:cols.size,cols2:cols2.size,p0:p[0],pn:p[p.length-1],move:gt.moveBps})};
  });
  add("landscape: a recorded session becomes a source, the playhead can sit anywhere in it, and the grid never changes its input",E=>{
    const inputs=[["q","bn",T0,99.99,100.01],["t",{t:T0+1000,v:"bn",side:"buy",px:100.02,q:1,ntl:200}],["q","bn",T0+2000,100.09,100.11],["t",{t:T0+2500,v:"hl",side:"sell",px:100.08,q:1,ntl:70}],["q","hl",T0+2000,100.07,100.09]];
    const s=LS.fromInputs(inputs),before=JSON.stringify(s.trades),g1=LS.grid(s,T0+3000,{venue:"both",spanMs:60000}),g2=LS.grid(s,T0+3000,{venue:"both",spanMs:60000}),early=LS.grid(s,T0+1500,{venue:"bn",spanMs:60000});
    return{ok:s.trades.length===2&&s.t0===T0&&s.mid("bn",T0+1000)===100&&Math.abs(s.mid("bn",T0+2500)-100.1)<1e-9&&s.mid("bn",T0+90000)===null&&JSON.stringify(Array.from(g1.z))===JSON.stringify(Array.from(g2.z))&&JSON.stringify(s.trades)===before&&early.trades===1&&early.buy===200,detail:JSON.stringify({n:s.trades.length,e:early.trades,eb:early.buy,m:s.mid("bn",T0+2500)})};
  });
  // ---- adaptive sigma (v021): a fast component so sigma follows a market that suddenly gets busier ----
  add("sigma: with the fast component a market that gets four times busier is measured against its new pace within minutes; a steady market is barely changed",E=>{
    const run=(cfg,volAfter)=>{const e=E.create(cfg),a=sim(e,{seconds:900,seed:3,params:()=>({vol:.3})});sim(e,{t0:a.t,mid0:a.mid,seconds:180,seed:4,params:()=>({vol:volAfter})});return e.debug().sigmaBps("bn");};
    const on={sigmaFastN:120,sigmaFastW:.5},offBusy=run({},1.2),onBusy=run(on,1.2),offSteady=run({},.3),onSteady=run(on,.3);
    return{ok:onBusy>1.3*offBusy&&onBusy<4*offBusy&&Math.abs(onSteady/offSteady-1)<.25,detail:JSON.stringify({offBusy:+offBusy.toFixed(3),onBusy:+onBusy.toFixed(3),offSteady:+offSteady.toFixed(3),onSteady:+onSteady.toFixed(3)})};
  });
  add("sigma: the fast component is off unless asked for, so older settings and recordings read exactly as before",E=>{
    const mk=cfg=>{const e=E.create(cfg),a=sim(e,{seconds:400,seed:3,params:()=>({vol:.3})});sim(e,{t0:a.t,mid0:a.mid,seconds:60,seed:4,params:()=>({vol:1})});return e.debug().sigmaBps("bn");};
    return{ok:E.DEFAULTS.sigmaFastN===0&&mk({})===mk({sigmaFastN:0,sigmaFastW:.9}),detail:String(E.DEFAULTS.sigmaFastN)};
  });
  // ---- landscape view (v025): the cache key decides when a drawn grid may be reused, so a stale one would show the wrong market ----
  add("landscape: the cache key reuses a grid for the same moment and changes for anything that changes the picture",E=>{
    const K=READER_LANDSCAPE.cacheKey,tr=(t0,n)=>Array.from({length:n},(_,i)=>({t:t0+i*10})),base={src:"live",venue:"both",spanMs:60000,tNow:100000,live:true,trades:tr(0,50)};
    const k=K(base),same=K(Object.assign({},base,{tNow:100200}))===k,moved=K(Object.assign({},base,{tNow:100400}))!==k,grown=K(Object.assign({},base,{trades:tr(0,51)}))!==k;
    const trimmed=K(Object.assign({},base,{trades:tr(500,50)}))!==k,venue=K(Object.assign({},base,{venue:"bn"}))!==k,span=K(Object.assign({},base,{spanMs:120000}))!==k;
    const play=Object.assign({},base,{live:false,tNow:100200,sessId:1,src:"session"}),s1=K(play),sNext=K(Object.assign({},play,{sessId:2}))!==s1,exact=K(Object.assign({},play,{tNow:100201}))!==s1;
    return{ok:same&&moved&&grown&&trimmed&&venue&&span&&sNext&&exact,detail:JSON.stringify({same,moved,grown,trimmed,venue,span,sNext,exact})};
  });
  add("landscape: episodes become marks on the floor at their price and time, and only when they overlap the window",E=>{
    const LS=READER_LANDSCAPE,T=100000,src={trades:[],t0:0,t1:T,mid:()=>100},g={spanMs:60000,half:4,venue:"both"};
    const eps=[{family:"wall",venue:"bn",stage:"active",tStart:T-20000,tEnd:null,tDetected:T-15000,px:100.02},
      {family:"absorption",venue:"hl",stage:"ended",tStart:T-90000,tEnd:T-70000,tDetected:T-85000,px:100},
      {family:"burst",venue:"hl",stage:"ended",tStart:T-80000,tEnd:T-30000,tDetected:T-79000,px:99.96},
      {family:"exhaustion",venue:"bn",stage:"active",tStart:T-5000,tEnd:null,tDetected:T-1000,px:101}];
    const m=LS.episodeMarks(src,T,g,eps),w=m.find(x=>x.family==="wall"),b=m.find(x=>x.family==="burst"),x=m.find(x=>x.family==="exhaustion");
    const hl=LS.episodeMarks(src,T,Object.assign({},g,{venue:"hl"}),eps);
    return{ok:m.length===3&&!m.some(y=>y.family==="absorption")&&Math.abs(w.u-.5)<1e-9&&Math.abs(w.z0+1)<1e-9&&Math.abs(w.z1-(20000/60000*2-1))<1e-9&&Math.abs(w.zd-(15000/60000*2-1))<1e-9
      &&b.zd===null&&b.z1===1&&Math.abs(b.u+1)<1e-9&&x.u===1&&x.outside===true&&hl.length===1&&hl[0].family==="burst"&&LS.episodeMarks(src,T,g,null).length===0,
      detail:JSON.stringify({n:m.length,w,b,x,hl:hl.length})};
  });
  add("landscape: a wall that was re-posted again and again is one mark; different prices, venues and far-apart times stay separate; a family can be hidden",E=>{
    const LS=READER_LANDSCAPE,T=100000,src={trades:[],t0:0,t1:T,mid:()=>100},g={spanMs:60000,half:4,nx:41,venue:"both"};
    const w=(a,b,px,v)=>({family:"wall",venue:v||"bn",stage:"ended",tStart:T-a,tEnd:T-b,tDetected:T-a+1000,px});
    const eps=[w(50000,40000,100.02),w(39000,30000,100.0201),w(28000,20000,100.02),w(10000,5000,100.02),w(45000,35000,100.05),w(45000,35000,100.02,"hl"),{family:"absorption",venue:"bn",stage:"active",tStart:T-8000,tEnd:null,tDetected:T-6000,px:100.02}];
    const m=LS.episodeMarks(src,T,g,eps),raw=LS.episodeMarks(src,T,g,eps,{merge:false}),walls=m.filter(x=>x.wall),hid=LS.episodeMarks(src,T,g,eps,{hide:{wall:true}});
    const big=walls.find(x=>x.n===3);
    return{ok:raw.length===7&&m.length===5&&walls.length===4&&!!big&&Math.abs(big.z0+1/3)<1e-9&&Math.abs(big.z1-2/3)<1e-9&&Math.abs(big.zd-(49000/60000*2-1))<1e-9&&hid.length===1&&hid[0].family==="absorption"&&walls.filter(x=>x.venue==="hl").length===1,
      detail:JSON.stringify({raw:raw.length,m:m.length,walls:walls.map(x=>[x.venue,x.n,+x.u.toFixed(3)]),hid:hid.length})};
  });
  // ---- auto-record (v031): when to start and stop recording, from a one-second price series ----
  add("autorec: sigma of a random walk matches its true scale, on the same footing as the engine's sigma",E=>{
    const r=rng(11),h=AUTOREC.createHistory();let px=82000,t=T0;for(let i=0;i<3700;i++){px*=1+(r()-.5)*2*.6/1e4;t+=1000;AUTOREC.push(h,t,px);}
    const g=AUTOREC.sigma(h,3600,15),want=.6/Math.sqrt(3);
    return{ok:Math.abs(g.sigma/want-1)<.15&&g.n>3500,detail:JSON.stringify({got:+g.sigma.toFixed(3),want:+want.toFixed(3),n:g.n})};
  });
  add("autorec: it learns an hour first, ignores a calm market, starts soon after a jump, stays while it lasts, and stops after the calm minutes",E=>{
    const A=AUTOREC,r=rng(5),h=A.createHistory(),cfg={};let px=82000,t=T0,st={mode:"waiting"};const ev=[];
    const run=(secs,vol)=>{for(let i=0;i<secs;i++){px*=1+(r()-.5)*2*vol/1e4;t+=1000;A.push(h,t,px);if(i%5===4&&!ev.some(x=>x.a==="stop")){const v=A.vol(h,cfg),o=A.step(st,v,t,cfg);st=o.st;if(o.action)ev.push({a:o.action,why:o.why,t});}}};   // the view disarms after a stop, so nothing is asked after it
    run(600,.3);const notReady=ev.length===0;run(1800,.3);const quiet=ev.length===0,jumpAt=t;run(900,1.2);const jumpEnd=t;run(2400,.3);
    const start=ev.find(x=>x.a==="start"),stop=ev.find(x=>x.a==="stop");
    return{ok:notReady&&quiet&&!!start&&start.t>jumpAt&&start.t-jumpAt<=300000&&!!stop&&stop.why==="calm"&&stop.t>jumpEnd&&ev.length===2,detail:JSON.stringify({notReady,quiet,start:start&&(start.t-jumpAt)/1000,why:start&&start.why,stop:stop&&(stop.t-jumpEnd)/1000,n:ev.length})};
  });
  add("autorec: a recording ends at its time limit even if the market stays wild, and either trigger alone is enough to start",E=>{
    const A=AUTOREC,calm={fast:.5,slow:.5,ratio:1,ready:true},wild={fast:2,slow:1,ratio:2,ready:true},T=1e6;
    const byRatio=A.step({mode:"waiting"},{fast:.9,slow:.4,ratio:2.2,ready:true},T,{}),bySigma=A.step({mode:"waiting"},{fast:1.5,slow:1.4,ratio:1.07,ready:true},T,{}),no=A.step({mode:"waiting"},{fast:1.1,slow:.7,ratio:1.57,ready:true},T,{}),notReady=A.step({mode:"waiting"},{fast:3,slow:.4,ratio:7,ready:false},T,{}),deadCalm=A.step({mode:"waiting"},{fast:.2,slow:.08,ratio:2.5,ready:true},T,{});
    const st={mode:"recording",since:T,calmSince:null},o=A.step(st,wild,T+59*60000,{maxMin:60}),o2=A.step(st,wild,T+60*60000,{maxMin:60});
    const dip=A.step({mode:"recording",since:T,calmSince:T+60000},wild,T+400000,{}),keep=A.step({mode:"recording",since:T,calmSince:T+60000},calm,T+240000,{calmMin:5});
    return{ok:byRatio.action==="start"&&byRatio.why==="ratio"&&bySigma.action==="start"&&bySigma.why==="sigma"&&no.action===null&&notReady.action===null&&deadCalm.action===null&&o.action===null&&o2.action==="stop"&&o2.why==="max"&&dip.action===null&&dip.st.calmSince===null&&keep.action===null,
      detail:JSON.stringify({byRatio:byRatio.why,bySigma:bySigma.why,no:no.action,o:o.action,o2:o2.why,dip:dip.action,keep:keep.action})};
  });
  add("autorec: a price stream that has gone quiet is not judged: the last window is stale, so nothing starts and nothing counts as calm",E=>{
    const A=AUTOREC,r=rng(3),h=A.createHistory();let px=82000,t=T0;for(let i=0;i<3700;i++){px*=1+(r()-.5)*2*1.5/1e4;t+=1000;A.push(h,t,px);}
    const live=A.vol(h,{},t+2000),stale=A.vol(h,{},t+60000),a=A.step({mode:"waiting"},stale,t+60000,{});
    return{ok:live.ready&&!stale.ready&&a.action===null,detail:JSON.stringify({live:live.ready,stale:stale.ready,action:a.action})};
  });
  add("landscape: a multi-venue episode on a single-venue grid is placed against that venue's mid; a merged mark keeps the newest stage and is dashed only if every mark was",E=>{
    const LS=READER_LANDSCAPE,T=100000,src={trades:[],t0:0,t1:T,mid:v=>v==="hl"?100:200},g={spanMs:60000,half:4,nx:41,venue:"hl"};
    const one=LS.episodeMarks(src,T,g,[{family:"burst",venues:["bn","hl"],stage:"ended",tStart:T-20000,tEnd:T-10000,tDetected:T-19000,px:100.02}]);
    const w=(a,b,px,st)=>({family:"wall",venue:"hl",stage:st,tStart:T-a,tEnd:T-b,tDetected:T-a+1000,px});
    const m=LS.episodeMarks(src,T,g,[w(20000,10000,100.02,"ended"),w(40000,23000,100.02,"fading"),w(60000,50000,104.5,"ended"),w(55000,52000,104.5,"ended")]);
    const mid=m.find(x=>!x.outside),far=m.find(x=>x.outside);
    return{ok:one.length===1&&Math.abs(one[0].u-.5)<1e-9&&m.length===2&&mid.n===2&&mid.stage==="ended"&&!!far&&far.n===2&&far.outside===true,detail:JSON.stringify({one:one.length&&one[0].u,m:m.map(x=>[x.n,x.stage,x.outside])})};
  });
  add("replay: an empty recording and one with unknown record types replay to a quiet engine without throwing",E=>{
    const a=E.replayEngine([]),b=E.replayEngine([["zz",1],["a",T0],["x"],["a",T0+1000]]);
    return{ok:a.events.length===0&&a.episodes.length===0&&b.events.length===0&&b.episodes.length===0,detail:`empty ${a.events.length}/${a.episodes.length}, unknown ${b.events.length}/${b.episodes.length}`};
  });
  add("register: a file from before the later fields (no seed2, settings, overrides, proposals, approvals, history, epoch) still loads and keeps learning",E=>{
    const r=R.create();for(let i=0;i<500;i++)r.observe(T0+i*1000,"hl",{ret:Math.sin(i)});r.endSession();
    const old=JSON.parse(JSON.stringify(r.save()));for(const k of ["seed2","settings","overrides","proposals","approvals","history","epoch"])delete old[k];
    const r2=R.create({},old);r2.observe(T0+9e5,"hl",{ret:1});
    return{ok:r2.sessions.length===1&&r2.overrides&&Object.keys(r2.overrides).length===0&&r2.epoch===0&&r2.snapshot().vars["hl|ret"].n===501,detail:`sessions ${r2.sessions.length}, n ${r2.snapshot().vars["hl|ret"].n}`};
  });
  add("register: a file carries the sigma scale; one without it loads, is flagged, and stays flagged until marked current",E=>{
    const r=R.create();for(let i=0;i<500;i++)r.observe(T0+i*1000,"hl",{ret:Math.sin(i)});r.endSession();
    const saved=JSON.parse(JSON.stringify(r.save())),fresh=R.create().review().scale.ok,marked=R.create({},saved).review().scale.ok;
    const old=JSON.parse(JSON.stringify(saved));delete old.sigmaScale;
    const r2=R.create({},old),flagged=!r2.review().scale.ok,again=JSON.parse(JSON.stringify(r2.save())).sigmaScale===undefined&&!R.create({},JSON.parse(JSON.stringify(r2.save()))).review().scale.ok;
    const learned=r2.snapshot().vars["hl|ret"].n===500;r2.confirmScale();
    const cleared=r2.review().scale.ok&&JSON.parse(JSON.stringify(r2.save())).sigmaScale===saved.sigmaScale;
    const empty=R.create({},{v:1,cum:{}}).review().scale.ok;
    return{ok:fresh&&marked&&flagged&&again&&learned&&cleared&&empty&&typeof saved.sigmaScale==="number",detail:JSON.stringify({fresh,marked,flagged,again,learned,cleared,empty})};
  });
  add("status: a connected, flowing market shows 'streaming' with the rate; nothing is shown while disconnected",E=>{
    const v=(ageMs,rate,on=true)=>({on,ageMs,rate}),base={connected:true,paused:false,online:true,venues:{bn:v(200,40),hl:v(900,8)},ar:{on:false},rec:{on:false},kept:0};
    const a=STATUS.chips(base),b=STATUS.chips(Object.assign({},base,{connected:false}));
    return{ok:a.length===1&&a[0].id==="data"&&a[0].tone==="ok"&&a[0].text==="streaming 48/s"&&b.length===0,detail:JSON.stringify({a,b})};
  });
  add("status: a venue silent for over 5 s, no network and a pause are called out; an unused venue is not blamed",E=>{
    const v=(ageMs,rate,on=true)=>({on,ageMs,rate}),base={connected:true,paused:false,online:true,venues:{bn:v(200,40),hl:v(12000,0)},ar:{on:false},rec:{on:false},kept:0};
    const silent=STATUS.chips(base)[0],never=STATUS.chips(Object.assign({},base,{venues:{bn:v(200,40),hl:v(null,0)}}))[0],off=STATUS.chips(Object.assign({},base,{venues:{bn:v(200,40),hl:v(null,0,false)}}))[0];
    const net=STATUS.chips(Object.assign({},base,{online:false}))[0],pz=STATUS.chips(Object.assign({},base,{paused:true}))[0];
    return{ok:silent.tone==="bad"&&silent.text==="HL silent 12 s"&&never.text==="HL silent"&&off.tone==="ok"&&net.id==="net"&&pz.text==="paused",detail:JSON.stringify({silent,never,off,net,pz})};
  });
  add("status: auto-record shows learning, waiting and recording; a lost wake lock and a manual recording are shown too",E=>{
    const base={connected:false,paused:false,online:true,venues:{},rec:{on:false},kept:2};
    const learn=STATUS.chips(Object.assign({},base,{ar:{on:true,ready:false,learnMin:4,wake:true}})),wait=STATUS.chips(Object.assign({},base,{ar:{on:true,ready:true,mode:"waiting",wake:false}}));
    const rec=STATUS.chips(Object.assign({},base,{ar:{on:true,ready:true,mode:"recording",wake:true},rec:{on:true,ms:192000,n:5}})),man=STATUS.chips(Object.assign({},base,{rec:{on:true,ms:65000,n:12345}}));
    const t=l=>l.map(c=>c.text).join(" | ");
    return{ok:t(learn)==="armed · learning 4/15 min | 2 saved"&&t(wait)==="armed · waiting | screen may sleep | 2 saved"&&t(rec)==="auto REC 3:12 | 2 saved"&&/^REC 1:05 · 12[.,  ]?345 inputs/.test(t(man)),detail:[t(learn),t(wait),t(rec),t(man)].join(" // ")};
  });
  add("status: only a higher release number counts as a newer version; a dev build never asks to update",E=>{
    const n=STATUS.newer;
    return{ok:n("v040","v041")&&!n("v040","v040")&&!n("v041","v040")&&n("v099","v100")&&!n("dev","v041")&&!n("v040","")&&!n("v040",null)&&!n("v040","latest"),detail:"version comparison"};
  });
  add("history: Binance orders, fills, income and the account are turned into the common rows, odd values included",E=>{
    const o=HIST.order({orderId:7,time:1000,updateTime:2000,symbol:"BTCUSDT",side:"BUY",type:"LIMIT",price:"82000.5",origQty:"0.010",executedQty:"0.004",avgPrice:"82000.50",status:"PARTIALLY_FILLED",reduceOnly:true,timeInForce:"GTC"});
    const o2=HIST.order({orderId:8,time:"x",symbol:null,price:"",origQty:undefined});
    const f=HIST.fill({id:5,orderId:7,time:3000,symbol:"BTCUSDT",side:"SELL",price:"82010",qty:"0.004",commission:"0.0131",commissionAsset:"USDT",realizedPnl:"-1.5",maker:true});
    const i=HIST.income({tranId:9,time:4000,symbol:"",incomeType:"FUNDING_FEE",income:"-0.25",asset:"USDT",info:"FUNDING_FEE"});
    const a=HIST.account({account:{canTrade:true,feeTier:2,multiAssetsMargin:false,assets:[{asset:"USDT",walletBalance:"100.5",availableBalance:"90",unrealizedProfit:"1.25",marginBalance:"101.75"},{asset:"BNB",walletBalance:"0",availableBalance:"0",unrealizedProfit:"0",marginBalance:"0"},{asset:"BTC",walletBalance:"0.001",availableBalance:"0.001",unrealizedProfit:"0",marginBalance:"0.001"}]},
      positions:[{symbol:"BTCUSDT",positionAmt:"-0.02",entryPrice:"82000",markPrice:"81900",unRealizedProfit:"2",leverage:"10",marginType:"cross",liquidationPrice:"0",positionSide:"BOTH"},{symbol:"ETHUSDT",positionAmt:"0.000",entryPrice:"0",markPrice:"3000",unRealizedProfit:"0",leverage:"20",marginType:"cross",liquidationPrice:"0"}],
      dual:{dualSidePosition:false},rate:{makerCommissionRate:"0.000200",takerCommissionRate:"0.000500"}});
    const none=HIST.account(null),partial=HIST.account({positions:"nope"});
    const ok=o.id===7&&o.price===82000.5&&o.qty===.01&&o.filled===.004&&o.status==="PARTIALLY_FILLED"&&o.reduce===true&&o2.t===0&&o2.symbol===""&&o2.price===0&&o2.qty===0
      &&f.fee===.0131&&f.pnl===-1.5&&f.maker===true&&f.feeAsset==="USDT"&&i.amount===-.25&&i.type==="FUNDING_FEE"
      &&a.assets.length===2&&a.assets[1].asset==="BTC"&&a.positions.length===1&&a.positions[0].qty===-.02&&a.positions[0].liq===null&&a.positions[0].marginType==="cross"&&a.positions[0].lev===10
      &&a.mode.hedge===false&&a.mode.multiAssets===false&&a.canTrade===true&&a.feeTier===2&&a.fees.maker===.0002&&a.fees.taker===.0005
      &&none.assets.length===0&&none.mode.hedge===null&&none.canTrade===null&&none.fees===null&&partial.positions.length===0;
    return{ok,detail:JSON.stringify({o,o2,a})};
  });
  add("history: the simulated account is shown in the same shape as a Binance one",E=>{
    const a=HIST.simAccount({balance:{wallet:10004.5,available:9900,upnl:-3.5},positions:[{symbol:"BTCUSDT",qty:-0.5,entry:100,mark:101,upnl:-0.5,liq:null,lev:"10 (sim)"}]},{maker:.0002,taker:.0005}),e=HIST.simAccount(null,null);
    const ok=a.assets.length===1&&a.assets[0].asset==="USDT"&&a.assets[0].margin===10001&&a.positions[0].lev===10&&a.positions[0].qty===-.5&&a.positions[0].marginType==="simulated"&&a.mode.hedge===false&&a.canTrade===true&&a.fees.taker===.0005&&a.feeTier===null
      &&e.assets[0].wallet===0&&e.positions.length===0&&e.fees===null;
    return{ok,detail:JSON.stringify(a)};
  });
  add("history: the table and CSV columns exist on the rows, the CSV gets a UTC time, symbols and periods are worked out",E=>{
    const o=HIST.order({orderId:1,time:1700000000000,symbol:"BTCUSDT"}),f=HIST.fill({id:2,time:1700000001000,symbol:"ETHUSDT"}),i=HIST.income({tranId:3,time:1700000002000,symbol:"",incomeType:"FUNDING_FEE",income:"1"}),i2=HIST.income({tranId:3,time:1700000002000,symbol:"BTCUSDT",incomeType:"COMMISSION",income:"-1"});
    const has=(k,row)=>HIST.COLUMNS[k].every(c=>c[0]==="iso"||c[0] in row);
    const co=HIST.csvRows([o])[0],csv=HIST.toCsv(HIST.csvRows([o]),HIST.COLUMNS.orders).split(String.fromCharCode(13,10));
    const p=HIST.period(7,1700000000000);
    const ok=has("orders",o)&&has("fills",f)&&has("income",i)&&co.iso==="2023-11-14T22:13:20.000Z"&&csv[0].startsWith("time (UTC),symbol,side")&&csv[1].startsWith("2023-11-14T22:13:20.000Z,BTCUSDT")
      &&HIST.symbols([{symbol:"ETHUSDT"},{symbol:""},{symbol:"BTCUSDT"},{symbol:"ETHUSDT"},{}]).join()==="BTCUSDT,ETHUSDT"&&HIST.symbols(null).length===0&&p.to-p.from===HIST.WINDOW&&HIST.period(30,1700000000000).to-HIST.period(30,1700000000000).from===30*HIST.DAY&&HIST.period(1,1700000000000).to-HIST.period(1,1700000000000).from===HIST.DAY&&HIST.pieces(p.from,p.to).length===1
      &&i.id!==i2.id&&HIST.merge([i,i2]).length===2;
    return{ok,detail:JSON.stringify({co,csv})};
  });
  add("history: income totals by type inside a period, fill totals and order status counts",E=>{
    const rows=[{t:100,type:"REALIZED_PNL",amount:5,asset:"USDT"},{t:200,type:"COMMISSION",amount:-.5,asset:"USDT"},{t:300,type:"REALIZED_PNL",amount:-2,asset:"USDT"},{t:400,type:"FUNDING_FEE",amount:-.1,asset:"BNB"},{t:500,type:"COMMISSION",amount:-.2,asset:"USDT"}];
    const all=HIST.totals(rows),part=HIST.totals(rows,200,500),empty=HIST.totals([]),none=HIST.totals(null);
    const ft=HIST.fillTotals([{qty:2,price:100,fee:.1,pnl:3},{qty:1,price:50,fee:.05,pnl:-1}]),sc=HIST.statusCounts([{status:"FILLED"},{status:"CANCELED"},{status:"FILLED"}]);
    const ok=all.n===5&&Math.abs(all.total-2.2)<1e-9&&Math.abs(all.byType.REALIZED_PNL.amount-3)<1e-9&&all.byType.REALIZED_PNL.n===2&&all.assets.join()==="BNB,USDT"
      &&part.n===3&&part.byType.COMMISSION.n===1&&part.byType.REALIZED_PNL.n===1&&empty.n===0&&empty.total===0&&none.n===0
      &&ft.n===2&&ft.volume===250&&Math.abs(ft.fee-.15)<1e-9&&ft.pnl===2&&sc.FILLED===2&&sc.CANCELED===1;
    return{ok,detail:JSON.stringify({all,part,ft,sc})};
  });
  add("history: a long period is cut into pieces under 7 days that cover it without a gap, and repeated rows count once",E=>{
    const to=1.7e12,from=to-30*HIST.DAY,p=HIST.pieces(from,to);
    let gap=false;for(let k=1;k<p.length;k++)if(p[k][1]+1!==p[k-1][0])gap=true;
    const short=HIST.pieces(to-1000,to),same=HIST.pieces(to,to),back=HIST.pieces(to,to-5);
    const m=HIST.merge([{id:1,t:10},{id:2,t:30},{id:1,t:10},{id:3,t:20},{id:null,t:5},{t:4}]);
    const ok=p.length===5&&p[0][1]===to&&p[p.length-1][0]===from&&!gap&&p.every(x=>x[1]-x[0]<7*HIST.DAY)&&short.length===1&&short[0][0]===to-1000&&same.length===0&&back.length===0
      &&m.map(r=>r.t).join()==="30,20,10,5,4";
    return{ok,detail:JSON.stringify({n:p.length,gap,m})};
  });
  add("history: CSV quotes commas, quotes and line breaks and defuses a text cell a spreadsheet would run as a formula",E=>{
    const NL=String.fromCharCode(10),CR=String.fromCharCode(13),CRLF=CR+NL;
    const csv=HIST.toCsv([{a:"x,y",b:'say "hi"',c:-1.5,d:"=1+1"},{a:"two"+NL+"lines",b:null,c:0,d:"@SUM"},{a:"-ok",b:undefined,c:2,d:"+3"}],[["a","A"],["b","B"],["c","C"],["d","D"]]);
    const lines=csv.split(CRLF),first=csv.indexOf("two"),q='"';
    const ok=lines[0]==="A,B,C,D"&&lines[1]===q+"x,y"+q+","+q+'say ""hi""'+q+",-1.5,'=1+1"&&csv.slice(first-1,first+10)===q+"two"+NL+"lines"+q&&csv.includes(",0,'@SUM")&&csv.includes("-ok,,2,'+3")&&csv.endsWith(CRLF)&&HIST.toCsv([],[["a","A"]])==="A"+CRLF;
    return{ok,detail:JSON.stringify(csv)};
  });
  add("history: the simulated log keeps only the newest rows once it is over its cap",E=>{
    const a=[];for(let k=0;k<HIST.LOG_CAP+25;k++)HIST.push(a,{k});
    return{ok:a.length===HIST.LOG_CAP&&a[0].k===25&&a[a.length-1].k===HIST.LOG_CAP+24,detail:`${a.length} rows, first ${a[0].k}`};
  });
  add("autorec: after a recording it stays armed but waits out the cooldown, then starts again on the next jump",E=>{
    const A=AUTOREC,r=rng(9),h=A.createHistory(),cfg={cooldownMin:10};let px=82000,t=T0,st={mode:"waiting"};const ev=[];
    const run=(secs,vol)=>{for(let i=0;i<secs;i++){px*=1+(r()-.5)*2*vol/1e4;t+=1000;A.push(h,t,px);if(i%5===4){const v=A.vol(h,cfg),o=A.step(st,v,t,cfg);st=o.st;if(o.action){ev.push({a:o.action,why:o.why,t});if(o.action==="stop")st=A.afterStop(t,cfg);}}}};
    run(2400,.3);run(900,1.2);for(let g=0;g<1000&&!ev.some(x=>x.a==="stop");g++)run(5,.3);      // learn, a jump, calm until the recording stops: then the view stays armed
    const stop=ev.find(x=>x.a==="stop"),n1=ev.length;
    run(180,2.5);const v=A.vol(h,cfg),wouldTrigger=v.fast>=cfg.trigSigma||v.ratio>=1.8&&v.fast>=.4,blocked=ev.length===n1&&st.mode==="waiting";   // wild again 3 minutes later, inside the cooldown
    run(600,2.5);const second=ev.filter(x=>x.a==="start")[1];                  // still wild once the cooldown is over
    const none=A.step({mode:"waiting"},{ready:true,ratio:3,fast:2},T0,cfg).action==="start";   // a state with no cooldown starts at once
    return{ok:!!stop&&n1===2&&wouldTrigger&&blocked&&!!second&&second.t>=stop.t+600000&&none&&A.afterStop(T0,{}).until===T0+600000,detail:JSON.stringify({n1,wouldTrigger,blocked,second:second&&(second.t-stop.t)/1000,none})};
  });
  add("status: auto-record shows the cooldown after a recording and how many it has made",E=>{
    const base={connected:false,paused:false,online:true,venues:{},rec:{on:false},kept:0},t=l=>l.map(c=>c.text).join(" | ");
    const cd=STATUS.chips(Object.assign({},base,{ar:{on:true,ready:true,mode:"waiting",wake:true,runs:1,cooldownMin:7}})),after=STATUS.chips(Object.assign({},base,{ar:{on:true,ready:true,mode:"waiting",wake:true,runs:2,cooldownMin:0}}));
    return{ok:t(cd)==="armed · cooldown 7 min"&&t(after)==="armed · waiting · 2 recorded",detail:t(cd)+" // "+t(after)};
  });
  function run(Eng){return scenarios.map(sc=>{try{const r=sc.run(Eng);return{name:sc.name,ok:!!r.ok,detail:r.detail};}catch(err){return{name:sc.name,ok:false,detail:String(err&&err.stack||err)};}});}
  return {T0,rng,poisson,levels,sim,scenarios,run};
})();