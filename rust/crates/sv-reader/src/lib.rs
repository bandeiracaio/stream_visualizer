//! The Market Reader (src/js/reader-engine.js and src/js/reader-episodes.js) as Rust: the order-flow engine, its one-off signals and the episode layer, ported line for line.
//! Pure: no clock, no randomness, no I/O; exchange timestamps drive it. Every call into the statistics cache (`stat`, `sigma_bps`, `robust_z`) happens where and when the JS makes it,
//! because the cache refreshes on the engine's clock and a call that the JS does not make (or skips) would move a later detection.
//! Numbers keep the JS order of operations; Math.exp / Math.log / Math.log2 are the host's (sv_core::math); readings are written with the JS toFixed / String rules (out.rs).
//! JS values: a missing price is `None` (JS null); `null` in an input reads as JS null does (0 in arithmetic, never > 0). Venues are bn = 0, hl = 1.
pub mod eps;
pub mod ops;
pub mod out;

use out::{fx, ns, short_wallet, W};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use sv_core::js::{to_number, truthy, to_string};
use sv_core::{js_round, math};

pub const VN: [&str; 2] = ["bn", "hl"];
pub fn venue_of(v: Option<&Value>) -> Option<usize> { match v { Some(Value::String(s)) if s == "bn" => Some(0), Some(Value::String(s)) if s == "hl" => Some(1), _ => None } }

pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 { sv_core::js::min(hi, sv_core::js::max(x, lo)) }
pub fn clamp01(x: f64) -> f64 { clamp(x, 0.0, 1.0) }
fn mx(a: f64, b: f64) -> f64 { sv_core::js::max(a, b) }
fn mn(a: f64, b: f64) -> f64 { sv_core::js::min(a, b) }

/// The side of a trade: "buy", "sell" or anything else (which the JS counts as a sell in the flows and as itself in comparisons).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side { Buy, Sell, Other }
impl Side {
    pub fn of(v: Option<&Value>) -> Side { match v { Some(Value::String(s)) if s == "buy" => Side::Buy, Some(Value::String(s)) if s == "sell" => Side::Sell, _ => Side::Other } }
    pub fn name(self) -> &'static str { match self { Side::Buy => "buy", Side::Sell => "sell", Side::Other => "other" } }
    pub fn opp(self) -> Side { if self == Side::Buy { Side::Sell } else { Side::Buy } }
}

pub const DETECTORS: [&str; 7] = ["wall_appears", "wall_pulled", "wall_eaten", "book_thin", "imbalance_flip", "refreshing_level", "failed_poke"];
pub const FAMS: [&str; 4] = ["absorption", "exhaustion", "burst", "wall"];

// ---------------------------------------------------------------- configuration (the merged cfg the JS engine builds; the wrapper sends it whole)
#[derive(Clone, Debug)]
pub struct EpCfg {
    pub enter_score: f64, pub form_score: f64, pub exit_score: f64, pub enter_hold_ms: f64, pub end_hold_ms: f64, pub resume_ms: f64,
    pub keep_episodes: f64, pub wall_fade_frac: f64, pub wall_stale_ms: f64, pub wall_episode_ms: f64, pub wall_min_mult: f64, pub keep_walls: f64, pub wall_max_active: f64,
    pub wall_merge_bps: f64, pub wall_merge_ms: f64, pub wall_min_usd: f64, pub min_trades_fast: f64, pub min_trades_mid: f64, pub refresh_ms: f64, pub poke_ms: f64, pub trace_cap: f64,
    pub horizons: Vec<String>, pub fam_horizons: [Option<Vec<String>>; 3], pub families: [bool; 4],
    pub recent_share: f64, pub recent_pace: f64, pub cross_share: f64, pub cross_z: f64, pub burst_liq: f64, pub burst_sweeps: f64,
    pub exh_decay: f64, pub exh_was_z: f64, pub exh_was_share: f64, pub exh_gap: f64, pub exh_near: f64, pub exh_size: f64, pub abs_adverse: f64,
    pub abs_conc: f64, pub exh_count: f64, pub wall_reposts: f64, pub wall_dip: f64, pub wall_back: f64,
    pub outcome_look_ms: f64, pub outcome_flat_sigma: f64, pub group_gap_ms: f64,
}
#[derive(Clone, Debug)]
pub struct Cfg {
    pub bucket_ms: f64, pub sigma_lag_ms: f64, pub sigma_fast_n: f64, pub sigma_fast_w: f64, pub z_other_frac: f64, pub z_cap: f64, pub keep_ms: f64, pub warmup_ms: f64, pub base_tau_ms: f64,
    pub horizons: Vec<(String, f64)>, pub min_window_ms: f64, pub max_window_ms: f64,
    pub gap_reset_ms: f64, pub cooldown_ms: f64, pub max_events_per_min: f64, pub keep_events: f64, pub sens: f64,
    pub detectors: [bool; 7],
    pub wall_ratio: f64, pub wall_min_levels: f64, pub wall_bps: f64, pub wall_confirm_ms: f64, pub wall_drop_frac: f64, pub wall_eat_frac: f64, pub wall_pulled_frac: f64,
    pub thin_frac: f64, pub thin_bps: f64, pub imb_top: f64, pub imb_enter: f64, pub imb_exit: f64, pub imb_hold_ms: f64,
    pub burst_z: f64, pub burst_share: f64, pub burst_sigma: f64,
    pub absorb_z: f64, pub absorb_share: f64, pub absorb_sigma: f64, pub absorb_efficiency: f64, pub absorb_refill: f64,
    pub refresh_trades: f64, pub refresh_visible_mult: f64, pub refresh_span_ms: f64, pub wallet_share: f64, pub wallet_trades: f64, pub wallet_secs: f64, pub poke_return_ms: f64, pub poke_sigma: f64,
    pub ep: EpCfg,
}
fn names(v: Option<&Value>) -> Vec<String> { match v { Some(Value::Array(a)) => a.iter().map(|x| to_string(Some(x))).collect(), _ => Vec::new() } }
impl Cfg {
    /// The cfg object as the wrapper sends it: the JS engine's merged cfg, with `horizons` as [[name, ms], ...] (Object.entries keeps the key order; a JSON object would not).
    /// Numbers read as `+x` (null is 0, a missing key is NaN; the wrapper writes NaN and +/-Infinity as their text).
    pub fn from(v: &Value) -> Cfg {
        let n = |k: &str| to_number(v.get(k));
        let e = v.get("ep").cloned().unwrap_or(Value::Null);
        let en = |k: &str| to_number(e.get(k));
        let horizons = match v.get("horizons") { Some(Value::Array(a)) => a.iter().map(|p| (to_string(p.get(0)), to_number(p.get(1)))).collect(), _ => Vec::new() };
        let det = v.get("detectors");
        let fh = e.get("famHorizons");
        let fam_h = |f: &str| match fh.and_then(|o| o.get(f)) { Some(Value::Array(a)) => Some(a.iter().map(|x| to_string(Some(x))).collect()), _ => None };
        let fams = e.get("families");
        Cfg {
            bucket_ms: n("bucketMs"), sigma_lag_ms: n("sigmaLagMs"), sigma_fast_n: n("sigmaFastN"), sigma_fast_w: n("sigmaFastW"), z_other_frac: n("zOtherFrac"), z_cap: n("zCap"), keep_ms: n("keepMs"), warmup_ms: n("warmupMs"), base_tau_ms: n("baseTauMs"),
            horizons, min_window_ms: n("minWindowMs"), max_window_ms: n("maxWindowMs"),
            gap_reset_ms: n("gapResetMs"), cooldown_ms: n("cooldownMs"), max_events_per_min: n("maxEventsPerMin"), keep_events: n("keepEvents"), sens: n("sens"),
            detectors: DETECTORS.map(|d| truthy(det.and_then(|o| o.get(d)))),
            wall_ratio: n("wallRatio"), wall_min_levels: n("wallMinLevels"), wall_bps: n("wallBps"), wall_confirm_ms: n("wallConfirmMs"), wall_drop_frac: n("wallDropFrac"), wall_eat_frac: n("wallEatFrac"), wall_pulled_frac: n("wallPulledFrac"),
            thin_frac: n("thinFrac"), thin_bps: n("thinBps"), imb_top: n("imbTop"), imb_enter: n("imbEnter"), imb_exit: n("imbExit"), imb_hold_ms: n("imbHoldMs"),
            burst_z: n("burstZ"), burst_share: n("burstShare"), burst_sigma: n("burstSigma"),
            absorb_z: n("absorbZ"), absorb_share: n("absorbShare"), absorb_sigma: n("absorbSigma"), absorb_efficiency: n("absorbEfficiency"), absorb_refill: n("absorbRefill"),
            refresh_trades: n("refreshTrades"), refresh_visible_mult: n("refreshVisibleMult"), refresh_span_ms: n("refreshSpanMs"), wallet_share: n("walletShare"), wallet_trades: n("walletTrades"), wallet_secs: n("walletSecs"), poke_return_ms: n("pokeReturnMs"), poke_sigma: n("pokeSigma"),
            ep: EpCfg {
                enter_score: en("enterScore"), form_score: en("formScore"), exit_score: en("exitScore"), enter_hold_ms: en("enterHoldMs"), end_hold_ms: en("endHoldMs"), resume_ms: en("resumeMs"),
                keep_episodes: en("keepEpisodes"), wall_fade_frac: en("wallFadeFrac"), wall_stale_ms: en("wallStaleMs"), wall_episode_ms: en("wallEpisodeMs"), wall_min_mult: en("wallMinMult"), keep_walls: en("keepWalls"), wall_max_active: en("wallMaxActive"),
                wall_merge_bps: en("wallMergeBps"), wall_merge_ms: en("wallMergeMs"), wall_min_usd: en("wallMinUsd"), min_trades_fast: en("minTradesFast"), min_trades_mid: en("minTradesMid"), refresh_ms: en("refreshMs"), poke_ms: en("pokeMs"), trace_cap: en("traceCap"),
                horizons: names(e.get("horizons")), fam_horizons: [fam_h("absorption"), fam_h("exhaustion"), fam_h("burst")], families: FAMS.map(|f| truthy(fams.and_then(|o| o.get(f)))),
                recent_share: en("recentShare"), recent_pace: en("recentPace"), cross_share: en("crossShare"), cross_z: en("crossZ"), burst_liq: en("burstLiq"), burst_sweeps: en("burstSweeps"),
                exh_decay: en("exhDecay"), exh_was_z: en("exhWasZ"), exh_was_share: en("exhWasShare"), exh_gap: en("exhGap"), exh_near: en("exhNear"), exh_size: en("exhSize"), abs_adverse: en("absAdverse"),
                abs_conc: en("absConc"), exh_count: en("exhCount"), wall_reposts: en("wallReposts"), wall_dip: en("wallDip"), wall_back: en("wallBack"),
                outcome_look_ms: en("outcomeLookMs"), outcome_flat_sigma: en("outcomeFlatSigma"), group_gap_ms: en("groupGapMs"),
            },
        }
    }
}

