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
 *   • Tax: added ON TOP of the base and paid by the guest; Revamp remits it
 *     (pass-through, not revenue), computed on the full base amount.
 * The base = accommodation (rate × nights/guests, discount-applied) + the
 * operator's flat cleaning fee. Guest charge = base + tax. Operator payout =
 * base − commission (so the operator keeps the cleaning fee, less commission).
 */
export const PLATFORM_COMMISSION_PERCENT = 12.5;
export const TAX_PERCENT = 10;

export interface BookingCharge {
  baseCents: number; // pre-tax booking amount = accommodation + cleaning fee (after any discount)
  taxCents: number; // tax added on top, guest-paid, Revamp remits
  totalCents: number; // what the guest is actually charged (base + tax)
  commissionCents: number; // Revamp's cut of the base
  operatorNetCents: number; // what the operator is paid (base − commission)
}

/**
 * Full money breakdown for a base booking amount (accommodation + cleaning).
 * `commissionPercent` defaults to the standard rate; pass an operator's resolved
 * rate (from their subscription plan) to vary the payout split — see
 * server/subscriptions.ts `resolveOperatorCommissionPercent`. Only the payout
 * split (commission/net) depends on it; the guest charge (base + tax) does not.
 */
export function computeBookingCharge(baseCents: number, commissionPercent: number = PLATFORM_COMMISSION_PERCENT): BookingCharge {
  const base = Math.max(0, Math.round(baseCents));
  const pct = Number.isFinite(commissionPercent) ? Math.min(100, Math.max(0, commissionPercent)) : PLATFORM_COMMISSION_PERCENT;
  const taxCents = Math.round((base * TAX_PERCENT) / 100);
  const commissionCents = Math.round((base * pct) / 100);
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
 * Fallback booking currency when PAYLINK_CURRENCY isn't set. The marketplace is
 * AMD-primary — listings are priced, and all accounting (commission, tax,
 * payouts) is done, in Armenian dram; PayLink charges AMD. The server charges
 * `amount_cents / 100` in this currency and BookingPanel previews it, so they
 * must agree. USD is a display-only reference (see CurrencyContext). All
 * `*_cents` money columns are hundredths of the currency unit, so for AMD they
 * hold drams × 100 (AMD has no minor unit; the /100 convention is kept so the
 * shared money math is currency-agnostic). Set PAYLINK_CURRENCY=AMD in the
 * environment; this is only the safety net.
 */
export const DEFAULT_CURRENCY = "AMD";

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
  listing: {
    priceCents: number;
    priceUnit: string;
    cancellationPolicy?: CancellationPolicy;
    nonrefundableDiscountPercent?: number;
    seasonalRates?: { start: string; end: string; priceCents: number }[];
  },
  params: { startDate: string; endDate: string; guests: number },
): number {
  const unit = (listing.priceUnit || "").toLowerCase().trim();
  const base = Math.max(0, Math.round(listing.priceCents));
  let total: number;
  if (PER_NIGHT_UNITS.has(unit)) {
    // Sum each night at its per-date rate: a matching seasonal/date-range rate
    // if the operator set one (last match wins), otherwise the base nightly price.
    const rates = listing.seasonalRates ?? [];
    let sum = 0;
    for (let d = params.startDate; d < params.endDate; d = addDaysIso(d, 1)) {
      const match = rates.filter((r) => r.start <= d && d <= r.end).pop();
      sum += Math.max(0, Math.round(match ? match.priceCents : base));
    }
    total = sum;
  } else if (PER_PERSON_UNITS.has(unit)) {
    // Per-person activity: the date's rate (a per-date override if the operator
    // set one for the activity date, else the base) × guests.
    const rates = listing.seasonalRates ?? [];
    const match = rates.filter((r) => r.start <= params.startDate && params.startDate <= r.end).pop();
    const unitPrice = Math.max(0, Math.round(match ? match.priceCents : base));
    total = unitPrice * Math.max(1, params.guests);
  } else total = base;
  // Non-refundable rate is offered at a discount as the incentive.
  if (listing.cancellationPolicy === "non_refundable") {
    const pct = Math.min(90, Math.max(0, Math.round(listing.nonrefundableDiscountPercent ?? 0)));
    total = Math.round(total * (1 - pct / 100));
  }
  return total;
}

/**
 * A representative "per night" price for headline display (cards + detail
 * header) when a stay uses seasonal/daily rates. Day-weighted average across a
 * window (default: the next 365 days) — each day counts at its matching
 * seasonal rate, or the base price for days outside every range. Falls back to
 * the base price for non-per-night units or when no seasonal rates are set, so
 * it's always safe to call. Returns AMD cents.
 */
