import { lazy, Suspense } from "react";
import { useAML } from "../live/aml";
import PhaseRibbon from "../components/PhaseRibbon";
import TranscriptFeed from "../components/TranscriptFeed";
import DemoControls from "../components/DemoControls";

const CourtroomScene = lazy(() => import("../scene/CourtroomScene"));

export default function Courtroom() {
  const snapshot = useAML(s => s.snapshot);

  return (
    <div className="courtroom">
      <section className="aml-case" aria-label="AML source case">
        <strong>{snapshot?.input.title || "Live AML case review"}</strong>
        <p>{snapshot?.input.description || "Connecting to the AML workflow service…"}</p>
        {snapshot && <a href={snapshot.input.source} target="_blank" rel="noreferrer">Read the DOJ source record</a>}
        <span>Alert → triage → investigation / RFI gaps → sealed panel → human review → verification</span>
      </section>
      <PhaseRibbon />
      <div className="courtroom-main">
        <div id="scene-root" className="scene-root">
          <Suspense fallback={null}>
            <CourtroomScene />
          </Suspense>
        </div>
        <TranscriptFeed />
      </div>
      <DemoControls />
    </div>
  );
}
