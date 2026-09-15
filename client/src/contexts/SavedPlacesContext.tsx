/**
 * A signed-in traveler's saved (bookmarked) listings — the first persisted
 * piece of the traveler account. Backed by the `saved_places` table (see
 * supabase/migrations/0009_saved_places.sql), it centralises what used to be
 * five separate "saved for later" toasts (ListingCard, TourCard, ListingPage,
 * TourDetail, and the header bookmark) into one shared source of truth so the
 * Save buttons, the header, and the /account saved view all agree.
 *
 * Mirrors the loading/state shape of AuthContext / ListingsContext. Rows are
 * private to their owner by RLS, so a signed-out visitor simply has an empty
 * set and Save prompts them to sign in. Toggling is optimistic: the UI flips
 * immediately and rolls back if Supabase rejects the write.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface SavedPlacesContextType {
  /** Listing ids the current account has saved. */
  savedIds: Set<string>;
  loading: boolean;
  isSaved: (listingId: string) => boolean;
  /** Save or unsave a listing. No-op with a sign-in prompt when signed out. */
  toggleSaved: (listing: { id: string; title: string }) => Promise<void>;
}

const SavedPlacesContext = createContext<SavedPlacesContextType | undefined>(undefined);

export function SavedPlacesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Load (or clear) the saved set whenever the signed-in account changes.
  useEffect(() => {
    let active = true;
    if (!user) {
      setSavedIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from("saved_places")
      .select("listing_id")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          // Table missing (migration not yet run) or offline — degrade to empty
          // rather than breaking browsing.
          console.error("Failed to load saved places", error);
          setSavedIds(new Set());
        } else {
          setSavedIds(new Set((data ?? []).map((r) => r.listing_id as string)));
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const isSaved = useCallback((listingId: string) => savedIds.has(listingId), [savedIds]);

  const toggleSaved = useCallback(
    async ({ id, title }: { id: string; title: string }) => {
      if (!user) {
        toast("Sign in to save places", {
          description: "Create a free account to keep your favourites.",
          action: { label: "Sign in", onClick: () => (window.location.href = "/login") },
        });
        return;
      }

      const wasSaved = savedIds.has(id);
      // Optimistic flip.
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.delete(id);
        else next.add(id);
        return next;
      });

      try {
        if (wasSaved) {
          const { error } = await supabase.from("saved_places").delete().eq("listing_id", id);
          if (error) throw error;
          toast(`Removed ${title} from saved.`);
        } else {
          const { error } = await supabase
            .from("saved_places")
            .upsert({ traveler_id: user.id, listing_id: id }, { onConflict: "traveler_id,listing_id" });
          if (error) throw error;
          toast(`Saved ${title}.`);
        }
      } catch (err) {
        // Roll back the optimistic change.
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (wasSaved) next.add(id);
          else next.delete(id);
          return next;
        });
        toast(err instanceof Error ? err.message : "Couldn't update your saved places.");
      }
    },
    [user, savedIds],
  );

  return (
    <SavedPlacesContext.Provider value={{ savedIds, loading, isSaved, toggleSaved }}>
      {children}
    </SavedPlacesContext.Provider>
  );
}

export function useSavedPlaces() {
  const context = useContext(SavedPlacesContext);
  if (!context) {
    throw new Error("useSavedPlaces must be used within SavedPlacesProvider");
  }
  return context;
}
