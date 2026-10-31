//! Clerk: phase state machine with timeouts. Every submitted message goes
//! through the shared protocol admission engine and is appended to the
//! Ledger with the engine's decision, so the transcript keeps rejected and
//! unattested inputs for audit while the certificate only counts accepted
//! ones. The Clerk signs phase-close markers; the Ledger signs certificates.

use std::rc::Rc;

use sealed_verdict_protocol::{
    sign, Admission, Argument, CertBody, Commit, Engine, EntryKind, Evidence, Keypair, Message,
    Phase, PhaseMarker, Quorum, Registry, Reveal, Signed, Tally, VerdictCert, QUORUM_F, QUORUM_N,
    QUORUM_NEEDED,
};
use serde_json::Value;

use crate::clock::SimClock;
use crate::error::ActorError;
use crate::ledger::Ledger;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhaseInfo {
    pub phase: Phase,
    pub round: u8,
    pub deadline_ms: u64,
    /// True once the round-1 reveal close has been written.
    pub closed: bool,
}

pub struct Clerk {
    registry: Registry,
    keypair: Keypair,
    clock: Rc<SimClock>,
    timeout_ms: u64,
    deadline_ms: u64,
    engine: Engine,
}

impl Clerk {
    /// Open a case with a fixed registry. The attest window opens immediately
    /// and every phase lasts `phase_timeout_ms` of simulated time.
    pub fn open_case(
        registry: Registry,
        keypair: Keypair,
        clock: Rc<SimClock>,
        phase_timeout_ms: u64,
    ) -> Self {
        let deadline_ms = clock.now_ms() + phase_timeout_ms;
        let engine = Engine::new(registry.clone());
        Self {
            registry,
            keypair,
            clock,
            timeout_ms: phase_timeout_ms,
            deadline_ms,
            engine,
        }
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    pub fn public_key_hex(&self) -> String {
        self.keypair.public_key_hex()
    }

    pub fn is_closed(&self) -> bool {
        self.engine.is_closed()
    }

    /// Current phase of a case, or `None` for a case this Clerk does not run.
    pub fn phase(&self, case_id: &str) -> Option<PhaseInfo> {
        if case_id != self.registry.case_id {
            return None;
        }
        Some(match self.engine.window() {
            Some((phase, round)) => PhaseInfo {
                phase,
                round,
                deadline_ms: self.deadline_ms,
                closed: false,
            },
            None => PhaseInfo {
                phase: Phase::Reveal,
                round: 1,
                deadline_ms: self.deadline_ms,
                closed: true,
            },
        })
    }

    /// Admit any envelope value and record it, whatever the decision.
    pub fn submit(
        &mut self,
        ledger: &mut Ledger,
        kind: EntryKind,
        msg: Value,
    ) -> Result<Admission, ActorError> {
        let admission = self.engine.admit(kind, &msg);
        ledger.append(kind, msg, admission.clone())?;
        Ok(admission)
    }

    pub fn submit_evidence(
        &mut self,
        ledger: &mut Ledger,
        msg: Value,
    ) -> Result<Admission, ActorError> {
        self.submit(ledger, EntryKind::Evidence, msg)
    }

    pub fn submit_commit(
        &mut self,
        ledger: &mut Ledger,
        msg: Value,
    ) -> Result<Admission, ActorError> {
        self.submit(ledger, EntryKind::Commit, msg)
    }

    pub fn submit_reveal(
        &mut self,
        ledger: &mut Ledger,
        msg: Value,
    ) -> Result<Admission, ActorError> {
        self.submit(ledger, EntryKind::Reveal, msg)
    }

    pub fn submit_argument(
        &mut self,
        ledger: &mut Ledger,
        msg: Value,
    ) -> Result<Admission, ActorError> {
        self.submit(ledger, EntryKind::Argument, msg)
    }

    fn submit_typed<T: Message>(
        &mut self,
        ledger: &mut Ledger,
        kind: EntryKind,
        env: &Signed<T>,
    ) -> Result<Admission, ActorError> {
        self.submit(ledger, kind, serde_json::to_value(env)?)
    }

    pub fn attest(
        &mut self,
        ledger: &mut Ledger,
        env: &Signed<Evidence>,
    ) -> Result<Admission, ActorError> {
        self.submit_typed(ledger, EntryKind::Evidence, env)
    }

    pub fn commit(
        &mut self,
        ledger: &mut Ledger,
        env: &Signed<Commit>,
    ) -> Result<Admission, ActorError> {
        self.submit_typed(ledger, EntryKind::Commit, env)
    }

    pub fn reveal(
        &mut self,
        ledger: &mut Ledger,
        env: &Signed<Reveal>,
    ) -> Result<Admission, ActorError> {
        self.submit_typed(ledger, EntryKind::Reveal, env)
    }

    pub fn argue(
        &mut self,
        ledger: &mut Ledger,
        env: &Signed<Argument>,
    ) -> Result<Admission, ActorError> {
        self.submit_typed(ledger, EntryKind::Argument, env)
    }

    /// Close the current phase if its deadline has passed. Returns true when a
    /// close marker was written. Missing ballots simply abstain.
    pub fn tick(&mut self, ledger: &mut Ledger) -> Result<bool, ActorError> {
        if self.engine.is_closed() || self.clock.now_ms() < self.deadline_ms {
            return Ok(false);
        }
        self.close_phase(ledger)?;
        Ok(true)
    }

    /// Write the Clerk-signed close marker for the open phase and start the
    /// next phase's timeout.
    pub fn close_phase(&mut self, ledger: &mut Ledger) -> Result<PhaseMarker, ActorError> {
        let Some((phase, round)) = self.engine.window() else {
            return Err(ActorError::AlreadyClosed(self.registry.case_id.clone()));
        };
        let marker = PhaseMarker {
            case_id: self.registry.case_id.clone(),
            phase,
            round,
            ts: self.clock.now_ms(),
        };
        let env = sign(&self.keypair, marker.clone())?;
        let value = serde_json::to_value(&env)?;
        let admission = self.engine.admit(EntryKind::Phase, &value);
        if !admission.is_accepted() {
            return Err(ActorError::Other(format!(
                "clerk's own phase marker was not accepted: {:?}",
                admission.reason
            )));
        }
        ledger.append(EntryKind::Phase, value, admission)?;
        self.deadline_ms = self.clock.now_ms() + self.timeout_ms;
        Ok(marker)
    }

    pub fn tally(&self) -> Tally {
        self.engine.tally()
    }

    /// Build the certificate body from accepted round-1 reveals and ask the
    /// Ledger to sign it. Only valid after the round-1 reveal close.
    pub fn issue_verdict(&self, ledger: &Ledger) -> Result<VerdictCert, ActorError> {
        if !self.engine.is_closed() {
            return Err(ActorError::NotClosed(self.registry.case_id.clone()));
        }
        let tally = self.engine.tally();
        let votes = self
            .engine
            .certificate_votes()
            .into_iter()
            .map(serde_json::from_value::<Signed<Reveal>>)
            .collect::<Result<Vec<_>, _>>()?;
        let body = CertBody {
            case_id: self.registry.case_id.clone(),
            verdict: tally.verdict.clone(),
            quorum: Quorum {
                n: QUORUM_N,
                f: QUORUM_F,
                needed: QUORUM_NEEDED,
                counted: tally.counted,
            },
            transcript_root: ledger.root_hex(),
            transcript_len: ledger.len(),
            evidence_ids: self.engine.certificate_evidence_ids(),
            registry: self.registry.clone(),
            votes,
        };
        let cert = ledger.certify(body)?;
        Ok(VerdictCert {
            cert,
            transcript: ledger.entries().to_vec(),
        })
    }
}
