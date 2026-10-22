/**
 * Trigger for the PAID upcoming-events discovery (server/events.ts): twice a
 * month, on the 1st and 15th at 02:00 UTC (06:00 Yerevan) — about $2.5 a run in
 * AI web search, and events are found up to 12 months ahead, so weekly found
 * little new (cadence chosen 2026-10-22). The free weekly upkeep — holidays,
 * cancellation re-checks, pictures — is events-upkeep.ts. A scheduled
 * function may only run ~30s, and AI web search takes longer, so this just
 * hands off to the background function (15 min limit), authenticated with a
 * token derived from the service-role key. Loosely typed, outside tsconfig.
 */
import { eventsSyncToken } from "../../server/events.js";

export default async (): Promise<Response> => {
  const token = await eventsSyncToken();
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!token || !base) return Response.json({ skipped: "not_configured" });
  const res = await fetch(`${base}/.netlify/functions/events-sync-background`, { method: "POST", headers: { "x-events-token": token } });
  return Response.json({ triggered: res.status });
};

export const config = { schedule: "0 2 1,15 * *" };
