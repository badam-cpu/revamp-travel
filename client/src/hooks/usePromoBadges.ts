/**
 * Public promo badges for listing cards/pages — loaded ONCE for the whole app
 * (a single public query, module-cached) so a grid of cards costs one request.
 * Only codes an operator explicitly marked "show on listing" (and active) are
 * readable here (RLS); secret codes never surface. A code scoped to a listing
 * badges that listing; an operator-wide code (listing_id null) badges all of
 * that operator's listings.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { PromoType } from "@shared/promo";

export interface PromoBadge {
  listing_id: string | null;
  operator_id: string;
  discount_type: PromoType;
  discount_value: number;
  tag_label: string | null;
}

let cachePromise: Promise<PromoBadge[]> | null = null;

async function load(): Promise<PromoBadge[]> {
  const { data } = await supabase
    .from("promo_codes")
    .select("listing_id, operator_id, discount_type, discount_value, tag_label")
    .eq("active", true)
    .eq("show_on_listing", true)
    .limit(2000);
  return (data as PromoBadge[]) ?? [];
}

export function usePromoBadges(): (listingId?: string, operatorId?: string) => PromoBadge | null {
  const [rows, setRows] = useState<PromoBadge[] | null>(null);
  useEffect(() => {
    if (!cachePromise) cachePromise = load();
    let active = true;
    cachePromise.then((r) => active && setRows(r)).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (listingId, operatorId) => {
    if (!rows || !listingId) return null;
    // Prefer a listing-specific badge, then an operator-wide one.
    return rows.find((p) => p.listing_id === listingId) || (operatorId ? rows.find((p) => !p.listing_id && p.operator_id === operatorId) : undefined) || null;
  };
}