// ---------------------------------------------------------------- state
#[derive(Clone, Copy, Debug)]
pub struct Bucket {
    pub t0: f64, pub buy: f64, pub sell: f64, pub n: f64, pub max_trade: f64, pub open: Option<f64>, pub hi: Option<f64>, pub lo: Option<f64>, pub close: Option<f64>,
    pub liq_buy_n: f64, pub liq_sell_n: f64, pub sweep_buy_n: f64, pub sweep_sell_n: f64, pub bid_depth: f64, pub ask_depth: f64, pub spread: Option<f64>,
}
#[derive(Clone, Debug)]
pub struct Stat { pub n: usize, pub med: f64, pub mad: f64, pub q75: Option<f64>, pub q75f: Option<f64>, pub at: f64 }
#[derive(Clone, Debug)]
pub struct Recent { pub t: f64, pub px: f64, pub q: f64, pub ntl: f64, pub side: Side, pub user: Option<String> }
#[derive(Clone, Debug)]
pub struct Wall { pub side: usize, pub px: f64, pub born: f64, pub peak: f64, pub size: f64, pub low: f64, pub reposts: f64, pub ratio: f64, pub confirmed: bool }
#[derive(Clone, Debug)]
pub struct Flow { pub t0: f64, pub count: f64, pub q: f64, pub ntl: f64, pub visible: f64, pub emitted: bool }
#[derive(Clone, Copy, Debug)]
pub struct Poke { pub t: f64, pub level: f64, pub px: f64 }
pub const BOOK_SIDES: [&str; 2] = ["bid", "ask"];

#[derive(Clone, Debug)]
pub struct Venue {
    pub px: Option<f64>, pub mid: Option<f64>, pub spread: Option<f64>, pub cur: Bucket, pub ring: VecDeque<Bucket>, pub base: f64, pub base_n: f64,
    pub samples: [VecDeque<f64>; 3], pub stats: [Option<Stat>; 3], pub depth: [f64; 2], pub depth_ring: [VecDeque<f64>; 2], pub imb: f64, pub book_mid: Option<f64>,
    pub bids: Vec<(f64, f64)>, pub asks: Vec<(f64, f64)>, pub book_t: f64, pub recent: VecDeque<Recent>, pub walls: Vec<((usize, u64), Wall)>, pub wall_max: f64,
    pub imb_state: f64, pub imb_pending: f64, pub imb_pending_since: f64, pub last_imb_lean: f64, pub level_flow: Vec<((Side, u64), Flow)>, pub pokes: [Option<Poke>; 2], pub last_poke_fail: Option<(f64, usize)>,
    pub px_hist: VecDeque<(f64, f64)>,
}
pub const BUY: usize = 0;
pub const SELL: usize = 1;
pub const RET: usize = 2;
fn empty_bucket() -> Bucket { Bucket { t0: 0.0, buy: 0.0, sell: 0.0, n: 0.0, max_trade: 0.0, open: None, hi: None, lo: None, close: None, liq_buy_n: 0.0, liq_sell_n: 0.0, sweep_buy_n: 0.0, sweep_sell_n: 0.0, bid_depth: 0.0, ask_depth: 0.0, spread: None } }
impl Venue {
    fn new() -> Venue {
        Venue { px: None, mid: None, spread: None, cur: empty_bucket(), ring: VecDeque::new(), base: 0.0, base_n: 0.0, samples: Default::default(), stats: Default::default(), depth: [0.0, 0.0], depth_ring: Default::default(),
            imb: 0.0, book_mid: None, bids: Vec::new(), asks: Vec::new(), book_t: 0.0, recent: VecDeque::new(), walls: Vec::new(), wall_max: 0.0, imb_state: 0.0, imb_pending: 0.0, imb_pending_since: 0.0, last_imb_lean: 0.0,
            level_flow: Vec::new(), pokes: [None, None], last_poke_fail: None, px_hist: VecDeque::new() }
    }
}

