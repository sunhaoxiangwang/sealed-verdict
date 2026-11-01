export type Signed<T> = { body: T; sig: string; signer: string };
export type Evidence = { id: string; caseId: string; kind: "fetch" | "compute"; source: string; contentHash: string; excerpt: string; result?: string; ts: number };
export type Commit = { caseId: string; round: number; juror: string; commitment: string };
export type Verdict = "true" | "false" | "uncertain";
export type Reveal = { caseId: string; round: number; juror: string; vote: Verdict; confidence: number; nonce: string };
export type Argument = { caseId: string; round: number; juror: string; text: string; evidenceIds: string[]; prevHash: string };
export type VerdictCert = { caseId: string; verdict: string; quorum: string; transcriptRoot: string; evidenceIds: string[]; voterSigs: string[] };
export type PhaseChange = { caseId: string; phase: Phase };
export type Phase = "idle" | "attest" | "commit" | "reveal" | "deliberate" | "verdict";
export type Condition = "C0" | "C1" | "C2" | "C3" | "C4" | "C5";
// What a person submits for the jurors to decide.
export type CaseInput = { claim: string; context?: string; evidenceUrls: string[]; condition: "C2" | "C5" };
// The tribunal's opinion in plain English, issued after the verdict certificate.
export type Conclusion = {
  caseId: string;
  claim: string;
  verdict: Verdict;
  headline: string; // one plain-English sentence
  summary: string; // 2-4 sentences, the tribunal's opinion, paraphrasing the claim
  confidence: number; // 0..1
  quorum: string; // e.g. "3/4"
  reasons: { text: string; evidenceIds: string[] }[]; // 2-4
  dissent: { juror: string; text: string }[]; // 0-2 (juror = pseudonym)
  excluded: { id: string; why: string }[]; // evidence not counted
  herded?: { flips: number; note: string }; // C2 only
  simulated: boolean; // true when produced by the in-browser mock engine
  /** Set for which/who questions when the tribunal names an answer, e.g. "The engineer" (open debate herding). The UI shows it instead of TRUE/FALSE. */
  answer?: string;
  why: string; // 2-3 plain-English sentences: exactly why this verdict, naming the evidence ids that decided it or noting their absence
  wouldChange?: string; // uncertain: what attested evidence would settle it; true/false: what would overturn it (one sentence)
  votes: { juror: string; persona: string; vote: Verdict; confidence: number }[]; // the four revealed sealed votes
  agree: number; // jurors who voted with the verdict, e.g. 3
  total: number; // 4
  needed: number; // 3 (2f+1 with f=1)
  quorumRule: string; // "3 of 4 sealed votes are needed. The rule tolerates one faulty or dishonest juror."
};
export type TribunalEvent =
  | { type: "evidence"; msg: Signed<Evidence>; verified: boolean }
  | { type: "commit"; msg: Signed<Commit>; verified: boolean }
  | { type: "reveal"; msg: Signed<Reveal>; verified: boolean }
  | { type: "argument"; msg: Signed<Argument>; verified: boolean; unattested: boolean; stance?: "true" | "false" | "uncertain" }
  | { type: "verdict"; msg: Signed<VerdictCert>; verified: boolean }
  | { type: "conclusion"; msg: Signed<Conclusion>; verified: boolean }
  | { type: "phase"; msg: PhaseChange }
  | { type: "system"; text: string; level: "info" | "warn" | "error" };
