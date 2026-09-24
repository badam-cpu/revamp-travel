/**
 * Live catalog, now backed by Supabase's `listings` table (see
 * supabase/migrations/0001_init.sql) instead of the old Express /api/listings
 * CRUD + file-backed store. Row-Level Security is what makes it safe to call
 * create/update/delete straight from the client: an operator can only ever
 * write rows where operator_id = auth.uid(), and only for type in
 * ('stay','tour','experience') — Postgres enforces that, not this file.
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
  /** Multiple import feeds (Airbnb, Booking.com, …). Legacy icalUrl still read as a fallback. */
  icalFeeds: { url: string; label: string }[];
  icalSyncedAt: string | null;
  icalError: string | null;
  blockedRanges: BlockedRange[];
  /** Operator-set manual unavailability (end EXCLUSIVE), separate from iCal blocked_ranges. */
  manualBlockedRanges: BlockedRange[];
  seasonalRates: SeasonalRate[];
};

interface ListingsContextType {
  listings: LiveListing[];
  loading: boolean;
  /** Set when Supabase couldn't be reached — the app is showing the static seed instead. */
  offline: boolean;
  refresh: () => Promise<void>;
  // submit=true submits for review (status "pending"); submit=false saves a
  // draft (status "draft"). Defaults to true to preserve existing callers.
  createListing: (input: ListingInput, submit?: boolean) => Promise<LiveListing>;
  updateListing: (id: string, input: ListingInput, submit?: boolean) => Promise<LiveListing>;
  deleteListing: (id: string) => Promise<void>;
  /** Save the calendar export URL on a listing (the actual sync is POST /api/sync-ical). */
  setIcalUrl: (id: string, icalUrl: string | null) => Promise<LiveListing>;
  /** Save the listing's import feeds (Airbnb/Booking.com/…); the sync then merges them. */
  setIcalFeeds: (id: string, feeds: { url: string; label: string }[]) => Promise<LiveListing>;
  setSeasonalRates: (id: string, rates: SeasonalRate[]) => Promise<LiveListing>;
  /** Save the operator's manual availability blocks (content-only; status untouched). */
  setManualBlocks: (id: string, ranges: BlockedRange[]) => Promise<LiveListing>;
  /** Save a listing's facts array (content-only; status untouched). */
  setListingFacts: (id: string, facts: { label: string; value: string }[]) => Promise<LiveListing>;
}

const ListingsContext = createContext<ListingsContextType | undefined>(undefined);

// Select "*" rather than a fixed column list: as new columns are added by
// migrations, a client deployed before the DB migration runs would otherwise
// request a column that doesn't exist and fail the WHOLE query — blanking the
// catalog. "*" returns whatever columns exist; missing ones default in mapListingRow.
const ROW_COLUMNS = "*";

