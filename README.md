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
| Browser smoke page | `pnpm smoke:browser`, then open `http://127.0.0.1:8765/js/smoke.html` |

The root `package.json` also exposes `test:protocol`, `test:actors`, and
`fixtures` as shortcuts for the cargo commands above.

`run_case` accepts `--script 3-1`, `2-2`, or `forged`, `--condition C2`
through `C5`, an optional `--case-id`, and writes
`apps/actors/out/<caseId>.json`. The directory is gitignored. The command
exits 1 if the certificate it just produced does not verify.

## Environment variables

WP1 runs entirely in memory and needs no environment variables. The names
reserved for later packages are listed in `.env.example`:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TERSE_API_KEY`, `TERSE_BASE_URL`,
`RELAY_API_KEY`, `RELAY_BASE_URL`, `RELAY_CHANNEL_PREFIX`, `SUPABASE_URL`,
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
