import { useEffect, useRef, type RefObject } from "react";

/**
 * Keeps a scrolling list pinned to its newest item. It scrolls the list itself (never the page)
 * and lets go as soon as the reader scrolls up, so reading older entries is not interrupted.
 * The list's CSS scroll-behavior (smooth) animates the follow.
 */
export function useStickToBottom<T extends HTMLElement>(ref: RefObject<T | null>, changeKey: unknown) {
  const pinned = useRef(true);
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = el.scrollTop;
    const onScroll = () => {
      const up = el.scrollTop < last - 1;
      last = el.scrollTop;
      if (up) pinned.current = false;
      else if (el.scrollHeight - el.scrollTop - el.clientHeight < 56) pinned.current = true;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight) pinned.current = true;
    if (!pinned.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: first.current ? "instant" : "auto" });
    first.current = false;
  }, [ref, changeKey]);
}
