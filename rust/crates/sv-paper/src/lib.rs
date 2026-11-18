//! Port of src/js/js-cores/paper-broker-core.js (the simulated paper broker). Pure. The JS wrapper (src/js/paper-broker-core.js) keeps the
//! container bookkeeping (S.fills unshift / pop at 50, the order log through HIST.push, logEnd's scan, the resting-order objects, `pos`, `reset`)
//! and writes the results back into the SIM object in place; this crate does the arithmetic and the decisions.
//! A call takes the numbers of the state (cash, positions in key order, nextId, logSeq) and returns the new ones plus the rows to add.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use sv_core::js::{num_in, num_in_opt, ser_num, ser_opt_num, min as js_min, sign, to_fixed10, truthy_num};

const MAKER: f64 = 0.0002;
const TAKER: f64 = 0.0005;

fn nan() -> f64 { f64::NAN }
fn nanf<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> { Ok(num_in(&Value::deserialize(d)?)) }
fn optnum<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> { Ok(num_in_opt(&Value::deserialize(d)?)) }
fn optstr<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(d)? { Value::String(s) => Some(s), _ => None })
}
fn truthy_opt(x: Option<f64>) -> bool { x.map_or(false, truthy_num) }

#[derive(Deserialize, Serialize, Clone)]
pub struct Pos {
    symbol: String,
    #[serde(default = "nan", deserialize_with = "nanf")]
    #[serde(serialize_with = "ser_num")]
    qty: f64,
    #[serde(default = "nan", deserialize_with = "nanf")]
    #[serde(serialize_with = "ser_num")]
    entry: f64,
    #[serde(default, deserialize_with = "optnum")]
    #[serde(serialize_with = "ser_opt_num")]
    mark: Option<f64>,
}

/// The numbers of the SIM state. Positions are a list in key order (a JS object keeps insertion order; serde_json's map would sort).
#[derive(Deserialize, Serialize, Clone)]
pub struct State {
    #[serde(default = "nan", deserialize_with = "nanf")]
    #[serde(serialize_with = "ser_num")]
    cash: f64,
    #[serde(default)]
    positions: Vec<(String, Pos)>,
    #[serde(default = "nan", rename = "nextId", deserialize_with = "nanf")]
    #[serde(serialize_with = "ser_num")]
    next_id: f64,
    #[serde(default = "nan", rename = "logSeq", deserialize_with = "nanf")]
    #[serde(serialize_with = "ser_num")]
    log_seq: f64,
}

#[derive(Deserialize)]
pub struct Ctx {
    sym: String,
    #[serde(default = "nan", deserialize_with = "nanf")]
    now: f64,
    #[serde(default, deserialize_with = "optnum")]
    bid: Option<f64>,
    #[serde(default, deserialize_with = "optnum")]
    ask: Option<f64>,
    #[serde(default, deserialize_with = "optnum")]
    mark: Option<f64>,
}

#[derive(Deserialize)]
pub struct RestOrd {
    #[serde(default = "nan", deserialize_with = "nanf")]
    id: f64,
    #[serde(default, deserialize_with = "optstr")]
    symbol: Option<String>,
    #[serde(default, deserialize_with = "optstr")]
    side: Option<String>,
    #[serde(default = "nan", deserialize_with = "nanf")]
    qty: f64,
    #[serde(default = "nan", deserialize_with = "nanf")]
    price: f64,
    #[serde(default)]
    reduce: Option<Value>,
}

