/**
 * Region name helpers. Armenian regions are stored with their administrative
 * suffix ("Tavush Province", "Kotayk Marz"), which reads as clutter in the UI —
 * so for display (and for region slugs) we drop the "Province"/"Marz" suffix.
 * This is the single source of truth; several pages used to inline the same regex.
 */

/** Strip the "Province"/"Marz" suffix from a region name. */
export function normalizeRegion(region: string): string {
  return (region || "").trim().replace(/\s+(province|marz)$/i, "").trim();
}

/**
 * "City, Region" for display — with the province/marz suffix dropped, and the
 * region omitted entirely when it's empty or just repeats the city (e.g.
 * "Yerevan, Yerevan" → "Yerevan").
 */
export function formatLocation(city: string, region: string): string {
  const r = normalizeRegion(region);
  return r && r.toLowerCase() !== (city || "").trim().toLowerCase() ? `${city}, ${r}` : city;
}
