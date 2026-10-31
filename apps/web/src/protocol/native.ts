import initWasm, { verifyCertJson } from "../../../../packages/protocol/wasm/pkg/sealed_verdict_protocol.js";
import type { Signed, Reveal } from "./types";

export type Registry = { ledger: string; clerk: string; oracle: string; jurors: { id: string; pubkey: string }[] };
export type LedgerEntry = { seq: number; ts: number; kind: string; status: string; reason?: string; msg: Signed<any> };
export type ProtocolBundle = {
  cert: Signed<{ caseId: string; verdict: string; quorum: { needed: number; counted: number; n: number }; transcriptRoot: string; evidenceIds: string[]; votes: Signed<Reveal>[]; registry: Registry }>;
  transcript: LedgerEntry[];
};
export type VerifyReport = { valid: boolean; failures: string[] };
let ready: ReturnType<typeof initWasm> | undefined;
export async function verifyBundle(bundle: ProtocolBundle): Promise<VerifyReport> {
  ready ??= initWasm();
  try { await ready; } catch (error) { ready = undefined; throw error; }
  return JSON.parse(verifyCertJson(JSON.stringify(bundle)));
}
