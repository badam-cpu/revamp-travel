/**
 * Real, location-based map for listings — replaces the old deterministic SVG
 * "atlas." Uses Leaflet + OpenStreetMap tiles (no API key, free), so a Yerevan
 * listing shows a street-level Yerevan map and a remote one shows its wider
 * Armenian surroundings, automatically, from each listing's real coordinates.
 *
 * The public props are unchanged from the SVG version (`listings`,
 * `selectedId`, `onSelect`, `single`, `className`) so every call site — the
 * listing/tour detail pages, /map, the Explore & Tours map sheets, and the
 * home preview — keeps working untouched. Markers are brand-styled price pills
 * (CSS DivIcons, no marker-image assets to break in the bundler); clicking one
 * fires `onSelect`, and the selected/active listing is summarized in a corner
 * card, same behavior as before.
 *
 * Location logic: `single` (a detail page) centers on the one listing —
 * street zoom for Yerevan, a wider regional view otherwise. Multi-listing
 * views fit the map to all pins, so the framing follows wherever the listings
 * actually are. Scroll-wheel zoom is off so the map never hijacks page scroll;
 * drag + the zoom buttons still work.
 */
import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { Listing } from "@/data/listings";
import { cn } from "@/lib/utils";

interface ArmeniaMapProps {
  listings: Listing[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
  single?: boolean;
}

const ARMENIA_CENTER: [number, number] = [40.18, 44.51];

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function ArmeniaMap({ listings, selectedId, onSelect, className, single = false }: ArmeniaMapProps) {
  const active = useMemo(() => listings.find((listing) => listing.id === selectedId) || listings[0], [listings, selectedId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.MarkerClusterGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Create the map once, then keep it in sync via the effect below.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    }).setView(ARMENIA_CENTER, 7);
    map.zoomControl.setPosition("topright");
    // CARTO Positron — a clean, muted light basemap that reads as a quiet
    // brand surface rather than default OSM's busy color. Keyless; attribution
    // credits both OSM (data) and CARTO (tiles), as their usage requires.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      detectRetina: true,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    // Cluster nearby listings into a brand pill showing the count; a single
    // listing (detail pages) just shows its own marker, no cluster.
    layerRef.current = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 46,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (cluster) =>
        L.divIcon({
          className: "",
          html: `<span class="revamp-cluster">${cluster.getChildCount()}</span>`,
          iconSize: L.point(38, 38),
        }),
    }).addTo(map);
    mapRef.current = map;

    // Leaflet needs a correctly-sized container; recompute when it changes
    // (e.g. opening inside the mobile map Sheet, which mounts at 0 height).
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);
    const t = setTimeout(() => map.invalidateSize(), 0);

    return () => {
      clearTimeout(t);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Sync markers + framing whenever the data or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;
    group.clearLayers();

    const points: [number, number][] = [];
    listings.forEach((listing) => {
      const latlng: [number, number] = [listing.coordinates.lat, listing.coordinates.lng];
      points.push(latlng);
      const isSelected = selectedId === listing.id || (single && listing.id === active?.id);
      const icon = L.divIcon({
        className: "revamp-pin-wrap",
        iconSize: [0, 0],
        html: `<span class="revamp-pin${isSelected ? " selected" : ""}">${escapeHtml(listing.priceLabel)}</span>`,
      });
      const marker = L.marker(latlng, { icon, title: listing.title, keyboard: false }).addTo(group);
      marker.on("click", () => onSelectRef.current?.(listing.id));
    });

    if (points.length === 0) {
      map.setView(ARMENIA_CENTER, 7);
      return;
    }
    if (single || points.length === 1) {
      const a = active ?? listings[0];
      // Yerevan → street-level; anywhere else → a wider view of its surroundings.
      const zoom = a.city.trim().toLowerCase() === "yerevan" ? 14 : 9;
      map.setView([a.coordinates.lat, a.coordinates.lng], zoom);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 });
    }
  }, [listings, selectedId, single, active]);

  return (
    <div className={cn("atlas-map relative overflow-hidden bg-[#D9D8CD]", className)}>
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      {active && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] max-w-[220px] border-l-2 border-apricot bg-basalt px-4 py-3 text-paper shadow-xl">
          <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-paper/45">
            {active.city} · {active.region}
          </p>
          <p className="mt-1 font-display text-lg leading-tight">{active.title}</p>
        </div>
      )}
    </div>
  );
}
