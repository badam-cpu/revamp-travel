/**
 * Virtual tours for stays (migration 0109). Pure helpers shared by the
 * operator's tour editor, the guest viewer and the server: the room kinds and
 * their tour order, grouping Aha's per-photo labels into rooms, folding newly
 * uploaded photos into an existing tour, and dropping photos the listing no
 * longer has.
 */

export type TourRoomKind =
  | "exterior"
  | "entrance"
  | "living"
  | "dining"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "workspace"
  | "balcony"
  | "view"
  | "garden"
  | "pool"
  | "amenities"
  | "hotel_room"
  | "other";

/** Tour order and the default room name for each kind. */
export const TOUR_ROOM_KINDS: { kind: TourRoomKind; label: string }[] = [
  { kind: "exterior", label: "Outside" },
  { kind: "entrance", label: "Entrance" },
  { kind: "living", label: "Living room" },
  { kind: "dining", label: "Dining area" },
  { kind: "kitchen", label: "Kitchen" },
  { kind: "bedroom", label: "Bedroom" },
  // Hotels: one room per room type, where the bedrooms would be.
  { kind: "hotel_room", label: "Room" },
  { kind: "bathroom", label: "Bathroom" },
  { kind: "workspace", label: "Workspace" },
  { kind: "balcony", label: "Balcony & terrace" },
  { kind: "view", label: "The view" },
  { kind: "garden", label: "Garden & yard" },
  { kind: "pool", label: "Pool" },
  { kind: "amenities", label: "Amenities" },
  { kind: "other", label: "More photos" },
];
/** Kinds Aha may assign (hotel rooms come from room types, not from AI). */
export const AI_ROOM_KINDS = TOUR_ROOM_KINDS.map((k) => k.kind).filter((k) => k !== "hotel_room") as TourRoomKind[];

export const TOUR_LIMITS = { rooms: 24, name: 40, caption: 80, photosPerRoom: 40 } as const;
/** A tour needs at least this much to be worth a button on the listing page. */
export const MIN_TOUR_ROOMS = 2;

export interface TourPhoto {
  url: string;
  caption: string;
}
export interface TourRoom {
  id: string;
  name: string;
  kind: TourRoomKind;
  photos: TourPhoto[];
  pano: { url: string } | null;
}
export interface ListingTour {
  listingId: string;
  status: "draft" | "live";
  rooms: TourRoom[];
  seenPhotos: string[];
  builtAt: string | null;
  publishedAt: string | null;
}
/** Aha's answer for one photo. */
export interface ClassifiedPhoto {
  url: string;
  kind: TourRoomKind;
  caption: string;
}

export function kindLabel(kind: TourRoomKind): string {
  return TOUR_ROOM_KINDS.find((k) => k.kind === kind)?.label ?? "More photos";
}
export function isRoomKind(v: unknown): v is TourRoomKind {
  return typeof v === "string" && TOUR_ROOM_KINDS.some((k) => k.kind === v);
}
const order = (kind: TourRoomKind) => {
  const i = TOUR_ROOM_KINDS.findIndex((k) => k.kind === kind);
  return i < 0 ? TOUR_ROOM_KINDS.length : i;
};

let seq = 0;
export function newRoomId(): string {
  seq += 1;
  return `r${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const clip = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Groups classified photos into rooms in tour order (one room per kind; the
 * operator can split e.g. two bedrooms in the editor). Hotel room types are
 * added as their own rooms after the bedrooms.
 */
export function buildTourRooms(classified: ClassifiedPhoto[], hotelRooms: { name: string; photos: string[] }[] = []): TourRoom[] {
  const byKind = new Map<TourRoomKind, TourPhoto[]>();
  for (const c of classified) {
    const kind = isRoomKind(c.kind) && c.kind !== "hotel_room" ? c.kind : "other";
    const list = byKind.get(kind) ?? [];
    list.push({ url: c.url, caption: clip(c.caption ?? "", TOUR_LIMITS.caption) });
    byKind.set(kind, list);
  }
  const rooms: TourRoom[] = Array.from(byKind.entries()).map(([kind, photos]) => ({ id: newRoomId(), name: kindLabel(kind), kind, photos, pano: null }));
  const hotel = hotelRooms
    .filter((r) => r.photos.length)
    .map<TourRoom>((r) => ({ id: newRoomId(), name: clip(r.name, TOUR_LIMITS.name) || "Room", kind: "hotel_room", photos: r.photos.map((url) => ({ url, caption: "" })), pano: null }));
  // Stable sort: hotel room types keep their own order, after the bedrooms.
  return [...rooms, ...hotel].sort((a, b) => order(a.kind) - order(b.kind));
}

/** Photos of the listing the tour hasn't seen yet (uploaded after it was built). */
export function newPhotosFor(tour: Pick<ListingTour, "seenPhotos" | "rooms">, listingPhotos: string[]): string[] {
  const seen = new Set([...tour.seenPhotos, ...tour.rooms.flatMap((r) => r.photos.map((p) => p.url))]);
  return listingPhotos.filter((u) => !seen.has(u));
}

/** Adds newly classified photos to the first room of their kind, or a new room in tour order. */
export function addPhotosToRooms(rooms: TourRoom[], classified: ClassifiedPhoto[]): TourRoom[] {
  const next = rooms.map((r) => ({ ...r, photos: [...r.photos] }));
  for (const c of classified) {
    const kind = isRoomKind(c.kind) && c.kind !== "hotel_room" ? c.kind : "other";
    const photo = { url: c.url, caption: clip(c.caption ?? "", TOUR_LIMITS.caption) };
    const room = next.find((r) => r.kind === kind);
    if (room) room.photos.push(photo);
    else {
      const at = next.findIndex((r) => order(r.kind) > order(kind));
      const created: TourRoom = { id: newRoomId(), name: kindLabel(kind), kind, photos: [photo], pano: null };
      if (at < 0) next.push(created);
      else next.splice(at, 0, created);
    }
  }
  return next;
}

/**
 * What guests (and the editor preview) actually see: photos the listing no
 * longer has are dropped, and rooms left with nothing to show disappear.
 */
export function visibleRooms(rooms: TourRoom[], listingPhotos: string[]): TourRoom[] {
  const have = new Set(listingPhotos);
  return rooms
    .map((r) => ({ ...r, photos: r.photos.filter((p) => have.has(p.url)) }))
    .filter((r) => r.photos.length > 0 || !!r.pano);
}

export function tourWorthShowing(rooms: TourRoom[]): boolean {
  return rooms.length >= MIN_TOUR_ROOMS || rooms.some((r) => !!r.pano);
}

/** All photos a stay can use in its tour: cover + gallery, then (hotels) each room type's photos. */
export function listingTourPhotos(listing: { image?: string | null; gallery?: string[] | null }, roomTypes: { image?: string | null; gallery?: string[] | null }[] = []): string[] {
  const urls = [listing.image, ...(listing.gallery ?? []), ...roomTypes.flatMap((t) => [t.image, ...(t.gallery ?? [])])];
  return Array.from(new Set(urls.filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u))));
}

/** A smaller copy of a Revamp-uploaded photo (…_w2560.webp → …_w640.webp) for Aha to look at. */
export function smallPhotoUrl(url: string): string {
  return url.replace(/_w(1280|2560)\.(webp|jpg|jpeg|png)$/i, "_w640.$2");
}
