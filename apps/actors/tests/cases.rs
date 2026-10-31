//! End-to-end behavior of the in-memory actors against the shared verifier.
//! Everything runs on the simulated clock; no sleeps.

use std::fs;

use sealed_verdict_actors::runner::{
    self, forged_evidence, run_case, tamper_first_argument_word, three_one, two_two, write_case,
    Harness, FORGED_BADKEY_ID, FORGED_UNSIGNED_ID,
};
use sealed_verdict_protocol::replay::reasons;
use sealed_verdict_protocol::verify::codes;
use sealed_verdict_protocol::{
    verify_cert, Commit, Condition, EntryKind, EntryStatus, LedgerEntry, Phase, VerdictCert,
    NO_QUORUM,
};
use serde_json::Value;

fn last_entry(h: &Harness) -> &LedgerEntry {
    h.ledger.entries().last().expect("ledger has entries")
}

fn entries_of_kind(cert: &VerdictCert, kind: EntryKind) -> Vec<&LedgerEntry> {
    cert.transcript.iter().filter(|e| e.kind == kind).collect()
}

fn evidence_id(e: &LedgerEntry) -> &str {
    e.msg
        .pointer("/body/id")
        .and_then(Value::as_str)
        .unwrap_or("")
}

/// Drive a harness through attest and both closes so the commit/0 window is open.
fn open_in_commit_0(h: &mut Harness) {
    h.attest().unwrap();
    h.close_phase().unwrap();
    assert_eq!(
        h.clerk.phase(h.ledger.case_id()).unwrap().phase,
        Phase::Commit
    );
}

#[test]
fn full_case_cert_verifies() {
    let run = run_case(&three_one(Condition::C3)).unwrap();
    assert!(run.report.valid, "{:?}", run.report.failures);
    assert_eq!(run.cert.cert.body.verdict, "ans2");
    assert_eq!(run.cert.cert.body.quorum.counted, 4);
    assert_eq!(
        run.cert.cert.body.transcript_len as usize,
        run.cert.transcript.len()
    );
    assert_eq!(run.cert.cert.body.evidence_ids, vec!["ev-0", "ev-1"]);
    assert_eq!(
        run.cert.cert.signer.as_deref(),
        Some(run.cert.cert.body.registry.ledger.as_str())
    );
}

#[test]
fn clerk_rejects_early_reveal() {
    let mut h = Harness::open(&three_one(Condition::C3)).unwrap();
    open_in_commit_0(&mut h);
    let env = h.jurors[0].commit(0, "ans2", 80).unwrap();
    assert!(h.clerk.commit(&mut h.ledger, &env).unwrap().is_accepted());

    let early = h.jurors[0].reveal(0).unwrap();
    let adm = h.clerk.reveal(&mut h.ledger, &early).unwrap();
    assert_eq!(adm.status, EntryStatus::Rejected);
    assert_eq!(adm.reason.as_deref(), Some(reasons::OUT_OF_PHASE));
    let e = last_entry(&h);
    assert_eq!(e.kind, EntryKind::Reveal);
    assert_eq!(e.status, EntryStatus::Rejected);
    assert_eq!(e.reason.as_deref(), Some(reasons::OUT_OF_PHASE));
}

#[test]
fn clerk_rejects_mismatched_reveal() {
    let mut h = Harness::open(&three_one(Condition::C3)).unwrap();
    open_in_commit_0(&mut h);
    h.commit_round(0).unwrap();
    h.close_phase().unwrap();
    assert_eq!(
        h.clerk.phase(h.ledger.case_id()).unwrap().phase,
        Phase::Reveal
    );

    let wrong = h.jurors[0].reveal_with_vote(0, "ans0").unwrap();
    let adm = h.clerk.reveal(&mut h.ledger, &wrong).unwrap();
    assert_eq!(adm.status, EntryStatus::Rejected);
    assert_eq!(adm.reason.as_deref(), Some(reasons::COMMITMENT_MISMATCH));

    let right = h.jurors[0].reveal(0).unwrap();
    assert!(h.clerk.reveal(&mut h.ledger, &right).unwrap().is_accepted());
}

