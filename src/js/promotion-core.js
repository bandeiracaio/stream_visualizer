// Promotion core (Trader step 7): the rule that decides when a system may move from paper to demo and from demo to live (spec section 4.7), the stage log, and the automatic move down. Pure: no DOM, timers, storage or clock;
// everything it needs is handed in. It changes nothing in the runner's decisions; it only reads journal rows and the stage log. No order is sent anywhere: until step 8 a demo system still fills on paper.
// The rule, fixed before any system ran (do not tune it here; a change is an amendment in .scratch/trader/spec.md):
//   paper to demo, counted on paper-filled trades made live by the page since the system's last move into paper (interrupted positions never count):
//     1. at least 300 trades; 2. on at least 10 different UTC days (the day of the entry); 3. mean net bps per trade above 0 (fees included);
//     4. mean net R above at least 19 of its 20 twins, where at least 19 twins have 100 trades or more (twins counted over the same stretch); 5. the day's net sum positive on at least 60% of the days that have a trade.
//   demo to live, counted on demo-filled trades since the last move into demo: at least 100, on at least 5 days, and the mean demo fill worse than the paper fill of the same trades by no more than half the paper edge
//   (the paper edge = the mean net bps that earned the promotion, stored in the stage log at that moment). A demo row carries both: netBps (the demo fill) and paperNetBps (what the paper fill gave).
//   Never automatic upward. Promotion to live also needs a cap above 0 (dollars). A move down goes to paper and has no condition. A live system goes to paper by itself when its net loss in one UTC day reaches 3 times its risk per trade or its cap.
// Rows read: {k:"trade", sys, tIn, t, netBps, R, usd, reason, interrupted?, stage?, fill?, paperNetBps?} and {k:"twin", sys, n, tIn, R}. A row without stage and fill is paper / paper (rows written before step 7).
// Stage log entries (append-only, one per move): {sys, from, to, t, by: "user"|"auto", reason?, cap?, figures: {criteria: [{id, now, need, met}], edge?}}.
// Since R0 the functions below run in WebAssembly (rust/crates/sv-promotion, loaded by wasm-loader.js as SVWASM); the signatures and results are the ones the JS version had
// Inputs go in as JSON: a value that is not a number, NaN or Infinity reads as absent.
const PROMO = (() => {
  "use strict";
  const DAY = 86400000, STAGES = ["paper", "demo", "live"];
  const RULE = { paper: { trades: 300, days: 10, posDayShare: 0.6, twinsAhead: 19, twinsEnough: 19, twinTrades: 100, twinsTotal: 20 }, demo: { trades: 100, days: 5, halfEdge: 0.5 }, lossRisks: 3 };      // the figures live in the Rust crate; this copy is for display and the self-test
  const wasm = (fn, o) => SVWASM.call("promo_" + fn, o);

  // the stage of a system: the `to` of its last move, else `start` (the stage in systems-default.js)
  const stageOf = (log, id, start) => wasm("stage_of", { log: log || [], id, start });
  // {sys id: stage} for the systems that have moved at least once
  function stages(log) { const m = {}; for (const [k, v] of wasm("stages", { log: log || [] })) m[k] = v; return m; }
  // time of the last move of the system into `to`; -Infinity when there is none (the count then begins with the journal)
  function since(log, id, to) { const t = wasm("since", { log: log || [], id, to }); return t == null ? -Infinity : t; }
  const edgeOf = (log, id) => wasm("edge_of", { log: log || [], id });
  const capOf = (log, id) => wasm("cap_of", { log: log || [], id });
  // The standing of one system against the rule for its next stage.
  const eligibility = (rows, stageLog, systemId, start) => wasm("eligibility", { rows, log: stageLog || [], sys: systemId, start });
  // The automatic move down. system: {id, riskFrac, equity0}; cap: dollars or null; day: UTC day number.
  const lossLimit = (rows, system, cap, day) => wasm("loss_limit", { rows, system, cap, day });
  // Validates one move: {ok: true, log: the new log (the old one is not changed), entry} or {ok: false, reason}. The WASM returns the entry; the log is joined here, so entries already stored are never rewritten.
  function apply(stageLog, move, rows) {
    const log = stageLog || [], r = wasm("apply", { log, move, rows: rows || [] });
    return r.ok ? { ok: true, log: log.concat([r.entry]), entry: r.entry } : { ok: false, reason: r.reason };
  }

  // ---------- self-test: scenarios named promo:* ----------
  function selftest() {
    const res = [], ok = (name, c, detail) => res.push({ name: "promo:" + name, ok: !!c, detail: c ? "" : String(detail || "") });
    const D0 = 20000 * DAY;      // a day number far from zero
    // trades: count per day given by `perDay` (array of net bps lists); R = bps / 10; entries one minute apart on day d0 + k
    const trades = (sys, perDay, o) => { const out = []; perDay.forEach((list, k) => list.forEach((b, i) => out.push(Object.assign({ k: "trade", sys, t: D0 + k * DAY + (i + 1) * 60000 + 30000, tIn: D0 + k * DAY + (i + 1) * 60000, netBps: b, R: b / 10, usd: b, reason: "time" }, o)))); return out; };
    const twins = (sys, nTw, perTwin, R, t0) => { const out = []; for (let n = 0; n < nTw; n++) for (let i = 0; i < perTwin; i++) out.push({ k: "twin", sys, n, tIn: (t0 == null ? D0 : t0) + i * 1000, R: R(n), usd: 0, reason: "time" }); return out; };
    const days = (nDays, perDay, net) => Array.from({ length: nDays }, () => Array.from({ length: perDay }, () => net));
    const get = (el, id) => el.criteria.find(c => c.id === id);
    // all five at the boundary: 300 trades on 10 days, net mean 1 bps, 60% positive days, ahead of 19 twins with 100 trades
    const good = (extra) => trades("A", [].concat(days(6, 30, 3), days(4, 30, -1.5)), extra).concat(twins("A", 20, 100, n => n === 19 ? 0.5 : -0.1 + n * 0.001));
    { const el = eligibility(good(), [], "A");
      ok("the five criteria at their boundaries together make a system eligible", el.eligible && el.stage === "paper" && el.next === "demo" && el.criteria.length === 5 && el.criteria.every(c => c.met), JSON.stringify(el.criteria.map(c => c.id + ":" + c.now + ":" + c.met))); }
    { const el299 = eligibility(trades("A", days(10, 30, 2)).slice(0, 299), [], "A"), el300 = eligibility(trades("A", days(10, 30, 2)), [], "A");
      ok("trades: 299 do not meet it and 300 do", !get(el299, "trades").met && get(el299, "trades").now === 299 && get(el300, "trades").met && get(el300, "trades").now === 300); }
    { const e9 = eligibility(trades("A", days(9, 40, 2)), [], "A"), e10 = eligibility(trades("A", days(10, 40, 2)), [], "A");
      ok("days: 9 different days do not meet it and 10 do", !get(e9, "days").met && get(e9, "days").now === 9 && get(e10, "days").met); }
    { const a = eligibility(trades("A", days(10, 30, 0)), [], "A"), b = eligibility(trades("A", [[0.001].concat(Array(29).fill(0))].concat(days(9, 30, 0))), [], "A"), c = eligibility(trades("A", days(10, 30, -0.001)), [], "A");
      ok("mean net: exactly 0 does not meet it, a hair above does, below does not", !get(a, "mean").met && get(b, "mean").met && !get(c, "mean").met, JSON.stringify([get(a, "mean").now, get(b, "mean").now])); }
    { const mk = k => trades("A", days(10, 30, 2)).concat(twins("A", 20, 100, n => n < k ? -1 : 5));      // the system's mean R is 0.2; k twins are below it
      const e18 = eligibility(mk(18), [], "A"), e19 = eligibility(mk(19), [], "A"), e20 = eligibility(mk(20), [], "A");
      ok("twins: ahead of 18 does not meet it, ahead of 19 and of 20 do", !get(e18, "twins").met && get(e18, "twins").now === 18 && get(e19, "twins").met && get(e19, "twins").now === 19 && get(e20, "twins").met && get(e20, "twins").now === 20, JSON.stringify([18, 19, 20].map(k => get(eligibility(mk(k), [], "A"), "twins").now))); }
    { const sysRows = trades("A", days(10, 30, 2)), few = n => twins("A", n, 100, () => -1), e18 = eligibility(sysRows.concat(few(18)), [], "A"), e19 = eligibility(sysRows.concat(few(19)), [], "A"), thin = eligibility(sysRows.concat(few(19).filter(r => r.n < 18 || r.tIn < D0 + 99000)), [], "A");
      ok("twins: ahead of all 18 with enough trades is not enough (19 must have 100 trades); 19 are enough; a twin with 99 trades does not count", !get(e18, "twins").met && /only 18 twins/.test(get(e18, "twins").text) && get(e19, "twins").met && !get(thin, "twins").met, get(thin, "twins").text); }
    { const six = (nPos, nDays) => trades("A", Array.from({ length: nDays }, (_, k) => k < nPos ? [3, 3, 3] : [-3, -3, -3])), p = k => get(eligibility(six(k, 10), [], "A"), "posdays"), q = k => get(eligibility(six(k, 100), [], "A"), "posdays");
      ok("positive days: 5 of 10 and 59 of 100 do not meet it, 6 of 10 and 60 of 100 do", !p(5).met && p(6).met && !q(59).met && q(60).met && /59%/.test(q(59).text) && /60%/.test(q(60).text) && /^positive days 60% \/ 60%$/.test(q(60).text), q(59).text + " | " + q(60).text); }
    { const m = trades("A", [[10, -4]]); const dayNet = eligibility(m, [], "A"); ok("a day's net sum decides: +10 and -4 on one day is a positive day", get(dayNet, "posdays").now === 1); }
    // interrupted, stage, fill
    { const base = trades("A", days(10, 30, 2)), withInt = base.concat(trades("A", [[5, 5, 5]], { interrupted: true, reason: "interrupted" }).map(r => Object.assign(r, { netBps: undefined, R: undefined, usd: undefined })));
      ok("interrupted rows are ignored", eligibility(withInt, [], "A").trades === 300); }
    { const base = trades("A", days(10, 30, 2)), mix = base.concat(trades("A", [[9, 9]], { stage: "demo", fill: "paper" })).concat(trades("A", [[9]], { stage: "paper", fill: "demo" })), el = eligibility(mix, [], "A");
      ok("only trades made under stage paper with a paper fill count for paper to demo", el.trades === 300); }
    { const old = trades("A", days(10, 30, 2)), tagged = old.map(r => Object.assign({}, r, { stage: "paper", fill: "paper" }));
      ok("rows without stage and fill read as paper / paper (same figures as tagged rows)", JSON.stringify(eligibility(old, [], "A")) === JSON.stringify(eligibility(tagged, [], "A")) && eligibility(old, [], "A").trades === 300); }
    { const other = trades("B", days(10, 30, 2)); ok("another system's rows are not counted", eligibility(other, [], "A").trades === 0 && get(eligibility(other, [], "A"), "mean").met === false); }
    { const el = eligibility([], [], "A"); ok("an empty journal: nothing met, not eligible, no errors", !el.eligible && el.criteria.length === 5 && el.criteria.every(c => !c.met) && el.trades === 0 && el.meanNetBps === null); }
    // the count restarts after a move down
    { const rows = good(), log = [{ sys: "A", from: "paper", to: "demo", t: D0 + 50 * DAY, by: "user", figures: { criteria: [], edge: 1 } }, { sys: "A", from: "demo", to: "paper", t: D0 + 60 * DAY, by: "user", figures: { criteria: [] } }];
      const el = eligibility(rows, log, "A"), after = eligibility(rows.concat(trades("A", [[4]], { t: D0 + 61 * DAY, tIn: D0 + 61 * DAY + 5 })), log, "A");
      ok("after a move down the count starts again from that moment: earlier trades are not counted, a later one is", el.stage === "paper" && el.trades === 0 && el.since === D0 + 60 * DAY && after.trades === 1, JSON.stringify([el.trades, after.trades])); }
    { const old = eligibility(good(), [{ sys: "A", from: "live", to: "paper", t: D0 + 5 * DAY, by: "auto", figures: { criteria: [] } }], "A");
      ok("the count begins at the LAST move into paper (here day 5: trades before it are out)", old.trades < 300 && old.trades > 0 && old.since === D0 + 5 * DAY, old.trades); }
    // demo to live
    const demoLog = (edge) => [{ sys: "A", from: "paper", to: "demo", t: D0 - DAY, by: "user", figures: { criteria: [], edge } }];
    const demoRows = (n, nDays, net, paper) => { const out = []; for (let i = 0; i < n; i++) out.push({ k: "trade", sys: "A", t: D0 + (i % nDays) * DAY + 100, tIn: D0 + (i % nDays) * DAY + 50 + i, netBps: net, paperNetBps: paper, R: net / 10, usd: net, reason: "time", stage: "demo", fill: "demo" }); return out; };
    { const ok100 = eligibility(demoRows(100, 5, 2, 3), demoLog(4), "A"), n99 = eligibility(demoRows(99, 5, 2, 3), demoLog(4), "A"), d4 = eligibility(demoRows(100, 4, 2, 3), demoLog(4), "A");
      ok("demo to live: 100 trades on 5 days meet the first two criteria; 99 trades or 4 days do not", ok100.stage === "demo" && ok100.next === "live" && get(ok100, "trades").met && get(ok100, "days").met && !get(n99, "trades").met && !get(d4, "days").met); }
    { const at = x => get(eligibility(demoRows(100, 5, 2, 2 + x), demoLog(4), "A"), "cost");      // half the paper edge is 2 bps: the demo fill is worse by x
      ok("demo to live: worse by exactly half the paper edge passes, a hair more fails, better than paper passes", at(2).met && !at(2.01).met && at(0).met && at(-1).met && at(2).now === 2, JSON.stringify([at(2), at(2.01)].map(c => c.now + ":" + c.met))); }
    { const e = eligibility(demoRows(100, 5, 2, 3), demoLog(null), "A"); ok("demo to live with no stored paper edge: the cost criterion is not met, and says why", !get(e, "cost").met && /no stored paper edge/.test(get(e, "cost").text)); }
    { const e = eligibility(demoRows(100, 5, 2, 3).concat(demoRows(50, 5, 9, 9).map(r => Object.assign(r, { fill: "paper" }))), demoLog(4), "A"), none = eligibility([], demoLog(4), "A");
      ok("demo to live counts demo fills only; with none it says it needs demo trades", e.trades === 100 && none.waiting === "needs demo trades" && !none.eligible); }
    { const e = eligibility(demoRows(100, 5, 2, 3), demoLog(4), "A").eligible, e2 = eligibility(demoRows(100, 5, 2, 3), demoLog(4).concat([{ sys: "A", from: "demo", to: "live", t: D0 + 9 * DAY, by: "user", cap: 100, figures: { criteria: [] } }]), "A");
      ok("a live system has no next stage", e === true && e2.stage === "live" && e2.next === null && e2.criteria.length === 0 && !e2.eligible); }
    // loss limit
    { const sys = { id: "A", riskFrac: 0.005, equity0: 10000 }, day = D0 / DAY, lose = (usd, stage) => ({ k: "trade", sys: "A", t: D0 + 3600000, tIn: D0, usd, netBps: -1, R: -1, reason: "stop", stage: stage || "live", fill: "live" });
      ok("loss limit: 3 times the risk per trade (3 x $50 = $150) is a hit, a cent under is not", lossLimit([lose(-150)], sys, null, day).hit && !lossLimit([lose(-149.99)], sys, null, day).hit && lossLimit([lose(-149.99)], sys, null, day).limit === 150, JSON.stringify(lossLimit([lose(-149.99)], sys, null, day)));
      ok("loss limit: a cap lower than 3 risks is the limit (cap $80: -80 hits, -79.99 does not); a higher cap changes nothing", lossLimit([lose(-80)], sys, 80, day).hit && lossLimit([lose(-80)], sys, 80, day).which === "cap" && !lossLimit([lose(-79.99)], sys, 80, day).hit && lossLimit([lose(-149.99)], sys, 500, day).limit === 150 && !lossLimit([lose(-149.99)], sys, 500, day).hit);
      ok("loss limit: several trades add up; wins in the day offset losses; another day and a paper-stage trade do not count", lossLimit([lose(-100), lose(-60)], sys, null, day).hit && !lossLimit([lose(-100), lose(60), lose(-60)], sys, null, day).hit && !lossLimit([lose(-200)], sys, null, day + 1).hit && !lossLimit([lose(-200, "paper")], sys, null, day).hit);
      const before = { k: "trade", sys: "A", t: D0 - 3600000, tIn: D0 - 7200000, usd: -5000, netBps: -1, R: -1, reason: "stop", stage: "paper", fill: "paper" };
      ok("loss limit: risk per trade follows the equity at the start of the day (equity down to $5000: 3 x $25 = $75)", lossLimit([before, lose(-75)], sys, null, day).hit && !lossLimit([before, lose(-74)], sys, null, day).hit && lossLimit([before], sys, null, day).riskUsd === 25);
      ok("loss limit: nothing today is no hit", !lossLimit([], sys, null, day).hit && lossLimit([], sys, null, day).loss === 0); }
    // apply
    { const rows = good(), up = apply([], { sys: "A", to: "demo", t: 5, by: "user" }, rows), bad = apply([], { sys: "A", to: "demo", t: 5, by: "user" }, rows.slice(0, 100));
      ok("apply: an eligible system moves to demo; the entry holds from, to, time, by and a copy of the criteria with the paper edge", up.ok && up.entry.from === "paper" && up.entry.to === "demo" && up.entry.by === "user" && up.entry.t === 5 && up.entry.figures.criteria.length === 5 && up.entry.figures.criteria.every(c => c.met) && Math.abs(up.entry.figures.edge - eligibility(rows, [], "A").meanNetBps) < 1e-12 && up.log.length === 1, JSON.stringify(up));
      ok("apply: an upward move that is not eligible is refused with the reason, and the old log is not changed", !bad.ok && /not eligible/.test(bad.reason) && /trades/.test(bad.reason)); }
    { const log = [], r = apply(log, { sys: "A", to: "demo", t: 1, by: "user" }, good()); ok("apply does not change the log it was given", r.ok && log.length === 0 && r.log !== log); }
    { const rows = good(), l1 = apply([], { sys: "A", to: "demo", t: 1, by: "user" }, rows).log, demo = demoRows(100, 5, 2, 2.5), noCap = apply(l1, { sys: "A", to: "live", t: 2, by: "user" }, demo), zero = apply(l1, { sys: "A", to: "live", t: 2, by: "user", cap: 0 }, demo), neg = apply(l1, { sys: "A", to: "live", t: 2, by: "user", cap: -5 }, demo), withCap = apply(l1, { sys: "A", to: "live", t: 2, by: "user", cap: 250 }, demo);
      ok("apply: live without a cap, with 0 or a negative cap is refused; with a cap above 0 it moves and the entry keeps the cap", !noCap.ok && /cap/.test(noCap.reason) && !zero.ok && !neg.ok && withCap.ok && withCap.entry.cap === 250 && withCap.entry.to === "live" && withCap.entry.from === "demo", JSON.stringify([noCap, withCap.entry]));
      const notYet = apply(l1, { sys: "A", to: "live", t: 2, by: "user", cap: 250 }, demoRows(99, 5, 2, 2.5)); ok("apply: demo to live is refused until its criteria are met", !notYet.ok && /not eligible/.test(notYet.reason));
      const skip = apply([], { sys: "A", to: "live", t: 2, by: "user", cap: 250 }, rows); ok("apply: paper straight to live is refused", !skip.ok && /one stage at a time/.test(skip.reason)); }
    { const l = [{ sys: "A", from: "paper", to: "demo", t: 1, by: "user", figures: { criteria: [], edge: 1 } }], down = apply(l, { sys: "A", to: "paper", t: 9, by: "user" }, []), same = apply(l, { sys: "A", to: "demo", t: 9, by: "user" }, []);
      ok("apply: a move down to paper is always allowed (no condition), and the criteria figures are copied", down.ok && down.entry.from === "demo" && down.entry.to === "paper" && down.entry.figures.criteria.length === 3 && !same.ok && /already/.test(same.reason)); }
    { const l = [{ sys: "A", from: "demo", to: "live", t: 1, by: "user", cap: 10, figures: { criteria: [] } }], auto = apply(l, { sys: "A", to: "paper", t: 9, by: "auto", reason: "loss limit: $150 in one day" }, []), toDemo = apply(l, { sys: "A", to: "demo", t: 9, by: "user" }, []), autoUp = apply([], { sys: "A", to: "demo", t: 9, by: "auto" }, good());
      ok("apply: live goes to paper by hand or automatically (the reason is kept); live to demo is refused; an automatic move never goes up", auto.ok && auto.entry.by === "auto" && /loss limit/.test(auto.entry.reason) && !toDemo.ok && /to paper/.test(toDemo.reason) && !autoUp.ok); }
    { const refuse = m => !apply([], m, []).ok; ok("apply: a missing system, an unknown stage, a missing time and a missing author are refused", refuse({ to: "demo", t: 1, by: "user" }) && refuse({ sys: "A", to: "gold", t: 1, by: "user" }) && refuse({ sys: "A", to: "demo", by: "user" }) && refuse({ sys: "A", to: "demo", t: 1 })); }
    { const l = [{ sys: "A", from: "paper", to: "demo", t: 1, by: "user", figures: {} }, { sys: "B", from: "paper", to: "demo", t: 2, by: "user", figures: {} }, { sys: "A", from: "demo", to: "paper", t: 3, by: "user", figures: {} }];
      ok("stageOf, stages and since read the log; a system with no move keeps its starting stage", stageOf(l, "A") === "paper" && stageOf(l, "B") === "demo" && stageOf(l, "C") === "paper" && stageOf(l, "C", "demo") === "demo" && stages(l).A === "paper" && stages(l).B === "demo" && since(l, "A", "paper") === 3 && since(l, "A", "demo") === 1 && since(l, "C", "paper") === -Infinity); }
    return res;
  }


  return { RULE, DAY, STAGES, stageOf, stages, since, edgeOf, capOf, eligibility, lossLimit, apply, selftest };
})();
