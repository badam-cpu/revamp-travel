/**
 * Cron health heartbeats + dead-cron email alerting.
 *
 * Why: our scheduled functions (netlify/functions/*.ts) are the only things
 * that keep operator calendars fresh (refresh-ical) and confirm PayLink
 * payments (reconcile-bookings). When one silently stops running there's no
 * error anywhere — we found Airbnb availability ~2.5 weeks stale because the
 * refresh cron hadn't run. This module makes "a cron stopped" observable.
 *
 * How it works:
 *  - Every scheduled function calls recordCronRun() at the end of each run
 *    (success OR failure), writing a heartbeat row to public.cron_runs.
 *  - Every run then calls checkAndAlertStaleCrons(), which looks at ALL jobs in
 *    CRON_REGISTRY and emails the admins about any job whose last success is
 *    older than its expected cadence, or that has been failing repeatedly.
 *  - Because the jobs cross-check each other, a single dead cron is caught by
 *    the others that still run (e.g. the 10-minute reconcile notices the daily
 *    refresh has gone stale). Alerts are de-duped (at most one per RE_ALERT
 *    window) and a one-time "recovered" email is sent when it comes back.
 *
 * Limitation: if the ENTIRE Netlify scheduler dies, no job runs, so none can
 * send the in-app alert. For that case set a per-job HEARTBEAT_URL_* env to an
 * external dead-man's-switch (e.g. healthchecks.io) — pingHeartbeat() calls it
 * on each success, and the external service alerts when the pings stop.
 *
 * All writes are service-role (the crons use supabaseAdmin()); RLS lets admins
 * only read the table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfigured, sendCronAlert, sendCronRecovered } from "./email.js";

export interface CronJobSpec {
  /** Stable key — must match the `job` passed to recordCronRun(). */
  job: string;
  /** Human label for the email. */
  label: string;
  /** Alert if the last SUCCESS is older than this many minutes. */
  maxAgeMinutes: number;
}

/**
 * Every scheduled job we monitor + how fresh its last success must be before we
 * alert. Keep each job here in sync with its netlify/functions/*.ts schedule
 * (with generous headroom so a single slow/skipped run isn't a false alarm).
 */
export const CRON_REGISTRY: CronJobSpec[] = [
  // Schedule: @daily → allow a full extra run's worth of slack (30h).
  { job: "refresh-ical", label: "iCal availability refresh", maxAgeMinutes: 30 * 60 },
  // Schedule: */10 * * * * → should run constantly; 60 min means several misses.
  { job: "reconcile-bookings", label: "Booking & payment reconcile", maxAgeMinutes: 60 },
];

/** Re-send a down-alert for the same job at most once per this window. */
const RE_ALERT_MINUTES = 12 * 60;
/** Consecutive failed runs that count as "degraded" even if not yet stale. */
const FAILURE_STREAK_ALERT = 3;

interface CronRunRow {
  job: string;
  last_run_at: string | null;
  last_success_at: string | null;
  ok: boolean | null;
  detail: string | null;
  consecutive_failures: number | null;
  alerted_at: string | null;
}

function ageMs(iso: string | null, now: number): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return isNaN(t) ? Infinity : now - t;
}

/**
 * Record one run of a scheduled job. Idempotent upsert keyed by job; a failing
 * run keeps the prior last_success_at (so "how long since it last worked" stays
 * meaningful) and bumps the failure streak.
 */
export async function recordCronRun(
  admin: SupabaseClient,
  job: string,
  ok: boolean,
  detail?: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const { data: prev } = await admin.from("cron_runs").select("*").eq("job", job).maybeSingle();
    const prevRow = prev as CronRunRow | null;
    const row = {
      job,
      last_run_at: now,
      last_success_at: ok ? now : prevRow?.last_success_at ?? null,
      ok,
      detail: detail ? detail.slice(0, 500) : null,
      consecutive_failures: ok ? 0 : (prevRow?.consecutive_failures ?? 0) + 1,
      updated_at: now,
    };
    await admin.from("cron_runs").upsert(row, { onConflict: "job" });
  } catch (err) {
    // Heartbeat must never break the cron it's measuring.
    console.error("[alerts] recordCronRun failed", job, err);
  }

  // Best-effort external dead-man's-switch ping on success (e.g. healthchecks.io).
  if (ok) await pingHeartbeat(job);
}

/**
 * Look at every registered job and email admins about any that look down
 * (last success too old) or degraded (failing repeatedly). Send a one-time
 * recovery email when a previously-alerting job is healthy again. Safe to call
 * on every cron run — alerts are de-duped via cron_runs.alerted_at.
 */
