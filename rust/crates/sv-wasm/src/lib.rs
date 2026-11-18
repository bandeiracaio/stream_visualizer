//! The only crate with exports. Memory: sv_alloc / sv_free. One call export per core function: sv_<core>_<function>(ptr, len) -> result block
//! (layout in sv-core). Stateful cores will add sv_<core>_create / _step / _drop around a sv_core::Handles registry.
use sv_core::call;

#[no_mangle]
pub extern "C" fn sv_alloc(len: usize) -> *mut u8 { sv_core::alloc(len) }

/// # Safety
/// `ptr`/`len` must come from `sv_alloc` (or be a result block with len = 4 + its length prefix) and be freed once.
#[no_mangle]
pub unsafe extern "C" fn sv_free(ptr: *mut u8, len: usize) { sv_core::free(ptr, len) }

macro_rules! export {
    ($($name:ident => $f:path),* $(,)?) => {
        $(#[no_mangle] pub extern "C" fn $name(ptr: *const u8, len: usize) -> *mut u8 { call(ptr, len, $f) })*
    };
}

export! {
    sv_promo_stage_of => sv_promotion::op_stage_of,
    sv_promo_stages => sv_promotion::op_stages,
    sv_promo_since => sv_promotion::op_since,
    sv_promo_edge_of => sv_promotion::op_edge_of,
    sv_promo_cap_of => sv_promotion::op_cap_of,
    sv_promo_eligibility => sv_promotion::op_eligibility,
    sv_promo_loss_limit => sv_promotion::op_loss_limit,
    sv_promo_apply => sv_promotion::op_apply,
}
