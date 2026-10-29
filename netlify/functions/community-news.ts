/**
 * Trigger for the revamp.community news finder (server/communityNews.ts):
 * Monday and Thursday at 04:00 UTC (08:00 Yerevan). AI web search takes longer
 * than a scheduled function may run (~30s), so this hands off to the
 * background function (15 min limit), authenticated with a token derived from
 * the service-role key. Finds DRAFTS only — an admin publishes. Loosely typed,
 * outside tsconfig.
 */
import { communityNewsToken } from "../../server/communityNews.js";
import { COMMUNITY_LIVE } from "../../shared/community.js";

export default async (): Promise<Response> => {
  // Not before launch — until then admins run it by hand (Find news now).
  if (!COMMUNITY_LIVE) return Response.json({ skipped: "community_not_live" });
  const token = await communityNewsToken();
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!token || !base) return Response.json({ skipped: "not_configured" });
  const res = await fetch(`${base}/.netlify/functions/community-news-background`, { method: "POST", headers: { "x-community-token": token } });
  return Response.json({ triggered: res.status });
};

export const config = { schedule: "0 4 * * 1,4" };
