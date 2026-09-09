/**
 * Address-search box for the dashboard listing form — wraps Google's
 * `PlaceAutocompleteElement` web component (Places API (New)) so an
 * operator can type an address and have city/region/coordinates fill in
 * below, instead of hunting up lat/lng by hand.
 *
 * Renders nothing when `VITE_GOOGLE_MAPS_API_KEY` isn't configured (see
 * client/src/lib/googleMaps.ts) — the manual city/region/lat/lng fields in
 * Dashboard.tsx keep working exactly as before either way. This is purely
 * an autofill convenience layered on top of them, never a replacement:
 * results only ever set those fields' values, an operator can still edit
 * every one of them by hand afterward, and results are restricted to
 * Armenia (`componentRestrictions`/`includedRegionCodes`) to match the
 * existing 38–42/43–47 coordinate-bounds validation those fields already
 * enforce.
 *
 * Uncontrolled and imperative by necessity: `PlaceAutocompleteElement` is a
 * custom element (`<gmp-place-autocomplete>`), not a React component, so
 * it's constructed and appended to a plain container `div` in an effect
 * rather than written as JSX.
 */
import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { loadPlaceAutocompleteElement, extractResolvedPlace, type ResolvedPlace } from "@/lib/googleMaps";

export function PlaceAutocomplete({ onSelect }: { onSelect: (place: ResolvedPlace) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    let element: HTMLElement | null = null;

    loadPlaceAutocompleteElement().then((PlaceAutocompleteElementCtor) => {
      if (cancelled) return;
      if (!PlaceAutocompleteElementCtor || !containerRef.current) {
        setStatus("unavailable");
        return;
      }
      const el = new PlaceAutocompleteElementCtor({ componentRestrictions: { country: "am" } });
      // Force the widget to render light — its shadow DOM otherwise follows the
      // OS `prefers-color-scheme`, which turns the box black in dark mode while
      // the rest of this (deliberately light) app stays white.
      el.style.setProperty("color-scheme", "light");
      // Google's newer region-restriction property — set defensively since
      // the installed @types package doesn't declare it on this element yet
      // (see googleMaps.ts's header comment). A harmless no-op if this API
      // generation doesn't read it; `componentRestrictions` above already
      // covers the same restriction on the generation that does.
      (el as unknown as { includedRegionCodes?: string[] }).includedRegionCodes = ["am"];
      el.addEventListener("gmp-select", async (event: Event) => {
        const place = await extractResolvedPlace(event);
        if (place) onSelectRef.current(place);
      });
      containerRef.current.appendChild(el);
      element = el;
      setStatus("ready");
    });

    return () => {
      cancelled = true;
      element?.remove();
    };
  }, []);

  if (status === "unavailable") return null;

  return (
    <div className="grid gap-1.5">
      <Label>Search for the address (optional)</Label>
      <div
        ref={containerRef}
        // Pressing Enter to pick a suggestion shouldn't submit the
        // surrounding listing form — preventDefault on the native keydown
        // stops that default action without blocking the widget's own
        // internal handling of the same keypress.
        onKeyDownCapture={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        style={{ colorScheme: "light" }}
        className="[&_gmp-place-autocomplete]:block [&_gmp-place-autocomplete]:w-full"
      />
      <p className="text-xs text-basalt/45">
        Pick a result to fill in city, region, and coordinates below — you can still edit any of them by hand after.
      </p>
    </div>
  );
}
