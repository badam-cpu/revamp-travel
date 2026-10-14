/**
 * Upcoming events in Armenia (migration 0102) — fully automatic, no curation.
 *
 * Two open sources, refreshed weekly (netlify/functions/events-sync*.ts):
 *   1. Public & religious holidays — Google's public Armenian holiday calendar
 *      (a free .ics feed). Trusted as-is.
 *   2. Everything else (festivals, concerts, sports, conferences, exhibitions)
 *      — Claude with the Anthropic web-search tool searches the open web and
 *      returns events WITH the public page that states each one. The server
 *      then fetches that page itself (one plain, SSRF-guarded GET — no
 *      rendering, no bypassing anything) and only marks an event `verified`
 *      when the page really mentions it (title words + its year/month). Only
 *      verified events are ever shown (RLS) — a made-up or misdated event
 *      never reaches an operator.
 * Rows are de-duplicated by a key (date + normalised title) and by fuzzy title
 * match on the same start date; re-found events just refresh last_seen_at.
 * Writes are service-role only. Operators read events (Analytics → pricing
 * insights, calendar markers); admins can hide a wrong one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { assertSafeUrl } from "./urlPrefill.js";

const HOLIDAY_ICS = "https://calendar.google.com/calendar/ical/en.am%23holiday%40group.v.calendar.google.com/public/basic.ics";
const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(iso + "T00:00:00Z") + n * DAY));

export type EventImpact = "low" | "medium" | "high";
export const EVENT_CATEGORIES = ["holiday", "festival", "concert", "sports", "conference", "exhibition", "religious", "other"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface EventRow {
  dedupe_key: string;
  kind: "holiday" | "event";
  title: string;
  category: EventCategory;
  city: string | null;
  region: string | null;
  venue: string | null;
  start_date: string;
  end_date: string;
  impact: EventImpact;
  expected_attendance: number | null;
  summary: string | null;
  source_url: string | null;
  source_name: string | null;
  verified: boolean;
}

// Built with RegExp(): the project's TS target rejects a /u regex literal.
const WORD = new RegExp("[\\p{L}\\p{N}]{3,}", "gu");
/** Lower-case words of 3+ letters (Latin or Armenian/Cyrillic), for keys and matching. */
export function titleTokens(s: string): string[] {
  return (s.toLowerCase().normalize("NFKD").match(WORD) ?? []).filter((w) => !["the", "and", "for", "with", "festival", "day", "yerevan", "armenia", "2026", "2027", "2028"].includes(w));
}
export function dedupeKey(kind: string, start: string, title: string): string {
  return `${kind}:${start}:${titleTokens(title).slice(0, 6).join("-") || "event"}`.slice(0, 160);
}
/** Share of the smaller title's words that appear in the other. */
export function titleOverlap(a: string, b: string): number {
  const A = new Set(titleTokens(a));
  const B = new Set(titleTokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => B.has(w) && n++);
  return n / Math.min(A.size, B.size);
}

// ── 1. Holidays ───────────────────────────────────────────────────────────────
const HIGH_HOLIDAYS = /new year|christmas|easter|independence day|vardavar/i;
const MEDIUM_HOLIDAYS = /republic day|victory|constitution|women'?s day|motherhood|labor day|genocide remembrance/i;

