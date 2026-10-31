export interface LegendItem {
  label: string;
  color: string;
}

/** Right-aligned chart legend, rendered in the card header. */
export default function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="legend" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label}>
          <i className="legend-swatch" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
