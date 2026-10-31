import { Fragment } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CategoryTick } from "./CategoryTick";
import { token, type TipProps } from "./format";
import type { Condition } from "./types";

export type RateKey = "herdingFlipRate" | "byzantineFlipRate" | "forgedAcceptRate";

export interface RateField {
  field: RateKey;
  label: string;
  color: string;
}

interface Props {
  conditions: Condition[];
  ids: string[];
  fields: RateField[];
  cellColor?: (id: string) => string | undefined;
  height?: number;
}

function RateTooltip({ active, payload, fields }: TipProps & { fields: RateField[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Record<string, unknown> & { id: string; label: string };
  return (
    <div className="chart-tip">
      <div className="chart-tip-head">
        <span>{r.id}</span> {r.label}
      </div>
      <dl>
        {fields.map((f) => {
          const v = r[f.field] as number | null;
          return (
            <Fragment key={f.field}>
              <dt>{f.label}</dt>
              <dd>{v === null ? "—" : `${v.toFixed(0)}%`}</dd>
            </Fragment>
          );
        })}
      </dl>
    </div>
  );
}

/** Grouped (or single-series) bar chart of 0..1 rates shown as percentages. */
export default function RateBarChart({ conditions, ids, fields, cellColor, height = 260 }: Props) {
  const grid = token("--grid", "rgba(255, 255, 255, 0.06)");
  const dim = token("--text-3", "#8a8497");

  const picked = ids.map((id) => conditions.find((c) => c.id === id)).filter((c): c is Condition => Boolean(c));
  const rows = picked.map((c) => {
    const row: Record<string, string | number | null> = { id: c.id, label: c.label };
    for (const f of fields) {
      const v = c[f.field];
      row[f.field] = v === null ? null : v * 100;
    }
    return row;
  });
  const labels = Object.fromEntries(picked.map((c) => [c.id, c.label]));

  return (
    <div className="rate-chart">
      <div className="chart-scroll">
        <div className="chart-inner">
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%" barGap={4}>
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
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: dim, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
                content={(p) => <RateTooltip {...p} fields={fields} />}
              />
              {fields.map((f) => (
                <Bar key={f.field} dataKey={f.field} name={f.label} fill={f.color} maxBarSize={48} radius={[4, 4, 0, 0]}>
                  {rows.map((r) => (
                    <Cell key={String(r.id)} fill={cellColor?.(String(r.id)) ?? f.color} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
