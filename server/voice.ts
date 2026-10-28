/**
 * Aha Voice Assistant (Phase 3, web) — what the ElevenLabs voice agent knows.
 *
 * The listing page starts a voice session with `listing_context` (from
 * `voiceContext`): the listing's own posted details + Guest FAQ, the same facts
 * the inbox AI and the automatic FAQ use — public information only (never door
 * codes, contacts or the host's private details). For dates the agent calls the
 * `check_dates` server tool → POST /api/voice/quote (`voiceQuote`), which reuses
 * the AI connector's quote (calendars, bookings, minimum stay, all-in price)
 * and answers in one speakable sentence. Read-only: nothing is held or booked.
 *
 * Photos: the context numbers the listing's photos in the order the page shows
 * them, labelled with the virtual tour's room (live, else Aha's draft sort) and
 * captions; the agent's `show_photo` client tool opens photo N on the page.
 *
 * Homepage search (`voiceSearch`): the agent's `search_places` client tool sends
 * place / dates / guests / budget; the SAME search as the Telegram concierge
 * (searchListings — discoverable listings, stays checked against calendars and
 * priced with checkout's helpers) returns up to 3 cards + one speakable line.
 *
 * Budget (user, 2026-10-27: stay under ~$20/month on top of the plan): every
 * call is claimed through `claim_voice_call` (0121) — a monthly and a daily cap
 * — and the browser ends a call after MAX_CALL_SECONDS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanFaq } from "../shared/listingFaq.js";
import { listingFaqFacts } from "./listingFaqAuto.js";
import { quoteListing } from "./mcpQuote.js";
import { cleanIntent, searchListings } from "./telegramConcierge.js";
import { getPublishedCatalog } from "./supabase.js";

type Row = Record<string, any>;

/**
 * Listing text written for screens, rewritten so text-to-speech says it right:
 * "1BR" → "one-bedroom", "֏ / AMD" → "drams", "m²" → "square metres",
 * "3:00 PM" → "3 PM", emoji bullets dropped.
 */
const NUM = ["zero", "one", "two", "three", "four", "five", "six"];
// Built at runtime: the "u" flag isn't allowed in regex literals for this build target.
const BULLETS = new RegExp("(?:🔸|🔹|🔶|🔷|•|✅|✔️?|➤|►)\\s*", "gu");
const EMOJI = new RegExp("[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]", "gu");
export function speakable(text: string): string {
  return text
    .replace(/\b([1-6])\s?-?BR\b/gi, (_m, n) => `${NUM[Number(n)]}-bedroom`)
    .replace(/\bstudio apt\b/gi, "studio apartment")
    .replace(/\bapt\.?\b/gi, "apartment")
    .replace(/֏\s?([\d,]+)/g, "$1 drams")
    .replace(/([\d,]+)\s?(?:AMD|֏)/g, "$1 drams")
    .replace(/\bm²|\bsq\.?\s?m\b/g, " square metres")
    .replace(/\b(\d{1,2}):00\s?(AM|PM)\b/gi, (_m, h, ap) => `${Number(h)} ${ap.toUpperCase()}`)
    .replace(BULLETS, "")
    .replace(EMOJI, "")
    .replace(/[ \t]{2,}/g, " ");
}

/** What the agent calls the listing out loud — never the marketing title. */
const spokenKind = (row: Row) =>
  row.type === "tour" ? "this tour" : row.type === "experience" ? "this experience" : row.multi_room ? "this guesthouse" : "this place";

/**
 * The listing's photos in the order the page's viewer shows them (stays: cover +
 * gallery; tours/experiences: the gallery, else the cover), each with what's in
 * it when we know: the virtual tour's room + caption, or the host's caption.
 */
async function photoList(client: SupabaseClient, admin: SupabaseClient | null, row: Row): Promise<string[]> {
  const gallery: string[] = Array.isArray(row.gallery) ? row.gallery.filter((u: unknown) => typeof u === "string" && u) : [];
  const urls: string[] =
    row.type === "stay" ? Array.from(new Set([row.image, ...gallery].filter(Boolean))) : gallery.length ? gallery : row.image ? [row.image] : [];
  if (urls.length < 2) return [];
  // Live tour (public), else the draft Aha sorted after the last save (labels only).
  const { data: tour } = await (admin ?? client).from("listing_tours").select("rooms").eq("listing_id", row.id).maybeSingle();
  const rooms: { name?: string; photos?: { url: string; caption?: string }[] }[] = Array.isArray(tour?.rooms) ? tour.rooms : [];
  const byUrl = new Map<string, string>();
  for (const room of rooms) {
    for (const ph of room.photos ?? []) {
      const label = [room.name, ph.caption].filter((x) => typeof x === "string" && x.trim()).join(" — ");
      if (label) byUrl.set(ph.url, label);
    }
  }
  const captions: Record<string, string> = row.photo_captions && typeof row.photo_captions === "object" ? row.photo_captions : {};
  return urls.slice(0, 40).map((u, i) => {
    const label = [byUrl.get(u), captions[u]?.trim()].filter(Boolean).join(" — ");
    return `${i + 1}. ${label ? speakable(label) : "(no description)"}`;
  });
}

