/**
 * revamp.community data (migration 0125). Public reads go straight to
 * Supabase under RLS (published news, public guides, meetups, the Telegram
 * link); joining goes through POST /api/community/join (members are never
 * publicly readable). Admin writes (news review, meetups, settings) are
 * admin-RLS writes from Admin → Community.
 */
import { supabase } from "@/lib/supabase";
import { ApiError } from "@/lib/api";
import {
  GUIDE_COLS,
  MEETUP_COLS,
  NEWS_COLS,
  mapGuideRow,
  mapMeetupRow,
  mapNewsRow,
  type CommunityGuide,
  type CommunityMeetup,
  type CommunityNewsItem,
  type NewsCategory,
} from "@shared/community";

export async function listPublishedNews(opts: { category?: NewsCategory | null; limit?: number; offset?: number } = {}): Promise<CommunityNewsItem[]> {
  let q = supabase.from("community_news").select(NEWS_COLS).eq("status", "published").order("published_at", { ascending: false });
  if (opts.category) q = q.eq("category", opts.category);
  const from = opts.offset ?? 0;
  const { data, error } = await q.range(from, from + (opts.limit ?? 20) - 1);
  if (error) throw error;
  return (data ?? []).map(mapNewsRow);
}

export async function getPublishedNews(slug: string): Promise<CommunityNewsItem | null> {
  const { data, error } = await supabase.from("community_news").select(NEWS_COLS).eq("slug", slug).eq("status", "published").maybeSingle();
  if (error) throw error;
  return data ? mapNewsRow(data) : null;
}

export async function listPublicGuides(limit = 50): Promise<CommunityGuide[]> {
  const { data, error } = await supabase
    .from("hub_articles")
    .select(GUIDE_COLS)
    .eq("status", "published")
    .eq("public", true)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapGuideRow);
}

export async function getPublicGuide(slug: string): Promise<CommunityGuide | null> {
  const { data, error } = await supabase.from("hub_articles").select(GUIDE_COLS).eq("slug", slug).eq("status", "published").eq("public", true).maybeSingle();
  if (error) throw error;
  return data ? mapGuideRow(data) : null;
}

export async function listUpcomingMeetups(limit = 6): Promise<CommunityMeetup[]> {
  const { data, error } = await supabase
    .from("community_meetups")
    .select(MEETUP_COLS)
    .eq("status", "published")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapMeetupRow);
}

export async function getCommunityTelegramUrl(): Promise<string | null> {
  const { data } = await supabase.from("community_settings").select("telegram_url").eq("id", 1).maybeSingle();
  return (data as { telegram_url: string | null } | null)?.telegram_url ?? null;
}

export async function joinCommunity(input: { email: string; name?: string; hosts: string; meetupId?: string }): Promise<{ ok: true; seat: boolean }> {
  let res: Response;
  try {
    res = await fetch("/api/community/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  } catch {
    throw new ApiError("We couldn't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error || "We couldn't add you just now. Please try again in a moment.");
  return body;
}

/* ── Admin (RLS: admins only) ─────────────────────────────────────────── */

export async function adminListNews(status: "draft" | "published" | "rejected"): Promise<CommunityNewsItem[]> {
  const { data, error } = await supabase
    .from("community_news")
    .select(NEWS_COLS)
    .eq("status", status)
    .order(status === "published" ? "published_at" : "created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(mapNewsRow);
}

export interface NewsEdit {
  category: NewsCategory;
  title: string;
  summary: string;
  forYou: string;
  keyPoints: string[];
  sourceUrl: string;
  sourceName: string;
  storyDate: string | null;
}

const cleanPoints = (p: string[]) => p.map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean).slice(0, 8);

export async function adminSaveNews(id: string, edit: NewsEdit, status?: "draft" | "published" | "rejected"): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {
    category: edit.category,
    title: edit.title.trim(),
    summary: edit.summary.trim(),
    for_you: edit.forYou.trim(),
    key_points: cleanPoints(edit.keyPoints),
    source_url: edit.sourceUrl.trim(),
    source_name: edit.sourceName.trim(),
    story_date: edit.storyDate || null,
  };
  if (status) {
    row.status = status;
    row.reviewed_by = auth.user?.id ?? null;
    if (status === "published") row.published_at = new Date().toISOString();
  }
  const { error } = await supabase.from("community_news").update(row).eq("id", id);
  if (error) throw error;
}

export async function adminAddNews(edit: NewsEdit, slug: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("community_news").insert({
    slug,
    category: edit.category,
    title: edit.title.trim(),
    summary: edit.summary.trim(),
    for_you: edit.forYou.trim(),
    key_points: cleanPoints(edit.keyPoints),
    source_url: edit.sourceUrl.trim(),
    source_name: edit.sourceName.trim(),
    story_date: edit.storyDate || null,
    status: "draft",
    origin: "admin",
    reviewed_by: auth.user?.id ?? null,
  });
  if (error) throw error;
}

export async function adminDeleteNews(id: string): Promise<void> {
  const { error } = await supabase.from("community_news").delete().eq("id", id);
  if (error) throw error;
}

export async function adminFindNews(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in.");
  const res = await fetch("/api/admin-community/find-news", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error || "Couldn't start the search. Please try again.");
}

/** "Write detailed version": Aha AI rewrites these stories from their articles and checks them (background). */
export async function adminRewriteNews(ids: string[]): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in.");
  const res = await fetch("/api/admin-community/rewrite", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error || "Couldn't start the rewrite. Please try again.");
}

export async function adminListMeetups(): Promise<(CommunityMeetup & { seats: number })[]> {
  const [{ data, error }, { data: rsvps }] = await Promise.all([
    supabase.from("community_meetups").select(MEETUP_COLS).order("starts_at", { ascending: false }).limit(200),
    supabase.from("community_rsvps").select("meetup_id"),
  ]);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of (rsvps ?? []) as { meetup_id: string }[]) counts.set(r.meetup_id, (counts.get(r.meetup_id) ?? 0) + 1);
  return (data ?? []).map((r) => ({ ...mapMeetupRow(r), seats: counts.get((r as { id: string }).id) ?? 0 }));
}

