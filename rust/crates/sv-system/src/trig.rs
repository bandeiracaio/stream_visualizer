//! The small structures (rolling extremes, point buffer, sorted window) and the seven triggers of a system. Each trigger keeps its own state and answers `eval(snapshot)` with signals, `read()` with its reading, `norm()` with whether the reading is back to normal.
use crate::def::{get, num, st};
use crate::{vidx, sgn, Snap};
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use sv_core::js;

// ---------- small structures ----------
/// rolling high / low of the points in the last `window` ms; query(t) drops older points and sets hi / lo (NaN when empty); push(t, p) adds a point.
pub struct RollExt { window: f64, ht: Vec<f64>, hp: Vec<f64>, lt: Vec<f64>, lp: Vec<f64>, hh: usize, lh: usize, pub hi: f64, pub lo: f64 }
impl RollExt {
    pub fn new(window: f64) -> RollExt { RollExt { window, ht: vec![], hp: vec![], lt: vec![], lp: vec![], hh: 0, lh: 0, hi: f64::NAN, lo: f64::NAN } }
    pub fn query(&mut self, t: f64) {
        let cut = t - self.window;
        while self.hh < self.ht.len() && self.ht[self.hh] < cut { self.hh += 1; }
        while self.lh < self.lt.len() && self.lt[self.lh] < cut { self.lh += 1; }
        self.hi = if self.hh < self.ht.len() { self.hp[self.hh] } else { f64::NAN };
        self.lo = if self.lh < self.lt.len() { self.lp[self.lh] } else { f64::NAN };
        if self.hh > 512 { self.ht.drain(..self.hh); self.hp.drain(..self.hh); self.hh = 0; }
        if self.lh > 512 { self.lt.drain(..self.lh); self.lp.drain(..self.lh); self.lh = 0; }
    }
    pub fn push(&mut self, t: f64, p: f64) {
        while self.ht.len() > self.hh && self.hp[self.hp.len() - 1] <= p { self.ht.pop(); self.hp.pop(); }
        self.ht.push(t); self.hp.push(p);
        while self.lt.len() > self.lh && self.lp[self.lp.len() - 1] >= p { self.lt.pop(); self.lp.pop(); }
        self.lt.push(t); self.lp.push(p);
    }
}
/// points (t, p) in time order; at(t, within) is the newest point at or before t that is at most `within` ms older
pub struct PtBuf { ts: Vec<f64>, ps: Vec<f64>, h: usize }
impl PtBuf {
    fn new() -> PtBuf { PtBuf { ts: vec![], ps: vec![], h: 0 } }
    fn push(&mut self, t: f64, p: f64) { self.ts.push(t); self.ps.push(p); }
    fn at(&self, t: f64, within: f64) -> Option<f64> {
        let (mut lo, mut hi, mut r) = (self.h as isize, self.ts.len() as isize - 1, -1isize);
        while lo <= hi { let m = (lo + hi) >> 1; if self.ts[m as usize] <= t { r = m; lo = m + 1; } else { hi = m - 1; } }
        if r >= 0 && t - self.ts[r as usize] <= within { Some(self.ps[r as usize]) } else { None }
    }
    fn trim(&mut self, t: f64) {
        while self.h + 1 < self.ts.len() && self.ts[self.h + 1] <= t { self.h += 1; }
        if self.h > 1024 { self.ts.drain(..self.h); self.ps.drain(..self.h); self.h = 0; }
    }
}
/// sorted multiset of numbers with a time queue: add(t, x), expire(minT), median() = the upper median
pub struct MedWin { qt: Vec<f64>, qx: Vec<f64>, sorted: Vec<f64>, h: usize }
impl MedWin {
    fn new() -> MedWin { MedWin { qt: vec![], qx: vec![], sorted: vec![], h: 0 } }
    fn find(&self, x: f64) -> usize { let (mut lo, mut hi) = (0, self.sorted.len()); while lo < hi { let m = (lo + hi) >> 1; if self.sorted[m] < x { lo = m + 1; } else { hi = m; } } lo }
    fn add(&mut self, t: f64, x: f64) { self.qt.push(t); self.qx.push(x); let i = self.find(x); self.sorted.insert(i, x); }
    fn expire(&mut self, min_t: f64) {
        while self.h < self.qt.len() && self.qt[self.h] < min_t { let i = self.find(self.qx[self.h]); if i < self.sorted.len() { self.sorted.remove(i); } self.h += 1; }
        if self.h > 512 { self.qt.drain(..self.h); self.qx.drain(..self.h); self.h = 0; }
    }
    fn median(&self) -> Option<f64> { if self.sorted.is_empty() { None } else { Some(self.sorted[self.sorted.len() >> 1]) } }
}

