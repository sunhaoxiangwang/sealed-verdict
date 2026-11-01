# Frontend contracts (PROPOSED, for Leo and the data scientist to confirm)

## Environment
- `VITE_SUPABASE_URL`: project URL, e.g. `https://<ref>.supabase.co`
- `VITE_SUPABASE_ANON_KEY`: publishable anon key (read-only for the frontend; RLS must allow SELECT on `cases` and `events`, and Realtime on `events`)
- Both must be set for live mode. If either is missing the app stays on the mock player and the LIVE toggle is disabled. Template: `apps/web/.env.example`.
- `VITE_TRIBUNAL_API_URL` (optional): base URL of the tribunal backend. When set, submitted cases are POSTed to `${VITE_TRIBUNAL_API_URL}/cases` (see "Submitting a case").

## Submitting a case (`submitCase` in `src/mock/player.ts`)
The frontend validates first: claim trimmed, 10 to 600 characters; at most 5 evidence URLs, each `http:` or `https:` (deduped); `condition` is `"C2"` or `"C5"`; empty `context` is omitted. Then the first matching path runs:

1. `VITE_TRIBUNAL_API_URL` is set: `POST ${VITE_TRIBUNAL_API_URL}/cases`
   - Request: `Content-Type: application/json`, body `{ "claim": string, "context"?: string, "evidenceUrls": string[], "condition": "C2" | "C5" }`
   - Response: 2xx with `{ "caseId": string }`. Any non-2xx or a missing `caseId` is shown to the user as an error.
   - The frontend then subscribes to `case:{caseId}` exactly as below, so the backend must create the `cases` row and write `events` for that id (CORS must allow the app origin).
2. Supabase is configured (no API URL): the frontend inserts one row into `cases` and subscribes:
   - `{ id: "case-<10 hex>", claim, condition, context: string | null, evidence_urls: string[] (jsonb), status: "queued" }`
   - Needs columns `context text`, `evidence_urls jsonb`, `status text` on `cases`, and an RLS policy allowing INSERT for the anon role (ideally `WITH CHECK (status = 'queued')`).
   - The backend should pick up `status = 'queued'` rows (e.g. a trigger, webhook or poller), set `status` to `running` / `done`, and write `events` as usual.
3. Neither is configured: the in-browser mock engine (`src/mock/engine.ts`) builds a signed script and plays it. Its conclusion has `simulated: true`.
   - Each URL gets a deterministic simulated stance from `sha256(url + claim)` (the claim with negation words removed, so a claim and its denial share stances): supports ~55%, contradicts ~30%, irrelevant ~15%. Two or more words shared between the URL's host/path and the claim make it supporting; one shared word nudges toward supporting. A negated claim ("did not", "never", "isn't", "not") flips supports and contradicts.
   - More supporting than contradicting sources leans true, the reverse leans false. Jurors vote by persona: domain expert follows the evidence, statistician needs a margin of at least 0.3, skeptic needs two winning sources, devil's advocate takes the opposing side when any source supports it. Irrelevant sources are listed in `excluded`.

## Supabase tables
- `events`
  - `id` (bigint or uuid, primary key; used to dedupe rows)
  - `case_id` (text, references cases.id)
  - `ts` (bigint, epoch ms; rows are read ordered by `ts`, then `id`)
  - `type` (text): one of `evidence` | `commit` | `reveal` | `argument` | `verdict` | `conclusion` | `phase` | `system`
  - `payload` (jsonb): see payload shapes below
  - `verified` (bool): the backend's verification result. The frontend uses this flag directly (no key registry in live mode yet).
  - Must be in the `supabase_realtime` publication (`ALTER PUBLICATION supabase_realtime ADD TABLE events;`).
- `cases`
  - `id` (text, primary key; this is the caseId in the channel name and in events)
  - `claim` (text)
  - `condition` (text): `C0` to `C5`
  - `created_at` (timestamptz)
  - `context` (text, nullable), `evidence_urls` (jsonb array of strings), `status` (text: `queued` | `running` | `done`): written by the frontend when it submits a case without `VITE_TRIBUNAL_API_URL`
  - `jurors` (jsonb, optional but recommended): array of `{ id, pseudonym, persona, model, byzantine }`. If absent, the frontend shows four placeholder jurors named from distinct juror names seen in events.
- `certificates`: case_id, cert jsonb (not read by the frontend yet)

