/**
 * First-party per-listing engagement tracking. Sends lightweight, anonymous
 * events (impressions / detail views / intent clicks) to /api/track, which
 * increments daily counters (see supabase migration 0068). No PII; batched and
 * flushed via sendBeacon so it never blocks navigation. This is separate from
 * GA (lib/analytics.ts): GA is aggregate/external, this is per-listing and
 * powers the admin per-restaurant analytics (and later an owner dashboard).
 */
import { useCallback } from "react";
import { aiAssistantFromSource } from "@shared/aiAgents";

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

// Our own team's browsing (operators/admins) must never inflate the numbers
// shown to owners. Two guards, both client-side because /api/track is an
// anonymous sendBeacon:
//  1. Nothing is sent until auth has resolved (`setTrackingSuppressed` is
//     called once the profile is known) — otherwise the first page a team
//     member opens is counted before we know who they are.
//  2. A browser that has ever been signed in as an operator/admin is remembered
//     as a team device (localStorage) and stays excluded when signed out too.
// Travelers and signed-out visitors on other devices are tracked normally.
const TEAM_DEVICE_KEY = "revamp.teamDevice";
let suppressed = false;
let resolved = false;

/** This browser has been used by an operator/admin account. */
export function isTeamDevice(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(TEAM_DEVICE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Called by AuthContext once auth has resolved: `team` = signed in as an
 * operator/admin. Team accounts mark the device; queued events are dropped for
 * team devices and sent otherwise.
 */
export function setTrackingSuppressed(team: boolean): void {
  if (team) {
    try {
      localStorage.setItem(TEAM_DEVICE_KEY, "1");
    } catch {
      /* private mode — the signed-in check still applies */
    }
  }
  suppressed = team || isTeamDevice();
  resolved = true;
  if (!suppressed) sendAiReferral();
  if (suppressed) queue.length = 0;
  else if (queue.length && !timer) timer = setTimeout(flush, 1500);
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!resolved || suppressed) return; // wait until we know who's browsing
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
  if (suppressed || !listingId || isTeamDevice()) return;
  queue.push({ listingId, kind, surface });
  if (resolved && !timer) timer = setTimeout(flush, 1500);
}

/** Record an impression at most once per listing+surface per page-session. */
export function trackImpressionOnce(listingId: string, surface = ""): void {
  if (suppressed || isTeamDevice()) return;
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

// ── Arrivals from AI assistants (admin → Analytics → AI assistants, 0114) ──
// Read once, when the app first loads: the referrer (chatgpt.com, perplexity.ai,
// claude.ai, …) or ChatGPT's utm_source tag. Sent at most once per browser
// session, only after auth has resolved and never from a team device.
const AI_REFERRAL_SENT_KEY = "revamp.aiReferralSent";
const aiArrival: { assistant: string; path: string } | null = (() => {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const assistant = aiAssistantFromSource(params.get("utm_source")) ?? aiAssistantFromSource(document.referrer);
    return assistant ? { assistant, path: window.location.pathname } : null;
  } catch {
    return null;
  }
})();

function sendAiReferral(): void {
  if (!aiArrival || typeof navigator === "undefined") return;
  try {
    if (sessionStorage.getItem(AI_REFERRAL_SENT_KEY)) return;
    sessionStorage.setItem(AI_REFERRAL_SENT_KEY, "1");
  } catch {
    /* private mode — send once per page load instead */
  }
  const body = JSON.stringify(aiArrival);
  try {
    if (navigator.sendBeacon) navigator.sendBeacon("/api/ai-referral", new Blob([body], { type: "application/json" }));
    else void fetch("/api/ai-referral", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* best-effort */
  }
}
