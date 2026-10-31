"""Call the Agent Relay jury from Python (C2-C5).

    import sys; sys.path.insert(0, "apps/jurors")
    from jurors import run_case, run_condition

    verdict = run_case({"id": "demo-1", "context": "...", "question": "...", "options": ["A", "B", "Unknown"]}, "C5")
    rows = run_condition("C2", "eval/data/items.jsonl", "eval/results/verdicts/C2.jsonl", limit=20)

Needs Node 22+ and `npm install` in apps/jurors once. Set OPENAI_API_KEY (otherwise jurors are scripted mocks)
and RELAY_WORKSPACE_KEY (otherwise a dev workspace is created and saved to apps/jurors/.env.local).
"""
import json
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TSX = HERE / "node_modules" / "tsx" / "dist" / "cli.mjs"


def run_condition(condition, items_path, out_path, limit=None, concurrency=2, rounds=3, models=None):
    """Run every item in a JSONL file under one condition; returns all verdict rows in out_path.

    Finished items are skipped, so calling this again after a crash resumes.
    """
    if not TSX.exists():
        raise RuntimeError(f"run `npm install` in {HERE} first")
    out_path = Path(out_path).resolve()
    cmd = ["node", str(TSX), str(HERE / "src" / "cli.ts"), "--condition", condition,
           "--in", str(Path(items_path).resolve()), "--out", str(out_path),
           "--concurrency", str(concurrency), "--rounds", str(rounds)]
    if limit:
        cmd += ["--limit", str(limit)]
    if models:
        cmd += ["--models", ",".join(models)]
    subprocess.run(cmd, cwd=HERE, check=True)
    with open(out_path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def run_case(item, condition, rounds=3):
    """Run one case dict and return its verdict row (None if the case failed)."""
    with tempfile.TemporaryDirectory() as d:
        items, out = Path(d) / "items.jsonl", Path(d) / "verdicts.jsonl"
        items.write_text(json.dumps(item) + "\n", encoding="utf-8")
        rows = run_condition(condition, items, out, concurrency=1, rounds=rounds)
    return rows[0] if rows else None
