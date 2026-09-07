/**
 * Live, editable replacement for the old static `listings` import. Fetches
 * the shared catalog from the Express API (`server/routes.ts`) on mount and
 * exposes create/update/delete so the Manage page can mutate it. Falls back
 * to the static seed (read-only) if the API can't be reached, so the rest
 * of the marketplace still renders.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Listing, ListingInput } from "@shared/listings";
import { seedListings } from "@shared/listings";
import * as api from "@/lib/api";

interface ListingsContextType {
  listings: Listing[];
  loading: boolean;
  /** Set when the API couldn't be reached — the app is showing the static seed instead. */
  offline: boolean;
  refresh: () => Promise<void>;
  createListing: (input: ListingInput) => Promise<Listing>;
  updateListing: (id: string, input: ListingInput) => Promise<Listing>;
  deleteListing: (id: string) => Promise<void>;
}

const ListingsContext = createContext<ListingsContextType | undefined>(undefined);

export function ListingsProvider({ children }: { children: React.ReactNode }) {
  const [listings, setListings] = useState<Listing[]>(seedListings);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getListings();
      setListings(data);
      setOffline(false);
    } catch {
      setListings(seedListings);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createListing = useCallback(async (input: ListingInput) => {
    const listing = await api.createListing(input);
    await refresh();
    return listing;
  }, [refresh]);

  const updateListing = useCallback(async (id: string, input: ListingInput) => {
    const listing = await api.updateListing(id, input);
    await refresh();
    return listing;
  }, [refresh]);

  const deleteListing = useCallback(async (id: string) => {
    await api.deleteListing(id);
    await refresh();
  }, [refresh]);

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
