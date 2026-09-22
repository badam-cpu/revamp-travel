/**
 * Google Business reviews via the Google **Places API (New)** — the v1 Place
 * Details endpoint (places.googleapis.com/v1/places/{id}). Fetched server-side
 * so the key isn't exposed and results can be cached briefly (Google policy:
 * Place IDs may be stored, but review content should be refreshed, not cached
 * long-term). Returns up to 5 reviews (Google's cap) plus the overall rating,
 * total count, and the Google Maps link for attribution.
 *
 * Key: GOOGLE_PLACES_API_KEY (a server-usable key with "Places API (New)"
 * enabled — no HTTP-referrer restriction). Falls back to VITE_GOOGLE_MAPS_API_KEY
 * only if that key allows server calls.
 */
export interface GoogleReview {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
  photo: string | null;
}

export interface GooglePlaceReviews {
  businessName: string;
  rating: number | null;
  total: number;
  url: string | null;
  reviews: GoogleReview[];
}

const CACHE_TTL_MS = 30 * 60_000; // 30 min
const cache = new Map<string, { data: GooglePlaceReviews | null; expires: number }>();

function apiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
}

export function googlePlacesConfigured(): boolean {
  return !!apiKey();
}

export async function fetchPlaceReviews(placeId: string): Promise<GooglePlaceReviews | null> {
  const key = apiKey();
  if (!key || !placeId) return null;

  const cached = cache.get(placeId);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "displayName,rating,userRatingCount,googleMapsUri,reviews",
      },
    });
    const json = (await res.json()) as {
      displayName?: { text?: string };
      rating?: number;
      userRatingCount?: number;
      googleMapsUri?: string;
      reviews?: {
        rating?: number;
        text?: { text?: string };
        originalText?: { text?: string };
        relativePublishTimeDescription?: string;
        authorAttribution?: { displayName?: string; photoUri?: string };
      }[];
    };
    if (!res.ok || (!json.reviews && json.rating === undefined)) {
      cache.set(placeId, { data: null, expires: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const data: GooglePlaceReviews = {
      businessName: json.displayName?.text ?? "",
      rating: typeof json.rating === "number" ? json.rating : null,
      total: json.userRatingCount ?? 0,
      url: json.googleMapsUri ?? null,
      reviews: (json.reviews ?? [])
        .map((rv) => ({
          author: rv.authorAttribution?.displayName ?? "Google user",
          rating: rv.rating ?? 0,
          text: (rv.text?.text || rv.originalText?.text || "").trim(),
          relativeTime: rv.relativePublishTimeDescription ?? "",
          photo: rv.authorAttribution?.photoUri ?? null,
        }))
        .filter((rv) => rv.text)
        .slice(0, 5),
    };
    cache.set(placeId, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.error("[google-places] fetch failed", err);
    return null;
  }
}
