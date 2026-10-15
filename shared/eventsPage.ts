/**
 * The public "Events in Armenia" page (/events) — shared by the React page,
 * the bot prerender (server/prerender.ts) and the sitemap, so people, Google
 * and AI crawlers all see the same list.
 *
 * Data: the `events` table (0102/0104), written weekly by server/events.ts —
 * public holidays from Google's calendar and festivals/concerts/sports/
 * conferences found by AI web search, each VERIFIED against a public source
 * page before RLS lets anyone see it. Cancelled events are left out.
 *
 * Honesty: we show what the source says (title, dates, venue, a one-line
 * factual summary) and always link the source. We never show our internal
 * "impact"/demand guess publicly, never invent ticket prices, ratings or
 * attendance, and say plainly that dates can change.
 */

export interface PublicEvent {
  id: string;
  kind: "holiday" | "event";
  title: string;
  category: string;
  city: string | null;
  region: string | null;
  venue: string | null;
  start: string; // YYYY-MM-DD
  end: string; // inclusive
  summary: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
}

/** Filter chips, in display order. Holidays + religious feasts share one chip. */
export const EVENT_FILTERS = [
  { key: "concert", label: "Concerts" },
  { key: "festival", label: "Festivals" },
  { key: "sports", label: "Sports" },
  { key: "conference", label: "Conferences" },
  { key: "exhibition", label: "Exhibitions" },
  { key: "holiday", label: "Holidays" },
] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number]["key"] | "all";

export function filterKey(e: PublicEvent): string {
  if (e.kind === "holiday" || e.category === "holiday" || e.category === "religious") return "holiday";
  return e.category;
}

export function categoryLabel(e: PublicEvent): string {
  // Google's Armenian calendar mixes days off with memorial/observance days, so not "public holiday".
  if (e.kind === "holiday") return e.category === "religious" ? "Religious holiday" : "Holiday";
  return (
    {
      concert: "Concert",
      festival: "Festival",
      sports: "Sports",
      conference: "Conference",
      exhibition: "Exhibition",
      religious: "Religious feast",
    } as Record<string, string>
  )[e.category] ?? "Event";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const utc = (iso: string) => {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d));
};
export const addDays = (iso: string, n: number) => new Date(utc(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** "Sat 17 Oct", "17–19 Oct", "30 Oct – 2 Nov". */
export function formatEventDates(e: Pick<PublicEvent, "start" | "end">): string {
  const [, sm, sd] = parts(e.start);
  const [, em, ed] = parts(e.end);
  const mon = (m: number) => MONTHS[m - 1].slice(0, 3);
  if (e.start === e.end) return `${WEEKDAYS[utc(e.start).getUTCDay()]} ${sd} ${mon(sm)}`;
  if (sm === em) return `${sd}–${ed} ${mon(sm)}`;
  return `${sd} ${mon(sm)} – ${ed} ${mon(em)}`;
}

/** Upcoming, not cancelled, soonest first — then grouped as "November 2026". */
export function groupByMonth(events: PublicEvent[]): { key: string; label: string; events: PublicEvent[] }[] {
  const groups = new Map<string, PublicEvent[]>();
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))) {
    const key = e.start.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return Array.from(groups.entries()).map(([key, list]) => {
    const [y, m] = key.split("-").map(Number);
    return { key, label: `${MONTHS[m - 1]} ${y}`, events: list };
  });
}

/** Search stays for the event's nights (checkout = the day after it ends). */
export function staysLink(e: Pick<PublicEvent, "start" | "end">): string {
  return `/explore/stay?checkin=${e.start}&checkout=${addDays(e.end, 1)}`;
}

/** "armenpress.am" from a source URL (or the stored name). */
export function sourceLabel(e: Pick<PublicEvent, "sourceUrl" | "sourceName">): string | null {
  if (e.sourceName) return e.sourceName;
  if (!e.sourceUrl) return null;
  try {
    return new URL(e.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Only http(s) source links are ever rendered. */
export function safeSourceUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function eventsPageTitle(today: string): string {
  const y = Number(today.slice(0, 4));
  return `Events in Armenia ${y}–${String(y + 1).slice(2)}: Concerts, Festivals & Holidays | Revamp Vacations`;
}
export const EVENTS_PAGE_DESCRIPTION =
  "What's on in Yerevan and across Armenia over the next 12 months — concerts, festivals, sports, conferences and public holidays, each checked against its official source. Find a stay for the dates.";

const SCHEMA_TYPE: Record<string, string> = {
  concert: "MusicEvent",
  festival: "Festival",
  sports: "SportsEvent",
  conference: "BusinessEvent",
  exhibition: "ExhibitionEvent",
};

/**
 * schema.org ItemList of Events for the page. Holidays are left out (they
 * aren't events with a venue). Only facts from the verified row: name, dates,
 * place, summary, the source page as `url`. No offers, ratings or attendance.
 */
export function buildEventsJsonLd(origin: string, events: PublicEvent[]): Record<string, unknown> {
  const list = events.filter((e) => e.kind === "event").slice(0, 100);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Events in Armenia",
    url: `${origin}/events`,
    itemListElement: list.map((e, i) => {
      const place = e.venue || e.city || "Armenia";
      const ev: Record<string, unknown> = {
        "@type": SCHEMA_TYPE[e.category] ?? "Event",
        name: e.title,
        startDate: e.start,
        endDate: e.end,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: {
          "@type": "Place",
          name: place,
          address: { "@type": "PostalAddress", ...(e.city ? { addressLocality: e.city } : {}), ...(e.region ? { addressRegion: e.region } : {}), addressCountry: "AM" },
        },
      };
      if (e.summary) ev.description = e.summary;
      const src = safeSourceUrl(e.sourceUrl);
      if (src) ev.url = src;
      return { "@type": "ListItem", position: i + 1, item: ev };
    }),
  };
}
