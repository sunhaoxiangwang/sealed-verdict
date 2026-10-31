# Frontend contracts (PROPOSED, for Leo and the data scientist to confirm)

## Environment
- `VITE_SUPABASE_URL`: project URL, e.g. `https://<ref>.supabase.co`
- `VITE_SUPABASE_ANON_KEY`: publishable anon key (read-only for the frontend; RLS must allow SELECT on `cases` and `events`, and Realtime on `events`)
- Both must be set for live mode. If either is missing the app stays on the mock player and the LIVE toggle is disabled. Template: `apps/web/.env.example`.

## Supabase tables
- `events`
  - `id` (bigint or uuid, primary key; used to dedupe rows)
  - `case_id` (text, references cases.id)
  - `ts` (bigint, epoch ms; rows are read ordered by `ts`, then `id`)
  - `type` (text): one of `evidence` | `commit` | `reveal` | `argument` | `verdict` | `phase` | `system`
  - `payload` (jsonb): see payload shapes below
  - `verified` (bool): the backend's verification result. The frontend uses this flag directly (no key registry in live mode yet).
  - Must be in the `supabase_realtime` publication (`ALTER PUBLICATION supabase_realtime ADD TABLE events;`).
- `cases`
  - `id` (text, primary key; this is the caseId in the channel name and in events)
  - `claim` (text)
  - `condition` (text): `C0` to `C5`
  - `created_at` (timestamptz)
  - `jurors` (jsonb, optional but recommended): array of `{ id, pseudonym, persona, model, byzantine }`. If absent, the frontend shows four placeholder jurors named from distinct juror names seen in events.
- `certificates`: case_id, cert jsonb (not read by the frontend yet)

## Payload shapes (`events.payload`)
Types match `src/protocol/types.ts`. `Signed<T>` = `{ body: T, sig: string, signer: string }`.
- `evidence`: `Signed<Evidence>`
- `commit`: `Signed<Commit>`. Juror name is `body.juror`.
- `reveal`: `Signed<Reveal>`. Juror name is `body.juror`.
- `argument`: `Signed<Argument>` plus optional top-level `unattested: bool` and `stance: "true" | "false" | "uncertain"` on the payload object. If `unattested` is absent it is derived as `body.evidenceIds.length === 0`.
- `verdict`: `Signed<VerdictCert>`
- `phase`: `{ phase: "idle" | "attest" | "commit" | "reveal" | "deliberate" | "verdict" }`
- `system`: `{ text: string, level: "info" | "warn" | "error" }`

Unknown `type` values are skipped and logged once.

## Realtime
- Channel: `case:{caseId}`
- postgres_changes: `INSERT` on `public.events` with filter `case_id=eq.{caseId}`. The new row is mapped with the rules above.
- broadcast: event name `"tribunal"`. The payload is a complete TribunalEvent, so the backend can push without writing a table row:
  - `{ type: "evidence" | "commit" | "reveal" | "verdict", msg: Signed<...>, verified: bool }`
  - `{ type: "argument", msg: Signed<Argument>, verified: bool, unattested: bool, stance?: "true" | "false" | "uncertain" }`
  - `{ type: "phase", msg: { caseId, phase } }`
  - `{ type: "system", text: string, level: "info" | "warn" | "error" }`
  - Broadcast events have no row id, so they are not deduplicated against table rows. Do not send the same event both ways.

Client load order: subscribe, then fetch `cases` and `events`, then apply fetched rows, then apply anything that arrived meanwhile (deduped by `id`).

## results.json (public/results.json)
- measured: bool, generatedAt: string|null, n: {bbq, truthfulqa}
- conditions[]: id (C0-C5), label, transport ("direct" for C0-C1, "relay" for C2-C5), biasScore, ci [lo, hi], accuracy, herdingFlipRate, byzantineFlipRate, forgedAcceptRate (null until measured), pVsC0 (null until measured)
