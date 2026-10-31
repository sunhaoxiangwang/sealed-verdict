# Sealed Verdict core protocol

This document is the contract between the actors (`apps/actors`), the
verifier (`packages/protocol`), the WASM build used by Node and browsers, the
frontend, and the evaluation code. The Rust source under
`packages/protocol/src` is authoritative; this document describes it.

Protocol version string: `sv1`. It prefixes every signature and hash domain.

## Wire contract

All field names below are frozen. Hex strings are lowercase. Timestamps are
milliseconds as unsigned integers. Every type rejects unknown fields.

### Signed\<T\>

| Field | Type | Notes |
| --- | --- | --- |
| `body` | T | The signed message |
| `sig` | hex string or `null` | 64-byte Ed25519 signature |
| `signer` | hex string or `null` | 32-byte Ed25519 public key |

Both `sig` and `signer` keys must be present. Under condition C2 an unsigned
ballot sets both to `null`; such an envelope is never juror-authenticated and
the verifier treats its identity as claimed, not proven.

### Evidence

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique within the case |
| `caseId` | string | |
| `kind` | `"fetch"` or `"compute"` | WP1 produces only `fetch` |
| `source` | string | Name of the supplied context source |
| `contentHash` | hex string | SHA-256 of the full content |
| `excerpt` | string | Human-readable excerpt |
| `result` | string, optional | Omitted when absent |
| `ts` | integer | Milliseconds |

### Commit

| Field | Type |
| --- | --- |
| `caseId` | string |
| `round` | integer, 0 or 1 |
| `juror` | string, registered juror id |
| `commitment` | hex string, 32 bytes |

### Reveal

| Field | Type |
| --- | --- |
| `caseId` | string |
| `round` | integer, 0 or 1 |
| `juror` | string |
| `vote` | string, an answer id from the case choices |
| `confidence` | integer, 0 to 100 |
| `nonce` | hex string, 32 bytes |

### Argument

| Field | Type | Notes |
| --- | --- | --- |
| `caseId` | string | |
| `round` | integer | Always 0: deliberation happens once |
| `juror` | string | |
| `text` | string | |
| `evidenceIds` | string array | Evidence ids the argument cites |
| `prevHash` | string | Informational only, never checked |

### PhaseMarker

| Field | Type |
| --- | --- |
| `caseId` | string |
| `phase` | `"attest"`, `"commit"`, `"reveal"`, or `"deliberate"` |
| `round` | integer, 0 or 1 |
| `ts` | integer |

Signed by the Clerk with kind `phase`. Each marker closes the named phase.

### Registry

| Field | Type | Notes |
| --- | --- | --- |
| `caseId` | string | Must equal the certificate `caseId` |
| `condition` | `"C2"`, `"C3"`, `"C4"`, or `"C5"` | Fixed at case open |
| `choices` | string array | Unique answer ids; `NO_QUORUM` is rejected |
| `ledger` | hex string | Ledger public key, signs the certificate |
| `clerk` | hex string | Clerk public key, signs phase markers |
| `oracle` | hex string | Oracle public key, signs evidence |
| `jurors` | array of `{ id, pubkey }` | Exactly four, unique ids and keys |

All role and juror keys must be valid Ed25519 points and pairwise distinct.

### Quorum

| Field | Type | Notes |
| --- | --- | --- |
| `n` | integer | 4 |
| `f` | integer | 1 |
| `needed` | integer | 3 |
| `counted` | integer | Distinct jurors with an accepted round-1 reveal, including losing votes |

### CertBody

| Field | Type | Notes |
| --- | --- | --- |
| `caseId` | string | |
| `verdict` | string | A case choice, or `NO_QUORUM` |
| `quorum` | Quorum | |
| `transcriptRoot` | hex string | Chain head after the round-1 reveal close |
| `transcriptLen` | integer | Number of covered entries |
| `evidenceIds` | string array | Sorted unique attested ids cited by attested arguments |
| `registry` | Registry | |
| `votes` | array of Signed\<Reveal\> | Accepted round-1 reveal envelopes, one per voting juror, sorted by juror id bytewise |

Signed by the Ledger with kind `cert`.

### LedgerEntry

