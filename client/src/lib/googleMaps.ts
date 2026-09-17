/**
 * Loader for the Google Maps JavaScript API — shared by the dashboard's
 * address-autocomplete field (client/src/components/PlaceAutocomplete.tsx) and
 * the listings map (client/src/components/ArmeniaMap.tsx). Hand-written single
 * script tag rather than pulling in @googlemaps/js-api-loader: not enough
 * surface to justify a dependency.
 *
 * Entirely optional: if `VITE_GOOGLE_MAPS_API_KEY` isn't set, `ensureMapsScript`
 * resolves to `false` and callers degrade gracefully (PlaceAutocomplete renders
 * nothing; ArmeniaMap shows a neutral placeholder). Only one `<script>` is ever
 * added no matter how many components ask, so the two features share one load.
 *
 * A note on reading autocomplete results defensively: `PlaceAutocompleteElement`
 * is a Google web component still under active revision upstream. The installed
 * `@types/google.maps` package doesn't necessarily match the exact event shape
 * Google's live service returns (we found the installed types describe an older
 * `event.place` shape while current docs describe
 * `event.placePrediction.toPlace()` + `fetchFields()`). `extractResolvedPlace()`
 * checks for both at runtime — it's the one function to update if Google changes
 * this again.
 */

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export const isGoogleMapsConfigured = Boolean(apiKey);

let scriptPromise: Promise<boolean> | null = null;

/**
 * Loads the Maps JS API `<script>` exactly once (shared across callers) and
 * resolves `true` when `google.maps.importLibrary` is available, or `false`
 * if there's no API key or the script failed to load. Never throws. Callers
 * then `await google.maps.importLibrary("maps" | "marker" | "places")` for the
 * specific pieces they need.
 */
