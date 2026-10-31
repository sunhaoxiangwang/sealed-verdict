import { create } from "zustand";
import type { Condition, Evidence, Phase, TribunalEvent, VerdictCert } from "../protocol/types";

export type Juror = {
  id: string;
  pseudonym: string;
  persona: string;
  model: string;
  byzantine: boolean;
  committed: boolean;
  revealed: boolean;
  vote?: "true" | "false" | "uncertain";
  confidence?: number;
  speaking: boolean;
  lastSpokeAt?: number;
};

export type FeedItem = {
  id: string;
  ts: number;
  kind: TribunalEvent["type"];
  juror?: string;
  text: string;
  verified: boolean;
  unattested?: boolean;
  evidenceIds?: string[];
};

export type TribunalState = {
  caseId: string;
  claim: string;
  condition: Condition;
  phase: Phase;
  jurors: Juror[];
  evidence: Evidence[];
  feed: FeedItem[];
  certificate?: VerdictCert;
  chainBroken: boolean;
  source: "mock" | "live";
};

type TribunalActions = {
  applyEvent: (e: TribunalEvent) => void;
  setCase: (c: { caseId: string; claim: string; condition: Condition; jurors: Juror[] }) => void;
  reset: () => void;
  setChainBroken: (b: boolean) => void;
  setSource: (s: "mock" | "live") => void;
};

const initial: TribunalState = {
  caseId: "",
  claim: "",
  condition: "C5",
  phase: "idle",
  jurors: [],
  evidence: [],
  feed: [],
  certificate: undefined,
  chainBroken: false,
  source: "mock",
};

let seq = 0;
const nextId = () => `f${Date.now().toString(36)}-${++seq}`;
const mkItem = (kind: FeedItem["kind"], text: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  id: nextId(),
  ts: Date.now(),
  kind,
  text,
  verified: true,
  ...extra,
});
const upd = (jurors: Juror[], id: string, patch: Partial<Juror>) =>
  jurors.map((j) => (j.id === id ? { ...j, ...patch } : j));

export const useTribunal = create<TribunalState & TribunalActions>()((set, get) => ({
  ...initial,

  applyEvent: (e) => {
    set((s): Partial<TribunalState> => {
      switch (e.type) {
        case "evidence": {
          const b = e.msg.body;
          return {
            evidence: [...s.evidence, b],
            feed: [...s.feed, mkItem("evidence", `${b.kind} ${b.source}: ${b.excerpt}`, { verified: e.verified, evidenceIds: [b.id] })],
          };
        }
        case "commit": {
          const { juror, commitment } = e.msg.body;
          return {
            jurors: upd(s.jurors, juror, { committed: true }),
            feed: [...s.feed, mkItem("commit", `committed ${commitment}`, { juror, verified: e.verified })],
          };
        }
        case "reveal": {
          const { juror, vote, confidence } = e.msg.body;
          return {
            jurors: upd(s.jurors, juror, { revealed: true, vote, confidence }),
            feed: [...s.feed, mkItem("reveal", `revealed ${vote} (confidence ${confidence})`, { juror, verified: e.verified })],
          };
        }
        case "argument": {
          const { juror, text, evidenceIds } = e.msg.body;
          return {
            jurors: upd(s.jurors, juror, { speaking: true, lastSpokeAt: Date.now() }),
            feed: [...s.feed, mkItem("argument", text, { juror, verified: e.verified, unattested: e.unattested, evidenceIds })],
          };
        }
        case "verdict": {
          const c = e.msg.body;
          return {
            certificate: c,
            phase: "verdict",
            feed: [...s.feed, mkItem("verdict", `verdict: ${c.verdict} (quorum ${c.quorum})`, { verified: e.verified })],
          };
        }
        case "phase":
          return { phase: e.msg.phase, feed: [...s.feed, mkItem("phase", `phase: ${e.msg.phase}`)] };
        case "system":
          return { feed: [...s.feed, mkItem("system", e.text, { verified: e.level !== "error" })] };
      }
    });

    if (e.type === "argument") {
      const who = e.msg.body.juror;
      setTimeout(() => set((s) => ({ jurors: upd(s.jurors, who, { speaking: false }) })), 4000);
    }
  },

  setCase: ({ caseId, claim, condition, jurors }) =>
    set({ ...initial, caseId, claim, condition, jurors, chainBroken: false, source: get().source }),

  reset: () => set({ ...initial, source: get().source }),

  setChainBroken: (b) => set({ chainBroken: b }),

  setSource: (s) => set({ source: s }),
}));
