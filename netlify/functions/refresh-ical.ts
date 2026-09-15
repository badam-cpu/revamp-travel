/**
 * Daily iCal auto-refresh cron. Operators sync their Airbnb/GetYourGuide/etc.
 * calendar by pasting an .ics export URL (POST /api/sync-ical, on demand). This
 * scheduled function re-pulls every listing that has one once a day, so busy
 * dates stay current without the operator re-syncing by hand — closing the
 * overbooking gap the operator flagged.
 *
 * Runs with the service-role key (server-only) so it can update any operator's
 * listing; the one-way, RLS-scoped on-demand sync in server/routes.ts stays as
 * is. Reuses server/ical.ts's parser + SSRF-guarded fetch. Netlify detects the
 * `config.schedule` export and registers the cron automatically.
 *
 * Loosely typed / outside tsconfig, like netlify/functions/api.ts.
 */
import { supabaseAdmin, adminConfigured } from "../../server/supabaseAdmin.js";
import { fetchIcalBlockedRanges } from "../../server/ical.js";

export const handler = async () => {
  if (!adminConfigured()) {
    console.error("[refresh-ical] service role not configured — skipping");
    return { statusCode: 200, body: JSON.stringify({ skipped: "not_configured" }) };
  }
  const admin = supabaseAdmin();
  if (!admin) return { statusCode: 200, body: JSON.stringify({ skipped: "no_client" }) };

  const { data, error } = await admin
    .from("listings")
    .select("id, ical_url")
    .not("ical_url", "is", null);
  if (error || !data) {
    console.error("[refresh-ical] failed to list listings", error);
    return { statusCode: 500, body: JSON.stringify({ error: "list_failed" }) };
  }

  let refreshed = 0;
  let failed = 0;
  for (const listing of data as { id: string; ical_url: string | null }[]) {
    if (!listing.ical_url) continue;
    const syncedAt = new Date().toISOString();
    try {
      const blockedRanges = await fetchIcalBlockedRanges(listing.ical_url);
      await admin.from("listings").update({ blocked_ranges: blockedRanges, ical_synced_at: syncedAt, ical_error: null }).eq("id", listing.id);
      refreshed++;
    } catch (err) {
      // Record the failure but never wipe the last-known-good busy ranges.
      const message = err instanceof Error ? err.message : "Couldn't refresh this calendar.";
      await admin.from("listings").update({ ical_error: message, ical_synced_at: syncedAt }).eq("id", listing.id);
      failed++;
    }
  }

  const result = { total: data.length, refreshed, failed };
  console.log("[refresh-ical]", result);
  return { statusCode: 200, body: JSON.stringify(result) };
};

// Once a day. Netlify reads this export to schedule the function.
export const config = { schedule: "@daily" };

export default handler;
