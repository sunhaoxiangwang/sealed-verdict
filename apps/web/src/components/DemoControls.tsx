import { useEffect, useRef, useState } from "react";
import { injectForgedEvidence, load, makeByzantine, tamperTranscript, usePlayer, type Speed } from "../mock/player";
import { hasLiveConfig, listRecentCases, subscribeCase } from "../live/supabase";
import { useTribunal } from "../store/tribunal";
import { IconFilePlus, IconPause, IconPencil, IconPlay, IconReplay, IconUserX } from "./icons";

const SPEEDS: Speed[] = [1, 2, 4];
const FALLBACK_CASE = "demo";

export default function DemoControls() {
  const { playing, speed, play, pause, seek, setSpeed } = usePlayer();
  const source = useTribunal((s) => s.source);
  const jurors = useTribunal((s) => s.jurors);
  const target = jurors.find((j) => !j.byzantine)?.id;
  const live = source === "live";
  const configured = hasLiveConfig();
  const [caseInput, setCaseInput] = useState("");
  const unsubRef = useRef<(() => void) | null>(null);

  const stopLive = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  const connect = (caseId: string) => {
    stopLive();
    useTribunal.getState().reset();
    useTribunal.getState().setSource("live");
    unsubRef.current = subscribeCase(caseId);
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
    pause();
    useTribunal.getState().reset();
    useTribunal.getState().setSource("live");
    let id = caseInput.trim();
    if (!id) {
      id = await defaultCase();
      if (useTribunal.getState().source !== "live") return;
      setCaseInput(id);
    }
    connect(id);
  }

  function goMock() {
    stopLive();
    useTribunal.getState().setSource("mock");
    load("C5");
  }

  // Stop the live subscription if the controls unmount while live.
  useEffect(
    () => () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
        useTribunal.getState().setSource("mock");
      }
    },
    [],
  );

  const badgeTitle = !configured ? "Live mode is off: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY" : live ? "Switch to mock" : "Switch to live Supabase events";

  return (
    <div className="controls" role="group" aria-label="Case controls">
      <div className="controls-group">
        <button className="btn btn-primary" onClick={playing ? pause : play} disabled={live}>
          {playing ? <IconPause /> : <IconPlay />}
          {playing ? "Pause" : "Play"}
        </button>
        <button className="btn btn-ghost" onClick={() => { seek(0); play(); }} disabled={live}>
          <IconReplay />
          Replay
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
        <button className="btn btn-ghost btn-danger" disabled={live} onClick={() => injectForgedEvidence()}>
          <IconFilePlus />
          Forge evidence
        </button>
        <button className="btn btn-ghost btn-danger" disabled={live || !target} onClick={() => target && makeByzantine(target)}>
          <IconUserX />
          Byzantine juror
        </button>
        <button className="btn btn-ghost btn-danger" onClick={() => tamperTranscript()}>
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
