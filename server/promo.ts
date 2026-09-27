/**
 * Server-side promo-code resolution. Validates an operator's code against the
 * booking context (code window, travel window, allowed weekdays, min stay, usage
 * caps, listing scope) using the service-role client — promo_codes are not
 * traveler-readable. The discount amount itself is computed by the caller with
 * shared/promo.ts once the base is known. Usage is counted from bookings that
 * carry promo_code_id (so a cancelled booking automatically frees a use).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { nightsBetween } from "../shared/bookings.js";
import type { PromoType } from "../shared/promo.js";

export interface ResolvedPromo {
  id: string;
  discount_type: PromoType;
  discount_value: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function resolvePromo(
  admin: SupabaseClient,
  opts: { listingId: string; operatorId: string; code: string; travelerId: string | null; startDate: string; endDate: string; listingType: string },
): Promise<{ ok: true; promo: ResolvedPromo } | { ok: false; error: string }> {
  const code = (opts.code || "").trim();
  if (!code) return { ok: false, error: "Enter a code." };

  const { data: p } = await admin
    .from("promo_codes")
    .select("id, listing_id, discount_type, discount_value, code_starts_at, code_ends_at, travel_start, travel_end, allowed_days, min_stay_nights, max_redemptions, per_user_limit, active")
    .eq("operator_id", opts.operatorId)
    .ilike("code", code)
    .maybeSingle();
  if (!p || !p.active) return { ok: false, error: "That code isn't valid." };

  if (p.listing_id && p.listing_id !== opts.listingId) return { ok: false, error: "This code isn't valid for this listing." };

  const today = ymd(new Date());
  if (p.code_starts_at && today < (p.code_starts_at as string)) return { ok: false, error: "This code isn't active yet." };
  if (p.code_ends_at && today > (p.code_ends_at as string)) return { ok: false, error: "This code has expired." };

  if (p.travel_start && opts.startDate < (p.travel_start as string)) return { ok: false, error: `This code is valid for travel from ${p.travel_start}.` };
  if (p.travel_end && opts.startDate > (p.travel_end as string)) return { ok: false, error: `This code is valid for travel until ${p.travel_end}.` };

  const allowed = (p.allowed_days as number[] | null) ?? [];
  if (allowed.length) {
    const weekday = new Date(opts.startDate + "T00:00:00Z").getUTCDay();
    if (!allowed.includes(weekday)) return { ok: false, error: "This code isn't valid for the selected day." };
  }

  if (p.min_stay_nights && opts.listingType === "stay") {
    if (nightsBetween(opts.startDate, opts.endDate) < (p.min_stay_nights as number)) {
      return { ok: false, error: `This code needs a minimum ${p.min_stay_nights}-night stay.` };
    }
  }

  if (p.max_redemptions != null) {
    const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("promo_code_id", p.id).neq("status", "cancelled");
    if ((count ?? 0) >= (p.max_redemptions as number)) return { ok: false, error: "This code has reached its usage limit." };
  }
  if (p.per_user_limit != null && opts.travelerId) {
    const { count } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("promo_code_id", p.id)
      .eq("traveler_id", opts.travelerId)
      .neq("status", "cancelled");
    if ((count ?? 0) >= (p.per_user_limit as number)) return { ok: false, error: "You've already used this code." };
  }

  return { ok: true, promo: { id: p.id as string, discount_type: p.discount_type as PromoType, discount_value: p.discount_value as number } };
}
