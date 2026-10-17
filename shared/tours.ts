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

// ── Room details on each stop ───────────────────────────────────────────────
// Each tour stop lists facts the operator already entered — never invented:
// beds from the stay's sleeping arrangement, a hotel room type's beds / guests
// / size / amenities, and the stay's amenities that belong in that room.

export interface TourFacts {
  amenities: string[];
  /** Sleeping arrangement (listing.rooms): "Bedroom 1" → beds. */
  sleeping?: { name: string; beds: { type: string; count: number }[] }[];
  roomTypes?: { name: string; beds: { type: string; count: number }[]; maxGuests?: number; sizeM2?: number; amenities?: string[] }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Curated stay amenities (AmenityPicker's catalog) → the room they belong in. */
const AMENITY_ROOM: Record<string, TourRoomKind> = {};
const put = (kind: TourRoomKind, items: string[]) => items.forEach((i) => (AMENITY_ROOM[norm(i)] = kind));
put("kitchen", ["Blender", "Coffee Machine Espresso", "Coffee Machine Keurig", "Coffee Machine Nespresso", "Coffee Maker", "Dishwasher", "Electric kettle", "Hot Water Kettle", "Kitchen", "Kitchen Island", "Kitchenette", "Kitchenware", "Microwave", "Mini fridge", "Mixer", "Oven", "Refrigerator", "Spices", "Stove", "Toaster", "Wine Glasses", "Wine Opener"]);
put("dining", ["Dining Room", "Dining Table", "Dining area", "High Chair"]);
put("living", ["Sofa", "Sitting Area", "Living Room", "Fireplace", "Wood Stove", "Television", "Smart TV", "Cable TV", "Satellite TV", "Streaming Apple TV", "Streaming Chromecast", "Streaming HBO Max", "Streaming Hulu", "Streaming Netflix", "Books", "Books and reading material", "Games", "Video Games"]);
put("bedroom", ["Closet Racks", "Closet Walk-in", "Crib", "Crib by Request", "Extra Pillow and Blanket", "Linens", "Pack and Play", "Pack and Play by Request", "Room-darkening shades", "Wardrobe", "Mosquito net"]);
put("bathroom", ["Towels"]);
put("workspace", ["Workspace/Desk", "Laptop friendly space"]);
put("balcony", ["Balcony", "Balcony Shared", "Terrace", "Veranda", "Deck Patio", "Lanai Gazebo Covered", "Outdoor furniture", "Outdoor Dining area"]);
put("garden", ["Garden", "Courtyard", "Grill/BBQ", "Fire Pit", "Children's Playground", "Outdoor Kitchen"]);
put("amenities", ["Fitness Room", "Game Room", "Parking", "Parking Garage", "Parking Indoor", "Parking Paid", "EV Charger", "Business Center", "Front Desk", "Front Desk 24/7"]);
put("entrance", ["Private entrance", "Elevator", "Must climb stairs", "Single level home", "Wheelchair Accessible"]);

/** Operators' own amenities, matched by words. */
const AMENITY_WORDS: [RegExp, TourRoomKind][] = [
  [/hair ?dryer|shower|bath ?tub|\bbath\b|toilet|bidet|toiletr|shampoo|bathrobe/i, "bathroom"],
  [/washing machine|washer|dryer|laundry/i, "amenities"],
  [/pool|hot tub|jacuzzi/i, "pool"],
  [/sauna|gym|spa\b/i, "amenities"],
  [/coffee|kettle|fridge|freezer|cooker|cookware|dish|kitchen|oven|stove/i, "kitchen"],
  [/\btv\b|sofa|fireplace|netflix/i, "living"],
  [/balcony|terrace|veranda|patio/i, "balcony"],
  [/garden|yard|bbq|barbecue|grill|hammock/i, "garden"],
  [/desk|workspace/i, "workspace"],
];

export function amenityRoomKind(amenity: string): TourRoomKind | null {
  return AMENITY_ROOM[norm(amenity)] ?? AMENITY_WORDS.find(([re]) => re.test(amenity))?.[1] ?? null;
}

/**
 * Where a kind's amenities go when the tour has no stop of that kind — only
 * where they'd really be found (an open-plan dining table, a desk in the
 * living room). Anything else is left out rather than shown in the wrong room:
 * a balcony never appears on a living-room stop, a gym never on "Outside".
 */
const FALLBACK: Partial<Record<TourRoomKind, TourRoomKind[]>> = {
  dining: ["kitchen", "living"],
  workspace: ["living", "bedroom"],
  balcony: ["view"],
  garden: ["exterior"],
  pool: ["garden", "exterior"],
  entrance: ["exterior"],
  bathroom: ["hotel_room"],
};

/** Amenities that only name the room itself — redundant on that room's own stop. */
const SELF_NAMES: Partial<Record<TourRoomKind, string[]>> = {
  living: ["Living Room", "Sitting Area"],
  kitchen: ["Kitchen"],
  dining: ["Dining Room", "Dining area"],
};
const SPECIFIC_TV = /smart ?tv|cable tv|satellite tv/i;

const bedsText = (beds: { type: string; count: number }[]) =>
  beds
    .filter((b) => b.count > 0 && b.type)
    .map((b) => `${b.count} ${b.type}${b.count > 1 ? "s" : ""}`)
    .join(" · ");

const MAX_DETAILS = 10;

/** The facts shown on one stop of the tour (most specific first, deduplicated). */
export function tourRoomDetails(room: TourRoom, allRooms: TourRoom[], facts: TourFacts): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    const v = (s ?? "").trim();
    if (v && !out.some((x) => norm(x) === norm(v))) out.push(v);
  };

