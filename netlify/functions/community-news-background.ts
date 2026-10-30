/**
 * Background function ("-background" = Netlify's 15-minute limit): finds news
 * for revamp.community hosts with AI web search and stores them as drafts for
 * an admin to review (server/communityNews.ts). Invoked twice a week by
 * community-news.ts and by admins via POST /api/admin-community/find-news —
 * both send the derived token; anything else is ignored. Records a heartbeat.
 * With `x-community-mode: rewrite` and a JSON body {ids} it instead rewrites
 * those stories from their articles (Admin → "Write detailed version") — no
 * search, no heartbeat. With `x-community-mode: photos` it only looks for
 * pictures for stories that have none (no model calls).
 */
import { supabaseAdmin, adminConfigured } from "../../server/supabaseAdmin.js";
import { communityNewsToken, findCommunityNews, findStoryPhotos, rewriteStories } from "../../server/communityNews.js";
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
  if (req.headers.get("x-community-mode") === "photos") {
    try {
      console.log("[community-news] photos", JSON.stringify(await findStoryPhotos(admin)));
    } catch (e) {
      console.error("[community-news] photos failed", e);
    }
    return;
  }
  if (req.headers.get("x-community-mode") === "rewrite") {
    try {
      const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      if (ids.length) console.log("[community-news] rewrite", JSON.stringify(await rewriteStories(admin, ids)));
    } catch (e) {
      console.error("[community-news] rewrite failed", e);
    }
    return;
  }
  try {
    const r = await findCommunityNews(admin);
    console.log("[community-news]", JSON.stringify(r));
    await recordCronRun(admin, JOB, true, `sources ${r.sources}, feed posts ${r.feedPosts}, found ${r.found}, checked ${r.accepted}, left out ${r.skipped}, new drafts ${r.stored}, searches ${r.searches}`);
  } catch (e) {
    console.error("[community-news] failed", e);
    await recordCronRun(admin, JOB, false, e instanceof Error ? e.message : String(e));
  }
  await checkAndAlertStaleCrons(admin);
};
