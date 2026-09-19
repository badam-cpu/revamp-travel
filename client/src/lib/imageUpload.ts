/**
 * Browser → Supabase Storage image upload, shared by PhotoUploader (listing
 * photos) and AdminBlog (blog body/cover images). Images are downscaled/
 * re-encoded in-browser first (max 1600px, JPEG q≈0.82) so hosts don't fight
 * file-size limits. Uploads go to the public `listing-photos` bucket, scoped by
 * RLS to the signed-in user's own `<uid>/…` folder (see
 * supabase/migrations/0005_listing_photos_storage.sql).
 */
import { supabase } from "@/lib/supabase";

const BUCKET = "listing-photos";
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

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
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return fallback;
    if (blob.size >= file.size && scale === 1) return fallback;
    return { blob, ext: "jpg", contentType: "image/jpeg" };
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
