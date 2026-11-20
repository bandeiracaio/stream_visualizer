//! JSON text written in the key order the JS objects have (JSON.stringify follows insertion order), and the JS number-to-text helpers the readings use.
use sv_core::js::{num_str, to_fixed};
use sv_core::js_round;

/// A JSON writer: `{`/`[` open, keys and values in order, commas handled here. Numbers: NaN and +/-Infinity are written as null (as JSON.stringify does).
pub struct W { pub s: String, fresh: bool }
impl Default for W { fn default() -> Self { W { s: String::with_capacity(256), fresh: true } } }
impl W {
    fn pre(&mut self) { if !self.fresh { self.s.push(','); } self.fresh = false; }
    pub fn open(&mut self, c: char) { self.pre(); self.s.push(c); self.fresh = true; }
    pub fn close(&mut self, c: char) { self.s.push(c); self.fresh = false; }
    pub fn key(&mut self, k: &str) {
        self.pre();
        if k.bytes().all(|c| c >= 0x20 && c != b'"' && c != b'\\') { self.s.push('"'); self.s.push_str(k); self.s.push('"'); } else { self.s.push_str(&serde_json::to_string(k).unwrap_or_default()); }      // a cfg horizon name can be anything
        self.s.push(':'); self.fresh = true;
    }
    pub fn num(&mut self, x: f64) {
        self.pre();
        if !x.is_finite() { self.s.push_str("null"); }
        else if x == x.trunc() && x.abs() < 1e15 { if x == 0.0 && x.is_sign_negative() { self.s.push_str("-0.0"); } else { self.s.push_str(&format!("{}", x as i64)); } }
        else { self.s.push_str(&serde_json::to_string(&x).unwrap_or_else(|_| "null".into())); }
    }
    pub fn opt(&mut self, x: Option<f64>) { match x { Some(v) => self.num(v), None => self.null() } }
    pub fn null(&mut self) { self.pre(); self.s.push_str("null"); }
    pub fn bool(&mut self, b: bool) { self.pre(); self.s.push_str(if b { "true" } else { "false" }); }
    pub fn str(&mut self, x: &str) { self.pre(); self.s.push_str(&serde_json::to_string(x).unwrap_or_default()); }
    pub fn ostr(&mut self, x: Option<&str>) { match x { Some(v) => self.str(v), None => self.null() } }
    /// a value already written as JSON text
    pub fn raw(&mut self, x: &str) { self.pre(); self.s.push_str(x); }
    pub fn kn(&mut self, k: &str, x: f64) { self.key(k); self.num(x); }
    pub fn ko(&mut self, k: &str, x: Option<f64>) { self.key(k); self.opt(x); }
    pub fn ks(&mut self, k: &str, x: &str) { self.key(k); self.str(x); }
    pub fn kos(&mut self, k: &str, x: Option<&str>) { self.key(k); self.ostr(x); }
    pub fn kb(&mut self, k: &str, x: bool) { self.key(k); self.bool(x); }
}

/// x.toFixed(d)
pub fn fx(x: f64, d: usize) -> String { to_fixed(x, d) }
/// String(x)
pub fn ns(x: f64) -> String { num_str(x) }
/// Math.round(x*100)+"%"
pub fn pct(x: f64) -> String { format!("{}%", num_str(js_round(x * 100.0))) }
/// (Math.round(z*10)/10+0).toFixed(1)
pub fn zf(z: f64) -> String { to_fixed(js_round(z * 10.0) / 10.0 + 0.0, 1) }
/// (x>=0?"+":"-")+Math.abs(x).toFixed(d)
pub fn sgn(x: f64, d: usize) -> String { format!("{}{}", if x >= 0.0 { "+" } else { "-" }, to_fixed(x.abs(), d)) }
pub fn money(x: f64) -> String {
    if x >= 1e6 { format!("{}M", to_fixed(x / 1e6, 1)) } else if x >= 1e3 { format!("{}k", num_str(js_round(x / 1e3))) } else { to_fixed(x, 0) }
}
pub fn usd(n: f64) -> String {
    if n >= 1e6 { format!("${}M", to_fixed(n / 1e6, 1)) } else { format!("${}k", num_str(js_round(n / 1e3))) }
}
/// s.slice(0,6)+"..."+s.slice(-4), on UTF-16 code units like JS
pub fn short_wallet(s: &str) -> String {
    let u: Vec<u16> = s.encode_utf16().collect();
    let n = u.len();
    let head = &u[..n.min(6)];
    let tail = &u[n.saturating_sub(4)..];
    format!("{}...{}", String::from_utf16_lossy(head), String::from_utf16_lossy(tail))
}
