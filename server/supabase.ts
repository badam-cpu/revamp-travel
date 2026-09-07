/**
 * Read-only Supabase access for the trip planner. Uses the anon key
 * deliberately — the planner only ever needs published listings, which
 * Row-Level Security already makes publicly readable (see
 * "published listings are publicly readable" in
 * supabase/migrations/0001_init.sql), so there's no reason for this to hold
 * a more privileged key. Listing CRUD itself no longer goes through the
 * server at all — the client talks to Supabase directly under RLS
 * (see client/src/contexts/ListingsContext.tsx).
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
