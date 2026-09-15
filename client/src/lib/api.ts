/**
 * Thin fetch wrapper around the two remaining server routes — the AI trip
 * planner and the dashboard's link-import prefill assist
 * (server/routes.ts). Listings CRUD used to live here too; it's gone now
 * that listings read/write straight from Supabase under Row-Level Security
 * (see client/src/contexts/ListingsContext.tsx).
 */
import { supabase } from "@/lib/supabase";

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status}).`);
  }
  return body as T;
}

export interface PlanTripParams {
  days: number;
  startCity: string;
  travelers: number;
  pace: "relaxed" | "balanced" | "packed";
  budget: "budget" | "mid-range" | "comfort";
  interests: string[];
}

export interface ItineraryDay {
  day: number;
  title: string;
  morning: string;
  afternoon: string;
  evening: string;
  tip?: string;
}

export interface Itinerary {
  tripTitle: string;
  summary: string;
  days: ItineraryDay[];
  estimatedBudget: string;
  packingTip: string;
}

export function planTrip(params: PlanTripParams): Promise<Itinerary> {
  return request<{ itinerary: Itinerary }>("/api/plan-trip", {
    method: "POST",
    body: JSON.stringify(params),
  }).then((d) => d.itinerary);
}

export interface ListingPrefill {
  title?: string;
  description?: string;
  imageUrl?: string;
  amenities?: string[];
  city?: string;
  region?: string;
  price?: number;
  sourceUrl: string;
}

/**
 * Asks the server to pull a starting draft (title/description/hero image,
 * plus amenities/price/city/region when the source page's own JSON-LD
 * structured data has them) from a listing link's own public OpenGraph/meta
 * tags and schema.org markup — a best-effort assist, not a scraper (see
 * server/urlPrefill.ts). Every field is just a starting point: nothing here
 * is saved until the operator reviews the form and hits save. Requires a
 * signed-in session: the server checks the bearer token before fetching
 * anything, since this endpoint fetches an arbitrary caller-supplied URL.
 */
export async function importListingPrefill(url: string): Promise<ListingPrefill> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to use the link-import assist.");
  return request<ListingPrefill>("/api/import-listing", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url }),
  });
}

export interface StartCheckoutParams {
  listingId: string;
  startDate: string;
  endDate: string;
  guests: number;
}

/**
 * Begins a PayLink checkout for a booking. Returns the hosted-payment redirect
 * URL to send the browser to; the server has already created a pending booking
 * and computed the amount itself (the client never sends a price). Confirmation
 * happens server-side after the traveler returns — see confirmCheckout.
 */
export async function startCheckout(params: StartCheckoutParams): Promise<{ redirectUrl: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to book.");
  return request<{ redirectUrl: string }>("/api/start-checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
}

/**
 * Asks the server to poll PayLink for the signed-in user's pending bookings and
 * confirm any that were paid. Idempotent and safe to call on every account
 * load and on the post-payment return. Returns how many were just confirmed and
 * whether any are still awaiting payment.
 */
export async function confirmCheckout(): Promise<{ confirmed: number; pending: boolean }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to confirm your booking.");
  return request<{ confirmed: number; pending: boolean }>("/api/confirm-checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
}

/**
 * Cancels a booking (traveler who booked it, the listing's operator, or an
 * admin). Frees the dates. Returns whether a manual refund is owed (a paid,
 * confirmed booking — PayLink has no refund API, so it's processed by hand).
 */
export async function cancelBooking(bookingId: string): Promise<{ cancelled: boolean; refundOwed: boolean; refundCents: number }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to cancel a booking.");
  return request<{ cancelled: boolean; refundOwed: boolean; refundCents: number }>("/api/cancel-booking", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingId }),
  });
}

export interface IcalSyncResult {
  count: number;
  syncedAt: string;
}

/**
 * Refreshes a listing's availability from its saved Airbnb (or other) calendar
 * export URL. The server fetches + parses the .ics under the operator's own RLS
 * and caches the busy ranges; this returns how many ranges were found.
 */
export async function syncIcal(listingId: string): Promise<IcalSyncResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to sync a calendar.");
  return request<IcalSyncResult>("/api/sync-ical", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ listingId }),
  });
}
