import { Link } from "react-router-dom";
import { usePlayer } from "../mock/player";
import { useTribunal } from "../store/tribunal";
import Avatar, { hueIndex } from "./Avatar";
import { resetCourt } from "./DemoControls";
import { IconPlus } from "./CaseComposer";
import { IconReplay, IconShieldCheck } from "./icons";
import { QuorumAgree, VerdictPill, protocolName, verdictText, voteText } from "./VerdictPanel";

/** The tribunal's written opinion, full width below the controls once a case is done. */
export default function OpinionSection() {
  const c = useTribunal((s) => s.conclusion);
  const status = useTribunal((s) => s.status);
  const jurors = useTribunal((s) => s.jurors);
  const caseId = useTribunal((s) => s.caseId);
  const condition = useTribunal((s) => s.caseInput?.condition ?? s.condition);
  const live = useTribunal((s) => s.source === "live");
  const { seek, play } = usePlayer();
  if (status !== "done" || !c) return null;

  const pct = Math.round(Math.max(0, Math.min(1, c.confidence)) * 100);
  const dissenters = new Set(c.dissent.map((d) => d.juror));
  const persona = (name: string) => c.votes.find((v) => v.juror === name)?.persona ?? jurors.find((j) => j.pseudonym === name)?.persona;

  return (
    <section id="opinion" className={`opinion tone-${c.herded ? "herded" : c.verdict}`} aria-labelledby="opinion-title">
      <header className="opinion-head">
        <h2 id="opinion-title" className="opinion-title" tabIndex={-1} data-opinion-heading>
          Opinion of the tribunal
        </h2>
        <div className="opinion-tags">
          {caseId && <span className="mono">{caseId}</span>}
          <span className="opinion-tag">{protocolName(condition)}</span>
          {c.simulated && <span className="pill pill-uncertain">Simulated</span>}
        </div>
      </header>

      <blockquote className="opinion-claim">
        <p>{c.claim}</p>
      </blockquote>

      <div className="opinion-ruling">
        <VerdictPill vote={c.verdict} className="opinion-verdict" label={verdictText(c)} />
        {c.herded && <span className="pill pill-forged">Herded</span>}
        <p className="opinion-headline">{c.headline}</p>
      </div>

      <div className="opinion-flow">
        <section className="opinion-block" aria-labelledby="op-why">
          <h3 id="op-why" className="label opinion-label">Why</h3>
          <p className="opinion-why">{c.why}</p>
        </section>

        {c.wouldChange && (
          <section className="opinion-block" aria-labelledby="op-change">
            <h3 id="op-change" className="label opinion-label">What would change it</h3>
            <p className="opinion-text">{c.wouldChange}</p>
          </section>
        )}

        <section className="opinion-block" aria-labelledby="op-votes">
          <div className="opinion-block-head">
            <h3 id="op-votes" className="label opinion-label">How the jurors voted</h3>
            <span className="opinion-quorum">
              <QuorumAgree c={c} />
              <span className="vmeta-sep" aria-hidden="true" />
              <span>
                Confidence <span className="mono vmeta-num">{pct}%</span>
              </span>
            </span>
          </div>
          <ul className="votes">
            {c.votes.map((v) => {
              const dissent = v.vote !== c.verdict || dissenters.has(v.juror);
              return (
                <li key={v.juror} className={`vote${dissent ? " is-dissent" : ""}`}>
                  <Avatar name={v.juror} hue={hueIndex(v.juror, jurors)} />
                  <div className="vote-who">
                    <span className="vote-name">{v.juror}</span>
                    <span className="vote-persona">{v.persona}</span>
                  </div>
                  <div className="vote-ballot">
                    <VerdictPill vote={v.vote} label={voteText(c, v.vote)} />
                    <span className="mono vote-conf">{Math.round(v.confidence * 100)}%</span>
                    {dissent && <span className="vote-dissent">dissent</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {c.summary && (
          <section className="opinion-block" aria-labelledby="op-summary">
            <h3 id="op-summary" className="label opinion-label">In summary</h3>
            <p className="opinion-text">{c.summary}</p>
          </section>
        )}

        {c.reasons.length > 0 && (
          <section className="opinion-block" aria-labelledby="op-reasons">
            <h3 id="op-reasons" className="label opinion-label">Reasons</h3>
            <ol className="reasons">
              {c.reasons.map((r, i) => (
                <li key={i} className="reason">
                  <span className="reason-dot" aria-hidden="true" />
                  <div>
                    <p className="opinion-text">{r.text}</p>
                    {r.evidenceIds.length > 0 && (
                      <div className="entry-meta">
                        <span className="entry-meta-label">Evidence</span>
                        {r.evidenceIds.map((id) => (
                          <span key={id} className="cite">
                            {id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {c.dissent.length > 0 && (
          <section className="opinion-block" aria-labelledby="op-dissent">
            <h3 id="op-dissent" className="label opinion-label">Dissent</h3>
            <ul className="dissents">
              {c.dissent.map((d) => (
                <li key={d.juror} className="dissent">
                  <Avatar name={d.juror} hue={hueIndex(d.juror, jurors)} />
                  <div>
                    <div className="dissent-head">
                      <span className="vote-name">{d.juror}</span>
                      {persona(d.juror) && <span className="vote-persona">{persona(d.juror)}</span>}
                    </div>
                    <p className="opinion-text">{d.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {c.excluded.length > 0 && (
          <section className="opinion-block" aria-labelledby="op-excluded">
            <h3 id="op-excluded" className="label opinion-label">Excluded evidence</h3>
            <ul className="excluded">
              {c.excluded.map((x) => (
                <li key={x.id} className="excluded-row">
                  <span className="cite cite-forged">{x.id}</span>
                  <span className="opinion-text">{x.why}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {c.herded && (
          <aside className="callout" aria-label="Herding">
            <span className="callout-dot" aria-hidden="true" />
            <div>
              <p className="callout-title">
                Herding detected
                {c.herded.flips > 0 && (
                  <span className="muted">
                    {" "}
                    · {c.herded.flips} {c.herded.flips === 1 ? "juror changed their vote" : "jurors changed their votes"}
                  </span>
                )}
              </p>
              <p className="opinion-text">{c.herded.note}</p>
            </div>
          </aside>
        )}
      </div>

      <div className="opinion-actions">
        <button type="button" className="btn btn-primary" onClick={() => resetCourt()}>
          <IconPlus />
          New case
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={live}
          title={live ? "Replay works for cases played in this browser" : undefined}
          onClick={() => {
            seek(0);
            play();
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            document.getElementById("scene-root")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
          }}
        >
          <IconReplay />
          Replay deliberation
        </button>
        <Link to="/certificate" className="btn btn-ghost">
          <IconShieldCheck />
          Verify certificate
        </Link>
      </div>
    </section>
  );
}
