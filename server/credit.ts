/**
 * Revamp credit (0105) — server side. Rules live in shared/credit.ts.
 *
 *  - `creditBalanceFor`      a user's spendable balance.
 *  - `reserveCredit`         take credit for a checkout (atomic SQL, all-or-nothing).
 *  - `returnCredit` /
 *    `returnCreditForBooking` put it back: checkout failed, payment expired or
 *                            failed, or the booking was cancelled (credit is
 *                            refundable to the account, unlike a gift card).
 *  - `awardTravelCredits`    the cron: credit finished trips, email the guest.
 *
 * Everything is failure-tolerant before 0105 runs: no balance, nothing reserved,
 * nothing awarded — checkout works exactly as before.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDIT_PROGRAM_START, creditBalance, creditEarnDay, creditEarnedCents, creditExpiry } from "../shared/credit.js";
import { sendCreditEarned } from "./email.js";

/** Booking history line (same table as bookings.ts logBookingEvent; inlined to avoid a circular import). */
async function logBookingEvent(admin: SupabaseClient, bookingId: string, type: string, detail?: string): Promise<void> {
  try {
    await admin.from("booking_events").insert({ booking_id: bookingId, type, detail: detail ?? null });
  } catch {
    /* non-critical */
  }
}

export async function creditBalanceFor(admin: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await admin
    .from("credit_lots")
    .select("remaining_cents, expires_at")
    .eq("user_id", userId)
    .gt("remaining_cents", 0)
    .gt("expires_at", new Date().toISOString());
  if (error || !data) return 0;
  return creditBalance(data as { remaining_cents: number; expires_at: string }[]);
}

/** Reserve exactly `amountCents` of the user's credit; null if short or unavailable. */
export async function reserveCredit(admin: SupabaseClient, userId: string, amountCents: number): Promise<string | null> {
  if (amountCents <= 0) return null;
  const { data, error } = await admin.rpc("reserve_credit", { p_user: userId, p_amount: amountCents });
  if (error) {
    console.error("[credit] reserve failed", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Link a hold to the booking it paid for (for the guest's history). */
export async function attachCreditHold(admin: SupabaseClient, holdId: string, bookingId: string): Promise<void> {
  const { error } = await admin.from("credit_uses").update({ booking_id: bookingId }).eq("hold_id", holdId);
  if (error) console.error("[credit] attach hold failed", error.message);
}

/** Put a hold back on its lots. Returns the cents returned. */
export async function returnCredit(admin: SupabaseClient, holdId: string | null | undefined): Promise<number> {
  if (!holdId) return 0;
  const { data, error } = await admin.rpc("return_credit", { p_hold: holdId });
  if (error) {
    console.error("[credit] return failed", holdId, error.message);
    return 0;
  }
  return Number(data) || 0;
}

/** The booking's credit, read failure-tolerantly (columns exist only after 0105). */
export async function bookingCredit(admin: SupabaseClient, bookingId: string): Promise<{ appliedCents: number; holdId: string | null }> {
  const { data, error } = await admin.from("bookings").select("credit_applied_cents, credit_hold_id").eq("id", bookingId).maybeSingle();
  if (error || !data) return { appliedCents: 0, holdId: null };
  const d = data as { credit_applied_cents?: number | null; credit_hold_id?: string | null };
  return { appliedCents: d.credit_applied_cents ?? 0, holdId: d.credit_hold_id ?? null };
}

/**
 * Return a booking's credit (idempotent — zeroes the booking's credit columns
 * afterwards, and return_credit only touches 'applied' uses). Call wherever
 * the booking won't stand: payment failed/expired, cancelled.
 */
export async function returnCreditForBooking(admin: SupabaseClient, bookingId: string, why: string): Promise<number> {
  const { appliedCents, holdId } = await bookingCredit(admin, bookingId);
  if (!holdId || appliedCents <= 0) return 0;
  const back = await returnCredit(admin, holdId);
  await admin.from("bookings").update({ credit_applied_cents: 0, credit_hold_id: null }).eq("id", bookingId);
  if (back > 0) {
    try {
      await logBookingEvent(admin, bookingId, "credit_returned", `֏${Math.round(back / 100).toLocaleString("en-US")} Revamp credit returned · ${why}`);
    } catch {
      /* best-effort */
    }
  }
  return back;
}

/**
 * Cron: credit every finished trip once. A booking is looked at once
 * (`credit_awarded_at`), even when it earns nothing (e.g. fully paid by gift).
 * Hand-entered bookings and guests without a real account don't earn.
 */
export async function awardTravelCredits(admin: SupabaseClient, { limit = 200 }: { limit?: number } = {}): Promise<{ awarded: number; checked: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("bookings")
    .select("id, traveler_id, status, provider, start_date, end_date, amount_cents, base_cents, gift_applied_cents, credit_applied_cents, currency, guest_email, listings!inner(title, type)")
    .in("status", ["confirmed", "completed"])
    .is("credit_awarded_at", null)
    .gte("end_date", CREDIT_PROGRAM_START)
    .lte("end_date", today)
    .limit(limit);
  if (error || !data) {
    if (error && !/credit_awarded_at|column/i.test(error.message)) console.error("[credit] award read failed", error.message);
    return { awarded: 0, checked: 0 };
  }
  type Row = {
    id: string; traveler_id: string; status: string; provider: string | null; start_date: string; end_date: string;
    amount_cents: number; base_cents: number | null; gift_applied_cents: number | null; credit_applied_cents: number | null;
    currency: string; guest_email: string | null; listings: { title?: string; type?: string } | null;
  };
  let awarded = 0;
  let checked = 0;
  for (const row of data as unknown as Row[]) {
    if (creditEarnDay(row.listings?.type, row.start_date, row.end_date) > today) continue; // not yet the day after
    checked++;
    const markDone = () => admin.from("bookings").update({ credit_awarded_at: new Date().toISOString() }).eq("id", row.id);
    try {
      const cents = row.provider === "direct" ? 0 : creditEarnedCents({
        baseCents: row.base_cents,
        amountCents: row.amount_cents,
        giftAppliedCents: row.gift_applied_cents,
        creditAppliedCents: row.credit_applied_cents,
      });
      // Only real accounts can come back and spend it (not anonymous checkout sessions).
      const { data: u } = await admin.auth.admin.getUserById(row.traveler_id);
      const user = u?.user;
      if (cents <= 0 || !user || user.is_anonymous) {
        await markDone();
        continue;
      }
      const { error: insErr } = await admin.from("credit_lots").insert({
        user_id: row.traveler_id,
        source: "earned",
        source_booking_id: row.id,
        amount_cents: cents,
        remaining_cents: cents,
        currency: row.currency || "AMD",
        expires_at: creditExpiry(),
      });
      // 23505 = this booking already earned (a concurrent run) — just mark it.
      if (insErr && (insErr as { code?: string }).code !== "23505") {
        console.error("[credit] award insert failed", row.id, insErr.message);
        continue; // retry next run
      }
      await markDone();
      if (!insErr) {
        awarded++;
        await logBookingEvent(admin, row.id, "credit_earned", `֏${Math.round(cents / 100).toLocaleString("en-US")} Revamp credit`);
        const to = user.email || row.guest_email || "";
        if (to) {
          const balance = await creditBalanceFor(admin, row.traveler_id);
          await sendCreditEarned(to, { listingTitle: row.listings?.title ?? "your trip", earnedCents: cents, balanceCents: balance, expiresAt: creditExpiry() });
        }
      }
    } catch (err) {
      console.error("[credit] award failed", row.id, err);
    }
  }
  return { awarded, checked };
}
