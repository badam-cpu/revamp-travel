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

/** True only when a dedicated SERVER key is set (a referrer-restricted browser
 *  key can't make server-side Places calls, so the VITE fallback doesn't count). */
export function placesServerKeySet(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

/** Details used to pre-fill a curated "eat" listing from a Google Place. */
export interface GooglePlaceDetails {
  placeId: string;
  name: string;
  rating: number | null;
  ratingCount: number;
  address: string | null;
  website: string | null;
  googleMapsUri: string | null;
  priceBand: "$" | "$$" | "$$$" | null;
  lat: number | null;
  lng: number | null;
  summary: string | null;
}

// Google PRICE_LEVEL_* → our $/$$/$$$ band (VERY_EXPENSIVE folds into $$$).
function priceBand(level?: string): "$" | "$$" | "$$$" | null {
  switch (level) {
    case "PRICE_LEVEL_INEXPENSIVE":
      return "$";
    case "PRICE_LEVEL_MODERATE":
      return "$$";
    case "PRICE_LEVEL_EXPENSIVE":
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "$$$";
    default:
      return null;
  }
}

/** One-shot Place Details for admin curation (name, rating, address, website…). */
export async function fetchPlaceDetails(placeId: string): Promise<GooglePlaceDetails | null> {
  const key = apiKey();
  if (!key || !placeId) throw new Error("No Google Places server key is configured.");
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,formattedAddress,websiteUri,googleMapsUri,priceLevel,location,editorialSummary",
    },
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    displayName?: { text?: string };
    rating?: number;
    userRatingCount?: number;
    formattedAddress?: string;
    websiteUri?: string;
    googleMapsUri?: string;
    priceLevel?: string;
    location?: { latitude?: number; longitude?: number };
    editorialSummary?: { text?: string };
    error?: { message?: string; status?: string };
  };
  if (!res.ok || !json.id) {
    // Surface Google's own reason so the admin sees exactly what's wrong.
    const msg = json.error?.message || `Google returned HTTP ${res.status}.`;
    console.error("[google-places] details non-ok", res.status, JSON.stringify(json).slice(0, 400));
    throw new Error(msg);
  }
  return {
    placeId: json.id,
    name: json.displayName?.text ?? "",
    rating: typeof json.rating === "number" ? json.rating : null,
    ratingCount: json.userRatingCount ?? 0,
    address: json.formattedAddress ?? null,
    website: json.websiteUri ?? null,
    googleMapsUri: json.googleMapsUri ?? null,
    priceBand: priceBand(json.priceLevel),
    lat: typeof json.location?.latitude === "number" ? json.location.latitude : null,
    lng: typeof json.location?.longitude === "number" ? json.location.longitude : null,
    summary: json.editorialSummary?.text ?? null,
  };
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
