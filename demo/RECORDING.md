# Recording plan: all five judging criteria

Use the deployed live AML application. Keep the same case ID visible in the
frontend, backend evidence, and certificate. Never show `.env`, agent tokens,
private ballot files, or a signed preview URL in the recording.

| Criterion (20% each) | What the recording must show | Presenter script |
| --- | --- | --- |
| Real-Time AI and Track Technology | Start a fresh case. Show live triage, investigation, and panel updates. Show all three provider names, admitted Relay messages, and hosted Terse state. | “These are real OpenAI, Gemini, and Anthropic calls. Agent Relay carries the panel's encrypted ballot intents and protocol messages. The Rust Clerk admits them, and hosted Terse persists each entry before the next phase opens.” |
| Originality and Creativity | Show commitment hashes before revealed votes, then the signed transcript and certificate. | “The idea is independent judgment before discussion. Jurors commit to hidden ballots, reveal only after the Clerk closes that phase, then exchange evidence-based arguments and vote again. Encrypted intents keep ballot contents hidden from Relay's searchable message bodies.” |
| Execution and Demo | A completed real case, four final ballots, Verify PASS → Tamper FAIL → Restore PASS; show an actual backend verification result. | “Here is the completed case. The browser runs the same Rust verifier through WebAssembly. Editing one argument breaks verification. Restoring the original restores the valid certificate. The backend independently checks the same bundle.” |
| User Experience and Design | Case upload, readable input evidence, courtroom phase ribbon, live transcript, a plain-language conclusion and clear verification actions. | “Upload a case, review its evidence, and run the analysis. The courtroom shows sealed commitments, reveals and deliberation. The conclusion includes supporting judgment, and one button verifies the result.” |
| Potential and Impact | Real AML source and recommendation; human-review status; proposed integration with analyst case management. | “For AML review, a recommendation needs an audit trail. This prototype packages the evidence, votes, and protocol history for an analyst or examiner. The next step is private bank-data intake and authenticated human sign-off. This demo does not file a SAR.” |

## Suggested sequence

1. **Problem and source:** introduce the real DOJ cash-network record. Explain
   that it contains published aggregate facts, not private transaction rows.
2. **Live case:** click Run AML case. Show the phase changes and actual model
   response notifications. If waits are shortened in editing, label them.
3. **Technology proof:** show the same case ID, actual provider names, Relay
   admissions and phase-close counts, hosted Terse transcript, and Supabase
   archive location. SuperServe hosts the application; Supabase archives the
   completed bundle; neither replaces Relay transport or Terse state.
4. **Trust demonstration:** Verify → Tamper → Verify → Restore → Verify.
5. **Impact and boundary:** human review remains pending. Explain the next
   integration step without presenting it as implemented.

## Claims to avoid

- Do not claim that this run proves reduced bias or improved AML accuracy.
  Commit–reveal enforces the demonstrated protocol, not model correctness.
- Do not claim that the DOJ signed the exhibits. The application oracle
  attests supplied excerpts from the linked public source.
- Do not claim an independent human has approved or filed a SAR.
- Do not claim signing keys or an in-flight case survive a daemon crash.
  Completed records persist; interrupted cases restart with fresh signing keys.
- Do not present the old synthetic C2/C5 comparison or mock results as this
  live case's measured performance.

The uncut live recording is the execution evidence. A shorter presentation
may edit waits, provided the edit is labelled and preserves the actual events.
