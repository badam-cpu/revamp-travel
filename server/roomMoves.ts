/**
 * Hotels (0092): an operator moves a confirmed booking to another room — the
 * same room type or any other type of the same hotel (a free upgrade). The
 * guest keeps the price they paid; nothing is recharged or refunded.
 *
 * A room is offered only if it's free for every night of the booking: no other
 * confirmed booking, no fresh checkout hold (so a guest paying right now isn't
 * bumped), no manual block, and it sleeps the booking's guests. The database
 * still has the final say — `bookings_room_unit_no_overlap` refuses a move that
 * races another confirm (23P01), reported as "just booked".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MoveBooking {
  id: string;
  listing_id: string;
  status: string;
  start_date: string;
  end_date: string;
  guests: number;
  room_type_id: string | null;
  room_unit_id: string | null;
}

export interface RoomMoveOption {
  unitId: string;
  unitName: string;
  typeId: string;
  typeName: string;
  maxGuests: number;
  current: boolean;
  available: boolean;
  /** Why it can't be picked ("Booked", "Blocked", …). */
  reason?: string;
}

/** Same window the checkout uses before a pending hold counts as abandoned. */
const HOLD_MS = 15 * 60_000;
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && aEnd > bStart;

/** Null when this booking can be moved, else the reason it can't. A hotel booking
 *  with no room yet (e.g. recorded before rooms existed) can be given one. */
export function moveBlockedReason(b: MoveBooking, todayIso: string, isHotel = false): string | null {
  if (!b.room_type_id && !isHotel) return "Only hotel room bookings can be moved to another room.";
  if (b.status !== "confirmed") return "Only confirmed bookings can be moved.";
  if (b.end_date <= todayIso) return "This stay has already ended.";
  return null;
}

type RawRange = { start?: string; end?: string };
type UnitRow = { id: string; name: string; active: boolean; sort_order: number | null; manual_blocked_ranges: RawRange[] | null; blocked_ranges?: RawRange[] | null };
type TypeRow = { id: string; name: string; max_guests: number | null; sort_order: number | null; room_units: UnitRow[] | null };

/** Every active room of the booking's hotel, with whether it can take this booking. */
export async function roomMoveOptions(admin: SupabaseClient, b: MoveBooking, now = Date.now()): Promise<RoomMoveOption[]> {
  const { data: types, error } = await admin
    .from("room_types")
    .select("id, name, max_guests, sort_order, room_units(*)") // * so 0096 blocked_ranges is read when present
    .eq("listing_id", b.listing_id)
    .order("sort_order");
  if (error) throw new Error(`room types read failed: ${error.message}`);

  const units = ((types ?? []) as unknown as TypeRow[]).flatMap((t) =>
    (t.room_units ?? [])
      .filter((u) => u.active)
      .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
      .map((u) => ({ t, u })),
  );
  if (!units.length) return [];

  const { data: others, error: bErr } = await admin
    .from("bookings")
    .select("id, room_unit_id, status, created_at, start_date, end_date")
    .in("room_unit_id", units.map(({ u }) => u.id))
    .in("status", ["confirmed", "pending_payment", "awaiting_payment"])
    .lt("start_date", b.end_date)
    .gt("end_date", b.start_date)
    .neq("id", b.id);
  if (bErr) throw new Error(`room bookings read failed: ${bErr.message}`);

  const booked = new Set<string>();
  const held = new Set<string>();
  for (const o of (others ?? []) as { room_unit_id: string; status: string; created_at: string }[]) {
    if (o.status === "confirmed") booked.add(o.room_unit_id);
    else if (o.status === "awaiting_payment" || now - Date.parse(o.created_at) < HOLD_MS) held.add(o.room_unit_id);
  }

  return units.map(({ t, u }) => {
    const maxGuests = t.max_guests ?? 2;
    const current = u.id === b.room_unit_id;
    const hits = (list: RawRange[] | null | undefined) => (list ?? []).some((r) => r.start && r.end && overlaps(r.start, r.end, b.start_date, b.end_date));
    const blocked = hits(u.manual_blocked_ranges);
    const busyElsewhere = hits(u.blocked_ranges);
    const reason = current
      ? "Current room"
      : booked.has(u.id)
        ? "Booked"
        : held.has(u.id)
          ? "Being booked"
          : blocked
            ? "Blocked"
            : busyElsewhere
              ? "Busy on Airbnb/Booking"
              : b.guests > maxGuests
                ? `Sleeps ${maxGuests}`
                : undefined;
    return { unitId: u.id, unitName: u.name, typeId: t.id, typeName: t.name, maxGuests, current, available: !reason, ...(reason ? { reason } : {}) };
  });
}

/** Operator-facing reason a room can't take these nights. */
export function unavailableMessage(o: RoomMoveOption): string {
  const why: Record<string, string> = {
    Booked: "That room is booked for some of these nights.",
    "Being booked": "Someone is booking that room right now — pick another.",
    Blocked: "That room is blocked for some of these nights.",
    "Busy on Airbnb/Booking": "That room is booked on Airbnb or Booking.com for some of these nights.",
  };
  return why[o.reason ?? ""] ?? `That room sleeps up to ${o.maxGuests} guests.`;
}

/** For a NEW booking (operator direct booking): the room's option, or null if it isn't in this hotel. */
export async function roomOptionForNewBooking(
  admin: SupabaseClient,
  q: { listingId: string; unitId: string; startDate: string; endDate: string; guests: number },
  now = Date.now(),
): Promise<RoomMoveOption | null> {
  const pseudo: MoveBooking = {
    id: "00000000-0000-0000-0000-000000000000",
    listing_id: q.listingId,
    status: "confirmed",
    start_date: q.startDate,
    end_date: q.endDate,
    guests: q.guests,
    room_type_id: null,
    room_unit_id: null,
  };
  return (await roomMoveOptions(admin, pseudo, now)).find((o) => o.unitId === q.unitId) ?? null;
}

export type MoveResult = { ok: true; from: RoomMoveOption | null; to: RoomMoveOption } | { ok: false; status: number; error: string };

/** Move `b` to room `unitId` (re-checked here — never trust the picker's list). */
export async function moveBookingToRoom(admin: SupabaseClient, b: MoveBooking, unitId: string, now = Date.now()): Promise<MoveResult> {
  const options = await roomMoveOptions(admin, b, now);
  const to = options.find((o) => o.unitId === unitId);
  if (!to) return { ok: false, status: 404, error: "That room isn't part of this property." };
  if (to.current) return { ok: false, status: 400, error: "The guest is already in that room." };
  if (!to.available) return { ok: false, status: 409, error: unavailableMessage(to) };

  let q = admin
    .from("bookings")
    .update({ room_unit_id: to.unitId, room_type_id: to.typeId })
    .eq("id", b.id)
    .eq("status", "confirmed");
  // Only if nobody moved it meanwhile.
  q = b.room_unit_id ? q.eq("room_unit_id", b.room_unit_id) : q.is("room_unit_id", null);
  const { data, error } = await q.select("id");
  if (error) {
    if (error.code === "23P01") return { ok: false, status: 409, error: "That room was just booked for these nights — pick another." };
    throw new Error(`room move failed: ${error.message}`);
  }
  if (!data?.length) return { ok: false, status: 409, error: "This booking just changed — reopen it and try again." };
  return { ok: true, from: options.find((o) => o.current) ?? null, to };
}
