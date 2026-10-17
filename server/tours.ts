/**
 * Virtual tours for stays (migration 0109) — server side.
 *
 * classifyTourPhotos: Aha (Claude vision) looks at a few of the listing's own
 * photos (small 640px copies, fetched only from our Supabase storage host) and
 * says which room each shows, with a short plain caption. The client calls it
 * a handful of photos at a time, so each request stays well inside the
 * serverless time limit.
 *
 * saveTour: validates the operator's tour before storing it with the service
 * role — every photo must be one of the listing's own photos, every 360° photo
 * must sit in the operator's own storage folder, names/captions are clipped.
 *
 * Captions describe only what is plainly visible: no marketing claims, no
 * guesses about size, quality or location (no-fabrication rule).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AI_ROOM_KINDS,
  isRoomKind,
  kindLabel,
  listingTourPhotos,
  smallPhotoUrl,
  TOUR_LIMITS,
  type ClassifiedPhoto,
  type TourRoom,
} from "../shared/tours.js";

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    client = apiKey ? new Anthropic({ apiKey }) : null;
  }
  return client;
}
export function tourAiConfigured(): boolean {
  return !!getClient();
}

const STORAGE_ORIGIN = () => {
  const u = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};
const PUBLIC_BUCKET_PATH = "/storage/v1/object/public/listing-photos/";

export interface TourContext {
  listingId: string;
  operatorId: string;
  type: string;
  multiRoom: boolean;
  photos: string[];
  roomTypes: { name: string; photos: string[] }[];
}

export async function loadTourContext(admin: SupabaseClient, listingId: string): Promise<TourContext | null> {
  const { data } = await admin.from("listings").select("id, operator_id, type, multi_room, image, gallery").eq("id", listingId).maybeSingle();
  if (!data) return null;
  const l = data as { id: string; operator_id: string; type: string; multi_room?: boolean | null; image: string | null; gallery: string[] | null };
  let roomTypes: { name: string; image: string | null; gallery: string[] | null }[] = [];
  if (l.multi_room) {
    const { data: rts } = await admin.from("room_types").select("name, image, gallery, sort_order").eq("listing_id", listingId).order("sort_order", { ascending: true });
    roomTypes = (rts ?? []) as typeof roomTypes;
  }
  return {
    listingId: l.id,
    operatorId: l.operator_id,
    type: l.type,
    multiRoom: !!l.multi_room,
    photos: listingTourPhotos(l, roomTypes),
    roomTypes: roomTypes.map((t) => ({ name: t.name, photos: listingTourPhotos({ image: t.image, gallery: t.gallery }) })),
  };
}

export async function canEditTour(admin: SupabaseClient, ctx: TourContext, userId: string): Promise<boolean> {
  if (ctx.operatorId === userId) return true;
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return (data as { role?: string } | null)?.role === "admin";
}

const SYSTEM = `You sort photos of a holiday rental (an apartment, house, guesthouse or hotel in Armenia) into the rooms of a virtual tour.

For each photo, answer with:
- "kind": exactly one of ${AI_ROOM_KINDS.join(", ")}.
  exterior = the building or property from outside; entrance = door, hallway, stairs; living = sofa/lounge area; dining = dining table area; kitchen = kitchen or kitchenette; bedroom = any room with a bed; bathroom = bathroom, shower, toilet; workspace = desk set up for work; balcony = balcony, terrace, loggia; view = mainly the view out (landscape, city, mountains); garden = garden, yard, courtyard, BBQ area; pool = swimming pool or hot tub; amenities = gym, sauna, laundry, parking, games room or similar facilities; other = anything else (close-ups, decor, documents, logos, maps, food, people, unclear).
- "caption": 2–7 plain words describing only what is clearly visible, sentence case, no full stop. Examples: "Double bed with reading lamps", "Kitchen with dining table", "Balcony with two chairs".
  Never use marketing words (stunning, cozy, luxurious, perfect, spacious, beautiful). Never claim size, quality, cleanliness, location, or a specific view (sea, Ararat…) unless it is unmistakable in the photo. If unsure, describe the main object only.

Reply with JSON only: [{"i": <photo number>, "kind": "...", "caption": "..."}] — one entry per photo, in order.`;

type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } };

/** Fetches a (small copy of a) listing photo from our own storage host only. */
async function fetchPhoto(url: string): Promise<ImageBlock | null> {
  const origin = STORAGE_ORIGIN();
  const small = smallPhotoUrl(url);
  for (const candidate of small === url ? [url] : [small, url]) {
    let u: URL;
    try {
      u = new URL(candidate);
    } catch {
      return null;
    }
    if (!origin || u.origin !== origin || !u.pathname.startsWith(PUBLIC_BUCKET_PATH)) return null;
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 4_500_000) continue; // Claude's per-image limit is 5 MB (base64 grows it)
      return { type: "image", source: { type: "base64", media_type: type as ImageBlock["source"]["media_type"], data: buf.toString("base64") } };
    } catch {
      /* try the full-size copy, or give up on this photo */
    }
  }
  return null;
}

/**
 * Sorts up to 8 photos into rooms. Photos Aha couldn't see or answer for come
 * back as "other" with no caption, so the tour still includes them.
 */
