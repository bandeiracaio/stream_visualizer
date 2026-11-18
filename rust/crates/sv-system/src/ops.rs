//! The JSON layer for the JS wrapper (src/js/system-core.js): stateless helpers, and a registry of live systems addressed by handle.
//! A Rust runner does not use this file: it owns `System` values directly.
use crate::{def, Forced, Intent, Snap, State, System, Trade};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use sv_core::{js, Handles};

thread_local! { static SYSTEMS: RefCell<Handles<System>> = RefCell::new(Handles::default()); }
fn with<R>(h: u32, f: impl FnOnce(&mut System) -> R) -> Result<R, String> { SYSTEMS.with(|s| s.borrow_mut().get_mut(h).map(f)) }

pub fn op_validate(def_v: Option<Value>) -> Result<Vec<String>, String> { Ok(def::validate(def_v.as_ref())) }
pub fn op_id(def_v: Option<Value>) -> Result<String, String> { Ok(def::id(def_v.as_ref())) }

#[derive(Deserialize)]
pub struct SizeIn { #[serde(default)] equity: Value, #[serde(default, rename = "riskFrac")] risk_frac: Value, #[serde(default, rename = "stopBps")] stop_bps: Value, #[serde(default)] price: Value }
#[derive(Serialize)]
pub struct SizeOut { #[serde(serialize_with = "js::ser_num")] qty: f64, #[serde(serialize_with = "js::ser_num")] notional: f64, #[serde(serialize_with = "js::ser_num")] risk: f64 }
/// numbers go in as numbers, or as the text of a non-finite one ("Infinity", "NaN", "-0"); anything else is NaN
pub fn op_size(i: SizeIn) -> Result<SizeOut, String> {
    let (qty, notional, risk) = def::size(js::num_in(&i.equity), js::num_in(&i.risk_frac), js::num_in(&i.stop_bps), js::num_in(&i.price));
    Ok(SizeOut { qty, notional, risk })
}

#[derive(Deserialize)]
pub struct CreateIn { def: Value, #[serde(default)] opt: Option<Value> }
#[derive(Serialize)]
pub struct CreateOut { h: u32, id: String }
pub fn op_create(i: CreateIn) -> Result<CreateOut, String> {
    let sys = System::new(&i.def, i.opt.as_ref())?;
    let id = sys.id().to_string();
    let h = SYSTEMS.with(|s| s.borrow_mut().create(sys));
    Ok(CreateOut { h, id })
}
#[derive(Deserialize)]
pub struct StepIn { h: u32, snap: Snap }
pub fn op_step(i: StepIn) -> Result<Vec<Intent>, String> { with(i.h, |s| s.step(&i.snap)) }
#[derive(Deserialize)]
pub struct FillIn { h: u32, #[serde(default)] px: Value, #[serde(default)] t: Value }
pub fn op_filled(i: FillIn) -> Result<Vec<Intent>, String> { with(i.h, |s| s.filled(js::num_in(&i.px), js::num_in(&i.t))) }
pub fn op_closed(i: FillIn) -> Result<Option<Trade>, String> { with(i.h, |s| s.closed(js::num_in(&i.px), js::num_in(&i.t))) }
#[derive(Deserialize)]
pub struct HIn { h: u32 }
pub fn op_cancelled(i: HIn) -> Result<(), String> { with(i.h, |s| s.cancelled()) }
pub fn op_state(i: HIn) -> Result<State, String> { with(i.h, |s| s.state()) }
pub fn op_drop(i: HIn) -> Result<(), String> { SYSTEMS.with(|s| s.borrow_mut().drop_handle(i.h)); Ok(()) }
#[derive(Deserialize)]
pub struct EndIn { h: u32, #[serde(default)] t: Value }
pub fn op_end(i: EndIn) -> Result<Vec<Intent>, String> { with(i.h, |s| s.end(js::num_in(&i.t))) }
#[derive(Deserialize)]
pub struct ForceIn { h: u32, sig: Value }
pub fn op_force(i: ForceIn) -> Result<(), String> { with(i.h, |s| s.force(Forced::from_value(&i.sig))) }
