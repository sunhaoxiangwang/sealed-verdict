//! Juror signing shell. Holds the juror's key (or none, for C2 unsigned
//! jurors) and the nonce behind each pending commitment. Deciding *what* to
//! vote belongs to the juror orchestration in `apps/jurors`.

use std::collections::HashMap;
use std::rc::Rc;

use sealed_verdict_protocol::{
    commitment_hex, sign, Argument, Commit, Keypair, Message, Reveal, Signed,
};

use crate::clock::SimClock;
use crate::error::ActorError;
use crate::rng::random_nonce_hex;

#[derive(Clone, Debug)]
struct Pending {
    vote: String,
    confidence: u8,
    nonce: String,
}

pub struct JurorShell {
    id: String,
    case_id: String,
    keypair: Option<Keypair>,
    clock: Rc<SimClock>,
    pending: HashMap<u8, Pending>,
}

impl JurorShell {
    /// `keypair = None` produces envelopes with `sig: null, signer: null`
    /// (condition C2). Such ballots are never juror-authenticated.
    pub fn new(
        id: impl Into<String>,
        case_id: impl Into<String>,
        keypair: Option<Keypair>,
        clock: Rc<SimClock>,
    ) -> Self {
        Self {
            id: id.into(),
            case_id: case_id.into(),
            keypair,
            clock,
            pending: HashMap::new(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn case_id(&self) -> &str {
        &self.case_id
    }

    pub fn is_signed(&self) -> bool {
        self.keypair.is_some()
    }

    pub fn public_key_hex(&self) -> Option<String> {
        self.keypair.as_ref().map(Keypair::public_key_hex)
    }

    pub fn now_ms(&self) -> u64 {
        self.clock.now_ms()
    }

    /// Wrap any body in this juror's envelope style: signed, or explicitly
    /// unsigned for C2. Public so tests can craft arbitrary bodies.
    pub fn envelope<T: Message>(&self, body: T) -> Result<Signed<T>, ActorError> {
        match &self.keypair {
            Some(kp) => Ok(sign(kp, body)?),
            None => Ok(Signed::unsigned(body)),
        }
    }

    /// Commit to a vote with a fresh random nonce. The nonce is remembered
    /// for `reveal`; committing again in the same round replaces it.
    pub fn commit(
        &mut self,
        round: u8,
        vote: &str,
        confidence: u8,
    ) -> Result<Signed<Commit>, ActorError> {
        let nonce = random_nonce_hex();
        let commitment = commitment_hex(&self.case_id, round, &self.id, vote, &nonce)?;
        self.pending.insert(
            round,
            Pending {
                vote: vote.to_string(),
                confidence,
                nonce: nonce.clone(),
            },
        );
        self.envelope(Commit {
            case_id: self.case_id.clone(),
            round,
            juror: self.id.clone(),
            commitment,
        })
    }

    pub fn reveal(&self, round: u8) -> Result<Signed<Reveal>, ActorError> {
        let p = self.pending(round)?;
        self.envelope(Reveal {
            case_id: self.case_id.clone(),
            round,
            juror: self.id.clone(),
            vote: p.vote.clone(),
            confidence: p.confidence,
            nonce: p.nonce.clone(),
        })
    }

    /// Reveal a different vote than the one committed (will not match the
    /// commitment). Used to exercise Clerk rejection.
    pub fn reveal_with_vote(&self, round: u8, vote: &str) -> Result<Signed<Reveal>, ActorError> {
        let p = self.pending(round)?;
        self.envelope(Reveal {
            case_id: self.case_id.clone(),
            round,
            juror: self.id.clone(),
            vote: vote.to_string(),
            confidence: p.confidence,
            nonce: p.nonce.clone(),
        })
    }

    pub fn argue(
        &self,
        round: u8,
        text: &str,
        evidence_ids: Vec<String>,
        prev_hash: &str,
    ) -> Result<Signed<Argument>, ActorError> {
        self.envelope(Argument {
            case_id: self.case_id.clone(),
            round,
            juror: self.id.clone(),
            text: text.to_string(),
            evidence_ids,
            prev_hash: prev_hash.to_string(),
        })
    }

    fn pending(&self, round: u8) -> Result<&Pending, ActorError> {
        self.pending
            .get(&round)
            .ok_or_else(|| ActorError::NoPendingBallot(self.id.clone(), round))
    }
}