export function ensureMapsScript(): Promise<boolean> {
  if (!apiKey) return Promise.resolve(false);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    // The ambient google.maps types declare `google` as always-present, which
    // isn't true before the script loads — read via globalThis to sidestep the
    // "always truthy" narrowing and reflect the real "maybe not loaded" state.
    const existing = (globalThis as Record<string, unknown>).google as typeof google | undefined;
    if (existing?.maps?.importLibrary) {
      resolve(true);
      return;
    }

    const callbackName = "__revampGoogleMapsReady";
    (window as unknown as Record<string, () => void>)[callbackName] = () => resolve(true);
    const script = document.createElement("script");
    // v=weekly is Google's recommended default channel; if PlaceAutocompleteElement
    // comes back unavailable, v=beta is the one place to try (see the address
    // autocomplete delta's notes).
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      console.error("Google Maps script failed to load");
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface NearbyPlaceResult {
  name: string;
  category?: string;
  distanceM?: number;
}

/** Great-circle metres between two lat/lng points (Haversine). */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

// Sightseeing-oriented Google Place types (New Places API, Table A). This is
// what a guest wants under "what's nearby" — landmarks, museums, parks — not
// other apartments/hotels. A minimal, definitely-valid subset is used as a
// fallback if the full list is ever rejected, so one bad type can't blank it.
const SIGHT_TYPES = [
  "tourist_attraction", "museum", "art_gallery", "park", "historical_landmark", "monument",
  "plaza", "national_park", "church", "zoo", "aquarium", "amusement_park", "botanical_garden",
  "performing_arts_theater",
];
const SIGHT_TYPES_SAFE = ["tourist_attraction", "museum", "park"];

/**
 * Real sightseeing spots around a listing's coordinates, via Google Places
 * (New) `Place.searchNearby` — restricted to attraction/landmark types and with
 * lodging excluded, ranked by distance. Returns up to `limit` places,
 * de-duplicated by name. Never throws — resolves to `[]` if the key/library is
 * unavailable or the call fails, so a save never breaks over this. Types on the
 * New Places API lag the installed @types, so results are read via casts.
 */
export async function fetchNearbyPlaces(lat: number, lng: number, limit = 7): Promise<NearbyPlaceResult[]> {
  const ready = await ensureMapsScript();
  if (!ready) return [];
  try {
    const lib = (await google.maps.importLibrary("places")) as unknown as {
      Place: { searchNearby: (req: unknown) => Promise<{ places: unknown[] }> };
      SearchNearbyRankPreference: { DISTANCE: unknown };
    };
    const search = (includedTypes: string[]) =>
      lib.Place.searchNearby({
        fields: ["displayName", "location", "primaryTypeDisplayName"],
        locationRestriction: { center: { lat, lng }, radius: 2500 },
        includedTypes,
        excludedTypes: ["lodging"],
        maxResultCount: 20,
        rankPreference: lib.SearchNearbyRankPreference.DISTANCE,
      });

    let places: unknown[] = [];
    try {
      ({ places } = await search(SIGHT_TYPES));
    } catch {
      // A rejected type list aborts the whole request — retry with the safe subset.
      ({ places } = await search(SIGHT_TYPES_SAFE));
    }

    const out: NearbyPlaceResult[] = [];
    const seen = new Set<string>();
    for (const raw of places ?? []) {
      const p = raw as {
        displayName?: string;
        primaryTypeDisplayName?: string;
        location?: { lat: number | (() => number); lng: number | (() => number) };
      };
      const name = (p.displayName ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const category = (p.primaryTypeDisplayName ?? "").trim() || undefined;
      const plat = typeof p.location?.lat === "function" ? p.location.lat() : p.location?.lat;
      const plng = typeof p.location?.lng === "function" ? p.location.lng() : p.location?.lng;
      const distanceM = typeof plat === "number" && typeof plng === "number" ? distanceMeters(lat, lng, plat, plng) : undefined;
      out.push({ name, category, distanceM });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    console.error("Nearby places lookup failed", err);
    return [];
  }
}

export interface ResolvedPlace {
  city?: string;
  region?: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
}

type PlaceAutocompleteElementCtor = typeof google.maps.places.PlaceAutocompleteElement;

/**
 * Resolves the `PlaceAutocompleteElement` constructor once the Places library
 * is loaded, or `null` if there's no key or it couldn't load. Never throws.
 */
export async function loadPlaceAutocompleteElement(): Promise<PlaceAutocompleteElementCtor | null> {
  const ready = await ensureMapsScript();
  if (!ready) return null;
  try {
    await google.maps.importLibrary("places");
    // importLibrary registers the loaded library on the global namespace
    // (documented Google behavior); the installed types don't list
    // PlaceAutocompleteElement on the returned shape, so read it from there.
    return google.maps.places.PlaceAutocompleteElement ?? null;
  } catch (err) {
    console.error("Google Places library failed to load", err);
    return null;
  }
}

/**
 * Reads city/region/coordinates out of a `gmp-select` event fired by a
 * `PlaceAutocompleteElement`, handling both known event shapes (see this
 * file's header). Returns `null` if neither is present or reading fails —
 * callers treat that as "couldn't autofill, type it by hand," never an error.
 */
export async function extractResolvedPlace(event: Event): Promise<ResolvedPlace | null> {
  const raw = event as unknown as {
    placePrediction?: { toPlace: () => google.maps.places.Place };
    place?: google.maps.places.Place;
  };

  try {
    let place: google.maps.places.Place | undefined;
    if (raw.placePrediction && typeof raw.placePrediction.toPlace === "function") {
      place = raw.placePrediction.toPlace();
      await place.fetchFields({ fields: ["addressComponents", "location", "formattedAddress"] });
    } else if (raw.place) {
      place = raw.place;
    }
    if (!place) return null;

    const components = place.addressComponents ?? [];
    const city = components.find((c) => c.types?.includes("locality"))?.longText ?? undefined;
    const region = components.find((c) => c.types?.includes("administrative_area_level_1"))?.longText ?? undefined;

    const location = place.location as unknown as { lat: number | (() => number); lng: number | (() => number) } | null;
    const lat = typeof location?.lat === "function" ? location.lat() : location?.lat;
    const lng = typeof location?.lng === "function" ? location.lng() : location?.lng;

    return {
      city,
      region,
      lat: typeof lat === "number" ? lat : undefined,
      lng: typeof lng === "number" ? lng : undefined,
      formattedAddress: place.formattedAddress ?? undefined,
    };
  } catch (err) {
    console.error("Couldn't read the selected place", err);
    return null;
  }
}
