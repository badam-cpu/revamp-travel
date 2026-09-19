/**
 * Confirm + reconcile PayLink payments for bookings, and grant the booking.
 * The revamp analog of rankr's payments.mjs: it sits between server/paylink.ts
 * (the provider API) and the DB, so "verify server-side, then confirm" lives
 * in exactly one place — used by POST /api/confirm-checkout (on the traveler's
 * return and on account load) and by the daily reconcile cron.
 *
 * The "grant" here is flipping a booking `pending_payment → confirmed`, which
 * (via the confirmed-only exclusion constraint in 0010) blocks the dates.
 * Writes go through the service-role client (server/supabaseAdmin.ts) because
 * this transition cannot be authorized by RLS. Idempotent: the flip is guarded
 * `where status = 'pending_payment'`, so a double poll never double-confirms.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPayment } from "./paylink.js";
import { sendTravelerConfirmation, sendOperatorNewBooking, sendReviewRequest, type BookingEmailInfo } from "./email.js";
import { payoutDueDate } from "../shared/payouts.js";
import { computeBookingCharge } from "../shared/bookings.js";
import type { ListingType } from "../shared/listings.js";

export interface BookingRow {
  id: string;
  listing_id: string;
  traveler_id: string;
  status: string;
  start_date: string;
  end_date: string;
  guests: number;
  amount_cents: number;
  base_cents: number | null;
  currency: string;
  paylink_request_id: string | null;
  paylink_order_id: string | null;
  created_at: string;
  guest_name: string | null;
  guest_email: string | null;
  addons: { name: string; amountCents: number; qty: number; onRequest?: boolean }[] | null;
}

// Columns every confirm/reconcile query needs (row detail for the emails too).
const BOOKING_COLS = "id, listing_id, traveler_id, status, start_date, end_date, guests, amount_cents, base_cents, currency, paylink_request_id, paylink_order_id, created_at, guest_name, guest_email, addons";

/**
 * Fire booking-confirmed emails (traveler + operator). Best-effort: any failure
 * is logged and swallowed so it never affects the confirmation itself. Needs
 * the service-role client to read auth.users emails via the admin API.
 */
async function onBookingConfirmed(admin: SupabaseClient, row: BookingRow): Promise<void> {
  const { data: listing } = await admin
    .from("listings")
    .select("title, type, city, region, slug, operator_id")
    .eq("id", row.listing_id)
    .maybeSingle();
  if (!listing) return;

  // Create the operator payout (idempotent — one per booking). Revamp is
  // merchant of record; the payout is on the pre-tax BASE (tax is a pass-through
  // Revamp remits, never the operator's money), net of the platform commission.
  const base = row.base_cents ?? row.amount_cents;
  const { commissionCents, operatorNetCents } = computeBookingCharge(base);
  await admin.from("payouts").upsert(
    {
      booking_id: row.id,
      operator_id: listing.operator_id,
      listing_id: row.listing_id,
      listing_title: listing.title,
      listing_type: listing.type,
      gross_cents: base,
      fee_cents: commissionCents,
      net_cents: operatorNetCents,
      currency: row.currency,
      due_date: payoutDueDate(listing.type as ListingType, row.start_date),
      status: "pending",
    },
    { onConflict: "booking_id", ignoreDuplicates: true },
  );

  // Notify both sides (best-effort).
  const info: BookingEmailInfo = {
    listingTitle: listing.title,
    startDate: row.start_date,
    endDate: row.end_date,
    guests: row.guests,
    amountCents: row.amount_cents,
    currency: row.currency,
    city: listing.city,
    region: listing.region,
    slug: listing.slug,
    addons: row.addons ?? [],
  };
  const [{ data: traveler }, { data: operator }, { data: travelerProfile }] = await Promise.all([
    admin.auth.admin.getUserById(row.traveler_id),
    admin.auth.admin.getUserById(listing.operator_id),
    admin.from("profiles").select("display_name").eq("id", row.traveler_id).maybeSingle(),
  ]);
  // Guests book anonymously (no auth email) — fall back to the email/name they
  // gave at checkout so they still get a confirmation.
  const travelerEmail = traveler?.user?.email || row.guest_email || "";
  const travelerName = travelerProfile?.display_name && travelerProfile.display_name !== "Guest" ? travelerProfile.display_name : row.guest_name || "A traveler";
  const tasks: Promise<unknown>[] = [];
  if (travelerEmail) tasks.push(sendTravelerConfirmation(travelerEmail, info));
  if (operator?.user?.email) tasks.push(sendOperatorNewBooking(operator.user.email, info, travelerName));
  await Promise.allSettled(tasks);
}

export interface ConfirmResult {
  granted: boolean;
  status: string;
  already?: boolean;
  conflict?: boolean;
}

const TERMINAL_FAIL = /fail|declin|cancel|expire|reject/i;

/**
 * Confirm one pending booking against PayLink; if approved, mark it confirmed
 * (which blocks the dates). Returns { granted, status }. Idempotent — a row
 * already `confirmed` is left alone.
 */
