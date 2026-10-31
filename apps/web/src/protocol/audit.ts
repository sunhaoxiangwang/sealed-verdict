import { GENESIS, chainHash, verify } from "./crypto";
import type { TribunalState } from "../store/tribunal";

export type AuditRow = { label: string; detail: string; ok: boolean };

// Re-runs every cryptographic check from the stored transcript, in the browser.
export function auditTranscript(s: Pick<TribunalState, "messages" | "keys" | "certificate" | "certSigned">): AuditRow[] {
  const rows: AuditRow[] = [];
  const accepted = s.messages.filter((m) => m.verified);
  const forged = s.messages.filter((m) => !m.verified);

  const badSigs = accepted.filter((m) => {
    const pub = s.keys[m.msg.signer];
    return !pub || !verify(m.msg, pub);
  });
  rows.push({
    label: "Message signatures",
    ok: badSigs.length === 0,
    detail: badSigs.length === 0 ? `${accepted.length}/${accepted.length} signatures verify against the key registry` : `${badSigs.length} of ${accepted.length} fail: ${badSigs.map((m) => m.msg.signer).join(", ")}`,
  });

  const forgedCited = forged.filter((m) => m.kind === "evidence" && s.certificate?.evidenceIds.includes((m.msg.body as { id: string }).id));
  rows.push({
    label: "Forged items excluded",
    ok: forgedCited.length === 0,
    detail: forgedCited.length ? "a forged item is cited by the certificate" : `${forged.length} forged item(s) rejected and not cited`,
  });

  let strict = GENESIS;
  let strictBreak = -1;
  let k = 0;
  const args = s.messages.filter((m) => m.kind === "argument");
  for (const m of args) {
    k++;
    if (m.msg.body.prevHash !== strict && strictBreak < 0) strictBreak = k;
    strict = chainHash(strict, m.msg.body);
  }
  const chainOk = strictBreak < 0;
  rows.push({
    label: "Deliberation hash chain",
    ok: chainOk,
    detail: chainOk ? `${args.length} arguments link by prevHash` : `prevHash mismatch at argument ${strictBreak} of ${args.length}`,
  });

  let root = GENESIS;
  for (const m of accepted) root = chainHash(root, m.msg.body);
  const rootOk = !!s.certificate && root === s.certificate.transcriptRoot;
  rows.push({
    label: "Transcript root",
    ok: rootOk,
    detail: rootOk ? "recomputed root equals certificate transcriptRoot" : "recomputed root differs from certificate transcriptRoot",
  });

  const ledgerPub = s.certSigned ? s.keys[s.certSigned.signer] : undefined;
  const ledgerOk = !!(s.certSigned && ledgerPub && verify(s.certSigned, ledgerPub));
  rows.push({
    label: "Ledger signature",
    ok: ledgerOk,
    detail: ledgerOk ? `certificate signed by ${s.certSigned?.signer}` : "certificate signature does not verify",
  });
  return rows;
}
