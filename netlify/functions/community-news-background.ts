/**
 * Background function ("-background" = Netlify's 15-minute limit): finds news
 * for revamp.community hosts with AI web search and stores them as drafts for
 * an admin to review (server/communityNews.ts). Invoked twice a week by
 * community-news.ts and by admins via POST /api/admin-community/find-news —
 * both send the derived token; anything else is ignored. Records a heartbeat.
 */
import { supabaseAdmin, adminConfigured } from "../../server/supabaseAdmin.js";
import { communityNewsToken, findCommunityNews } from "../../server/communityNews.js";
import { recordCronRun, checkAndAlertStaleCrons } from "../../server/alerts.js";

const JOB = "community-news";

export default async (req: Request): Promise<void> => {
  const token = await communityNewsToken();
  if (!token || req.headers.get("x-community-token") !== token) {
    console.error("[community-news] rejected: bad or missing token");
    return;
  }
  if (!adminConfigured()) return;
  const admin = supabaseAdmin();
  if (!admin) return;
  try {
    const r = await findCommunityNews(admin);
    console.log("[community-news]", JSON.stringify(r));
    await recordCronRun(admin, JOB, true, `sources ${r.sources}, feed posts ${r.feedPosts}, found ${r.found}, checked ${r.accepted}, new drafts ${r.stored}, searches ${r.searches}`);
  } catch (e) {
    console.error("[community-news] failed", e);
    await recordCronRun(admin, JOB, false, e instanceof Error ? e.message : String(e));
  }
  await checkAndAlertStaleCrons(admin);
};
