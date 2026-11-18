//! Shared helpers for every core: the JSON call glue, handles for stateful cores, JS math imports, JS-compatible number text.
//!
//! ABI rules (see also src/js/wasm-loader.js):
//! * A call takes UTF-8 JSON (ptr, len) in memory the caller got from `sv_alloc`, and returns a pointer to a result block
//!   `[u32 LE n][u8 status][n-1 bytes]`. status 0: the bytes are the JSON result. status 1: the bytes are an error message.
//!   The caller frees the block with `sv_free(ptr, 4 + n)`. A panic traps (panic = "abort"); the panic message goes out through the
//!   import `env.sv_panic` first. The loader turns both into a thrown Error naming the core.
//! * JSON has no NaN or Infinity. Going out, serde_json writes them as `null`; coming in, JSON.stringify has already made them
//!   `null`. A core must therefore treat `null` as "no number", and a JS wrapper that needs +/-Infinity maps `null` back itself.
//!   Negative zero going in arrives as 0 (JSON.stringify(-0) is "0"); going out it is kept ("-0.0").
//! * Integer-valued numbers may come back as `300.0`; JSON.parse reads them as 300.
//! * Numbers are parsed with serde_json's `float_roundtrip`, so a double survives the trip exactly.
//! * Stateful cores (later): `create(json) -> u32 handle`, `step(handle, json) -> result block`, `drop(handle)`, with the state kept
//!   in a `Handles<T>` registry; a stale or unknown handle is an error result, never a panic.
//! * Math: use `math::exp`, `math::log`, `math::pow`, ... (imports of the host's Math.*), never f64::exp and the like, so results equal
//!   V8's bit for bit. sqrt, floor, ceil, abs, min, max and arithmetic are exact and may be native.
pub mod js;
use serde::{de::DeserializeOwned, Serialize};

pub mod math {
    //! The host's Math.* functions. An import is only present in the module when something calls it.
    #[cfg(target_arch = "wasm32")]
    #[link(wasm_import_module = "env")]
    extern "C" {
        #[link_name = "exp"]
        fn host_exp(x: f64) -> f64;
        #[link_name = "log"]
        fn host_log(x: f64) -> f64;
        #[link_name = "pow"]
        fn host_pow(x: f64, y: f64) -> f64;
        #[link_name = "log1p"]
        fn host_log1p(x: f64) -> f64;
        #[link_name = "expm1"]
        fn host_expm1(x: f64) -> f64;
    }
    #[cfg(target_arch = "wasm32")]
    pub fn exp(x: f64) -> f64 { unsafe { host_exp(x) } }
    #[cfg(target_arch = "wasm32")]
    pub fn log(x: f64) -> f64 { unsafe { host_log(x) } }
    #[cfg(target_arch = "wasm32")]
    pub fn pow(x: f64, y: f64) -> f64 { unsafe { host_pow(x, y) } }
    #[cfg(target_arch = "wasm32")]
    pub fn log1p(x: f64) -> f64 { unsafe { host_log1p(x) } }
    #[cfg(target_arch = "wasm32")]
    pub fn expm1(x: f64) -> f64 { unsafe { host_expm1(x) } }
    // Native builds (unit tests on the host) have no imports; they are never used for parity.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn exp(x: f64) -> f64 { x.exp() }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn log(x: f64) -> f64 { x.ln() }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn pow(x: f64, y: f64) -> f64 { x.powf(y) }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn log1p(x: f64) -> f64 { x.ln_1p() }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn expm1(x: f64) -> f64 { x.exp_m1() }
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    fn sv_panic(ptr: *const u8, len: usize);
}

/// Route panic messages to the host before the trap (`alloc` does it, so it is set before the first call).
pub fn install_panic_hook() {
    #[cfg(target_arch = "wasm32")]
    std::panic::set_hook(Box::new(|info| {
        let m = info.to_string();
        unsafe { sv_panic(m.as_ptr(), m.len()) }
    }));
}

