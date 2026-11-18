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
    sv_paper_place => sv_paper::op_place,
    sv_paper_on_trade => sv_paper::op_on_trade,
    sv_paper_fill => sv_paper::op_fill,
    sv_paper_cap_reduce => sv_paper::op_cap_reduce,
    sv_paper_snapshot => sv_paper::op_snapshot,
    sv_hist_order => sv_history::op_order,
    sv_hist_fill => sv_history::op_fill,
    sv_hist_income => sv_history::op_income,
    sv_hist_account => sv_history::op_account,
    sv_hist_sim_account => sv_history::op_sim_account,
    sv_hist_totals => sv_history::op_totals,
    sv_hist_fill_totals => sv_history::op_fill_totals,
    sv_hist_status_counts => sv_history::op_status_counts,
    sv_hist_iso => sv_history::op_iso,
    sv_hist_symbols => sv_history::op_symbols,
    sv_hist_period => sv_history::op_period,
    sv_hist_pieces => sv_history::op_pieces,
    sv_hist_merge => sv_history::op_merge,
    sv_hist_to_csv => sv_history::op_to_csv,
    sv_sq_of => sv_quality::op_of,
    sv_sq_collectors => sv_quality::op_collectors,
    sv_sq_col_problems => sv_quality::op_col_problems,
    sv_sq_clean => sv_quality::op_clean,
    sv_sq_line => sv_quality::op_line,
    sv_sq_coverage => sv_quality::op_coverage,
}
export! {
    sv_system_validate => sv_system::ops::op_validate,
    sv_system_id => sv_system::ops::op_id,
    sv_system_size => sv_system::ops::op_size,
    sv_system_create => sv_system::ops::op_create,
    sv_system_step => sv_system::ops::op_step,
    sv_system_filled => sv_system::ops::op_filled,
    sv_system_closed => sv_system::ops::op_closed,
    sv_system_cancelled => sv_system::ops::op_cancelled,
    sv_system_end => sv_system::ops::op_end,
    sv_system_state => sv_system::ops::op_state,
    sv_system_force => sv_system::ops::op_force,
    sv_system_drop => sv_system::ops::op_drop,
}
