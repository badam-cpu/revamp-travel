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
