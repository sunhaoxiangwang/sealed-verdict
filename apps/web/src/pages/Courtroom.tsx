import { lazy, Suspense } from "react";
import { useAML } from "../live/aml";
import PhaseRibbon from "../components/PhaseRibbon";
import TranscriptFeed from "../components/TranscriptFeed";
import DemoControls from "../components/DemoControls";
import AMLConclusion from "../components/AMLConclusion";

const CourtroomScene = lazy(() => import("../scene/CourtroomScene"));

export default function Courtroom() {
  const snapshot = useAML(s => s.snapshot);
  const pending = useAML(s => s.pendingCase);
  const input = pending || snapshot?.input;

  return (
    <div className="courtroom">
      <DemoControls />
      <div className="aml-summary">
        <section className="aml-case" aria-label="Input case">
          <span className="kicker">{pending ? "Uploaded input case" : "Input case"}</span>
          <h2>{input?.title || "Live AML case review"}</h2>
          <p><strong>{input?.question}</strong></p>
          <ul>{input?.context.map((e, i) => <li key={i}>{e.content}</li>)}</ul>
          <p>{input?.description || "Connecting to the AML workflow service…"}</p>
          {input && /^https?:\/\//i.test(input.source) && <a href={input.source} target="_blank" rel="noreferrer">Read source record</a>}
        </section>
        <AMLConclusion />
      </div>
      <PhaseRibbon />
      <div className="courtroom-main">
        <div id="scene-root" className="scene-root">
          <Suspense fallback={null}>
            <CourtroomScene />
          </Suspense>
        </div>
        <TranscriptFeed />
      </div>
    </div>
  );
}