#[test]
fn first_ballot_wins_later_audit_only() {
    let mut h = Harness::open(&three_one(Condition::C3)).unwrap();
    h.attest().unwrap();
    h.close_phase().unwrap();
    h.commit_round(0).unwrap();
    h.close_phase().unwrap();
    h.reveal_round(0).unwrap();
    h.close_phase().unwrap();
    h.deliberate().unwrap();
    h.close_phase().unwrap();
    h.commit_round(1).unwrap();

    // A second, conflicting round-1 commit from juror-1 is logged but ignored.
    let body = Commit {
        case_id: h.ledger.case_id().to_string(),
        round: 1,
        juror: "juror-1".to_string(),
        commitment: "ab".repeat(32),
    };
    let dup = h.jurors[0].envelope(body).unwrap();
    let adm = h.clerk.commit(&mut h.ledger, &dup).unwrap();
    assert_eq!(adm.status, EntryStatus::Rejected);
    assert_eq!(adm.reason.as_deref(), Some(reasons::DUPLICATE_BALLOT));

    h.close_phase().unwrap();
    h.reveal_round(1).unwrap();
    h.close_phase().unwrap();
    let run = h.finish().unwrap();
    assert!(run.report.valid, "{:?}", run.report.failures);
    assert_eq!(run.cert.cert.body.verdict, "ans2");
    assert_eq!(run.cert.cert.body.quorum.counted, 4);
    // juror-1's round-1 reveal still matches its first commitment.
    assert!(run.cert.transcript.iter().any(|e| {
        e.status == EntryStatus::Accepted
            && e.msg["body"]["juror"] == "juror-1"
            && e.msg["body"]["round"] == 1
            && e.msg["body"]["nonce"].is_string()
    }));
    let rejected = run
        .cert
        .transcript
        .iter()
        .filter(|e| e.status == EntryStatus::Rejected)
        .count();
    assert_eq!(rejected, 1);
}

#[test]
fn missing_commit_is_abstention() {
    let mut script = three_one(Condition::C3);
    script.jurors[3].round1_vote = None;
    let run = run_case(&script).unwrap();
    assert!(run.report.valid, "{:?}", run.report.failures);
    assert_eq!(run.cert.cert.body.quorum.counted, 3);
    assert_eq!(run.cert.cert.body.votes.len(), 3);
    assert_eq!(run.cert.cert.body.verdict, "ans2");
    assert!(run
        .cert
        .cert
        .body
        .votes
        .iter()
        .all(|v| v.body.juror != "juror-4"));
}

#[test]
fn forged_evidence_unattested_c3_c5_case_still_valid() {
    for cond in [Condition::C3, Condition::C4, Condition::C5] {
        let run = run_case(&forged_evidence(cond)).unwrap();
        assert!(run.report.valid, "{cond:?}: {:?}", run.report.failures);
        assert_eq!(run.cert.cert.body.verdict, "ans2");

        let evidence = entries_of_kind(&run.cert, EntryKind::Evidence);
        let unsigned = evidence
            .iter()
            .find(|e| evidence_id(e) == FORGED_UNSIGNED_ID)
            .expect("forged unsigned logged");
        let badkey = evidence
            .iter()
            .find(|e| evidence_id(e) == FORGED_BADKEY_ID)
            .expect("forged badkey logged");
        assert_eq!(unsigned.status, EntryStatus::Unattested);
        assert_eq!(unsigned.reason.as_deref(), Some(reasons::UNSIGNED));
        assert_eq!(badkey.status, EntryStatus::Unattested);
        assert_eq!(badkey.reason.as_deref(), Some(reasons::WRONG_SIGNER));

        let ids = &run.cert.cert.body.evidence_ids;
        assert!(
            !ids.iter()
                .any(|i| i == FORGED_UNSIGNED_ID || i == FORGED_BADKEY_ID),
            "{ids:?}"
        );
        assert_eq!(ids, &vec!["ev-0".to_string(), "ev-1".to_string()]);

        let unattested_args = entries_of_kind(&run.cert, EntryKind::Argument)
            .into_iter()
            .filter(|e| e.status == EntryStatus::Unattested)
            .count();
        assert_eq!(
            unattested_args, 1,
            "{cond:?}: impersonated argument must be tagged UNATTESTED"
        );
    }
}

