# Sealed Verdict web

Vite + React 19 + TypeScript frontend. Routes: /courtroom, /results, /replay, /certificate.
Runs on mock scenarios (C2 open debate, C5 signed commit-reveal) until the live Supabase/Realtime feed lands.
Protocol types live in src/protocol/types.ts (copy of the shared contract, to be replaced by a package).
Results come from public/results.json (stub, measured: false). Data shapes in src/contracts.md (PROPOSED).
