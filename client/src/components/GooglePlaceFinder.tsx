/**
 * "Search your Google Business" box — wraps Google's PlaceAutocompleteElement
 * (Places API New) and returns the selected place's Place ID + name, so an
 * operator can connect their Google Business without hunting for a ChIJ… id.
 * Renders nothing if VITE_GOOGLE_MAPS_API_KEY isn't set (caller then shows the
 * manual Place ID field). Mirrors PlaceAutocomplete.tsx.
 */
import { useEffect, useRef, useState } from "react";
import { loadPlaceAutocompleteElement, extractPlaceId } from "@/lib/googleMaps";

export function GooglePlaceFinder({ onFound }: { onFound: (r: { id: string; name: string }) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onFound);
  cbRef.current = onFound;
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    let element: HTMLElement | null = null;
    loadPlaceAutocompleteElement().then((Ctor) => {
      if (cancelled) return;
      if (!Ctor || !containerRef.current) {
        setStatus("unavailable");
        return;
      }
      const el = new Ctor({ componentRestrictions: { country: "am" } });
      el.style.setProperty("color-scheme", "light");
      (el as unknown as { includedRegionCodes?: string[] }).includedRegionCodes = ["am"];
      el.addEventListener("gmp-select", async (event: Event) => {
        const r = await extractPlaceId(event);
        if (r) cbRef.current(r);
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
    <div style={{ colorScheme: "light" }} className="rounded-[0.875rem] border border-basalt/20 bg-paper focus-within:border-apricot">
      <div
        ref={containerRef}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        className="[&_gmp-place-autocomplete]:block [&_gmp-place-autocomplete]:w-full [&_gmp-place-autocomplete]:bg-transparent"
      />
    </div>
  );
}
