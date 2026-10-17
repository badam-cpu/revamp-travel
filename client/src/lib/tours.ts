/**
 * Virtual tours for stays (migration 0109) — browser side. Reads the tour
 * (RLS: guests see a live tour of a published stay; the operator sees their
 * own), builds it a few photos at a time through /api/listing-tour/classify
 * (Aha sorts photos into rooms — shared/tours.ts groups them), folds photos
 * uploaded later into an existing tour, saves through /api/listing-tour/save,
 * and uploads 360° photos.
 */
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { classifyListingTourPhotos, saveListingTour } from "@/lib/api";
import {
  addPhotosToRooms,
  buildTourRooms,
  listingTourPhotos,
  newPhotosFor,
  type ClassifiedPhoto,
  type ListingTour,
  type TourRoom,
} from "@shared/tours";

interface TourRow {
  listing_id: string;
  status: "draft" | "live";
  rooms: TourRoom[] | null;
  seen_photos: string[] | null;
  built_at: string | null;
  published_at: string | null;
}

function mapTour(r: TourRow): ListingTour {
  return {
    listingId: r.listing_id,
    status: r.status,
    rooms: Array.isArray(r.rooms) ? r.rooms : [],
    seenPhotos: r.seen_photos ?? [],
    builtAt: r.built_at,
    publishedAt: r.published_at,
  };
}

/** The listing's tour, or null (none yet, not visible to this viewer, or migration 0109 not run). */
export async function fetchTour(listingId: string): Promise<ListingTour | null> {
  const { data, error } = await supabase.from("listing_tours").select("listing_id, status, rooms, seen_photos, built_at, published_at").eq("listing_id", listingId).maybeSingle();
  if (error || !data) return null;
  return mapTour(data as TourRow);
}

/** The operator's tours by listing id (for the listings list). */
export async function fetchToursFor(listingIds: string[]): Promise<Map<string, ListingTour>> {
  const out = new Map<string, ListingTour>();
  if (!listingIds.length) return out;
  const { data, error } = await supabase.from("listing_tours").select("listing_id, status, rooms, seen_photos, built_at, published_at").in("listing_id", listingIds);
  if (error) return out;
  for (const r of (data ?? []) as TourRow[]) out.set(r.listing_id, mapTour(r));
  return out;
}

export interface TourSource {
  /** Every photo the tour may use (listing + hotel room types). */
  photos: string[];
  /** Photos Aha sorts — the listing's own (hotel room-type photos become rooms as they are). */
  listingPhotos: string[];
  roomTypes: { name: string; photos: string[] }[];
}

/** The stay's current photos, read fresh from the database. */
export async function fetchTourSource(listingId: string): Promise<TourSource | null> {
  const { data, error } = await supabase.from("listings").select("image, gallery, multi_room").eq("id", listingId).maybeSingle();
  if (error || !data) return null;
  const l = data as { image: string | null; gallery: string[] | null; multi_room?: boolean | null };
  let roomTypes: { name: string; image: string | null; gallery: string[] | null }[] = [];
  if (l.multi_room) {
    const { data: rts } = await supabase.from("room_types").select("name, image, gallery, sort_order").eq("listing_id", listingId).order("sort_order", { ascending: true });
    roomTypes = (rts ?? []) as typeof roomTypes;
  }
  return {
    photos: listingTourPhotos(l, roomTypes),
    listingPhotos: listingTourPhotos(l),
    roomTypes: roomTypes.map((t) => ({ name: t.name, photos: listingTourPhotos({ image: t.image, gallery: t.gallery }) })),
  };
}

const CHUNK = 6;
const PARALLEL = 3;

/** Asks Aha about the photos, CHUNK at a time, PARALLEL requests at once. */
export async function classifyPhotos(listingId: string, urls: string[], onProgress?: (done: number, total: number) => void): Promise<ClassifiedPhoto[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += CHUNK) chunks.push(urls.slice(i, i + CHUNK));
  const results: ClassifiedPhoto[][] = new Array(chunks.length);
  let done = 0;
  let next = 0;
  let firstError: unknown = null;
  let failures = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      try {
        results[i] = (await classifyListingTourPhotos(listingId, chunks[i])).photos;
      } catch (e) {
        firstError ??= e;
        failures += 1;
        results[i] = chunks[i].map((url) => ({ url, kind: "other", caption: "" }));
      }
      done += chunks[i].length;
      onProgress?.(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
  // Every chunk failed (e.g. AI not configured) → let the caller say so.
  if (firstError && failures === chunks.length) throw firstError;
  return results.flat();
}

/** Builds a fresh tour from the stay's photos and saves it as a draft. */
export async function buildTour(listingId: string, onProgress?: (done: number, total: number) => void): Promise<{ rooms: TourRoom[]; seen: string[] }> {
  const src = await fetchTourSource(listingId);
  if (!src || !src.photos.length) throw new Error("Add photos to this stay first.");
  const classified = await classifyPhotos(listingId, src.listingPhotos, onProgress);
  const rooms = buildTourRooms(classified, src.roomTypes);
  await saveListingTour(listingId, { rooms, status: "draft", seenPhotos: src.photos, rebuilt: true });
  return { rooms, seen: src.photos };
}

