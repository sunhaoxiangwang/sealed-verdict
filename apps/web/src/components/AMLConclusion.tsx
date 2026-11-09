import { useAML } from "../live/aml";
import { useTribunal } from "../store/tribunal";

const conclusions: Record<string, {title: string; text: string}> = {
  escalate: { title: "Suspicious activity warrants investigation", text: "The evidence supports escalating this case for a human AML investigation. The activity should not be cleared on the information currently available." },
  close: { title: "The supplied evidence does not justify escalation", text: "The panel supports closing this alert on the supplied evidence. This is a case-review recommendation, not proof that no wrongdoing occurred." },
  need_more_info: { title: "More evidence is needed to reach a conclusion", text: "The panel cannot responsibly clear or escalate this activity yet. Obtain the missing records and reassess the case." },
  NO_QUORUM: { title: "The panel did not reach a shared conclusion", text: "Fewer than three jurors agreed. The case needs human review rather than an automated decision." },
};
export default function AMLConclusion() {
  const { snapshot, pendingCase } = useAML();
  const bundle = useTribunal(s => s.protocolBundle);
  if (pendingCase || !bundle || snapshot?.run?.status !== "complete") return <section className="aml-conclusion"><h2>Case conclusion</h2><p>{pendingCase ? "Your uploaded case is ready. Run the analysis to obtain its conclusion." : "The conclusion will appear here after the agents complete their evidence review."}</p></section>;
  const c = conclusions[bundle.cert.body.verdict] || conclusions.NO_QUORUM;
  const reason = snapshot.run.assessments?.find(a => a.answer === bundle.cert.body.verdict);
  const discussion = bundle.transcript.find(e => e.kind === "argument" && e.status === "accepted");
  return <section className="aml-conclusion" aria-label="Case conclusion">
    <span className="kicker">Case conclusion</span><h2>{c.title}</h2><p>{c.text}</p>
    {reason ? <p><strong>Supporting judgment ({reason.juror}): </strong>{reason.reason}</p> : discussion && <p><strong>Panel’s supporting analysis: </strong>{discussion.msg.body.text}</p>}
    <small>{bundle.cert.body.votes.filter(v => v.body.vote === bundle.cert.body.verdict).length} of 4 final ballots support this conclusion. Human approval remains pending; no SAR has been filed.</small>
  </section>;
}