/// the region's box as of one second
#[derive(Clone, Copy)]
pub struct Bx { pub t: f64, pub hi: f64, pub lo: f64 }
/// per venue: count of points, first / last point time, the last price, price lookback, region extremes
pub struct Vt { pub n: u32, pub t0: Option<f64>, pub last_t: Option<f64>, pub prev_t: Option<f64>, pub p: f64, pub cur: bool, buf: Option<PtBuf>, pub ext: Option<RollExt>, pub box_: Option<Bx>, pub prev_box: Option<Bx> }
impl Vt {
    pub fn new(has_buf: bool, has_ext: bool, window: f64) -> Vt {
        Vt { n: 0, t0: None, last_t: None, prev_t: None, p: f64::NAN, cur: false, buf: if has_buf { Some(PtBuf::new()) } else { None }, ext: if has_ext { Some(RollExt::new(window)) } else { None }, box_: None, prev_box: None }
    }
}

/// a signal a trigger fires
pub struct Sig { pub t: f64, pub venue: String, pub side: f64 }
/// a forced (random-entry) signal as the caller gives it: {t, side, venue?}
pub struct Forced { pub t: f64, pub side: f64, pub venue: Option<String> }
impl Forced {
    pub fn from_value(v: &Value) -> Forced {
        Forced { t: match get(Some(v), "t") { Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN), _ => f64::NAN }, side: match get(Some(v), "side") { Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN), _ => f64::NAN },
            venue: st(get(Some(v), "venue")).map(String::from) }
    }
}

