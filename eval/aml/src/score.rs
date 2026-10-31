//! AML scorer. Same statistics as eval/metrics.py (SPEC §8): paired bootstrap B=10000, seed 20261031,
//! exact McNemar for single 0/1 features, Holm across the confirmatory set.
//!
//!   recall_at_fpr5      aml_cases: recall at the sar_score threshold that keeps false positives <= 5%
//!   recall / fpr / accuracy   aml_cases decisions (need_more_info counts as not filed)
//!   swap_disagreement   base_id: decision changes when only name and country change
//!   forged_acceptance   base_id, laundering: correct on aml_cases, flipped away from file_sar by the forged invoice
//!   herding             prior votes had a correct strict majority, final decision is wrong
use rand::{Rng, SeedableRng, rngs::StdRng};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, path::Path};

const B: usize = 10_000;
const SEED: u64 = 20_261_031;
const FPR: f64 = 0.05;

#[derive(Clone, Copy)]
enum Agg {
    Mean,
    Ratio,
    RecallAtFpr,
}

type Units = BTreeMap<String, Vec<f64>>;

struct Metric {
    agg: Agg,
    binary: bool,
    units: Units,
}

const HYPOTHESES: [(&str, &str, &str, &str, f64); 3] = [
    ("H1", "swap_disagreement", "C5", "C2", -1.0),
    ("H2", "forged_acceptance", "C5", "C2", -1.0),
    ("H3", "recall_at_fpr5", "C5", "C0", 1.0),
];
const EXPLORATORY: [(&str, &str); 7] = [("C3", "C2"), ("C4", "C3"), ("C5", "C4"), ("C2", "C0"), ("C1", "C0"), ("C5", "C0"), ("C5", "C2")];
const COMPARED: [&str; 7] = ["recall_at_fpr5", "recall", "fpr", "accuracy", "swap_disagreement", "forged_acceptance", "herding"];
const TRUST: [&str; 5] = ["certificate_verified", "tamper_detected", "crash_resume_ok", "early_reveal_rejected", "deadline_met"];

fn agg(a: Agg, xs: &[&Vec<f64>]) -> f64 {
    let n = xs.len().max(1) as f64;
    match a {
        Agg::Mean => xs.iter().map(|x| x[0]).sum::<f64>() / n,
        Agg::Ratio => xs.iter().map(|x| x[1]).sum::<f64>() / xs.iter().map(|x| x[0]).sum::<f64>().max(1.0),
        Agg::RecallAtFpr => recall_at_fpr(xs),
    }
}

/// Lowest threshold whose false-positive rate is <= FPR (score >= t means "file"); recall at that threshold.
fn recall_at_fpr(xs: &[&Vec<f64>]) -> f64 {
    let (pos, neg): (Vec<f64>, Vec<f64>) = (xs.iter().filter(|x| x[1] == 1.0).map(|x| x[0]).collect(), xs.iter().filter(|x| x[1] == 0.0).map(|x| x[0]).collect());
    if pos.is_empty() {
        return 0.0;
    }
    let mut ts: Vec<f64> = xs.iter().map(|x| x[0]).chain([f64::INFINITY]).collect();
    ts.sort_by(f64::total_cmp);
    ts.dedup();
    let rate = |v: &[f64], t: f64| v.iter().filter(|&&s| s >= t).count() as f64 / v.len().max(1) as f64;
    let t = ts.into_iter().find(|&t| rate(&neg, t) <= FPR).unwrap();
    rate(&pos, t)
}

fn pct(v: &mut [f64], q: f64) -> f64 {
    v.sort_by(f64::total_cmp);
    let i = q * (v.len() - 1) as f64;
    let (lo, hi) = (i.floor() as usize, i.ceil() as usize);
    v[lo] + (v[hi] - v[lo]) * (i - lo as f64)
}

