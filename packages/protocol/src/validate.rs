//! Central field validation shared by the Clerk (live admission) and the
//! verifier (replay). Semantic checks live here so the two never drift.

use std::collections::BTreeSet;

use crate::error::ProtocolError;
use crate::hash::is_lower_hex;
use crate::sign::public_key_valid;
use crate::types::{Argument, Commit, Evidence, Registry, Reveal, NO_QUORUM, QUORUM_N};

fn invalid(msg: impl Into<String>) -> ProtocolError {
    ProtocolError::Invalid(msg.into())
}

pub fn validate_hex32(field: &str, s: &str) -> Result<(), ProtocolError> {
    if is_lower_hex(s, 32) {
        Ok(())
    } else {
        Err(invalid(format!(
            "{field} must be 32 bytes of lowercase hex"
        )))
    }
}

pub fn validate_confidence(c: u8) -> Result<(), ProtocolError> {
    if c <= 100 {
        Ok(())
    } else {
        Err(invalid("confidence must be 0..=100"))
    }
}

fn non_empty(field: &str, s: &str) -> Result<(), ProtocolError> {
    if s.is_empty() {
        Err(invalid(format!("{field} must not be empty")))
    } else {
        Ok(())
    }
}

pub fn validate_round(round: u8) -> Result<(), ProtocolError> {
    if round <= 1 {
        Ok(())
    } else {
        Err(invalid("round must be 0 or 1"))
    }
}

pub fn validate_evidence(e: &Evidence) -> Result<(), ProtocolError> {
    non_empty("id", &e.id)?;
    non_empty("caseId", &e.case_id)?;
    non_empty("source", &e.source)?;
    validate_hex32("contentHash", &e.content_hash)
}

pub fn validate_commit(c: &Commit) -> Result<(), ProtocolError> {
    non_empty("caseId", &c.case_id)?;
    non_empty("juror", &c.juror)?;
    validate_round(c.round)?;
    validate_hex32("commitment", &c.commitment)
}

/// Field validity only. Choice membership is checked against the registry by
/// the admission engine.
pub fn validate_reveal(r: &Reveal) -> Result<(), ProtocolError> {
    non_empty("caseId", &r.case_id)?;
    non_empty("juror", &r.juror)?;
    non_empty("vote", &r.vote)?;
    validate_round(r.round)?;
    validate_confidence(r.confidence)?;
    validate_hex32("nonce", &r.nonce)
}

pub fn validate_argument(a: &Argument) -> Result<(), ProtocolError> {
    non_empty("caseId", &a.case_id)?;
    non_empty("juror", &a.juror)?;
    validate_round(a.round)
}

/// Choices are unique, non-empty answer ids. `NO_QUORUM` is reserved.
pub fn validate_choices(choices: &[String]) -> Result<(), ProtocolError> {
    if choices.is_empty() {
        return Err(invalid("choices must not be empty"));
    }
    let mut seen = BTreeSet::new();
    for c in choices {
        non_empty("choice", c)?;
        if c == NO_QUORUM {
            return Err(invalid("NO_QUORUM is reserved and cannot be a choice"));
        }
        if !seen.insert(c.as_str()) {
            return Err(invalid(format!("duplicate choice {c}")));
        }
    }
    Ok(())
}

/// Registry sanity: valid, distinct role keys; exactly `QUORUM_N` jurors with
/// unique ids and keys distinct from every other key; valid choices.
pub fn validate_registry(reg: &Registry) -> Result<(), ProtocolError> {
    non_empty("caseId", &reg.case_id)?;
    validate_choices(&reg.choices)?;
    let mut keys = BTreeSet::new();
    for (name, key) in [
        ("ledger", &reg.ledger),
        ("clerk", &reg.clerk),
        ("oracle", &reg.oracle),
    ] {
        if !public_key_valid(key) {
            return Err(invalid(format!(
                "{name} key is not a valid Ed25519 public key"
            )));
        }
        if !keys.insert(key.as_str()) {
            return Err(invalid(format!("{name} key duplicates another key")));
        }
    }
    if reg.jurors.len() != QUORUM_N as usize {
        return Err(invalid(format!(
            "expected {QUORUM_N} jurors, found {}",
            reg.jurors.len()
        )));
    }
    let mut ids = BTreeSet::new();
    for j in &reg.jurors {
        non_empty("juror id", &j.id)?;
        if !ids.insert(j.id.as_str()) {
            return Err(invalid(format!("duplicate juror id {}", j.id)));
        }
        if !public_key_valid(&j.pubkey) {
            return Err(invalid(format!(
                "juror {} key is not a valid Ed25519 public key",
                j.id
            )));
        }
        if !keys.insert(j.pubkey.as_str()) {
            return Err(invalid(format!(
                "juror {} key duplicates another key",
                j.id
            )));
        }
    }
    Ok(())
}
