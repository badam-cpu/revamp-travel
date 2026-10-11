/**
 * QR payment reconcile — the PRIMARY path that marks QR tips/service payments
 * paid. PayLink production has no auto-redirect back to the site, so the guest's
 * return (POST /api/qr-payment/confirm) often doesn't fire; this sweep (run by
 * the reconcile cron) polls every pending payment and confirms the ones PayLink
 * now reports approved, and expires 24h-stale holds. Service-role only.
 *
 * A payment taken on an operator's OWN PayLink (0094, paylink_account_owner set)
 * is verified with that account; once paid it's recorded on the direct-payment
 * ledger (commission billed monthly) and marked settled — Revamp owes nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientForOwner } from "./paymentAccounts.js";
import { recordDirectQrCharge } from "./directLedger.js";

interface QrRow {
  id: string;
  owner_id: string;
  amount_cents: number;
  currency?: string | null;
  kind?: string | null;
  paylink_request_id: string | null;
  paylink_order_id: string | null;
  paylink_account_owner?: string | null;
  created_at: string;
}

/** Mark a QR payment paid (guarded on pending) and, if direct, ledger it. */
export async function markQrPaymentPaid(admin: SupabaseClient, r: QrRow, orderId: string | null): Promise<boolean> {
  const now = new Date().toISOString();
  const direct = !!r.paylink_account_owner;
  const { data, error } = await admin
    .from("qr_payments")
    .update({
      status: "paid",
      paid_at: now,
      paylink_order_id: orderId ?? r.paylink_order_id,
      // Direct: the money is already the operator's — nothing for Revamp to settle.
      ...(direct ? { settled_at: now } : {}),
    })
    .eq("id", r.id)
    .eq("status", "pending_payment")
    .select("id");
  if (error || !data?.length) return false;
  if (direct) {
    await recordDirectQrCharge(admin, {
      id: r.id,
      owner_id: r.owner_id,
      amount_cents: r.amount_cents,
      currency: r.currency,
      label: r.kind === "tip" ? "QR tip" : "QR service payment",
    });
  }
  return true;
}

export async function reconcileQrPayments(admin: SupabaseClient, { limit = 200 }: { limit?: number } = {}): Promise<{ paid: number; expired: number }> {
  const { data: rows } = await admin
    .from("qr_payments")
    .select("*")
    .eq("status", "pending_payment")
    .order("created_at", { ascending: true })
    .limit(limit);
  let paid = 0;
  let expired = 0;
  for (const r of (rows ?? []) as QrRow[]) {
    try {
      const client = await clientForOwner(admin, r.paylink_account_owner);
      const check = client ? await client.checkPayment({ requestId: r.paylink_request_id, orderId: r.paylink_order_id }) : null;
      if (check?.approved) {
        if (await markQrPaymentPaid(admin, r, check.orderId ?? null)) paid++;
      } else if (Date.now() - new Date(r.created_at).getTime() > 24 * 60 * 60 * 1000) {
        await admin.from("qr_payments").update({ status: "expired" }).eq("id", r.id).eq("status", "pending_payment");
        expired++;
      }
    } catch {
      /* keep going — one bad record shouldn't stop the sweep */
    }
  }
  return { paid, expired };
}
