/**
 * Campaign email images (0107). Email is not the web: Outlook can't show WebP,
 * many inboxes block images until the reader allows them, and the content
 * column is 600px wide (1200px for sharp phones / retina). So campaign images
 * get their own upload: resized to EMAIL_IMAGE_WIDTH, flattened onto white
 * (JPEG has no transparency) and saved as a compressed JPEG in the public
 * `listing-photos` bucket under the admin's folder — plus a quality check
 * the composer shows before anything is sent.
 */
import { supabase } from "@/lib/supabase";

export const EMAIL_IMAGE_WIDTH = 1200; // 2× the 600px email column
export const EMAIL_IMAGE_MIN_WIDTH = 600; // below this it looks blurry on every screen
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const BUCKET = "listing-photos";

export const IMAGE_GUIDE = [
  "Best size: 1200 × 600 px (landscape, 2:1). At least 1200 px wide for sharp phones and retina screens.",
  "JPG or PNG. We resize and compress it to about 100–250 KB so it loads fast.",
  "Keep important words in the message, not inside the picture — many inboxes hide images until the reader allows them.",
  "Add alt text: it's shown when images are hidden and read aloud by screen readers.",
];

/**
 * Three starter visuals that ship with the site (client/public/images/email/):
 * the brand cover + two of Revamp's own illustrations, pre-rendered to 1200 × 600 JPEG
 * (Gmail/Outlook don't show SVG). Revamp owns them — no listing photos here,
 * those were uploaded for listings, not for Revamp's marketing. Kept to three on
 * purpose (more looked noisy; most campaigns use their own photos). Emails always
 * point at the live site; the composer shows the local copy.
 */
export const STARTER_IMAGE_BASE = "https://revampvacations.com/images/email/";
const STARTERS: { id: string; name: string; file: string; size_bytes: number }[] = [
  { id: "starter-brand-cover", name: "Stay. Experience. Repeat.", file: "brand-cover.jpg", size_bytes: 96465 },
  { id: "starter-hero-armenia", name: "Armenia", file: "hero-armenia.jpg", size_bytes: 25315 },
  { id: "starter-dilijan", name: "Dilijan", file: "dilijan.jpg", size_bytes: 18541 },
];
export const STARTER_IMAGES: CampaignImage[] = STARTERS.map((s) => ({
  id: s.id,
  url: `${STARTER_IMAGE_BASE}${s.file}`,
  name: s.name,
  width: 1200,
  height: 600,
  size_bytes: s.size_bytes,
  original_width: 1200,
  original_height: 600,
  created_at: "2026-10-15T00:00:00Z",
  starter: true,
}));
/** Where the composer loads an image from (starters: the local copy, so they show before a deploy too). */
export const displaySrc = (url: string) => (url.startsWith(STARTER_IMAGE_BASE) ? `/images/email/${url.slice(STARTER_IMAGE_BASE.length)}` : url);

export interface CampaignImage {
  id: string;
  url: string;
  name: string;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  original_width: number | null;
  original_height: number | null;
  created_at: string;
  /** Ships with the site — can't be removed. */
  starter?: boolean;
}

export type QualityLevel = "good" | "okay" | "low";
export interface QualityNote {
  level: "ok" | "warn" | "bad";
  text: string;
}

