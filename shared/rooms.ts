/**
 * Pure helpers for multi-room properties (hotels — migration 0092): room
 * availability and the price of a room for given dates. No I/O, so the client,
 * the server and tests share them — the price a guest is shown is computed by
 * the same code the server charges with.
 *
 * A room TYPE owns individual rooms (`units`). Guests book a type; the cheapest
 * room of that type that's free for every night is assigned. A type with no
 * rooms yet falls back to its legacy `quantity` count.
 */
import type { Listing, RoomType, RoomUnit } from "./listings.js";
import { addDaysIso, computeBookingAmountCents, computeBookingCharge, maxNightlyOccupancy, nightOccupancy, nightsBetween, promoDiscount, type BookingCharge } from "./bookings.js";

type Range = { start: string; end: string };
type QuoteListing = Pick<Listing, "cancellationPolicy" | "nonrefundableDiscountPercent" | "cleaningFeeCents" | "discountType" | "discountValue" | "discountStart" | "discountEnd">;

/** Nights on which every room of this type is booked — legacy count model. */
export function soldOutNights(ranges: Range[], quantity: number): Range[] {
  const nights = new Set<string>();
  for (const r of ranges) for (let d = r.start; d < r.end; d = addDaysIso(d, 1)) nights.add(d);
  return Array.from(nights)
    .filter((d) => nightOccupancy(ranges, d) >= quantity)
    .sort()
    .map((d) => ({ start: d, end: addDaysIso(d, 1) }));
}

/** Whether at least one room of this type is free every night — legacy count model. */
export function roomAvailable(ranges: Range[], quantity: number, start: string, end: string): boolean {
  return maxNightlyOccupancy(ranges, start, end) < quantity;
}

export interface RoomQuote {
  nights: number;
  accommodationCents: number;
  discountCents: number;
  cleaningCents: number;
  charge: BookingCharge;
  /** What the guest pays (base + tax), and what it would be without the sale discount. */
  totalCents: number;
  undiscountedTotalCents: number;
}

/**
 * The nightly price input for a room. Per night: the room's own per-date rate →
 * the room TYPE's per-date rate (0100) → the room's base → the type's base. The
 * room's rates come last because a matching rate is resolved last-wins.
 */
export function unitPricing(type: Pick<RoomType, "priceCents" | "seasonalRates">, unit: Pick<RoomUnit, "priceCents" | "seasonalRates">) {
  return { priceCents: unit.priceCents ?? type.priceCents, priceUnit: "night", seasonalRates: [...(type.seasonalRates ?? []), ...(unit.seasonalRates ?? [])] };
}

/** One night's price for a room (same rule as `unitPricing`) — for calendars and the timeline. */
export function unitNightCents(type: Pick<RoomType, "priceCents" | "seasonalRates">, unit: Pick<RoomUnit, "priceCents" | "seasonalRates">, night: string): { cents: number; source: "room" | "type" | "base" } {
  const own = (unit.seasonalRates ?? []).filter((r) => r.start <= night && night <= r.end).pop();
  if (own) return { cents: own.priceCents, source: "room" };
  const t = (type.seasonalRates ?? []).filter((r) => r.start <= night && night <= r.end).pop();
  if (t) return { cents: t.priceCents, source: "type" };
  return { cents: unit.priceCents ?? type.priceCents, source: "base" };
}

/** A room's base nightly price (before per-date rates). */
export function unitBaseCents(type: Pick<RoomType, "priceCents">, unit: Pick<RoomUnit, "priceCents">): number {
  return unit.priceCents ?? type.priceCents;
}

/**
 * The price of a stay for a given nightly-price input — the same steps the
 * server charges with in /api/start-checkout (per-night sum incl. per-date
 * rates → non-refundable discount → listing sale discount → + cleaning fee →
 * + tax). Promo codes are applied later, at checkout.
 */
function quote(listing: QuoteListing, pricing: { priceCents: number; priceUnit: string; seasonalRates: { start: string; end: string; priceCents: number }[] }, startDate: string, endDate: string, guests: number): RoomQuote {
  const accommodationCents = computeBookingAmountCents(
    { ...pricing, cancellationPolicy: listing.cancellationPolicy, nonrefundableDiscountPercent: listing.nonrefundableDiscountPercent },
    { startDate, endDate, guests },
  );
  const promo = promoDiscount(accommodationCents, listing, startDate);
  const cleaningCents = accommodationCents > 0 ? listing.cleaningFeeCents ?? 0 : 0;
  const charge = computeBookingCharge(promo.netCents + cleaningCents);
  return {
    nights: nightsBetween(startDate, endDate),
    accommodationCents,
    discountCents: promo.discountCents,
    cleaningCents,
    charge,
    totalCents: charge.totalCents,
    undiscountedTotalCents: computeBookingCharge(accommodationCents + cleaningCents).totalCents,
  };
}

