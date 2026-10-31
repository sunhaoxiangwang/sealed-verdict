//! Admission engine.
//!
//! One implementation decides which messages count. The Clerk runs it live as
//! messages arrive and logs each [`Admission`] to the Ledger; the verifier runs
//! the same engine over the covered transcript and compares its own result
//! with the certificate. `LedgerEntry.status` therefore never authorizes
//! anything: it is what the Clerk said, and replay recomputes it.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commitment::commitment_for_reveal;
use crate::sign::verify_value;
use crate::types::{
    Argument, Commit, Condition, EntryKind, EntryStatus, Evidence, Phase, PhaseMarker, Registry,
    Reveal, Signed, CLOSE_ORDER, NO_QUORUM, QUORUM_NEEDED,
};
use crate::validate::{validate_argument, validate_commit, validate_evidence, validate_reveal};

/// Audit reason strings written to `LedgerEntry.reason`.
pub mod reasons {
    pub const MALFORMED: &str = "MALFORMED";
    pub const OUT_OF_PHASE: &str = "OUT_OF_PHASE";
    pub const CASE_CLOSED: &str = "CASE_CLOSED";
    pub const WRONG_CASE: &str = "WRONG_CASE";
    pub const WRONG_ROUND: &str = "WRONG_ROUND";
    pub const UNKNOWN_JUROR: &str = "UNKNOWN_JUROR";
    pub const UNSIGNED: &str = "UNSIGNED";
    pub const WRONG_SIGNER: &str = "WRONG_SIGNER";
    pub const BAD_SIGNATURE: &str = "BAD_SIGNATURE";
    pub const INVALID_FIELDS: &str = "INVALID_FIELDS";
    pub const INVALID_VOTE: &str = "INVALID_VOTE";
    pub const DUPLICATE_BALLOT: &str = "DUPLICATE_BALLOT";
    pub const DUPLICATE_EVIDENCE: &str = "DUPLICATE_EVIDENCE";
    pub const NO_COMMIT: &str = "NO_COMMIT";
    pub const COMMITMENT_MISMATCH: &str = "COMMITMENT_MISMATCH";
    pub const PHASE_ORDER: &str = "PHASE_ORDER";
}

/// Result of admitting one message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Admission {
    pub status: EntryStatus,
    pub reason: Option<String>,
}

impl Admission {
    fn accepted() -> Self {
        Self {
            status: EntryStatus::Accepted,
            reason: None,
        }
    }
    fn rejected(reason: &str) -> Self {
        Self {
            status: EntryStatus::Rejected,
            reason: Some(reason.to_string()),
        }
    }
    fn unattested(reason: &str) -> Self {
        Self {
            status: EntryStatus::Unattested,
            reason: Some(reason.to_string()),
        }
    }
    pub fn is_accepted(&self) -> bool {
        self.status == EntryStatus::Accepted
    }
}

/// Round-1 tally recomputed from accepted reveals.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tally {
    /// Distinct jurors with an accepted round-1 reveal.
    pub counted: u32,
    pub per_choice: BTreeMap<String, u32>,
    /// Winning choice, or `NO_QUORUM`.
    pub verdict: String,
}

pub struct Engine {
    registry: Registry,
    close_idx: usize,
    last_was_final_close: bool,
    phase_failures: Vec<String>,
    attested_evidence: BTreeSet<String>,
    cited_evidence: BTreeSet<String>,
    commits: [BTreeMap<String, String>; 2],
    /// Accepted reveals per round, keyed by juror id: the envelope exactly as
    /// received plus its parsed body.
    reveals: [BTreeMap<String, (Value, Reveal)>; 2],
}

fn authenticate(msg: &Value, kind: &str, expected_pk: &str) -> Result<(), &'static str> {
    let sig = msg.get("sig").and_then(Value::as_str);
    let signer = msg.get("signer").and_then(Value::as_str);
    let (Some(sig), Some(signer)) = (sig, signer) else {
        return Err(reasons::UNSIGNED);
    };
    if signer != expected_pk {
        return Err(reasons::WRONG_SIGNER);
    }
    let Some(body) = msg.get("body") else {
        return Err(reasons::MALFORMED);
    };
    verify_value(kind, body, Some(sig), Some(signer)).map_err(|_| reasons::BAD_SIGNATURE)
}