export function averageNightlyCents(
  listing: { priceCents: number; priceUnit: string; seasonalRates?: { start: string; end: string; priceCents: number }[] },
  opts?: { from?: string; days?: number },
): number {
  const unit = (listing.priceUnit || "").toLowerCase().trim();
  const base = Math.max(0, Math.round(listing.priceCents));
  const rates = listing.seasonalRates ?? [];
  if (!PER_NIGHT_UNITS.has(unit) || rates.length === 0) return base;
  const days = Math.max(1, opts?.days ?? 365);
  let d = opts?.from ?? new Date().toISOString().slice(0, 10);
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const match = rates.filter((r) => r.start <= d && d <= r.end).pop();
    sum += Math.max(0, Math.round(match ? match.priceCents : base));
    d = addDaysIso(d, 1);
  }
  return Math.round(sum / days);
}

/** A Revamp concierge add-on (admin-managed catalog, see migration 0029). */
export interface Addon {
  id: string;
  name: string;
  description?: string;
  image?: string; // thumbnail shown in the booking box
  priceCents: number; // AMD cents
  unit: "flat" | "per_night" | "per_guest" | "per_item";
  onRequest?: boolean; // true = shown/recorded but not charged (variable price)
  enabled?: boolean;
}

/** Cost of ONE unit of an add-on for a booking (qty multiplies at the call
 * site for per_item). onRequest add-ons cost 0 (billed/handled separately). */
export function addonUnitCost(a: Addon, ctx: { nights: number; guests: number }): number {
  if (a.onRequest) return 0;
  const p = Math.max(0, Math.round(a.priceCents));
  if (a.unit === "per_night") return p * Math.max(1, ctx.nights);
  if (a.unit === "per_guest") return p * Math.max(1, ctx.guests);
  return p; // flat or per_item
}

/** The promotional-discount shape carried on a listing (see shared/listings.ts). */
export interface ListingDiscount {
  discountType?: "percent" | "amount" | null;
  discountValue?: number;
  discountStart?: string;
  discountEnd?: string;
}

/**
 * The promo discount for a booking: applies when the listing has a discount and
 * the booking's check-in date falls within [discountStart, discountEnd]. Returns
 * the amount off (cents) and the discounted accommodation. Single source of truth
 * — server charge and client preview both call it, so they can't diverge.
 */
export function promoDiscount(accommodationCents: number, listing: ListingDiscount, startDate: string): { active: boolean; discountCents: number; netCents: number } {
  const { discountType, discountValue, discountStart, discountEnd } = listing;
  const base = Math.max(0, Math.round(accommodationCents));
  if (!discountType || !discountValue || discountValue <= 0 || !discountStart || !discountEnd || startDate < discountStart || startDate > discountEnd) {
    return { active: false, discountCents: 0, netCents: base };
  }
  const off =
    discountType === "percent"
      ? Math.floor((base * Math.min(90, Math.max(0, discountValue))) / 100)
      : Math.min(base, Math.max(0, Math.round(discountValue)));
  return { active: off > 0, discountCents: off, netCents: Math.max(0, base - off) };
}

/** Whether a discount is worth showing a badge for (configured and not fully past). */
export function isDiscountLive(listing: ListingDiscount, todayIso: string): boolean {
  return !!(listing.discountType && listing.discountValue && listing.discountValue > 0 && listing.discountEnd && listing.discountEnd >= todayIso);
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

/**
 * Human summary of how the amount was derived, for the checkout preview.
 * `unitLabel` overrides the shown per-unit price — pass the display-currency
 * formatted price so the line matches the currency toggle (defaults to the
 * listing's stored AMD priceLabel).
 */
export function describeBookingBasis(
  listing: Pick<Listing, "priceUnit" | "priceLabel">,
  params: { startDate: string; endDate: string; guests: number },
  unitLabel: string = listing.priceLabel,
): string {
  const unit = (listing.priceUnit || "").toLowerCase().trim();
  if (PER_NIGHT_UNITS.has(unit)) {
    const n = nightsBetween(params.startDate, params.endDate);
    return `${unitLabel} × ${n} night${n === 1 ? "" : "s"}`;
  }
  if (PER_PERSON_UNITS.has(unit)) {
    const g = Math.max(1, params.guests);
    return `${unitLabel} × ${g} guest${g === 1 ? "" : "s"}`;
  }
  return `${unitLabel} total`;
}
