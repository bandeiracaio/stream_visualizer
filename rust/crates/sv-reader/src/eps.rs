//! The episode layer (src/js/reader-episodes.js): episode state machines and evidence checklists for absorption, exhaustion, aggression burst and wall, the groups, the after-the-fact resolution.
//! Episodes live in an arena by id: a track can resume an episode that the list has already dropped (as the JS keeps the object), and the list, the tracks, the pending resolutions and the walls hold ids.
use crate::out::{fx, money, ns, pct, sgn, usd, zf, W};
use crate::{clamp, clamp01, Engine, RcItems, Side, Wall, BOOK_SIDES, BUY, FAMS, SELL, VN};
use std::collections::HashMap;
use std::rc::Rc;
use sv_core::{js_round, math};

#[derive(Clone, Debug)]
pub struct Item { pub k: &'static str, pub label: &'static str, pub ok: bool, pub w: f64, pub val: String, pub gate: bool, pub na: bool }
fn item(k: &'static str, label: &'static str, ok: bool, w: f64, val: String, gate: bool) -> Item { Item { k, label, ok, w, val, gate, na: false } }
fn na(k: &'static str, label: &'static str) -> Item { Item { k, label, ok: false, w: 0.0, val: "n/a".into(), gate: false, na: true } }

#[derive(Clone, Debug)]
pub enum Facts {
    Abs { share: f64, z: f64, prog: f64, eff: f64, refill: Option<f64>, d_side: usize, open: f64, secs: f64, rate_usd: f64 },
    Exh { ratio: f64, z_was: f64, gap: f64, away: f64, prog: f64, poke: bool, side: Side, open: f64, secs: f64 },
    Burst { z: f64, share: f64, prog: f64, liq: f64, sweeps: f64, secs: f64, notional: f64, open: f64 },
    None,
}
impl Facts { fn open(&self) -> f64 { match self { Facts::Abs { open, .. } | Facts::Exh { open, .. } | Facts::Burst { open, .. } => *open, Facts::None => f64::NAN } } }

