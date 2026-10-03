/**
 * First-party per-listing engagement tracking. Sends lightweight, anonymous
 * events (impressions / detail views / intent clicks) to /api/track, which
 * increments daily counters (see supabase migration 0068). No PII; batched and
 * flushed via sendBeacon so it never blocks navigation. This is separate from
 * GA (lib/analytics.ts): GA is aggregate/external, this is per-listing and
 * powers the admin per-restaurant analytics (and later an owner dashboard).
 */
import { useCallback } from "react";

export type ListingEventKind =
  | "impression"
  | "view"
  | "directions"
  | "website"
  | "call"
  | "menu"
  | "save"
  | "share"
  | "card_click";

interface QueuedEvent {
  listingId: string;
  kind: ListingEventKind;
  surface: string;
}

const queue: QueuedEvent[] = [];
const seenImpressions = new Set<string>(); // dedupe impressions per page-session
let timer: ReturnType<typeof setTimeout> | null = null;

// When true, no events are recorded at all. Flipped on by AuthContext for
// signed-in operators/admins so their own browsing (dashboard, admin, QA,
// previewing their listings) never inflates the per-listing engagement numbers
// shown to real users/owners. Travelers and signed-out visitors are tracked
// normally. There's no auth on /api/track (anonymous sendBeacon), so this
// identity-aware exclusion has to happen here on the client.
let suppressed = false;

/** Enable/disable all engagement tracking (operators/admins → suppressed). */
export function setTrackingSuppressed(value: boolean): void {
  suppressed = value;
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length || typeof navigator === "undefined") return;
  const events = queue.splice(0, queue.length);
  const body = JSON.stringify({ events });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* best-effort */
  }
}

/** Record a listing engagement event (batched). */
export function trackListing(listingId: string, kind: ListingEventKind, surface = ""): void {
  if (suppressed || !listingId) return;
  queue.push({ listingId, kind, surface });
  if (!timer) timer = setTimeout(flush, 1500);
}

/** Record an impression at most once per listing+surface per page-session. */
export function trackImpressionOnce(listingId: string, surface = ""): void {
  if (suppressed) return;
  const key = `${listingId}:${surface}`;
  if (seenImpressions.has(key)) return;
  seenImpressions.add(key);
  trackListing(listingId, "impression", surface);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/**
 * Callback ref that fires a single impression when the element first becomes
 * ~half visible. Attach to a card root: `<div ref={useImpressionRef(id, "guide")}>`.
 */
export function useImpressionRef<T extends Element>(listingId: string, surface = ""): (el: T | null) => void {
  return useCallback(
    (el: T | null) => {
      if (!el || !listingId || typeof IntersectionObserver === "undefined") return;
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              trackImpressionOnce(listingId, surface);
              io.disconnect();
              break;
            }
          }
        },
        { threshold: 0.5 },
      );
      io.observe(el);
    },
    [listingId, surface],
  );
}
