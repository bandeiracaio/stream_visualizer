//! A system definition: validate (the same messages as src/js/js-cores/system-core.js, in the same order), id (the hash of the definition) and size.
//! Pure. The definition is read as a JSON value the way the JS reads it (a missing key is `undefined`); after `validate` passes, `Cfg::parse` reads the typed form the running system uses.
use serde_json::Value;
use sv_core::js::{cmp_utf16, num_str, to_string, truthy};

pub const FAMILIES: [&str; 4] = ["absorption", "exhaustion", "burst", "wall"];

/// `def.k` on a JSON value: a key of an object, else `undefined`.
pub fn get<'a>(v: Option<&'a Value>, k: &str) -> Option<&'a Value> {
    match v { Some(Value::Object(m)) => m.get(k), _ => None }
}
pub fn st(v: Option<&Value>) -> Option<&str> { match v { Some(Value::String(s)) => Some(s), _ => None } }
fn is_in(v: Option<&Value>, list: &[&str]) -> bool { st(v).map_or(false, |s| list.contains(&s)) }
/// `typeof x === "number" && isFinite(x)`
pub fn num(v: Option<&Value>) -> Option<f64> { match v { Some(Value::Number(n)) => n.as_f64().filter(|x| x.is_finite()), _ => None } }
fn pos(v: Option<&Value>) -> bool { num(v).map_or(false, |x| x > 0.0) }
fn nonneg(v: Option<&Value>) -> bool { num(v).map_or(false, |x| x >= 0.0) }
fn is_int(v: Option<&Value>) -> bool { num(v).map_or(false, |x| x.floor() == x) }
fn families_ok(v: Option<&Value>) -> bool {
    match v { Some(Value::Array(a)) => !a.is_empty() && a.iter().all(|f| is_in(Some(f), &FAMILIES)), _ => false }
}
/// `x && x.k` as it prints in a message
fn and_prop(x: Option<&Value>, k: &str) -> String { if truthy(x) { to_string(get(x, k)) } else { to_string(x) } }

#[derive(Clone, Copy, PartialEq)]
enum Tk { Episode, PriceMove, Premium, TradeFlow, BookDepth, RangeBreak, LevelRejection }
fn trig_kind(s: Option<&str>) -> Option<Tk> {
    Some(match s? { "episode" => Tk::Episode, "priceMove" => Tk::PriceMove, "premium" => Tk::Premium, "tradeFlow" => Tk::TradeFlow, "bookDepth" => Tk::BookDepth, "rangeBreak" => Tk::RangeBreak, "levelRejection" => Tk::LevelRejection, _ => return None })
}
/// the keys of the trigger's spec that are not valid, in the order the JS lists them
fn trig_check(tk: Tk, trg: Option<&Value>) -> Vec<&'static str> {
    let mut bad = Vec::new();
    let mut k = |name: &'static str, ok: bool| if !ok { bad.push(name) };
    let g = |n: &str| get(trg, n);
    match tk {
        Tk::Episode => k("families", families_ok(g("families"))),
        Tk::PriceMove => { k("lookSec", pos(g("lookSec"))); k("m", pos(g("m"))); }
        Tk::Premium => { k("baseSec", pos(g("baseSec"))); k("minBps", pos(g("minBps"))); k("coolSec", nonneg(g("coolSec"))); }
        Tk::TradeFlow => { k("lookSec", pos(g("lookSec"))); k("share", num(g("share")).map_or(false, |x| x > 0.0 && x <= 1.0)); k("m", pos(g("m"))); }
        Tk::BookDepth => {
            k("edge", num(g("edge")).map_or(false, |x| x == 5.0 || x == 20.0)); k("thr", num(g("thr")).map_or(false, |x| x > 0.0 && x <= 1.0));
            k("sustainSec", pos(g("sustainSec"))); k("coolSec", nonneg(g("coolSec")));
        }
        Tk::RangeBreak => { k("brkBps", nonneg(g("brkBps"))); k("coolSec", nonneg(g("coolSec"))); }
        Tk::LevelRejection => { k("tolBps", pos(g("tolBps"))); k("rejBps", pos(g("rejBps"))); k("lookSec", pos(g("lookSec"))); k("coolSec", nonneg(g("coolSec"))); }
    }
    bad
}

