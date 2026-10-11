/**
 * Direct-payment ledger (migration 0094). When a guest pays an operator's OWN
 * PayLink account, Revamp doesn't hold the money, so instead of a `payouts` row
 * (Revamp owes the operator) we record what the operator owes Revamp:
 *
 *   commission (on the pre-tax base, operator's resolved rate) + add-ons
 *   − the Revamp gift-card portion the guest redeemed (Revamp owes that)
 *
 * These rows are rolled into the monthly commission statement
 * (server/commissionStatements.ts). All writes are service-role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBookingCharge, PLATFORM_COMMISSION_PERCENT } from "../shared/bookings.js";

export interface DirectBookingLike {
  id: string;
  paylink_account_owner?: string | null;
  base_cents?: number | null;
  amount_cents: number;
  addons_cents?: number | null;
  gift_applied_cents?: number | null;
  currency?: string | null;
}

/** What one direct booking puts on the operator's statement (pure; unit-tested). */
export function directBookingDue(b: DirectBookingLike, commissionPercent: number) {
  const base = b.base_cents ?? b.amount_cents;
  const commission = computeBookingCharge(base, commissionPercent).commissionCents;
  const addons = Math.max(0, b.addons_cents ?? 0);
  const giftCredit = Math.max(0, b.gift_applied_cents ?? 0);
  return { commission, addons, giftCredit, netDue: commission + addons - giftCredit };
}

/** Record a confirmed direct booking (idempotent: one charge row per booking). */
export async function recordDirectBookingCharge(
  admin: SupabaseClient,
  b: DirectBookingLike,
  ctx: { operatorId: string; listingTitle?: string | null; commissionPercent: number },
): Promise<void> {
  const due = directBookingDue(b, ctx.commissionPercent);
  const { error } = await admin.from("direct_payment_ledger").insert({
    operator_id: ctx.operatorId,
    kind: "charge",
    booking_id: b.id,
    listing_title: ctx.listingTitle ?? null,
    commission_cents: due.commission,
    addons_cents: due.addons,
    gift_credit_cents: due.giftCredit,
    net_due_cents: due.netDue,
    currency: b.currency ?? "AMD",
  });
  // A second confirm hits the partial unique index (one charge per booking) —
  // harmless; anything else is logged.
  if (error && !/duplicate|unique/i.test(error.message)) console.error("[direct-ledger] booking charge", b.id, error.message);
}

/** Record a paid direct QR payment (12.5% commission, no tax, no add-ons). */
export async function recordDirectQrCharge(
  admin: SupabaseClient,
  q: { id: string; owner_id: string; amount_cents: number; currency?: string | null; label?: string | null },
): Promise<void> {
  const commission = Math.round((q.amount_cents * PLATFORM_COMMISSION_PERCENT) / 100);
  const { error } = await admin.from("direct_payment_ledger").insert({
    operator_id: q.owner_id,
    kind: "charge",
    qr_payment_id: q.id,
    listing_title: q.label ?? "QR payment",
    commission_cents: commission,
    net_due_cents: commission,
    currency: q.currency ?? "AMD",
  });
  if (error && !/duplicate|unique/i.test(error.message)) console.error("[direct-ledger] qr charge", q.id, error.message);
}

/**
 * A direct booking was cancelled: an unbilled charge is voided; one already on
 * a statement gets a negative adjustment so the next statement credits it.
 */
export async function reverseDirectBookingCharge(admin: SupabaseClient, bookingId: string): Promise<void> {
  const { data: row } = await admin
    .from("direct_payment_ledger")
    .select("id, operator_id, status, net_due_cents, commission_cents, addons_cents, gift_credit_cents, currency, listing_title")
    .eq("booking_id", bookingId)
    .eq("kind", "charge")
    .maybeSingle();
  if (!row) return;
  if (row.status === "open") {
    await admin.from("direct_payment_ledger").update({ status: "void" }).eq("id", row.id).eq("status", "open");
    return;
  }
  if (row.status !== "billed") return;
  const { count } = await admin
    .from("direct_payment_ledger")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", bookingId)
    .eq("kind", "adjustment");
  if ((count ?? 0) > 0) return; // already credited
  await admin.from("direct_payment_ledger").insert({
    operator_id: row.operator_id,
    kind: "adjustment",
    booking_id: bookingId,
    listing_title: row.listing_title ? `Cancelled — ${row.listing_title}` : "Cancelled booking",
    commission_cents: -row.commission_cents,
    addons_cents: -row.addons_cents,
    gift_credit_cents: -row.gift_credit_cents,
    net_due_cents: -row.net_due_cents,
    currency: row.currency,
  });
}