#[test]
fn c2_unsigned_ballots_claimed_identity() {
    let mut script = three_one(Condition::C2);
    for j in &mut script.jurors {
        j.signed = false;
    }
    let run = run_case(&script).unwrap();
    assert!(run.report.valid, "{:?}", run.report.failures);
    assert_eq!(run.cert.cert.body.verdict, "ans2");
    assert_eq!(run.cert.cert.body.votes.len(), 4);
    for v in &run.cert.cert.body.votes {
        assert!(
            v.sig.is_none() && v.signer.is_none(),
            "C2 unsigned vote must carry null sig and signer"
        );
    }
    // Clerk and Ledger signatures stay mandatory under C2.
    assert!(run.cert.cert.sig.is_some());
    let as_json = serde_json::to_value(&run.cert).unwrap();
    let vote0 = &as_json["cert"]["body"]["votes"][0];
    assert!(vote0.get("sig").is_some_and(Value::is_null));
    assert!(vote0.get("signer").is_some_and(Value::is_null));
}

#[test]
fn c2_rejected_in_c3() {
    let mut script = three_one(Condition::C3);
    script.jurors[3].signed = false; // the dissenting juror goes unsigned
    let run = run_case(&script).unwrap();
    assert!(run.report.valid, "{:?}", run.report.failures);
    let rejected: Vec<&LedgerEntry> = run
        .cert
        .transcript
        .iter()
        .filter(|e| e.status == EntryStatus::Rejected)
        .collect();
    assert!(!rejected.is_empty());
    assert!(rejected
        .iter()
        .all(|e| e.reason.as_deref() == Some(reasons::UNSIGNED)));
    assert!(rejected
        .iter()
        .all(|e| e.msg.pointer("/body/juror").and_then(Value::as_str) == Some("juror-4")));
    assert_eq!(run.cert.cert.body.quorum.counted, 3);
    assert_eq!(run.cert.cert.body.verdict, "ans2");
}

#[test]
fn three_one_certifies() {
    let run = run_case(&three_one(Condition::C3)).unwrap();
    assert!(run.report.valid);
    assert_eq!(run.cert.cert.body.verdict, "ans2");
    assert_eq!(run.tally.per_choice.get("ans2"), Some(&3));
    assert_eq!(run.tally.per_choice.get("ans0"), Some(&1));
}

#[test]
fn two_two_no_quorum_verifies() {
    let run = run_case(&two_two(Condition::C3)).unwrap();
    assert!(run.report.valid, "{:?}", run.report.failures);
    assert_eq!(run.cert.cert.body.verdict, NO_QUORUM);
    assert_eq!(run.cert.cert.body.quorum.counted, 4);
    assert_eq!(run.cert.cert.body.votes.len(), 4);
}

#[test]
fn cross_case_messages_rejected() {
    let mut h = Harness::open(&three_one(Condition::C3)).unwrap();
    open_in_commit_0(&mut h);
    let body = Commit {
        case_id: "some-other-case".to_string(),
        round: 0,
        juror: "juror-1".to_string(),
        commitment: "cd".repeat(32),
    };
    let env = h.jurors[0].envelope(body).unwrap();
    let adm = h.clerk.commit(&mut h.ledger, &env).unwrap();
    assert_eq!(adm.status, EntryStatus::Rejected);
    assert_eq!(adm.reason.as_deref(), Some(reasons::WRONG_CASE));
    assert!(h.clerk.phase("some-other-case").is_none());
}

#[test]
fn incorrect_quorum_fields_fail() {
    let run = run_case(&three_one(Condition::C3)).unwrap();
    let mut v = serde_json::to_value(&run.cert).unwrap();
    v["cert"]["body"]["quorum"]["needed"] = Value::from(2);
    let report = verify_cert(&v);
    assert!(!report.valid);
    assert!(
        report.has_code(codes::QUORUM_FIELDS_INVALID),
        "{:?}",
        report.failures
    );
    assert!(
        report.has_code(codes::CERT_SIG_INVALID),
        "{:?}",
        report.failures
    );

    let mut v2 = serde_json::to_value(&run.cert).unwrap();
    v2["cert"]["body"]["quorum"]["counted"] = Value::from(3);
    let report2 = verify_cert(&v2);
    assert!(
        report2.has_code(codes::QUORUM_FIELDS_INVALID),
        "{:?}",
        report2.failures
    );
}