#[derive(Serialize, Clone)]
pub struct FillRow {
    #[serde(serialize_with = "ser_num")]
    t: f64,
    side: Option<String>,
    #[serde(serialize_with = "ser_num")]
    qty: f64,
    #[serde(serialize_with = "ser_num")]
    price: f64,
    #[serde(serialize_with = "ser_num")]
    fee: f64,
    #[serde(serialize_with = "ser_num")]
    pnl: f64,
    symbol: String,
}
#[derive(Serialize)]
pub struct LogFill {
    #[serde(serialize_with = "ser_num")]
    id: f64,
    #[serde(rename = "orderId")]
    #[serde(serialize_with = "ser_num")]
    order_id: f64,
    #[serde(serialize_with = "ser_num")]
    t: f64,
    symbol: String,
    side: Option<String>,
    #[serde(serialize_with = "ser_num")]
    price: f64,
    #[serde(serialize_with = "ser_num")]
    qty: f64,
    #[serde(serialize_with = "ser_num")]
    fee: f64,
    #[serde(rename = "feeAsset")]
    fee_asset: &'static str,
    #[serde(serialize_with = "ser_num")]
    pnl: f64,
    maker: bool,
}
#[derive(Serialize)]
pub struct LogIncome {
    #[serde(serialize_with = "ser_num")]
    id: f64,
    #[serde(serialize_with = "ser_num")]
    t: f64,
    symbol: String,
    #[serde(rename = "type")]
    typ: &'static str,
    #[serde(serialize_with = "ser_num")]
    amount: f64,
    asset: &'static str,
    info: &'static str,
}
/// Key order is the JS one: Object.assign({t, upd, symbol, tif:""}, row).
#[derive(Serialize)]
pub struct LogOrder {
    #[serde(serialize_with = "ser_num")]
    t: f64,
    #[serde(serialize_with = "ser_num")]
    upd: f64,
    symbol: String,
    tif: &'static str,
    #[serde(serialize_with = "ser_num")]
    id: f64,
    side: Option<String>,
    #[serde(rename = "type")]
    typ: &'static str,
    #[serde(serialize_with = "ser_num")]
    price: f64,
    #[serde(serialize_with = "ser_num")]
    qty: f64,
    #[serde(serialize_with = "ser_num")]
    filled: f64,
    #[serde(serialize_with = "ser_num")]
    avg: f64,
    status: &'static str,
    reduce: bool,
}
#[derive(Serialize)]
pub struct LogEnd {
    #[serde(serialize_with = "ser_num")]
    id: f64,
    status: &'static str,
    #[serde(serialize_with = "ser_num")]
    filled: f64,
    #[serde(serialize_with = "ser_num")]
    avg: f64,
}
#[derive(Serialize, Default)]
pub struct Log {
    orders: Vec<LogOrder>,
    fills: Vec<LogFill>,
    income: Vec<LogIncome>,
}

#[derive(Serialize)]
pub struct Result_ {
    kind: &'static str,
    #[serde(serialize_with = "ser_num")]
    qty: f64,
    #[serde(serialize_with = "ser_num")]
    px: f64,
    crossed: bool,
}

#[derive(Serialize)]
pub struct Out {
    #[serde(skip_serializing_if = "Option::is_none")]
    err: Option<&'static str>,
    state: State,
    #[serde(rename = "newFills")]
    new_fills: Vec<FillRow>,
    log: Log,
    #[serde(rename = "logEnds")]
    log_ends: Vec<LogEnd>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Result_>,
    /// place: the id given to a resting order
    #[serde(skip_serializing_if = "Option::is_none", rename = "restId")]
    #[serde(serialize_with = "ser_opt_num")]
    rest_id: Option<f64>,
    /// capReduce
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(serialize_with = "ser_opt_num")]
    q: Option<f64>,
    /// onTrade: which of the given orders stay, in order
    #[serde(skip_serializing_if = "Option::is_none")]
    keep: Option<Vec<bool>>,
}