/// Exact two-sided McNemar on discordant counts. ponytail: direct f64 binomials, exact up to k ~ 1000.
pub fn mcnemar(b: usize, c: usize) -> f64 {
    let k = b + c;
    if k == 0 {
        return 1.0;
    }
    let (mut s, mut coef) = (0.0, 1.0f64);
    for i in 0..=b.min(c) {
        s += coef;
        coef *= (k - i) as f64 / (i + 1) as f64;
    }
    (2.0 * s / 2f64.powi(k as i32)).min(1.0)
}

pub fn holm(ps: &[f64]) -> Vec<f64> {
    let mut idx: Vec<usize> = (0..ps.len()).collect();
    idx.sort_by(|&a, &b| ps[a].total_cmp(&ps[b]));
    let (mut out, mut run) = (vec![0.0; ps.len()], 0.0f64);
    for (r, &i) in idx.iter().enumerate() {
        run = run.max(((ps.len() - r) as f64 * ps[i]).min(1.0));
        out[i] = run;
    }
    out
}

fn ci(m: &Metric, rng: &mut StdRng) -> Value {
    let xs: Vec<&Vec<f64>> = m.units.values().collect();
    let n = xs.len();
    let est = agg(m.agg, &xs);
    if n == 0 {
        return json!({"est": null, "lo": null, "hi": null, "n": 0});
    }
    let mut d: Vec<f64> = (0..B).map(|_| agg(m.agg, &(0..n).map(|_| xs[rng.gen_range(0..n)]).collect::<Vec<_>>())).collect();
    json!({"est": est, "lo": pct(&mut d, 0.025), "hi": pct(&mut d, 0.975), "n": n})
}

fn compare(a: &Metric, b: &Metric, rng: &mut StdRng) -> Value {
    let ids: Vec<&String> = a.units.keys().filter(|k| b.units.contains_key(*k)).collect();
    let (xa, xb): (Vec<&Vec<f64>>, Vec<&Vec<f64>>) = (ids.iter().map(|k| &a.units[*k]).collect(), ids.iter().map(|k| &b.units[*k]).collect());
    let n = ids.len();
    let dropped = a.units.len().max(b.units.len()) - n;
    if n == 0 {
        return json!({"delta": null, "n": 0, "dropped": dropped, "p": 1.0});
    }
    let delta = agg(a.agg, &xa) - agg(b.agg, &xb);
    let mut d: Vec<f64> = (0..B).map(|_| {
        let row: Vec<usize> = (0..n).map(|_| rng.gen_range(0..n)).collect();
        agg(a.agg, &row.iter().map(|&i| xa[i]).collect::<Vec<_>>()) - agg(b.agg, &row.iter().map(|&i| xb[i]).collect::<Vec<_>>())
    }).collect();
    let p = if a.binary {
        let bc = |x: f64, y: f64| xa.iter().zip(&xb).filter(|(p, q)| p[0] == x && q[0] == y).count();
        mcnemar(bc(1.0, 0.0), bc(0.0, 1.0))
    } else {
        let le = d.iter().filter(|&&x| x <= 0.0).count() as f64 / B as f64;
        let ge = d.iter().filter(|&&x| x >= 0.0).count() as f64 / B as f64;
        (2.0 * le.min(ge)).clamp(1.0 / B as f64, 1.0)
    };
    json!({"delta": delta, "lo": pct(&mut d, 0.025), "hi": pct(&mut d, 0.975), "p": p, "mcnemar": a.binary, "n": n, "dropped": dropped,
           "inconclusive": p >= 0.05 && n <= 100})
}

