export const num = (v: number | null, digits = 2): string => (v === null ? "—" : v.toFixed(digits));

export const pct = (v: number | null, digits = 0): string => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`);

export const pVal = (v: number | null): string => (v === null ? "—" : `p = ${v.toFixed(3)}`);

/** SVG presentation attributes cannot read var(), so chart colours are resolved from tokens.css at render time. */
export function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Split a label into at most `lines` lines of roughly `max` characters, breaking on spaces. */
export function wrapLabel(text: string, max = 13, lines = 3): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > max && cur) {
      out.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out.slice(0, lines);
}

/** Minimal shape of the props Recharts passes to a custom tooltip content component. */
export interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}
