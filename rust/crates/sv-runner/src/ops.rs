//! The JSON layer for the JS wrapper (src/js/runner-core.js): a registry of live runners addressed by handle.
use crate::{Cfg, Risk, Row, Runner, SysState};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cell::RefCell;
use sv_core::Handles;
use sv_system::Snap;

thread_local! { static RUNNERS: RefCell<Handles<Runner>> = RefCell::new(Handles::default()); }
fn with<R>(h: u32, f: impl FnOnce(&mut Runner) -> R) -> Result<R, String> { RUNNERS.with(|s| s.borrow_mut().get_mut(h).map(f)) }

#[derive(Deserialize)]
pub struct CreateIn {
    defs: Vec<Value>, twins: f64, equity: f64, #[serde(rename = "feeBps")] fee_bps: f64, #[serde(rename = "riskCap")] risk_cap: f64, seed: String, #[serde(rename = "staleMs")] stale_ms: f64,
    #[serde(default)] usd: Map<String, Value>, #[serde(default)] stages: Map<String, Value>,
}
#[derive(Serialize)]
pub struct CreateOut { h: u32, ids: Vec<String> }
pub fn op_create(i: CreateIn) -> Result<CreateOut, String> {
    let cfg = Cfg { twins: if i.twins.is_finite() && i.twins > 0.0 { i.twins as usize } else { 0 }, equity: i.equity, fee_bps: i.fee_bps, risk_cap: i.risk_cap, seed: i.seed, stale_ms: i.stale_ms };
    let r = Runner::new(&i.defs, cfg, &i.usd, &i.stages)?;
    let ids = r.ids();
    let h = RUNNERS.with(|s| s.borrow_mut().create(r));
    Ok(CreateOut { h, ids })
}
#[derive(Deserialize)]
pub struct StepIn { h: u32, snap: Snap }
pub fn op_step(i: StepIn) -> Result<Vec<Row>, String> { with(i.h, |r| r.step(&i.snap)) }
#[derive(Deserialize)]
pub struct HIn { h: u32 }
#[derive(Deserialize)]
pub struct InterruptIn { h: u32, #[serde(default)] t: Value }
pub fn op_interrupt(i: InterruptIn) -> Result<Vec<Row>, String> { with(i.h, |r| r.interrupt(i.t.as_f64().unwrap_or(f64::NAN))) }
#[derive(Deserialize)]
pub struct MoveIn { h: u32, id: String, to: String }
pub fn op_move(i: MoveIn) -> Result<bool, String> { with(i.h, |r| r.move_stage(&i.id, i.to)) }
pub fn op_state(i: HIn) -> Result<Vec<SysState>, String> { with(i.h, |r| r.state()) }
pub fn op_risk(i: HIn) -> Result<Risk, String> { with(i.h, |r| r.risk()) }
pub fn op_drop(i: HIn) -> Result<(), String> { RUNNERS.with(|s| s.borrow_mut().drop_handle(i.h)); Ok(()) }
