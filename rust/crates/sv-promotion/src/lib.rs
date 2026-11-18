//! Port of src/js/js-cores/promotion-core.js (the promotion rule, the stage log, the loss limit). Pure: no clock, no I/O.
//! Every function takes one serde input struct and returns one serde output; the JS wrapper (src/js/promotion-core.js) keeps the
//! old signatures. Operation order matches the JS so that sums are the same doubles. Fields are read the way the JS reads them
//! (`typeof x === "number"`, `x || "paper"`): a field of another type counts as absent.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use sv_core::lenient::{self, truthy};
use sv_core::{f1, js_round};

const DAY: f64 = 86_400_000.0;
const STAGES: [&str; 3] = ["paper", "demo", "live"];
const PAPER_TRADES: usize = 300;
const PAPER_DAYS: usize = 10;
const POS_DAY_SHARE: f64 = 0.6;
const TWINS_AHEAD: usize = 19;
const TWINS_ENOUGH: usize = 19;
const TWIN_TRADES: usize = 100;
const TWINS_TOTAL: usize = 20;
const DEMO_TRADES: usize = 100;
const DEMO_DAYS: usize = 5;
const HALF_EDGE: f64 = 0.5;
const LOSS_RISKS: f64 = 3.0;

#[derive(Deserialize, Default)]
pub struct Entry {
    #[serde(default, deserialize_with = "lenient::string")]
    sys: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    to: Option<String>,
    #[serde(default, deserialize_with = "lenient::num")]
    t: Option<f64>,
    #[serde(default, deserialize_with = "lenient::num")]
    cap: Option<f64>,
    #[serde(default)]
    figures: Option<Value>,
}

#[derive(Deserialize, Default)]
pub struct Row {
    #[serde(default, deserialize_with = "lenient::string")]
    k: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    sys: Option<String>,
    #[serde(default)]
    interrupted: Option<Value>,
    #[serde(default, rename = "tIn", deserialize_with = "lenient::num")]
    t_in: Option<f64>,
    #[serde(default, deserialize_with = "lenient::num")]
    t: Option<f64>,
    #[serde(default, rename = "netBps", deserialize_with = "lenient::num")]
    net_bps: Option<f64>,
    #[serde(default, rename = "R", deserialize_with = "lenient::num")]
    r: Option<f64>,
    #[serde(default, deserialize_with = "lenient::num")]
    usd: Option<f64>,
    #[serde(default)]
    stage: Option<Value>,
    #[serde(default)]
    fill: Option<Value>,
    #[serde(default, rename = "paperNetBps", deserialize_with = "lenient::num")]
    paper_net_bps: Option<f64>,
    #[serde(default)]
    n: Option<Value>,
}

fn nan(x: Option<f64>) -> f64 { x.unwrap_or(f64::NAN) }
fn mean(a: &[f64]) -> Option<f64> {
    if a.is_empty() { None } else { Some(a.iter().fold(0.0, |x, y| x + y) / a.len() as f64) }
}
fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "null".into(),
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
    }
}
// (r.stage || "paper") === name
fn tag_is(v: &Option<Value>, name: &str) -> bool {
    if truthy(v) { matches!(v, Some(Value::String(s)) if s == name) } else { name == "paper" }
}

