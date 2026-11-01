import { lazy, Suspense } from "react";
import { useTribunal } from "../store/tribunal";
import PhaseRibbon from "../components/PhaseRibbon";
import TranscriptFeed from "../components/TranscriptFeed";
import DemoControls from "../components/DemoControls";
import CaseComposer from "../components/CaseComposer";
import VerdictPanel from "../components/VerdictPanel";
import OpinionSection from "../components/OpinionSection";
import "../styles/case.css";

const CourtroomScene = lazy(() => import("../scene/CourtroomScene"));

/** Floating chip at the top-left of the 3D panel: case id and the claim on trial. */
function SceneHud() {
  const caseId = useTribunal((s) => s.caseId);
  const claim = useTribunal((s) => s.caseInput?.claim || s.claim);
  if (!caseId && !claim) return null;
  return (
    <div className="hud">
      {caseId && <span className="hud-id mono">{caseId}</span>}
      {claim && <span className="hud-claim">{claim}</span>}
    </div>
  );
}

/** Centred over the empty courtroom until a case is submitted. */
function Recess() {
  return (
    <div className="recess" role="status">
      <span className="dot" aria-hidden="true" />
      The tribunal is in recess. Submit a case to begin.
    </div>
  );
}

export default function Courtroom() {
  const status = useTribunal((s) => s.status);
  const empty = status === "empty";

  return (
    <div className={`courtroom is-${status}`}>
      <h1 className="sr-only">Courtroom</h1>
      <PhaseRibbon />
      <div className="courtroom-main">
        <div id="scene-root" className="scene-root">
          <div className="scene-loading" aria-hidden="true">
            <span className="dot dot-ember" />
            Loading courtroom
          </div>
          <Suspense fallback={null}>
            <CourtroomScene />
          </Suspense>
          {empty ? <Recess /> : <SceneHud />}
          {status === "done" && <VerdictPanel />}
        </div>
        {empty ? <CaseComposer /> : <TranscriptFeed />}
      </div>
      <DemoControls />
      <OpinionSection />
    </div>
  );
}
