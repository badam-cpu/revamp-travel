/**
 * Restaurant-voucher server logic (consignment). Analog of server/giftcards.ts:
 * purchase is a PayLink payment (registered in the route); this module activates
 * a paid voucher (assign a single-use code + expiry, email the buyer), reconciles
 * unpaid ones, and handles customer-initiated in-venue redemption (atomic, single
 * use). All writes are service-role — restaurant_vouchers has no client write policy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPayment } from "./paylink.js";
import { sendVoucherPurchased } from "./email.js";
import { VOUCHER_VALID_MONTHS } from "../shared/vouchers.js";

export interface VoucherRow {
  id: string;
  code: string | null;
  status: string;
  listing_id: string;
  face_cents: number;
  price_cents: number;
  commission_percent: number;
  currency: string;
  purchaser_id: string | null;
  purchaser_email: string | null;
  paylink_request_id: string | null;
  paylink_order_id: string | null;
  expires_at: string | null;
  redeemed_at: string | null;
  created_at: string;
}

const VOUCHER_COLS =
  "id, code, status, listing_id, face_cents, price_cents, commission_percent, currency, purchaser_id, purchaser_email, paylink_request_id, paylink_order_id, expires_at, redeemed_at, created_at";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
function randomCode(): string {
  const block = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  return `RV-${block()}-${block()}`;
}

const TERMINAL_FAIL = /fail|declin|cancel|expire|reject/i;

/** Activate a paid voucher: assign a unique code + expiry, email the buyer. */
async function activateVoucher(admin: SupabaseClient, row: VoucherRow, orderId: string | null): Promise<boolean> {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + VOUCHER_VALID_MONTHS);
  let assigned: string | null = null;
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    const { data, error } = await admin
      .from("restaurant_vouchers")
      .update({ status: "active", code, expires_at: expires.toISOString(), paylink_order_id: orderId ?? row.paylink_order_id })
      .eq("id", row.id)
      .eq("status", "pending_payment")
      .select("id, code")
      .maybeSingle();
    if (data?.code) {
      assigned = data.code as string;
      break;
    }
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("[voucher activate]", error.message);
      return false;
    }
    // 23505 (code collision) or a concurrent activate — if it's already active, done.
    const { data: cur } = await admin.from("restaurant_vouchers").select("status").eq("id", row.id).maybeSingle();
    if (cur?.status === "active") return true;
  }
  if (!assigned) return false;

  if (row.purchaser_email) {
    const { data: listing } = await admin.from("listings").select("title").eq("id", row.listing_id).maybeSingle();
    try {
      await sendVoucherPurchased(row.purchaser_email, {
        restaurantTitle: (listing?.title as string) ?? "the restaurant",
        code: assigned,
        faceCents: row.face_cents,
        currency: row.currency,
        expiresAt: expires.toISOString(),
      });
    } catch (e) {
      console.error("[voucher activate] email", e);
    }
  }
  return true;
}

export async function confirmVoucherRow(admin: SupabaseClient, row: VoucherRow): Promise<boolean> {
  if (row.status === "active") return true;
  if (row.status !== "pending_payment") return false;
  const check = await checkPayment({ requestId: row.paylink_request_id, orderId: row.paylink_order_id });
  if (!check.ok) return false;
  if (!check.approved) {
    if (TERMINAL_FAIL.test(String(check.status))) {
      await admin.from("restaurant_vouchers").update({ status: "cancelled" }).eq("id", row.id).eq("status", "pending_payment");
    }
    return false;
  }
  return activateVoucher(admin, row, check.orderId ?? null);
}

