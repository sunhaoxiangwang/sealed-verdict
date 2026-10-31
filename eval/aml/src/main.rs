//! Sealed Verdict AML eval: alert -> triage -> investigation + RFI -> panel -> four-eyes -> lookback, under C0..C5.
//!
//!   sv-aml build  [--ibm-trans HI-Small_Trans.csv [--ibm-patterns HI-Small_Patterns.txt]] [--n 200]
//!   sv-aml run    [--cond C0,C1,C2,C3,C4,C5] [--backend mock|py] [--provider anthropic] [--panel local|relay]
//!                 [--limit N] [--workers 8] [--rounds 2]
//!   sv-aml score  [--ref anthropic]
//!   sv-aml verify <events file>        sv-aml serve [--port 8787]        sv-aml demo [--backend mock|py]
mod actors;
mod data;
mod score;
mod trust;
mod workflow;

use serde_json::{Value, json};
use std::{env, fs, path::PathBuf, sync::{Mutex, atomic::{AtomicUsize, Ordering}}};
use workflow::{LABELS, Opts};

fn eval_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
}

fn read_cases(path: &PathBuf) -> Vec<data::AmlCase> {
    let text = fs::read_to_string(path).unwrap_or_else(|_| panic!("{} missing: run `sv-aml build` first", path.display()));
    text.lines().map(|l| serde_json::from_str(l).expect("case line")).collect()
}

/// Runs one condition over all cases with a worker pool. Returns verdict rows in case order.
fn run_cond(cases: &[data::AmlCase], cond: &str, opts: &Opts, results: &PathBuf, workers: usize) -> Vec<Value> {
    let tag = opts.tag(cond);
    let store = actors::Store::new(results.join("state").join(format!("{cond}_{tag}")));
    let events = results.join("events").join(format!("{cond}_{tag}"));
    fs::create_dir_all(&events).unwrap();
    let next = AtomicUsize::new(0);
    let rows = Mutex::new(vec![Value::Null; cases.len()]);
    // ponytail: std threads over one queue. With --backend py the GIL serializes Python, but provider HTTP releases it.
    std::thread::scope(|s| {
        for _ in 0..workers.max(1) {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(c) = cases.get(i) else { break };
                let out = workflow::run_case(c, cond, opts, &store);
                if let Some(f) = out.file {
                    let name = c.case_id.replace(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-', "_");
                    fs::write(events.join(format!("{name}.json")), serde_json::to_vec(&f).unwrap()).unwrap();
                }
                rows.lock().unwrap()[i] = out.verdict;
            });
        }
    });
    let rows = rows.into_inner().unwrap();
    let path = results.join(format!("verdicts_{cond}_{tag}.jsonl"));
    fs::write(&path, rows.iter().map(|r| r.to_string() + "\n").collect::<String>()).unwrap();
    let failed = rows.iter().filter(|r| r["answer"].is_null()).count();
    println!("{}: {} verdicts, {failed} failed{}", path.display(), rows.len(),
             rows.iter().find_map(|r| r["error"].as_str()).map_or(String::new(), |e| format!(" (first error: {e})")));
    rows
}

