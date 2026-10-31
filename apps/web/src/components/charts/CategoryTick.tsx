import { token, wrapLabel } from "./format";

export interface CategoryTickProps {
  x?: number;
  y?: number;
  payload?: { value: string };
  labels: Record<string, string>;
}

/** X-axis tick: condition id on the first line, its label wrapped underneath. */
export function CategoryTick({ x = 0, y = 0, payload, labels }: CategoryTickProps) {
  const id = payload?.value ?? "";
  const lines = wrapLabel(labels[id] ?? "");
  const brass = token("--brass", "#c9a24a");
  const dim = token("--ink-dim", "#a69a86");
  return (
    <text x={x} y={y + 12} textAnchor="middle" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <tspan x={x} dy={0} fill={brass}>
        {id}
      </tspan>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={14} fill={dim}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
