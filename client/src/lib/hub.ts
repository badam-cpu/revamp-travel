/**
 * Partner Hub knowledge base (Supabase `hub_articles`, migration 0043). Operator-
 * facing resources: operators + admins read published articles (RLS), admins
 * author. Body is Markdown — render with shared/markdown.ts. The operator AI
 * assistant is grounded in these too (server/operatorAssistant.ts).
 */
import { supabase } from "@/lib/supabase";

export type HubCategory = "listing_quality" | "reviews" | "hosting_standards" | "local_news";

export const HUB_CATEGORIES: { key: HubCategory; label: string; blurb: string }[] = [
  { key: "listing_quality", label: "Listing quality", blurb: "Photos, descriptions, and details that convert." },
  { key: "reviews", label: "Reviews", blurb: "Earning great reviews and handling feedback." },
  { key: "hosting_standards", label: "Hosting standards", blurb: "What Revamp expects from every stay, tour, and experience." },
  { key: "local_news", label: "Local news & updates", blurb: "Platform changes and what's happening in Armenia." },
];

export function hubCategoryLabel(key: string): string {
  return HUB_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export interface HubArticle {
  id: string;
  category: HubCategory;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  status: "draft" | "published";
  pinned: boolean;
  /** Also shown on revamp.community (0125) — public, anyone can read it. */
  public: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HubArticleInput {
  category: HubCategory;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  status: "draft" | "published";
  pinned: boolean;
  public?: boolean;
}

const COLS = "id, category, slug, title, excerpt, body, status, pinned, published_at, created_at, updated_at";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): HubArticle {
  return {
    id: r.id,
    category: r.category,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt ?? "",
    body: r.body ?? "",
    status: r.status,
    pinned: !!r.pinned,
    public: !!r.public,
    publishedAt: r.published_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Published articles (operator + admin), pinned first then newest. */
export async function listHubArticles(): Promise<HubArticle[]> {
  const { data, error } = await supabase
    .from("hub_articles")
    .select(COLS)
    .eq("status", "published")
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false });
  if (error) return [];
  return (data ?? []).map(mapRow);
}

/** Every article regardless of status — admin only (RLS returns [] otherwise). */
export async function listAllHubArticles(): Promise<HubArticle[]> {
  // `public` arrives with migration 0125 — read without it on an older database.
  const withPublic = await supabase.from("hub_articles").select(`${COLS}, public`).order("updated_at", { ascending: false });
  if (!withPublic.error) return (withPublic.data ?? []).map(mapRow);
  const { data, error } = await supabase.from("hub_articles").select(COLS).order("updated_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map(mapRow);
}

/** Retry a write without `public` when the database doesn't have it yet (pre-0125). */
async function writeTolerant(run: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>, row: Record<string, unknown>): Promise<void> {
  let { error } = await run(row);
  if (error && "public" in row && /public/i.test(error.message)) {
    const { public: _drop, ...rest } = row;
    ({ error } = await run(rest));
  }
  if (error) throw new Error(error.message);
}

export async function createHubArticle(input: HubArticleInput): Promise<void> {
  await writeTolerant((row) => supabase.from("hub_articles").insert(row), toRow(input));
}

export async function updateHubArticle(id: string, input: HubArticleInput, existingPublishedAt: string | null): Promise<void> {
  const row = toRow(input);
  if (input.status === "published" && existingPublishedAt) row.published_at = existingPublishedAt;
  await writeTolerant((r) => supabase.from("hub_articles").update(r).eq("id", id), row);
}

export async function deleteHubArticle(id: string): Promise<void> {
  const { error } = await supabase.from("hub_articles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

function toRow(input: HubArticleInput) {
  return {
    category: input.category,
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    body: input.body,
    status: input.status,
    pinned: input.pinned,
    ...(input.public !== undefined ? { public: input.public } : {}),
    published_at: input.status === "published" ? new Date().toISOString() : null,
  } as Record<string, unknown>;
}
