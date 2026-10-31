import { useState } from "react";
import { Link } from "react-router-dom";
import { startAML, useAML } from "../live/aml";
import { useTribunal } from "../store/tribunal";

export default function DemoControls() {
  const { snapshot, error } = useAML();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const bundle = useTribunal(s => s.protocolBundle);
  const running = snapshot?.run?.status === "running";
  return <div className="demo-controls">
    <button disabled={starting || running || !snapshot || !!snapshot.missingKeys.length} onClick={async () => {
      setStarting(true); setStartError("");
      try { await startAML(); } catch (e) { setStartError(String(e instanceof Error ? e.message : e)); }
      finally { setStarting(false); }
    }}>{running ? `Running · ${snapshot?.run?.stage}` : starting ? "Starting…" : "Run AML case"}</button>
    <span className="source-badge source-live">LIVE · C5</span>
    {bundle && <Link to="/certificate">Verify certificate</Link>}
    <span role="status">{startError || error || (snapshot?.missingKeys.length ? `Missing: ${snapshot.missingKeys.join(", ")}` : snapshot?.run?.error || "")}</span>
  </div>;
}
