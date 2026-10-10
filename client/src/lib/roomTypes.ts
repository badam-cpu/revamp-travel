/**
 * Room types of a multi-room property (hotel) — migration 0092. Reads go
 * straight to Supabase under RLS (public for published listings, the owner for
 * their own drafts); writes are the operator's own rows (RLS-scoped to their
 * stay listings). The booking amount is always recomputed server-side from the
 * stored room price, so nothing here is a trust decision.
 */
import { supabase } from "@/lib/supabase";
import type { RoomBed, RoomType, RoomTypeInput } from "@shared/listings";

// The pure availability/price helpers live in shared/rooms.ts; re-exported for
// the components that already import them from here.
export { quoteRoom, roomAvailable, soldOutNights, type RoomQuote } from "@shared/rooms";

interface RoomTypeRow {
  id: string;
  listing_id: string;
  name: string;
  description: string | null;
  beds: RoomBed[] | null;
  max_guests: number;
  size_m2: number | null;
  price_cents: number;
  price_unit: string | null;
  quantity: number;
  image: string | null;
  gallery: string[] | null;
  amenities: string[] | null;
  sort_order: number | null;
}

export function mapRoomTypeRow(row: RoomTypeRow): RoomType {
  return {
    id: row.id,
    listingId: row.listing_id,
    name: row.name,
    description: row.description ?? undefined,
    beds: Array.isArray(row.beds) ? row.beds : [],
    maxGuests: row.max_guests,
    sizeM2: row.size_m2 ?? undefined,
    priceCents: row.price_cents,
    priceUnit: row.price_unit || "night",
    quantity: row.quantity,
    image: row.image ?? undefined,
    gallery: Array.isArray(row.gallery) ? row.gallery : [],
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    sortOrder: row.sort_order ?? 0,
  };
}

/** A listing's room types, in the operator's order. Empty on any error (e.g. pre-migration). */
export async function fetchRoomTypes(listingId: string): Promise<RoomType[]> {
  const { data, error } = await supabase.from("room_types").select("*").eq("listing_id", listingId).order("sort_order").order("created_at");
  if (error) {
    console.error("[room_types] read failed", error.message);
    return [];
  }
  return (data as RoomTypeRow[]).map(mapRoomTypeRow);
}

/**
 * Persist the editor's rooms for a listing: update rows that kept their id,
 * insert new ones, delete the ones the operator removed. Order follows the
 * editor. Throws on failure so the form can report it.
 */
export async function persistRoomTypes(listingId: string, rooms: RoomTypeInput[]): Promise<void> {
  const { data: existing, error: readErr } = await supabase.from("room_types").select("id").eq("listing_id", listingId);
  if (readErr) throw new Error(readErr.message);

  const keep = new Set(rooms.map((r) => r.id).filter(Boolean) as string[]);
  const removed = (existing ?? []).map((r) => r.id as string).filter((id) => !keep.has(id));
  if (removed.length) {
    const { error } = await supabase.from("room_types").delete().in("id", removed);
    if (error) throw new Error(error.message);
  }

  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    const row = {
      listing_id: listingId,
      name: r.name.trim(),
      description: r.description?.trim() || null,
      beds: r.beds.filter((b: RoomBed) => b.type && b.count > 0),
      max_guests: Math.max(1, Math.round(r.maxGuests)),
      size_m2: r.sizeM2 && r.sizeM2 > 0 ? Math.round(r.sizeM2) : null,
      price_cents: Math.max(0, Math.round(r.priceCents)),
      price_unit: "night",
      quantity: Math.max(1, Math.round(r.quantity)),
      image: r.image?.trim() || r.gallery[0] || null,
      gallery: r.gallery,
      amenities: r.amenities,
      sort_order: i,
    };
    const { error } = r.id
      ? await supabase.from("room_types").update(row).eq("id", r.id)
      : await supabase.from("room_types").insert(row);
    if (error) throw new Error(error.message);
  }
}

/**
 * Room names for hotel bookings (0092), keyed by booking id — so the host's
 * booking views can say which room was booked. Kept out of those views' main
 * queries and failure-tolerant: an unknown column/relationship (before 0092
 * runs) yields an empty map instead of blanking the booking list.
 */
export async function fetchBookingRoomNames(bookingIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!bookingIds.length) return out;
  const { data, error } = await supabase.from("bookings").select("id, room_types(name)").in("id", bookingIds).not("room_type_id", "is", null);
  if (error) return out;
  for (const r of (data ?? []) as unknown as { id: string; room_types: { name?: string } | null }[]) {
    if (r.room_types?.name) out.set(r.id, r.room_types.name);
  }
  return out;
}

/** "Kond House Hotel · Deluxe king room" — a booking's title with its room, when it has one. */
export function withRoomName<T extends { id: string; listings?: { title?: string } | null }>(rows: T[], names: Map<string, string>): T[] {
  if (!names.size) return rows;
  return rows.map((r) => (names.has(r.id) && r.listings ? { ...r, listings: { ...r.listings, title: `${r.listings.title ?? ""} · ${names.get(r.id)}` } } : r));
}

/** Confirmed bookings of the given room types, as [start, end) ranges per room. */
export async function fetchRoomBookedRanges(roomTypeIds: string[]): Promise<Map<string, { start: string; end: string }[]>> {
  const out = new Map<string, { start: string; end: string }[]>();
  if (!roomTypeIds.length) return out;
  const { data, error } = await supabase.from("room_type_booked_ranges").select("room_type_id, start_date, end_date").in("room_type_id", roomTypeIds);
  if (error) {
    console.error("[room_types] availability read failed", error.message);
    return out;
  }
  for (const r of (data ?? []) as { room_type_id: string; start_date: string; end_date: string }[]) {
    const arr = out.get(r.room_type_id) ?? [];
    arr.push({ start: r.start_date, end: r.end_date });
    out.set(r.room_type_id, arr);
  }
  return out;
}