#[test]
fn altered_vote_envelope_fails() {
    let run = run_case(&three_one(Condition::C3)).unwrap();
    let mut v = serde_json::to_value(&run.cert).unwrap();
    let c = v["cert"]["body"]["votes"][0]["body"]["confidence"]
        .as_u64()
        .unwrap();
    v["cert"]["body"]["votes"][0]["body"]["confidence"] = Value::from((c + 1) % 101);
    let report = verify_cert(&v);
    assert!(!report.valid);
    assert!(
        report.has_code(codes::VOTES_MISMATCH),
        "{:?}",
        report.failures
    );

    // Dropping a vote envelope is also caught.
    let mut v2 = serde_json::to_value(&run.cert).unwrap();
    v2["cert"]["body"]["votes"].as_array_mut().unwrap().pop();
    assert!(verify_cert(&v2).has_code(codes::VOTES_MISMATCH));
}

#[test]
fn tampered_argument_word_fails() {
    let run = run_case(&three_one(Condition::C3)).unwrap();
    let tampered = tamper_first_argument_word(&run.cert).unwrap();
    let report = runner::verify_value(&tampered);
    assert!(!report.valid);
    assert!(
        report.has_code(codes::TRANSCRIPT_ROOT_MISMATCH),
        "{:?}",
        report.failures
    );
    // Signatures and root untouched: only the text differs.
    let original = serde_json::to_value(&run.cert).unwrap();
    assert_eq!(original["cert"], tampered["cert"]);
    let diffs = original["transcript"]
        .as_array()
        .unwrap()
        .iter()
        .zip(tampered["transcript"].as_array().unwrap())
        .filter(|(a, b)| a != b)
        .count();
    assert_eq!(diffs, 1);
}

#[test]
fn output_file_written() {
    let run = run_case(&three_one(Condition::C3)).unwrap();
    let dir = std::env::temp_dir().join(format!(
        "sealed-verdict-test-{}",
        runner::default_case_id("out")
    ));
    let path = write_case(&dir, &run.cert).unwrap();
    assert_eq!(path.file_name().unwrap().to_str().unwrap(), "case-3-1.json");
    let text = fs::read_to_string(&path).unwrap();
    let parsed: VerdictCert = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed, run.cert);
    let report = verify_cert(&serde_json::from_str::<Value>(&text).unwrap());
    assert!(report.valid, "{:?}", report.failures);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn phase_sequence_and_timeouts() {
    let mut h = Harness::open(&three_one(Condition::C3)).unwrap();
    let case = h.ledger.case_id().to_string();
    let info = h.clerk.phase(&case).unwrap();
    assert_eq!(
        (info.phase, info.round, info.closed),
        (Phase::Attest, 0, false)
    );
    // Before the deadline nothing closes.
    assert!(!h.clerk.tick(&mut h.ledger).unwrap());
    let expected = [
        (Phase::Attest, 0),
        (Phase::Commit, 0),
        (Phase::Reveal, 0),
        (Phase::Deliberate, 0),
        (Phase::Commit, 1),
        (Phase::Reveal, 1),
    ];
    for (phase, round) in expected {
        let info = h.clerk.phase(&case).unwrap();
        assert_eq!((info.phase, info.round), (phase, round));
        h.close_phase().unwrap();
    }
    assert!(h.clerk.phase(&case).unwrap().closed);
    assert!(h.close_phase().is_err());
    // A case with no ballots at all still certifies NO_QUORUM verifiably.
    let run = h.finish().unwrap();
    assert!(run.report.valid, "{:?}", run.report.failures);
    assert_eq!(run.cert.cert.body.verdict, NO_QUORUM);
    assert_eq!(run.cert.cert.body.quorum.counted, 0);
}
