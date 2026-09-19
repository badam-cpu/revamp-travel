/**
 * Blog data access (Supabase `posts`, see supabase/migrations/0030_posts.sql).
 * Public reads are RLS-scoped to published posts; admins read all and are the
 * only ones who can write. Body is Markdown — render with shared/markdown.ts.
 */
import { supabase } from "@/lib/supabase";

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImage: string;
  body: string;
  tags: string[];
  status: "draft" | "published";
  authorId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostInput {
  slug: string;
  title: string;
  excerpt: string;
  coverImage: string;
  body: string;
  tags: string[];
  status: "draft" | "published";
}

const COLS = "id, slug, title, excerpt, cover_image, body, tags, status, author_id, published_at, created_at, updated_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): Post {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt ?? "",
    coverImage: r.cover_image ?? "",
    body: r.body ?? "",
    tags: Array.isArray(r.tags) ? r.tags : [],
    status: r.status,
    authorId: r.author_id ?? null,
    publishedAt: r.published_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Published posts, newest first (public). */
export async function listPublishedPosts(): Promise<Post[]> {
  const { data, error } = await supabase
    .from("posts")
    .select(COLS)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** A single post by slug. Published for anyone; drafts only for admins (RLS). */
export async function getPostBySlug(slug: string): Promise<Post | null> {
  const { data, error } = await supabase.from("posts").select(COLS).eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** Every post regardless of status — admin only (RLS returns [] otherwise). */
export async function listAllPosts(): Promise<Post[]> {
  const { data, error } = await supabase.from("posts").select(COLS).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

function toRow(input: PostInput, authorId: string | null) {
  return {
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    cover_image: input.coverImage,
    body: input.body,
    tags: input.tags,
    status: input.status,
    author_id: authorId,
    // Stamp published_at the first time it goes live; keep it otherwise.
    published_at: input.status === "published" ? new Date().toISOString() : null,
  };
}

export async function createPost(input: PostInput, authorId: string | null): Promise<Post> {
  const { data, error } = await supabase.from("posts").insert(toRow(input, authorId)).select(COLS).single();
  if (error) throw error;
  return mapRow(data);
}

export async function updatePost(id: string, input: PostInput, authorId: string | null, existingPublishedAt: string | null): Promise<Post> {
  const row = toRow(input, authorId);
  // Preserve the original publish timestamp when it's already live.
  if (input.status === "published" && existingPublishedAt) row.published_at = existingPublishedAt;
  const { data, error } = await supabase.from("posts").update(row).eq("id", id).select(COLS).single();
  if (error) throw error;
  return mapRow(data);
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) throw error;
}
