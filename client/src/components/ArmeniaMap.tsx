/**
 * Real, location-based listings map — Google Maps (reuses the same
 * VITE_GOOGLE_MAPS_API_KEY as the dashboard address autocomplete; loaded via
 * client/src/lib/googleMaps.ts). A Yerevan listing shows a street-level Yerevan
 * map and a remote one shows its wider surroundings, from each listing's real
 * coordinates.
 *
 * Public props are unchanged from earlier map implementations (`listings`,
 * `selectedId`, `onSelect`, `single`, `className`) so every call site — the
 * listing/tour detail pages, /map, the Explore & Tours map sheets, and the home
 * preview — keeps working untouched. Markers are brand apricot price-pill SVG
 * icons (basalt when selected); clicking one fires `onSelect`. Nearby listings
 * cluster into an apricot count pill (@googlemaps/markerclusterer). The active
 * listing is summarized in a corner card.
 *
 * No mapId is required: brand muting is done with a classic JSON `styles` array
 * and markers are classic `google.maps.Marker`s with SVG icons — so only the
 * plain API key is needed, nothing extra to configure in Google Cloud. If the
 * key is missing or the API fails to load, a neutral placeholder renders and
 * the rest of the page is unaffected.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer, type Renderer } from "@googlemaps/markerclusterer";
import { ensureMapsScript } from "@/lib/googleMaps";
import { Listing } from "@/data/listings";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import { formatLocation, normalizeRegion } from "@/lib/region";

interface ArmeniaMapProps {
  listings: Listing[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
  single?: boolean;
  /** When true, selecting a listing pans + zooms the camera to it (map-led
   * discovery surfaces like /map). Filter changes still frame the whole set;
   * only an in-set selection moves the camera. Off by default so preview maps
   * (home, tour detail) stay still on hover. */
  focusOnSelect?: boolean;
}

const ARMENIA_CENTER = { lat: 40.18, lng: 44.51 };

// Muted, light brand styling — desaturated geometry, softened roads/water,
// simplified POIs — so the map reads as a quiet surface, not busy full-color.
const MUTED_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ saturation: -55 }, { lightness: 12 }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5b5b57" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f4f3ee" }, { weight: 2 }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "simplified" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#dfe3d6" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ saturation: -60 }, { lightness: 22 }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfd8d3" }] },
];

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pillIcon(label: string, selected: boolean): google.maps.Icon {
  const bg = selected ? "#212121" : "#F15822";
  const h = 26;
  const w = Math.max(40, Math.round(18 + label.length * 8.2));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${(h - 2) / 2}" fill="${bg}" stroke="#ffffff" stroke-width="2"/><text x="${w / 2}" y="${h / 2}" dy=".35em" text-anchor="middle" font-family="Manrope, Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff">${escapeXml(label)}</text></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(w / 2, h / 2),
  };
}

function clusterIcon(count: number): google.maps.Icon {
  const d = 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 2}" fill="#F15822" stroke="#ffffff" stroke-width="2"/><text x="${d / 2}" y="${d / 2}" dy=".35em" text-anchor="middle" font-family="Manrope, Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${count}</text></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(d, d),
    anchor: new google.maps.Point(d / 2, d / 2),
  };
}

// Per-category glyphs for place markers — the inner elements of the matching
// Lucide icon (24×24, stroke-only), so the map reads like a real one (a cart for
// a supermarket, a cross for a pharmacy, columns for a museum) and stays compact.
const PLACE_GLYPHS: Record<string, string> = {
  supermarket: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  pharmacy: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  atm: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  clinic: '<path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
  museum: '<path d="M10 18v-7"/><path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
  gallery: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  library: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  theater: '<path d="M10 11h.01"/><path d="M14 6h.01"/><path d="M18 6h.01"/><path d="M6.5 13.1h.01"/><path d="M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3"/><path d="M17.4 9.9c-.8.8-2 .8-2.8 0"/><path d="M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7"/><path d="M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4"/>',
  cinema: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  landmark: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  coworking: '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>',
};

function iconPin(category: string | null | undefined, selected: boolean): google.maps.Icon {
  const bg = selected ? "#212121" : "#F15822";
  const d = 34;
  // Fallback for an unknown/missing category: a small filled dot.
  const glyph = (category && PLACE_GLYPHS[category]) || '<circle cx="12" cy="12" r="2.5" fill="#ffffff"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 2}" fill="${bg}" stroke="#ffffff" stroke-width="2"/><g transform="translate(7 7) scale(0.8333)" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(d, d),
    anchor: new google.maps.Point(d / 2, d / 2),
  };
}

