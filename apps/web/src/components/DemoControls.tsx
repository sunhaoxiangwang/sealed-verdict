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
      <button disabled={live} onClick={() => injectForgedEvidence()}>Inject forged evidence</button>
      <button disabled={live || !target} onClick={() => target && makeByzantine(target)}>Make juror Byzantine</button>
      <button onClick={() => tamperTranscript()}>Tamper transcript</button>
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
          {live ? "LIVE" : "MOCK"}
        </button>
      </span>
    </div>
  );
}