#[derive(Clone, Debug)]
pub struct Ev { pub items: RcItems, pub score: f64, pub gate: bool, pub px: f64, pub facts: Facts }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage { Active, Fading, Ended }
impl Stage { pub fn name(self) -> &'static str { match self { Stage::Active => "active", Stage::Fading => "fading", Stage::Ended => "ended" } } fn rank(self) -> u8 { match self { Stage::Active => 2, Stage::Fading => 1, Stage::Ended => 0 } } }

#[derive(Clone, Debug)]
pub struct WallEp { pub side: usize, pub px: f64, pub size: f64, pub peak: f64, pub ratio: f64, pub reposts: f64, pub traded_frac: Option<f64> }

#[derive(Clone, Debug)]
pub struct Ep {
    pub id: u32, pub fam: usize, pub venue: usize, pub horizon: Rc<str>, pub aggressor: Option<Side>, pub passive: Option<Side>, pub stage: Stage, pub pulses: f64,
    pub t_start: f64, pub t_detected: f64, pub t_end: Option<f64>, pub peak: f64, pub intensity: f64, pub evidence: RcItems, pub facts: Facts, pub reading: String,
    pub outcome: Option<Rc<str>>, pub resumed_at: Vec<f64>, pub trace: std::collections::VecDeque<(f64, f64)>, pub px: Option<f64>, pub px_start: f64, pub t_update: f64, pub t_seen: f64, pub fading_since: Option<f64>,
    pub peak_reading: Option<String>, pub peak_evidence: Option<RcItems>,
    /// the order the two resolution keys were first written in (JSON follows it): 0 none yet, 1 resolution first (a resume), 2 resolutionSigma first (resolve)
    pub res_order: u8, pub resolution: Option<&'static str>, pub resolution_sigma: Option<f64>,
    pub wall: Option<WallEp>,
}

#[derive(Clone, Debug)]
pub struct Track {
    pub fam: usize, pub vn: usize, pub hz: Rc<str>, pub side: Side, pub ep: Option<u32>, pub last_ended: Option<u32>, pub run_since: Option<f64>, pub last_near: f64,
    pub on_since: Option<f64>, pub low_since: Option<f64>, pub last: Option<Rc<Ev>>, pub last_t: f64,
}
impl Track { fn key(&self) -> String { format!("{}|{}|{}|{}", FAMS[self.fam], VN[self.vn], self.hz, self.side.name()) } }

#[derive(Default)]
pub struct Eps {
    pub arena: HashMap<u32, Ep>, pub list: Vec<u32>, pub tracks: Vec<Track>, pub walls: Vec<((usize, usize, u64), u32)>, pub pend: Vec<u32>, pub seq: u32, pub refresh: [[f64; 2]; 2],
}

/// Aggregate of ring buckets [len-offset-count, len-offset)
#[derive(Clone, Copy)]
struct Agg { buy: f64, sell: f64, n: f64, hi: f64, lo: f64, open: f64, close: f64 }

const FAM_ABS: usize = 0;
const FAM_EXH: usize = 1;
const FAM_WALL: usize = 3;
fn who(s: Side) -> &'static str { if s == Side::Buy { "buyers" } else { "sellers" } }
fn moved(side: Side, p: f64) -> String { format!("{}{}σ", if (side == Side::Buy) == (p >= 0.0) { "up " } else { "down " }, fx(p.abs(), 1)) }
fn si(side: Side) -> usize { if side == Side::Buy { BUY } else { SELL } }
fn score_of(items: &[Item]) -> (f64, bool) {
    let (mut w, mut s, mut gate) = (0.0, 0.0, true);
    for it in items { if it.na { continue; } w += it.w; if it.ok { s += it.w; } if it.gate && !it.ok { gate = false; } }
    (if w != 0.0 { s / w } else { 0.0 }, gate)
}

impl Engine {
    pub fn eps_reset(&mut self) { self.eps = Eps::default(); }
    fn notify(&mut self, id: u32, change: &str) {
        if !self.listen_eps { return; }
        let mut w = W::default();
        w.open('{'); w.key("ep"); self.ep_json(&mut w, id); w.ks("ch", change); w.close('}');
        self.notes.push(w.s);
    }
    fn agg(&self, vn: usize, count: f64, offset: f64) -> Option<Agg> {
        let r = &self.venues[vn].ring;
        let end = r.len() as f64 - offset; let start = end - count;
        if count < 1.0 || start < 0.0 { return None; }
        let mut a = Agg { buy: 0.0, sell: 0.0, n: 0.0, hi: f64::NEG_INFINITY, lo: f64::INFINITY, open: 0.0, close: 0.0 };
        let (mut open, mut close) = (None, None);
        let mut i = start;
        while i < end {
            let b = &r[i as usize];
            a.buy += b.buy; a.sell += b.sell; a.n += b.n;
            if let Some(h) = b.hi { if h > a.hi { a.hi = h; } let l = b.lo.unwrap_or(0.0); if l < a.lo { a.lo = l; } if open.is_none() { open = b.open; } close = b.close; }
            i += 1.0;
        }
        a.open = open?; a.close = close.unwrap_or(0.0);
        Some(a)
    }
    fn min_trades(&self, hz: &str) -> f64 { if hz == "fast" { self.cfg.ep.min_trades_fast } else { self.cfg.ep.min_trades_mid } }
    fn progress(&mut self, vn: usize, ms: f64, open: f64, close: f64, side: Side) -> f64 {
        (if side == Side::Buy { 1.0 } else { -1.0 }) * (close / open - 1.0) * 1e4 / (self.sigma_bps(vn) * (ms / 1000.0).sqrt())
    }
    /// Is it still going on? the latest quarter of the window only (at most the last 8 s)
    fn recent(&self, vn: usize, ms: f64, side: Side, rate: f64) -> (bool, String) {
        let q = clamp(js_round(ms / self.cfg.bucket_ms / 4.0), 4.0, 32.0);
        let r = match self.agg(vn, q, 0.0) { Some(r) if r.buy + r.sell > 0.0 => r, _ => return (false, "no trades".into()) };
        let mine = if side == Side::Buy { r.buy } else { r.sell };
        let share = mine / (r.buy + r.sell);
        let now = mine / (q * self.cfg.bucket_ms / 1000.0);
        (share >= self.cfg.ep.recent_share && now >= self.cfg.ep.recent_pace * rate, format!("{}, {} of pace", pct(share), if rate > 0.0 { pct(now / rate) } else { "-".into() }))
    }
    fn eval_absorption(&mut self, vn: usize, hz: &str, side: Side, t: f64) -> Option<Ev> {
        let h = self.horizon(vn, hz)?;
        if h.n < self.min_trades(hz) || !(h.open > 0.0) || !(h.buy + h.sell > 0.0) { return None; }
        let secs = h.ms / 1000.0;
        let share = if side == Side::Buy { h.share } else { 1.0 - h.share };
        let rate = (if side == Side::Buy { h.buy } else { h.sell }) / secs;
        let z = self.robust_z(rate, vn, si(side), 1.0);
        let prog = self.progress(vn, h.ms, h.open, h.close, side);
        let count = js_round(h.ms / self.cfg.bucket_ms);
        let ring = &self.venues[vn].ring;
        let from = (ring.len() as f64 - count).max(0.0) as usize;
        let mut path = 0.0;
        for i in from + 1..ring.len() { let (a, b) = (ring[i - 1].close, ring[i].close); if let (Some(a), Some(b)) = (a, b) { if a > 0.0 && b > 0.0 { path += (b / a - 1.0).abs(); } } }
        let eff = if path > 0.0 { (h.close / h.open - 1.0).abs() / path } else { 0.0 };
        let d_side = if side == Side::Sell { 0 } else { 1 };
        let start = if from < ring.len() { if d_side == 0 { ring[from].bid_depth } else { ring[from].ask_depth } } else { 0.0 };
        let typical = self.typical_depth(vn, d_side);
        let refill = if start > 0.0 && !(typical > 0.0 && start < self.cfg.thin_frac * typical) { Some(self.venues[vn].depth[d_side] / start) } else { None };
        let w = self.wallet_evidence(vn, side, t - h.ms);
        let ovn = 1 - vn;
        let oh = self.horizon(ovn, hz);
        let o_share = oh.map(|o| if side == Side::Buy { o.share } else { 1.0 - o.share });
        let o_prog = match oh { Some(o) if o.open > 0.0 => Some(self.progress(ovn, o.ms, o.open, o.close, side)), _ => None };
        let rc = self.recent(vn, h.ms, side, rate);
        let conc = h.max_trade / (h.buy + h.sell);
        let e = &self.cfg.ep;
        let lvl = t - self.eps.refresh[vn][si(side)] <= e.refresh_ms;
        let items = vec![
            item("flow", "aggressor share of taker flow", share >= self.cfg.absorb_share, 2.0, pct(share), true),
            item("stalled", "price has not progressed with the aggressor, nor clearly reversed", prog <= self.cfg.absorb_sigma && prog >= -e.abs_adverse, 2.0, format!("{}σ", sgn(prog, 1)), true),
            item("recent", "still happening in the latest seconds", rc.0, 1.5, rc.1, true),
            item("intensity", "flow intensity vs normal", z >= self.th(self.cfg.absorb_z), 1.5, format!("z {}", fx(z, 1)), false),
            item("efficiency", "price path efficiency (low = chop)", eff <= self.cfg.absorb_efficiency, 1.0, fx(eff, 2), false),
            match refill { None => na("refill", "passive depth refilled"), Some(r) => item("refill", "passive depth refilled", r >= self.cfg.absorb_refill, 1.5, pct(r), false) },
            item("fills", "flow spread over many fills (no one large trade)", conc <= e.abs_conc, 1.0, pct(conc), false),
            item("level", "repeated fills at one level", lvl, 1.0, (if lvl { "yes" } else { "no" }).into(), false),
            if vn == 1 { item("wallet", "one wallet dominates", w.is_some(), 1.0, match &w { Some(w) => pct(w.share), None => "no".into() }, false) } else { na("wallet", "one wallet dominates") },
            match (o_share, o_prog) { (Some(os), Some(op)) => item("cross", "other venue agrees", os >= e.cross_share && op <= self.cfg.absorb_sigma, 1.0, pct(os), false), _ => na("cross", "other venue agrees") },
        ];
        let (score, gate) = score_of(&items);
        Some(Ev { items: Rc::new(items), score, gate, px: h.close, facts: Facts::Abs { share, z, prog, eff, refill, d_side, open: h.open, secs, rate_usd: rate * secs } })
    }
    fn late_progress(&mut self, vn: usize, ms: f64, side: Side) -> f64 {
        let q = clamp(js_round(ms / self.cfg.bucket_ms / 4.0), 4.0, 32.0);
        let r = match self.agg(vn, q, 0.0) { Some(r) if r.open > 0.0 => r, _ => return 0.0 };
        (if side == Side::Buy { 1.0 } else { -1.0 }) * (r.close / r.open - 1.0) * 1e4 / (self.sigma_bps(vn) * (q * self.cfg.bucket_ms / 1000.0).sqrt())
    }
    fn eval_exhaustion(&mut self, vn: usize, hz: &str, side: Side, t: f64) -> Option<Ev> {
        let h = self.horizon(vn, hz)?;
        if !(h.open > 0.0) { return None; }
        let count = js_round(h.ms / self.cfg.bucket_ms);
        let prev = self.agg(vn, count, count)?;
        if prev.n < self.min_trades(hz) { return None; }
        let secs = h.ms / 1000.0;
        let sig = self.sigma_bps(vn) * secs.sqrt();
        let buy = side == Side::Buy;
        let rate = (if buy { h.buy } else { h.sell }) / secs;
        let was = (if buy { prev.buy } else { prev.sell }) / secs;
        let z_was = self.robust_z(was, vn, si(side), 1.0);
        let ratio = if was > 0.0 { rate / was } else { 1.0 };
        let prog = self.progress(vn, h.ms, h.open, h.close, side);
        let late = self.late_progress(vn, h.ms, side);
        let was_share = if prev.buy + prev.sell > 0.0 { (if buy { prev.buy } else { prev.sell }) / (prev.buy + prev.sell) } else { 0.0 };
        let ext = if buy { sv_core::js::max(h.hi, prev.hi) } else { sv_core::js::min(h.lo, prev.lo) };
        let prior = if buy { self.prior_high(vn, 2.0 * count) } else { self.prior_low(vn, 2.0 * count) };
        let away = sv_core::js::max(0.0, (if buy { ext - h.close } else { h.close - ext }) / ext * 1e4 / sig);
        let gap = if prior.is_finite() { (if buy { prior - ext } else { ext - prior }) / ext * 1e4 / sig } else { 0.0 };
        let count_ratio = if prev.n > 0.0 { Some(h.n / prev.n) } else { None };
        let size_now = if h.n != 0.0 { (h.buy + h.sell) / h.n } else { 0.0 };
        let size_was = if prev.n != 0.0 { (prev.buy + prev.sell) / prev.n } else { 0.0 };
        let e = &self.cfg.ep;
        let poke = match self.venues[vn].last_poke_fail { Some((pt, ps)) => ps == (if buy { 0 } else { 1 }) && t - pt <= e.poke_ms, None => false };
        let items = vec![
            item("decay", "aggression vs the window before", ratio <= e.exh_decay, 2.5, pct(ratio), true),
            item("was", "it was elevated before", z_was >= e.exh_was_z, 1.5, format!("z {}", fx(z_was, 1)), true),
            item("dominant", "it was the dominant side before", was_share >= e.exh_was_share, 1.0, pct(was_share), true),
            item("extreme", "made a new 5-minute extreme", gap <= e.exh_gap, 1.5, if gap <= 0.0 { "new extreme".into() } else { format!("{}σ away", fx(gap, 1)) }, false),
            item("atExtreme", "price still near that extreme", away <= e.exh_near, 1.5, format!("{}σ off it", fx(away, 1)), true),
            item("stalled", "price progress with the aggressor (latest seconds)", late <= self.cfg.absorb_sigma, 1.5, format!("{}σ", sgn(late, 1)), true),
            item("poke", "recent failed poke", poke, 1.5, (if poke { "yes" } else { "no" }).into(), false),
            match count_ratio { None => na("count", "trade count falling"), Some(c) => item("count", "trade count vs the window before", c <= e.exh_count, 1.0, pct(c), false) },
            item("size", "average trade size shrinking", size_was > 0.0 && size_now <= e.exh_size * size_was, 1.0, if size_was > 0.0 { pct(size_now / size_was) } else { "-".into() }, false),
        ];
        let (score, gate) = score_of(&items);
        Some(Ev { items: Rc::new(items), score, gate, px: h.close, facts: Facts::Exh { ratio, z_was, gap, away, prog, poke, side, open: h.open, secs } })
    }
    fn eval_burst(&mut self, vn: usize, hz: &str, side: Side, _t: f64) -> Option<Ev> {
        let h = self.horizon(vn, hz)?;
        if h.n < self.min_trades(hz) || !(h.open > 0.0) || !(h.buy + h.sell > 0.0) { return None; }
        let buy = side == Side::Buy;
        let secs = h.ms / 1000.0;
        let share = if buy { h.share } else { 1.0 - h.share };
        let rate = (if buy { h.buy } else { h.sell }) / secs;
        let z = self.robust_z(rate, vn, si(side), 1.0);
        let prog = self.progress(vn, h.ms, h.open, h.close, side);
        let count = js_round(h.ms / self.cfg.bucket_ms);
        let liq = if buy { h.liq_buy_n } else { h.liq_sell_n };
        let sweeps = if buy { h.sweep_buy_n } else { h.sweep_sell_n };
        let brk = if buy { h.hi > self.prior_high(vn, count) } else { h.lo < self.prior_low(vn, count) };
        let ovn = 1 - vn;
        let oh = self.horizon(ovn, hz);
        let o_z = match oh { Some(o) if o.n >= self.min_trades(hz) => Some(self.robust_z((if buy { o.buy } else { o.sell }) / (o.ms / 1000.0), ovn, si(side), 1.0)), _ => None };
        let rc = self.recent(vn, h.ms, side, rate);
        let far = if buy { 1 } else { 0 };
        let thin = self.depth_thinned(vn, far);
        let thin2 = self.depth_thinned(vn, far);
        let e = &self.cfg.ep;
        let items = vec![
            item("rate", "flow rate vs normal", z >= self.th(self.cfg.burst_z), 2.0, format!("z {}", fx(z, 1)), true),
            item("share", "aggressor share of taker flow", share >= self.cfg.burst_share, 2.0, pct(share), true),
            item("recent", "still happening in the latest seconds", rc.0, 1.5, rc.1, true),
            item("move", "price moved with the aggressor", prog >= self.th(self.cfg.burst_sigma), 2.0, format!("{}σ", sgn(prog, 1)), false),
            item("liq", "liquidations", liq >= e.burst_liq, 1.0, ns(liq), false),
            item("sweeps", "multi-level sweeps", sweeps >= e.burst_sweeps, 1.0, ns(sweeps), false),
            item("thin", "far side of the book thinned", thin, 1.0, (if thin2 { "yes" } else { "no" }).into(), false),
            item("break", "through the 5-minute extreme", brk, 1.0, (if brk { "yes" } else { "no" }).into(), false),
            match o_z { None => na("cross", "other venue agrees"), Some(oz) => item("cross", "other venue agrees", oz >= e.cross_z, 1.0, format!("z {}", fx(oz, 1)), false) },
        ];
        let (score, gate) = score_of(&items);
        Some(Ev { items: Rc::new(items), score, gate, px: h.close, facts: Facts::Burst { z, share, prog, liq, sweeps, secs, notional: if buy { h.buy } else { h.sell }, open: h.open } })
    }
    fn eval(&mut self, fam: usize, vn: usize, hz: &str, side: Side, t: f64) -> Option<Ev> {
        match fam { FAM_ABS => self.eval_absorption(vn, hz, side, t), FAM_EXH => self.eval_exhaustion(vn, hz, side, t), _ => self.eval_burst(vn, hz, side, t) }
    }

