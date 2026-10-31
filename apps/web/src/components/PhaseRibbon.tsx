import { useTribunal } from "../store/tribunal";
import type { Phase } from "../protocol/types";

const PHASES: Phase[] = ["attest", "commit", "reveal", "deliberate", "verdict"];

export default function PhaseRibbon() {
  const phase = useTribunal((s) => s.phase);
  const at = PHASES.indexOf(phase);
  return (
    <ol className="phases" aria-label="Phases">
      {PHASES.map((p, i) => {
        const state = at > i ? "done" : i === at ? "active" : "todo";
        return (
          <li key={p} className="phase" data-state={state} aria-current={state === "active" ? "step" : undefined}>
            <span className="phase-seg" aria-hidden="true">
              <span className="phase-fill" />
            </span>
            <span className="phase-label">{p}</span>
            {state === "done" && <span className="sr-only">done</span>}
          </li>
        );
      })}
    </ol>
  );
}
