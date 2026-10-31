import { create } from "zustand";
import type { Condition } from "../protocol/types";
import { useTribunal, type TribunalStore } from "../store/tribunal";
import { CASE_ID, CLAIM, JURORS, REGISTRY, fakeSig, hex16, scenarioC2, scenarioC5, type Step } from "./scenario";

export type Speed = 1 | 2 | 4;
type PlayerState = { condition: Condition; playing: boolean; speed: Speed; position: number; duration: number };

const SCENARIOS: Partial<Record<Condition, Step[]>> = { C2: scenarioC2, C5: scenarioC5 };
const TICK_MS = 100;

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

  const steps = (): Step[] => SCENARIOS[usePlayerStore.getState().condition] ?? [];
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

  // Loads a scenario into the store, paused at 0. Non-scripted conditions load an empty case.
  function load(condition: Condition) {
    clearTimer();
    cursor = 0;
    usePlayerStore.setState({ condition, playing: false, position: 0, duration: steps().at(-1)?.at ?? 0 });
    tribunal.getState().setCase({
      caseId: CASE_ID,
      claim: CLAIM,
      condition,
      jurors: JURORS.map((j) => ({ ...j })),
      keys: { ...REGISTRY },
    });
  }

  const player = {
    play() {
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
    // seek(0) restarts the scenario. Other values fast-forward without animation.
    seek(ms: number) {
      const cond = usePlayerStore.getState().condition;
      load(cond);
      if (ms > 0) {
        dispatchUpTo(ms);
        usePlayerStore.setState({ position: ms });
      }
    },
    speed(s: Speed) {
      usePlayerStore.setState({ speed: s });
    },
  };

  function usePlayer() {
    const state = usePlayerStore();
    return { ...state, play: player.play, pause: player.pause, seek: player.seek, setSpeed: player.speed };
  }

  return { usePlayerStore, load, player, usePlayer, setCondition: load };
}

const main = createPlayer();
export const usePlayerStore = main.usePlayerStore;
export const load = main.load;
export const player = main.player;
export const setCondition = main.setCondition;
export const usePlayer = main.usePlayer;

let forgedSeq = 0;
// Pushes an unsigned, rejected evidence item into the feed.
export function injectForgedEvidence(store: TribunalStore = useTribunal) {
  const n = ++forgedSeq;
  const body = {
    id: `e-forged-${n}`,
    caseId: CASE_ID,
    kind: "fetch" as const,
    source: "https://pastebin.example/p/unknown",
    contentHash: hex16(`forged-${n}`),
    excerpt: "Unsigned log line: nurse was at the server rack at 14:01.",
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