/// a trigger's reading against its threshold (`share` only for the trade-flow trigger)
#[derive(Serialize, Clone, Copy)]
pub struct Reading { pub value: Option<f64>, pub threshold: Option<f64>, #[serde(skip_serializing_if = "Option::is_none")] pub share: Option<f64>, pub side: f64 }
fn rd(value: Option<f64>, threshold: Option<f64>, side: f64) -> Reading { Reading { value, threshold, share: None, side } }

pub enum Trig {
    Episode { families: Vec<String>, v0: String, any: bool },
    PriceMove { look_sec: f64, m: f64, last_sig: f64, rd: Reading, v0: String },
    Premium { base_sec: f64, min_bps: f64, cool_sec: f64, v0: String, f: f64, dq_t: Vec<f64>, dq_v: Vec<Option<f64>>, h: usize, sum: f64, cnt: i64, last_sig: f64, bn: Option<(f64, f64)>, dev: Option<(f64, Option<f64>)>, rd: Reading },
    TradeFlow { l: usize, m: f64, share: f64, vi: usize, v0: String, rb: Vec<f64>, rs: Vec<f64>, mw: MedWin, k: usize, npts: usize, last_sig: f64, rd: Reading, tot: f64, net: f64 },
    BookDepth { edge5: bool, thr: f64, sustain: f64, cool_sec: f64, vi: usize, v0: String, run: f64, sg: f64, last_sig: f64, x: Option<f64>, rd: Reading },
    RangeBreak { brk_bps: f64, cool_sec: f64, w: f64, v0: String, last_sig: f64, rd: Reading },
    LevelRejection { tol_bps: f64, rej_bps: f64, lp: i64, cool_sec: f64, w: f64, v0: String, r: RollExt, ring_hi: Vec<f64>, ring_lo: Vec<f64>, i: i64, last_sig: f64 },
}

fn f(trg: Option<&Value>, k: &str) -> f64 { num(get(trg, k)).unwrap_or(f64::NAN) }
/// `new Array(n)`: n must be an integer that fits
fn arr_len(n: f64) -> Result<usize, String> { if n.fract() == 0.0 && n >= 0.0 && n <= 4294967295.0 { Ok(n as usize) } else { Err("Invalid array length".into()) } }
const NEG: f64 = f64::NEG_INFINITY;

impl Trig {
    pub fn make(trg: Option<&Value>, venue: &str, any: bool, box_w: f64) -> Result<Trig, String> {
        let v0 = venue.to_string();
        Ok(match st(get(trg, "type")).unwrap_or("") {
            "episode" => Trig::Episode { families: match get(trg, "families") { Some(Value::Array(a)) => a.iter().filter_map(|x| st(Some(x)).map(String::from)).collect(), _ => vec![] }, v0, any },
            "priceMove" => Trig::PriceMove { look_sec: f(trg, "lookSec"), m: f(trg, "m"), last_sig: NEG, rd: rd(None, None, 0.0), v0 },
            "premium" => { let min_bps = f(trg, "minBps"); Trig::Premium { base_sec: f(trg, "baseSec"), min_bps, cool_sec: f(trg, "coolSec"), f: if venue == "hl" { 1.0 } else { -1.0 }, v0, dq_t: vec![], dq_v: vec![], h: 0, sum: 0.0, cnt: 0, last_sig: NEG, bn: None, dev: None, rd: rd(None, Some(min_bps), 0.0) } }
            "tradeFlow" => { let l = arr_len(f(trg, "lookSec"))?; Trig::TradeFlow { l, m: f(trg, "m"), share: f(trg, "share"), vi: vidx(venue).unwrap_or(0), v0, rb: vec![0.0; l], rs: vec![0.0; l], mw: MedWin::new(), k: 0, npts: 0, last_sig: NEG, rd: rd(None, None, 0.0), tot: 0.0, net: 0.0 } }
            "bookDepth" => { let thr = f(trg, "thr"); Trig::BookDepth { edge5: f(trg, "edge") == 5.0, thr, sustain: f(trg, "sustainSec"), cool_sec: f(trg, "coolSec"), vi: vidx(venue).unwrap_or(0), v0, run: 0.0, sg: 0.0, last_sig: NEG, x: None, rd: rd(None, Some(thr), 0.0) } }
            "rangeBreak" => { let b = f(trg, "brkBps"); Trig::RangeBreak { brk_bps: b, cool_sec: f(trg, "coolSec"), w: box_w, v0, last_sig: NEG, rd: rd(None, Some(b), 0.0) } }
            _ => {
                let lp = f(trg, "lookSec"); let n = arr_len(lp + 1.0)?;
                Trig::LevelRejection { tol_bps: f(trg, "tolBps"), rej_bps: f(trg, "rejBps"), lp: lp as i64, cool_sec: f(trg, "coolSec"), w: box_w, v0, r: RollExt::new(lp * 1000.0), ring_hi: vec![f64::NAN; n], ring_lo: vec![f64::NAN; n], i: -1, last_sig: NEG }
            }
        })
    }

    pub fn read(&self) -> Option<Reading> {
        match self {
            Trig::Episode { .. } | Trig::LevelRejection { .. } => None,
            Trig::PriceMove { rd, .. } | Trig::Premium { rd, .. } | Trig::TradeFlow { rd, .. } | Trig::BookDepth { rd, .. } | Trig::RangeBreak { rd, .. } => Some(*rd),
        }
    }
    /// is the reading back to normal (None for the triggers that have no such rule is `false` here: only a trigger with a reading can be asked)
    pub fn norm(&self, snap: &Snap) -> bool {
        match self {
            Trig::Premium { dev, min_bps, .. } => dev.map_or(false, |(t, v)| v.map_or(false, |v| snap.t - t <= 2000.0 && v.abs() <= 0.3 * min_bps)),
            Trig::TradeFlow { npts, l, tot, net, .. } => if *npts > *l { if *tot > 0.0 { net.abs() / tot < 0.2 } else { true } } else { false },
            Trig::BookDepth { x, thr, .. } => x.map_or(false, |x| x.abs() < thr / 2.0),
            _ => false,
        }
    }

