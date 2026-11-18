//! Port of src/js/js-cores/session-quality.js (recording quality). Pure. The wrapper (src/js/session-quality.js) reduces the inputs to
//! (kind, time) pairs (a recording is millions of rows; only those two things are read), reduces the collector records to (name, time),
//! gives `collectors` objects as key lists (JS object order), and builds the result objects whose key order JS decides.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sv_core::js::{self, ser_num, num_str, to_number, to_string, truthy, truthy_num};

const MIN_PER_MINUTE: f64 = 20.0;
const TICKS_PER_MINUTE: f64 = 240.0;
const COL_MIN_WINDOW_MS: f64 = 120_000.0;
const COL_FLOOR_MS: f64 = 30_000.0;
const HOUR: f64 = 3_600_000.0;
const DAY: f64 = 24.0 * HOUR;

fn round(x: f64) -> f64 { sv_core::js_round(x) }
fn get<'a>(v: &'a Value, k: &str) -> Option<&'a Value> { match v { Value::Object(m) => m.get(k), _ => None } }

#[derive(Deserialize)]
pub struct OfIn {
    /// one char per input: q, t, a, or o (anything else)
    kinds: String,
    /// the time of each input as +timeOf(r), null when not finite
    times: Vec<Option<f64>>,
}
#[derive(Serialize, Default)]
pub struct Quality {
    #[serde(skip_serializing_if = "Option::is_none")]
    t0: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    t1: Option<f64>,
    #[serde(rename = "spanMin")]
    span_min: f64,
    minutes: f64,
    #[serde(rename = "dataMinutes")]
    data_minutes: f64,
    #[serde(rename = "longestGapSec")]
    longest_gap_sec: f64,
    #[serde(rename = "ticksPerMin")]
    ticks_per_min: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    clock: Option<f64>,
    verdict: &'static str,
}

pub fn op_of(i: OfIn) -> Result<Quality, String> {
    let (mut ts, mut ticks) = (vec![], vec![]);
    let (mut first, mut last) = (f64::INFINITY, f64::NEG_INFINITY);
    for (k, t) in i.kinds.chars().zip(i.times.iter()) {
        let t = match t { Some(t) => *t, None => continue };
        if t < first { first = t; }
        if t > last { last = t; }
        if k == 'q' || k == 't' { ts.push(t); } else if k == 'a' { ticks.push(t); }
    }
    if !first.is_finite() || last <= first { return Ok(Quality { verdict: "empty", ..Default::default() }); }
    let n = ((last - first) / 60000.0).ceil().max(1.0) as usize;
    let (mut data, mut tk) = (vec![0.0f64; n], vec![0.0f64; n]);
    let slot = |t: f64| ((t - first) / 60000.0).floor().min((n - 1) as f64) as usize;
    for &t in &ts { data[slot(t)] += 1.0; }
    for &t in &ticks { tk[slot(t)] += 1.0; }
    sv_core::sort_by(&mut ts, |a, b| a.partial_cmp(b).unwrap());
    let mut gap = f64::max(0.0, if !ts.is_empty() { ts[0] - first } else { last - first });
    for w in ts.windows(2) { gap = gap.max(w[1] - w[0]); }
    gap = gap.max(if !ts.is_empty() { last - ts[ts.len() - 1] } else { 0.0 });
    let tail = f64::min(1.0, ((last - first) - (n as f64 - 1.0) * 60000.0) / 60000.0);
    let data_minutes = data.iter().enumerate().filter(|(i, c)| **c >= MIN_PER_MINUTE * if *i == n - 1 { tail } else { 1.0 }).count() as f64;
    let mut sorted = tk.clone();
    sv_core::sort_by(&mut sorted, |a, b| a.partial_cmp(b).unwrap());
    let ticks_per_min = sorted[sorted.len() >> 1];
    let nf = n as f64;
    let verdict = if data_minutes < nf * 0.5 { "hollow" } else if data_minutes < nf || gap > 60000.0 { "holes" } else { "complete" };
    Ok(Quality {
        t0: Some(first), t1: Some(last), span_min: round((last - first) / 6000.0) / 10.0, minutes: nf, data_minutes,
        longest_gap_sec: round(gap / 1000.0), ticks_per_min,
        clock: Some(round(100.0 * f64::min(1.0, ticks_per_min / TICKS_PER_MINUTE))), verdict,
    })
}

// ---------- collectors