export async function voiceContext(client: SupabaseClient, slug: string, admin: SupabaseClient | null = null): Promise<{ title: string; context: string } | null> {
  const { data } = await client.from("listings").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
  const row = data as Row | null;
  if (!row || row.is_active === false) return null;
  const faq = cleanFaq(row.faq);
  const photos = await photoList(client, admin, row).catch(() => [] as string[]);
  const lines = [
    `RULES FOR THIS CALL (they apply in every language, Russian included):`,
    `- Use only the facts below. Don't add adjectives, numbers or details they don't contain (a "City View" is a city view — not a "panoramic" one). If something isn't here, say you don't have that detail.`,
    `- Suggest "Ask the host a question" at most once in the whole call, and only when the guest needs something you can't answer. Don't end every answer with it.`,
    `- When you talk, call it "${spokenKind(row)}" — don't read the listing title aloud. Say prices as a number of drams.`,
    `- If the guest wants to book: check the dates with check_dates first; if they're available, call fill_booking with the same dates and guests${row.type === "tour" || row.type === "experience" ? " (and the start time they chose)" : ""}. It fills in the booking box on the page. Then tell them to tap Book there to finish and pay. Never say it's booked or reserved — only the guest can book.`,
    ...(photos.length
      ? [
          `- If the guest asks to see something (the bathroom, the kitchen, the view…), call show_photo with the number of the best matching photo from PHOTOS, then say in a few words what it shows. If several match, show the first and offer the next. If none matches, say there's no photo of that — never show a different room instead. Photos marked "(no description)" can be shown in order when the guest just wants to look around.`,
        ]
      : []),
    `- If the guest wants a whole trip planned around their stay ("plan my 4 days"), call plan_trip with the days, where they start, how many people and their interests; it opens a day-by-day plan on their screen.`,
    `LISTING (for your reference only): ${speakable(row.title)}`,
    ...listingFaqFacts(row).map((f) => `- ${speakable(f)}`),
    ...(faq.length ? ["FREQUENT QUESTIONS:", ...faq.map((f) => `- Q: ${speakable(f.q)} A: ${speakable(f.a)}`)] : []),
    ...(photos.length ? ["PHOTOS (numbers for show_photo):", ...photos] : []),
  ];
  return { title: row.title, context: lines.join("\n").slice(0, 14000) };
}

/**
 * Spoken like the page shows it: the site displays prices rounded to the nearest
 * 100 drams (CurrencyContext), so Aha says the same figure — "about" when rounded.
 */
const drams = (n: number) => {
  const shown = Math.round(n / 100) * 100;
  return `${shown === Math.round(n) ? "" : "about "}${shown.toLocaleString("en-US")} drams`;
};
/** "20 November" — read naturally by text-to-speech (not "2026-11-20"). */
const spoken = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** One or two sentences an assistant can say out loud. */
export async function voiceQuote(
  client: SupabaseClient,
  input: { slug: string; startDate: string; endDate?: string; guests?: number },
): Promise<{ available: boolean | null; say: string }> {
  const q = await quoteListing(client, input, "listing");
  if ("error" in q) {
    // Technical wording from the shared quote → something a host would say.
    const say = /endDate|check-out/i.test(q.error)
      ? "For a stay I need both dates — when would you check out?"
      : /past/i.test(q.error)
        ? "That date has already passed — which dates are you thinking of?"
        : q.error;
    return { available: null, say };
  }
  const when = q.endDate ? `${q.nights} night${q.nights === 1 ? "" : "s"} from ${spoken(q.startDate)} to ${spoken(q.endDate)}` : `on ${spoken(q.startDate)}`;
  if (q.available === false) return { available: false, say: `Not available ${when}. ${q.reason ?? ""} Other dates may be free — the calendar is on the listing page.`.trim() };
  const parts = [`Available ${when} for ${q.guests} guest${q.guests === 1 ? "" : "s"}.`];
  if (q.room) parts.push(`The cheapest free room is the ${q.room}.`);
  if (q.slots?.length) parts.push(`Open times: ${q.slots.map((s) => s.localTime).join(", ")}.`);
  if (q.price) parts.push(`The total is ${drams(q.price.total)}, including fees and ${q.price.tax.label.replace(/^Tax /, "").replace(/[()]/g, "")} tax.`);
  if (q.cancellation) parts.push(`${q.cancellation}.`);
  if (q.available === null && q.reason) parts.push(q.reason);
  parts.push("You can book on this page.");
  return { available: q.available, say: speakable(parts.join(" ").replace(/\.\./g, ".")) };
}