struct Sim {
    st: State,
    new_fills: Vec<FillRow>,
    log: Log,
    log_ends: Vec<LogEnd>,
}
impl Sim {
    fn new(st: State) -> Sim { Sim { st, new_fills: vec![], log: Log::default(), log_ends: vec![] } }
    fn finish(self, err: Option<&'static str>) -> Out {
        Out { err, state: self.st, new_fills: self.new_fills, log: self.log, log_ends: self.log_ends, result: None, rest_id: None, q: None, keep: None }
    }
    /// pos(S, sym): created on first use
    fn pos(&mut self, sym: &str) -> usize {
        if let Some(i) = self.st.positions.iter().position(|(k, _)| k == sym) { return i; }
        self.st.positions.push((sym.to_string(), Pos { symbol: sym.to_string(), qty: 0.0, entry: 0.0, mark: None }));
        self.st.positions.len() - 1
    }
    fn seq(&mut self) -> f64 { let v = self.st.log_seq; self.st.log_seq += 1.0; v }
    fn cap_reduce(&mut self, ctx: &Ctx, side: &Option<String>, qty: f64) -> f64 {
        let i = self.pos(&ctx.sym);
        let p = self.st.positions[i].1.qty;
        let s = side.as_deref();
        let opp = (s == Some("SELL") && p > 0.0) || (s == Some("BUY") && p < 0.0);
        if !opp { return 0.0; }
        js_min(qty, p.abs())
    }
    fn fill(&mut self, ctx: &Ctx, side: &Option<String>, qty: f64, price: f64, maker: bool, oid: f64) {
        let fee = qty * price * (if maker { MAKER } else { TAKER });
        let i = self.pos(&ctx.sym);
        let signed = if side.as_deref() == Some("BUY") { qty } else { -qty };
        let mut pnl = 0.0;
        self.st.cash -= fee;
        let mut cash_add = 0.0;
        let symbol;
        {
            let p = &mut self.st.positions[i].1;
            if p.qty == 0.0 || sign(p.qty) == sign(signed) {
                p.entry = (p.entry * p.qty.abs() + price * qty) / (p.qty.abs() + qty);
                p.qty += signed;
            } else {
                let close = js_min(p.qty.abs(), qty);
                pnl = close * (price - p.entry) * sign(p.qty);
                cash_add = pnl;
                let was = sign(p.qty);
                p.qty += signed;
                if p.qty.abs() < 1e-12 { p.qty = 0.0; p.entry = 0.0; } else if sign(p.qty) != was { p.entry = price; }
            }
            p.qty = to_fixed10(p.qty);
            symbol = p.symbol.clone();
        }
        self.st.cash += cash_add;      // JS adds pnl to the cash inside the else branch, before the position moves; nothing in between reads the cash
        self.new_fills.push(FillRow { t: ctx.now, side: side.clone(), qty, price, fee, pnl, symbol: symbol.clone() });
        let id = self.seq();
        self.log.fills.push(LogFill { id, order_id: oid, t: ctx.now, symbol: symbol.clone(), side: side.clone(), price, qty, fee, fee_asset: "USDT", pnl, maker });
        let id = self.seq();
        self.log.income.push(LogIncome { id, t: ctx.now, symbol: symbol.clone(), typ: "COMMISSION", amount: -fee, asset: "USDT", info: "" });
        if truthy_num(pnl) {
            let id = self.seq();
            self.log.income.push(LogIncome { id, t: ctx.now, symbol, typ: "REALIZED_PNL", amount: pnl, asset: "USDT", info: "" });
        }
    }
    fn log_new(&mut self, ctx: &Ctx, id: f64, side: &Option<String>, typ: &'static str, price: f64, qty: f64, filled: f64, avg: f64, status: &'static str, reduce: bool, tif: &'static str) {
        self.log.orders.push(LogOrder { t: ctx.now, upd: ctx.now, symbol: ctx.sym.clone(), tif, id, side: side.clone(), typ, price, qty, filled, avg, status, reduce });
    }
}

// ---------- operations

#[derive(Deserialize)]
pub struct PlaceIn {
    state: State,
    ctx: Ctx,
    #[serde(default, deserialize_with = "optstr", rename = "type")]
    typ: Option<String>,
    #[serde(default, deserialize_with = "optstr")]
    side: Option<String>,
    #[serde(default = "nan", deserialize_with = "nanf")]
    qty: f64,
    #[serde(default = "nan", deserialize_with = "nanf")]
    price: f64,
    #[serde(default)]
    reduce: bool,
}

