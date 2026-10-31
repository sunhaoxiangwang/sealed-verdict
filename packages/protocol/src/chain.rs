//! Transcript chain.
//!
//! `h0 = SHA256(UTF8("sv1/chain\n" + caseId))`
//! `h_i = SHA256(raw32(h_{i-1}) || raw32(SHA256(canonical(entry_i))))`
//!
//! The complete ledger entry, including `status` and `reason`, is hashed.
//! Hex appears only on the wire; the chain concatenates raw digests.

use serde_json::Value;

use crate::canonical::canonical_value_bytes;
use crate::error::ProtocolError;
use crate::hash::sha256;
use crate::PROTOCOL_VERSION;

pub fn chain_genesis(case_id: &str) -> [u8; 32] {
    sha256(format!("{PROTOCOL_VERSION}/chain\n{case_id}").as_bytes())
}

pub fn chain_step(prev: &[u8; 32], entry: &Value) -> Result<[u8; 32], ProtocolError> {
    let entry_hash = sha256(&canonical_value_bytes(entry)?);
    let mut input = [0u8; 64];
    input[..32].copy_from_slice(prev);
    input[32..].copy_from_slice(&entry_hash);
    Ok(sha256(&input))
}

pub fn chain_root(case_id: &str, entries: &[Value]) -> Result<[u8; 32], ProtocolError> {
    let mut h = chain_genesis(case_id);
    for e in entries {
        h = chain_step(&h, e)?;
    }
    Ok(h)
}
