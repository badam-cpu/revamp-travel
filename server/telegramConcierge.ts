/**
 * The Telegram bot's AI trip concierge (migration 0110). A guest writes what
 * they want — "2 nights in Dilijan next weekend for 2", "wine tour near
 * Yerevan on Saturday", "cheaper?" — and gets up to three REAL listings from
 * the live catalog as cards (photo, price, Book button).
 *
 * Claude (Haiku) only turns the message into a search (type, place, dates,
 * guests, budget, keywords), merged with the chat's previous search so
 * follow-ups work. Everything shown comes from our own data and code:
 * listings from getPublishedCatalog (discoverable only), availability from
 * the stay's iCal/manual blocks, confirmed bookings and suspensions, the
 * minimum stay, and the total from the SAME helpers checkout charges with
 * (computeBookingAmountCents + fee + promo + tax). Questions ("do I need a
 * visa?") go to the support AI (generateSupportReply — grounded, no invented
 * facts). Nothing is booked here: buttons open checkout / the listing.
 *
 * Rate-limited per chat (telegram_chats.msg_count, 30 an hour).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTelegram, sendTelegramPhoto, telegramTyping, type TgButton } from "./telegram.js";
import { getPublishedCatalog, listPublishedForPlanner, type PublicListing } from "./supabase.js";
import { generateSupportReply } from "./support.js";
import { ARMENIA_REGIONS, isDiscoverable, overlapsSuspension } from "../shared/listings.js";
import { computeBookingAmountCents, computeBookingCharge, listingFeeCents, nightsBetween, promoDiscount } from "../shared/bookings.js";

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");
const UTM = "utm_source=telegram&utm_medium=bot&utm_campaign=concierge";
const yerevanToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (cents: number) => `֏${Math.round(cents / 100).toLocaleString("en-US")}`;
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const RATE_PER_HOUR = 30;

type ListingType = "stay" | "tour" | "experience" | "eat" | "place";
export interface ConciergeIntent {
  intent: "search" | "question" | "chat";
  type: ListingType | null;
  where: string | null;
  checkIn: string | null;
  checkOut: string | null;
  guests: number | null;
  maxPricePerNight: number | null;
  keywords: string | null;
  lang: "en" | "ru" | "other";
  reply: string | null;
}

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    client = apiKey ? new Anthropic({ apiKey }) : null;
  }
  return client;
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const TYPES: ListingType[] = ["stay", "tour", "experience", "eat", "place"];

/** Keeps only well-formed values from the model's JSON. */
export function cleanIntent(raw: Partial<Record<keyof ConciergeIntent, unknown>>, today: string): ConciergeIntent {
  const type = TYPES.includes(raw.type as ListingType) ? (raw.type as ListingType) : null;
  let checkIn = isDate(raw.checkIn) && raw.checkIn >= today ? raw.checkIn : null;
  let checkOut = isDate(raw.checkOut) ? raw.checkOut : null;
  if (checkIn && checkOut && checkOut <= checkIn) checkOut = null;
  if (!checkIn) checkOut = null;
  const guests = typeof raw.guests === "number" && raw.guests >= 1 && raw.guests <= 30 ? Math.round(raw.guests) : null;
  const maxPrice = typeof raw.maxPricePerNight === "number" && raw.maxPricePerNight > 0 ? Math.round(raw.maxPricePerNight) : null;
  const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  return {
    intent: raw.intent === "question" || raw.intent === "chat" ? raw.intent : "search",
    type,
    where: str(raw.where, 60),
    checkIn,
    checkOut,
    guests,
    maxPricePerNight: maxPrice,
    keywords: str(raw.keywords, 60),
    lang: raw.lang === "ru" ? "ru" : raw.lang === "en" ? "en" : "other",
    reply: str(raw.reply, 300),
  };
}

