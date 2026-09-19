/**
 * Browser → Supabase Storage image upload, shared by PhotoUploader (listing
 * photos) and AdminBlog (blog body/cover images). Images are downscaled/
 * re-encoded in-browser first (max 3000px long edge, WebP q≈0.9 — JPEG q≈0.92
 * where WebP encoding isn't available) so they stay crisp on full-width galleries
 * and the full-screen lightbox, including large retina/2× displays, without
 * shipping raw multi-MB originals. Uploads go to the public `listing-photos` bucket,
 * scoped by RLS to the signed-in user's own `<uid>/…` folder (see
 * supabase/migrations/0005_listing_photos_storage.sql).
 */
import { supabase } from "@/lib/supabase";

const BUCKET = "listing-photos";
// 3000px keeps photos crisp even in the full-screen lightbox on large 2× (retina)
// monitors; below this photos get upscaled on screen and look soft/pixelated.
const MAX_DIMENSION = 3000;
const WEBP_QUALITY = 0.9;
const JPEG_QUALITY = 0.92;

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

/** Downscale + re-encode an image; falls back to the original if the canvas can't decode it (e.g. HEIC). */
export async function compressImage(file: File): Promise<{ blob: Blob; ext: string; contentType: string }> {
  const fallback = { blob: file, ext: (file.name.split(".").pop() || "bin").toLowerCase(), contentType: file.type || "application/octet-stream" };
  if (!file.type.startsWith("image/")) return fallback;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    // High-quality resampling for the downscale (default is often bilinear/soft).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { type, ext, quality } = pickEncoding();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) return fallback;
    // Only keep the original when we didn't resize AND re-encoding didn't help.
    if (blob.size >= file.size && scale === 1) return fallback;
    return { blob, ext, contentType: type };
  } catch {
    return fallback;
  }
}

/** Upload one image and return its public URL. `userId` scopes the storage path (RLS). */
export async function uploadImage(file: File, userId: string): Promise<string> {
  const { blob, ext, contentType } = await compressImage(file);
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