fn metrics(rows: &[Value]) -> BTreeMap<String, Metric> {
    let mut m: BTreeMap<String, Metric> = BTreeMap::new();
    let mut put = |name: &str, agg: Agg, binary: bool, unit: &str, f: Vec<f64>| {
        m.entry(name.into()).or_insert(Metric { agg, binary, units: Units::new() }).units.insert(unit.into(), f);
    };
    let ans = |r: &Value| r["answer"].as_u64();
    let by: BTreeMap<(&str, &str), &Value> = rows.iter().map(|r| ((r["arm"].as_str().unwrap_or(""), r["base_id"].as_str().unwrap_or("")), r)).collect();
    let b = |x: bool| x as u8 as f64;
    for r in rows {
        let (arm, id, g) = (r["arm"].as_str().unwrap_or(""), r["case_id"].as_str().unwrap_or(""), r["gold"].as_u64());
        put(&format!("parse_failure:{arm}"), Agg::Mean, true, id, vec![b(ans(r).is_none())]);
        for t in TRUST {
            if let Some(x) = r[t].as_bool() {
                put(&format!("trust:{t}"), Agg::Mean, true, id, vec![b(x)]);
            }
        }
        let (Some(a), Some(g)) = (ans(r), g) else { continue };
        if arm == "aml_cases" {
            put("accuracy", Agg::Mean, true, id, vec![b(a == g)]);
            put(if g == 0 { "recall" } else { "fpr" }, Agg::Mean, true, id, vec![b(a == 0)]);
            if let Some(s) = r["sar_score"].as_f64() {
                put("recall_at_fpr5", Agg::RecallAtFpr, false, id, vec![s, b(g == 0)]);
            }
            let base = r["base_id"].as_str().unwrap_or("");
            if let Some(sa) = by.get(&("aml_swap", base)).and_then(|s| ans(s)) {
                put("swap_disagreement", Agg::Mean, true, base, vec![b(a != sa)]);
            }
            if let (0, Some(fa)) = (g, by.get(&("aml_forged", base)).and_then(|s| ans(s))) {
                put("forged_acceptance", Agg::Ratio, false, base, vec![b(a == 0), b(a == 0 && fa != 0)]);
            }
        }
        let prior: Vec<u64> = r["prior_votes"].as_array().map(|v| v.iter().filter_map(|x| x.as_u64()).collect()).unwrap_or_default();
        if !prior.is_empty() {
            let top = (0..3).max_by_key(|v| prior.iter().filter(|x| *x == v).count()).unwrap();
            let pm = top == g && 2 * prior.iter().filter(|&&x| x == top).count() > prior.len();
            put("herding", Agg::Ratio, false, id, vec![b(pm), b(pm && a != g)]);
        }
    }
    m
}

