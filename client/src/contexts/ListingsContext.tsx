/**
 * Live catalog, now backed by Supabase's `listings` table (see
 * supabase/migrations/0001_init.sql) instead of the old Express /api/listings
 * CRUD + file-backed store. Row-Level Security is what makes it safe to call
 * create/update/delete straight from the client: an operator can only ever
 * write rows where operator_id = auth.uid(), and only for type in
 * ('stay','tour') — Postgres enforces that, not this file.
 *
 * The public interface (`listings`, `refresh`, `createListing`,
 * `updateListing`, `deleteListing`, `offline`) is unchanged from the old
 * Express-backed version, so every consumer (Tours.tsx, Explore.tsx,
 * TourCard.tsx, TourDetail.tsx, ListingPage.tsx, Home.tsx) keeps working
 * without changes.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Listing, ListingInput, ListingType } from "@shared/listings";
import { seedListings, placeholderImage } from "@shared/listings";
import { supabase } from "@/lib/supabase";
import { slugify } from "@/lib/slug";
import { useAuth } from "@/contexts/AuthContext";

/** The live catalog carries a couple of fields the static seed type never needed: who owns a row, whether it's published, and (once submitted) any admin review feedback. Every existing consumer only reads the base `Listing` fields, so this is a superset, not a breaking change. */
export interface BlockedRange {
  start: string; // inclusive, YYYY-MM-DD
  end: string; // exclusive, YYYY-MM-DD
}
export interface SeasonalRate {
  start: string;
  end: string;
  priceCents: number;
  label?: string;
}

export type LiveListing = Listing & {
  operatorId: string;
  status: "draft" | "pending" | "published";
  reviewNote: string | null;
  reviewedAt: string | null;
  /** Airbnb (or other) calendar export URL, availability sync state, and the cached busy ranges. */
  icalUrl: string | null;
  icalSyncedAt: string | null;
  icalError: string | null;
  blockedRanges: BlockedRange[];
  seasonalRates: SeasonalRate[];
};

interface ListingsContextType {
  listings: LiveListing[];
  loading: boolean;
  /** Set when Supabase couldn't be reached — the app is showing the static seed instead. */
  offline: boolean;
  refresh: () => Promise<void>;
  createListing: (input: ListingInput) => Promise<LiveListing>;
  updateListing: (id: string, input: ListingInput) => Promise<LiveListing>;
  deleteListing: (id: string) => Promise<void>;
  /** Save the calendar export URL on a listing (the actual sync is POST /api/sync-ical). */
  setIcalUrl: (id: string, icalUrl: string | null) => Promise<LiveListing>;
}

const ListingsContext = createContext<ListingsContextType | undefined>(undefined);

const ROW_COLUMNS =
  "id, operator_id, type, slug, title, eyebrow, city, region, lat, lng, image, gallery, short_description, long_description, price_cents, price_unit, tags, amenities, facts, featured, accent, status, review_note, reviewed_at, ical_url, ical_synced_at, ical_error, blocked_ranges, seasonal_rates, max_guests";

interface ListingRow {
  id: string;
  operator_id: string;
  type: ListingType;
  slug: string;
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
  amenities: string[];
  facts: { label: string; value: string }[];
  featured: boolean;
  accent: "apricot" | "sevan" | "tuff";
  status: "draft" | "pending" | "published";
  review_note: string | null;
  reviewed_at: string | null;
  ical_url: string | null;
  ical_synced_at: string | null;
  ical_error: string | null;
  blocked_ranges: BlockedRange[] | null;
  seasonal_rates: SeasonalRate[] | null;
  max_guests: number | null;
}

function mapListingRow(row: ListingRow): LiveListing {
  const price = row.price_cents / 100;
  return {
    id: row.id,
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
    // Never render "$0": a listing with no price set reads as "Rate on request".
    priceLabel: price > 0 ? `$${price % 1 === 0 ? price : price.toFixed(2)}` : "Rate on request",
    priceUnit: row.price_unit,
    tags: row.tags,
    facts: row.facts,
    amenities: row.amenities,
    featured: row.featured,
    accent: row.accent,
    operatorId: row.operator_id,
    status: row.status,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    icalUrl: row.ical_url,
    icalSyncedAt: row.ical_synced_at,
    icalError: row.ical_error,
    blockedRanges: Array.isArray(row.blocked_ranges) ? row.blocked_ranges : [],
    seasonalRates: Array.isArray(row.seasonal_rates) ? row.seasonal_rates : [],
    maxGuests: row.max_guests ?? undefined,
  };
}

