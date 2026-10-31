import { lazy, Suspense, useEffect } from "react";
import { load } from "../mock/player";
import { useTribunal } from "../store/tribunal";
import PhaseRibbon from "../components/PhaseRibbon";
import TranscriptFeed from "../components/TranscriptFeed";
import DemoControls from "../components/DemoControls";

const CourtroomScene = lazy(() => import("../scene/CourtroomScene"));

/** Floating chip at the top-left of the 3D panel: case id and the claim on trial. */
function SceneHud() {
  const caseId = useTribunal((s) => s.caseId);
  const claim = useTribunal((s) => s.claim);
  if (!caseId && !claim) return null;
  return (
    <div className="hud">
      {caseId && <span className="hud-id mono">{caseId}</span>}
      {claim && <span className="hud-claim">{claim}</span>}
    </div>
  );
}

export default function Courtroom() {
  useEffect(() => {
    if (!useTribunal.getState().caseId) load("C5");
  }, []);

  return (
    <div className="courtroom">
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
          <SceneHud />
        </div>
        <TranscriptFeed />
      </div>
      <DemoControls />
    </div>
  );
}
