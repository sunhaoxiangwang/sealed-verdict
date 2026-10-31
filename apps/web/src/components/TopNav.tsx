import { NavLink, useLocation } from "react-router-dom";
import { useTribunal } from "../store/tribunal";

const LINKS = [
  { to: "/courtroom", label: "Courtroom" },
  { to: "/results", label: "Results" },
  { to: "/replay", label: "Replay" },
  { to: "/certificate", label: "Certificate" },
];

function SealGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <defs>
        <radialGradient id="sv-glyph-wax" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#d23a3a" />
          <stop offset="0.55" stopColor="#9b1b1b" />
          <stop offset="1" stopColor="#5e0f0f" />
        </radialGradient>
      </defs>
      <path d="M7 .6c1 0 1.6.8 2.5.9.9.1 1.8-.2 2.4.5.6.7.2 1.6.5 2.4.3.8 1.2 1.3 1.2 2.2s-.9 1.4-1.2 2.2c-.3.8.1 1.7-.5 2.4-.6.7-1.5.4-2.4.5-.9.1-1.5.9-2.5.9s-1.6-.8-2.5-.9c-.9-.1-1.8.2-2.4-.5-.6-.7-.2-1.6-.5-2.4C1.3 8.6.4 8.1.4 7.2s.9-1.4 1.2-2.2c.3-.8-.1-1.7.5-2.4.6-.7 1.5-.4 2.4-.5C5.4 2.1 6 .6 7 .6z" fill="url(#sv-glyph-wax)" />
      <circle cx="7" cy="7" r="3.6" fill="none" stroke="#000" strokeOpacity=".35" strokeWidth=".8" />
      <path d="M5.2 8.3c.5.6 1.2.8 1.9.7.9-.1 1.2-1 .6-1.5-.6-.5-1.9-.3-2.1-1.1-.2-.8.6-1.4 1.4-1.3.5 0 .9.2 1.2.5" fill="none" stroke="#f1c9b0" strokeOpacity=".8" strokeWidth=".9" strokeLinecap="round" />
    </svg>
  );
}

export default function TopNav() {
  const phase = useTribunal((s) => s.phase);
  const { pathname } = useLocation();
  const onCourtroom = pathname === "/" || pathname.startsWith("/courtroom");
  return (
    <header className="topnav">
      <div className="brand-block">
        <span className="brand">
          <SealGlyph />
          Sealed Verdict
        </span>
        {onCourtroom && <p className="tagline">Debate gives you agreement. Signatures give you accountability.</p>}
      </div>
      <nav className="topnav-links" aria-label="Main">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className="nav-link">
            {l.label}
          </NavLink>
        ))}
      </nav>
      <span className="pill" aria-label={`Current phase: ${phase}`}>
        <span className="pill-k">phase</span>
        <span className="pill-v">{phase}</span>
      </span>
    </header>
  );
}