pub fn validate(def: Option<&Value>) -> Vec<String> {
    let mut bad: Vec<String> = Vec::new();
    if !matches!(def, Some(Value::Object(_)) | Some(Value::Array(_))) { return vec!["the system is not an object".into()]; }
    let (ctx, reg, trg, th, ex, rk) = (get(def, "context"), get(def, "region"), get(def, "trigger"), get(def, "thesis"), get(def, "exit"), get(def, "risk"));
    if !matches!(get(def, "name"), Some(Value::String(s)) if !s.is_empty()) { bad.push("name is missing".into()); }
    if !is_in(get(def, "stage"), &["paper", "demo", "live"]) { bad.push("stage must be paper, demo or live".into()); }
    let trig_val = if truthy(trg) { get(trg, "type") } else { None };
    let trig_name = and_prop(trg, "type");
    let ctx_type = if truthy(ctx) { get(ctx, "type") } else { None };
    if !truthy(ctx) || !is_in(ctx_type, &["always", "sigmaBand", "hours", "marketState"]) { bad.push(format!("unknown context type: {}", and_prop(ctx, "type"))); }
    else {
        match st(ctx_type).unwrap_or("") {
            "sigmaBand" => {
                let (mn, mx) = (num(get(ctx, "min")), num(get(ctx, "max")));
                if !(mn.map_or(false, |x| x >= 0.0) && mx.map_or(false, |x| x > 0.0) && mx.unwrap_or(0.0) > mn.unwrap_or(0.0)) { bad.push("context sigmaBand needs min and max with max above min".into()); }
            }
            "hours" => {
                let ok = match get(ctx, "hours") { Some(Value::Array(a)) => !a.is_empty() && a.iter().all(|h| is_int(Some(h)) && num(Some(h)).map_or(false, |x| x >= 0.0 && x <= 23.0)), _ => false };
                if !ok { bad.push("context hours needs a list of UTC hours 0 to 23".into()); }
            }
            "marketState" => { if !matches!(get(ctx, "states"), Some(Value::Array(a)) if !a.is_empty()) { bad.push("context marketState needs a list of allowed states".into()); } }
            _ => {}
        }
    }
    let reg_type = if truthy(reg) { get(reg, "type") } else { None };
    if !truthy(reg) || !is_in(reg_type, &["none", "rangeBox"]) { bad.push(format!("unknown region type: {}", and_prop(reg, "type"))); }
    else if st(reg_type) == Some("rangeBox") && !pos(get(reg, "windowSec")) { bad.push("region rangeBox needs windowSec above 0".into()); }
    let tk = trig_kind(st(trig_val));
    match tk {
        None => bad.push(format!("unknown trigger type: {}", trig_name)),
        Some(tk) => {
            for name in trig_check(tk, trg) { bad.push(format!("trigger {} needs a valid {}", trig_name, name)); }
            if matches!(tk, Tk::RangeBreak | Tk::LevelRejection) && !(truthy(reg) && st(reg_type) == Some("rangeBox")) { bad.push(format!("trigger {} needs a region (rangeBox) and the system has none", trig_name)); }
        }
    }
    let venues: &[&str] = if tk == Some(Tk::Episode) { &["any", "bn", "hl"] } else { &["bn", "hl"] };
    if !is_in(get(def, "venue"), venues) { bad.push(format!("venue must be {}{}", venues.join(" or "), if tk == Some(Tk::Episode) { String::new() } else { format!(" for trigger {}", trig_name) })); }
    let th_dir = if truthy(th) { get(th, "dir") } else { None };
    if !truthy(th) || !is_in(th_dir, &["continuation", "fade"]) { bad.push("thesis dir must be continuation or fade".into()); }
    else {
        if !matches!(get(th, "text"), Some(Value::String(_))) { bad.push("thesis text is missing".into()); }
        let inv = get(th, "invalidation");
        let inv_has = truthy(inv);
        let inv_type: Option<&Value> = if inv_has { get(inv, "type") } else { None };
        let inv_name = if inv_has { st(inv_type) } else { Some("none") };
        let known = inv_name.map_or(false, |s| ["none", "triggerReverses", "episodeAgainst", "region"].contains(&s));
        if !known { bad.push(format!("unknown invalidation type: {}", to_string(inv_type))); }
        else if inv_name == Some("triggerReverses") && !matches!(tk, Some(Tk::PriceMove | Tk::Premium | Tk::TradeFlow | Tk::BookDepth | Tk::RangeBreak)) { bad.push(format!("invalidation triggerReverses needs a trigger with a reading (not {})", trig_name)); }
        else if inv_name == Some("region") && !matches!(tk, Some(Tk::RangeBreak | Tk::LevelRejection)) { bad.push("invalidation region needs a rangeBreak or levelRejection trigger".into()); }
    }
    let ex_type_v = if truthy(ex) { get(ex, "type") } else { None };
    let ex_type = st(ex_type_v).filter(|s| ["timed", "flowEpisode", "target", "trailing", "rangeLevel", "normalisation"].contains(s));
    match ex_type {
        None => bad.push(format!("unknown exit type: {}", and_prop(ex, "type"))),
        Some(et) => {
            if !pos(get(ex, "holdSec")) { bad.push(format!("exit {} needs holdSec above 0", et)); }
            let key_ok = match et {
                "flowEpisode" => Some(("families", families_ok(get(ex, "families")))),
                "target" => Some(("tpK", pos(get(ex, "tpK")))),
                "trailing" => Some(("trailK", pos(get(ex, "trailK")))),
                "rangeLevel" => Some(("frac", num(get(ex, "frac")).map_or(false, |x| x == 0.5 || x == 1.0))),
                _ => None,
            };
            if let Some((k, ok)) = key_ok { if !ok { bad.push(format!("exit {} needs a valid {}", et, k)); } }
            let has_box = truthy(reg) && st(reg_type) == Some("rangeBox");
            if et == "rangeLevel" && !has_box { bad.push("exit rangeLevel needs a region (rangeBox) and the system has none".into()); }
            if et == "normalisation" && !matches!(tk, Some(Tk::PriceMove | Tk::Premium | Tk::TradeFlow | Tk::BookDepth)) { bad.push(format!("exit normalisation needs a trigger with a reading (premium, tradeFlow, bookDepth or priceMove), not {}", trig_name)); }
        }
    }
    if !(truthy(rk) && pos(get(rk, "stopK"))) { bad.push("risk stopK must be above 0".into()); }
    if !(truthy(rk) && num(get(rk, "riskFrac")).map_or(false, |x| x > 0.0 && x <= 1.0)) { bad.push("risk riskFrac must be above 0 and at most 1".into()); }
    bad
}

