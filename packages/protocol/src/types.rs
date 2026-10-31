//! Wire types. Field names are frozen; see docs/core.md.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Reserved verdict value when fewer than `QUORUM_NEEDED` round-1 votes agree.
pub const NO_QUORUM: &str = "NO_QUORUM";
/// Prototype quorum constants. The verifier enforces these and ignores
/// certificate-supplied values that disagree.
pub const QUORUM_N: u32 = 4;
pub const QUORUM_F: u32 = 1;
pub const QUORUM_NEEDED: u32 = QUORUM_N - QUORUM_F;

/// A message envelope. `sig` and `signer` are lowercase hex (64-byte Ed25519
/// signature, 32-byte public key). Under condition C2 an unsigned ballot sets
/// both to `null`; such a ballot is never juror-authenticated.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signed<T> {
    pub body: T,
    pub sig: Option<String>,
    pub signer: Option<String>,
}

impl<T> Signed<T> {
    /// Envelope with explicit `null` signature fields (C2 unsigned input).
    pub fn unsigned(body: T) -> Self {
        Self {
            body,
            sig: None,
            signer: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EvidenceKind {
    Fetch,
    Compute,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub id: String,
    pub case_id: String,
    pub kind: EvidenceKind,
    pub source: String,
    pub content_hash: String,
    pub excerpt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    pub ts: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Commit {
    pub case_id: String,
    pub round: u8,
    pub juror: String,
    pub commitment: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reveal {
    pub case_id: String,
    pub round: u8,
    pub juror: String,
    pub vote: String,
    pub confidence: u8,
    pub nonce: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Argument {
    pub case_id: String,
    pub round: u8,
    pub juror: String,
    pub text: String,
    pub evidence_ids: Vec<String>,
    pub prev_hash: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Attest,
    Commit,
    Reveal,
    Deliberate,
}

/// Clerk-signed phase-close marker. The frozen close order is [`CLOSE_ORDER`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhaseMarker {
    pub case_id: String,
    pub phase: Phase,
    pub round: u8,
    pub ts: u64,
}

/// Phase closes in this exact order. An entry's phase window is determined by
/// how many authenticated close markers precede it.
pub const CLOSE_ORDER: [(Phase, u8); 6] = [
    (Phase::Attest, 0),
    (Phase::Commit, 0),
    (Phase::Reveal, 0),
    (Phase::Deliberate, 0),
    (Phase::Commit, 1),
    (Phase::Reveal, 1),
];

/// Experimental condition. C2 accepts claimed juror identities without
/// authentication; C3 to C5 require valid juror, Oracle, Clerk and Ledger
/// signatures. Clerk and Ledger signatures are mandatory in every condition.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Condition {
    C2,
    C3,
    C4,
    C5,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JurorEntry {
    pub id: String,
    pub pubkey: String,
}

/// Static case registry fixed at case open and embedded in the certificate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    pub case_id: String,
    pub condition: Condition,
    pub choices: Vec<String>,
    pub ledger: String,
    pub clerk: String,
    pub oracle: String,
    pub jurors: Vec<JurorEntry>,
}

impl Registry {
    pub fn juror_pubkey(&self, id: &str) -> Option<&str> {
        self.jurors
            .iter()
            .find(|j| j.id == id)
            .map(|j| j.pubkey.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Quorum {
    pub n: u32,
    pub f: u32,
    pub needed: u32,
    /// Distinct jurors with an accepted round-1 reveal, including losing votes.
    pub counted: u32,
}

/// Ledger-signed certificate body.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CertBody {
    pub case_id: String,
    pub verdict: String,
    pub quorum: Quorum,
    pub transcript_root: String,
    pub transcript_len: u64,
    pub evidence_ids: Vec<String>,
    pub registry: Registry,
    /// Accepted round-1 reveal envelopes, exactly one per voting juror, sorted
    /// by juror id (bytewise).
    pub votes: Vec<Signed<Reveal>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Evidence,
    Commit,
    Reveal,
    Argument,
    Phase,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryStatus {
    Accepted,
    Rejected,
    Unattested,
}

/// One ledger record. `status` and `reason` are audit information written by
/// the Ledger; the verifier recomputes acceptance and never trusts them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LedgerEntry {
    pub seq: u64,
    pub ts: u64,
    pub kind: EntryKind,
    pub msg: Value,
    pub status: EntryStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The verifiable bundle: what `run_case` writes, what fixtures contain, and
/// what `verifyCert` accepts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerdictCert {
    pub cert: Signed<CertBody>,
    pub transcript: Vec<LedgerEntry>,
}
