# Sealed Verdict

Multi-agent debate makes LLM bias worse: jurors read each other and herd. Sealed
Verdict runs LLM jurors as a tribunal under a commit-reveal protocol, carries
every message over Agent Relay, keeps each case's state in a Terse durable
actor, and ships every verdict with a certificate that anyone can verify
offline, in Rust or in the browser through the same WebAssembly verifier.

## How it maps to the judging criteria

**Real-time AI and the Terse and Agent Relay tracks.** Every protocol message
of a live case is an Agent Relay message: Oracle evidence, sealed commitments,
reveals, arguments, Clerk phase markers, and the final certificate each travel
on a per-case channel (`sv-<caseId>-*`) in real time, and jurors submit their
ballots as private Relay DMs to the Clerk agent. Each case is a Terse durable
actor that stores the registry, the open phase and its deadline, every ledger
entry, and the final certificate as the case runs, so jurors and the frontend
read live state from Terse rather than from the process that produced it. The
Rust Clerk admits only what it receives from Relay and persists to Terse before
announcing a phase. Both integrations are verified against local Relay and
Terse runtimes; hosted operation is not yet verified.

**Originality.** The jury is a protocol, not a prompt. Blind ballots are
commitments bound to fresh nonces, reveals are gated by Clerk-signed phase
closes, evidence is Oracle-attested, the transcript is a hash chain, and the
verifier replays the whole transcript instead of trusting the Clerk. When we
found that any agent in a Relay workspace can read DM bodies through search,
we sealed the ballots end to end with X25519 and AES-256-GCM so the transport
leak cannot un-blind a vote.

**Execution and demo.** `cargo run --bin run_case` produces a verifiable case
in memory in under a second; `node src/run-live.js` runs the same protocol
over live Relay and Terse; three public fixtures (valid, tampered by one word,
NO_QUORUM) verify identically in Rust and in WASM. The test suites cover the
protocol replay, the actors, the daemon contract, the Relay and Terse
integrations, the sealed-intent cryptography, and live end-to-end cases
including a forging agent, a persistence failure, and an early reveal attempt.
The demo flow lives in `apps/web/README.md`.

**User experience and design.** The frontend team owns the experience: a 3D
courtroom that plays a case, a certificate page where Verify shows the checks
and Tamper breaks the seal, a side-by-side replay of open debate (C2) against
the signed protocol (C5), and a results ladder. The backend's contribution to
that design is a single JSON bundle per case and a `verifyCert` call that runs
in the browser.

**Potential and impact.** Verdicts from AI deliberation are entering
decisions that affect people. A certificate that any third party can replay
turns "the model said so" into an auditable record of who was allowed to
speak, what evidence was attested, and how the quorum was reached. The runs in
this repository are scripted integration evidence; measured bias results with
real-model jurors belong to the evaluation team and are labelled as such in
the results page until they land.

## Repository structure and ownership

| Path | Contents | Owner |
| --- | --- | --- |
| `packages/protocol/` | Wire types, canonical encoding, signing, commitments, transcript chain, admission engine, certificate verifier, WASM build and JS glue, fixtures | Leo |
| `apps/actors/` | In-memory Clerk, Ledger, Oracle, juror signing shell, scripted case runner, fixture generator | Leo |
| `apps/web/` | All visuals | Frontend team |
| `apps/jurors/` | Juror orchestration, `runJuror(caseId, { persona, model, condition, byzantine? })` | Teammate |
| `eval/` | Answer mapping and evaluation | Data scientist |
| `docs/core.md` | Protocol specification and known limits | Leo |

Only the owner edits a directory. Shared root files (`package.json`,
`pnpm-workspace.yaml`, `.env.example`, `.gitignore`) are coordinated by Leo.

## Prerequisites

- Rust 1.85 or newer with the `wasm32-unknown-unknown` target
  (`rustup target add wasm32-unknown-unknown`).
- `wasm-bindgen-cli` 0.2.128, matching the pinned crate version
  (`cargo install wasm-bindgen-cli --version 0.2.128 --locked`).
- Node 20 or newer and pnpm (`npm i -g pnpm`), then `pnpm install` at the
  repository root to link the workspace.

The frontend does not need a Rust toolchain: the generated WASM package under
`packages/protocol/wasm/pkg` is committed.

## Commands

| Task | Command |
| --- | --- |
| Protocol tests | `cargo test --manifest-path packages/protocol/Cargo.toml` |
| Actor tests | `cargo test --manifest-path apps/actors/Cargo.toml` |
| Run one case | `cargo run --manifest-path apps/actors/Cargo.toml --bin run_case -- --script 3-1 --condition C3 --out apps/actors/out` |
| Regenerate fixtures | `cargo run --manifest-path apps/actors/Cargo.toml --bin gen_fixtures -- --out packages/protocol/fixtures` |
| Build WASM | `pnpm build:wasm` |
| Native/WASM parity test | `pnpm test:wasm` |

The root `package.json` also exposes `test:protocol`, `test:actors`, and
`fixtures` as shortcuts for the cargo commands above.

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

The in-memory runner needs no environment variables. Live mode reads
`RELAY_WORKSPACE_KEY` and `RELAY_BASE_URL` (default `http://127.0.0.1:8787`)
for Agent Relay, and `TERSE_ACTOR_URL` (default
`http://127.0.0.1:7100/v1/projects/local/actors`) and `TERSE_API_KEY` (hosted
only) for Terse. Names reserved for teammate packages are also listed in
`.env.example`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`. Copy the file to `.env` for local values; `.env` is
gitignored and must never be committed.

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