/** Parse all-day VEVENTs (DTSTART;VALUE=DATE) from an .ics body. */
export function parseHolidayIcs(ics: string): { start: string; end: string; title: string }[] {
  const out: { start: string; end: string; title: string }[] = [];
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const get = (k: string) => block.match(new RegExp(`^${k}[^:\\n]*:(.*)$`, "m"))?.[1]?.trim();
    const ds = get("DTSTART");
    const de = get("DTEND");
    const title = get("SUMMARY")?.replace(/\\,/g, ",").replace(/\\;/g, ";");
    if (!ds || !title || !/^\d{8}$/.test(ds)) continue;
    const start = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`;
    // DTEND is exclusive for all-day events.
    const end = de && /^\d{8}$/.test(de) ? addDays(`${de.slice(0, 4)}-${de.slice(4, 6)}-${de.slice(6, 8)}`, -1) : start;
    out.push({ start, end, title });
  }
  return out;
}

export async function syncHolidays(admin: SupabaseClient, today = isoDay(new Date())): Promise<number> {
  const res = await fetch(HOLIDAY_ICS, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`holiday feed ${res.status}`);
  const horizon = addDays(today, 400);
  const rows: EventRow[] = parseHolidayIcs(await res.text())
    .filter((h) => h.end >= today && h.start <= horizon)
    .map((h) => ({
      dedupe_key: dedupeKey("holiday", h.start, h.title),
      kind: "holiday",
      title: h.title,
      category: /easter|christmas|vardavar|etchmiadzin|vartan|holy/i.test(h.title) ? "religious" : "holiday",
      city: null,
      region: null,
      venue: null,
      start_date: h.start,
      end_date: h.end,
      impact: HIGH_HOLIDAYS.test(h.title) ? "high" : MEDIUM_HOLIDAYS.test(h.title) ? "medium" : "low",
      expected_attendance: null,
      summary: null,
      source_url: "https://calendar.google.com/calendar/embed?src=en.am%23holiday%40group.v.calendar.google.com",
      source_name: "Google public holidays (Armenia)",
      verified: true,
    }));
  if (!rows.length) return 0;
  const { error } = await admin.from("events").upsert(rows.map((r) => ({ ...r, last_seen_at: new Date().toISOString() })), { onConflict: "dedupe_key" });
  if (error) throw new Error(`holiday upsert: ${error.message}`);
  return rows.length;
}

// ── 2. AI discovery from the open web ────────────────────────────────────────
interface FoundEvent {
  title?: unknown;
  category?: unknown;
  city?: unknown;
  region?: unknown;
  venue?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  impact?: unknown;
  expected_attendance?: unknown;
  summary?: unknown;
  source_url?: unknown;
}

const PROMPT = (today: string, until: string) => `Today is ${today}. Using web search, find PUBLIC events in Armenia that will happen between ${today} and ${until} and could bring visitors to a city — especially Yerevan, but also Gyumri, Dilijan, Tsaghkadzor, Jermuk, Sevan, Goris and elsewhere.

Look for: festivals (wine, food, music, film — e.g. Yerevan Wine Days, Golden Apricot, Areni wine festival, Vardavar), big concerts and tours by well-known artists, international sports matches and tournaments, conferences and trade shows, major exhibitions, and religious festivals that draw crowds. Search in English, Armenian and Russian. Prefer official sites, venue/ticketing pages and reputable news.

Rules:
- Only events with a CONFIRMED date in that window. Skip anything past, rumoured, or without a date.
- Each event needs the URL of a public page you actually found that states the event and its date (official site, venue, ticketing, or news). Never invent or guess a URL.
- Do not list ordinary public holidays (they come from another source), weekly markets, or small private events.
- impact: "high" = draws thousands / fills hotels (major festival, stadium concert, international match, big conference); "medium" = hundreds to a few thousand; "low" = smaller.

When you are done searching, reply with ONLY a JSON array (no prose, no markdown) of objects:
{"title": string, "category": "festival"|"concert"|"sports"|"conference"|"exhibition"|"religious"|"other", "city": string, "region": string|null, "venue": string|null, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "impact": "low"|"medium"|"high", "expected_attendance": number|null, "summary": string (max 140 chars, factual), "source_url": string}`;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Ask Claude (with web search) for upcoming events; returns raw candidates. */
export async function discoverWithAi(today = isoDay(new Date()), days = 183): Promise<FoundEvent[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });
  const until = addDays(today, days);
  // Hard cost cap for the WHOLE run (max_uses is per request, and a paused turn
  // continues in a new request — so pass only the searches left each time).
  const budget = Math.max(1, Number(process.env.EVENTS_MAX_SEARCHES || 15));
  let used = 0;
  // The SDK pinned here predates the web-search tool types; the API accepts it as-is.
  const tools = (maxUses: number) =>
    [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: maxUses,
        user_location: { type: "approximate", country: "AM", city: "Yerevan", timezone: "Asia/Yerevan" },
      },
    ] as unknown as Anthropic.Tool[];
  const searchesIn = (m: Anthropic.Message) => Number((m.usage as unknown as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0);
  const model = process.env.EVENTS_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: PROMPT(today, until) }];
  // A long search turn can come back with stop_reason "pause_turn": send the
  // paused assistant message back unchanged and let it continue (a few rounds max).
  let msg = await client.messages.create({ model, max_tokens: 8000, tools: tools(budget), messages });
  used += searchesIn(msg);
  for (let round = 0; (msg.stop_reason as string) === "pause_turn" && round < 4 && used < budget; round++) {
    messages.push({ role: "assistant", content: msg.content as Anthropic.MessageParam["content"] });
    msg = await client.messages.create({ model, max_tokens: 8000, tools: tools(budget - used), messages });
    used += searchesIn(msg);
  }
  console.log(`[events] web searches used: ${used}/${budget}`);
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as FoundEvent[]) : [];
  } catch {
    console.error("[events] model reply wasn't JSON");
    return [];
  }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Does the cited page really talk about this event? One plain GET (public
 * address only, 10s, first 1.5 MB), then: most of the title's words appear,
 * and the event's year or month name appears too.
 */
export async function sourceMentions(url: string, title: string, start: string): Promise<boolean> {
  try {
    const safe = await assertSafeUrl(url);
    const res = await fetch(safe.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "RevampVacationsBot/1.0 (+https://revampvacations.com; event source check)", accept: "text/html,*/*" },
    });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    let html = "";
    const dec = new TextDecoder();
    while (html.length < 1_500_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
    const words = titleTokens(title);
    if (!words.length) return false;
    const hit = words.filter((w) => text.includes(w)).length / words.length;
    const year = start.slice(0, 4);
    const month = MONTHS[Number(start.slice(5, 7)) - 1];
    return hit >= 0.6 && (text.includes(year) || text.includes(month) || text.includes(month.slice(0, 3)));
  } catch {
    return false;
  }
}

/** Validate, verify against the cited page, de-duplicate and store AI-found events. */
export async function discoverEvents(admin: SupabaseClient, today = isoDay(new Date())): Promise<{ found: number; verified: number; stored: number }> {
  const raw = await discoverWithAi(today);
  const horizon = addDays(today, 200);
  const { data: existing } = await admin.from("events").select("id, dedupe_key, title, start_date").gte("end_date", today);
  const known = (existing ?? []) as { id: string; dedupe_key: string; title: string; start_date: string }[];

  let verified = 0;
  let stored = 0;
  const seen = new Set<string>();
  for (const e of raw.slice(0, 80)) {
    const title = str(e.title, 160);
    const start = str(e.start_date, 10);
    const end = str(e.end_date, 10) ?? start;
    const url = str(e.source_url, 600);
    if (!title || !start || !ISO.test(start) || !end || !ISO.test(end) || !url || !/^https?:\/\//.test(url)) continue;
    if (end < today || start > horizon || end < start) continue;
    const key = dedupeKey("event", start, title);
    if (seen.has(key)) continue;
    seen.add(key);

    const ok = await sourceMentions(url, title, start);
    if (ok) verified++;
    const category = (EVENT_CATEGORIES as readonly string[]).includes(String(e.category)) ? (e.category as EventCategory) : "other";
    const impact: EventImpact = e.impact === "high" || e.impact === "medium" ? e.impact : "low";
    const att = typeof e.expected_attendance === "number" && e.expected_attendance > 0 ? Math.round(e.expected_attendance) : null;
    const row: EventRow = {
      dedupe_key: key,
      kind: "event",
      title,
      category,
      city: str(e.city, 80),
      region: str(e.region, 80),
      venue: str(e.venue, 160),
      start_date: start,
      end_date: end,
      impact,
      expected_attendance: att,
      summary: str(e.summary, 200),
      source_url: url,
      source_name: (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, "");
        } catch {
          return null;
        }
      })(),
      verified: ok,
    };
    // Same event found again under a slightly different name → update that row.
    const twin = known.find((k) => k.start_date === start && titleOverlap(k.title, title) >= 0.6);
    const { error } = twin
      ? await admin.from("events").update({ ...row, dedupe_key: twin.dedupe_key, last_seen_at: new Date().toISOString() }).eq("id", twin.id)
      : await admin.from("events").upsert({ ...row, last_seen_at: new Date().toISOString() }, { onConflict: "dedupe_key" });
    if (error) console.error("[events] store failed", title, error.message);
    else stored++;
  }
  return { found: raw.length, verified, stored };
}

/** Holidays + AI discovery. Each half runs even if the other fails. */
export async function syncEvents(admin: SupabaseClient): Promise<{ holidays: number; found: number; verified: number; stored: number; errors: string[] }> {
  const errors: string[] = [];
  let holidays = 0;
  let disc = { found: 0, verified: 0, stored: 0 };
  try {
    holidays = await syncHolidays(admin);
  } catch (e) {
    errors.push(`holidays: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    disc = await discoverEvents(admin);
  } catch (e) {
    errors.push(`discovery: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { holidays, ...disc, errors };
}

/** Shared secret for invoking the background sync (derived — no extra env var). */
export async function eventsSyncToken(): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const data = new TextEncoder().encode(`events-sync:${key}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
