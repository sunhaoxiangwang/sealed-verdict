//! Daemon command-contract tests, driven in-process through `Daemon::handle`.

use std::path::PathBuf;

use sealed_verdict_actors::daemon::Daemon;
use sealed_verdict_protocol::{verify_cert, VerdictCert};
use serde_json::{json, Value};

fn call(d: &mut Daemon, cmd: &str, mut params: Value) -> Value {
    params["id"] = json!("r1");
    params["cmd"] = json!(cmd);
    d.handle(&params.to_string())
}

fn ok(v: Value) -> Value {
    assert_eq!(v["ok"], true, "{v}");
    v["result"].clone()
}

fn err(v: Value) -> String {
    assert_eq!(v["ok"], false, "{v}");
    v["error"]["code"].as_str().unwrap().to_string()
}

fn open_params(case_id: &str, condition: &str) -> Value {
    json!({
        "caseId": case_id,
        "condition": condition,
        "choices": ["ans0", "ans1", "ans2"],
        "context": [
            {"source": "case:context", "content": "Two neighbors heard the alarm. Only one called the manager."},
            {"source": "case:question", "content": "Who called the building manager?"}
        ],
        "jurors": [
            {"id": "juror-1", "sender": "S1"},
            {"id": "juror-2", "sender": "S2"},
            {"id": "juror-3", "sender": "S3"},
            {"id": "juror-4", "sender": "S4"}
        ],
        "timeoutMs": 1000
    })
}

fn daemon() -> Daemon {
    let dir = std::env::temp_dir().join(format!(
        "sv-daemon-test-{}",
        sealed_verdict_actors::rng::random_hex(4)
    ));
    Daemon::new(dir)
}

fn deadline(d: &mut Daemon) -> u64 {
    ok(call(d, "phase", json!({})))["phase"]["deadlineMs"]
        .as_u64()
        .unwrap()
}

/// Advance to the current deadline and close exactly one phase.
fn close(d: &mut Daemon) -> Value {
    let dl = deadline(d);
    let r = ok(call(d, "tick", json!({"nowMs": dl})));
    assert_eq!(r["closed"]["kind"], "phase", "{r}");
    r
}

fn admit(d: &mut Daemon, kind: &str, msg: &Value) -> Value {
    ok(call(d, "admit", json!({"kind": kind, "msg": msg})))
}

#[test]
fn open_is_fresh_and_single() {
    let mut d = daemon();
    assert_eq!(err(call(&mut d, "phase", json!({}))), "no_case");
    let r = ok(call(&mut d, "open", open_params("live-1", "C3")));
    assert_eq!(r["registry"]["jurors"].as_array().unwrap().len(), 4);
    assert_eq!(r["evidence"].as_array().unwrap().len(), 2);
    assert_eq!(r["phase"]["phase"], "attest");
    assert_eq!(r["phase"]["round"], 0);
    assert_eq!(r["head"].as_str().unwrap().len(), 64);
    assert_eq!(
        err(call(&mut d, "open", open_params("live-2", "C3"))),
        "case_open"
    );
    assert_eq!(err(call(&mut d, "bogus", json!({}))), "bad_request");
    assert_eq!(err(call(&mut d, "finish", json!({}))), "not_closed");
}

#[test]
fn sign_requires_known_sender_open_phase_and_round() {
    let mut d = daemon();
    let r = ok(call(&mut d, "open", open_params("live-sign", "C3")));
    for ev in r["evidence"].as_array().unwrap() {
        assert_eq!(admit(&mut d, "evidence", ev)["entry"]["status"], "accepted");
    }
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "nope", "kind": "commit", "round": 0, "vote": "ans0"})
        )),
        "unknown_sender"
    );
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S1", "kind": "commit", "round": 0, "vote": "ans0"})
        )),
        "wrong_phase"
    );
    close(&mut d); // attest -> commit/0
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S1", "kind": "commit", "round": 1, "vote": "ans0"})
        )),
        "wrong_phase"
    );
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S1", "kind": "reveal", "round": 0})
        )),
        "wrong_phase"
    );
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S1", "kind": "commit", "round": 0, "vote": "bogus"})
        )),
        "invalid_vote"
    );
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S1", "kind": "commit", "round": 0, "vote": "ans0", "confidence": 101})
        )),
        "invalid_confidence"
    );
    let c = ok(call(
        &mut d,
        "sign",
        json!({"sender": "S1", "kind": "commit", "round": 0, "vote": "ans0", "confidence": 70}),
    ));
    assert_eq!(c["channel"]["kind"], "commit");
    assert_eq!(c["envelope"]["body"]["juror"], "juror-1");
    assert!(c["envelope"]["sig"].is_string());
    assert_eq!(
        admit(&mut d, "commit", &c["envelope"])["entry"]["status"],
        "accepted"
    );
    close(&mut d); // commit/0 -> reveal/0
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S2", "kind": "reveal", "round": 0})
        )),
        "no_commit"
    );
    let rv = ok(call(
        &mut d,
        "sign",
        json!({"sender": "S1", "kind": "reveal", "round": 0}),
    ));
    assert_eq!(rv["envelope"]["body"]["vote"], "ans0");
    assert_eq!(
        admit(&mut d, "reveal", &rv["envelope"])["entry"]["status"],
        "accepted"
    );
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S1", "kind": "argument", "round": 0, "text": "x"})
        )),
        "wrong_phase"
    );
    close(&mut d); // reveal/0 -> deliberate/0
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S1", "kind": "argument", "round": 1, "text": "x"})
        )),
        "wrong_phase"
    );
    let a = ok(call(
        &mut d,
        "sign",
        json!({"sender": "S1", "kind": "argument", "round": 0, "text": "because ev-0", "evidenceIds": ["ev-0"]}),
    ));
    assert_eq!(a["envelope"]["body"]["evidenceIds"][0], "ev-0");
}

