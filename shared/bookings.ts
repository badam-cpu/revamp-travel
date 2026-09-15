/**
 * Booking model shared by the client and the Express server — the traveler-
 * facing half of the account flow's Phase 2 (PayLink checkout). Mirrors the
 * proven rankr payments pattern (hosted redirect, poll-not-webhook, server-
 * computed amount, server-verified grant) but the "grant" here is a dated
 * reservation that blocks a listing's availability, not a user entitlement.
 *
 * The amount is ALWAYS computed server-side from the listing (see
 * computeBookingAmountCents) — the client sends only listingId + dates +
 * guests, never a price, so it can't be tampered with. This module is the one
 * place that rule lives, imported by both `server/routes.ts` (to charge) and
 * the client (to preview the same figure).
 */
import type { Listing, ListingType } from "./listings.js";

/**
 * Booking lifecycle. Only `confirmed` blocks availability; `pending_payment`
 * is a soft hold during checkout; the rest are terminal/non-blocking. Kept in
 * sync with the `booking_status` enum in
 * supabase/migrations/0010_bookings.sql.
 */
export type BookingStatus =
  | "pending_payment" // created, awaiting PayLink approval (soft hold)
  | "confirmed" // PayLink approved server-side — blocks the dates
  | "payment_failed" // PayLink reported a terminal failure
  | "cancelled" // cancelled before the trip
  | "refunded" // refunded after confirmation
  | "expired" // pending hold that was never paid (TTL swept)
  | "completed"; // trip dates have passed

export interface Booking {
  id: string;
  listingId: string;
  travelerId: string;
  /** Inclusive check-in / activity date, YYYY-MM-DD. */
  startDate: string;
  /** Exclusive check-out date, YYYY-MM-DD (start + 1 for a single-day activity). */
  endDate: string;
  guests: number;
  amountCents: number;
  currency: string;
  status: BookingStatus;
  paylinkRequestId: string | null;
  paylinkOrderId: string | null;
  paidAt: string | null;
  createdAt: string;
}

/** What the client sends to POST /api/start-checkout. */
export interface StartCheckoutParams {
  listingId: string;
  startDate: string;
  endDate: string;
  guests: number;
}

/**
 * Fallback booking currency when PAYLINK_CURRENCY isn't set. Listings are priced
 * in USD, so the fallback is USD too — the server charges `amount_cents / 100` in
 * this currency, and BookingPanel previews it, so they must agree. Set
 * PAYLINK_CURRENCY=USD in the environment; this is only the safety net.
 */
export const DEFAULT_CURRENCY = "USD";

// How a listing's unit price scales into a total. Grouped by the `priceUnit`
// strings the seed data and the experience wizard actually produce.
const PER_NIGHT_UNITS = new Set(["night", "nights", "day", "days"]);
const PER_PERSON_UNITS = new Set(["person", "guest", "ticket", "seat", "pax"]);
// Everything else (group, session, class, visit, couple, menu, average, …) is a
// flat price for the whole booking.

/** Whole nights between two YYYY-MM-DD dates (end exclusive); minimum 1. */
export function nightsBetween(startDate: string, endDate: string): number {
  const start = Date.parse(startDate + "T00:00:00Z");
  const end = Date.parse(endDate + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

/**
 * The single source of truth for what a booking costs. Server charges this;
 * client previews it. `priceCents` is the listing's stored unit price.
 *   • per-night units  → unit × nights (a whole stay; guests don't multiply)
 *   • per-person units → unit × guests (a single-session activity)
 *   • anything else    → flat unit price
 */
export function computeBookingAmountCents(
  listing: { priceCents: number; priceUnit: string },
  params: { startDate: string; endDate: string; guests: number },
): number {
  const unit = (listing.priceUnit || "").toLowerCase().trim();
  const base = Math.max(0, Math.round(listing.priceCents));
  if (PER_NIGHT_UNITS.has(unit)) return base * nightsBetween(params.startDate, params.endDate);
  if (PER_PERSON_UNITS.has(unit)) return base * Math.max(1, params.guests);
  return base;
}

/** Whether a listing type can be booked at all (restaurants never can). */
export function isBookableType(type: ListingType): boolean {
  return type === "stay" || type === "tour" || type === "experience";
}

/** Human summary of how the amount was derived, for the checkout preview. */
export function describeBookingBasis(
  listing: Pick<Listing, "priceUnit" | "priceLabel">,
  params: { startDate: string; endDate: string; guests: number },
): string {
  const unit = (listing.priceUnit || "").toLowerCase().trim();
  if (PER_NIGHT_UNITS.has(unit)) {
    const n = nightsBetween(params.startDate, params.endDate);
    return `${listing.priceLabel} × ${n} night${n === 1 ? "" : "s"}`;
  }
  if (PER_PERSON_UNITS.has(unit)) {
    const g = Math.max(1, params.guests);
    return `${listing.priceLabel} × ${g} guest${g === 1 ? "" : "s"}`;
  }
  return `${listing.priceLabel} total`;
}
