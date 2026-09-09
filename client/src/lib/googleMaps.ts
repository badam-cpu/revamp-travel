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
