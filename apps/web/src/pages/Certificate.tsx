import { useEffect, useRef, useState, type CSSProperties } from "react";
import { auditTranscript, type AuditRow } from "../protocol/audit";
import { load, player, tamperTranscript } from "../mock/player";
import { useTribunal } from "../store/tribunal";
import { IconCheck, IconChevron, IconCopy, IconPencil, IconPlay, IconReplay, IconShieldCheck, IconShieldX, IconX } from "../components/icons";
import "../styles/certificate.css";

const short = (h: string, n = 10) => (h.length > n * 2 + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** A hash or signature you can click to copy. `shown` is the truncated form. */
function CopyText({ value, shown, label, wrap = false }: { value: string; shown?: string; label: string; wrap?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await writeClipboard(value);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  };

  return (
    <span className="copy">
      <button type="button" className={`copyable mono${wrap ? " wrap" : ""}`} data-state={state} onClick={() => void copy()} title="Click to copy" aria-label={label}>
        <span className="copyable-text">{shown ?? value}</span>
        <span className="copyable-icon" aria-hidden="true">
          {state === "copied" ? <IconCheck size={13} /> : <IconCopy size={13} />}
        </span>
      </button>
      <span className="copy-tip" data-state={state} aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}
      </span>
    </span>
  );
}

/** 64px seal: conic brass ring, dark centre, SV. When broken the ring turns red and a crack is drawn across it. */
function Seal({ broken = false, idle = false }: { broken?: boolean; idle?: boolean }) {
  return (
    <div className={`seal${broken ? " seal-cracked" : ""}${idle ? " seal-idle" : ""}`} aria-hidden="true">
      <span className="seal-sv">SV</span>
      {broken && (
        <svg className="seal-crack" viewBox="0 0 64 64" focusable="false">
          <path pathLength="100" className="seal-crack-dark" d="M46 1 L40 14 L47.5 21 L35 30.5 L41 39 L29.5 47.5 L33 63" />
          <path pathLength="100" className="seal-crack-light" d="M46.8 1 L40.8 14 L48.3 21 L35.8 30.5 L41.8 39 L30.3 47.5 L33.8 63" />
        </svg>
      )}
    </div>
  );
}

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
      <div className="cert-page">
        <section className="empty">
          <Seal idle />
          <h1>No verdict yet</h1>
          <p>The tribunal has not issued a certificate. Load the signed-protocol case and watch it deliberate.</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              load("C5");
              player.speed(4);
              player.play();
            }}
          >
            <IconPlay />
            Load C5 and play at 4x
          </button>
        </section>
      </div>
    );
  }

  const broken = rows ? rows.some((r) => !r.ok) : false;
  const forgedEv = messages.filter((m) => m.kind === "evidence" && !m.verified).map((m) => (m.msg.body as { id: string }).id);
  const evRows = [...cert.evidenceIds.map((id) => ({ id, ok: true })), ...forgedEv.map((id) => ({ id, ok: false }))];
  const sigOwner = (i: number) => jurors[i]?.pseudonym ?? `juror-${i + 1}`;

  return (
    <div className="cert-page">
      <article className={`cert${rows && broken ? " cert-broken" : ""}`} aria-label="Verdict certificate">
        <Seal broken={!!rows && broken} />
        <h1 className="cert-title">Verdict certificate</h1>
        <dl className="cert-grid">
          <dt>Case</dt>
          <dd>
            <CopyText value={cert.caseId} label="Copy case id" />
          </dd>
          <dt>Claim</dt>
          <dd>{claim}</dd>
          <dt>Verdict</dt>
          <dd className="cert-verdict">{cert.verdict}</dd>
          <dt>Quorum</dt>
          <dd className="mono">{cert.quorum}</dd>
          <dt>Transcript root</dt>
          <dd>
            <CopyText value={cert.transcriptRoot} label="Copy transcript root" wrap />
          </dd>
        </dl>
        <h2 className="cert-sub">Evidence</h2>
        <ul className="cert-rows">
          {evRows.map((e) => (
            <li key={e.id}>
              <span className="mono cert-id">{e.id}</span>
              <span className={`pill ${e.ok ? "pill-verified ok" : "pill-forged bad"}`}>{e.ok ? "verified" : "forged"}</span>
              {!e.ok && <span className="cert-note">excluded</span>}
            </li>
          ))}
        </ul>
        <h2 className="cert-sub">Voter signatures</h2>
        <ul className="cert-rows">
          {cert.voterSigs.map((sig, i) => (
            <li key={i}>
              <span className="mono cert-juror">{sigOwner(i)}</span>
              <CopyText value={sig} shown={short(sig, 12)} label={`Copy signature of ${sigOwner(i)}`} />
            </li>
          ))}
        </ul>
        {certSigned && (
          <p className="cert-foot">
            <span>Ledger</span>
            <span className="mono">{certSigned.signer}</span>
            <CopyText value={certSigned.sig} shown={short(certSigned.sig, 12)} label="Copy ledger signature" />
            <span>{Object.keys(keys).length} keys in registry</span>
          </p>
        )}
      </article>

      <div className="cert-actions">
        <button className="btn btn-primary" onClick={() => setRows(auditTranscript(useTribunal.getState()))}>
          <IconShieldCheck />
          Verify
        </button>
        <button className="btn btn-ghost btn-danger" onClick={() => tamperTranscript()}>
          <IconPencil />
          Tamper transcript
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            load("C5");
            player.seek(0);
            player.speed(4);
            player.play();
          }}
        >
          <IconReplay />
          Reset
        </button>
      </div>

      {rows && (
        <section className="audit" aria-live="polite" aria-label="Verification checks">
          <h2 className="cert-sub audit-title">Verification</h2>
          <ul className="checks">
            {rows.map((r, i) => (
              <li key={r.label} className={`check ${r.ok ? "audit-ok" : "audit-bad"}`} style={{ "--i": i } as CSSProperties}>
                <span className="check-icon" role="img" aria-label={r.ok ? "Passed" : "Failed"}>
                  {r.ok ? <IconCheck size={13} /> : <IconX size={13} />}
                </span>
                <strong>{r.label}</strong>
                <span className="check-detail">{r.detail}</span>
              </li>
            ))}
          </ul>
          <div className={`seal-banner ${broken ? "is-broken" : "is-intact"}`} role="status" style={{ "--i": rows.length } as CSSProperties}>
            {broken ? <IconShieldX size={18} /> : <IconShieldCheck size={18} />}
            {broken ? "Seal broken" : "Seal intact"}
          </div>
        </section>
      )}

      <details className="raw">
        <summary>
          <IconChevron size={14} />
          Raw certificate JSON
        </summary>
        <pre className="mono">{JSON.stringify(certSigned ?? cert, null, 2)}</pre>
      </details>
    </div>
  );
}
