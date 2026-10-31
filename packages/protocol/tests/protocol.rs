//! Protocol unit and replay tests. Keys here are derived from fixed test
//! labels and are never used for fixtures.

use std::path::Path;

use sealed_verdict_protocol::replay::reasons;
use sealed_verdict_protocol::verify::codes;
use sealed_verdict_protocol::*;
use serde::Serialize;
use serde_json::{json, Value};

fn key(name: &str) -> Keypair {
    Keypair::from_seed(sha256(format!("sealed-verdict-test-key:{name}").as_bytes()))
}

fn val<T: Serialize>(t: &T) -> Value {
    serde_json::to_value(t).unwrap()
}

#[test]
fn canonical_sorted_keys_stable() {
    #[derive(Serialize)]
    struct Unsorted {
        zeta: u8,
        alpha: &'static str,
        mid: Vec<u8>,
    }
    let from_struct = canonical_bytes(&Unsorted {
        zeta: 1,
        alpha: "a\"b\n",
        mid: vec![3, 4],
    })
    .unwrap();
    let from_value =
        canonical_value_bytes(&json!({"mid":[3,4],"alpha":"a\"b\n","zeta":1})).unwrap();
    assert_eq!(from_struct, from_value);
    assert_eq!(
        std::str::from_utf8(&from_struct).unwrap(),
        r#"{"alpha":"a\"b\n","mid":[3,4],"zeta":1}"#
    );
    // Nested objects sort too; null and bool are literal.
    let nested = canonical_value_bytes(&json!({"b":{"y":null,"x":true},"a":[]})).unwrap();
    assert_eq!(
        std::str::from_utf8(&nested).unwrap(),
        r#"{"a":[],"b":{"x":true,"y":null}}"#
    );
    // Bytewise order: uppercase before lowercase.
    let order = canonical_value_bytes(&json!({"b":1,"B":2})).unwrap();
    assert_eq!(std::str::from_utf8(&order).unwrap(), r#"{"B":2,"b":1}"#);
    // Floats are rejected.
    assert!(matches!(
        canonical_value_bytes(&json!({"x":1.5})),
        Err(ProtocolError::FloatNotAllowed)
    ));
}

#[test]
fn sign_verify_rejects_tamper() {
    let kp = key("juror");
    let commit = Commit {
        case_id: "c1".into(),
        round: 0,
        juror: "J1".into(),
        commitment: "00".repeat(32),
    };
    let signed = sign(&kp, commit.clone()).unwrap();
    assert!(verify(&signed).is_ok());
    assert_eq!(signed.signer.as_deref(), Some(kp.public_key_hex().as_str()));

    let mut tampered = signed.clone();
    tampered.body.juror = "J2".into();
    assert!(matches!(
        verify(&tampered),
        Err(ProtocolError::BadSignature)
    ));

    let mut wrong_signer = signed.clone();
    wrong_signer.signer = Some(key("other").public_key_hex());
    assert!(matches!(
        verify(&wrong_signer),
        Err(ProtocolError::BadSignature)
    ));

    let unsigned = Signed::unsigned(commit.clone());
    assert!(matches!(
        verify(&unsigned),
        Err(ProtocolError::MissingSignature)
    ));

    // Domain separation: a commit signature does not verify as a reveal.
    let body = val(&commit);
    assert!(verify_value(
        "commit",
        &body,
        signed.sig.as_deref(),
        signed.signer.as_deref()
    )
    .is_ok());
    assert!(verify_value(
        "reveal",
        &body,
        signed.sig.as_deref(),
        signed.signer.as_deref()
    )
    .is_err());
    assert!(signing_bytes("commit", b"{}").starts_with(b"sv1/commit\n"));
}

#[test]
fn commitment_binds_vote_and_nonce() {
    let nonce = "ab".repeat(32);
    let c = commitment_hex("c1", 1, "J1", "ans0", &nonce).unwrap();
    assert_eq!(c.len(), 64);
    assert_ne!(c, commitment_hex("c1", 1, "J1", "ans1", &nonce).unwrap());
    assert_ne!(
        c,
        commitment_hex("c1", 1, "J1", "ans0", &"cd".repeat(32)).unwrap()
    );
    assert_ne!(c, commitment_hex("c1", 0, "J1", "ans0", &nonce).unwrap());
    let reveal = Reveal {
        case_id: "c1".into(),
        round: 1,
        juror: "J1".into(),
        vote: "ans0".into(),
        confidence: 70,
        nonce,
    };
    assert_eq!(commitment_for_reveal(&reveal).unwrap(), c);
}

#[test]
fn chain_uses_raw_digests() {
    let h0 = chain_genesis("c1");
    assert_eq!(h0, sha256(b"sv1/chain\nc1"));
    let entry = json!({"seq":0,"ts":1,"kind":"phase","msg":{},"status":"accepted"});
    let mut input = Vec::new();
    input.extend_from_slice(&h0);
    input.extend_from_slice(&sha256(&canonical_value_bytes(&entry).unwrap()));
    assert_eq!(chain_step(&h0, &entry).unwrap(), sha256(&input));
    let e2 = json!({"seq":1,"ts":2,"kind":"phase","msg":{},"status":"rejected","reason":"x"});
    let root = chain_root("c1", &[entry.clone(), e2.clone()]).unwrap();
    assert_eq!(
        root,
        chain_step(&chain_step(&h0, &entry).unwrap(), &e2).unwrap()
    );
}

#[test]
fn verify_cert_malformed_inputs_do_not_panic() {
    for input in [
        Value::Null,
        json!("x"),
        json!({}),
        json!({"cert": {}, "transcript": []}),
        json!({"cert": {"body": {}}, "transcript": []}),
        json!({"cert": {"body": 5}, "transcript": {}}),
    ] {
        let r = verify_cert(&input);
        assert!(!r.valid);
        assert!(
            r.has_code(codes::SCHEMA_INVALID),
            "{input}: {:?}",
            r.failures
        );
    }
    let r = verify_cert_json("not json");
    assert!(!r.valid && r.has_code(codes::SCHEMA_INVALID));
}

// ---- In-test ledger driving the shared admission engine ----

struct MiniLedger {
    kp: Keypair,
    clock: u64,
    entries: Vec<LedgerEntry>,
    head: [u8; 32],
}

impl MiniLedger {
    fn new(case_id: &str) -> Self {
        Self {
            kp: key("ledger"),
            clock: 1_000,
            entries: Vec::new(),
            head: chain_genesis(case_id),
        }
    }
    fn append(&mut self, kind: EntryKind, msg: Value, adm: Admission) {
        let e = LedgerEntry {
            seq: self.entries.len() as u64,
            ts: self.clock,
            kind,
            msg,
            status: adm.status,
            reason: adm.reason,
        };
        self.head = chain_step(&self.head, &val(&e)).unwrap();
        self.entries.push(e);
        self.clock += 1;
    }
}

struct Case {
    registry: Registry,
    engine: Engine,
    ledger: MiniLedger,
    clerk: Keypair,
    oracle: Keypair,
}

fn juror_key(j: &str) -> Keypair {
    key(&format!("juror-{j}"))
}

fn registry(case_id: &str, cond: Condition) -> Registry {
    Registry {
        case_id: case_id.into(),
        condition: cond,
        choices: vec!["ans0".into(), "ans1".into(), "ans2".into()],
        ledger: key("ledger").public_key_hex(),
        clerk: key("clerk").public_key_hex(),
        oracle: key("oracle").public_key_hex(),
        jurors: ["J1", "J2", "J3", "J4"]
            .iter()
            .map(|j| JurorEntry {
                id: j.to_string(),
                pubkey: juror_key(j).public_key_hex(),
            })
            .collect(),
    }
}

impl Case {
    fn open(case_id: &str, cond: Condition) -> Self {
        let registry = registry(case_id, cond);
        Self {
            engine: Engine::new(registry.clone()),
            registry,
            ledger: MiniLedger::new(case_id),
            clerk: key("clerk"),
            oracle: key("oracle"),
        }
    }
    fn case_id(&self) -> &str {
        &self.registry.case_id
    }
    fn submit(&mut self, kind: EntryKind, msg: Value) -> Admission {
        let adm = self.engine.admit(kind, &msg);
        self.ledger.append(kind, msg, adm.clone());
        adm
    }
    fn close(&mut self) {
        let (phase, round) = self.engine.window().expect("case already closed");
        let marker = PhaseMarker {
            case_id: self.case_id().into(),
            phase,
            round,
            ts: self.ledger.clock,
        };
        let adm = self.submit(EntryKind::Phase, val(&sign(&self.clerk, marker).unwrap()));
        assert!(adm.is_accepted(), "{adm:?}");
    }
    fn evidence(&mut self, id: &str, signed: bool) -> Admission {
        let ev = Evidence {
            id: id.into(),
            case_id: self.case_id().into(),
            kind: EvidenceKind::Fetch,
            source: "case:context".into(),
            content_hash: sha256_hex(b"ctx"),
            excerpt: "ctx".into(),
            result: None,
            ts: 1,
        };
        let msg = if signed {
            val(&sign(&self.oracle, ev).unwrap())
        } else {
            val(&Signed::unsigned(ev))
        };
        self.submit(EntryKind::Evidence, msg)
    }
    fn envelope<T: Message + Clone>(&self, juror: &str, body: T, signed: bool) -> Value {
        if signed {
            val(&sign(&juror_key(juror), body).unwrap())
        } else {
            val(&Signed::unsigned(body))
        }
    }
    fn commit(&mut self, juror: &str, round: u8, vote: &str, signed: bool) -> Admission {
        let nonce = sha256_hex(format!("nonce:{juror}:{round}:{}", self.case_id()).as_bytes());
        let commitment = commitment_hex(self.case_id(), round, juror, vote, &nonce).unwrap();
        let body = Commit {
            case_id: self.case_id().into(),
            round,
            juror: juror.into(),
            commitment,
        };
        let msg = self.envelope(juror, body, signed);
        self.submit(EntryKind::Commit, msg)
    }
    fn reveal(&mut self, juror: &str, round: u8, vote: &str, signed: bool) -> Admission {
        let nonce = sha256_hex(format!("nonce:{juror}:{round}:{}", self.case_id()).as_bytes());
        let body = Reveal {
            case_id: self.case_id().into(),
            round,
            juror: juror.into(),
            vote: vote.into(),
            confidence: 80,
            nonce,
        };
        let msg = self.envelope(juror, body, signed);
        self.submit(EntryKind::Reveal, msg)
    }
    fn argue(&mut self, juror: &str, evidence_ids: &[&str], signed: bool) -> Admission {
        let body = Argument {
            case_id: self.case_id().into(),
            round: 0,
            juror: juror.into(),
            text: "I vote this way because the context says so".into(),
            evidence_ids: evidence_ids.iter().map(|s| s.to_string()).collect(),
            prev_hash: hex::encode(self.ledger.head),
        };
        let msg = self.envelope(juror, body, signed);
        self.submit(EntryKind::Argument, msg)
    }
    fn certify(&mut self) -> VerdictCert {
        assert!(self.engine.is_closed());
        let tally = self.engine.tally();
        let votes = self
            .engine
            .certificate_votes()
            .into_iter()
            .map(|v| serde_json::from_value(v).unwrap())
            .collect();
        let body = CertBody {
            case_id: self.case_id().into(),
            verdict: tally.verdict,
            quorum: Quorum {
                n: QUORUM_N,
                f: QUORUM_F,
                needed: QUORUM_NEEDED,
                counted: tally.counted,
            },
            transcript_root: hex::encode(self.ledger.head),
            transcript_len: self.ledger.entries.len() as u64,
            evidence_ids: self.engine.certificate_evidence_ids(),
            registry: self.registry.clone(),
            votes,
        };
        VerdictCert {
            cert: sign(&self.ledger.kp, body).unwrap(),
            transcript: self.ledger.entries.clone(),
        }
    }
}

/// Runs the frozen flow with the given round-1 votes; all jurors signed.
fn run(case_id: &str, cond: Condition, r1: [&str; 4]) -> (Case, VerdictCert) {
    let mut c = Case::open(case_id, cond);
    let signed = cond != Condition::C2;
    assert!(c.evidence("ev-0", true).is_accepted());
    c.close();
    for j in ["J1", "J2", "J3", "J4"] {
        assert!(c.commit(j, 0, "ans0", signed).is_accepted());
    }
    c.close();
    for j in ["J1", "J2", "J3", "J4"] {
        assert!(c.reveal(j, 0, "ans0", signed).is_accepted());
    }
    c.close();
    assert!(c.argue("J1", &["ev-0"], signed).is_accepted());
    c.close();
    for (i, j) in ["J1", "J2", "J3", "J4"].iter().enumerate() {
        assert!(c.commit(j, 1, r1[i], signed).is_accepted());
    }
    c.close();
    for (i, j) in ["J1", "J2", "J3", "J4"].iter().enumerate() {
        assert!(c.reveal(j, 1, r1[i], signed).is_accepted());
    }
    c.close();
    let cert = c.certify();
    (c, cert)
}

#[test]
fn replay_three_one_certifies() {
    let (_, cert) = run("case-3-1", Condition::C3, ["ans0", "ans0", "ans0", "ans1"]);
    let r = verify_cert_typed(&cert);
    assert!(r.valid, "{:?}", r.failures);
    assert_eq!(cert.cert.body.verdict, "ans0");
    assert_eq!(cert.cert.body.quorum.counted, 4);
    assert_eq!(cert.cert.body.evidence_ids, vec!["ev-0".to_string()]);
    assert_eq!(cert.cert.body.votes.len(), 4);
    assert_eq!(cert.cert.body.votes[0].body.juror, "J1");
}

#[test]
fn replay_two_two_yields_verifiable_no_quorum() {
    let (_, cert) = run("case-2-2", Condition::C4, ["ans0", "ans0", "ans1", "ans1"]);
    let r = verify_cert_typed(&cert);
    assert!(r.valid, "{:?}", r.failures);
    assert_eq!(cert.cert.body.verdict, NO_QUORUM);
    assert_eq!(cert.cert.body.quorum.counted, 4);
}

#[test]
fn replay_c2_unsigned_ballots_are_claimed_identity() {
    let (_, cert) = run("case-c2", Condition::C2, ["ans2", "ans2", "ans2", "ans2"]);
    let r = verify_cert_typed(&cert);
    assert!(r.valid, "{:?}", r.failures);
    assert!(cert
        .cert
        .body
        .votes
        .iter()
        .all(|v| v.sig.is_none() && v.signer.is_none()));
    // Certificate and phase signatures remain mandatory in C2.
    let mut v = val(&cert);
    v["cert"]["sig"] = Value::Null;
    v["cert"]["signer"] = Value::Null;
    let r = verify_cert(&v);
    assert!(r.has_code(codes::CERT_SIG_INVALID) && r.has_code(codes::CERT_SIGNER_NOT_LEDGER));
}

#[test]
fn replay_rejections_are_audit_only() {
    let mut c = Case::open("case-audit", Condition::C3);
    // Unsigned and foreign-key evidence are UNATTESTED under C3.
    assert_eq!(c.evidence("ev-0", true).status, EntryStatus::Accepted);
    let forged = c.evidence("ev-forged", false);
    assert_eq!(forged.status, EntryStatus::Unattested);
    assert_eq!(forged.reason.as_deref(), Some(reasons::UNSIGNED));
    let other = Evidence {
        id: "ev-other".into(),
        case_id: "case-audit".into(),
        kind: EvidenceKind::Fetch,
        source: "x".into(),
        content_hash: sha256_hex(b"y"),
        excerpt: "y".into(),
        result: None,
        ts: 1,
    };
    let adm = c.submit(
        EntryKind::Evidence,
        val(&sign(&key("not-oracle"), other).unwrap()),
    );
    assert_eq!(adm.reason.as_deref(), Some(reasons::WRONG_SIGNER));
    // Early reveal during attest is out of phase.
    assert_eq!(
        c.reveal("J1", 0, "ans0", true).reason.as_deref(),
        Some(reasons::OUT_OF_PHASE)
    );
    c.close();
    for j in ["J1", "J2", "J3", "J4"] {
        assert!(c.commit(j, 0, "ans0", true).is_accepted());
    }
    // Duplicate commit, unsigned commit, cross-case commit.
    assert_eq!(
        c.commit("J1", 0, "ans1", true).reason.as_deref(),
        Some(reasons::DUPLICATE_BALLOT)
    );
    // Authentication runs before the duplicate check: unauthenticated input never touches state.
    assert_eq!(
        c.commit("J2", 0, "ans1", false).reason.as_deref(),
        Some(reasons::UNSIGNED)
    );
    let foreign = Commit {
        case_id: "other-case".into(),
        round: 0,
        juror: "J3".into(),
        commitment: "00".repeat(32),
    };
    let adm = c.submit(
        EntryKind::Commit,
        val(&sign(&juror_key("J3"), foreign).unwrap()),
    );
    assert_eq!(adm.reason.as_deref(), Some(reasons::WRONG_CASE));
    // Early reveal during the commit window.
    assert_eq!(
        c.reveal("J1", 0, "ans0", true).reason.as_deref(),
        Some(reasons::OUT_OF_PHASE)
    );
    c.close();
    // Mismatched reveal, then the matching one wins; unsigned reveal rejected.
    assert_eq!(
        c.reveal("J1", 0, "ans1", true).reason.as_deref(),
        Some(reasons::COMMITMENT_MISMATCH)
    );
    assert!(c.reveal("J1", 0, "ans0", true).is_accepted());
    assert_eq!(
        c.reveal("J2", 0, "ans0", false).reason.as_deref(),
        Some(reasons::UNSIGNED)
    );
    assert!(c.reveal("J2", 0, "ans0", true).is_accepted());
    assert!(c.reveal("J3", 0, "ans0", true).is_accepted());
    // J4 never reveals in round 0: abstention, no recovery.
    c.close();
    // Attested argument citing attested and forged ids; unattested argument citing attested id.
    assert!(c.argue("J1", &["ev-0", "ev-forged"], true).is_accepted());
    let un = c.argue("J2", &["ev-0"], false);
    assert_eq!(un.status, EntryStatus::Unattested);
    c.close();
    for j in ["J1", "J2", "J3"] {
        assert!(c.commit(j, 1, "ans1", true).is_accepted());
    }
    c.close();
    for j in ["J1", "J2", "J3"] {
        assert!(c.reveal(j, 1, "ans1", true).is_accepted());
    }
    c.close();
    let cert = c.certify();
    assert_eq!(cert.cert.body.verdict, "ans1");
    assert_eq!(cert.cert.body.quorum.counted, 3);
    assert_eq!(cert.cert.body.evidence_ids, vec!["ev-0".to_string()]);
    let r = verify_cert_typed(&cert);
    assert!(r.valid, "{:?}", r.failures);
    assert!(cert
        .transcript
        .iter()
        .any(|e| e.status == EntryStatus::Rejected));
    assert!(cert
        .transcript
        .iter()
        .any(|e| e.status == EntryStatus::Unattested));
}

#[test]
fn replay_detects_every_certificate_mutation() {
    let (_, cert) = run("case-mut", Condition::C3, ["ans0", "ans0", "ans0", "ans1"]);
    let base = val(&cert);

    // One changed word in an argument: chain failure; the argument also loses attestation.
    let mut v = base.clone();
    let idx = v["transcript"]
        .as_array()
        .unwrap()
        .iter()
        .position(|e| e["kind"] == "argument")
        .unwrap();
    let text = v["transcript"][idx]["msg"]["body"]["text"]
        .as_str()
        .unwrap()
        .replacen("because", "unless", 1);
    v["transcript"][idx]["msg"]["body"]["text"] = Value::String(text);
    let r = verify_cert(&v);
    assert!(
        !r.valid && r.has_code(codes::TRANSCRIPT_ROOT_MISMATCH),
        "{:?}",
        r.failures
    );
    assert!(r.has_code(codes::EVIDENCE_IDS_MISMATCH));

    // Quorum constants are not trusted from the certificate.
    let mut v = base.clone();
    v["cert"]["body"]["quorum"]["needed"] = json!(2);
    let r = verify_cert(&v);
    assert!(r.has_code(codes::QUORUM_FIELDS_INVALID) && r.has_code(codes::CERT_SIG_INVALID));

    // Altered vote envelope.
    let mut v = base.clone();
    v["cert"]["body"]["votes"][0]["body"]["confidence"] = json!(1);
    assert!(verify_cert(&v).has_code(codes::VOTES_MISMATCH));
    let mut v = base.clone();
    v["cert"]["body"]["votes"].as_array_mut().unwrap().pop();
    assert!(verify_cert(&v).has_code(codes::VOTES_MISMATCH));

    // Verdict claims disagree with the replayed tally.
    let mut v = base.clone();
    v["cert"]["body"]["verdict"] = json!("NO_QUORUM");
    assert!(verify_cert(&v).has_code(codes::TALLY_MISMATCH));
    let mut v = base.clone();
    v["cert"]["body"]["verdict"] = json!("ans1");
    assert!(verify_cert(&v).has_code(codes::TALLY_MISMATCH));
    let mut v = base.clone();
    v["cert"]["body"]["verdict"] = json!("bogus");
    assert!(verify_cert(&v).has_code(codes::VERDICT_INVALID));

    // Certificate signed by the Clerk instead of the Ledger.
    let mut v = base.clone();
    let body: CertBody = serde_json::from_value(v["cert"]["body"].clone()).unwrap();
    let resigned = sign(&key("clerk"), body).unwrap();
    v["cert"] = val(&resigned);
    let r = verify_cert(&v);
    assert!(r.has_code(codes::CERT_SIGNER_NOT_LEDGER) && !r.has_code(codes::CERT_SIG_INVALID));

    // Covered transcript must end on the round-1 reveal close.
    let mut v = base.clone();
    let len = v["cert"]["body"]["transcriptLen"].as_u64().unwrap();
    v["cert"]["body"]["transcriptLen"] = json!(len - 1);
    let r = verify_cert(&v);
    assert!(r.has_code(codes::PHASE_ORDER_INVALID) && r.has_code(codes::TRANSCRIPT_ROOT_MISMATCH));
    let mut v = base.clone();
    v["cert"]["body"]["transcriptLen"] = json!(len + 5);
    assert!(verify_cert(&v).has_code(codes::TRANSCRIPT_BOUNDS_INVALID));

    // Reserved verdict as a choice id, and a missing juror.
    let mut v = base.clone();
    v["cert"]["body"]["registry"]["choices"]
        .as_array_mut()
        .unwrap()
        .push(json!("NO_QUORUM"));
    assert!(verify_cert(&v).has_code(codes::REGISTRY_INVALID));
    let mut v = base.clone();
    v["cert"]["body"]["registry"]["jurors"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(verify_cert(&v).has_code(codes::REGISTRY_INVALID));
}

#[test]
fn replay_no_quorum_is_only_valid_when_recomputed() {
    let (_, cert) = run("case-nq", Condition::C5, ["ans0", "ans0", "ans1", "ans2"]);
    assert_eq!(cert.cert.body.verdict, NO_QUORUM);
    assert!(verify_cert_typed(&cert).valid);
    let mut v = val(&cert);
    v["cert"]["body"]["verdict"] = json!("ans0");
    let r = verify_cert(&v);
    assert!(r.has_code(codes::QUORUM_NOT_MET), "{:?}", r.failures);
}

// ---- Public fixtures, once generated by apps/actors gen_fixtures ----

fn fixture(name: &str) -> Option<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name);
    let text = std::fs::read_to_string(path).ok()?;
    Some(serde_json::from_str(&text).unwrap())
}

#[test]
fn fixtures_match_expected_reports() {
    let Some(expected) = fixture("expected.json") else {
        eprintln!("fixtures not generated yet; run `pnpm fixtures`");
        return;
    };
    for name in [
        "valid_cert.json",
        "tampered_cert.json",
        "no_quorum_cert.json",
    ] {
        let cert = fixture(name).unwrap_or_else(|| panic!("{name} missing"));
        let report = verify_cert(&cert);
        let want: VerifyReport = serde_json::from_value(expected[name].clone()).unwrap();
        assert_eq!(report, want, "{name}");
        match name {
            "valid_cert.json" => assert!(report.valid),
            "no_quorum_cert.json" => {
                assert!(report.valid);
                assert_eq!(cert["cert"]["body"]["verdict"], "NO_QUORUM");
            }
            _ => assert!(!report.valid && report.has_code(codes::TRANSCRIPT_ROOT_MISMATCH)),
        }
    }
}