    /// reading(ep) of a non-wall episode (also a forming one): built from its facts
    fn reading_of(&self, fam: usize, a: Side, f: &Facts) -> String {
        match (fam, f) {
            (FAM_ABS, Facts::Abs { share, z, prog, refill, d_side, .. }) => format!("Aggressive {} ({} of taker flow, z {}) are being absorbed by passive {}: price {}{}.", who(a), pct(*share), zf(*z), who(a.opp()), moved(a, *prog),
                match refill { Some(r) => format!(", {} depth {} refilled", BOOK_SIDES[*d_side], pct(*r)), None => String::new() }),
            (FAM_EXH, Facts::Exh { ratio, away, poke, prog, .. }) => format!("Aggressive {} have faded to {} of the previous window's pace{}{}; price {}.", who(a), pct(*ratio),
                if *away <= self.cfg.ep.exh_near { format!(", near the 5-minute {}", if a == Side::Buy { "high" } else { "low" }) } else { String::new() }, if *poke { ", after a failed poke" } else { "" }, moved(a, *prog)),
            (_, Facts::Burst { notional, secs, z, prog, liq, sweeps, .. }) => format!("Aggressive {}: ${} in {} s (z {}), price {}{}{}.", who(a), money(*notional), fx(*secs, 0), zf(*z), moved(a, *prog),
                if *liq != 0.0 && !liq.is_nan() { format!(", {} liquidations", ns(*liq)) } else { String::new() }, if *sweeps != 0.0 && !sweeps.is_nan() { format!(", {} sweeps", ns(*sweeps)) } else { String::new() }),
            _ => String::new(),
        }
    }
    fn reading_wall(ep: &Ep) -> String {
        let w = ep.wall.as_ref().unwrap();
        format!("{} wall at {}, {} at its peak ({} the median level), {} s old, {} of its peak left{}.", if w.side == 0 { "Bid" } else { "Ask" }, ns(w.px), usd(w.peak * w.px),
            if w.ratio >= 100.0 { "100x+".to_string() } else { format!("{}x", fx(w.ratio, 1)) }, ns(js_round((ep.t_update - ep.t_start) / 1000.0)), pct(w.size / w.peak),
            match w.traded_frac { Some(f) => format!("; {} of the size that left was traded through (the rest was pulled)", pct(f)), None => String::new() })
    }

