//! Port of src/js/js-cores/system-core.js (the trade system: validate, id, size, and one running system). Pure: no clock, no randomness, no I/O.
//! The plain API (`System::new`, `step`, `filled`, `closed`, `cancelled`, `end`, `state`, `force`) owns everything a system holds, so a Rust runner can own instances directly;
//! `ops` is the JSON layer for the JS wrapper (handles in a registry). The snapshot a second (`Snap`) is made by SYSTEM.facts in JS, which stays there with the Reader engine it reads.
//! Operation order and number handling follow the JS exactly (sums, comparisons with NaN, Math.min / Math.max through `sv_core::js`).
mod def;
pub mod ops;
mod trig;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashSet, VecDeque};
use sv_core::js::{self, num_str};
pub use def::{id, size, validate};
use def::{get, num, st};
pub use trig::Forced;
use trig::{Bx, ForcedQ, Reading, Sig, Trig, Vt};

fn sgn(x: f64) -> f64 { if x > 0.0 { 1.0 } else if x < 0.0 { -1.0 } else { 0.0 } }
fn vidx(v: &str) -> Option<usize> { match v { "bn" => Some(0), "hl" => Some(1), _ => None } }

// ---------- the snapshot a second ----------
#[derive(Deserialize, Default, Clone, Copy)]
pub struct Pair<T> {
    #[serde(default)]
    pub bn: T,
    #[serde(default)]
    pub hl: T,
}
impl<T: Copy> Pair<T> {
    pub fn at(&self, v: usize) -> T { if v == 0 { self.bn } else { self.hl } }
}
#[derive(Deserialize, Default, Clone, Copy)]
pub struct Flow {
    #[serde(default)]
    pub buy: f64,
    #[serde(default)]
    pub sell: f64,
}
#[derive(Deserialize, Default, Clone, Copy)]
pub struct Imb {
    #[serde(default, rename = "5")]
    pub e5: Option<f64>,
    #[serde(default, rename = "20")]
    pub e20: Option<f64>,
}
#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Ep {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub side: f64,
    #[serde(default)]
    pub t_detected: f64,
}
#[derive(Deserialize, Default)]
pub struct Episodes {
    #[serde(default, rename = "new")]
    pub new_: Vec<Ep>,
    #[serde(default)]
    pub ended: Vec<Ep>,
    #[serde(default)]
    pub active: Vec<Ep>,
}
/// One second of facts. A venue's number that is `null` (no quote, no book) is `None`.
#[derive(Deserialize)]
pub struct Snap {
    pub t: f64,
    #[serde(default)]
    pub px: Pair<Option<f64>>,
    #[serde(default)]
    pub sigma: Pair<Option<f64>>,
    #[serde(default)]
    pub age: Pair<Option<f64>>,
    #[serde(default)]
    pub calibrated: bool,
    #[serde(default)]
    pub flow: Pair<Flow>,
    #[serde(default)]
    pub imb: Pair<Imb>,
    #[serde(default)]
    pub episodes: Episodes,
    #[serde(default)]
    pub state: Option<Value>,
}

// ---------- what a system answers ----------
#[derive(Serialize, Clone)]
pub struct ExitInfo {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "holdSec")]
    pub hold_sec: f64,
    #[serde(rename = "tpBps")]
    pub tp_bps: Option<f64>,
    #[serde(rename = "trailBps")]
    pub trail_bps: Option<f64>,
    #[serde(rename = "levelPx")]
    pub level_px: Option<f64>,
    pub families: Option<Vec<String>>,
}
#[derive(Serialize, Clone)]
pub struct Region2 { pub hi: f64, pub lo: f64 }
#[derive(Serialize, Clone)]
pub struct Enter {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub t: f64,
    #[serde(rename = "tSig")]
    pub t_sig: f64,
    pub venue: String,
    pub dir: f64,
    #[serde(rename = "stopBps")]
    pub stop_bps: f64,
    pub exit: ExitInfo,
    pub reading: Option<Reading>,
    pub thesis: String,
    pub trigger: String,
    pub region: Option<Region2>,
}
#[derive(Serialize, Clone)]
pub struct Skip {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub reason: &'static str,
    pub t: f64,
    #[serde(rename = "tSig")]
    pub t_sig: f64,
    pub venue: String,
    pub side: f64,
}
#[derive(Serialize, Clone)]
pub struct Leave {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub reason: &'static str,
    pub t: f64,
    #[serde(rename = "tAt")]
    pub t_at: f64,
    pub venue: String,
    pub dir: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub void: Option<bool>,
}
#[derive(Serialize, Clone)]
#[serde(untagged)]
pub enum Intent { Enter(Enter), Skip(Skip), Leave(Leave) }

