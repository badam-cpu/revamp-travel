/**
 * Time-slot session generation + seat reservation for tours & experiences.
 * Sits between shared/sessions.ts (pure schedule → slot math) and the DB. All
 * writes are service-role: sessions are generated server-side, and seats are only
 * ever moved by a guarded conditional update (the same integrity model as the
 * PayLink booking confirm), so capacity can't be forged from a client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateSessionStarts, scheduleHasSlots, type SessionSchedule } from "../shared/sessions.js";
import { fetchMergedBusyIntervals, type IcalFeed } from "./ical.js";

/**
 * Generate the listing's rolling window of sessions from its schedule and insert
 * any that don't exist yet. Idempotent: existing sessions (and their seats) are
 * left untouched — a schedule edit adds new future slots but never rewrites a
 * slot someone may have already booked. Returns how many were created.
 */
export async function syncListingSessions(admin: SupabaseClient, listingId: string): Promise<{ created: number }> {
  const { data: listing } = await admin.from("listings").select("session_schedule").eq("id", listingId).maybeSingle();
  const schedule = (listing?.session_schedule ?? null) as SessionSchedule | null;
  if (!scheduleHasSlots(schedule)) return { created: 0 };

  const wanted = generateSessionStarts(schedule!);
  if (wanted.length === 0) return { created: 0 };

  // Which of these already exist? (Insert only the missing ones so seats/capacity
  // on existing sessions are preserved.)
  const firstIso = wanted[0].startsAt;
  const { data: existingRows } = await admin
    .from("listing_sessions")
    .select("starts_at")
    .eq("listing_id", listingId)
    .gte("starts_at", firstIso);
  const existing = new Set((existingRows ?? []).map((r) => new Date(r.starts_at as string).toISOString()));

  const toInsert = wanted
    .filter((s) => !existing.has(s.startsAt))
    .map((s) => ({ listing_id: listingId, starts_at: s.startsAt, duration_min: s.durationMin, capacity: s.capacity, source: "schedule" }));
  if (toInsert.length === 0) return { created: 0 };

  // Chunk to keep payloads sane.
  let created = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const { error, count } = await admin.from("listing_sessions").insert(chunk, { count: "exact" });
    if (!error) created += count ?? chunk.length;
    else console.error("[sessions] insert failed", listingId, error.message);
  }
  return { created };
}

/** Regenerate sessions for every tour/experience that has a schedule (cron). */
export async function syncAllSessions(admin: SupabaseClient, { limit = 500 }: { limit?: number } = {}): Promise<{ listings: number; created: number }> {
  const { data } = await admin
    .from("listings")
    .select("id")
    .in("type", ["tour", "experience"])
    .not("session_schedule", "is", null)
    .limit(limit);
  const rows = data ?? [];
  let created = 0;
  for (const r of rows) {
    try {
      const res = await syncListingSessions(admin, r.id as string);
      created += res.created;
    } catch (err) {
      console.error("[sessions] sync failed", r.id, err);
    }
  }
  return { listings: rows.length, created };
}

/**
 * Atomically reserve `guests` seats on a session. Returns true only if the seats
 * were available (open session, capacity not exceeded). Uses a read-then-guarded-
 * write; the write's `.eq("seats_taken", current)` makes it a compare-and-set, so
 * two concurrent reservations can't both win.
 */
export async function reserveSeats(admin: SupabaseClient, sessionId: string, guests: number): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: s } = await admin.from("listing_sessions").select("seats_taken, capacity, status").eq("id", sessionId).maybeSingle();
    if (!s || s.status !== "open") return false;
    const taken = s.seats_taken as number;
    if (taken + guests > (s.capacity as number)) return false;
    const { data: upd } = await admin
      .from("listing_sessions")
      .update({ seats_taken: taken + guests })
      .eq("id", sessionId)
      .eq("seats_taken", taken) // compare-and-set: only if nobody moved it since
      .select("id");
    if (upd && upd.length) return true;
    // Someone else changed seats_taken — retry with fresh value.
  }
  return false;
}

/** Release `guests` seats previously reserved (on payment failure / expiry / cancel). */
export async function releaseSeats(admin: SupabaseClient, sessionId: string, guests: number): Promise<void> {
  const { data: s } = await admin.from("listing_sessions").select("seats_taken").eq("id", sessionId).maybeSingle();
  if (!s) return;
  const next = Math.max(0, (s.seats_taken as number) - guests);
  await admin.from("listing_sessions").update({ seats_taken: next }).eq("id", sessionId);
}

/**
 * Apply an external calendar (e.g. Fresha, GetYourGuide) to a listing's future
 * sessions: any auto-generated, un-booked session that overlaps a busy interval
 * is closed; one that no longer overlaps is reopened. Only touches
 * source='schedule' sessions with no seats taken — a session someone already
 * booked is never hidden. Returns how many flipped.
 */
export async function applyIcalToSessions(admin: SupabaseClient, listingId: string, feeds: IcalFeed[]): Promise<{ closed: number; opened: number }> {
  if (!feeds.length) return { closed: 0, opened: 0 };
  const { intervals } = await fetchMergedBusyIntervals(feeds);
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("listing_sessions")
    .select("id, starts_at, duration_min, status, seats_taken, source")
    .eq("listing_id", listingId)
    .gte("starts_at", nowIso);
  let closed = 0;
  let opened = 0;
  for (const s of data ?? []) {
    if (s.source !== "schedule" || (s.seats_taken as number) > 0) continue; // never hide booked/manual sessions
    const startMs = Date.parse(s.starts_at as string);
    const endMs = startMs + (s.duration_min as number) * 60_000;
    const overlaps = intervals.some((iv) => startMs < iv.endMs && endMs > iv.startMs);
    const want = overlaps ? "closed" : "open";
    if (s.status !== want) {
      await admin.from("listing_sessions").update({ status: want }).eq("id", s.id);
      if (want === "closed") closed++;
      else opened++;
    }
  }
  return { closed, opened };
}
