"use strict";
// Remembering that auto-record was armed (pure, no DOM, no timers, no storage, no clock: the caller passes now). A reload, a browser restart or a closed tab silently ends an overnight
// collection, because the armed state lives only in the page. The page therefore keeps a flag {on, since, last, runs} in the browser's storage while it is armed; a deliberate Disarm (or a
// finished arming) clears it; a page that loads and finds the flag but is not armed shows a prompt to re-arm. Display and storage only: arming itself is auto-record's.
// Spec: .scratch/arm-memory/spec.md.
const ARMMEM = (() => {
  const WRITE_MS = 10000, STALE_MS = 7*24*3600000;
  // The flag to store now. flag: what is stored (or null); st: {armed (this page), justArmed (it became armed since the last call), justDisarmed (it stopped being armed since the last call), now, runs}.
  // Returns {flag, write}: write = the stored value should change to `flag` (null clears it).
  function step(flag, st) {
    if (st.armed) {
      if (!flag || !flag.on || st.justArmed) return {flag:{on:true, since:st.now, last:st.now, runs:st.runs || 0}, write:true};      // the moment of arming is a new arming, whatever an earlier arming left behind
      if (st.now - flag.last >= WRITE_MS || (st.runs || 0) !== flag.runs) return {flag:{on:true, since:flag.since, last:st.now, runs:st.runs || 0}, write:true};
      return {flag, write:false};
    }
    if (st.justDisarmed && flag) return {flag:null, write:true};      // this page stopped being armed just now (a Disarm, or the arming finished): nothing to remind. Only at that moment: a page that disarmed earlier must not wipe another page's flag
    return {flag, write:false};
  }
  // The prompt to show, or null. o: {now, armed (this page), lockElsewhere (another page of this app holds the armed lock), dismissed (this page's prompt was dismissed)}.
  function prompt(flag, o) {
    if (!flag || !flag.on || o.armed || o.lockElsewhere || o.dismissed) return null;
    const ago = o.now - flag.last; if (!(ago >= 0) || ago > STALE_MS) return null;
    return {since:flag.since, last:flag.last, runs:flag.runs || 0, agoMs:ago};
  }
  const dur = ms => { const m = Math.round(ms/60000); return m < 90 ? m + " min" : m < 2880 ? (m/60).toFixed(m < 600 ? 1 : 0) + " h" : Math.round(m/1440) + " days"; };
  // The sentence for the bar. clock(t) formats a time (the caller's locale).
  function text(p, clock) {
    return "Auto-record was armed (last seen " + clock(p.last) + ", " + dur(p.agoMs) + " ago" + (p.runs ? ", " + p.runs + " recording" + (p.runs === 1 ? "" : "s") + " made" : "") + "), and this page is not armed: nothing is being recorded automatically.";
  }

  function selftest() {
    const out = [], ok = (name, pass, detail) => out.push({name:"arm memory: " + name, ok:!!pass, detail:detail || ""});
    const T = 1.8e12, J = JSON.stringify;
    const a1 = step(null, {armed:true, justArmed:true, now:T, runs:0});
    ok("arming writes the flag with its start", a1.write && J(a1.flag) === J({on:true, since:T, last:T, runs:0}));
    const a2 = step(a1.flag, {armed:true, now:T + 5000, runs:0}), a3 = step(a1.flag, {armed:true, now:T + 10000, runs:0});
    ok("while armed the flag is refreshed every 10 s, keeping its start, not on every call", !a2.write && a3.write && a3.flag.since === T && a3.flag.last === T + 10000);
    ok("a finished recording (runs went up) is written at once", step(a1.flag, {armed:true, now:T + 1000, runs:1}).write);
    const d = step(a3.flag, {armed:false, justDisarmed:true, now:T + 20000, runs:3});
    ok("the moment a Disarm or a finished arming happens clears the flag", d.write && d.flag === null);
    const re = step({on:true, since:T - 7*3600000, last:T - 6*3600000, runs:4}, {armed:true, justArmed:true, now:T, runs:0});
    ok("re-arming after an earlier page left a flag starts a new arming (since = now, runs from this page)", re.write && re.flag.since === T && re.flag.runs === 0);
    const l = step(a3.flag, {armed:false, now:T + 3600000, runs:0});
    ok("a page that is not armed leaves the flag alone every other time: one that loads and finds it (so the prompt can show), and one that disarmed long ago while another page armed", !l.write && l.flag === a3.flag);
    ok("nothing stored and not armed: nothing to do", J(step(null, {armed:false, now:T, runs:0})) === J({flag:null, write:false}) && !step(null, {armed:false, justDisarmed:true, now:T, runs:0}).write);
    const f = {on:true, since:T, last:T + 600000, runs:4}, now = T + 600000 + 6*3600000;
    const p = prompt(f, {now, armed:false, lockElsewhere:false, dismissed:false});
    ok("the prompt: when it was last seen, how long ago, how many recordings", p && p.last === f.last && p.since === T && p.runs === 4 && p.agoMs === 6*3600000);
    ok("no prompt when this page is armed, another page holds the armed lock, it was dismissed, or nothing is stored", prompt(f, {now, armed:true}) === null && prompt(f, {now, armed:false, lockElsewhere:true}) === null && prompt(f, {now, armed:false, dismissed:true}) === null && prompt(null, {now}) === null && prompt({on:false}, {now}) === null);
    ok("a flag older than a week is ignored", prompt(f, {now:f.last + 8*24*3600000, armed:false}) === null && prompt(f, {now:f.last + 6*24*3600000, armed:false}) !== null);
    ok("a clock that went backwards gives no prompt", prompt(f, {now:f.last - 1000, armed:false}) === null);
    const clock = t => "HH:MM";
    ok("the sentence: time, age, count (singular and plural), what it means", /last seen HH:MM, 6\.0 h ago, 4 recordings made/.test(text(p, clock)) && /1 recording made/.test(text({last:T, agoMs:2*60000, runs:1}, clock)) && !/made/.test(text({last:T, agoMs:60000, runs:0}, clock)) && /not armed: nothing is being recorded/.test(text(p, clock)) && /2 min ago/.test(text({last:T, agoMs:120000, runs:0}, clock)) && /3 days ago/.test(text({last:T, agoMs:3*86400000, runs:0}, clock)));
    return out;
  }
  return {WRITE_MS, STALE_MS, step, prompt, text, selftest};
})();