fn print_audit(events: &[trust::Event]) -> bool {
    let rows = trust::audit(events);
    for (label, ok, detail) in &rows {
        println!("  {} {label}: {detail}", if *ok { "PASS" } else { "FAIL" });
    }
    rows.iter().all(|r| r.1)
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let opt = |k: &str| args.iter().position(|a| *a == format!("--{k}")).and_then(|i| args.get(i + 1)).cloned();
    let num = |k: &str, d: usize| opt(k).and_then(|v| v.parse().ok()).unwrap_or(d);
    let cases_path = opt("cases").map(PathBuf::from).unwrap_or(eval_dir().join("data/aml/cases.jsonl"));
    let results = opt("results").map(PathBuf::from).unwrap_or(eval_dir().join("results/aml"));
    let opts = Opts { mock: opt("backend").as_deref().unwrap_or("mock") == "mock", provider: opt("provider").unwrap_or("anthropic".into()),
                      rounds: num("rounds", 2) as u32, relay: opt("panel").as_deref() == Some("relay") };

    match args.first().map(String::as_str).unwrap_or("help") {
        "build" => {
            let n = num("n", 200);
            let (txs, kind, linked) = match opt("ibm-trans") {
                Some(p) => (data::load_ibm(&p, opt("ibm-patterns").as_deref()), Default::default(), Default::default()),
                None => {
                    println!("no --ibm-trans given: generating IBM-format synthetic transactions (seed 20261031)");
                    data::generate(20_261_031)
                }
            };
            let cases = data::build(&txs, &kind, &linked, n, 20_261_031);
            fs::create_dir_all(cases_path.parent().unwrap()).unwrap();
            fs::write(&cases_path, cases.iter().map(|c| serde_json::to_string(c).unwrap() + "\n").collect::<String>()).unwrap();
            let pos = cases.iter().filter(|c| c.arm == "aml_cases" && c.gold == 0).count();
            println!("{}: {} transactions -> {} alerts per arm ({pos} laundering) x 3 arms", cases_path.display(), txs.len(), cases.len() / 3);
        }
        "run" => {
            let mut cases = read_cases(&cases_path);
            if let Some(l) = opt("limit").and_then(|v| v.parse::<usize>().ok()) {
                let keep: std::collections::HashSet<String> = cases.iter().filter(|c| c.arm == "aml_cases").take(l).map(|c| c.base_id.clone()).collect();
                cases.retain(|c| keep.contains(&c.base_id));
            }
            for cond in opt("cond").unwrap_or("C0,C1,C2,C3,C4,C5".into()).split(',') {
                run_cond(&cases, cond.trim(), &opts, &results, num("workers", 8));
            }
        }
        "score" => {
            let res = score::score(&results, &opt("ref").unwrap_or(if opts.mock { "mock".into() } else { "anthropic".into() }));
            fs::write(results.join("results.json"), serde_json::to_string_pretty(&res).unwrap()).unwrap();
            let t = score::table(&res);
            fs::write(results.join("results_table.md"), &t).unwrap();
            println!("{t}\n-> {}", results.join("results.json").display());
        }
        "verify" => {
            let path = args.get(1).expect("usage: sv-aml verify <events file>");
            let file: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
            let events: Vec<trust::Event> = serde_json::from_value(file["events"].clone()).unwrap();
            let ok = print_audit(&events);
            println!("{}", if ok { "VERIFIED" } else { "NOT VERIFIED" });
            std::process::exit(if ok { 0 } else { 1 });
        }
        "serve" => {
            // Verify endpoint: POST /verify with an events file ({"events": [...]}) -> {"ok", "checks"}.
            let addr = format!("127.0.0.1:{}", num("port", 8787));
            let server = tiny_http::Server::http(&addr).unwrap();
            println!("POST http://{addr}/verify");
            let cors = tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
            for mut req in server.incoming_requests() {
                let mut body = String::new();
                let _ = req.as_reader().read_to_string(&mut body);
                let (code, out) = match (req.method(), req.url()) {
                    (tiny_http::Method::Post, "/verify") => match serde_json::from_str::<Value>(&body).ok().and_then(|v| serde_json::from_value::<Vec<trust::Event>>(v["events"].clone()).ok()) {
                        Some(ev) => {
                            let rows = trust::audit(&ev);
                            (200, json!({"ok": rows.iter().all(|r| r.1), "checks": rows.iter().map(|(l, o, d)| json!({"label": l, "ok": o, "detail": d})).collect::<Vec<_>>()}))
                        }
                        None => (400, json!({"error": "body must be JSON with an events array"})),
                    },
                    (tiny_http::Method::Options, _) => (204, json!({})),
                    _ => (404, json!({"error": "POST /verify"})),
                };
                let resp = tiny_http::Response::from_string(out.to_string()).with_status_code(code).with_header(cors.clone())
                    .with_header(tiny_http::Header::from_bytes("Access-Control-Allow-Headers", "content-type").unwrap());
                let _ = req.respond(resp);
            }
        }
        "demo" => demo(&cases_path, &results, &opts),
        _ => println!("{}", include_str!("main.rs").lines().take_while(|l| l.starts_with("//!")).map(|l| &l[3.min(l.len())..]).collect::<Vec<_>>().join("\n")),
    }
}

