/**
 * Google Business reviews via the Google Places API (Place Details). Fetched
 * server-side so the key isn't exposed and results can be cached briefly (Google
 * policy: Place IDs may be stored, but review content should be refreshed, not
 * cached long-term). Returns up to 5 reviews (Google's cap) plus the overall
 * rating, total count, and the link to the Google listing for attribution.
 *
 * Key: GOOGLE_PLACES_API_KEY (a server-usable key with the Places API enabled).
 * Falls back to VITE_GOOGLE_MAPS_API_KEY only if that key allows server calls
 * (a browser key restricted to HTTP referrers will NOT work here).
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
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("fields", "name,rating,user_ratings_total,url,reviews");
    url.searchParams.set("reviews_sort", "newest");
    url.searchParams.set("key", key);
    const res = await fetch(url.toString());
    const json = (await res.json()) as {
      status?: string;
      result?: {
        name?: string;
        rating?: number;
        user_ratings_total?: number;
        url?: string;
        reviews?: { author_name?: string; rating?: number; text?: string; relative_time_description?: string; profile_photo_url?: string }[];
      };
    };
    if (json.status !== "OK" || !json.result) {
      cache.set(placeId, { data: null, expires: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const r = json.result;
    const data: GooglePlaceReviews = {
      businessName: r.name ?? "",
      rating: typeof r.rating === "number" ? r.rating : null,
      total: r.user_ratings_total ?? 0,
      url: r.url ?? null,
      reviews: (r.reviews ?? [])
        .filter((rv) => (rv.text ?? "").trim())
        .slice(0, 5)
        .map((rv) => ({
          author: rv.author_name ?? "Google user",
          rating: rv.rating ?? 0,
          text: rv.text ?? "",
          relativeTime: rv.relative_time_description ?? "",
          photo: rv.profile_photo_url ?? null,
        })),
    };
    cache.set(placeId, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.error("[google-places] fetch failed", err);
    return null;
  }
}
