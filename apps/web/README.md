# Sealed Verdict — web

Courtroom, results dashboard, C2-vs-C5 replay and verdict certificate for the Sealed Verdict tribunal.

## Run

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:5173
npm run typecheck && npm run build
```

Deploy a preview: `vercel deploy --yes` from this folder (vercel.json has the SPA rewrite and install command).

## Pages

- `/courtroom` — 3D tribunal (react-three-fiber). Mock player by default; LIVE toggle subscribes to Supabase when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set (see `src/contracts.md`).
  Debug: `?top=1` top-down camera, `?hide=bench,jurors,seal,cards`.
- `/results` — ablation ladder from `public/results.json`. Data scientist: drop the real file there and set `"measured": true` to remove the ILLUSTRATIVE label.
- `/replay` — same case under open debate (C2) and the signed protocol (C5), side by side.
- `/certificate` — verdict certificate with in-browser Ed25519 + hash-chain verification; Tamper breaks the seal.

## Demo script (2 min)

1. Courtroom, Play at 2x: evidence attested (one FORGED in red), four sealed commits, reveals, deliberation, seal drops.
2. Click "Make juror Byzantine": it turns green and argues hard; quorum holds 3/4.
3. Certificate: Verify (five green checks). Tamper transcript, Verify again (seal cracks, chain fails).
4. Replay: C2 herds to "the engineer"; C5 holds "uncertain".
5. Results: walk the ladder C0→C5.

## Layout

- `src/scene/` 3D scene (Blender assets in `public/models`, built from `assets/blender/sealed-verdict.blend`)
- `src/store/tribunal.ts` zustand event store; `src/mock/` scripted cases + player; `src/live/` Supabase source
- `src/protocol/` shared types, crypto (noble ed25519), audit checklist