// ---------- id ----------
fn js_str(s: &str) -> String { serde_json::to_string(s).unwrap_or_default() }
/// canon(x) of the JS: sorted keys, JSON.stringify for the leaves; `undefined` (a missing part) prints as the word.
fn canon(v: Option<&Value>, out: &mut String) {
    match v {
        None => out.push_str("undefined"),
        Some(Value::Array(a)) => {
            out.push('[');
            for (i, e) in a.iter().enumerate() { if i > 0 { out.push(','); } if e.is_null() { out.push_str("null"); } else { canon(Some(e), out); } }
            out.push(']');
        }
        Some(Value::Object(m)) => {
            let mut keys: Vec<&String> = m.keys().collect(); sv_core::sort_by(&mut keys, |a, b| cmp_utf16(a, b));
            out.push('{');
            for (i, k) in keys.iter().enumerate() { if i > 0 { out.push(','); } out.push_str(&js_str(k)); out.push(':'); canon(m.get(*k), out); }
            out.push('}');
        }
        Some(Value::Number(n)) => { let x = n.as_f64().unwrap_or(f64::NAN); if x.is_finite() { out.push_str(&num_str(x)); } else { out.push_str("null"); } }
        Some(Value::String(s)) => out.push_str(&js_str(s)),
        Some(Value::Bool(b)) => out.push_str(if *b { "true" } else { "false" }),
        Some(Value::Null) => out.push_str("null"),
    }
}
fn hash(s: &str) -> String {
    let (mut a, mut b) = (0x811c9dc5u32, 0x01000193u32 ^ 0x5bd1e995);
    for c in s.encode_utf16() {
        let c = c as u32;
        a = (a ^ c).wrapping_mul(0x01000193);
        b = b.wrapping_add(c).wrapping_mul(0x85ebca6b);
        b ^= b >> 13;
    }
    let mut h = format!("{a:08x}{b:08x}"); h.truncate(12); h
}
/// "S" + the short hash of venue, context, region, trigger, thesis (dir and invalidation), exit and risk: not name, stage or thesis text.
pub fn id(def: Option<&Value>) -> String {
    let th = get(def, "thesis");
    let th = if truthy(th) { th } else { None };
    let inv = get(th, "invalidation");
    let none = serde_json::json!({"type": "none"});
    let mut s = String::from("{\"context\":"); canon(get(def, "context"), &mut s);
    s.push_str(",\"exit\":"); canon(get(def, "exit"), &mut s);
    s.push_str(",\"region\":"); canon(get(def, "region"), &mut s);
    s.push_str(",\"risk\":"); canon(get(def, "risk"), &mut s);
    s.push_str(",\"thesis\":{\"dir\":"); canon(get(th, "dir"), &mut s);
    s.push_str(",\"invalidation\":"); canon(if truthy(inv) { inv } else { Some(&none) }, &mut s);
    s.push_str("},\"trigger\":"); canon(get(def, "trigger"), &mut s);
    s.push_str(",\"venue\":"); canon(get(def, "venue"), &mut s);
    s.push('}');
    format!("S{}", hash(&s))
}

/// Position size for a fixed risk per trade: the loss at the stop equals equity x riskFrac. Returns (qty, notional, risk).
pub fn size(equity: f64, risk_frac: f64, stop_bps: f64, price: f64) -> (f64, f64, f64) {
    if !(equity > 0.0 && risk_frac > 0.0 && stop_bps > 0.0 && price > 0.0) { return (0.0, 0.0, 0.0); }
    let risk = equity * risk_frac;
    let notional = risk / (stop_bps / 1e4);
    (notional / price, notional, risk)
}