/** Sorts photos uploaded since the tour was built into its rooms. */
export async function addNewPhotos(listingId: string, tour: ListingTour, onProgress?: (done: number, total: number) => void): Promise<{ rooms: TourRoom[]; seen: string[]; added: number }> {
  const src = await fetchTourSource(listingId);
  if (!src) return { rooms: tour.rooms, seen: tour.seenPhotos, added: 0 };
  const fresh = newPhotosFor(tour, src.photos);
  if (!fresh.length) return { rooms: tour.rooms, seen: tour.seenPhotos, added: 0 };
  const roomTypePhotos = new Set(src.roomTypes.flatMap((t) => t.photos));
  const classified = await classifyPhotos(
    listingId,
    fresh.filter((u) => !roomTypePhotos.has(u)),
    onProgress,
  );
  // A new hotel room-type photo joins the room named after its type.
  let rooms = addPhotosToRooms(tour.rooms, classified);
  for (const u of fresh.filter((x) => roomTypePhotos.has(x))) {
    const type = src.roomTypes.find((t) => t.photos.includes(u));
    const room = rooms.find((r) => r.kind === "hotel_room" && r.name === type?.name);
    if (room) room.photos.push({ url: u, caption: "" });
    else rooms = addPhotosToRooms(rooms, [{ url: u, kind: "other", caption: "" }]);
  }
  return { rooms, seen: Array.from(new Set([...tour.seenPhotos, ...src.photos])), added: fresh.length };
}

/** Event the Dashboard listens to, to open a listing's tour editor. */
export const OPEN_TOUR_EVENT = "revamp:open-tour";
export function openTourEditor(listingId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_TOUR_EVENT, { detail: { listingId } }));
}

/** Fired after the background build/update saved a tour (the listings list refreshes its chips). */
export const TOUR_CHANGED_EVENT = "revamp:tour-changed";
const announceChange = (listingId: string) => window.dispatchEvent(new CustomEvent(TOUR_CHANGED_EVENT, { detail: { listingId } }));

const running = new Set<string>();

/**
 * Called after an operator saves a stay: builds the tour the first time the
 * stay has enough photos, or adds newly uploaded photos to the existing one.
 * Runs in the background (the form has closed) and reports with a toast.
 */
export async function autoTourAfterSave(listingId: string): Promise<void> {
  if (running.has(listingId)) return;
  running.add(listingId);
  try {
    const tour = await fetchTour(listingId);
    if (!tour) {
      const src = await fetchTourSource(listingId);
      if (!src || src.photos.length < 3) return;
      const id = toast.loading("Building your virtual tour…");
      try {
        await buildTour(listingId, (d, t) => toast.loading(`Building your virtual tour… ${d}/${t} photos`, { id }));
        announceChange(listingId);
        toast.success("Your virtual tour is ready to check.", { id, action: { label: "Check tour", onClick: () => openTourEditor(listingId) }, duration: 12_000 });
      } catch (e) {
        console.error("[tour] auto build", e);
        toast.dismiss(id);
      }
      return;
    }
    const { rooms, seen, added } = await addNewPhotos(listingId, tour);
    if (!added) return;
    await saveListingTour(listingId, { rooms, status: tour.status, seenPhotos: seen, rebuilt: false });
    announceChange(listingId);
    toast(`${added} new photo${added === 1 ? "" : "s"} added to your virtual tour.`, { action: { label: "Check tour", onClick: () => openTourEditor(listingId) } });
  } catch (e) {
    console.error("[tour] after save", e);
  } finally {
    running.delete(listingId);
  }
}

// ── 360° photos ─────────────────────────────────────────────────────────────

const BUCKET = "listing-photos";
// 5600×2800 stays under iOS Safari's ~16.7 MP canvas limit and is sharp enough
// for a full-screen look-around; the bucket caps files at 6 MB (0042).
const PANO_MAX_W = 5600;
const PANO_MIN_W = 3000;
const PANO_MAX_BYTES = 5_500_000;

export class PanoramaError extends Error {}

/**
 * Uploads an equirectangular 360° photo (2:1, from a 360° camera) as a JPEG in
 * the operator's own folder. Ordinary phone panoramas (very wide, not 2:1)
 * are refused with a plain explanation.
 */
export async function uploadPanorama(file: File, userId: string): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new PanoramaError("Use a JPG or PNG 360° photo.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PanoramaError("This photo couldn't be opened. Export it from your 360° camera app as a JPG and try again.");
  }
  const ratio = bitmap.width / bitmap.height;
  if (ratio < 1.9 || ratio > 2.1) {
    bitmap.close();
    throw new PanoramaError("This isn't a 360° photo. 360° photos are exactly twice as wide as they are tall (e.g. 5760 × 2880) and come from a 360° camera such as Insta360 or Ricoh Theta. A phone's panorama mode won't work.");
  }
  if (bitmap.width < PANO_MIN_W) {
    bitmap.close();
    throw new PanoramaError(`This 360° photo is too small (${bitmap.width} px wide). Use at least ${PANO_MIN_W} px wide so it stays sharp when guests look around.`);
  }
  const w = Math.min(PANO_MAX_W, bitmap.width);
  const h = Math.round(w / 2);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PanoramaError("Your browser couldn't prepare this photo. Try another browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob: Blob | null = null;
  for (const q of [0.86, 0.8, 0.72, 0.64]) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    if (blob && blob.size <= PANO_MAX_BYTES) break;
  }
  if (!blob || blob.size > PANO_MAX_BYTES) throw new PanoramaError("This 360° photo is too large to upload. Export a smaller version (under 6 MB) and try again.");
  const path = `${userId}/pano_${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) {
    console.error("[tour] pano upload", error.message);
    throw new PanoramaError("Couldn't upload the 360° photo. Please try again.");
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
