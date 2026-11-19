//! R5: the parts of market-core.js (MARKET) and chunk-core.js (CHUNK) that are called rarely enough to cross the JSON boundary (micro-core.js, MICRO, stays JS whole).
//! Everything on the per-input path (stampMid, bumpCvd, prune, thinner, pipeline.input, MICRO's sweeps, sample and top-N of the books) stays in JS: one call costs
//! about 6 us across the boundary and a book of 1000 levels about 800 us, against 0.1 us / 420 us in JS (measured, see source-map "Rust and WebAssembly").
use serde_json::Value;
use sv_core::js::{iso, num_str, truthy_num};

// Inputs and outputs are plain serde_json Values read by hand (the derived deserializers of a struct per call cost 15 KB of wasm for these four small calls).
fn get<'a>(v: &'a Value, k: &str) -> Option<&'a Value> { v.get(k) }
fn num(v: &Value, k: &str) -> Option<f64> { get(v, k).and_then(Value::as_f64) }
fn string<'a>(v: &'a Value, k: &str) -> &'a str { get(v, k).and_then(Value::as_str).unwrap_or("") }
fn flag(v: &Value, k: &str) -> bool { get(v, k) == Some(&Value::Bool(true)) }
fn jnum(x: f64) -> Value { if x.is_finite() { serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number) } else { Value::Null } }

// ---------- MARKET.midRow: the 250 ms mid row. In: {bb, ba, hb, ha}. Out: [bn, hl] (each null when that venue has no two-sided quote), or null when neither mid is truthy. The wrapper builds {t, bn, hl}.
fn mid(b: Option<f64>, a: Option<f64>) -> Option<f64> {
    match (b, a) {
        (Some(b), Some(a)) if truthy_num(b) && truthy_num(a) => Some((b + a) / 2.0),
        _ => None,
    }
}
pub fn op_mid_row(i: Value) -> Result<Value, String> {
    let (bn, hl) = (mid(num(&i, "bb"), num(&i, "ba")), mid(num(&i, "hb"), num(&i, "ha")));
    let t = |x: Option<f64>| x.map_or(false, truthy_num);
    let c = |x: Option<f64>| x.map_or(Value::Null, jnum);
    Ok(if t(bn) || t(hl) { Value::Array(vec![c(bn), c(hl)]) } else { Value::Null })
}

// ---------- CHUNK.check: In: {seqs}. Out: [first, last, startsAtZero, holes] (an object would come back with its keys sorted); the wrapper handles an empty list.
pub fn op_check(i: Value) -> Result<Value, String> {
    let mut seqs: Vec<f64> = get(&i, "seqs").and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_f64().unwrap_or(f64::NAN)).collect()).unwrap_or_default();
    if seqs.is_empty() {
        return Err("empty".into());
    }
    sv_core::sort_by(&mut seqs, |a, b| (a - b).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut holes = vec![];
    let mut next = seqs[0];
    for &s in &seqs {
        while next < s {
            holes.push(jnum(next));
            next += 1.0;
        }
        next = s + 1.0;
    }
    Ok(Value::Array(vec![jnum(seqs[0]), jnum(seqs[seqs.len() - 1]), Value::Bool(seqs[0] == 0.0), Value::Array(holes)]))
}

// ---------- CHUNK.fileName: In: {sym: String(c.sym || "X"), at: +(c.startedAt || 0), run: String(c.run), seq: String(c.seq), gz}. Out: the name, or null for an invalid time.
pub fn op_file_name(i: Value) -> Result<Value, String> {
    let s = match iso(num(&i, "at").unwrap_or(f64::NAN)) { Some(s) => s, None => return Ok(Value::Null) };
    let stamp: String = s.chars().take(16).filter(|c| !matches!(c, '-' | ':' | 'T')).collect();
    let sym: String = string(&i, "sym").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let sym = if sym.is_empty() { "X".to_string() } else { sym };
    let seq = string(&i, "seq");
    let n = seq.encode_utf16().count();
    let pad = "0".repeat(3usize.saturating_sub(n));
    Ok(Value::String(format!("session_{}_{}_run{}-c{}{}{}", sym, stamp, string(&i, "run"), pad, seq, if flag(&i, "gz") { ".json.gz" } else { ".json" })))
}

