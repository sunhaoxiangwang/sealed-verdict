"""C0 (one call, T=0) and C1 (5 samples at T=0.7, majority, ties -> earliest sample).

python baselines.py --provider anthropic --model <id> --conds C0,C1 [--limit 10 --smoke]
"""
import argparse, json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import providers as P

HERE = Path(__file__).parent
BASELINE_ARMS = {"bbq_amb", "bbq_dis", "bbq_amb_lead", "pos_bias", "tqa_forged"}  # bbq_byz needs a jury


def load_cases(smoke=False, limit=None, arms=None):
    rows = [json.loads(l) for l in (HERE / "data" / ("smoke.jsonl" if smoke else "cases.jsonl")).open()]
    rows = [c for c in rows if not arms or c["arm"] in arms]
    if limit:  # first `limit` per arm
        seen = Counter()
        rows = [c for c in rows if seen.update([c["arm"]]) or seen[c["arm"]] <= limit]
    return rows


def run_case(prov, case, cond):
    n_opt = len(case["prompt"]["options"])
    temp, k = (0.0, 1) if cond == "C0" else (0.7, 5)
    samples, error = [], None
    try:
        for s in range(k):
            samples.append(P.parse(prov.complete(P.SYSTEM, P.render(case) + "\n\n" + P.JSON_SPEC, temp, s), n_opt)[0])
    except Exception as e:  # recorded, not cached -> retried on rerun
        error = repr(e)[:300]
    valid = [a for a in samples if a is not None]
    if valid:
        top = max(Counter(valid).values())
        answer = next(a for a in valid if Counter(valid)[a] == top)  # tie -> earliest sample
    else:
        answer = None
    return {"case_id": case["case_id"], "condition": cond, "answer": answer, "samples": samples,
            "provider": prov.name, "model": prov.model, "error": error}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", required=True, choices=list(P.PROVIDERS))
    ap.add_argument("--model")
    ap.add_argument("--conds", default="C0,C1")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--smoke", action="store_true", help="use data/smoke.jsonl (outside the sample)")
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    prov = P.get(a.provider, a.model)
    cases = load_cases(a.smoke, a.limit, BASELINE_ARMS)
    out_dir = HERE / ("results_smoke" if a.smoke else "results")
    out_dir.mkdir(exist_ok=True)
    for cond in a.conds.split(","):
        with ThreadPoolExecutor(a.workers) as ex:
            rows = list(ex.map(lambda c: run_case(prov, c, cond), cases))
        path = out_dir / f"verdicts_{cond}_{a.provider}.jsonl"
        path.write_text("".join(json.dumps(r) + "\n" for r in rows))
        bad = sum(r["answer"] is None for r in rows)
        print(f"{path.name}: {len(rows)} verdicts, {bad} failed, model={prov.model}")


if __name__ == "__main__":
    main()
