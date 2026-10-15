/**
 * Gift card + Revamp credit at checkout, in one place, for every checkout path
 * (stay, time slot, room group). Both are reserved BEFORE any charge (so the
 * guest is never charged more than the checkout showed) and released on any
 * path where the booking doesn't stand. Order: gift card first, then credit
 * for what's left. Both are funded by Revamp — the operator's base/payout
 * doesn't change; only what the guest pays via PayLink does.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupRedeemableGift, reserveGift, releaseGift, logGiftEvent } from "./giftcards.js";
import { attachCreditHold, creditBalanceFor, reserveCredit, returnCredit } from "./credit.js";
import { creditToApply } from "../shared/credit.js";

export interface Redeemed {
  giftId: string | null;
  giftApplied: number;
  giftBalanceAfter: number;
  creditHold: string | null;
  creditApplied: number;
}

export const NOTHING_REDEEMED: Redeemed = { giftId: null, giftApplied: 0, giftBalanceAfter: 0, creditHold: null, creditApplied: 0 };

export async function redeemForCheckout(
  admin: SupabaseClient | null,
  o: { userId: string; giftCode?: string; useCredit?: boolean; totalCents: number; currency: string },
): Promise<{ ok: true; r: Redeemed } | { ok: false; status: number; error: string }> {
  const r: Redeemed = { ...NOTHING_REDEEMED };
  if (!o.giftCode && !o.useCredit) return { ok: true, r };
  if (!admin) return { ok: false, status: 503, error: o.giftCode ? "Gift cards aren't available right now." : "Credit isn't available right now." };

  if (o.giftCode) {
    const look = await lookupRedeemableGift(admin, o.giftCode, o.currency);
    if ("error" in look) return { ok: false, status: 400, error: look.error };
    const applied = Math.min(look.balanceCents, o.totalCents);
    if (!(await reserveGift(admin, look.id, applied))) return { ok: false, status: 409, error: "That gift card balance just changed — please try again." };
    r.giftId = look.id;
    r.giftApplied = applied;
    r.giftBalanceAfter = look.balanceCents - applied;
  }

  if (o.useCredit) {
    const balance = await creditBalanceFor(admin, o.userId);
    const want = creditToApply(balance, o.totalCents - r.giftApplied);
    if (want > 0) {
      const hold = await reserveCredit(admin, o.userId, want);
      if (!hold) {
        await releaseRedeemed(admin, r);
        return { ok: false, status: 409, error: "Your Revamp credit balance just changed. Go back to review the total, then try again." };
      }
      r.creditHold = hold;
      r.creditApplied = want;
    }
  }
  return { ok: true, r };
}

/** Undo both reservations (checkout failed before a booking stood). */
export async function releaseRedeemed(admin: SupabaseClient | null, r: Redeemed): Promise<void> {
  if (!admin) return;
  if (r.giftId && r.giftApplied > 0) await releaseGift(admin, r.giftId, r.giftApplied);
  if (r.creditHold) await returnCredit(admin, r.creditHold);
}

/** Booking columns. Credit columns only when used, so inserts work before 0105 runs. */
export function redeemedColumns(r: Redeemed): Record<string, unknown> {
  return {
    gift_card_id: r.giftId,
    gift_applied_cents: r.giftApplied,
    ...(r.creditApplied > 0 ? { credit_applied_cents: r.creditApplied, credit_hold_id: r.creditHold } : {}),
  };
}

export const redeemedTotal = (r: Redeemed) => r.giftApplied + r.creditApplied;

/** Provider for a booking fully paid by gift card and/or credit (no PayLink). */
export const coveredProvider = (r: Redeemed) => (r.giftId ? "gift" : "credit");

/** After the booking row exists: gift ledger line + link the credit hold to it. */
export async function noteRedeemed(admin: SupabaseClient | null, r: Redeemed, bookingId: string | null, detail: string): Promise<void> {
  if (!admin) return;
  if (r.giftId && r.giftApplied > 0) await logGiftEvent(admin, r.giftId, "redeemed", { amountCents: r.giftApplied, balanceAfter: r.giftBalanceAfter, bookingId, detail });
  if (r.creditHold && bookingId) await attachCreditHold(admin, r.creditHold, bookingId);
}
