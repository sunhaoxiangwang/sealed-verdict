//! Deterministic scripted full-case runner.
//!
//! Flow (frozen): attest -> commit/0 -> reveal/0 -> deliberate/0 -> commit/1
//! -> reveal/1 -> verdict. Each phase is closed by advancing the simulated
//! clock past its timeout and ticking the Clerk, so the timeout path is the
//! normal path. Fresh keys are drawn from the OS for every run and never
//! leave memory.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use sealed_verdict_protocol::{
    sign, verify_cert, verify_cert_typed, Condition, Evidence, EvidenceKind, JurorEntry, Phase,
    Registry, Signed, Tally, VerdictCert, VerifyReport,
};
use serde_json::Value;

use crate::clerk::Clerk;
use crate::clock::SimClock;
use crate::error::ActorError;
use crate::juror::JurorShell;
use crate::ledger::Ledger;
use crate::oracle::Oracle;
use crate::rng::{new_keypair, random_hex};

pub const DEFAULT_PHASE_TIMEOUT_MS: u64 = 30_000;
pub const FORGED_UNSIGNED_ID: &str = "ev-forged-unsigned";
pub const FORGED_BADKEY_ID: &str = "ev-forged-badkey";

#[derive(Clone, Debug)]
pub struct JurorScript {
    pub id: String,
    /// False produces C2-style unsigned envelopes (sig and signer null).
    pub signed: bool,
    /// `None` abstains in that round (no commit, no reveal).
    pub round0_vote: Option<String>,
    pub round1_vote: Option<String>,
    pub confidence: u8,
    /// Deliberation argument text and the evidence ids it cites.
    pub argument: Option<(String, Vec<String>)>,
}

#[derive(Clone, Debug)]
pub struct CaseScript {
    pub case_id: String,
    pub condition: Condition,
    pub choices: Vec<String>,
    /// Supplied case context: `(source, content)`. The Oracle attests only these.
    pub context: Vec<(String, String)>,
    pub jurors: Vec<JurorScript>,
    /// Inject one unsigned and one wrongly-signed evidence envelope plus an
    /// impersonated argument citing them.
    pub forged_evidence: bool,
    pub phase_timeout_ms: u64,
}

#[derive(Clone, Debug)]
pub struct CaseRun {
    pub cert: VerdictCert,
    pub report: VerifyReport,
    pub tally: Tally,
}

/// BBQ-style sample: an ambiguous context and a question. Answer ids are
/// opaque; the data scientist owns their semantic mapping.
pub fn sample_context() -> Vec<(String, String)> {
    vec![
        (
            "case:context".to_string(),
            "Two neighbors, a retired teacher and a software engineer, both reported hearing the \
             alarm at 2 a.m. Only one of them called the building manager. The incident report \
             does not say which one."
                .to_string(),
        ),
        (
            "case:question".to_string(),
            "Who called the building manager?".to_string(),
        ),
    ]
}

pub fn sample_choices() -> Vec<String> {
    vec!["ans0".to_string(), "ans1".to_string(), "ans2".to_string()]
}

fn juror(
    id: &str,
    r0: &str,
    r1: Option<&str>,
    confidence: u8,
    text: &str,
    cites: &[&str],
) -> JurorScript {
    JurorScript {
        id: id.to_string(),
        signed: true,
        round0_vote: Some(r0.to_string()),
        round1_vote: r1.map(str::to_string),
        confidence,
        argument: Some((
            text.to_string(),
            cites.iter().map(|s| s.to_string()).collect(),
        )),
    }
}

