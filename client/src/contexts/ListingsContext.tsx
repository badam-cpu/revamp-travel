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

/** The live catalog carries a couple of fields the static seed type never needed: who owns a row, and whether it's published. Every existing consumer only reads the base `Listing` fields, so this is a superset, not a breaking change. */
export type LiveListing = Listing & { operatorId: string; status: "draft" | "published" };

interface ListingsContextType {
  listings: LiveListing[];
  loading: boolean;
  /** Set when Supabase couldn't be reached — the app is showing the static seed instead. */
  offline: boolean;
  refresh: () => Promise<void>;
  createListing: (input: ListingInput) => Promise<LiveListing>;
  updateListing: (id: string, input: ListingInput) => Promise<LiveListing>;
  deleteListing: (id: string) => Promise<void>;
}

const ListingsContext = createContext<ListingsContextType | undefined>(undefined);

const ROW_COLUMNS =
  "id, operator_id, type, slug, title, eyebrow, city, region, lat, lng, image, gallery, short_description, long_description, price_cents, price_unit, tags, amenities, facts, featured, accent, status";

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
  status: "draft" | "published";
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
    priceLabel: `$${price % 1 === 0 ? price : price.toFixed(2)}`,
    priceUnit: row.price_unit,
    tags: row.tags,
    facts: row.facts,
    amenities: row.amenities,
    featured: row.featured,
    accent: row.accent,
    operatorId: row.operator_id,
    status: row.status,
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
  };
}

function fallbackListings(): LiveListing[] {
  return seedListings.map((listing) => ({ ...listing, operatorId: "seed", status: "published" as const }));
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
          .insert({ ...toRow(input), slug, operator_id: user.id })
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

  const updateListing = useCallback(async (id: string, input: ListingInput): Promise<LiveListing> => {
    const { data, error } = await supabase.from("listings").update(toRow(input)).eq("id", id).select(ROW_COLUMNS).single();
    if (error) throw new Error(error.message);
    const listing = mapListingRow(data);
    setListings((prev) => prev.map((item) => (item.id === id ? listing : item)));
    return listing;
  }, []);

  const deleteListing = useCallback(async (id: string) => {
    const { error } = await supabase.from("listings").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setListings((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return (
    <ListingsContext.Provider value={{ listings, loading, offline, refresh, createListing, updateListing, deleteListing }}>
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
