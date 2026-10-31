import { useEffect, useRef, useState } from "react";
import { injectForgedEvidence, load, makeByzantine, tamperTranscript, usePlayer, type Speed } from "../mock/player";
import { hasLiveConfig, listRecentCases, subscribeCase } from "../live/supabase";
import { useTribunal } from "../store/tribunal";

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

  const badgeTitle = !configured ? "set VITE_SUPABASE_URL" : live ? "Switch to mock" : "Switch to live Supabase events";

  return (
    <div className="demo-controls">
      <button onClick={playing ? pause : play} disabled={live}>{playing ? "Pause" : "Play"}</button>
      <button onClick={() => { seek(0); play(); }} disabled={live}>Replay</button>
      <div className="speed" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={speed === s} disabled={live} onClick={() => setSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
      <button className="writ" disabled={live} onClick={() => injectForgedEvidence()}>Forge evidence</button>
      <button className="writ" disabled={live || !target} onClick={() => target && makeByzantine(target)}>Turn juror Byzantine</button>
      <button className="writ" onClick={() => tamperTranscript()}>Tamper transcript</button>
      {live && (
        <input
          className="case-input"
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
          className={`source-badge source-${source}`}
          aria-pressed={live}
          disabled={!configured}
          title={badgeTitle}
          onClick={() => (live ? goMock() : void goLive())}
        >
          <span className="toggle-track" aria-hidden="true"><span className="toggle-knob" /></span>
          <svg className="lantern" width="12" height="18" viewBox="0 0 12 18" aria-hidden="true">
            <path d="M4 3.5V2.2a2 2 0 0 1 4 0v1.3" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <path className="lamp" d="M3 4h6l1.2 9.5H1.8z" strokeWidth="1" strokeLinejoin="round" />
            <path className="flame" d="M6 6.2c1.4 1.6 1.8 2.6 1.8 3.6A1.8 1.8 0 0 1 4.2 9.8C4.2 8.8 4.6 7.8 6 6.2z" />
            <path d="M1.5 14.2h9v1.6h-9z" fill="currentColor" opacity=".7" />
          </svg>
          <span>{live ? "LIVE" : "MOCK"}</span>
        </button>
      </span>
    </div>
  );
}
