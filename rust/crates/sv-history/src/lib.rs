//! Port of src/js/js-cores/history-core.js (order history and account info rows, totals, paging, CSV). Pure.
//! Inputs are JSON values with JS semantics (sv_core::js): `None` is a missing key (undefined). The wrapper (src/js/history-core.js) keeps
//! `push` (it mutates an array in place), the constants and COLUMNS, passes raw ids through (`id: o.orderId` is added by the wrapper) and
//! builds objects whose key order JS decides (totals, statusCounts). A thrown TypeError / RangeError comes back as Err("TypeError: ...").
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sv_core::js::{self, cmp_utf16, ser_num, num_v, parse_float, to_number, to_string, truthy, truthy_num};

const DAY: f64 = 86_400_000.0;
const WINDOW: f64 = 7.0 * DAY - 1000.0;

fn get<'a>(v: &'a Value, k: &str) -> Option<&'a Value> { match v { Value::Object(m) => m.get(k), _ => None } }
fn gets<'a>(v: &'a Value, k: &str) -> Option<&'a Value> { get(v, k) }
fn is_null(v: Option<&Value>) -> bool { matches!(v, None | Some(Value::Null)) }
/// num(x): parseFloat, 0 when not finite
fn num(v: Option<&Value>) -> f64 { let n = parse_float(v); if n.is_finite() { n } else { 0.0 } }
fn s(v: Option<&Value>) -> String { if is_null(v) { String::new() } else { to_string(v) } }
/// `+x || 0`
fn plus_or0(v: Option<&Value>) -> f64 { let x = to_number(v); if truthy_num(x) { x } else { 0.0 } }
fn type_err<T>(prop: &str, v: &Value) -> Result<T, String> {
    Err(format!("TypeError: Cannot read properties of {} (reading '{}')", if v.is_null() { "null" } else { "undefined" }, prop))
}

#[derive(Serialize)]
pub struct OrderRow {
    #[serde(serialize_with = "ser_num")]
    t: f64,
    #[serde(serialize_with = "ser_num")]
    upd: f64,
    symbol: String,
    side: String,
    #[serde(rename = "type")]
    typ: String,
    price: f64,
    qty: f64,
    filled: f64,
    avg: f64,
    status: String,
    reduce: bool,
    tif: String,
}
/// the row without `id` (the wrapper puts `id: o.orderId` first)
pub fn op_order(o: Value) -> Result<OrderRow, String> {
    let g = |k| gets(&o, k);
    Ok(OrderRow {
        t: plus_or0(g("time")),
        upd: { let a = plus_or0(g("updateTime")); if truthy_num(a) { a } else { plus_or0(g("time")) } },
        symbol: s(g("symbol")), side: s(g("side")), typ: s(g("type")),
        price: num(g("price")), qty: num(g("origQty")), filled: num(g("executedQty")), avg: num(g("avgPrice")),
        status: s(g("status")), reduce: truthy(g("reduceOnly")), tif: s(g("timeInForce")),
    })
}

#[derive(Serialize)]
pub struct FillRow {
    #[serde(serialize_with = "ser_num")]
    t: f64,
    symbol: String,
    side: String,
    price: f64,
    qty: f64,
    fee: f64,
    #[serde(rename = "feeAsset")]
    fee_asset: String,
    pnl: f64,
    maker: bool,
}
/// the row without `id` and `orderId` (the wrapper puts them first)
pub fn op_fill(f: Value) -> Result<FillRow, String> {
    let g = |k| gets(&f, k);
    Ok(FillRow {
        t: plus_or0(g("time")), symbol: s(g("symbol")), side: s(g("side")), price: num(g("price")), qty: num(g("qty")),
        fee: num(g("commission")), fee_asset: s(g("commissionAsset")), pnl: num(g("realizedPnl")), maker: truthy(g("maker")),
    })
}

#[derive(Serialize)]
pub struct IncomeRow {
    id: String,
    #[serde(serialize_with = "ser_num")]
    t: f64,
    symbol: String,
    #[serde(rename = "type")]
    typ: String,
    amount: f64,
    asset: String,
    info: String,
}
pub fn op_income(i: Value) -> Result<IncomeRow, String> {
    let g = |k| gets(&i, k);
    Ok(IncomeRow { id: format!("{}:{}", s(g("incomeType")), s(g("tranId"))), t: plus_or0(g("time")), symbol: s(g("symbol")), typ: s(g("incomeType")), amount: num(g("income")), asset: s(g("asset")), info: s(g("info")) })
}