pub fn op_place(i: PlaceIn) -> Result<Out, String> {
    let PlaceIn { state, ctx, typ, side, qty, price, reduce } = i;
    let mut s = Sim::new(state);
    let buy = side.as_deref() == Some("BUY");
    let (bid, ask) = (ctx.bid, ctx.ask);
    if typ.as_deref() == Some("MARKET") {
        let px = if buy { ask } else { bid };
        if !truthy_opt(px) { return Ok(s.finish(Some("no Binance prices yet; press Connect"))); }
        let px = px.unwrap();
        let q = if reduce { s.cap_reduce(&ctx, &side, qty) } else { qty };
        if !truthy_num(q) { return Ok(s.finish(Some("reduce-only: no position to reduce"))); }
        let id = s.seq();
        s.fill(&ctx, &side, q, px, false, id);
        s.log_new(&ctx, id, &side, "MARKET", 0.0, q, q, px, "FILLED", reduce, "");
        let mut o = s.finish(None);
        o.result = Some(Result_ { kind: "filled", qty: q, px, crossed: false });
        return Ok(o);
    }
    let cross = if buy { truthy_opt(ask) && price >= ask.unwrap() } else { truthy_opt(bid) && price <= bid.unwrap() };
    if cross {
        let px = if buy { ask.unwrap() } else { bid.unwrap() };
        let q = if reduce { s.cap_reduce(&ctx, &side, qty) } else { qty };
        if !truthy_num(q) { return Ok(s.finish(Some("reduce-only: no position to reduce"))); }
        let id = s.seq();
        s.fill(&ctx, &side, q, px, false, id);
        s.log_new(&ctx, id, &side, "LIMIT", price, q, q, px, "FILLED", reduce, "GTC");
        let mut o = s.finish(None);
        o.result = Some(Result_ { kind: "filled", qty: q, px, crossed: true });
        return Ok(o);
    }
    let id = s.st.next_id;
    s.st.next_id += 1.0;
    s.log_new(&ctx, id, &side, "LIMIT", price, qty, 0.0, 0.0, "NEW", reduce, "GTC");
    let mut o = s.finish(None);
    o.rest_id = Some(id);
    Ok(o)
}

#[derive(Deserialize)]
pub struct TradeIn {
    state: State,
    ctx: Ctx,
    orders: Vec<RestOrd>,
    #[serde(default = "nan", deserialize_with = "nanf")]
    px: f64,
}

pub fn op_on_trade(i: TradeIn) -> Result<Out, String> {
    let TradeIn { state, ctx, orders, px } = i;
    let mut s = Sim::new(state);
    let mut keep = Vec::with_capacity(orders.len());
    for o in &orders {
        if o.symbol.as_deref() != Some(ctx.sym.as_str()) { keep.push(true); continue; }
        let buy = o.side.as_deref() == Some("BUY");
        let hit = (buy && px <= o.price) || (o.side.as_deref() == Some("SELL") && px >= o.price);
        if !hit { keep.push(true); continue; }
        let reduce = sv_core::js::truthy(o.reduce.as_ref());
        let q = if reduce { s.cap_reduce(&ctx, &o.side, o.qty) } else { o.qty };
        if truthy_num(q) { s.fill(&ctx, &o.side, q, o.price, true, o.id); }
        s.log_ends.push(LogEnd { id: o.id, status: if truthy_num(q) { "FILLED" } else { "EXPIRED" }, filled: q, avg: if truthy_num(q) { o.price } else { 0.0 } });
        keep.push(false);
    }
    let mut o = s.finish(None);
    o.keep = Some(keep);
    Ok(o)
}