function systemPrompt(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `You turn a traveller's Telegram message into a search of Revamp, an Armenian travel marketplace (stays, tours, experiences, restaurants = "eat", places to visit = "place"). Today is ${weekday} ${today} (Armenia).

Reply with JSON only:
{"intent":"search"|"question"|"chat","type":"stay"|"tour"|"experience"|"eat"|"place"|null,"where":string|null,"checkIn":"YYYY-MM-DD"|null,"checkOut":"YYYY-MM-DD"|null,"guests":number|null,"maxPricePerNight":number|null,"keywords":string|null,"lang":"en"|"ru"|"other","reply":string|null}

Rules:
- "search" when they want somewhere to stay or something to do/eat; "question" for questions about Armenia or booking (visa, money, transport, cancellation…); "chat" for greetings/thanks.
- type: hotels/apartments/cabins/guesthouses = stay; guided trips = tour; classes/workshops/tastings = experience. Default stay for "where to stay" style requests, null if unclear.
- where: an English place name as used in Armenia (e.g. Yerevan, Dilijan, Gyumri, Sevan, Jermuk, Tsaghkadzor, Goris, Tatev, Garni) or a region (${ARMENIA_REGIONS.join(", ")}). null if none.
- Dates: resolve relative dates ("next weekend" = the coming Friday→Sunday, "tonight", "for 3 nights from the 14th") into real dates on/after today. For tours/experiences put the day in checkIn and leave checkOut null. Never invent dates the user didn't imply.
- maxPricePerNight in Armenian drams (convert "$50" at about 390 AMD per USD). keywords: short words like "pool", "wine", "hiking", "view", "family".
- PREVIOUS is the search already shown in this chat. For follow-ups ("cheaper", "what about tours", "for 4 people", "next week instead") return the FULL updated search, keeping what still applies. A "cheaper" request sets maxPricePerNight below the previous results' level if given.
- lang: the language they wrote in ("ru" for Russian). reply: only for "chat" — one short friendly sentence in their language; otherwise null.`;
}

