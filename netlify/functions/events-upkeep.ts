/**
 * Weekly FREE upkeep of upcoming events (no AI, no paid searches): refreshes
 * public holidays and re-opens every upcoming event's source page for
 * cancellations and pictures (server/events.ts upkeepEvents). The paid AI
 * discovery runs twice a month (events-sync.ts). Hands off to the background
 * function like events-sync.ts. Loosely typed, outside tsconfig.
 */
import { eventsSyncToken } from "../../server/events.js";

export default async (): Promise<Response> => {
  const token = await eventsSyncToken();
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!token || !base) return Response.json({ skipped: "not_configured" });
  const res = await fetch(`${base}/.netlify/functions/events-sync-background`, { method: "POST", headers: { "x-events-token": token, "x-events-mode": "upkeep" } });
  return Response.json({ triggered: res.status });
};

export const config = { schedule: "@weekly" };
