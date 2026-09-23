/**
 * Tripadvisor Content API (api.content.tripadvisor.com/api/v1) — server-side so
 * the key stays private. Used at curation time to pull a restaurant's rating +
 * review count, plus the attribution the terms require: Tripadvisor's own
 * bubble-rating image and the web_url link back. We cache the location_id and
 * rating on the listing; the display always shows the Tripadvisor branding.
 *
 * Key: TRIPADVISOR_API_KEY. Some keys are referrer-restricted — set
 * TRIPADVISOR_REFERER to a matching allowed referrer and we send it as a header.
 */
const BASE = "https://api.content.tripadvisor.com/api/v1";

function key(): string | undefined {
  return process.env.TRIPADVISOR_API_KEY;
}
export function tripadvisorConfigured(): boolean {
  return !!key();
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (process.env.TRIPADVISOR_REFERER) h.Referer = process.env.TRIPADVISOR_REFERER;
  return h;
}

/** GET + parse, surfacing Tripadvisor's own error text on a non-ok response. */
async function taGet(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: headers() });
  const raw = await res.text().catch(() => "");
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    const msg = err?.message || (json.message as string) || (json.Message as string) || raw.slice(0, 200) || `HTTP ${res.status}`;
    console.error("[tripadvisor] non-ok", res.status, raw.slice(0, 300));
    throw new Error(`${res.status} — ${msg}`);
  }
  return json;
}

export interface TripadvisorMatch {
  locationId: string;
  name: string;
  rating: number | null;
  ratingCount: number;
  url: string | null;
  ratingImage: string | null;
  address: string | null;
}

interface SearchRow {
  location_id?: string;
  name?: string;
  address_obj?: { address_string?: string };
}

/** Find the best-matching Tripadvisor location for a name near lat/lng. */
async function searchLocation(query: string, latLng?: string): Promise<string | null> {
  const k = key();
  if (!k) throw new Error("No Tripadvisor API key is configured.");
  const params = new URLSearchParams({ key: k, searchQuery: query, category: "restaurants", language: "en" });
  if (latLng) params.set("latLong", latLng);
  const json = (await taGet(`${BASE}/location/search?${params.toString()}`)) as { data?: SearchRow[] };
  const first = (json.data ?? []).find((d) => d.location_id);
  return first?.location_id ?? null;
}

/** Full details (rating, count, url, bubble image) for a location_id. */
async function locationDetails(locationId: string): Promise<TripadvisorMatch | null> {
  const k = key();
  if (!k) throw new Error("No Tripadvisor API key is configured.");
  const json = (await taGet(`${BASE}/location/${encodeURIComponent(locationId)}/details?key=${encodeURIComponent(k)}&language=en`)) as {
    location_id?: string;
    name?: string;
    rating?: string | number;
    num_reviews?: string | number;
    web_url?: string;
    rating_image_url?: string;
    address_obj?: { address_string?: string };
  };
  if (!json.location_id) throw new Error("Tripadvisor returned no details for that location.");
  const rating = json.rating != null ? Number(json.rating) : null;
  const count = json.num_reviews != null ? Number(json.num_reviews) : 0;
  return {
    locationId: json.location_id,
    name: json.name ?? "",
    rating: Number.isFinite(rating as number) ? (rating as number) : null,
    ratingCount: Number.isFinite(count) ? count : 0,
    url: json.web_url ?? null,
    ratingImage: json.rating_image_url ?? null,
    address: json.address_obj?.address_string ?? null,
  };
}

/** Search by name (+ optional coords) and return the best match's details. */
export async function matchTripadvisor(query: string, latLng?: string): Promise<TripadvisorMatch | null> {
  const id = await searchLocation(query, latLng);
  if (!id) return null;
  return locationDetails(id);
}
