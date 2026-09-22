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
import { fetchMergedBlockedRanges } from "../../server/ical.js";
import { syncAllPricelabs } from "../../server/pricelabs.js";

/** Legacy single `ical_url` → one Airbnb feed; otherwise use `ical_feeds`. */
function feedsFor(row: { ical_url?: string | null; ical_feeds?: unknown }) {
  const feeds: { url: string; label: string }[] = [];
  if (Array.isArray(row.ical_feeds)) {
    for (const f of row.ical_feeds as { url?: unknown; label?: unknown }[]) {
      const url = typeof f?.url === "string" ? f.url.trim() : "";
      if (url) feeds.push({ url, label: typeof f?.label === "string" && f.label.trim() ? f.label.trim() : "Calendar" });
    }
  }
  if (feeds.length === 0 && row.ical_url) feeds.push({ url: row.ical_url, label: "Airbnb" });
  return feeds;
}

export const handler = async () => {
  if (!adminConfigured()) {
    console.error("[refresh-ical] service role not configured — skipping");
    return { statusCode: 200, body: JSON.stringify({ skipped: "not_configured" }) };
  }
  const admin = supabaseAdmin();
  if (!admin) return { statusCode: 200, body: JSON.stringify({ skipped: "no_client" }) };

  // select("*") so a not-yet-run 0034 (ical_feeds) migration doesn't break the cron.
  const { data, error } = await admin.from("listings").select("*");
  if (error || !data) {
    console.error("[refresh-ical] failed to list listings", error);
    return { statusCode: 500, body: JSON.stringify({ error: "list_failed" }) };
  }

  let refreshed = 0;
  let failed = 0;
  for (const listing of data as { id: string; ical_url: string | null; ical_feeds: unknown }[]) {
    const feeds = feedsFor(listing);
    if (feeds.length === 0) continue;
    const syncedAt = new Date().toISOString();
    try {
      const { ranges, errors } = await fetchMergedBlockedRanges(feeds);
      const patch: Record<string, unknown> = { ical_synced_at: syncedAt, ical_error: errors.length ? errors.join("; ") : null };
      // Keep last-known-good ranges if every feed failed.
      if (errors.length < feeds.length) patch.blocked_ranges = ranges;
      await admin.from("listings").update(patch).eq("id", listing.id);
      if (errors.length) failed++; else refreshed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't refresh this calendar.";
      await admin.from("listings").update({ ical_error: message, ical_synced_at: syncedAt }).eq("id", listing.id);
      failed++;
    }
  }

  // Also pull PriceLabs recommended prices into mapped listings' calendars.
  let pricelabs: { operators: number; synced: number } = { operators: 0, synced: 0 };
  try {
    pricelabs = await syncAllPricelabs(admin);
  } catch (err) {
    console.error("[refresh-ical] pricelabs sync failed", err);
  }

  const result = { total: data.length, refreshed, failed, pricelabs };
  console.log("[refresh-ical]", result);
  return { statusCode: 200, body: JSON.stringify(result) };
};

// Once a day. Netlify reads this export to schedule the function.
export const config = { schedule: "@daily" };

export default handler;
