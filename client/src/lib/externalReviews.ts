/**
 * External reviews shown on listings, clearly attributed and separate from
 * native Revamp reviews:
 *   - Google Business: fetched live from /api/google-reviews (server → Places API).
 *   - Airbnb: host self-imported rows in `external_reviews` (migration 0046),
 *     public-read, operator-managed. Labeled "added by the host".
 */
import { supabase } from "@/lib/supabase";

export interface HostReview {
  id: string;
  source: "airbnb" | "booking";
  reviewerName: string;
  rating: number | null;
  body: string;
  reviewDate: string | null;
  /** null = applies to all the operator's listings; else this listing only. */
  listingId: string | null;
}

export interface HostReviewInput {
  source: "airbnb" | "booking";
  reviewerName: string;
  rating: number | null;
  body: string;
  reviewDate: string | null;
  listingId: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): HostReview {
  return { id: r.id, source: r.source, reviewerName: r.reviewer_name, rating: r.rating ?? null, body: r.body ?? "", reviewDate: r.review_date ?? null, listingId: r.listing_id ?? null };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Host-imported reviews for an operator (public read). select("*") stays
 *  resilient if the listing_id column (0047) hasn't been added yet. */
export async function listHostReviews(operatorId: string): Promise<HostReview[]> {
  const { data } = await supabase
    .from("external_reviews")
    .select("*")
    .eq("operator_id", operatorId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(mapRow);
}

export async function addHostReview(operatorId: string, input: HostReviewInput): Promise<void> {
  const { error } = await supabase.from("external_reviews").insert({
    operator_id: operatorId,
    source: input.source,
    reviewer_name: input.reviewerName,
    rating: input.rating,
    body: input.body,
    review_date: input.reviewDate,
    ...(input.listingId ? { listing_id: input.listingId } : {}),
  });
  if (error) throw new Error(error.message);
}

export async function deleteHostReview(id: string): Promise<void> {
  const { error } = await supabase.from("external_reviews").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface GoogleReviewsResult {
  configured: boolean;
  businessName?: string;
  rating?: number | null;
  total?: number;
  url?: string | null;
  reviews?: { author: string; rating: number; text: string; relativeTime: string; photo: string | null }[];
}

/** Translate review texts to `target` (server → Google Translation API, cached). */
export async function translateReviews(texts: string[], target = "en"): Promise<{ text: string; detected: string }[]> {
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts, target }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { results?: { text: string; detected: string }[] };
    return j.results ?? [];
  } catch {
    return [];
  }
}

/** Live Google Business reviews for an operator (server fetches via Places API). */
export async function fetchGoogleReviews(operatorId: string): Promise<GoogleReviewsResult> {
  try {
    const res = await fetch(`/api/google-reviews?operatorId=${encodeURIComponent(operatorId)}`);
    if (!res.ok) return { configured: false };
    return (await res.json()) as GoogleReviewsResult;
  } catch {
    return { configured: false };
  }
}
