import { useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useTribunal } from "../store/tribunal";
import Logo from "./Logo";

const LINKS = [
  { to: "/courtroom", label: "Courtroom" },
  { to: "/results", label: "Results" },
  { to: "/replay", label: "Replay" },
  { to: "/certificate", label: "Certificate" },
];

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
          <Logo />
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
