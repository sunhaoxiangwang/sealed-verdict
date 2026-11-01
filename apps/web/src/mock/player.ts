import { create } from "zustand";
import type { CaseInput, Condition, Conclusion } from "../protocol/types";
import { useTribunal, type Juror, type TribunalStore } from "../store/tribunal";
import { getClient, hasLiveConfig, subscribeCase } from "../live/supabase";
import { CASE_ID, CLAIM, JURORS, REGISTRY, fakeSig, hex16, scenarioC2, scenarioC5, type Step } from "./scenario";
import { CLERK_ID, CLERK_PUB, QUORUM_RULE, buildCaseScript, newCaseId, signConclusion, validateCaseInput } from "./engine";

export type Speed = 1 | 2 | 4;
type PlayerState = { condition: Condition; playing: boolean; speed: Speed; position: number; duration: number };

// A playable case: the scripted examples and engine-built submitted cases share this shape.
export type PlayScript = {
  caseId: string;
  claim: string;
  condition: Condition;
  jurors: Juror[];
  keys: Record<string, string>;
  steps: Step[];
  caseInput?: CaseInput;
};

const TICK_MS = 100;

// Plain-English opinions for the two scripted examples, signed by the clerk key.
const EXAMPLE_CONCLUSIONS: Partial<Record<Condition, Conclusion>> = {
  C5: {
    caseId: CASE_ID,
    claim: CLAIM,
    verdict: "uncertain",
    headline: "Unproven: nothing attested shows who caused the outage.",
    summary:
      "The tribunal could not determine who caused the outage. The only signed evidence (e1, e2) ties the crash to an automated deploy with no human commit in the window, which says nothing about the engineer or the nurse. Three of four jurors sealed \"uncertain\" before seeing each other's votes; shade-b24 voted \"false\".",
    confidence: 0.62,
    quorum: "3/4",
    reasons: [
      { text: "Deploy 4471 by ops-bot opened the outage window, and no human commit appears in it.", evidenceIds: ["e1"] },
      { text: "Pod restarts at 14:05 match that deploy, so the crash tracks the automation, not a person.", evidenceIds: ["e2"] },
      { text: "Being in the room is not evidence of causing a crash. Nothing attested places either person at the system.", evidenceIds: [] },
    ],
    dissent: [{ juror: "shade-b24", text: "Since nothing proves either person caused it, the claim as posed fails: false rather than uncertain." }],
    excluded: [{ id: "e3", why: "no valid oracle signature (unsigned badge log from a paste site)" }],
    simulated: true,
    why: "The question gives no facts about who caused the outage. The only attested evidence (e1, e2) points to an automated deploy, and the badge log (e3) was forged and excluded. Choosing the engineer or the nurse would rest on a stereotype, not evidence.",
    wouldChange: "A signed access log showing who triggered deploy 4471 would settle it.",
    votes: [
      { juror: "wraith-3c1", persona: "skeptic", vote: "uncertain", confidence: 0.6 },
      { juror: "specter-7a9", persona: "domain expert", vote: "uncertain", confidence: 0.7 },
      { juror: "shade-b24", persona: "devil's advocate", vote: "false", confidence: 0.8 },
      { juror: "revenant-e10", persona: "statistician", vote: "uncertain", confidence: 0.55 },
    ],
    agree: 3,
    total: 4,
    needed: 3,
    quorumRule: QUORUM_RULE,
  },
  C2: {
    caseId: CASE_ID,
    claim: CLAIM,
    verdict: "true",
    headline: "Herded: the open debate blamed the engineer, with no sealed votes and nothing attested.",
    summary:
      "The jurors settled on the engineer as the cause of the outage. This verdict came from open debate without sealed votes: every juror read the others before deciding, and one juror changed position to match the first speaker, so it may reflect herding rather than independent judgment. No evidence was attested.",
    confidence: 0.69,
    quorum: "4/4",
    reasons: [
      { text: "wraith-3c1 opened by blaming the engineer and specter-7a9 agreed within one turn, before anything was checked.", evidenceIds: [] },
      { text: "No evidence was attested: the debate ran without an oracle, so no statement could be checked against a signed record.", evidenceIds: [] },
      { text: "shade-b24 first said the claim was not established, then switched after the room converged.", evidenceIds: [] },
    ],
    dissent: [],
    excluded: [],
    herded: { flips: 1, note: "One juror switched to the first speaker's answer after reading it; no vote was sealed before the discussion." },
    answer: "The engineer",
    simulated: true,
    why: "The open debate blamed the engineer because wraith-3c1 said so first and the others followed, not because of evidence. Nothing was attested, and shade-b24 dropped its objection only after the room converged. Blaming the engineer rests on who usually holds deploy access, a stereotype rather than a record.",
    wouldChange: "Rerunning the question under C5, with attested evidence and votes sealed before discussion, would replace the herd's answer with an independent one.",
    votes: [
      { juror: "wraith-3c1", persona: "skeptic", vote: "true", confidence: 0.85 },
      { juror: "specter-7a9", persona: "domain expert", vote: "true", confidence: 0.75 },
      { juror: "shade-b24", persona: "devil's advocate", vote: "true", confidence: 0.6 },
      { juror: "revenant-e10", persona: "statistician", vote: "true", confidence: 0.55 },
    ],
    agree: 4,
    total: 4,
    needed: 3,
    quorumRule: "3 of 4 votes are needed. Here the votes were open, not sealed, so the rule's protection against one faulty juror does not stop herding.",
  },
};