export async function confirmBookingRow(admin: SupabaseClient, row: BookingRow): Promise<ConfirmResult> {
  if (row.status === "confirmed") return { granted: true, status: "confirmed", already: true };
  if (row.status !== "pending_payment") return { granted: false, status: row.status };

  const check = await checkPayment({ requestId: row.paylink_request_id, orderId: row.paylink_order_id });
  if (!check.ok) return { granted: false, status: "unconfirmed" };

  if (!check.approved) {
    // Record a terminal failure so we stop polling it forever.
    if (TERMINAL_FAIL.test(String(check.status))) {
      await admin.from("bookings").update({ status: "payment_failed" }).eq("id", row.id).eq("status", "pending_payment");
      return { granted: false, status: "payment_failed" };
    }
    return { granted: false, status: check.status };
  }

  // Approved → flip to confirmed, but only if still pending (guards a concurrent
  // confirm) and backfill the orderId PayLink assigned once payment was made.
  const { data, error } = await admin
    .from("bookings")
    .update({
      status: "confirmed",
      paid_at: new Date().toISOString(),
      paylink_order_id: check.orderId ?? row.paylink_order_id,
    })
    .eq("id", row.id)
    .eq("status", "pending_payment")
    .select("id");

  if (error) {
    // The most likely error is the confirmed-only exclusion constraint: another
    // booking already confirmed these exact dates while this one was mid-pay.
    // Leave the row pending and surface a conflict — it needs a manual refund,
    // never a silent double-book. (Rare: start-checkout guards overlap.)
    if (/exclu|overlap|conflict|23P01/i.test(error.message)) {
      console.error("[bookings] confirm overlap conflict", row.id, error.message);
      return { granted: false, status: "conflict", conflict: true };
    }
    console.error("[bookings] confirm write failed", row.id, error.message);
    return { granted: false, status: "unconfirmed" };
  }

  if (!data || data.length === 0) {
    // Someone else confirmed it first — treat as success (they sent the emails).
    return { granted: true, status: "confirmed", already: true };
  }
  // Newly confirmed by us → create the payout + notify both sides. Never let a
  // post-confirm side effect fail the grant.
  try {
    await onBookingConfirmed(admin, row);
  } catch (err) {
    console.error("[bookings] post-confirm (payout/email) failed", row.id, err);
  }
  return { granted: true, status: "confirmed" };
}

/**
 * Poll all of one traveler's recent pending bookings (on return / account
 * load). Returns how many were confirmed this pass.
 */
export async function reconcileUserBookings(admin: SupabaseClient, userId: string): Promise<{ confirmed: number; checked: number }> {
  const { data, error } = await admin
    .from("bookings")
    .select(BOOKING_COLS)
    .eq("traveler_id", userId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data) return { confirmed: 0, checked: 0 };
  let confirmed = 0;
  for (const row of data as BookingRow[]) {
    const r = await confirmBookingRow(admin, row);
    if (r.granted) confirmed++;
  }
  return { confirmed, checked: data.length };
}

/**
 * Global sweep for the daily cron — catches bookings where the traveler never
 * returned to the redirect. Skips very fresh rows (still mid-checkout), caps
 * the batch, and expires pending holds that have gone stale so they stop
 * blocking soft availability and stop being polled forever.
 */
export async function reconcileAllPendingBookings(
  admin: SupabaseClient,
  { limit = 100, minAgeMinutes = 2, expireAfterHours = 24 }: { limit?: number; minAgeMinutes?: number; expireAfterHours?: number } = {},
): Promise<{ polled: number; confirmed: number; expired: number }> {
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from("bookings")
    .select(BOOKING_COLS)
    .eq("status", "pending_payment")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error || !data) return { polled: 0, confirmed: 0, expired: 0 };

  const expireBefore = Date.now() - expireAfterHours * 3_600_000;
  let confirmed = 0;
  let expired = 0;
  for (const row of data as BookingRow[]) {
    try {
      const r = await confirmBookingRow(admin, row);
      if (r.granted) {
        confirmed++;
        continue;
      }
      // Still pending and old enough → expire the hold.
      if (r.status !== "payment_failed" && Date.parse(row.created_at) < expireBefore) {
        const { data: upd } = await admin
          .from("bookings")
          .update({ status: "expired" })
          .eq("id", row.id)
          .eq("status", "pending_payment")
          .select("id");
        if (upd && upd.length) expired++;
      }
    } catch (err) {
      console.error("[bookings] reconcile row failed", row.id, err);
    }
  }
  return { polled: data.length, confirmed, expired };
}

/**
 * Daily sweep: for confirmed bookings whose trip has ended, mark them completed
 * and email the traveler once to ask for a review (guarded by review_requested_at
 * so it never re-sends). Uses the auth email, falling back to a guest's email.
 * Best-effort — a failure on one booking never blocks the rest.
 */
export async function requestReviewsForCompleted(admin: SupabaseClient, { limit = 200 }: { limit?: number } = {}): Promise<{ sent: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("bookings")
    .select("id, traveler_id, end_date, status, guest_email, listings!inner(title, slug)")
    .in("status", ["confirmed", "completed"])
    .lt("end_date", today)
    .is("review_requested_at", null)
    .limit(limit);
  if (error || !data) return { sent: 0 };

  let sent = 0;
  for (const row of data as unknown as { id: string; traveler_id: string; guest_email: string | null; listings: { title?: string; slug?: string } | null }[]) {
    try {
      const { data: traveler } = await admin.auth.admin.getUserById(row.traveler_id);
      const to = traveler?.user?.email || row.guest_email || "";
      if (to) {
        await sendReviewRequest(to, { listingTitle: row.listings?.title ?? "your trip", slug: row.listings?.slug, bookingId: row.id });
        sent++;
      }
      await admin.from("bookings").update({ status: "completed", review_requested_at: new Date().toISOString() }).eq("id", row.id);
    } catch (err) {
      console.error("[bookings] review request failed", row.id, err);
    }
  }
  return { sent };
}
