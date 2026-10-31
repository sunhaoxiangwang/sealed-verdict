import { useTribunal } from "../store/tribunal";
import type { Phase } from "../protocol/types";

const PHASES: Phase[] = ["attest", "commit", "reveal", "deliberate", "verdict"];

export default function PhaseRibbon() {
  const phase = useTribunal((s) => s.phase);
  return (
    <ol className="phase-ribbon" aria-label="Phases">
      {PHASES.map((p) => (
        <li key={p} className={`phase ${p === phase ? "active" : ""}`} aria-current={p === phase ? "step" : undefined}>
          {p}
        </li>
      ))}
    </ol>
  );
}
