import { useEffect, useRef } from "react";
import { useTribunal, type FeedItem } from "../store/tribunal";

const SIGNED = new Set<FeedItem["kind"]>(["evidence", "commit", "reveal", "argument", "verdict"]);

function SigBadge({ item }: { item: FeedItem }) {
  if (!SIGNED.has(item.kind)) return null;
  if (item.unattested) return <span className="badge unattested">UNATTESTED</span>;
  return item.verified ? <span className="badge verified">verified</span> : <span className="badge forged">forged</span>;
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
          <div className="feed-head">
            {item.juror && <span className="juror-name">{item.juror}</span>}
            <SigBadge item={item} />
            <span className="feed-kind">{item.kind}</span>
          </div>
          <div className="feed-text">{item.text}</div>
        </div>
      ))}
      <div ref={endRef} />
    </section>
  );
}
