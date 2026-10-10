/**
 * Room types and their individual rooms at a multi-room property (hotel) —
 * migration 0092. Reads go straight to Supabase under RLS (public for
 * published listings, the owner for their own drafts); writes are the
 * operator's own rows (RLS-scoped to their stay listings). The booking amount
 * is always recomputed server-side from the stored prices, so nothing here is
 * a trust decision.
 */
import { supabase } from "@/lib/supabase";
import type { RoomBed, RoomType, RoomTypeInput, RoomUnit, SeasonalRate } from "@shared/listings";
import { roomUnitLabel } from "@shared/rooms";

// The pure availability/price helpers live in shared/rooms.ts; re-exported for
// the components that already import them from here.
export {
  cheapestAvailableUnit,
  quoteRoom,
  quoteUnit,
  roomAvailable,
  soldOutNights,
  typeCapacity,
  typeFromCents,
  typeSoldOutNights,
  unitBaseCents,
  unitFree,
  type RoomQuote,
} from "@shared/rooms";

type Range = { start: string; end: string };

interface RoomUnitRow {
  id: string;
  room_type_id: string;
  name: string;
  price_cents: number | null;
  seasonal_rates: SeasonalRate[] | null;
  manual_blocked_ranges: Range[] | null;
  active: boolean | null;
  sort_order: number | null;
}

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
  room_units?: RoomUnitRow[] | null;
}

export function mapRoomUnitRow(row: RoomUnitRow): RoomUnit {
  return {
    id: row.id,
    roomTypeId: row.room_type_id,
    name: row.name,
    priceCents: row.price_cents ?? undefined,
    seasonalRates: Array.isArray(row.seasonal_rates) ? row.seasonal_rates : [],
    manualBlockedRanges: Array.isArray(row.manual_blocked_ranges) ? row.manual_blocked_ranges : [],
    active: row.active !== false,
    sortOrder: row.sort_order ?? 0,
  };
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
    units: (row.room_units ?? []).map(mapRoomUnitRow).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/** A listing's room types with their rooms, in the operator's order. Empty on any error. */
export async function fetchRoomTypes(listingId: string): Promise<RoomType[]> {
  const { data, error } = await supabase.from("room_types").select("*, room_units(*)").eq("listing_id", listingId).order("sort_order").order("created_at");
  if (error) {
    console.error("[room_types] read failed", error.message);
    return [];
  }
  return (data as RoomTypeRow[]).map(mapRoomTypeRow);
}

/**
 * Persist the editor's room types and their rooms for a listing: update rows
 * that kept their id, insert new ones, delete the ones the operator removed.
 * Order follows the editor. A room's own per-date prices and blocked dates are
 * edited in the pricing calendar and left untouched here. Throws on failure so
 * the form can report it.
 */
export async function persistRoomTypes(listingId: string, types: RoomTypeInput[]): Promise<void> {
  const { data: existing, error: readErr } = await supabase.from("room_types").select("id").eq("listing_id", listingId);
  if (readErr) throw new Error(readErr.message);

  const keep = new Set(types.map((t) => t.id).filter(Boolean) as string[]);
  const removed = (existing ?? []).map((r) => r.id as string).filter((id) => !keep.has(id));
  if (removed.length) {
    const { error } = await supabase.from("room_types").delete().in("id", removed);
    if (error) throw new Error(error.message);
  }

  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const row = {
      listing_id: listingId,
      name: t.name.trim(),
      description: t.description?.trim() || null,
      beds: t.beds.filter((b: RoomBed) => b.type && b.count > 0),
      max_guests: Math.max(1, Math.round(t.maxGuests)),
      size_m2: t.sizeM2 && t.sizeM2 > 0 ? Math.round(t.sizeM2) : null,
      price_cents: Math.max(0, Math.round(t.priceCents)),
      price_unit: "night",
      // Kept in step with the room list for anything still reading the count.
      quantity: Math.max(1, t.units.length),
      image: t.image?.trim() || t.gallery[0] || null,
      gallery: t.gallery,
      amenities: t.amenities,
      sort_order: i,
    };
    let typeId = t.id;
    if (typeId) {
      const { error } = await supabase.from("room_types").update(row).eq("id", typeId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase.from("room_types").insert(row).select("id").single();
      if (error || !data) throw new Error(error?.message || "Couldn't save the room type.");
      typeId = data.id as string;
    }
    await persistUnits(typeId, t.units);
  }
}

async function persistUnits(roomTypeId: string, units: RoomTypeInput["units"]): Promise<void> {
  const { data: existing, error: readErr } = await supabase.from("room_units").select("id").eq("room_type_id", roomTypeId);
  if (readErr) throw new Error(readErr.message);
  const keep = new Set(units.map((u) => u.id).filter(Boolean) as string[]);
  const removed = (existing ?? []).map((r) => r.id as string).filter((id) => !keep.has(id));
  if (removed.length) {
    const { error } = await supabase.from("room_units").delete().in("id", removed);
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const row = {
      room_type_id: roomTypeId,
      name: u.name.trim(),
      price_cents: u.priceCents != null && u.priceCents > 0 ? Math.round(u.priceCents) : null,
      active: true,
      sort_order: i,
    };
    const { error } = u.id ? await supabase.from("room_units").update(row).eq("id", u.id) : await supabase.from("room_units").insert(row);
    if (error) throw new Error(error.message);
  }
}

/** Save one room's calendar edits (per-date prices and/or blocked dates). */
export async function updateRoomUnitCalendar(unitId: string, patch: { seasonalRates?: SeasonalRate[]; manualBlockedRanges?: Range[] }): Promise<RoomUnit> {
  const row: Record<string, unknown> = {};
  if (patch.seasonalRates) row.seasonal_rates = patch.seasonalRates;
  if (patch.manualBlockedRanges) row.manual_blocked_ranges = patch.manualBlockedRanges;
  const { data, error } = await supabase.from("room_units").update(row).eq("id", unitId).select("*").single();
  if (error || !data) throw new Error(error?.message || "Couldn't save the calendar.");
  return mapRoomUnitRow(data as RoomUnitRow);
}

/**
 * Room labels for hotel bookings (0092), keyed by booking id — "Deluxe king
 * room · Room 101" — so the host's booking views say which room was booked.
 * Kept out of those views' main queries and failure-tolerant: an error yields
 * an empty map instead of blanking the booking list.
 */
export async function fetchBookingRoomNames(bookingIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!bookingIds.length) return out;
  const { data, error } = await supabase.from("bookings").select("id, room_types(name), room_units(name)").in("id", bookingIds).not("room_type_id", "is", null);
  if (error) return out;
  for (const r of (data ?? []) as unknown as { id: string; room_types: { name?: string } | null; room_units: { name?: string } | null }[]) {
    const label = [r.room_types?.name, r.room_units?.name ? roomUnitLabel(r.room_units.name) : ""].filter(Boolean).join(" · ");
    if (label) out.set(r.id, label);
  }
  return out;
}

