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
import { cn } from "@/lib/utils";

interface ArmeniaMapProps {
  listings: Listing[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
  single?: boolean;
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

export function ArmeniaMap({ listings, selectedId, onSelect, className, single = false }: ArmeniaMapProps) {
  const active = useMemo(() => listings.find((listing) => listing.id === selectedId) || listings[0], [listings, selectedId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
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
  useEffect(() => {
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!ready || !map || !clusterer) return;

    clusterer.clearMarkers();
    const markers = listings.map((listing) => {
      const isSelected = selectedId === listing.id || (single && listing.id === active?.id);
      const marker = new google.maps.Marker({
        position: { lat: listing.coordinates.lat, lng: listing.coordinates.lng },
        icon: pillIcon(listing.priceLabel, isSelected),
        title: listing.title,
        zIndex: isSelected ? 9_000 : 1,
      });
      marker.addListener("click", () => onSelectRef.current?.(listing.id));
      return marker;
    });
    clusterer.addMarkers(markers);

    if (listings.length === 0) {
      map.setCenter(ARMENIA_CENTER);
      map.setZoom(7);
      return;
    }
    if (single || listings.length === 1) {
      const a = active ?? listings[0];
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
  }, [ready, listings, selectedId, single, active]);

  return (
    <div className={cn("atlas-map relative overflow-hidden bg-[#EDECE6]", className)}>
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-chalk px-6 text-center">
          <p className="max-w-xs text-xs leading-5 text-basalt/50">
            Map preview needs a Google Maps key (<span className="font-mono">VITE_GOOGLE_MAPS_API_KEY</span>). Listing coordinates are still saved and shown elsewhere.
          </p>
        </div>
      )}
      {active && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-[5] max-w-[220px] border-l-2 border-apricot bg-basalt px-4 py-3 text-paper shadow-xl">
          <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-paper/45">
            {active.city} · {active.region}
          </p>
          <p className="mt-1 font-display text-lg leading-tight">{active.title}</p>
        </div>
      )}
    </div>
  );
}
