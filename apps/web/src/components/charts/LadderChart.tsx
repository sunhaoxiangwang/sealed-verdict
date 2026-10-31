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
  const herded = token("--data-herded", "#c62828");
  const held = token("--data-held", "#5ac47c");
  const baseline = token("--data-baseline", "#8a6a2a");
  const ink = token("--text", "#f3efe8");
  const soft = token("--text-2", "#a9a3b3");
  const dim = token("--text-3", "#8a8497");
  const grid = token("--grid", "rgba(255, 255, 255, 0.06)");

  const rows: Row[] = conditions.map((c) => ({
    id: c.id,
    label: c.label,
    score: c.biasScore,
    lo: c.ci[0],
    hi: c.ci[1],
    errorY: [c.biasScore - c.ci[0], c.ci[1] - c.biasScore],
    accuracy: c.accuracy,
    transport: c.transport,
    fill: c.id === "C0" || c.id === "C1" ? baseline : base && c.biasScore > base.biasScore ? herded : held,
  }));
  const labels = Object.fromEntries(conditions.map((c) => [c.id, c.label]));
  const top = Math.max(0.1, ...conditions.map((c) => c.ci[1]));

  return (
    <div className="chart-scroll">
      <div className="chart-inner wide">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis
              dataKey="id"
              interval={0}
              height={64}
              tickLine={false}
              axisLine={{ stroke: grid }}
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
            <Tooltip cursor={{ fill: "rgba(255, 255, 255, 0.04)" }} content={(p) => <LadderTooltip {...p} />} />
            {base && (
              <ReferenceLine
                y={base.biasScore}
                stroke={soft}
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                label={{ value: "single-model baseline", position: "insideTopRight", fill: dim, fontSize: 11 }}
              />
            )}
            <Bar dataKey="score" maxBarSize={80} radius={[4, 4, 0, 0]}>
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
