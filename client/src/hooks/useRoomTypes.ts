import { useEffect, useState } from "react";
import type { RoomType } from "@shared/listings";
import type { RoomAvailability } from "@shared/rooms";
import { fetchRoomBookedRanges, fetchRoomTypes, fetchUnitBookedRanges } from "@/lib/roomTypes";

/** Confirmed bookings per individual room and per room type (identity-free views), for availability. */
export function useRoomAvailability(types: RoomType[]): RoomAvailability & { ready: boolean } {
  // Tagged with the rooms it was loaded for, so `ready` is false until THESE rooms' bookings are in.
  const [state, setState] = useState<RoomAvailability & { forKey: string }>({ byType: new Map(), byUnit: new Map(), forKey: "" });
  const typeKey = types.map((t) => t.id).join(",");
  const unitKey = types.flatMap((t) => t.units.map((u) => u.id)).join(",");
  const key = `${typeKey}|${unitKey}`;
  useEffect(() => {
    if (!typeKey) return;
    let alive = true;
    Promise.all([fetchRoomBookedRanges(typeKey.split(",")), fetchUnitBookedRanges(unitKey ? unitKey.split(",") : [])]).then(([byType, byUnit]) => {
      if (alive) setState({ byType, byUnit, forKey: key });
    });
    return () => {
      alive = false;
    };
  }, [typeKey, unitKey, key]);
  return { byType: state.byType, byUnit: state.byUnit, ready: !!typeKey && state.forKey === key };
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