/** "Kond House Hotel · Deluxe king room · Room 101" — a booking's title with its room, when it has one. */
export function withRoomName<T extends { id: string; listings?: { title?: string } | null }>(rows: T[], names: Map<string, string>): T[] {
  if (!names.size) return rows;
  return rows.map((r) => (names.has(r.id) && r.listings ? { ...r, listings: { ...r.listings, title: `${r.listings.title ?? ""} · ${names.get(r.id)}` } } : r));
}

async function rangesBy(view: string, key: string, ids: string[]): Promise<Map<string, Range[]>> {
  const out = new Map<string, Range[]>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from(view).select(`${key}, start_date, end_date`).in(key, ids);
  if (error) {
    console.error(`[room_types] ${view} read failed`, error.message);
    return out;
  }
  for (const r of (data ?? []) as unknown as Record<string, string>[]) {
    const arr = out.get(r[key]) ?? [];
    arr.push({ start: r.start_date, end: r.end_date });
    out.set(r[key], arr);
  }
  return out;
}

/** Confirmed bookings per room type, as [start, end) ranges (types with no rooms yet). */
export function fetchRoomBookedRanges(roomTypeIds: string[]): Promise<Map<string, Range[]>> {
  return rangesBy("room_type_booked_ranges", "room_type_id", roomTypeIds);
}

/** Confirmed bookings per individual room, as [start, end) ranges. */
export function fetchUnitBookedRanges(unitIds: string[]): Promise<Map<string, Range[]>> {
  return rangesBy("room_unit_booked_ranges", "room_unit_id", unitIds);
}
