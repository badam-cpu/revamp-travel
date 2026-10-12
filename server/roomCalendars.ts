/**
 * Hotels: calendar sync per individual room (migration 0096).
 *
 * IMPORT — each room keeps its own OTA feeds (Airbnb, Booking.com) in the
 * private `room_unit_calendars` table; a sync reads them and stores the busy
 * nights on `room_units.blocked_ranges`, which every room picker honours
 * (shared/rooms.ts `unitFree`, the `confirm_room_booking` SQL, room moves).
 * If every feed fails, the last-known-good nights are kept.
 *
 * EXPORT — `roomExportRanges` gives the room's Revamp bookings + the operator's
 * manual blocks for GET /api/ical/room/:unitId.ics. Imported nights are left
 * out on purpose, so an Airbnb block is never echoed back to Airbnb (where it
 * could outlive a cancellation).
 *
 * CONFLICTS — iCal is never instant, so an OTA can sell a night Revamp already
 * sold in the same room. After a sync, a confirmed Revamp booking overlapping an
 * imported range is a clash: the operator is emailed once per booking (tracked in
 * `conflicts_notified`) and the booking's history notes it. A range with exactly
 * the booking's own dates is treated as the OTA echoing our export, not a clash.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMergedBlockedRanges, type IcalFeed } from "./ical.js";
import { logBookingEvent } from "./bookings.js";
import { sendRoomCalendarConflict } from "./email.js";
import { roomUnitLabel } from "../shared/rooms.js";

type Range = { start: string; end: string };

export function normalizeRoomFeeds(raw: unknown): IcalFeed[] {
  if (!Array.isArray(raw)) return [];
  const out: IcalFeed[] = [];
  for (const f of raw as { url?: unknown; label?: unknown }[]) {
    const url = typeof f?.url === "string" ? f.url.trim() : "";
    if (!/^https:\/\//i.test(url)) continue;
    out.push({ url, label: typeof f?.label === "string" && f.label.trim() ? f.label.trim() : "Calendar" });
  }
  return out;
}

/** Revamp bookings in this room that an imported range now clashes with (echoes excluded). */
export function findConflicts<B extends { start_date: string; end_date: string }>(bookings: B[], imported: Range[]): B[] {
  return bookings.filter((b) =>
    imported.some((r) => r.start < b.end_date && r.end > b.start_date && !(r.start === b.start_date && r.end === b.end_date)),
  );
}

export interface RoomSyncResult {
  count: number;
  feeds: number;
  errors: string[];
  syncedAt: string;
  conflicts: number;
}

/** Re-pull one room's feeds, store its busy nights, and report new clashes. */
export async function syncRoomCalendar(admin: SupabaseClient, unitId: string, now = new Date()): Promise<RoomSyncResult> {
  const syncedAt = now.toISOString();
  const { data: cal, error: calErr } = await admin.from("room_unit_calendars").select("feeds, conflicts_notified").eq("room_unit_id", unitId).maybeSingle();
  if (calErr) throw new Error(`room calendar read failed: ${calErr.message}`);
  const feeds = normalizeRoomFeeds(cal?.feeds);

  if (!feeds.length) {
    // Disconnected: nothing imported any more.
    await admin.from("room_units").update({ blocked_ranges: [] }).eq("id", unitId);
    if (cal) await admin.from("room_unit_calendars").update({ synced_at: syncedAt, error: null }).eq("room_unit_id", unitId);
    return { count: 0, feeds: 0, errors: [], syncedAt, conflicts: 0 };
  }

  const { ranges, errors } = await fetchMergedBlockedRanges(feeds);
  const anyRead = errors.length < feeds.length;
  if (anyRead) {
    const { error: upErr } = await admin.from("room_units").update({ blocked_ranges: ranges }).eq("id", unitId);
    if (upErr) throw new Error(`room busy-nights write failed: ${upErr.message}`);
  }
  await admin
    .from("room_unit_calendars")
    .update({ synced_at: syncedAt, error: errors.length ? errors.join("; ") : null })
    .eq("room_unit_id", unitId);

  let conflicts = 0;
  if (anyRead) conflicts = await notifyConflicts(admin, unitId, ranges, feeds, Array.isArray(cal?.conflicts_notified) ? (cal!.conflicts_notified as string[]) : [], now);
  return { count: ranges.length, feeds: feeds.length, errors, syncedAt, conflicts };
}

