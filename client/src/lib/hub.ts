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
  const { data, error } = await supabase.from("hub_articles").select(COLS).order("updated_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map(mapRow);
}

export async function createHubArticle(input: HubArticleInput): Promise<void> {
  const { error } = await supabase.from("hub_articles").insert(toRow(input));
  if (error) throw new Error(error.message);
}

export async function updateHubArticle(id: string, input: HubArticleInput, existingPublishedAt: string | null): Promise<void> {
  const row = toRow(input);
  if (input.status === "published" && existingPublishedAt) row.published_at = existingPublishedAt;
  const { error } = await supabase.from("hub_articles").update(row).eq("id", id);
  if (error) throw new Error(error.message);
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
    published_at: input.status === "published" ? new Date().toISOString() : null,
  } as Record<string, unknown>;
}
