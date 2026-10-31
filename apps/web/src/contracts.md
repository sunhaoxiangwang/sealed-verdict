# Frontend contracts (PROPOSED, for Leo and the data scientist to confirm)

## Supabase tables
- events: id, case_id, ts, type, payload jsonb, verified bool
- cases: id, claim, condition, created_at
- certificates: case_id, cert jsonb

## Realtime
- Channel: `case:{caseId}`

## results.json (public/results.json)
- measured: bool, generatedAt: string|null, n: {bbq, truthfulqa}
- conditions[]: id (C0-C5), label, transport ("direct" for C0-C1, "relay" for C2-C5), biasScore, ci [lo, hi], accuracy, herdingFlipRate, byzantineFlipRate, forgedAcceptRate (null until measured), pVsC0 (null until measured)
