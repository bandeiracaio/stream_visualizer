//! JS value semantics on serde_json values: `+x`, `String(x)`, `parseFloat(x)`, Number#toString, `new Date(ms).toISOString()`.
//! `None` stands for `undefined`, `Value::Null` for `null` (JSON.stringify drops undefined properties, so a missing key is None).
use serde_json::Value;
use std::cmp::Ordering;

fn is_ws(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// Number#toString (radix 10).
pub fn num_str(x: f64) -> String {
    if x.is_nan() { return "NaN".into(); }
    if x == 0.0 { return "0".into(); }
    if x.is_infinite() { return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() }; }
    let sign = if x < 0.0 { "-" } else { "" };
    let s = format!("{:e}", x.abs());
    let (mant, exp) = s.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    let digits: String = mant.replace('.', "");
    let k = digits.len() as i32;
    let n = exp + 1;
    let body = if k <= n && n <= 21 {
        format!("{}{}", digits, "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), digits)
    } else {
        let e = n - 1;
        let es = format!("{}{}", if e < 0 { "-" } else { "+" }, e.abs());
        if k == 1 { format!("{}e{}", digits, es) } else { format!("{}.{}e{}", &digits[..1], &digits[1..], es) }
    };
    format!("{sign}{body}")
}

/// String(x)
pub fn to_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => num_str(n.as_f64().unwrap_or(f64::NAN)),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a.iter().map(|e| if e.is_null() { String::new() } else { to_string(Some(e)) }).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// Length of the longest prefix of `s` that is an unsigned decimal literal (digits, optional point, optional exponent).
fn decimal_len(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() && b[i].is_ascii_digit() { i += 1; }
    let int = i;
    let mut frac = 0;
    if i < b.len() && b[i] == b'.' {
        let mut j = i + 1;
        while j < b.len() && b[j].is_ascii_digit() { j += 1; }
        frac = j - i - 1;
        if int > 0 || frac > 0 { i = j; }
    }
    if int == 0 && frac == 0 { return None; }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') { j += 1; }
        let d = j;
        while j < b.len() && b[j].is_ascii_digit() { j += 1; }
        if j > d { i = j; }
    }
    Some(i)
}

fn str_to_number(s: &str) -> f64 {
    let t = s.trim_matches(is_ws);
    if t.is_empty() { return 0.0; }
    let b = t.as_bytes();
    if b.len() > 2 && b[0] == b'0' {
        let radix = match b[1] { b'x' | b'X' => 16, b'o' | b'O' => 8, b'b' | b'B' => 2, _ => 0 };
        if radix != 0 {
            let mut v = 0f64;
            for c in t[2..].chars() { match c.to_digit(radix) { Some(d) => v = v * radix as f64 + d as f64, None => return f64::NAN } }
            return v;
        }
    }
    let (neg, rest) = match b[0] { b'+' => (false, &t[1..]), b'-' => (true, &t[1..]), _ => (false, t) };
    if rest == "Infinity" { return if neg { f64::NEG_INFINITY } else { f64::INFINITY }; }
    if decimal_len(rest) == Some(rest.len()) { return t.parse::<f64>().unwrap_or(f64::NAN); }
    f64::NAN
}

/// +x
pub fn to_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => if *b { 1.0 } else { 0.0 },
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => str_to_number(s),
        Some(Value::Array(_)) => str_to_number(&to_string(v)),
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// parseFloat(x)
pub fn parse_float(v: Option<&Value>) -> f64 {
    if let Some(Value::Number(n)) = v { return n.as_f64().unwrap_or(f64::NAN); }
    let s = to_string(v);
    let t = s.trim_start_matches(is_ws);
    let (neg, rest) = match t.as_bytes().first() { Some(b'+') => (false, &t[1..]), Some(b'-') => (true, &t[1..]), _ => (false, t) };
    if rest.starts_with("Infinity") { return if neg { f64::NEG_INFINITY } else { f64::INFINITY }; }
    match decimal_len(rest) {
        Some(n) => format!("{}{}", if neg { "-" } else { "" }, &rest[..n]).parse::<f64>().unwrap_or(f64::NAN),
        None => f64::NAN,
    }
}

/// Math.min (NaN wins, -0 is below +0).
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { return f64::NAN; }
    if a == b { return if a == 0.0 && (a.is_sign_negative() || b.is_sign_negative()) { -0.0 } else { a }; }
    if a < b { a } else { b }
}
/// Math.max (NaN wins, +0 is above -0).
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { return f64::NAN; }
    if a == b { return if a == 0.0 && (a.is_sign_positive() || b.is_sign_positive()) { 0.0 } else { a }; }
    if a > b { a } else { b }
}

