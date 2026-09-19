/**
 * Admin → Blog: author and publish blog posts (see lib/blog.ts and
 * supabase/migrations/0030_posts.sql). Body is Markdown with a live preview
 * rendered by shared/markdown.ts (safe — HTML-escaped first). Admin-only writes
 * are enforced by RLS, not this component.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ExternalLink, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { PhotoUploader, type PhotoUploaderHandle } from "@/components/PhotoUploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { slugify } from "@/lib/slug";
import { renderMarkdown } from "@shared/markdown";
import { createPost, deletePost, listAllPosts, updatePost, type Post, type PostInput } from "@/lib/blog";
import { toast } from "sonner";

const BLANK: PostInput = { slug: "", title: "", excerpt: "", coverImage: "", body: "", tags: [], status: "draft" };

export function AdminBlog() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [editing, setEditing] = useState<Post | "new" | null>(null);

  const load = async () => {
    try {
      setPosts(await listAllPosts());
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't load posts.");
      setPosts([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (editing) {
    return (
      <PostEditor
        post={editing === "new" ? null : editing}
        authorId={user?.id ?? null}
        onDone={() => {
          setEditing(null);
          load();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.03em] sm:text-5xl">Blog.</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-basalt/60">Write and publish posts to revampvacations.com/blog. Drafts stay private until you publish.</p>
        </div>
        <Button onClick={() => setEditing("new")} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
          <Plus className="mr-1.5 h-4 w-4" /> New post
        </Button>
      </div>

      {posts === null ? (
        <p className="text-sm text-basalt/50">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">No posts yet. Write your first one.</p>
      ) : (
        <div className="grid gap-3">
          {posts.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-4 border border-basalt/10 bg-paper p-4">
              {p.coverImage ? <img src={p.coverImage} alt="" className="h-14 w-20 shrink-0 rounded object-cover" /> : <div className="h-14 w-20 shrink-0 rounded bg-chalk" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cnBadge(p.status)}>{p.status === "published" ? "Published" : "Draft"}</span>
                  <p className="truncate font-semibold text-basalt">{p.title || "(untitled)"}</p>
                </div>
                <p className="mt-0.5 truncate text-xs text-basalt/50">/blog/{p.slug}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {p.status === "published" && (
                  <Link href={`/blog/${p.slug}`} className="grid h-9 w-9 place-items-center border border-basalt/15 text-basalt/60 hover:border-apricot hover:text-apricot" title="View">
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
                <button type="button" onClick={() => setEditing(p)} className="grid h-9 w-9 place-items-center border border-basalt/15 text-basalt/60 hover:border-apricot hover:text-apricot" title="Edit">
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Delete "${p.title || "this post"}"? This can't be undone.`)) return;
                    try {
                      await deletePost(p.id);
                      toast("Post deleted.");
                      load();
                    } catch (err) {
                      toast(err instanceof Error ? err.message : "Couldn't delete.");
                    }
                  }}
                  className="grid h-9 w-9 place-items-center border border-basalt/15 text-basalt/60 hover:border-destructive hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function cnBadge(status: Post["status"]): string {
  return status === "published"
    ? "shrink-0 border border-sevan/30 bg-sevan/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-sevan"
    : "shrink-0 border border-basalt/20 bg-basalt/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/50";
}

function PostEditor({ post, authorId, onDone, onCancel }: { post: Post | null; authorId: string | null; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!post);
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [tags, setTags] = useState((post?.tags ?? []).join(", "));
  const [body, setBody] = useState(post?.body ?? "");
  const [status, setStatus] = useState<Post["status"]>(post?.status ?? "draft");
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const coverRef = useRef<PhotoUploaderHandle | null>(null);

  // Auto-derive the slug from the title until the admin edits it by hand.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  const previewHtml = useMemo(() => renderMarkdown(body), [body]);

  const save = async (publish?: boolean) => {
    const nextStatus: Post["status"] = publish === undefined ? status : publish ? "published" : "draft";
    if (!title.trim()) {
      toast("Give the post a title.");
      return;
    }
    const finalSlug = (slug.trim() || slugify(title)).trim();
    if (!finalSlug) {
      toast("Couldn't derive a URL slug — add a title.");
      return;
    }
    setSaving(true);
    try {
      const input: PostInput = {
        slug: finalSlug,
        title: title.trim(),
        excerpt: excerpt.trim(),
        coverImage: coverRef.current?.getValue()[0] ?? post?.coverImage ?? "",
        body,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        status: nextStatus,
      };
      if (post) await updatePost(post.id, input, authorId, post.publishedAt);
      else await createPost(input, authorId);
      toast(nextStatus === "published" ? "Post published." : "Draft saved.");
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save the post.";
      toast(msg.includes("duplicate") || msg.includes("unique") ? "That URL slug is already taken — change it." : msg);
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <button type="button" onClick={onCancel} className="text-sm font-semibold text-basalt/55 hover:text-apricot">← All posts</button>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-none" disabled={saving} onClick={() => save(false)}>Save draft</Button>
          <Button className="rounded-none bg-apricot text-white hover:bg-apricot/90" disabled={saving} onClick={() => save(true)}>{saving ? "Saving…" : "Publish"}</Button>
        </div>
      </div>

      <div className="grid gap-5">
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold text-basalt/60">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A morning on the road to Geghard" className="h-12 rounded-none text-lg" />
        </div>

        <div className="grid gap-1.5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold text-basalt/60">URL slug</Label>
            <Input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} placeholder="morning-road-to-geghard" className="h-11 rounded-none" />
          </div>
          <p className="pb-3 text-xs text-basalt/45">/blog/{slug || "…"}</p>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold text-basalt/60">Excerpt (shown on cards + link previews)</Label>
          <Textarea rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="A short summary…" className="rounded-none text-base" />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold text-basalt/60">Cover image</Label>
          <PhotoUploader ref={coverRef} defaultValue={post?.coverImage ? [post.coverImage] : []} />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold text-basalt/60">Tags (comma-separated)</Label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Yerevan, food, day trips" className="h-11 rounded-none" />
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-basalt/60">Body (Markdown)</Label>
            <button type="button" onClick={() => setShowPreview((s) => !s)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-apricot hover:underline">
              <Eye className="h-3.5 w-3.5" /> {showPreview ? "Hide preview" : "Preview"}
            </button>
          </div>
          <div className={showPreview ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
            <Textarea rows={18} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Write in Markdown.\n\n## A heading\n\n**Bold**, *italic*, [links](https://example.com), lists:\n\n- one\n- two\n\n> A quote"} className="rounded-none font-mono text-sm leading-6" />
            {showPreview && (
              <div className="prose-blog max-h-[28rem] overflow-y-auto border border-basalt/12 bg-paper p-5 text-sm leading-7" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
          </div>
          <p className="text-xs text-basalt/45">Markdown supported: # headings, **bold**, *italic*, `code`, lists, &gt; quotes, [links](url), ![images](url).</p>
        </div>
      </div>
    </div>
  );
}
