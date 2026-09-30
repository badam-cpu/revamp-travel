/**
 * Browser → Supabase Storage upload for a listing's short intro video, into the
 * public `listing-videos` bucket (migration 0079), RLS-scoped to the signed-in
 * user's own <uid>/ folder — same trust model as listing photos. No transcoding
 * happens, so we cap length + size client-side and keep clips short. Returns the
 * uploaded file's public URL, stored in the listing's `video_url`.
 */
import { supabase } from "@/lib/supabase";

const BUCKET = "listing-videos";
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB (matches the bucket cap)
export const MAX_VIDEO_SECONDS = 60; // short clips only
export const ACCEPTED_VIDEO = "video/mp4,video/webm,video/quicktime";

/** Best-effort duration read from the file's metadata (0 if it can't be probed). */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const el = document.createElement("video");
      el.preload = "metadata";
      el.onloadedmetadata = () => { URL.revokeObjectURL(el.src); resolve(el.duration || 0); };
      el.onerror = () => { URL.revokeObjectURL(el.src); resolve(0); };
      el.src = URL.createObjectURL(file);
    } catch {
      resolve(0);
    }
  });
}

/** Upload one short video and return its public URL. Throws with a friendly message. */
export async function uploadVideo(file: File, userId: string): Promise<string> {
  if (file.size > MAX_VIDEO_BYTES) throw new Error(`That video is too large (max ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB). Trim it or lower the resolution.`);
  const duration = await readVideoDuration(file);
  if (duration && duration > MAX_VIDEO_SECONDS + 1) throw new Error(`Keep it short — max ${MAX_VIDEO_SECONDS} seconds (this clip is ${Math.round(duration)}s).`);

  const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "video/mp4", upsert: false });
  if (error) throw new Error(error.message || "Upload failed.");
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