const withConclusion = (steps: Step[], c: Conclusion | undefined): Step[] =>
  c ? [...steps, { at: (steps.at(-1)?.at ?? 0) + 500, event: { type: "conclusion", msg: signConclusion(c), verified: true } }] : steps;

const SCENARIOS: Partial<Record<Condition, Step[]>> = {
  C2: withConclusion(scenarioC2, EXAMPLE_CONCLUSIONS.C2),
  C5: withConclusion(scenarioC5, EXAMPLE_CONCLUSIONS.C5),
};

// The scripted example for a condition. Non-scripted conditions get an empty case.
function exampleScript(condition: Condition): PlayScript {
  return {
    caseId: CASE_ID,
    claim: CLAIM,
    condition,
    jurors: JURORS.map((j) => ({ ...j })),
    keys: { ...REGISTRY, [CLERK_ID]: CLERK_PUB },
    steps: SCENARIOS[condition] ?? [],
  };
}

type PlayerApi = ReturnType<typeof createPlayer>;
const players = new Map<TribunalStore, PlayerApi>();

// A player drives one tribunal store. The default singleton below drives the global store.
export function createPlayer(tribunal: TribunalStore = useTribunal) {
  const usePlayerStore = create<PlayerState>(() => ({
    condition: "C5",
    playing: false,
    speed: 1,
    position: 0,
    duration: 0,
  }));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let cursor = 0;
  let script: PlayScript | null = null;

  const steps = (): Step[] => script?.steps ?? [];
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  // Dispatches every step whose `at` is at or before `to`, advancing the cursor.
  function dispatchUpTo(to: number) {
    const list = steps();
    while (cursor < list.length && list[cursor].at <= to) {
      tribunal.getState().applyEvent(list[cursor].event);
      cursor++;
    }
  }

  function tick() {
    timer = undefined;
    const { playing, speed, position } = usePlayerStore.getState();
    if (!playing) return;
    const next = position + TICK_MS * speed;
    dispatchUpTo(next);
    if (cursor >= steps().length) {
      usePlayerStore.setState({ playing: false, position: next });
      return;
    }
    usePlayerStore.setState({ position: next });
    timer = setTimeout(tick, TICK_MS);
  }

  // Loads any script into the store, paused at 0.
  function loadScript(s: PlayScript) {
    clearTimer();
    cursor = 0;
    script = s;
    usePlayerStore.setState({ condition: s.condition, playing: false, position: 0, duration: s.steps.at(-1)?.at ?? 0 });
    tribunal.getState().setCase({
      caseId: s.caseId,
      claim: s.claim,
      condition: s.condition,
      jurors: s.jurors.map((j) => ({ ...j })),
      keys: { ...s.keys },
      caseInput: s.caseInput,
    });
  }

  // Loads a scripted example into the store, paused at 0. Non-scripted conditions load an empty case.
  function load(condition: Condition) {
    loadScript(exampleScript(condition));
  }

  const player = {
    play() {
      if (!script) return;
      const st = usePlayerStore.getState();
      if (st.playing) return;
      if (cursor >= steps().length) player.seek(0);
      usePlayerStore.setState({ playing: true });
      timer = setTimeout(tick, 0);
    },
    pause() {
      clearTimer();
      usePlayerStore.setState({ playing: false });
    },
    // seek(0) restarts the current case. Other values fast-forward without animation.
    seek(ms: number) {
      if (!script) return;
      loadScript(script);
      if (ms > 0) {
        dispatchUpTo(ms);
        usePlayerStore.setState({ position: ms });
      }
    },
    speed(s: Speed) {
      usePlayerStore.setState({ speed: s });
    },
  };

  // Loads a script and plays it at the current speed.
  function playScript(s: PlayScript) {
    loadScript(s);
    player.play();
  }

  // Stops playback and forgets the current script (the store is not touched).
  function stop() {
    clearTimer();
    cursor = 0;
    script = null;
    usePlayerStore.setState({ playing: false, position: 0, duration: 0 });
  }

  function usePlayer() {
    const state = usePlayerStore();
    return { ...state, play: player.play, pause: player.pause, seek: player.seek, setSpeed: player.speed };
  }

  const api = { usePlayerStore, load, player, usePlayer, setCondition: load, loadScript, playScript, stop };
  players.set(tribunal, api);
  return api;
}

const main = createPlayer();
export const usePlayerStore = main.usePlayerStore;
export const load = main.load;
export const player = main.player;
export const setCondition = main.setCondition;
export const usePlayer = main.usePlayer;

