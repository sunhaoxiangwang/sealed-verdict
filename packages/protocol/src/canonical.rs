//! Deterministic canonical JSON.
//!
//! Rules: object keys sorted bytewise, no whitespace, serde_json string
//! escaping, integer numbers only (floats are rejected), `null` written as
//! `null`. Optional wire fields are omitted by the type definitions when
//! absent, so the same struct always canonicalizes to the same bytes, and a
//! parsed JSON document re-canonicalizes to the bytes its producer hashed.

use serde::Serialize;
use serde_json::Value;

use crate::error::ProtocolError;

/// Canonical bytes of any serializable value.
pub fn canonical_bytes<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, ProtocolError> {
    let v = serde_json::to_value(value)?;
    canonical_value_bytes(&v)
}

/// Canonical bytes of an already-parsed JSON value.
pub fn canonical_value_bytes(value: &Value) -> Result<Vec<u8>, ProtocolError> {
    let mut out = Vec::with_capacity(256);
    write_value(value, &mut out)?;
    Ok(out)
}

fn write_value(value: &Value, out: &mut Vec<u8>) -> Result<(), ProtocolError> {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Number(n) => {
            if n.is_f64() {
                return Err(ProtocolError::FloatNotAllowed);
            }
            out.extend_from_slice(n.to_string().as_bytes());
        }
        Value::String(s) => write_string(s, out)?,
        Value::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_value(item, out)?;
            }
            out.push(b']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
            out.push(b'{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_string(key, out)?;
                out.push(b':');
                write_value(&map[key], out)?;
            }
            out.push(b'}');
        }
    }
    Ok(())
}

fn write_string(s: &str, out: &mut Vec<u8>) -> Result<(), ProtocolError> {
    serde_json::to_writer(&mut *out, s)?;
    Ok(())
}
