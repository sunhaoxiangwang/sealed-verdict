import { useMemo, useRef, type ReactNode } from "react";
import { useTribunal, type FeedItem, type Juror } from "../store/tribunal";
import Avatar, { hueIndex } from "./Avatar";
import { IconFileText, IconShield } from "./icons";
import { useStickToBottom } from "./useStickToBottom";

const SIGNED = new Set<FeedItem["kind"]>(["evidence", "commit", "reveal", "argument", "verdict"]);

function StatusPill({ item }: { item: FeedItem }) {
  if (!SIGNED.has(item.kind)) return null;
  if (item.unattested) return <span className="pill pill-forged unattested">unattested</span>;
  return item.verified ? (
    <span className="pill pill-verified verified">verified</span>
  ) : (
    <span className="pill pill-forged forged">forged</span>
  );
}

/** Evidence text is "<kind> <source>: <excerpt>". Anything else is shown whole. */
function parseEvidence(text: string) {
  const m = /^(\S+)\s+(.+?):\s+([\s\S]*)$/.exec(text);
  return m ? { kind: m[1], source: m[2], excerpt: m[3] } : null;
}

function Body({ item }: { item: FeedItem }): ReactNode {
  if (item.kind === "commit") {
    const m = /^committed\s+(\S+)$/.exec(item.text);
    if (m) {
      return (
        <>
          Committed <span className="mono">{m[1]}</span>
        </>
      );
    }
  }
  if (item.kind === "reveal") {
    const m = /^revealed\s+(true|false|uncertain)\s+\(confidence\s+([\d.]+)\)$/.exec(item.text);
    if (m) {
      return (
        <>
          Revealed <span className={`vote-word vote-${m[1]}`}>{m[1]}</span>, confidence <span className="mono">{m[2]}</span>
        </>
      );
    }
  }
  if (item.kind === "verdict") {
    const m = /^verdict:\s+(.+?)\s+\(quorum\s+([^)]+)\)$/.exec(item.text);
    if (m) {
      return (
        <>
          <strong>{m[1]}</strong> <span className="mono">quorum {m[2]}</span>
        </>
      );
    }
  }
  return item.text;
}

export function LedgerEntry({
  item,
  jurors,
  speaking = false,
  dense = false,
}: {
  item: FeedItem;
  jurors: ReadonlyArray<Juror>;
  speaking?: boolean;
  dense?: boolean;
}) {
  if (item.kind === "system" || item.kind === "phase") {
    const text = item.kind === "phase" ? `Phase · ${item.text.replace(/^phase:\s*/i, "")}` : item.text;
    const error = item.kind === "system" && !item.verified;
    return (
      <div className={`entry-line is-${item.kind}${error ? " is-error" : ""}`}>
        <span>{text}</span>
      </div>
    );
  }

  const cls = `entry${dense ? " entry-dense" : ""}`;

  if (item.kind === "evidence") {
    const ev = parseEvidence(item.text);
    return (
      <article className={cls}>
        <span className={`glyph-disc${item.verified ? "" : " is-forged"}`}>
          <IconFileText size={dense ? 12 : 14} />
        </span>
        <div>
          <div className="entry-head">
            <span className="entry-name">Exhibit {item.evidenceIds?.[0] ?? ""}</span>
            {ev && (
              <span className="entry-kind">
                <span aria-hidden="true">· </span>
                {ev.kind}
              </span>
            )}
            <StatusPill item={item} />
          </div>
          {ev && <div className="entry-source mono">{ev.source}</div>}
          <div className="entry-body">{ev ? ev.excerpt : item.text}</div>
        </div>
      </article>
    );
  }

  if (item.kind === "verdict") {
    return (
      <article className={cls}>
        <span className="glyph-disc is-verdict">
          <IconShield size={dense ? 12 : 14} />
        </span>
        <div>
          <div className="entry-head">
            <span className="entry-name">Verdict</span>
            <StatusPill item={item} />
          </div>
          <div className="entry-body">
            <Body item={item} />
          </div>
        </div>
      </article>
    );
  }

  const juror = jurors.find((j) => j.id === item.juror);
  const name = juror?.pseudonym ?? item.juror ?? "juror";
  const cites = item.kind === "argument" ? (item.evidenceIds ?? []) : [];
  return (
    <article className={cls}>
      <Avatar name={name} hue={hueIndex(item.juror ?? name, jurors)} speaking={speaking} small={dense} />
      <div>
        <div className="entry-head">
          <span className="entry-name">{name}</span>
          <span className="entry-kind">
            <span aria-hidden="true">· </span>
            {item.kind}
          </span>
          <StatusPill item={item} />
        </div>
        <div className="entry-body">
          <Body item={item} />
        </div>
        {cites.length > 0 && (
          <div className="entry-meta">
            <span className="entry-meta-label">Cites</span>
            {cites.map((id) => (
              <span key={id} className="cite">
                {id}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export default function TranscriptFeed() {
  const feed = useTribunal((s) => s.feed);
  const jurors = useTribunal((s) => s.jurors);
  const source = useTribunal((s) => s.source);
  const listRef = useRef<HTMLDivElement>(null);
  useStickToBottom(listRef, feed.length);

  // A speaking juror's ember ring goes on their newest argument only.
  const speaking = useMemo(() => {
    const out = new Set<string>();
    for (const j of jurors) {
      if (!j.speaking) continue;
      for (let i = feed.length - 1; i >= 0; i--) {
        if (feed[i].kind === "argument" && feed[i].juror === j.id) {
          out.add(feed[i].id);
          break;
        }
      }
    }
    return out;
  }, [feed, jurors]);

  return (
    <section className="ledger" aria-label="Transcript">
      <header className="ledger-head">
        <h2 className="ledger-title label">Ledger</h2>
        <span className="ledger-count mono">
          {feed.length} {feed.length === 1 ? "entry" : "entries"}
        </span>
      </header>
      <div ref={listRef} className="ledger-list" role="log" aria-label="Transcript entries" tabIndex={0}>
        {feed.length === 0 && (
          <p className="ledger-empty">{source === "live" ? "Waiting for live events." : "No messages yet. Press Play to start the case."}</p>
        )}
        {feed.map((item) => (
          <LedgerEntry key={item.id} item={item} jurors={jurors} speaking={speaking.has(item.id)} />
        ))}
      </div>
    </section>
  );
}
