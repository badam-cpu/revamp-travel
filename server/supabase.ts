/**
 * Read-only Supabase access for the server's two remaining jobs: the trip
 * planner's catalog digest, and verifying who's calling
 * POST /api/import-listing. Uses the anon key deliberately in both cases —
 * the planner only ever needs published listings, which Row-Level Security
 * already makes publicly readable (see "published listings are publicly
 * readable" in supabase/migrations/0001_init.sql), and verifying a token
 * doesn't need elevated privilege either. Listing CRUD itself no longer
 * goes through the server at all — the client talks to Supabase directly
 * under RLS (see client/src/contexts/ListingsContext.tsx).
 */
import { createClient } from "@supabase/supabase-js";
import type { Listing } from "../shared/listings.js";
import type { CatalogEntry } from "./planner.js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const client = url && anonKey ? createClient(url, anonKey) : null;

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
