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

/* ── Timed busy intervals (for time-slot tours/experiences) ────────────────
 * Day-level ranges above are enough for stays; slot listings need the actual
 * hours a provider is busy (e.g. a Fresha appointment) so only overlapping
 * sessions get blocked. */
export interface BusyInterval {
  startMs: number;
  endMs: number;
}

/** Parse an iCal date/date-time value to epoch ms. Handles `20260925` (all-day),
 *  `20260925T100000Z` (UTC), and `20260925T100000` (naive → treated as Armenia
 *  local, UTC+4, since our providers are here). Returns null if unparseable. */
function icsValueToMs(val: string): number | null {
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, hh ? +hh : 0, mm ? +mm : 0, ss ? +ss : 0);
  if (hh && !z) return utc - 4 * 3_600_000; // naive timed value → Armenia local
  return utc; // all-day (date) or explicit UTC
}

/** Parse an .ics string into busy time intervals (epoch ms). */
export function parseIcalBusyIntervals(ics: string): BusyInterval[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const out: BusyInterval[] = [];
  for (const chunk of unfolded.split(/BEGIN:VEVENT/i).slice(1)) {
    const block = chunk.split(/END:VEVENT/i)[0];
    const sM = block.match(/DTSTART[^:\n]*:([0-9TZ]+)/i);
    if (!sM) continue;
    const startMs = icsValueToMs(sM[1]);
    if (startMs == null) continue;
    const eM = block.match(/DTEND[^:\n]*:([0-9TZ]+)/i);
    let endMs = eM ? icsValueToMs(eM[1]) : null;
    if (endMs == null) endMs = /T/.test(sM[1]) ? startMs + 3_600_000 : startMs + 86_400_000; // timed→+1h, all-day→+1d
    if (endMs > startMs) {
      out.push({ startMs, endMs });
      if (out.length >= MAX_RANGES) break;
    }
  }
  return out;
}

export interface IcalFeed {
  url: string;
  label: string;
}

/** Fetch several feeds and merge their busy intervals (per-feed errors collected). */
export async function fetchMergedBusyIntervals(feeds: IcalFeed[]): Promise<{ intervals: BusyInterval[]; errors: string[] }> {
  const intervals: BusyInterval[] = [];
  const errors: string[] = [];
  for (const feed of feeds) {
    if (!feed.url) continue;
    try {
      const text = await safeFetchText(feed.url, { accept: "text/calendar, text/plain, */*" });
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That URL didn't return a calendar (.ics) feed.");
      intervals.push(...parseIcalBusyIntervals(text));
    } catch (err) {
      errors.push(`${feed.label || "Calendar"}: ${err instanceof Error ? err.message : "couldn't be read"}`);
    }
  }
  return { intervals, errors };
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