interface ListingRow {
  id: string;
  operator_id: string;
  type: ListingType;
  slug: string;
  title: string;
  eyebrow: string;
  city: string;
  region: string;
  address: string | null;
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
  ical_feeds: { url: string; label: string }[] | null;
  ical_synced_at: string | null;
  ical_error: string | null;
  blocked_ranges: BlockedRange[] | null;
  manual_blocked_ranges: BlockedRange[] | null;
  seasonal_rates: SeasonalRate[] | null;
  max_guests: number | null;
  highlights: string[] | null;
  not_included: string[] | null;
  what_to_bring: string[] | null;
  important_info: string | null;
  not_suitable_for: string[] | null;
  cancellation_policy: "flexible" | "non_refundable" | null;
  free_cancel_days: number | null;
  nonrefundable_discount_percent: number | null;
  cleaning_fee_cents: number | null;
  house_rules: string[] | null;
  neighborhood: string | null;
  nearby: { name: string; category?: string; distanceM?: number }[] | null;
  discount_type: "percent" | "amount" | null;
  discount_value: number | null;
  discount_start: string | null;
  discount_end: string | null;
  rooms: { name: string; beds: { type: string; count: number }[] }[] | null;
  venue_type: string | null;
  cover_focus: string | null;
  cuisine: string | null;
  price_band: "$" | "$$" | "$$$" | null;
  website: string | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_rating_count: number | null;
  tripadvisor_location_id: string | null;
  tripadvisor_rating: number | null;
  tripadvisor_rating_count: number | null;
  tripadvisor_url: string | null;
  tripadvisor_rating_image: string | null;
  tripadvisor_menu_url: string | null;
  is_partner: boolean | null;
  claimed_by: string | null;
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
    address: row.address ?? undefined,
    coordinates: { lat: row.lat, lng: row.lng },
    image: row.image,
    gallery: row.gallery,
    shortDescription: row.short_description,
    longDescription: row.long_description,
    price,
    // Never render "֏0": a listing with no price set reads as "Rate on request".
    // AMD-primary: prices are in Armenian dram, shown as whole drams.
    priceLabel: price > 0 ? `֏${Math.round(price).toLocaleString()}` : "Rate on request",
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
    icalFeeds: Array.isArray(row.ical_feeds) ? row.ical_feeds : [],
    icalSyncedAt: row.ical_synced_at,
    icalError: row.ical_error,
    blockedRanges: Array.isArray(row.blocked_ranges) ? row.blocked_ranges : [],
    manualBlockedRanges: Array.isArray(row.manual_blocked_ranges) ? row.manual_blocked_ranges : [],
    seasonalRates: Array.isArray(row.seasonal_rates) ? row.seasonal_rates : [],
    maxGuests: row.max_guests ?? undefined,
    highlights: row.highlights ?? [],
    notIncluded: row.not_included ?? [],
    whatToBring: row.what_to_bring ?? [],
    importantInfo: row.important_info ?? "",
    notSuitableFor: row.not_suitable_for ?? [],
    cancellationPolicy: row.cancellation_policy ?? "flexible",
    freeCancelDays: row.free_cancel_days ?? 7,
    nonrefundableDiscountPercent: row.nonrefundable_discount_percent ?? 0,
    cleaningFeeCents: row.cleaning_fee_cents ?? 0,
    houseRules: row.house_rules ?? [],
    neighborhood: row.neighborhood ?? undefined,
    nearby: row.nearby ?? [],
    discountType: row.discount_type ?? null,
    discountValue: row.discount_value ?? 0,
    discountStart: row.discount_start ?? undefined,
    discountEnd: row.discount_end ?? undefined,
    rooms: Array.isArray(row.rooms) ? row.rooms : [],
    coverFocus: row.cover_focus ?? undefined,
    venueType: row.venue_type ?? undefined,
    cuisine: row.cuisine ?? undefined,
    priceBand: row.price_band ?? undefined,
    website: row.website ?? undefined,
    googlePlaceId: row.google_place_id ?? undefined,
    googleRating: row.google_rating ?? undefined,
    googleRatingCount: row.google_rating_count ?? undefined,
    tripadvisorLocationId: row.tripadvisor_location_id ?? undefined,
    tripadvisorRating: row.tripadvisor_rating ?? undefined,
    tripadvisorRatingCount: row.tripadvisor_rating_count ?? undefined,
    tripadvisorUrl: row.tripadvisor_url ?? undefined,
    tripadvisorRatingImage: row.tripadvisor_rating_image ?? undefined,
    tripadvisorMenuUrl: row.tripadvisor_menu_url ?? undefined,
    isPartner: row.is_partner ?? false,
    claimedBy: row.claimed_by ?? null,
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
    address: input.address?.trim() || null,
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
    highlights: input.highlights ?? [],
    not_included: input.notIncluded ?? [],
    what_to_bring: input.whatToBring ?? [],
    important_info: input.importantInfo ?? "",
    not_suitable_for: input.notSuitableFor ?? [],
    cancellation_policy: input.cancellationPolicy ?? "flexible",
    free_cancel_days: input.freeCancelDays ?? 7,
    nonrefundable_discount_percent: input.nonrefundableDiscountPercent ?? 5,
    cleaning_fee_cents: input.cleaningFeeCents ?? 0,
    house_rules: input.houseRules ?? [],
    neighborhood: input.neighborhood ?? null,
    nearby: input.nearby ?? [],
    discount_type: input.discountType ?? null,
    discount_value: input.discountValue ?? 0,
    discount_start: input.discountStart || null,
    discount_end: input.discountEnd || null,
    rooms: input.rooms ?? [],
    seasonal_rates: input.seasonalRates ?? [],
    cover_focus: input.coverFocus?.trim() || null,
    venue_type: input.venueType?.trim() || null,
    cuisine: input.cuisine?.trim() || null,
    price_band: input.priceBand ?? null,
    website: input.website?.trim() || null,
    google_place_id: input.googlePlaceId?.trim() || null,
    google_rating: input.googleRating ?? null,
    google_rating_count: input.googleRatingCount ?? null,
    tripadvisor_location_id: input.tripadvisorLocationId?.trim() || null,
    tripadvisor_rating: input.tripadvisorRating ?? null,
    tripadvisor_rating_count: input.tripadvisorRatingCount ?? null,
    tripadvisor_url: input.tripadvisorUrl?.trim() || null,
    tripadvisor_rating_image: input.tripadvisorRatingImage?.trim() || null,
    tripadvisor_menu_url: input.tripadvisorMenuUrl?.trim() || null,
    is_partner: input.isPartner ?? false,
    claimed_by: input.claimedBy ?? null,
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
    icalFeeds: [],
    icalSyncedAt: null,
    icalError: null,
    blockedRanges: [],
    manualBlockedRanges: [],
    seasonalRates: [],
  }));
}