    // ---- lifecycle
    fn refresh_ep(&mut self, id: u32, ev: &Ev, t: f64) {
        let cap = self.cfg.ep.trace_cap;
        let (fam, aggr) = { let ep = &self.eps.arena[&id]; (ep.fam, ep.aggressor.unwrap_or(Side::Buy)) };
        let reading = self.reading_of(fam, aggr, &ev.facts);
        let ep = self.eps.arena.get_mut(&id).unwrap();
        ep.intensity = ev.score; ep.evidence = ev.items.clone(); ep.facts = ev.facts.clone(); ep.px = Some(ev.px); ep.t_update = t; ep.reading = reading;
        if ev.score >= ep.peak { ep.peak = ev.score; ep.peak_reading = Some(ep.reading.clone()); ep.peak_evidence = Some(ev.items.clone()); }
        ep.trace.push_back((t, ev.score));
        if ep.trace.len() as f64 > cap { ep.trace.pop_front(); }
    }
    fn trim(&mut self) {
        let (kw, ke) = (self.cfg.ep.keep_walls, self.cfg.ep.keep_episodes);
        let e = &mut self.eps;
        let mut nw = e.list.iter().filter(|id| e.arena[id].fam == FAM_WALL).count() as f64;
        let mut no = e.list.len() as f64 - nw;
        let mut i = 0;
        let mut removed = false;
        while (nw > kw || no > ke) && i < e.list.len() {
            let x = &e.arena[&e.list[i]];
            let w = x.fam == FAM_WALL;
            if x.stage == Stage::Ended && (if w { nw > kw } else { no > ke }) { e.list.remove(i); removed = true; if w { nw -= 1.0; } else { no -= 1.0; } } else { i += 1; }
        }
        if removed { self.gc(); }
    }
    /// drop arena entries nothing refers to any more
    fn gc(&mut self) {
        let e = &mut self.eps;
        if e.arena.len() <= e.list.len() + 64 { return; }
        let mut keep: std::collections::HashSet<u32> = e.list.iter().copied().collect();
        for tr in &e.tracks { if let Some(x) = tr.ep { keep.insert(x); } if let Some(x) = tr.last_ended { keep.insert(x); } }
        for x in &e.pend { keep.insert(*x); }
        for (_, x) in &e.walls { keep.insert(*x); }
        e.arena.retain(|k, _| keep.contains(k));
    }
    fn open_ep(&mut self, ti: usize, ev: &Ev, t: f64) {
        if let Some(prev) = self.eps.tracks[ti].last_ended {
            let t_end = self.eps.arena[&prev].t_end.unwrap_or(0.0);
            if t - t_end <= self.cfg.ep.resume_ms {
                {
                    let p = self.eps.arena.get_mut(&prev).unwrap();
                    p.stage = Stage::Active; p.t_end = None; p.outcome = None; p.resolution = None; p.resolution_sigma = None; if p.res_order == 0 { p.res_order = 1; }
                    p.pulses += 1.0; p.resumed_at.push(t); p.fading_since = None;
                }
                self.eps.pend.retain(|x| *x != prev);
                let tr = &mut self.eps.tracks[ti];
                tr.last_ended = None; tr.ep = Some(prev); tr.on_since = None; tr.low_since = None;
                self.refresh_ep(prev, ev, t);
                self.notify(prev, "resumed");
                return;
            }
        }
        self.eps.seq += 1;
        let id = self.eps.seq;
        let tr = &self.eps.tracks[ti];
        let ep = Ep { id, fam: tr.fam, venue: tr.vn, horizon: tr.hz.clone(), aggressor: Some(tr.side), passive: if tr.fam == FAM_ABS { Some(tr.side.opp()) } else { None }, stage: Stage::Active, pulses: 1.0,
            t_start: sv_core::js::min(tr.run_since.unwrap_or(t), t), t_detected: t, t_end: None, peak: 0.0, intensity: 0.0, evidence: Rc::new(Vec::new()), facts: Facts::None, reading: String::new(),
            outcome: None, resumed_at: Vec::new(), trace: Default::default(), px: None, px_start: ev.facts.open(), t_update: t, t_seen: 0.0, fading_since: None, peak_reading: None, peak_evidence: None,
            res_order: 0, resolution: None, resolution_sigma: None, wall: None };
        self.eps.arena.insert(id, ep);
        let tr = &mut self.eps.tracks[ti];
        tr.ep = Some(id); tr.on_since = None; tr.low_since = None;
        self.eps.list.push(id);
        self.refresh_ep(id, ev, t);
        self.trim();
        self.notify(id, "started");
    }
    fn end_ep(&mut self, ti: usize, t_end: f64, outcome: &str) {
        let id = match self.eps.tracks[ti].ep { Some(x) => x, None => return };
        { let ep = self.eps.arena.get_mut(&id).unwrap(); ep.stage = Stage::Ended; ep.t_end = Some(t_end); ep.outcome = Some(Rc::from(outcome)); ep.fading_since = None; }
        let tr = &mut self.eps.tracks[ti];
        tr.last_ended = Some(id); tr.ep = None; tr.on_since = None; tr.run_since = None; tr.low_since = None;
        if outcome == "faded" { self.eps.pend.push(id); }
        self.notify(id, "ended");
    }
    fn step(&mut self, fam: usize, vn: usize, hz: &Rc<str>, side: Side, ev: Option<Ev>, t: f64) {
        let ti = match self.eps.tracks.iter().position(|x| x.fam == fam && x.vn == vn && *x.hz == **hz && x.side == side) {
            Some(i) => i,
            None => {
                if ev.is_none() { return; }
                self.eps.tracks.push(Track { fam, vn, hz: hz.clone(), side, ep: None, last_ended: None, run_since: None, last_near: 0.0, on_since: None, low_since: None, last: None, last_t: 0.0 });
                self.eps.tracks.len() - 1
            }
        };
        let ev = ev.map(Rc::new);
        { let tr = &mut self.eps.tracks[ti]; tr.last = ev.clone(); tr.last_t = t; }
        let c = &self.cfg.ep;
        let (enter, form, exit, enter_hold, end_hold) = (c.enter_score, c.form_score, c.exit_score, c.enter_hold_ms, c.end_hold_ms);
        let has = ev.as_ref().map_or(false, |e| e.gate);
        let sc = if has { ev.as_ref().unwrap().score } else { 0.0 };
        let on = has && sc >= enter;
        let near = has && sc >= form;
        let ep = self.eps.tracks[ti].ep;
        let id = match ep {
            None => {
                let tr = &mut self.eps.tracks[ti];
                if near { if tr.run_since.is_none() { tr.run_since = Some(t); } tr.last_near = t; } else if tr.run_since.is_some() && t - tr.last_near > 2000.0 { tr.run_since = None; }
                if on {
                    if tr.on_since.is_none() { tr.on_since = Some(t); }
                    if t - tr.on_since.unwrap() >= enter_hold { let ev = ev.unwrap(); self.open_ep(ti, &ev, t); }
                } else { tr.on_since = None; }
                return;
            }
            Some(id) => id,
        };
        let holds = has && sc >= exit;
        if let Some(e) = &ev { self.refresh_ep(id, e, t); }
        let stage = self.eps.arena[&id].stage;
        if stage == Stage::Active {
            if !holds { { let ep = self.eps.arena.get_mut(&id).unwrap(); ep.stage = Stage::Fading; ep.fading_since = Some(t); } self.eps.tracks[ti].low_since = Some(t); self.notify(id, "fading"); }
        } else if on {
            { let ep = self.eps.arena.get_mut(&id).unwrap(); ep.stage = Stage::Active; ep.fading_since = None; } self.eps.tracks[ti].low_since = None; self.notify(id, "active");
        } else if holds { self.eps.tracks[ti].low_since = None; }
        else {
            if self.eps.tracks[ti].low_since.is_none() { self.eps.tracks[ti].low_since = Some(t); self.eps.arena.get_mut(&id).unwrap().fading_since = Some(t); }
            if t - self.eps.tracks[ti].low_since.unwrap() >= end_hold {
                let fs = self.eps.arena[&id].fading_since;
                let te = match fs { Some(x) if x != 0.0 && !x.is_nan() => x, _ => t };
                self.end_ep(ti, te, "faded");
            }
        }
    }
    pub fn eps_tick(&mut self, t: f64) {
        let hzs: Vec<Rc<str>> = self.cfg.ep.horizons.iter().map(|s| Rc::from(s.as_str())).collect();
        for vn in 0..2 {
            for hz in &hzs {
                for fam in 0..3 {
                    let c = &self.cfg.ep;
                    if !c.families[fam] { continue; }
                    if let Some(list) = &c.fam_horizons[fam] { if !list.iter().any(|x| **x == **hz) { continue; } }
                    for side in [Side::Buy, Side::Sell] { let ev = self.eval(fam, vn, hz, side, t); self.step(fam, vn, hz, side, ev, t); }
                }
            }
        }
        let stale = self.cfg.ep.wall_stale_ms;
        let mut i = 0;
        while i < self.eps.walls.len() {
            let (k, id) = self.eps.walls[i];
            if t - self.eps.arena[&id].t_seen > stale { self.close_wall(k, id, t, "left", None, None); } else { i += 1; }
        }
        self.resolve(t);
    }
    /// After the fact: what price did in the aggressor's direction after the episode faded. Never feeds back into a detection.
    fn resolve(&mut self, t: f64) {
        if self.eps.pend.is_empty() { return; }
        let (look, flat) = (self.cfg.ep.outcome_look_ms, self.cfg.ep.outcome_flat_sigma);
        let pend = std::mem::take(&mut self.eps.pend);
        let mut keep = Vec::new();
        for id in pend {
            let (venue, t_end, aggr) = { let ep = &self.eps.arena[&id]; (ep.venue, ep.t_end.unwrap_or(0.0), ep.aggressor) };
            if t < t_end + look { keep.push(id); continue; }
            let p0 = self.price_at(venue, t_end); let p1 = self.price_at(venue, t_end + look);
            let (p0, p1) = match (p0, p1) { (Some(a), Some(b)) if a > 0.0 && b > 0.0 => (a, b), _ => continue };
            let mv = (if aggr == Some(Side::Buy) { 1.0 } else { -1.0 }) * (p1 / p0 - 1.0) * 1e4 / (self.sigma_bps(venue) * (look / 1000.0).sqrt());
            let ep = self.eps.arena.get_mut(&id).unwrap();
            ep.resolution_sigma = Some(mv); if ep.res_order == 0 { ep.res_order = 2; }
            ep.resolution = Some(if mv >= flat { "resolved-with" } else if mv <= -flat { "resolved-against" } else { "flat" });
            self.notify(id, "resolved");
        }
        self.eps.pend = keep;
    }

