import { useId } from "react";
import "../styles/logo.css";

type LogoProps = {
  /** Mark size in px (square). */
  size?: number;
  /** Show the "Sealed Verdict" wordmark beside the mark. */
  wordmark?: boolean;
};

/** Back of a sealed envelope with a wax seal: the verdict arrives under seal. */
export default function Logo({ size = 28, wordmark = true }: LogoProps) {
  const gradId = `sv-wax-${useId().replace(/:/g, "")}`;
  return (
    <span className="logo">
      <svg
        className="logo-mark"
        width={size}
        height={size}
        viewBox="0 0 28 28"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id={gradId} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffb066" />
            <stop offset="35%" stopColor="#ff8c3a" />
            <stop offset="70%" stopColor="#e2412e" />
            <stop offset="100%" stopColor="#9f1239" />
          </radialGradient>
        </defs>
        <g fill="none" stroke="#f3efe8" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <rect x="4.5" y="7.5" width="19" height="13.5" rx="2.6" />
          <polyline points="5.4,8.4 14,15 22.6,8.4" />
        </g>
        <g className="logo-seal">
          <circle
            cx="14"
            cy="15.2"
            r="3.9"
            fill={`url(#${gradId})`}
            stroke="#7f1d1d"
            strokeOpacity="0.6"
            strokeWidth="0.8"
          />
          <ellipse cx="12.8" cy="13.9" rx="1.1" ry="0.7" fill="#fff" fillOpacity="0.35" />
        </g>
      </svg>
      {wordmark && (
        <span className="logo-word">
          Sealed<em> Verdict</em>
        </span>
      )}
    </span>
  );
}