impl Engine {
    pub fn new(registry: Registry) -> Self {
        Self {
            registry,
            close_idx: 0,
            last_was_final_close: false,
            phase_failures: Vec::new(),
            attested_evidence: BTreeSet::new(),
            cited_evidence: BTreeSet::new(),
            commits: [BTreeMap::new(), BTreeMap::new()],
            reveals: [BTreeMap::new(), BTreeMap::new()],
        }
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    /// The phase currently open, or `None` once the final close has passed.
    pub fn window(&self) -> Option<(Phase, u8)> {
        CLOSE_ORDER.get(self.close_idx).copied()
    }

    pub fn closes_seen(&self) -> usize {
        self.close_idx
    }

    pub fn is_closed(&self) -> bool {
        self.close_idx == CLOSE_ORDER.len()
    }

    /// True when the most recent entry was the accepted round-1 reveal close.
    pub fn ended_on_final_close(&self) -> bool {
        self.last_was_final_close
    }

    /// Out-of-order or post-close authenticated markers seen so far.
    pub fn phase_failures(&self) -> &[String] {
        &self.phase_failures
    }

    pub fn attested_evidence(&self) -> &BTreeSet<String> {
        &self.attested_evidence
    }

    /// Attested evidence ids cited by attested arguments.
    pub fn cited_evidence(&self) -> &BTreeSet<String> {
        &self.cited_evidence
    }

    pub fn accepted_commit(&self, round: u8, juror: &str) -> Option<&str> {
        self.commits
            .get(round as usize)?
            .get(juror)
            .map(String::as_str)
    }

    pub fn accepted_reveals(&self, round: u8) -> &BTreeMap<String, (Value, Reveal)> {
        &self.reveals[(round as usize).min(1)]
    }

    /// Record that an entry was present but not admissible as any known kind.
    pub fn mark_unparsed(&mut self) {
        self.last_was_final_close = false;
    }

    /// Admit a message of the given kind in the current window.
    pub fn admit(&mut self, kind: EntryKind, msg: &Value) -> Admission {
        self.last_was_final_close = false;
        match kind {
            EntryKind::Phase => self.admit_phase(msg),
            EntryKind::Evidence => self.admit_evidence(msg),
            EntryKind::Commit => self.admit_commit(msg),
            EntryKind::Reveal => self.admit_reveal(msg),
            EntryKind::Argument => self.admit_argument(msg),
        }
    }

    fn juror_auth(&self, msg: &Value, kind: &str, juror: &str) -> Result<(), &'static str> {
        let Some(pk) = self.registry.juror_pubkey(juror) else {
            return Err(reasons::UNKNOWN_JUROR);
        };
        match self.registry.condition {
            Condition::C2 => Ok(()),
            _ => authenticate(msg, kind, pk),
        }
    }

