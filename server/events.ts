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
  /** The event's name exactly as the source page writes it (may be Armenian/Russian). */
  name_on_source?: unknown;
}

/**
 * Discovery runs as four focused searches — one broad search spreads its budget
 * too thin (the first live run found 8). Each area has its own guidance and
 * search budget (EVENTS_SEARCHES_PER_AREA, default 8); results are merged.
 */
export const DISCOVERY_AREAS = [
  {
    key: "performances",
    focus: "concerts and performing arts",
    guidance: `Arena and stadium concerts, tours by well-known Armenian, Russian and international artists, big club nights, opera, ballet, philharmonic and theatre premieres and festivals. Venues: Karen Demirchyan Sports Complex, Republic Square stages, Armenian National Opera and Ballet Theatre, Aram Khachaturian Concert Hall, Philharmonic, big clubs. Ticketing: tomsarkgh.am, ticketon.am, tkt.am, eventix.am. Searches like "Yerevan concert December 2026", "Ереван концерт ноябрь 2026", "Երևան համերգ 2026".`,
  },
  {
    key: "festivals",
    focus: "festivals, culture and religious feasts",
    guidance: `Wine, food, brandy, beer and cheese festivals (e.g. Yerevan Wine Days, Areni Wine Festival, Gata festival), film festivals (Golden Apricot), folk, craft and cultural festivals, New Year and Christmas markets, regional festivals in Gyumri, Dilijan, Goris, Jermuk, Tsaghkadzor, Sevan, and Armenian Apostolic feasts that draw crowds (e.g. Vardavar, Trndez). Searches like "Armenia festival 2027", "Фестиваль Армения 2026", "փառատոն 2026".`,
  },
  {
    key: "sports",
    focus: "sports",
    guidance: `National team football matches (UEFA Nations League, qualifiers) and other international matches held in Armenia, tournaments and championships, marathons, trail races, cycling and ski events (Tsaghkadzor), chess events. Searches like "Armenia national team home match 2026", "Yerevan marathon 2027", "турнир Ереван 2026".`,
  },
  {
    key: "business",
    focus: "conferences, forums and exhibitions",
    guidance: `International conferences, summits and UN or government forums held in Armenia, tech events (e.g. DIGITEC), trade shows and expos, medical and academic congresses, and major museum and art exhibitions. Searches like "conference Yerevan 2026", "форум Ереван 2026", "Expo Yerevan 2027", "համաժողով Երևան".`,
  },
] as const;
export type DiscoveryArea = (typeof DISCOVERY_AREAS)[number];

const PROMPT = (today: string, until: string, area: DiscoveryArea) => `Today is ${today}. Using web search, find PUBLIC ${area.focus} in Armenia between ${today} and ${until} that could bring visitors to a city — especially Yerevan, but also Gyumri, Dilijan, Tsaghkadzor, Jermuk, Sevan, Goris, Areni and elsewhere.

What to look for: ${area.guidance}

How to search: spend your searches well — go month by month across the window and use English, Armenian and Russian. Prefer official sites, venue and ticketing pages, and reputable news. Aim for 10–25 events in this area.

Rules:
- Only events with a CONFIRMED date in that window. Skip anything past, rumoured, or without a date.
- source_url must be a page from your search results that states the event and its date. Never invent or guess a URL.
- name_on_source: the event's name exactly as written on that page, in the page's language.
- Do not list ordinary public holidays (they come from another source), weekly markets, or small private events.
- impact: "high" = draws thousands / fills hotels (major festival, stadium concert, international match, big conference); "medium" = hundreds to a few thousand; "low" = smaller.

When you are done searching, reply with ONLY a JSON array (no prose, no markdown) of objects:
{"title": string (English), "name_on_source": string, "category": "festival"|"concert"|"sports"|"conference"|"exhibition"|"religious"|"other", "city": string, "region": string|null, "venue": string|null, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "impact": "low"|"medium"|"high", "expected_attendance": number|null, "summary": string (max 120 chars, factual), "source_url": string}`;

/** Parse the model's JSON array — or, if it was cut off, every complete {...} object in it. */
export function parseEventsJson(text: string): FoundEvent[] {
  const start = text.indexOf("[");
  if (start < 0) return [];
  const body = text.slice(start);
  try {
    const arr = JSON.parse(body.slice(0, body.lastIndexOf("]") + 1));
    if (Array.isArray(arr)) return arr as FoundEvent[];
  } catch {
    /* fall through to object-by-object */
  }
  const out: FoundEvent[] = [];
  let depth = 0;
  let from = -1;
  let inStr = false;
  for (let i = 1; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth === 0) from = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && from >= 0) {
        try {
          out.push(JSON.parse(body.slice(from, i + 1)));
        } catch {
          /* skip a malformed one */
        }
        from = -1;
      }
    }
  }
  return out;
}