#[derive(Deserialize)]
pub struct RegEntry {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    records: Vec<Value>,
    #[serde(default, rename = "expectMs")]
    expect_ms: Option<Value>,
}
#[derive(Deserialize)]
pub struct ColIn {
    /// [name, time] of each ["c", name, t, payload] record; time null when not finite
    recs: Vec<(Value, Option<f64>)>,
    #[serde(default)]
    from: Option<Value>,
    #[serde(default)]
    to: Option<Value>,
    /// null when the registry is not an array
    registry: Option<Vec<RegEntry>>,
}
#[derive(Serialize)]
pub struct ColOut {
    n: f64,
    min: f64,
    of: f64,
    #[serde(rename = "gapSec")]
    gap_sec: f64,
    state: &'static str,
}
pub fn op_collectors(i: ColIn) -> Result<Option<Vec<(String, ColOut)>>, String> {
    let (from, to) = (to_number(i.from.as_ref()), to_number(i.to.as_ref()));
    let registry = match i.registry { Some(r) if to - from >= COL_MIN_WINDOW_MS => r, _ => return Ok(None) };
    let mut owner: Vec<(String, Value)> = vec![];      // record name -> id (the last registry entry wins)
    for c in &registry { for n in &c.records {
        let name = to_string(Some(n));
        let id = c.id.clone().unwrap_or(Value::Null);
        match owner.iter_mut().find(|(k, _)| *k == name) { Some(e) => e.1 = id, None => owner.push((name, id)) }
    } }
    let mut times: Vec<(String, Vec<f64>)> = vec![];
    for (name, t) in &i.recs {
        let t = match t { Some(t) => *t, None => continue };
        let name = to_string(Some(name));
        let id = match owner.iter().find(|(k, _)| *k == name) { Some((_, id)) if truthy(Some(id)) => to_string(Some(id)), _ => continue };
        if t >= from && t <= to {
            match times.iter_mut().find(|(k, _)| *k == id) { Some(e) => e.1.push(t), None => times.push((id, vec![t])) }
        }
    }
    let total = f64::max(1.0, ((to - from) / 60000.0).ceil());
    let mut out: Vec<(String, ColOut)> = vec![];
    for c in &registry {
        let expect = to_number(c.expect_ms.as_ref());
        if !(expect * 3.0 <= to - from) { continue; }
        let key = to_string(Some(c.id.as_ref().unwrap_or(&Value::Null)));
        let key = if c.id.is_none() { "undefined".to_string() } else { key };
        let mut a: Vec<f64> = times.iter().find(|(k, _)| *k == key).map(|(_, v)| v.clone()).unwrap_or_default();
        sv_core::sort_by(&mut a, |x, y| x.partial_cmp(y).unwrap());
        let mut mins: Vec<f64> = a.iter().map(|t| f64::min(total - 1.0, ((t - from) / 60000.0).floor())).collect();
        mins.dedup();      // a is sorted, so equal minutes are adjacent
        let mut gap = if !a.is_empty() { a[0] - from } else { to - from };
        for w in a.windows(2) { gap = gap.max(w[1] - w[0]); }
        if !a.is_empty() { gap = gap.max(to - a[a.len() - 1]); }
        let state = if a.is_empty() { "none" } else if gap > f64::max(3.0 * expect, COL_FLOOR_MS) { "holes" } else { "ok" };
        let row = ColOut { n: a.len() as f64, min: mins.len() as f64, of: total, gap_sec: round(gap / 1000.0), state };
        match out.iter_mut().find(|(k, _)| *k == key) { Some(e) => e.1 = row, None => out.push((key, row)) }
    }
    Ok(Some(out))
}

// ---------- line / clean / colProblems

