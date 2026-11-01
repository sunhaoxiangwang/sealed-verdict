import { useId } from "react";
import { Link } from "react-router-dom";
import type { Conclusion, Verdict } from "../protocol/types";
import { useTribunal } from "../store/tribunal";
import { IconArrowDown, IconShieldCheck } from "./icons";

const VERDICT_WORD: Record<Verdict, string> = { true: "True", false: "False", uncertain: "Uncertain" };

/** Outline pill coloured by vote: green true, red false, amber uncertain. */
export function VerdictPill({ vote, className = "", label }: { vote: Verdict; className?: string; label?: string }) {
  return <span className={`pill vpill vpill-${vote} ${className}`.trim()}>{label ?? VERDICT_WORD[vote]}</span>;
}

/** A which/who question shows the named answer (e.g. "The engineer") instead of TRUE/FALSE. */
export const verdictText = (c: { verdict: Verdict; answer?: string }) => c.answer ?? VERDICT_WORD[c.verdict];
/** Label for one juror's vote: a vote for the named answer reads as the answer. */
export const voteText = (c: { answer?: string }, vote: Verdict) => (c.answer && vote === "true" ? c.answer : VERDICT_WORD[vote]);

/** Small "i" disc that reveals the quorum rule on hover, focus or tap. */
export function InfoHint({ text, label = "How the quorum works" }: { text: string; label?: string }) {
  const id = useId();
  return (
    <span className="hint">
      <button type="button" className="hint-btn" aria-label={label} aria-describedby={id}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 7.5h.01" />
        </svg>
      </button>
      <span id={id} role="tooltip" className="hint-tip">
        {text}
      </span>
    </span>
  );
}

/** "3 of 4 jurors agreed" plus the quorum rule behind an info hint. Never a bare "3/4". */
export function QuorumAgree({ c, short = false }: { c: Conclusion; short?: boolean }) {
  const total = c.total || 4;
  const agree = Number.isFinite(c.agree) ? c.agree : 0;
  return (
    <span className="quorum">
      <span>
        {agree} of {total} {short ? "agreed" : "jurors agreed"}
      </span>
      {!short && c.quorumRule && <InfoHint text={c.quorumRule} />}
    </span>
  );
}

export function protocolName(condition: string | undefined): string {
  if (condition === "C5") return "Signed protocol";
  if (condition === "C2") return "Open debate";
  return condition ? `Condition ${condition}` : "Signed protocol";
}

export function firstSentence(text: string): string {
  const t = (text ?? "").trim();
  const m = /^[\s\S]+?[.!?](?=\s|$)/.exec(t);
  return m ? m[0] : t;
}

export function scrollToOpinion() {
  const el = document.getElementById("opinion");
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const heading = el.querySelector<HTMLElement>("[data-opinion-heading]");
  heading?.focus({ preventScroll: true });
}

/** Docked at the bottom of the 3D frame once the tribunal has written its conclusion. */
export default function VerdictPanel() {
  const c = useTribunal((s) => s.conclusion);
  const condition = useTribunal((s) => s.caseInput?.condition ?? s.condition);
  if (!c) return null;
  const why = firstSentence(c.why);
  const pct = Math.round(Math.max(0, Math.min(1, c.confidence)) * 100);

  return (
    <section className={`vpanel tone-${c.herded ? "herded" : c.verdict}${c.answer ? " has-answer" : ""}`} aria-label="Verdict" aria-live="polite">
      <div className="vpanel-word">
        <span className="label vpanel-label">{c.answer ? "Answer" : "Verdict"}</span>
        <span className="vpanel-verdict">{verdictText(c)}</span>
        {c.herded && <span className="pill pill-forged vpanel-herded">Herded</span>}
      </div>
      <div className="vpanel-body">
        <p className="vpanel-headline">{c.headline}</p>
        {why && why !== c.headline && <p className="vpanel-why">{why}</p>}
        <div className="vmeta">
          <QuorumAgree c={c} />
          <span className="vmeta-sep" aria-hidden="true" />
          <span>
            Confidence <span className="mono vmeta-num">{pct}%</span>
          </span>
          <span className="vmeta-sep" aria-hidden="true" />
          <span>{protocolName(condition)}</span>
          {c.simulated && <span className="pill pill-uncertain">Simulated</span>}
        </div>
      </div>
      <div className="vpanel-actions">
        <button type="button" className="btn btn-primary" onClick={scrollToOpinion}>
          <IconArrowDown />
          Read opinion
        </button>
        <Link to="/certificate" className="btn btn-ghost">
          <IconShieldCheck />
          Verify certificate
        </Link>
      </div>
    </section>
  );
}
