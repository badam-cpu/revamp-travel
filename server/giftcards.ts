/**
 * Gift-card server logic — the analog of server/bookings.ts for gift cards.
 * Purchase is a PayLink payment (registered in the route); this module handles
 * everything after: activating a paid card (assign code, set balance + expiry,
 * email the recipient), reconciling unpaid ones on the cron, and the redemption
 * balance moves (reserve at checkout, refund on a failed/cancelled booking).
 * All writes use the service-role client — gift_cards has no client write policy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPayment } from "./paylink.js";
import { sendGiftCard, sendGiftReceipt } from "./email.js";
import { GIFT_CARD_VALID_MONTHS } from "../shared/giftcards.js";

export interface GiftCardRow {
  id: string;
  code: string | null;
  status: string;
  initial_amount_cents: number;
  balance_cents: number;
  currency: string;
  purchaser_id: string | null;
  purchaser_email: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  message: string | null;
  paylink_request_id: string | null;
  paylink_order_id: string | null;
  created_at: string;
}

const GIFT_COLS =
  "id, code, status, initial_amount_cents, balance_cents, currency, purchaser_id, purchaser_email, recipient_name, recipient_email, message, paylink_request_id, paylink_order_id, created_at";

// No ambiguous chars (0/O, 1/I) — codes get typed by hand off an email.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  const block = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  return `RV-${block()}-${block()}-${block()}`;
}

const TERMINAL_FAIL = /fail|declin|cancel|expire|reject/i;

/** Append one entry to a gift card's audit ledger (gift_card_events). Best-effort
 *  and append-only — nothing here is ever updated or deleted. */
export async function logGiftEvent(
  admin: SupabaseClient,
  giftId: string,
  type: "activated" | "redeemed" | "released" | "refunded" | "voided" | "expired",
  opts: { amountCents?: number; balanceAfter?: number | null; bookingId?: string | null; detail?: string } = {},
): Promise<void> {
  try {
    await admin.from("gift_card_events").insert({
      gift_card_id: giftId,
      type,
      amount_cents: opts.amountCents ?? 0,
      balance_after: opts.balanceAfter ?? null,
      booking_id: opts.bookingId ?? null,
      detail: opts.detail ?? null,
    });
  } catch (err) {
    console.error("[giftcards] ledger write failed", giftId, type, err);
  }
}

/** Activate a paid gift card: assign a unique code, set the balance + 12-month
 *  expiry, then email the recipient (and the purchaser a receipt). Idempotent —
 *  only acts on a row still `pending_payment`. */
export async function activateGiftCard(admin: SupabaseClient, row: GiftCardRow, orderId: string | null): Promise<boolean> {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + GIFT_CARD_VALID_MONTHS);

  // Assign a unique code, retrying on the unlikely unique-collision (23505).
  let assigned: string | null = null;
  for (let attempt = 0; attempt < 6 && !assigned; attempt++) {
    const code = randomCode();
    const { data, error } = await admin
      .from("gift_cards")
      .update({
        status: "active",
        code,
        balance_cents: row.initial_amount_cents,
        activated_at: new Date().toISOString(),
        expires_at: expires.toISOString(),
        paylink_order_id: orderId ?? row.paylink_order_id,
      })
      .eq("id", row.id)
      .eq("status", "pending_payment")
      .select("id, code")
      .maybeSingle();
    if (!error && data) {
      assigned = data.code as string;
      break;
    }
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("[giftcards] activate write failed", row.id, error.message);
      return false;
    }
    // 23505 → code collided (or a concurrent activate). If the row is no longer
    // pending (someone activated it), stop and treat as already done.
    const { data: cur } = await admin.from("gift_cards").select("status, code").eq("id", row.id).maybeSingle();
    if (cur?.status === "active") return true;
  }
  if (!assigned) return false;

  await logGiftEvent(admin, row.id, "activated", { amountCents: row.initial_amount_cents, balanceAfter: row.initial_amount_cents, detail: `Activated as ${assigned}` });

  // Emails are best-effort — a delivery failure never un-activates the card.
  try {
    const amount = row.initial_amount_cents;
    if (row.recipient_email) {
      await sendGiftCard(row.recipient_email, {
        code: assigned,
        amountCents: amount,
        currency: row.currency,
        recipientName: row.recipient_name || undefined,
        message: row.message || undefined,
        expiresAt: expires.toISOString(),
      });
    }
    if (row.purchaser_email) {
      await sendGiftReceipt(row.purchaser_email, {
        amountCents: amount,
        currency: row.currency,
        recipientName: row.recipient_name || row.recipient_email || "your recipient",
      });
    }
  } catch (err) {
    console.error("[giftcards] activation email failed", row.id, err);
  }
  return true;
}

