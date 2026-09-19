/**
 * Public blog post (/blog/:slug). Reads Supabase `posts` (RLS: published for
 * anyone, drafts for admins). Body is Markdown rendered to safe HTML by
 * shared/markdown.ts. SEO via useDocumentMeta + shared/seo.ts; non-JS crawlers
 * get the same content from server/prerender.ts.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { buildArticleJsonLd } from "@shared/seo";
import { renderMarkdown, markdownToPlain } from "@shared/markdown";
import { getPostBySlug, type Post } from "@/lib/blog";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function BlogPost({ params }: { params: { slug: string } }) {
  const [post, setPost] = useState<Post | null | "missing">(null);

  useEffect(() => {
    let active = true;
    getPostBySlug(params.slug)
      .then((p) => active && setPost(p ?? "missing"))
      .catch(() => active && setPost("missing"));
    return () => {
      active = false;
    };
  }, [params.slug]);

  const resolved = post && post !== "missing" ? post : null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  useDocumentMeta({
    title: resolved ? `${resolved.title} | Revamp Vacations` : "Blog | Revamp Vacations",
    description: resolved ? resolved.excerpt || markdownToPlain(resolved.body) : "Read the latest from Revamp Vacations.",
    canonicalPath: `/blog/${params.slug}`,
    ogImage: resolved?.coverImage || undefined,
    jsonLd: resolved ? buildArticleJsonLd(resolved, origin) : undefined,
    noindex: post === "missing",
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-12 lg:py-16">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-semibold text-basalt/55 hover:text-apricot">
          <ArrowLeft className="h-4 w-4" /> The Revamp Journal
        </Link>

        {post === null ? (
          <p className="mt-10 text-sm text-basalt/50">Loading…</p>
        ) : post === "missing" ? (
          <div className="mt-16 text-center">
            <h1 className="font-display text-4xl">Post not found</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-basalt/55">This story may have moved or isn't published yet.</p>
            <Link href="/blog" className="mt-6 inline-flex items-center gap-2 rounded-none bg-apricot px-5 py-3 text-sm font-semibold text-white hover:bg-apricot/90">Back to the blog</Link>
          </div>
        ) : (
          <article className="mx-auto mt-8 max-w-2xl">
            {post.tags[0] && <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-apricot">{post.tags[0]}</p>}
            <h1 className="mt-2 font-display text-4xl leading-[1.02] tracking-[-0.03em] sm:text-5xl">{post.title}</h1>
            {post.publishedAt && <p className="mt-4 text-sm text-basalt/45">{formatDate(post.publishedAt)}</p>}
            {post.coverImage && <img src={post.coverImage} alt="" className="mt-8 aspect-[16/9] w-full rounded-[14px] object-cover" />}
            <div className="prose-blog mt-8 text-[1.05rem] leading-8 text-basalt/85" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }} />
            {post.tags.length > 1 && (
              <div className="mt-10 flex flex-wrap gap-1.5 border-t border-basalt/10 pt-6">
                {post.tags.map((t) => (
                  <span key={t} className="border border-basalt/15 px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] text-basalt/55">{t}</span>
                ))}
              </div>
            )}
          </article>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
