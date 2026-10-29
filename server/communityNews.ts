/**
 * News & updates for revamp.community (migration 0125, 2026-10-29).
 *
 * Twice a week (netlify/functions/community-news.ts → community-news-background)
 * and on an admin's "Find news now", Claude with the Anthropic web-search tool
 * looks for recent stories hosts in Armenia should know about — travel to
 * Armenia, short-term rentals, booking-site changes, rules & taxes — and writes
 * each as a short summary IN ITS OWN WORDS plus one practical "what it means
 * for you" line. Nothing is published automatically: every item lands as a
 * DRAFT for an admin to check, edit and publish (Admin → Community → News).
 *
 * Evidence rules (no invented news): the source URL must be a page the
 * web-search API itself returned during this run (not a model-written link),
 * the story must be dated within the last NEWS_MAX_AGE_DAYS, and an item whose
 * source or headline we already have is skipped. Summaries never quote more
 * than a few words of the source (copyright) — the source is always linked.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NEWS_CATEGORIES, newsSlug, type NewsCategory } from "../shared/community.js";
import { parseEventsJson, titleOverlap } from "./events.js";

const NEWS_MAX_AGE_DAYS = 21;
const MAX_ITEMS_PER_RUN = 12;

export interface FoundNews {
  category: NewsCategory;
  title: string;
  summary: string;
  for_you: string;
  source_url: string;
  source_name: string;
  story_date: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

const PROMPT = (today: string, since: string) => `Today is ${today}. You help run a community for people who host short-term rentals (apartments, guest houses, small hotels), tours and experiences in Armenia.

Using web search, find NEWS published between ${since} and ${today} that these hosts should know about. Cover these four areas:
${NEWS_CATEGORIES.map((c) => `- "${c.key}": ${c.searchHint}`).join("\n")}

How to search: use English, Russian and Armenian. Prefer official sources (company newsrooms, help-centre announcements, government sites) and reputable trade or news media (e.g. Skift, PhocusWire, Short Term Rentalz, Armenian news agencies). Aim for 6–12 stories in total, at least one per area when there is real news.

Rules:
- Only real, dated news from that window. Skip opinion pieces, ads, listicles, rumours and anything without a clear date.
- source_url must be a page from your search results that reports the story. Never invent or guess a URL.
- Write title, summary and for_you in plain English, in YOUR OWN WORDS — never copy sentences from the source. No hype, no exclamation marks, no claims the source doesn't make.
- summary: 2–3 short sentences — what changed, from when, who it affects. Max 450 characters.
- for_you: one practical sentence for a host in Armenia (what to check or do). Max 200 characters. If there is nothing practical, say what to watch for.
- Never mention Revamp.

When you are done searching, reply with ONLY a JSON array (no prose, no markdown) of objects:
{"category": "travel"|"rentals"|"booking_sites"|"rules", "title": string (max 110 chars), "summary": string, "for_you": string, "source_url": string, "source_name": string (publication name), "story_date": "YYYY-MM-DD"}`;

/** Ask Claude (with web search) for recent host news; returns raw candidates + the URLs search really returned. */
async function searchNews(today: string, since: string): Promise<{ items: FoundNews[]; hitUrls: Set<string>; searches: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });
  const budget = Math.max(1, Number(process.env.COMMUNITY_NEWS_SEARCHES || 10));
  const model = process.env.COMMUNITY_NEWS_MODEL || process.env.EVENTS_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  // The SDK pinned here predates the web-search tool types; the API accepts it as-is.
  const tools = (maxUses: number) => [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }] as unknown as Anthropic.Tool[];
  const searchesIn = (m: Anthropic.Message) => Number((m.usage as unknown as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0);
  const hitUrls = new Set<string>();
  const collect = (m: Anthropic.Message) => {
    for (const b of m.content as unknown as { type: string; content?: unknown }[]) {
      if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
      for (const r of b.content as { url?: string }[]) if (r.url) hitUrls.add(normUrl(r.url));
    }
  };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: PROMPT(today, since) }];
  let used = 0;
  let msg = await client.messages.create({ model, max_tokens: 12000, tools: tools(budget), messages });
  used += searchesIn(msg);
  collect(msg);
  // A long search turn can pause: send it back unchanged so it continues (few rounds, within budget).
  for (let round = 0; (msg.stop_reason as string) === "pause_turn" && round < 4 && used < budget; round++) {
    messages.push({ role: "assistant", content: msg.content as Anthropic.MessageParam["content"] });
    msg = await client.messages.create({ model, max_tokens: 12000, tools: tools(budget - used), messages });
    used += searchesIn(msg);
    collect(msg);
  }
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const items = parseEventsJson(text) as unknown as FoundNews[];
  console.log(`[community-news] searches ${used}/${budget}; search results ${hitUrls.size}; items in reply ${items.length}; stop ${msg.stop_reason}`);
  return { items, hitUrls, searches: used };
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Keep only well-formed, recent, evidenced items (pure — exported for tests). */
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
    if (!hitUrls.has(normUrl(url))) continue; // only pages search really returned
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

/** One run: search, check, and store new drafts. */
export async function findCommunityNews(admin: SupabaseClient, now = new Date()): Promise<{ found: number; accepted: number; stored: number; searches: number }> {
  const today = isoDay(now);
  const since = isoDay(new Date(now.getTime() - NEWS_MAX_AGE_DAYS * 86_400_000));
  const { items, hitUrls, searches } = await searchNews(today, since);
  const accepted = acceptNews(items, hitUrls, today, since);

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
  return { found: items.length, accepted: accepted.length, stored, searches };
}

/** Shared secret for invoking the background finder (derived — no extra env var). */
export async function communityNewsToken(): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const data = new TextEncoder().encode(`community-news:${key}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