// ---------- stage log ----------
fn last_entry<'a>(log: &'a [Entry], id: &str) -> Option<&'a Entry> { log.iter().rev().find(|e| e.sys.as_deref() == Some(id)) }
fn stage_of(log: &[Entry], id: &str, start: &Option<String>) -> String {
    match last_entry(log, id) {
        Some(e) => e.to.clone().unwrap_or_else(|| "undefined".into()),
        None => match start { Some(s) if !s.is_empty() => s.clone(), _ => "paper".into() },
    }
}
fn since(log: &[Entry], id: &str, to: &str) -> f64 {
    let mut t = f64::NEG_INFINITY;
    for e in log { if e.sys.as_deref() == Some(id) && e.to.as_deref() == Some(to) { t = nan(e.t); } }
    t
}
fn edge_of(log: &[Entry], id: &str) -> Option<f64> {
    let mut v = None;
    for e in log {
        if e.sys.as_deref() == Some(id) && e.to.as_deref() == Some("demo") {
            if let Some(x) = e.figures.as_ref().and_then(|f| f.get("edge")).and_then(|x| x.as_f64()) { v = Some(x); }
        }
    }
    v
}
fn cap_of(log: &[Entry], id: &str) -> Option<f64> {
    let mut v = None;
    for e in log { if e.sys.as_deref() == Some(id) && e.to.as_deref() == Some("live") { v = e.cap; } }
    v
}

#[derive(Deserialize)]
pub struct LogIn {
    #[serde(default)]
    log: Vec<Entry>,
    #[serde(default, deserialize_with = "lenient::string")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    start: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    to: Option<String>,
}
fn id_of(i: &LogIn) -> String { i.id.clone().unwrap_or_else(|| "undefined".into()) }

pub fn op_stage_of(i: LogIn) -> Result<String, String> { Ok(stage_of(&i.log, &id_of(&i), &i.start)) }
/// [[sys, stage], ...] in the order each system first appears; the wrapper builds the object.
pub fn op_stages(i: LogIn) -> Result<Vec<(String, String)>, String> {
    let mut out: Vec<(String, String)> = Vec::new();
    for e in &i.log {
        let k = e.sys.clone().unwrap_or_else(|| "undefined".into());
        let v = e.to.clone().unwrap_or_else(|| "undefined".into());
        match out.iter_mut().find(|p| p.0 == k) { Some(p) => p.1 = v, None => out.push((k, v)) }
    }
    Ok(out)
}
/// null for -Infinity (no move) and for a move without a time; the wrapper maps null to -Infinity.
pub fn op_since(i: LogIn) -> Result<Option<f64>, String> {
    let t = since(&i.log, &id_of(&i), i.to.as_deref().unwrap_or("undefined"));
    Ok(if t.is_finite() { Some(t) } else { None })
}
pub fn op_edge_of(i: LogIn) -> Result<Option<f64>, String> { Ok(edge_of(&i.log, &id_of(&i))) }
pub fn op_cap_of(i: LogIn) -> Result<Option<f64>, String> { Ok(cap_of(&i.log, &id_of(&i))) }

// ---------- eligibility ----------
#[derive(Serialize)]
pub struct Criterion {
    id: &'static str,
    label: &'static str,
    now: Option<f64>,
    need: Option<f64>,
    met: bool,
    text: String,
    #[serde(rename = "needText")]
    need_text: String,
}
#[allow(clippy::too_many_arguments)]
fn crit(id: &'static str, label: &'static str, now: Option<f64>, need: Option<f64>, met: bool, text: String, need_text: String) -> Criterion {
    Criterion { id, label, now, need, met, text, need_text }
}

#[derive(Serialize)]
pub struct Eligibility {
    sys: String,
    stage: String,
    next: Option<String>,
    since: Option<f64>,
    criteria: Vec<Criterion>,
    eligible: bool,
    trades: usize,
    #[serde(rename = "meanNetBps")]
    mean_net_bps: Option<f64>,
    edge: Option<f64>,
    waiting: String,
}

#[derive(Deserialize)]
pub struct EligIn {
    #[serde(default)]
    rows: Vec<Row>,
    #[serde(default)]
    log: Vec<Entry>,
    #[serde(default, deserialize_with = "lenient::string")]
    sys: Option<String>,
    #[serde(default, deserialize_with = "lenient::string")]
    start: Option<String>,
}