    // ---- wall episodes: fed by the engine's wall tracker
    fn wall_items(&self, id: u32, ratio: f64, dist_bps: f64) -> Vec<Item> {
        let ep = &self.eps.arena[&id];
        let w = ep.wall.as_ref().unwrap();
        let th = self.th(self.cfg.wall_ratio);
        let age = ep.t_update - ep.t_start;
        vec![
            item("size", "size vs median level", ratio >= th, 2.0, format!("{} · {}", usd(w.peak * w.px), if ratio >= 100.0 { "100x+".to_string() } else { format!("{}x", fx(ratio, 1)) }), true),
            item("held", "held without being hit", age >= self.cfg.wall_confirm_ms, 1.5, format!("{} s", ns(js_round(age / 1000.0))), false),
            item("intact", "still near its peak size", w.size >= w.peak * self.cfg.ep.wall_fade_frac, 2.0, pct(w.size / w.peak), false),
            item("repost", "refilled after being hit", w.reposts >= self.cfg.ep.wall_reposts, 1.0, ns(w.reposts), false),
            item("near", "distance from mid", true, 0.0, format!("{} bps", fx(dist_bps, 1)), false),
        ]
    }
    pub fn eps_wall_update(&mut self, vn: usize, t: f64, w: &Wall, ratio: f64, mid: f64) {
        let key = (vn, w.side, w.px.to_bits());
        let mut fresh = false;
        let id = match self.eps.walls.iter().find(|x| x.0 == key) {
            Some(x) => x.1,
            None => {
                let c = &self.cfg.ep;
                if !c.families[FAM_WALL] || !self.is_calibrated() || t - w.born < c.wall_episode_ms { return; }
                let n = self.eps.walls.iter().filter(|x| { let o = &self.eps.arena[&x.1]; o.venue == vn && o.wall.as_ref().unwrap().side == w.side }).count() as f64;
                if n >= c.wall_max_active || ratio < self.th(self.cfg.wall_ratio) * c.wall_min_mult { return; }
                if w.peak * w.px < c.wall_min_usd { return; }
                if w.size <= w.peak * c.wall_fade_frac { return; }
                let merge = c.wall_merge_bps;
                let near = |o: &Ep| o.venue == vn && o.wall.as_ref().map_or(false, |x| x.side == w.side && (x.px - w.px).abs() / w.px * 1e4 <= merge);
                for x in &self.eps.walls { if near(&self.eps.arena[&x.1]) { return; } }
                let mut k = 0;
                for i in (0..self.eps.list.len()).rev() {
                    if k >= 40 { break; }
                    let o = &self.eps.arena[&self.eps.list[i]];
                    if o.fam != FAM_WALL { continue; }
                    k += 1;
                    if let Some(te) = o.t_end { if t - te <= c.wall_merge_ms && near(o) { return; } }
                }
                fresh = true;
                self.wall_open(vn, t, w, ratio)
            }
        };
        let th = self.th(self.cfg.wall_ratio);
        let fade = self.cfg.ep.wall_fade_frac;
        let stage = {
            let ep = self.eps.arena.get_mut(&id).unwrap();
            let x = ep.wall.as_mut().unwrap();
            x.size = w.size; x.peak = w.peak; x.ratio = ratio; x.reposts = if w.reposts != 0.0 && !w.reposts.is_nan() { w.reposts } else { 0.0 };
            ep.t_seen = t; ep.t_update = t;
            ep.intensity = clamp01(math::log2(sv_core::js::max(ratio, 1.0) / th) / 4.0);
            if ep.intensity > ep.peak { ep.peak = ep.intensity; }
            ep.stage
        };
        let fading = w.size <= w.peak * fade;
        let dist = (w.px - mid).abs() / mid * 1e4;
        if fading && stage == Stage::Active {
            { let ep = self.eps.arena.get_mut(&id).unwrap(); ep.stage = Stage::Fading; ep.fading_since = Some(t); }
            let items = self.wall_items(id, ratio, dist);
            { let ep = self.eps.arena.get_mut(&id).unwrap(); ep.evidence = Rc::new(items); ep.reading = Engine::reading_wall(ep); }
            self.notify(id, "fading");
        } else if !fading && stage == Stage::Fading {
            { let ep = self.eps.arena.get_mut(&id).unwrap(); ep.stage = Stage::Active; ep.fading_since = None; }
            self.notify(id, "active");
        }
        let items = self.wall_items(id, ratio, dist);
        { let ep = self.eps.arena.get_mut(&id).unwrap(); ep.evidence = Rc::new(items); ep.reading = Engine::reading_wall(ep); }
        if fresh { self.notify(id, "started"); }
    }
    fn wall_open(&mut self, vn: usize, t: f64, w: &Wall, ratio: f64) -> u32 {
        self.eps.seq += 1;
        let id = self.eps.seq;
        let ep = Ep { id, fam: FAM_WALL, venue: vn, horizon: Rc::from("book"), aggressor: None, passive: Some(if w.side == 0 { Side::Buy } else { Side::Sell }), stage: Stage::Active, pulses: 1.0,
            t_start: w.born, t_detected: t, t_end: None, peak: 0.0, intensity: 0.0, evidence: Rc::new(Vec::new()), facts: Facts::None, reading: String::new(), outcome: None, resumed_at: Vec::new(), trace: Default::default(),
            px: Some(w.px), px_start: w.px, t_update: t, t_seen: t, fading_since: None, peak_reading: None, peak_evidence: None, res_order: 0, resolution: None, resolution_sigma: None,
            wall: Some(WallEp { side: w.side, px: w.px, size: w.size, peak: w.peak, ratio, reposts: if w.reposts != 0.0 && !w.reposts.is_nan() { w.reposts } else { 0.0 }, traded_frac: None }) };
        self.eps.arena.insert(id, ep);
        self.eps.walls.push(((vn, w.side, w.px.to_bits()), id));
        self.eps.list.push(id);
        self.trim();
        id
    }
    fn close_wall(&mut self, key: (usize, usize, u64), id: u32, t: f64, outcome: &str, frac: Option<f64>, size: Option<f64>) {
        {
            let ep = self.eps.arena.get_mut(&id).unwrap();
            if let Some(s) = size { ep.wall.as_mut().unwrap().size = s; }
            ep.stage = Stage::Ended; ep.t_end = Some(t); ep.outcome = Some(Rc::from(outcome)); ep.fading_since = None; ep.wall.as_mut().unwrap().traded_frac = frac; ep.t_update = t;
            ep.reading = Engine::reading_wall(ep);
        }
        if let Some(j) = self.eps.walls.iter().position(|x| x.0 == key) { self.eps.walls.remove(j); }
        self.notify(id, "ended");
    }
    pub fn eps_wall_close(&mut self, vn: usize, t: f64, w: &Wall, outcome: &str, frac: f64, size: f64) {
        let key = (vn, w.side, w.px.to_bits());
        if let Some(x) = self.eps.walls.iter().find(|x| x.0 == key) { let id = x.1; self.close_wall(key, id, t, outcome, Some(frac), Some(size)); }
    }
    pub fn eps_note_refresh(&mut self, vn: usize, side: Side, t: f64) { if side != Side::Other { self.eps.refresh[vn][si(side)] = t; } }
    pub fn eps_close_all(&mut self, t: f64, reason: &str) {
        for ti in 0..self.eps.tracks.len() { if self.eps.tracks[ti].ep.is_some() { self.end_ep(ti, t, reason); } }
        let walls = self.eps.walls.clone();
        for (k, id) in walls { self.close_wall(k, id, t, reason, None, None); }
        self.eps.tracks.clear(); self.eps.pend.clear();
    }
    pub fn eps_set_family(&mut self, name: &str, on: bool) {
        let f = match FAMS.iter().position(|x| *x == name) { Some(f) => f, None => return };
        self.cfg.ep.families[f] = on;
        if !on {
            for ti in 0..self.eps.tracks.len() {
                if self.eps.tracks[ti].fam == f { if let Some(id) = self.eps.tracks[ti].ep { let tu = self.eps.arena[&id].t_update; self.end_ep(ti, tu, "disabled"); } }
            }
        }
    }

