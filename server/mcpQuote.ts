/**
 * Exact quotes + real availability for the public MCP connector (server/mcp.ts),
 * so an AI assistant gets the outcome — "free on those dates, ֏X all-in, these
 * cancellation terms" — not just a link. (Meta Muse's connector guidelines:
 * read-only connectors qualify when the information is the outcome; prices
 * must be complete — fees, tax, payment timing, cancellation terms.)
 *
 * Same money rules as checkout (shared/bookings.ts), so a quote matches what
 * the guest is charged. Read-only: it never holds dates or creates bookings,
 * and it runs on the PUBLIC anon client (RLS) — every table it reads is one the
 * website already shows guests (least privilege; no service-role key).
 *   - stays: dates checked against synced calendars, the host's blocks,
 *     confirmed bookings, suspensions, minimum stay and max guests
 *   - hotels (multi-room): the cheapest room free for every night that fits the
 *     party, priced like checkout (bestRoomFor) — the room types are listed too
 *   - tours / experiences with time slots: the open slots that day with enough
 *     seats; without slots, booked by date (same checks as stays, one day)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBookingAmountCents, computeBookingCharge, describeCancellationPolicy, listingFeeCents, listingFeeLabel, nightsBetween, promoDiscount, TAX_PERCENT } from "../shared/bookings.js";
import { overlapsSuspension, type RoomType, type RoomUnit } from "../shared/listings.js";
import { bestRoomFor, type RoomAvailability, type RoomQuote } from "../shared/rooms.js";
import { formatSlotTime } from "../shared/sessions.js";

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");
const amd = (cents: number) => Math.round(cents / 100);
const fmt = (cents: number) => `֏${amd(cents).toLocaleString("en-US")}`;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayArmenia = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

/**
 * The listing's own photos (absolute URLs). Without these, assistants decorate
 * results with images from elsewhere on the web — ChatGPT showed thumbnails that
 * weren't Revamp's (2026-10-26). Only real uploaded photos; the brand SVG
 * fallbacks (/images, /brand) are left out rather than shown as "the place".
 */
