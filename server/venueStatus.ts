/**
 * Venue closure checks (migration 0112). Restaurants ("eat") and places to
 * visit ("place") that are linked to a Google place (listings.google_place_id,
 * 0051) are checked about once a week against Google's business status. When
 * it changes to temporarily / permanently closed — or back to open — the
 * admins get an email (sendVenueStatusAlert) and Admin → Eat guide / Visit
 * guide shows a badge. Nothing on the site changes automatically.
 *
 * Runs from the hourly refresh-ical cron a small batch at a time (oldest check
 * first), so each venue is looked at roughly weekly and a run stays short.
 * Needs GOOGLE_PLACES_API_KEY (the server key); silently does nothing without
 * it or before 0112.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBusinessStatus, type BusinessStatus } from "./googlePlaces.js";
import { resolveAdminEmails } from "./alerts.js";
import { sendVenueStatusAlert } from "./email.js";

const WEEK_MS = 7 * 86_400_000;

/** Whether a status change is worth telling the admins about. */
export function shouldAlert(previous: string | null, next: BusinessStatus | null): boolean {
  if (!next || next === previous) return false;
  if (next === "OPERATIONAL") return previous === "CLOSED_TEMPORARILY" || previous === "CLOSED_PERMANENTLY"; // reopened
  return true; // newly closed (or temporary → permanent)
}

export async function checkVenueClosures(admin: SupabaseClient, opts: { limit?: number } = {}): Promise<{ checked: number; alerted: number }> {
  if (!process.env.GOOGLE_PLACES_API_KEY) return { checked: 0, alerted: 0 };
  const due = new Date(Date.now() - WEEK_MS).toISOString();
  const { data, error } = await admin
    .from("listings")
    .select("id, title, slug, type, google_place_id, business_status, business_status_checked_at")
    .in("type", ["eat", "place"])
    .eq("status", "published")
    .not("google_place_id", "is", null)
    .or(`business_status_checked_at.is.null,business_status_checked_at.lt.${due}`)
    .order("business_status_checked_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 15);
  if (error) return { checked: 0, alerted: 0 }; // before 0112
  const rows = (data ?? []) as { id: string; title: string; slug: string; type: "eat" | "place"; google_place_id: string; business_status: string | null }[];
  if (!rows.length) return { checked: 0, alerted: 0 };

  let alerted = 0;
  let adminEmails: string[] | null = null;
  const now = new Date().toISOString();
  for (const r of rows) {
    const previous = r.business_status;
    const got = await fetchBusinessStatus(r.google_place_id);
    if (!got) {
      // Couldn't ask Google — try again next week rather than every hour.
      await admin.from("listings").update({ business_status_checked_at: now }).eq("id", r.id);
      continue;
    }
    const changed = !!got.status && got.status !== previous;
    await admin
      .from("listings")
      .update({ business_status_checked_at: now, ...(got.status ? { business_status: got.status } : {}), ...(changed ? { business_status_changed_at: now } : {}) })
      .eq("id", r.id);
    if (!shouldAlert(previous, got.status)) continue;
    adminEmails ??= await resolveAdminEmails(admin);
    await Promise.all(
      adminEmails.map((to) =>
        sendVenueStatusAlert(to, { title: r.title, type: r.type, slug: r.slug, status: got.status!, previous, mapsUri: got.mapsUri }).catch((e) =>
          console.error("[venue status] email", e),
        ),
      ),
    );
    alerted += 1;
  }
  return { checked: rows.length, alerted };
}
