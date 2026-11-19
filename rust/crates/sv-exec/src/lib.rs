//! Port of src/js/js-cores/exec-core.js (EXEC, Trader step 8): the demo-execution state machine, one per asset (idle, entering, stopping, holding, exiting, settling, stuck; overlays blocked, fault, killed).
//! Pure: no clock, no network, no I/O. The time is handed in, the requests it wants sent come out of `drain` and the exchange's answers go back in through `reply`.
//!
//! SAFETY RULE (the first thing this file does): a machine is `allowed` only when its base URL is the Binance DEMO host or this PC's demo proxy (`is_demo_base`) and `ALLOW_LIVE` is false for the live host.
//! A machine that is not allowed never produces a request: `send` returns before it queues anything, `start` does not start, `on_enter` refuses the trade. `ALLOW_LIVE` is a `const false` (the live path stays closed until step 9).
//!
//! The code follows the JS function by function (same names in snake case, same order of checks and of side effects). Numbers follow JS: a missing or non-numeric field reads as NaN, and comparisons with NaN are false.
//! Differences, all in inputs the page never sends: see the list in the doc of src/js/exec-core.js ("Edge differences").
pub mod ops;

use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::{Number, Value};
use std::collections::BTreeMap;
use sv_core::js::{max as jmax, min as jmin, num_str, sign, to_number, to_string, truthy, truthy_num};
use sv_core::js_round;

pub const DEMO_BASE: &str = "https://demo-fapi.binance.com";
pub const LIVE_BASE: &str = "https://fapi.binance.com";
/// The live path stays closed until step 9. Nothing reads this from outside; it is a constant, not an option.
pub const ALLOW_LIVE: bool = false;