#[test]
fn tick_closes_once_and_never_moves_backward() {
    let mut d = daemon();
    ok(call(&mut d, "open", open_params("live-tick", "C3")));
    let dl = deadline(&mut d);
    let early = ok(call(&mut d, "tick", json!({"nowMs": dl - 1})));
    assert!(early["closed"].is_null());
    let late = dl + 5_000;
    let r = ok(call(&mut d, "tick", json!({"nowMs": late})));
    assert_eq!(r["closed"]["kind"], "phase");
    assert_eq!(r["closed"]["msg"]["body"]["phase"], "attest");
    assert_eq!(r["phase"]["phase"], "commit");
    assert_eq!(r["phase"]["deadlineMs"], late + 1000);
    // Same instant again: no second close.
    let again = ok(call(&mut d, "tick", json!({"nowMs": late})));
    assert!(again["closed"].is_null());
    // A reordered older tick does not rewind the clock or the deadline.
    let old = ok(call(&mut d, "tick", json!({"nowMs": 10})));
    assert!(old["closed"].is_null());
    assert_eq!(old["nowMs"], late);
    assert_eq!(old["phase"]["deadlineMs"], late + 1000);
}

#[test]
fn admit_rejects_phase_kind_and_phase_is_tick_only() {
    let mut d = daemon();
    let r = ok(call(&mut d, "open", open_params("live-admit", "C3")));
    let marker = json!({"body": {"caseId": "live-admit", "phase": "attest", "round": 0, "ts": 1}, "sig": null, "signer": null});
    assert_eq!(
        err(call(
            &mut d,
            "admit",
            json!({"kind": "phase", "msg": marker})
        )),
        "forbidden_kind"
    );
    // Junk from transport is recorded as an audit row, never fatal.
    let junk = admit(&mut d, "commit", &json!({"hello": "world"}));
    assert_eq!(junk["entry"]["status"], "rejected");
    assert_eq!(junk["admission"]["reason"], "OUT_OF_PHASE");
    close(&mut d); // attest -> commit/0
    let junk = admit(&mut d, "commit", &json!({"hello": "world"}));
    assert_eq!(junk["admission"]["reason"], "MALFORMED");
    let _ = r;
}

#[test]
fn full_live_flow_certifies_three_one() {
    let mut d = daemon();
    let r = ok(call(&mut d, "open", open_params("live-full", "C3")));
    for ev in r["evidence"].as_array().unwrap() {
        admit(&mut d, "evidence", ev);
    }
    close(&mut d);
    let votes = [
        ("S1", "ans2"),
        ("S2", "ans2"),
        ("S3", "ans2"),
        ("S4", "ans0"),
    ];
    for round in [0u8, 1u8] {
        if round == 1 {
            // deliberate/0 is open here
            for (s, _) in votes {
                let a = ok(call(
                    &mut d,
                    "sign",
                    json!({"sender": s, "kind": "argument", "round": 0, "text": "I lean this way because of ev-0", "evidenceIds": ["ev-0"]}),
                ));
                assert_eq!(
                    admit(&mut d, "argument", &a["envelope"])["entry"]["status"],
                    "accepted"
                );
            }
            close(&mut d); // deliberate -> commit/1
        }
        for (s, v) in votes {
            let c = ok(call(
                &mut d,
                "sign",
                json!({"sender": s, "kind": "commit", "round": round, "vote": v, "confidence": 80}),
            ));
            assert_eq!(
                admit(&mut d, "commit", &c["envelope"])["entry"]["status"],
                "accepted"
            );
        }
        close(&mut d);
        for (s, _) in votes {
            let rv = ok(call(
                &mut d,
                "sign",
                json!({"sender": s, "kind": "reveal", "round": round}),
            ));
            assert_eq!(
                admit(&mut d, "reveal", &rv["envelope"])["entry"]["status"],
                "accepted"
            );
        }
        close(&mut d);
    }
    let ph = ok(call(&mut d, "phase", json!({})));
    assert_eq!(ph["phase"]["closed"], true);
    assert_eq!(
        err(call(
            &mut d,
            "sign",
            json!({"sender": "S1", "kind": "commit", "round": 1, "vote": "ans2"})
        )),
        "wrong_phase"
    );
    let late = admit(&mut d, "commit", &json!({"hello": "world"}));
    assert_eq!(late["entry"]["status"], "rejected");
    let f = ok(call(&mut d, "finish", json!({})));
    assert_eq!(f["report"]["valid"], true, "{}", f["report"]);
    assert_eq!(f["cert"]["cert"]["body"]["verdict"], "ans2");
    assert_eq!(f["cert"]["cert"]["body"]["quorum"]["counted"], 4);
    assert_eq!(f["cert"]["cert"]["body"]["evidenceIds"], json!(["ev-0"]));
    let path = PathBuf::from(f["path"].as_str().unwrap());
    assert!(path.ends_with("live-full.json"));
    let text = std::fs::read_to_string(&path).unwrap();
    let parsed: VerdictCert = serde_json::from_str(&text).unwrap();
    assert!(verify_cert(&serde_json::to_value(&parsed).unwrap()).valid);
    assert_eq!(err(call(&mut d, "finish", json!({}))), "already_finished");
    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}