#[derive(Serialize)]
pub struct AssetRow { asset: String, wallet: f64, available: f64, upnl: f64, margin: f64 }
#[derive(Serialize)]
pub struct AcctPos {
    symbol: String,
    qty: f64,
    entry: f64,
    mark: f64,
    upnl: f64,
    lev: f64,
    #[serde(rename = "marginType")]
    margin_type: String,
    liq: Option<f64>,
    side: String,
}
#[derive(Serialize)]
pub struct Mode { hedge: Option<bool>, #[serde(rename = "multiAssets")] multi_assets: Option<bool> }
#[derive(Serialize)]
pub struct Fees { maker: f64, taker: f64 }
#[derive(Serialize)]
pub struct Account {
    assets: Vec<AssetRow>,
    positions: Vec<AcctPos>,
    mode: Mode,
    #[serde(rename = "canTrade")]
    can_trade: Option<bool>,
    /// null, a number, or "NaN" / "Infinity" / "-Infinity" (the wrapper turns the strings back)
    #[serde(rename = "feeTier")]
    fee_tier: Value,
    fees: Option<Fees>,
}

fn elements<'a>(v: Option<&'a Value>) -> &'a [Value] { match v { Some(Value::Array(a)) => a, _ => &[] } }

pub fn op_account(raw: Value) -> Result<Account, String> {
    let empty = Value::Object(Default::default());
    // raw = raw || {}
    let raw = if truthy(Some(&raw)) { raw } else { empty.clone() };
    let a = match get(&raw, "account") { Some(v) if truthy(Some(v)) => v, _ => &empty };
    let mut assets = vec![];
    for x in elements(get(a, "assets")) {
        if x.is_null() { return type_err("asset", x); }
        let r = AssetRow { asset: s(get(x, "asset")), wallet: num(get(x, "walletBalance")), available: num(get(x, "availableBalance")), upnl: num(get(x, "unrealizedProfit")), margin: num(get(x, "marginBalance")) };
        if truthy_num(r.wallet) || truthy_num(r.upnl) || truthy_num(r.available) || truthy_num(r.margin) { assets.push(r); }
    }
    let mut positions = vec![];
    for p in elements(get(&raw, "positions")) {
        if p.is_null() { return type_err("positionAmt", p); }
        if num(get(p, "positionAmt")) == 0.0 { continue; }
        let liq = num(get(p, "liquidationPrice"));
        positions.push(AcctPos {
            symbol: s(get(p, "symbol")), qty: num(get(p, "positionAmt")), entry: num(get(p, "entryPrice")), mark: num(get(p, "markPrice")), upnl: num(get(p, "unRealizedProfit")),
            lev: num(get(p, "leverage")), margin_type: s(get(p, "marginType")), liq: if truthy_num(liq) { Some(liq) } else { None }, side: s(get(p, "positionSide")),
        });
    }
    let rate = match get(&raw, "rate") { Some(v) if truthy(Some(v)) => v, _ => &empty };
    let dual = get(&raw, "dual");
    let hedge = if truthy(dual) { Some(truthy(get(dual.unwrap(), "dualSidePosition"))) } else { None };
    let multi = get(a, "multiAssetsMargin");
    let ct = get(a, "canTrade");
    let ft = get(a, "feeTier");
    let mk = get(rate, "makerCommissionRate");
    Ok(Account {
        assets, positions,
        mode: Mode { hedge, multi_assets: if is_null(multi) { None } else { Some(truthy(multi)) } },
        can_trade: if is_null(ct) { None } else { Some(truthy(ct)) },
        fee_tier: if is_null(ft) { Value::Null } else { num_v(to_number(ft)) },
        fees: if is_null(mk) { None } else { Some(Fees { maker: num(mk), taker: num(get(rate, "takerCommissionRate")) }) },
    })
}