const PREFIX: &str = "svx_";
const CAP_USD: f64 = 5000.0;
const QUOTE_MS: f64 = 3000.0;
const OFFSET_MS: f64 = 1000.0;
const STOP_MS: f64 = 3000.0;
const UNKNOWN_MS: f64 = 5000.0;
const REQ_MS: f64 = 8000.0;
const LATE_MS: f64 = 5000.0;
const EXIT_TRIES: f64 = 3.0;
const RETRY_MS: f64 = 1000.0;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the guard
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
/// `/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/`: this PC's demo proxy. Exactly that and nothing more: lower case, plain http, a port of 2 to 5 ASCII digits, no path, no userinfo, no trailing dot.
fn local_proxy(s: &str) -> bool {
    let Some(r) = s.strip_prefix("http://") else { return false };
    let Some(r) = r.strip_prefix("127.0.0.1").or_else(|| r.strip_prefix("localhost")) else { return false };
    let Some(port) = r.strip_prefix(':') else { return false };
    (2..=5).contains(&port.len()) && port.bytes().all(|c| c.is_ascii_digit())
}
/// The demo host itself (a string that equals it exactly: `is_string` says the JS value was a string, `b === DEMO_BASE` is a strict comparison) or the local demo proxy (tested on `String(b)`).
pub fn is_demo_base(s: &str, is_string: bool) -> bool { (is_string && s == DEMO_BASE) || local_proxy(s) }
/// The one decision on where requests may go.
pub fn allowed_base(s: &str, is_string: bool) -> bool { is_demo_base(s, is_string) || (ALLOW_LIVE && is_string && s == LIVE_BASE) }

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// JS number and string helpers
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
fn nj(x: f64) -> Value { Number::from_f64(x).map(Value::Number).unwrap_or(Value::Null) }
fn nv(x: f64) -> V { V::J(nj(x)) }
fn hash36(s: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for c in s.encode_utf16() { h ^= c as u32; h = h.wrapping_mul(0x01000193); }
    radix36(h as f64)
}
/// Number#toString(36) for the integers a time stamp is (the fraction of a non-integer is not written; the page's times are whole milliseconds).
fn radix36(x: f64) -> String {
    if x.is_nan() { return "NaN".into(); }
    if x.is_infinite() { return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() }; }
    let neg = x < 0.0;
    let mut n = x.abs().trunc() as u128;
    if n == 0 { return "0".into(); }
    let mut d = Vec::new();
    while n > 0 { d.push(b"0123456789abcdefghijklmnopqrstuvwxyz"[(n % 36) as usize]); n /= 36; }
    if neg { d.push(b'-'); }
    d.reverse();
    String::from_utf8(d).unwrap_or_default()
}
/// `decOf`: the digits after the point of the shortest text of `x` (an exponent "e-7" counts as 7). Capped at 100 (the largest toFixed accepts).
fn dec_of(x: f64) -> usize {
    let s = num_str(x);
    let n = if let Some((_, e)) = s.split_once("e-") { e.parse::<usize>().unwrap_or(0) } else { s.split_once('.').map_or(0, |(_, f)| f.len()) };
    n.min(100)
}
/// Number#toFixed(d): the exact decimal value of the double rounded half away from zero (Rust rounds an exact tie to even), "NaN", or the Number text at 1e21 and above.
fn to_fixed(x: f64, d: usize) -> String {
    if x.is_nan() { return "NaN".into(); }
    if x.abs() >= 1e21 { return num_str(x); }
    let a = x.abs();
    let long = format!("{:.*}", d + 40, a);
    let keep = long.len() - 40;
    let tail = &long[keep..];
    let tie = tail.starts_with('5') && tail[1..].bytes().all(|c| c == b'0');
    let mut s = if tie {
        let mut b: Vec<u8> = long.as_bytes()[..keep].to_vec();
        if d == 0 { b.pop(); }      // the point
        let mut i = b.len();
        loop {
            if i == 0 { b.insert(0, b'1'); break; }
            i -= 1;
            if b[i] == b'.' { continue; }
            if b[i] == b'9' { b[i] = b'0'; } else { b[i] += 1; break; }
        }
        String::from_utf8(b).unwrap_or_default()
    } else { format!("{:.*}", d, a) };
    if x < 0.0 { s.insert(0, '-'); }
    s
}
fn floor_step(v: f64, step: f64) -> f64 { (v / step + 1e-9).floor() * step }
fn to_str(v: f64, step: f64) -> String { to_fixed(v, dec_of(step)) }
fn truthy_s(s: &Option<String>) -> bool { matches!(s, Some(x) if !x.is_empty()) }
/// `a || b` on strings (the result is b, whatever it is, when a is falsy).
fn or_s(a: &Option<String>, b: Option<String>) -> Option<String> { if truthy_s(a) { a.clone() } else { b } }
/// String(v || "")
fn txt(v: Option<&Value>) -> String { if truthy(v) { to_string(v) } else { String::new() } }
fn fnum(v: &Value, k: &str) -> f64 { to_number(v.get(k)) }
fn is_nullish(v: Option<&Value>) -> bool { matches!(v, None | Some(Value::Null)) }
/// a === b on JSON values (numbers by value; two undefined are equal; objects are never equal, as two different references)
fn strict_eq(a: &Option<Value>, b: &Option<Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::Object(_)), _) | (Some(Value::Array(_)), _) => false,
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}
/// /-2011|-2013|unknown order|no such order/i on String(err || "") + String(code || "")
fn gone(res: &Res) -> bool {
    let s = (txt(res.err.as_ref()) + &txt(res.code.as_ref())).to_ascii_lowercase();
    s.contains("-2011") || s.contains("-2013") || s.contains("unknown order") || s.contains("no such order")
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// ordered JSON out (serde_json's Value sorts keys; the rows and requests keep the JS key order)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
pub enum V { J(Value), O(Ord), F(Vec<Fault>) }
impl Serialize for V { fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { match self { V::J(v) => v.serialize(s), V::O(o) => o.serialize(s), V::F(f) => f.serialize(s) } } }
pub struct Ord(Vec<(&'static str, V)>);
impl Serialize for Ord {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 { m.serialize_entry(k, v)?; }
        m.end()
    }
}
fn sv(s: &str) -> V { V::J(Value::String(s.to_string())) }
fn push_opt(o: &mut Vec<(&'static str, V)>, k: &'static str, v: &Option<Value>) { if let Some(x) = v { o.push((k, V::J(x.clone()))); } }

#[derive(Clone)]
pub struct Fault { t: f64, kind: String, text: String }
impl Serialize for Fault {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(3))?;
        m.serialize_entry("t", &nj(self.t))?; m.serialize_entry("kind", &self.kind)?; m.serialize_entry("text", &self.text)?;
        m.end()
    }
}

#[derive(Clone)]
enum Orig { Role(&'static str), Full(Box<Req>) }
/// A request to the exchange. Which keys it has, and their order, depends on `op`, as in the JS object literals (and `id` last, which `send` adds).
#[derive(Clone)]
pub struct Req {
    op: &'static str, role: &'static str, side: &'static str, qty: f64, qty_str: String, reduce: bool, stop_px: f64, stop_str: String,
    cid: Option<String>, algo: bool, recon: bool, of: Option<String>, orig: Option<Orig>, since: f64, prev: bool, id: u32,
}
impl Req {
    fn blank(op: &'static str, role: &'static str) -> Req {
        Req { op, role, side: "", qty: 0.0, qty_str: String::new(), reduce: false, stop_px: 0.0, stop_str: String::new(), cid: None, algo: false, recon: false, of: None, orig: None, since: 0.0, prev: false, id: 0 }
    }
    fn market(role: &'static str, side: &'static str, qty: f64, qty_str: String, reduce: bool, cid: String) -> Req { Req { side, qty, qty_str, reduce, cid: Some(cid), ..Req::blank("market", role) } }
    fn cancel(cid: Option<String>, algo: bool, recon: bool) -> Req { Req { cid, algo, recon, ..Req::blank("cancel", "c") } }
    fn lookup(role: &'static str, of: Option<String>, algo: bool, orig: Orig, since: f64, prev: bool) -> Req { Req { of, algo, orig: Some(orig), since, prev, ..Req::blank("lookup", role) } }
}
impl Serialize for Req {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(None)?;
        m.serialize_entry("op", self.op)?; m.serialize_entry("role", self.role)?;
        match self.op {
            "market" => { m.serialize_entry("side", self.side)?; m.serialize_entry("qty", &nj(self.qty))?; m.serialize_entry("qtyStr", &self.qty_str)?; m.serialize_entry("reduce", &self.reduce)?; m.serialize_entry("cid", &self.cid)?; }
            "stop" => { m.serialize_entry("side", self.side)?; m.serialize_entry("qty", &nj(self.qty))?; m.serialize_entry("qtyStr", &self.qty_str)?; m.serialize_entry("stopPx", &nj(self.stop_px))?; m.serialize_entry("stopStr", &self.stop_str)?; m.serialize_entry("cid", &self.cid)?; }
            "cancel" => { m.serialize_entry("cid", &self.cid)?; m.serialize_entry("algo", &self.algo)?; if self.recon { m.serialize_entry("recon", &true)?; } }
            _ => {
                if let Some(o) = &self.of { m.serialize_entry("of", o)?; }
                m.serialize_entry("algo", &self.algo)?;
                match &self.orig {
                    Some(Orig::Role(r)) => { let mut o = serde_json::Map::new(); o.insert("role".into(), Value::String(r.to_string())); m.serialize_entry("orig", &o)?; }
                    Some(Orig::Full(b)) => m.serialize_entry("orig", b.as_ref())?,
                    None => {}
                }
                m.serialize_entry("since", &nj(self.since))?;
                if self.prev { m.serialize_entry("prev", &true)?; }
            }
        }
        m.serialize_entry("id", &self.id)?;
        m.end()
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// what comes in
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
/// The data of an answer (a fill or a lookup): `d.px`, `d.qty`, `d.fee || 0`, `d.t`, `d.found`, `d.status`.
struct Data { px: f64, qty: f64, fee: f64, t: Option<f64>, found: bool, status: String }
impl Data {
    fn empty() -> Data { Data { px: f64::NAN, qty: f64::NAN, fee: 0.0, t: None, found: false, status: String::new() } }
    fn from(v: &Value) -> Data {
        let fee = fnum(v, "fee");
        Data { px: fnum(v, "px"), qty: fnum(v, "qty"), fee: if truthy_num(fee) { fee } else { 0.0 }, t: if is_nullish(v.get("t")) { None } else { Some(fnum(v, "t")) }, found: truthy(v.get("found")), status: txt(v.get("status")) }
    }
}
struct Res { ok: bool, ok_false: bool, unknown: bool, err: Option<Value>, code: Option<Value>, data: Option<Data>, data_nullish: bool }
impl Res {
    fn parse(v: &Value) -> Res {
        let d = v.get("data");
        Res { ok: truthy(v.get("ok")), ok_false: matches!(v.get("ok"), Some(Value::Bool(false))), unknown: truthy(v.get("unknown")), err: v.get("err").cloned(), code: v.get("code").cloned(),
            data: if truthy(d) { d.map(Data::from) } else { None }, data_nullish: is_nullish(d) }
    }
    /// `res.data || {}`
    fn data_or_empty(self) -> Data { self.data.unwrap_or_else(Data::empty) }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the machine
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
#[derive(Clone, Copy)]
struct Fill { px: f64, qty: f64, fee: f64, t: f64 }
enum PaperDone { Undef, None, Row { exit_px: f64, net_bps: Option<Value> } }

struct Pos {
    sys: Option<Value>, pid: Option<Value>, dir_v: Option<Value>, dir: f64, qty: f64, qty_str: Option<String>, t_paper: f64, paper_px: f64, t0: f64, step: f64, stop_bps: f64, tick: f64, notes: Vec<String>,
    entry_cid: Option<String>, entry: Option<Fill>, entry_done: bool, close_asap: Option<String>, closing: Option<bool>, why: Option<String>, exit: Option<Fill>, exit_failed: Option<bool>, exit_cancel_pending: bool,
    tries: Option<f64>, exit_cids: Option<Vec<String>>, close_side: Option<&'static str>, stop_due: f64, stop_px: f64, stop_cid: Option<String>, stop_done: bool, stop_ok: Option<bool>, stop_at: Option<f64>, stop_triggered: Option<bool>,
    paper_done: PaperDone, t_paper_exit: f64, late_ms: f64, interrupted: bool, leftover: bool, close_from_poll: bool, resent: Option<bool>, prev_checked: Option<bool>, prev_miss: Option<f64>, prev_n: Option<f64>,
}
impl Pos {
    fn new(sys: Option<Value>, pid: Option<Value>, dir_v: Option<Value>, dir: f64, qty: f64, t: f64) -> Pos {
        Pos { sys, pid, dir_v, dir, qty, qty_str: None, t_paper: t, paper_px: f64::NAN, t0: t, step: f64::NAN, stop_bps: f64::NAN, tick: f64::NAN, notes: Vec::new(), entry_cid: None, entry: None, entry_done: false, close_asap: None, closing: None, why: None,
            exit: None, exit_failed: None, exit_cancel_pending: false, tries: None, exit_cids: None, close_side: None, stop_due: f64::NAN, stop_px: f64::NAN, stop_cid: None, stop_done: false, stop_ok: None, stop_at: None, stop_triggered: None,
            paper_done: PaperDone::Undef, t_paper_exit: f64::NAN, late_ms: 0.0, interrupted: false, leftover: false, close_from_poll: false, resent: None, prev_checked: None, prev_miss: None, prev_n: None }
    }
    fn note(&mut self, n: &str) { if !self.notes.iter().any(|x| x == n) { self.notes.push(n.to_string()); } }
}
struct Pend { r: Req, due: f64 }
struct Retry { q: Req, at: f64 }

pub struct Machine {
    allowed: bool, st: &'static str, pos: Option<Pos>, started: bool, block_why: String, fault_why: String, killed: bool, seq: u32, n_cid: u32,
    reqs: Vec<Req>, rows: Vec<Ord>, new_faults: Vec<Fault>, faults: Vec<Fault>, pend: BTreeMap<u32, Pend>, late: BTreeMap<u32, Pend>, retry: Vec<Retry>,
}

const NOT_OWN_POSITION: &str = "a position on this asset that is not the page's own";
fn foreign_orders(n: usize) -> String { format!("{n} open order(s) on this asset that are not the page's own") }

impl Machine {
    /// `base`: String(o.base), `is_string`: it was a string. `saved`: {killed, faults} from the page's storage.
    pub fn new(base: &str, is_string: bool, saved: &Value) -> Machine {
        let faults = saved.get("faults").and_then(Value::as_array).map(|a| a.iter().map(|f| Fault { t: fnum(f, "t"), kind: txt(f.get("kind")), text: txt(f.get("text")) }).collect()).unwrap_or_default();
        Machine { allowed: allowed_base(base, is_string), st: "idle", pos: None, started: false, block_why: String::new(), fault_why: String::new(), killed: truthy(saved.get("killed")), seq: 0, n_cid: 0,
            reqs: Vec::new(), rows: Vec::new(), new_faults: Vec::new(), faults, pend: BTreeMap::new(), late: BTreeMap::new(), retry: Vec::new() }
    }
    pub fn allowed(&self) -> bool { self.allowed }
    fn p(&mut self) -> &mut Pos { self.pos.as_mut().expect("a position") }

    /// The one door every request goes through. A machine that is not allowed queues nothing.
    fn send(&mut self, mut r: Req, now: f64) -> u32 {
        if !self.allowed { return 0; }
        self.seq += 1; r.id = self.seq; self.reqs.push(r.clone());
        self.pend.insert(r.id, Pend { r, due: now + REQ_MS });
        self.seq
    }
    fn mk_cid(&mut self, role: &str) -> String {
        let p = self.p();
        let h = match &p.sys { Some(Value::String(s)) if !s.is_empty() => hash36(s), Some(v) if truthy(Some(v)) => hash36(""), _ => hash36("?") };
        let t0 = if truthy_num(p.t0) { p.t0 } else { 0.0 };
        self.n_cid += 1;
        format!("{PREFIX}{h}_{}_{role}{}", radix36(t0), self.n_cid)
    }

    fn fault(&mut self, kind: &str, text: String, now: f64) {
        self.fault2(kind, text, now);
        self.close_now(Some(format!("fault: {kind}")), now);
    }
    fn fault2(&mut self, kind: &str, text: String, now: f64) {
        let f = Fault { t: now, kind: kind.to_string(), text };
        self.faults.push(f.clone()); self.new_faults.push(f); self.fault_why = kind.to_string();
    }
    /// close what is the page's own at market, once; a position still being entered is closed as soon as its fill is known
    fn close_now(&mut self, why: Option<String>, now: f64) {
        let st = self.st;
        let Some(p) = self.pos.as_mut() else { return };
        if p.closing == Some(true) { return; }
        if st == "entering" { p.close_asap = or_s(&p.close_asap, why); return; }
        if p.exit_failed == Some(true) || p.exit.is_some() { return; }
        p.closing = Some(true); p.why = or_s(&p.why, why);
        if st != "settling" { self.st = "exiting"; }
        self.send_exit(now);
    }
    fn send_exit(&mut self, now: f64) {
        let p = self.p();
        let tries = p.tries.unwrap_or(0.0) + 1.0; p.tries = Some(tries);
        if tries == 2.0 {
            p.note("exit retried");      // rule 12: any exit that needed a second attempt
            self.fault2("exit needed more than one attempt", "the first exit order got no answer or was refused".into(), now);
        }
        let cid = self.mk_cid("x");
        let p = self.p(); p.exit_cids.get_or_insert_with(Vec::new).push(cid.clone());
        let side = p.close_side.unwrap_or(if p.dir > 0.0 { "SELL" } else { "BUY" });
        let qty_str = match &p.qty_str { Some(s) if !s.is_empty() => s.clone(), _ => num_str(p.qty) };
        let r = Req::market("x", side, p.qty, qty_str, true, cid);
        self.send(r, now);
    }
    fn fail_entry(&mut self, why: &str, now: f64) {      // nothing is held: the trade stays a paper trade
        self.p().note(why); self.write_row(now, "failed"); self.pos = None; self.st = "idle";
    }

    // ---- the mirror row, written once the real exit is known and the paper trade row has been seen
    fn write_row(&mut self, now: f64, status: &str) {
        let Some(p) = self.pos.as_ref() else { return };
        let tr = match &p.paper_done { PaperDone::Row { exit_px, net_bps } => Some((*exit_px, net_bps.clone())), _ => None };
        let (e, x) = (p.entry, p.exit);
        let demo = e.is_some() && x.is_some() && status == "filled" && tr.is_some();
        let mut o: Vec<(&'static str, V)> = vec![("k", sv("mirror"))];
        push_opt(&mut o, "sys", &p.sys); o.push(("t", nv(now))); push_opt(&mut o, "pid", &p.pid);
        o.push(("status", sv(status))); o.push(("fill", sv(if demo { "demo" } else { "paper" }))); push_opt(&mut o, "dir", &p.dir_v);
        o.push(("notes", V::J(Value::Array(p.notes.iter().map(|n| Value::String(n.clone())).collect()))));
        if let Some(e) = e {
            o.push(("qty", nv(e.qty))); o.push(("entryPx", nv(e.px))); o.push(("entryDelayMs", nv(e.t - p.t_paper)));
            if truthy_num(p.paper_px) { o.push(("entrySlipBps", nv(p.dir * (e.px / p.paper_px - 1.0) * 1e4))); }
        }
        if let Some(x) = x {
            o.push(("exitPx", nv(x.px)));
            o.push(("exitDelayMs", nv(x.t - if truthy_num(p.t_paper_exit) { p.t_paper_exit } else { p.t_paper })));
            if let Some((tpx, _)) = &tr { o.push(("exitSlipBps", nv(-p.dir * (x.px / tpx - 1.0) * 1e4))); }
            if let Some(w) = &p.why { o.push(("exitReason", sv(w))); }
        }
        if let (Some(e), Some(x)) = (e, x) {
            let (fees, notional) = (e.fee + x.fee, e.px * e.qty); let fees_bps = fees / notional * 1e4;
            o.push(("fees", nv(fees))); o.push(("feesBps", nv(fees_bps)));
            o.push(("netBps", nv(p.dir * (x.px / e.px - 1.0) * 1e4 - fees_bps)));
            match &tr { Some((_, n)) => { if let Some(n) = n { o.push(("paperNetBps", V::J(n.clone()))); } } None => o.push(("paperNetBps", V::J(Value::Null))) }
        }
        if truthy_num(p.late_ms) { o.push(("lateMs", nv(p.late_ms))); }
        self.rows.push(Ord(o));
    }
    fn try_finalize(&mut self, now: f64) {
        let Some(p) = self.pos.as_ref() else { return };
        if p.exit.is_none() || matches!(p.paper_done, PaperDone::Undef) || p.exit_cancel_pending { return; }
        let status = if p.entry.is_none() && !p.leftover { "failed" } else if p.leftover || p.interrupted || matches!(p.paper_done, PaperDone::None) { "interrupted" } else { "filled" };
        self.write_row(now, status); self.pos = None; self.st = "idle";
    }

    // ---- entries
    fn on_enter(&mut self, row: &Value, now: f64, g: &Value) {
        let (sys, pid, dir_v) = (row.get("sys").cloned(), row.get("pid").cloned(), row.get("dir").cloned());
        let refuse = |m: &mut Machine, why: &str| {
            let mut o: Vec<(&'static str, V)> = vec![("k", sv("mirror"))];
            push_opt(&mut o, "sys", &sys); o.push(("t", nv(now))); push_opt(&mut o, "pid", &pid); o.push(("status", sv("paper"))); o.push(("fill", sv("paper"))); push_opt(&mut o, "dir", &dir_v);
            o.push(("notes", V::J(Value::Array(vec![Value::String(why.to_string())]))));
            m.rows.push(Ord(o));
        };
        if !self.allowed { return refuse(self, "not the demo account"); }
        if !self.started { return refuse(self, "execution not started"); }
        if self.killed { return refuse(self, "kill switch"); }
        if !self.fault_why.is_empty() { return refuse(self, "fault not cleared"); }
        if !self.block_why.is_empty() { let w = format!("blocked: {}", self.block_why); return refuse(self, &w); }
        if matches!(g.get("readOk"), Some(Value::Bool(false))) { return refuse(self, "cannot read the exchange"); }
        if self.pos.is_some() { return refuse(self, "account busy"); }
        let qa = g.get("quoteAgeMs");
        if !(!is_nullish(qa) && to_number(qa) <= QUOTE_MS) { return refuse(self, "no Binance quote for 3 s"); }
        let off = g.get("offsetMs");
        if !(!is_nullish(off) && to_number(off).abs() <= OFFSET_MS) { return refuse(self, "clock offset over 1 s"); }
        if !matches!(g.get("oneWay"), Some(Value::Bool(true))) { return refuse(self, "not one-way position mode"); }
        let (rqty, rpx, step) = (fnum(row, "qty"), fnum(row, "px"), fnum(g, "step"));
        let raw = jmin(rqty, CAP_USD / rpx);
        let capped = rqty * rpx > CAP_USD;
        let qty = floor_step(raw, step);
        if !(qty >= fnum(g, "minQty")) || (truthy(g.get("minNotional")) && qty * rpx < fnum(g, "minNotional")) { return refuse(self, "below the exchange minimum"); }
        let (dir, t) = (fnum(row, "dir"), fnum(row, "t"));
        let mut p = Pos::new(sys, pid, dir_v, dir, qty, t);
        p.qty_str = Some(to_str(qty, step)); p.paper_px = rpx; p.step = step; p.stop_bps = fnum(row, "stopBps"); p.tick = fnum(g, "tick");
        if capped { p.note("capped"); }
        let (qs, side) = (p.qty_str.clone().unwrap_or_default(), if p.dir > 0.0 { "BUY" } else { "SELL" });
        self.pos = Some(p); self.st = "entering";
        let cid = self.mk_cid("e"); self.p().entry_cid = Some(cid.clone());
        self.send(Req::market("e", side, qty, qs, false, cid), now);
    }
    fn got_entry(&mut self, d: Option<&Data>, now: f64) {
        let p = self.pos.as_mut().expect("a position");
        if p.entry_done { return; }
        p.entry_done = true;
        let Some(d) = d.filter(|d| d.qty > 0.0) else { return self.fail_entry("entry not filled", now) };
        let p = self.pos.as_mut().expect("a position");
        if d.qty < p.qty - 1e-12 { p.note("partial fill"); }
        p.entry = Some(Fill { px: d.px, qty: d.qty, fee: d.fee, t: d.t.unwrap_or(now) }); p.qty = d.qty; p.qty_str = Some(to_str(d.qty, p.step));
        if truthy_s(&p.close_asap) {
            let why = p.close_asap.clone(); p.closing = Some(false); self.st = "holding";
            return self.close_now(why, now);
        }
        p.stop_due = now + STOP_MS; self.st = "stopping";
        let px = d.px;
        let sp = if p.dir > 0.0 { px * (1.0 - p.stop_bps / 1e4) } else { px * (1.0 + p.stop_bps / 1e4) };
        let tick = if truthy_num(p.tick) { p.tick } else { 0.01 };
        p.stop_px = js_round(sp / tick) * tick;
        let (qty, qs, side, sp_, sstr) = (p.qty, p.qty_str.clone().unwrap_or_default(), if p.dir > 0.0 { "SELL" } else { "BUY" }, p.stop_px, to_fixed(p.stop_px, dec_of(tick)));
        let cid = self.mk_cid("s"); self.p().stop_cid = Some(cid.clone());
        self.send(Req { side, qty, qty_str: qs, stop_px: sp_, stop_str: sstr, cid: Some(cid), ..Req::blank("stop", "s") }, now);
    }
    fn got_stop(&mut self, now: f64) {
        let p = self.pos.as_mut().expect("a position");
        if p.stop_done { return; }
        p.stop_done = true; p.stop_ok = Some(true); p.stop_at = Some(now);
        let late = p.closing == Some(true) || p.exit.is_some();
        if self.st == "stopping" { self.st = "holding"; }
        if late { self.cancel_stop(now); }      // a stop that was confirmed late, after the position was already being closed
    }
    fn stop_failed(&mut self, text: String, now: f64) {
        let p = self.p();
        if p.stop_done { return; }
        p.stop_done = true; p.note("stop rejected");
        self.fault("stop rejected", text, now);
    }
    fn cancel_stop(&mut self, now: f64) {
        let p = self.p();
        let Some(c) = p.stop_cid.clone().filter(|c| !c.is_empty()) else { return };
        p.exit_cancel_pending = true;
        self.send(Req::cancel(Some(c), true, false), now);
    }
    fn got_exit(&mut self, d: &Data, now: f64) {
        let p = self.p();
        if p.exit.is_some() { return; }
        p.exit = Some(Fill { px: d.px, qty: d.qty, fee: d.fee, t: d.t.unwrap_or(now) });
        if truthy_s(&p.stop_cid) && p.stop_triggered != Some(true) { self.cancel_stop(now); }      // also when the stop answer never came: the cancel of an order that is not there is tolerated (gone())
        self.try_finalize(now);
    }

    // ---- an answer
    /// Returns an error only where the JS would throw a TypeError: a successful answer to an exit with no `data` at all.
    pub fn reply(&mut self, id: u32, res: &Value, now: f64) -> Result<(), String> {
        if let Some(p) = self.pend.get(&id) { if p.r.op == "lookup" && p.r.role == "k" { let p = self.pend.remove(&id).expect("pending"); self.settle_reply(p, res, now); return Ok(()); } }
        let (p, was_late) = if let Some(p) = self.pend.remove(&id) { (p, false) } else if let Some(p) = self.late.remove(&id) { (p, true) } else { return Ok(()) };
        let (r, role) = (p.r.clone(), p.r.role);
        if r.op == "lookup" { self.lookup_reply(&r, res, now); return Ok(()); }
        let rs = Res::parse(res);
        if rs.ok_false && rs.unknown { let r2 = p.r.clone(); self.late.insert(id, p); self.unknown(&r2, now); return Ok(()); }
        if was_late && self.pos.is_none() { return Ok(()); }
        match role {
            "e" => {
                if self.pos.as_ref().map_or(true, |p| p.entry_done) { return Ok(()); }
                if rs.ok { self.got_entry(rs.data.as_ref(), now); } else { self.fail_entry(&format!("entry rejected: {}", txt(rs.err.as_ref())), now); }
            }
            "s" => {
                if self.pos.is_none() { if rs.ok { self.send(Req::cancel(r.cid.clone(), true, true), now); } return Ok(()); }
                if rs.ok { self.got_stop(now); } else { self.stop_failed(txt(rs.err.as_ref()), now); }
            }
            "x" => {
                if self.pos.is_none() { return Ok(()); }
                if rs.ok {
                    if rs.data_nullish && self.pos.as_ref().map_or(false, |p| p.exit.is_none()) { return Err("Cannot read properties of undefined (reading 'px')".into()); }
                    let d = rs.data_or_empty(); self.got_exit(&d, now); return Ok(());
                }
                // the exchange said no: with no position left (reduce-only refused) the stop probably fired; the next poll tells. Otherwise try again, up to the limit.
                let tries = self.p().tries.unwrap_or(f64::NAN);
                if tries >= EXIT_TRIES { self.p().exit_failed = Some(true); self.st = "stuck"; self.fault("exit failed", txt(rs.err.as_ref()), now); return Ok(()); }
                let p = self.p();
                if to_string(rs.err.as_ref()).contains("-2022") && tries > 1.0 && p.prev_checked != Some(true) {      // refused as reduce-only with nothing to reduce: an earlier attempt probably did fill, its answer was lost. Look each one up by client id.
                    p.prev_checked = Some(true); p.prev_miss = Some(0.0);
                    let all = p.exit_cids.clone().unwrap_or_default(); let prev = &all[..all.len().saturating_sub(1)]; p.prev_n = Some(prev.len() as f64);
                    for c in prev { self.send(Req::lookup("x", Some(c.clone()), false, Orig::Role("x"), now, true), now); }
                    return Ok(());
                }
                self.send_exit(now);
            }
            "c" => {
                if r.recon || self.pos.is_none() { return Ok(()); }
                if !rs.ok && !gone(&rs) { self.fault2("unknown order state", format!("cancel of the stop: {}", txt(rs.err.as_ref())), now); }
                self.p().exit_cancel_pending = false; self.try_finalize(now);
            }
            _ => {}
        }
        Ok(())
    }
    /// no answer (timeout, dropped): ask the exchange by client id; a state still unknown after 5 s is a fault
    fn unknown(&mut self, r: &Req, now: f64) {
        if r.op == "lookup" { self.retry.push(Retry { q: r.clone(), at: now }); return; }      // a lookup that got no answer continues the same 5 s clock (its own since), it does not start a new one
        if r.role == "c" {
            if self.pos.is_some() { self.fault2("unknown order state", "cancel of the stop timed out".into(), now); self.p().exit_cancel_pending = false; self.try_finalize(now); }
            return;
        }
        let q = Req::lookup(r.role, r.cid.clone(), r.role == "s", Orig::Full(Box::new(r.clone())), now, false);
        self.send(q, now);
    }
    fn lookup_reply(&mut self, q: &Req, res: &Value, now: f64) {
        let rs = Res::parse(res);
        if !rs.ok || rs.unknown { self.retry.push(Retry { q: q.clone(), at: now + RETRY_MS }); return; }
        let d = rs.data_or_empty();
        let st_has = |re: &[&str]| { let s = d.status.to_ascii_uppercase(); re.iter().any(|w| s.contains(w)) };
        match q.role {
            "e" => {
                if self.pos.as_ref().map_or(true, |p| p.entry_done) { return; }
                if d.found && d.qty > 0.0 { return self.got_entry(Some(&d), now); }
                if d.found && st_has(&["NEW", "PARTIAL"]) && !st_has(&["EXPIRED", "CANCEL", "REJECT"]) { self.retry.push(Retry { q: q.clone(), at: now + RETRY_MS }); return; }
                self.fail_entry("entry not found on the exchange", now);
            }
            "s" => {
                if self.pos.as_ref().map_or(true, |p| p.stop_done) { return; }
                if d.found && !st_has(&["CANCEL", "REJECT", "EXPIRED"]) { return self.got_stop(now); }
                self.stop_failed("stop not found on the exchange".into(), now);
            }
            "x" => {
                if self.pos.as_ref().map_or(true, |p| p.exit.is_some()) { return; }
                if d.found && d.qty > 0.0 { return self.got_exit(&d, now); }
                if q.prev {
                    let p = self.p(); let miss = p.prev_miss.unwrap_or(f64::NAN) + 1.0; p.prev_miss = Some(miss);
                    if miss >= p.prev_n.unwrap_or(f64::NAN) {
                        if truthy_s(&p.stop_cid) && p.stop_ok == Some(true) && p.stop_triggered != Some(true) { self.stop_fired(now); return; }
                        self.fault2("unknown order state", "the exit was refused as reduce-only and no earlier exit order was found".into(), now);
                        let p = self.p(); if matches!(p.paper_done, PaperDone::Undef) { p.paper_done = PaperDone::None; }
                        self.write_row(now, "failed"); self.pos = None; self.st = "idle";
                    }
                    return;
                }
                self.send_exit(now);      // never reached the exchange
            }
            _ => {}
        }
    }
    pub fn tick(&mut self, now: f64) {
        let due: Vec<u32> = self.pend.iter().filter(|(_, p)| p.due <= now).map(|(id, _)| *id).collect();
        for id in due { if let Some(p) = self.pend.remove(&id) { let r = p.r.clone(); self.late.insert(id, p); self.unknown(&r, now); } }
        let mut i = self.retry.len();
        while i > 0 {
            i -= 1;
            if i >= self.retry.len() || self.retry[i].at > now { continue; }
            let x = self.retry.remove(i);
            if now - x.q.since > UNKNOWN_MS {
                if self.pos.is_some() {
                    let p = self.p();
                    if x.q.prev { p.prev_checked = Some(false); }
                    if x.q.role == "k" { p.stop_triggered = Some(false); }
                    self.fault2("unknown order state", format!("order {} still unknown after 5 s", x.q.of.clone().unwrap_or_else(|| "undefined".into())), now);
                    let p = self.p();
                    if x.q.role == "x" && !x.q.prev && p.exit.is_none() && p.resent != Some(true) && p.tries.unwrap_or(f64::NAN) < EXIT_TRIES { p.resent = Some(true); self.send_exit(now); } else { self.close_after_unknown(now); }      // an exit that stayed unknown is sent again once (reduce-only: it cannot double-close)
                }
                continue;
            }
            self.send(x.q.clone(), now);
        }
        if let Some(p) = self.pos.as_ref() { if self.st == "stopping" && !p.stop_done && now >= p.stop_due { self.p().stop_done = false; self.stop_late(now); } }
    }
    fn stop_fired(&mut self, now: f64) {      // flat on the exchange and no exit order of ours found: the resting stop must have fired. Its fill is the real exit.
        let p = self.p();
        p.stop_triggered = Some(true);
        let keep = truthy_s(&p.why) && p.why.as_deref().map_or(false, |w| ["time", "stop", "invalidate", "end", "gap"].iter().any(|k| w.starts_with(k)));
        p.why = if keep { p.why.clone() } else { or_s(&p.why, Some("stop (exchange)".into())) };
        p.note("stop fired on the exchange");
        let of = p.stop_cid.clone();
        self.send(Req::lookup("k", of, true, Orig::Role("k"), now, false), now);
    }
    fn exit_busy(&self) -> bool { self.pend.values().any(|q| q.r.role == "x") || self.retry.iter().any(|x| x.q.role == "x") }
    fn close_after_unknown(&mut self, now: f64) {      // no fill is known: the next poll says what is held
        let Some(p) = self.pos.as_mut() else { return };
        if p.entry.is_some() && p.closing != Some(true) { self.close_now(Some("unknown order state".into()), now); }
        else if p.entry.is_none() { p.close_from_poll = true; p.why = Some("unknown order state".into()); }
    }
    fn stop_late(&mut self, now: f64) {
        let p = self.p();
        if p.closing == Some(true) { return; }
        p.note("stop rejected"); self.fault("stop rejected or late", "no confirmation within 3 s".into(), now);
    }

    // ---- the exchange as it is now (start: once; poll: every few seconds)
    pub fn start(&mut self, x: &Value, now: f64, extra: &Value) {
        if !self.allowed { return; }
        self.started = true; self.reconcile(x, now, true, extra);
    }
    pub fn poll(&mut self, x: &Value, now: f64) { if self.started { self.reconcile(x, now, false, &Value::Null); } }
    fn reconcile(&mut self, x: &Value, now: f64, at_start: bool, extra: &Value) {
        let net = x.get("positions").and_then(Value::as_array).map_or(0.0, |a| a.iter().fold(0.0, |s, v| s + to_number(Some(v))));
        let (mut own, mut foreign): (Vec<(String, bool)>, usize) = (Vec::new(), 0);
        if let Some(a) = x.get("orders").and_then(Value::as_array) {
            for k in a { match k.get("cid") { Some(Value::String(c)) if !c.is_empty() && c.starts_with(PREFIX) => own.push((c.clone(), truthy(k.get("algo")))), _ => foreign += 1 } }
        }
        if at_start {
            if net.abs() > 0.0 {
                let own_pos = !own.is_empty() || truthy(extra.get("savedOpen"));
                if !own_pos { self.block_why = NOT_OWN_POSITION.into(); self.fault2("foreign position found", NOT_OWN_POSITION.into(), now); return; }
                for (c, a) in &own { self.send(Req::cancel(Some(c.clone()), *a, true), now); }
                let sys = if truthy(extra.get("savedSys")) { extra.get("savedSys").cloned() } else { Some(Value::String("?".into())) };
                let dir = if net > 0.0 { 1.0 } else { -1.0 };
                let mut p = Pos::new(sys, Some(Value::String(format!("leftover:{}", num_str(now)))), Some(nj(dir)), dir, net.abs(), now);
                p.qty_str = Some(num_str(net.abs())); p.notes = vec!["leftover own position".into()]; p.leftover = true; p.interrupted = true; p.paper_done = PaperDone::None; p.why = Some("interrupted".into());
                p.entry_done = true; p.stop_done = true; p.closing = Some(true); p.tries = Some(0.0);
                self.pos = Some(p); self.st = "exiting";
                self.fault2("leftover own position found at start", format!("position {} with {} own order(s)", num_str(net), own.len()), now); self.send_exit(now); return;
            }
            for (c, a) in &own { self.send(Req::cancel(Some(c.clone()), *a, true), now); }
        }
        if self.pos.is_none() {      // nothing of ours is open: a foreign position or order blocks; it clears when it is gone
            if net.abs() > 0.0 && !at_start {
                if self.block_why.is_empty() { self.fault2("foreign position found", format!("position {}", num_str(net)), now); }
                self.block_why = NOT_OWN_POSITION.into();
            } else if foreign > 0 { self.block_why = foreign_orders(foreign); } else { self.block_why.clear(); }
            return;
        }
        if foreign > 0 { self.block_why = foreign_orders(foreign); } else if !self.block_why.is_empty() && !self.block_why.contains("position") { self.block_why.clear(); }
        if self.p().close_from_poll {      // an entry whose state stayed unknown: close what the exchange shows, cancel what is ours
            self.p().close_from_poll = false;
            for (c, a) in &own { self.send(Req::cancel(Some(c.clone()), *a, true), now); }
            if net.abs() < 1e-12 { self.write_row(now, "failed"); self.pos = None; self.st = "idle"; return; }
            let p = self.p();
            p.dir = if net > 0.0 { 1.0 } else { -1.0 }; p.dir_v = Some(nj(p.dir)); p.qty = net.abs();
            let step = if truthy_num(p.step) { p.step } else { 0.001 }; p.qty_str = Some(to_str(p.qty, step));
            p.closing = Some(true); p.entry_done = true; p.stop_done = true; if matches!(p.paper_done, PaperDone::Undef) { p.paper_done = PaperDone::None; }
            self.st = "exiting"; self.send_exit(now); return;
        }
        let (closing, has_exit, exit_failed) = { let p = self.p(); (p.closing == Some(true), p.exit.is_some(), p.exit_failed == Some(true)) };
        if closing && !has_exit && !exit_failed && (self.st == "exiting" || self.st == "stuck") && !self.exit_busy() {      // an exit that stalled (the exchange or the network was down for longer than the retries): the poll takes it up again
            let p = self.p();
            let has_cids = p.exit_cids.as_ref().map_or(false, |v| !v.is_empty());
            if net.abs() > 1e-12 {
                if p.tries.unwrap_or(f64::NAN) < 6.0 { p.resent = Some(false); self.send_exit(now); }
                else { p.exit_failed = Some(true); self.st = "stuck"; self.fault2("exit failed", "six exit attempts, the position is still open".into(), now); }
            } else if truthy_s(&p.stop_cid) && p.stop_ok == Some(true) && p.stop_triggered != Some(true) && !(has_cids && p.prev_checked != Some(true)) { self.stop_fired(now); }
            else if has_cids && p.prev_checked != Some(true) {
                p.prev_checked = Some(true); p.prev_miss = Some(0.0); let cids = p.exit_cids.clone().unwrap_or_default(); p.prev_n = Some(cids.len() as f64);
                for c in cids { self.send(Req::lookup("x", Some(c), false, Orig::Role("x"), now, true), now); }
            }
            return;
        }
        if self.st == "holding" {
            let p = self.pos.as_mut().expect("a position");
            if net.abs() < 1e-12 {      // flat: the exchange stop fired before the paper exit
                self.st = "settling"; p.stop_triggered = Some(true); p.why = or_s(&p.why, Some("stop (exchange)".into())); p.note("stop fired on the exchange");
                let of = p.stop_cid.clone();
                self.send(Req::lookup("k", of, true, Orig::Role("k"), now, false), now); return;
            }
            if sign(net) != p.dir || (net.abs() - p.qty).abs() > jmax(1e-9, p.qty * 1e-6) {
                let was = p.dir * p.qty; p.qty = net.abs(); let step = if truthy_num(p.step) { p.step } else { 0.001 }; p.qty_str = Some(to_str(p.qty, step)); p.close_side = Some(if net > 0.0 { "SELL" } else { "BUY" });
                self.fault("position differs from what the page believes", format!("page {}, exchange {}", num_str(was), num_str(net)), now); return;
            }
            let t = fnum(x, "t");
            if p.stop_ok == Some(true) && p.stop_at.is_some() && t > p.stop_at.unwrap_or(f64::NAN) + 1500.0 && !own.iter().any(|(c, _)| Some(c) == p.stop_cid.as_ref()) {
                self.fault("position differs from what the page believes", "the stop order is not on the exchange".into(), now);
            }
        }
    }
    /// lookup of the fired stop (role "k"): its fill is the real exit
    fn settle_reply(&mut self, p: Pend, res: &Value, now: f64) {
        if self.pos.is_none() { return; }
        let rs = Res::parse(res);
        let ok = rs.ok; let d = rs.data_or_empty();
        if ok && d.found && d.qty > 0.0 { self.p().stop_ok = Some(false); self.got_exit(&d, now); return; }
        self.retry.push(Retry { q: p.r, at: now + RETRY_MS });
    }

    // ---- the journal rows of the runner
    pub fn on_row(&mut self, row: &Value, now: f64, g: &Value) {
        let k = row.get("k").and_then(Value::as_str).unwrap_or("");
        if k == "enter" && row.get("stage").and_then(Value::as_str) == Some("demo") { return self.on_enter(row, now, g); }
        let pid = row.get("pid").cloned();
        if k == "trade" {
            if self.pos.as_ref().map_or(false, |p| strict_eq(&pid, &p.pid)) {
                let interrupted = truthy(row.get("interrupted"));
                self.p().paper_done = if interrupted { PaperDone::None } else { PaperDone::Row { exit_px: fnum(row, "exitPx"), net_bps: row.get("netBps").cloned() } };
                if interrupted { self.p().interrupted = true; self.close_now(Some("interrupted".into()), now); }
                self.try_finalize(now);
            }
            return;
        }
        if (k == "exit" || k == "invalidate") && self.pos.as_ref().map_or(false, |p| strict_eq(&pid, &p.pid)) {
            let reason = row.get("reason").and_then(Value::as_str).map(str::to_string);
            let t = fnum(row, "t");
            let p = self.p();
            p.t_paper_exit = t; let l = now - t; if l > LATE_MS { p.late_ms = l; p.note("late exit"); }
            p.why = or_s(&p.why, reason.clone());
            self.close_now(reason, now);
        }
    }
    pub fn kill(&mut self, now: f64) { self.killed = true; if self.pos.is_some() { self.close_now(Some("kill switch".into()), now); } }
    pub fn unkill(&mut self) { self.killed = false; }
    pub fn clear_fault(&mut self) { self.fault_why.clear(); }
    pub fn drain(&mut self) -> Drained { Drained { reqs: std::mem::take(&mut self.reqs), rows: std::mem::take(&mut self.rows), faults: std::mem::take(&mut self.new_faults) } }
    pub fn state(&self) -> Ord {
        let s = if !self.allowed || !self.started { "off" } else if self.killed { "killed" } else if !self.fault_why.is_empty() { "fault" } else if !self.block_why.is_empty() { "blocked" } else if self.pos.is_some() { "holding" } else { "ready" };
        let why = if !self.allowed { "not the demo account".to_string() } else if !self.started { "not started".into() } else if self.killed { "kill switch on".into() } else if !self.fault_why.is_empty() { self.fault_why.clone() } else { self.block_why.clone() };
        let pos = match &self.pos {
            None => V::J(Value::Null),
            Some(p) => { let mut o = Vec::new(); push_opt(&mut o, "sys", &p.sys); push_opt(&mut o, "pid", &p.pid); push_opt(&mut o, "dir", &p.dir_v); o.push(("qty", nv(p.qty))); o.push(("phase", sv(self.st))); V::O(Ord(o)) }
        };
        Ord(vec![("state", sv(s)), ("why", V::J(Value::String(why))), ("phase", sv(self.st)), ("faults", V::J(Value::from(self.faults.len()))), ("pos", pos), ("killed", V::J(Value::Bool(self.killed)))])
    }
    /// what to keep across a reload (the page stores it): the kill switch, the fault log, and whether a position was open
    pub fn snapshot(&self) -> Ord {
        let open = match &self.pos { None => V::J(Value::Null), Some(p) => { let mut o = Vec::new(); push_opt(&mut o, "sys", &p.sys); push_opt(&mut o, "pid", &p.pid); V::O(Ord(o)) } };
        Ord(vec![("killed", V::J(Value::Bool(self.killed))), ("faults", V::F(self.faults_list())), ("open", open)])
    }
    pub fn faults_list(&self) -> Vec<Fault> { self.faults.clone() }
    pub fn debug(&self) -> Ord {
        let role = |r: &Req| format!("{}:{}", r.op, r.role);
        let pos = match &self.pos {
            None => V::J(Value::Null),
            Some(p) => {
                let mut o: Vec<(&'static str, V)> = Vec::new();
                if let Some(t) = p.tries { o.push(("tries", nv(t))); }
                if let Some(b) = p.prev_checked { o.push(("prevChecked", V::J(Value::Bool(b)))); }
                if let Some(b) = p.prev_miss { o.push(("prevMiss", nv(b))); }
                if let Some(b) = p.prev_n { o.push(("prevN", nv(b))); }
                if let Some(b) = p.closing { o.push(("closing", V::J(Value::Bool(b)))); }
                o.push(("exit", V::J(Value::Bool(p.exit.is_some()))));
                if let Some(b) = p.stop_ok { o.push(("stopOk", V::J(Value::Bool(b)))); }
                if let Some(b) = p.stop_triggered { o.push(("stopTriggered", V::J(Value::Bool(b)))); }
                if let Some(c) = &p.exit_cids { o.push(("exitCids", V::J(Value::from(c.len())))); }
                if let Some(b) = p.resent { o.push(("resent", V::J(Value::Bool(b)))); }
                if let Some(b) = p.exit_failed { o.push(("exitFailed", V::J(Value::Bool(b)))); }
                V::O(Ord(o))
            }
        };
        Ord(vec![("pend", V::J(Value::Array(self.pend.values().map(|q| Value::String(role(&q.r))).collect()))),
                 ("retry", V::J(Value::Array(self.retry.iter().map(|x| Value::String(role(&x.q) + if x.q.prev { ":prev" } else { "" })).collect()))), ("pos", pos)])
    }
}
pub struct Drained { pub reqs: Vec<Req>, pub rows: Vec<Ord>, pub faults: Vec<Fault> }
impl Serialize for Drained {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(3))?;
        m.serialize_entry("reqs", &self.reqs)?; m.serialize_entry("rows", &self.rows)?; m.serialize_entry("faults", &self.faults)?;
        m.end()
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn guard_accepts_only_the_demo_host_and_the_local_proxy() {
        for ok in ["https://demo-fapi.binance.com", "http://127.0.0.1:8787", "http://localhost:9000", "http://localhost:80", "http://127.0.0.1:65535", "http://127.0.0.1:00"] {
            assert!(is_demo_base(ok, true), "{ok}");
        }
        let bad = [
            "https://fapi.binance.com", "http://fapi.binance.com", "https://testnet.binancefuture.com", "https://demo-fapi.binance.com.evil.example", "https://demo-fapi.binance.com@evil.example", "https://demo-fapi.binance.com:443",
            "https://demo-fapi.binance.com/", "https://demo-fapi.binance.com.", "http://demo-fapi.binance.com", "HTTPS://demo-fapi.binance.com", "https://DEMO-FAPI.binance.com", "https://demo-fapi.binance.com@fapi.binance.com", "https://evil@demo-fapi.binance.com",
            "https://evil.example#demo-fapi.binance.com", "https://evil.example/?https://demo-fapi.binance.com", " https://demo-fapi.binance.com", "https://demo-fapi.binance.com ", "https://demo-fapi.binance.com\n", "https://demo-fapi.binance.com\u{200b}",
            "https://demo\u{2011}fapi.binance.com", "https://demo-fapi.binance.com@evil.example", "", "undefined", "null", r"https://demo-fapi.binance.com@evil.example",
            "http://127.0.0.1.evil.example:8787", "http://localhost:8787/x", "https://127.0.0.1:8787", "http://127.0.0.1", "http://127.0.0.1:", "http://127.0.0.1:1", "http://127.0.0.1:123456", "http://127.0.0.1:87a7", "http://127.0.0.1:8787\n", "http://127.0.0.1:８７８７",
            "http://evil.example/http://127.0.0.1:8787", "http://127.0.0.1@evil.example:8787", "http://evil@127.0.0.1:8787", "http://127.0.0.1:8787@evil.example:80", "http://localhost.:8787", "http://LOCALHOST:8787", "http://Localhost:8787", "http://127.0.0.1.:8787",
            "http://localhost:8787.evil.example", "http://0.0.0.0:8787", "http://[::1]:8787", "http://127.1:8787", "http://2130706433:8787", "http://localhost.evil.example:8787", "https://fapi.binance.com.local:8787", "ftp://127.0.0.1:8787", "//127.0.0.1:8787",
        ];
        for b in bad { assert!(!is_demo_base(b, true), "{b:?}"); assert!(!allowed_base(b, true), "{b:?}"); }
        // a value that was not a string equals the host only as text through the proxy rule, never as the host
        assert!(!is_demo_base(DEMO_BASE, false));
        assert!(!is_demo_base(LIVE_BASE, true) && !allowed_base(LIVE_BASE, true) && !allowed_base(LIVE_BASE, false));
        assert!(!ALLOW_LIVE);
    }

    fn enter() -> Value { json!({"k": "enter", "sys": "A", "t": 1000, "pid": "A:1000", "dir": 1, "px": 100, "qty": 1, "stopBps": 50, "stage": "demo"}) }
    fn guards() -> Value { json!({"quoteAgeMs": 100, "offsetMs": 10, "oneWay": true, "step": 0.001, "tick": 0.1, "minQty": 0.001, "minNotional": 5}) }

    #[test]
    fn a_machine_that_is_not_allowed_never_produces_a_request() {
        for base in ["https://fapi.binance.com", "https://demo-fapi.binance.com.evil.example", "https://demo-fapi.binance.com@evil.example", "http://127.0.0.1", "undefined"] {
            let mut m = Machine::new(base, true, &json!({}));
            assert!(!m.allowed());
            m.start(&json!({"t": 1, "positions": [0.4], "orders": [{"cid": "svx_a_1_s1", "algo": true}]}), 1000.0, &json!({"savedOpen": true, "savedSys": "A"}));
            m.on_row(&enter(), 1000.0, &guards());
            m.kill(1100.0); m.tick(20000.0); m.poll(&json!({"t": 2, "positions": [], "orders": []}), 21000.0);
            let d = m.drain();
            assert!(d.reqs.is_empty(), "{base}");
            assert_eq!(d.rows.len(), 1);
            assert_eq!(serde_json::to_value(&d.rows[0]).unwrap()["notes"][0], "not the demo account");
            let s = serde_json::to_value(m.state()).unwrap();
            assert_eq!(s["state"], "off"); assert_eq!(s["why"], "not the demo account");
        }
        // send itself refuses even when something upstream were wrong
        let mut m = Machine::new("https://fapi.binance.com", true, &json!({}));
        assert_eq!(m.send(Req::cancel(Some("x".into()), true, false), 0.0), 0);
        assert!(m.reqs.is_empty() && m.pend.is_empty());
    }

    #[test]
    fn the_demo_machine_enters_with_a_market_order_then_a_stop() {
        let mut m = Machine::new(DEMO_BASE, true, &json!({}));
        m.start(&json!({"t": 1, "positions": [], "orders": []}), 1000.0, &json!({}));
        m.on_row(&enter(), 1000.0, &guards());
        let d = serde_json::to_value(m.drain()).unwrap();
        assert_eq!(d["reqs"][0]["op"], "market"); assert_eq!(d["reqs"][0]["reduce"], false); assert_eq!(d["reqs"][0]["qtyStr"], "1.000"); assert_eq!(d["reqs"][0]["id"], 1);
        m.reply(1, &json!({"ok": true, "data": {"px": 100.05, "qty": 1, "fee": 0.05, "t": 1050, "status": "FILLED"}}), 1050.0).unwrap();
        let d = serde_json::to_value(m.drain()).unwrap();
        assert_eq!(d["reqs"][0]["op"], "stop"); assert_eq!(d["reqs"][0]["side"], "SELL");
    }

    #[test]
    fn to_fixed_matches_js() {
        assert_eq!(to_fixed(0.5, 0), "1"); assert_eq!(to_fixed(2.5, 0), "3"); assert_eq!(to_fixed(0.125, 2), "0.13"); assert_eq!(to_fixed(1.005, 2), "1.00"); assert_eq!(to_fixed(-0.0001, 2), "-0.00");
        assert_eq!(to_fixed(-0.0, 2), "0.00"); assert_eq!(to_fixed(9.5, 0), "10"); assert_eq!(to_fixed(99.5, 0), "100"); assert_eq!(to_fixed(0.0005, 3), "0.001"); assert_eq!(to_fixed(1e21, 2), "1e+21");
        assert_eq!(dec_of(0.001), 3); assert_eq!(dec_of(1e-7), 7); assert_eq!(dec_of(5.0), 0); assert_eq!(radix36(1700000000000.0), "loyw3v28");
    }
}