/** A search result the API itself returned (URL + page title) — evidence that isn't model-written. */
export interface SearchHit {
  url: string;
  title: string;
}
const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Ask Claude (with web search) for upcoming events; returns raw candidates. */
export async function discoverWithAi(area: DiscoveryArea, today = isoDay(new Date()), days = 183): Promise<{ events: FoundEvent[]; hits: SearchHit[]; searches: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });
  const until = addDays(today, days);
  // Hard cost cap for the WHOLE run (max_uses is per request, and a paused turn
  // continues in a new request — so pass only the searches left each time).
  const budget = Math.max(1, Number(process.env.EVENTS_SEARCHES_PER_AREA || process.env.EVENTS_MAX_SEARCHES || 8));
  let used = 0;
  // The SDK pinned here predates the web-search tool types; the API accepts it as-is.
  const tools = (maxUses: number) =>
    [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: maxUses,
        // Armenia ("AM") isn't a supported country code for search localisation (the API
        // rejects the request), so localise by time zone only; the prompt names Armenia.
        user_location: { type: "approximate", timezone: "Asia/Yerevan" },
      },
    ] as unknown as Anthropic.Tool[];
  const searchesIn = (m: Anthropic.Message) => Number((m.usage as unknown as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0);
  const model = process.env.EVENTS_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: PROMPT(today, until, area) }];
  // A long search turn can come back with stop_reason "pause_turn": send the
  // paused assistant message back unchanged and let it continue (a few rounds max).
  const hits: SearchHit[] = [];
  const collect = (m: Anthropic.Message) => {
    for (const b of m.content as unknown as { type: string; content?: unknown }[]) {
      if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
      for (const r of b.content as { url?: string; title?: string }[]) if (r.url) hits.push({ url: r.url, title: r.title ?? "" });
    }
  };
  let msg = await client.messages.create({ model, max_tokens: 16000, tools: tools(budget), messages });
  used += searchesIn(msg);
  collect(msg);
  for (let round = 0; (msg.stop_reason as string) === "pause_turn" && round < 4 && used < budget; round++) {
    messages.push({ role: "assistant", content: msg.content as Anthropic.MessageParam["content"] });
    msg = await client.messages.create({ model, max_tokens: 16000, tools: tools(budget - used), messages });
    used += searchesIn(msg);
    collect(msg);
  }
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const events = parseEventsJson(text);
  console.log(`[events] ${area.key}: web searches ${used}/${budget}; search results ${hits.length}; events in reply ${events.length}; stop ${msg.stop_reason}`);
  return { events, hits, searches: used };
}

// Month names a page might use for the event's date (English, Russian genitive, Armenian).
const MONTH_NAMES: string[][] = [
  ["january", "jan", "января", "январь", "հունվար"],
  ["february", "feb", "февраля", "февраль", "փետրվար"],
  ["march", "mar", "марта", "март", "մարտ"],
  ["april", "apr", "апреля", "апрель", "ապրիլ"],
  ["may", "мая", "май", "մայիս"],
  ["june", "jun", "июня", "июнь", "հունիս"],
  ["july", "jul", "июля", "июль", "հուլիս"],
  ["august", "aug", "августа", "август", "օգոստոս"],
  ["september", "sep", "sept", "сентября", "сентябрь", "սեպտեմբեր"],
  ["october", "oct", "октября", "октябрь", "հոկտեմբեր"],
  ["november", "nov", "ноября", "ноябрь", "նոյեմբեր"],
  ["december", "dec", "декабря", "декабрь", "դեկտեմբեր"],
];
/** Does this text carry the event's date (year, a month name in any language, or dd.mm / dd/mm)? */
export function mentionsDate(text: string, start: string): boolean {
  const [y, m, d] = start.split("-");
  const dd = String(Number(d));
  if (text.includes(y)) return true;
  if (MONTH_NAMES[Number(m) - 1].some((n) => text.includes(n))) return true;
  return [`${d}.${m}`, `${dd}.${m}`, `${d}/${m}`, `${dd}/${m}`].some((p) => text.includes(p));
}
/** Share of the name's words found in the text. */
const nameHit = (text: string, name: string) => {
  const words = titleTokens(name);
  return words.length ? words.filter((w) => text.includes(w)).length / words.length : 0;
};

/**
 * Does the cited page really talk about this event? One plain GET (public
 * address only, 10s, first 1.5 MB), then: most of the event's name (English
 * title OR the name as written on the source) appears, and its date does too.
 */
