//! Append-only in-memory ledger. Arrival order is the canonical transcript
//! order; the chain head advances with every entry, accepted or not. The
//! Ledger also signs the certificate.

use std::rc::Rc;

use sealed_verdict_protocol::{
    chain_genesis, chain_step, sign, Admission, CertBody, EntryKind, Keypair, LedgerEntry, Signed,
};
use serde_json::Value;

use crate::clock::SimClock;
use crate::error::ActorError;

pub struct Ledger {
    case_id: String,
    keypair: Keypair,
    clock: Rc<SimClock>,
    entries: Vec<LedgerEntry>,
    head: [u8; 32],
}

impl Ledger {
    pub fn new(case_id: impl Into<String>, keypair: Keypair, clock: Rc<SimClock>) -> Self {
        let case_id = case_id.into();
        let head = chain_genesis(&case_id);
        Self {
            case_id,
            keypair,
            clock,
            entries: Vec::new(),
            head,
        }
    }

    pub fn case_id(&self) -> &str {
        &self.case_id
    }

    pub fn public_key_hex(&self) -> String {
        self.keypair.public_key_hex()
    }

    /// Record a message with the Clerk's admission decision. Rejected and
    /// unattested inputs are kept for audit; the chain covers all of them.
    pub fn append(
        &mut self,
        kind: EntryKind,
        msg: Value,
        admission: Admission,
    ) -> Result<&LedgerEntry, ActorError> {
        let entry = LedgerEntry {
            seq: self.entries.len() as u64,
            ts: self.clock.now_ms(),
            kind,
            msg,
            status: admission.status,
            reason: admission.reason,
        };
        let value = serde_json::to_value(&entry)?;
        self.head = chain_step(&self.head, &value)?;
        self.entries.push(entry);
        Ok(self.entries.last().expect("entry just pushed"))
    }

    pub fn root_hex(&self) -> String {
        hex::encode(self.head)
    }

    pub fn len(&self) -> u64 {
        self.entries.len() as u64
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn entries(&self) -> &[LedgerEntry] {
        &self.entries
    }

    /// Sign a certificate body. The certificate is not itself a ledger entry,
    /// so it never covers its own hash.
    pub fn certify(&self, body: CertBody) -> Result<Signed<CertBody>, ActorError> {
        Ok(sign(&self.keypair, body)?)
    }
}
