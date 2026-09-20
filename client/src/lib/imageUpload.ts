/**
 * Browser → Supabase Storage image upload, shared by PhotoUploader (listing
 * photos) and AdminBlog (blog images). Airbnb-style delivery: one decode, then
 * a LADDER of WebP variants (640 / 1280 / 2560px long edge, never upscaled past
 * the source), all stored side by side as `<uuid>_w<width>.webp`. The returned
 * URL is the largest variant, and its `_w<max>` token lets imgAttrs() (see
 * client/src/lib/responsiveImg.ts) rebuild a srcset so each slot + device pixel
 * ratio downloads only the resolution it needs — crisp in the full-screen
 * lightbox, light on a thumbnail. WebP q≈0.82 (JPEG q≈0.85 where the browser
 * can't encode WebP). HEIC / anything the canvas can't decode is uploaded as-is
 * (single file, no srcset). Uploads go to the public `listing-photos` bucket,
 * RLS-scoped to the signed-in user's own `<uid>/…` folder (migration 0005).
 */
import { supabase } from "@/lib/supabase";

const BUCKET = "listing-photos";
// Long-edge widths generated per image. Covers a thumbnail (640), a card/hero at
// 2× (1280), and the full-screen lightbox at 2× (2560). Keep in sync with the
// LADDER in responsiveImg.ts.
export const IMAGE_LADDER = [640, 1280, 2560];
const MAX_DIMENSION = 2560;
const WEBP_QUALITY = 0.82;
const JPEG_QUALITY = 0.85;

/** WebP re-encodes sharper per byte than JPEG; use it when the browser can encode it. */
function pickEncoding(): { type: string; ext: string; quality: number } {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    if (c.toDataURL("image/webp").startsWith("data:image/webp")) return { type: "image/webp", ext: "webp", quality: WEBP_QUALITY };
  } catch {
    /* fall through to JPEG */
  }
  return { type: "image/jpeg", ext: "jpg", quality: JPEG_QUALITY };
}

async function encodeAt(bitmap: ImageBitmap, w: number, h: number, type: string, quality: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Upload one image (as a responsive ladder) and return the largest variant's public URL. */
export async function uploadImage(file: File, userId: string): Promise<string> {
  const uuid = crypto.randomUUID();
  const putPublic = async (path: string, body: Blob, contentType: string) => {
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
    if (error) throw error;
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  };

  // Fallback: not an image, or the canvas can't decode it (e.g. HEIC) → store as-is.
  let bitmap: ImageBitmap | null = null;
  if (file.type.startsWith("image/")) {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      bitmap = null;
    }
  }
  if (!bitmap) {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    return putPublic(`${userId}/${uuid}.${ext}`, file, file.type || "application/octet-stream");
  }

  const { type, ext, quality } = pickEncoding();
  const long = Math.max(bitmap.width, bitmap.height);
  const maxW = Math.min(long, MAX_DIMENSION); // never upscale past the source
  // Ladder steps smaller than the source, plus one at the source (or the cap).
  const widths = [...IMAGE_LADDER.filter((w) => w < maxW), maxW];

  let masterUrl = "";
  for (const w of widths) {
    const scale = w / long;
    const cw = Math.max(1, Math.round(bitmap.width * scale));
    const ch = Math.max(1, Math.round(bitmap.height * scale));
    const blob = await encodeAt(bitmap, cw, ch, type, quality);
    if (!blob) continue;
    const url = await putPublic(`${userId}/${uuid}_w${w}.${ext}`, blob, type);
    if (w === maxW) masterUrl = url;
  }
  if (masterUrl) return masterUrl;
  // Every encode failed — last-resort original upload.
  const oext = (file.name.split(".").pop() || "bin").toLowerCase();
  return putPublic(`${userId}/${uuid}.${oext}`, file, file.type || "application/octet-stream");
}