fn eligibility(rows: &[Row], log: &[Entry], id: &str, start: &Option<String>) -> Eligibility {
    let stage = stage_of(log, id, start);
    let mut out = Eligibility { sys: id.to_string(), stage: stage.clone(), next: None, since: None, criteria: vec![], eligible: false, trades: 0, mean_net_bps: None, edge: None, waiting: String::new() };
    if stage == "live" { return out; }
    out.next = Some(if stage == "paper" { "demo" } else { "live" }.to_string());
    let t0 = since(log, id, &stage);
    out.since = if t0.is_finite() { Some(t0) } else { None };
    let mut tr: Vec<&Row> = Vec::new();
    let mut tw: HashMap<String, Vec<f64>> = HashMap::new();
    for r in rows {
        if r.sys.as_deref() != Some(id) { continue; }
        // `r.tIn >= t0` is false for a missing tIn and for a NaN t0
        let after = matches!(r.t_in, Some(x) if x >= t0);
        if r.k.as_deref() == Some("trade") {
            if truthy(&r.interrupted) || !after || !tag_is(&r.stage, &stage) || !tag_is(&r.fill, &stage) || r.net_bps.is_none() { continue; }
            tr.push(r);
        } else if stage == "paper" && r.k.as_deref() == Some("twin") && after {
            if let Some(rv) = r.r {
                let key = match &r.n {
                    Some(Value::Number(n)) => format!("n{}", n.as_f64().map_or(0.0, |x| x + 0.0).to_bits()),
                    Some(v) => format!("v{v}"),
                    None => "u".to_string(),
                };
                tw.entry(key).or_default().push(rv);
            }
        }
    }
    let n = tr.len();
    let mut days: HashMap<i64, f64> = HashMap::new();
    for r in &tr { *days.entry((r.t_in.unwrap() / DAY).floor() as i64).or_insert(0.0) += r.net_bps.unwrap(); }
    let nd = days.len();
    let m_net = mean(&tr.iter().map(|r| r.net_bps.unwrap()).collect::<Vec<_>>());
    let m_r = mean(&tr.iter().map(|r| nan(r.r)).collect::<Vec<_>>());
    out.trades = n;
    out.mean_net_bps = m_net;
    if stage == "paper" {
        let pos = days.values().filter(|x| **x > 0.0).count();
        let twin_means: Vec<f64> = tw.values().filter(|a| a.len() >= TWIN_TRADES).map(|a| mean(a).unwrap()).collect();
        let ahead = match m_r { None => 0, Some(mr) => twin_means.iter().filter(|m| **m < mr).count() };
        let enough = twin_means.len();
        let ndf = nd as f64;
        out.criteria = vec![
            crit("trades", "Trades", Some(n as f64), Some(PAPER_TRADES as f64), n >= PAPER_TRADES, format!("trades {n} / {PAPER_TRADES}"), PAPER_TRADES.to_string()),
            crit("days", "Different UTC days", Some(nd as f64), Some(PAPER_DAYS as f64), nd >= PAPER_DAYS, format!("days {nd} / {PAPER_DAYS}"), PAPER_DAYS.to_string()),
            crit("mean", "Mean net result per trade, fees included", m_net, Some(0.0), matches!(m_net, Some(x) if x > 0.0), format!("mean net {} bps / above 0", f1(m_net)), "above 0".into()),
            crit("twins", "Mean net R above its twins", Some(ahead as f64), Some(TWINS_AHEAD as f64), n > 0 && enough >= TWINS_ENOUGH && ahead >= TWINS_AHEAD,
                format!("ahead of {ahead} of {TWINS_TOTAL} twins / {TWINS_AHEAD}") + &if enough < TWINS_ENOUGH { format!(", only {enough} twins have {TWIN_TRADES} trades (need {TWINS_ENOUGH})") } else { String::new() }, TWINS_AHEAD.to_string()),
            crit("posdays", "Days with a positive net sum", if nd > 0 { Some(pos as f64 / ndf) } else { None }, Some(POS_DAY_SHARE), nd > 0 && pos * 5 >= nd * 3,
                format!("positive days {}% / {}%", if nd > 0 { (100.0 * pos as f64 / ndf + 1e-9).floor() } else { 0.0 }, js_round(POS_DAY_SHARE * 100.0)), format!("{}%", js_round(POS_DAY_SHARE * 100.0))),
        ];
        out.edge = m_net;
    } else {
        let edge = edge_of(log, id);
        let costs: Vec<f64> = tr.iter().filter_map(|r| r.paper_net_bps.map(|p| p - r.net_bps.unwrap())).collect();
        let worse = mean(&costs);
        let half = edge.map(|e| HALF_EDGE * e);
        out.edge = edge;
        out.criteria = vec![
            crit("trades", "Demo trades", Some(n as f64), Some(DEMO_TRADES as f64), n >= DEMO_TRADES, format!("demo trades {n} / {DEMO_TRADES}"), DEMO_TRADES.to_string()),
            crit("days", "Different UTC days", Some(nd as f64), Some(DEMO_DAYS as f64), nd >= DEMO_DAYS, format!("days {nd} / {DEMO_DAYS}"), DEMO_DAYS.to_string()),
            crit("cost", "Demo fill worse than the paper fill, at most half the paper edge", worse, half, matches!((worse, half), (Some(w), Some(h)) if w <= h),
                format!("demo fill worse by {} bps / at most {}", f1(worse), f1(half)) + if edge.is_none() { " (no stored paper edge)" } else { "" }, "at most half the paper edge".into()),
        ];
        if n == 0 { out.waiting = "needs demo trades".into(); }
    }
    out.eligible = out.criteria.iter().all(|c| c.met);
    out
}
pub fn op_eligibility(i: EligIn) -> Result<Eligibility, String> { Ok(eligibility(&i.rows, &i.log, i.sys.as_deref().unwrap_or("undefined"), &i.start)) }

