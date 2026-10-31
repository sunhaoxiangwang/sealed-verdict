export type Signed<T> = { body: T; sig: string; signer: string };
export type Evidence = { id: string; caseId: string; kind: "fetch" | "compute"; source: string; contentHash: string; excerpt: string; result?: string; ts: number };
export type Commit = { caseId: string; round: number; juror: string; commitment: string };
export type Reveal = { caseId: string; round: number; juror: string; vote: "true" | "false" | "uncertain"; confidence: number; nonce: string };
export type Argument = { caseId: string; round: number; juror: string; text: string; evidenceIds: string[]; prevHash: string };
export type VerdictCert = { caseId: string; verdict: string; quorum: string; transcriptRoot: string; evidenceIds: string[]; voterSigs: string[] };
export type PhaseChange = { caseId: string; phase: Phase };
export type Phase = "idle" | "attest" | "commit" | "reveal" | "deliberate" | "verdict";
export type Condition = "C0" | "C1" | "C2" | "C3" | "C4" | "C5";
export type TribunalEvent =
  | { type: "evidence"; msg: Signed<Evidence>; verified: boolean }
  | { type: "commit"; msg: Signed<Commit>; verified: boolean }
  | { type: "reveal"; msg: Signed<Reveal>; verified: boolean }
  | { type: "argument"; msg: Signed<Argument>; verified: boolean; unattested: boolean }
  | { type: "verdict"; msg: Signed<VerdictCert>; verified: boolean }
  | { type: "phase"; msg: PhaseChange }
  | { type: "system"; text: string; level: "info" | "warn" | "error" };
