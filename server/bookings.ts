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
import { computeBookingCharge, DEFAULT_CURRENCY } from "../shared/bookings.js";
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
    .select("title, type, city, region, slug, operator_id, lat, lng, facts")
    .eq("id", row.listing_id)
    .maybeSingle();
  if (!listing) return;

  // Read a loosely-typed fact by label (meeting point / duration / languages).
  const facts = (Array.isArray(listing.facts) ? listing.facts : []) as { label?: string; value?: string }[];
  const fact = (...labels: string[]) => facts.find((f) => f.label && labels.includes(f.label.toLowerCase()))?.value || undefined;

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
    type: listing.type,
    lat: typeof listing.lat === "number" ? listing.lat : undefined,
    lng: typeof listing.lng === "number" ? listing.lng : undefined,
    meetingPoint: fact("starting point", "meeting point", "start"),
    duration: fact("duration"),
    languages: fact("languages", "language"),
    checkIn: fact("check-in", "checkin", "check in"),
    checkOut: fact("checkout", "check-out", "check out"),
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
  const operatorEmail = operator?.user?.email || "";
  const [travelerRes, operatorRes] = await Promise.all([
    travelerEmail ? sendTravelerConfirmation(travelerEmail, info) : Promise.resolve({ sent: false, reason: "no_recipient" as const }),
    operatorEmail ? sendOperatorNewBooking(operatorEmail, info, travelerName) : Promise.resolve({ sent: false, reason: "no_recipient" as const }),
  ]);
  // Record the activity for the booking's History log (best-effort). Log the
  // TRUE send result so a delivery/config failure is visible here, not masked
  // as "sent".
  await logBookingEvent(admin, row.id, "status_confirmed");
  if (travelerEmail) {
    await logBookingEvent(admin, row.id, travelerRes.sent ? "email_traveler_confirmation" : "email_failed", travelerRes.sent ? travelerEmail : `Guest email to ${travelerEmail} failed (${travelerRes.reason ?? "unknown"}).`);
  }
  if (operatorEmail) {
    await logBookingEvent(admin, row.id, operatorRes.sent ? "email_operator_new_booking" : "email_failed", operatorRes.sent ? operatorEmail : `Operator email to ${operatorEmail} failed (${operatorRes.reason ?? "unknown"}).`);
  }
}

/**
 * Append one entry to a booking's activity/communication log (booking_events,
 * migration 0032). Best-effort: never throws, and no-ops if the table isn't
 * there yet. Written with the service role, so it's exempt from RLS.
 */
export async function logBookingEvent(admin: SupabaseClient, bookingId: string, type: string, detail?: string): Promise<void> {
  try {
    await admin.from("booking_events").insert({ booking_id: bookingId, type, detail: detail ?? null });
  } catch {
    /* table missing / transient — history is non-critical */
  }
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
export async function reconcileUserBookings(admin: SupabaseClient, userId: string): Promise<{ confirmed: number; checked: number; amountCents: number; currency: string; bookingIds: string[] }> {
  const { data, error } = await admin
    .from("bookings")
    .select(BOOKING_COLS)
    .eq("traveler_id", userId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data) return { confirmed: 0, checked: 0, amountCents: 0, currency: DEFAULT_CURRENCY, bookingIds: [] };
  let confirmed = 0;
  let amountCents = 0;
  let currency = DEFAULT_CURRENCY;
  const bookingIds: string[] = [];
  for (const row of data as BookingRow[]) {
    const r = await confirmBookingRow(admin, row);
    if (r.granted) {
      confirmed++;
      amountCents += row.amount_cents ?? 0;
      if (row.currency) currency = row.currency;
      bookingIds.push(row.id);
    }
  }
  return { confirmed, checked: data.length, amountCents, currency, bookingIds };
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
        if (upd && upd.length) {
          expired++;
          await logBookingEvent(admin, row.id, "status_expired", `Unpaid hold expired after ${expireAfterHours}h`);
        }
      }
    } catch (err) {
      console.error("[bookings] reconcile row failed", row.id, err);
    }
  }
  return { polled: data.length, confirmed, expired };
}

/** How long after an experience ends before we ask the guest to review it. */
const REVIEW_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * The instant a booking's experience is actually *over*, so we can wait a full
 * 24h from there regardless of product type. We only store dates, so we treat
 * the experience as ending at midday of its final active day (a reasonable
 * proxy for checkout / an activity wrapping up):
 *   - stay: `end_date` is the checkout day → that's the final day.
 *   - tour / experience: a single-day activity is stored with an *exclusive*
 *     `end_date = start_date + 1`, so the activity itself happens on
 *     `start_date` — that's the final day. Using `end_date` here would push the
 *     email a full day late for every tour/experience.
 */
function experienceEndInstant(type: string | undefined, startDate: string, endDate: string): number {
  const finalDay = type === "stay" ? endDate : startDate;
  return Date.parse(`${finalDay}T12:00:00Z`);
}

/**
 * Sweep (runs on the reconcile cron, every 10 min): for confirmed bookings whose
 * experience ended at least 24h ago — stays, tours, and experiences alike — mark
 * them completed and email the traveler once to ask for a review (guarded by
 * review_requested_at so it never re-sends). Uses the auth email, falling back to
 * a guest's email. Best-effort — a failure on one booking never blocks the rest.
 */
export async function requestReviewsForCompleted(admin: SupabaseClient, { limit = 200 }: { limit?: number } = {}): Promise<{ sent: number }> {
  const today = new Date().toISOString().slice(0, 10);
  // Coarse date prefilter (a superset): anything whose end date is today or past
  // is a candidate; the precise ">=24h after it ended" gate is applied per-row
  // below, so a same-day checkout or a just-finished tour is never emailed early.
  const { data, error } = await admin
    .from("bookings")
    .select("id, traveler_id, start_date, end_date, status, guest_email, listings!inner(title, slug, type, image)")
    .in("status", ["confirmed", "completed"])
    .lte("end_date", today)
    .is("review_requested_at", null)
    .limit(limit);
  if (error || !data) return { sent: 0 };

  const now = Date.now();
  let sent = 0;
  for (const row of data as unknown as {
    id: string;
    traveler_id: string;
    start_date: string;
    end_date: string;
    guest_email: string | null;
    listings: { title?: string; slug?: string; type?: string; image?: string } | null;
  }[]) {
    // Only once a full 24h has passed since the experience actually ended.
    if (now - experienceEndInstant(row.listings?.type, row.start_date, row.end_date) < REVIEW_DELAY_MS) continue;
    try {
      const { data: traveler } = await admin.auth.admin.getUserById(row.traveler_id);
      const to = traveler?.user?.email || row.guest_email || "";
      if (to) {
        await sendReviewRequest(to, {
          listingTitle: row.listings?.title ?? "your trip",
          slug: row.listings?.slug,
          bookingId: row.id,
          type: row.listings?.type,
          image: row.listings?.image,
        });
        await logBookingEvent(admin, row.id, "email_review_request", to);
        sent++;
      }
      await admin.from("bookings").update({ status: "completed", review_requested_at: new Date().toISOString() }).eq("id", row.id);
    } catch (err) {
      console.error("[bookings] review request failed", row.id, err);
    }
  }
  return { sent };
}