/// The 7-step demo from the AML artifact, on one laundering and one clean case.
fn demo(cases_path: &PathBuf, results: &PathBuf, opts: &Opts) {
    let all = read_cases(cases_path);
    let pick = |gold: usize| all.iter().find(|c| c.arm == "aml_cases" && c.gold == gold && (gold == 1 || c.rule_id == "R-FANIN-7D")).unwrap().base_id.clone();
    let ids = [pick(0), pick(1)];
    let cases: Vec<data::AmlCase> = all.into_iter().filter(|c| ids.contains(&c.base_id)).collect();
    let dir = results.join("demo");
    let label = |r: &Value| r["answer"].as_u64().map_or("none", |a| LABELS[a as usize]);
    println!("1-2  cases: laundering {} (fan-in) and clean {}; case file = subgraph, signed features, KYC", ids[0], ids[1]);
    let by_cond: Vec<(String, Vec<Value>)> = ["C2", "C5"].iter().map(|c| (c.to_string(), run_cond(&cases, c, opts, &dir, 2))).collect();
    let get = |cond: &str, arm: &str, base: &str| by_cond.iter().find(|(c, _)| c == cond).unwrap().1.iter().find(|r| r["arm"] == arm && r["base_id"] == base).cloned().unwrap();
    let file = dir.join("events").join(format!("C5_{}", opts.tag("C5"))).join(format!("aml_cases_{}.json", ids[0].replace(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-', "_")));
    let f: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    let mut events: Vec<trust::Event> = serde_json::from_value(f["events"].clone()).unwrap();
    println!("3    stages (C5, laundering case):");
    for e in &events {
        match e.kind.as_str() {
            "phase" => println!("       phase -> {}", e.payload["phase"].as_str().unwrap_or("")),
            "system" => println!("       {}", e.payload["text"].as_str().unwrap_or("")),
            _ => {}
        }
    }
    let r = get("C5", "aml_cases", &ids[0]);
    println!("4    kill investigator -> resumed with clock intact: {}", r["crash_resume_ok"]);
    let fz = get("C5", "aml_forged", &ids[0]);
    println!("5    inject fake invoice -> E7 UNATTESTED; C2 decides {}, C5 decides {} (truth: file_sar)", label(&get("C2", "aml_forged", &ids[0])), label(&fz));
    for id in &ids {
        println!("6    swap nationality on {id}: C2 {} -> {}, C5 {} -> {}", label(&get("C2", "aml_cases", id)), label(&get("C2", "aml_swap", id)),
                 label(&get("C5", "aml_cases", id)), label(&get("C5", "aml_swap", id)));
    }
    println!("7    verify certificate:");
    print_audit(&events);
    if let Some(e) = events.iter_mut().find(|e| e.kind == "argument") {
        e.payload["body"]["text"] = json!("I never said that.");
    }
    println!("     tamper one argument, verify again:");
    print_audit(&events);
    println!("events for the frontend: {}", file.display());
    if opts.mock {
        println!("NOTE: mock jurors with planted flaws. This shows the pipeline works, not that any model behaves this way.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use trust::*;

    #[test]
    fn spec_vectors_and_trust_layer() {
        // SPEC §10 parse vectors
        let p = |t: &str, n| workflow::parse(t, n).0;
        assert_eq!(p(r#"{"answer": "B", "confidence": 0.9}"#, 3), Some(1));
        assert_eq!(p("```json\n{\"answer\":\"c\"}\n```", 3), Some(2));
        assert_eq!(p("A.", 3), Some(0));
        assert_eq!(p(r#"{"answer": "D"}"#, 3), None);
        assert_eq!(p("I think A or B", 3), None);
        // SPEC §10 stats vectors
        assert_eq!(score::mcnemar(10, 0), 0.001953125);
        assert_eq!(score::mcnemar(0, 0), 1.0);
        let h = score::holm(&[0.01, 0.04, 0.03]);
        assert!((h[0] - 0.03).abs() < 1e-12 && (h[1] - 0.06).abs() < 1e-12 && (h[2] - 0.06).abs() < 1e-12);

        // canonical JSON matches crypto.ts (sorted keys, no spaces, 1.0 -> 1, non-ASCII literal)
        assert_eq!(canonical(&json!({"b": 1.0, "a": [0.7, "José"], "c": null})), r#"{"a":[0.7,"José"],"b":1,"c":null}"#);
        // oracle key = eval/oracle.py's key (same seed)
        assert_eq!(oracle_key().pub_hex().len(), 64);
        let ev = attest(&oracle_key(), "case", "E1", "fetch", "src", "excerpt", 1);
        assert!(evidence_ok(&ev, &oracle_key().pub_hex()));
        let mut bad = ev.clone();
        bad.body["excerpt"] = json!("edited");
        assert!(!evidence_ok(&bad, &oracle_key().pub_hex()));

        // Clerk refuses early reveals and early #context reads
        let mut clerk = actors::Clerk::default();
        clerk.open_commit(2);
        let c0 = actors::commitment("0", "n0");
        assert!(clerk.read_context("a").is_err());
        clerk.commit("a", &c0).unwrap();
        assert!(clerk.read_context("a").is_ok());
        assert!(clerk.reveal("a", "0", "n0").is_err() && clerk.open_reveal().is_err());
        clerk.commit("b", &actors::commitment("1", "n1")).unwrap();
        clerk.open_reveal().unwrap();
        assert!(clerk.reveal("a", "0", "n0").is_ok() && clerk.reveal("a", "1", "n0").is_err());

        // End to end on generated data with mock jurors: every C5 certificate verifies, every tamper is caught,
        // crashes resume with identical state, and the scorer runs.
        let (txs, kind, linked) = data::generate(7);
        let cases = data::build(&txs, &kind, &linked, 6, 7);
        assert_eq!(cases.len(), 18);
        let dir = std::env::temp_dir().join(format!("sv-aml-test-{}", std::process::id()));
        let opts = Opts { mock: true, provider: "anthropic".into(), rounds: 2, relay: false };
        for cond in ["C0", "C1", "C2", "C5"] {
            let rows = run_cond(&cases, cond, &opts, &dir, 4);
            assert!(rows.iter().all(|r| !r["answer"].is_null()), "{cond}: {:?}", rows.iter().find(|r| r["answer"].is_null()));
            if cond != "C0" && cond != "C1" {
                assert!(rows.iter().all(|r| r["certificate_verified"] == true && r["tamper_detected"] == true && r["deadline_met"] == true));
                assert!(rows.iter().all(|r| r["crash_resume_ok"] != false));
            }
            if cond == "C5" {
                assert!(rows.iter().all(|r| r["early_reveal_rejected"] == true));
            }
        }
        let res = score::score(&dir, "mock");
        assert_eq!(res["meta"]["SYNTHETIC"], true);
        assert!(res["per_condition"]["C5_mock"]["accuracy"]["est"].is_number());
        let _ = fs::remove_dir_all(dir);
    }
}