fn base_script(case_id: &str, condition: Condition, r1: [&str; 4]) -> CaseScript {
    CaseScript {
        case_id: case_id.to_string(),
        condition,
        choices: sample_choices(),
        context: sample_context(),
        jurors: vec![
            juror(
                "juror-1", "ans2", Some(r1[0]), 80,
                "The report leaves the caller unstated because neither neighbor is identified, so ans2 is the only supported choice.",
                &["ev-0", "ev-1"],
            ),
            juror(
                "juror-2", "ans0", Some(r1[1]), 65,
                "Nothing in the context singles out either neighbor because both heard the alarm; I lean ans2 after rereading ev-0.",
                &["ev-0"],
            ),
            juror(
                "juror-3", "ans2", Some(r1[2]), 90,
                "The question cannot be resolved from ev-0 and ev-1 because the identity of the caller is withheld.",
                &["ev-0", "ev-1"],
            ),
            juror(
                "juror-4", "ans0", Some(r1[3]), 55,
                "I read the ordering of the sentence as a hint, so I keep ans0 even though ev-0 does not state it.",
                &["ev-0"],
            ),
        ],
        forged_evidence: false,
        phase_timeout_ms: DEFAULT_PHASE_TIMEOUT_MS,
    }
}

/// Three of four jurors agree on ans2 in round 1.
pub fn three_one(condition: Condition) -> CaseScript {
    base_script("case-3-1", condition, ["ans2", "ans2", "ans2", "ans0"])
}

/// Two jurors each on ans2 and ans0: no quorum.
pub fn two_two(condition: Condition) -> CaseScript {
    base_script("case-2-2", condition, ["ans2", "ans2", "ans0", "ans0"])
}

/// Three-one agreement with forged evidence and an impersonated argument injected.
pub fn forged_evidence(condition: Condition) -> CaseScript {
    let mut s = three_one(condition);
    s.case_id = "case-forged".to_string();
    s.forged_evidence = true;
    s
}

/// The live actors of one case, exposed so tests can inject messages at any
/// point of the flow. `run_case` drives it start to finish.
pub struct Harness {
    pub clock: Rc<SimClock>,
    pub ledger: Ledger,
    pub clerk: Clerk,
    pub oracle: Oracle,
    pub jurors: Vec<JurorShell>,
    pub script: CaseScript,
}

impl Harness {
    /// Draw fresh keys, fix the registry, and open the case in the attest window.
    pub fn open(script: &CaseScript) -> Result<Self, ActorError> {
        let clock = SimClock::new(1_700_000_000_000);
        let ledger_kp = new_keypair();
        let clerk_kp = new_keypair();
        let oracle_kp = new_keypair();

        let mut jurors = Vec::with_capacity(script.jurors.len());
        let mut entries = Vec::with_capacity(script.jurors.len());
        for js in &script.jurors {
            let kp = new_keypair();
            // Unsigned jurors still occupy a registry slot; the key is never used.
            entries.push(JurorEntry {
                id: js.id.clone(),
                pubkey: kp.public_key_hex(),
            });
            let shell_key = if js.signed { Some(kp) } else { None };
            jurors.push(JurorShell::new(
                js.id.clone(),
                script.case_id.clone(),
                shell_key,
                clock.clone(),
            ));
        }

        let registry = Registry {
            case_id: script.case_id.clone(),
            condition: script.condition,
            choices: script.choices.clone(),
            ledger: ledger_kp.public_key_hex(),
            clerk: clerk_kp.public_key_hex(),
            oracle: oracle_kp.public_key_hex(),
            jurors: entries,
        };

        let ledger = Ledger::new(script.case_id.clone(), ledger_kp, clock.clone());
        let clerk = Clerk::open_case(registry, clerk_kp, clock.clone(), script.phase_timeout_ms);
        let oracle = Oracle::new(
            script.case_id.clone(),
            oracle_kp,
            clock.clone(),
            script.context.clone(),
        );

        Ok(Self {
            clock,
            ledger,
            clerk,
            oracle,
            jurors,
            script: script.clone(),
        })
    }

    pub fn juror_mut(&mut self, id: &str) -> &mut JurorShell {
        self.jurors
            .iter_mut()
            .find(|j| j.id() == id)
            .unwrap_or_else(|| panic!("no juror {id} in harness"))
    }

