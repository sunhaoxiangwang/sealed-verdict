import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CategoryTick } from "./CategoryTick";
import { num, pct, token, type TipProps } from "./format";
import type { Condition } from "./types";

interface Row {
  id: string;
  label: string;
  score: number;
  lo: number;
  hi: number;
  errorY: [number, number];
  accuracy: number;
  transport: string;
  fill: string;
}

function LadderTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Row;
  return (
    <div className="chart-tip">
      <div className="chart-tip-head">
        <span>{r.id}</span> {r.label}
      </div>
      <dl>
        <dt>bias</dt>
        <dd>{num(r.score)}</dd>
        <dt>95% CI</dt>
        <dd>
          [{num(r.lo)}, {num(r.hi)}]
        </dd>
        <dt>accuracy</dt>
        <dd>{pct(r.accuracy)}</dd>
        <dt>transport</dt>
        <dd>{r.transport}</dd>
      </dl>
    </div>
  );
}

export default function LadderChart({ conditions }: { conditions: Condition[] }) {
  const base = conditions.find((c) => c.id === "C0");
  const wax = token("--wax-2", "#c62828");
  const verified = token("--verified", "#5ac47c");
  const brass = token("--brass-2", "#8a6a2a");
  const ink = token("--ink", "#f1ead9");
  const parchment = token("--parchment", "#e8dcc0");
  const dim = token("--ink-dim", "#a69a86");
  const oak = token("--oak", "#4a2e1b");

  const rows: Row[] = conditions.map((c) => ({
    id: c.id,
    label: c.label,
    score: c.biasScore,
    lo: c.ci[0],
    hi: c.ci[1],
    errorY: [c.biasScore - c.ci[0], c.ci[1] - c.biasScore],
    accuracy: c.accuracy,
    transport: c.transport,
    fill: c.id === "C0" || c.id === "C1" ? brass : base && c.biasScore > base.biasScore ? wax : verified,
  }));
  const labels = Object.fromEntries(conditions.map((c) => [c.id, c.label]));
  const top = Math.max(0.1, ...conditions.map((c) => c.ci[1]));

  return (
    <div className="chart-scroll">
      <div className="chart-inner wide">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={oak} strokeOpacity={0.6} />
            <XAxis
              dataKey="id"
              interval={0}
              height={64}
              tickLine={false}
              axisLine={{ stroke: oak }}
              tick={<CategoryTick labels={labels} />}
            />
            <YAxis
              domain={[0, Math.ceil(top * 20) / 20]}
              tickFormatter={(v: number) => num(v, 2)}
              tick={{ fill: dim, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip cursor={{ fill: "rgba(232, 220, 192, 0.06)" }} content={(p) => <LadderTooltip {...p} />} />
            {base && (
              <ReferenceLine
                y={base.biasScore}
                stroke={parchment}
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                label={{ value: "single-model baseline", position: "insideTopRight", fill: dim, fontSize: 11 }}
              />
            )}
            <Bar dataKey="score" maxBarSize={80} radius={[3, 3, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.id} fill={r.fill} />
              ))}
              <ErrorBar dataKey="errorY" direction="y" width={8} stroke={ink} strokeWidth={1.5} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