/// horizon(): the sums over the latest `ms` of buckets
#[derive(Clone, Copy, Debug)]
pub struct H {
    pub ms: f64, pub buy: f64, pub sell: f64, pub n: f64, pub max_trade: f64, pub hi: f64, pub lo: f64, pub open: f64, pub close: f64,
    pub liq_buy_n: f64, pub liq_sell_n: f64, pub sweep_buy_n: f64, pub sweep_sell_n: f64, pub share: f64, pub delta: f64,
}

#[derive(Clone, Debug)]
pub struct WalletEv { pub who: String, pub share: f64, pub count: f64 }
#[derive(Clone, Debug)]
pub enum Refs { Poke { level: f64, extreme: f64 }, Refresh { trades: f64, traded: f64, visible: f64, wallet: Option<WalletEv> }, Wall { side: usize, size: f64, ratio: f64 }, Imb { imb: f64 }, Thin { cur: f64, med: f64 } }
#[derive(Clone, Debug)]
pub struct Event { pub t: f64, pub ty: usize, pub family: &'static str, pub dir: &'static str, pub venue: usize, pub px: Option<f64>, pub horizon: &'static str, pub strength: f64, pub refs: Refs, pub evidence: String, pub id: u32 }

pub struct Engine {
    pub cfg: Cfg,
    pub events: Vec<Event>, pub seq: u32, pub now: f64, pub first_t: Option<f64>, pub cur_start: Option<f64>, pub venues: [Venue; 2], last_emit: HashMap<(usize, usize, bool, u64), f64>,
    pub eps: eps::Eps,
    pub listen_eps: bool, pub listen_ev: bool, pub notes: Vec<String>,
}

fn sorted_copy(a: &VecDeque<f64>) -> Vec<f64> {
    // Float64Array#sort: ascending, -0 before +0, NaN last
    let mut f: Vec<f64> = a.iter().copied().collect();
    f.sort_unstable_by(|x, y| match (x.is_nan(), y.is_nan()) { (true, true) => std::cmp::Ordering::Equal, (true, false) => std::cmp::Ordering::Greater, (false, true) => std::cmp::Ordering::Less, _ => x.total_cmp(y) });
    f
}
/// (a,b)=>a-b on numbers that are never NaN (depths and sizes); stable
fn sort_num(v: &mut [f64]) { v.sort_by(|a, b| { let d = a - b; if d < 0.0 { std::cmp::Ordering::Less } else if d > 0.0 { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal } }); }
fn kth_dev(s: &[f64], med: f64, k: usize) -> f64 {
    let n = s.len() as isize;
    let (mut l, mut r, mut d) = ((n >> 1) as isize, (n >> 1) as isize + 1, 0.0);
    for _ in 0..=k {
        let dl = if l >= 0 { med - s[l as usize] } else { f64::INFINITY };
        let dr = if r < n { s[r as usize] - med } else { f64::INFINITY };
        if dl <= dr { d = dl; l -= 1; } else { d = dr; r += 1; }
    }
    d
}
fn q75of(a: &VecDeque<f64>) -> f64 { let s = sorted_copy(a); let med = s[s.len() >> 1]; kth_dev(&s, med, (s.len() as f64 * 0.75).floor() as usize) / 1.1503 }
fn push_cap(a: &mut VecDeque<f64>, x: f64, n: usize) { a.push_back(x); if a.len() > n { a.pop_front(); } }
fn num_of(v: Option<&Value>) -> f64 { to_number(v) }

impl Engine {
    pub fn new(cfg: Cfg) -> Engine {
        let mut e = Engine { cfg, events: Vec::new(), seq: 0, now: 0.0, first_t: None, cur_start: None, venues: [Venue::new(), Venue::new()], last_emit: HashMap::new(), eps: eps::Eps::default(), listen_eps: false, listen_ev: false, notes: Vec::new() };
        e.reset();
        e
    }
    pub fn reset(&mut self) {
        self.eps_reset();
        self.events = Vec::new(); self.seq = 0; self.now = 0.0; self.first_t = None; self.cur_start = None; self.last_emit = HashMap::new(); self.venues = [Venue::new(), Venue::new()];
    }
    fn open_bucket(&mut self, k: usize, t0: f64) {
        let v = &mut self.venues[k];
        let p = v.px;
        v.cur = Bucket { t0, buy: 0.0, sell: 0.0, n: 0.0, max_trade: 0.0, open: p, hi: p, lo: p, close: p, liq_buy_n: 0.0, liq_sell_n: 0.0, sweep_buy_n: 0.0, sweep_sell_n: 0.0, bid_depth: v.depth[0], ask_depth: v.depth[1], spread: v.spread };
    }
    fn touch(&mut self, k: usize, p: f64) {
        if !(p > 0.0) { return; }
        let v = &mut self.venues[k];
        v.px = Some(p);
        let c = &mut v.cur;
        if c.open.is_none() { c.open = Some(p); c.hi = Some(p); c.lo = Some(p); } else { if p > c.hi.unwrap_or(0.0) { c.hi = Some(p); } if p < c.lo.unwrap_or(0.0) { c.lo = Some(p); } }
        c.close = Some(p);
    }
    pub fn is_calibrated(&self) -> bool { self.first_t.is_some() && self.now - self.first_t.unwrap() >= self.cfg.warmup_ms && self.venues[0].base_n > 0.0 }
    fn sample(&mut self, k: usize) {
        if self.venues[k].ring.len() < 8 { return; }
        if let Some(h) = self.horizon(k, "fast") {
            let s = h.ms / 1000.0;
            let v = &mut self.venues[k];
            push_cap(&mut v.samples[BUY], h.buy / s, 1800); push_cap(&mut v.samples[SELL], h.sell / s, 1800);
        }
        let lag = mx(4.0, js_round(self.cfg.sigma_lag_ms / self.cfg.bucket_ms));
        let v = &mut self.venues[k];
        let n = v.ring.len();
        if (n as f64) > lag {
            let li = n - 1 - lag as usize;
            if v.ring[li].close.map_or(false, |c| c > 0.0) {
                let x = (v.ring[n - 1].close.unwrap_or(0.0) / v.ring[li].close.unwrap() - 1.0) * 1e4;
                push_cap(&mut v.samples[RET], x, 1800);
            }
        }
        let (b, a) = (v.depth[0], v.depth[1]);
        push_cap(&mut v.depth_ring[0], b, 30); push_cap(&mut v.depth_ring[1], a, 30);
    }
    pub fn stat(&mut self, k: usize, key: usize) -> Stat {
        let now = self.now;
        let fast_n = self.cfg.sigma_fast_n;
        let v = &mut self.venues[k];
        let arr = &v.samples[key];
        if arr.len() < 30 { return Stat { n: arr.len(), med: 0.0, mad: 0.0, q75: None, q75f: None, at: now }; }
        if let Some(c) = &v.stats[key] { if now - c.at < 5000.0 { return c.clone(); } }
        let s = sorted_copy(arr);
        let med = s[s.len() >> 1];
        let mut o = Stat { n: arr.len(), med, mad: 1.4826 * kth_dev(&s, med, s.len() >> 1), q75: Some(kth_dev(&s, med, (s.len() as f64 * 0.75).floor() as usize) / 1.1503), q75f: None, at: now };
        if key == RET && fast_n > 0.0 && arr.len() as f64 >= fast_n { let m = fast_n as usize; let tail: VecDeque<f64> = arr.iter().skip(arr.len() - m.min(arr.len())).copied().collect(); o.q75f = Some(q75of(&tail)); }
        v.stats[key] = Some(o.clone());
        o
    }
    fn blend_sigma(&self, slow: f64, fast: Option<f64>) -> f64 {
        if !(self.cfg.sigma_fast_n > 0.0) || fast.is_none() { return slow; }
        let f = fast.unwrap();
        ((1.0 - self.cfg.sigma_fast_w) * slow * slow + self.cfg.sigma_fast_w * f * f).sqrt()
    }
    pub fn robust_z(&mut self, x: f64, k: usize, key: usize, floor: f64) -> f64 {
        let st = self.stat(k, key);
        if st.n < 60 { return 0.0; }
        let om = if key == BUY { self.stat(k, SELL).med } else if key == SELL { self.stat(k, BUY).med } else { 0.0 };
        let d = mx(mx(mx(st.mad, 0.1 * st.med.abs()), self.cfg.z_other_frac * om.abs()), floor);
        mn(self.cfg.z_cap, (x - st.med) / d)
    }
    pub fn sigma_bps(&mut self, k: usize) -> f64 {
        let st = self.stat(k, RET);
        if st.n < 60 { return 0.05; }
        let r = (self.cfg.sigma_lag_ms / 1000.0).sqrt();
        mx(self.blend_sigma(st.q75.unwrap_or(f64::NAN) / r, st.q75f.map(|f| f / r)), 0.05)
    }
    pub fn sigma_peek(&self, k: usize) -> f64 {
        let v = &self.venues[k];
        let arr = &v.samples[RET];
        if arr.len() < 60 { return 0.05; }
        let (q75, q75f);
        match &v.stats[RET] {
            Some(c) if self.now - c.at < 5000.0 => { q75 = c.q75.unwrap_or(f64::NAN); q75f = c.q75f; }
            _ => {
                let s = sorted_copy(arr); let med = s[s.len() >> 1];
                q75 = kth_dev(&s, med, (s.len() as f64 * 0.75).floor() as usize) / 1.1503;
                q75f = if self.cfg.sigma_fast_n > 0.0 && arr.len() as f64 >= self.cfg.sigma_fast_n { let m = self.cfg.sigma_fast_n as usize; let tail: VecDeque<f64> = arr.iter().skip(arr.len() - m.min(arr.len())).copied().collect(); Some(q75of(&tail)) } else { None };
            }
        }
        let r = (self.cfg.sigma_lag_ms / 1000.0).sqrt();
        mx(self.blend_sigma(q75 / r, q75f), 0.05)
    }
    pub fn rate_ratio(&self) -> f64 {
        let v = &self.venues[0];
        let r = &v.ring;
        let n = r.len().min(20);
        if n < 4 || !(v.base > 0.0) { return 1.0; }
        let mut s = 0.0;
        for i in r.len() - n..r.len() { s += r[i].buy + r[i].sell; }
        clamp((s / (n as f64 * self.cfg.bucket_ms / 1000.0)) / v.base, 0.25, 4.0)
    }
    pub fn window_ms(&self, name: &str) -> f64 {
        let nominal = self.cfg.horizons.iter().find(|(k, _)| k == name).map_or(f64::NAN, |x| x.1);
        if nominal > 0.0 { clamp(nominal / self.rate_ratio(), self.cfg.min_window_ms, self.cfg.max_window_ms) } else { f64::NAN }
    }
    pub fn horizon(&self, k: usize, name: &str) -> Option<H> {
        let r = &self.venues[k].ring;
        if r.is_empty() { return None; }
        let ms = self.window_ms(name);
        if !(ms > 0.0) { return None; }
        let count = clamp(js_round(ms / self.cfg.bucket_ms), 1.0, r.len() as f64) as usize;
        let mut h = H { ms: count as f64 * self.cfg.bucket_ms, buy: 0.0, sell: 0.0, n: 0.0, max_trade: 0.0, hi: f64::NEG_INFINITY, lo: f64::INFINITY, open: 0.0, close: 0.0, liq_buy_n: 0.0, liq_sell_n: 0.0, sweep_buy_n: 0.0, sweep_sell_n: 0.0, share: 0.0, delta: 0.0 };
        let (mut open, mut close): (Option<f64>, Option<f64>) = (None, None);
        for i in r.len() - count..r.len() {
            let b = &r[i];
            h.buy += b.buy; h.sell += b.sell; h.n += b.n;
            if b.max_trade > h.max_trade { h.max_trade = b.max_trade; }
            if let Some(bh) = b.hi { if bh > h.hi { h.hi = bh; } let bl = b.lo.unwrap_or(0.0); if bl < h.lo { h.lo = bl; } if open.is_none() { open = b.open; } close = b.close; }
            h.liq_buy_n += b.liq_buy_n; h.liq_sell_n += b.liq_sell_n; h.sweep_buy_n += b.sweep_buy_n; h.sweep_sell_n += b.sweep_sell_n;
        }
        let o = open?;
        h.open = o; h.close = close.unwrap_or(0.0);
        let total = h.buy + h.sell;
        h.share = if total > 0.0 { h.buy / total } else { 0.5 };
        h.delta = h.buy - h.sell;
        Some(h)
    }
    pub fn th(&self, x: f64) -> f64 { x / self.cfg.sens }
    pub fn typical_depth(&self, k: usize, side: usize) -> f64 {
        let ring = &self.venues[k].depth_ring[side];
        if ring.len() < 15 { return 0.0; }
        let mut s: Vec<f64> = ring.iter().copied().collect(); sort_num(&mut s);
        s[s.len() >> 1]
    }
    pub fn depth_thinned(&self, k: usize, side: usize) -> bool {
        let ring = &self.venues[k].depth_ring[side];
        if ring.len() < 15 { return false; }
        let mut s: Vec<f64> = ring.iter().copied().collect(); sort_num(&mut s);
        let med = s[s.len() >> 1];
        med > 0.0 && self.venues[k].depth[side] < self.cfg.thin_frac * med
    }
    pub fn prior_high(&self, k: usize, skip: f64) -> f64 {
        let r = &self.venues[k].ring; let n = r.len() as f64;
        let mut hi = f64::NEG_INFINITY;
        let mut i = mx(0.0, n - skip - 1200.0);
        while i < n - skip { if let Some(x) = r[i as usize].hi { if x > hi { hi = x; } } i += 1.0; }
        hi
    }
    pub fn prior_low(&self, k: usize, skip: f64) -> f64 {
        let r = &self.venues[k].ring; let n = r.len() as f64;
        let mut lo = f64::INFINITY;
        let mut i = mx(0.0, n - skip - 1200.0);
        while i < n - skip { if let Some(x) = r[i as usize].lo { if x < lo { lo = x; } } i += 1.0; }
        lo
    }
    /// one wallet that keeps hitting (Hyperliquid only): one big order split into many fills at one instant is one trade, not a wallet that keeps hitting
    pub fn wallet_evidence(&self, k: usize, side: Side, since: f64) -> Option<WalletEv> {
        if k != 1 { return None; }
        let mut who: Vec<(&str, f64, f64, Vec<f64>)> = Vec::new();
        let mut total = 0.0;
        for x in &self.venues[k].recent {
            let u = match &x.user { Some(u) if !u.is_empty() => u.as_str(), _ => continue };
            if x.t < since || x.side != side { continue; }
            let sec = (x.t / 1000.0).floor();
            match who.iter_mut().find(|w| w.0 == u) {
                Some(w) => { w.1 += x.ntl; w.2 += 1.0; if !w.3.iter().any(|s| *s == sec) { w.3.push(sec); } }
                None => who.push((u, x.ntl, 1.0, vec![sec])),
            }
            total += x.ntl;
        }
        let mut best: Option<usize> = None; let mut value = 0.0;
        for (i, w) in who.iter().enumerate() { if w.1 > value { best = Some(i); value = w.1; } }
        let b = best?;
        let w = &who[b];
        if total <= 0.0 || value / total < self.cfg.wallet_share || w.2 < self.cfg.wallet_trades || (w.3.len() as f64) < self.cfg.wallet_secs { return None; }
        Some(WalletEv { who: short_wallet(w.0), share: value / total, count: w.2 })
    }
    fn exhaustion(&mut self, k: usize, t: f64) {
        let h = match self.horizon(k, "fast") { Some(h) if h.open != 0.0 && !h.open.is_nan() => h, _ => return };
        let skip = js_round(h.ms / self.cfg.bucket_ms);
        let hi = self.prior_high(k, skip); let lo = self.prior_low(k, skip);
        let threshold = h.close * self.sigma_bps(k) * (h.ms / 1000.0).sqrt() / 1e4 * self.cfg.poke_sigma;
        let v = &mut self.venues[k];
        if v.pokes[0].is_none() && hi.is_finite() && h.hi > hi + threshold { v.pokes[0] = Some(Poke { t, level: hi, px: h.hi }); }
        if v.pokes[1].is_none() && lo.is_finite() && h.lo < lo - threshold { v.pokes[1] = Some(Poke { t, level: lo, px: h.lo }); }
        for side in 0..2 {
            let p = match self.venues[k].pokes[side] { Some(p) => p, None => continue };
            if t - p.t > self.cfg.poke_return_ms { self.venues[k].pokes[side] = None; continue; }
            let returned = if side == 0 { h.close < p.level } else { h.close > p.level };
            if !returned { continue; }
            let dir = if side == 0 { "bear" } else { "bull" };
            let evidence = format!("price poked {} {} and returned within {} s", if side == 0 { "above" } else { "below" }, fx(p.level, 1), fx((t - p.t) / 1000.0, 1));
            self.emit(Event { t, ty: 6, family: "exhaustion", dir, venue: k, px: Some(h.close), horizon: "fast", strength: 0.55, refs: Refs::Poke { level: p.level, extreme: p.px }, evidence, id: 0 });
            self.venues[k].last_poke_fail = Some((t, side));
            self.venues[k].pokes[side] = None;
        }
    }
    fn track_refreshing(&mut self, k: usize, t: f64, side: Side, side_text: &str, px: f64, q: f64, ntl: f64) {
        let span = self.cfg.refresh_span_ms;
        let key = (side, px.to_bits());
        let v = &mut self.venues[k];
        let idx = v.level_flow.iter().position(|e| e.0 == key);
        let stale = match idx { None => true, Some(i) => t - v.level_flow[i].1.t0 > span };
        let i = if stale {
            let book = if side == Side::Buy { &v.asks } else { &v.bids };
            let visible = book.iter().find(|l| l.0 == px).map_or(0.0, |l| l.1);
            let x = Flow { t0: t, count: 0.0, q: 0.0, ntl: 0.0, visible, emitted: false };
            match idx { Some(i) => { v.level_flow[i].1 = x; i } None => { v.level_flow.push((key, x)); v.level_flow.len() - 1 } }
        } else { idx.unwrap() };
        let x = &mut v.level_flow[i].1;
        x.count += 1.0; x.q += q; x.ntl += ntl;
        if !x.emitted && x.visible > 0.0 && x.count >= self.cfg.refresh_trades && x.q >= self.cfg.refresh_visible_mult * x.visible {
            x.emitted = true;
            let (count, xq, visible) = (x.count, x.q, x.visible);
            self.eps_note_refresh(k, side, t);
            let w = self.wallet_evidence(k, side, t - span);
            let wallet = match &w { Some(w) => format!(", wallet {} {}%", w.who, ns(js_round(w.share * 100.0))), None => String::new() };
            let evidence = format!("{} {} trades moved {} against {} initially visible ({}x){}", ns(count), side_text, fx(xq, 3), fx(visible, 3), fx(xq / visible, 1), wallet);
            self.emit(Event { t, ty: 5, family: "absorption", dir: if side == Side::Sell { "bull" } else { "bear" }, venue: k, px: Some(px), horizon: "book", strength: 0.6, refs: Refs::Refresh { trades: count, traded: xq, visible, wallet: w }, evidence, id: 0 });
        }
        self.venues[k].level_flow.retain(|(_, y)| !(t - y.t0 > span));
    }
    pub fn price_at(&self, k: usize, t: f64) -> Option<f64> {
        let h = &self.venues[k].px_hist;
        let (mut lo, mut hi, mut r): (isize, isize, isize) = (0, h.len() as isize - 1, -1);
        while lo <= hi { let m = (lo + hi) >> 1; if h[m as usize].0 <= t { r = m; lo = m + 1; } else { hi = m - 1; } }
        if r >= 0 && t - h[r as usize].0 <= 2000.0 { Some(h[r as usize].1) } else { None }
    }
    fn on_second(&mut self, t: f64) {
        for k in 0..2 {
            self.sample(k);
            let v = &mut self.venues[k];
            if let Some(p) = v.px { if p > 0.0 { v.px_hist.push_back((t, p)); if v.px_hist.len() > 21600 { v.px_hist.pop_front(); } } }
        }
        if !self.is_calibrated() { return; }
        for k in 0..2 { self.detect_thinning(k, t); self.exhaustion(k, t); }
        self.eps_tick(t);
    }
    fn close_bucket(&mut self) {
        let bms = self.cfg.bucket_ms;
        let end_t = self.cur_start.unwrap_or(0.0) + bms;
        let keep = (self.cfg.keep_ms / bms).ceil();
        let a0 = 1.0 - math::exp(-bms / self.cfg.base_tau_ms);
        for k in 0..2 {
            let v = &mut self.venues[k];
            if v.px.is_some() { v.cur.close = v.px; }
            v.cur.bid_depth = v.depth[0]; v.cur.ask_depth = v.depth[1]; v.cur.spread = v.spread;
            let c = v.cur;
            v.ring.push_back(c);
            if (v.ring.len() as f64) > keep { let drop = v.ring.len() - keep as usize; v.ring.drain(..drop); }
            let rate = (c.buy + c.sell) / (bms / 1000.0);
            v.base_n += 1.0;
            let a = mx(1.0 / v.base_n, a0);
            v.base += a * (rate - v.base);
        }
        if (end_t / 1000.0).floor() != ((end_t - bms) / 1000.0).floor() { self.on_second(end_t); }
    }
    fn soft_reset(&mut self, t: f64) {
        self.eps_close_all(t, "gap");
        for k in 0..2 {
            let v = &mut self.venues[k];
            v.ring = VecDeque::new(); v.base = 0.0; v.base_n = 0.0; v.samples = Default::default(); v.stats = Default::default(); v.depth_ring = Default::default(); v.recent = VecDeque::new(); v.walls = Vec::new();
            v.imb_state = 0.0; v.imb_pending = 0.0; v.imb_pending_since = 0.0; v.level_flow = Vec::new(); v.pokes = [None, None];
        }
        self.first_t = Some(t);
        let cs = (t / self.cfg.bucket_ms).floor() * self.cfg.bucket_ms;
        self.cur_start = Some(cs);
        for k in 0..2 { self.open_bucket(k, cs); }
    }
    fn tick(&mut self, t: f64) {
        if !(t > 0.0) { return; }
        let bms = self.cfg.bucket_ms;
        let cs = match self.cur_start {
            None => { self.first_t = Some(t); self.now = t; let cs = (t / bms).floor() * bms; self.cur_start = Some(cs); for k in 0..2 { self.open_bucket(k, cs); } return; }
            Some(c) => c,
        };
        if t <= self.now { return; }
        self.now = t;
        if t - (cs + bms) > self.cfg.gap_reset_ms { self.soft_reset(t); return; }
        while t >= self.cur_start.unwrap() + bms {
            self.close_bucket();
            let cs = self.cur_start.unwrap() + bms;
            self.cur_start = Some(cs);
            for k in 0..2 { self.open_bucket(k, cs); }
        }
    }
    pub fn on_trade(&mut self, tr: Option<&Value>) {
        let tr = match tr { Some(x) if truthy(Some(x)) => x, _ => return };
        let k = match venue_of(tr.get("v")) { Some(k) => k, None => return };
        let ntl = num_of(tr.get("ntl")); let px = num_of(tr.get("px")); let t = num_of(tr.get("t"));
        if !(ntl > 0.0) || !(px > 0.0) || !(t > 0.0) { return; }
        self.tick(t);
        let side = Side::of(tr.get("side"));
        let q = num_of(tr.get("q"));
        {
            let c = &mut self.venues[k].cur;
            if truthy(tr.get("liq")) { if side == Side::Buy { c.liq_buy_n += 1.0; } else { c.liq_sell_n += 1.0; } return; }
            if side == Side::Buy { c.buy += ntl; } else { c.sell += ntl; }
            c.n += 1.0;
            if ntl > c.max_trade { c.max_trade = ntl; }
        }
        if self.venues[k].mid.is_none() { self.touch(k, px); }
        let users = tr.get("users");
        let user = if truthy(users) { match users.and_then(|u| u.get(if side == Side::Buy { 0 } else { 1 })) { Some(Value::String(s)) => Some(s.clone()), _ => None } } else { None };
        let now = self.now;
        let v = &mut self.venues[k];
        v.recent.push_back(Recent { t, px, q, ntl, side, user });
        while let Some(f) = v.recent.front() { if f.t < now - 60000.0 { v.recent.pop_front(); } else { break; } }
        let side_text = match tr.get("side") { Some(s) => to_string(Some(s)), None => "undefined".into() };
        self.track_refreshing(k, t, side, &side_text, px, q, ntl);
    }
    pub fn on_quote(&mut self, vn: Option<&Value>, t: f64, bid: f64, ask: f64) {
        let k = match venue_of(vn) { Some(k) => k, None => return };
        if !(bid > 0.0) || !(ask > 0.0) || ask < bid || !(t > 0.0) { return; }
        self.tick(t);
        let v = &mut self.venues[k];
        let mid = (bid + ask) / 2.0;
        v.mid = Some(mid); v.spread = Some(ask - bid);
        self.touch(k, mid);
    }
    pub fn on_sweep(&mut self, vn: Option<&Value>, t: f64, side: Option<&Value>) {
        let k = match venue_of(vn) { Some(k) => k, None => return };
        if !(t > 0.0) { return; }
        self.tick(t);
        let c = &mut self.venues[k].cur;
        if Side::of(side) == Side::Buy { c.sweep_buy_n += 1.0; } else { c.sweep_sell_n += 1.0; }
    }
    pub fn advance(&mut self, t: f64) { self.tick(t); }
    fn clean(levels: &[Value], desc: bool) -> Vec<(f64, f64)> {
        let mut out = Vec::new();
        for l in levels {
            if !truthy(Some(l)) { continue; }
            let (p, q) = match l {
                Value::Array(a) => (to_number(a.first()), to_number(a.get(1))),
                Value::String(s) => { let u: Vec<u16> = s.encode_utf16().collect(); let ch = |i: usize| u.get(i).map(|c| Value::String(String::from_utf16_lossy(&[*c]))); (to_number(ch(0).as_ref()), to_number(ch(1).as_ref())) }
                Value::Object(o) => (to_number(o.get("0")), to_number(o.get("1"))),
                _ => (f64::NAN, f64::NAN),
            };
            if p.is_finite() && q.is_finite() && p > 0.0 && q > 0.0 { out.push((p, q)); }
        }
        out.sort_by(|a, b| { let d = if desc { b.0 - a.0 } else { a.0 - b.0 }; if d < 0.0 { std::cmp::Ordering::Less } else if d > 0.0 { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal } });
        out
    }
    pub fn on_book(&mut self, vn: Option<&Value>, t: f64, bids: Option<&Value>, asks: Option<&Value>) {
        let k = match venue_of(vn) { Some(k) => k, None => return };
        let (bids, asks) = match (bids, asks) { (Some(Value::Array(b)), Some(Value::Array(a))) => (b, a), _ => return };
        if !(t > 0.0) { return; }
        let b = Engine::clean(bids, true); let a = Engine::clean(asks, false);
        if b.is_empty() || a.is_empty() || a[0].0 <= b[0].0 { return; }
        self.tick(t);
        let mid = (b[0].0 + a[0].0) / 2.0;
        let lim = mid * self.cfg.thin_bps / 1e4;
        let (mut bd, mut ad, mut sb, mut sa) = (0.0, 0.0, 0.0, 0.0);
        for l in &b { if mid - l.0 > lim { break; } bd += l.1; }
        for l in &a { if l.0 - mid > lim { break; } ad += l.1; }
        let mut i = 0.0; let top = self.cfg.imb_top;
        while i < top { let ix = i as usize; if let Some(l) = b.get(ix) { sb += l.1; } if let Some(l) = a.get(ix) { sa += l.1; } i += 1.0; }
        let v = &mut self.venues[k];
        v.bids = b; v.asks = a; v.book_t = t; v.book_mid = Some(mid);
        v.depth = [bd, ad];
        v.imb = if sb + sa > 0.0 { (sb - sa) / (sb + sa) } else { 0.0 };
        self.track_walls(k, t, mid);
        self.track_imbalance(k, t);
    }
    fn wall_strength(&self, ratio: f64) -> f64 { let th = self.th(self.cfg.wall_ratio); clamp01(0.3 + 0.7 * clamp01((ratio - th) / (2.0 * th))) }
    fn traded_through(&self, k: usize, w: &Wall, t: f64, ms: f64) -> f64 {
        let mut s = 0.0;
        for x in &self.venues[k].recent { if x.t >= t - ms && (if w.side == 0 { x.side == Side::Sell && x.px <= w.px } else { x.side == Side::Buy && x.px >= w.px }) { s += x.q; } }
        s
    }
    fn wall_event(&mut self, k: usize, t: f64, w: &Wall, ty: usize, dir: &'static str, evidence: String) {
        let strength = self.wall_strength(w.ratio);
        self.emit(Event { t, ty, family: "wall", dir, venue: k, px: Some(w.px), horizon: "book", strength, refs: Refs::Wall { side: w.side, size: w.size, ratio: w.ratio }, evidence, id: 0 });
    }
    fn resolve_wall(&mut self, k: usize, w: &Wall, size: f64, t: f64) {
        let lost = mx(0.0, w.peak - size);
        let frac = if lost > 0.0 { self.traded_through(k, w, t, 1500.0) / lost } else { 0.0 };
        if !w.confirmed { return; }
        let wher = format!("{} wall at {} ({}x median)", BOOK_SIDES[w.side], ns(w.px), fx(w.ratio, 1));
        let dir = if w.side == 0 { "bear" } else { "bull" };
        let outcome = if frac >= self.cfg.wall_eat_frac { "eaten" } else if frac < self.cfg.wall_pulled_frac { "pulled" } else { "faded" };
        self.eps_wall_close(k, t, w, outcome, frac, size);
        if frac >= self.cfg.wall_eat_frac { self.wall_event(k, t, w, 2, dir, format!("{} was eaten: {}% of its size traded through", wher, fx(frac * 100.0, 0))); }
        else if frac < self.cfg.wall_pulled_frac { self.wall_event(k, t, w, 1, dir, format!("{} vanished with only {}% of its size traded", wher, fx(frac * 100.0, 0))); }
    }
    fn track_walls(&mut self, k: usize, t: f64, mid: f64) {
        let limit = mid * self.cfg.wall_bps / 1e4;
        for side in 0..2 {
            let lv = if side == 0 { self.venues[k].bids.clone() } else { self.venues[k].asks.clone() };
            if (lv.len() as f64) < self.cfg.wall_min_levels { continue; }
            let mut sizes: Vec<f64> = lv.iter().take(20).map(|l| l.1).collect(); sort_num(&mut sizes);
            let med = sizes[sizes.len() >> 1];
            if !(med > 0.0) { continue; }
            let mut seen: Vec<u64> = Vec::new();
            let th = self.th(self.cfg.wall_ratio);
            for &(px, sz) in &lv {
                if (px - mid).abs() > limit { break; }
                let rr = sz / med;
                if rr > self.venues[k].wall_max { self.venues[k].wall_max = rr; }
                if sz < th * med { continue; }
                let key = (side, px.to_bits());
                seen.push(px.to_bits());
                let (dip, back) = (self.cfg.ep.wall_dip, self.cfg.ep.wall_back);
                let walls = &mut self.venues[k].walls;
                let wi = match walls.iter().position(|e| e.0 == key) {
                    None => { walls.push((key, Wall { side, px, born: t, peak: sz, size: sz, low: sz, reposts: 0.0, ratio: sz / med, confirmed: false })); walls.len() - 1 }
                    Some(i) => {
                        let w = &mut walls[i].1;
                        w.size = sz; if sz > w.peak { w.peak = sz; } w.ratio = mx(w.ratio, sz / med); if sz < w.low { w.low = sz; }
                        if w.low <= w.peak * dip && sz >= w.peak * back { w.reposts += 1.0; w.low = sz; }
                        i
                    }
                };
                let w = self.venues[k].walls[wi].1.clone();
                if w.confirmed { self.eps_wall_update(k, t, &w, sz / med, mid); }
                if !w.confirmed && t - w.born >= self.cfg.wall_confirm_ms {
                    self.venues[k].walls[wi].1.confirmed = true;
                    let w = self.venues[k].walls[wi].1.clone();
                    let ev = format!("{} wall {}x the median level at {}, held {} s", BOOK_SIDES[side], fx(w.ratio, 1), ns(w.px), fx((t - w.born) / 1000.0, 1));
                    self.wall_event(k, t, &w, 0, if side == 0 { "bull" } else { "bear" }, ev);
                }
            }
            let far = lv[lv.len() - 1].0;
            let mut i = 0;
            while i < self.venues[k].walls.len() {
                let (key, w) = self.venues[k].walls[i].clone();
                if w.side != side { i += 1; continue; }
                let cur = lv.iter().find(|l| l.0 == w.px);
                if cur.is_none() && (if side == 0 { w.px < far } else { w.px > far }) { i += 1; continue; }
                let size = cur.map_or(0.0, |l| l.1);
                if size <= w.peak * (1.0 - self.cfg.wall_drop_frac) {
                    self.resolve_wall(k, &w, size, t);
                    if let Some(j) = self.venues[k].walls.iter().position(|e| e.0 == key) { self.venues[k].walls.remove(j); if j < i { i -= 1; } }
                } else {
                    if !seen.contains(&key.1) { let w = &mut self.venues[k].walls[i].1; w.size = size; if size < w.low { w.low = size; } }
                    i += 1;
                }
            }
        }
    }
    fn track_imbalance(&mut self, k: usize, t: f64) {
        let enter = self.th(self.cfg.imb_enter);
        let (exit, hold, top) = (self.cfg.imb_exit, self.cfg.imb_hold_ms, self.cfg.imb_top);
        let v = &mut self.venues[k];
        let imb = v.imb;
        let target = if imb >= enter { 1.0 } else if imb <= -enter { -1.0 } else if imb.abs() < exit { 0.0 } else { v.imb_state };
        if target != v.imb_pending { v.imb_pending = target; v.imb_pending_since = t; }
        if target == v.imb_state || t - v.imb_pending_since < hold { return; }
        v.imb_state = target;
        if target == 0.0 { return; }
        let flipped = v.last_imb_lean != 0.0 && v.last_imb_lean != target;
        v.last_imb_lean = target;
        let px = v.book_mid;
        if flipped {
            let evidence = format!("top-{} book imbalance flipped to {}% ({} heavier), held {} s", ns(top), fx(imb * 100.0, 0), if target > 0.0 { "bids" } else { "asks" }, ns(hold / 1000.0));
            self.emit(Event { t, ty: 4, family: "book", dir: if target > 0.0 { "bull" } else { "bear" }, venue: k, px, horizon: "book", strength: 0.3 + imb.abs(), refs: Refs::Imb { imb }, evidence, id: 0 });
        }
    }
    fn detect_thinning(&mut self, k: usize, t: f64) {
        for side in 0..2 {
            let ring = &self.venues[k].depth_ring[side];
            if ring.len() < 15 { continue; }
            let mut s: Vec<f64> = ring.iter().copied().collect(); sort_num(&mut s);
            let med = s[s.len() >> 1];
            let cur = self.venues[k].depth[side];
            let tf = self.cfg.thin_frac;
            if med > 0.0 && cur < tf * med {
                let v = &self.venues[k];
                let px = match v.book_mid { Some(m) if m != 0.0 && !m.is_nan() => Some(m), _ => v.px };
                let evidence = format!("{} depth within {} bps fell to {}% of its 30 s median", BOOK_SIDES[side], ns(self.cfg.thin_bps), fx(100.0 * cur / med, 0));
                self.emit(Event { t, ty: 3, family: "book", dir: if side == 0 { "bear" } else { "bull" }, venue: k, px, horizon: "book", strength: 0.3 + (1.0 - cur / (tf * med)), refs: Refs::Thin { cur, med }, evidence, id: 0 });
            }
        }
    }
    fn emit(&mut self, mut e: Event) {
        if !self.is_calibrated() || !self.cfg.detectors[e.ty] { return; }
        e.strength = clamp01(if e.strength.is_nan() { 0.0 } else { e.strength });
        if !(e.t > 0.0) { e.t = self.now; }
        let zone = match e.px { Some(p) if p > 0.0 => js_round(math::log(p) / 2e-4), _ => 0.0 };
        let key = (e.ty, e.venue, e.dir == "bull", (zone + 0.0).to_bits());
        if let Some(&last) = self.last_emit.get(&key) { if e.t - last < self.cfg.cooldown_ms { return; } }
        let mut recent: Vec<usize> = Vec::new();
        for (i, x) in self.events.iter().enumerate() { if x.t > e.t - 60000.0 { recent.push(i); } }
        if recent.len() as f64 >= self.cfg.max_events_per_min {
            let mut weakest = recent[0];
            for &i in &recent { if self.events[i].strength < self.events[weakest].strength { weakest = i; } }
            if e.strength <= self.events[weakest].strength { return; }
            self.events.remove(weakest);
        }
        self.last_emit.insert(key, e.t);
        self.seq += 1; e.id = self.seq;
        if self.listen_ev { let mut w = W::default(); w.open('{'); w.key("ev"); event_json(&mut w, &e); w.close('}'); self.notes.push(w.s); }
        self.events.push(e);
        if self.events.len() as f64 > self.cfg.keep_events { self.events.remove(0); }
    }
    /// setFamily, as the JS: only the four families exist as keys
    pub fn set_family(&mut self, name: &str, on: bool) { self.eps_set_family(name, on); }
}

// ---------------------------------------------------------------- output
pub fn event_json(w: &mut W, e: &Event) {
    w.open('{');
    w.kn("t", e.t); w.ks("type", DETECTORS[e.ty]); w.ks("family", e.family); w.ks("dir", e.dir); w.ks("venue", VN[e.venue]); w.ko("px", e.px); w.ks("horizon", e.horizon); w.kn("strength", e.strength);
    let refs = |w: &mut W| {
        w.key("refs"); w.open('{');
        match &e.refs {
            Refs::Poke { level, extreme } => { w.kn("level", *level); w.kn("extreme", *extreme); }
            Refs::Refresh { trades, traded, visible, wallet } => {
                w.kn("trades", *trades); w.kn("traded", *traded); w.kn("visible", *visible); w.key("wallet");
                match wallet { Some(x) => { w.open('{'); w.ks("who", &x.who); w.kn("share", x.share); w.kn("count", x.count); w.close('}'); } None => w.null() }
            }
            Refs::Wall { side, size, ratio } => { w.ks("side", BOOK_SIDES[*side]); w.kn("size", *size); w.kn("ratio", *ratio); }
            Refs::Imb { imb } => { w.kn("imb", *imb); }
            Refs::Thin { cur, med } => { w.kn("cur", *cur); w.kn("med", *med); }
        }
        w.close('}');
    };
    if let Refs::Wall { .. } = e.refs { w.ks("evidence", &e.evidence); refs(w); } else { refs(w); w.ks("evidence", &e.evidence); }
    w.kn("id", e.id as f64);
    w.close('}');
}
pub fn horizon_json(w: &mut W, h: Option<H>) {
    let h = match h { Some(h) => h, None => return w.null() };
    w.open('{');
    w.kn("ms", h.ms); w.kn("buy", h.buy); w.kn("sell", h.sell); w.kn("n", h.n); w.kn("maxTrade", h.max_trade); w.kn("hi", h.hi); w.kn("lo", h.lo); w.kn("open", h.open); w.kn("close", h.close);
    w.kn("liqBuyN", h.liq_buy_n); w.kn("liqSellN", h.liq_sell_n); w.kn("sweepBuyN", h.sweep_buy_n); w.kn("sweepSellN", h.sweep_sell_n); w.kn("share", h.share); w.kn("delta", h.delta);
    w.close('}');
}
pub type RcItems = Rc<Vec<eps::Item>>;
