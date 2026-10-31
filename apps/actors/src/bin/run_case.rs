//! Run one scripted case in memory and write `<out>/<caseId>.json`.
//!
//! Usage:
//!   run_case [--script 3-1|2-2|forged] [--condition C2|C3|C4|C5] [--out DIR] [--case-id ID]

use std::path::PathBuf;
use std::process::ExitCode;

use sealed_verdict_actors::runner::{self, default_case_id, run_case, write_case};
use sealed_verdict_protocol::Condition;

fn usage() -> ! {
    eprintln!("usage: run_case [--script 3-1|2-2|forged] [--condition C2|C3|C4|C5] [--out DIR] [--case-id ID]");
    std::process::exit(2)
}

fn parse_condition(s: &str) -> Condition {
    match s {
        "C2" => Condition::C2,
        "C3" => Condition::C3,
        "C4" => Condition::C4,
        "C5" => Condition::C5,
        _ => usage(),
    }
}

fn main() -> ExitCode {
    let mut script_name = "3-1".to_string();
    let mut condition = Condition::C3;
    let mut out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("out");
    let mut case_id: Option<String> = None;

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--script" => script_name = args.next().unwrap_or_else(|| usage()),
            "--condition" => condition = parse_condition(&args.next().unwrap_or_else(|| usage())),
            "--out" => out = PathBuf::from(args.next().unwrap_or_else(|| usage())),
            "--case-id" => case_id = Some(args.next().unwrap_or_else(|| usage())),
            "-h" | "--help" => usage(),
            _ => usage(),
        }
    }

    let mut script = match script_name.as_str() {
        "3-1" => runner::three_one(condition),
        "2-2" => runner::two_two(condition),
        "forged" => runner::forged_evidence(condition),
        _ => usage(),
    };
    script.case_id = case_id.unwrap_or_else(|| default_case_id(&script_name));

    let run = match run_case(&script) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("run failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    let path = match write_case(&out, &run.cert) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("could not write output: {e}");
            return ExitCode::FAILURE;
        }
    };

    println!("case:      {}", run.cert.cert.body.case_id);
    println!("condition: {:?}", script.condition);
    println!("verdict:   {}", run.cert.cert.body.verdict);
    println!(
        "counted:   {} of {}",
        run.tally.counted, run.cert.cert.body.quorum.n
    );
    println!("entries:   {}", run.cert.transcript.len());
    println!("valid:     {}", run.report.valid);
    for f in &run.report.failures {
        println!("failure:   {f}");
    }
    println!("output:    {}", path.display());

    if run.report.valid {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
