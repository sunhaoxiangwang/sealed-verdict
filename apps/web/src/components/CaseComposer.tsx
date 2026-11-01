import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type SVGProps } from "react";
import { hasLiveConfig } from "../live/supabase";
import { CLAIM_MAX, CLAIM_MIN, MAX_URLS } from "../mock/engine";
import { loadExample, submitCase } from "../mock/player";
import type { CaseInput } from "../protocol/types";
import { stopWatching } from "./DemoControls";
import { IconArrowRight, IconX } from "./icons";

type P = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };
const svg = (size = 16) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

export const IconPlus = ({ size, ...p }: P) => (
  <svg {...svg(size)} {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const IconLink = ({ size, ...p }: P) => (
  <svg {...svg(size)} {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const PROTOCOLS: { id: CaseInput["condition"]; name: string; hint: string }[] = [
  { id: "C5", name: "Signed protocol", hint: "Votes are sealed before anyone speaks and every message is signed. Herding cannot change the outcome." },
  { id: "C2", name: "Open debate", hint: "Jurors argue first and vote in the open, so they can herd. Use it to see the bias the protocol removes." },
];

const API_URL = (import.meta.env.VITE_TRIBUNAL_API_URL as string | undefined)?.trim();

function urlError(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  try {
    const p = new URL(u);
    if (p.protocol !== "http:" && p.protocol !== "https:") return "Only http:// or https:// links can be attested.";
    return null;
  } catch {
    return "This is not a full link. Start it with https://";
  }
}

type Link = { id: number; value: string; touched: boolean };
let linkSeq = 0;
const newLink = (): Link => ({ id: ++linkSeq, value: "", touched: false });

export default function CaseComposer() {
  const ids = useId();
  const [claim, setClaim] = useState("");
  const [context, setContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [links, setLinks] = useState<Link[]>(() => [newLink()]);
  const [condition, setCondition] = useState<CaseInput["condition"]>("C5");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimTouched, setClaimTouched] = useState(false);
  const contextRef = useRef<HTMLTextAreaElement>(null);
  const focusLink = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  useEffect(() => {
    if (focusLink.current == null) return;
    document.getElementById(`${ids}-url-${focusLink.current}`)?.focus();
    focusLink.current = null;
  }, [links, ids]);

  const trimmed = claim.trim();
  const claimShort = trimmed.length > 0 && trimmed.length < CLAIM_MIN;
  const claimOk = trimmed.length >= CLAIM_MIN && trimmed.length <= CLAIM_MAX;
  const linkErrors = links.map((l) => urlError(l.value));
  const linksOk = linkErrors.every((e) => e === null);
  const valid = claimOk && linksOk;
  const simulated = !API_URL && !hasLiveConfig();
  const protocol = PROTOCOLS.find((p) => p.id === condition)!;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setClaimTouched(true);
    setLinks((ls) => ls.map((l) => ({ ...l, touched: true })));
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      stopWatching();
      await submitCase({
        claim: trimmed,
        context: context.trim() || undefined,
        evidenceUrls: links.map((l) => l.value.trim()).filter(Boolean),
        condition,
      });
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "The case could not be submitted. Try again.");
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  const setLink = (id: number, patch: Partial<Link>) => setLinks((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLink = () => {
    if (links.length >= MAX_URLS) return;
    const l = newLink();
    focusLink.current = l.id;
    setLinks((ls) => [...ls, l]);
  };
  const removeLink = (id: number) => setLinks((ls) => ls.filter((l) => l.id !== id));

  const counterTone = claim.length >= CLAIM_MAX ? " is-max" : claim.length > CLAIM_MAX - 60 ? " is-near" : "";

  return (
    <section className="composer" aria-labelledby={`${ids}-title`}>
      <form className="composer-form" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
        <div className="composer-scroll">
          <header className="composer-head">
            <h2 id={`${ids}-title`} className="composer-title">
              Submit a case
            </h2>
            <p className="composer-lede">Four jurors deliberate. An oracle attests the facts, and every vote is sealed before anyone speaks.</p>
          </header>

          <div className="cfield">
            <div className="cfield-top">
              <label htmlFor={`${ids}-claim`} className="cfield-label">
                Claim or question
              </label>
              <span className={`cfield-count mono${counterTone}`} aria-live="polite" aria-atomic="true">
                <span className="sr-only">Characters used: </span>
                {claim.length}/{CLAIM_MAX}
              </span>
            </div>
            <textarea
              id={`${ids}-claim`}
              className="cinput ctextarea"
              rows={4}
              required
              maxLength={CLAIM_MAX}
              placeholder="e.g. Did the 14:02 deploy cause the outage?"
              value={claim}
              aria-invalid={claimTouched && !claimOk ? true : undefined}
              aria-describedby={claimTouched && claimShort ? `${ids}-claim-err` : undefined}
              onChange={(e) => setClaim(e.target.value)}
              onBlur={() => claim && setClaimTouched(true)}
            />
            {claimTouched && claimShort && (
              <p id={`${ids}-claim-err`} className="cfield-error">
                Write at least {CLAIM_MIN} characters so the jurors know what to decide.
              </p>
            )}
            {claimTouched && trimmed.length === 0 && (
              <p className="cfield-error">Write the claim or question the jurors should decide.</p>
            )}
          </div>

          <div className="cfield">
            {!showContext ? (
              <button
                type="button"
                className="btn-text"
                aria-expanded={false}
                onClick={() => {
                  setShowContext(true);
                  requestAnimationFrame(() => contextRef.current?.focus());
                }}
              >
                <IconPlus size={14} />
                Add context
              </button>
            ) : (
              <>
                <div className="cfield-top">
                  <label htmlFor={`${ids}-ctx`} className="cfield-label">
                    Context <span className="cfield-opt">optional</span>
                  </label>
                  <button
                    type="button"
                    className="btn-text btn-text-sm"
                    aria-expanded={true}
                    aria-controls={`${ids}-ctx`}
                    onClick={() => {
                      setShowContext(false);
                      setContext("");
                    }}
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  id={`${ids}-ctx`}
                  ref={contextRef}
                  className="cinput ctextarea"
                  rows={3}
                  maxLength={2000}
                  placeholder="Background the jurors should know: timeline, systems involved, what is already agreed."
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
              </>
            )}
          </div>

          <fieldset className="cfield">
            <div className="cfield-top">
              <legend className="cfield-label">Evidence links</legend>
              <span className="cfield-count mono">
                {links.filter((l) => l.value.trim()).length}/{MAX_URLS}
              </span>
            </div>
            <p className="cfield-hint">Without evidence the tribunal can only rule Uncertain. Add links the oracle can attest.</p>
            {links.length > 0 && (
              <ul className="links">
                {links.map((l, i) => {
                  const err = l.touched ? linkErrors[i] : null;
                  return (
                    <li key={l.id} className="link-row">
                      <div className={`link-field${err ? " is-invalid" : ""}`}>
                        <IconLink size={14} className="link-icon" />
                        <input
                          id={`${ids}-url-${l.id}`}
                          className="cinput link-input mono"
                          type="url"
                          inputMode="url"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="https://status.example.com/incident"
                          aria-label={`Evidence link ${i + 1}`}
                          aria-invalid={err ? true : undefined}
                          aria-describedby={err ? `${ids}-url-err-${l.id}` : undefined}
                          value={l.value}
                          onChange={(e) => setLink(l.id, { value: e.target.value })}
                          onBlur={() => setLink(l.id, { touched: true })}
                        />
                      </div>
                      <button type="button" className="icon-btn" aria-label={`Remove evidence link ${i + 1}`} onClick={() => removeLink(l.id)}>
                        <IconX size={14} />
                      </button>
                      {err && (
                        <p id={`${ids}-url-err-${l.id}`} className="cfield-error link-error">
                          {err}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" className="btn-text" onClick={addLink} disabled={links.length >= MAX_URLS}>
              <IconPlus size={14} />
              {links.length >= MAX_URLS ? `Up to ${MAX_URLS} links` : links.length === 0 ? "Add a link" : "Add another link"}
            </button>
          </fieldset>

          <div className="cfield">
            <span id={`${ids}-proto`} className="cfield-label">
              Protocol
            </span>
            <div className="seg seg-full" role="radiogroup" aria-labelledby={`${ids}-proto`}>
              {PROTOCOLS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={condition === p.id}
                  className="seg-item"
                  onClick={() => setCondition(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <p className="cfield-hint" aria-live="polite">
              {protocol.hint}
            </p>
          </div>

          {simulated && (
            <p className="composer-note">
              <span className="dot" aria-hidden="true" />
              <span>Mock mode: the deliberation is simulated in your browser. Switch to Live to use real jurors.</span>
            </p>
          )}
        </div>

        <footer className="composer-foot">
          {error && (
            <p className="cfield-error composer-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary composer-submit" disabled={!valid || submitting} aria-busy={submitting || undefined}>
            {submitting ? <span className="spinner" aria-hidden="true" /> : <IconArrowRight />}
            {submitting ? "Submitting" : "Submit to the tribunal"}
          </button>
          <div className="composer-foot-row">
            <button
              type="button"
              className="btn-text"
              disabled={submitting}
              onClick={() => {
                stopWatching();
                loadExample();
              }}
            >
              Try the example case
            </button>
            <span className="composer-kbd" aria-hidden="true">
              <kbd>{typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd>
              <kbd>Enter</kbd>
            </span>
          </div>
        </footer>
      </form>
    </section>
  );
}
