import { useEffect, useState } from "react";
import { auditTranscript, type AuditRow } from "../protocol/audit";
import { load, player, tamperTranscript } from "../mock/player";
import { useTribunal } from "../store/tribunal";
import "../styles/certificate.css";

const short = (h: string, n = 10) => (h.length > n * 2 + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);

export default function Certificate() {
  const cert = useTribunal((s) => s.certificate);
  const certSigned = useTribunal((s) => s.certSigned);
  const claim = useTribunal((s) => s.claim);
  const messages = useTribunal((s) => s.messages);
  const keys = useTribunal((s) => s.keys);
  const jurors = useTribunal((s) => s.jurors);
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  // Any change to the stored transcript invalidates a previous audit.
  useEffect(() => setRows(null), [messages, cert]);

  if (!cert) {
    return (
      <div className="page cert-page">
        <p className="kicker">The sealed writ</p>
        <h1>No verdict yet</h1>
        <p className="muted">The tribunal has not issued a certificate. Load the signed-protocol case and watch it deliberate.</p>
        <button
          onClick={() => {
            load("C5");
            player.speed(4);
            player.play();
          }}
        >
          Load C5 and play at 4x
        </button>
      </div>
    );
  }

  const broken = rows ? rows.some((r) => !r.ok) : false;
  const forgedEv = messages.filter((m) => m.kind === "evidence" && !m.verified).map((m) => (m.msg.body as { id: string }).id);
  const evRows = [...cert.evidenceIds.map((id) => ({ id, ok: true })), ...forgedEv.map((id) => ({ id, ok: false }))];
  const sigOwner = (i: number) => jurors[i]?.pseudonym ?? `juror-${i + 1}`;

  return (
    <div className="page cert-page">
      <p className="kicker">The sealed writ</p>
      <article className={`cert ${rows && broken ? "cert-broken" : ""}`} aria-label="Verdict certificate">
        <div className={`seal ${rows && broken ? "seal-cracked" : ""}`} aria-hidden="true">
          <span>SV</span>
        </div>
        <span className="cert-ribbon" aria-hidden="true" />
        <h2 className="cert-title">Verdict Certificate</h2>
        <dl className="cert-grid">
          <dt>Case</dt>
          <dd className="mono">{cert.caseId}</dd>
          <dt>Claim</dt>
          <dd>{claim}</dd>
          <dt>Verdict</dt>
          <dd className="cert-verdict">{cert.verdict}</dd>
          <dt>Quorum</dt>
          <dd className="mono">{cert.quorum}</dd>
          <dt>Transcript root</dt>
          <dd className="mono wrap">{cert.transcriptRoot}</dd>
        </dl>
        <h3 className="cert-sub">Evidence</h3>
        <ul className="cert-ev">
          {evRows.map((e) => (
            <li key={e.id}>
              <span className="mono">{e.id}</span>
              <span className={`stamp stamp-sm cbadge ${e.ok ? "stamp-green ok" : "stamp-red bad"}`} style={{ ["--rot" as string]: e.ok ? "-5deg" : "-7deg" }}>{e.ok ? "VERIFIED" : "FORGED"}</span>
              {!e.ok && <span className="cert-note">excluded</span>}
            </li>
          ))}
        </ul>
        <h3 className="cert-sub">Voter signatures</h3>
        <ul className="cert-sigs">
          {cert.voterSigs.map((sig, i) => (
            <li key={i}>
              <span className="mono cert-juror">{sigOwner(i)}</span>
              <span className="mono">{short(sig, 12)}</span>
            </li>
          ))}
        </ul>
        {certSigned && <p className="cert-foot mono">Ledger {certSigned.signer} · {short(certSigned.sig, 12)} · {Object.keys(keys).length} keys in registry</p>}
      </article>

      <div className="cert-actions">
        <button onClick={() => setRows(auditTranscript(useTribunal.getState()))}>Verify</button>
        <button className="writ" onClick={() => tamperTranscript()}>Tamper transcript</button>
        <button
          onClick={() => {
            load("C5");
            player.seek(0);
            player.speed(4);
            player.play();
          }}
        >
          Reset
        </button>
      </div>

      {rows && (
        <section className="audit" aria-live="polite" aria-label="Ledger of checks">
          <h3 className="audit-title">Ledger of checks</h3>
          <ul className="audit-list">
            {rows.map((r) => (
              <li key={r.label} className={r.ok ? "audit-ok" : "audit-bad"}>
                <span className="audit-mark"><span className={`stamp stamp-sm ${r.ok ? "stamp-green" : "stamp-red"}`} style={{ ["--rot" as string]: r.ok ? "-6deg" : "-9deg" }}>{r.ok ? "PASS" : "FAIL"}</span></span>
                <strong>{r.label}</strong>
                <span className="audit-detail">{r.detail}</span>
              </li>
            ))}
          </ul>
          <div className={`audit-banner ${broken ? "audit-banner-bad" : "audit-banner-ok"}`}><span className={`stamp ${broken ? "stamp-red" : "stamp-green"}`} style={{ ["--rot" as string]: "-7deg" }}>{broken ? "SEAL BROKEN" : "SEAL INTACT"}</span></div>
        </section>
      )}

      <details className="cert-json">
        <summary>Clerk&rsquo;s copy (raw certificate JSON)</summary>
        <pre className="mono">{JSON.stringify(certSigned ?? cert, null, 2)}</pre>
      </details>
    </div>
  );
}
