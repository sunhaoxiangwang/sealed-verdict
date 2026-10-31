import { NavLink } from "react-router-dom";
import { useTribunal } from "../store/tribunal";

const LINKS = [
  { to: "/courtroom", label: "Courtroom" },
  { to: "/results", label: "Results" },
  { to: "/replay", label: "Replay" },
  { to: "/certificate", label: "Certificate" },
];

export default function TopNav() {
  const phase = useTribunal((s) => s.phase);
  return (
    <header className="topnav">
      <span className="brand">Sealed Verdict</span>
      <nav className="topnav-links" aria-label="Main">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className="nav-link">
            {l.label}
          </NavLink>
        ))}
      </nav>
      <span className="pill" aria-label="Current phase">phase: {phase}</span>
    </header>
  );
}