function toRow(input: ListingInput) {
  const image = input.image?.trim() || placeholderImage;
  return {
    type: input.type,
    title: input.title,
    eyebrow: input.eyebrow,
    city: input.city,
    region: input.region,
    lat: input.coordinates.lat,
    lng: input.coordinates.lng,
    image,
    gallery: input.gallery?.length ? input.gallery : [image],
    short_description: input.shortDescription,
    long_description: input.longDescription,
    price_cents: Math.round(input.price * 100),
    price_unit: input.priceUnit,
    tags: input.tags,
    amenities: input.amenities,
    facts: input.facts,
    featured: input.featured ?? false,
    accent: input.accent,
    max_guests: input.maxGuests ?? null,
  };
}

function fallbackListings(): LiveListing[] {
  return seedListings.map((listing) => ({
    ...listing,
    operatorId: "seed",
    status: "published" as const,
    reviewNote: null,
    reviewedAt: null,
    icalUrl: null,
    icalSyncedAt: null,
    icalError: null,
    blockedRanges: [],
    seasonalRates: [],
  }));
}

export function ListingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [listings, setListings] = useState<LiveListing[]>(fallbackListings());
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("listings").select(ROW_COLUMNS).order("created_at", { ascending: true });
      if (error) throw error;
      setListings((data ?? []).map(mapListingRow));
      setOffline(false);
    } catch (err) {
      console.error("Failed to load listings from Supabase — showing the static seed instead.", err);
      setListings(fallbackListings());
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch whenever the signed-in user changes: RLS returns a different
  // row set for a signed-in operator (their own drafts included) than for a
  // signed-out visitor, so a sign-in/out needs a fresh read, not a stale one.
  useEffect(() => {
    refresh();
  }, [refresh, user?.id]);

  const createListing = useCallback(
    async (input: ListingInput): Promise<LiveListing> => {
      if (!user) throw new Error("You need to be signed in as an operator to add a listing.");
      const base = slugify(input.title);
      let slug = base;
      // Retry on a slug collision (unique constraint) instead of pre-checking
      // for existing slugs — correct under concurrent writers, unlike an
      // in-memory check would be.
      for (let attempt = 1; attempt <= 6; attempt++) {
        const { data, error } = await supabase
          .from("listings")
          // Every new listing starts in review — RLS requires status:
          // "pending" on insert (supabase/migrations/0002_review_gate_and_admin.sql),
          // this just makes that requirement visible here too.
          .insert({ ...toRow(input), slug, operator_id: user.id, status: "pending" })
          .select(ROW_COLUMNS)
          .single();
        if (!error) {
          const listing = mapListingRow(data);
          setListings((prev) => [...prev, listing]);
          return listing;
        }
        if (error.code === "23505" && attempt < 6) {
          slug = `${base}-${attempt + 1}`;
          continue;
        }
        throw new Error(error.message);
      }
      throw new Error("Couldn't generate a unique URL for this listing. Try a more distinct title.");
    },
    [user],
  );

  const updateListing = useCallback(
    async (id: string, input: ListingInput): Promise<LiveListing> => {
      // A listing sitting at "draft" is one an admin sent back with
      // feedback (see review_note) — saving it is what resubmits it, so
      // this is the one case that also touches status. Editing a
      // "pending" or already-"published" listing's content leaves its
      // status untouched (a live listing doesn't get pulled for a typo
      // fix); the review-gate trigger enforces this server-side too, this
      // is just what makes the intent visible client-side.
      const current = listings.find((item) => item.id === id);
      const patch = current?.status === "draft" ? { ...toRow(input), status: "pending" as const } : toRow(input);
      const { data, error } = await supabase.from("listings").update(patch).eq("id", id).select(ROW_COLUMNS).single();
      if (error) throw new Error(error.message);
      const listing = mapListingRow(data);
      setListings((prev) => prev.map((item) => (item.id === id ? listing : item)));
      return listing;
    },
    [listings],
  );

  const deleteListing = useCallback(async (id: string) => {
    const { error } = await supabase.from("listings").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setListings((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const setIcalUrl = useCallback(async (id: string, icalUrl: string | null): Promise<LiveListing> => {
    const { data, error } = await supabase
      .from("listings")
      .update({ ical_url: icalUrl?.trim() || null })
      .eq("id", id)
      .select(ROW_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    const listing = mapListingRow(data);
    setListings((prev) => prev.map((item) => (item.id === id ? listing : item)));
    return listing;
  }, []);

  return (
    <ListingsContext.Provider value={{ listings, loading, offline, refresh, createListing, updateListing, deleteListing, setIcalUrl }}>
      {children}
    </ListingsContext.Provider>
  );
}

export function useListings() {
  const context = useContext(ListingsContext);
  if (!context) {
    throw new Error("useListings must be used within ListingsProvider");
  }
  return context;
}
