//! Live-case daemon: one process, one fresh case, JSON lines on stdin/stdout.
//!
//! The daemon owns the Clerk, Ledger, Oracle, and juror signing shells, so
//! every private key stays in this process. A thin bridge moves bytes
//! between Agent Relay, this daemon, and the Terse case actor; it never
//! signs, hashes, admits, or tallies. Requests are `{ id, cmd, ... }`,
//! replies are `{ id, ok: true, result }` or `{ id, ok: false, error:
//! { code, message } }`. Diagnostics go to stderr only. Phase closes are
//! reported solely through the `tick` reply.
//!
//! There is no recovery: a daemon that dies takes its keys with it and the
//! case is aborted. A new attempt uses a new case id.

use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{SystemTime, UNIX_EPOCH};

use sealed_verdict_protocol::{
    verify_cert_typed, Condition, EntryKind, Evidence, JurorEntry, LedgerEntry, Phase, Registry,
    Signed,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::clerk::{Clerk, PhaseInfo};
use crate::clock::SimClock;
use crate::juror::JurorShell;
use crate::ledger::Ledger;
use crate::oracle::Oracle;
use crate::rng::new_keypair;
use crate::runner::write_case;

pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseJson {
    pub phase: Phase,
    pub round: u8,
    pub deadline_ms: u64,
    pub closed: bool,
}

impl From<PhaseInfo> for PhaseJson {
    fn from(p: PhaseInfo) -> Self {
        Self {
            phase: p.phase,
            round: p.round,
            deadline_ms: p.deadline_ms,
            closed: p.closed,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenParams {
    case_id: String,
    condition: Condition,
    choices: Vec<String>,
    context: Vec<ContextItem>,
    jurors: Vec<JurorParam>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ContextItem {
    source: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct JurorParam {
    id: String,
    /// Server-assigned Relay sender id, the only identity the bridge may use.
    sender: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignParams {
    sender: String,
    kind: String,
    round: u8,
    #[serde(default)]
    vote: Option<String>,
    #[serde(default)]
    confidence: Option<u8>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    evidence_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AdmitParams {
    kind: EntryKind,
    msg: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TickParams {
    now_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FinishParams {
    #[serde(default)]
    out_dir: Option<String>,
}

struct Fail {
    code: &'static str,
    message: String,
}

fn fail(code: &'static str, message: impl Into<String>) -> Fail {
    Fail {
        code,
        message: message.into(),
    }
}

impl From<crate::error::ActorError> for Fail {
    fn from(e: crate::error::ActorError) -> Self {
        fail("internal", e.to_string())
    }
}

impl From<serde_json::Error> for Fail {
    fn from(e: serde_json::Error) -> Self {
        fail("bad_request", e.to_string())
    }
}

impl From<std::io::Error> for Fail {
    fn from(e: std::io::Error) -> Self {
        fail("internal", format!("io: {e}"))
    }
}

struct LiveCase {
    clock: Rc<SimClock>,
    ledger: Ledger,
    clerk: Clerk,
    choices: Vec<String>,
    /// Shells keyed by the registered Relay sender id.
    shells: HashMap<String, JurorShell>,
    finished: bool,
}

pub struct Daemon {
    case: Option<LiveCase>,
    out_dir: PathBuf,
}

pub fn wall_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Daemon {
    pub fn new(out_dir: PathBuf) -> Self {
        Self {
            case: None,
            out_dir,
        }
    }

    /// Handle one request line and return the reply as a JSON value.
    pub fn handle(&mut self, line: &str) -> Value {
        let req: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                return reply_err(&Value::Null, fail("bad_request", format!("not JSON: {e}")))
            }
        };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let cmd = req
            .get("cmd")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let mut params = req.clone();
        if let Some(obj) = params.as_object_mut() {
            obj.remove("id");
            obj.remove("cmd");
        }
        let result = match cmd.as_str() {
            "open" => self.open(params),
            "sign" => self.sign(params),
            "admit" => self.admit(params),
            "tick" => self.tick(params),
            "phase" => self.phase(),
            "finish" => self.finish(params),
            other => Err(fail("bad_request", format!("unknown cmd {other:?}"))),
        };
        match result {
            Ok(v) => json!({ "id": id, "ok": true, "result": v }),
            Err(f) => reply_err(&id, f),
        }
    }

    fn live(&mut self) -> Result<&mut LiveCase, Fail> {
        self.case
            .as_mut()
            .ok_or_else(|| fail("no_case", "open a case first"))
    }

    fn open(&mut self, params: Value) -> Result<Value, Fail> {
        if self.case.is_some() {
            return Err(fail(
                "case_open",
                "this daemon already holds a case; start a new daemon for a new case id",
            ));
        }
        let p: OpenParams = serde_json::from_value(params)?;
        if p.jurors.len() != 4 {
            return Err(fail("bad_request", "exactly four jurors are required"));
        }
        let mut ids = std::collections::BTreeSet::new();
        let mut senders = std::collections::BTreeSet::new();
        for j in &p.jurors {
            if j.id.is_empty() || j.sender.is_empty() {
                return Err(fail("bad_request", "juror id and sender must be non-empty"));
            }
            if !ids.insert(j.id.as_str()) || !senders.insert(j.sender.as_str()) {
                return Err(fail("bad_request", "juror ids and senders must be unique"));
            }
        }
        let clock = SimClock::new(wall_now_ms());
        let signed = p.condition != Condition::C2;
        let ledger_kp = new_keypair();
        let clerk_kp = new_keypair();
        let oracle_kp = new_keypair();
        let mut entries = Vec::new();
        let mut shells = HashMap::new();
        for j in &p.jurors {
            let kp = new_keypair();
            entries.push(JurorEntry {
                id: j.id.clone(),
                pubkey: kp.public_key_hex(),
            });
            let shell_key = if signed { Some(kp) } else { None };
            shells.insert(
                j.sender.clone(),
                JurorShell::new(j.id.clone(), p.case_id.clone(), shell_key, clock.clone()),
            );
        }
        let registry = Registry {
            case_id: p.case_id.clone(),
            condition: p.condition,
            choices: p.choices.clone(),
            ledger: ledger_kp.public_key_hex(),
            clerk: clerk_kp.public_key_hex(),
            oracle: oracle_kp.public_key_hex(),
            jurors: entries,
        };
        sealed_verdict_protocol::validate::validate_registry(&registry)
            .map_err(|e| fail("bad_request", e.to_string()))?;
        let ledger = Ledger::new(p.case_id.clone(), ledger_kp, clock.clone());
        let timeout = p.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).max(1);
        let clerk = Clerk::open_case(registry.clone(), clerk_kp, clock.clone(), timeout);
        let context: Vec<(String, String)> = p
            .context
            .into_iter()
            .map(|c| (c.source, c.content))
            .collect();
        let oracle = Oracle::new(p.case_id.clone(), oracle_kp, clock.clone(), context);
        let mut evidence: Vec<Signed<Evidence>> = Vec::new();
        for src in oracle.sources().map(str::to_string).collect::<Vec<_>>() {
            evidence.push(oracle.fetch(&src)?);
        }
        let phase: PhaseJson = clerk.phase(&p.case_id).expect("own case").into();
        let head = ledger.root_hex();
        self.case = Some(LiveCase {
            clock,
            ledger,
            clerk,
            choices: p.choices,
            shells,
            finished: false,
        });
        Ok(json!({ "registry": registry, "evidence": evidence, "phase": phase, "head": head }))
    }

    fn sign(&mut self, params: Value) -> Result<Value, Fail> {
        let p: SignParams = serde_json::from_value(params)?;
        let case = self.live()?;
        let case_id = case.ledger.case_id().to_string();
        let window = case.clerk.phase(&case_id).expect("own case");
        if window.closed {
            return Err(fail("wrong_phase", "case is closed"));
        }
        let shell = case.shells.get_mut(&p.sender).ok_or_else(|| {
            fail(
                "unknown_sender",
                format!("sender {:?} is not a registered juror", p.sender),
            )
        })?;
        let want = |phase: Phase, round: u8| -> Result<(), Fail> {
            if window.phase == phase && window.round == round {
                Ok(())
            } else {
                Err(fail(
                    "wrong_phase",
                    format!(
                        "{:?}/{} requested while {:?}/{} is open",
                        phase, round, window.phase, window.round
                    ),
                ))
            }
        };
        let (kind, envelope) = match p.kind.as_str() {
            "commit" => {
                want(Phase::Commit, p.round)?;
                let vote = p
                    .vote
                    .ok_or_else(|| fail("bad_request", "commit needs vote"))?;
                if !case.choices.contains(&vote) {
                    return Err(fail(
                        "invalid_vote",
                        format!("{vote:?} is not a case choice"),
                    ));
                }
                let confidence = p.confidence.unwrap_or(50);
                if confidence > 100 {
                    return Err(fail("invalid_confidence", "confidence must be 0..=100"));
                }
                (
                    "commit",
                    serde_json::to_value(shell.commit(p.round, &vote, confidence)?)?,
                )
            }
            "reveal" => {
                want(Phase::Reveal, p.round)?;
                let env = shell.reveal(p.round).map_err(|_| {
                    fail(
                        "no_commit",
                        format!("no pending commit for round {}", p.round),
                    )
                })?;
                ("reveal", serde_json::to_value(env)?)
            }
            "argument" => {
                want(Phase::Deliberate, 0)?;
                if p.round != 0 {
                    return Err(fail("wrong_phase", "arguments belong to round 0"));
                }
                let text = p
                    .text
                    .ok_or_else(|| fail("bad_request", "argument needs text"))?;
                let prev = case.ledger.root_hex();
                (
                    "argument",
                    serde_json::to_value(shell.argue(
                        0,
                        &text,
                        p.evidence_ids.unwrap_or_default(),
                        &prev,
                    )?)?,
                )
            }
            other => return Err(fail("bad_request", format!("unknown sign kind {other:?}"))),
        };
        Ok(json!({ "envelope": envelope, "channel": { "kind": kind, "round": p.round } }))
    }

    fn admit(&mut self, params: Value) -> Result<Value, Fail> {
        let p: AdmitParams = serde_json::from_value(params)?;
        if p.kind == EntryKind::Phase {
            return Err(fail(
                "forbidden_kind",
                "phase markers are authored by the Clerk, never admitted from transport",
            ));
        }
        let case = self.live()?;
        if case.finished {
            return Err(fail("already_finished", "certificate already issued"));
        }
        let admission = case.clerk.submit(&mut case.ledger, p.kind, p.msg)?;
        let entry: &LedgerEntry = case.ledger.entries().last().expect("entry appended");
        Ok(
            json!({ "entry": entry, "admission": { "status": admission.status, "reason": admission.reason }, "head": case.ledger.root_hex() }),
        )
    }

    fn tick(&mut self, params: Value) -> Result<Value, Fail> {
        let p: TickParams = serde_json::from_value(params)?;
        let case = self.live()?;
        // Monotonic: a late or reordered tick never moves the clock backward.
        let now = case.clock.now_ms().max(p.now_ms);
        case.clock.set(now);
        let closed = if case.clerk.tick(&mut case.ledger)? {
            Some(
                case.ledger
                    .entries()
                    .last()
                    .expect("close appended")
                    .clone(),
            )
        } else {
            None
        };
        let phase: PhaseJson = case
            .clerk
            .phase(case.ledger.case_id())
            .expect("own case")
            .into();
        Ok(
            json!({ "closed": closed, "phase": phase, "head": case.ledger.root_hex(), "nowMs": now }),
        )
    }

    fn phase(&mut self) -> Result<Value, Fail> {
        let case = self.live()?;
        let phase: PhaseJson = case
            .clerk
            .phase(case.ledger.case_id())
            .expect("own case")
            .into();
        Ok(
            json!({ "phase": phase, "head": case.ledger.root_hex(), "len": case.ledger.len(), "finished": case.finished }),
        )
    }

    fn finish(&mut self, params: Value) -> Result<Value, Fail> {
        let p: FinishParams = serde_json::from_value(params)?;
        let out_dir = p
            .out_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| self.out_dir.clone());
        let case = self.live()?;
        if case.finished {
            return Err(fail("already_finished", "certificate already issued"));
        }
        if !case.clerk.is_closed() {
            return Err(fail("not_closed", "round-1 reveal has not closed"));
        }
        let cert = case.clerk.issue_verdict(&case.ledger)?;
        let report = verify_cert_typed(&cert);
        let path = write_case(&out_dir, &cert)?;
        case.finished = true;
        Ok(json!({ "cert": cert, "report": report, "path": path }))
    }
}

fn reply_err(id: &Value, f: Fail) -> Value {
    json!({ "id": id, "ok": false, "error": { "code": f.code, "message": f.message } })
}