#[derive(Deserialize)]
pub struct SimIn { #[serde(default)] snap: Value, #[serde(default)] fees: Value }
#[derive(Serialize)]
pub struct SimPos { symbol: String, qty: f64, entry: f64, mark: f64, upnl: f64, lev: f64, #[serde(rename = "marginType")] margin_type: &'static str, liq: Option<f64>, side: &'static str }
#[derive(Serialize)]
pub struct SimAccount {
    assets: Vec<AssetRow>,
    positions: Vec<SimPos>,
    mode: Mode,
    #[serde(rename = "canTrade")]
    can_trade: bool,
    #[serde(rename = "feeTier")]
    fee_tier: Option<f64>,
    fees: Option<Fees>,
}
pub fn op_sim_account(i: SimIn) -> Result<SimAccount, String> {
    let empty = Value::Object(Default::default());
    let snap = Some(&i.snap).filter(|v| truthy(Some(v)));
    let b = snap.and_then(|v| get(v, "balance")).filter(|v| truthy(Some(v))).unwrap_or(&empty);
    let wallet = num(get(b, "wallet")); let upnl = num(get(b, "upnl"));
    let pos = snap.and_then(|v| get(v, "positions")).filter(|v| truthy(Some(v)));
    let list: &[Value] = match pos { None => &[], Some(Value::Array(a)) => a, Some(_) => return Err("TypeError: ((snap && snap.positions) || []).map is not a function".into()) };
    let mut positions = vec![];
    for p in list {
        if p.is_null() { return type_err("symbol", p); }
        positions.push(SimPos { symbol: s(get(p, "symbol")), qty: num(get(p, "qty")), entry: num(get(p, "entry")), mark: num(get(p, "mark")), upnl: num(get(p, "upnl")), lev: num(get(p, "lev")), margin_type: "simulated", liq: None, side: "BOTH" });
    }
    let fees = if truthy(Some(&i.fees)) { Some(Fees { maker: num(get(&i.fees, "maker")), taker: num(get(&i.fees, "taker")) }) } else { None };
    Ok(SimAccount {
        assets: vec![AssetRow { asset: "USDT".into(), wallet, available: num(get(b, "available")), upnl, margin: wallet + upnl }],
        positions, mode: Mode { hedge: Some(false), multi_assets: Some(false) }, can_trade: true, fee_tier: None, fees,
    })
}

// ---------- totals

#[derive(Deserialize)]
pub struct TotalsIn { #[serde(default)] rows: Value, #[serde(default)] from: Option<Value>, #[serde(default)] to: Option<Value> }
#[derive(Serialize)]
pub struct TypeTotal { n: f64, amount: f64 }
#[derive(Serialize)]
pub struct Totals {
    #[serde(rename = "byType")]
    by_type: Vec<(String, TypeTotal)>,
    total: Value,
    n: f64,
    assets: Vec<String>,
}
fn rows_of(v: &Value) -> Result<&[Value], String> {
    match v { Value::Array(a) => Ok(a), x if !truthy(Some(x)) => Ok(&[]), _ => Err("TypeError: rows is not iterable".into()) }
}
pub fn op_totals(i: TotalsIn) -> Result<Totals, String> {
    let from = i.from.as_ref().filter(|v| !v.is_null()).map(|v| to_number(Some(v)));
    let to = i.to.as_ref().filter(|v| !v.is_null()).map(|v| to_number(Some(v)));
    let mut by: Vec<(String, TypeTotal)> = vec![];
    let mut assets: Vec<String> = vec![];
    let mut total = 0.0; let mut n = 0.0;
    for r in rows_of(&i.rows)? {
        if r.is_null() { return type_err("t", r); }
        let t = to_number(get(r, "t"));
        if from.map_or(false, |f| t < f) || to.map_or(false, |x| t >= x) { continue; }
        let key = to_string(get(r, "type"));
        let amount = to_number(get(r, "amount"));
        let idx = match by.iter().position(|(k, _)| *k == key) { Some(i) => i, None => { by.push((key, TypeTotal { n: 0.0, amount: 0.0 })); by.len() - 1 } };
        by[idx].1.n += 1.0; by[idx].1.amount += amount; total += amount; n += 1.0;
        if truthy(get(r, "asset")) { let a = to_string(get(r, "asset")); if !assets.contains(&a) { assets.push(a); } }
    }
    assets.sort_by(|a, b| cmp_utf16(a, b));
    Ok(Totals { by_type: by, total: num_v(total), n, assets })
}

#[derive(Serialize)]
pub struct FillTotals { n: f64, fee: Value, pnl: Value, volume: Value }
pub fn op_fill_totals(rows: Value) -> Result<FillTotals, String> {
    let (mut fee, mut pnl, mut volume, mut n) = (0.0, 0.0, 0.0, 0.0);
    for f in rows_of(&rows)? {
        if f.is_null() { return type_err("fee", f); }
        fee += to_number(get(f, "fee")); pnl += to_number(get(f, "pnl")); volume += to_number(get(f, "qty")) * to_number(get(f, "price")); n += 1.0;
    }
    Ok(FillTotals { n, fee: num_v(fee), pnl: num_v(pnl), volume: num_v(volume) })
}

/// [[status, count]] in first-seen order
pub fn op_status_counts(rows: Value) -> Result<Vec<(String, f64)>, String> {
    let mut out: Vec<(String, f64)> = vec![];
    for r in rows_of(&rows)? {
        if r.is_null() { return type_err("status", r); }
        let k = to_string(get(r, "status"));
        match out.iter_mut().find(|(x, _)| *x == k) { Some(e) => e.1 += 1.0, None => out.push((k, 1.0)) }
    }
    Ok(out)
}

/// new Date(ms).toISOString() for each time; Err("RangeError: Invalid time value") on the first bad one
pub fn op_iso(ts: Vec<Value>) -> Result<Vec<String>, String> {
    ts.iter().map(|t| js::iso(match t { Value::Number(n) => n.as_f64().unwrap_or(f64::NAN), _ => f64::NAN }).ok_or_else(|| "RangeError: Invalid time value".to_string())).collect()
}

/// symbols: the values are given in order; the result is the index of the first occurrence of each distinct truthy value, in sorted order (String() compared as UTF-16)
pub fn op_symbols(vals: Vec<Option<Value>>) -> Result<Vec<usize>, String> {
    let mut first: Vec<usize> = vec![];
    for (i, v) in vals.iter().enumerate() {
        if !truthy(v.as_ref()) { continue; }
        let v = v.as_ref().unwrap();
        let same = |w: &Value| match (v, w) { (Value::Array(_) | Value::Object(_), _) | (_, Value::Array(_) | Value::Object(_)) => false, _ => v == w };
        if !first.iter().any(|&j| same(vals[j].as_ref().unwrap())) { first.push(i); }
    }
    first.sort_by(|&a, &b| cmp_utf16(&to_string(vals[a].as_ref()), &to_string(vals[b].as_ref())));
    Ok(first)
}

#[derive(Deserialize)]
pub struct PeriodIn { #[serde(default)] days: Value, #[serde(default)] now: Value }
/// `from` of period(days, now); null-safe encoding as num_v
pub fn op_period(i: PeriodIn) -> Result<Value, String> {
    let days = to_number(Some(&i.days));
    let now = to_number(Some(&i.now));
    let cap = if days <= 7.0 { WINDOW } else { f64::INFINITY };
    Ok(num_v(now - js::min(days * DAY, cap)))
}

#[derive(Deserialize)]
pub struct PiecesIn { #[serde(default)] from: Value, #[serde(default)] to: Value }
pub fn op_pieces(i: PiecesIn) -> Result<Vec<[f64; 2]>, String> {
    let from = to_number(Some(&i.from));
    let mut end = to_number(Some(&i.to));
    let mut out = vec![];
    while end > from {
        let start = js::max(from, end - WINDOW);
        out.push([start, end]);
        end = start - 1.0;
    }
    Ok(out)
}

#[derive(Deserialize)]
pub struct MergeRow { #[serde(default)] k: Option<Value>, #[serde(default)] t: Value }
/// merge: the indexes of the kept rows (each key once, the first), newest first (stable)
pub fn op_merge(rows: Vec<MergeRow>) -> Result<Vec<usize>, String> {
    let mut kept: Vec<usize> = vec![];
    for (i, r) in rows.iter().enumerate() {
        match &r.k {
            Some(Value::Null) | None => { kept.push(i); }
            Some(k) => {
                let dup = !matches!(k, Value::Array(_) | Value::Object(_)) && kept.iter().any(|&j| rows[j].k.as_ref() == Some(k));
                if !dup { kept.push(i); }
            }
        }
    }
    let ts: Vec<f64> = kept.iter().map(|&i| to_number(Some(&rows[i].t))).collect();
    // stable merge sort with the comparator (a, b) => b.t - a.t, NaN counting as 0; never panics on an inconsistent comparator
    let mut idx: Vec<usize> = (0..kept.len()).collect();
    let cmp = |a: usize, b: usize| -> bool { let d = ts[b] - ts[a]; d > 0.0 };      // true when b must come before a
    let mut buf = idx.clone();
    let mut width = 1;
    while width < idx.len() {
        let mut i = 0;
        while i < idx.len() {
            let mid = (i + width).min(idx.len()); let hi = (i + 2 * width).min(idx.len());
            let (mut l, mut r, mut o) = (i, mid, i);
            while l < mid && r < hi { if cmp(idx[l], idx[r]) { buf[o] = idx[r]; r += 1; } else { buf[o] = idx[l]; l += 1; } o += 1; }
            while l < mid { buf[o] = idx[l]; l += 1; o += 1; }
            while r < hi { buf[o] = idx[r]; r += 1; o += 1; }
            i += 2 * width;
        }
        std::mem::swap(&mut idx, &mut buf);
        width *= 2;
    }
    Ok(idx.into_iter().map(|i| kept[i]).collect())
}

#[derive(Deserialize)]
pub struct CsvIn { #[serde(default)] header: Vec<Value>, #[serde(default)] rows: Vec<Vec<Value>> }
fn cell(v: &Value) -> String {
    let mut t = if v.is_null() { String::new() } else { to_string(Some(v)) };
    if let Value::String(_) = v { if t.starts_with(['=', '+', '@', '\t', '\r']) { t.insert(0, '\''); } }
    if t.contains(['"', ',', '\n', '\r']) { format!("\"{}\"", t.replace('"', "\"\"")) } else { t }
}
pub fn op_to_csv(i: CsvIn) -> Result<String, String> {
    let mut lines = vec![i.header.iter().map(cell).collect::<Vec<_>>().join(",")];
    for r in &i.rows { lines.push(r.iter().map(cell).collect::<Vec<_>>().join(",")); }
    Ok(lines.join("\r\n") + "\r\n")
}
