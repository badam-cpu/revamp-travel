/**
 * Tripadvisor **Terra** API (terra.tripadvisor.com/api) — the current platform
 * (the legacy Content API is being sunset). Server-side so the key stays
 * private. Used at curation time to pull a restaurant's rating + review count,
 * plus the attribution the terms require: Tripadvisor's own rating icon and the
 * link back. We cache those on the listing.
 *
 * Auth: X-API-Key header, key = TRIPADVISOR_API_KEY (a Terra Discover key).
 *   GET /catalog/locations/search?version=1 → find a Location by name (Discover)
 *   GET /locations/{id}?version=1           → rating, count, icon_url, urls, name
 */
const BASE = "https://terra.tripadvisor.com/api";

function key(): string | undefined {
  return process.env.TRIPADVISOR_API_KEY;
}
export function tripadvisorConfigured(): boolean {
  return !!key();
}

function authHeaders(): Record<string, string> {
  const k = key();
  if (!k) throw new Error("No Tripadvisor (Terra) API key is configured.");
  return { "X-API-Key": k, accept: "application/json", "content-type": "application/json" };
}

/** Read the primary translated name from a Terra `names` array. */
function primaryName(names?: { value?: string; primary?: boolean }[]): string {
  if (!names?.length) return "";
  return (names.find((n) => n.primary) ?? names[0]).value ?? "";
}

export interface TripadvisorMatch {
  locationId: string;
  name: string;
  rating: number | null;
  ratingCount: number;
  url: string | null;
  ratingImage: string | null;
  address: string | null;
  menuUrl: string | null;
}

interface TerraLocation {
  id?: number;
  names?: { value?: string; primary?: boolean }[];
  traveler_ratings?: { overall?: { rating?: number; count?: number; icon_url?: string } };
  urls?: { tripadvisor?: { main?: string }; menu?: string; official?: string };
  addresses?: { formatted?: string }[];
}

/** Surface Terra's own error text on a non-ok response. */
async function parseOrThrow(res: Response): Promise<Record<string, unknown>> {
  const raw = await res.text().catch(() => "");
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message;
    const msg = err || (json.message as string) || (json.Message as string) || raw.slice(0, 200) || `HTTP ${res.status}`;
    console.error("[tripadvisor/terra] non-ok", res.status, raw.slice(0, 300));
    throw new Error(`${res.status} — ${msg}`);
  }
  return json;
}

/** Find the best-matching Terra Location for a name (Discover catalog search). */
async function searchLocation(query: string, geoName?: string): Promise<TerraLocation | null> {
  const params = new URLSearchParams({ version: "1", query, category: "RESTAURANT", search_type: "NAME", country_code: "AM", size: "10" });
  if (geoName) params.set("geo_name", geoName);
  const res = await fetch(`${BASE}/catalog/locations/search?${params.toString()}`, { headers: authHeaders() });
  const json = (await parseOrThrow(res)) as { data?: { location?: TerraLocation }[] };
  const locs = (json.data ?? []).map((d) => d.location).filter((l): l is TerraLocation => !!l?.id);
  if (!locs.length) return null;
  // Prefer an exact-ish name match, else the first result.
  const want = query.trim().toLowerCase();
  return locs.find((l) => primaryName(l.names).toLowerCase().includes(want)) ?? locs[0];
}

/** Full details for a location id (rating, count, icon, url, name, address). */
async function locationDetails(id: number): Promise<TripadvisorMatch> {
  const res = await fetch(`${BASE}/locations/${id}?version=1`, { headers: authHeaders() });
  const loc = (await parseOrThrow(res)) as TerraLocation;
  const overall = loc.traveler_ratings?.overall;
  const rating = typeof overall?.rating === "number" ? overall.rating : null;
  return {
    locationId: String(loc.id ?? id),
    name: primaryName(loc.names),
    rating,
    ratingCount: typeof overall?.count === "number" ? overall.count : 0,
    url: loc.urls?.tripadvisor?.main ?? null,
    ratingImage: overall?.icon_url ?? null,
    address: loc.addresses?.[0]?.formatted ?? null,
    menuUrl: loc.urls?.menu ?? null,
  };
}

/** Search by name (+ optional geo/city) and return the best match's details. */
export async function matchTripadvisor(query: string, geoName?: string): Promise<TripadvisorMatch | null> {
  const hit = await searchLocation(query, geoName);
  if (!hit?.id) return null;
  return locationDetails(hit.id);
}
