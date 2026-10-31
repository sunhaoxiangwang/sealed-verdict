import { useTribunal } from "../store/tribunal";
import type { Phase } from "../protocol/types";

const PHASES: Phase[] = ["attest", "commit", "reveal", "deliberate", "verdict"];

export default function PhaseRibbon() {
  const phase = useTribunal((s) => s.phase);
  const at = PHASES.indexOf(phase);
  return (
    <ol className="phase-ribbon" aria-label="Phases">
      {PHASES.map((p, i) => {
        const done = at > i;
        const active = i === at;
        return (
          <li key={p} className={`phase ${active ? "active" : ""} ${done ? "done" : ""}`} aria-current={active ? "step" : undefined}>
            <span className="phase-label">{p}</span>
            {done && <span className="stamp stamp-green stamp-done" aria-hidden="true">Done</span>}
            {active && <span className="stamp stamp-red" aria-hidden="true">Open</span>}
          </li>
        );
      })}
    </ol>
  );
}