export async function classifyTourPhotos(urls: string[]): Promise<ClassifiedPhoto[]> {
  const fallback = (u: string): ClassifiedPhoto => ({ url: u, kind: "other", caption: "" });
  const anthropic = getClient();
  if (!anthropic || !urls.length) return urls.map(fallback);

  const images = await Promise.all(urls.map(fetchPhoto));
  const content: Anthropic.MessageParam["content"] = [];
  const shown: number[] = [];
  images.forEach((img, i) => {
    if (!img) return;
    shown.push(i);
    (content as unknown[]).push({ type: "text", text: `Photo ${shown.length}:` }, img);
  });
  if (!shown.length) return urls.map(fallback);
  (content as unknown[]).push({ type: "text", text: `Sort these ${shown.length} photos.` });

  try {
    const response = await anthropic.messages.create({
      model: process.env.TOUR_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 900,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content }],
    });
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const json = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
    const answers = JSON.parse(json) as { i?: number; kind?: string; caption?: string }[];
    const out = urls.map(fallback);
    for (const a of Array.isArray(answers) ? answers : []) {
      const n = typeof a.i === "number" ? a.i : NaN;
      const idx = shown[n - 1];
      if (idx === undefined) continue;
      out[idx] = {
        url: urls[idx],
        kind: isRoomKind(a.kind) && a.kind !== "hotel_room" ? a.kind : "other",
        caption: typeof a.caption === "string" ? a.caption.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").slice(0, TOUR_LIMITS.caption) : "",
      };
    }
    return out;
  } catch (err) {
    console.error("[tour] classify failed", err instanceof Error ? err.message : err);
    return urls.map(fallback);
  }
}

export type SaveTourResult = { ok: true } | { ok: false; status: number; error: string };

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Validates and stores the operator's tour. */
export async function saveTour(
  admin: SupabaseClient,
  ctx: TourContext,
  input: { rooms: unknown; status: "draft" | "live"; seenPhotos: unknown; rebuilt: boolean },
): Promise<SaveTourResult> {
  if (ctx.type !== "stay") return { ok: false, status: 400, error: "Virtual tours are for stays." };
  if (!Array.isArray(input.rooms)) return { ok: false, status: 400, error: "The tour couldn't be read. Please try again." };

  const allowed = new Set(ctx.photos);
  const panoPrefix = `${STORAGE_ORIGIN()}${PUBLIC_BUCKET_PATH}${ctx.operatorId}/`;
  const used = new Set<string>();
  const rooms: TourRoom[] = [];
  for (const r of input.rooms.slice(0, TOUR_LIMITS.rooms) as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const kind = isRoomKind(r.kind) ? r.kind : "other";
    const photos = (Array.isArray(r.photos) ? (r.photos as Record<string, unknown>[]) : [])
      .filter((p) => p && typeof p.url === "string" && allowed.has(p.url) && !used.has(p.url as string))
      .slice(0, TOUR_LIMITS.photosPerRoom)
      .map((p) => {
        used.add(p.url as string);
        return { url: p.url as string, caption: clip(p.caption, TOUR_LIMITS.caption) };
      });
    const panoUrl = r.pano && typeof (r.pano as { url?: unknown }).url === "string" ? ((r.pano as { url: string }).url) : null;
    if (panoUrl && (!STORAGE_ORIGIN() || !panoUrl.startsWith(panoPrefix))) {
      return { ok: false, status: 400, error: "A 360° photo couldn't be verified — upload it again from this page." };
    }
    if (!photos.length && !panoUrl) continue;
    rooms.push({
      id: clip(r.id, 40) || `r${rooms.length}`,
      name: clip(r.name, TOUR_LIMITS.name) || kindLabel(kind),
      kind,
      photos,
      pano: panoUrl ? { url: panoUrl } : null,
    });
  }
  if (input.status === "live" && !rooms.length) return { ok: false, status: 400, error: "Add at least one room before publishing the tour." };

  const seen = Array.from(
    new Set([...(Array.isArray(input.seenPhotos) ? (input.seenPhotos as unknown[]) : []).filter((u): u is string => typeof u === "string" && allowed.has(u)), ...Array.from(used)]),
  );

  const { data: existing } = await admin.from("listing_tours").select("status, published_at, built_at").eq("listing_id", ctx.listingId).maybeSingle();
  const prev = existing as { status: string; published_at: string | null; built_at: string | null } | null;
  const now = new Date().toISOString();
  const { error } = await admin.from("listing_tours").upsert(
    {
      listing_id: ctx.listingId,
      status: input.status,
      rooms,
      seen_photos: seen,
      built_at: input.rebuilt || !prev?.built_at ? now : prev.built_at,
      published_at: input.status === "live" ? (prev?.status === "live" && prev.published_at ? prev.published_at : now) : null,
      updated_at: now,
    },
    { onConflict: "listing_id" },
  );
  if (error) {
    console.error("[tour] save", error.message);
    return { ok: false, status: /relation .* does not exist/i.test(error.message) ? 503 : 500, error: "Couldn't save the tour right now. Please try again." };
  }
  return { ok: true };
}