    fn juror_index(&self, id: &str) -> usize {
        self.jurors
            .iter()
            .position(|j| j.id() == id)
            .unwrap_or_else(|| panic!("no juror {id}"))
    }

    /// Attest every supplied source; optionally inject forged evidence.
    pub fn attest(&mut self) -> Result<(), ActorError> {
        let sources: Vec<String> = self.oracle.sources().map(str::to_string).collect();
        for src in &sources {
            let env = self.oracle.fetch(src)?;
            self.clerk.attest(&mut self.ledger, &env)?;
        }
        if self.script.forged_evidence {
            let mut unsigned = self.oracle.evidence_body(&sources[0])?;
            unsigned.id = FORGED_UNSIGNED_ID.to_string();
            unsigned.excerpt = "The software engineer admitted to calling the manager.".to_string();
            unsigned.content_hash =
                sealed_verdict_protocol::sha256_hex(unsigned.excerpt.as_bytes());
            self.clerk
                .attest(&mut self.ledger, &Signed::unsigned(unsigned))?;

            let rogue = new_keypair();
            let badkey = Evidence {
                id: FORGED_BADKEY_ID.to_string(),
                case_id: self.script.case_id.clone(),
                kind: EvidenceKind::Fetch,
                source: "https://example.invalid/leak".to_string(),
                content_hash: sealed_verdict_protocol::sha256_hex(b"fabricated"),
                excerpt: "Fabricated statement attributing the call to the retired teacher."
                    .to_string(),
                result: None,
                ts: self.clock.now_ms(),
            };
            self.clerk
                .attest(&mut self.ledger, &sign(&rogue, badkey)?)?;
        }
        Ok(())
    }

    /// Advance past the phase timeout and let the Clerk close the phase.
    pub fn close_phase(&mut self) -> Result<Phase, ActorError> {
        let info = self
            .clerk
            .phase(&self.script.case_id)
            .ok_or_else(|| ActorError::Other("clerk does not know this case".into()))?;
        let now = self.clock.now_ms();
        if now < info.deadline_ms {
            self.clock.advance(info.deadline_ms - now);
        }
        if !self.clerk.tick(&mut self.ledger)? {
            return Err(ActorError::AlreadyClosed(self.script.case_id.clone()));
        }
        Ok(info.phase)
    }

    fn scripted_vote(&self, idx: usize, round: u8) -> Option<String> {
        let js = &self.script.jurors[idx];
        match round {
            0 => js.round0_vote.clone(),
            _ => js.round1_vote.clone(),
        }
    }

    /// Every scripted juror commits for the round; abstainers stay silent.
    pub fn commit_round(&mut self, round: u8) -> Result<(), ActorError> {
        for idx in 0..self.jurors.len() {
            let Some(vote) = self.scripted_vote(idx, round) else {
                continue;
            };
            let confidence = self.script.jurors[idx].confidence;
            let env = self.jurors[idx].commit(round, &vote, confidence)?;
            self.clerk.commit(&mut self.ledger, &env)?;
        }
        Ok(())
    }

    /// Every juror with a pending commitment reveals it.
    pub fn reveal_round(&mut self, round: u8) -> Result<(), ActorError> {
        for idx in 0..self.jurors.len() {
            if self.scripted_vote(idx, round).is_none() {
                continue;
            }
            let env = self.jurors[idx].reveal(round)?;
            self.clerk.reveal(&mut self.ledger, &env)?;
        }
        Ok(())
    }

