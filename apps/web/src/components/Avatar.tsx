import type { Juror } from "../store/tribunal";

/** Four fixed muted hues (--hue-0..3 in tokens.css). */
const HUES = 4;

export function initials(name: string): string {
  const base = name.split("-")[0] || name;
  return base.slice(0, 2);
}

/** A juror's hue is its position in the jury, so four jurors always get four different hues. Unknown names hash. */
export function hueIndex(name: string, jurors?: ReadonlyArray<Pick<Juror, "id" | "pseudonym">>): number {
  const at = jurors ? jurors.findIndex((j) => j.id === name || j.pseudonym === name) : -1;
  if (at >= 0) return at % HUES;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % HUES;
}

export default function Avatar({
  name,
  hue,
  speaking = false,
  small = false,
}: {
  name: string;
  hue: number;
  speaking?: boolean;
  small?: boolean;
}) {
  return (
    <span className={`avatar${small ? " avatar-sm" : ""}${speaking ? " is-speaking" : ""}`} data-hue={hue} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