export async function checkAndAlertStaleCrons(admin: SupabaseClient): Promise<{ alerted: string[]; recovered: string[] }> {
  const alerted: string[] = [];
  const recovered: string[] = [];
  try {
    const { data } = await admin.from("cron_runs").select("*");
    const rows = (data ?? []) as CronRunRow[];
    const byJob = new Map(rows.map((r) => [r.job, r]));
    const now = Date.now();

    // "System alive since" = the most recent success across ALL jobs. Used to
    // decide whether a never-recorded job is genuinely overdue vs. just not
    // deployed yet — avoids a false alarm on a brand-new environment.
    const newestSuccessMs = rows.reduce((min, r) => Math.min(min, ageMs(r.last_success_at, now)), Infinity);

    const recipients = await resolveAdminEmails(admin);

    for (const spec of CRON_REGISTRY) {
      const row = byJob.get(spec.job);
      const maxAgeMs = spec.maxAgeMinutes * 60_000;
      const neverSucceeded = !row || !row.last_success_at;
      const successAge = ageMs(row?.last_success_at ?? null, now);

      // Overdue if it has a known success that's too old, OR it has never
      // succeeded AND the system has otherwise been alive longer than this
      // job's window (so we know it really should have run by now).
      const stale = neverSucceeded ? newestSuccessMs > maxAgeMs : successAge > maxAgeMs;
      const failing = (row?.consecutive_failures ?? 0) >= FAILURE_STREAK_ALERT;
      const down = stale || failing;

      if (down) {
        const alreadyAlerted = row?.alerted_at && ageMs(row.alerted_at, now) < RE_ALERT_MINUTES * 60_000;
        if (alreadyAlerted) continue;
        const reason = failing
          ? `Failed ${row?.consecutive_failures} run(s) in a row`
          : neverSucceeded
            ? "Has never recorded a successful run"
            : `No successful run in over ${Math.round(spec.maxAgeMinutes / 60)}h`;
        if (recipients.length && emailConfigured()) {
          await Promise.all(
            recipients.map((to) =>
              sendCronAlert(to, {
                job: spec.label,
                reason,
                lastSuccessAt: row?.last_success_at ?? null,
                lastError: row?.ok === false ? row?.detail : null,
              }),
            ),
          );
        } else {
          console.warn(`[alerts] ${spec.job} is down (${reason}) but no email recipients / email not configured.`);
        }
        await admin.from("cron_runs").upsert(
          { job: spec.job, alerted_at: new Date().toISOString() },
          { onConflict: "job" },
        );
        alerted.push(spec.job);
      } else if (row?.alerted_at) {
        // Healthy again after having alerted — clear the flag and say so once.
        if (recipients.length && emailConfigured()) {
          await Promise.all(recipients.map((to) => sendCronRecovered(to, { job: spec.label })));
        }
        await admin.from("cron_runs").update({ alerted_at: null }).eq("job", spec.job);
        recovered.push(spec.job);
      }
    }
  } catch (err) {
    console.error("[alerts] checkAndAlertStaleCrons failed", err);
  }
  return { alerted, recovered };
}

/**
 * Who gets operational alerts: ADMIN_EMAIL, every admin profile's auth email,
 * then EMAIL_FROM as a last resort so an alert still lands. Mirrors the
 * support-escalation recipient logic in server/routes.ts.
 */
export async function resolveAdminEmails(admin: SupabaseClient): Promise<string[]> {
  const emails = new Set<string>();
  if (process.env.ADMIN_EMAIL) emails.add(process.env.ADMIN_EMAIL);
  try {
    const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
    for (const a of admins ?? []) {
      const { data: u } = await admin.auth.admin.getUserById((a as { id: string }).id);
      if (u?.user?.email) emails.add(u.user.email);
    }
  } catch (err) {
    console.error("[alerts] resolveAdminEmails lookup failed", err);
  }
  if (emails.size === 0 && process.env.EMAIL_FROM) emails.add(process.env.EMAIL_FROM);
  return Array.from(emails);
}

/**
 * Optional external dead-man's-switch: GET a per-job heartbeat URL on success so
 * a service like healthchecks.io can alert if the whole scheduler dies (when no
 * in-app code runs to email). Env var: HEARTBEAT_URL_<JOB>, job uppercased with
 * non-alphanumerics → "_", e.g. HEARTBEAT_URL_REFRESH_ICAL. No env → no-op.
 */
export async function pingHeartbeat(job: string): Promise<void> {
  const key = `HEARTBEAT_URL_${job.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const url = process.env[key];
  if (!url) return;
  try {
    await fetch(url, { method: "GET" });
  } catch (err) {
    console.error("[alerts] heartbeat ping failed", job, err);
  }
}