// ---------- CHUNK.leftRunning. In: {connected, recOn, folder: {state, name}|null (only when set and supported), disk: {tone, text}|null, battery: {charging, level}|null, wakeApi, wake, newer, persisted}.
// Out: [[id, tone, text, fix], ...]; the wrapper builds the objects (key order) and counts.
pub fn op_left_running(e: Value) -> Result<Value, String> {
    let mut out: Vec<[String; 4]> = vec![];
    let mut add = |id: &str, tone: &str, text: String, fix: &str| out.push([id.into(), tone.into(), text, if tone == "ok" { String::new() } else { fix.into() }]);
    let (connected, rec_on) = (flag(&e, "connected"), flag(&e, "recOn"));
    if !rec_on { add("rec", "bad", "Recording is off".into(), "Turn the switch on (Continuous recording): nothing is being kept."); }
    else if !connected { add("rec", "warn", "Not connected".into(), "Press Connect: a run is recorded from connect to disconnect."); }
    else { add("rec", "ok", "Connected and recording".into(), ""); }
    if let Some(f) = get(&e, "folder").filter(|f| f.is_object()) {
        let name = string(f, "name");
        match f.get("state").and_then(Value::as_str) {
            Some("ok") => add("folder", "ok", format!("Save folder: {}", if name.is_empty() { "chosen" } else { name }), ""),
            Some("none") => add("folder", "warn", "No save folder: chunks are kept in this browser for 24 hours only".into(), "Choose a folder (Saved recordings, Choose folder)."),
            Some("denied") => add("folder", "bad", "The browser took back access to the save folder".into(), "Press Allow (Saved recordings)."),
            _ => add("folder", "bad", "The last save into the folder failed".into(), "Check the folder and the disk."),
        }
    }
    if let Some(d) = get(&e, "disk").filter(|d| d.is_object()) { add("disk", string(d, "tone"), format!("Disk room: {}", string(d, "text")), "Free some space or choose another folder."); }
    if get(&e, "persisted") == Some(&Value::Bool(false)) { add("persist", "warn", "The browser may evict stored chunks".into(), "Allow persistent storage for this site."); }
    if let Some(b) = get(&e, "battery").filter(|b| b.is_object()) {
        let lv = num(b, "level").unwrap_or(f64::NAN);
        let charging = flag(b, "charging");
        let tone = if charging { "ok" } else if lv < 0.5 { "bad" } else { "warn" };
        let text = if charging { "Power: charging".to_string() } else { format!("Power: on battery, {}%", num_str(sv_core::js_round(lv * 100.0))) };
        add("power", tone, text, "Plug in the device.");
    }
    let wake_api = get(&e, "wakeApi");
    if connected && wake_api == Some(&Value::Bool(false)) { add("wake", "warn", "No screen wake lock in this browser: the device may sleep".into(), "Turn off sleep in the system settings."); }
    else if connected && sv_core::js::truthy(wake_api) && !flag(&e, "wake") { add("wake", "warn", "The screen wake lock is not held: the device may sleep".into(), "Keep the tab visible; the lock is asked for again when it is."); }
    else if connected { add("wake", "ok", "Screen wake lock held".into(), ""); }
    let newer = string(&e, "newer");
    if !newer.is_empty() { add("version", "warn", format!("A newer version ({}) is out", newer), "Reload when you can stop the run: the chunk being recorded is lost on a reload."); }
    Ok(Value::Array(out.into_iter().map(|x| Value::Array(x.into_iter().map(Value::String).collect())).collect()))
}
