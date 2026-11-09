import { create } from "zustand";
import { useTribunal } from "../store/tribunal";
import { verifyWire } from "../protocol/crypto";
import { verifyBundle, type ProtocolBundle, type LedgerEntry, type Registry } from "../protocol/native";
import type { Phase, TribunalEvent } from "../protocol/types";

export type AMLCase = { id: string; title: string; question: string; description: string; source: string; choices: string[]; context: {source: string; content: string}[] };
type Snapshot = {
  input: AMLCase;
  panel: { id: string; provider: string; role: string }[];
  run: null | { caseId: string; status: string; stage: string; error?: string; assessments?: {juror: string; answer: string; reason: string}[]; events: { text?: string; result?: { reason: string; missingInformation: string[] }; stage: string }[] };
  registry: Registry | null;
  actor: null | { phase: { phase: Phase; round: number; closed: boolean } };
  transcript: LedgerEntry[];
  bundle: ProtocolBundle | null;
  missingKeys: string[];
  terseMode: string;
};
export const useAML = create<{ snapshot?: Snapshot; error?: string; pendingCase?: AMLCase }>(() => ({}));
const personas = ["domain expert", "skeptic", "statistician", "devil's advocate"];

export function subscribeAML() {
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  let current = "", seq = -1, eventCount = 0, lastPhase = "", certSeen = false;
  const poll = async () => {
    try {
      const response = await fetch("/api/aml", { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error((await response.json()).error || "AML service unavailable");
      const data: Snapshot = await response.json();
      if (stopped) return;
      useAML.setState({ snapshot: data, error: undefined });
      if (data.run && current !== data.run.caseId) {
        current = data.run.caseId; seq = -1; eventCount = 0; lastPhase = ""; certSeen = false;
        useTribunal.getState().setSource("live");
        useTribunal.getState().setCase({ caseId: current, claim: data.input.question, condition: "C5", jurors: data.panel.map((j, i) => ({
          id: j.id, pseudonym: j.id, persona: personas[i], model: j.provider, byzantine: false, committed: false, revealed: false, speaking: false,
        })) });
      }
      for (const e of data.run?.events.slice(eventCount) || []) {
        useTribunal.getState().applyEvent({ type: "system", text: `${e.stage}: ${e.text || e.result?.reason || ""}${e.result?.missingInformation.length ? ` Missing: ${e.result.missingInformation.join("; ")}` : ""}`, level: e.stage === "error" ? "error" : "info" });
      }
      eventCount = data.run?.events.length || 0;
      const reg = data.registry;
      for (const entry of data.transcript.filter(e => e.seq > seq)) {
        seq = entry.seq;
        const { kind, msg } = entry;
        if (kind === "phase") {
          if (verifyWire("phase", msg, reg?.clerk)) {
            const p = msg.body.phase;
            const next: Phase = p === "attest" || p === "deliberate" ? "commit" : p === "commit" ? "reveal" : msg.body.round === 0 ? "deliberate" : "verdict";
            useTribunal.getState().applyEvent({ type: "phase", msg: { caseId: current, phase: next } });
          }
          continue;
        }
        const key = kind === "evidence" ? reg?.oracle : reg?.jurors.find(j => j.id === msg.body.juror)?.pubkey;
        const verified = entry.status === "accepted" && verifyWire(kind, msg, key);
        if (entry.status === "rejected") {
          useTribunal.getState().applyEvent({ type: "system", text: `Rejected ${kind}: ${entry.reason}`, level: "error" });
          continue;
        }
        if (["evidence", "commit", "reveal", "argument"].includes(kind)) {
          useTribunal.getState().applyEvent({ type: kind, msg, verified, unattested: entry.status === "unattested" } as TribunalEvent);
        }
      }
      const phase = data.actor?.phase;
      if (phase && !phase.closed && lastPhase !== `${phase.phase}/${phase.round}`) {
        lastPhase = `${phase.phase}/${phase.round}`;
        if (useTribunal.getState().phase !== phase.phase) useTribunal.getState().applyEvent({ type: "phase", msg: { caseId: current, phase: phase.phase } });
      }
      if (data.bundle && !certSeen) {
        const report = await verifyBundle(data.bundle);
        if (stopped) return;
        certSeen = true;
        useTribunal.getState().setProtocolBundle(data.bundle);
        useTribunal.getState().setChainBroken(!report.valid);
        useTribunal.getState().applyEvent({ type: "system", text: report.valid ? "Rust/WASM certificate verification passed. Human compliance review remains pending." : report.failures.join("; "), level: report.valid ? "info" : "error" });
      }
    } catch (error) {
      if (!stopped) useAML.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally { if (!stopped) timer = setTimeout(poll, 1000); }
  };
  void poll();
  return () => { stopped = true; clearTimeout(timer); };
}

export async function startAML() {
  const response = await fetch("/api/aml/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ case: useAML.getState().pendingCase }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  useAML.setState({ pendingCase: undefined });
}
