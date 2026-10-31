//! Certificate verification by bounded transcript replay.
//!
//! `verify_cert` never panics on malformed input. It collects every failure
//! it can establish, each as `CODE: detail` with a stable code from [`codes`].

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::canonical::canonical_value_bytes;
use crate::chain::chain_root;
use crate::replay::Engine;
use crate::sign::verify_value;
use crate::types::{
    CertBody, EntryKind, VerdictCert, CLOSE_ORDER, NO_QUORUM, QUORUM_F, QUORUM_N, QUORUM_NEEDED,
};
use crate::validate::validate_registry;

/// Stable failure codes. The text before the first `:` in a failure string.
pub mod codes {
    pub const SCHEMA_INVALID: &str = "SCHEMA_INVALID";
    pub const REGISTRY_INVALID: &str = "REGISTRY_INVALID";
    pub const CERT_SIGNER_NOT_LEDGER: &str = "CERT_SIGNER_NOT_LEDGER";
    pub const CERT_SIG_INVALID: &str = "CERT_SIG_INVALID";
    pub const TRANSCRIPT_BOUNDS_INVALID: &str = "TRANSCRIPT_BOUNDS_INVALID";
    pub const TRANSCRIPT_ROOT_MISMATCH: &str = "TRANSCRIPT_ROOT_MISMATCH";
    pub const PHASE_ORDER_INVALID: &str = "PHASE_ORDER_INVALID";
    pub const QUORUM_FIELDS_INVALID: &str = "QUORUM_FIELDS_INVALID";
    pub const VERDICT_INVALID: &str = "VERDICT_INVALID";
    pub const QUORUM_NOT_MET: &str = "QUORUM_NOT_MET";
    pub const TALLY_MISMATCH: &str = "TALLY_MISMATCH";
    pub const VOTES_MISMATCH: &str = "VOTES_MISMATCH";
    pub const EVIDENCE_IDS_MISMATCH: &str = "EVIDENCE_IDS_MISMATCH";
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerifyReport {
    pub valid: bool,
    pub failures: Vec<String>,
}

impl VerifyReport {
    /// True when some failure carries the given code.
    pub fn has_code(&self, code: &str) -> bool {
        self.failures
            .iter()
            .any(|f| f.split(':').next() == Some(code))
    }
}

fn fail(code: &str, detail: impl AsRef<str>) -> VerifyReport {
    VerifyReport {
        valid: false,
        failures: vec![entry(code, detail)],
    }
}

fn entry(code: &str, detail: impl AsRef<str>) -> String {
    let d = detail.as_ref();
    if d.is_empty() {
        code.to_string()
    } else {
        format!("{code}: {d}")
    }
}

/// Verify a certificate given as JSON text.
pub fn verify_cert_json(json: &str) -> VerifyReport {
    match serde_json::from_str::<Value>(json) {
        Ok(v) => verify_cert(&v),
        Err(e) => fail(codes::SCHEMA_INVALID, format!("not JSON: {e}")),
    }
}

/// Verify a typed bundle (producers and tests).
pub fn verify_cert_typed(cert: &VerdictCert) -> VerifyReport {
    match serde_json::to_value(cert) {
        Ok(v) => verify_cert(&v),
        Err(e) => fail(codes::SCHEMA_INVALID, e.to_string()),
    }
}

fn parse_kind(s: &str) -> Option<EntryKind> {
    serde_json::from_value(Value::String(s.to_string())).ok()
}

/// Verify a `{ cert, transcript }` bundle by replaying the covered transcript.
pub fn verify_cert(root: &Value) -> VerifyReport {
    let mut failures: Vec<String> = Vec::new();
    let mut push = |code: &str, detail: String| failures.push(entry(code, &detail));

    let Some(obj) = root.as_object() else {
        return fail(codes::SCHEMA_INVALID, "certificate must be a JSON object");
    };
    for key in obj.keys() {
        if key != "cert" && key != "transcript" {
            push(
                codes::SCHEMA_INVALID,
                format!("unexpected top-level key {key}"),
            );
        }
    }
    let Some(cert) = obj.get("cert").filter(|c| c.is_object()) else {
        return fail(codes::SCHEMA_INVALID, "cert must be an object");
    };
    let Some(transcript) = obj.get("transcript").and_then(Value::as_array) else {
        return fail(codes::SCHEMA_INVALID, "transcript must be an array");
    };
    let Some(body_v) = cert.get("body") else {
        return fail(codes::SCHEMA_INVALID, "cert.body missing");
    };
    let body: CertBody = match serde_json::from_value(body_v.clone()) {
        Ok(b) => b,
        Err(e) => return fail(codes::SCHEMA_INVALID, format!("cert.body: {e}")),
    };
    let reg = &body.registry;

    // 1. Registry and roles.
    if let Err(e) = validate_registry(reg) {
        push(codes::REGISTRY_INVALID, e.to_string());
    }
    if reg.case_id != body.case_id {
        push(
            codes::REGISTRY_INVALID,
            "registry.caseId differs from certificate caseId".into(),
        );
    }

    // 2. Ledger signature over the body exactly as received.
    let sig = cert.get("sig").and_then(Value::as_str);
    let signer = cert.get("signer").and_then(Value::as_str);
    if signer != Some(reg.ledger.as_str()) {
        push(
            codes::CERT_SIGNER_NOT_LEDGER,
            format!("signer {:?} is not the registry ledger key", signer),
        );
    }
    if let Err(e) = verify_value("cert", body_v, sig, signer) {
        push(codes::CERT_SIG_INVALID, e.to_string());
    }

    // 3. Bounds, sequence, chain.
    let covered: &[Value] = match usize::try_from(body.transcript_len) {
        Ok(n) if n >= 1 && n <= transcript.len() => &transcript[..n],
        _ => {
            push(
                codes::TRANSCRIPT_BOUNDS_INVALID,
                format!(
                    "transcriptLen {} outside 1..={}",
                    body.transcript_len,
                    transcript.len()
                ),
            );
            &transcript[..]
        }
    };
    for (i, e) in covered.iter().enumerate() {
        if e.get("seq").and_then(Value::as_u64) != Some(i as u64) {
            push(
                codes::TRANSCRIPT_BOUNDS_INVALID,
                format!("entry {i} has seq {}", e.get("seq").unwrap_or(&Value::Null)),
            );
            break;
        }
    }
    match chain_root(&body.case_id, covered) {
        Ok(h) if hex::encode(h) == body.transcript_root => {}
        Ok(h) => push(
            codes::TRANSCRIPT_ROOT_MISMATCH,
            format!("recomputed {}", hex::encode(h)),
        ),
        Err(e) => push(
            codes::TRANSCRIPT_ROOT_MISMATCH,
            format!("entry not hashable: {e}"),
        ),
    }

    // 4. Replay admission with the same engine the Clerk used.
    let mut engine = Engine::new(reg.clone());
    for e in covered {
        let kind = e.get("kind").and_then(Value::as_str).and_then(parse_kind);
        match (kind, e.get("msg")) {
            (Some(k), Some(msg)) => {
                engine.admit(k, msg);
            }
            _ => engine.mark_unparsed(),
        }
    }
    for pf in engine.phase_failures() {
        push(codes::PHASE_ORDER_INVALID, pf.clone());
    }
    if !engine.is_closed() {
        push(
            codes::PHASE_ORDER_INVALID,
            format!(
                "only {} of {} phase closes present",
                engine.closes_seen(),
                CLOSE_ORDER.len()
            ),
        );
    } else if !engine.ended_on_final_close() {
        push(
            codes::PHASE_ORDER_INVALID,
            "covered transcript must end with the round-1 reveal close".into(),
        );
    }

    // 5. Tally and quorum.
    let tally = engine.tally();
    let q = body.quorum;
    if q.n != QUORUM_N || q.f != QUORUM_F || q.needed != QUORUM_NEEDED || q.counted != tally.counted
    {
        push(
            codes::QUORUM_FIELDS_INVALID,
            format!(
                "expected n={QUORUM_N} f={QUORUM_F} needed={QUORUM_NEEDED} counted={}, got n={} f={} needed={} counted={}",
                tally.counted, q.n, q.f, q.needed, q.counted
            ),
        );
    }
    if body.verdict != NO_QUORUM && !reg.choices.contains(&body.verdict) {
        push(
            codes::VERDICT_INVALID,
            format!("{} is neither a case choice nor NO_QUORUM", body.verdict),
        );
    }
    if body.verdict != tally.verdict {
        if tally.verdict == NO_QUORUM {
            push(
                codes::QUORUM_NOT_MET,
                format!("certificate claims {} but no choice reached {QUORUM_NEEDED} matching round-1 votes", body.verdict),
            );
        } else {
            push(
                codes::TALLY_MISMATCH,
                format!(
                    "replay certifies {}, certificate says {}",
                    tally.verdict, body.verdict
                ),
            );
        }
    }

    // 6. Vote envelopes must equal the reconstructed accepted round-1 reveals.
    let expected_votes = engine.certificate_votes();
    let actual_votes: Vec<Value> = body_v
        .get("votes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if actual_votes.len() != expected_votes.len() {
        push(
            codes::VOTES_MISMATCH,
            format!(
                "certificate carries {} vote envelopes, replay accepted {}",
                actual_votes.len(),
                expected_votes.len()
            ),
        );
    } else {
        for (i, (a, e)) in actual_votes.iter().zip(expected_votes.iter()).enumerate() {
            let same = match (canonical_value_bytes(a), canonical_value_bytes(e)) {
                (Ok(x), Ok(y)) => x == y,
                _ => false,
            };
            if !same {
                push(
                    codes::VOTES_MISMATCH,
                    format!("vote {i} differs from the accepted round-1 reveal envelope"),
                );
                break;
            }
        }
    }

    // 7. Evidence ids.
    let expected_ev = engine.certificate_evidence_ids();
    if body.evidence_ids != expected_ev {
        push(
            codes::EVIDENCE_IDS_MISMATCH,
            format!("replay cites {:?}", expected_ev),
        );
    }

    VerifyReport {
        valid: failures.is_empty(),
        failures,
    }
}
