/**
 * Client reads for time-slot sessions (tours & experiences). Sessions are public
 * for published listings (RLS), so the slot picker reads them straight from
 * Supabase; only 'open' future sessions with seats left are bookable. iCal-blocked
 * sessions are set to 'closed' server-side, so filtering on status='open' already
 * hides them.
 */
import { supabase } from "@/lib/supabase";
import { slotLocalDate, formatSlotTime } from "@shared/sessions";

export interface ListingSession {
  id: string;
  startsAt: string; // UTC ISO
  durationMin: number;
  capacity: number;
  seatsTaken: number;
  seatsLeft: number;
}

/** Bookable (open, future, seats-left) sessions for a listing, sorted by time. */
export async function getListingSessions(listingId: string): Promise<ListingSession[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("listing_sessions")
    .select("id, starts_at, duration_min, capacity, seats_taken")
    .eq("listing_id", listingId)
    .eq("status", "open")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true });
  if (error || !data) return [];
  return data
    .map((r) => ({
      id: r.id as string,
      startsAt: r.starts_at as string,
      durationMin: r.duration_min as number,
      capacity: r.capacity as number,
      seatsTaken: r.seats_taken as number,
      seatsLeft: (r.capacity as number) - (r.seats_taken as number),
    }))
    .filter((s) => s.seatsLeft > 0);
}

/** Group sessions by their Armenia-local calendar date (YYYY-MM-DD). */
export function groupSessionsByDate(sessions: ListingSession[]): { date: string; sessions: ListingSession[] }[] {
  const map = new Map<string, ListingSession[]>();
  for (const s of sessions) {
    const d = slotLocalDate(s.startsAt);
    const bucket = map.get(d) ?? [];
    bucket.push(s);
    map.set(d, bucket);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, ss]) => ({ date, sessions: ss }));
}

export { slotLocalDate, formatSlotTime };
