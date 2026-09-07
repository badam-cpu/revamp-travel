/**
 * Lazily loads the Google Maps JavaScript API (Places library) for the
 * operator dashboard's address autocomplete. Entirely optional: without
 * `VITE_GOOGLE_MAPS_API_KEY` the dashboard falls back to manual city/region/
 * coordinate entry, so nothing breaks when the key isn't set. The key is a
 * browser (client) key — restrict it by HTTP referrer in Google Cloud, since
 * Vite inlines it into the bundle.
 */
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export const isGoogleMapsConfigured = Boolean(API_KEY);

let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (!API_KEY) return Promise.reject(new Error("Google Maps API key is not configured."));
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const w = window as unknown as { google?: { maps?: { places?: unknown } } };
    if (w.google?.maps?.places) {
      resolve();
      return;
    }
    const done = () => (w.google?.maps?.places ? resolve() : reject(new Error("Google Maps failed to initialize.")));
    const fail = () => reject(new Error("Google Maps failed to load."));

    const existing = document.getElementById("google-maps-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", fail);
      return;
    }
    const script = document.createElement("script");
    script.id = "google-maps-js";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}&libraries=places&loading=async`;
    script.addEventListener("load", done);
    script.addEventListener("error", fail);
    document.head.appendChild(script);
  });
  return loadPromise;
}
