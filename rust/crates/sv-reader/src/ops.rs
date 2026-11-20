//! The JSON layer for the JS wrapper (src/js/reader-wasm.js): a registry of live engines addressed by handle. One call `run` takes a batch of operations
//! (the engine's inputs in the recording format, plus reset / cfg / setFamily / closeEpisodes / listen) and then a list of queries, so the crossing is paid once per batch, not per input.
use crate::out::W;
use crate::{event_json, horizon_json, Cfg, Engine, Side, BOOK_SIDES, VN};
use serde_json::Value;
use std::cell::RefCell;
use sv_core::js::{to_number, to_string, truthy};
use sv_core::Handles;

thread_local! { static ENGINES: RefCell<Handles<Engine>> = RefCell::new(Handles::default()); }

fn h_of(v: &Value) -> Result<u32, String> { v.get("h").and_then(|x| x.as_u64()).map(|x| x as u32).ok_or_else(|| "no handle".to_string()) }
fn num(a: &[Value], i: usize) -> f64 { to_number(a.get(i)) }
fn vn_of(a: &[Value], i: usize) -> Result<usize, String> { crate::venue_of(a.get(i)).ok_or_else(|| format!("unknown venue {}", to_string(a.get(i)))) }

pub fn op_create(i: Value) -> Result<String, String> {
    let cfg = Cfg::from(i.get("cfg").unwrap_or(&Value::Null));
    let h = ENGINES.with(|s| s.borrow_mut().create(Engine::new(cfg)));
    Ok(format!("{{\"h\":{h}}}"))
}
pub fn op_drop(i: Value) -> Result<String, String> { let h = h_of(&i)?; ENGINES.with(|s| s.borrow_mut().drop_handle(h)); Ok("null".into()) }

