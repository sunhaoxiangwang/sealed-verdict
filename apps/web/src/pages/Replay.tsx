import { useEffect } from "react";
import { createPlayer, type Speed } from "../mock/player";
import { createTribunalStore, type Juror, type TribunalStore } from "../store/tribunal";
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

function Chip({ j, cond }: { j: Juror; cond: "C2" | "C5" }) {
  const v = j.vote ?? "unknown";
  return (
    <div className={`rchip vote-${v}`}>
      <span className="rchip-dot" />
      <span className="rchip-name">{j.pseudonym}</span>
      <span className="rchip-vote">{v}</span>
      <span className="rchip-state">{chipState(j, cond)}</span>
      {j.flipped && <span className="rchip-flip">recanted</span>}
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

  const banner = cert
    ? col.cond === "C2"
      ? `Herded to: ${cert.verdict}`
      : `Held: ${cert.verdict} (${cert.quorum} quorum, ${forged} forged item${forged === 1 ? "" : "s"} excluded)`
    : null;

  return (
    <section className={`rcol rcol-${col.cond}`} aria-label={col.label}>
      <header>
        <h2>{col.label}</h2>
        <p className="muted">{col.blurb}</p>
      </header>
      <div className="rchips">{jurors.map((j) => <Chip key={j.id} j={j} cond={col.cond} />)}</div>
      <div className="rfeed">
        {items.length === 0 && <p className="muted">Waiting for play.</p>}
        {items.map((f) => (
          <div key={f.id} className={`ritem ritem-${f.kind}`}>
            <span className="rname">{f.juror ?? f.kind}</span>
            {f.kind === "evidence" && <span className={`badge ${f.verified ? "verified" : "forged"}`}>{f.verified ? "verified" : "forged"}</span>}
            <span className="rtext">{f.text}</span>
          </div>
        ))}
      </div>
      <div className="rverdict">
        {cert ? <span className="rverdict-line">Verdict: {cert.verdict} ({cert.quorum})</span> : <span className="muted">No verdict yet</span>}
      </div>
      {banner && (
        <div className={`rbanner rbanner-${col.cond}`}>
          <span className="rbanner-text">{banner}</span>
          {col.cond === "C2" ? (
            <span className="stamp stamp-red" style={{ ["--rot" as string]: "-8deg" }}>Tainted by herding</span>
          ) : (
            <span className="stamp stamp-green" style={{ ["--rot" as string]: "-6deg" }}>Held</span>
          )}
        </div>
      )}
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
    <div className="page replay">
      <p className="kicker">Two inquests, one body of evidence</p>
      <h1>Same case, two protocols</h1>
      <div className="demo-controls">
        <button onClick={() => (playing ? both((p) => p.pause()) : both((p) => p.play()))}>{playing ? "Pause" : "Play"}</button>
        <button onClick={() => { both((p) => p.seek(0)); both((p) => p.play()); }}>Restart</button>
        <div className="speed" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={speed === s} onClick={() => both((p) => p.speed(s))}>{s}x</button>
          ))}
        </div>
      </div>
      <div className="rgrid">
        {COLUMNS.map((c) => <Column key={c.cond} col={c} />)}
      </div>
    </div>
  );
}