## Payload shapes (`events.payload`)
Types match `src/protocol/types.ts`. `Signed<T>` = `{ body: T, sig: string, signer: string }`.
- `evidence`: `Signed<Evidence>`
- `commit`: `Signed<Commit>`. Juror name is `body.juror`.
- `reveal`: `Signed<Reveal>`. Juror name is `body.juror`.
- `argument`: `Signed<Argument>` plus optional top-level `unattested: bool` and `stance: "true" | "false" | "uncertain"` on the payload object. If `unattested` is absent it is derived as `body.evidenceIds.length === 0`.
- `verdict`: `Signed<VerdictCert>`
- `conclusion`: `Signed<Conclusion>` (a bare `Conclusion` object is also accepted and treated as unsigned). Send it after the `verdict` event; the UI shows it as the tribunal's written opinion and marks the case done. Shape:
  ```ts
  type Conclusion = {
    caseId: string; claim: string; verdict: "true" | "false" | "uncertain";
    headline: string;   // one plain-English sentence, e.g. "Unproven: nothing attested shows who caused the outage."
    summary: string;    // 2-4 sentences, the tribunal's opinion, paraphrasing the claim
    confidence: number; // 0..1
    quorum: string;     // e.g. "3/4"
    reasons: { text: string; evidenceIds: string[] }[];  // 2-4, cite evidence ids
    dissent: { juror: string; text: string }[];          // 0-2, juror = pseudonym
    excluded: { id: string; why: string }[];             // evidence not counted (forged, unattested)
    herded?: { flips: number; note: string };            // C2 only: how many jurors flipped toward the first speaker
    simulated: boolean;                                  // false for real backend runs
    why: string;          // 2-3 plain-English sentences: exactly why this verdict, naming the evidence ids that decided it or noting their absence
    wouldChange?: string; // uncertain: what attested evidence would settle it; true/false: what would overturn it (one sentence)
    votes: { juror: string; persona: string; vote: "true" | "false" | "uncertain"; confidence: number }[]; // the four revealed sealed votes
    agree: number;        // jurors who voted with the verdict, e.g. 3
    total: number;        // 4
    needed: number;       // 3 (2f+1 with f=1)
    quorumRule: string;   // "3 of 4 sealed votes are needed. The rule tolerates one faulty or dishonest juror."
  };
  ```
  Missing `reasons` / `dissent` / `excluded` / `votes` default to `[]`, an unknown `verdict` (also per vote) becomes `"uncertain"`, missing `simulated` becomes `false`. Missing `why` falls back to `summary`. Missing `total` / `agree` come from `votes` (or from `quorum` "a/b"), missing `needed` is `2f+1` with `f = floor((total-1)/3)`, and missing `quorumRule` gets the default sentence above. The same defaults apply to `conclusion` events sent by broadcast. The UI also lists any rejected (unverified) evidence from the transcript under `excluded`.

  Verdict rule (the mock engine follows it; the backend should too): a verdict needs `needed` matching sealed votes. If no position reaches it, `verdict` is `"uncertain"`, `agree` is the number of `"uncertain"` votes, and `why` says no quorum was reached. `"uncertain"` is otherwise reserved for: nothing attested, attested evidence tied, or a question that asks to blame a person by identity. `dissent` lists the jurors whose vote differs from `verdict`.
- `phase`: `{ phase: "idle" | "attest" | "commit" | "reveal" | "deliberate" | "verdict" }`
- `system`: `{ text: string, level: "info" | "warn" | "error" }`

Unknown `type` values are skipped and logged once.

## Realtime
- Channel: `case:{caseId}`
- postgres_changes: `INSERT` on `public.events` with filter `case_id=eq.{caseId}`. The new row is mapped with the rules above.
- broadcast: event name `"tribunal"`. The payload is a complete TribunalEvent, so the backend can push without writing a table row:
  - `{ type: "evidence" | "commit" | "reveal" | "verdict" | "conclusion", msg: Signed<...>, verified: bool }`
  - `{ type: "argument", msg: Signed<Argument>, verified: bool, unattested: bool, stance?: "true" | "false" | "uncertain" }`
  - `{ type: "phase", msg: { caseId, phase } }`
  - `{ type: "system", text: string, level: "info" | "warn" | "error" }`
  - Broadcast events have no row id, so they are not deduplicated against table rows. Do not send the same event both ways.

Client load order: subscribe, then fetch `cases` and `events`, then apply fetched rows, then apply anything that arrived meanwhile (deduped by `id`).

## results.json (public/results.json)
- measured: bool, generatedAt: string|null, n: {bbq, truthfulqa}
- conditions[]: id (C0-C5), label, transport ("direct" for C0-C1, "relay" for C2-C5), biasScore, ci [lo, hi], accuracy, herdingFlipRate, byzantineFlipRate, forgedAcceptRate (null until measured), pVsC0 (null until measured)