/** Price of a room type with no individual rooms (legacy: the type's flat nightly price). */
export function quoteRoom(listing: QuoteListing, room: Pick<RoomType, "priceCents" | "priceUnit" | "seasonalRates">, startDate: string, endDate: string, guests: number): RoomQuote {
  return quote(listing, { priceCents: room.priceCents, priceUnit: room.priceUnit, seasonalRates: room.seasonalRates ?? [] }, startDate, endDate, guests);
}

/** Price of one specific room for the dates (its per-date rates, own base, or the type's price). */
export function quoteUnit(listing: QuoteListing, type: Pick<RoomType, "priceCents" | "seasonalRates">, unit: Pick<RoomUnit, "priceCents" | "seasonalRates">, startDate: string, endDate: string, guests: number): RoomQuote {
  return quote(listing, unitPricing(type, unit), startDate, endDate, guests);
}

/** Whether a room is free for every night of [start, end): active, not booked, not blocked by the
 *  operator, and not busy on the room's own imported Airbnb/Booking.com calendar. */
export function unitFree(unit: Pick<RoomUnit, "active" | "manualBlockedRanges" | "blockedRanges">, booked: Range[], start: string, end: string): boolean {
  if (!unit.active) return false;
  const clashes = (r: Range) => r.start < end && r.end > start;
  return !booked.some(clashes) && !(unit.manualBlockedRanges ?? []).some(clashes) && !(unit.blockedRanges ?? []).some(clashes);
}

/**
 * The room a guest gets when booking this type for these dates: the cheapest
 * room free for every night (ties → the operator's order). Null when no single
 * room is free for the whole stay. `bookedByUnit` holds each room's bookings.
 */
export function cheapestAvailableUnit(
  listing: QuoteListing,
  type: Pick<RoomType, "priceCents" | "units" | "seasonalRates">,
  bookedByUnit: Map<string, Range[]>,
  startDate: string,
  endDate: string,
  guests: number,
): { unit: RoomUnit; quote: RoomQuote } | null {
  let best: { unit: RoomUnit; quote: RoomQuote } | null = null;
  for (const unit of [...type.units].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!unitFree(unit, bookedByUnit.get(unit.id) ?? [], startDate, endDate)) continue;
    const q = quoteUnit(listing, type, unit, startDate, endDate, guests);
    if (!best || q.totalCents < best.quote.totalCents) best = { unit, quote: q };
  }
  return best;
}

/** Nights when NO room of the type is free (all booked or blocked) — greyed out in the calendar. */
export function typeSoldOutNights(type: Pick<RoomType, "units">, bookedByUnit: Map<string, Range[]>, from: string, days = 400): Range[] {
  const active = type.units.filter((u) => u.active);
  if (active.length === 0) return [];
  const out: Range[] = [];
  for (let i = 0, d = from; i < days; i++, d = addDaysIso(d, 1)) {
    const next = addDaysIso(d, 1);
    if (active.every((u) => !unitFree(u, bookedByUnit.get(u.id) ?? [], d, next))) out.push({ start: d, end: next });
  }
  return out;
}

/** Lowest base nightly price among a type's rooms ("from ֏X"); the type's price when it has none. */
export function typeFromCents(type: Pick<RoomType, "priceCents" | "units">): number {
  const active = type.units.filter((u) => u.active);
  return active.length ? Math.min(...active.map((u) => unitBaseCents(type, u))) : type.priceCents;
}

/** Confirmed bookings for a hotel's rooms: per individual room, and per type (types with no rooms yet). */
export interface RoomAvailability {
  byType: Map<string, Range[]>;
  byUnit: Map<string, Range[]>;
}

/**
 * What a guest gets for this room type and these dates: the assigned room (the
 * cheapest free one) and its price — or, for a type with no individual rooms
 * yet, the type's own price if its count isn't used up. Null = not available.
 */
export function bestRoomFor(
  listing: QuoteListing,
  type: RoomType,
  avail: RoomAvailability,
  startDate: string,
  endDate: string,
  guests: number,
): { unit: RoomUnit | null; quote: RoomQuote } | null {
  if (type.units.length) return cheapestAvailableUnit(listing, type, avail.byUnit, startDate, endDate, guests);
  if (!roomAvailable(avail.byType.get(type.id) ?? [], type.quantity, startDate, endDate)) return null;
  return { unit: null, quote: quoteRoom(listing, type, startDate, endDate, guests) };
}

/** Nights a guest can't pick for this room type (no room free that night). */
export function typeUnavailableNights(type: RoomType, avail: RoomAvailability, from: string): Range[] {
  if (type.units.length) return typeSoldOutNights(type, avail.byUnit, from);
  return soldOutNights(avail.byType.get(type.id) ?? [], type.quantity);
}

/** "Room 101" for a numbered room; a named room ("Garden suite") as is. */
export function roomUnitLabel(name: string): string {
  const n = name.trim();
  return /^\d+[a-z]?$/i.test(n) ? `Room ${n}` : n;
}

