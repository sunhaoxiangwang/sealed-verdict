//! Commitment encoding.
//!
//! `commitment = SHA256(UTF8("sv1/commit\n") || canonical({caseId, round, juror, vote, nonce}))`
//! where `nonce` is 32 fresh random bytes as lowercase hex.

use serde::Serialize;

use crate::canonical::canonical_bytes;
use crate::error::ProtocolError;
use crate::hash::sha256_hex;
use crate::types::Reveal;
use crate::PROTOCOL_VERSION;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitPreimage<'a> {
    case_id: &'a str,
    round: u8,
    juror: &'a str,
    vote: &'a str,
    nonce: &'a str,
}

pub fn commitment_hex(
    case_id: &str,
    round: u8,
    juror: &str,
    vote: &str,
    nonce_hex: &str,
) -> Result<String, ProtocolError> {
    let canon = canonical_bytes(&CommitPreimage {
        case_id,
        round,
        juror,
        vote,
        nonce: nonce_hex,
    })?;
    let mut input = format!("{PROTOCOL_VERSION}/commit\n").into_bytes();
    input.extend_from_slice(&canon);
    Ok(sha256_hex(&input))
}

/// The commitment a reveal must match.
pub fn commitment_for_reveal(r: &Reveal) -> Result<String, ProtocolError> {
    commitment_hex(&r.case_id, r.round, &r.juror, &r.vote, &r.nonce)
}