#[derive(Serialize)]
pub struct Trade {
    pub dir: f64,
    pub venue: String,
    #[serde(rename = "tIn")]
    pub t_in: f64,
    #[serde(rename = "tOut")]
    pub t_out: f64,
    #[serde(rename = "entryPx")]
    pub entry_px: f64,
    #[serde(rename = "exitPx")]
    pub exit_px: f64,
    #[serde(rename = "grossBps")]
    pub gross_bps: f64,
    #[serde(rename = "stopBps")]
    pub stop_bps: f64,
    pub reason: &'static str,
    pub thesis: String,
}

/// An object whose keys keep the order they were first counted in (a JS object's own order).
#[derive(Default, Clone)]
pub struct Tally(Vec<(&'static str, i32)>);
impl Tally {
    fn add(&mut self, k: &'static str) { if let Some(e) = self.0.iter_mut().find(|e| e.0 == k) { e.1 += 1; } else { self.0.push((k, 1)); } }
}
impl Serialize for Tally {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 { m.serialize_entry(k, v)?; }
        m.end()
    }
}
#[derive(Serialize, Clone, Default)]
pub struct Counts { pub enter: i32, pub skip: Tally, pub exit: Tally, pub invalidate: i32 }

#[derive(Serialize)]
pub struct CtxState { #[serde(rename = "type")] pub kind: String, pub on: bool, pub why: String }
#[derive(Serialize)]
#[serde(untagged)]
pub enum RegionState {
    Flat { #[serde(rename = "type")] kind: &'static str },
    Box {
        #[serde(rename = "type")] kind: &'static str,
        #[serde(rename = "windowSec")] window_sec: f64,
        #[serde(skip_serializing_if = "Option::is_none")] hi: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")] lo: Option<f64>,
        ready: bool,
    },
}
#[derive(Serialize)]
pub struct LastSkip { pub reason: &'static str, pub t: f64 }
#[derive(Serialize)]
pub struct TrigState {
    #[serde(rename = "type")] pub kind: String,
    pub reading: Option<f64>,
    pub threshold: Option<f64>,
    pub side: f64,
    #[serde(rename = "lastSkip")] pub last_skip: Option<LastSkip>,
    #[serde(rename = "lastEnter")] pub last_enter: Option<Enter>,
}
#[derive(Serialize)]
pub struct ThesisState { pub dir: String, pub text: String, pub invalidation: String }
#[derive(Serialize)]
pub struct PosState {
    pub pending: bool,
    pub dir: f64,
    pub venue: String,
    #[serde(rename = "entryPx")] pub entry_px: Option<f64>,
    #[serde(rename = "tIn")] pub t_in: Option<f64>,
    #[serde(rename = "tEnd")] pub t_end: Option<f64>,
    #[serde(rename = "stopBps")] pub stop_bps: f64,
    #[serde(rename = "stopPx")] pub stop_px: Option<f64>,
    #[serde(rename = "targetPx")] pub target_px: Option<f64>,
    #[serde(rename = "trailBps")] pub trail_bps: Option<f64>,
    pub best: f64,
    #[serde(rename = "flowAt")] pub flow_at: Option<f64>,
}
#[derive(Serialize)]
pub struct State {
    pub id: String,
    pub name: String,
    pub stage: String,
    pub context: CtxState,
    pub region: RegionState,
    pub trigger: TrigState,
    pub thesis: ThesisState,
    pub position: Option<PosState>,
    pub counts: Counts,
}

// ---------- the definition, typed (after validate) ----------
#[derive(Clone, Copy, PartialEq)]
enum Inv { None, TriggerReverses, EpisodeAgainst, Region }
#[derive(Clone, Copy, PartialEq)]
enum Ex { Timed, FlowEpisode, Target, Trailing, RangeLevel, Normalisation }
enum Ctx { Always, SigmaBand(f64, f64), Hours([bool; 24]), MarketState(Vec<String>) }

#[derive(Clone)]
struct Opt { latency_ms: f64, stale_ms: f64, max_gap_ms: f64, flow_window_sec: f64, min_flow_readings: f64, min_room_bps: f64 }

struct Pos {
    dir: f64, venue: String, t_sig: f64, side: f64, filled: bool, t_in: Option<f64>, p0: Option<f64>, t_end: f64, best: f64, stop_bps: f64,
    tp_bps: Option<f64>, trail_bps: Option<f64>, level_px: Option<f64>, flow_at: Option<f64>, box_: Option<(f64, f64)>, support: HashSet<String>, thesis: String, exit_reason: &'static str,
}

/// One system running. Create it with `System::new`; feed it one `Snap` a second.
pub struct System {
    id: String,
    name: String,
    stage: String,
    venue: String,
    any_venue: bool,
    ctx: Ctx,
    ctx_kind: &'static str,
    box_w: f64,
    reg_window_sec: Option<f64>,
    trg_kind: String,
    trg_tol_bps: f64,
    ex: Ex,
    ex_kind: &'static str,
    hold_sec: f64,
    tp_k: f64,
    trail_k: f64,
    frac: f64,
    families: Option<Vec<String>>,
    stop_k: f64,
    dir_sign: f64,
    th_dir: String,
    th_text: String,
    inv: Inv,
    inv_kind: &'static str,
    opt: Opt,
    forced: Option<ForcedQ>,
    vt: [Option<Vt>; 2],
    trig: Trig,
    sigma_now: f64,
    position: Option<Pos>,
    busy_until: f64,
    prev_busy: f64,
    last_snap_t: Option<f64>,
    last_ctx: (bool, String),
    last_skip: Option<LastSkip>,
    last_enter: Option<Enter>,
    counts: Counts,
    last_closed: Option<Pos>,
}

fn opt_num(o: Option<&Value>, k: &str, d: f64) -> f64 {
    match get(o, k) { None => d, Some(Value::Null) => 0.0, Some(Value::Number(n)) => n.as_f64().unwrap_or(d), _ => d }
}
fn s(x: Option<&Value>) -> String { st(x).unwrap_or("").to_string() }
fn f(x: Option<&Value>) -> f64 { num(x).unwrap_or(f64::NAN) }

impl System {
    pub fn new(def_v: &Value, opt_v: Option<&Value>) -> Result<System, String> {
        let bad = validate(Some(def_v));
        if !bad.is_empty() { return Err(format!("invalid system: {}", bad.join("; "))); }
        let d = Some(def_v);
        let o = Opt {
            latency_ms: opt_num(opt_v, "latencyMs", 0.0), stale_ms: opt_num(opt_v, "staleMs", 3000.0), max_gap_ms: opt_num(opt_v, "maxGapMs", 30000.0),
            flow_window_sec: opt_num(opt_v, "flowWindowSec", 1800.0), min_flow_readings: opt_num(opt_v, "minFlowReadings", 30.0), min_room_bps: opt_num(opt_v, "minRoomBps", 0.2),
        };
        // signals (an array, even an empty one): the forced signals, sorted by time; forced: signals arrive at step time with force()
        let forced: Option<ForcedQ> = match get(opt_v, "signals") {
            Some(Value::Array(a)) => { let mut v: Vec<Forced> = a.iter().map(Forced::from_value).collect(); sv_core::sort_by(&mut v, |x, y| (x.t - y.t).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)); Some(v.into()) }
            _ => if js::truthy(get(opt_v, "forced")) { Some(VecDeque::new()) } else { None },
        };
        let (ctx_v, reg_v, trg, th, ex_v, rk) = (get(d, "context"), get(d, "region"), get(d, "trigger"), get(d, "thesis"), get(d, "exit"), get(d, "risk"));
        let ctx_kind: &'static str = match st(get(ctx_v, "type")).unwrap_or("") { "sigmaBand" => "sigmaBand", "hours" => "hours", "marketState" => "marketState", _ => "always" };
        let ctx = match ctx_kind {
            "sigmaBand" => Ctx::SigmaBand(f(get(ctx_v, "min")), f(get(ctx_v, "max"))),
            "hours" => { let mut h = [false; 24]; if let Some(Value::Array(a)) = get(ctx_v, "hours") { for x in a { if let Some(n) = num(Some(x)) { h[n as usize] = true; } } } Ctx::Hours(h) }
            "marketState" => Ctx::MarketState(match get(ctx_v, "states") { Some(Value::Array(a)) => a.iter().filter_map(|x| st(Some(x)).map(String::from)).collect(), _ => vec![] }),
            _ => Ctx::Always,
        };
        let venue = s(get(d, "venue"));
        let any_venue = venue == "any";
        let trg_kind = s(get(trg, "type"));
        let box_w = if st(get(reg_v, "type")) == Some("rangeBox") { f(get(reg_v, "windowSec")) * 1000.0 } else { 0.0 };
        let ex_kind: &'static str = match st(get(ex_v, "type")).unwrap_or("") { "flowEpisode" => "flowEpisode", "target" => "target", "trailing" => "trailing", "rangeLevel" => "rangeLevel", "normalisation" => "normalisation", _ => "timed" };
        let ex = match ex_kind { "flowEpisode" => Ex::FlowEpisode, "target" => Ex::Target, "trailing" => Ex::Trailing, "rangeLevel" => Ex::RangeLevel, "normalisation" => Ex::Normalisation, _ => Ex::Timed };
        let inv_kind: &'static str = match st(get(get(th, "invalidation").filter(|v| js::truthy(Some(v))), "type")).unwrap_or("none") { "triggerReverses" => "triggerReverses", "episodeAgainst" => "episodeAgainst", "region" => "region", _ => "none" };
        let inv = match inv_kind { "triggerReverses" => Inv::TriggerReverses, "episodeAgainst" => Inv::EpisodeAgainst, "region" => Inv::Region, _ => Inv::None };
        let th_dir = s(get(th, "dir"));
        let used: Vec<usize> = if any_venue || trg_kind == "premium" { vec![0, 1] } else { vec![vidx(&venue).unwrap_or(0)] };
        let look_ms = if trg_kind == "priceMove" { f(get(trg, "lookSec")) * 1000.0 } else { 0.0 };
        let mut vt: [Option<Vt>; 2] = [None, None];
        for v in used { vt[v] = Some(Vt::new(look_ms > 0.0, box_w > 0.0, box_w)); }
        let trig = Trig::make(trg, &venue, any_venue, box_w)?;
        Ok(System {
            id: id(d), name: s(get(d, "name")), stage: s(get(d, "stage")), venue, any_venue, ctx, ctx_kind, box_w,
            reg_window_sec: if box_w > 0.0 { Some(f(get(reg_v, "windowSec"))) } else { None },
            trg_kind, trg_tol_bps: f(get(trg, "tolBps")), ex, ex_kind, hold_sec: f(get(ex_v, "holdSec")), tp_k: f(get(ex_v, "tpK")), trail_k: f(get(ex_v, "trailK")), frac: f(get(ex_v, "frac")),
            families: match get(ex_v, "families") { Some(Value::Array(a)) => Some(a.iter().map(|x| s(Some(x))).collect()), _ => None },
            stop_k: f(get(rk, "stopK")), dir_sign: if th_dir == "fade" { -1.0 } else { 1.0 }, th_dir, th_text: s(get(th, "text")), inv, inv_kind, opt: o, forced, vt, trig, sigma_now: 0.0,
            position: None, busy_until: f64::NEG_INFINITY, prev_busy: f64::NEG_INFINITY, last_snap_t: None, last_ctx: (true, String::new()), last_skip: None, last_enter: None, counts: Counts::default(), last_closed: None,
        })
    }
    pub fn id(&self) -> &str { &self.id }

    fn context_at(&self, snap: &Snap, venue: &str) -> (bool, String) {
        match &self.ctx {
            Ctx::Always => (true, String::new()),
            Ctx::SigmaBand(mn, mx) => {
                let sg = vidx(venue).and_then(|v| snap.sigma.at(v));
                match sg { Some(x) if x >= *mn && x <= *mx => (true, String::new()), _ => (false, format!("sigma {} outside {} to {}", match sg { None => "?".to_string(), Some(x) => to_fixed2(x) }, num_str(*mn), num_str(*mx))) }
            }
            Ctx::Hours(h) => {
                let hr = utc_hour(snap.t);
                if hr.is_finite() && h[hr as usize] { (true, String::new()) } else { (false, format!("hour {} UTC not in the list", num_str(hr))) }
            }
            Ctx::MarketState(list) => match &snap.state {
                None | Some(Value::Null) => (false, "no market state".into()),
                Some(Value::String(x)) if list.iter().any(|y| y == x) => (true, String::new()),
                Some(x) => (false, format!("market state {} not allowed", js::to_string(Some(x)))),
            },
        }
    }
    fn box_for(&self, venue: &str, t_sig: f64) -> Option<Bx> {
        let x = self.vt[vidx(venue)?].as_ref()?;
        let c = x.box_?;
        if c.t <= t_sig && t_sig - c.t <= 2000.0 { return Some(c); }
        if let Some(p) = x.prev_box { if p.t <= t_sig && t_sig - p.t <= 2000.0 { return Some(p); } }
        None
    }
    fn skip(&mut self, reason: &'static str, sig: &Sig, snap: &Snap, out: &mut Vec<Intent>) {
        self.counts.skip.add(reason);
        self.last_skip = Some(LastSkip { reason, t: snap.t });
        out.push(Intent::Skip(Skip { kind: "skip", reason, t: snap.t, t_sig: sig.t, venue: sig.venue.clone(), side: sig.side }));
    }
    fn leave(&mut self, reason: &'static str, t: f64, t_at: f64, out: &mut Vec<Intent>, px: Option<f64>, bps: Option<f64>, why: Option<&'static str>) {
        let Some(mut p) = self.position.take() else { return };
        self.busy_until = t_at;
        p.exit_reason = reason;
        if reason == "invalidate" { self.counts.invalidate += 1; } else { self.counts.exit.add(reason); }
        out.push(Intent::Leave(Leave { kind: if reason == "invalidate" { "invalidate" } else { "exit" }, reason, t, t_at, venue: p.venue.clone(), dir: p.dir, px, bps, why, void: None }));
        self.last_closed = Some(p);
    }

    /// One second.
    pub fn step(&mut self, snap: &Snap) -> Vec<Intent> {
        let t = snap.t;
        let mut out: Vec<Intent> = Vec::new();
        // 1. venue points: box (before the point is added), counters
        for v in 0..2 {
            let Some(x) = self.vt[v].as_mut() else { continue };
            x.cur = false;
            let p = match snap.px.at(v) { Some(p) if p > 0.0 => p, _ => continue };
            x.cur = true; x.p = p; x.n += 1; if x.t0.is_none() { x.t0 = Some(t); } x.prev_t = x.last_t;
            if let Some(e) = x.ext.as_mut() { e.query(t); x.prev_box = x.box_; x.box_ = Some(Bx { t, hi: e.hi, lo: e.lo }); }
        }
        let pv_idx = if self.any_venue { None } else { vidx(&self.venue) };
        self.sigma_now = if self.any_venue { 0.0 } else { pv_idx.and_then(|i| snap.sigma.at(i)).unwrap_or(f64::NAN) };
        // 2. the trigger reads this second first
        let mut sigs: Vec<Sig> = Vec::new();
        if self.forced.is_none() || self.ex == Ex::Normalisation || self.inv == Inv::TriggerReverses {
            let mut r: Vec<Sig> = Vec::new();
            let pv_cur = pv_idx.map_or(false, |i| self.vt[i].as_ref().map_or(false, |x| x.cur));
            let fl = (self.opt.flow_window_sec, self.opt.min_flow_readings);
            if self.trg_kind == "episode" || self.trg_kind == "premium" { r = self.trig.eval(snap, None, self.sigma_now, &fl); }
            else if pv_cur { let i = pv_idx.unwrap_or(0); r = self.trig.eval(snap, self.vt[i].as_mut(), self.sigma_now, &fl); }
            if self.forced.is_none() { sigs = r; }
        }
        if let Some(fq) = self.forced.as_mut() {
            while fq.front().map_or(false, |x| x.t <= t) {
                let Some(fs) = fq.pop_front() else { break };
                if !self.any_venue && fs.venue.as_ref().map_or(false, |v| *v != self.venue) { continue; }
                sigs.push(Sig { t: fs.t, venue: match &fs.venue { Some(v) if !v.is_empty() => v.clone(), _ => self.venue.clone() }, side: fs.side });
            }
            if pv_idx.map_or(false, |i| !self.vt[i].as_ref().map_or(false, |x| x.cur)) { sigs.clear(); }
        }
        // 3. the position
        if self.position.as_ref().map_or(false, |p| p.filled && t > p.t_in.unwrap_or(f64::NAN)) { self.manage_position(snap, &mut out); }
        // 4. the signals
        let cv = if self.any_venue { "bn".to_string() } else { self.venue.clone() };
        self.last_ctx = self.context_at(snap, &cv);
        for sig in &sigs { self.take_signal(sig, snap, &mut out); }
        for x in self.vt.iter_mut().flatten() { if x.cur { if let Some(e) = x.ext.as_mut() { e.push(t, x.p); } x.last_t = Some(t); } }
        self.last_snap_t = Some(t);
        out
    }

    fn take_signal(&mut self, sig: &Sig, snap: &Snap, out: &mut Vec<Intent>) {
        let v = sig.venue.as_str();
        let c = self.context_at(snap, v);
        self.last_ctx = c.clone();
        if !c.0 { return self.skip("context off", sig, snap, out); }
        if !snap.calibrated { return self.skip("not calibrated", sig, snap, out); }
        let vi = vidx(v);
        let px_ok = vi.and_then(|i| snap.px.at(i)).map_or(false, |p| p > 0.0);
        let age = vi.and_then(|i| snap.age.at(i));
        if !px_ok || age.is_none() || age.map_or(false, |a| a > self.opt.stale_ms) { return self.skip("stale price", sig, snap, out); }
        if self.position.is_some() || sig.t < self.busy_until { return self.skip("in position", sig, snap, out); }
        let mut level_px = None;
        let mut bx: Option<Bx> = None;
        if self.box_w > 0.0 {
            bx = self.box_for(v, sig.t);
            if self.ex == Ex::RangeLevel || self.inv == Inv::Region { if !bx.map_or(false, |b| b.hi > b.lo) { return self.skip("no region yet", sig, snap, out); } }
        }
        let dir = sig.side * self.dir_sign;
        let sigma = vi.and_then(|i| snap.sigma.at(i)).unwrap_or(f64::NAN);
        let sg = sigma * self.hold_sec.sqrt();
        let stop_bps = self.stop_k * sg;
        if self.ex == Ex::RangeLevel {
            let b = bx.unwrap_or(Bx { t: 0.0, hi: f64::NAN, lo: f64::NAN });
            level_px = Some(if dir > 0.0 { if self.frac == 1.0 { b.hi } else { (b.hi + b.lo) / 2.0 } } else if self.frac == 1.0 { b.lo } else { (b.hi + b.lo) / 2.0 });
        }
        let reading = self.trig.read();
        let tp_bps = if self.ex == Ex::Target { Some(self.tp_k * sg) } else { None };
        let trail_bps = if self.ex == Ex::Trailing { Some(self.trail_k * sg) } else { None };
        let support: HashSet<String> = snap.episodes.active.iter().filter(|g| g.venue == v && g.side == dir).map(|g| g.id.clone()).collect();
        self.position = Some(Pos {
            dir, venue: sig.venue.clone(), t_sig: sig.t, side: sig.side, filled: false, t_in: None, p0: None, t_end: f64::NAN, best: 0.0, stop_bps, tp_bps, trail_bps, level_px, flow_at: None,
            box_: bx.map(|b| (b.hi, b.lo)), support, thesis: self.th_text.clone(), exit_reason: "",
        });
        self.prev_busy = self.busy_until;
        if self.ex == Ex::FlowEpisode { for g in &snap.episodes.new_ { self.flow_candidate(g); } }
        self.counts.enter += 1;
        let info = Enter {
            kind: "enter", t: snap.t, t_sig: sig.t, venue: sig.venue.clone(), dir, stop_bps,
            exit: ExitInfo { kind: self.ex_kind.to_string(), hold_sec: self.hold_sec, tp_bps, trail_bps, level_px, families: self.families.clone() },
            reading, thesis: self.th_text.clone(), trigger: self.trg_kind.clone(), region: bx.map(|b| Region2 { hi: b.hi, lo: b.lo }),
        };
        self.last_enter = Some(info.clone());
        out.push(Intent::Enter(info));
    }
    fn flow_candidate(&mut self, g: &Ep) {
        let Some(p) = self.position.as_mut() else { return };
        let fam = self.families.as_ref().map_or(false, |f| f.iter().any(|x| *x == g.family));
        if p.flow_at.is_some() || g.venue != p.venue || !fam || g.side != -p.dir || !(g.t_detected > p.t_sig) { return; }
        p.flow_at = Some(g.t_detected);
    }
    fn manage_position(&mut self, snap: &Snap, out: &mut Vec<Intent>) {
        let t = snap.t;
        let Some(vi) = self.position.as_ref().and_then(|p| vidx(&p.venue)) else { return };
        if self.ex == Ex::FlowEpisode { for g in &snap.episodes.new_ { self.flow_candidate(g); } }
        if let Some(a) = snap.age.at(vi) { if a > self.opt.max_gap_ms { return self.leave("gap", t, t, out, None, None, None); } }
        let (cur, xp, prev_t) = { let x = self.vt[vi].as_ref().unwrap(); (x.cur, x.p, x.prev_t) };
        if !cur { return; }
        if prev_t.map_or(false, |pt| t - pt > self.opt.max_gap_ms) { return self.leave("gap", t, t, out, None, None, None); }
        let (t_end, dir, p0, stop_bps, trail_bps, tp_bps, flow_at) = { let p = self.position.as_ref().unwrap(); (p.t_end, p.dir, p.p0.unwrap_or(f64::NAN), p.stop_bps, p.trail_bps, p.tp_bps, p.flow_at) };
        if t > t_end { return self.leave("time", t, t_end, out, None, None, None); }
        let px = xp;
        let mv = dir * (px / p0 - 1.0) * 1e4;
        if mv <= -stop_bps { return self.leave("stop", t, t, out, Some(px), None, None); }
        { let p = self.position.as_mut().unwrap(); if mv > p.best { p.best = mv; } }
        let best = self.position.as_ref().unwrap().best;
        if let Some(tb) = trail_bps { if best - mv >= tb && best > 0.0 { return self.leave("trail", t, t, out, Some(px), None, None); } }
        if let Some(tp) = tp_bps { if mv >= tp { return self.leave("target", t, t, out, None, Some(tp), None); } }
        if self.ex == Ex::Normalisation && self.trig.norm(snap) { return self.leave("norm", t, t, out, Some(px), None, None); }
        if let Some(fa) = flow_at { if fa + self.opt.latency_ms < t_end && t >= fa + self.opt.latency_ms { return self.leave("flow", t, t, out, Some(px), None, None); } }
        if self.inv != Inv::None && self.invalidated(snap, px) { return self.leave("invalidate", t, t, out, Some(px), None, Some(self.inv_kind)); }
        if t >= t_end { return self.leave("time", t, t_end, out, None, None, None); }
    }
    fn invalidated(&self, snap: &Snap, px: f64) -> bool {
        let p = self.position.as_ref().unwrap();
        match self.inv {
            Inv::TriggerReverses => { let r = self.trig.read(); r.map_or(false, |r| r.side != 0.0 && r.side == -p.side) }
            Inv::EpisodeAgainst => {
                if snap.episodes.new_.iter().any(|g| g.venue == p.venue && g.side == -p.dir) { return true; }
                snap.episodes.ended.iter().any(|g| p.support.contains(&g.id))
            }
            Inv::Region => match p.box_ {
                Some((hi, lo)) => {
                    if self.trg_kind == "rangeBreak" { if p.side > 0.0 { px <= hi } else { px >= lo } }
                    else { let tol = self.trg_tol_bps / 1e4; px > hi * (1.0 + tol) || px < lo * (1.0 - tol) }
                }
                None => false,
            },
            Inv::None => false,
        }
    }

    /// A forced (random-entry) signal for the next step; only an instance made with `forced` or `signals` takes it.
    pub fn force(&mut self, sig: Forced) { if let Some(q) = self.forced.as_mut() { q.push_back(sig); } }
    /// The caller's fill of the entry: price and time. May answer with an exit (a range-level target with no room left is void: the entry is closed at once).
    pub fn filled(&mut self, px: f64, t: f64) -> Vec<Intent> {
        let Some(p) = self.position.as_mut() else { return vec![] };
        if p.filled { return vec![]; }
        p.filled = true; p.p0 = Some(px); p.t_in = Some(t); p.t_end = t + self.hold_sec * 1000.0;
        if let Some(lvl) = p.level_px {
            let lb = p.dir * (lvl / px - 1.0) * 1e4;
            if !(lb > self.opt.min_room_bps) {
                let (venue, dir) = (p.venue.clone(), p.dir);
                self.position = None; self.busy_until = self.prev_busy; self.counts.enter -= 1;
                return vec![Intent::Leave(Leave { kind: "exit", reason: "no room", t, t_at: t, venue, dir, px: None, bps: None, why: None, void: Some(true) })];
            }
            p.tp_bps = Some(match p.tp_bps { None => lb, Some(x) => js::min(x, lb) });
        }
        vec![]
    }
    /// The entry was not filled (no price, order refused): back to flat as if the signal had not been taken.
    pub fn cancelled(&mut self) {
        if self.position.as_ref().map_or(false, |p| !p.filled) { self.position = None; self.busy_until = self.prev_busy; self.counts.enter -= 1; }
    }
    /// The caller's fill of an exit: the finished trade.
    pub fn closed(&mut self, px: f64, t: f64) -> Option<Trade> {
        let p = self.last_closed.take()?;
        let p0 = p.p0.unwrap_or(f64::NAN);
        Some(Trade { dir: p.dir, venue: p.venue, t_in: p.t_in.unwrap_or(f64::NAN), t_out: t, entry_px: p0, exit_px: px, gross_bps: p.dir * (px / p0 - 1.0) * 1e4, stop_bps: p.stop_bps, reason: p.exit_reason, thesis: p.thesis })
    }
    /// The data ended (or the caller is shutting down): close what is open.
    pub fn end(&mut self, t: f64) -> Vec<Intent> {
        match &self.position {
            None => vec![],
            Some(p) if !p.filled => { self.cancelled(); vec![] }
            Some(_) => {
                let mut out = Vec::new();
                self.leave("end", t, t, &mut out, None, None, None);
                out
            }
        }
    }
    pub fn state(&self) -> State {
        let p = self.position.as_ref();
        let rd = self.trig.read();
        let region = match self.reg_window_sec {
            None => RegionState::Flat { kind: "none" },
            Some(w) => {
                let x = self.vt[if self.any_venue { 0 } else { vidx(&self.venue).unwrap_or(0) }].as_ref().unwrap();
                match x.box_ {
                    Some(b) => RegionState::Box { kind: "rangeBox", window_sec: w, hi: Some(b.hi), lo: Some(b.lo), ready: x.t0.map_or(false, |t0| self.last_snap_t.map_or(false, |l| l - t0 >= self.box_w)) },
                    None => RegionState::Box { kind: "rangeBox", window_sec: w, hi: None, lo: None, ready: false },
                }
            }
        };
        State {
            id: self.id.clone(), name: self.name.clone(), stage: self.stage.clone(),
            context: CtxState { kind: self.ctx_kind.to_string(), on: self.last_ctx.0, why: self.last_ctx.1.clone() },
            region,
            trigger: TrigState { kind: self.trg_kind.clone(), reading: rd.and_then(|r| r.value), threshold: rd.and_then(|r| r.threshold), side: rd.map_or(0.0, |r| r.side),
                last_skip: self.last_skip.as_ref().map(|k| LastSkip { reason: k.reason, t: k.t }), last_enter: self.last_enter.clone() },
            thesis: ThesisState { dir: self.th_dir.clone(), text: self.th_text.clone(), invalidation: self.inv_kind.to_string() },
            position: p.map(|p| PosState {
                pending: !p.filled, dir: p.dir, venue: p.venue.clone(), entry_px: p.p0, t_in: p.t_in, t_end: if p.filled { Some(p.t_end) } else { None }, stop_bps: p.stop_bps,
                stop_px: p.p0.map(|p0| p0 * (1.0 - p.dir * p.stop_bps / 1e4)), target_px: match (p.p0, p.tp_bps) { (Some(p0), Some(tp)) => Some(p0 * (1.0 + p.dir * tp / 1e4)), _ => None },
                trail_bps: p.trail_bps, best: p.best, flow_at: p.flow_at,
            }),
            counts: self.counts.clone(),
        }
    }
}

/// `x.toFixed(2)`: exact decimal rounding, a tie goes away from zero (Rust's own `{:.2}` rounds a tie to even).
fn to_fixed2(x: f64) -> String {
    if !x.is_finite() || x.abs() >= 1e21 { return num_str(x); }
    let a = x.abs();
    let tie = (a * 8.0).fract() == 0.0 && ((a * 1000.0).round() as u128) % 10 == 5;
    let body = if tie { let n = (a * 100.0).floor() as u128 + 1; format!("{}.{:02}", n / 100, n % 100) } else { format!("{:.2}", a) };
    if x < 0.0 { format!("-{body}") } else { body }
}
/// `new Date(t).getUTCHours()` (NaN for an invalid date)
fn utc_hour(t: f64) -> f64 {
    if !t.is_finite() || t.abs() > 8.64e15 { return f64::NAN; }
    let ms = t.trunc();
    ((ms / 3.6e6).floor() % 24.0 + 24.0) % 24.0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn id_matches_js() {
        let d: Value = serde_json::from_str(r#"{"name":"t","stage":"paper","venue":"bn","context":{"type":"always"},"region":{"type":"none"},"trigger":{"type":"priceMove","lookSec":10,"m":2},"thesis":{"dir":"continuation","text":"x","invalidation":{"type":"none"}},"exit":{"type":"timed","holdSec":30},"risk":{"stopK":2,"riskFrac":0.01}}"#).unwrap();
        assert!(validate(Some(&d)).is_empty());
        assert_eq!(id(Some(&d)), "S0c8bfe06c2c8");
    }
    #[test]
    fn to_fixed2_ties_go_away_from_zero() {
        let got: Vec<String> = [0.125, 0.375, 2.5, 1.005, 0.994999, -0.125, 100.0, 0.05].iter().map(|x| to_fixed2(*x)).collect();
        assert_eq!(got.join(" "), "0.13 0.38 2.50 1.00 0.99 -0.13 100.00 0.05");
    }
}
