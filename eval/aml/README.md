# eval/aml: the AML case-review eval, in Rust

Runs each alert through the six stages of `Sealed Verdict AML Case Review.md` (alert, L1 triage, investigation and RFI, panel, four-eyes, lookback) under the same C0 to C5 ladder as the BBQ eval. Then it scores the results.

```bash
cd eval/aml
cargo test --release                       # SPEC §10 vectors, Clerk gate, crash resume, end-to-end mock run
cargo run --release -- build               # data/aml/cases.jsonl: 200 alerts x 3 arms
cargo run --release -- run                 # mock jurors, all six conditions -> results/aml/verdicts_*.jsonl
cargo run --release -- score               # results/aml/results.json + results_table.md
cargo run --release -- demo                # the 7-step demo on one laundering and one clean case
cargo run --release -- verify <events.json>   # or: serve --port 8787, then POST /verify

# real models, through eval/providers.py (FFI via pyo3; same keys, cache and models as the BBQ eval)
PYO3_PYTHON=python3 cargo run --release --features py -- run --backend py --provider anthropic --limit 10
# panel on Agent Relay (PR #1): needs apps/jurors installed, or SV_JURORS_DIR
PYO3_PYTHON=python3 cargo run --release --features py -- run --backend py --panel relay --cond C5 --limit 5
```

**Data.** `build --ibm-trans HI-Small_Trans.csv --ibm-patterns HI-Small_Patterns.txt` reads [IBM AML-Data](https://github.com/IBM/AML-Data). Without those flags it generates seeded transactions in the same format. The generator plants fan-in, fan-out and cycle laundering patterns, plus clean accounts that trip the same rules: merchants, payroll, and sweeps between a customer's own accounts. The same monitoring rules then pick the alerts. Arms: `aml_cases` (gold = laundering), `aml_swap` (only the name and country change), `aml_forged` (adds an unsigned invoice). The BBQ Nationality headline stays in the Python pipeline.

**Conditions.** C0/C1: one model sees the full file. C2: triage, then an open sequential panel. C3: adds blind triage (it commits before `#context` opens) and a commit-reveal panel. C4: adds identity masking, pseudonyms and mixed providers. C5: adds oracle tags (UNATTESTED carries zero weight) and a signed 3-of-4 quorum. All jury conditions run the same actors and ledger.

**Metrics.** `recall_at_fpr5`, recall, FPR, accuracy, `swap_disagreement`, `forged_acceptance` and herding, with paired bootstrap CIs, exact McNemar and Holm (H1 to H3 in `src/score.rs`). Trust checks are recorded for every case: certificate verifies, tamper detected, crash resume, early reveal refused, deadline met. Mock runs are marked SYNTHETIC; never report them.

| Piece | File | Swap point |
|---|---|---|
| Durable actors: AlertCase (Clerk, Ledger, SAR clock), Juror (keypair, nonce, sealed vote) | `src/actors.rs` | `Store` is one JSON file per actor. Replace it with the Durable Actors SDK. |
| Oracle, ledger, certificate, verify | `src/trust.rs` | Demo keys come from public seeds. The oracle seed is the same as `oracle.py`'s. Replace them with the key registry. |
| Signature format | `src/trust.rs` | Byte-compatible with `apps/web/src/protocol/crypto.ts` (PR #2). Event files load into the courtroom and `audit.ts`. |
| Python agent layer | `../aml_agent.py` | `complete`, `model`, `relay_panel` (PR #1) |

**Caveats.**
- The human officer is simulated and countersigns the panel's decision.
- `recall_at_fpr5` is coarse for C0, whose score is 0 or 1.
- In C2 and C3, swap disagreement includes T=0.7 sampling noise. C4 and C5 see identical prompts across a swap pair, so their disagreement is exactly 0. Add a re-sampled `aml_cases` arm if you need the noise floor.
- Add H1 to H3 to `PREREGISTRATION.md` before a real run.
