/**
 * Weekly trigger for upcoming-events discovery (server/events.ts). A scheduled
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

export const config = { schedule: "@weekly" };
