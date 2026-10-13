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
import { clientForOwner } from "./paymentAccounts.js";
import { recordDirectBookingCharge } from "./directLedger.js";
import { sendTravelerConfirmation, sendOperatorNewBooking, sendReviewRequest, type BookingEmailInfo } from "./email.js";
import { notifyBooking } from "./notify.js";
import { qualifyReferralForOperator } from "./referrals.js";
import { payoutDueDate } from "../shared/payouts.js";
import { computeBookingCharge, DEFAULT_CURRENCY } from "../shared/bookings.js";
import type { ListingType } from "../shared/listings.js";
import { refundGiftForBooking } from "./giftcards.js";
import { resolveOperatorCommissionPercent } from "./subscriptions.js";
import { releaseSeats } from "./sessions.js";
import { formatSlotTime } from "../shared/sessions.js";
import { roomUnitLabel } from "../shared/rooms.js";

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
  guest_phone: string | null;
  addons: { name: string; amountCents: number; qty: number; onRequest?: boolean }[] | null;
  session_id: string | null;
  starts_at: string | null;
}

/**
 * Which PayLink account issued this booking's charge (0094) plus the amounts the
 * direct-payment ledger needs. Looked up separately and failure-tolerant (like
 * room_type_id) so BOOKING_COLS never names a 0094 column — a pre-0094 DB just
 * reads "Revamp's account" and nothing changes.
 */
async function directPaymentInfo(admin: SupabaseClient, bookingId: string): Promise<{ owner: string | null; addonsCents: number; giftAppliedCents: number }> {
  const { data, error } = await admin.from("bookings").select("paylink_account_owner, addons_cents, gift_applied_cents").eq("id", bookingId).maybeSingle();
  if (error || !data) return { owner: null, addonsCents: 0, giftAppliedCents: 0 };
  const d = data as { paylink_account_owner?: string | null; addons_cents?: number | null; gift_applied_cents?: number | null };
  return { owner: d.paylink_account_owner ?? null, addonsCents: d.addons_cents ?? 0, giftAppliedCents: d.gift_applied_cents ?? 0 };
}

