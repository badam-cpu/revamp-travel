/// <reference types="google.maps" />
/**
 * Google Places address autocomplete for the operator listing form. Restricted
 * to Armenia; on selecting a suggestion it reports lat/lng + city/region so the
 * dashboard can fill those fields (the operator can still edit them). Rendered
 * only when Google Maps is configured (see googleMaps.ts) — the form keeps its
 * manual city/region/coordinate inputs as the fallback either way.
 */
import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadGoogleMaps } from "@/lib/googleMaps";

export interface AddressSelection {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
}

export function AddressAutocomplete({ onSelect }: { onSelect: (selection: AddressSelection) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Keep the latest callback without re-initializing the Autocomplete each render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let autocomplete: google.maps.places.Autocomplete | null = null;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !inputRef.current) return;
        autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          fields: ["geometry", "address_components", "name", "formatted_address"],
          componentRestrictions: { country: "am" }, // Armenia only
          types: ["geocode"],
        });
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete!.getPlace();
          const loc = place.geometry?.location;
          if (!loc) return;
          const component = (type: string) => place.address_components?.find((c) => c.types.includes(type))?.long_name;
          onSelectRef.current({
            lat: loc.lat(),
            lng: loc.lng(),
            city: component("locality") || component("administrative_area_level_2") || component("postal_town"),
            region: component("administrative_area_level_1"),
          });
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      if (autocomplete) google.maps.event.clearInstanceListeners(autocomplete);
    };
  }, []);

  if (status === "error") return null; // fall back silently to manual entry

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="address-search" className="flex items-center gap-1.5">
        <MapPin className="h-3.5 w-3.5 text-apricot" /> Search address {status === "loading" && <span className="text-basalt/40">(loading…)</span>}
      </Label>
      <Input
        id="address-search"
        ref={inputRef}
        placeholder="Start typing an address in Armenia…"
        autoComplete="off"
        onKeyDown={(e) => {
          // Enter selects an autocomplete suggestion — don't submit the form.
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      <p className="text-xs text-basalt/45">Pick a suggestion to auto-fill city, region, and the map coordinates below — you can still adjust them.</p>
    </div>
  );
}
