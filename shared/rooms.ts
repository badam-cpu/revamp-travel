/**
 * Pure helpers for multi-room properties (hotels — migration 0092): room
 * availability and the price of a room for given dates. No I/O, so the client
 * (and tests) can use them anywhere.
 */
import type { Listing, RoomType } from "./listings.js";
import { addDaysIso, computeBookingAmountCents, computeBookingCharge, maxNightlyOccupancy, nightOccupancy, nightsBetween, promoDiscount, type BookingCharge } from "./bookings.js";

type Range = { start: string; end: string };

/** Nights on which every room of this type is booked — greyed out in the calendar. */
export function soldOutNights(ranges: Range[], quantity: number): Range[] {
  const nights = new Set<string>();
  for (const r of ranges) for (let d = r.start; d < r.end; d = addDaysIso(d, 1)) nights.add(d);
  return Array.from(nights)
    .filter((d) => nightOccupancy(ranges, d) >= quantity)
    .sort()
    .map((d) => ({ start: d, end: addDaysIso(d, 1) }));
}

/** Whether at least one room of this type is free every night of [start, end). */
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
 * The price of a room for given dates — the same steps the server charges with
 * in /api/start-checkout (room nightly rate → listing sale discount → + cleaning
 * fee → + tax). Promo codes are applied later, at checkout.
 */
export function quoteRoom(
  listing: Pick<Listing, "cancellationPolicy" | "nonrefundableDiscountPercent" | "cleaningFeeCents" | "discountType" | "discountValue" | "discountStart" | "discountEnd">,
  room: Pick<RoomType, "priceCents" | "priceUnit">,
  startDate: string,
  endDate: string,
  guests: number,
): RoomQuote {
  const accommodationCents = computeBookingAmountCents(
    {
      priceCents: room.priceCents,
      priceUnit: room.priceUnit,
      cancellationPolicy: listing.cancellationPolicy,
      nonrefundableDiscountPercent: listing.nonrefundableDiscountPercent,
      seasonalRates: [],
    },
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
