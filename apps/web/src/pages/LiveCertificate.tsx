import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTribunal } from "../store/tribunal";
import { useAML } from "../live/aml";
import { verifyBundle, type VerifyReport } from "../protocol/native";
import "../styles/certificate.css";
import AMLConclusion from "../components/AMLConclusion";

export default function LiveCertificate() {
  const bundle = useTribunal(s => s.protocolBundle);
  const original = useAML(s => s.snapshot?.bundle);
  const [report, setReport] = useState<VerifyReport>();
  const [error, setError] = useState("");
  useEffect(() => { setReport(undefined); setError(""); }, [bundle]);
  if (!bundle) return <div className="cert-page"><h1>No live certificate yet</h1><p>Run the AML case to collect real agent ballots and a Rust-signed certificate.</p><Link to="/courtroom">Open courtroom</Link></div>;
  const body = bundle.cert.body;
  return <div className="cert-page">
    <p className="kicker">Live AML · C5 · Rust protocol</p>
    <article className={`cert ${report && !report.valid ? "cert-broken" : ""}`}>
      <h1>Verified Case Conclusion</h1>
      <AMLConclusion />
      <dl className="cert-grid">
        <dt>Case</dt><dd>{body.caseId}</dd>
        <dt>Recommendation</dt><dd>{body.verdict}</dd>
        <dt>Quorum</dt><dd>{body.quorum.counted} of {body.quorum.n} ballots received; {body.quorum.needed} matching votes required</dd>
        <dt>Transcript root</dt><dd className="mono wrap">{body.transcriptRoot}</dd>
        <dt>Evidence</dt><dd>{body.evidenceIds.join(", ")}</dd>
        <dt>Human review</dt><dd>Pending. No SAR has been filed.</dd>
      </dl>
      <h3>Final signed ballots</h3>
      <ul className="cert-sigs">{body.votes.map(v => <li key={v.body.juror}><strong>{v.body.juror}: {v.body.vote}</strong><span className="mono">{v.sig.slice(0, 24)}…</span></li>)}</ul>
    </article>
    <div className="cert-actions">
      <button onClick={async () => {
        try {
          const result = await verifyBundle(bundle); setReport(result);
          useTribunal.getState().setChainBroken(!result.valid);
        } catch (e) { setError(String(e)); }
      }}>Verify with Rust/WASM</button>
      <button onClick={() => useTribunal.getState().tamper()}>Tamper local transcript</button>
      <button disabled={!original} onClick={() => { if (original) { useTribunal.getState().setProtocolBundle(structuredClone(original)); useTribunal.getState().setChainBroken(false); } }}>Restore original</button>
      <button onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = `${body.caseId}.json`; a.click(); URL.revokeObjectURL(url);
      }}>Download certificate + transcript</button>
    </div>
    <div role="status">{error || (report && (report.valid ? "PASS — signatures, commitments, evidence, phase order, transcript and quorum verified." : `FAIL — ${report.failures.join("; ")}`))}</div>
    <p className="muted">Verification proves protocol integrity. Source excerpts were attested by this case's oracle; the DOJ did not sign these envelopes. Provider identities are operational metadata, not provider-signed attestations.</p>
    <details className="cert-json"><summary>Original protocol bundle</summary><pre>{JSON.stringify(bundle, null, 2)}</pre></details>
  </div>;
}
