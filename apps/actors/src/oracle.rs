//! Fetch Oracle. For BBQ cases it signs only the case context it was given:
//! no retrieval, no answer labels.

use std::rc::Rc;

use sealed_verdict_protocol::{sha256_hex, sign, Evidence, EvidenceKind, Keypair, Signed};

use crate::clock::SimClock;
use crate::error::ActorError;

const EXCERPT_CHARS: usize = 240;

pub struct Oracle {
    case_id: String,
    keypair: Keypair,
    clock: Rc<SimClock>,
    context: Vec<(String, String)>,
}

impl Oracle {
    pub fn new(
        case_id: impl Into<String>,
        keypair: Keypair,
        clock: Rc<SimClock>,
        context: Vec<(String, String)>,
    ) -> Self {
        Self {
            case_id: case_id.into(),
            keypair,
            clock,
            context,
        }
    }

    pub fn public_key_hex(&self) -> String {
        self.keypair.public_key_hex()
    }

    pub fn sources(&self) -> impl Iterator<Item = &str> {
        self.context.iter().map(|(s, _)| s.as_str())
    }

    /// Unsigned evidence body for a supplied source. Exposed so tests and the
    /// runner can build forged envelopes around real-looking content.
    pub fn evidence_body(&self, src: &str) -> Result<Evidence, ActorError> {
        let (idx, (_, content)) = self
            .context
            .iter()
            .enumerate()
            .find(|(_, (s, _))| s == src)
            .ok_or_else(|| ActorError::UnknownSource(src.to_string()))?;
        Ok(Evidence {
            id: format!("ev-{idx}"),
            case_id: self.case_id.clone(),
            kind: EvidenceKind::Fetch,
            source: src.to_string(),
            content_hash: sha256_hex(content.as_bytes()),
            excerpt: content.chars().take(EXCERPT_CHARS).collect(),
            result: None,
            ts: self.clock.now_ms(),
        })
    }

    /// Attest a supplied source. Unknown sources are an error, never fetched.
    pub fn fetch(&self, src: &str) -> Result<Signed<Evidence>, ActorError> {
        let body = self.evidence_body(src)?;
        Ok(sign(&self.keypair, body)?)
    }
}
