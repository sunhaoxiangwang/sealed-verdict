import { useState } from "react";
import { Link } from "react-router-dom";
import { startAML, useAML, type AMLCase } from "../live/aml";
import { useTribunal } from "../store/tribunal";

export default function DemoControls() {
  const { snapshot, error } = useAML();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const bundle = useTribunal(s => s.protocolBundle);
  const running = snapshot?.run?.status === "running";
  return <div className="demo-controls">
    <label>Upload case (JSON) <input type="file" accept=".json,application/json" disabled={running || starting} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (file.size > 65536) throw new Error("Case file must be smaller than 64 KB");
        const value = JSON.parse(await file.text()) as AMLCase;
        if (!value || [value.id, value.title, value.question, value.description, value.source].some(v => typeof v !== "string" || !v.trim()) || !Array.isArray(value.context) || !value.context.length || value.context.some(e => typeof e?.content !== "string" || typeof e?.source !== "string")) throw new Error("Use the downloadable example's JSON case format");
        useAML.setState({ pendingCase: value }); setStartError("");
      } catch (error) { setStartError(error instanceof Error ? error.message : String(error)); }
    }} /></label>
    <a href="/api/aml/example" download>Download example case</a>
    <button disabled={starting || running || !snapshot || !!snapshot.missingKeys.length} onClick={async () => {
      setStarting(true); setStartError("");
      try { await startAML(); } catch (e) { setStartError(String(e instanceof Error ? e.message : e)); }
      finally { setStarting(false); }
    }}>{running ? `Running · ${snapshot?.run?.stage}` : starting ? "Starting…" : "Run AML case"}</button>
    <span className="source-badge source-live">LIVE · C5</span>
    {bundle && <Link to="/certificate">Verify conclusion</Link>}
    <span role="status">{startError || error || (snapshot?.missingKeys.length ? `Missing: ${snapshot.missingKeys.join(", ")}` : snapshot?.run?.error || "")}</span>
  </div>;
}
