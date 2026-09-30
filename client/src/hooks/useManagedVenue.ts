/**
 * True when the signed-in account manages at least one restaurant venue
 * (restaurant_managers, migration 0078) — used to show the "My venue" link only
 * to owners. Reads own rows under RLS; degrades to false if signed out or the
 * table isn't there yet.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

export function useManagedVenue(): boolean {
  const { user } = useAuth();
  const [hasVenue, setHasVenue] = useState(false);

  useEffect(() => {
    if (!user) { setHasVenue(false); return; }
    let active = true;
    supabase
      .from("restaurant_managers")
      .select("listing_id")
      .eq("user_id", user.id)
      .limit(1)
      .then(({ data, error }) => { if (active) setHasVenue(!error && (data?.length ?? 0) > 0); });
    return () => { active = false; };
  }, [user?.id]);

  return hasVenue;
}
