/**
 * News & updates for revamp.community (migrations 0125 + 0126, 2026-10-29).
 *
 * Twice a week (netlify/functions/community-news.ts → community-news-background)
 * and on an admin's "Find news now", Aha AI looks for recent stories hosts in
 * Armenia should know about and writes each as a short summary IN ITS OWN WORDS
 * plus one practical "what it means for you" line. Nothing is published
 * automatically: every item lands as a DRAFT for an admin to check, edit and
 * publish (Admin → Community → News), and admins get an email/Telegram note.
 *
 * Where it looks (0126 — the admin's trusted list, Admin → Community → Sources):
 *  1. Sources with a feed (RSS/Atom): the feed is read directly (one plain GET,
 *     public address only) and Claude picks + summarises the relevant posts —
 *     no web search, and every link comes from the feed itself.
 *  2. Sources without one (no feed, or the site blocks automated readers — we
 *     never try to get around that): a web search limited to those sites.
 *  3. Unless switched off (community_settings.news_wider_search): a short open
 *     web search for what the list doesn't cover — travel to Armenia, Armenian
 *     rules & taxes, major booking-site changes.
 *
 * Evidence rules (no invented news): a story's link must be a feed item or a
 * page the web-search API itself returned during this run (never a
 * model-written link), dated within the last NEWS_MAX_AGE_DAYS, and not one we
 * already have. Summaries never copy the source (copyright) — it's linked.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NEWS_CATEGORIES, newsSlug, type NewsCategory } from "../shared/community.js";
import { parseEventsJson, titleOverlap } from "./events.js";
import { assertSafeUrl } from "./urlPrefill.js";
import { resolveAdminEmails } from "./alerts.js";
import { sendCommunityNewsAlert } from "./email.js";
import { sendTelegram } from "./telegram.js";

const NEWS_MAX_AGE_DAYS = 21;
const MAX_ITEMS_PER_RUN = 15;
const FEED_ITEMS_PER_SOURCE = 8;
const FEED_RECHECK_DAYS = 30;

export interface FoundNews {
  category: NewsCategory;
  title: string;
  summary: string;
  for_you: string;
  source_url: string;
  source_name: string;
  story_date: string;
}

export interface NewsSource {
  id: string;
  name: string;
  site_url: string;
  feed_url: string | null;
  feed_status: "unchecked" | "ok" | "none" | "error";
  feed_checked_at: string | null;
  active: boolean;
}

interface FeedItem {
  title: string;
  link: string;
  date: string; // YYYY-MM-DD
  text: string;
  source: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const model = () => process.env.COMMUNITY_NEWS_MODEL || process.env.EVENTS_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

/* ── Feeds ─────────────────────────────────────────────────────────────── */

const UA = "Mozilla/5.0 (compatible; RevampVacationsBot/1.0; +https://revampvacations.com) community news reader";

/** One plain GET of a public page or feed (SSRF-guarded, 10 s, first 2 MB). Never retries around a block. */
async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string; url: string }> {
  const safe = await assertSafeUrl(url);
  const res = await fetch(safe.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
    headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" },
  });
  if (!res.body) return { ok: res.ok, status: res.status, text: "", url: res.url };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      break;
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  return { ok: res.ok, status: res.status, text, url: res.url || url };
}

const looksLikeFeed = (t: string) => /<(rss|feed|rdf:RDF)[\s>]/i.test(t.slice(0, 4000));

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "—")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};