export interface MeetupInput {
  title: string;
  description: string;
  startsAt: string; // ISO
  venue: string;
  city: string;
  online: boolean;
  status: "draft" | "published" | "cancelled";
}

export async function adminSaveMeetup(id: string | null, m: MeetupInput): Promise<void> {
  const row = { title: m.title.trim(), description: m.description.trim(), starts_at: m.startsAt, venue: m.venue.trim(), city: m.city.trim() || "Yerevan", online: m.online, status: m.status };
  const { error } = id ? await supabase.from("community_meetups").update(row).eq("id", id) : await supabase.from("community_meetups").insert(row);
  if (error) throw error;
}

export async function adminDeleteMeetup(id: string): Promise<void> {
  const { error } = await supabase.from("community_meetups").delete().eq("id", id);
  if (error) throw error;
}

export interface CommunityMemberRow {
  id: string;
  email: string;
  name: string | null;
  hosts: string;
  createdAt: string;
  unsubscribedAt: string | null;
  meetups: string[];
}

export async function adminListMembers(): Promise<CommunityMemberRow[]> {
  const [{ data, error }, { data: rsvps }, { data: meetups }] = await Promise.all([
    supabase.from("community_members").select("id, email, name, hosts, created_at, unsubscribed_at").order("created_at", { ascending: false }).limit(5000),
    supabase.from("community_rsvps").select("meetup_id, member_id"),
    supabase.from("community_meetups").select("id, title"),
  ]);
  if (error) throw error;
  const titles = new Map(((meetups ?? []) as { id: string; title: string }[]).map((m) => [m.id, m.title]));
  const byMember = new Map<string, string[]>();
  for (const r of (rsvps ?? []) as { meetup_id: string; member_id: string }[]) {
    const list = byMember.get(r.member_id) ?? [];
    list.push(titles.get(r.meetup_id) ?? "Meetup");
    byMember.set(r.member_id, list);
  }
  return ((data ?? []) as { id: string; email: string; name: string | null; hosts: string; created_at: string; unsubscribed_at: string | null }[]).map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    hosts: r.hosts,
    createdAt: r.created_at,
    unsubscribedAt: r.unsubscribed_at,
    meetups: byMember.get(r.id) ?? [],
  }));
}

export async function adminSaveTelegramUrl(url: string | null): Promise<void> {
  const { error } = await supabase.from("community_settings").update({ telegram_url: url, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw error;
}

/* ── News sources (0126, admin-only) ──────────────────────────────────── */

export interface NewsSourceRow {
  id: string;
  groupLabel: string;
  name: string;
  siteUrl: string;
  feedUrl: string | null;
  feedStatus: "unchecked" | "ok" | "none" | "error";
  lastItemAt: string | null;
  lastError: string | null;
  active: boolean;
  sort: number;
}

export async function adminListSources(): Promise<NewsSourceRow[]> {
  const { data, error } = await supabase
    .from("community_news_sources")
    .select("id, group_label, name, site_url, feed_url, feed_status, last_item_at, last_error, active, sort")
    .order("sort")
    .order("name");
  if (error) throw error;
  return ((data ?? []) as { id: string; group_label: string; name: string; site_url: string; feed_url: string | null; feed_status: NewsSourceRow["feedStatus"]; last_item_at: string | null; last_error: string | null; active: boolean; sort: number }[]).map((r) => ({
    id: r.id,
    groupLabel: r.group_label,
    name: r.name,
    siteUrl: r.site_url,
    feedUrl: r.feed_url,
    feedStatus: r.feed_status,
    lastItemAt: r.last_item_at,
    lastError: r.last_error,
    active: r.active,
    sort: r.sort,
  }));
}

export async function adminSaveSource(id: string | null, s: { groupLabel: string; name: string; siteUrl: string; feedUrl: string | null; active: boolean; sort?: number }): Promise<void> {
  const row: Record<string, unknown> = { group_label: s.groupLabel.trim(), name: s.name.trim(), site_url: s.siteUrl.trim(), active: s.active };
  // A typed feed is trusted as-is; clearing it lets the next run look for one again.
  row.feed_url = s.feedUrl?.trim() || null;
  row.feed_status = s.feedUrl?.trim() ? "ok" : "unchecked";
  row.feed_checked_at = null;
  if (s.sort !== undefined) row.sort = s.sort;
  const { error } = id ? await supabase.from("community_news_sources").update(row).eq("id", id) : await supabase.from("community_news_sources").insert(row);
  if (error) throw error;
}

export async function adminSetSourceActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("community_news_sources").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function adminDeleteSource(id: string): Promise<void> {
  const { error } = await supabase.from("community_news_sources").delete().eq("id", id);
  if (error) throw error;
}

export async function adminCheckSource(id: string): Promise<{ feedUrl: string | null; status: string; note: string | null }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in.");
  const res = await fetch("/api/admin-community/check-source", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error || "Couldn't check that site right now.");
  return body;
}

export async function getNewsWiderSearch(): Promise<boolean> {
  const { data } = await supabase.from("community_settings").select("news_wider_search").eq("id", 1).maybeSingle();
  return (data as { news_wider_search?: boolean } | null)?.news_wider_search ?? true;
}

export async function adminSetNewsWiderSearch(on: boolean): Promise<void> {
  const { error } = await supabase.from("community_settings").update({ news_wider_search: on, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw error;
}