async function parseIntent(text: string, previous: ConciergeIntent | null, today: string): Promise<ConciergeIntent | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.create({
      model: process.env.TELEGRAM_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 300,
      system: [{ type: "text", text: systemPrompt(today) }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content: `PREVIOUS: ${previous ? JSON.stringify(previous) : "none"}\nMESSAGE: ${text.slice(0, 500)}` }],
    });
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return cleanIntent(JSON.parse(json), today);
  } catch (err) {
    console.error("[concierge] parse", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

interface StayFacts {
  slug: string;
  price_cents: number;
  price_unit: string;
  seasonal_rates: { start: string; end: string; priceCents: number }[] | null;
  cleaning_fee_cents: number | null;
  guests_included: number | null;
  extra_guest_fee_cents: number | null;
  discount_type: "percent" | "amount" | null;
  discount_value: number | null;
  discount_start: string | null;
  discount_end: string | null;
  cancellation_policy: "flexible" | "non_refundable" | null;
  nonrefundable_discount_percent: number | null;
  blocked_ranges: { start: string; end: string }[] | null;
  manual_blocked_ranges: { start: string; end: string }[] | null;
  suspended_from: string | null;
  suspended_until: string | null;
  facts: { label?: string; value?: string }[] | null;
  multi_room: boolean | null;
  type: string;
  id: string;
}

export interface Card {
  listing: PublicListing;
  /** Total for the dates (stays with dates, priced with checkout's helpers). */
  totalCents: number | null;
  nights: number | null;
  /** True = checked free for the dates; null = not checked (no dates / hotel / activity). */
  available: boolean | null;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "");

function minStayOf(facts: StayFacts["facts"]): number {
  const raw = (facts ?? []).find((f) => f.label?.toLowerCase() === "minimum stay")?.value;
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** Real listings for the search (up to 3), with availability + price where we can check them. */
export async function searchListings(admin: SupabaseClient | null, q: ConciergeIntent, catalog: PublicListing[], today: string): Promise<Card[]> {
  const type = q.type ?? "stay";
  const where = q.where ? norm(q.where) : "";
  const words = (q.keywords ?? "").split(/[\s,]+/).map(norm).filter((w) => w.length > 2);
  let pool = catalog.filter((l) => isDiscoverable(l, today) && l.type === type);
  if (where) pool = pool.filter((l) => [l.city, l.region, l.title].some((v) => norm(v || "").includes(where)));
  if (q.guests) pool = pool.filter((l) => !l.maxGuests || l.maxGuests >= q.guests!);
  if (q.maxPricePerNight && type === "stay") pool = pool.filter((l) => l.price > 0 && l.price <= q.maxPricePerNight!);
  if (words.length) {
    const hay = (l: PublicListing) => norm([l.title, l.shortDescription, l.eyebrow, ...(l.tags ?? []), ...(l.amenities ?? []), l.cuisine, l.venueType].join(" "));
    const scored = pool.map((l) => ({ l, s: words.filter((w) => hay(l).includes(w)).length })).filter((x) => x.s > 0);
    if (scored.length) pool = scored.sort((a, b) => b.s - a.s).map((x) => x.l);
  }
  pool = pool.slice().sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || (a.price || Infinity) - (b.price || Infinity));

  const dated = type === "stay" && q.checkIn && q.checkOut;
  if (!dated || !admin) return pool.slice(0, 3).map((listing) => ({ listing, totalCents: null, nights: null, available: null }));

  // Stays with dates: check the top candidates for real.
  const candidates = pool.slice(0, 12);
  const { data } = await admin
    .from("listings")
    .select(
      "id, slug, type, price_cents, price_unit, seasonal_rates, cleaning_fee_cents, guests_included, extra_guest_fee_cents, discount_type, discount_value, discount_start, discount_end, cancellation_policy, nonrefundable_discount_percent, blocked_ranges, manual_blocked_ranges, suspended_from, suspended_until, facts, multi_room",
    )
    .in("slug", candidates.map((c) => c.slug));
  const rows = new Map(((data ?? []) as StayFacts[]).map((r) => [r.slug, r]));
  const ids = Array.from(rows.values()).map((r) => r.id);
  const { data: booked } = ids.length ? await admin.from("listing_booked_ranges").select("listing_id, start_date, end_date").in("listing_id", ids) : { data: [] };
  const bookedBy = new Map<string, { start: string; end: string }[]>();
  for (const b of (booked ?? []) as { listing_id: string; start_date: string; end_date: string }[]) {
    const arr = bookedBy.get(b.listing_id) ?? [];
    arr.push({ start: b.start_date, end: b.end_date });
    bookedBy.set(b.listing_id, arr);
  }

  const start = q.checkIn!;
  const end = q.checkOut!;
  const nights = nightsBetween(start, end);
  const guests = q.guests ?? 2;
  const cards: Card[] = [];
  for (const listing of candidates) {
    const r = rows.get(listing.slug);
    if (!r) continue;
    if (minStayOf(r.facts) > nights) continue;
    if (overlapsSuspension({ suspendedFrom: r.suspended_from, suspendedUntil: r.suspended_until } as never, start, end)) continue;
    if (r.multi_room) {
      // Hotels sell rooms; their per-room availability is checked on the page.
      cards.push({ listing, totalCents: null, nights, available: null });
    } else {
      const busy = [...(r.blocked_ranges ?? []), ...(r.manual_blocked_ranges ?? []), ...(bookedBy.get(r.id) ?? [])];
      if (busy.some((b) => start < b.end && end > b.start)) continue;
      const accommodation = computeBookingAmountCents(
        {
          priceCents: r.price_cents,
          priceUnit: r.price_unit,
          cancellationPolicy: r.cancellation_policy ?? "flexible",
          nonrefundableDiscountPercent: r.nonrefundable_discount_percent ?? 0,
          seasonalRates: Array.isArray(r.seasonal_rates) ? r.seasonal_rates : [],
          guestsIncluded: r.guests_included ?? undefined,
          extraGuestFeeCents: r.extra_guest_fee_cents ?? undefined,
        },
        { startDate: start, endDate: end, guests },
      );
      if (accommodation <= 0) continue; // rate on request
      const net = promoDiscount(accommodation, { discountType: r.discount_type, discountValue: r.discount_value ?? undefined, discountStart: r.discount_start ?? undefined, discountEnd: r.discount_end ?? undefined } as never, start).netCents;
      const total = computeBookingCharge(net + listingFeeCents({ type: "stay", cleaningFeeCents: r.cleaning_fee_cents ?? 0 }, guests)).totalCents;
      cards.push({ listing, totalCents: total, nights, available: true });
    }
    if (cards.length >= 3) break;
  }
  return cards;
}

// ── Replies ─────────────────────────────────────────────────────────────────

const T = {
  en: {
    found: (n: number, what: string) => `Here ${n === 1 ? "is" : "are"} ${n} ${what}:`,
    none: "I couldn't find a match on Revamp for that. Try other dates, a nearby town, or fewer filters.",
    limit: "You've sent a lot of messages — give me a few minutes and try again.",
    fallback: "Sorry, I couldn't work that out. Try something like “a cabin in Dilijan for 2, 14–16 Nov”.",
    book: "Book these dates",
    view: "View & book",
    details: "Details",
    nightFrom: "from",
    perNight: "night",
    total: (t: string, n: number) => `${t} for ${n} night${n === 1 ? "" : "s"} · fees & tax incl.`,
    free: (a: string, b: string) => `✓ Free ${a} – ${b}`,
    refine: "Want something different? Just say — e.g. “cheaper”, “with a view”, “for 4 people”.",
  },
  ru: {
    found: (n: number, what: string) => `Вот ${n} ${what}:`,
    none: "Не нашёл подходящих вариантов на Revamp. Попробуйте другие даты, соседний город или меньше условий.",
    limit: "Слишком много сообщений — попробуйте снова через несколько минут.",
    fallback: "Извините, не понял запрос. Попробуйте, например: «домик в Дилижане на двоих, 14–16 ноября».",
    book: "Забронировать",
    view: "Смотреть",
    details: "Подробнее",
    nightFrom: "от",
    perNight: "ночь",
    total: (t: string, n: number) => `${t} за ${n} ноч${n === 1 ? "ь" : n < 5 ? "и" : "ей"} · сборы и налог включены`,
    free: (a: string, b: string) => `✓ Свободно ${a} – ${b}`,
    refine: "Хотите другое? Просто напишите — например, «дешевле», «с видом», «на 4 человек».",
  },
};
const WHAT_EN: Record<ListingType, string> = { stay: "places to stay", tour: "tours", experience: "experiences", eat: "places to eat", place: "places to visit" };
const WHAT_RU: Record<ListingType, string> = { stay: "вариантов жилья", tour: "туров", experience: "впечатлений", eat: "мест, где поесть", place: "мест для посещения" };

function absImage(url: string | undefined): string | null {
  if (!url) return null;
  const abs = url.startsWith("http") ? url : `${SITE()}${url.startsWith("/") ? "" : "/"}${url}`;
  if (/\.svg($|\?)/i.test(abs)) return null; // Telegram can't show SVG as a photo
  return abs.replace(/_w2560\.(webp|jpg|jpeg|png)$/i, "_w1280.$1");
}

async function sendCard(chatId: string, card: Card, q: ConciergeIntent, t: (typeof T)["en"]): Promise<void> {
  const l = card.listing;
  const listingUrl = `${SITE()}/listing/${l.slug}?${UTM}`;
  const lines = [`<b>${esc(l.title)}</b>`, esc([l.city, l.region && l.region !== l.city ? l.region : ""].filter(Boolean).join(", "))];
  if (card.totalCents != null && card.nights) lines.push(`💳 ${esc(t.total(money(card.totalCents), card.nights))}`);
  else if (l.price > 0) lines.push(`💳 ${t.nightFrom} ${esc(l.priceLabel)} / ${l.type === "stay" ? t.perNight : esc(l.priceUnit)}`);
  if (card.available && q.checkIn && q.checkOut) lines.push(esc(t.free(shortDay(q.checkIn), shortDay(q.checkOut))));
  if (l.shortDescription) lines.push("", esc(l.shortDescription.slice(0, 180)));
  const keyboard: TgButton[][] =
    card.available && q.checkIn && q.checkOut
      ? [
          [
            { text: t.book, url: `${SITE()}/checkout/${l.slug}?start=${q.checkIn}&end=${q.checkOut}&guests=${q.guests ?? 2}&${UTM}` },
            { text: t.details, url: listingUrl },
          ],
        ]
      : [[{ text: t.view, url: listingUrl }]];
  const caption = lines.join("\n").slice(0, 1000);
  const img = absImage(l.image);
  if (img) {
    const r = await sendTelegramPhoto(chatId, img, caption, { html: true, keyboard });
    if (r.sent) return;
  }
  await sendTelegram(chatId, caption, { html: true, keyboard });
}

/** Counts this message; false when the chat is over its hourly allowance. */
async function withinRate(admin: SupabaseClient, chatId: string): Promise<{ ok: boolean; state: Record<string, unknown> }> {
  const { data, error } = await admin.from("telegram_chats").select("state, window_start, msg_count").eq("chat_id", chatId).maybeSingle();
  if (error) return { ok: true, state: {} }; // before 0110
  const row = data as { state: Record<string, unknown> | null; window_start: string; msg_count: number } | null;
  const fresh = !row || Date.now() - Date.parse(row.window_start) > 3_600_000;
  const count = fresh ? 1 : (row!.msg_count ?? 0) + 1;
  await admin.from("telegram_chats").upsert(
    { chat_id: chatId, msg_count: count, ...(fresh ? { window_start: new Date().toISOString() } : {}), updated_at: new Date().toISOString() },
    { onConflict: "chat_id" },
  );
  return { ok: count <= RATE_PER_HOUR, state: row?.state ?? {} };
}

export async function handleConciergeMessage(
  admin: SupabaseClient,
  m: { chatId: string; text: string; userId: string | null; firstName: string | null; /** tests */ catalog?: PublicListing[] },
): Promise<void> {
  const today = yerevanToday();
  const looksRu = /[а-яё]/i.test(m.text);
  const rate = await withinRate(admin, m.chatId);
  if (!rate.ok) return void (await sendTelegram(m.chatId, (looksRu ? T.ru : T.en).limit));
  await telegramTyping(m.chatId);

  const previous = (rate.state?.intent as ConciergeIntent | undefined) ?? null;
  // Without the AI: a plain keyword search of stays.
  const q = (await parseIntent(m.text, previous, today)) ?? cleanIntent({ intent: "search", type: "stay", keywords: m.text, lang: looksRu ? "ru" : "en" }, today);
  const t = q.lang === "ru" || (q.lang === "other" && looksRu) ? T.ru : T.en;

  if (q.intent === "chat") {
    await sendTelegram(m.chatId, q.reply || t.refine);
    return;
  }
  if (q.intent === "question") {
    try {
      const reply = await generateSupportReply([{ sender: "traveler", body: m.text.slice(0, 1000) }], await listPublishedForPlanner());
      await sendTelegram(m.chatId, reply.reply.slice(0, 4000), reply.needsHuman ? { keyboard: [[{ text: "Contact Revamp", url: `${SITE()}/faq?${UTM}` }]] } : {});
    } catch (err) {
      console.error("[concierge] question", err);
      await sendTelegram(m.chatId, t.fallback);
    }
    return;
  }

  const catalog = m.catalog ?? (await getPublishedCatalog());
  const cards = await searchListings(admin, q, catalog, today);
  await admin.from("telegram_chats").update({ state: { intent: q }, updated_at: new Date().toISOString() }).eq("chat_id", m.chatId);
  if (!cards.length) {
    await sendTelegram(m.chatId, t.none, { keyboard: [[{ text: t.view, url: `${SITE()}/explore/${q.type ?? "stay"}?${UTM}` }]] });
    return;
  }
  const type = q.type ?? "stay";
  await sendTelegram(m.chatId, t.found(cards.length, (t === T.ru ? WHAT_RU : WHAT_EN)[type]));
  for (const c of cards) await sendCard(m.chatId, c, q, t);
  await sendTelegram(m.chatId, t.refine);
}
