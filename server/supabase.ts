/**
 * Read-only Supabase access for the server's jobs: the trip planner's
 * catalog digest, verifying who's calling POST /api/import-listing, the
 * per-user client that scopes POST /api/sync-ical to the caller's own row,
 * and (since the bot-prerender/SEO feature) getPublishedCatalog() for
 * server/prerender.ts and server/sitemap.ts. Uses the anon key deliberately
 * for the read paths — published listings are already publicly readable
 * under Row-Level Security (see "published listings are publicly readable"
 * in supabase/migrations/0001_init.sql), and verifying a token doesn't need
 * elevated privilege either. Listing CRUD itself no longer goes through the
 * server at all — the client talks to Supabase directly under RLS (see
 * client/src/contexts/ListingsContext.tsx).
 */
import { createClient } from "@supabase/supabase-js";
import type { Listing, ListingType } from "../shared/listings.js";
import type { CatalogEntry } from "./planner.js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const client = url && anonKey ? createClient(url, anonKey) : null;

/** Full published-catalog projection, used by the bot prerenderer and the sitemap — see getPublishedCatalog() below. */
export type PublicListing = Listing & { updatedAt: string };

interface CatalogRow {
  slug: string;
  type: ListingType;
  title: string;
  eyebrow: string;
  city: string;
  region: string;
  lat: number;
  lng: number;
  image: string;
  gallery: string[];
  short_description: string;
  long_description: string;
  price_cents: number;
  price_unit: string;
  tags: string[];
  facts: { label: string; value: string }[];
  amenities: string[];
  accent: "apricot" | "sevan" | "tuff";
  updated_at: string;
}

function mapCatalogRow(row: CatalogRow): PublicListing {
  const price = row.price_cents / 100;
  return {
    id: row.slug,
    slug: row.slug,
    type: row.type,
    title: row.title,
    eyebrow: row.eyebrow,
    city: row.city,
    region: row.region,
    coordinates: { lat: row.lat, lng: row.lng },
    image: row.image,
    gallery: row.gallery,
    shortDescription: row.short_description,
    longDescription: row.long_description,
    price,
    // Mirror ListingsContext's client-side rule: a real price shows as "$X",
    // no price shows as "Rate on request" — never "$0".
    priceLabel: price > 0 ? `$${price % 1 === 0 ? price : price.toFixed(2)}` : "Rate on request",
    priceUnit: row.price_unit,
    tags: row.tags,
    facts: row.facts,
    amenities: row.amenities,
    accent: row.accent,
    updatedAt: row.updated_at,
  };
}

const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache: { data: PublicListing[]; expiresAt: number } | null = null;

/**
 * Every publicly-visible (status = "published") listing, with a short
 * in-memory cache — shared by server/prerender.ts and server/sitemap.ts,
 * so a burst of crawler traffic costs at most one Supabase round trip per
 * 5-minute window, not one per request. Same RLS-backed "published is
 * public" pattern as listPublishedForPlanner() below, just projecting the
 * full Listing shape (a prerendered page/sitemap entry needs the whole
 * thing) plus updatedAt for <lastmod>.
 */
export async function getPublishedCatalog(): Promise<PublicListing[]> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.data;
  if (!client) return [];
  const { data, error } = await client
    .from("listings")
    .select(
      "slug, type, title, eyebrow, city, region, lat, lng, image, gallery, short_description, long_description, price_cents, price_unit, tags, facts, amenities, accent, updated_at",
    )
    .eq("status", "published");
  const rows = error || !data ? [] : (data as CatalogRow[]).map(mapCatalogRow);
  catalogCache = { data: rows, expiresAt: Date.now() + CATALOG_TTL_MS };
  return rows;
}

interface ListingRow {
  type: Listing["type"];
  title: string;
  city: string;
  region: string;
  price_cents: number;
  price_unit: string;
  short_description: string;
}

/** A lightweight projection of the published catalog — just what planner.ts's catalogDigest() needs, not the full Listing shape. */
export async function listPublishedForPlanner(): Promise<CatalogEntry[]> {
  if (!client) return [];
  const { data, error } = await client
    .from("listings")
    .select("type, title, city, region, price_cents, price_unit, short_description")
    .eq("status", "published");
  if (error || !data) return [];
  return (data as ListingRow[]).map((row) => ({
    type: row.type,
    title: row.title,
    city: row.city,
    region: row.region,
    priceLabel: `$${row.price_cents / 100}`,
    priceUnit: row.price_unit,
    shortDescription: row.short_description,
  }));
}

/**
 * Verifies a client-supplied Supabase access token (the Authorization
 * header on POST /api/import-listing) and returns the signed-in user's id,
 * or null if it's missing/invalid. This endpoint fetches an arbitrary
 * caller-supplied URL server-side, so it must not be callable anonymously
 * — this is the check that enforces that. It doesn't check role
 * (traveler vs. operator): any signed-in account may use the prefill
 * assist, same as anyone can look at /dashboard's form; Row-Level Security
 * is still what actually gates whether a listing write succeeds.
 */
export async function verifyUser(accessToken: string): Promise<string | null> {
  if (!client) return null;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user.id;
}

/**
 * A Supabase client scoped to a specific signed-in user by passing their
 * access token as the Authorization header, so every query runs under that
 * user's Row-Level Security — the same rules as if they'd made the call from
 * the browser. Used by POST /api/sync-ical to update the operator's OWN
 * listing (their iCal-derived availability) without any elevated/service-role
 * privilege: the operator update policy already allows it, and RLS blocks
 * touching anyone else's listing.
 */
export function userClient(accessToken: string) {
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}
