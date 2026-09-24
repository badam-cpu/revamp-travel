/**
 * Channel Manager — availability engine. Revamp is the source of truth for a
 * listing's availability; this computes the per-day open/closed + nightly price
 * to push OUT to OTAs via a connectivity provider. Vendor-agnostic (no ETG /
 * aggregator specifics here).
 *
 * A day is CLOSED if it's covered by a confirmed/held booking, an iCal-synced
 * blocked range (inclusive end), or an operator manual block (exclusive end) —
 * the same rules the booking calendar and Explore date filter already use.
 * Price = the matching seasonal rate (inclusive range, last match wins) else the
 * listing's base nightly price. All money in AMD cents.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AvailabilityDay {
  date: string; // YYYY-MM-DD
  available: boolean;
  priceCents: number;
}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDaysIso = (s: string, n: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY_MS));
/** Half-open overlap: [aStart,aEnd) intersects [bStart,bEnd). */
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && aEnd > bStart;

interface SeasonalRate { start: string; end: string; priceCents: number }
interface Range { start: string; end: string }

/**
 * Compute availability + price for a listing over the next `days` nights.
 * Service-role client required (reads all bookings/blocks for the listing).
 */
export async function computeListingAvailability(
  admin: SupabaseClient,
  listingId: string,
  days = 365,
): Promise<AvailabilityDay[]> {
  const { data: listing } = await admin
    .from("listings")
    .select("price_cents, seasonal_rates, blocked_ranges, manual_blocked_ranges")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return [];

  const baseCents = Number(listing.price_cents) || 0;
  const seasonal = (Array.isArray(listing.seasonal_rates) ? listing.seasonal_rates : []) as SeasonalRate[];
  const ical = (Array.isArray(listing.blocked_ranges) ? listing.blocked_ranges : []) as Range[];
  const manual = (Array.isArray(listing.manual_blocked_ranges) ? listing.manual_blocked_ranges : []) as Range[];

  // Confirmed / held bookings block their nights.
  const { data: bookings } = await admin
    .from("bookings")
    .select("start_date, end_date, status")
    .eq("listing_id", listingId)
    .in("status", ["confirmed", "pending_payment"]);

  // Normalise every blocking source to half-open [start, end) ranges.
  const blocks: Range[] = [
    ...ical.map((b) => ({ start: b.start, end: addDaysIso(b.end, 1) })), // iCal end is inclusive
    ...manual.map((b) => ({ start: b.start, end: b.end })), // manual end exclusive
    ...((bookings ?? []) as { start_date: string; end_date: string }[]).map((b) => ({ start: b.start_date, end: b.end_date })),
  ].filter((r) => r.start && r.end);

  const priceOn = (d: string): number => {
    const m = seasonal.filter((r) => r.start <= d && d <= r.end).pop();
    return m ? m.priceCents : baseCents;
  };

  const today = iso(new Date());
  const out: AvailabilityDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(today, i);
    const nightEnd = addDaysIso(date, 1);
    const available = !blocks.some((b) => overlaps(date, nightEnd, b.start, b.end));
    out.push({ date, available, priceCents: priceOn(date) });
  }
  return out;
}