| Field | Type | Notes |
| --- | --- | --- |
| `seq` | integer | Zero-based arrival index |
| `ts` | integer | Ledger clock at arrival |
| `kind` | `"evidence"`, `"commit"`, `"reveal"`, `"argument"`, or `"phase"` | |
| `msg` | Signed\<T\> for the kind | Stored exactly as received |
| `status` | `"accepted"`, `"rejected"`, or `"unattested"` | Clerk's decision, audit only |
| `reason` | string, optional | Audit reason, omitted when accepted |

`status` and `reason` are what the Clerk said. The verifier recomputes
acceptance and never authorizes anything from these fields.

### VerdictCert

| Field | Type |
| --- | --- |
| `cert` | Signed\<CertBody\> |
| `transcript` | array of LedgerEntry |

This is the file `run_case` writes, the shape of every fixture, and the only
input `verifyCert` accepts.

## Canonical encoding

Every hash and signature covers canonical JSON bytes produced by
`canonical_bytes` (`canonical.rs`):

- Object keys sorted bytewise.
- No whitespace.
- Strings escaped exactly as `serde_json` escapes them; non-ASCII is emitted
  as raw UTF-8.
- Numbers must be integers. A float anywhere in a body is an encoding error.
- `null` is written as `null`. Optional fields (`result`, `reason`) are
  omitted when absent, so a struct always canonicalizes to the same bytes and
  a parsed document re-canonicalizes to the bytes its producer hashed.
- `ts` is milliseconds; `confidence` is 0 to 100; `round` is 0 or 1.

Field-level validation lives in one place, `validate.rs`, and is called by
both the live Clerk and the replay verifier so the two cannot drift.

## Signing and hashing

Signatures are Ed25519, verified with `verify_strict`, which rejects weak keys
and non-canonical signature encodings. The signed bytes are

```
UTF8("sv1/" + KIND + "\n") || canonical(body)
```

with KIND one of `evidence`, `commit`, `reveal`, `argument`, `phase`, `cert`.
Hashes are SHA-256 and travel as lowercase hex.

| Who | Signs | KIND |
| --- | --- | --- |
| Ledger | Certificate bodies | `cert` |
| Clerk | Phase-close markers | `phase` |
| Oracle | Evidence | `evidence` |
| Jurors | Commits, reveals, arguments | `commit`, `reveal`, `argument` |

The protocol crate has no runtime randomness. `Keypair::from_seed` takes 32
bytes the caller obtained from the operating system; `apps/actors` does this
with `getrandom`.

## Commitments

```
commitment = SHA256(UTF8("sv1/commit\n") || canonical({ caseId, round, juror, vote, nonce }))
```

`nonce` is 32 fresh random bytes, hex encoded, drawn per commit. A reveal is
accepted only if recomputing this value from its body equals the commitment
the same juror had accepted in the same round. Reveals before the reveal
window opens, reveals without an accepted commit, and reveals whose
recomputed commitment differs are rejected and logged.

## Transcript chain

```
h0  = SHA256(UTF8("sv1/chain\n" + caseId))
h_i = SHA256(raw32(h_{i-1}) || raw32(SHA256(canonical(entry_i))))
```

Both operands are raw 32-byte digests; hex appears only on the wire. The
complete LedgerEntry is hashed, including `status` and `reason`, so the chain
is an audit record of what the Ledger wrote, not only of what was accepted.
Changing any byte of any covered entry changes the root.

`transcriptRoot` is the chain head after the round-1 reveal close, and
`transcriptLen` is the number of entries covered. The certificate is produced
after that boundary and is not itself a ledger entry, so it never references
itself.

Only that prefix is authenticated. The verifier recomputes the chain over
`transcript[0..transcriptLen)` and compares it with `transcriptRoot`; entries
after `transcriptLen` are not covered by any signature or hash and are not
checked. A bundle may carry trailing entries for display, but a consumer must
treat them as unverified and must not infer anything about the verdict from
them.

## Phases and timeouts

Phase closes happen in this frozen order, each as a Clerk-signed marker:

```
attest/0 -> commit/0 -> reveal/0 -> deliberate/0 -> commit/1 -> reveal/1
```

An entry's phase window is defined by how many authenticated close markers
precede it in the transcript. Evidence counts only in the attest window,
commits only in a commit window with a matching `round`, reveals only in a
reveal window with a matching `round`, arguments only in the deliberate window
with `round` 0.

