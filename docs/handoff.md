# Backend handoff (local, sealed-intent build)

Status: approved for local handoff at commits a9adf87 and 66a8916 on 2026-10-31.
Backend is frozen. Any further integration fix needs a short plan and reviewer
approval first.

## What is verified

Scripted integration evidence only. Four in-process scripted jurors, plus a
fifth forging agent, drove a full case over the local Agent Relay engine and the
local Terse runtime; the certificate verified natively and through the Node/WASM
verifier. These runs establish backend behavior. They are not measured bias
results; those come from the evaluation team with real-model jurors.

| Artifact | Path |
| --- | --- |
| Verified bundle | `apps/actors/out/handoff-sealed-c3.json` (verdict `ans2`, counted 4, 29 entries, one forged commit rejected `UNSIGNED`) |
| Relay sidecar | `apps/actors/out/handoff-sealed-c3.relay.json` (ledger seq to Relay message id for every admitted entry) |
| Fixtures for the frontend and eval | `packages/protocol/fixtures/{valid_cert,tampered_cert,no_quorum_cert,expected}.json` |

Reproduce with a NEW case id (a case id can never be reopened; a finished or
aborted id is spent):

```bash
cargo build --manifest-path apps/actors/Cargo.toml
cd apps/actors/bridge
RELAY_WORKSPACE_KEY=<key> RELAY_BASE_URL=http://127.0.0.1:8787 \
  node src/run-live.js --script forged --condition C3 --case-id demo-$(date +%H%M%S) --timeout-ms 3000
```

Exit code 0 and `"valid": true` mean the bundle under `apps/actors/out/` passed
the Rust verifier; `pnpm test:wasm` and the browser `verifyCert` accept the
same file.

## Local services

| Service | Start | Notes |
| --- | --- | --- |
| Agent Relay engine 12.3.0 | `node node_modules/@relaycast/engine/dist/bin/serve.js --db ./relaycast.db --port 8787` from an install made with `npm pkg set overrides.better-sqlite3=13.0.3 && npm i @relaycast/engine@12.3.0` | Node 26 needs the SQLite override. Workspace key: `node -e 'import("./src/relay.js").then(async m => console.log((await m.createWorkspace({ name: "sealed-verdict" })).workspaceKey))'` from `apps/actors/bridge`, paste into `.env`, never commit |
| Terse runtime 0.14.9 | `cd apps/actors/bridge/terse && terse actor dev --port 7100` | No account needed locally. Hosted `terse deploy` needs `terse auth login --no-browser` and is unverified |

## Juror team: how to join a live case

1. Leo runs the case in live mode. This creates the Relay agents, channels, the
   Terse case actor, and a private handoff file:

   ```bash
   cd apps/actors/bridge && node src/run-live.js --live --condition C3 --case-id <new-id>
   # writes apps/actors/bridge/.tokens/<new-id>.json (gitignored, mode 600)
   ```

2. Leo gives each juror ONLY its own slice of that file. Never share the whole
   file, the workspace key, or another juror's token. Every juror pins
   `recipientPublicKey` from this private handoff; nothing announced on a
   channel is an authority for that key.

   Handoff fields and where they go:

   | Handoff field | Use |
   | --- | --- |
   | `baseUrl` | `createAgentClient({ baseUrl })` |
   | `jurors.<id>.agentToken` | `createAgentClient({ agentToken })` |
   | `jurors.<id>.senderId` | `sealIntent({ senderId })` (your registered Relay id) |
   | `caseId` | `sealIntent({ caseId })` and channel names `sv-<caseId>-*` |
   | `recipientPublicKey` | `sealIntent({ recipientPublicKeyHex })` |
   | `clerkName` | `client.dm(clerkName, ...)` |
   | `condition` | C3 to C5 require sealed intents; only C2 accepts plaintext |

3. Minimal juror (Node 22+, ESM). Import the helper from the bridge package or by
   relative path; it uses Node built-in crypto only:

   ```js
   import { readFile } from "node:fs/promises";
   import { createAgentClient } from "@agent-relay/sdk/messaging";
   import { sealIntent } from "../../actors/bridge/src/intent-crypto.js"; // or "@sealed-verdict/bridge/src/intent-crypto.js" with a workspace dependency

   const h = JSON.parse(await readFile(process.env.SV_HANDOFF, "utf8")); // your private slice
   const me = h.jurors["juror-1"];
   const client = createAgentClient({ agentToken: me.agentToken, baseUrl: h.baseUrl });
   const seal = (intent) => JSON.stringify(sealIntent({
     recipientPublicKeyHex: h.recipientPublicKey, caseId: h.caseId, senderId: me.senderId, intent,
   }));

   await client.channels.join(`sv-${h.caseId}-phase`);
   await client.channels.join(`sv-${h.caseId}-evidence`);
   const latestPhase = async () => (await client.messages(`sv-${h.caseId}-phase`, { limit: 1 }))[0];
   // Poll latestPhase() every ~500 ms; its text is { marker, next: { phase, round, deadlineMs } | "verdict" }.

   await client.dm(h.clerkName, seal({ kind: "commit", round: 0, vote: "ans2", confidence: 70 }));
   // when next.phase === "reveal":
   await client.dm(h.clerkName, seal({ kind: "reveal", round: 0 }));
   // when next.phase === "deliberate":
   await client.dm(h.clerkName, seal({ kind: "argument", round: 0, text: "...", evidenceIds: ["ev-0"] }));
   ```

4. Channels and replies:
   - `sv-<caseId>-phase`: Clerk-signed close marker plus the window that just opened and its deadline.
   - `sv-<caseId>-evidence`: Oracle-signed evidence; cite its `body.id` values in arguments.
   - `sv-<caseId>-commit-<r>`, `reveal-<r>`, `argument`: the signed envelopes the bridge publishes for you.
   - `sv-<caseId>-cert`: `{ cert: Signed<CertBody> }` when the case closes.
   - The bridge answers each intent by DM with `{ ok: true, kind, round, messageId }` or
     `{ ok: false, error: { code } }`. Codes only, never votes: `wrong_phase`,
     `duplicate_commit` (first commitment stands), `no_commit`, `invalid_vote`,
     `invalid_confidence`, `unknown_sender`, `intent_not_encrypted`, `intent_invalid`.
   - Byzantine behavior: post a raw envelope directly on a public channel; the
     Clerk rejects or tags it, and it stays in the transcript as audit.

## Limits to state in the demo

- Local only. Relay and Terse were exercised on local runtimes; hosted operation
  is unverified.
- Central key custody. The bridge holds every juror's signing key and signs on
  behalf of the authenticated Relay sender.
- No recovery. If the bridge or Terse fails, the case aborts and its artifacts
  are removed; start again with a new case id.
- Ballot confidentiality was measured only against another agent in the same
  local workspace. Rejected public content remains readable, and a juror can
  always announce its own vote.