async function notifyConflicts(admin: SupabaseClient, unitId: string, imported: Range[], feeds: IcalFeed[], notified: string[], now: Date): Promise<number> {
  const today = now.toISOString().slice(0, 10);
  const { data: bookings } = await admin
    .from("bookings")
    .select("id, start_date, end_date, guest_name, profiles!traveler_id(display_name)")
    .eq("room_unit_id", unitId)
    .eq("status", "confirmed")
    .gt("end_date", today);
  const clashing = findConflicts((bookings ?? []) as unknown as { id: string; start_date: string; end_date: string; guest_name: string | null; profiles: { display_name?: string } | null }[], imported);
  const fresh = clashing.filter((b) => !notified.includes(b.id));
  if (!fresh.length) return clashing.length;

  const { data: unit } = await admin.from("room_units").select("name, room_types(name), listings(title, operator_id)").eq("id", unitId).maybeSingle();
  const u = unit as unknown as { name: string; room_types: { name?: string } | null; listings: { title?: string; operator_id?: string } | null } | null;
  const room = u ? `${u.room_types?.name ? `${u.room_types.name} · ` : ""}${roomUnitLabel(u.name)}` : "A room";
  const source = Array.from(new Set(feeds.map((f) => f.label))).join(" / ");
  let to: string | undefined;
  if (u?.listings?.operator_id) {
    const { data } = await admin.auth.admin.getUserById(u.listings.operator_id);
    to = data?.user?.email ?? undefined;
  }
  for (const b of fresh) {
    await logBookingEvent(admin, b.id, "calendar_conflict", `${source} shows ${room} booked on some of these nights.`);
    if (to) {
      await sendRoomCalendarConflict(to, {
        hotel: u?.listings?.title ?? "your hotel",
        room,
        guestName: b.guest_name || b.profiles?.display_name || "Guest",
        checkIn: b.start_date,
        checkOut: b.end_date,
        source,
      }).catch((err) => console.error("[room-calendars] conflict email failed", err));
    }
  }
  // Remember who was told; drop bookings that no longer clash so a fresh clash re-alerts.
  const keep = clashing.map((b) => b.id);
  await admin.from("room_unit_calendars").update({ conflicts_notified: keep }).eq("room_unit_id", unitId);
  return clashing.length;
}

/** The hourly cron: every room that has at least one feed, a few at a time (a big
 *  hotel shouldn't run past the scheduled function's time limit). Tolerates a
 *  pre-0096 database. */
export async function syncAllRoomCalendars(admin: SupabaseClient, concurrency = 5): Promise<{ synced: number; failed: number; conflicts: number }> {
  const { data, error } = await admin.from("room_unit_calendars").select("room_unit_id, feeds");
  if (error) return { synced: 0, failed: 0, conflicts: 0 };
  const queue = ((data ?? []) as { room_unit_id: string; feeds: unknown }[]).filter((r) => normalizeRoomFeeds(r.feeds).length).map((r) => r.room_unit_id);
  let synced = 0;
  let failed = 0;
  let conflicts = 0;
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const r = await syncRoomCalendar(admin, id);
        if (r.errors.length === r.feeds) failed++;
        else synced++;
        conflicts += r.conflicts;
      } catch (err) {
        failed++;
        console.error("[room-calendars] sync failed", id, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { synced, failed, conflicts };
}

/** What a room's exported .ics carries: Revamp bookings + manual blocks (never imported nights). */
export async function roomExportRanges(admin: SupabaseClient, unitId: string): Promise<{ title: string; ranges: Range[] } | null> {
  const { data: unit } = await admin
    .from("room_units")
    .select("id, name, active, manual_blocked_ranges, room_types(name), listings(title, status)")
    .eq("id", unitId)
    .maybeSingle();
  const u = unit as unknown as { name: string; manual_blocked_ranges: Range[] | null; room_types: { name?: string } | null; listings: { title?: string; status?: string } | null } | null;
  if (!u || u.listings?.status !== "published") return null;
  const { data: booked } = await admin
    .from("bookings")
    .select("start_date, end_date")
    .eq("room_unit_id", unitId)
    .eq("status", "confirmed");
  const ranges = [
    ...(Array.isArray(u.manual_blocked_ranges) ? u.manual_blocked_ranges : []),
    ...((booked ?? []) as { start_date: string; end_date: string }[]).map((b) => ({ start: b.start_date, end: b.end_date })),
  ].filter((r) => r && r.start && r.end);
  return { title: `${u.listings?.title ?? "Revamp"} — ${roomUnitLabel(u.name)}`, ranges };
}
