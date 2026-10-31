import { lazy, Suspense, useEffect } from "react";
import { load } from "../mock/player";
import { useTribunal } from "../store/tribunal";
import PhaseRibbon from "../components/PhaseRibbon";
import TranscriptFeed from "../components/TranscriptFeed";
import DemoControls from "../components/DemoControls";

const CourtroomScene = lazy(() => import("../scene/CourtroomScene"));

export default function Courtroom() {
  useEffect(() => {
    if (!useTribunal.getState().caseId) load("C5");
  }, []);

  return (
    <div className="courtroom">
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