/** RSS 2.0 / RDF / Atom items (pure — exported for tests). */
export function parseFeed(xml: string, sourceName: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = decode(tag(b, "title"));
    let link = decode(tag(b, "link"));
    if (!/^https?:\/\//.test(link)) {
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ?? b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = alt ? alt[1].replace(/&amp;/g, "&") : "";
    }
    const rawDate = decode(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const t = Date.parse(rawDate);
    const text = decode(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 500);
    if (!title || !/^https:\/\//.test(link) || Number.isNaN(t)) continue;
    out.push({ title: title.slice(0, 200), link, date: isoDay(new Date(t)), text, source: sourceName });
  }
  return out;
}

/** Find a site's feed: its own <link rel="alternate"> first, then the usual paths. */
export async function discoverFeed(siteUrl: string): Promise<{ feedUrl: string | null; error: string | null }> {
  let page: Awaited<ReturnType<typeof fetchText>>;
  try {
    page = await fetchText(siteUrl);
  } catch (e) {
    return { feedUrl: null, error: e instanceof Error ? e.message.slice(0, 120) : "unreachable" };
  }
  if (page.status === 401 || page.status === 403 || page.status === 429) return { feedUrl: null, error: "The site blocks automated readers — searched instead" };
  if (looksLikeFeed(page.text)) return { feedUrl: page.url, error: null };
  const candidates: string[] = [];
  for (const m of Array.from(page.text.matchAll(/<link[^>]+>/gi))) {
    if (!/application\/(rss|atom)\+xml/i.test(m[0])) continue;
    const h = m[0].match(/href=["']([^"']+)["']/i);
    if (h && !/comments/i.test(h[1])) {
      try {
        candidates.push(new URL(h[1].replace(/&amp;/g, "&"), page.url).toString());
      } catch {
        /* skip */
      }
    }
  }
  const base = new URL(siteUrl);
  const path = base.pathname.replace(/\/+$/, "");
  for (const p of [`${path}/feed/`, "/feed/", "/rss", "/rss.xml", "/feed.xml", "/atom.xml"]) candidates.push(`${base.origin}${p.replace(/^\/\//, "/")}`);
  for (const c of Array.from(new Set(candidates)).slice(0, 8)) {
    try {
      const r = await fetchText(c);
      if (r.ok && looksLikeFeed(r.text)) return { feedUrl: c, error: null };
    } catch {
      /* next */
    }
  }
  return { feedUrl: null, error: null };
}

/** Find (or re-check monthly) a source's feed and remember it. */
async function ensureFeed(admin: SupabaseClient, s: NewsSource): Promise<NewsSource> {
  if (s.feed_url) return s;
  const fresh = s.feed_checked_at && Date.now() - Date.parse(s.feed_checked_at) < FEED_RECHECK_DAYS * 86_400_000;
  if (fresh) return s;
  const { feedUrl, error } = await discoverFeed(s.site_url);
  const patch = { feed_url: feedUrl, feed_status: feedUrl ? "ok" : error && !/blocks/.test(error) ? "error" : "none", feed_checked_at: new Date().toISOString(), last_error: error } as const;
  await admin.from("community_news_sources").update(patch).eq("id", s.id);
  return { ...s, ...patch };
}

/** Recent posts from every source that has a feed (missing feeds are discovered first). */
async function readFeeds(admin: SupabaseClient, sources: NewsSource[], since: string): Promise<{ items: FeedItem[]; noFeed: NewsSource[] }> {
  const items: FeedItem[] = [];
  const noFeed: NewsSource[] = [];
  const ready: NewsSource[] = [];
  for (const s of sources) {
    try {
      const r = await ensureFeed(admin, s);
      if (r.feed_url) ready.push(r);
      else noFeed.push(r);
    } catch (e) {
      console.error("[community-news] feed discovery", s.name, e);
      noFeed.push(s);
    }
  }
  // Five at a time — polite to the sites and well inside the function's time limit.
  for (let i = 0; i < ready.length; i += 5) {
    await Promise.all(
      ready.slice(i, i + 5).map(async (s) => {
        try {
          const r = await fetchText(s.feed_url!);
          if (!r.ok || !looksLikeFeed(r.text)) throw new Error(`feed answered ${r.status}`);
          const all = parseFeed(r.text, s.name);
          const recent = all.filter((x) => x.date >= since).slice(0, FEED_ITEMS_PER_SOURCE);
          items.push(...recent);
          const newest = all.reduce<string | null>((m, x) => (!m || x.date > m ? x.date : m), null);
          await admin.from("community_news_sources").update({ feed_status: "ok", last_error: null, ...(newest ? { last_item_at: `${newest}T00:00:00Z` } : {}) }).eq("id", s.id);
        } catch (e) {
          const msg = e instanceof Error ? e.message.slice(0, 200) : "feed failed";
          await admin.from("community_news_sources").update({ feed_status: "error", last_error: msg }).eq("id", s.id);
          noFeed.push(s); // fall back to a site search this run
        }
      }),
    );
  }
  return { items, noFeed };
}

/* ── Writing ───────────────────────────────────────────────────────────── */

const WRITING_RULES = `Write title, summary and for_you in plain English, in YOUR OWN WORDS — never copy sentences from the source. No hype, no exclamation marks, no claims the source doesn't make. Never mention Revamp.
- title: max 110 characters.
- summary: 2–3 short sentences — what changed, from when, who it affects. Max 450 characters.
- for_you: one practical sentence for a host in Armenia (what to check or do). Max 200 characters. If there is nothing practical, say what to watch for.
- category: "travel" (travel to Armenia / the region, flights, visas, tourism demand), "rentals" (short-term rental & hospitality industry), "booking_sites" (Airbnb, Booking.com, Expedia/Vrbo, GetYourGuide… changes for hosts), "rules" (rules, registration, tax).`;

/** Claude picks the posts that matter to hosts in Armenia and writes them up (no tools; links come from the feeds). */
async function writeFromFeeds(client: Anthropic, items: FeedItem[], today: string): Promise<FoundNews[]> {
  if (!items.length) return [];
  const list = items.map((x, i) => `[${i}] ${x.date} · ${x.source} · ${x.title}${x.text ? ` — ${x.text.slice(0, 280)}` : ""}`).join("\n");
  const prompt = `Today is ${today}. You help run a community for people who host short-term rentals (apartments, guest houses, small hotels), tours and experiences in Armenia.

Below are recent posts from trusted industry sources. Pick the ones those hosts would genuinely want to know about: changes on booking sites, rules and taxes, guest and demand trends, pricing, operations and technology that applies to small hosts, and anything about travel to Armenia or the region. Skip press releases about single hotels or chains, funding rounds, executive moves, webinars, sponsored posts and opinion pieces. Pick at most 10; if two posts cover the same news, pick one.

${WRITING_RULES}

POSTS:
${list}

Reply with ONLY a JSON array (no prose, no markdown) of objects:
{"i": number (the post's number), "category": "travel"|"rentals"|"booking_sites"|"rules", "title": string, "summary": string, "for_you": string}`;
  const msg = await client.messages.create({ model: model(), max_tokens: 6000, messages: [{ role: "user", content: prompt }] });
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const picked = parseEventsJson(text) as unknown as { i: number; category: NewsCategory; title: string; summary: string; for_you: string }[];
  const out: FoundNews[] = [];
  for (const p of picked) {
    const src = Number.isInteger(p?.i) ? items[p.i] : undefined;
    if (!src) continue; // only posts we actually read
    out.push({ category: p.category, title: p.title, summary: p.summary, for_you: p.for_you, source_url: src.link, source_name: src.source, story_date: src.date });
  }
  console.log(`[community-news] feed posts ${items.length}; picked ${out.length}`);
  return out;
}

/** Web search (optionally limited to some sites); returns candidates + the URLs search really returned. */
async function searchNews(
  client: Anthropic,
  today: string,
  since: string,
  opts: { budget: number; allowedDomains?: string[]; focus: string },
): Promise<{ items: FoundNews[]; hitUrls: Set<string>; searches: number }> {
  const prompt = `Today is ${today}. You help run a community for people who host short-term rentals (apartments, guest houses, small hotels), tours and experiences in Armenia.

Using web search, find NEWS published between ${since} and ${today} that these hosts should know about. ${opts.focus}

Topics:
${NEWS_CATEGORIES.map((c) => `- "${c.key}": ${c.searchHint}`).join("\n")}

Rules:
- Only real, dated news from that window. Skip opinion pieces, ads, listicles, rumours and anything without a clear date.
- source_url must be a page from your search results that reports the story. Never invent or guess a URL.
${WRITING_RULES}

When you are done searching, reply with ONLY a JSON array (no prose, no markdown) of objects:
{"category": "travel"|"rentals"|"booking_sites"|"rules", "title": string, "summary": string, "for_you": string, "source_url": string, "source_name": string (publication name), "story_date": "YYYY-MM-DD"}`;
  // The SDK pinned here predates the web-search tool types; the API accepts it as-is.
  const tools = (maxUses: number) =>
    [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses, ...(opts.allowedDomains?.length ? { allowed_domains: opts.allowedDomains } : {}) }] as unknown as Anthropic.Tool[];
  const searchesIn = (m: Anthropic.Message) => Number((m.usage as unknown as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0);
  const hitUrls = new Set<string>();
  const collect = (m: Anthropic.Message) => {
    for (const b of m.content as unknown as { type: string; content?: unknown }[]) {
      if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
      for (const r of b.content as { url?: string }[]) if (r.url) hitUrls.add(normUrl(r.url));
    }
  };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let used = 0;
  let msg = await client.messages.create({ model: model(), max_tokens: 12000, tools: tools(opts.budget), messages });
  used += searchesIn(msg);
  collect(msg);
  // A long search turn can pause: send it back unchanged so it continues (few rounds, within budget).
  for (let round = 0; (msg.stop_reason as string) === "pause_turn" && round < 4 && used < opts.budget; round++) {
    messages.push({ role: "assistant", content: msg.content as Anthropic.MessageParam["content"] });
    msg = await client.messages.create({ model: model(), max_tokens: 12000, tools: tools(opts.budget - used), messages });
    used += searchesIn(msg);
    collect(msg);
  }
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const items = parseEventsJson(text) as unknown as FoundNews[];
  console.log(`[community-news] search${opts.allowedDomains ? ` (${opts.allowedDomains.length} sites)` : ""}: ${used}/${opts.budget} searches; ${hitUrls.size} results; ${items.length} items`);
  return { items, hitUrls, searches: used };
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Keep only well-formed, recent, evidenced, non-duplicate items (pure — exported for tests). */
export function acceptNews(raw: FoundNews[], hitUrls: Set<string>, today: string, since: string): FoundNews[] {
  const cats = new Set(NEWS_CATEGORIES.map((c) => c.key));
  const out: FoundNews[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const category = r.category as NewsCategory;
    const title = clean(r.title, 160);
    const url = clean(r.source_url, 600);
    const date = clean(r.story_date, 10);
    if (!cats.has(category) || title.length < 5 || !/^https:\/\//.test(url)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < since || date > today) continue;
    if (!hitUrls.has(normUrl(url))) continue; // only feed posts or pages search really returned
    if (out.some((o) => normUrl(o.source_url) === normUrl(url) || titleOverlap(o.title, title) >= 0.7)) continue;
    out.push({
      category,
      title,
      summary: clean(r.summary, 900),
      for_you: clean(r.for_you, 400),
      source_url: url,
      source_name: clean(r.source_name, 120),
      story_date: date,
    });
  }
  return out.slice(0, MAX_ITEMS_PER_RUN);
}

/* ── One run ───────────────────────────────────────────────────────────── */

export interface NewsRunResult {
  sources: number;
  feedPosts: number;
  found: number;
  accepted: number;
  stored: number;
  searches: number;
}

export async function findCommunityNews(admin: SupabaseClient, now = new Date()): Promise<NewsRunResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });
  const today = isoDay(now);
  const since = isoDay(new Date(now.getTime() - NEWS_MAX_AGE_DAYS * 86_400_000));

  const [{ data: srcRows }, { data: settings }] = await Promise.all([
    admin.from("community_news_sources").select("id, name, site_url, feed_url, feed_status, feed_checked_at, active").eq("active", true).order("sort"),
    admin.from("community_settings").select("news_wider_search").eq("id", 1).maybeSingle(),
  ]);
  const sources = (srcRows ?? []) as NewsSource[];
  const wider = (settings as { news_wider_search?: boolean } | null)?.news_wider_search ?? true;

  const candidates: FoundNews[] = [];
  const evidence = new Set<string>();
  let searches = 0;

  // 1. Feeds.
  const { items: feedItems, noFeed } = await readFeeds(admin, sources, since);
  for (const x of feedItems) evidence.add(normUrl(x.link));
  try {
    candidates.push(...(await writeFromFeeds(client, feedItems, today)));
  } catch (e) {
    console.error("[community-news] writing from feeds failed", e);
  }

  // 2. Sources without a feed: search only those sites.
  const domains = Array.from(new Set(noFeed.map((s) => hostOf(s.site_url)).filter(Boolean))).slice(0, 25);
  if (domains.length) {
    try {
      const r = await searchNews(client, today, since, {
        budget: Math.max(1, Number(process.env.COMMUNITY_NEWS_SOURCE_SEARCHES || 5)),
        allowedDomains: domains,
        focus: "Search only the trusted sites you are given — their newsrooms, blogs and news sections.",
      });
      searches += r.searches;
      r.hitUrls.forEach((u) => evidence.add(u));
      candidates.push(...r.items);
    } catch (e) {
      console.error("[community-news] source search failed", e);
    }
  }

  // 3. A short open search for what the list doesn't cover.
  if (wider) {
    try {
      const r = await searchNews(client, today, since, {
        budget: Math.max(1, Number(process.env.COMMUNITY_NEWS_SEARCHES || 5)),
        focus:
          "Our trusted industry sources are read separately, so focus on what they miss: travel to Armenia (flights to Yerevan, visas and entry, visitor numbers, big events, roads and borders), Armenian rules, registration and tax for tourism and rentals, and major changes on booking sites. Use English, Russian and Armenian; prefer official sources and Armenian news agencies.",
      });
      searches += r.searches;
      r.hitUrls.forEach((u) => evidence.add(u));
      candidates.push(...r.items);
    } catch (e) {
      console.error("[community-news] wider search failed", e);
    }
  }

  const accepted = acceptNews(candidates, evidence, today, since);

  // Skip what we already have (any status — a rejected story stays rejected).
  const { data: recent } = await admin
    .from("community_news")
    .select("source_url, title")
    .gte("created_at", new Date(now.getTime() - 90 * 86_400_000).toISOString())
    .limit(1000);
  const have = (recent ?? []) as { source_url: string; title: string }[];
  const fresh = accepted.filter((a) => !have.some((h) => normUrl(h.source_url) === normUrl(a.source_url) || titleOverlap(h.title, a.title) >= 0.7));

  let stored = 0;
  for (const a of fresh) {
    const { error } = await admin.from("community_news").insert({
      slug: newsSlug(a.title, crypto.randomUUID()),
      category: a.category,
      title: a.title,
      summary: a.summary,
      for_you: a.for_you,
      source_url: a.source_url,
      source_name: a.source_name,
      story_date: a.story_date,
      status: "draft",
      origin: "ai",
    });
    if (error) console.error("[community-news] insert", error.message);
    else stored++;
  }
  if (stored > 0) await notifyAdmins(admin, stored, fresh.slice(0, stored).map((f) => f.title));
  return { sources: sources.length, feedPosts: feedItems.length, found: candidates.length, accepted: accepted.length, stored, searches };
}