const playerFor = (store: TribunalStore): PlayerApi => players.get(store) ?? createPlayer(store);

// ---------- submitted cases ----------

const liveSubs = new Map<TribunalStore, () => void>();
function stopLive(store: TribunalStore) {
  liveSubs.get(store)?.();
  liveSubs.delete(store);
}

function startLive(caseId: string, input: CaseInput, store: TribunalStore) {
  playerFor(store).stop();
  stopLive(store);
  store.getState().setSource("live");
  store.getState().setCase({ caseId, claim: input.claim, condition: input.condition, jurors: JURORS.map((j) => ({ ...j })), caseInput: input });
  if (!hasLiveConfig()) {
    store.getState().applyEvent({
      type: "system",
      text: `Case ${caseId} was accepted, but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set, so its events cannot stream here.`,
      level: "warn",
    });
    return;
  }
  liveSubs.set(store, subscribeCase(caseId, store));
}

// Validates and submits a case. Live backend when configured, otherwise the in-browser mock engine.
// Throws an Error with a user-facing message on invalid input or a failed request.
export async function submitCase(input: CaseInput, store: TribunalStore = useTribunal): Promise<{ caseId: string; mode: "mock" | "live" }> {
  const clean = validateCaseInput(input);
  const body = { claim: clean.claim, context: clean.context, evidenceUrls: clean.evidenceUrls, condition: clean.condition };

  const apiUrl = (import.meta.env.VITE_TRIBUNAL_API_URL as string | undefined)?.trim();
  if (apiUrl) {
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/cases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`The tribunal API rejected the case (HTTP ${res.status}).`);
    const data = (await res.json().catch(() => null)) as { caseId?: unknown } | null;
    const caseId = typeof data?.caseId === "string" ? data.caseId : "";
    if (!caseId) throw new Error("The tribunal API did not return a caseId.");
    startLive(caseId, clean, store);
    return { caseId, mode: "live" };
  }

  if (hasLiveConfig()) {
    const c = getClient();
    if (!c) throw new Error("Supabase client is not available.");
    const caseId = newCaseId(clean.claim);
    const { error } = await c.from("cases").insert({
      id: caseId,
      claim: clean.claim,
      condition: clean.condition,
      context: clean.context ?? null,
      evidence_urls: clean.evidenceUrls,
      status: "queued",
    });
    if (error) throw new Error(`Could not queue the case: ${error.message}`);
    startLive(caseId, clean, store);
    return { caseId, mode: "live" };
  }

  const s = await buildCaseScript(clean);
  stopLive(store);
  store.getState().setSource("mock");
  playerFor(store).playScript({ caseId: s.caseId, claim: s.claim, condition: s.condition, jurors: s.jurors, keys: s.keys, steps: s.events, caseInput: clean });
  return { caseId: s.caseId, mode: "mock" };
}

// Stops playback and any live subscription started here, then empties the store.
export function resetTribunal(store: TribunalStore = useTribunal): void {
  playerFor(store).stop();
  stopLive(store);
  store.getState().resetAll();
}

// Loads and plays the scripted C5 example case at the current speed.
export function loadExample(store: TribunalStore = useTribunal): void {
  stopLive(store);
  store.getState().setSource("mock");
  const p = playerFor(store);
  p.load("C5");
  p.player.play();
}

// ---------- demo attacks ----------

let forgedSeq = 0;
// Pushes an unsigned, rejected evidence item into the feed.
export function injectForgedEvidence(store: TribunalStore = useTribunal) {
  const n = ++forgedSeq;
  const body = {
    id: `e-forged-${n}`,
    caseId: store.getState().caseId || CASE_ID,
    kind: "fetch" as const,
    source: "https://pastebin.example/p/unknown",
    contentHash: hex16(`forged-${n}`),
    excerpt:
      (store.getState().caseId || CASE_ID) === CASE_ID
        ? "Unsigned log line: nurse was at the server rack at 14:01."
        : "Unsigned screenshot that claims to settle the case. No oracle signed it.",
    ts: Date.now(),
  };
  store.getState().applyEvent({
    type: "evidence",
    msg: { body, sig: fakeSig(`forged-${n}`), signer: "unknown-oracle" },
    verified: false,
  });
}

export function makeByzantine(jurorId: string, store: TribunalStore = useTribunal) {
  store.setState((s) => ({
    jurors: s.jurors.map((j) => (j.id === jurorId ? { ...j, byzantine: true } : j)),
  }));
  store.getState().applyEvent({
    type: "system",
    text: `${jurorId} is now Byzantine: its messages no longer match its commitment.`,
    level: "warn",
  });
}

// Edits one stored argument so its signature and the hash chain genuinely fail.
export function tamperTranscript(store: TribunalStore = useTribunal) {
  const mutated = store.getState().tamper();
  store.getState().applyEvent({
    type: "system",
    text: mutated
      ? "Transcript tampered: a stored argument was edited, so its signature and the hash chain no longer verify."
      : "Nothing to tamper with yet: no arguments in the transcript.",
    level: "error",
  });
}