  if (room.kind === "hotel_room") {
    const t = (facts.roomTypes ?? []).find((rt) => norm(rt.name) === norm(room.name));
    if (t) {
      add(bedsText(t.beds));
      if (t.maxGuests) add(`Sleeps ${t.maxGuests}`);
      if (t.sizeM2) add(`${t.sizeM2} m²`);
      (t.amenities ?? []).forEach(add);
    }
    return out.slice(0, MAX_DETAILS);
  }

  // Beds: a stop named like a sleeping-arrangement room shows that room's beds;
  // a general "Bedroom" stop sums up every bedroom; living rooms show sofa beds.
  const sleeping = (facts.sleeping ?? []).filter((r) => bedsText(r.beds));
  const exact = sleeping.find((r) => norm(r.name) === norm(room.name));
  if (exact) add(bedsText(exact.beds));
  else if (room.kind === "bedroom") {
    const bedrooms = sleeping.filter((r) => !/living|lounge|sofa/i.test(r.name));
    if (bedrooms.length === 1) add(bedsText(bedrooms[0].beds));
    else bedrooms.slice(0, 3).forEach((r) => add(`${r.name}: ${bedsText(r.beds)}`));
  } else if (room.kind === "living") {
    sleeping.filter((r) => /living|lounge|sofa/i.test(r.name)).forEach((r) => add(bedsText(r.beds)));
  }

  // Amenities of this kind, plus kinds that have no stop of their own and fall back here.
  const present = new Set(allRooms.map((r) => r.kind));
  const firstOfKind = allRooms.find((r) => r.kind === room.kind)?.id === room.id;
  if (firstOfKind) {
    const kinds = new Set<TourRoomKind>([room.kind]);
    for (const [k, targets] of Object.entries(FALLBACK) as [TourRoomKind, TourRoomKind[]][]) {
      if (present.has(k)) continue;
      const target = targets.find((t) => present.has(t));
      if (target === room.kind) kinds.add(k);
    }
    const selfNames = new Set((SELF_NAMES[room.kind] ?? []).map(norm));
    const hasSpecificTv = facts.amenities.some((a) => SPECIFIC_TV.test(a));
    for (const a of facts.amenities) {
      const k = amenityRoomKind(a);
      if (!k || !kinds.has(k)) continue;
      if (k === room.kind && selfNames.has(norm(a))) continue;
      if (hasSpecificTv && norm(a) === "television") continue;
      add(a);
    }
  }
  return out.slice(0, MAX_DETAILS);
}