export function ArmeniaMap({ listings, selectedId, onSelect, className, single = false, focusOnSelect = false }: ArmeniaMapProps) {
  const { format } = useCurrency();
  const active = useMemo(() => listings.find((listing) => listing.id === selectedId) || listings[0], [listings, selectedId]);
  // Marker pill: eateries are free recommendations — show their price band (or a
  // dot), never a bookable price / "Rate on request". Places use a category ICON
  // pin instead (see markerIcon), so they stay compact and self-explanatory.
  const markerLabel = (l: (typeof listings)[number]) =>
    l.type === "eat" ? l.priceBand || "•" : l.price > 0 ? format(Math.round(l.price * 100)) : l.priceLabel;
  // A place gets a small round icon pin (what it is); everything else a price/band pill.
  const markerIcon = (l: (typeof listings)[number], selected: boolean) =>
    l.type === "place" ? iconPin(l.category, selected) : pillIcon(markerLabel(l), selected);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // Tracks the current listing SET so the pan-on-select effect can tell a real
  // selection apart from a filter change (which should re-frame, not pan).
  const setKeyRef = useRef("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    // Google renders its own "Oops! Something went wrong" overlay inside the
    // map div on any auth failure (key not authorized for the Maps JS API,
    // referrer blocked, billing off). Catch it and show our own neutral
    // placeholder instead so a broken key never surfaces a raw Google error to
    // visitors. gm_authFailure is a single global Google invokes on auth error.
    (window as unknown as Record<string, () => void>).gm_authFailure = () => {
      if (!cancelled) setFailed(true);
    };
    ensureMapsScript().then(async (ok) => {
      if (cancelled || !containerRef.current) return;
      if (!ok) {
        setFailed(true);
        return;
      }
      try {
        await google.maps.importLibrary("maps");
        await google.maps.importLibrary("marker");
        if (cancelled || !containerRef.current) return;
        const map = new google.maps.Map(containerRef.current, {
          center: ARMENIA_CENTER,
          zoom: 7,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "cooperative", // don't hijack page scroll
          styles: MUTED_STYLE,
        });
        mapRef.current = map;
        const renderer: Renderer = {
          render: ({ count, position }) => new google.maps.Marker({ position, icon: clusterIcon(count), zIndex: 10_000 + count }),
        };
        clustererRef.current = new MarkerClusterer({ map, renderer });
        setReady(true);
      } catch (err) {
        console.error("Google Maps failed to initialize", err);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      mapRef.current = null;
    };
  }, []);

  // Sync markers + framing whenever data/selection changes (once the map is up).
  // Build markers + frame the camera. Runs only when the SET of listings
  // changes — NOT on hover/selection — so hovering a card never moves the map.
  useEffect(() => {
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!ready || !map || !clusterer) return;

    clusterer.clearMarkers();
    markersRef.current.clear();
    const markers = listings.map((listing) => {
      const marker = new google.maps.Marker({
        position: { lat: listing.coordinates.lat, lng: listing.coordinates.lng },
        icon: markerIcon(listing, false),
        title: listing.title,
        zIndex: 1,
      });
      marker.addListener("click", () => onSelectRef.current?.(listing.id));
      markersRef.current.set(listing.id, marker);
      return marker;
    });
    clusterer.addMarkers(markers);

    if (listings.length === 0) {
      map.setCenter(ARMENIA_CENTER);
      map.setZoom(7);
      return;
    }
    if (single || listings.length === 1) {
      const a = listings[0];
      map.setCenter({ lat: a.coordinates.lat, lng: a.coordinates.lng });
      map.setZoom(a.city.trim().toLowerCase() === "yerevan" ? 14 : 9);
    } else {
      const bounds = new google.maps.LatLngBounds();
      listings.forEach((l) => bounds.extend({ lat: l.coordinates.lat, lng: l.coordinates.lng }));
      map.fitBounds(bounds, 56);
      google.maps.event.addListenerOnce(map, "idle", () => {
        const z = map.getZoom();
        if (typeof z === "number" && z > 15) map.setZoom(15);
      });
    }
  }, [ready, listings, single, format]);

  // Highlight the selected marker only — recolors/raises its pin without moving
  // the camera (this is what runs on hover).
  useEffect(() => {
    if (!ready) return;
    listings.forEach((listing) => {
      const marker = markersRef.current.get(listing.id);
      if (!marker) return;
      const isSelected = selectedId === listing.id || (single && listing.id === active?.id);
      marker.setIcon(markerIcon(listing, isSelected));
      marker.setZIndex(isSelected ? 9_000 : 1);
    });
  }, [ready, selectedId, single, active, listings, format]);

  // Pan + zoom to the selected listing (map-led surfaces, focusOnSelect). Skips
  // the tick where the listing SET changed — a filter switch should re-frame the
  // whole set (the effect above), and only a true in-set selection flies in.
  useEffect(() => {
    const map = mapRef.current;
    const key = listings.map((l) => l.id).join("|");
    const setChanged = key !== setKeyRef.current;
    setKeyRef.current = key;
    if (!ready || !map || single || !focusOnSelect || setChanged || !selectedId) return;
    const sel = listings.find((l) => l.id === selectedId);
    if (!sel) return;
    map.panTo({ lat: sel.coordinates.lat, lng: sel.coordinates.lng });
    const target = sel.city.trim().toLowerCase() === "yerevan" ? 14 : 12;
    if ((map.getZoom() ?? 7) < target) map.setZoom(target);
  }, [ready, selectedId, single, focusOnSelect, listings]);

  return (
    <div className={cn("atlas-map relative overflow-hidden bg-[#EDECE6]", className)}>
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-chalk px-6 text-center">
          <div className="max-w-xs">
            <p className="text-sm font-semibold text-basalt/70">{active ? formatLocation(active.city, active.region) : "Armenia"}</p>
            <p className="mt-1 text-xs leading-5 text-basalt/45">Interactive map is temporarily unavailable.</p>
          </div>
        </div>
      )}
      {active && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-[5] max-w-[220px] border-l-2 border-apricot bg-basalt px-4 py-3 text-paper shadow-xl">
          <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-paper/45">
            {active.city} · {normalizeRegion(active.region)}
          </p>
          <p className="mt-1 font-display text-lg leading-tight">{active.title}</p>
        </div>
      )}
    </div>
  );
}
