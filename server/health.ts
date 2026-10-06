/**
 * Admin health snapshot — the data behind /admin → Health. Aggregates the
 * "life-important" operational signals in one place so an admin can see at a
 * glance whether the site's moving parts are alive: the scheduled jobs (crons),
 * per-listing calendar (iCal) freshness, stuck payments, and which server
 * integrations are configured.
 *
 * Read-only and admin-gated at the route (server/routes.ts). Integration status
 * is reported as BOOLEANS only — never a key value — so nothing secret leaks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CRON_REGISTRY } from "./alerts.js";
import { pingDb } from "./supabase.js";
import { paylinkConfigured } from "./paylink.js";
import { emailConfigured } from "./email.js";
import { adminConfigured } from "./supabaseAdmin.js";
import { googlePlacesConfigured } from "./googlePlaces.js";
import { translateConfigured } from "./translate.js";
import { smsConfigured, whatsappConfigured, viberConfigured } from "./sms.js";
import { telegramConfigured } from "./telegram.js";
import { supportAiConfigured } from "./support.js";
import { tripadvisorConfigured } from "./tripadvisor.js";

/** How long a connected listing calendar may go unsynced before we flag it. */
const CAL_STALE_HOURS = 24;

export interface CronHealth {
  job: string;
  label: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  ok: boolean | null;
  consecutiveFailures: number;
  detail: string | null;
  stale: boolean;
  maxAgeMinutes: number;
  neverRecorded: boolean;
}

export interface CalendarHealth {
  id: string;
  title: string;
  type: string;
  lastSyncedAt: string | null;
  error: string | null;
  blockedRanges: number;
  stale: boolean;
}

export interface AdminHealth {
  time: string;
  db: { ok: boolean; configured: boolean };
  crons: CronHealth[];
  calendars: { total: number; stale: number; errored: number; items: CalendarHealth[] };
  bookings: { pendingPayment: number; awaitingPayment: number };
  integrations: Record<string, boolean>;
}

export async function collectHealth(admin: SupabaseClient): Promise<AdminHealth> {
  const now = Date.now();

  const db = await pingDb();

  // Crons — join the heartbeat rows against the registry so a job that has
  // NEVER recorded a run still shows up (as missing), not just silently absent.
  const { data: cronRows } = await admin.from("cron_runs").select("*");
  const rows = (cronRows ?? []) as Array<Record<string, unknown>>;
  const crons: CronHealth[] = CRON_REGISTRY.map((spec) => {
    const row = rows.find((r) => r.job === spec.job);
    const lastSuccess = typeof row?.last_success_at === "string" ? Date.parse(row.last_success_at) : NaN;
    const hasSuccess = !isNaN(lastSuccess);
    const stale = !hasSuccess || now - lastSuccess > spec.maxAgeMinutes * 60_000;
    return {
      job: spec.job,
      label: spec.label,
      lastRunAt: (row?.last_run_at as string) ?? null,
      lastSuccessAt: (row?.last_success_at as string) ?? null,
      ok: (row?.ok as boolean) ?? null,
      consecutiveFailures: (row?.consecutive_failures as number) ?? 0,
      detail: (row?.detail as string) ?? null,
      stale,
      maxAgeMinutes: spec.maxAgeMinutes,
      neverRecorded: !row,
    };
  });

  // Calendars — only listings that actually have a feed connected.
  const { data: listingRows } = await admin
    .from("listings")
    .select("id,title,type,ical_url,ical_feeds,ical_synced_at,ical_error,blocked_ranges");
  const withFeed = (listingRows ?? []).filter(
    (l: Record<string, unknown>) => l.ical_url || (Array.isArray(l.ical_feeds) && l.ical_feeds.length > 0),
  ) as Array<Record<string, unknown>>;
  const items: CalendarHealth[] = withFeed.map((l) => {
    const lastMs = typeof l.ical_synced_at === "string" ? Date.parse(l.ical_synced_at) : NaN;
    const stale = isNaN(lastMs) || now - lastMs > CAL_STALE_HOURS * 3_600_000;
    return {
      id: l.id as string,
      title: (l.title as string) ?? "Untitled",
      type: (l.type as string) ?? "",
      lastSyncedAt: (l.ical_synced_at as string) ?? null,
      error: (l.ical_error as string) ?? null,
      blockedRanges: Array.isArray(l.blocked_ranges) ? (l.blocked_ranges as unknown[]).length : 0,
      stale,
    };
  });
  // Problem calendars first (errored, then stale), then the healthy ones.
  items.sort((a, b) => Number(!!b.error) - Number(!!a.error) || Number(b.stale) - Number(a.stale));

  // Stuck payments — a cron outage leaves paid holds here (PayLink has no webhook).
  const { count: pendingPayment } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_payment");
  const { count: awaitingPayment } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "awaiting_payment");

  const integrations: Record<string, boolean> = {
    payments_paylink: paylinkConfigured(),
    email_resend: emailConfigured(),
    supabase_service_role: adminConfigured(),
    anthropic_ai: supportAiConfigured(),
    google_maps: !!process.env.VITE_GOOGLE_MAPS_API_KEY,
    google_places: googlePlacesConfigured(),
    google_translate: translateConfigured(),
    sms_infobip: smsConfigured(),
    whatsapp_infobip: whatsappConfigured(),
    viber_infobip: viberConfigured(),
    telegram: telegramConfigured(),
    tripadvisor: tripadvisorConfigured(),
    alert_recipient_admin_email: !!process.env.ADMIN_EMAIL,
    heartbeat_ping_refresh_ical: !!process.env.HEARTBEAT_URL_REFRESH_ICAL,
    heartbeat_ping_reconcile_bookings: !!process.env.HEARTBEAT_URL_RECONCILE_BOOKINGS,
  };

  return {
    time: new Date().toISOString(),
    db: { ok: db.ok, configured: db.configured },
    crons,
    calendars: { total: items.length, stale: items.filter((c) => c.stale).length, errored: items.filter((c) => c.error).length, items },
    bookings: { pendingPayment: pendingPayment ?? 0, awaitingPayment: awaitingPayment ?? 0 },
    integrations,
  };
}