/** "5 new stories to check" — email every admin, and Telegram admins who linked a chat. Best-effort. */
async function notifyAdmins(admin: SupabaseClient, count: number, titles: string[]): Promise<void> {
  const reviewUrl = `${(process.env.URL || "https://revampvacations.com").replace(/\/+$/, "")}/admin?section=community`;
  try {
    const emails = await resolveAdminEmails(admin);
    await Promise.all(emails.map((to) => sendCommunityNewsAlert(to, { count, titles, reviewUrl })));
  } catch (e) {
    console.error("[community-news] email alert", e);
  }
  try {
    const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
    const ids = ((admins ?? []) as { id: string }[]).map((a) => a.id);
    if (!ids.length) return;
    const { data: links } = await admin.from("telegram_links").select("chat_id").in("user_id", ids).not("chat_id", "is", null);
    const text = `📰 ${count} new ${count === 1 ? "story" : "stories"} for revamp.community to check\n\n${titles.slice(0, 5).map((t) => `• ${t}`).join("\n")}`;
    await Promise.all(((links ?? []) as { chat_id: string }[]).map((l) => sendTelegram(l.chat_id, text, { buttons: [{ text: "Review in Admin", url: reviewUrl }] })));
  } catch (e) {
    console.error("[community-news] telegram alert", e);
  }
}

/** Shared secret for invoking the background finder (derived — no extra env var). */
export async function communityNewsToken(): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const data = new TextEncoder().encode(`community-news:${key}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
