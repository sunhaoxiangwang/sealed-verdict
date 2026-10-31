import { create } from "zustand";
import type { Argument, Condition, Evidence, Phase, Signed, TribunalEvent, VerdictCert } from "../protocol/types";
import { verify } from "../protocol/crypto";

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
  firstVote?: "true" | "false" | "uncertain";
  flipped?: boolean;
};

export type StoredMessage =
  | { kind: "evidence" | "commit" | "reveal"; msg: Signed<any>; verified: boolean }
  | { kind: "argument"; msg: Signed<Argument>; verified: boolean };

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
  certSigned?: Signed<VerdictCert>;
  messages: StoredMessage[];
  keys: Record<string, string>;
  chainBroken: boolean;
  source: "mock" | "live";
};

type TribunalActions = {
  applyEvent: (e: TribunalEvent) => void;
  setCase: (c: { caseId: string; claim: string; condition: Condition; jurors: Juror[]; keys?: Record<string, string> }) => void;
  tamper: () => boolean;
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
  certSigned: undefined,
  messages: [],
  keys: {},
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

export type TribunalStore = ReturnType<typeof createTribunalStore>;

export function createTribunalStore() {
  return create<TribunalState & TribunalActions>()((set, get) => ({
  ...initial,

  applyEvent: (e) => {
    set((s): Partial<TribunalState> => {
      // Real verification against the key registry; fall back to the event flag for unknown signers.
      const check = (m: Signed<unknown>, flag: boolean) => {
        const pub = s.keys[m.signer];
        return pub ? verify(m, pub) : flag;
      };
      const voteInfo = (id: string, v: "true" | "false" | "uncertain") => {
        const j = s.jurors.find((x) => x.id === id);
        return { firstVote: j?.firstVote ?? v, flipped: !!j?.flipped || (j?.firstVote !== undefined && j.firstVote !== v) };
      };
      switch (e.type) {
        case "evidence": {
          const b = e.msg.body;
          const ok = check(e.msg, e.verified);
          return {
            evidence: [...s.evidence, b],
            messages: [...s.messages, { kind: "evidence", msg: e.msg, verified: ok }],
            feed: [...s.feed, mkItem("evidence", `${b.kind} ${b.source}: ${b.excerpt}`, { verified: ok, evidenceIds: [b.id] })],
          };
        }
        case "commit": {
          const { juror, commitment } = e.msg.body;
          const ok = check(e.msg, e.verified);
          return {
            jurors: upd(s.jurors, juror, { committed: true }),
            messages: [...s.messages, { kind: "commit", msg: e.msg, verified: ok }],
            feed: [...s.feed, mkItem("commit", `committed ${commitment}`, { juror, verified: ok })],
          };
        }
        case "reveal": {
          const { juror, vote, confidence } = e.msg.body;
          const ok = check(e.msg, e.verified);
          return {
            jurors: upd(s.jurors, juror, { revealed: true, vote, confidence, ...voteInfo(juror, vote) }),
            messages: [...s.messages, { kind: "reveal", msg: e.msg, verified: ok }],
            feed: [...s.feed, mkItem("reveal", `revealed ${vote} (confidence ${confidence})`, { juror, verified: ok })],
          };
        }
        case "argument": {
          const { juror, text, evidenceIds } = e.msg.body;
          const ok = check(e.msg, e.verified);
          return {
            jurors: upd(s.jurors, juror, { speaking: true, lastSpokeAt: Date.now(), ...(e.stance ? { vote: e.stance, ...voteInfo(juror, e.stance) } : {}) }),
            messages: [...s.messages, { kind: "argument", msg: e.msg, verified: ok }],
            feed: [...s.feed, mkItem("argument", text, { juror, verified: ok, unattested: e.unattested, evidenceIds })],
          };
        }
        case "verdict": {
          const c = e.msg.body;
          const ok = check(e.msg, e.verified);
          return {
            certificate: c,
            certSigned: e.msg,
            phase: "verdict",
            feed: [...s.feed, mkItem("verdict", `verdict: ${c.verdict} (quorum ${c.quorum})`, { verified: ok })],
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

  setCase: ({ caseId, claim, condition, jurors, keys }) =>
    set({ ...initial, caseId, claim, condition, jurors, keys: keys ?? {}, chainBroken: false, source: get().source }),

  // Mutates one stored Argument's text so the signature and hash chain genuinely fail.
  tamper: () => {
    const args = get().messages.map((m, i) => ({ m, i })).filter((x) => x.m.kind === "argument");
    if (args.length === 0) return false;
    const target = args[Math.min(1, args.length - 1)];
    set((s) => ({
      chainBroken: true,
      messages: s.messages.map((m, i) =>
        i === target.i && m.kind === "argument"
          ? { ...m, msg: { ...m.msg, body: { ...m.msg.body, text: m.msg.body.text + " [edited]" } } }
          : m,
      ),
    }));
    return true;
  },

  reset: () => set({ ...initial, source: get().source }),

  setChainBroken: (b) => set({ chainBroken: b }),

  setSource: (s) => set({ source: s }),
}));
}

export const useTribunal = createTribunalStore();
