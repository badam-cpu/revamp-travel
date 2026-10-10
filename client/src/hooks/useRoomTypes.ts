import { useEffect, useState } from "react";
import type { RoomType } from "@shared/listings";
import { fetchRoomBookedRanges, fetchRoomTypes } from "@/lib/roomTypes";

/** Confirmed booking ranges per room type (identity-free view), for availability. */
export function useRoomAvailability(rooms: RoomType[]): Map<string, { start: string; end: string }[]> {
  const [byRoom, setByRoom] = useState(new Map<string, { start: string; end: string }[]>());
  const key = rooms.map((r) => r.id).join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetchRoomBookedRanges(key.split(",")).then((m) => alive && setByRoom(m));
    return () => {
      alive = false;
    };
  }, [key]);
  return byRoom;
}

/**
 * The room types of a multi-room property, loaded on demand for the detail and
 * booking surfaces (the bulk catalog only carries the `multiRoom` flag and the
 * cheapest price). Pass `enabled=false` for ordinary stays to skip the query.
 */
export function useRoomTypes(listingId: string | undefined, enabled = true): { rooms: RoomType[]; loading: boolean } {
  // Rooms are tagged with the listing they were fetched for, so `loading` is
  // true from the very first render until THIS listing's rooms are in.
  const [state, setState] = useState<{ forId: string | null; rooms: RoomType[] }>({ forId: null, rooms: [] });

  useEffect(() => {
    if (!listingId || !enabled) return;
    let alive = true;
    fetchRoomTypes(listingId).then((rooms) => alive && setState({ forId: listingId, rooms }));
    return () => {
      alive = false;
    };
  }, [listingId, enabled]);

  const active = !!listingId && enabled;
  return {
    rooms: active && state.forId === listingId ? state.rooms : [],
    loading: active && state.forId !== listingId,
  };
}