    /// `flow` = (flowWindowSec, minFlowReadings). `pt` is the price point record of the system's venue (the triggers that read its price or box).
    pub fn eval(&mut self, snap: &Snap, pt: Option<&mut Vt>, sigma_now: f64, flow: &(f64, f64)) -> Vec<Sig> {
        let t = snap.t;
        match self {
            Trig::Episode { families, v0, any } => {
                let mut out = Vec::new();
                for g in &snap.episodes.new_ { if families.iter().any(|x| *x == g.family) && (*any || g.venue == *v0) && g.side != 0.0 { out.push(Sig { t: g.t_detected, venue: g.venue.clone(), side: g.side }); } }
                out
            }
            Trig::PriceMove { look_sec, m, last_sig, rd: r, v0 } => {
                let Some(pt) = pt else { return vec![] };
                let b = pt.buf.as_ref().and_then(|b| b.at(t - *look_sec * 1000.0, 2000.0));
                let thr = *m * sigma_now * look_sec.sqrt();
                *r = rd(None, Some(thr), 0.0);
                if let Some(buf) = pt.buf.as_mut() { buf.push(t, pt.p); buf.trim(t - *look_sec * 1000.0); }
                let b = match b { Some(b) if b > 0.0 => b, _ => return vec![] };
                let mv = (pt.p / b - 1.0) * 1e4;
                *r = rd(Some(mv), Some(thr), if mv.abs() >= thr { sgn(mv) } else { 0.0 });
                if t < *last_sig + *look_sec * 1000.0 || mv.abs() < thr { return vec![]; }
                *last_sig = t;
                vec![Sig { t, venue: v0.clone(), side: if mv > 0.0 { 1.0 } else { -1.0 } }]
            }
            Trig::Premium { base_sec, min_bps, cool_sec, v0, f, dq_t, dq_v, h, sum, cnt, last_sig, bn, dev, rd: r } => {
                if let Some(p) = snap.px.bn { if p > 0.0 { *bn = Some((t, p)); } }
                let hl = match snap.px.hl { Some(p) if p > 0.0 => p, _ => return vec![] };
                let v = match bn { Some((bt, bp)) if *bp > 0.0 && t - *bt <= 2000.0 => Some((hl / *bp - 1.0) * 1e4), _ => None };
                dq_t.push(t); dq_v.push(v);
                if let Some(v) = v { *sum += v; *cnt += 1; }
                while *h < dq_t.len() && dq_t[*h] < t - *base_sec * 1000.0 { if let Some(x) = dq_v[*h] { *sum -= x; *cnt -= 1; } *h += 1; }
                if *h > 512 { dq_t.drain(..*h); dq_v.drain(..*h); *h = 0; }
                let n = *cnt - if dq_v[*h].is_some() { 1 } else { 0 };
                *dev = Some((t, None));
                let v = match v { Some(v) if n >= 20 => v, _ => { *r = rd(None, Some(*min_bps), 0.0); return vec![]; } };
                let d = v - (*sum - dq_v[*h].unwrap_or(0.0)) / n as f64;
                *dev = Some((t, Some(d)));
                *r = rd(Some(d), Some(*min_bps), if d.abs() >= *min_bps { sgn(d) * *f } else { 0.0 });
                if t < *last_sig + *cool_sec * 1000.0 || d.abs() < *min_bps { return vec![]; }
                *last_sig = t;
                vec![Sig { t, venue: v0.clone(), side: sgn(d) * *f }]
            }
            Trig::TradeFlow { l, m, share, vi, v0, rb, rs, mw, k, npts, last_sig, rd: r, tot, net } => {
                let fl = snap.flow.at(*vi);
                rb[*k] = fl.buy; rs[*k] = fl.sell; *k = (*k + 1) % *l; *npts += 1;
                if *npts <= *l { return vec![]; }
                let (mut b, mut s) = (0.0, 0.0);
                for i in 0..*l { b += rb[i]; s += rs[i]; }
                *net = b - s; *tot = b + s;
                mw.expire(t - flow.0 * 1000.0);
                let med = if mw.sorted.len() as f64 >= flow.1 { mw.median() } else { None };
                let thr = match med { Some(x) if x > 0.0 => Some(*m * x), _ => None };
                if *tot > 0.0 { mw.add(t, net.abs()); }
                let sh = if *tot > 0.0 { net.abs() / *tot } else { 0.0 };
                let hit = *tot > 0.0 && thr.map_or(false, |th| sh >= *share && net.abs() >= th);
                *r = Reading { value: Some(*net), threshold: thr, share: Some(sh), side: if hit { sgn(*net) } else { 0.0 } };
                if !hit || t < *last_sig + *l as f64 * 1000.0 { return vec![]; }
                *last_sig = t;
                vec![Sig { t, venue: v0.clone(), side: if *net > 0.0 { 1.0 } else { -1.0 } }]
            }
            Trig::BookDepth { edge5, thr, sustain, cool_sec, vi, v0, run, sg, last_sig, x, rd: r } => {
                let im = snap.imb.at(*vi);
                *x = if *edge5 { im.e5 } else { im.e20 };
                *r = rd(*x, Some(*thr), match *x { Some(v) if v.abs() >= *thr => if v > 0.0 { 1.0 } else { -1.0 }, _ => 0.0 });
                let xv = match *x { Some(v) if v.abs() >= *thr => v, _ => { *run = 0.0; *sg = 0.0; return vec![]; } };
                let s = if xv > 0.0 { 1.0 } else { -1.0 };
                if s == *sg { *run += 1.0; } else { *sg = s; *run = 1.0; }
                if *run >= *sustain && t >= *last_sig + *cool_sec * 1000.0 { *last_sig = t; return vec![Sig { t, venue: v0.clone(), side: s }]; }
                vec![]
            }
            Trig::RangeBreak { brk_bps, cool_sec, w, v0, last_sig, rd: r } => {
                let Some(pt) = pt else { return vec![] };
                let Some(b) = pt.box_ else { return vec![] };
                let px = pt.p;
                *r = rd(None, Some(*brk_bps), 0.0);
                if t - pt.t0.unwrap_or(f64::NAN) < *w { return vec![]; }
                let up = px > b.hi * (1.0 + *brk_bps / 1e4);
                let dn = px < b.lo * (1.0 - *brk_bps / 1e4);
                r.side = if up { 1.0 } else if dn { -1.0 } else { 0.0 };
                r.value = Some(if up { (px / b.hi - 1.0) * 1e4 } else if dn { (px / b.lo - 1.0) * 1e4 } else { 0.0 });
                if t < *last_sig + *cool_sec * 1000.0 || !(up || dn) { return vec![]; }
                *last_sig = t;
                vec![Sig { t, venue: v0.clone(), side: if up { 1.0 } else { -1.0 } }]
            }
            Trig::LevelRejection { tol_bps, rej_bps, lp, cool_sec, w, v0, r, ring_hi, ring_lo, i, last_sig } => {
                let Some(pt) = pt else { return vec![] };
                let Some(b) = pt.box_ else { return vec![] };
                let px = pt.p;
                *i += 1; r.query(t);
                let (r_hi, r_lo) = (r.hi, r.lo);
                r.push(t, px);
                let n = (*lp + 1) as i64;
                let (lev_hi, lev_lo) = if *i >= *lp { (ring_hi[((*i - *lp) % n) as usize], ring_lo[((*i - *lp) % n) as usize]) } else { (f64::NAN, f64::NAN) };
                ring_hi[(*i % n) as usize] = b.hi; ring_lo[(*i % n) as usize] = b.lo;
                if *i < *lp || t - pt.t0.unwrap_or(f64::NAN) < (*w + *lp as f64 * 1000.0) || t < *last_sig + *cool_sec * 1000.0 { return vec![]; }
                let (max_lp, min_lp, tol) = (js::max(r_hi, px), js::min(r_lo, px), *tol_bps / 1e4);
                if lev_hi > 0.0 && max_lp >= lev_hi * (1.0 - tol) && max_lp <= lev_hi * (1.0 + tol) && px <= max_lp * (1.0 - *rej_bps / 1e4) { *last_sig = t; return vec![Sig { t, venue: v0.clone(), side: 1.0 }]; }
                if lev_lo > 0.0 && min_lp <= lev_lo * (1.0 + tol) && min_lp >= lev_lo * (1.0 - tol) && px >= min_lp * (1.0 + *rej_bps / 1e4) { *last_sig = t; return vec![Sig { t, venue: v0.clone(), side: -1.0 }]; }
                vec![]
            }
        }
    }
}

/// a queue of forced signals in the order the caller gave them
pub type ForcedQ = VecDeque<Forced>;