impl Engine {
    pub fn apply(&mut self, op: &Value) {
        let a = match op { Value::Array(a) if !a.is_empty() => a, _ => return };
        match a[0].as_str().unwrap_or("") {
            "t" => self.on_trade(a.get(1)),
            "q" => self.on_quote(a.get(1), num(a, 2), num(a, 3), num(a, 4)),
            "b" => self.on_book(a.get(1), num(a, 2), a.get(3), a.get(4)),
            "s" => self.on_sweep(a.get(1), num(a, 2), a.get(3)),
            "a" => self.advance(num(a, 1)),
            "x" => self.reset(),
            "cfg" => { if let Some(c) = a.get(1) { self.cfg = Cfg::from(c); } }
            "fam" => self.set_family(&to_string(a.get(1)), truthy(a.get(2))),
            "close" => { let t = match a.get(1) { None | Some(Value::Null) => self.now, x => to_number(x) }; self.eps_close_all(t, "closed"); }
            "listen" => { self.listen_eps = truthy(a.get(1)); self.listen_ev = truthy(a.get(2)); }
            _ => {}
        }
    }
    fn state_json(&self, w: &mut W) {
        let ratio = self.rate_ratio();
        w.open('{');
        w.kb("calibrated", self.is_calibrated());
        w.kn("calibratingPct", match self.first_t { None => 0.0, Some(f) => crate::clamp01((self.now - f) / self.cfg.warmup_ms) });
        w.kn("now", self.now); w.kn("ratio", ratio); w.ks("regime", if ratio < 0.7 { "calm" } else if ratio < 1.8 { "active" } else { "hot" });
        w.key("horizons"); w.open('{');
        for (k, _) in &self.cfg.horizons {
            w.key(k);
            match self.horizon(0, k) {
                Some(h) => { w.open('{'); w.kn("ms", h.ms); w.kn("share", h.share); w.kn("delta", h.delta); w.ks("side", if h.share >= 0.6 { "buyers" } else if h.share <= 0.4 { "sellers" } else { "balanced" }); w.close('}'); }
                None => w.null(),
            }
        }
        w.close('}');
        w.kn("eventsPerMin", self.events.iter().filter(|x| x.t > self.now - 60000.0).count() as f64);
        w.kn("episodesActive", self.active_count() as f64);
        w.key("last"); match self.events.last() { Some(e) => event_json(w, e), None => w.null() }
        w.key("bookAgeMs"); w.open('{');
        for k in 0..2 { let bt = self.venues[k].book_t; w.key(VN[k]); if bt != 0.0 && !bt.is_nan() { w.num(self.now - bt); } else { w.null(); } }
        w.close('}');
        w.close('}');
    }
    pub fn query(&mut self, q: &Value, w: &mut W) -> Result<(), String> {
        let a = match q { Value::Array(a) if !a.is_empty() => a, _ => return Err("bad query".into()) };
        match a[0].as_str().unwrap_or("") {
            "events" => { w.open('['); for e in &self.events { event_json(w, e); } w.close(']'); }
            "episodes" => self.episodes_json(w, false),
            "active" => self.episodes_json(w, true),
            "groups" => self.groups_json(w),
            "forming" => { let t = self.now; self.forming_json(w, t); }
            "state" => self.state_json(w),
            "horizon" => { let k = crate::venue_of(a.get(1)); let name = to_string(a.get(2)); horizon_json(w, k.and_then(|k| self.horizon(k, &name))); }
            "windowMs" => w.num(self.window_ms(&to_string(a.get(1)))),
            "sigmaPeek" => w.num(self.sigma_peek(vn_of(a, 1)?)),
            "priceHistory" => {
                w.open('[');
                if let Some(k) = crate::venue_of(a.get(1)) { for (t, p) in &self.venues[k].px_hist { w.open('['); w.num(*t); w.num(*p); w.close(']'); } }
                w.close(']');
            }
            "isCalibrated" => w.bool(self.is_calibrated()),
            "stat" => {
                let k = vn_of(a, 1)?;
                let key = match a.get(2).and_then(|x| x.as_str()) { Some("buy") => crate::BUY, Some("sell") => crate::SELL, Some("ret") => crate::RET, _ => return Err("unknown stat key".into()) };
                let s = self.stat(k, key);
                w.open('{'); w.kn("n", s.n as f64); w.kn("med", s.med); w.kn("mad", s.mad); if let Some(x) = s.q75 { w.kn("q75", x); } w.kn("at", s.at); if let Some(x) = s.q75f { w.kn("q75f", x); } w.close('}');
            }
            "robustZ" => {
                let k = vn_of(a, 2)?;
                let key = match a.get(3).and_then(|x| x.as_str()) { Some("buy") => crate::BUY, Some("sell") => crate::SELL, Some("ret") => crate::RET, _ => return Err("unknown stat key".into()) };
                let z = self.robust_z(num(a, 1), k, key, num(a, 4));
                w.num(z);
            }
            "sigmaBps" => { let k = vn_of(a, 1)?; let s = self.sigma_bps(k); w.num(s); }
            "walletEvidence" => {
                let k = vn_of(a, 1)?;
                match self.wallet_evidence(k, Side::of(a.get(2)), num(a, 3)) { Some(x) => { w.open('{'); w.ks("who", &x.who); w.kn("share", x.share); w.kn("count", x.count); w.close('}'); } None => w.null() }
            }
            "typicalDepth" => { let k = vn_of(a, 1)?; let s = match a.get(2).and_then(|x| x.as_str()) { Some("bid") => 0, Some("ask") => 1, _ => return Err("unknown side".into()) }; w.num(self.typical_depth(k, s)); }
            "debug" => {
                w.open('{'); w.kn("now", self.now); w.ko("firstT", self.first_t); w.ko("curStart", self.cur_start);
                w.key("venues"); w.open('{');
                for k in 0..2 {
                    let v = &self.venues[k];
                    w.key(VN[k]); w.open('{'); w.kn("walls", v.walls.len() as f64); w.kn("ring", v.ring.len() as f64); w.kn("wallMax", v.wall_max); w.ko("px", v.px); w.ko("mid", v.mid);
                    w.key("depth"); w.open('{'); for s in 0..2 { w.kn(BOOK_SIDES[s], v.depth[s]); } w.close('}'); w.close('}');
                }
                w.close('}'); w.close('}');
            }
            other => return Err(format!("unknown query {other}")),
        }
        Ok(())
    }
}

/// {h, ops:[...], q:[...]} -> {"notes":[...],"r":[...]}: the operations in order, then the queries in order (a query may move the statistics cache, as its JS counterpart does).
pub fn op_run(i: Value) -> Result<String, String> {
    let h = h_of(&i)?;
    ENGINES.with(|s| {
        let mut reg = s.borrow_mut();
        let e = reg.get_mut(h)?;
        if let Some(Value::Array(ops)) = i.get("ops") { for op in ops { e.apply(op); } }
        let mut w = W::default();
        w.open('{');
        w.key("notes"); w.open('['); for n in e.notes.drain(..) { w.raw(&n); } w.close(']');
        w.key("r"); w.open('[');
        if let Some(Value::Array(qs)) = i.get("q") { for q in qs { e.query(q, &mut w)?; } }
        w.close(']');
        w.close('}');
        Ok(w.s)
    })
}