/// Math.sign
pub fn sign(x: f64) -> f64 { if x.is_nan() { x } else if x > 0.0 { 1.0 } else if x < 0.0 { -1.0 } else { x } }

/// JS truthiness of a number.
pub fn truthy_num(x: f64) -> bool { x != 0.0 && !x.is_nan() }

/// JS truthiness of a JSON value (None = undefined).
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => truthy_num(n.as_f64().unwrap_or(f64::NAN)),
        _ => true,
    }
}

/// A number that may not be finite, as JSON: finite stays a number, NaN / Infinity / -Infinity become the strings JS prints (the JS wrapper turns them back).
pub fn num_v(x: f64) -> Value {
    if x.is_finite() { serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number) } else { Value::String(num_str(x)) }
}

/// A number from JSON that may be a non-finite or negative-zero number sent as text ("NaN", "Infinity", "-Infinity", "-0"); null or a non-number is NaN.
pub fn num_in(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(t) => match t.as_str() { "-0" => -0.0, "Infinity" => f64::INFINITY, "-Infinity" => f64::NEG_INFINITY, _ => f64::NAN },
        _ => f64::NAN,
    }
}
/// Like num_in, but None when the value is not a number at all (null, undefined, other text).
pub fn num_in_opt(v: &Value) -> Option<f64> {
    match v { Value::Number(n) => n.as_f64(), Value::String(t) if matches!(t.as_str(), "-0" | "Infinity" | "-Infinity" | "NaN") => Some(num_in(v)), _ => None }
}
/// serde serialize_with: a number out; NaN / Infinity / -Infinity as their text, negative zero as "-0" (the JS wrapper turns them back).
pub fn ser_num<S: serde::Serializer>(x: &f64, s: S) -> Result<S::Ok, S::Error> {
    if x.is_finite() && !(*x == 0.0 && x.is_sign_negative()) { s.serialize_f64(*x) } else if *x == 0.0 { s.serialize_str("-0") } else { s.serialize_str(&num_str(*x)) }
}
pub fn ser_opt_num<S: serde::Serializer>(x: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
    match x { None => s.serialize_none(), Some(x) => ser_num(x, s) }
}

/// `+x.toFixed(10)`.
pub fn to_fixed10(x: f64) -> f64 {
    if x == 0.0 { return 0.0; }
    if !x.is_finite() || x.abs() >= 1e21 { return x; }
    let a = x.abs();
    let t = a * 2048.0;
    // an exact tie (x is an odd multiple of 2^-11): JS takes the larger n, i.e. away from zero; Rust would round half to even
    let tie = t.fract() == 0.0 && t < 1e30 && (t as u128) % 2 == 1;
    let s = if tie {
        let f = format!("{:.11}", a);
        let mut d: Vec<u8> = f.bytes().take(f.len() - 1).collect();
        let mut i = d.len();
        loop {
            i -= 1;
            if d[i] == b'.' { continue; }
            if d[i] == b'9' { d[i] = b'0'; if i == 0 { d.insert(0, b'1'); break; } } else { d[i] += 1; break; }
        }
        String::from_utf8(d).unwrap()
    } else { format!("{:.10}", a) };
    let v: f64 = s.parse().unwrap();
    if x < 0.0 { -v } else { v }
}

/// new Date(ms).toISOString(); None when the date is invalid (the JS throws RangeError).
pub fn iso(ms: f64) -> Option<String> {
    if !ms.is_finite() || ms.abs() > 8.64e15 { return None; }
    let t = ms.trunc() as i64;
    let days = t.div_euclid(86_400_000);
    let rem = t.rem_euclid(86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let ys = if (0..=9999).contains(&y) { format!("{:04}", y) } else { format!("{}{:06}", if y < 0 { "-" } else { "+" }, y.abs()) };
    Some(format!("{}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", ys, m, d, rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000))
}

/// Default Array#sort order of strings (UTF-16 code units).
pub fn cmp_utf16(a: &str, b: &str) -> Ordering { a.encode_utf16().cmp(b.encode_utf16()) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nums() {
        assert_eq!(num_str(1e21), "1e+21");
        assert_eq!(num_str(123456789.0), "123456789");
        assert_eq!(num_str(0.000001), "0.000001");
        assert_eq!(num_str(1e-7), "1e-7");
        assert_eq!(num_str(1.5e-7), "1.5e-7");
        assert_eq!(num_str(-0.5), "-0.5");
        assert_eq!(iso(1700000000000.0).unwrap(), "2023-11-14T22:13:20.000Z");
    }
}
