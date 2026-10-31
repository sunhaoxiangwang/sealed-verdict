# eval/

Read `PREREGISTRATION.md` first and commit it before any real run.

```bash
pip3 install -r requirements.txt
python3 prep_data.py   # data/cases.jsonl + data/smoke.jsonl (already committed; rerun is deterministic)

# smoke test, no keys needed
python3 baselines.py --provider mock --smoke
for c in C2 C3 C4 C5; do python3 run_relay.py --config configs/$c.yaml --provider mock --smoke; done
python3 metrics.py --results results_smoke --ref mock && python3 plots.py --results results_smoke

# real run (keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY)
python3 baselines.py --provider anthropic --smoke --limit 10   # live smoke first
python3 baselines.py --provider anthropic --conds C0,C1         # one terminal per provider
python3 baselines.py --provider openai    --conds C0,C1
python3 baselines.py --provider gemini    --conds C0,C1
for c in C2 C3 C4 C5; do python3 run_relay.py --config configs/$c.yaml; done
python3 metrics.py && python3 plots.py   # results/results.json, results_table.md, figs/
```

- Models: defaults are in `providers.DEFAULT_MODELS`. Override them with `--model` or `ANTHROPIC_MODEL`, `OPENAI_MODEL` or `GEMINI_MODEL`. The OpenAI and Gemini defaults are guesses, so check them before running.
- Every call is cached in `.cache/` by (provider, model, temperature, system, user, sample index). Reruns resume where they stopped, and failed calls are retried.
- Relay: `run_relay.py --backend relay --relay-cmd "<cmd>"` pipes `{"case", "config"}` to the command on stdin and reads one verdict JSON from stdout.
- `metrics.py` copies results.json to `apps/web/public/` only when the run is real (not SYNTHETIC).
