import { injectForgedEvidence, makeByzantine, tamperTranscript, usePlayer, type Speed } from "../mock/player";
import { useTribunal } from "../store/tribunal";

const SPEEDS: Speed[] = [1, 2, 4];

export default function DemoControls() {
  const { playing, speed, play, pause, seek, setSpeed } = usePlayer();
  const source = useTribunal((s) => s.source);
  const jurors = useTribunal((s) => s.jurors);
  const target = jurors.find((j) => !j.byzantine)?.id;

  return (
    <div className="demo-controls">
      <button onClick={playing ? pause : play}>{playing ? "Pause" : "Play"}</button>
      <button onClick={() => { seek(0); play(); }}>Replay</button>
      <div className="speed" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
      <button onClick={() => injectForgedEvidence()}>Inject forged evidence</button>
      <button disabled={!target} onClick={() => target && makeByzantine(target)}>Make juror Byzantine</button>
      <button onClick={() => tamperTranscript()}>Tamper transcript</button>
      <span className={`source-badge source-${source}`}>{source === "mock" ? "MOCK" : "LIVE"}</span>
    </div>
  );
}
