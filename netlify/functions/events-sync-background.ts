/**
 * Background function (the "-background" suffix gives it Netlify's 15-minute
 * limit): refreshes public holidays and runs the AI web-search discovery of
 * upcoming events in Armenia (server/events.ts). Invoked weekly by
 * events-sync.ts and by admins via POST /api/admin-events/refresh — both send
 * the derived token; anything else is ignored. Records a cron heartbeat.
 */
import { supabaseAdmin, adminConfigured } from "../../server/supabaseAdmin.js";
import { eventsSyncToken, recheckEvents, syncEvents } from "../../server/events.js";
import { recordCronRun, checkAndAlertStaleCrons } from "../../server/alerts.js";

const JOB = "events-sync";

export default async (req: Request): Promise<void> => {
  const token = await eventsSyncToken();
  if (!token || req.headers.get("x-events-token") !== token) {
    console.error("[events-sync] rejected: bad or missing token");
    return;
  }
  if (!adminConfigured()) return;
  const admin = supabaseAdmin();
  if (!admin) return;
  // "pictures" (Admin → Events → Refresh pictures): only re-open the upcoming
  // events' source pages (cancellations + pictures) — no paid web searches, and
  // no heartbeat, so it never starts the full refresh's one-hour cooldown.
  if (req.headers.get("x-events-mode") === "pictures") {
    try {
      console.log("[events-sync] pictures", JSON.stringify(await recheckEvents(admin)));
    } catch (e) {
      console.error("[events-sync] pictures failed", e);
    }
    return;
  }
  try {
    const r = await syncEvents(admin);
    console.log("[events-sync]", JSON.stringify(r));
    await recordCronRun(admin, JOB, r.errors.length === 0, r.errors.length ? r.errors.join(" | ").slice(0, 500) : `holidays ${r.holidays}, found ${r.found}, verified ${r.verified}, searches ${r.searches}, cancelled ${r.cancelled}, hidden ${r.hidden}`);
  } catch (e) {
    console.error("[events-sync] failed", e);
    await recordCronRun(admin, JOB, false, e instanceof Error ? e.message : String(e));
  }
  await checkAndAlertStaleCrons(admin);
};
