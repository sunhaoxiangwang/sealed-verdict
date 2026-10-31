import { useEffect, useRef } from "react";
import { useTribunal, type FeedItem } from "../store/tribunal";

const SIGNED = new Set<FeedItem["kind"]>(["evidence", "commit", "reveal", "argument", "verdict"]);

function SigBadge({ item }: { item: FeedItem }) {
  if (!SIGNED.has(item.kind)) return null;
  if (item.unattested) {
    return (
      <span className="unattested stamp stamp-red stamp-round stamp-void">
        <span>UNATTESTED</span>
      </span>
    );
  }
  return item.verified ? (
    <span className="verified stamp stamp-green stamp-round">
      <span>verified</span>
    </span>
  ) : (
    <span className="forged stamp stamp-red stamp-round stamp-void">
      <span>forged</span>
    </span>
  );
}

function headerLine(item: FeedItem): string {
  if (item.kind === "evidence") {
    const source = item.text.split(/\s+/)[0] ?? "";
    return `Exhibit ${item.evidenceIds?.[0] ?? ""} · ${source}`.trim();
  }
  if (item.juror) return `Juror ${item.juror} · ${item.kind}`;
  return item.kind;
}

export default function TranscriptFeed() {
  const feed = useTribunal((s) => s.feed);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [feed.length]);

  return (
    <section className="feed" aria-label="Transcript">
      {feed.length === 0 && <p className="muted">No messages yet.</p>}
      {feed.map((item) => (
        <div key={item.id} className={`feed-item feed-${item.kind}`}>
          <span className="feed-string" aria-hidden="true" />
          <div className="feed-head">
            <span className="feed-kind">{headerLine(item)}</span>
            <SigBadge item={item} />
          </div>
          <div className="feed-text">{item.text}</div>
        </div>
      ))}
      <div ref={endRef} />
    </section>
  );
}
