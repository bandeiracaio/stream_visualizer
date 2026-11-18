//! Port of the stepping part of src/js/js-cores/runner-core.js (the paper runner): the systems and their random-entry twins run on paper, each with a small ledger, fees at the far side of the quote, a global cap on
//! open risk, stages. It owns its `System` values directly (sv-system's plain API, no JSON between the runner and a system), so one `step` call takes one snapshot for every system and twin.
//! Pure: no clock, no randomness (a seeded mulberry32, bit for bit the JS one), no I/O. The journal rows come out with the same keys in the same order as the JS rows.
//! What stays in JS (src/js/runner-core.js): reading the journal a runner begins with (equity, positions to interrupt), `carryOf`, `driver`, `evaluate` and the self-test.
pub mod ops;

use serde::Serialize;
use serde_json::{Map, Value};
use sv_core::js::num_str;
use sv_system::{Forced, Intent, Snap, State, System};

const MIN_TWIN_TRIGGERS: i64 = 5;

pub struct Cfg { pub twins: usize, pub equity: f64, pub fee_bps: f64, pub risk_cap: f64, pub seed: String, pub stale_ms: f64 }

// ---------- journal rows (key order = the JS object literal's; one shared serializer, see sv_core::obj) ----------
use sv_core::obj::{Obj, J};
pub type Row = Obj;
fn num(x: f64) -> J { J::Num(x) }
fn own(x: &str) -> J { J::Own(x.to_string()) }
fn enter_row(sys: &str, t: f64, pid: &str, dir: f64, px: f64, qty: f64, notional: f64, stop_bps: f64, thesis: &str, trigger: &str, t_sig: f64, stage: &str) -> Row {
    Obj(vec![("k", J::S("enter")), ("sys", own(sys)), ("t", num(t)), ("pid", own(pid)), ("dir", num(dir)), ("px", num(px)), ("qty", num(qty)), ("notional", num(notional)), ("stopBps", num(stop_bps)), ("thesis", own(thesis)), ("trigger", own(trigger)), ("tSig", num(t_sig)), ("stage", own(stage)), ("fill", J::S("paper"))])
}
fn skip_row(sys: &str, t: f64, reason: &'static str, t_sig: f64) -> Row { Obj(vec![("k", J::S("skip")), ("sys", own(sys)), ("t", num(t)), ("reason", J::S(reason)), ("tSig", num(t_sig))]) }

// ---------- state ----------
#[derive(Serialize)]
pub struct OpenState { dir: f64, px: f64, #[serde(rename = "tIn")] t_in: f64, notional: f64, exiting: Option<&'static str> }
#[derive(Serialize)]
pub struct SysState { pub id: String, name: Value, stage: String, equity: f64, triggers: i64, secs: i64, #[serde(rename = "twinForced")] twin_forced: f64, open: Option<OpenState>, inst: State }
#[derive(Serialize)]
pub struct Risk { open: f64, cap: f64 }

// ---------- seeded randomness: mulberry32 over a 32-bit FNV-1a hash of a string (the JS `Math.imul` and `>>> 0`, bit for bit) ----------
fn hash32(s: &str) -> u32 { let mut h: u32 = 0x811c9dc5; for c in s.encode_utf16() { h ^= c as u32; h = h.wrapping_mul(0x01000193); } h }
struct Mulberry(u32);
impl Mulberry {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6D2B79F5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

// ---------- the runner ----------
struct Pos { pid: String, dir: f64, px: f64, qty: f64, notional: f64, t_in: f64, stop_bps: f64, thesis: String, fee_in: f64, stage: String }
/// A system or one twin: its running system and its small ledger (equity, the open position, the reason an exit is waiting for a quote).
struct Ent { inst: System, eq: f64, pos: Option<Pos>, pend: Option<&'static str> }
struct Twin { e: Ent, rng: Option<Mulberry>, forced: f64 }
struct Sys { id: String, name: Value, stage: String, trigger: String, risk_frac: f64, venue: String, e: Ent, trig: i64, secs: i64, t0: Option<f64>, twins: Vec<Twin> }
#[derive(Clone, Copy)]
struct Q { bid: f64, ask: f64 }

pub struct Runner { cfg: Cfg, s: Vec<Sys> }

fn vstr(v: Option<&Value>) -> String { match v { Some(Value::String(s)) => s.clone(), _ => String::new() } }
fn vnum(v: Option<&Value>) -> f64 { match v { Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN), _ => f64::NAN } }

impl Runner {
    /// `usd`: the closed results the journal already holds, by system id and by "id#n" for a twin (equity carries over); `stages`: {system id: stage}.
    pub fn new(defs: &[Value], cfg: Cfg, usd: &Map<String, Value>, stages: &Map<String, Value>) -> Result<Runner, String> {
        let mut forced = Map::new(); forced.insert("forced".to_string(), Value::Bool(true)); let forced = Value::Object(forced);
        let mut s: Vec<Sys> = Vec::new();
        for def in defs {
            let inst = System::new(def, None)?;
            let id = inst.id().to_string();
            let stage = match stages.get(&id) { Some(Value::String(x)) if !x.is_empty() => x.clone(), _ => vstr(def.get("stage")) };
            let mut twins = Vec::with_capacity(cfg.twins);
            for n in 0..cfg.twins {
                let key = format!("{id}#{n}");
                twins.push(Twin { e: Ent { inst: System::new(def, Some(&forced))?, eq: cfg.equity + usd.get(&key).and_then(Value::as_f64).unwrap_or(0.0), pos: None, pend: None }, rng: None, forced: 0.0 });
            }
            let vn = vstr(def.get("venue"));
            s.push(Sys { name: def.get("name").cloned().unwrap_or(Value::Null), stage, trigger: vstr(def.get("trigger").and_then(|t| t.get("type"))), risk_frac: vnum(def.get("risk").and_then(|r| r.get("riskFrac"))),
                venue: if vn == "any" { "bn".to_string() } else { vn }, e: Ent { inst, eq: cfg.equity + usd.get(&id).and_then(Value::as_f64).unwrap_or(0.0), pos: None, pend: None }, id, trig: 0, secs: 0, t0: None, twins });
        }
        if (1..s.len()).any(|k| s[..k].iter().any(|o| o.id == s[k].id)) { return Err("two systems have the same id".into()); }
        Ok(Runner { cfg, s })
    }

    fn ent(&mut self, i: usize, tw: Option<usize>) -> &mut Ent { match tw { None => &mut self.s[i].e, Some(j) => &mut self.s[i].twins[j].e } }
    /// the open risk of the systems (not the twins)
    fn open_risk(&self) -> f64 { let mut r = 0.0; for x in &self.s { if x.e.pos.is_some() { r += x.risk_frac; } } r }

    /// close the open position of an entity at the quote (the far side), or leave it waiting
    fn settle(&mut self, i: usize, tw: Option<usize>, t: f64, q: Option<Q>, out: &mut Vec<Row>) {
        let fee = self.cfg.fee_bps;
        let (Some(reason), Some(q)) = (self.ent(i, tw).pend, q) else { return };
        let sys = self.s[i].id.clone();
        let e = self.ent(i, tw);
        let Some(p) = e.pos.take() else { return };
        let px = if p.dir > 0.0 { q.bid } else { q.ask };
        e.inst.closed(px, t);
        let gross_bps = p.dir * (px / p.px - 1.0) * 1e4;
        let fee_out = fee / 1e4 * p.qty * px;
        let usd_net = p.dir * p.qty * (px - p.px) - p.fee_in - fee_out;
        let net_bps = usd_net / p.notional * 1e4;
        let fees_bps = (p.fee_in + fee_out) / p.notional * 1e4;
        let r = net_bps / p.stop_bps;
        e.eq += usd_net; e.pend = None;
        out.push(match tw {
            Some(j) => Obj(vec![("k", J::S("twin")), ("sys", J::Own(sys)), ("t", num(t)), ("n", num(j as f64)), ("tIn", num(p.t_in)), ("netBps", num(net_bps)), ("R", num(r)), ("usd", num(usd_net)), ("reason", J::S(reason))]),
            None => Obj(vec![("k", J::S("trade")), ("sys", J::Own(sys)), ("t", num(t)), ("pid", J::Own(p.pid)), ("tIn", num(p.t_in)), ("tOut", num(t)), ("dir", num(p.dir)), ("qty", num(p.qty)), ("notional", num(p.notional)), ("entryPx", num(p.px)), ("exitPx", num(px)),
                ("grossBps", num(gross_bps)), ("feesBps", num(fees_bps)), ("netBps", num(net_bps)), ("R", num(r)), ("usd", num(usd_net)), ("stopBps", num(p.stop_bps)), ("reason", J::S(reason)), ("thesis", J::Own(p.thesis)), ("stage", J::Own(p.stage)), ("fill", J::S("paper"))]),
        });
    }

    fn handle(&mut self, i: usize, tw: Option<usize>, intents: Vec<Intent>, t: f64, q: Option<Q>, out: &mut Vec<Row>) {
        let is_twin = tw.is_some();
        for it in intents {
            match it {
                Intent::Enter(en) => {
                    if !is_twin { self.s[i].trig += 1; }
                    let rf = self.s[i].risk_frac;
                    let why: &'static str = match q {
                        None => "no quote",
                        Some(_) if !is_twin && self.open_risk() + rf > self.cfg.risk_cap + 1e-12 => "risk cap",
                        Some(q) => {
                            let px = if en.dir > 0.0 { q.ask } else { q.bid };
                            let eq = self.ent(i, tw).eq;
                            let (qty, notional, _) = sv_system::size(eq, rf, en.stop_bps, px);
                            if !(qty > 0.0) { "no size" }
                            else if !self.ent(i, tw).inst.filled(px, t).is_empty() {      // a level exit with no room behind the fill: void, nothing was bought
                                if !is_twin { out.push(skip_row(&self.s[i].id, t, "no room", en.t_sig)); }
                                continue;
                            } else {
                                let (fee_in, stage) = (self.cfg.fee_bps / 1e4 * notional, self.s[i].stage.clone());
                                let pid = format!("{}:{}", self.s[i].id, num_str(t));
                                if !is_twin { out.push(enter_row(&self.s[i].id, t, &pid, en.dir, px, qty, notional, en.stop_bps, &en.thesis, &self.s[i].trigger, en.t_sig, &stage)); }
                                let e = self.ent(i, tw);
                                e.pos = Some(Pos { pid, dir: en.dir, px, qty, notional, t_in: t, stop_bps: en.stop_bps, thesis: en.thesis, fee_in, stage }); e.pend = None;
                                continue;
                            }
                        }
                    };
                    self.ent(i, tw).inst.cancelled();      // refused: the system goes back to flat as if the signal had not been taken
                    if !is_twin { out.push(skip_row(&self.s[i].id, t, why, en.t_sig)); }
                }
                Intent::Skip(sk) => { if !is_twin { self.s[i].trig += 1; out.push(skip_row(&self.s[i].id, t, sk.reason, sk.t_sig)); } }
                Intent::Leave(lv) => {
                    let Some(pid) = self.ent(i, tw).pos.as_ref().map(|p| p.pid.clone()) else { continue };
                    self.ent(i, tw).pend = Some(lv.reason);
                    if !is_twin {
                        let mut o = vec![("k", J::S(lv.kind)), ("sys", own(&self.s[i].id)), ("t", num(t)), ("pid", J::Own(pid)), ("reason", J::S(lv.reason))];
                        if let Some(w) = lv.why { o.push(("why", J::S(w))); }
                        out.push(Obj(o));
                    }
                    self.settle(i, tw, t, q, out);
                }
            }
        }
    }

    /// One snapshot: every system and every twin takes it; the journal rows that second produced.
    pub fn step(&mut self, snap: &Snap) -> Vec<Row> {
        let mut out: Vec<Row> = Vec::new();
        let t = snap.t;
        let q = match (snap.q.bn, snap.age.bn) { (Some(q0), Some(age)) if age <= self.cfg.stale_ms => Some(Q { bid: q0.bid.unwrap_or(f64::NAN), ask: q0.ask.unwrap_or(f64::NAN) }), _ => None };
        for i in 0..self.s.len() {
            self.s[i].secs += 1;
            if self.s[i].t0.is_none() {
                self.s[i].t0 = Some(t);
                let (seed, id) = (self.cfg.seed.clone(), self.s[i].id.clone());
                for (n, w) in self.s[i].twins.iter_mut().enumerate() { w.rng = Some(Mulberry(hash32(&format!("{seed}|{id}|{n}|{}", num_str(t))))); }
            }
            self.settle(i, None, t, q, &mut out);
            let intents = self.s[i].e.inst.step(snap);
            self.handle(i, None, intents, t, q, &mut out);
            // twins: the system's own trigger rate so far, none before its fifth trigger
            let r = if self.s[i].trig >= MIN_TWIN_TRIGGERS { self.s[i].trig as f64 / self.s[i].secs as f64 } else { 0.0 };
            for j in 0..self.s[i].twins.len() {
                let s = &mut self.s[i];
                let w = &mut s.twins[j];
                let rng = w.rng.as_mut().unwrap();
                let u = rng.next();
                if u < r { let side = if rng.next() < 0.5 { 1.0 } else { -1.0 }; w.e.inst.force(Forced { t, side, venue: Some(s.venue.clone()) }); w.forced += 1.0; }
                self.settle(i, Some(j), t, q, &mut out);
                let intents = self.s[i].twins[j].e.inst.step(snap);
                self.handle(i, Some(j), intents, t, q, &mut out);
            }
        }
        out
    }

    /// The page is stopping: what a system has open stays unfinished, so it is closed as interrupted.
    pub fn interrupt(&mut self, t: f64) -> Vec<Row> {
        let mut out = Vec::new();
        for s in self.s.iter_mut() {
            if let Some(p) = s.e.pos.take() {
                s.e.pend = None;
                out.push(Obj(vec![("k", J::S("trade")), ("sys", own(&s.id)), ("t", num(t)), ("pid", J::Own(p.pid)), ("tIn", num(p.t_in)), ("tOut", J::Null), ("dir", num(p.dir)), ("entryPx", num(p.px)), ("reason", J::S("interrupted")), ("interrupted", J::Bool(true)), ("thesis", J::Own(p.thesis)), ("stage", J::Own(p.stage)), ("fill", J::S("paper"))]));
            }
        }
        out
    }
    /// A system's stage changes: new entries carry it from the next snapshot on.
    pub fn move_stage(&mut self, id: &str, to: String) -> bool { match self.s.iter_mut().find(|s| s.id == id) { Some(s) => { s.stage = to; true } None => false } }
    pub fn state(&self) -> Vec<SysState> {
        self.s.iter().map(|s| SysState {
            id: s.id.clone(), name: s.name.clone(), stage: s.stage.clone(), equity: s.e.eq, triggers: s.trig, secs: s.secs,
            twin_forced: if s.twins.is_empty() { 0.0 } else { let mut a = 0.0; for w in &s.twins { a += w.forced; } a / s.twins.len() as f64 },
            open: s.e.pos.as_ref().map(|p| OpenState { dir: p.dir, px: p.px, t_in: p.t_in, notional: p.notional, exiting: s.e.pend }), inst: s.e.inst.state(),
        }).collect()
    }
    pub fn ids(&self) -> Vec<String> { self.s.iter().map(|s| s.id.clone()).collect() }
    pub fn risk(&self) -> Risk { Risk { open: self.open_risk(), cap: self.cfg.risk_cap } }
}