// ---------- loss limit ----------
#[derive(Deserialize)]
pub struct SystemIn {
    #[serde(default, deserialize_with = "lenient::string")]
    id: Option<String>,
    #[serde(default, rename = "riskFrac", deserialize_with = "lenient::num")]
    risk_frac: Option<f64>,
    #[serde(default, deserialize_with = "lenient::num")]
    equity0: Option<f64>,
}
#[derive(Deserialize)]
pub struct LossIn {
    #[serde(default)]
    rows: Vec<Row>,
    system: SystemIn,
    #[serde(default, deserialize_with = "lenient::num")]
    cap: Option<f64>,
    #[serde(default, deserialize_with = "lenient::num")]
    day: Option<f64>,
}
#[derive(Serialize)]
pub struct LossOut {
    hit: bool,
    loss: f64,
    limit: f64,
    which: &'static str,
    #[serde(rename = "riskUsd")]
    risk_usd: f64,
    day: Option<f64>,
}
pub fn op_loss_limit(i: LossIn) -> Result<LossOut, String> {
    let day = nan(i.day);
    let (mut before, mut today) = (0.0f64, 0.0f64);
    for r in &i.rows {
        if r.k.as_deref() != Some("trade") || r.sys.is_none() || r.sys != i.system.id || truthy(&r.interrupted) { continue; }
        let usd = match r.usd { Some(u) => u, None => continue };
        let d = (nan(r.t) / DAY).floor();
        if d < day { before += usd; } else if d == day && matches!(&r.stage, Some(Value::String(s)) if s == "live") { today += usd; }
    }
    let risk = (nan(i.system.equity0) + before) * nan(i.system.risk_frac);
    let mut limit = LOSS_RISKS * risk;
    let mut which = "risk";
    if let Some(c) = i.cap { if c > 0.0 && c < limit { limit = c; which = "cap"; } }
    let loss = if today < 0.0 { -today } else { 0.0 };
    Ok(LossOut { hit: loss > 0.0 && loss >= limit * (1.0 - 1e-12), loss, limit, which, risk_usd: risk, day: i.day })
}