    fn oracle_auth(&self, msg: &Value) -> Result<(), &'static str> {
        match self.registry.condition {
            Condition::C2 => Ok(()),
            _ => authenticate(msg, "evidence", &self.registry.oracle),
        }
    }

    fn admit_phase(&mut self, msg: &Value) -> Admission {
        let env: Signed<PhaseMarker> = match serde_json::from_value(msg.clone()) {
            Ok(e) => e,
            Err(_) => return Admission::rejected(reasons::MALFORMED),
        };
        if let Err(r) = authenticate(msg, "phase", &self.registry.clerk) {
            return Admission::rejected(r);
        }
        if env.body.case_id != self.registry.case_id {
            return Admission::rejected(reasons::WRONG_CASE);
        }
        match self.window() {
            None => {
                self.phase_failures
                    .push("close marker after the final close".to_string());
                Admission::rejected(reasons::CASE_CLOSED)
            }
            Some((p, r)) if p == env.body.phase && r == env.body.round => {
                self.close_idx += 1;
                if self.is_closed() {
                    self.last_was_final_close = true;
                }
                Admission::accepted()
            }
            Some((p, r)) => {
                self.phase_failures.push(format!(
                    "expected close {:?}/{r}, got {:?}/{}",
                    p, env.body.phase, env.body.round
                ));
                Admission::rejected(reasons::PHASE_ORDER)
            }
        }
    }

    fn admit_evidence(&mut self, msg: &Value) -> Admission {
        if self.window() != Some((Phase::Attest, 0)) {
            return Admission::unattested(reasons::OUT_OF_PHASE);
        }
        let env: Signed<Evidence> = match serde_json::from_value(msg.clone()) {
            Ok(e) => e,
            Err(_) => return Admission::unattested(reasons::MALFORMED),
        };
        if env.body.case_id != self.registry.case_id {
            return Admission::unattested(reasons::WRONG_CASE);
        }
        if validate_evidence(&env.body).is_err() {
            return Admission::unattested(reasons::INVALID_FIELDS);
        }
        if let Err(r) = self.oracle_auth(msg) {
            return Admission::unattested(r);
        }
        if !self.attested_evidence.insert(env.body.id.clone()) {
            return Admission::rejected(reasons::DUPLICATE_EVIDENCE);
        }
        Admission::accepted()
    }

    fn admit_commit(&mut self, msg: &Value) -> Admission {
        let Some((Phase::Commit, r)) = self.window() else {
            return Admission::rejected(reasons::OUT_OF_PHASE);
        };
        let env: Signed<Commit> = match serde_json::from_value(msg.clone()) {
            Ok(e) => e,
            Err(_) => return Admission::rejected(reasons::MALFORMED),
        };
        let b = &env.body;
        if b.case_id != self.registry.case_id {
            return Admission::rejected(reasons::WRONG_CASE);
        }
        if b.round != r {
            return Admission::rejected(reasons::WRONG_ROUND);
        }
        if validate_commit(b).is_err() {
            return Admission::rejected(reasons::INVALID_FIELDS);
        }
        if let Err(reason) = self.juror_auth(msg, "commit", &b.juror) {
            return Admission::rejected(reason);
        }
        let slot = &mut self.commits[r as usize];
        if slot.contains_key(&b.juror) {
            return Admission::rejected(reasons::DUPLICATE_BALLOT);
        }
        slot.insert(b.juror.clone(), b.commitment.clone());
        Admission::accepted()
    }

    fn admit_reveal(&mut self, msg: &Value) -> Admission {
        let Some((Phase::Reveal, r)) = self.window() else {
            return Admission::rejected(reasons::OUT_OF_PHASE);
        };
        let env: Signed<Reveal> = match serde_json::from_value(msg.clone()) {
            Ok(e) => e,
            Err(_) => return Admission::rejected(reasons::MALFORMED),
        };
        let b = &env.body;
        if b.case_id != self.registry.case_id {
            return Admission::rejected(reasons::WRONG_CASE);
        }
        if b.round != r {
            return Admission::rejected(reasons::WRONG_ROUND);
        }
        if validate_reveal(b).is_err() {
            return Admission::rejected(reasons::INVALID_FIELDS);
        }
        if !self.registry.choices.contains(&b.vote) {
            return Admission::rejected(reasons::INVALID_VOTE);
        }
        if let Err(reason) = self.juror_auth(msg, "reveal", &b.juror) {
            return Admission::rejected(reason);
        }
        let Some(commitment) = self.commits[r as usize].get(&b.juror) else {
            return Admission::rejected(reasons::NO_COMMIT);
        };
        match commitment_for_reveal(b) {
            Ok(expected) if &expected == commitment => {}
            _ => return Admission::rejected(reasons::COMMITMENT_MISMATCH),
        }
        let slot = &mut self.reveals[r as usize];
        if slot.contains_key(&b.juror) {
            return Admission::rejected(reasons::DUPLICATE_BALLOT);
        }
        slot.insert(b.juror.clone(), (msg.clone(), b.clone()));
        Admission::accepted()
    }

    fn admit_argument(&mut self, msg: &Value) -> Admission {
        if self.window() != Some((Phase::Deliberate, 0)) {
            return Admission::rejected(reasons::OUT_OF_PHASE);
        }
        let env: Signed<Argument> = match serde_json::from_value(msg.clone()) {
            Ok(e) => e,
            Err(_) => return Admission::rejected(reasons::MALFORMED),
        };
        let b = &env.body;
        if b.case_id != self.registry.case_id {
            return Admission::rejected(reasons::WRONG_CASE);
        }
        if b.round != 0 {
            return Admission::rejected(reasons::WRONG_ROUND);
        }
        if validate_argument(b).is_err() {
            return Admission::rejected(reasons::INVALID_FIELDS);
        }
        if let Err(reason) = self.juror_auth(msg, "argument", &b.juror) {
            return Admission::unattested(reason);
        }
        for id in &b.evidence_ids {
            if self.attested_evidence.contains(id) {
                self.cited_evidence.insert(id.clone());
            }
        }
        Admission::accepted()
    }

    /// Round-1 tally. Three matching distinct jurors certify a choice;
    /// anything else is `NO_QUORUM`.
    pub fn tally(&self) -> Tally {
        let r1 = &self.reveals[1];
        let mut per_choice: BTreeMap<String, u32> = BTreeMap::new();
        for (_, reveal) in r1.values() {
            *per_choice.entry(reveal.vote.clone()).or_insert(0) += 1;
        }
        let verdict = per_choice
            .iter()
            .find(|(_, &count)| count >= QUORUM_NEEDED)
            .map(|(choice, _)| choice.clone())
            .unwrap_or_else(|| NO_QUORUM.to_string());
        Tally {
            counted: r1.len() as u32,
            per_choice,
            verdict,
        }
    }

    /// Accepted round-1 reveal envelopes exactly as received, sorted by juror id.
    pub fn certificate_votes(&self) -> Vec<Value> {
        self.reveals[1]
            .values()
            .map(|(env, _)| env.clone())
            .collect()
    }

    /// Sorted unique attested evidence ids cited by attested arguments.
    pub fn certificate_evidence_ids(&self) -> Vec<String> {
        self.cited_evidence.iter().cloned().collect()
    }
}