export function listingPhotos(l: { image?: string | null; gallery?: string[] | null }): string[] {
  const all = [l.image, ...(l.gallery ?? [])].filter((u): u is string => typeof u === "string" && !!u);
  return Array.from(new Set(all))
    .filter((u) => !u.startsWith("/images/") && !u.startsWith("/brand/") && !/\.svg(\?|$)/i.test(u))
    .map((u) => (/^https?:\/\//i.test(u) ? u : `${SITE()}${u.startsWith("/") ? "" : "/"}${u}`))
    // Uploaded photos have size variants (…_w2560.webp, _w1280, …): 1280 px is
    // plenty for an assistant's card and far lighter (same choice as the Telegram bot).
    .map((u) => u.replace(/_w\d+\.webp$/i, "_w1280.webp"));
}

type Range = { start: string; end: string };
type Row = Record<string, unknown> & { id: string; slug: string; title: string; type: string };

export interface Quote {
  slug: string;
  title: string;
  type: string;
  /** The listing's own cover photo (absolute URL), when it has one. */
  image?: string;
  currency: "AMD";
  guests: number;
  startDate: string;
  endDate?: string;
  nights?: number;
  /** true = checked free · false = not bookable for this request (see reason) · null = can't be confirmed here (see reason). */
  available: boolean | null;
  reason?: string;
  /** All amounts in whole Armenian dram. */
  price?: { lines: { label: string; amount: number }[]; tax: { label: string; amount: number }; total: number; totalFormatted: string };
  slots?: { startsAt: string; localTime: string; durationMinutes: number; seatsLeft: number }[];
  rooms?: { name: string; maxGuests: number | null; nightlyFrom: number | null; nightlyFromFormatted: string | null }[];
  /** Hotels: the room type a guest would get (the cheapest one free for the whole stay that fits the party). */
  room?: string;
  cancellation?: string;
  payment?: string;
  bookingMode?: "instant" | "request";
  bookUrl: string;
}

const PAYMENT =
  "Paid in full when booking, by card on PayLink's secure payment page (some hosts take payment through their own PayLink account). Prices are in Armenian dram (AMD); the total includes " +
  `${TAX_PERCENT}% tax. A booking is confirmed only after the payment is verified.`;

const busyOf = (r: Row, booked: Range[]): Range[] => [
  ...((Array.isArray(r.blocked_ranges) ? r.blocked_ranges : []) as Range[]),
  ...((Array.isArray(r.manual_blocked_ranges) ? r.manual_blocked_ranges : []) as Range[]),
  ...booked,
];

function minStayOf(facts: unknown): number {
  const raw = (Array.isArray(facts) ? (facts as { label?: string; value?: string }[]) : []).find((f) => f.label?.toLowerCase() === "minimum stay")?.value;
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** The charge for one booking, itemised like checkout (accommodation, promo, fee, tax). */
function priceFor(r: Row, startDate: string, endDate: string, guests: number): Quote["price"] | null {
  const accommodation = computeBookingAmountCents(
    {
      priceCents: Number(r.price_cents) || 0,
      priceUnit: String(r.price_unit || ""),
      cancellationPolicy: (r.cancellation_policy as never) ?? "flexible",
      nonrefundableDiscountPercent: Number(r.nonrefundable_discount_percent) || 0,
      seasonalRates: Array.isArray(r.seasonal_rates) ? (r.seasonal_rates as never) : [],
      guestsIncluded: (r.guests_included as number | null) ?? undefined,
      extraGuestFeeCents: (r.extra_guest_fee_cents as number | null) ?? undefined,
    },
    { startDate, endDate, guests },
  );
  if (accommodation <= 0) return null; // "rate on request"
  const promo = promoDiscount(
    accommodation,
    { discountType: r.discount_type, discountValue: r.discount_value ?? undefined, discountStart: r.discount_start ?? undefined, discountEnd: r.discount_end ?? undefined } as never,
    startDate,
  );
  const feeListing = { type: r.type as never, cleaningFeeCents: Number(r.cleaning_fee_cents) || 0, extraFeeType: r.extra_fee_type as string | null, extraFeePer: r.extra_fee_per as string | null };
  const fee = listingFeeCents(feeListing, guests);
  const charge = computeBookingCharge(promo.netCents + fee);
  const lines = [{ label: r.type === "stay" ? "Accommodation" : `${guests} guest${guests === 1 ? "" : "s"}`, amount: amd(accommodation) }];
  if (promo.active && promo.discountCents > 0) lines.push({ label: "Discount", amount: -amd(promo.discountCents) });
  if (fee > 0) lines.push({ label: listingFeeLabel(feeListing, guests), amount: amd(fee) });
  return { lines, tax: { label: `Tax (${TAX_PERCENT}%)`, amount: amd(charge.taxCents) }, total: amd(charge.totalCents), totalFormatted: fmt(charge.totalCents) };
}

/** Room types with their rooms, read like checkout reads them (public RLS). */
async function hotelRooms(admin: SupabaseClient, listingId: string): Promise<RoomType[] | null> {
  const { data, error } = await admin.from("room_types").select("*, room_units(*)").eq("listing_id", listingId).order("sort_order", { ascending: true });
  if (error) return null;
  return ((data ?? []) as Record<string, any>[]).map((t) => ({
    id: t.id,
    listingId: t.listing_id,
    name: t.name,
    beds: [],
    maxGuests: t.max_guests,
    priceCents: t.price_cents,
    priceUnit: t.price_unit || "night",
    seasonalRates: Array.isArray(t.seasonal_rates) ? t.seasonal_rates : [],
    quantity: t.quantity,
    gallery: [],
    amenities: [],
    sortOrder: t.sort_order ?? 0,
    units: ((t.room_units ?? []) as Record<string, any>[])
      .map(
        (u): RoomUnit => ({
          id: u.id,
          roomTypeId: u.room_type_id,
          name: u.name,
          priceCents: u.price_cents ?? undefined,
          seasonalRates: Array.isArray(u.seasonal_rates) ? u.seasonal_rates : [],
          manualBlockedRanges: Array.isArray(u.manual_blocked_ranges) ? u.manual_blocked_ranges : [],
          blockedRanges: Array.isArray(u.blocked_ranges) ? u.blocked_ranges : [],
          active: u.active !== false,
          sortOrder: u.sort_order ?? 0,
        }),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

/** Confirmed bookings per room and per room type — the identity-free views the listing page uses. */
async function roomAvailability(admin: SupabaseClient, types: RoomType[]): Promise<RoomAvailability | null> {
  const typeIds = types.map((t) => t.id);
  const unitIds = types.flatMap((t) => t.units.map((u) => u.id));
  const by = async (view: string, key: string, ids: string[]) => {
    const out = new Map<string, Range[]>();
    if (!ids.length) return out;
    const { data, error } = await admin.from(view).select(`${key}, start_date, end_date`).in(key, ids);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Record<string, string>[]) out.set(row[key], [...(out.get(row[key]) ?? []), { start: row.start_date, end: row.end_date }]);
    return out;
  };
  try {
    const [byType, byUnit] = await Promise.all([by("room_type_booked_ranges", "room_type_id", typeIds), by("room_unit_booked_ranges", "room_unit_id", unitIds)]);
    return { byType, byUnit };
  } catch {
    return null;
  }
}

/** A room's charge itemised like checkout. */
function roomPrice(rq: RoomQuote, roomName: string): NonNullable<Quote["price"]> {
  const lines = [{ label: `Accommodation · ${roomName}`, amount: amd(rq.accommodationCents) }];
  if (rq.discountCents > 0) lines.push({ label: "Discount", amount: -amd(rq.discountCents) });
  if (rq.cleaningCents > 0) lines.push({ label: "Cleaning fee", amount: amd(rq.cleaningCents) });
  return { lines, tax: { label: `Tax (${TAX_PERCENT}%)`, amount: amd(rq.charge.taxCents) }, total: amd(rq.totalCents), totalFormatted: fmt(rq.totalCents) };
}

/**
 * `links`: "checkout" (default) returns a pre-filled checkout link where one
 * exists; "listing" always links the listing page — used by the ChatGPT endpoint
 * (/mcp/chatgpt), whose directory rules don't allow links to checkout pages.
 */
export async function quoteListing(
  admin: SupabaseClient | null,
  input: { slug: string; startDate: string; endDate?: string; guests?: number },
  links: "checkout" | "listing" = "checkout",
): Promise<Quote | { error: string }> {
  if (!admin) return { error: "Quotes are unavailable right now. Please try again later." };
  const { data } = await admin.from("listings").select("*").eq("slug", input.slug).eq("status", "published").maybeSingle();
  const r = data as Row | null;
  if (!r || r.is_active === false) return { error: "No published listing with that slug." };
  if (r.type === "eat" || r.type === "place") return { error: "Restaurants and places to visit aren't booked on Revamp — there's nothing to quote." };

  const guests = Math.max(1, Math.round(input.guests ?? 2));
  const today = todayArmenia();
  const start = input.startDate;
  if (start < today) return { error: "That date is in the past." };
  const isStay = r.type === "stay";
  const end = isStay ? input.endDate : addDays(start, 1);
  if (isStay && (!end || end <= start)) return { error: "For a stay, endDate (check-out) must be after startDate." };
  const nights = isStay ? nightsBetween(start, end!) : undefined;

  const cancellation = describeCancellationPolicy(r.cancellation_policy as never, {
    freeCancelDays: (r.free_cancel_days as number | null) ?? undefined,
    startDate: start,
    discountPercent: (r.nonrefundable_discount_percent as number | null) ?? undefined,
    today,
  });
  const bookingMode = r.booking_mode === "request" ? "request" : "instant";
  const base: Quote = {
    slug: r.slug,
    title: r.title,
    type: r.type,
    image: listingPhotos({ image: r.image as string | null, gallery: r.gallery as string[] | null })[0],
    currency: "AMD",
    guests,
    startDate: start,
    ...(isStay ? { endDate: end, nights } : {}),
    available: null,
    cancellation,
    payment: bookingMode === "request" ? `The host approves the request first; then you pay. ${PAYMENT}` : PAYMENT,
    bookingMode,
    bookUrl: `${SITE()}/listing/${r.slug}`,
  };

  const maxGuests = (r.max_guests as number | null) ?? null;
  if (maxGuests && guests > maxGuests) return { ...base, available: false, reason: `This listing takes up to ${maxGuests} guests.` };
  if (overlapsSuspension({ suspendedFrom: r.suspended_from, suspendedUntil: r.suspended_until } as never, start, end!)) {
    return { ...base, available: false, reason: "The host isn't taking bookings on these dates." };
  }

  // Hotels: price the room a guest would get — for each room type that fits the party, the
  // cheapest room free for every night (bestRoomFor, the same rule checkout assigns rooms
  // by) — and quote the cheapest of those. If the rooms can't be read, say so honestly.
  if (isStay && r.multi_room) {
    const types = await hotelRooms(admin, r.id);
    const rooms = (types ?? []).map((t) => ({
      name: t.name,
      maxGuests: t.maxGuests,
      nightlyFrom: t.priceCents ? amd(t.priceCents) : null,
      nightlyFromFormatted: t.priceCents ? fmt(t.priceCents) : null,
    }));
    const unknown = { ...base, available: null, reason: "This is a hotel: free rooms and the exact total depend on the room type, chosen on the listing page.", rooms };
    if (!types?.length) return unknown;
    const minStay = minStayOf(r.facts);
    if (nights! < minStay) return { ...base, available: false, reason: `This stay has a ${minStay}-night minimum.`, rooms };
    const avail = await roomAvailability(admin, types);
    if (!avail) return unknown;
    const listing = {
      cancellationPolicy: (r.cancellation_policy as never) ?? "flexible",
      nonrefundableDiscountPercent: Number(r.nonrefundable_discount_percent) || 0,
      cleaningFeeCents: Number(r.cleaning_fee_cents) || 0,
      discountType: r.discount_type as never,
      discountValue: (r.discount_value as number | null) ?? undefined,
      discountStart: (r.discount_start as string | null) ?? undefined,
      discountEnd: (r.discount_end as string | null) ?? undefined,
    };
    let best: { type: RoomType; quote: RoomQuote } | null = null;
    for (const t of types) {
      if (t.maxGuests && guests > t.maxGuests) continue;
      const got = bestRoomFor(listing, t, avail, start, end!, guests);
      if (got && got.quote.totalCents > 0 && (!best || got.quote.totalCents < best.quote.totalCents)) best = { type: t, quote: got.quote };
    }
    if (!best) return { ...base, available: false, reason: `No room is free for all of these nights for ${guests} guest${guests === 1 ? "" : "s"}.`, rooms };
    return {
      ...base,
      available: true,
      room: best.type.name,
      price: roomPrice(best.quote, best.type.name),
      reason: `Cheapest free room for these dates: ${best.type.name}. Other rooms are on the listing page.`,
      rooms,
    };
  }

  const { data: bookedRows } = await admin.from("listing_booked_ranges").select("start_date, end_date").eq("listing_id", r.id);
  const booked = ((bookedRows ?? []) as { start_date: string; end_date: string }[]).map((b) => ({ start: b.start_date, end: b.end_date }));

  if (isStay) {
    const minStay = minStayOf(r.facts);
    if (nights! < minStay) return { ...base, available: false, reason: `This stay has a ${minStay}-night minimum.` };
    if (busyOf(r, booked).some((b) => start < b.end && end! > b.start)) return { ...base, available: false, reason: "Not available for these dates." };
    const price = priceFor(r, start, end!, guests);
    if (!price) return { ...base, available: true, reason: "The host sets the price on request — ask on the listing page." };
    const q = new URLSearchParams({ start, end: end!, guests: String(guests) });
    return { ...base, available: true, price, ...(links === "checkout" ? { bookUrl: `${SITE()}/checkout/${r.slug}?${q.toString()}` } : {}) };
  }

  // Tours / experiences.
  const price = priceFor(r, start, end!, guests) ?? undefined;
  const dayStart = `${start}T00:00:00+04:00`;
  const dayEnd = `${addDays(start, 1)}T00:00:00+04:00`;
  const { data: anySession } = await admin.from("listing_sessions").select("id").eq("listing_id", r.id).limit(1);
  if ((anySession ?? []).length) {
    const { data: sess } = await admin
      .from("listing_sessions")
      .select("id, starts_at, duration_min, capacity, seats_taken, status")
      .eq("listing_id", r.id)
      .eq("status", "open")
      .gte("starts_at", dayStart)
      .lt("starts_at", dayEnd)
      .order("starts_at", { ascending: true });
    const now = Date.now();
    const slots = ((sess ?? []) as { starts_at: string; duration_min: number; capacity: number; seats_taken: number }[])
      .filter((s) => Date.parse(s.starts_at) > now && s.capacity - s.seats_taken >= guests)
      .map((s) => ({ startsAt: s.starts_at, localTime: formatSlotTime(s.starts_at), durationMinutes: s.duration_min, seatsLeft: s.capacity - s.seats_taken }));
    if (!slots.length) return { ...base, available: false, reason: `No time slots with ${guests} free seat${guests === 1 ? "" : "s"} on this date.`, slots: [], price };
    return { ...base, available: true, slots, price, reason: "Pick a time slot on the listing page to book." };
  }
  // Booked by date (no time slots set up).
  if (busyOf(r, booked).some((b) => start < b.end && end! > b.start)) return { ...base, available: false, reason: "Not available on this date.", price };
  const q = new URLSearchParams({ start, end: end!, guests: String(guests) });
  return { ...base, available: true, price, ...(links === "checkout" ? { bookUrl: `${SITE()}/checkout/${r.slug}?${q.toString()}` } : {}) };
}
