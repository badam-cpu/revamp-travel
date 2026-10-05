/**
 * QR codes — operator/admin create dynamic codes that resolve at /q/<slug>
 * (server/routes.ts GET /api/qr-resolve). Metadata lives in the `qr_codes` table
 * (RLS: owner + admin); the QR image is generated client-side from the landing
 * URL. Migration 0086. Phase 1 wires the marketing types (listing/instructions/
 * custom); tip/service (payments) come later.
 */
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { supabase } from "@/lib/supabase";

export const QR_TYPES = [
  { value: "listing", label: "My Revamp listing", blurb: "Opens one of your listings — great for 'book your next stay'." },
  { value: "instructions", label: "Instructions / info", blurb: "A welcome page: wifi, check-out, house notes." },
  { value: "custom", label: "Custom URL", blurb: "Point the QR at any link you choose." },
] as const;

export type QrType = "listing" | "instructions" | "custom" | "tip" | "service";

export interface QrConfig {
  url?: string;
  content?: string;
  amountMode?: "choose" | "fixed";
  amountCents?: number;
  suggestionsCents?: number[];
  description?: string;
}

export interface QrRow {
  id: string;
  owner_id: string;
  listing_id: string | null;
  name: string;
  type: QrType;
  slug: string;
  config: QrConfig;
  scans: number;
  active: boolean;
  created_at: string;
}

/** The public URL a code resolves at. */
export function qrLandingUrl(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://revampvacations.com";
  return `${origin}/q/${slug}`;
}

export async function listQrCodes(): Promise<QrRow[]> {
  const { data, error } = await supabase.from("qr_codes").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as QrRow[];
}

export async function createQrCode(opts: {
  ownerId: string;
  name: string;
  type: QrType;
  listingId: string | null;
  config: QrConfig;
}): Promise<void> {
  // Short unique code; retry once on the (extremely unlikely) slug collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = nanoid(8).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
    const { error } = await supabase.from("qr_codes").insert({
      owner_id: opts.ownerId,
      name: opts.name.trim(),
      type: opts.type,
      listing_id: opts.listingId,
      slug,
      config: opts.config,
    });
    if (!error) return;
    if (error.code !== "23505") throw new Error(error.message); // not a unique-collision
  }
  throw new Error("Couldn't generate a unique code — try again.");
}

export async function deleteQrCode(id: string): Promise<void> {
  const { error } = await supabase.from("qr_codes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setQrActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("qr_codes").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Resolve a code for the public landing page (counts the scan server-side). */
export async function resolveQr(code: string): Promise<{ type: QrType; name: string; config: QrConfig; listingSlug: string | null }> {
  const res = await fetch(`/api/qr-resolve?code=${encodeURIComponent(code)}`);
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || "This QR code isn't active.");
  }
  return res.json();
}

// --- image generation ---------------------------------------------------------
export async function qrPngDataUrl(text: string, size = 640): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: size, errorCorrectionLevel: "M", color: { dark: "#212121", light: "#ffffff" } });
}
export async function qrSvgString(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#212121", light: "#ffffff" } });
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
export async function downloadQrPng(text: string, filename: string): Promise<void> {
  triggerDownload(await qrPngDataUrl(text, 1024), filename.endsWith(".png") ? filename : `${filename}.png`);
}
export async function downloadQrSvg(text: string, filename: string): Promise<void> {
  const blob = new Blob([await qrSvgString(text)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename.endsWith(".svg") ? filename : `${filename}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