/** Confirm one pending gift card against PayLink; activate if approved. */
export async function confirmGiftCardRow(admin: SupabaseClient, row: GiftCardRow): Promise<boolean> {
  if (row.status === "active") return true;
  if (row.status !== "pending_payment") return false;
  const check = await checkPayment({ requestId: row.paylink_request_id, orderId: row.paylink_order_id });
  if (!check.ok) return false;
  if (!check.approved) {
    if (TERMINAL_FAIL.test(String(check.status))) {
      await admin.from("gift_cards").update({ status: "cancelled" }).eq("id", row.id).eq("status", "pending_payment");
    }
    return false;
  }
  return activateGiftCard(admin, row, check.orderId ?? null);
}

/** Poll a purchaser's recent pending gift cards (called on their return). */
export async function reconcilePurchaserGiftCards(admin: SupabaseClient, purchaserId: string): Promise<{ activated: number }> {
  const { data } = await admin
    .from("gift_cards")
    .select(GIFT_COLS)
    .eq("purchaser_id", purchaserId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(10);
  let activated = 0;
  for (const row of (data ?? []) as GiftCardRow[]) if (await confirmGiftCardRow(admin, row)) activated++;
  return { activated };
}

/** Global sweep for the cron — activates paid cards whose buyer never returned,
 *  and expires stale unpaid holds. */
export async function reconcileAllPendingGiftCards(
  admin: SupabaseClient,
  { limit = 100, minAgeMinutes = 2, expireAfterHours = 24 }: { limit?: number; minAgeMinutes?: number; expireAfterHours?: number } = {},
): Promise<{ polled: number; activated: number; expired: number }> {
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString();
  const { data } = await admin
    .from("gift_cards")
    .select(GIFT_COLS)
    .eq("status", "pending_payment")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  const expireBefore = Date.now() - expireAfterHours * 3_600_000;
  let activated = 0;
  let expired = 0;
  for (const row of (data ?? []) as GiftCardRow[]) {
    try {
      if (await confirmGiftCardRow(admin, row)) {
        activated++;
        continue;
      }
      if (Date.parse(row.created_at) < expireBefore) {
        const { data: upd } = await admin.from("gift_cards").update({ status: "cancelled" }).eq("id", row.id).eq("status", "pending_payment").select("id");
        if (upd && upd.length) expired++;
      }
    } catch (err) {
      console.error("[giftcards] reconcile row failed", row.id, err);
    }
  }
  return { polled: (data ?? []).length, activated, expired };
}

export interface GiftLookup {
  id: string;
  balanceCents: number;
  currency: string;
}

/** Validate a code for redemption: active, not expired, positive balance. */
export async function lookupRedeemableGift(admin: SupabaseClient, code: string, currency: string): Promise<GiftLookup | { error: string }> {
  const { data } = await admin
    .from("gift_cards")
    .select("id, status, balance_cents, currency, expires_at")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (!data) return { error: "That gift card code wasn't found." };
  if (data.status !== "active" || data.balance_cents <= 0) return { error: "This gift card has no balance left." };
  if (data.expires_at && Date.parse(data.expires_at) < Date.now()) return { error: "This gift card has expired." };
  if (data.currency !== currency) return { error: "This gift card is in a different currency." };
  return { id: data.id, balanceCents: data.balance_cents, currency: data.currency };
}

/** Reserve `applied` cents against a card (conditional decrement, no double-spend).
 *  Returns true if reserved. Depletes the card when it hits zero. */
export async function reserveGift(admin: SupabaseClient, giftId: string, applied: number): Promise<boolean> {
  const { data: cur } = await admin.from("gift_cards").select("balance_cents").eq("id", giftId).eq("status", "active").maybeSingle();
  if (!cur || cur.balance_cents < applied) return false;
  const nextBalance = cur.balance_cents - applied;
  const { data: upd } = await admin
    .from("gift_cards")
    .update({ balance_cents: nextBalance, status: nextBalance <= 0 ? "depleted" : "active" })
    .eq("id", giftId)
    .eq("status", "active")
    .eq("balance_cents", cur.balance_cents) // optimistic lock against a concurrent reserve
    .select("id");
  return !!(upd && upd.length);
}

/** Undo a reservation that never became a booking (register/insert failed).
 *  Adds `amount` back to the card. */
export async function releaseGift(admin: SupabaseClient, giftId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const { data: card } = await admin.from("gift_cards").select("balance_cents, expires_at").eq("id", giftId).maybeSingle();
  if (!card) return;
  const expired = card.expires_at && Date.parse(card.expires_at) < Date.now();
  const balanceAfter = card.balance_cents + amount;
  await admin.from("gift_cards").update({ balance_cents: balanceAfter, status: expired ? "expired" : "active" }).eq("id", giftId);
  await logGiftEvent(admin, giftId, "released", { amountCents: amount, balanceAfter, detail: "Reservation released (checkout not completed)" });
}

/** Refund a booking's reserved gift amount back to its card (idempotent — zeroes
 *  the booking's gift_applied_cents so it can't refund twice). Call on any path
 *  where the booking won't stand: payment_failed, expired, conflict, cancelled. */
export async function refundGiftForBooking(admin: SupabaseClient, bookingId: string): Promise<void> {
  const { data: b } = await admin.from("bookings").select("gift_card_id, gift_applied_cents").eq("id", bookingId).maybeSingle();
  const applied = (b as { gift_applied_cents?: number } | null)?.gift_applied_cents ?? 0;
  const giftId = (b as { gift_card_id?: string | null } | null)?.gift_card_id;
  if (!giftId || applied <= 0) return;
  const { data: card } = await admin.from("gift_cards").select("balance_cents, status, expires_at").eq("id", giftId).maybeSingle();
  if (card) {
    const expired = card.expires_at && Date.parse(card.expires_at) < Date.now();
    const balanceAfter = card.balance_cents + applied;
    await admin
      .from("gift_cards")
      .update({ balance_cents: balanceAfter, status: expired ? "expired" : "active" })
      .eq("id", giftId);
    await logGiftEvent(admin, giftId, "refunded", { amountCents: applied, balanceAfter, bookingId, detail: "Booking didn't stand — gift released back" });
  }
  await admin.from("bookings").update({ gift_applied_cents: 0, gift_card_id: null }).eq("id", bookingId);
}

/** Cron cleanup: flip active/depleted cards past their expiry to `expired`. The
 *  balance and the card row are kept (nothing removed) and each is logged. */
export async function expireOverdueGiftCards(admin: SupabaseClient, { limit = 200 }: { limit?: number } = {}): Promise<{ expired: number }> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("gift_cards")
    .select("id, balance_cents")
    .in("status", ["active", "depleted"])
    .lt("expires_at", nowIso)
    .limit(limit);
  let expired = 0;
  for (const c of (data ?? []) as { id: string; balance_cents: number }[]) {
    const { data: upd } = await admin.from("gift_cards").update({ status: "expired" }).eq("id", c.id).in("status", ["active", "depleted"]).select("id");
    if (upd && upd.length) {
      expired++;
      await logGiftEvent(admin, c.id, "expired", { balanceAfter: c.balance_cents, detail: "Reached expiry date" });
    }
  }
  return { expired };
}

/** Admin: void a gift card so it can no longer be redeemed (fraud / chargeback).
 *  Sets status `cancelled` and logs it — the balance and history are preserved. */
export async function voidGiftCard(admin: SupabaseClient, giftId: string, detail: string): Promise<boolean> {
  const { data: card } = await admin.from("gift_cards").select("balance_cents, status").eq("id", giftId).maybeSingle();
  if (!card) return false;
  if (card.status === "cancelled") return true;
  const { data: upd } = await admin.from("gift_cards").update({ status: "cancelled" }).eq("id", giftId).select("id");
  if (!upd || !upd.length) return false;
  await logGiftEvent(admin, giftId, "voided", { balanceAfter: card.balance_cents, detail });
  return true;
}
