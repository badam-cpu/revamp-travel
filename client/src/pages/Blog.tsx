/**
 * Public blog index (/blog) — lists published posts. Reads Supabase `posts`
 * (RLS returns only published rows to the public). SEO via useDocumentMeta +
 * shared/seo.ts; non-JS crawlers get the same content from server/prerender.ts.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { buildBlogListJsonLd } from "@shared/seo";
import { listPublishedPosts, type Post } from "@/lib/blog";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function Blog() {
  const [posts, setPosts] = useState<Post[] | null>(null);

  useDocumentMeta({
    title: "The Revamp Journal | Revamp Vacations",
    description: "Stories, guides, and field notes from across Armenia — from the Revamp Vacations team.",
    canonicalPath: "/blog",
    jsonLd: buildBlogListJsonLd(typeof window !== "undefined" ? window.location.origin : "", posts ?? []),
  });

  useEffect(() => {
    listPublishedPosts().then(setPosts).catch(() => setPosts([]));
  }, []);

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-12 lg:py-16">
        <p className="eyebrow">The Revamp Journal</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Field notes from Armenia.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-basalt/60">
          Stories, guides, and slow-travel ideas from the people building Revamp.
        </p>

        {posts === null ? (
          <p className="mt-10 text-sm text-basalt/50">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="mt-10 border border-dashed border-basalt/20 bg-chalk px-6 py-12 text-center text-sm text-basalt/55">No posts yet — check back soon.</p>
        ) : (
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <Link key={p.id} href={`/blog/${p.slug}`} className="group block">
                <article className="flex h-full flex-col">
                  <div className="aspect-[16/10] w-full overflow-hidden rounded-[14px] bg-chalk">
                    {p.coverImage && <img src={p.coverImage} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />}
                  </div>
                  {p.tags[0] && <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-apricot">{p.tags[0]}</p>}
                  <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.02em] group-hover:text-apricot">{p.title}</h2>
                  {p.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-6 text-basalt/60">{p.excerpt}</p>}
                  <p className="mt-3 text-xs text-basalt/45">{formatDate(p.publishedAt)}</p>
                </article>
              </Link>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
