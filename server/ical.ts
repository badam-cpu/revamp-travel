/**
 * Airbnb (and any iCalendar) availability import. Airbnb exposes a public
 * calendar-export ".ics" URL per listing (Listing → Availability → connect
 * calendars → export). It contains all-day VEVENTs for each booked/blocked
 * span — no prices, just busy dates. We fetch it server-side (client CORS
 * would block it) and reduce it to blocked date ranges the listing caches in
 * `blocked_ranges`. One-way: we only READ Airbnb's calendar, never write to it.
 */
import { safeFetchText } from "./safeFetch.js";

export interface BlockedRange {
  start: string; // inclusive, YYYY-MM-DD
  end: string; // EXCLUSIVE, YYYY-MM-DD (matches iCal all-day DTEND semantics)
}

const MAX_RANGES = 2000;

function toIso(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Parse an .ics string into blocked date ranges. Tolerant of line folding and DATE/DATE-TIME values. */
export function parseIcalBlockedRanges(ics: string): BlockedRange[] {
  // Unfold folded lines (RFC 5545: a CRLF followed by space/tab continues the line).
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const ranges: BlockedRange[] = [];
  const events = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  for (const chunk of events) {
    const block = chunk.split(/END:VEVENT/i)[0];
    const startMatch = block.match(/DTSTART[^:\n]*:(\d{8})/i);
    if (!startMatch) continue;
    const start = toIso(startMatch[1]);
    const endMatch = block.match(/DTEND[^:\n]*:(\d{8})/i);
    // No DTEND → single all-day block. DTEND is exclusive already.
    const end = endMatch ? toIso(endMatch[1]) : nextDay(start);
    if (end > start) {
      ranges.push({ start, end });
      if (ranges.length >= MAX_RANGES) break;
    }
  }
  return ranges;
}

/** Fetch a calendar URL (SSRF-guarded) and return its blocked ranges. Throws SafeFetchError on a bad/unreachable URL, or a plain Error if the body isn't a calendar. */
export async function fetchIcalBlockedRanges(url: string): Promise<BlockedRange[]> {
  const text = await safeFetchText(url, { accept: "text/calendar, text/plain, */*" });
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error("That URL didn't return a calendar (.ics) feed.");
  }
  return parseIcalBlockedRanges(text);
}

export interface IcalFeed {
  url: string;
  label: string;
}

/** Fetch several calendar feeds, merge + dedupe their blocked ranges, and
 *  collect per-feed errors (so one bad feed doesn't sink the rest). */
export async function fetchMergedBlockedRanges(feeds: IcalFeed[]): Promise<{ ranges: BlockedRange[]; errors: string[] }> {
  const all: BlockedRange[] = [];
  const errors: string[] = [];
  for (const feed of feeds) {
    if (!feed.url) continue;
    try {
      all.push(...(await fetchIcalBlockedRanges(feed.url)));
    } catch (err) {
      errors.push(`${feed.label || "Calendar"}: ${err instanceof Error ? err.message : "couldn't be read"}`);
    }
  }
  // Dedupe identical start/end spans.
  const seen = new Set<string>();
  const ranges = all.filter((r) => {
    const key = `${r.start}_${r.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ranges, errors };
}

/** RFC 5545 text escaping for SUMMARY/CALNAME values. */
function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Build an all-day busy .ics feed (VCALENDAR) from blocked ranges. `end` is
 *  EXCLUSIVE, matching iCal DATE DTEND — so it lines up with how Airbnb/Booking
 *  read it. Every range renders as an opaque all-day "Reserved" event. */
export function buildIcalFeed(calendarName: string, ranges: BlockedRange[]): string {
  const compact = (iso: string) => iso.replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Revamp Vacations//Availability//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];
  ranges.forEach((r, i) => {
    if (!(r.end > r.start)) return;
    lines.push(
      "BEGIN:VEVENT",
      `UID:revamp-${compact(r.start)}-${compact(r.end)}-${i}@revampvacations.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(r.start)}`,
      `DTEND;VALUE=DATE:${compact(r.end)}`,
      "SUMMARY:Reserved",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
