/**
 * Minimal loader for the Google Maps JavaScript API's Places library —
 * used only by the dashboard's address-autocomplete field
 * (client/src/components/PlaceAutocomplete.tsx). Hand-written rather than
 * pulling in the `@googlemaps/js-api-loader` package: this is a single
 * script tag with a callback, not enough surface to justify a dependency,
 * consistent with this project's general "no dependency for something
 * this small" bias (see server/prerender.ts's header comment for the same
 * reasoning applied elsewhere).
 *
 * Entirely optional: if `VITE_GOOGLE_MAPS_API_KEY` isn't set, this
 * resolves to `null` and `PlaceAutocomplete` quietly renders nothing — the
 * dashboard form's city/region/lat/lng fields keep working as plain manual
 * inputs, same "missing config degrades gracefully" pattern as the trip
 * planner's `ANTHROPIC_API_KEY` and Supabase's offline fallback.
 *
 * A note on why this file reads results defensively: `PlaceAutocompleteElement`
 * is a Google web component that is still under active revision upstream.
 * The community `@types/google.maps` package installed in this project
 * (pinned by whatever version is in package.json at the time) does not
 * necessarily match the exact event/property shape Google's live service
 * returns — we found a real mismatch while building this (the installed
 * types describe an older `event.place` shape; Google's current published
 * docs describe `event.placePrediction.toPlace()` + `fetchFields()`).
 * Rather than bet on one shape, `extractResolvedPlace()` below checks for
 * both at runtime. If Google changes this again, this is the one function
 * to update — nothing else in the app needs to know.
 */

export interface ResolvedPlace {
  city?: string;
  region?: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
}

type PlaceAutocompleteElementCtor = typeof google.maps.places.PlaceAutocompleteElement;

let placesReadyPromise: Promise<PlaceAutocompleteElementCtor | null> | null = null;

/**
 * Loads the Maps JS API (if not already loaded) and resolves with the
 * `PlaceAutocompleteElement` constructor, or `null` if there's no API key
 * configured or the library failed to load for any reason (network error,
 * invalid key, the element genuinely isn't available on the loaded
 * channel — see the troubleshooting note in this project's
 * CLAUDE_CODE_PROMPT for this delta). Never throws.
 */
export function loadPlaceAutocompleteElement(): Promise<PlaceAutocompleteElementCtor | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) return Promise.resolve(null);
  if (placesReadyPromise) return placesReadyPromise;

  placesReadyPromise = new Promise((resolve) => {
    const finish = async () => {
      try {
        await google.maps.importLibrary("places");
        // importLibrary's return value (per the installed @types/google.maps
        // package) doesn't list PlaceAutocompleteElement on the `places`
        // library's typed shape, even though Google's own class exists —
        // importLibrary also registers the loaded library on the global
        // `google.maps.places` namespace (documented Google behavior), so
        // we read the constructor from there instead of destructuring the
        // call's return value.
        resolve(google.maps.places.PlaceAutocompleteElement ?? null);
      } catch (err) {
        console.error("Google Places library failed to load", err);
        resolve(null);
      }
    };

    // The ambient google.maps types declare `google` as an always-present
    // global (they describe the shape *after* the script loads, not
    // before), and that non-optional declaration flows into `window`'s own
    // type too — so a plain `window.google?.…` check gets flagged as
    // "always true" no matter how it's cast through `window`. Reading via
    // `globalThis` as an untyped record first, then re-typing as possibly
    // `undefined`, escapes that and reflects the real "might not be loaded
    // yet" runtime state.
    const existingGoogle = (globalThis as Record<string, unknown>).google as typeof google | undefined;
    if (existingGoogle?.maps?.importLibrary) {
      finish();
      return;
    }

    const callbackName = "__revampGoogleMapsReady";
    (window as unknown as Record<string, () => void>)[callbackName] = finish;
    const script = document.createElement("script");
    // v=weekly is Google's recommended default channel. If
    // PlaceAutocompleteElement comes back unavailable in your browser
    // console after applying this, try v=beta here — some Google web
    // components ship there before reaching the weekly channel, and this
    // is the one place that would need to change.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      console.error("Google Maps script failed to load");
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return placesReadyPromise;
}

/**
 * Reads city/region/coordinates out of a `gmp-select` event fired by a
 * `PlaceAutocompleteElement`, handling both known event shapes (see this
 * file's header comment). Returns `null` if neither shape is present or
 * reading fails for any reason — callers should treat that as "couldn't
 * autofill this one, the operator can still type it by hand," never as a
 * hard error.
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
