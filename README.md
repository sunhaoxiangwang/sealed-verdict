# Sealed Verdict

LLM jurors deliberate under a commit-reveal protocol, and every verdict ships
with a certificate that anyone can verify offline. The certificate carries the
static case registry (who was allowed to speak), the signed round-1 votes, and
the root of a hash chain over the full transcript. A verifier replays that
transcript and recomputes the verdict itself; it never trusts what the Clerk
or Ledger said happened.

The experiment compares four conditions. C2 has no juror authentication: a
ballot's juror identity is whatever the ballot claims. C3 to C5 require valid
Ed25519 signatures from registered jurors and the Oracle, so forged input is
dropped or tagged UNATTESTED. Clerk and Ledger signatures are mandatory in
every condition.

This is a hackathon prototype. The protocol, actors, and verifier are Rust;
the verifier is also compiled to WebAssembly so the Node and browser code call
the same implementation.

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