export async function sourceMentions(url: string, title: string, start: string, nameOnSource?: string | null): Promise<boolean> {
  try {
    const safe = await assertSafeUrl(url);
    const res = await fetch(safe.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; RevampVacationsBot/1.0; +https://revampvacations.com) event source check", accept: "text/html,*/*", "accept-language": "en,hy;q=0.9,ru;q=0.8" },
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
    const text = html.replace(/<[^>]+>/g, " ").toLowerCase().normalize("NFKD");
    const named = Math.max(nameHit(text, title), nameOnSource ? nameHit(text, nameOnSource) : 0) >= 0.6;
    return named && mentionsDate(text, start);
  } catch {
    return false;
  }
}

/**
 * Fallback evidence when a site blocks or JS-renders its page: the cited URL is
 * one the web-search API itself returned in this run, and that result's title
 * names the event. Search results come from the API, not from the model's text.
 */
export function searchConfirms(hits: SearchHit[], url: string, title: string, nameOnSource?: string | null): boolean {
  const u = normUrl(url);
  const hit = hits.find((h) => normUrl(h.url) === u);
  if (!hit) return false;
  const t = hit.title.toLowerCase().normalize("NFKD");
  return Math.max(nameHit(t, title), nameOnSource ? nameHit(t, nameOnSource) : 0) >= 0.5;
}

/** Validate, verify against the cited page, de-duplicate and store AI-found events. */
export async function discoverEvents(admin: SupabaseClient, today = isoDay(new Date())): Promise<{ found: number; verified: number; stored: number; searches: number; areaErrors: string[] }> {
  // Four focused searches, one after another; one failing doesn't stop the rest.
  const raw: FoundEvent[] = [];
  const hits: SearchHit[] = [];
  const areaErrors: string[] = [];
  let searches = 0;
  for (const area of DISCOVERY_AREAS) {
    try {
      const r = await discoverWithAi(area, today);
      raw.push(...r.events);
      hits.push(...r.hits);
      searches += r.searches;
    } catch (e) {
      areaErrors.push(`${area.key}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    }
  }
  if (areaErrors.length === DISCOVERY_AREAS.length) throw new Error(areaErrors.join(" | "));
  const horizon = addDays(today, 200);
  const { data: existing } = await admin.from("events").select("id, dedupe_key, title, start_date").gte("end_date", today);
  const known = (existing ?? []) as { id: string; dedupe_key: string; title: string; start_date: string }[];

  // 1. Validate and de-duplicate across the four areas (same day + similar name = same event).
  type Cand = { e: FoundEvent; title: string; start: string; end: string; url: string; key: string; nameOnSource: string | null };
  const cands: Cand[] = [];
  for (const e of raw.slice(0, 150)) {
    const title = str(e.title, 160);
    const start = str(e.start_date, 10);
    const end = str(e.end_date, 10) ?? start;
    const url = str(e.source_url, 600);
    if (!title || !start || !ISO.test(start) || !end || !ISO.test(end) || !url || !/^https?:\/\//.test(url)) continue;
    if (end < today || start > horizon || end < start) continue;
    if (cands.some((c) => c.start === start && titleOverlap(c.title, title) >= 0.6)) continue;
    cands.push({ e, title, start, end, url, key: dedupeKey("event", start, title), nameOnSource: str(e.name_on_source, 160) });
  }

  // 2. Check each against real evidence — six at a time, so a long list still fits the time limit.
  const oks = await mapPool(cands, 6, async (c) => (await sourceMentions(c.url, c.title, c.start, c.nameOnSource)) || searchConfirms(hits, c.url, c.title, c.nameOnSource));

  // 3. Store (or refresh) each one.
  let verified = 0;
  let stored = 0;
  for (let n = 0; n < cands.length; n++) {
    const { e, title, start, end, url, key } = cands[n];
    const ok = oks[n];
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
    // Same event found in an earlier run under a slightly different name → update that row.
    const twin = known.find((k) => k.start_date === start && titleOverlap(k.title, title) >= 0.6);
    const { error } = twin
      ? await admin.from("events").update({ ...row, dedupe_key: twin.dedupe_key, last_seen_at: new Date().toISOString() }).eq("id", twin.id)
      : await admin.from("events").upsert({ ...row, last_seen_at: new Date().toISOString() }, { onConflict: "dedupe_key" });
    if (error) console.error("[events] store failed", title, error.message);
    else stored++;
  }
  return { found: cands.length, verified, stored, searches, areaErrors };
}

/** Run `fn` over items with at most `limit` in flight; results keep the input order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Holidays + AI discovery. Each half runs even if the other fails. */
export async function syncEvents(admin: SupabaseClient): Promise<{ holidays: number; found: number; verified: number; stored: number; searches: number; errors: string[] }> {
  const errors: string[] = [];
  let holidays = 0;
  let disc = { found: 0, verified: 0, stored: 0, searches: 0, areaErrors: [] as string[] };
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
  errors.push(...disc.areaErrors.map((a) => `discovery ${a}`));
  const { areaErrors: _unused, ...rest } = disc;
  return { holidays, ...rest, errors };
}



/** Shared secret for invoking the background sync (derived — no extra env var). */
export async function eventsSyncToken(): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const data = new TextEncoder().encode(`events-sync:${key}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