#[derive(Deserialize)]
pub struct FillIn {
    state: State,
    ctx: Ctx,
    #[serde(default, deserialize_with = "optstr")]
    side: Option<String>,
    #[serde(default = "nan", deserialize_with = "nanf")]
    qty: f64,
    #[serde(default = "nan", deserialize_with = "nanf")]
    price: f64,
    #[serde(default)]
    maker: bool,
    #[serde(default = "nan", deserialize_with = "nanf")]
    oid: f64,
}
pub fn op_fill(i: FillIn) -> Result<Out, String> {
    let mut s = Sim::new(i.state);
    s.fill(&i.ctx, &i.side, i.qty, i.price, i.maker, i.oid);
    Ok(s.finish(None))
}

#[derive(Deserialize)]
pub struct CapIn {
    state: State,
    ctx: Ctx,
    #[serde(default, deserialize_with = "optstr")]
    side: Option<String>,
    #[serde(default = "nan", deserialize_with = "nanf")]
    qty: f64,
}
pub fn op_cap_reduce(i: CapIn) -> Result<Out, String> {
    let mut s = Sim::new(i.state);
    let q = s.cap_reduce(&i.ctx, &i.side, i.qty);
    let mut o = s.finish(None);
    o.q = Some(q);
    Ok(o)
}

#[derive(Deserialize)]
pub struct SnapIn {
    state: State,
    ctx: Ctx,
    /// the symbol of each resting order, in order
    #[serde(default)]
    orders: Vec<Option<String>>,
}
#[derive(Serialize)]
pub struct OpenPos {
    symbol: String,
    #[serde(serialize_with = "ser_num")]
    qty: f64,
    #[serde(serialize_with = "ser_num")]
    entry: f64,
    #[serde(serialize_with = "ser_num")]
    mark: f64,
    #[serde(serialize_with = "ser_num")]
    upnl: f64,
    #[serde(serialize_with = "ser_opt_num")]
    liq: Option<f64>,
    lev: &'static str,
}
#[derive(Serialize)]
pub struct Balance {
    #[serde(serialize_with = "ser_num")]
    wallet: f64,
    #[serde(serialize_with = "ser_num")]
    available: f64,
    #[serde(serialize_with = "ser_num")]
    upnl: f64,
}
#[derive(Serialize)]
pub struct SnapOut {
    state: State,
    balance: Balance,
    positions: Vec<OpenPos>,
    #[serde(rename = "orderIdx")]
    order_idx: Vec<usize>,
}
pub fn op_snapshot(i: SnapIn) -> Result<SnapOut, String> {
    let SnapIn { state, ctx, orders } = i;
    let mut s = Sim::new(state);
    let ci = s.pos(&ctx.sym);
    {
        let cur = &mut s.st.positions[ci].1;
        let m = if truthy_opt(ctx.mark) { ctx.mark.unwrap() }
            else if truthy_opt(ctx.bid) && truthy_opt(ctx.ask) { (ctx.bid.unwrap() + ctx.ask.unwrap()) / 2.0 }
            else if truthy_opt(cur.mark) { cur.mark.unwrap() } else { cur.entry };
        cur.mark = Some(m);
    }
    let open: Vec<OpenPos> = s.st.positions.iter().map(|(_, p)| p).filter(|p| truthy_num(p.qty)).map(|p| {
        let mark = if truthy_opt(p.mark) { p.mark.unwrap() } else { p.entry };
        OpenPos { symbol: p.symbol.clone(), qty: p.qty, entry: p.entry, mark, upnl: p.qty * (mark - p.entry), liq: None, lev: "10 (sim)" }
    }).collect();
    let upnl = open.iter().fold(0.0, |a, p| a + p.upnl);
    let margin = open.iter().fold(0.0, |a, p| a + p.qty.abs() * p.mark / 10.0);
    let cash = s.st.cash;
    let order_idx = orders.iter().enumerate().filter(|(_, o)| o.as_deref() == Some(ctx.sym.as_str())).map(|(i, _)| i).collect();
    Ok(SnapOut { balance: Balance { wallet: cash, available: cash + upnl - margin, upnl }, positions: open, order_idx, state: s.st })
}