/**
 * The listing call's instructions, sent as the session's prompt override (the
 * agent's own dashboard prompt is only a fallback). Lives in code so the tool
 * rules are versioned — on 2026-10-27 Aha said "photo 10 is the bathroom"
 * without calling show_photo, so the rules say it plainly.
 */
export function listingPrompt(lang: "en" | "ru", title: string, context: string): string {
  const today = armeniaToday();
  return `You are Aha AI, Revamp Vacations' assistant (Revamp is a travel marketplace in Armenia). A guest is on the page of one listing and is talking to you through their browser. Today is ${today} (Armenia time).

Everything you know about this listing is below. Answer ONLY from it. Never invent amenities, times, distances, prices, availability, rules or promises. If it doesn't answer a question, say you don't have that detail and suggest "Ask the host a question" on the page (at most once in the call).

${context}

Your tools — use them, never just describe them:
- check_dates: availability and the all-in price for dates (YYYY-MM-DD). Ask for any missing date first.
- fill_booking: after check_dates says the dates are available, fills in the booking box. Then the guest taps Book.
- show_photo: when the guest wants to see something, call it with the photo's number from PHOTOS. Never say a photo is open or "here it is" unless show_photo returned that it opened.
- plan_trip: a whole trip planned around their stay.
- search_places: other places to stay, things to do, or restaurants and cafés nearby (type "eat", where = this town), if the guest asks.
- handoff: when the guest asks for a person, or needs something you can't do (changing or cancelling a booking, refunds, payments, special requests, complaints), call handoff with to = "host" for anything about this place or their stay, or "team" for anything about Revamp, payments or their account, and question = their request in one or two sentences, in their words and language. It opens a form with that written in; the guest sends it. Then say what it returns.
- end_call: when the guest says goodbye or that they're done ("thanks, bye", "that's all"), say one short, warm goodbye, then call end_call. Never end the call while they still have a question.

How to talk: short and natural for speech, one to three sentences. No lists, markdown, links or emoji. Prices as a number of drams. ${lang === "ru" ? "Speak Russian." : "Speak English, or Russian if the guest speaks Russian."} You can't book, hold dates, take payments or change bookings — the guest books on the page, and the host handles changes through "Ask the host a question". Never ask for payment details, passwords or ID numbers, and never share the host's contacts.

(Listing: ${title})`;
}

// ── Homepage voice search ───────────────────────────────────────────────────

/** Longest call the browser allows before it hangs up (budget). */
export const MAX_CALL_SECONDS = 240;

const armeniaToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);

/** The homepage agent's instructions (sent as the session's prompt override). */
export function homePrompt(lang: "en" | "ru"): string {
  // Aha is Revamp's one assistant (chat, voice, trip planner) — the name guests see everywhere.
  const today = armeniaToday();
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `You are Aha AI, the voice assistant of Revamp Vacations, a travel marketplace in Armenia. A visitor on the homepage is talking to you through their browser to find a place to stay, a tour or an experience. Today is ${weekday} ${today} (Armenia time).

How to help:
- Find out what they want: what (stay, tour, experience, or a restaurant/café = type "eat"), where in Armenia, the dates, and how many people. Ask for one missing thing at a time, but don't insist — search as soon as you know at least what and where (or dates).
- Then call search_places. For restaurants and cafés use type "eat" (no dates needed); keywords can be a cuisine or dish (e.g. "khorovats", "wine", "coffee"). Dates as YYYY-MM-DD: resolve "this weekend" (the coming Friday to Sunday), "next week", "for 3 nights from the 14th" into real dates on or after today. For tours and experiences give only startDate. maxPrice is per night in Armenian drams (about 390 drams per US dollar).
- search_places shows the results as cards on the visitor's screen and returns what to say. Always call it to search — never describe places you haven't got from it. Say it briefly and naturally, then ask if they'd like to change anything (cheaper, other dates, another town). Never describe listings you weren't given, and never invent prices, availability, amenities or reviews.
- The visitor taps a card to see the place and book it. You can't book, hold dates or take payments.
- If they want a whole trip planned ("plan me 4 days", "an itinerary for a week"), ask how many days and where they start if you don't know, then call plan_trip with days, startCity (Yerevan, Gyumri or Dilijan), travelers, and interests as short comma-separated words (e.g. "food, hiking, history"). It opens the plan on their screen.
- If the visitor asks for a person, or needs something you can't do (bookings, refunds, payments, complaints, special requests), call handoff with to = "team" and question = their request in one or two sentences, in their words. It puts the question in the Revamp chat for them to send. Then say what it returns.
- When the visitor says goodbye or that they're done, say one short, warm goodbye, then call end_call. Never end the call while they still have a question.
- Keep every answer short and natural for speech: one to three sentences. No lists, no markdown, no links, no emoji. Say prices as a number of drams.
- ${lang === "ru" ? "Speak Russian." : "Speak English, or Russian if the visitor speaks Russian."}
- For questions about travelling in Armenia (visas, money, transport) give a short, careful general answer and suggest the Travel guide on the site for details. Never ask for payment details, passwords or ID numbers.`;
}

