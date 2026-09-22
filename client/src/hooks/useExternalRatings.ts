/**
 * Card star ratings from real host-imported (external) reviews — loaded ONCE for
 * the whole app (a single public query, module-cached) so a grid of cards costs
 * one request, not one per card. Honest: the score is the average of genuine
 * imported review ratings for that listing (listing-specific + the operator's
 * operator-wide imports). Returns null when there are none, so cards show no
 * rating rather than a fabricated one. (Google Business ratings are business-
 * level and fetched live per listing page, not aggregated onto cards here.)
 *
 * At larger scale this should move to a grouped DB view; fine for now.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Agg {
  sum: number;
  count: number;
}
type Index = Map<string, Agg>;

let cachePromise: Promise<Index> | null = null;

async function load(): Promise<Index> {
  const idx: Index = new Map();
  const { data } = await supabase.from("external_reviews").select("operator_id, listing_id, rating").limit(5000);
  const add = (key: string, rating: number) => {
    const a = idx.get(key) ?? { sum: 0, count: 0 };
    a.sum += rating;
    a.count += 1;
    idx.set(key, a);
  };
  for (const r of (data ?? []) as { operator_id: string; listing_id: string | null; rating: number | null }[]) {
    if (typeof r.rating !== "number") continue;
    add(r.listing_id ? `${r.operator_id}|${r.listing_id}` : `${r.operator_id}|*`, r.rating);
  }
  return idx;
}

export function useExternalRatings(): (operatorId?: string, listingId?: string) => { avg: number; count: number } | null {
  const [idx, setIdx] = useState<Index | null>(null);
  useEffect(() => {
    if (!cachePromise) cachePromise = load();
    let active = true;
    cachePromise.then((m) => active && setIdx(m)).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (operatorId, listingId) => {
    if (!idx || !operatorId || operatorId === "seed") return null;
    const listing = listingId ? idx.get(`${operatorId}|${listingId}`) : undefined;
    const wide = idx.get(`${operatorId}|*`);
    let sum = 0;
    let count = 0;
    if (listing) {
      sum += listing.sum;
      count += listing.count;
    }
    if (wide) {
      sum += wide.sum;
      count += wide.count;
    }
    if (count === 0) return null;
    return { avg: sum / count, count };
  };
}
