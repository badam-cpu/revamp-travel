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
import type { Listing, ListingType, CancellationPolicy } from "./listings.js";

/** Defaults when a listing hasn't set them explicitly. */
export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = "flexible";
export const DEFAULT_FREE_CANCEL_DAYS = 7;
export const DEFAULT_NONREFUNDABLE_DISCOUNT = 5;

/**
 * Marketplace economics (single source of truth for client preview + server
 * charge, so they always agree — change here, not in env).
 *   • Commission: Revamp's cut, % of the base booking amount (Revamp revenue).
 *   • Turnover tax: added ON TOP of the base and paid by the guest; Revamp
 *     remits it (pass-through, not revenue), computed on the full base amount.
 * Guest charge = base + tax. Operator payout = base − commission.
 */
export const PLATFORM_COMMISSION_PERCENT = 12.5;
export const TURNOVER_TAX_PERCENT = 10;

export interface BookingCharge {
  baseCents: number; // pre-tax booking amount (after any non-refundable discount)
  taxCents: number; // turnover tax added on top, guest-paid, Revamp remits
  totalCents: number; // what the guest is actually charged (base + tax)
  commissionCents: number; // Revamp's cut of the base
  operatorNetCents: number; // what the operator is paid (base − commission)
}

/** Full money breakdown for a base booking amount. */
export function computeBookingCharge(baseCents: number): BookingCharge {
  const base = Math.max(0, Math.round(baseCents));
  const taxCents = Math.round((base * TURNOVER_TAX_PERCENT) / 100);
  const commissionCents = Math.round((base * PLATFORM_COMMISSION_PERCENT) / 100);
  return {
    baseCents: base,
    taxCents,
    totalCents: base + taxCents,
    commissionCents,
    operatorNetCents: Math.max(0, base - commissionCents),
  };
}

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

/** Shift a YYYY-MM-DD date by whole days (may be negative), returning YYYY-MM-DD. */
export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The single source of truth for what a booking costs. Server charges this;
 * client previews it. `priceCents` is the listing's stored unit price.
 *   • per-night units  → unit × nights (a whole stay; guests don't multiply)
 *   • per-person units → unit × guests (a single-session activity)
 *   • anything else    → flat unit price
 */
export function computeBookingAmountCents(
  listing: { priceCents: number; priceUnit: string; cancellationPolicy?: CancellationPolicy; nonrefundableDiscountPercent?: number },
  params: { startDate: string; endDate: string; guests: number },
): number {
  const unit = (listing.priceUnit || "").toLowerCase().trim();
  const base = Math.max(0, Math.round(listing.priceCents));
  let total: number;
  if (PER_NIGHT_UNITS.has(unit)) total = base * nightsBetween(params.startDate, params.endDate);
  else if (PER_PERSON_UNITS.has(unit)) total = base * Math.max(1, params.guests);
  else total = base;
  // Non-refundable rate is offered at a discount as the incentive.
  if (listing.cancellationPolicy === "non_refundable") {
    const pct = Math.min(90, Math.max(0, Math.round(listing.nonrefundableDiscountPercent ?? 0)));
    total = Math.round(total * (1 - pct / 100));
  }
  return total;
}

/**
 * How much of a booking is refundable if cancelled now. Refunds are computed
 * from the policy SNAPSHOT stored on the booking (so a later listing change
 * can't alter a traveler's terms). PayLink has no refund API, so this is the
 * amount the operator issues by hand — 0 means nothing is owed.
 *   • unpaid (never confirmed) → 0 (no money was captured)
 *   • non_refundable          → 0
 *   • flexible                → full amount before the cutoff (freeCancelDays
 *                               before check-in, inclusive), 0 after
 */
export function computeRefundCents(
  booking: {
    status: string;
    paidAt?: string | null;
    amountCents: number;
    startDate: string;
    cancellationPolicy?: CancellationPolicy | null;
    freeCancelDays?: number | null;
  },
  nowIso: string,
): number {
  const paid = booking.status === "confirmed" || !!booking.paidAt;
  if (!paid) return 0;
  const policy = booking.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY;
  if (policy === "non_refundable") return 0;
  const days = booking.freeCancelDays ?? DEFAULT_FREE_CANCEL_DAYS;
  const cutoff = addDaysIso(booking.startDate, -days);
  const today = nowIso.slice(0, 10);
  return today <= cutoff ? booking.amountCents : 0;
}

/** One-line policy description for the UI. */
export function describeCancellationPolicy(
  policy: CancellationPolicy | undefined | null,
  opts: { freeCancelDays?: number; startDate?: string; discountPercent?: number } = {},
): string {
  const p = policy ?? DEFAULT_CANCELLATION_POLICY;
  if (p === "non_refundable") {
    const d = opts.discountPercent ?? 0;
    return d > 0 ? `Non-refundable · ${d}% off` : "Non-refundable";
  }
  const days = opts.freeCancelDays ?? DEFAULT_FREE_CANCEL_DAYS;
  if (opts.startDate) {
    const cutoff = addDaysIso(opts.startDate, -days);
    const [y, m, d] = cutoff.split("-").map(Number);
    const pretty = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `Free cancellation until ${pretty}`;
  }
  return `Free cancellation until ${days} day${days === 1 ? "" : "s"} before check-in`;
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
