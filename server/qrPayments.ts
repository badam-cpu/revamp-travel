/**
 * QR payment reconcile — the PRIMARY path that marks QR tips/service payments
 * paid. PayLink production has no auto-redirect back to the site, so the guest's
 * return (POST /api/qr-payment/confirm) often doesn't fire; this sweep (run by
 * the reconcile cron) polls every pending payment and confirms the ones PayLink
 * now reports approved, and expires 24h-stale holds. Service-role only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPayment } from "./paylink.js";

export async function reconcileQrPayments(admin: SupabaseClient, { limit = 200 }: { limit?: number } = {}): Promise<{ paid: number; expired: number }> {
  const { data: rows } = await admin
    .from("qr_payments")
    .select("id, paylink_request_id, paylink_order_id, created_at")
    .eq("status", "pending_payment")
    .order("created_at", { ascending: true })
    .limit(limit);
  let paid = 0;
  let expired = 0;
  for (const r of (rows ?? []) as { id: string; paylink_request_id: string | null; paylink_order_id: string | null; created_at: string }[]) {
    try {
      const check = await checkPayment({ requestId: r.paylink_request_id, orderId: r.paylink_order_id });
      if (check.approved) {
        await admin
          .from("qr_payments")
          .update({ status: "paid", paid_at: new Date().toISOString(), paylink_order_id: check.orderId ?? r.paylink_order_id })
          .eq("id", r.id)
          .eq("status", "pending_payment");
        paid++;
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