    // ---- views
    pub fn active_count(&self) -> usize { self.eps.list.iter().filter(|id| self.eps.arena[id].stage != Stage::Ended).count() }
    fn items_json(w: &mut W, items: &[Item]) {
        w.open('[');
        for it in items {
            w.open('{'); w.ks("k", it.k); w.ks("label", it.label); w.kb("ok", it.ok); w.kn("w", it.w); w.ks("val", &it.val);
            if it.na { w.kb("na", true); } else { w.kb("gate", it.gate); }
            w.close('}');
        }
        w.close(']');
    }
    fn facts_json(w: &mut W, f: &Facts) {
        w.open('{');
        match f {
            Facts::Abs { share, z, prog, eff, refill, d_side, open, secs, rate_usd } => { w.kn("share", *share); w.kn("z", *z); w.kn("prog", *prog); w.kn("eff", *eff); w.ko("refill", *refill); w.ks("dSide", BOOK_SIDES[*d_side]); w.kn("open", *open); w.kn("secs", *secs); w.kn("rate$", *rate_usd); }
            Facts::Exh { ratio, z_was, gap, away, prog, poke, side, open, secs } => { w.kn("ratio", *ratio); w.kn("zWas", *z_was); w.kn("gap", *gap); w.kn("away", *away); w.kn("prog", *prog); w.kb("poke", *poke); w.ks("side", side.name()); w.kn("open", *open); w.kn("secs", *secs); }
            Facts::Burst { z, share, prog, liq, sweeps, secs, notional, open } => { w.kn("z", *z); w.kn("share", *share); w.kn("prog", *prog); w.kn("liq", *liq); w.kn("sweeps", *sweeps); w.kn("secs", *secs); w.kn("notional", *notional); w.kn("open", *open); }
            Facts::None => {}
        }
        w.close('}');
    }
    fn wall_json(w: &mut W, x: &WallEp) {
        w.open('{'); w.ks("side", BOOK_SIDES[x.side]); w.kn("px", x.px); w.kn("size", x.size); w.kn("peak", x.peak); w.kn("ratio", x.ratio); w.kn("reposts", x.reposts); w.ko("tradedFrac", x.traded_frac); w.close('}');
    }
    fn nums_json(w: &mut W, v: &[f64]) { w.open('['); for x in v { w.num(*x); } w.close(']'); }
    pub fn ep_json(&self, w: &mut W, id: u32) {
        let ep = &self.eps.arena[&id];
        let wall = ep.fam == FAM_WALL;
        w.open('{');
        w.kn("id", ep.id as f64); w.ks("family", FAMS[ep.fam]);
        match &ep.wall { Some(x) if wall => w.ks("kind", &format!("{} wall", BOOK_SIDES[x.side])), _ => w.ks("kind", FAMS[ep.fam]) }
        w.ks("venue", VN[ep.venue]); w.ks("horizon", &ep.horizon); w.kos("aggressor", ep.aggressor.map(|s| s.name())); w.kos("passive", ep.passive.map(|s| s.name()));
        w.ks("stage", ep.stage.name()); w.kn("pulses", ep.pulses); w.kn("tStart", ep.t_start); w.kn("tDetected", ep.t_detected); w.ko("tEnd", ep.t_end); w.kn("peak", ep.peak); w.kn("intensity", ep.intensity);
        w.key("evidence"); Engine::items_json(w, &ep.evidence);
        w.key("facts"); Engine::facts_json(w, &ep.facts);
        w.ks("reading", &ep.reading); w.kos("outcome", ep.outcome.as_deref());
        w.key("resumedAt"); Engine::nums_json(w, &ep.resumed_at);
        w.key("trace"); w.open('['); for (a, b) in &ep.trace { w.open('['); w.num(*a); w.num(*b); w.close(']'); } w.close(']');
        w.ko("px", ep.px); w.kn("pxStart", ep.px_start); w.kn("tUpdate", ep.t_update);
        if wall { w.kn("tSeen", ep.t_seen); }
        w.ko("fadingSince", ep.fading_since);
        if wall { w.key("wall"); Engine::wall_json(w, ep.wall.as_ref().unwrap()); }
        if let Some(r) = &ep.peak_reading { w.ks("peakReading", r); }
        if let Some(e) = &ep.peak_evidence { w.key("peakEvidence"); Engine::items_json(w, e); }
        match ep.res_order {
            1 => { w.kos("resolution", ep.resolution); w.ko("resolutionSigma", ep.resolution_sigma); }
            2 => { w.ko("resolutionSigma", ep.resolution_sigma); w.kos("resolution", ep.resolution); }
            _ => {}
        }
        w.close('}');
    }
    pub fn episodes_json(&self, w: &mut W, active_only: bool) {
        w.open('[');
        for id in &self.eps.list { if !active_only || self.eps.arena[id].stage != Stage::Ended { self.ep_json(w, *id); } }
        w.close(']');
    }
    pub fn forming_json(&self, w: &mut W, t: f64) {
        let form = self.cfg.ep.form_score;
        w.open('[');
        for tr in &self.eps.tracks {
            let ev = match &tr.last { Some(e) => e, None => continue };
            if tr.ep.is_some() || tr.run_since.is_none() || t - tr.last_t > 2000.0 || !ev.gate || ev.score < form { continue; }
            let passive = if tr.fam == FAM_ABS { Some(tr.side.opp()) } else { None };
            w.open('{');
            w.ks("id", &format!("f|{}", tr.key())); w.ks("family", FAMS[tr.fam]); w.ks("kind", FAMS[tr.fam]); w.ks("venue", VN[tr.vn]); w.ks("horizon", &tr.hz); w.ks("aggressor", tr.side.name()); w.kos("passive", passive.map(|s| s.name()));
            w.ks("stage", "forming"); w.kn("pulses", 0.0); w.ko("tStart", tr.run_since); w.null_key("tDetected"); w.null_key("tEnd"); w.kn("peak", ev.score); w.kn("intensity", ev.score);
            w.key("evidence"); Engine::items_json(w, &ev.items); w.key("facts"); Engine::facts_json(w, &ev.facts); w.ks("reading", &self.reading_of(tr.fam, tr.side, &ev.facts)); w.null_key("outcome"); w.kn("px", ev.px); w.kn("tUpdate", tr.last_t);
            w.close('}');
        }
        w.close(']');
    }
    /// Groups: one phenomenon seen on several venues / horizons (same family and aggressor, another venue or horizon, time spans within groupGapMs). Walls are a group of one.
    pub fn groups_json(&self, w: &mut W) {
        let gap = self.cfg.ep.group_gap_ms;
        let a = &self.eps.arena;
        let mut list: Vec<&Ep> = self.eps.list.iter().map(|id| &a[id]).collect();
        list.sort_by(|x, y| { let d = x.t_start - y.t_start; let d = if d != 0.0 && !d.is_nan() { d } else { x.id as f64 - y.id as f64 }; d.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal) });
        let n = list.len();
        let mut par: Vec<usize> = (0..n).collect();
        fn find(par: &mut Vec<usize>, mut i: usize) -> usize { while par[i] != i { par[i] = par[par[i]]; i = par[i]; } i }
        let end_of = |e: &Ep| e.t_end.unwrap_or(e.t_update);
        for i in 0..n {
            let x = list[i]; if x.fam == FAM_WALL { continue; }
            for j in i + 1..n {
                let y = list[j];
                if y.t_start > end_of(x) + gap { break; }
                if y.fam != x.fam || y.aggressor != x.aggressor || (y.venue == x.venue && *y.horizon == *x.horizon) { continue; }
                if y.t_start <= end_of(x) + gap && x.t_start <= end_of(y) + gap { let rj = find(&mut par, j); let ri = find(&mut par, i); par[rj] = ri; }
            }
        }
        let mut order: Vec<usize> = Vec::new();
        let mut by: HashMap<usize, Vec<usize>> = HashMap::new();
        for i in 0..n { let r = find(&mut par, i); if !by.contains_key(&r) { order.push(r); } by.entry(r).or_default().push(i); }
        struct G<'a> { prim: &'a Ep, m: Vec<&'a Ep>, t_start: f64 }
        let mut out: Vec<G> = Vec::new();
        for r in order {
            let m: Vec<&Ep> = by[&r].iter().map(|&i| list[i]).collect();
            let mut prim = m[0]; for y in &m[1..] { if y.t_detected < prim.t_detected || (y.t_detected == prim.t_detected && y.id < prim.id) { prim = y; } }
            let t_start = m.iter().map(|e| e.t_start).fold(f64::INFINITY, sv_core::js::min);
            out.push(G { prim, m, t_start });
        }
        out.sort_by(|x, y| { let d = x.t_start - y.t_start; let d = if d != 0.0 && !d.is_nan() { d } else { x.prim.id as f64 - y.prim.id as f64 }; d.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal) });
        w.open('[');
        for g in &out {
            let m = &g.m;
            let mut lead = m[0]; for y in &m[1..] { if y.peak > lead.peak { lead = y; } }
            let mut stage = Stage::Ended; for y in m { if y.stage.rank() > stage.rank() { stage = y.stage; } }
            let ended = stage == Stage::Ended;
            let maxf = |f: &dyn Fn(&Ep) -> f64| m.iter().map(|e| f(e)).fold(f64::NEG_INFINITY, sv_core::js::max);
            let minf = |f: &dyn Fn(&Ep) -> f64| m.iter().map(|e| f(e)).fold(f64::INFINITY, sv_core::js::min);
            w.open('{');
            w.ks("id", &format!("g{}", g.prim.id)); w.kn("primary", g.prim.id as f64);
            w.key("members"); w.open('['); for e in m { self.ep_json(w, e.id); } w.close(']');
            w.ks("family", FAMS[lead.fam]);
            match &lead.wall { Some(x) if lead.fam == FAM_WALL => w.ks("kind", &format!("{} wall", BOOK_SIDES[x.side])), _ => w.ks("kind", FAMS[lead.fam]) }
            w.kos("aggressor", lead.aggressor.map(|s| s.name())); w.kos("passive", lead.passive.map(|s| s.name())); w.ks("venue", VN[lead.venue]); w.ks("horizon", &lead.horizon);
            let mut vs: Vec<&str> = Vec::new(); for e in m { if !vs.contains(&VN[e.venue]) { vs.push(VN[e.venue]); } } vs.sort();
            w.key("venues"); w.open('['); for v in vs { w.str(v); } w.close(']');
            let mut hs: Vec<&str> = Vec::new(); for e in m { if !hs.contains(&&*e.horizon) { hs.push(&e.horizon); } }
            w.key("horizons"); w.open('['); for h in hs { w.str(h); } w.close(']');
            w.ks("stage", stage.name()); w.kn("pulses", maxf(&|e| e.pulses)); w.kn("tStart", minf(&|e| e.t_start)); w.kn("tDetected", minf(&|e| e.t_detected));
            if ended { w.kn("tEnd", maxf(&|e| e.t_end.unwrap_or(0.0))); } else { w.null_key("tEnd"); }
            w.kn("tUpdate", maxf(&|e| e.t_update)); w.kn("peak", maxf(&|e| e.peak)); w.kn("intensity", maxf(&|e| e.intensity));
            let mut ra: Vec<f64> = m.iter().flat_map(|e| e.resumed_at.iter().copied()).collect();
            ra.sort_by(|a, b| (a - b).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
            w.key("resumedAt"); Engine::nums_json(w, &ra);
            w.ks("reading", &lead.reading);
            if let Some(r) = &lead.peak_reading { w.ks("peakReading", r); }
            w.key("evidence"); Engine::items_json(w, &lead.evidence);
            if let Some(e) = &lead.peak_evidence { w.key("peakEvidence"); Engine::items_json(w, e); }
            w.key("facts"); Engine::facts_json(w, &lead.facts);
            if let Some(x) = &lead.wall { w.key("wall"); Engine::wall_json(w, x); }
            w.ko("px", lead.px);
            if ended { w.kos("outcome", lead.outcome.as_deref()); } else { w.null_key("outcome"); }
            w.kos("resolution", lead.resolution); w.ko("resolutionSigma", lead.resolution_sigma);
            w.close('}');
        }
        w.close(']');
    }
}
impl W { pub fn null_key(&mut self, k: &str) { self.key(k); self.null(); } }
