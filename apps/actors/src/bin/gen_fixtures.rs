//! Generate the public fixtures consumed by the protocol tests and the
//! Node/WASM parity test.
//!
//! Keys are drawn fresh from the OS for every run and discarded; the files
//! contain only public keys, signatures, certificates, and transcripts.
//!
//! Usage: gen_fixtures [--out DIR]   (default: packages/protocol/fixtures)

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use sealed_verdict_actors::runner::{self, run_case, tamper_first_argument_word, verify_value};
use sealed_verdict_protocol::{verify::codes, Condition, VerifyReport, NO_QUORUM};

fn main() -> ExitCode {
    let mut out =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/protocol/fixtures");
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--out" => out = PathBuf::from(args.next().expect("--out needs a directory")),
            _ => {
                eprintln!("usage: gen_fixtures [--out DIR]");
                return ExitCode::from(2);
            }
        }
    }

    match generate(&out) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("fixture generation failed: {e}");
            ExitCode::FAILURE
        }
    }
}

fn generate(out: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(out)?;
    let mut expected: BTreeMap<String, VerifyReport> = BTreeMap::new();

    // valid_cert.json: 3-1 under C3.
    let mut valid_script = runner::three_one(Condition::C3);
    valid_script.case_id = "fixture-valid".to_string();
    let valid = run_case(&valid_script)?;
    if !valid.report.valid {
        return Err(format!(
            "valid fixture failed verification: {:?}",
            valid.report.failures
        )
        .into());
    }
    if !valid_script.choices.contains(&valid.cert.cert.body.verdict) {
        return Err(format!(
            "valid fixture verdict {} is not a choice",
            valid.cert.cert.body.verdict
        )
        .into());
    }
    write(out, "valid_cert.json", &serde_json::to_value(&valid.cert)?)?;
    expected.insert("valid_cert.json".into(), valid.report.clone());

    // tampered_cert.json: one argument word changed, nothing re-signed.
    let tampered = tamper_first_argument_word(&valid.cert)?;
    let tampered_report = verify_value(&tampered);
    if tampered_report.valid || !tampered_report.has_code(codes::TRANSCRIPT_ROOT_MISMATCH) {
        return Err(format!(
            "tampered fixture did not fail on the chain: {:?}",
            tampered_report.failures
        )
        .into());
    }
    write(out, "tampered_cert.json", &tampered)?;
    expected.insert("tampered_cert.json".into(), tampered_report);

    // no_quorum_cert.json: 2-2 under C3.
    let mut nq_script = runner::two_two(Condition::C3);
    nq_script.case_id = "fixture-no-quorum".to_string();
    let nq = run_case(&nq_script)?;
    if !nq.report.valid || nq.cert.cert.body.verdict != NO_QUORUM {
        return Err(format!(
            "no-quorum fixture unexpected: verdict {} failures {:?}",
            nq.cert.cert.body.verdict, nq.report.failures
        )
        .into());
    }
    write(out, "no_quorum_cert.json", &serde_json::to_value(&nq.cert)?)?;
    expected.insert("no_quorum_cert.json".into(), nq.report.clone());

    write(out, "expected.json", &serde_json::to_value(&expected)?)?;

    println!("wrote fixtures to {}", out.display());
    println!(
        "  valid_cert.json      verdict={} valid={}",
        valid.cert.cert.body.verdict, valid.report.valid
    );
    println!(
        "  tampered_cert.json   valid=false failures={:?}",
        expected["tampered_cert.json"].failures
    );
    println!(
        "  no_quorum_cert.json  verdict={} valid={}",
        nq.cert.cert.body.verdict, nq.report.valid
    );
    println!("  expected.json        native reports for WASM parity");
    Ok(())
}

fn write(dir: &Path, name: &str, value: &serde_json::Value) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    fs::write(dir.join(name), json + "\n")
}