// Columns every confirm/reconcile query needs (row detail for the emails too).
const BOOKING_COLS = "id, listing_id, traveler_id, status, start_date, end_date, guests, amount_cents, base_cents, currency, paylink_request_id, paylink_order_id, created_at, guest_name, guest_email, guest_phone, addons, session_id, starts_at";

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

  // Hotel room booking (0092): name the room type everywhere this booking is
  // shown, and — for the host only (their email + payout) — the specific room
  // assigned ("Room 101"). Failure-tolerant lookup: a non-room booking (or a
  // pre-0092 DB) keeps the plain title.
  const { data: roomRef } = await admin.from("bookings").select("room_type_id, room_types(name), room_units(name)").eq("id", row.id).maybeSingle();
  const ref = roomRef as { room_types?: { name?: string } | null; room_units?: { name?: string } | null } | null;
  const roomTypeName = ref?.room_types?.name;
  const unitName = ref?.room_units?.name;
  if (roomTypeName) listing.title = `${listing.title} · ${roomTypeName}`;
  const hostTitle = unitName ? `${listing.title} · ${roomUnitLabel(unitName)}` : listing.title;

  // Read a loosely-typed fact by label (meeting point / duration / languages).
  const facts = (Array.isArray(listing.facts) ? listing.facts : []) as { label?: string; value?: string }[];
  const fact = (...labels: string[]) => facts.find((f) => f.label && labels.includes(f.label.toLowerCase()))?.value || undefined;

  // Create the operator payout (idempotent — one per booking). Revamp is
  // merchant of record; the payout is on the pre-tax BASE (tax is a pass-through
  // Revamp remits, never the operator's money), net of the platform commission.
  // Commission rate is per-operator ("operator's choice"): subscribers on a plan
  // with a commission_percent get that rate, else the site default.
  const base = row.base_cents ?? row.amount_cents;
  const commissionPct = await resolveOperatorCommissionPercent(admin, listing.operator_id);
  const { commissionCents, operatorNetCents } = computeBookingCharge(base, commissionPct);
  const direct = await directPaymentInfo(admin, row.id);
  if (direct.owner) {
    // Paid into the operator's OWN PayLink (0094): Revamp holds nothing, so no
    // payout — the operator owes commission + add-ons (minus any Revamp gift
    // portion) on their monthly statement.
    await recordDirectBookingCharge(
      admin,
      { id: row.id, base_cents: row.base_cents, amount_cents: row.amount_cents, addons_cents: direct.addonsCents, gift_applied_cents: direct.giftAppliedCents, currency: row.currency },
      { operatorId: listing.operator_id, listingTitle: hostTitle, commissionPercent: commissionPct },
    );
  } else await admin.from("payouts").upsert(
    {
      booking_id: row.id,
      operator_id: listing.operator_id,
      listing_id: row.listing_id,
      listing_title: hostTitle,
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

  // Referral program: if this operator was referred by another host, their first
  // confirmed booking earns the referrer credit. Best-effort, never throws, and
  // deliberately independent of the payout above.
  await qualifyReferralForOperator(admin, listing.operator_id, row.id);

  // Several rooms booked together (0097): every room gets its own payout above,
  // but the guest and host get ONE confirmation for the group — whichever room
  // confirms first claims it (atomic), the others stay quiet.
  let groupTitle: string | null = null;
  let groupHostTitle: string | null = null;
  let groupGuests = row.guests;
  let groupAmount = row.amount_cents;
  let groupAddons = row.addons ?? [];
  const { data: grp } = await admin.from("bookings").select("booking_group_id").eq("id", row.id).maybeSingle();
  const groupId = (grp as { booking_group_id?: string | null } | null)?.booking_group_id ?? null;
  if (groupId) {
    const { data: claimed } = await admin.from("bookings").update({ group_notified_at: new Date().toISOString() }).eq("id", groupId).is("group_notified_at", null).select("id");
    if (!claimed?.length) return;
    const { data: members } = await admin.from("bookings").select("id, guests, amount_cents, addons, room_types(name), room_units(name)").eq("booking_group_id", groupId);
    const ms = (members ?? []) as unknown as { id: string; guests: number; amount_cents: number; addons: BookingRow["addons"]; room_types: { name?: string } | null; room_units: { name?: string } | null }[];
    groupAddons = ms.find((m) => m.id === groupId)?.addons ?? groupAddons; // add-ons live on the first room
    const baseTitle = listing.title.replace(roomTypeName ? ` · ${roomTypeName}` : "", "");
    groupTitle = `${baseTitle} · ${roomTypeName ?? "Room"} × ${ms.length}`;
    const numbers = ms.map((m) => (m.room_units?.name ? roomUnitLabel(m.room_units.name) : "")).filter(Boolean);
    groupHostTitle = numbers.length ? `${groupTitle} (${numbers.join(", ")})` : groupTitle;
    groupGuests = ms.reduce((a, m) => a + (m.guests ?? 0), 0) || row.guests;
    groupAmount = ms.reduce((a, m) => a + (m.amount_cents ?? 0), 0) || row.amount_cents;
  }

  // Notify both sides (best-effort).
  const info: BookingEmailInfo = {
    listingTitle: groupTitle ?? listing.title,
    startDate: row.start_date,
    endDate: row.end_date,
    guests: groupGuests,
    amountCents: groupAmount,
    currency: row.currency,
    city: listing.city,
    region: listing.region,
    slug: listing.slug,
    addons: groupAddons,
    type: listing.type,
    time: row.starts_at ? formatSlotTime(row.starts_at) : undefined,
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
    operatorEmail ? sendOperatorNewBooking(operatorEmail, { ...info, listingTitle: groupHostTitle ?? hostTitle }, travelerName) : Promise.resolve({ sent: false, reason: "no_recipient" as const }),
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

  // New channels on top of email: mirror into the unified inbox + text/WhatsApp
  // the traveler (best-effort, self-gating).
  const whenLine = info.type === "stay"
    ? `${info.startDate} → ${info.endDate}`
    : `${info.startDate}${info.time ? ` at ${info.time}` : ""}`;
  await notifyBooking(admin, {
    bookingId: row.id,
    listingId: row.listing_id,
    operatorId: listing.operator_id,
    travelerId: row.traveler_id,
    travelerPhone: row.guest_phone,
    inboxBody: `✅ Booking confirmed — ${info.listingTitle}, ${whenLine}, ${info.guests} guest${info.guests === 1 ? "" : "s"}.`,
    smsBody: `Revamp: your booking is confirmed — ${info.listingTitle}, ${whenLine}. Details are in your account.`,
  });
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

/** Run the post-confirm side effects (operator payout + confirmation emails) for
 *  a booking that was inserted already-confirmed (e.g. fully covered by a gift
 *  card, so it never went through PayLink). Best-effort. */
export async function finalizeConfirmedBooking(admin: SupabaseClient, bookingId: string): Promise<void> {
  const { data } = await admin.from("bookings").select(BOOKING_COLS).eq("id", bookingId).maybeSingle();
  if (data) await onBookingConfirmed(admin, data as BookingRow);
}

const TERMINAL_FAIL = /fail|declin|cancel|expire|reject/i;

/**
 * Confirm one pending booking against PayLink; if approved, mark it confirmed
 * (which blocks the dates). Returns { granted, status }. Idempotent — a row
 * already `confirmed` is left alone.
 */
export async function confirmBookingRow(admin: SupabaseClient, row: BookingRow): Promise<ConfirmResult> {
  if (row.status === "confirmed") return { granted: true, status: "confirmed", already: true };
  // Confirmable states: a normal pending hold, or a request the operator approved
  // that's now awaiting the guest's payment.
  if (row.status !== "pending_payment" && row.status !== "awaiting_payment") return { granted: false, status: row.status };
  const payableStatuses = ["pending_payment", "awaiting_payment"];

  // Verify with the account that issued the charge — Revamp's, or the
  // operator's own PayLink (0094). Missing credentials → leave it pending.
  const { owner } = await directPaymentInfo(admin, row.id);
  const client = await clientForOwner(admin, owner);
  if (!client) {
    console.error("[bookings] no credentials to verify direct payment", row.id);
    return { granted: false, status: "unconfirmed" };
  }
  const check = await client.checkPayment({ requestId: row.paylink_request_id, orderId: row.paylink_order_id });
  if (!check.ok) return { granted: false, status: "unconfirmed" };

  if (!check.approved) {
    // Record a terminal failure so we stop polling it forever.
    if (TERMINAL_FAIL.test(String(check.status))) {
      await admin.from("bookings").update({ status: "payment_failed" }).eq("id", row.id).in("status", payableStatuses);
      await refundGiftForBooking(admin, row.id); // release any gift-card hold
      if (row.session_id) await releaseSeats(admin, row.session_id, row.guests); // free the slot
      return { granted: false, status: "payment_failed" };
    }
    return { granted: false, status: check.status };
  }

  // Hotel room booking (0092): capacity can't be a DB exclusion ("up to N
  // rooms"), so confirm through confirm_room_booking(), which locks the room
  // type and checks the busiest night in one transaction. Looked up separately
  // (and failure-tolerant) so BOOKING_COLS never names room_type_id — an
  // unknown column there would break every confirm before 0092 runs.
  const { data: roomRef } = await admin.from("bookings").select("room_type_id").eq("id", row.id).maybeSingle();
  const roomTypeId = (roomRef as { room_type_id?: string | null } | null)?.room_type_id ?? null;
  if (roomTypeId) {
    const { data: outcome, error: rpcErr } = await admin.rpc("confirm_room_booking", {
      p_booking_id: row.id,
      p_order_id: check.orderId ?? row.paylink_order_id,
    });
    if (rpcErr) {
      console.error("[bookings] room confirm failed", row.id, rpcErr.message);
      return { granted: false, status: "unconfirmed" };
    }
    if (outcome === "capacity") {
      // Paid, but the last room went to someone else mid-payment. Same handling
      // as the exclusion conflict below: left pending for a manual refund,
      // never a silent overbooking.
      console.error("[bookings] room confirm capacity conflict", row.id);
      return { granted: false, status: "conflict", conflict: true };
    }
    if (outcome !== "confirmed") {
      const { data: now } = await admin.from("bookings").select("status").eq("id", row.id).maybeSingle();
      return now?.status === "confirmed" ? { granted: true, status: "confirmed", already: true } : { granted: false, status: now?.status ?? "unconfirmed" };
    }
    try {
      await onBookingConfirmed(admin, row);
    } catch (err) {
      console.error("[bookings] post-confirm (payout/email) failed", row.id, err);
    }
    return { granted: true, status: "confirmed" };
  }

  // Approved → flip to confirmed, but only if still payable (guards a concurrent
  // confirm) and backfill the orderId PayLink assigned once payment was made.
  const { data, error } = await admin
    .from("bookings")
    .update({
      status: "confirmed",
      paid_at: new Date().toISOString(),
      paylink_order_id: check.orderId ?? row.paylink_order_id,
    })
    .eq("id", row.id)
    .in("status", payableStatuses)
    .select("id");

  if (error) {
    // The most likely error is the confirmed-only exclusion constraint: another
    // booking already confirmed these exact dates while this one was mid-pay.
    // Leave the row pending and surface a conflict — it needs a manual refund,
    // never a silent double-book. (Rare: start-checkout guards overlap.)
    if (/exclu|overlap|conflict|23P01/i.test(error.message)) {
      console.error("[bookings] confirm overlap conflict", row.id, error.message);
      return { granted: false, status: "conflict", conflict: true };
      // Note: gift hold is intentionally NOT released here — the row stays
      // pending_payment for manual resolution, and releasing then re-charging
      // would be wrong. It's released when the booking is finally cancelled.
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
    .in("status", ["pending_payment", "awaiting_payment"])
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
    .in("status", ["pending_payment", "awaiting_payment"])
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
          .in("status", ["pending_payment", "awaiting_payment"])
          .select("id");
        if (upd && upd.length) {
          expired++;
          await refundGiftForBooking(admin, row.id); // release any gift-card hold
          if (row.session_id) await releaseSeats(admin, row.session_id, row.guests); // free the slot
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
    .select("id, traveler_id, start_date, end_date, status, guest_email, listing_id, listings!inner(title, slug, type, image, operator_id)")
    .in("status", ["confirmed", "completed"])
    .lte("end_date", today)
    .is("review_requested_at", null)
    .limit(limit);
  if (error || !data) return { sent: 0 };

  const now = Date.now();
  let sent = 0;
  const rows = data as unknown as {
    id: string;
    traveler_id: string;
    start_date: string;
    end_date: string;
    guest_email: string | null;
    listing_id: string;
    listings: { title?: string; slug?: string; type?: string; image?: string; operator_id?: string } | null;
  }[];
  // Customer Journey (0097): when the operator's own "Thank you" step is on, it
  // carries the review link — so Revamp's separate email is skipped (no double email).
  let journeyAfter = new Set<string>();
  try {
    const { afterStepEnabledFor } = await import("./journey.js");
    journeyAfter = await afterStepEnabledFor(
      admin,
      rows.map((r) => ({ id: r.listing_id, operator_id: r.listings?.operator_id ?? "", type: r.listings?.type ?? "" })).filter((l) => l.operator_id),
    );
  } catch (err) {
    console.error("[bookings] journey check failed", err);
  }
  for (const row of rows) {
    // Only once a full 24h has passed since the experience actually ended.
    if (now - experienceEndInstant(row.listings?.type, row.start_date, row.end_date) < REVIEW_DELAY_MS) continue;
    if (journeyAfter.has(row.listing_id)) {
      await admin.from("bookings").update({ status: "completed", review_requested_at: new Date().toISOString() }).eq("id", row.id);
      continue;
    }
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
