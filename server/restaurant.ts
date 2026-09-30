/**
 * Restaurant owner dashboard data (migration 0078). A venue manager sees their
 * own restaurant's numbers at /venue. Restaurants are house-owned and stay
 * non-editable — this is read-only insight, aggregated SERVER-SIDE (service role)
 * after verifying the caller manages the listing, so no extra RLS is needed on
 * the analytics / voucher tables.
 *
 * Returns: engagement analytics (impression/view/directions/website/call/menu/
 * save totals + a daily series) and voucher performance (sold / redeemed /
 * outstanding, plus the payout Revamp owes the venue on redeemed-but-unsettled
 * vouchers — the consignment settlement figure).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { voucherPayoutCents } from "../shared/vouchers.js";

export interface ManagedVenue { id: string; title: string; city: string }

const ANALYTICS_KINDS = ["impression", "view", "directions", "website", "call", "menu", "save", "share", "card_click"] as const;

/** The eat listings a user manages (empty for a normal traveler). */
export async function listManagedVenues(admin: SupabaseClient, userId: string): Promise<ManagedVenue[]> {
  const { data: links } = await admin.from("restaurant_managers").select("listing_id").eq("user_id", userId);
  const ids = (links ?? []).map((r) => (r as { listing_id: string }).listing_id);
  if (ids.length === 0) return [];
  const { data: rows } = await admin.from("listings").select("id, title, city").in("id", ids);
  return (rows ?? []).map((r) => {
    const l = r as { id: string; title: string; city: string };
    return { id: l.id, title: l.title, city: l.city };
  });
}

function dayList(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  return days;
}

export interface VenueSummary {
  windowDays: number;
  analytics: { totals: Record<string, number>; days: string[]; views: number[]; impressions: number[] };
  vouchers: {
    soldCount: number; soldFaceCents: number; revenueCents: number;
    redeemedCount: number; redeemedFaceCents: number;
    outstandingCount: number; outstandingFaceCents: number;
    payoutOwedCents: number; payoutSettledCents: number; currency: string;
  };
  redeemToken: string | null;
}

/** Full dashboard summary for one venue. Caller membership is verified upstream. */
export async function venueSummary(admin: SupabaseClient, listingId: string, windowDays: number): Promise<VenueSummary> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const days = dayList(windowDays);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const [analyticsRes, vouchersRes, offerRes] = await Promise.all([
    admin.from("listing_analytics_daily").select("day, kind, count").eq("listing_id", listingId).gte("day", since),
    admin.from("restaurant_vouchers").select("status, face_cents, price_cents, commission_percent, currency, settled_at").eq("listing_id", listingId),
    admin.from("restaurant_voucher_offers").select("redeem_token").eq("listing_id", listingId).maybeSingle(),
  ]);

  const totals: Record<string, number> = {};
  for (const k of ANALYTICS_KINDS) totals[k] = 0;
  const views = new Array(days.length).fill(0);
  const impressions = new Array(days.length).fill(0);
  for (const r of (analyticsRes.data ?? []) as { day: string; kind: string; count: number }[]) {
    totals[r.kind] = (totals[r.kind] ?? 0) + r.count;
    const i = dayIndex.get(r.day);
    if (i != null) {
      if (r.kind === "view") views[i] += r.count;
      else if (r.kind === "impression") impressions[i] += r.count;
    }
  }

  const v = {
    soldCount: 0, soldFaceCents: 0, revenueCents: 0,
    redeemedCount: 0, redeemedFaceCents: 0,
    outstandingCount: 0, outstandingFaceCents: 0,
    payoutOwedCents: 0, payoutSettledCents: 0, currency: "AMD",
  };
  for (const row of (vouchersRes.data ?? []) as { status: string; face_cents: number; price_cents: number; commission_percent: number; currency: string; settled_at: string | null }[]) {
    if (row.currency) v.currency = row.currency;
    const paid = row.status === "active" || row.status === "redeemed" || row.status === "expired";
    if (paid) { v.soldCount++; v.soldFaceCents += row.face_cents; v.revenueCents += row.price_cents; }
    if (row.status === "active") { v.outstandingCount++; v.outstandingFaceCents += row.face_cents; }
    if (row.status === "redeemed") {
      v.redeemedCount++; v.redeemedFaceCents += row.face_cents;
      const payout = voucherPayoutCents(row.face_cents, row.commission_percent);
      if (row.settled_at) v.payoutSettledCents += payout;
      else v.payoutOwedCents += payout;
    }
  }

  return {
    windowDays,
    analytics: { totals, days, views, impressions },
    vouchers: v,
    redeemToken: (offerRes.data as { redeem_token: string | null } | null)?.redeem_token ?? null,
  };
}
