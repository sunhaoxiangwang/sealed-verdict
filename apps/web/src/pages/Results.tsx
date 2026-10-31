import { useEffect, useState, type ReactNode } from "react";
import LadderChart from "../components/charts/LadderChart";
import Legend, { type LegendItem } from "../components/charts/Legend";
import RateBarChart, { type RateField } from "../components/charts/RateBarChart";
import { num, pct, pVal, token } from "../components/charts/format";
import type { Condition, Results as ResultsData } from "../components/charts/types";
import { IconArrowRight } from "../components/icons";
import "../styles/results.css";

const HERDING_IDS = ["C2", "C3", "C4", "C5"];

const find = (list: Condition[], id: string) => list.find((c) => c.id === id);

/** "p = 0.003" with an italic p; anything else (the em dash for no data) passes through. */
function PValue({ text }: { text: string }) {
  return text.startsWith("p = ") ? (
    <span>
      <em>p</em> = {text.slice(4)}
    </span>
  ) : (
    <span>{text}</span>
  );
}

function Flow({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <span className="flow">
      {from}
      <IconArrowRight size={13} />
      {to}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="results" aria-busy="true" aria-label="Loading results">
      <div className="skeleton sk-title" />
      <div className="skeleton sk-line" />
      <div className="skeleton sk-stats" />
      <div className="skeleton sk-chart" />
      <div className="split">
        <div className="skeleton sk-chart-sm" />
        <div className="skeleton sk-chart-sm" />
      </div>
    </div>
  );
}

function ChartCard({ title, legend, children }: { title: string; legend?: LegendItem[]; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2 className="card-title">{title}</h2>
        {legend && <Legend items={legend} />}
      </header>
      {children}
    </section>
  );
}

export default function Results() {
  const [data, setData] = useState<ResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/results.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ResultsData>;
      })
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="results">
        <h1>Bias ablation ladder</h1>
        <div className="error-card" role="alert">
          <h2>Could not load results</h2>
          <p>
            <span className="mono">results.json</span> failed to load ({error}). Check that <span className="mono">public/results.json</span> exists, then reload.
          </p>
          <button className="btn btn-ghost" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <Skeleton />;

  const { conditions, measured, n } = data;
  const c0 = find(conditions, "C0");
  const c2 = find(conditions, "C2");
  const c5 = find(conditions, "C5");
  const reduction = c0 && c5 && c0.biasScore > 0 ? (c0.biasScore - c5.biasScore) / c0.biasScore : null;

  const herded = token("--data-herded", "#c62828");
  const held = token("--data-held", "#5ac47c");
  const baseline = token("--data-baseline", "#8a6a2a");
  const byzantine = token("--data-byzantine", "#c9a24a");
  const forged = token("--data-forged", "#e04b3a");

  const herdingFields: RateField[] = [{ field: "herdingFlipRate", label: "Herding flip rate", color: baseline }];
  const herdingColor = (id: string) => (id === "C2" ? herded : id === "C5" ? held : undefined);
  const attackFields: RateField[] = [
    { field: "byzantineFlipRate", label: "Byzantine flip rate", color: byzantine },
    { field: "forgedAcceptRate", label: "Forged accept rate", color: forged },
  ];

  const ladderLegend: LegendItem[] = [
    { label: "Single-model controls", color: baseline },
    { label: "Above baseline", color: herded },
    { label: "Below baseline", color: held },
  ];
  const herdingLegend: LegendItem[] = [
    { label: "Open debate", color: herded },
    { label: "Signed protocol", color: held },
    { label: "Other rungs", color: baseline },
  ];
  const attackLegend: LegendItem[] = attackFields.map((f) => ({ label: f.label, color: f.color }));

  return (
    <div className="results">
      <header className="page-head">
        <h1>Bias ablation ladder</h1>
        {measured ? (
          <span className="pill pill-note pill-verified status-pill measured">{`Measured · n=${n.bbq}+${n.truthfulqa}`}</span>
        ) : (
          <span className="pill pill-note pill-uncertain status-pill illustrative">Illustrative data</span>
        )}
      </header>

      <p className="results-lede">
        Multi-agent debate makes LLM bias worse (C2 &gt; C0). The protocol on Agent Relay brings it below baseline (C5).
      </p>

      <div className="stats" role="group" aria-label="Key figures">
        <div className="stat">
          <div className="stat-label">Bias reduction</div>
          <div className="stat-value is-good">{reduction === null ? "—" : `${Math.round(reduction * 100)}%`}</div>
          <div className="stat-note">
            <Flow from="C0" to="C5" />
            <span aria-hidden="true">·</span>
            <span>bias</span>
            <Flow from={<span className="mono">{num(c0?.biasScore ?? null)}</span>} to={<span className="mono">{num(c5?.biasScore ?? null)}</span>} />
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Significance</div>
          <div className="stat-value">
            <PValue text={pVal(c5?.pVsC0 ?? null)} />
          </div>
          <div className="stat-note">C5 vs the C0 baseline</div>
        </div>
        <div className="stat">
          <div className="stat-label">Herding flips</div>
          <div className="stat-value">
            <Flow from={pct(c2?.herdingFlipRate ?? null)} to={pct(c5?.herdingFlipRate ?? null)} />
          </div>
          <div className="stat-note">
            <Flow from="C2" to="C5" />
            <span aria-hidden="true">·</span>
            <span>correct answers turned wrong</span>
          </div>
        </div>
      </div>

      <ChartCard title="Bias score by condition" legend={ladderLegend}>
        <LadderChart conditions={conditions} />
        <p className="caption">BBQ ambiguous bias score; 0 is unbiased, lower is better. Bars show bootstrap 95% CI.</p>
      </ChartCard>

      <div className="split">
        <ChartCard title="Herding: correct-to-wrong flips after deliberation" legend={herdingLegend}>
          <RateBarChart conditions={conditions} ids={HERDING_IDS} fields={herdingFields} cellColor={herdingColor} />
        </ChartCard>
        <ChartCard title="Attack resistance" legend={attackLegend}>
          <RateBarChart conditions={conditions} ids={HERDING_IDS} fields={attackFields} />
        </ChartCard>
      </div>

      <section className="card">
        <header className="card-head">
          <h2 className="card-title">All numbers</h2>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>condition</th>
                <th>transport</th>
                <th className="num">bias</th>
                <th className="num">95% CI</th>
                <th className="num">accuracy</th>
                <th className="num">herding flip</th>
                <th className="num">byzantine flip</th>
                <th className="num">forged accept</th>
                <th className="num">p vs C0</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((c) => (
                <tr key={c.id}>
                  <td className="id">{c.id}</td>
                  <td>{c.label}</td>
                  <td>{c.transport}</td>
                  <td className="num">{num(c.biasScore)}</td>
                  <td className="num">
                    [{num(c.ci[0])}, {num(c.ci[1])}]
                  </td>
                  <td className="num">{num(c.accuracy)}</td>
                  <td className="num">{num(c.herdingFlipRate)}</td>
                  <td className="num">{num(c.byzantineFlipRate)}</td>
                  <td className="num">{num(c.forgedAcceptRate)}</td>
                  <td className="num">{num(c.pVsC0, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="results-foot">Pre-registered metrics; see eval/PREREGISTRATION.md</footer>
    </div>
  );
}