pub fn alloc(len: usize) -> *mut u8 {
    install_panic_hook();
    let mut v: Vec<u8> = Vec::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` and `len` must be a block returned by `alloc(len)` and not freed yet.
pub unsafe fn free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

fn pack(status: u8, body: &[u8]) -> *mut u8 {
    let n = (body.len() + 1) as u32;
    let total = 4 + n as usize;
    let p = alloc(total);
    unsafe {
        let out = std::slice::from_raw_parts_mut(p, total);
        out[..4].copy_from_slice(&n.to_le_bytes());
        out[4] = status;
        out[5..].copy_from_slice(body);
    }
    p
}

/// The glue of a stateless call: JSON in, `f`, JSON out.
pub fn call<I: DeserializeOwned, O: Serialize>(ptr: *const u8, len: usize, f: impl FnOnce(I) -> Result<O, String>) -> *mut u8 {
    let input = unsafe { std::slice::from_raw_parts(ptr, len) };
    let run = || -> Result<Vec<u8>, String> {
        let i: I = serde_json::from_slice(input).map_err(|e| format!("bad input: {e}"))?;
        let o = f(i)?;
        serde_json::to_vec(&o).map_err(|e| format!("bad output: {e}"))
    };
    match run() {
        Ok(b) => pack(0, &b),
        Err(m) => pack(1, m.as_bytes()),
    }
}

/// Slab of live states for stateful cores: handle 0 is never used.
pub struct Handles<T> {
    slots: Vec<Option<T>>,
}
impl<T> Default for Handles<T> {
    fn default() -> Self { Handles { slots: Vec::new() } }
}
impl<T> Handles<T> {
    pub fn create(&mut self, v: T) -> u32 {
        if let Some(i) = self.slots.iter().position(|s| s.is_none()) { self.slots[i] = Some(v); return i as u32 + 1; }
        self.slots.push(Some(v));
        self.slots.len() as u32
    }
    pub fn get_mut(&mut self, h: u32) -> Result<&mut T, String> {
        self.slots.get_mut((h as usize).wrapping_sub(1)).and_then(|s| s.as_mut()).ok_or_else(|| format!("unknown handle {h}"))
    }
    pub fn drop_handle(&mut self, h: u32) {
        if let Some(s) = self.slots.get_mut((h as usize).wrapping_sub(1)) { *s = None; }
    }
}

/// Lenient readers for `#[serde(default, deserialize_with = "...")]`: JS code checks `typeof x === "number"`, so a field of
/// another type (or null, or missing) reads as "none" instead of failing the whole call.
pub mod lenient {
    use serde::{Deserialize, Deserializer};
    use serde_json::Value;
    pub fn num<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> { Ok(Value::deserialize(d)?.as_f64()) }
    pub fn string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
        Ok(match Value::deserialize(d)? { Value::String(s) => Some(s), _ => None })
    }
    /// JS truthiness of a JSON value.
    pub fn truthy(v: &Option<Value>) -> bool {
        match v {
            None | Some(Value::Null) | Some(Value::Bool(false)) => false,
            Some(Value::String(s)) => !s.is_empty(),
            Some(Value::Number(n)) => n.as_f64().map_or(true, |x| x != 0.0 && !x.is_nan()),
            _ => true,
        }
    }
}

/// JS `Math.round`: round half toward +Infinity, exact for every double.
pub fn js_round(v: f64) -> f64 {
    if !v.is_finite() { return v; }
    let f = v.floor();
    if v - f >= 0.5 { f + 1.0 } else { f }
}

/// `(Math.round(x * 10) / 10).toFixed(1)`; "–" for none. Exact while |x| < 1e19 (beyond that JS prints an exponent; not used by any core).
pub fn f1(x: Option<f64>) -> String {
    let x = match x { None => return "\u{2013}".to_string(), Some(x) => x };
    let r = js_round(x * 10.0);
    if !r.is_finite() { return if r.is_nan() { "NaN".into() } else if r > 0.0 { "Infinity".into() } else { "-Infinity".into() }; }
    let neg = r < 0.0;
    let a = r.abs() as u128;
    format!("{}{}.{}", if neg { "-" } else { "" }, a / 10, a % 10)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn f1_matches_js() {
        assert_eq!(f1(Some(0.0)), "0.0");
        assert_eq!(f1(Some(-0.04)), "0.0");
        assert_eq!(f1(Some(-0.06)), "-0.1");
        assert_eq!(f1(Some(2.25)), "2.3");
        assert_eq!(f1(Some(-2.25)), "-2.2");
        assert_eq!(f1(None), "\u{2013}");
    }
}
