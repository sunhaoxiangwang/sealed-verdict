# Handoff: merging and building on the jurors (PR #1)

For whoever merges this or continues the work: Leo (actors and signatures), Dan (UI), or the data scientist (eval runs). Rikin wrote this PR. Usage details are in [README.md](README.md).

## 1. Merging

- **Conflicts:** none expected. Everything is new files under `apps/jurors/`. GitHub reports the PR as mergeable while `main` has moved ahead with frontend commits.
- **Merge method:** a squash merge or a merge commit is fine.
- **Package manager:** the folder uses npm with its own `package-lock.json`, like `apps/web`. The root `pnpm-workspace.yaml` includes `apps/*`, so a root `pnpm install` also picks it up. Either works; don't commit a second lockfile.
- **Secrets:** none are committed. `apps/jurors/.env.local` holds the keys and is gitignored.

After merging:

```bash
cd apps/jurors
npm install
npx tsc -p .                # typecheck, should print nothing
npm run quickstart          # live Relay check: ends with "FOUR AGENTS TALKING: PASS"
```

## 2. Keys (`apps/jurors/.env.local`)

| Variable | Needed for | If missing |
|---|---|---|
| `OPENAI_API_KEY` | Real LLM jurors | Scripted mock jurors. Verdicts carry `mock: true`. **Never report numbers from mock runs.** |
| `EVAL_MODEL` | Juror model | Defaults to `gpt-4.1-mini`. Must match the C0/C1 baselines. |
| `RELAY_WORKSPACE_KEY` | Shared team workspace | A new dev workspace is created on first run and its key is saved here. Share the team key privately; it acts like a password. |

## 3. What has and hasn't been tested

| Area | Status |
|---|---|
| Four agents talking on a Relay channel | Tested live, PASS |
| Channel permission probe | Tested live. **There are none**, see section 5. |
| C5 end to end: commit-reveal, signatures, UNATTESTED tags, quorum, certificate | Tested live on 3 items (base, byz, forged), all completed, with scripted jurors |
| C2 end to end | Tested live on 3 items. 2/3 passed on the first run; the failure was a hosted-relay 429, which now retries |
| C3, C4 | Same code paths as C2/C5, gated by flags. Not run separately yet. |
| LLM juror calls (`src/llm.ts`) | **Not run yet.** No OpenAI key was available. Run `--limit 5` first and check the verdict lines. |

## 4. Integration points

### Data scientist: running C2 to C5

From Python:

```python
import sys; sys.path.insert(0, "apps/jurors")
from jurors import run_condition
run_condition("C2", "eval/data/items.jsonl", "eval/results/verdicts/C2.jsonl", limit=20)
```

Or from the shell:

```bash
npx tsx src/cli.ts --condition C2 --in <items.jsonl> --out <C2.jsonl>
```

- **Input:** the item schema is in the README. Only `id` and `options` are required. The `variant`, `attack_idx`, `byz_text`, and `evidence` fields switch on the Byzantine and forged-evidence tests.
- **Output:** one line per item with `verdict_idx`, and per juror `round1_idx` and `final_idx` (for the flip rate), plus `byzantine`, `votes[round][juror]`, `no_quorum`, `commits_verified`, and `certificate_verified`.
- **Resuming:** re-running skips finished items, and a failed item is retried once automatically.
- **Speed:** the hosted relay rate-limits hard. At `--concurrency 2`, each case is about 30 relay calls plus 12 LLM calls. Run tier 1 (BBQ base) first.

### Dan: showing real cases in the UI

The jurors post to Relay only; **nothing is written to Supabase yet**. That bridge is the main open task. Every message carries structured `metadata.kind`, so the mapping to `apps/web/src/protocol/types.ts` is mechanical:

| Relay `metadata.kind` | UI `TribunalEvent` | Notes |
|---|---|---|
| `evidence` | `evidence` | Has `id`, `source`, `text`. `sig` is present only when oracle-signed. |
| `commit` | `commit` | `commitment = sha256(vote\|nonce)`, `juror` = display name |
| `vote` with `round: 1` and a `nonce` | `reveal` | |
| `vote`, later rounds | `argument` | Unattested when C5 and none of `evidence_ids` is signed |
| `clerk` with `phase` | `phase` | Phases: `attest`, `commit`, `reveal`, `deliberate`, `verdict` |
| `verdict` | `verdict` | `cert` = `{caseId, verdict, quorum, transcriptRoot, evidenceIds}`, plus `sig` in C5 |

**Decision needed:** the UI's `Reveal.vote` is `"true" | "false" | "uncertain"`, but the jurors vote on an option index (BBQ has three options). Either widen the UI type to an option string, or map "unknown" to `uncertain`.

The simplest bridge is a `relay.addListener("message.created")` that inserts rows into Supabase `events`. But live push dropped 3 of 11 messages in testing, so a reliable version reads each case channel's history after the case finishes and writes it in order.

### Leo: actors and signatures

- **Keys:** they live in memory in `src/protocol.ts` (`newKeys`, `signText`, `verifyText`, Ed25519 from `node:crypto`). Swap them for the key registry when it lands; the call sites are only in `runCase.ts`.
- **Clerk and ledger:** the clerk gate and the ledger hash chain currently run inside `runCase.ts` (the reveal gate and the transcript root). Moving them into Durable Actors means replacing those two blocks. The message shapes stay the same.
- **Durable Actors:** not used yet in this PR.

## 5. Decisions worth knowing before changing things

- **Relay channels can't hide anything.** The live probe showed non-members can read, list members, and post, and leaving a channel doesn't revoke reads. So:
  - **The clerk is the enforcement point.** It opens reveals only after it sees all four commitments, and commits are hashes, so reading them early leaks nothing.
  - **Signatures carry C5.** Every C5 reader verifies signatures itself.
  - **One channel per case**, not one per phase, because separate phase channels would add no protection.
- **Jurors read channel history rather than relying on push**, since push is lossy.
- **The Byzantine juror is scripted, not an LLM.** That makes it deterministic and identical across conditions. In C2/C3 it is labelled "senior domain expert"; in C4/C5 it hides behind a pseudonym like everyone else.
- **The C4 personas are neutral thinking styles** (Skeptic, Literalist, Domain expert, Pragmatist). None is told to avoid bias, so C4's effect comes from the protocol, not from debiasing prompts.
- **The C5 verdict needs 3 of 4 signed votes.** Without a quorum it falls back to the plurality and sets `no_quorum: true`.
- **Hosted relay quirks:** it returns retryable 503s and 429s, and sometimes stores the write anyway. So every send has an idempotency key, every registration gets a fresh name suffix, and retries honour `retryAfterMs`. Don't remove these.

## 6. Open tasks, in priority order

1. Add the OpenAI key and run `--limit 5` for each condition to check that LLM jurors parse and vote.
2. Point everyone at one team `RELAY_WORKSPACE_KEY`.
3. Run C2 to C5 on tier-1 items for the eval.
4. Build the Relay-to-Supabase event bridge for the live courtroom (section 4, Dan).
5. Swap in Leo's key registry and actors (section 4, Leo).
