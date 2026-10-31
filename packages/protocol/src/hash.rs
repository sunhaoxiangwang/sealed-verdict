//! SHA-256 helpers. Hashes travel as lowercase hex on the wire and are
//! concatenated as raw 32-byte digests inside the transcript chain.

use sha2::{Digest, Sha256};

use crate::error::ProtocolError;

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(sha256(bytes))
}

/// Decode a fixed-length lowercase or uppercase hex string.
pub fn decode_hex_array<const N: usize>(s: &str) -> Result<[u8; N], ProtocolError> {
    let bytes = hex::decode(s).map_err(|e| ProtocolError::Hex(e.to_string()))?;
    bytes
        .try_into()
        .map_err(|_| ProtocolError::Hex(format!("expected {N} bytes")))
}

/// True when `s` is exactly `n` bytes of lowercase hex.
pub fn is_lower_hex(s: &str, n: usize) -> bool {
    s.len() == n * 2 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