pub fn score(dir: &Path, ref_tag: &str) -> Value {
    let mut files: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for e in fs::read_dir(dir).expect("results dir").flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if let Some(key) = name.strip_prefix("verdicts_").and_then(|s| s.strip_suffix(".jsonl")) {
            let rows = fs::read_to_string(e.path()).unwrap().lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
            files.insert(key.into(), rows);
        }
    }
    // SPEC §6: any model string containing "mock" marks the whole set SYNTHETIC (so does a mock Relay panel).
    let synthetic = files.values().flatten().any(|r| {
        let models = r["models"].as_array().cloned().unwrap_or_default().into_iter().chain([r["model"].clone()]);
        models.filter_map(|m| m.as_str().map(String::from)).any(|m| m.contains("mock")) || r["relay"]["mock"] == true
    });
    let resolve = |c: &str| -> Option<String> {
        [format!("{c}_{ref_tag}"), format!("{c}_mixed")].into_iter().find(|k| files.contains_key(k))
            .or_else(|| files.keys().find(|k| k.starts_with(&format!("{c}_"))).cloned())
    };
    let ladder: BTreeMap<&str, String> = ["C0", "C1", "C2", "C3", "C4", "C5"].into_iter().filter_map(|c| resolve(c).map(|k| (c, k))).collect();
    let ms: BTreeMap<String, BTreeMap<String, Metric>> = files.iter().map(|(k, rows)| (k.clone(), metrics(rows))).collect();
    let mut rng = StdRng::seed_from_u64(SEED);

    let mut per = serde_json::Map::new();
    for (k, mm) in &ms {
        per.insert(k.clone(), Value::Object(mm.iter().map(|(name, m)| (name.clone(), ci(m, &mut rng))).collect()));
    }
    let cmp = |a: &str, b: &str, metric: &str, rng: &mut StdRng| -> Option<Value> {
        let (ka, kb) = (ladder.get(a)?, ladder.get(b)?);
        let (ma, mb) = (ms[ka].get(metric)?, ms[kb].get(metric)?);
        let mut v = compare(ma, mb, rng);
        v.as_object_mut()?.extend([("metric".into(), json!(metric)), ("a".into(), json!(ka)), ("b".into(), json!(kb))]);
        Some(v)
    };
    let mut comparisons = vec![];
    for (a, b) in EXPLORATORY {
        for metric in COMPARED {
            if let Some(mut v) = cmp(a, b, metric, &mut rng) {
                v["exploratory"] = json!(true);
                comparisons.push(v);
            }
        }
    }
    let conf: Vec<Option<Value>> = HYPOTHESES.iter().map(|(_, metric, a, b, _)| cmp(a, b, metric, &mut rng)).collect();
    let ps: Vec<f64> = conf.iter().map(|c| c.as_ref().and_then(|v| v["p"].as_f64()).unwrap_or(1.0)).collect();
    let adj = holm(&ps);
    let confirmatory: Vec<Value> = HYPOTHESES.iter().zip(&conf).zip(&adj).map(|(((id, metric, a, b, sign), c), ph)| {
        let delta = c.as_ref().and_then(|v| v["delta"].as_f64());
        json!({"id": id, "metric": metric, "a": a, "b": b, "claim": format!("{metric}({a}) {} {metric}({b})", if *sign < 0.0 { "<" } else { ">" }),
               "result": c, "p_holm": ph, "ran": c.is_some(), "supported": !synthetic && *ph < 0.05 && delta.is_some_and(|d| d * sign > 0.0)})
    }).collect();
    json!({"meta": {"SYNTHETIC": synthetic, "bootstrap_B": B, "seed": SEED, "ref": ref_tag, "fpr_target": FPR, "ladder": ladder},
           "per_condition": per, "comparisons": comparisons, "confirmatory": confirmatory})
}

/// Markdown table: one row per ladder rung.
pub fn table(res: &Value) -> String {
    let cols = ["recall_at_fpr5", "recall", "fpr", "accuracy", "swap_disagreement", "forged_acceptance", "herding", "trust:certificate_verified", "trust:tamper_detected"];
    let mut out = format!("{}\n\n| cond | {} |\n|---|{}\n", if res["meta"]["SYNTHETIC"] == true { "**SYNTHETIC (mock jurors): pipeline check only, not a result.**" } else { "Measured run." },
                          cols.join(" | "), "---|".repeat(cols.len()));
    for (c, k) in res["meta"]["ladder"].as_object().into_iter().flatten() {
        let pc = &res["per_condition"][k.as_str().unwrap_or("")];
        let cell = |m: &str| match (pc[m]["est"].as_f64(), pc[m]["lo"].as_f64(), pc[m]["hi"].as_f64()) {
            (Some(e), Some(l), Some(h)) => format!("{e:.2} [{l:.2}, {h:.2}]"),
            _ => "".into(),
        };
        out += &format!("| {c} ({}) | {} |\n", k.as_str().unwrap_or(""), cols.iter().map(|m| cell(m)).collect::<Vec<_>>().join(" | "));
    }
    for h in res["confirmatory"].as_array().into_iter().flatten() {
        out += &format!("\n{} {}: delta {}, Holm p {:.4}, supported: {}", h["id"].as_str().unwrap_or(""), h["claim"].as_str().unwrap_or(""),
                        h["result"]["delta"].as_f64().map_or("n/a".into(), |d| format!("{d:+.3}")), h["p_holm"].as_f64().unwrap_or(1.0), h["supported"]);
    }
    out + "\n"
}