Each phase has a timeout; when it passes, the Clerk closes the phase. A juror
with no accepted commit, or no accepted matching reveal, in a round simply
abstains for that round. There is no recovery machinery. The first valid
commit per juror per round wins, and the first reveal that matches it wins;
later ballots are rejected and logged as `DUPLICATE_BALLOT`. Round 0 is a
blind straw poll that informs deliberation; only round 1 determines the
verdict.

## Quorum

The prototype fixes `n = 4`, `f = 1`, `needed = 3`. The verifier enforces
these constants and the presence of exactly four distinct registered jurors;
certificate-supplied `n`, `f`, and `needed` that disagree are a failure, not
a parameter. `counted` is the number of distinct jurors with an accepted
round-1 reveal, including those who voted for a losing choice.

Three accepted round-1 reveals for the same choice from distinct jurors
certify that choice. Anything else certifies `NO_QUORUM`. `NO_QUORUM` is
reserved: it is rejected as a choice id and is valid as a verdict only when
replay independently finds no choice with three votes.

Votes are answer ids taken from the case choices. Mapping ids to answer text
or labels belongs to the data scientist; the protocol never sees labels.

## Certificate verification

`verify_cert` (`verify.rs`) takes the `{ cert, transcript }` JSON, never
panics on malformed input, and returns `{ valid, failures }`. It collects
every failure it can establish rather than stopping at the first. The
algorithm:

1. Shape. The root must be an object with exactly `cert` and `transcript`;
   `cert.body` must parse as CertBody. Otherwise `SCHEMA_INVALID` and stop.
2. Registry. `validate_registry` checks valid, pairwise-distinct role keys,
   exactly four jurors with unique ids and keys, and valid choices.
   `registry.caseId` must equal the certificate `caseId`.
3. Certificate signature. `cert.signer` must equal `registry.ledger` and the
   signature must verify over the body bytes exactly as received.
4. Bounds and chain. `transcriptLen` must be between 1 and the transcript
   length; covered entries must carry `seq` equal to their index; the
   recomputed chain root must equal `transcriptRoot`.
5. Replay. A fresh admission `Engine` (`replay.rs`) is run over the covered
   entries in order, with the same code the Clerk used live. Authenticated
   Clerk markers advance the phase window and must appear in the frozen order;
   the covered transcript must end with the round-1 reveal close. Every
   trusted message must carry the certificate `caseId`, and ballots and
   arguments must carry the round of their window. Under C3 to C5 evidence
   must be signed by the registry Oracle and ballots and arguments by the
   registered key of the juror they name; under C2 the claimed juror id only
   has to be registered. Rejected and unattested inputs are audit records and
   do not by themselves invalidate the certificate.
6. Tally. From the accepted round-1 reveals: `counted`, per-choice counts, and
   the expected verdict (a choice with three votes, else `NO_QUORUM`). The
   quorum fields must match the constants and `counted`; the verdict must be
   a choice or `NO_QUORUM` and must equal the replayed verdict.
7. Votes. `cert.body.votes` must equal the accepted round-1 reveal envelopes
   in full (body, `sig`, and `signer`), compared by canonical bytes, in
   ascending juror-id order, exactly one per juror.
8. Evidence ids. `cert.body.evidenceIds` must equal the sorted unique set of
   attested evidence ids cited by attested arguments.

Status flags in the transcript never authorize anything; step 5 recomputes
every admission.

### Failure codes

Each failure string is `CODE: detail`, or just `CODE`. The code is the text
before the first colon and is stable; the detail is for humans.

| Code | Meaning |
| --- | --- |
| `SCHEMA_INVALID` | Input is not JSON, not the `{ cert, transcript }` shape, or the body does not parse |
| `REGISTRY_INVALID` | Bad or duplicate keys, wrong juror count, bad choices, or registry case id mismatch |
| `CERT_SIGNER_NOT_LEDGER` | `cert.signer` is not the registry ledger key |
| `CERT_SIG_INVALID` | Ledger signature missing, malformed, or does not verify |
| `TRANSCRIPT_BOUNDS_INVALID` | `transcriptLen` out of range or an entry's `seq` differs from its index |
| `TRANSCRIPT_ROOT_MISMATCH` | Recomputed chain root differs, or an entry cannot be canonicalized |
| `PHASE_ORDER_INVALID` | Authenticated close markers out of order, missing, after the final close, or the covered transcript does not end with the round-1 reveal close |
| `QUORUM_FIELDS_INVALID` | `n`, `f`, `needed`, or `counted` differ from the enforced values |
| `VERDICT_INVALID` | Verdict is neither a case choice nor `NO_QUORUM` |
| `QUORUM_NOT_MET` | Certificate names a choice but replay found no choice with three votes |
| `TALLY_MISMATCH` | Replay certifies a different outcome than the certificate claims |
| `VOTES_MISMATCH` | Vote envelopes differ in count or content from the accepted round-1 reveals |
| `EVIDENCE_IDS_MISMATCH` | `evidenceIds` differ from the replayed cited attested set |

