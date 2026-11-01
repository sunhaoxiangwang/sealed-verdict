import { useEffect, useState, type SVGProps } from "react";
import { injectForgedEvidence, makeByzantine, resetTribunal, tamperTranscript, usePlayer, type Speed } from "../mock/player";
import { hasLiveConfig, listRecentCases, subscribeCase } from "../live/supabase";
import { useTribunal } from "../store/tribunal";
import { IconFilePlus, IconPause, IconPencil, IconPlay, IconReplay, IconUserX } from "./icons";

const SPEEDS: Speed[] = [1, 2, 4];
const FALLBACK_CASE = "demo";

// The "watch a case by id" subscription lives at module level so Reset, New case and Submit can stop it too.
let watchUnsub: (() => void) | null = null;

/** Stops the live case this bar is watching, if any. */
export function stopWatching() {
  watchUnsub?.();
  watchUnsub = null;
}

/** Back to an empty courtroom: stops playback and every live subscription, keeps the MOCK/LIVE source. */
export function resetCourt() {
  stopWatching();
  resetTribunal();
}

const IconEraser = (p: Omit<SVGProps<SVGSVGElement>, "children">) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
    <path d="M7 21l-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="M5 11l9 9" />
  </svg>
);

export default function DemoControls() {
  const { playing, speed, play, pause, seek, setSpeed } = usePlayer();
  const source = useTribunal((s) => s.source);
  const status = useTribunal((s) => s.status);
  const jurors = useTribunal((s) => s.jurors);
  const target = jurors.find((j) => !j.byzantine)?.id;
  const live = source === "live";
  const empty = status === "empty";
  const configured = hasLiveConfig();
  const [caseInput, setCaseInput] = useState("");

  const connect = (caseId: string) => {
    stopWatching();
    resetTribunal();
    useTribunal.getState().setSource("live");
    watchUnsub = subscribeCase(caseId);
  };

  async function defaultCase(): Promise<string> {
    try {
      const [latest] = await listRecentCases(1);
      return latest?.id ?? FALLBACK_CASE;
    } catch {
      return FALLBACK_CASE;
    }
  }

  async function goLive() {
    resetCourt();
    useTribunal.getState().setSource("live");
    let id = caseInput.trim();
    if (!id) {
      id = await defaultCase();
      if (useTribunal.getState().source !== "live") return;
      setCaseInput(id);
    }
    connect(id);
  }

  // Back to mock: an empty courtroom, ready for a new case.
  function goMock() {
    resetCourt();
    useTribunal.getState().setSource("mock");
  }

  // Stop the live subscription if the controls unmount while live.
  useEffect(
    () => () => {
      if (watchUnsub) {
        stopWatching();
        useTribunal.getState().setSource("mock");
      }
    },
    [],
  );

  const badgeTitle = !configured ? "Live mode is off: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY" : live ? "Switch to mock" : "Switch to live Supabase events";
  const noCase = empty ? "Submit a case first" : undefined;

  return (
    <div className="controls" role="group" aria-label="Case controls">
      <div className="controls-group">
        <button className="btn btn-primary" onClick={playing ? pause : play} disabled={live || empty} title={noCase}>
          {playing ? <IconPause /> : <IconPlay />}
          {playing ? "Pause" : "Play"}
        </button>
        <button className="btn btn-ghost" onClick={() => { seek(0); play(); }} disabled={live || empty} title={noCase}>
          <IconReplay />
          Replay
        </button>
        <button className="btn btn-ghost" onClick={() => resetCourt()} disabled={empty} title={empty ? "Nothing to reset" : "Clear the courtroom and start a new case"}>
          <IconEraser />
          Reset
        </button>
        <div className="seg" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} className="seg-item" aria-pressed={speed === s} disabled={live} onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
      </div>
      <div className="controls-group controls-attacks" role="group" aria-label="Attacks">
        <button className="btn btn-ghost btn-danger" disabled={live || empty} title={noCase} onClick={() => injectForgedEvidence()}>
          <IconFilePlus />
          Forge evidence
        </button>
        <button className="btn btn-ghost btn-danger" disabled={live || empty || !target} title={noCase} onClick={() => target && makeByzantine(target)}>
          <IconUserX />
          Byzantine juror
        </button>
        <button className="btn btn-ghost btn-danger" disabled={empty} title={noCase} onClick={() => tamperTranscript()}>
          <IconPencil />
          Tamper transcript
        </button>
      </div>
      <div className="controls-group controls-source">
        {live && (
          <input
            className="field"
            aria-label="Case id"
            placeholder="case id"
            value={caseInput}
            onChange={(e) => setCaseInput(e.target.value)}
            onKeyDown={(e) => {
              const id = caseInput.trim();
              if (e.key === "Enter" && id) connect(id);
            }}
          />
        )}
        <span title={badgeTitle}>
          <button
            type="button"
            role="switch"
            aria-checked={live}
            aria-label="Live data"
            className={`switch source-${source}`}
            disabled={!configured}
            title={badgeTitle}
            onClick={() => (live ? goMock() : void goLive())}
          >
            <span className="switch-opt">MOCK</span>
            <span className="switch-track" aria-hidden="true">
              <span className="switch-knob" />
            </span>
            <span className="switch-opt">LIVE</span>
          </button>
        </span>
      </div>
    </div>
  );
}
