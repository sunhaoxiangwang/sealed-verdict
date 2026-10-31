import { useEffect, useState } from "react";
import LadderChart from "../components/charts/LadderChart";
import RateBarChart, { type RateField } from "../components/charts/RateBarChart";
import { num, pct, pVal, token } from "../components/charts/format";
import type { Condition, Results as ResultsData } from "../components/charts/types";
import "../styles/results.css";

const HERDING_IDS = ["C2", "C3", "C4", "C5"];

const find = (list: Condition[], id: string) => list.find((c) => c.id === id);

function Skeleton() {
  return (
    <div className="results" aria-busy="true" aria-label="Loading results">
      <div className="skeleton sk-title" />
      <div className="skeleton sk-line" />
      <div className="stat-grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton sk-tile" />
        ))}
      </div>
      <div className="skeleton sk-chart" />
      <div className="split">
        <div className="skeleton sk-chart-sm" />
        <div className="skeleton sk-chart-sm" />
      </div>
    </div>
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
          <p className="muted">results.json: {error}</p>
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

  const wax = token("--wax-2", "#c62828");
  const brass = token("--brass", "#c9a24a");
  const brass2 = token("--brass-2", "#8a6a2a");
  const verified = token("--verified", "#5ac47c");
  const forged = token("--forged", "#e04b3a");

  const herdingFields: RateField[] = [{ field: "herdingFlipRate", label: "Herding flip rate", color: brass2 }];
  const herdingColor = (id: string) => (id === "C2" ? wax : id === "C5" ? verified : undefined);
  const attackFields: RateField[] = [
    { field: "byzantineFlipRate", label: "Byzantine flip rate", color: brass },
    { field: "forgedAcceptRate", label: "Forged accept rate", color: forged },
  ];

  return (
    <div className="results">
      <header className="results-head">
        <p className="kicker">The Coroner&rsquo;s Findings</p>
        <h1>Bias ablation ladder</h1>
      </header>

      <p className="results-lede">
        Multi-agent debate makes LLM bias worse (C2 &gt; C0). The protocol on Agent Relay brings it below baseline (C5).
      </p>

      <div className="stat-grid" role="group" aria-label="Key figures">
        <div className="stat">
          <div className="stat-label">Bias reduction, C0 → C5</div>
          <div className="stat-value good">{reduction === null ? "—" : `${Math.round(reduction * 100)}%`}</div>
        </div>
        <div className="stat">
          <div className="stat-label">C5 vs C0</div>
          <div className="stat-value">{pVal(c5?.pVsC0 ?? null)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Herding flips, C2 → C5</div>
          <div className="stat-value">{`${pct(c2?.herdingFlipRate ?? null)} → ${pct(c5?.herdingFlipRate ?? null)}`}</div>
        </div>
      </div>

      <section className="panel panel-stamped">
        <h2>Bias score by condition</h2>
        <div className="stamp-slip">
          {measured ? (
            <span className="stamp stamp-green status-pill measured">{`Entered into record · n=${n.bbq}+${n.truthfulqa}`}</span>
          ) : (
            <span className="stamp stamp-red status-pill illustrative">Specimen — not measured</span>
          )}
        </div>
        <LadderChart conditions={conditions} />
        <p className="caption">BBQ ambiguous bias score; 0 is unbiased, lower is better. Bars show bootstrap 95% CI.</p>
      </section>

      <div className="split">
        <section className="panel">
          <h2>Herding: correct→wrong flips after deliberation</h2>
          <RateBarChart conditions={conditions} ids={HERDING_IDS} fields={herdingFields} cellColor={herdingColor} />
        </section>
        <section className="panel">
          <h2>Attack resistance</h2>
          <RateBarChart conditions={conditions} ids={HERDING_IDS} fields={attackFields} />
        </section>
      </div>

      <section className="panel">
        <h2>All numbers</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>condition</th>
                <th>transport</th>
                <th>bias</th>
                <th>95% CI</th>
                <th>accuracy</th>
                <th>herding flip</th>
                <th>byzantine flip</th>
                <th>forged accept</th>
                <th>p vs C0</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.label}</td>
                  <td>{c.transport}</td>
                  <td>{num(c.biasScore)}</td>
                  <td>
                    [{num(c.ci[0])}, {num(c.ci[1])}]
                  </td>
                  <td>{num(c.accuracy)}</td>
                  <td>{num(c.herdingFlipRate)}</td>
                  <td>{num(c.byzantineFlipRate)}</td>
                  <td>{num(c.forgedAcceptRate)}</td>
                  <td>{num(c.pVsC0, 3)}</td>
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