/** How many rooms the type can sell (its active rooms, or the legacy count). */
export function typeCapacity(type: Pick<RoomType, "quantity" | "units">): number {
  const active = type.units.filter((u) => u.active).length;
  return active || type.quantity;
}

// ── Several rooms of one type in one checkout ────────────────────────────────

/** Most rooms of one type a guest can book in a single checkout. */
export const MAX_ROOMS_PER_BOOKING = 6;

/**
 * Pick one free room per entry of `guestsPerRoom` — the cheapest distinct rooms
 * of the type free for every night (the same rule as a single booking, applied
 * again for each extra room). Null when there aren't enough free rooms.
 */
export function cheapestAvailableUnits(
  listing: QuoteListing,
  type: Pick<RoomType, "priceCents" | "units" | "seasonalRates">,
  bookedByUnit: Map<string, Range[]>,
  startDate: string,
  endDate: string,
  guestsPerRoom: number[],
): { unit: RoomUnit; quote: RoomQuote; guests: number }[] | null {
  const picked: { unit: RoomUnit; quote: RoomQuote; guests: number }[] = [];
  let remaining = [...type.units];
  for (const guests of guestsPerRoom) {
    const best = cheapestAvailableUnit(listing, { priceCents: type.priceCents, seasonalRates: type.seasonalRates, units: remaining }, bookedByUnit, startDate, endDate, guests);
    if (!best) return null;
    picked.push({ ...best, guests });
    remaining = remaining.filter((u) => u.id !== best.unit.id);
  }
  return picked;
}

/** How many rooms of the type are free for every night (for "Only 2 left"). */
export function freeUnitCount(type: Pick<RoomType, "units">, bookedByUnit: Map<string, Range[]>, startDate: string, endDate: string): number {
  return type.units.filter((u) => unitFree(u, bookedByUnit.get(u.id) ?? [], startDate, endDate)).length;
}

/**
 * Split one promo-code discount across several rooms in proportion to each
 * room's pre-tax base (remainder on the first room), then charge each room on
 * its own (base + tax). The client preview and the server charge both use this,
 * so the total a guest sees is exactly what each room booking stores.
 */
export function splitGroupCharges(bases: number[], promoDiscountCents = 0): BookingCharge[] {
  const sum = bases.reduce((a, b) => a + b, 0);
  const promo = Math.max(0, Math.min(Math.round(promoDiscountCents), sum));
  const alloc = bases.map((b) => (sum > 0 ? Math.floor((promo * b) / sum) : 0));
  if (alloc.length) alloc[0] += promo - alloc.reduce((a, b) => a + b, 0);
  return bases.map((b, i) => computeBookingCharge(Math.max(0, b - alloc[i])));
}

/**
 * Several rooms of this type for these dates — `bestRoomFor` for a group: the
 * cheapest distinct free rooms (or, for a type with no individual rooms yet, its
 * count), each priced for its own guests. Null when there aren't enough rooms.
 */
export function bestRoomsFor(
  listing: QuoteListing,
  type: RoomType,
  avail: RoomAvailability,
  startDate: string,
  endDate: string,
  guestsPerRoom: number[],
): { unit: RoomUnit | null; quote: RoomQuote; guests: number }[] | null {
  if (type.units.length) return cheapestAvailableUnits(listing, type, avail.byUnit, startDate, endDate, guestsPerRoom);
  if (maxNightlyOccupancy(avail.byType.get(type.id) ?? [], startDate, endDate) + guestsPerRoom.length > type.quantity) return null;
  return guestsPerRoom.map((g) => ({ unit: null, guests: g, quote: quoteRoom(listing, type, startDate, endDate, g) }));
}

/** How many rooms of this type a guest could take for these dates. */
export function roomsFreeFor(type: RoomType, avail: RoomAvailability, startDate: string, endDate: string): number {
  if (type.units.length) return freeUnitCount(type, avail.byUnit, startDate, endDate);
  return Math.max(0, type.quantity - maxNightlyOccupancy(avail.byType.get(type.id) ?? [], startDate, endDate));
}

/**
 * Split a party across the fewest rooms of a type: 4 guests in 2-guest rooms →
 * [2, 2]; 5 → [2, 2, 1]. Null when it would take more rooms than one checkout allows.
 */
export function splitGuests(total: number, maxPerRoom: number): number[] | null {
  const max = Math.max(1, maxPerRoom);
  const n = Math.max(1, Math.ceil(total / max));
  if (n > MAX_ROOMS_PER_BOOKING) return null;
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total % n ? 1 : 0));
}

/** Largest party one checkout can take: one room type, several of its rooms (capped). */
export function maxPartySize(types: Pick<RoomType, "maxGuests" | "quantity" | "units">[]): number {
  return Math.max(1, ...types.map((t) => t.maxGuests * Math.min(typeCapacity(t), MAX_ROOMS_PER_BOOKING)));
}
