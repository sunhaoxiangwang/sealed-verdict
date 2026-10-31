import { useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useTribunal } from "../store/tribunal";

const LINKS = [
  { to: "/courtroom", label: "Courtroom" },
  { to: "/results", label: "Results" },
  { to: "/replay", label: "Replay" },
  { to: "/certificate", label: "Certificate" },
];

/** 20px seal mark: brass ring, dark centre, tiny SV. */
function SealMark() {
  return (
    <svg className="seal-mark" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle className="seal-mark-disc" cx="10" cy="10" r="9" />
      <circle className="seal-mark-inner" cx="10" cy="10" r="6.9" />
      <text className="seal-mark-text" x="10" y="12.7" textAnchor="middle">SV</text>
    </svg>
  );
}

export default function TopNav() {
  const phase = useTribunal((s) => s.phase);
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const running = phase !== "idle";

  // On phones the nav pill scrolls sideways; keep the current page in view.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2 });
  }, [pathname]);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/courtroom" className="brand" aria-label="Sealed Verdict, courtroom">
          <SealMark />
          <span>Sealed Verdict</span>
        </Link>
        <nav ref={navRef} className="seg nav-seg" aria-label="Main">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className="seg-item">
              {l.label}
            </NavLink>
          ))}
        </nav>
        <span className="status" data-running={running} role="status">
          <span key={phase} className={`dot${running ? " dot-ember" : ""}`} aria-hidden="true" />
          <span className="sr-only">Phase: </span>
          {running ? phase : "idle"}
        </span>
      </div>
    </header>
  );
}