#[derive(Deserialize)]
pub struct QIn {
    #[serde(default)]
    q: Value,
    /// Object.keys(q.collectors) when it is an object, else []
    #[serde(default)]
    keys: Vec<String>,
}
fn problems(i: &QIn) -> Result<Vec<String>, String> {
    let c = if truthy(Some(&i.q)) { get(&i.q, "collectors") } else { None };
    let mut out = vec![];
    if let Some(c) = c.filter(|c| truthy(Some(c))) {
        for k in &i.keys {
            let e = get(c, k);
            match e {
                None | Some(Value::Null) => return Err(format!("TypeError: Cannot read properties of {} (reading 'state')", if e.is_none() { "undefined" } else { "null" })),
                Some(e) => if get(e, "state") != Some(&Value::String("ok".into())) { out.push(k.clone()); },
            }
        }
    }
    Ok(out)
}
pub fn op_col_problems(i: QIn) -> Result<Vec<String>, String> { problems(&i) }
pub fn op_clean(i: QIn) -> Result<bool, String> {
    Ok(truthy(Some(&i.q)) && get(&i.q, "verdict") == Some(&Value::String("complete".into())) && problems(&i)?.is_empty())
}
fn span(s: Option<&Value>) -> String {
    let n = to_number(s);
    if n >= 120.0 { format!("{} min", num_str(round(n / 60.0))) } else { format!("{} s", to_string(s)) }
}
pub fn op_line(i: QIn) -> Result<String, String> {
    let q = &i.q;
    if !truthy(Some(q)) { return Ok(String::new()); }
    let verdict = get(q, "verdict");
    if matches!(verdict, None | Some(Value::Null)) { return Ok(String::new()); }
    if verdict == Some(&Value::String("empty".into())) { return Ok("no data".into()); }
    let bad = problems(&i)?;
    let c = get(q, "collectors");
    let mut s = format!("{} of {} min with data", to_string(get(q, "dataMinutes")), to_string(get(q, "minutes")));
    if verdict != Some(&Value::String("complete".into())) { s += &format!(", longest silence {} s", to_string(get(q, "longestGapSec"))); }
    if to_number(get(q, "clock")) < 80.0 { s += &format!(", clock at {}%", to_string(get(q, "clock"))); }
    if !bad.is_empty() {
        let parts: Vec<String> = bad.iter().map(|k| {
            let e = get(c.unwrap(), k).unwrap();      // Object.assign({id: k}, e): e's own `id` wins
            let id = match get(e, "id") { Some(v) => to_string(Some(v)), None => k.clone() };
            if get(e, "state") == Some(&Value::String("none".into())) { format!("{} no data", id) } else { format!("{} silent {}", id, span(get(e, "gapSec"))) }
        }).collect();
        s += &format!("; collectors: {}", parts.join(", "));
    }
    Ok(s)
}

// ---------- coverage

#[derive(Deserialize)]
pub struct CovRow {
    #[serde(default)]
    at: Value,
    #[serde(default)]
    quality: Option<Value>,
}
#[derive(Deserialize)]
pub struct CovIn {
    rows: Vec<CovRow>,
    #[serde(default)]
    now: Option<Value>,
    #[serde(default)]
    days: Option<Value>,
    #[serde(default, rename = "offMs")]
    off_ms: Option<Value>,
}
#[derive(Serialize)]
pub struct Slot { #[serde(serialize_with = "ser_num")] start: f64, #[serde(serialize_with = "ser_num")] frac: f64 }
#[derive(Serialize)]
pub struct Coverage { slots: Vec<Slot>, #[serde(serialize_with = "ser_num")] hours: f64, #[serde(serialize_with = "ser_num")] last24: f64 }
pub fn op_coverage(i: CovIn) -> Result<Coverage, String> {
    let (now, days, off) = (to_number(i.now.as_ref()), to_number(i.days.as_ref()), to_number(i.off_ms.as_ref()));
    let mut iv: Vec<[f64; 2]> = vec![];
    for r in &i.rows {
        let q = match &r.quality { Some(q) if truthy(Some(q)) => q, _ => continue };
        let at = to_number(Some(&r.at));
        let (t0, t1, sm) = (get(q, "t0"), get(q, "t1"), get(q, "spanMin"));
        let both = truthy(t0) && truthy(t1);
        let a_raw = if both { to_number(t0) } else if truthy(sm) { at - to_number(sm) * 60000.0 } else { 0.0 };
        let b = if both { to_number(t1) } else { at };
        // `a && b > a`: a is the raw t0 (truthy) when both are set, else the computed number
        if (both || truthy_num(a_raw)) && b > a_raw { iv.push([a_raw, b]); }
    }
    sv_core::sort_by(&mut iv, |x, y| x[0].partial_cmp(&y[0]).unwrap_or(std::cmp::Ordering::Equal));
    let mut un: Vec<[f64; 2]> = vec![];
    for [a, b] in iv {
        match un.last_mut() { Some(l) if a <= l[1] => l[1] = js::max(l[1], b), _ => un.push([a, b]) }
    }
    let within = |s: f64, e: f64| -> f64 {
        let mut cov = 0.0;
        for [a, b] in &un { if *b <= s { continue; } if *a >= e { break; } cov += js::min(*b, e) - js::max(*a, s); }
        cov
    };
    let first = (((now + off) / DAY).floor()) * DAY - off - (days - 1.0) * DAY;
    let mut slots = vec![];
    let mut total = 0.0;
    let mut k = 0.0;
    while k < days * 24.0 {
        let s = first + k * HOUR;
        let cov = within(s, s + HOUR);
        total += cov;
        slots.push(Slot { start: s, frac: js::min(1.0, cov / HOUR) });
        k += 1.0;
    }
    Ok(Coverage { slots, hours: total / HOUR, last24: within(now - DAY, now) / HOUR })
}
