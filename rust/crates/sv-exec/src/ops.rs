//! The JSON layer for the JS wrapper (src/js/exec-core.js): a registry of live machines addressed by handle.
use crate::{allowed_base, is_demo_base, Drained, Machine, Ord};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use sv_core::Handles;

thread_local! { static MACHINES: RefCell<Handles<Machine>> = RefCell::new(Handles::default()); }
fn with<R>(h: u32, f: impl FnOnce(&mut Machine) -> R) -> Result<R, String> { MACHINES.with(|s| s.borrow_mut().get_mut(h).map(f)) }

#[derive(Deserialize)]
pub struct BaseIn { s: String, #[serde(rename = "isStr")] is_str: bool }
pub fn op_is_demo_base(i: BaseIn) -> Result<bool, String> { Ok(is_demo_base(&i.s, i.is_str)) }
#[derive(Deserialize)]
pub struct CreateIn { s: String, #[serde(rename = "isStr")] is_str: bool, #[serde(default)] saved: Value }
#[derive(Serialize)]
pub struct CreateOut { h: u32, allowed: bool }
pub fn op_create(i: CreateIn) -> Result<CreateOut, String> {
    let m = Machine::new(&i.s, i.is_str, &i.saved);
    let allowed = m.allowed();
    debug_assert_eq!(allowed, allowed_base(&i.s, i.is_str));
    Ok(CreateOut { h: MACHINES.with(|s| s.borrow_mut().create(m)), allowed })
}
#[derive(Deserialize)] pub struct HIn { h: u32 }
#[derive(Deserialize)] pub struct RowIn { h: u32, row: Value, now: Value, #[serde(default)] g: Value }
pub fn op_on_row(i: RowIn) -> Result<(), String> { let n = sv_core::js::num_in(&i.now); with(i.h, |m| m.on_row(&i.row, n, &i.g)) }
#[derive(Deserialize)] pub struct ReplyIn { h: u32, id: u32, res: Value, now: Value }
pub fn op_reply(i: ReplyIn) -> Result<(), String> { let n = sv_core::js::num_in(&i.now); with(i.h, |m| m.reply(i.id, &i.res, n))? }
#[derive(Deserialize)] pub struct TickIn { h: u32, now: Value }
pub fn op_tick(i: TickIn) -> Result<(), String> { let n = sv_core::js::num_in(&i.now); with(i.h, |m| m.tick(n)) }
pub fn op_kill(i: TickIn) -> Result<(), String> { let n = sv_core::js::num_in(&i.now); with(i.h, |m| m.kill(n)) }
#[derive(Deserialize)] pub struct StartIn { h: u32, x: Value, now: Value, #[serde(default)] extra: Value }
pub fn op_start(i: StartIn) -> Result<(), String> { let n = sv_core::js::num_in(&i.now); with(i.h, |m| m.start(&i.x, n, &i.extra)) }
pub fn op_poll(i: StartIn) -> Result<(), String> { let n = sv_core::js::num_in(&i.now); with(i.h, |m| m.poll(&i.x, n)) }
pub fn op_unkill(i: HIn) -> Result<(), String> { with(i.h, |m| m.unkill()) }
pub fn op_clear_fault(i: HIn) -> Result<(), String> { with(i.h, |m| m.clear_fault()) }
pub fn op_drain(i: HIn) -> Result<Drained, String> { with(i.h, |m| m.drain()) }
pub fn op_state(i: HIn) -> Result<Ord, String> { with(i.h, |m| m.state()) }
pub fn op_snapshot(i: HIn) -> Result<Ord, String> { with(i.h, |m| m.snapshot()) }
pub fn op_faults(i: HIn) -> Result<Vec<crate::Fault>, String> { with(i.h, |m| m.faults_list()) }
pub fn op_debug(i: HIn) -> Result<Ord, String> { with(i.h, |m| m.debug()) }
pub fn op_drop(i: HIn) -> Result<(), String> { MACHINES.with(|s| s.borrow_mut().drop_handle(i.h)); Ok(()) }