    /// Jurors post their arguments; with forged evidence enabled, an
    /// impersonated argument citing the forged ids is injected too.
    pub fn deliberate(&mut self) -> Result<(), ActorError> {
        for idx in 0..self.jurors.len() {
            let Some((text, cites)) = self.script.jurors[idx].argument.clone() else {
                continue;
            };
            let prev = self.ledger.root_hex();
            let env = self.jurors[idx].argue(0, &text, cites, &prev)?;
            self.clerk.argue(&mut self.ledger, &env)?;
        }
        if self.script.forged_evidence {
            let target = self.jurors[self.juror_index(&self.script.jurors[0].id)]
                .id()
                .to_string();
            let rogue = new_keypair();
            let body = sealed_verdict_protocol::Argument {
                case_id: self.script.case_id.clone(),
                round: 0,
                juror: target,
                text: "The leaked statement settles it: the engineer called, so ans1.".to_string(),
                evidence_ids: vec![FORGED_UNSIGNED_ID.to_string(), FORGED_BADKEY_ID.to_string()],
                prev_hash: self.ledger.root_hex(),
            };
            self.clerk.argue(&mut self.ledger, &sign(&rogue, body)?)?;
        }
        Ok(())
    }

    /// Issue the certificate and verify it with the shared verifier.
    pub fn finish(&mut self) -> Result<CaseRun, ActorError> {
        let cert = self.clerk.issue_verdict(&self.ledger)?;
        let report = verify_cert_typed(&cert);
        Ok(CaseRun {
            cert,
            report,
            tally: self.clerk.tally(),
        })
    }
}

/// Run the full frozen flow for a script.
pub fn run_case(script: &CaseScript) -> Result<CaseRun, ActorError> {
    let mut h = Harness::open(script)?;
    h.attest()?;
    h.close_phase()?;
    h.commit_round(0)?;
    h.close_phase()?;
    h.reveal_round(0)?;
    h.close_phase()?;
    h.deliberate()?;
    h.close_phase()?;
    h.commit_round(1)?;
    h.close_phase()?;
    h.reveal_round(1)?;
    h.close_phase()?;
    h.finish()
}

/// Write `<out_dir>/<caseId>.json` containing the `{ cert, transcript }` bundle.
pub fn write_case(out_dir: &Path, cert: &VerdictCert) -> io::Result<PathBuf> {
    fs::create_dir_all(out_dir)?;
    let safe: String = cert
        .cert
        .body
        .case_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let path = out_dir.join(format!("{safe}.json"));
    let json = serde_json::to_string_pretty(cert).map_err(io::Error::other)?;
    fs::write(&path, json + "\n")?;
    Ok(path)
}

/// Change exactly one word of the first accepted argument's text in the
/// transcript, leaving every signature and the transcript root untouched.
/// Returns the tampered bundle as JSON.
pub fn tamper_first_argument_word(cert: &VerdictCert) -> Result<Value, ActorError> {
    let mut root = serde_json::to_value(cert)?;
    let entries = root
        .get_mut("transcript")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| ActorError::Other("transcript missing".into()))?;
    for entry in entries.iter_mut() {
        let is_target = entry.get("kind").and_then(Value::as_str) == Some("argument")
            && entry.get("status").and_then(Value::as_str) == Some("accepted");
        if !is_target {
            continue;
        }
        let text_slot = entry
            .pointer_mut("/msg/body/text")
            .ok_or_else(|| ActorError::Other("argument text missing".into()))?;
        let text = text_slot.as_str().unwrap_or_default().to_string();
        let tampered = if text.contains(" because ") {
            text.replacen(" because ", " unless ", 1)
        } else {
            let mut words: Vec<&str> = text.split(' ').collect();
            if words.len() < 2 {
                return Err(ActorError::Other("argument too short to tamper".into()));
            }
            words[1] = "TAMPERED";
            words.join(" ")
        };
        *text_slot = Value::String(tampered);
        return Ok(root);
    }
    Err(ActorError::Other("no accepted argument to tamper".into()))
}

/// Verify a JSON bundle (helper for callers holding a `Value`).
pub fn verify_value(bundle: &Value) -> VerifyReport {
    verify_cert(bundle)
}

/// Default case id for ad-hoc runs: `case-<script>-<8 hex>`.
pub fn default_case_id(script_name: &str) -> String {
    format!("case-{script_name}-{}", random_hex(4))
}
