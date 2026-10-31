# Sealed Verdict — product truth

**What it is.** A jury of AI agents (Durable Actors) that deliberates over Agent Relay, casts blind commit-reveal votes, cites oracle-signed evidence, and issues a cryptographically sealed VerdictCertificate anyone can verify in the browser. Built at Haunted Hacks (San Francisco, 2026-10-31).

**Mechanism in one sentence.** Separate facts from judgment: facts are attested by signing oracles and never voted on; jurors debate only the judgment layer, blind first, pseudonymous, and every argument must cite signed evidence.

**Claim we can prove.** Open multi-agent debate herds toward the most confident voice (bias goes up); the protocol brings measured bias below a single-model baseline. Proof is the pre-registered C0–C5 ablation ladder on BBQ ambiguous items (illustrative numbers until the data scientist's `results.json` lands).

**Audience and scene.** Hackathon judges watching a 2-minute live demo on a laptop in a noisy room, then AI eval teams who grade model outputs with LLM judges. They need to see the mechanism happen, not read about it.

**Surfaces.**
- `/courtroom` (Experience): the 3D tribunal where the case plays out. Must show attest → commit → reveal → deliberate → verdict, plus three attacks (forged evidence, Byzantine juror, tampered transcript).
- `/results` (Read): the ablation ladder with CIs.
- `/replay` (Read): the same case under open debate vs the signed protocol.
- `/certificate` (Operate): the signed certificate with Verify and Tamper.

**Must remain true.** Signatures prove provenance and integrity, not truth. Verified green, forged red, uncertain amber. Pseudonyms are the jurors' public identity. Nothing claims real measured results until `measured: true`.

**Constraints.** Vite + React 19, no new runtime dependencies beyond what is installed, phone-width must work, demo laptop may be offline (self-host fonts and assets), feature freeze 15:15 today.

**Event theme.** Halloween. The product name is Sealed Verdict; the tribunal skin is "Tribunal of the Dead".