### Audit reasons

The Clerk writes one of these to `LedgerEntry.reason` when an input is
rejected or unattested. They explain the transcript; they never drive
verification.

| Reason | Meaning |
| --- | --- |
| `MALFORMED` | Envelope does not parse as the named kind |
| `OUT_OF_PHASE` | Arrived outside its phase window, for example an early reveal |
| `CASE_CLOSED` | Phase marker after the final close |
| `WRONG_CASE` | Body `caseId` is not this case |
| `WRONG_ROUND` | Body `round` does not match the open window |
| `UNKNOWN_JUROR` | Juror id is not in the registry |
| `UNSIGNED` | Signature required by the condition but `sig` or `signer` is null |
| `WRONG_SIGNER` | Signer key is not the registered key for that role or juror |
| `BAD_SIGNATURE` | Signature present but does not verify |
| `INVALID_FIELDS` | Field validation failed (hex lengths, confidence range, empty ids) |
| `INVALID_VOTE` | Vote is not one of the case choices |
| `DUPLICATE_BALLOT` | A ballot from this juror was already accepted this round |
| `DUPLICATE_EVIDENCE` | Evidence id already attested |
| `NO_COMMIT` | Reveal from a juror with no accepted commit this round |
| `COMMITMENT_MISMATCH` | Recomputed commitment differs from the accepted commit |
| `PHASE_ORDER` | Authenticated Clerk marker closes the wrong phase |

Evidence that fails authentication is recorded with status `unattested`.
Arguments from unauthenticated jurors are also recorded as `unattested`;
they stay in the transcript but contribute no evidence ids to the
certificate. There is no semantic check that cited evidence supports an
argument.

## Conditions

| Condition | Juror and Oracle authentication | Clerk and Ledger signatures |
| --- | --- | --- |
| C2 | None. A ballot's identity is its claimed `juror` id, which must be registered. Evidence in the attest window is attested without a signature. Unsigned envelopes carry `sig: null, signer: null`. | Mandatory |
| C3, C4, C5 | Required. Ballots and arguments must be signed by the registered juror key they name; evidence must be signed by the registry Oracle key. Unsigned or forged ballots are rejected; unsigned or forged evidence is `unattested`. | Mandatory |

In WP1 the verifier applies the same policy to C3, C4, and C5; the conditions
differ in juror behavior, which is owned by the jurors team. A C2 certificate
attests ledger order and the Clerk's phase sequence, not juror identity.

## Interfaces

### Rust, `packages/protocol`