const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/** Quality check for a campaign image (original size decides sharpness; the optimised file decides weight). */
export function imageQuality(img: { width: number | null; height: number | null; size_bytes: number | null; original_width?: number | null }, altText?: string): {
  level: QualityLevel;
  notes: QualityNote[];
  summary: string;
} {
  const notes: QualityNote[] = [];
  const w = img.original_width ?? img.width ?? 0;
  const h = img.height ?? 0;
  const ratio = w && h ? (img.width ?? w) / h : 0;
  if (w >= EMAIL_IMAGE_WIDTH) notes.push({ level: "ok", text: `Sharp — ${w} px wide (1200 px needed).` });
  else if (w >= EMAIL_IMAGE_MIN_WIDTH) notes.push({ level: "warn", text: `${w} px wide — may look soft on phones. Use 1200 px wide or more.` });
  else notes.push({ level: "bad", text: `Only ${w} px wide — will look blurry. Use 1200 px wide.` });
  if (ratio) {
    if (ratio < 0.8) notes.push({ level: "warn", text: "Tall image — it pushes your message below the first screen. Landscape (2:1 or 3:2) works best." });
    else if (ratio > 3.2) notes.push({ level: "warn", text: "Very wide strip — it will look thin on phones. 2:1 or 3:2 works best." });
    else notes.push({ level: "ok", text: `Good shape (${ratio >= 1 ? ratio.toFixed(1) + ":1" : "1:" + (1 / ratio).toFixed(1)}).` });
  }
  if (img.size_bytes != null) {
    if (img.size_bytes > 500 * 1024) notes.push({ level: "warn", text: `Heavy file (${kb(img.size_bytes)}) — slow on mobile data. Under 300 KB is ideal.` });
    else notes.push({ level: "ok", text: `Light file (${kb(img.size_bytes)}).` });
  }
  if (altText !== undefined) {
    if (!altText.trim()) notes.push({ level: "warn", text: "No alt text — add a short description for inboxes that hide images." });
    else notes.push({ level: "ok", text: "Alt text added." });
  }
  const level: QualityLevel = notes.some((n) => n.level === "bad") ? "low" : notes.some((n) => n.level === "warn") ? "okay" : "good";
  const dims = img.width && img.height ? `${img.width} × ${img.height}` : "";
  const summary = [dims, img.size_bytes != null ? kb(img.size_bytes) : ""].filter(Boolean).join(" · ");
  return { level, notes, summary };
}

/** Resize + flatten + JPEG-encode in the browser, upload, and save to the library. */
export async function uploadCampaignImage(file: File, userId: string): Promise<CampaignImage> {
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) throw new Error("Use a JPG or PNG image.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("That file is over 15 MB — export a smaller version and try again.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. Try exporting it as JPG.");
  }
  const ow = bitmap.width;
  const oh = bitmap.height;
  if (ow < EMAIL_IMAGE_MIN_WIDTH) {
    bitmap.close();
    throw new Error(`That image is only ${ow} px wide — it would look blurry. Use one at least 1200 px wide.`);
  }
  const scale = Math.min(1, EMAIL_IMAGE_WIDTH / ow);
  const w = Math.round(ow * scale);
  const h = Math.round(oh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image in this browser.");
  ctx.fillStyle = "#ffffff"; // JPEG has no transparency — flatten onto white, not black
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  // Step quality down until the file is light enough for email.
  let blob: Blob | null = null;
  for (const q of [0.85, 0.78, 0.7, 0.62]) {
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= 300 * 1024) break;
  }
  if (!blob) throw new Error("Couldn't process that image.");

  const path = `${userId}/campaign/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (upErr) throw new Error("Upload failed — try again.");
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Image";
  const row = { url, name, width: w, height: h, size_bytes: blob.size, original_width: ow, original_height: oh, created_by: userId };
  const { data, error } = await supabase.from("campaign_images").insert(row).select("*").single();
  if (error || !data) {
    console.error("[campaign image] save failed", error?.message);
    throw new Error("Uploaded, but couldn't save it to the library — has migration 0107 been run?");
  }
  return data as CampaignImage;
}

export async function listCampaignImages(): Promise<{ images: CampaignImage[]; missing: boolean }> {
  const { data, error } = await supabase.from("campaign_images").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) return { images: [], missing: true };
  return { images: (data as CampaignImage[]) ?? [], missing: false };
}

/** Remove from the library only — the file stays, because sent emails still show it. */
export async function removeCampaignImage(id: string): Promise<void> {
  const { error } = await supabase.from("campaign_images").delete().eq("id", id);
  if (error) throw new Error("Couldn't remove it.");
}