// ---------- apply ----------
#[derive(Deserialize)]
pub struct ApplyIn {
    #[serde(default)]
    log: Vec<Entry>,
    #[serde(default, rename = "move")]
    mv: Option<Value>,
    #[serde(default)]
    rows: Vec<Row>,
}
#[derive(Serialize)]
pub struct FigCrit { id: &'static str, now: Option<f64>, need: Option<f64>, met: bool }
#[derive(Serialize)]
pub struct Figures {
    criteria: Vec<FigCrit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    edge: Option<f64>,
}
#[derive(Serialize)]
pub struct EntryOut {
    sys: String,
    from: String,
    to: String,
    t: f64,
    by: String,
    figures: Figures,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cap: Option<f64>,
}
/// {ok: true, entry} or {ok: false, reason}; the wrapper adds `log` (the old array with the entry appended), so entries already in the log are never rewritten.
#[derive(Serialize)]
pub struct ApplyOut {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    entry: Option<EntryOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}
fn bad(reason: impl Into<String>) -> Result<ApplyOut, String> { Ok(ApplyOut { ok: false, entry: None, reason: Some(reason.into()) }) }
fn stage_idx(s: &str) -> i32 { STAGES.iter().position(|x| *x == s).map_or(-1, |p| p as i32) }

pub fn op_apply(i: ApplyIn) -> Result<ApplyOut, String> {
    let m = match &i.mv { Some(Value::Object(m)) => m, _ => return bad("no system named") };
    let sys = match m.get("sys") { Some(Value::String(s)) if !s.is_empty() => s.clone(), _ => return bad("no system named") };
    let to = match m.get("to") { Some(Value::String(s)) if STAGES.contains(&s.as_str()) => s.clone(), other => return bad(format!("unknown stage {}", js_string(other))) };
    let by = match m.get("by") { Some(Value::String(s)) if s == "user" || s == "auto" => s.clone(), _ => return bad("a move is made by the user or automatically") };
    let t = match m.get("t").and_then(|x| x.as_f64()) { Some(t) if t.is_finite() => t, _ => return bad("a move needs its time") };
    let start = m.get("start").and_then(|x| x.as_str()).map(String::from);
    let from = stage_of(&i.log, &sys, &start);
    let up = stage_idx(&to) - stage_idx(&from);
    if up == 0 { return bad(format!("already at stage {from}")); }
    let el = eligibility(&i.rows, &i.log, &sys, &start);
    let mut figures = Figures { criteria: el.criteria.iter().map(|c| FigCrit { id: c.id, now: c.now, need: c.need, met: c.met }).collect(), edge: None };
    if up > 0 {
        if by == "auto" { return bad("an automatic move only goes down"); }
        if up > 1 { return bad("a system moves up one stage at a time"); }
        if !el.eligible {
            let why = if !el.waiting.is_empty() { el.waiting.clone() } else { el.criteria.iter().filter(|c| !c.met).map(|c| c.text.clone()).collect::<Vec<_>>().join("; ") };
            return bad(format!("not eligible for {to}: {why}"));
        }
        if to == "live" && !matches!(m.get("cap").and_then(|x| x.as_f64()), Some(c) if c.is_finite() && c > 0.0) { return bad("live needs a dollar cap above 0"); }
        if to == "demo" && el.mean_net_bps.is_some() { figures.edge = el.mean_net_bps; }
    } else if to != "paper" { return bad("a move down goes to paper"); }
    let reason = m.get("reason").filter(|v| truthy(&Some((*v).clone()))).map(|v| js_string(Some(v)));
    let cap = if to == "live" { m.get("cap").and_then(|x| x.as_f64()) } else { None };
    Ok(ApplyOut { ok: true, entry: Some(EntryOut { sys, from, to, t, by, figures, reason, cap }), reason: None })
}