| Item | Signature |
| --- | --- |
| `sign` | `fn sign<T: Message>(kp: &Keypair, body: T) -> Result<Signed<T>, ProtocolError>` |
| `verify` | `fn verify<T: Message>(signed: &Signed<T>) -> Result<(), ProtocolError>` (signature only; authorization is the caller's) |
| `verify_value` | `fn verify_value(kind: &str, body: &Value, sig: Option<&str>, signer: Option<&str>) -> Result<(), ProtocolError>` |
| `canonical_bytes` | `fn canonical_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, ProtocolError>` |
| `sha256_hex` | `fn sha256_hex(bytes: &[u8]) -> String` |
| `commitment_hex` | `fn commitment_hex(case_id, round, juror, vote, nonce_hex) -> Result<String, ProtocolError>` |
| `chain_root` | `fn chain_root(case_id: &str, entries: &[Value]) -> Result<[u8; 32], ProtocolError>` |
| `Engine::admit` | `fn admit(&mut self, kind: EntryKind, msg: &Value) -> Admission` |
| `verify_cert` | `fn verify_cert(root: &Value) -> VerifyReport` |
| `verify_cert_json` | `fn verify_cert_json(json: &str) -> VerifyReport` |

`Keypair::from_seed([u8; 32])` builds a signer; the crate never draws
randomness.

### Rust, `apps/actors`

| Actor | Methods |
| --- | --- |
| `Clerk` | `open_case(registry, keypair, clock, phase_timeout_ms)`, `phase(case_id) -> Option<PhaseInfo { phase, round, deadline_ms, closed }>`, `submit(ledger, kind, value)` plus `submit_evidence` / `submit_commit` / `submit_reveal` / `submit_argument(ledger, value)` and typed wrappers `attest` / `commit` / `reveal` / `argue(ledger, &Signed<T>)`, all returning `Result<Admission, ActorError>`; `tick(ledger) -> Result<bool>` closes the phase once the deadline has passed; `close_phase(ledger) -> Result<PhaseMarker>`; `tally()`; `issue_verdict(&ledger) -> Result<VerdictCert>` after the final close |
| `Ledger` | `append(kind, msg, admission) -> Result<&LedgerEntry>`, `root_hex`, `len`, `entries`, `public_key_hex`, `certify(body) -> Result<Signed<CertBody>>` |
| `Oracle` | `fetch(src) -> Result<Signed<Evidence>>` and `evidence_body(src)`, both only for sources in the supplied case context; unknown sources are an error, never fetched |
| `JurorShell` | `commit(round, vote, confidence)`, `reveal(round)`, `reveal_with_vote(round, other)` for tests, `argue(round, text, evidence_ids, prev_hash)`, `envelope(body)`; a shell without a key produces C2 unsigned envelopes |
| runner | `run_case(&CaseScript) -> Result<CaseRun { cert, report, tally }>`, presets `three_one` / `two_two` / `forged_evidence(condition)`, `Harness` exposing the live actors step by step (`open`, `attest`, `close_phase`, `commit_round`, `reveal_round`, `deliberate`, `finish`), `write_case(out_dir, &cert) -> PathBuf`, `tamper_first_argument_word(&cert)` used to derive the tampered fixture |

Every submit call runs the admission engine and appends the result to the
Ledger, whether accepted or not; a submit only fails when the envelope cannot
be canonically hashed (for example a float). Timing uses an injected
simulated clock, so tests never sleep; the runner closes each phase by
advancing the clock past the deadline and ticking the Clerk. Juror
orchestration (`runJuror`) is owned by the jurors team; `JurorShell` is only
the signing shell it calls.

### JavaScript, `@sealed-verdict/protocol`

| Export | Entry | Behavior |
| --- | --- | --- |
| `init(input?)` | `.` | Loads the WASM once. With no argument it fetches the `.wasm` next to the module; it also accepts a URL, a `Response`, or bytes. Idempotent. |
| `initNode()` | `./node` | Reads the `.wasm` from disk and calls `init` with the bytes. Node only. |
| `verifyCert(cert)` | both | Synchronous after init. Returns `{ valid: boolean, failures: string[] }`. Never throws on malformed certificates; those return `SCHEMA_INVALID`. Throws only if called before init resolves. |
| `isReady()` | both | Whether init has completed |
| `protocolVersion()` | both | Returns `"sv1"` |

The JS layer is glue only: it serializes the certificate to JSON, calls the
single WASM export, and parses the report. There is no second verifier.

## Output files

| Path | Contents |
| --- | --- |
| `apps/actors/out/<caseId>.json` | One VerdictCert per finished case, pretty-printed. Gitignored; `--out` overrides the directory. |
| `packages/protocol/fixtures/valid_cert.json` | 3-1 case, C3, case id `fixture-valid`, verifies |
| `packages/protocol/fixtures/no_quorum_cert.json` | 2-2 case, C3, case id `fixture-no-quorum`, verdict `NO_QUORUM`, verifies |
| `packages/protocol/fixtures/tampered_cert.json` | The valid bundle with one argument word changed; fails with `TRANSCRIPT_ROOT_MISMATCH` |
| `packages/protocol/fixtures/expected.json` | Native VerifyReport per fixture file name; the WASM parity test must match it exactly |

Fixtures contain public keys, signatures, certificates, and transcripts only.
Signing keys exist in memory during generation and are discarded.

## Live mode: clerk daemon and bridge

Live cases keep every protocol decision in Rust. `clerk_daemon`
(`apps/actors/src/daemon.rs`, binary `clerk_daemon`) owns the Clerk, Ledger,
Oracle, juror signing shells, and all private keys for exactly one fresh case.
A thin Node bridge (`apps/actors/bridge`) moves bytes between Agent Relay,
the daemon, and the Terse case actor. The bridge never signs, hashes, admits,
or tallies.

Transport is JSON lines on stdin/stdout. Requests are `{ id, cmd, ... }`;
replies are `{ id, ok: true, result }` or `{ id, ok: false, error: { code,
message } }`. Diagnostics go to stderr only. Phase closes are reported solely
through the `tick` reply; there is no unsolicited event.

| Command | Parameters | Result | Error codes |
| --- | --- | --- | --- |
| `open` | `caseId`, `condition`, `choices`, `context: [{ source, content }]`, `jurors: [{ id, sender }]`, `timeoutMs?` | `registry`, `evidence: Signed<Evidence>[]` (to publish, not yet admitted), `phase`, `head` | `case_open`, `bad_request` |
| `sign` | `sender` (registered Relay sender id), `kind: commit \| reveal \| argument`, `round`, `vote?`, `confidence?`, `text?`, `evidenceIds?` | `envelope`, `channel: { kind, round }` | `unknown_sender`, `wrong_phase`, `invalid_vote`, `invalid_confidence`, `no_commit` |
| `admit` | `kind: evidence \| commit \| reveal \| argument`, `msg` (envelope exactly as received) | `entry: LedgerEntry`, `admission`, `head` | `forbidden_kind` (phase), `already_finished` |
| `tick` | `nowMs` | `closed: LedgerEntry \| null`, `phase: { phase, round, deadlineMs, closed }`, `head`, `nowMs` | |
| `phase` | | `phase`, `head`, `len`, `finished` | |
| `finish` | `outDir?` | `cert` (VerdictCert), `report` (VerifyReport), `path` | `not_closed`, `already_finished` |

Rules the daemon enforces:

- One process, one case. A second `open` fails with `case_open`; a new attempt
  uses a new daemon and a new case id.
- `sign` binds `caseId` internally and requires the open window to match:
  commits need `commit/<round>`, reveals need `reveal/<round>` and a pending
  commit from the same shell, arguments need `deliberate/0`. Sender identity is
  the server-assigned Relay id captured at registration, never a display name
  or a payload field.
- `sign` never admits. Only envelopes received from Relay enter `admit`.
- The injected clock advances monotonically to `max(current, nowMs)`; a
  reordered older tick cannot rewind it. Each tick closes at most one phase.
- The certificate covers the transcript through the round-1 reveal close,
  captured at that moment. Messages admitted afterwards stay in the ledger as
  trailing entries outside `transcriptLen`.
- The bridge serializes DMs, channel envelopes, and 250 ms ticks through one
  per-case queue, persists each entry or phase transition to Terse before
  publishing anything derived from it, and exits non-zero on daemon or
  persistence failure. The case is then aborted.

Trust assumption: juror signing keys are held centrally by the daemon and
used on behalf of the authenticated Relay sender. This is a prototype
convenience, recorded under Known limits.

## Terse case actor

Durable per-case state lives in a Terse durable actor (`apps/actors/bridge/terse/src/actor.ts`,
class `CaseActor`, actor id = `caseId`; terse-sdk and terse-cli 0.14.9). It
holds `@Persisted registry`, `phase { phase, round, deadlineMs, closed }`,
`head` (chain head hex), `entryCount`, `cert`, and a SQLite table
`entries(seq, ts, kind, msg, status, reason)` with one row per LedgerEntry.
The actor contains no protocol logic: no hashing, signing, or tallying.

| Method | Behavior |
| --- | --- |
| `openCase(registry, phase, head)` | Initializes a fresh case; throws `case_exists` if a registry or any entry is already stored |
| `appendEntry(entry, head)` | Inserts the entry and updates the head in one transaction; throws `seq_mismatch` unless `entry.seq === entryCount` |
| `closePhase(entry, head, next)` | Same as `appendEntry` for a `phase` entry plus `phase = next`, atomically; the seq check makes a double close impossible |
| `getPhase()`, `getRegistry()`, `getHead()`, `getSummary()` | Live reads used by jurors and the bridge during the case |
| `getTranscript(fromSeq = 0)` | Stored entries in seq order, `msg` parsed back to JSON |
| `setCertificate(bundle)`, `getCertificate()` | Final `{ cert, transcript }`; a second set throws `cert_exists` |

The bridge calls the actor through the dependency-free client generated by
`terse actor generate --out-dir ../generated` (committed under
`apps/actors/bridge/generated`, imported as `actors.CaseActor.get(caseId)`),
configured by `TERSE_ACTOR_URL` (default local dev server
`http://127.0.0.1:7100/v1/projects/local/actors`) and `TERSE_API_KEY`
(hosted only). The local runtime (`terse actor dev --port 7100`) needs no
account; `terse init` and `terse deploy` require `terse auth login`.

## Relay channels (live mode)

Transport is Agent Relay (`@agent-relay/sdk` 15.0.1). The bridge
(`apps/actors/bridge/src/relay.js`) registers one agent per case for the
Clerk, one per juror, and one read-only tap (the engine does not echo an
agent's own posts to its own stream, so the tap joins every channel to see
all messages exactly once). Channels are created per case:

```
sv-<caseId>-evidence
sv-<caseId>-commit-<round>
sv-<caseId>-reveal-<round>
sv-<caseId>-argument
sv-<caseId>-phase       { marker: Signed<PhaseMarker>, next: { phase, round, deadlineMs } | "verdict" }
sv-<caseId>-cert        { caseId, verdict, valid, failures }
```

Messages are JSON text. Only envelopes received on the evidence, commit,
reveal, and argument channels enter admission; phase and cert are mirrors
and are never re-admitted. The daemon's own Oracle evidence is published to
the evidence channel and admitted when it comes back, so every externally
admitted entry has a Relay message id, recorded in the sidecar
`apps/actors/out/<caseId>.relay.json` (`seqToMessage`) without touching the
frozen LedgerEntry fields.

Signing intents are private: a juror sends `{ kind: "commit" | "reveal" |
"argument", round, vote?, confidence?, text?, evidenceIds? }` as a Relay DM
to the clerk agent. The bridge binds the DM's authenticated sender id
(`message.from.id`, verified against the installed SDK types and a real DM)
to that juror's signing shell, asks the daemon to sign, publishes the signed
envelope on the public channel, and DMs back `{ ok, kind, round, messageId }`
or `{ ok: false, error }`. Plaintext votes and nonces never appear on a public
channel before the reveal window; the acceptance test
`apps/actors/bridge/test/live-e2e.mjs` checks every public channel for this.

Credentials: the workspace key (`RELAY_WORKSPACE_KEY`) stays in the bridge.
Jurors receive only their own agent token through a private handoff file
(`apps/actors/bridge/.tokens/<caseId>.json`, gitignored, mode 600) and
connect with `createAgentClient({ agentToken, baseUrl })` from
`@agent-relay/sdk/messaging`. There are no private channels in Relay; the
Clerk is the enforcement point and never relies on channel read
restrictions. Terse and Relay are both exercised against local runtimes in
WP2; hosted deployment is a later step.

## Known limits

- **Embedded registry trust.** The certificate carries its own registry. A
  forged registry paired with a matching ledger key produces a certificate
  that verifies. Consumers must obtain the expected registry keys out of band
  and compare them to `cert.body.registry`.
- **Clerk controls admission and timing.** The Clerk decides when phases
  close and therefore which ballots arrive in time. The verifier checks that
  closes are Clerk-signed and in order, not that their timing was fair.
- **Oracle attests supplied content only.** For BBQ cases the Oracle signs the
  case context it was given. There is no external retrieval and no access to
  answer labels. `contentHash` covers the full content, which is not in the
  transcript, so it cannot be recomputed from the excerpt.
- **Ledger orders arrivals.** Arrival order is canonical and the chain
  commits to it. The Ledger is trusted for ordering and liveness, not for
  content, which signatures cover.
- **Only the covered prefix is authenticated.** Verification covers
  `transcript[0..transcriptLen)`. Trailing entries, if present, are not hashed
  into `transcriptRoot`, are not replayed, and carry no assurance.
- **C2 does not authenticate jurors.** C2 certificates prove ledger order and
  phase sequence only.
- **Central key custody in live mode.** The daemon signs juror ballots on
  behalf of authenticated Relay senders; jurors never hold their own protocol
  keys in WP2.
- **No recovery.** Daemon or persistence failure aborts the live case. Keys
  live only in the daemon process and are not reconstructed from registry or
  transcript data; the next attempt is a new case id.
- `Argument.prevHash` is informational and unchecked.
- No semantic check that cited evidence supports an argument.
- No recovery, restart, or re-delivery; a missed phase is an abstention.
- No throughput tuning, no Compute Oracle, no CBBA, and no Supabase
  ingestion in WP1.