/** Poll a buyer's recent pending vouchers (on their return from PayLink). */
export async function reconcilePurchaserVouchers(admin: SupabaseClient, purchaserId: string): Promise<{ activated: number }> {
  const { data } = await admin
    .from("restaurant_vouchers")
    .select(VOUCHER_COLS)
    .eq("purchaser_id", purchaserId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(10);
  let activated = 0;
  for (const row of (data ?? []) as VoucherRow[]) if (await confirmVoucherRow(admin, row)) activated++;
  return { activated };
}

/** Cron sweep: activate paid vouchers whose buyer never returned, expire stale
 *  unpaid holds, and expire active vouchers past their validity. */
export async function reconcileAllVouchers(
  admin: SupabaseClient,
  { limit = 100, minAgeMinutes = 2, expireAfterHours = 48 }: { limit?: number; minAgeMinutes?: number; expireAfterHours?: number } = {},
): Promise<{ polled: number; activated: number; cancelled: number }> {
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString();
  const { data } = await admin
    .from("restaurant_vouchers")
    .select(VOUCHER_COLS)
    .eq("status", "pending_payment")
    .lt("created_at", cutoff)
    .limit(limit);
  const rows = (data ?? []) as VoucherRow[];
  let activated = 0;
  for (const row of rows) if (await confirmVoucherRow(admin, row)) activated++;

  const expireCutoff = new Date(Date.now() - expireAfterHours * 3_600_000).toISOString();
  const { data: stale } = await admin
    .from("restaurant_vouchers")
    .update({ status: "cancelled" })
    .eq("status", "pending_payment")
    .lt("created_at", expireCutoff)
    .select("id");
  await admin.from("restaurant_vouchers").update({ status: "expired" }).eq("status", "active").lt("expires_at", new Date().toISOString());
  return { polled: rows.length, activated, cancelled: stale?.length ?? 0 };
}

/** Restaurant-side redemption (model B): staff enter the code shown by the guest
 *  in the per-restaurant validator (authorized by its secret redeem_token). Atomic
 *  single-use, scoped to the token's restaurant. */
export async function redeemVoucherByCode(
  admin: SupabaseClient,
  opts: { token: string; code: string },
): Promise<{ ok: true; restaurantTitle: string; faceCents: number; currency: string } | { ok: false; error: string }> {
  const token = (opts.token || "").trim();
  const code = (opts.code || "").trim();
  if (!token || !code) return { ok: false, error: "Enter the voucher code." };

  const { data: offer } = await admin.from("restaurant_voucher_offers").select("listing_id, redeem_active").eq("redeem_token", token).maybeSingle();
  if (!offer) return { ok: false, error: "Invalid redemption link." };
  if (!offer.redeem_active) return { ok: false, error: "Redemption is currently turned off for this restaurant." };

  const { data: v } = await admin
    .from("restaurant_vouchers")
    .select("id, status, expires_at, face_cents, currency, listing_id")
    .ilike("code", code)
    .maybeSingle();
  if (!v || v.listing_id !== offer.listing_id) return { ok: false, error: "That code isn't valid for this restaurant." };
  if (v.status === "redeemed") return { ok: false, error: "This voucher was already redeemed." };
  if (v.status === "expired" || (v.expires_at && Date.parse(v.expires_at as string) < Date.now())) {
    if (v.status === "active") await admin.from("restaurant_vouchers").update({ status: "expired" }).eq("id", v.id).eq("status", "active");
    return { ok: false, error: "This voucher has expired." };
  }
  if (v.status !== "active") return { ok: false, error: "This voucher isn't active." };

  const { data: upd } = await admin.from("restaurant_vouchers").update({ status: "redeemed", redeemed_at: new Date().toISOString() }).eq("id", v.id).eq("status", "active").select("id").maybeSingle();
  if (!upd) return { ok: false, error: "This voucher was just redeemed." };

  const { data: listing } = await admin.from("listings").select("title").eq("id", v.listing_id).maybeSingle();
  return { ok: true, restaurantTitle: (listing?.title as string) ?? "Restaurant", faceCents: v.face_cents as number, currency: v.currency as string };
}

/** Customer-initiated, single-use in-venue redemption. Atomic: only the first
 *  attempt on an active, unexpired voucher owned by the caller succeeds. */
export async function redeemVoucher(admin: SupabaseClient, voucherId: string, purchaserId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: v } = await admin
    .from("restaurant_vouchers")
    .select("id, status, purchaser_id, expires_at")
    .eq("id", voucherId)
    .maybeSingle();
  if (!v) return { ok: false, error: "Voucher not found." };
  if (v.purchaser_id !== purchaserId) return { ok: false, error: "That's not your voucher." };
  if (v.status === "redeemed") return { ok: false, error: "This voucher was already redeemed." };
  if (v.status === "expired" || (v.expires_at && Date.parse(v.expires_at as string) < Date.now())) {
    if (v.status === "active") await admin.from("restaurant_vouchers").update({ status: "expired" }).eq("id", voucherId).eq("status", "active");
    return { ok: false, error: "This voucher has expired." };
  }
  if (v.status !== "active") return { ok: false, error: "This voucher isn't active yet." };
  const { data: upd } = await admin
    .from("restaurant_vouchers")
    .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
    .eq("id", voucherId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (!upd) return { ok: false, error: "This voucher was just redeemed." };
  return { ok: true };
}
