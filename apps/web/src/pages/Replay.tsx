import { useEffect, useRef } from "react";
import { createPlayer, type Speed } from "../mock/player";
import { createTribunalStore, type Juror, type TribunalStore } from "../store/tribunal";
import Avatar, { hueIndex } from "../components/Avatar";
import { LedgerEntry } from "../components/TranscriptFeed";
import { IconPause, IconPlay, IconReplay } from "../components/icons";
import { useStickToBottom } from "../components/useStickToBottom";
import "../styles/replay.css";

// Two independent tribunals: same case, two conditions.
const storeC2 = createTribunalStore();
const storeC5 = createTribunalStore();
const pC2 = createPlayer(storeC2);
const pC5 = createPlayer(storeC5);
const SPEEDS: Speed[] = [1, 2, 4];

const COLUMNS = [
  { cond: "C2" as const, store: storeC2, p: pC2, label: "C2 · Open debate", blurb: "Jurors see each other's messages as they argue. No signatures, no blind votes." },
  { cond: "C5" as const, store: storeC5, p: pC5, label: "C5 · Signed protocol", blurb: "Signed evidence, blind commit-reveal, hash-chained transcript." },
];

function chipState(j: Juror, cond: "C2" | "C5") {
  if (cond === "C2") return j.vote ? "stated" : "listening";
  return j.revealed ? "revealed" : j.committed ? "committed" : "waiting";
}

const voteTone = (v: string) => (v === "true" ? "verified" : v === "false" ? "forged" : v === "uncertain" ? "uncertain" : "neutral");

function Chip({ j, cond, hue }: { j: Juror; cond: "C2" | "C5"; hue: number }) {
  const v = j.vote ?? "unknown";
  return (
    <div className={`rchip vote-${v}`}>
      <Avatar name={j.pseudonym} hue={hue} speaking={j.speaking} />
      <span className="rchip-name">{j.pseudonym}</span>
      <span className={`pill pill-${voteTone(v)} rchip-vote`}>{v === "unknown" ? "no vote" : v}</span>
      <span className="rchip-state">{chipState(j, cond)}</span>
      {j.flipped && <span className="pill pill-forged rchip-flip">flipped</span>}
    </div>
  );
}

function Column({ col }: { col: (typeof COLUMNS)[number] }) {
  const s: TribunalStore = col.store;
  const jurors = s((x) => x.jurors);
  const feed = s((x) => x.feed);
  const cert = s((x) => x.certificate);
  const messages = s((x) => x.messages);
  const forged = messages.filter((m) => m.kind === "evidence" && !m.verified).length;
  const items = feed.filter((f) => f.kind === "argument" || f.kind === "evidence" || f.kind === "verdict" || f.kind === "reveal");
  const feedRef = useRef<HTMLDivElement>(null);
  useStickToBottom(feedRef, items.length);

  const banner = cert
    ? col.cond === "C2"
      ? `Herded to: ${cert.verdict} (${cert.quorum})`
      : `Held: ${cert.verdict} (${cert.quorum} quorum, ${forged} forged item${forged === 1 ? "" : "s"} excluded)`
    : null;

  return (
    <section className={`rcol rcol-${col.cond}`} aria-label={col.label}>
      <header className="rcol-head">
        <h2>{col.label}</h2>
        <p>{col.blurb}</p>
      </header>
      <div className="rcol-body">
        <div className="rchips">
          {jurors.map((j) => (
            <Chip key={j.id} j={j} cond={col.cond} hue={hueIndex(j.id, jurors)} />
          ))}
        </div>
        <div ref={feedRef} className="rfeed" tabIndex={0} aria-label={`${col.label} transcript`}>
          {items.length === 0 && <p className="rfeed-empty">Press Play to run this case.</p>}
          {items.map((f) => (
            <LedgerEntry key={f.id} item={f} jurors={jurors} speaking={false} dense />
          ))}
        </div>
        <div className={`verdict-bar rbanner-${col.cond}`} data-tone={banner ? (col.cond === "C2" ? "forged" : "verified") : "none"}>
          <span className="verdict-text">{banner ?? "No verdict yet"}</span>
          {banner && (col.cond === "C2" ? <span className="pill pill-forged">Tainted by herding</span> : <span className="pill pill-verified">Held</span>)}
        </div>
      </div>
    </section>
  );
}

export default function Replay() {
  const a = pC2.usePlayerStore();
  const b = pC5.usePlayerStore();
  const playing = a.playing || b.playing;
  const speed = a.speed;

  useEffect(() => {
    pC2.load("C2");
    pC5.load("C5");
    return () => {
      pC2.player.pause();
      pC5.player.pause();
    };
  }, []);

  const both = (f: (p: typeof pC2.player) => void) => { f(pC2.player); f(pC5.player); };

  return (
    <div className="replay">
      <header className="replay-head">
        <h1>Same case, two protocols</h1>
        <div className="controls" role="group" aria-label="Replay controls">
          <div className="controls-group">
            <button className="btn btn-primary" onClick={() => (playing ? both((p) => p.pause()) : both((p) => p.play()))}>
              {playing ? <IconPause /> : <IconPlay />}
              {playing ? "Pause" : "Play"}
            </button>
            <button className="btn btn-ghost" onClick={() => { both((p) => p.seek(0)); both((p) => p.play()); }}>
              <IconReplay />
              Restart
            </button>
            <div className="seg" role="group" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button key={s} className="seg-item" aria-pressed={speed === s} onClick={() => both((p) => p.speed(s))}>
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>
      <div className="rgrid">
        {COLUMNS.map((c) => <Column key={c.cond} col={c} />)}
      </div>
    </div>
  );
}