export function ListingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Start empty (not seeded) so the first paint shows skeletons via `loading`,
  // not the brand-illustration placeholders that then flash to the real photos.
  // The seed is only used as an offline fallback when the fetch fails.
  const [listings, setListings] = useState<LiveListing[]>([]);
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
    async (input: ListingInput, submit = true): Promise<LiveListing> => {
      if (!user) throw new Error("You need to be signed in as an operator to add a listing.");
      const base = slugify(input.title);
      let slug = base;
      // submit=true → "pending" (into the review queue); submit=false → "draft"
      // (work in progress, not yet reviewed). RLS allows both on insert since
      // migration 0031.
      const status = submit ? "pending" : "draft";
      // Retry on a slug collision (unique constraint) instead of pre-checking
      // for existing slugs — correct under concurrent writers, unlike an
      // in-memory check would be.
      for (let attempt = 1; attempt <= 6; attempt++) {
        const { data, error } = await supabase
          .from("listings")
          .insert({ ...toRow(input), slug, operator_id: user.id, status })
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
    async (id: string, input: ListingInput, submit = true): Promise<LiveListing> => {
      // Status intent (the review-gate trigger enforces the same rules server-
      // side; this just makes them visible client-side):
      //  • published listing → never change status here (a live listing isn't
      //    pulled for an edit); save content only.
      //  • otherwise (draft or pending) → submit=true sets "pending" (into/keep
      //    in review), submit=false sets "draft" (save without submitting).
      const current = listings.find((item) => item.id === id);
      const patch =
        current?.status === "published"
          ? toRow(input)
          : { ...toRow(input), status: (submit ? "pending" : "draft") as "pending" | "draft" };
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

  const setIcalFeeds = useCallback(async (id: string, feeds: { url: string; label: string }[]): Promise<LiveListing> => {
    const clean = feeds.map((f) => ({ url: f.url.trim(), label: f.label.trim() || "Calendar" })).filter((f) => f.url);
    const { data, error } = await supabase
      .from("listings")
      .update({ ical_feeds: clean })
      .eq("id", id)
      .select(ROW_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    const listing = mapListingRow(data);
    setListings((prev) => prev.map((item) => (item.id === id ? listing : item)));
    return listing;
  }, []);

  // Update only a listing's seasonal/daily rates (from the pricing timeline).
  // A content-only edit — doesn't touch status (review gate untouched).
  const setSeasonalRates = useCallback(async (id: string, rates: SeasonalRate[]): Promise<LiveListing> => {
    const { data, error } = await supabase
      .from("listings")
      .update({ seasonal_rates: rates })
      .eq("id", id)
      .select(ROW_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    const listing = mapListingRow(data);
    setListings((prev) => prev.map((item) => (item.id === id ? listing : item)));
    return listing;
  }, []);

  // Update only a listing's manual availability blocks (from the calendar
  // block/open controls). Content-only — doesn't touch status.
  const setManualBlocks = useCallback(async (id: string, ranges: BlockedRange[]): Promise<LiveListing> => {
    const { data, error } = await supabase
      .from("listings")
      .update({ manual_blocked_ranges: ranges })
      .eq("id", id)
      .select(ROW_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    const listing = mapListingRow(data);
    setListings((prev) => prev.map((item) => (item.id === id ? listing : item)));
    return listing;
  }, []);

  // Update only a listing's facts (from the calendar's min-stay control).
  // Content-only — doesn't touch status.
  const setListingFacts = useCallback(async (id: string, facts: { label: string; value: string }[]): Promise<LiveListing> => {
    const { data, error } = await supabase
      .from("listings")
      .update({ facts })
      .eq("id", id)
      .select(ROW_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    const listing = mapListingRow(data);
    setListings((prev) => prev.map((item) => (item.id === id ? listing : item)));
    return listing;
  }, []);

  return (
    <ListingsContext.Provider value={{ listings, loading, offline, refresh, createListing, updateListing, deleteListing, setIcalUrl, setIcalFeeds, setSeasonalRates, setManualBlocks, setListingFacts }}>
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
