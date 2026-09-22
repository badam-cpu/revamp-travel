/**
 * Admin — author Partner Hub knowledge-base articles (hub_articles, 0043).
 * Operator-facing resources: listing quality, reviews, hosting standards, local
 * news. Body is Markdown (rendered with the shared safe renderer on the operator
 * side). Admin-only writes by RLS.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { slugify } from "@/lib/slug";
import { renderMarkdown } from "@shared/markdown";
import { Loader2, Pin } from "lucide-react";
import { listAllHubArticles, createHubArticle, updateHubArticle, deleteHubArticle, HUB_CATEGORIES, hubCategoryLabel, type HubArticle, type HubArticleInput, type HubCategory } from "@/lib/hub";

const BLANK: HubArticleInput = { category: "listing_quality", slug: "", title: "", excerpt: "", body: "", status: "draft", pinned: false };

export function AdminHub() {
  const [items, setItems] = useState<HubArticle[] | null>(null);
  const [editing, setEditing] = useState<HubArticle | "new" | null>(null);

  const load = useCallback(() => listAllHubArticles().then(setItems), []);
  useEffect(() => {
    load();
  }, [load]);

  if (editing) return <Editor existing={editing === "new" ? null : editing} onDone={() => { setEditing(null); load(); }} />;

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Partner Hub</p>
          <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Knowledge base.</h2>
          <p className="mt-2 max-w-xl text-sm text-basalt/55">Articles operators see in their dashboard. The operator AI assistant is grounded in the published ones.</p>
        </div>
        <Button onClick={() => setEditing("new")} className="shrink-0 rounded-none bg-apricot text-white hover:bg-apricot/90">New article</Button>
      </div>

      {items === null ? (
        <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-basalt/50">No articles yet — write your first.</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-basalt/12 bg-paper px-4 py-3">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${a.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{a.status}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-apricot/80">{hubCategoryLabel(a.category)}</span>
              {a.pinned && <Pin className="h-3 w-3 text-basalt/40" />}
              <span className="min-w-0 flex-1 truncate font-semibold text-basalt">{a.title || "(untitled)"}</span>
              <button type="button" onClick={() => setEditing(a)} className="text-xs font-semibold text-basalt/60 hover:text-apricot">Edit</button>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(`Delete "${a.title}"?`)) return;
                  try {
                    await deleteHubArticle(a.id);
                    toast("Article deleted.");
                    load();
                  } catch (e) {
                    toast(e instanceof Error ? e.message : "Couldn't delete.");
                  }
                }}
                className="text-xs font-semibold text-basalt/45 hover:text-destructive"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Editor({ existing, onDone }: { existing: HubArticle | null; onDone: () => void }) {
  const [category, setCategory] = useState<HubCategory>(existing?.category ?? BLANK.category);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!existing);
  const [excerpt, setExcerpt] = useState(existing?.excerpt ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const publishedAt = useRef(existing?.publishedAt ?? null);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  const save = async (status: "draft" | "published") => {
    if (!title.trim()) {
      toast("Give the article a title.");
      return;
    }
    setSaving(true);
    const input: HubArticleInput = { category, slug: (slug.trim() || slugify(title)).trim(), title: title.trim(), excerpt: excerpt.trim(), body, status, pinned };
    try {
      if (existing) await updateHubArticle(existing.id, input, publishedAt.current);
      else await createHubArticle(input);
      toast(status === "published" ? "Published." : "Saved as draft.");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <button type="button" onClick={onDone} className="text-sm font-semibold text-basalt/55 hover:text-apricot">← Back to articles</button>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-1.5">
          <Label className="text-sm font-semibold">Category</Label>
          <select value={category} onChange={(e) => setCategory(e.target.value as HubCategory)} className="h-11 rounded-none border border-basalt/20 bg-paper px-2 text-sm outline-none focus:border-apricot">
            {HUB_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-sm font-semibold">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 5 photos every stay needs" className="h-11 rounded-none" />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-sm font-semibold">Slug</Label>
          <Input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} placeholder="auto-from-title" className="h-11 rounded-none" />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-sm font-semibold">Excerpt <span className="font-normal text-basalt/45">(shown on the card)</span></Label>
          <Textarea rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} className="rounded-none text-base" />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-semibold">Body <span className="font-normal text-basalt/45">(Markdown)</span></Label>
            <div className="inline-flex text-xs font-semibold">
              <button type="button" onClick={() => setPreview(false)} className={`border px-3 py-1 ${!preview ? "border-apricot bg-apricot/5 text-basalt" : "border-basalt/15 text-basalt/55 hover:border-basalt/30"}`}>Write</button>
              <button type="button" onClick={() => setPreview(true)} className={`-ml-px border px-3 py-1 ${preview ? "border-apricot bg-apricot/5 text-basalt" : "border-basalt/15 text-basalt/55 hover:border-basalt/30"}`}>Preview</button>
            </div>
          </div>
          {preview ? (
            body.trim() ? (
              <div className="prose-blog min-h-[20rem] border border-basalt/15 bg-paper p-5 text-[1.02rem] leading-8 text-basalt/85" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
            ) : (
              <p className="min-h-[20rem] border border-dashed border-basalt/20 bg-chalk/40 p-5 text-sm text-basalt/50">Nothing to preview yet.</p>
            )
          ) : (
            <Textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-none font-mono text-sm" />
          )}
          <p className="text-xs text-basalt/45">Use <code className="bg-basalt/[0.06] px-1">## Heading</code> for section titles and <code className="bg-basalt/[0.06] px-1">- item</code> for bullet lists. Paste the <strong>raw</strong> Markdown, not copied-and-formatted text, or headings and bullets flatten into plain paragraphs. Check <strong>Preview</strong> before publishing.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 accent-apricot" /> Pin to the top
        </label>
        <div className="flex items-center gap-3 border-t border-basalt/10 pt-4">
          <Button onClick={() => save("published")} disabled={saving} className="rounded-none bg-apricot text-white hover:bg-apricot/90">{saving ? "Saving…" : "Publish"}</Button>
          <Button onClick={() => save("draft")} disabled={saving} variant="outline" className="rounded-none border-basalt/20">Save as draft</Button>
        </div>
      </div>
    </div>
  );
}
