# Sealed Verdict

## Live AML demo (real providers, Relay, hosted Terse, Rust, browser)

Run `pnpm demo:setup` once, then `pnpm demo:live` and open
**http://localhost:8090**. Click **Run AML case**, then **Conclusion** →
**Verify with Rust/WASM**. `pnpm demo:check` verifies the completed run and
confirms that editing an argument breaks verification.

For recording, use **Download example case** or save
[td-bank-public-case.json](demo/data/td-bank-public-case.json), select it with
**Upload case (JSON)**, then click **Run AML case**. The screen displays the
input evidence and a plain-language conclusion with the final agents' supporting
judgment. Uploaded JSON uses the example's schema; evidence excerpts are limited
to 240 characters each so the protocol admits them without truncation.

Keys are read server-side from `.env`: `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`ANTHROPIC_API_KEY`, `TERSE_API_KEY`. Set `TERSE_ACTOR_URL` to your deployed
CaseActor endpoint; a machine-specific `.env.live` may hold that endpoint.
Without a hosted endpoint the launcher starts the real local Terse runtime.
Relay runs locally unless `RELAY_BASE_URL` and `RELAY_WORKSPACE_KEY` are set.

The input is [a real public DOJ AML case](demo/data/td-bank-public-case.json):
TD Bank's nominee-account cash network. It contains sourced aggregate facts,
not synthetic transactions or private bank records. Python calls OpenAI for
triage, Gemini for investigation/RFI gaps, and a four-juror panel spanning
OpenAI, Gemini and Anthropic. Every panel message travels through Relay;
the Rust Clerk admits it and Terse persists it. Phases close when all required
messages are admitted, or at the deadline. The browser reads persisted state
and verifies the original bundle with the Rust WASM verifier. Failed API calls
stop the run; no mock fallback exists. Human review remains pending and no SAR
is filed. Existing synthetic experiments remain separate from this demo.

Defaults: `gpt-5-mini`, `gemini-3.5-flash-lite`, `claude-haiku-4-5-20251001`.
Override with `OPENAI_MODEL`, `GEMINI_MODEL`, `ANTHROPIC_MODEL`.

For **SuperServe**, install its CLI (`curl -fsSL https://superserve.ai/install | sh`),
set `SUPERSERVE_API_KEY` in `.env` (or run `superserve login`), then
`pnpm demo:superserve`. A repository-local install
at `.runtime/bin/superserve` is also supported. The deployment command packages
the app, builds its Rust executable and frontend in a new sandbox, passes only the required
runtime environment, and publishes port 8090 privately. It prints the command
to open a signed browser URL. A hosted Terse endpoint is required. See the
[official CLI documentation](https://docs.superserve.ai/cli) for authentication.

**Supabase location:** the private Storage bucket `sealed-verdict` in your
`VITE_SUPABASE_URL` project. `cases/<caseId>.json` contains the completed case,
original certificate, transcript and provider metadata; `latest.json` makes
the last completed case available immediately after a fresh deployment.
The backend uses `SUPABASE_API_KEY`; the browser reads through `/api/aml` and
never receives that secret. Terse remains the live protocol state; Supabase
archives completed cases. No public storage policy or database migration is
needed. `VITE_SUPABASE_ANON_KEY` is the public client credential, not a server key.

**SuperServe location:** a sandbox named `sealed-verdict-<runId>`, with the
application in `/home/user/sealed-verdict` and the workflow server listening on
port 8090. Only its private preview port is published. The sandbox pauses
after one hour; resume it with `superserve sandbox resume <name>`.

Multi-agent debate can let jurors anchor on each other’s judgments. Sealed
Verdict runs LLM jurors as a tribunal under a commit-reveal protocol, carries
every message over Agent Relay, keeps each case's state in a Terse durable
actor, and ships every verdict with a certificate that anyone can verify
offline, in Rust or in the browser through the same WebAssembly verifier.

## Recording evidence for the judging rubric

The [recording plan and presenter script](demo/RECORDING.md) map every criterion
to visible evidence. The live AML recording uses one case ID throughout;
shortened model waits are labelled in the edited version.

### Use of Real-Time AI and Track Technology (20%)

The Python workflow calls OpenAI for triage, Gemini for investigation, and
four jurors spanning OpenAI, Gemini and Anthropic for the panel. It never
falls back to mock votes. Agent Relay carries encrypted ballot intents,
evidence envelopes, commitments, reveals, arguments, phase announcements and
the certificate. The Rust Clerk admits messages received from Relay. Hosted
Terse stores the registry, phase, transcript and certificate; every admitted
entry and transition is persisted before the bridge proceeds. The recording
shows live model responses, phase changes and actual backend counters.
SuperServe hosts the connected application; Supabase privately archives the
completed bundle. Hosted Terse and the deployed frontend have been exercised
with real-model AML ballots.

### Originality and Creativity (20%)

The distinctive mechanism is independent judgment before discussion. Jurors
commit to hidden ballots, reveal after a signed phase close, publish their
initial evidence-based reasoning, and reassess after seeing peer arguments.
Encrypted intents prevent the local Relay engine's searchable DM bodies from
exposing ballot contents. A signed transcript and replayable certificate
make protocol compliance independently checkable. The recording shows this
mechanism; it does not claim that one case establishes reduced bias.

### Execution and Demo (20%)

A fresh run starts from documented public DOJ AML facts, obtains real model
responses, transports panel messages over Relay, persists state in Terse,
and produces a Rust-verified certificate. The recording follows the same
case through the frontend and backend. The browser's Rust/WASM verifier
passes the original, rejects an edited argument, and passes the restored
original. `pnpm demo:check` independently checks four final ballots, provider
participation, admission errors, certificate validity and tamper rejection.
Older scripted fixtures and synthetic comparisons are separate tests, not
results from the live AML case.

### User Experience and Design (20%)

The courtroom connects abstract protocol steps to visible states: evidence,
sealed commitments, reveals, discussion and verdict. The source is linked,
progress is shown in the phase ribbon and transcript, and one Run button
starts the workflow. Certificate actions verify, tamper with a local copy,
restore the original, and download the complete bundle. Missing credentials
and failed calls appear as errors rather than a fabricated successful run.
The recording demonstrates these actions in the deployed frontend.

### Potential and Impact (20%)

AML reviewers need to understand why an AI system recommended escalation.
The case bundle preserves supplied evidence, signed ballots and the sequence
of protocol decisions for review. The public enforcement case demonstrates
that workflow without inventing private transactions or customer responses.
Private bank-data intake and authenticated human sign-off are proposed next
steps. Human review remains pending in this prototype; it does not file a
SAR. Signatures establish protocol integrity, not factual correctness,
regulatory compliance, improved accuracy or a measured reduction in bias.

## Repository structure and ownership

| Path | Contents | Owner |
| --- | --- | --- |
| `packages/protocol/` | Rust wire types, canonical encoding, Ed25519 signing, commitments, transcript chain, admission engine, certificate verifier, WASM build and JS glue, public fixtures | Leo |
| `apps/actors/` | Rust Clerk, Ledger, Oracle, juror signing shell, scripted runner, live `clerk_daemon`; `bridge/` Node glue for Agent Relay transport, sealed intents, and the Terse case actor | Leo |
| `apps/jurors/` | LLM jurors on Agent Relay for conditions C2 to C5: TypeScript runner, CLI, Python entry point, quickstart and permission probe | Rikin |
| `eval/` | Preregistered benchmark: data preparation, C0/C1 baselines, jury runs, scorer, plots, spec | Cheng Yao Lee (data science) |
| `apps/web/` | Courtroom, certificate verify/tamper page, C2-vs-C5 replay, results ladder | Dan (frontend) |
| `docs/` | `core.md` protocol specification and known limits, `handoff.md` backend handoff | Leo |

The backend (`packages/protocol`, `apps/actors`) is the reference for the wire
contract and verification; the other tracks were merged on top of it in the
order jurors, evaluation, frontend. Two live Relay paths exist today: the
backend bridge, which drives the Rust Clerk and produces verifiable
certificates, and the jurors runner in `apps/jurors`, which implements its own
C2 to C5 flow in TypeScript for the evaluation runs. They share the Agent Relay
workspace and the condition definitions but not code; unifying them is open
work.

## Prerequisites

- Backend: Rust 1.85 or newer with the `wasm32-unknown-unknown` target,
  `wasm-bindgen-cli` 0.2.128, Node 22 or newer, pnpm (`pnpm install` at the
  root links the workspace). Live mode adds Bun 1.4.2 or newer with
  `terse-cli` 0.14.9 (`bunx terse-cli@0.14.9 install`).
- Jurors: Node 22 or newer; `cd apps/jurors && npm install`. Without
  `OPENAI_API_KEY` the jurors are scripted mocks and their verdicts carry
  `mock: true`; numbers from mock runs are never reported.
- Evaluation: Python 3 with `pip3 install -r eval/requirements.txt`. Read and
  commit `eval/PREREGISTRATION.md` before any real run.
- Frontend: `cd apps/web && npm install --legacy-peer-deps`. The frontend does
  not need a Rust toolchain; the generated WASM package under
  `packages/protocol/wasm/pkg` is committed.

## Commands

| Task | Command |
| --- | --- |
| Protocol tests | `cargo test --manifest-path packages/protocol/Cargo.toml` |
| Actor and daemon tests | `cargo test --manifest-path apps/actors/Cargo.toml` |
| Run one in-memory case | `cargo run --manifest-path apps/actors/Cargo.toml --bin run_case -- --script 3-1 --condition C3 --out apps/actors/out` |
| Regenerate fixtures | `cargo run --manifest-path apps/actors/Cargo.toml --bin gen_fixtures -- --out packages/protocol/fixtures` |
| Build WASM | `pnpm build:wasm` |
| Native/WASM parity test | `pnpm test:wasm` |
| Live case over Relay and Terse | see Live mode below |
| Jurors quickstart (four agents on one channel plus permission probe) | `cd apps/jurors && npm run quickstart` |
| Jurors condition run | `cd apps/jurors && npx tsx src/cli.ts --condition C2 --in ../../eval/data/items.jsonl --out ../../eval/results/verdicts/C2.jsonl --limit 20` |
| Eval smoke, no keys | `cd eval && python3 baselines.py --provider mock --smoke && for c in C2 C3 C4 C5; do python3 run_relay.py --config configs/$c.yaml --provider mock --smoke; done` |
| Eval scoring and plots | `cd eval && python3 metrics.py && python3 plots.py` |
| Frontend | `cd apps/web && npm run dev` (http://localhost:5173), demo script in `apps/web/README.md` |

`run_case` accepts `--script 3-1`, `2-2`, or `forged`, `--condition C2`
through `C5`, an optional `--case-id`, and writes
`apps/actors/out/<caseId>.json`. The directory is gitignored. The command
exits 1 if the certificate it just produced does not verify.

## Live mode: Agent Relay transport and Terse state

`apps/actors/bridge` runs one live case: the Rust `clerk_daemon` holds every
key and makes every protocol decision; a thin Node bridge moves envelopes over
Agent Relay channels and persists each entry and phase transition to a Terse
durable actor before announcing it. Both services run locally in WP2; hosted
deployment is a later, separately reported step. See docs/core.md for the
command contract, channel names, and trust assumptions.

Prerequisites: Node 22 or newer, pnpm, Bun 1.4.2 or newer with
`terse-cli` 0.14.9 (`bunx terse-cli@0.14.9 install`), and a built daemon
(`cargo build --manifest-path apps/actors/Cargo.toml`).

| Step | Command |
| --- | --- |
| Local Relay engine (Node 26 needs a newer SQLite binding) | `mkdir -p ~/relay-engine && cd ~/relay-engine && npm init -y >/dev/null && npm pkg set overrides.better-sqlite3=13.0.3 && npm i @relaycast/engine@12.3.0 && node node_modules/@relaycast/engine/dist/bin/serve.js --db ./relaycast.db --port 8787` |
| Workspace key (operator step; paste into `.env`, never commit) | `cd apps/actors/bridge && node -e 'import("./src/relay.js").then(async (m) => console.log((await m.createWorkspace({ name: "sealed-verdict" })).workspaceKey))'` |
| Local Terse runtime | `cd apps/actors/bridge/terse && terse actor dev --port 7100` |
| Live scripted case | `cd apps/actors/bridge && RELAY_WORKSPACE_KEY=... node src/run-live.js --script 3-1 --condition C3` (also `2-2`, `forged`; `--timeout-ms`, `--case-id`) |
| Live case with teammate jurors | `node src/run-live.js --live --case-id <id>`; juror tokens are written to `apps/actors/bridge/.tokens/<id>.json` (gitignored) for a private handoff |
| Bridge tests | `pnpm --filter @sealed-verdict/bridge test:relay`, `test:terse`, `node --test test/daemon-client.test.mjs`, and the live acceptance `node --test --test-force-exit --test-timeout=120000 test/live-e2e.mjs` |

Output is the same `apps/actors/out/<caseId>.json` bundle as the in-memory
runner, plus `<caseId>.relay.json` mapping every admitted ledger sequence
number to its Relay message id. Both are staged under `out/.staging/<caseId>`
and exposed only after the certificate verifies natively and Terse has
stored it; if either step fails the run exits non-zero and removes this
case's staged and final files, and nothing is published on the cert channel.

Juror interface for the jurors team: Leo's private handoff file
(`apps/actors/bridge/.tokens/<caseId>.json`) gives each juror its
`agentToken`, its `senderId`, the `clerkName`, and the case
`recipientPublicKey`. Connect with `createAgentClient({ agentToken, baseUrl })`
from `@agent-relay/sdk/messaging`, read phase changes on `sv-<caseId>-phase`
and evidence on `sv-<caseId>-evidence`, and send signing intents as a DM to
the clerk agent. Under C3 to C5 the intent must be sealed with
`sealIntent({ recipientPublicKeyHex, caseId, senderId, intent })` from
`apps/actors/bridge/src/intent-crypto.js` (Node built-in crypto, no
dependencies); plaintext is refused with `intent_not_encrypted`. Intents:
`{ "kind": "commit", "round": 0, "vote": "ans2", "confidence": 70 }`, then
`{ "kind": "reveal", "round": 0 }` once the reveal window opens, and
`{ "kind": "argument", "round": 0, "text": "...", "evidenceIds": ["ev-0"] }`
during deliberation. The bridge replies by DM with `{ ok, kind, round,
messageId }` or `{ ok: false, error: { code } }`. Byzantine jurors may post
raw envelopes directly to the public channels; the Clerk rejects or tags
them. Why sealed: on the local Relay engine any workspace agent can read DM
bodies through search, so plaintext ballots would not be blind. Rejected
public content stays readable and a juror can always announce its own vote;
see docs/core.md for the exact limits.

## Environment variables

Names only; values live in gitignored `.env` files (`.env.example` at the
root, `apps/jurors/.env.local`, `apps/web/.env.example`).

| Track | Names |
| --- | --- |
| Backend live mode | `RELAY_WORKSPACE_KEY`, `RELAY_BASE_URL` (default `http://127.0.0.1:8787`), `TERSE_ACTOR_URL` (default `http://127.0.0.1:7100/v1/projects/local/actors`), `TERSE_API_KEY` (hosted only) |
| Jurors | `OPENAI_API_KEY`, `EVAL_MODEL`, `RELAY_WORKSPACE_KEY` |
| Evaluation | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, optional `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL` |
| Frontend live toggle | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

The in-memory backend runner needs none of them. The Relay workspace key acts
like a password: share it privately and never commit it.

## Fixtures and output walkthrough

Every finished case is one JSON file in the shape the verifier accepts:

```json
{
  "cert": { "body": { "...": "CertBody" }, "sig": "<hex>", "signer": "<ledger pubkey hex>" },
  "transcript": [ { "seq": 0, "ts": 0, "kind": "evidence", "msg": {}, "status": "accepted" } ]
}
```

`packages/protocol/fixtures/` holds three such files plus the expected
verifier output:

| File | What it shows |
| --- | --- |
| `valid_cert.json` | A 3-1 case under C3 (case id `fixture-valid`). Three jurors agree, so the verdict is that answer id and the certificate verifies. |
| `no_quorum_cert.json` | A 2-2 case under C3 (case id `fixture-no-quorum`). No answer reaches three votes, so the verdict is `NO_QUORUM`, and the certificate still verifies. |
| `tampered_cert.json` | `valid_cert.json` with exactly one word changed in the first accepted argument. Signatures and root were left alone, so verification fails with `TRANSCRIPT_ROOT_MISMATCH`. |
| `expected.json` | The native `VerifyReport` for each file above, keyed by file name. The WASM parity test compares against it. |

Fixture keys are generated in memory each time `gen_fixtures` runs and are
never written anywhere. Only public keys, signatures, certificates, and
transcripts are committed, so regenerated fixtures differ byte-for-byte from
the previous set.

Verify a fixture from Node:

```js
import { readFile } from "node:fs/promises";
import { initNode, verifyCert } from "@sealed-verdict/protocol/node";
await initNode();
const cert = JSON.parse(await readFile("packages/protocol/fixtures/valid_cert.json", "utf8"));
console.log(verifyCert(cert)); // { valid: true, failures: [] }
```

In the browser, `import { init, verifyCert } from "@sealed-verdict/protocol"`,
await `init()` once, then call `verifyCert(cert)` synchronously.

A failing report lists every failure the verifier could establish, each
prefixed with a stable code:

```json
{ "valid": false, "failures": ["TRANSCRIPT_ROOT_MISMATCH: recomputed 7f3a..."] }
```

The full code list, the wire contract, the crypto rules, and the known limits
are in [docs/core.md](docs/core.md).
