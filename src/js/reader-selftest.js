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
  add("malformed books are ignored",E=>{const e=E.create(),a=calm(e,130),before=e.events.length;try{e.onBook("bn",a.t+250,[],[[100,1]]);e.onBook("bn",a.t+500,[[101,1]],[[100,1]]);e.onBook("bn",a.t+750,[[100,0],[99,NaN],null],[[101,-1],"x"]);e.onBook("bn",a.t+1000,[[100,1],[99,50]],[[101,1],[102,1]]);e.onBook("zz",a.t+1250,[[100,1]],[[101,1]]);e.onBook("bn",a.t+1500,null,undefined);}catch(err){return{ok:false,detail:"threw: "+err.message};}return result(e.events.length===before&&e.debug().venues.bn.walls.size===0,e,"no events and no walls");});
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
  add("wall episodes: a wall that is already fading when it would open (below the fade fraction of its peak) does not open an episode; one that holds does",E=>{
    const run=(low)=>{const e=E.create(),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:75,seed:11,params:sec=>({vol:0,bidWalls:[{idx:12,size:sec<50?20:low}]})});sim(e,{t0:b.t,mid0:b.mid,seconds:4,seed:12,params:()=>({vol:0})});return eps(e,"wall").length;};
    const fading=run(8),holding=run(18);      // 8 is 40% of the peak (20) yet still well over the opening ratio; 18 is 90%
    return{ok:fading===0&&holding===1,detail:JSON.stringify({fading,holding})};
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
  add("collectors: a worker socket close is logged with its code and who closed it; our own stop is not; a flapping source is capped at 5 notes an hour and counts what it left out",E=>{
    const notes=[];let t=T0;const sw=COLLECT.sockWatch(m=>notes.push(m),()=>t);
    const mk=()=>{const h={};return{addEventListener(n,f){h[n]=f;},close(){},fire(n,e){h[n]&&h[n](e||{});}};};
    const a=mk();sw.watch("venue x",a);t=T0;a.fire("open");t=T0+1000;a.fire("message");a.fire("message");t=T0+31000;a.fire("error");a.fire("close",{code:1006,wasClean:false,reason:""});
    const b=mk();sw.watch("venue y",b);t=T0;b.fire("open");sw.shut(b,"silent");t=T0+40000;b.fire("close",{code:1000,wasClean:true,reason:"bye"});
    const c=mk();sw.watch("venue z",c);sw.shut(c,"stop");c.fire("close",{code:1000,wasClean:true});
    const n0=notes.length,d=notes[0].d,e=notes[1].d;
    const f=mk();sw.watch("flap",f);for(let i=0;i<8;i++){t=T0+100000+i*5000;f.fire("open");f.fire("close",{code:1006,wasClean:false});}
    const fl=notes.filter(x=>x.d.src==="flap");t=T0+100000+3600000+5000;const g=mk();sw.watch("flap",g);g.fire("open");g.fire("close",{code:1001,wasClean:true});
    const after=notes.filter(x=>x.d.src==="flap");
    return{ok:n0===2&&notes[0].k==="socket closed"&&d.src==="venue x"&&d.code===1006&&d.clean===false&&d.upMs===31000&&d.silentMs===30000&&d.msgs===2&&d.errors===1&&d.ours===null&&e.ours==="silent"&&e.code===1000&&e.clean===true&&e.reason==="bye"&&fl.length===5&&after.length===6&&after[5].d.left_out===3&&after[5].d.closes===9,detail:JSON.stringify({n0,d,e,fl:fl.length,after:after.length,last:after[after.length-1]&&after[after.length-1].d})};
  });
  add("collectors: the tape is pruned to its window, sliced for a session, and fitted to the file budget",E=>{
    const recs=[];for(let i=0;i<100;i++)recs.push(COLLECT.rec("feeds",T0+i*10000,{n:i,pad:"x".repeat(50)}));
    const now=T0+99*10000,pr=COLLECT.prune(recs,now,200000),sl=COLLECT.slice(recs,T0+100000,T0+200000),ft=COLLECT.fit(recs,1500);
    return{ok:pr.length===21&&sl.length===11&&ft.length>5&&ft.length<30&&ft[ft.length-1]===recs[99]&&JSON.stringify(ft).length<=1500&&COLLECT.fit(recs,1e9).length===100,detail:JSON.stringify({pr:pr.length,sl:sl.length,ft:ft.length})};
  });
  add("collectors: derivatives readers parse the real answer shapes and refuse unusable ones",E=>{
    const pr=COLLECT.premium({symbol:"BTCUSDT",markPrice:"80667.20261594",indexPrice:"80708.63673913",estimatedSettlePrice:"80784.82",lastFundingRate:"0.00003407",nextFundingTime:1792800000000,time:1792797389000});
    const oi=COLLECT.openInterest({symbol:"BTCUSDT",openInterest:"92836.854",time:1792797387450});
    const hl=COLLECT.hlCtx([{universe:[{name:"ETH"},{name:"BTC"}]},[{markPx:"1"},{funding:"0.0000125",openInterest:"44627.99",premium:"-0.00015",oraclePx:"80702.0",markPx:"80688.7",midPx:"80689.5"}]],"BTC");
    const fo=COLLECT.force({e:"forceOrder",E:1,o:{s:"BTCUSDT",S:"BUY",q:"0.039",p:"81115.10",ap:"80803.10",X:"FILLED",z:"0.039",T:1792797483260}});
    const bs=COLLECT.basis({e:"markPriceUpdate",p:"80782.5",i:"80817.3426",r:"0.00003376",T:1792800000000});
    const bad=[COLLECT.premium({}),COLLECT.premium(null),COLLECT.openInterest({openInterest:"x"}),COLLECT.hlCtx([{universe:[{name:"ETH"}]},[{markPx:"1"}]],"BTC"),COLLECT.hlCtx({},"BTC"),COLLECT.force({e:"markPriceUpdate"}),COLLECT.force({e:"forceOrder",o:{S:"BUY"}}),COLLECT.basis({p:"1"})];
    return{ok:pr.mark===80667.20261594&&pr.fund===.00003407&&pr.next===1792800000000&&oi.oi===92836.854&&hl.fund===.0000125&&hl.mark===80688.7&&hl.oi===44627.99&&fo.side==="BUY"&&fo.qty===.039&&fo.px===80803.1&&bs.bps===-4.31&&bad.every(x=>x===null),detail:JSON.stringify({pr,oi,hl,fo,bs,bad})};
  });
  add("collectors: polls are due on their own schedule",E=>{
    const E_=COLLECT.EVERY;
    return{ok:COLLECT.due(0,T0,E_.prem)&&!COLLECT.due(T0,T0+14999,E_.prem)&&COLLECT.due(T0,T0+15000,E_.prem)&&!COLLECT.due(T0,T0+9999,E_.basis)&&COLLECT.due(T0,T0+10000,E_.basis)&&COLLECT.BACKOFF_MS===300000&&COLLECT.REGISTRY.some(c=>c.id==="derivs"&&c.on),detail:JSON.stringify(E_)};
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
  add("collectors: venue prices: sockets per coin, real message shapes parsed, partial Bybit updates merged, ages and lags in the record",E=>{
    const J=JSON.stringify,P=COLLECT.venueParse,subs=COLLECT.venueSubs("btc"),eth=COLLECT.venueSubs("ETH");
    const cb=P("cb",{type:"ticker",product_id:"BTC-USD",price:"80993.52",best_bid:"80993.51",best_ask:"80993.52",time:"2026-10-23T23:48:10.644540Z"});
    const by1=P("byL",{topic:"tickers.BTCUSDT",type:"snapshot",ts:1000,data:{symbol:"BTCUSDT",lastPrice:"81058.90",markPrice:"81059.93",indexPrice:"81102.51",fundingRate:"0.0000649",bid1Price:"81058.80",ask1Price:"81058.90"}});
    const by2=P("byL",{topic:"tickers.BTCUSDT",type:"delta",ts:1100,data:{symbol:"BTCUSDT",bid1Price:"81054.70",bid1Size:"0.976"}});
    const bn=P("bnS",{stream:"btcusdt@bookTicker",data:{u:1,s:"BTCUSDT",b:"81105.85000000",B:"2.3",a:"81105.86000000",A:"2.9"}});
    const junk=[P("cb",{type:"subscriptions"}),P("byL",{success:true,op:"subscribe"}),P("bnS",{result:null}),P("cb",null),P("zz",{}),P("ok",{arg:{channel:"tickers"},data:[{instType:"SWAP"}]}),P("maj",{data:{e:"markPriceUpdate",s:"ETHUSDT",p:"1"}})];
    const st={};COLLECT.venueApply(st,by1,10000);COLLECT.venueApply(st,by2,10200);COLLECT.venueApply(st,bn,10300);COLLECT.venueApply(st,null,1);
    const r=COLLECT.venueRecord(st,11000),none=COLLECT.venueRecord({},1);
    return{ok:subs.length===3&&subs[0].sub.product_ids[0]==="BTC-USD"&&subs[1].sub.args[0]==="tickers.BTCUSDT"&&subs[2].url.endsWith("btcusdt@bookTicker")&&eth[2].url.includes("ethusdt")&&subs[1].ping.op==="ping"
      &&cb.src==="cb"&&cb.set.b===80993.51&&cb.set.a===80993.52&&cb.set.l===80993.52&&cb.e===Date.parse("2026-10-23T23:48:10.644Z")
      &&by1.set.m===81059.93&&by1.set.i===81102.51&&by1.set.f===.0000649&&J(Object.keys(by2.set))==='["b"]'&&by2.set.b===81054.7
      &&bn.src==="bnS"&&bn.set.b===81105.85&&bn.e===null&&junk.every(x=>x===null)
      &&r.byL.b===81054.7&&r.byL.m===81059.93&&r.byL.age===800&&r.byL.lag===9100&&r.bnS.age===700&&r.bnS.lag===undefined&&none===null&&COLLECT.REGISTRY.some(c=>c.id==="venues"&&c.speed==="fast"),detail:J({cb,by1,by2,bn,r})};
  });
  add("collectors: Binance and Hyperliquid books in the worker: snapshot window as reach, stale and straddling first diff, pu chain, gap resync, flow, Hyperliquid parse, bucketed top-up and stale book",E=>{
    const J=JSON.stringify,P=COLLECT.bookParse,T0=1792800000000;
    const snap=id=>({lastUpdateId:id,E:T0,T:T0,bids:[["100000","2"],["99990","3"],["99900","5"]],asks:[["100001","1"],["100010","4"],["100100","6"]]});
    const ev=(U,u,pu,b,a)=>({stream:"btcusdt@depth@100ms",data:{e:"depthUpdate",E:T0,T:T0,s:"BTCUSDT",U,u,pu,b,a}});
    const b=COLLECT.perpBook("bn"),r0=b.apply(P("bn",ev(5,6,4,[["100000","1"]],[]))),r1=b.apply(P("bn",snap(100))),s1=b.summary();
    const r2=b.apply(P("bn",ev(90,100,89,[["100000","9"]],[]))),r3=b.apply(P("bn",ev(95,105,99,[["99990","0"],["100000","2.5"],["99995","1"]],[["100001","0"],["100020","2"]]))),s3=b.summary();
    const r4=b.apply(P("bn",ev(106,110,105,[],[]))),r5=b.apply(P("bn",ev(112,115,111,[],[]))),afterGap=b.ready();
    const r6=b.apply(P("bn",snap(200))),r7=b.apply(P("bn",ev(250,260,249,[],[]))),afterFirst=b.ready();
    const r8=b.apply(P("bn",snap(300))),r9=b.apply(P("bn",ev(300,301,299,[],[]))),r10=b.apply(P("bn",ev(302,303,301,[["99995","1"]],[]))),st=b.stats();
    const raw=ev(1,2,0,[],[]).data,sub=COLLECT.bnBookSub("btc");
    const lv=(px,sz,n)=>({px,sz,n:n||1}),hl={channel:"l2Book",data:{coin:"BTC",time:T0,levels:[[lv("100000","2"),lv("99999","1")],[lv("100001","1.5")]]}};
    const h=COLLECT.hlBookParse(hl,"btc"),cur={bids:h.bids,asks:h.asks,at:T0},co=COLLECT.hlCoarse({coin:"BTC",levels:[[lv("99920","3"),lv("99500","4")],[lv("100080","3.5"),lv("100500","5")]]});
    const h1=COLLECT.hlBookSummary(cur,null,T0+1000,0),h2=COLLECT.hlBookSummary(cur,co,T0+1000,T0+500),h3=COLLECT.hlBookSummary(cur,co,T0+1000,T0-20000),h4=COLLECT.hlBookSummary(cur,co,T0+6000,T0+5900),h5=COLLECT.hlBookSummary(null,co,T0,0);
    const reg=COLLECT.REGISTRY.find(c=>c.id==="book");
    return{ok:J(r0)==='"ignored"'&&r1==="snapshot"&&s1.mid===100000.5&&J(s1.d[1])==='[2,5]'&&J(s1.d[5])==='[5,5]'&&J(s1.d[10])==='[5,null]'&&J(s1.d[20])==='[null,null]'&&s1.reach[0]>=10&&s1.reach[1]<10
      &&r2==="ignored"&&r3==="ok"&&s3.tb===2.5&&s3.ta===4&&Math.abs(s3.fl.b.add-1.5)<1e-9&&Math.abs(s3.fl.b.rem-3)<1e-9&&s3.fl.a.add===2&&s3.fl.a.rem===1&&s3.reach[0]>=10&&s3.reach[1]<10
      &&r4==="ok"&&r5==="resync"&&!afterGap&&r6==="snapshot"&&r7==="resync"&&!afterFirst&&r8==="snapshot"&&r9==="ok"&&r10==="ok"&&b.ready()&&st.gap===2&&st.resync===2&&st.snap===3&&st.ign===2
      &&P("bn",ev(1,2,0,[],[])).type==="delta"&&P("bn",raw).type==="delta"&&P("bn",raw).first===1&&P("bn",snap(1)).type==="snapshot"&&P("bn",{e:"aggTrade"})===null&&P("bn",{result:null,id:1})===null
      &&sub.url.indexOf("/public/stream?streams=btcusdt@depth@100ms")>0&&sub.snap.indexOf("symbol=BTCUSDT&limit=1000")>0
      &&J(h)==='{"bids":[[100000,2],[99999,1]],"asks":[[100001,1.5]]}'&&COLLECT.hlBookParse(hl,"eth")===null&&COLLECT.hlBookParse({channel:"subscriptionResponse"},"btc")===null&&COLLECT.hlBookParse(null,"btc")===null
      &&co&&co.mid===100000&&h1&&h1.mid===100000.5&&h1.cAge===null&&h2.cAge===500&&h2.coarse.length>0&&h2.d[10][0]!==null&&h3.cAge===21000&&h3.coarse.length===0&&h4===null&&h5===null
      &&reg&&reg.owner==="worker"&&reg.speed==="fast"&&COLLECT.ownerOf("bookBn")==="book"&&COLLECT.ownerOf("bookHl")==="book",
      detail:J({r0,r1,s1,r2,r3,s3,r4,r5,r6,r7,r8,r9,r10,st,h,co,h1,h2,h3})};
  });
  add("collectors: status lines: records are attributed to their collector, and a quiet or idle collector is told apart from a working one",E=>{
    const J=JSON.stringify,R=COLLECT.rec,recs=[R("feeds",100,{}),R("feeds",300,{}),R("markPrice",200,{}),R("bookBn",50,{}),R("venues",70,{}),R("nope",999,{}),["t",{}],["c","cal"],R("cal",400,{})];
    const t=COLLECT.tally(recs),H=COLLECT.health;
    const ok=H({on:true,why:null,n:1234,ageMs:3000,expectMs:60000,sinceMs:1e6}),slow=H({on:true,why:null,n:5,ageMs:400000,expectMs:60000,sinceMs:1e6});
    const idle=H({on:true,why:"waits for a recording",n:0,ageMs:null,expectMs:10000,sinceMs:1e6}),idleN=H({on:true,why:"waits for a recording",n:2500,ageMs:9e6,expectMs:10000,sinceMs:1e6});
    const start=H({on:true,why:null,n:0,ageMs:null,expectMs:60000,sinceMs:20000}),silent=H({on:true,why:null,n:0,ageMs:null,expectMs:60000,sinceMs:400000}),off=H({on:false,why:null,n:9,ageMs:1,expectMs:1,sinceMs:1});
    const owners=Object.values(COLLECT.OWNER);
    return{ok:J(t.telemetry)==='{"n":3,"last":300}'&&t.book.n===1&&t.venues.last===70&&t.calendar.n===1&&Object.keys(t).length===4&&COLLECT.ownerOf("liq")==="derivs"&&COLLECT.ownerOf("hlLiq")===null&&COLLECT.ownerOf("zzz")===null
      &&ok.tone==="ok"&&ok.text==="1,234 on the tape · last 3 s ago"&&slow.tone==="warn"&&/slower than expected/.test(slow.text)&&idle.tone==="idle"&&idle.text==="waits for a recording"&&idleN.text==="waits for a recording · 2,500 on the tape"
      &&start.tone==="info"&&silent.tone==="warn"&&off.tone==="off"&&off.text==="off"
      &&COLLECT.ageText(4000)==="4 s"&&COLLECT.ageText(120000)==="2 min"&&COLLECT.ageText(7200000)==="2 h"
      &&COLLECT.REGISTRY.every(c=>owners.includes(c.id)&&COLLECT.EXPECT_MS[c.id]>0),detail:J({t,ok,slow,idle,idleN,start,silent,off})};
  });
  add("collectors: registry: every collector declares owner, interval and records; OWNER, EXPECT_MS, FEATURES and FEATURE_INFO are exactly what the collectors contribute, in the fixed feature order",E=>{
    const J=JSON.stringify,R=COLLECT.REGISTRY,ids=R.map(c=>c.id),recNames=R.reduce((a,c)=>a.concat(c.records),[]);
    const union=[];R.forEach(c=>Object.keys(c.features).forEach(f=>union.push(f)));
    const feats=Object.keys(COLLECT.FEATURES),info=Object.keys(COLLECT.FEATURE_INFO);
    const ORDER_HEAD=["dvol.vol","bnDerivs.fund","bnDerivs.basisBps","bnDerivs.oi","hlCtx.fund","hlCtx.prem","hlCtx.oi","basis.bps","bookBn.spread","bookBn.imbalance5","bookBn.depth5","bookHl.spread","bookHl.imbalance5","bookHl.depth5","venues.coinbaseVsBinanceBps","venues.bybitVsBinanceBps"];      // the order analysis plans depend on
    const ok1=ids.length===new Set(ids).size&&R.every(c=>(c.owner==="worker"||c.owner==="page")&&c.expectMs>0&&c.records.length>0&&c.features&&c.info&&typeof c.label==="string"&&(c.speed==="fast"||c.speed==="slow"));
    const ok2=recNames.length===new Set(recNames).size&&recNames.every(n=>COLLECT.ownerOf(n)&&R.find(c=>c.id===COLLECT.ownerOf(n)).records.includes(n))&&Object.keys(COLLECT.OWNER).length===recNames.length;
    const ok3=Object.keys(COLLECT.EXPECT_MS).length===R.length&&R.every(c=>COLLECT.EXPECT_MS[c.id]===c.expectMs);
    const ok4=feats.length===union.length&&union.every(f=>feats.includes(f))&&J(feats)===J(ORDER_HEAD);      // FEATURE_ORDER lists every contribution (a new one not in it lands last and fails the next line)
    const ok5=R.every(c=>Object.keys(c.info).every(f=>c.features[f]))&&info.every(f=>feats.includes(f))&&Object.keys(COLLECT.FEATURES).every(f=>R.find(c=>c.features[f]).records.includes(COLLECT.FEATURES[f][0]));
    return{ok:ok1&&ok2&&ok3&&ok4&&ok5,detail:J({ok1,ok2,ok3,ok4,ok5,feats:feats.length,union:union.length})};
  });
  add("collectors: context at a moment: a feature far from its own recent mean is unusual, a constant one that moves is too, stale or future readings are ignored, liquidations are counted",E=>{
    const R=COLLECT.rec,recs=[],T=T0,J=JSON.stringify;
    for(let i=0;i<=240;i++){const t=T+i*10000;      // 40 minutes
      recs.push(R("dvol",t,{vol:(i<234?50+Math.sin(i)*.3:60),idx:1}));
      recs.push(R("hlCtx",t,{fund:i<239?0.0000125:0.0001125,oi:1000+Math.cos(i)*2,prem:Math.sin(i*2)*1e-5}));
      recs.push(R("bookBn",t,{spr:0.01,d:{"5":[10,10]}}));}
    const now=T+40*60000-5000;
    recs.push(R("dvol",now+10000,{vol:999,idx:1}));      // in the future of `now`
    recs.push(R("liq",now-30000,{}),R("liq",now-31000,{}),R("liq",now-90000,{}),R("hlLiq",now-10000,{}));
    const c=COLLECT.context(recs,now),by=f=>c.items.find(x=>x.f===f),early=COLLECT.context(recs,T+20*60000),none=COLLECT.context([],now);
    return{ok:c.items.length>=3&&c.items[0].f==="hlCtx.fund"&&c.items[1].f==="dvol.vol"&&by("dvol.vol").unusual&&by("dvol.vol").z>5&&/^\+(19|20|21|22)(\.\d)?%$/.test(by("dvol.vol").text)
      &&by("hlCtx.fund")&&by("hlCtx.fund").unusual&&by("hlCtx.fund").z===99&&by("hlCtx.fund").text==="+1 bps"
      &&by("bookBn.depth5")&&!by("bookBn.depth5").unusual&&by("bookBn.depth5").z===0&&!by("optChain.atmVol")&&by("dvol.vol").x===60
      &&c.liq.bn===2&&c.liq.hl===1&&early.items.length>=2&&!early.items.find(x=>x.f==="dvol.vol").unusual&&none.items.length===0&&none.liq.bn===0
      &&c.items.every((x,i,a)=>!i||Math.abs(a[i-1].z)>=Math.abs(x.z))&&COLLECT.REGISTRY.length===6&&Object.keys(COLLECT.FEATURES).length===16,
      detail:J({n:c.items.length,top:c.items.slice(0,4).map(x=>[x.f,x.z,x.text,x.unusual]),liq:c.liq,early:early.items.length})};
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
  add("3a: evidence cut-offs that used to be inline are named config and actually drive the evidence",E=>{
    const run=cfg=>{const e=E.create(cfg),a=calm(e),b=sim(e,{t0:a.t,mid0:a.mid,seconds:12,seed:21,params:()=>burstSell});sim(e,{t0:b.t,mid0:b.mid,seconds:40,seed:22});return eps(e,"burst",p=>p.horizon==="fast"&&p.aggressor==="sell")[0];};
    const d=READER_EPISODES.DEFAULTS,x=run(),y=run({ep:{burstLiq:99}}),liq=ep=>ep&&ep.peakEvidence.find(i=>i.k==="liq");
    const named=["recentShare","recentPace","crossShare","crossZ","burstLiq","burstSweeps","exhDecay","exhWasZ","exhWasShare","exhGap","exhSize"].every(k=>typeof d[k]==="number");
    return{ok:named&&x&&liq(x).ok&&(!y||!liq(y).ok),detail:"named="+named+" liq ok by default="+(x&&liq(x).ok)};
  });
  add("3b: replay in chunks equals a one-shot replay, and a root threshold override changes what is detected",E=>{
    const e=E.create();e.startRecording();const a=calm(e),h1=sim(e,{t0:a.t,mid0:a.mid,seconds:20,seed:41,params:()=>heavySell});sim(e,{t0:h1.t,mid0:h1.mid,seconds:30,seed:44});const inputs=e.stopRecording();
    const whole=E.replayEngine(inputs),ch=E.create();for(let i=0;i<inputs.length;i+=777)E.feed(ch,inputs,i,i+777);
    const sig=x=>x.episodes.map(p=>[p.family,p.tStart,p.tEnd,p.stage].join(":")).join(),strict=E.replayEngine(inputs,{absorbShare:.99});
    return{ok:whole.episodes.length>0&&sig(whole)===sig(ch)&&strict.episodes.filter(p=>p.family==="absorption").length<whole.episodes.filter(p=>p.family==="absorption").length,detail:"chunked or override differs"};
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
  add("sigma: a market where most 1-second returns are zero still gets an honest sigma",E=>{
    const e=E.create(),a=jumpSim(e,{seconds:900}),sg=e.debug().sigmaBps("bn"),true1=Math.sqrt(.08*4)*1.2,zs=zeroShare(e);
    return{ok:zs>.5&&sg>.5*true1&&sg<1.5*true1,detail:JSON.stringify({zeroShare:+zs.toFixed(2),sigma:+sg.toFixed(3),true1:+true1.toFixed(3)})};
  });
  add("sigma: a market with about 30% zero returns (quiet Hyperliquid) is not underestimated",E=>{
    const e=E.create(),o={seconds:900,pJump:.26,jumpBps:1},x=jumpSim(e,o),sg=e.debug().sigmaBps("bn"),true1=Math.sqrt(.26*4)*1,zs=zeroShare(e);
    return{ok:zs>.15&&zs<.6&&sg>.75*true1&&sg<1.25*true1,detail:JSON.stringify({zeroShare:+zs.toFixed(2),sigma:+sg.toFixed(3),true1:+true1.toFixed(3)})};
  });
  add("sigma: until there is enough history it stays at the floor instead of guessing",E=>{
    const e=E.create();jumpSim(e,{seconds:40});return{ok:e.debug().sigmaBps("bn")===.05,detail:String(e.debug().sigmaBps("bn"))};
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
  // ---- auto-record (v031): when to start and stop recording, from a one-second price series ----
  add("replay: an empty recording and one with unknown record types replay to a quiet engine without throwing",E=>{
    const a=E.replayEngine([]),b=E.replayEngine([["zz",1],["a",T0],["x"],["a",T0+1000]]);
    return{ok:a.events.length===0&&a.episodes.length===0&&b.events.length===0&&b.episodes.length===0,detail:`empty ${a.events.length}/${a.episodes.length}, unknown ${b.events.length}/${b.episodes.length}`};
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
  add("session quality: each collector's records, minutes and longest silence over the recording; none / holes / ok; slow writers and the lead-in are not judged; the list line names the problem",E=>{
    const J=JSON.stringify,T0=1792800000000,MIN=60000,to=T0+10*MIN;
    const reg=[{id:"venues",records:["venues"],expectMs:10000},{id:"book",records:["bookBn","bookHl"],expectMs:10000},{id:"derivs",records:["bnDerivs"],expectMs:60000},{id:"calendar",records:["cal"],expectMs:900000},{id:"options",records:["dvol"],expectMs:60000}];
    const ext=[];
    for(let t=T0-5*MIN;t<=to;t+=10000)ext.push(["c","venues",t,{}]);                 // before the start too: the lead-in is not counted
    for(let t=T0+1000;t<=to;t+=1000){ if(t>T0+3*MIN&&t<T0+8*MIN)continue; ext.push(["c","bookBn",t,{}]); }      // book: silent 5 minutes in the middle
    for(let t=T0;t<=to;t+=60000)ext.push(["c","bnDerivs",t,{}]);
    ext.push(["x"],["c","zzz",T0+5,{}],["c","venues","bad",{}]);
    const c=SQ.collectors(ext,T0,to,reg),q={verdict:"complete",dataMinutes:10,minutes:10,longestGapSec:1,clock:100,collectors:c};
    const none=SQ.collectors(ext,T0,to,[{id:"derivs",records:["wallets"],expectMs:60000}]);
    const short=SQ.collectors(ext,T0,T0+60000,reg),old={verdict:"complete",dataMinutes:10,minutes:10,longestGapSec:1,clock:100};
    const withIn=SQ.of([["q","bn",T0,1,2],["q","bn",T0+MIN,1,2]]);
    return{ok:c.venues.state==="ok"&&c.venues.min===10&&c.venues.of===10&&c.book.state==="holes"&&c.book.gapSec===300&&c.book.min<=6&&c.book.n>0&&c.derivs.state==="ok"&&c.calendar===undefined&&c.options.state==="none"&&c.options.n===0&&c.options.gapSec===600
      &&none.derivs.state==="none"&&short===null&&SQ.collectors(ext,T0,to,null)===null&&SQ.collectors([],T0,to,reg).venues.state==="none"
      &&J(SQ.colProblems(q).map(p=>p.id))==='["book","options"]'&&!SQ.clean(q)&&SQ.clean(old)&&SQ.colProblems(old).length===0&&SQ.line(old)==="10 of 10 min with data"
      &&SQ.line(q)==="10 of 10 min with data; collectors: book silent 5 min, options no data"&&SQ.line(Object.assign({},old,{collectors:{a:{state:"holes",gapSec:90},b:{state:"ok"}}}))==="10 of 10 min with data; collectors: a silent 90 s"
      &&withIn.t0===T0&&withIn.t1===T0+MIN,detail:J({c,none,short,line:SQ.line(q)})};
  });
  add("status: a lost, failing or missing save folder is shown while the page records, and only then; a failed chunk save and a lost wake lock are shown",E=>{
    const base={connected:false,paused:false,online:true,venues:{},kept:0},on={on:true,seq:3,fail:0,wake:true};
    const t=l=>l.map(c=>c.text).join(" | "),f=(st,extra)=>Object.assign({},base,{cr:on,folder:Object.assign({state:st},extra)});
    const den=STATUS.chips(f("denied")),fail=STATUS.chips(f("failed",{err:"disk full"})),none=STATUS.chips(f("none")),ok=STATUS.chips(f("ok"));
    const idle=STATUS.chips(Object.assign({},base,{cr:{on:false},folder:{state:"denied"}})),absent=STATUS.chips(Object.assign({},base)),sav=STATUS.chips(Object.assign({},base,{cr:Object.assign({},on,{fail:1,err:"quota",wake:false})}));
    return{ok:t(den)==="REC run, chunk 3 | save folder needs OK"&&den[1].tone==="bad"&&/Allow/.test(den[1].title)&&t(fail)==="REC run, chunk 3 | last save failed"&&/disk full/.test(fail[1].title)&&t(none)==="REC run, chunk 3 | no save folder"&&none[1].tone==="info"
      &&t(ok)==="REC run, chunk 3"&&idle.length===0&&absent.length===0&&t(sav)==="REC run, chunk 3 | screen may sleep | chunk save failed"&&sav[2].tone==="bad"&&/quota/.test(sav[2].title),detail:[t(den),t(fail),t(none),t(ok),t(idle),t(absent),t(sav)].join(" // ")};
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
  add("hooks: subscribers run in subscription order with the emitted arguments, a throwing one is contained, an unknown name is a no-op",E=>{
    const log=[],H=HOOKS,n="selftest-"+Math.random(),err=console.error;
    H.on(n,x=>log.push("a"+x));H.on(n,()=>{throw new Error("boom");});H.on(n,x=>log.push("c"+x));
    let threw=false;console.error=()=>{};try{H.emit(n,7);H.emit("selftest-none",1);}catch(e){threw=true;}finally{console.error=err;}
    return{ok:!threw&&log.join(",")==="a7,c7",detail:log.join(",")+(threw?" threw":"")};
  });
  add("views: areas and labels in registration order, a shared slot draws once per tick on its own throttle, onOpen runs per view",E=>{
    const V=VIEWS,log=[],p="st"+Math.random().toString(36).slice(2,6),A=p+"a";
    V.area(A,"Test","M0 0");
    V.register({id:p+"x",label:"X",area:A,minIntervalMs:100,render:()=>log.push("x")});
    V.register({id:p+"y",label:"Y",area:A,minIntervalMs:50,render:()=>log.push("y"),onOpen:id=>log.push("open "+id)});
    V.register({id:p+"z",label:"Z",area:A,slot:p+"y"});
    V.onOpen(p+"z",()=>{throw new Error("boom");});V.onOpen(p+"z",id=>log.push("open2 "+id));
    const vis=set=>id=>set.includes(id),g=V.groups().find(x=>x[0]===A),tb=V.tabs().filter(t=>t[0].startsWith(p)).map(t=>t[1]).join("");
    V.tick(1000,vis([p+"x"]));V.tick(1050,vis([p+"x"]));V.tick(1101,vis([p+"x"]));          // x: 1000 and 1101, not 1050
    V.tick(2000,vis([p+"y",p+"z"]));V.tick(2040,vis([p+"z"]));V.tick(2060,vis([p+"z"]));    // shared slot y/z: once per due tick
    V.tick(3000,vis([]));                                                                     // nothing visible
    const err=console.error;console.error=()=>{};try{V.open(p+"y");V.open(p+"z");V.open("none-"+p);}finally{console.error=err;}
    const got=log.join(",");
    return{ok:got==="x,x,y,y,open "+p+"y,open2 "+p+"z"&&g[2].join(",")===[p+"x",p+"y",p+"z"].join(",")&&tb==="XYZ"&&V.icons()[A]==="M0 0",detail:got};
  });
  add("disk space: tone from room left and from hours left at the current rate; the rate needs recent saved files",E=>{
    const G=1e9,H=3600000,now=100*H,rows=[{at:now-5*H,size:6e6},{at:now-1*H,size:6e6},{at:now-30*H,size:9e9}];
    const r=DISK.rate(rows,now),none=DISK.rate([],now),old=DISK.rate([{at:now-30*H,size:5e6}],now),fresh=DISK.rate([{at:now-60000,size:3e6}],now);
    const ok=DISK.assess(50*G,r),warnRoom=DISK.assess(4*G,r),badRoom=DISK.assess(1.5*G,r),warnRate=DISK.assess(10*G,1e9),badRate=DISK.assess(10*G,3e9),unk=DISK.assess(undefined,r),noRate=DISK.assess(50*G,null);
    return{ok:Math.abs(r-2.4e6)<1&&none===null&&old===null&&Math.abs(fresh-3e6)<1&&ok.tone==="ok"&&warnRoom.tone==="warn"&&badRoom.tone==="bad"&&warnRate.tone==="warn"&&badRate.tone==="bad"&&unk.tone==="off"&&noRate.tone==="ok"&&noRate.hours===null&&/about 50\.0 GB left/.test(ok.text),detail:JSON.stringify({r,none,old,fresh,ok:ok.text,warnRoom:warnRoom.tone,badRoom:badRoom.tone,warnRate:warnRate.tone,badRate:badRate.tone,unk:unk.tone,noRate})};
  });
  function run(Eng){return scenarios.map(sc=>{try{const r=sc.run(Eng);return{name:sc.name,ok:!!r.ok,detail:r.detail};}catch(err){return{name:sc.name,ok:false,detail:String(err&&err.stack||err)};}});}
  return {T0,rng,poisson,levels,sim,scenarios,run};
})();