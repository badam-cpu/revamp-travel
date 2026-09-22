/**
 * Thin fetch wrapper around the two remaining server routes — the AI trip
 * planner and the dashboard's link-import prefill assist
 * (server/routes.ts). Listings CRUD used to live here too; it's gone now
 * that listings read/write straight from Supabase under Row-Level Security
 * (see client/src/contexts/ListingsContext.tsx).
 */
import { supabase } from "@/lib/supabase";

export class ApiError extends Error {}

/** Friendly fallback message by HTTP status, when the server didn't send its own. */
function friendlyError(status: number): string {
  if (status === 429) return "You're going a bit fast — give it a few seconds and try again.";
  if (status === 408 || status === 502 || status === 503 || status === 504) return "That took longer than usual. Please try again in a moment.";
  if (status === 401 || status === 403) return "Please sign in and try again.";
  if (status >= 500) return "Something went wrong on our end. Please try again in a moment.";
  return "Something went wrong. Please try again.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch {
    // Network/offline/aborted — never surface the raw error to a traveler.
    throw new ApiError("We couldn't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Prefer the server's own friendly message; otherwise a human-readable
    // fallback by status — never "Request failed (504)".
    throw new ApiError(body?.error || friendlyError(res.status));
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
export async function startCheckout(
  params: StartCheckoutParams & { guestName?: string; guestEmail?: string; guestPhone?: string; addons?: { id: string; qty: number }[]; giftCode?: string },
): Promise<{ redirectUrl?: string; confirmed?: boolean; fullyCovered?: boolean; bookingId?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to book.");
  return request<{ redirectUrl?: string; confirmed?: boolean; fullyCovered?: boolean; bookingId?: string }>("/api/start-checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
}

/** Look up a gift-card code's remaining balance (for the checkout redemption preview). */
export async function lookupGiftCard(code: string): Promise<{ balanceCents: number; currency: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in.");
  return request<{ balanceCents: number; currency: string }>("/api/gift-card/lookup", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
}

/** Buy a gift card — returns a PayLink redirect URL. */
export async function buyGiftCard(params: { amountCents: number; recipientName: string; recipientEmail: string; message?: string; acceptTerms: true }): Promise<{ redirectUrl: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to buy a gift card.");
  return request<{ redirectUrl: string }>("/api/gift-card/start-checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
}

/** Activate the buyer's paid gift card(s) on their return from PayLink. */
export async function confirmGiftPurchase(): Promise<{ activated: number }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in.");
  return request<{ activated: number }>("/api/gift-card/confirm", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
}

/**
 * Asks the server to poll PayLink for the signed-in user's pending bookings and
 * confirm any that were paid. Idempotent and safe to call on every account
 * load and on the post-payment return. Returns how many were just confirmed and
 * whether any are still awaiting payment.
 */
export async function confirmCheckout(): Promise<{ confirmed: number; pending: boolean; amountCents?: number; currency?: string; bookingIds?: string[] }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to confirm your booking.");
  return request<{ confirmed: number; pending: boolean; amountCents?: number; currency?: string; bookingIds?: string[] }>("/api/confirm-checkout", {
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

export interface DirectBookingInput {
  listingId: string;
  startDate: string;
  endDate: string;
  guests: number;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  /** Pre-tax amount in AMD cents (rate×nights + cleaning, or the tour total). */
  baseCents: number;
  paymentStatus: "paid" | "unpaid";
}

/** Operator records an offline/direct booking that blocks the dates. */
export async function createDirectBooking(input: DirectBookingInput): Promise<{ id: string; totalCents: number }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in as an operator.");
  return request<{ id: string; totalCents: number }>("/api/operator-direct-booking", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

/** Operator flips a direct booking's payment status (paid/unpaid). */
export async function setBookingPayment(bookingId: string, paymentStatus: "paid" | "unpaid"): Promise<{ ok: boolean }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in as an operator.");
  return request<{ ok: boolean }>("/api/operator-booking-payment", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingId, paymentStatus }),
  });
}

/**
 * Sends a traveler's message to Revamp support. The server stores it, has the
 * AI answer first (routing to a human when needed), and returns the reply.
 */
export async function sendSupportMessage(message: string): Promise<{ reply: string; needsHuman: boolean }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to chat with support.");
  return request<{ reply: string; needsHuman: boolean }>("/api/support-chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
}

/**
 * Unified inbox — open (or fetch) the conversation for a booking. The server
 * derives the operator from the listing and seeds both participants; idempotent.
 */
export async function ensureBookingThread(bookingId: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to send a message.");
  const res = await request<{ conversationId: string }>("/api/message-thread", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingId }),
  });
  return res.conversationId;
}

/** Unified inbox — send a message into a conversation (guardrail-scanned server-side). */
export async function sendInboxMessage(conversationId: string, body: string): Promise<{ id: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to send a message.");
  const res = await request<{ message: { id: string } }>("/api/message-send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversationId, body }),
  });
  return res.message;
}

/** Admin moderation for the unified inbox: redact a message, or close/reopen a thread. */
export async function moderateInbox(input: { action: "redact" | "close" | "reopen"; messageId?: string; conversationId?: string }): Promise<{ ok: boolean }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in.");
  return request<{ ok: boolean }>("/api/admin-moderate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

/** Admin-only: promote a traveler to operator (or demote back). */
export async function adminSetRole(userId: string, role: "traveler" | "operator"): Promise<{ ok: boolean }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in.");
  return request<{ ok: boolean }>("/api/admin-set-role", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId, role }),
  });
}

/** A guest optionally leaves an email/name so Revamp can follow up after they leave. */
export async function submitSupportContact(email: string, name?: string): Promise<{ ok: boolean }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Start a chat first.");
  return request<{ ok: boolean }>("/api/support-contact", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, name }),
  });
}

export interface IcalSyncResult {
  count: number;
  syncedAt: string;
  /** Number of feeds synced (multi-feed stays); undefined for single-feed. */
  feeds?: number;
  /** Per-feed errors (a bad feed doesn't fail the whole sync). */
  errors?: string[];
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

export interface OperatorChatTurn {
  role: "user" | "assistant";
  body: string;
}

/**
 * Ask the operator assistant a data-only question about the signed-in
 * operator's own bookings and payouts. Sends the recent turns; the server
 * fetches the operator's data (RLS-scoped), summarizes it, and the AI answers.
 */
export async function askOperatorAssistant(messages: OperatorChatTurn[]): Promise<{ reply: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in to use the assistant.");
  return request<{ reply: string }>("/api/operator-assistant", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  });
}