export interface VoiceCard {
  slug: string;
  type: string;
  title: string;
  city: string;
  image: string;
  /** "֏35,000 / night" style headline price, or "Rate on request". */
  price: string;
  /** All-in total for the dates (stays with dates), in drams. */
  total: number | null;
  /** Hotels/guesthouses with dates: the room type the total is for. */
  room: string | null;
  nights: number | null;
  available: boolean | null;
}

/** The `search_places` tool: up to 3 real listings + one sentence to say. */
export async function voiceSearch(
  admin: SupabaseClient | null,
  input: { where?: string; type?: string; startDate?: string; endDate?: string; guests?: number; maxPrice?: number; keywords?: string },
): Promise<{ say: string; cards: VoiceCard[]; query: { type: string; startDate: string | null; endDate: string | null; guests: number | null } }> {
  const today = armeniaToday();
  const q = cleanIntent(
    {
      intent: "search",
      type: input.type,
      where: input.where,
      checkIn: input.startDate,
      checkOut: input.endDate,
      guests: input.guests,
      maxPricePerNight: input.maxPrice,
      keywords: input.keywords,
    },
    today,
  );
  const type = q.type ?? "stay";
  const found = await searchListings(admin, q, await getPublishedCatalog(), today);
  const cards: VoiceCard[] = found.map((c) => ({
    slug: c.listing.slug,
    type: c.listing.type,
    title: c.listing.title,
    city: c.listing.city,
    image: c.listing.image,
    // Restaurants / places aren't priced — show what kind of place it is instead.
    price:
      c.listing.type === "eat" || c.listing.type === "place"
        ? c.listing.cuisine || c.listing.venueType || (c.listing.type === "eat" ? "Restaurant" : "Place to visit")
        : c.listing.price > 0
          ? `${c.listing.priceLabel} / ${c.listing.priceUnit}`
          : "Rate on request",
    total: c.totalCents != null ? Math.round(c.totalCents / 100) : null,
    room: c.room ?? null,
    nights: c.nights,
    available: c.available,
  }));
  const one = cards.length === 1;
  const WHAT: Record<string, [string, string]> = { tour: ["tour", "tours"], experience: ["experience", "experiences"], eat: ["place to eat", "places to eat"], place: ["place to visit", "places to visit"], stay: ["place to stay", "places to stay"] };
  const what = (WHAT[type] ?? WHAT.stay)[one ? 0 : 1];
  const where = q.where ? ` in ${q.where}` : "";
  const when = q.checkIn && q.checkOut ? ` from ${spoken(q.checkIn)} to ${spoken(q.checkOut)}` : q.checkIn ? ` on ${spoken(q.checkIn)}` : "";
  const query = { type, startDate: q.checkIn, endDate: q.checkOut, guests: q.guests };
  if (!cards.length) {
    return {
      say: `I couldn't find ${(WHAT[type] ?? WHAT.stay)[1]}${where}${type === "eat" || type === "place" ? "" : when} that match on Revamp right now. Would you like to try other dates, a nearby town, or fewer requirements?`,
      cards,
      query,
    };
  }
  const items = cards.map((c, i) => {
    const name = speakable(c.title);
    if (c.type === "eat" || c.type === "place") return `${i + 1}: ${name}, ${speakable(c.price)}`;
    const cost = c.total != null && c.nights ? `${c.room ? `the ${speakable(c.room)}, ` : ""}${drams(c.total)} in total for ${c.nights} night${c.nights === 1 ? "" : "s"}` : c.price === "Rate on request" ? "price on request" : `from ${speakable(c.price.replace(/ \/ .*/, ""))} per ${c.price.split(" / ")[1] ?? "night"}`;
    return `${i + 1}: ${name}, ${cost}`;
  });
  // Hotels' rooms are checked on their page, so only claim "available" when every card was checked.
  const checked = q.checkIn && q.checkOut && cards.every((c) => c.available === true) ? " available" : "";
  return {
    say: `I found ${cards.length === 1 ? "one" : cards.length} ${what}${where}${checked}${when} — ${one ? "it's" : "they're"} on your screen. ${items.join(". ")}. ${one ? "Tap it" : "Tap one"} to see it${type === "eat" || type === "place" ? "" : " and book"}.`,
    cards,
    query,
  };
}
