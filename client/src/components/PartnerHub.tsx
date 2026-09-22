/**
 * Partner Hub — the operator-facing knowledge base (in /dashboard). Lists
 * published hub_articles (RLS-scoped to operators/admins), filterable by
 * category, with a reading pane rendering the article Markdown via the shared
 * safe renderer. The dashboard AI assistant is grounded in the same articles.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { Loader2, Pin, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@shared/markdown";
import { listHubArticles, HUB_CATEGORIES, hubCategoryLabel, type HubArticle, type HubCategory } from "@/lib/hub";

export function PartnerHub() {
  const [articles, setArticles] = useState<HubArticle[] | null>(null);
  const [cat, setCat] = useState<HubCategory | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const search = useSearch();

  useEffect(() => {
    listHubArticles().then(setArticles);
  }, []);

  // Deep link from the Aha assistant / a shared URL: ?section=hub&article=<slug>
  useEffect(() => {
    if (!articles) return;
    const slug = new URLSearchParams(search).get("article");
    if (!slug) return;
    const a = articles.find((x) => x.slug === slug);
    if (a) setOpenId(a.id);
  }, [articles, search]);

  const filtered = useMemo(() => (articles ?? []).filter((a) => cat === "all" || a.category === cat), [articles, cat]);
  const open = articles?.find((a) => a.id === openId) ?? null;

  if (articles === null) {
    return (
      <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
    );
  }

  // Reading view
  if (open) {
    return (
      <article className="max-w-3xl">
        <button type="button" onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-basalt/55 hover:text-apricot">
          <ArrowLeft className="h-4 w-4" /> Back to Partner Hub
        </button>
        <p className="eyebrow mt-6">{hubCategoryLabel(open.category)}</p>
        <h1 className="mt-2 font-display text-4xl leading-tight tracking-[-0.03em]">{open.title}</h1>
        <div className="prose-blog mt-6 text-[1.02rem] leading-8 text-basalt/85" dangerouslySetInnerHTML={{ __html: renderMarkdown(open.body) }} />
      </article>
    );
  }

  // Index view
  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">Partner Hub</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Resources for hosts.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Guides on listing quality, reviews, hosting standards, and the latest updates. Your dashboard assistant can answer questions from these too.</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <button type="button" onClick={() => setCat("all")} className={cn("rounded-none border px-3.5 py-1.5 text-sm font-semibold transition-colors", cat === "all" ? "border-apricot bg-apricot/5 text-basalt" : "border-basalt/15 text-basalt/60 hover:border-basalt/30")}>
          All
        </button>
        {HUB_CATEGORIES.map((c) => (
          <button key={c.key} type="button" onClick={() => setCat(c.key)} className={cn("rounded-none border px-3.5 py-1.5 text-sm font-semibold transition-colors", cat === c.key ? "border-apricot bg-apricot/5 text-basalt" : "border-basalt/15 text-basalt/60 hover:border-basalt/30")}>
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-none border border-dashed border-basalt/20 bg-chalk/40 px-6 py-12 text-center">
          <p className="font-display text-xl">Nothing here yet</p>
          <p className="mt-2 text-sm text-basalt/55">{cat === "all" ? "Articles will appear as the Revamp team publishes them." : `No ${hubCategoryLabel(cat).toLowerCase()} articles yet.`}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setOpenId(a.id)} className="flex h-full w-full flex-col border border-basalt/12 bg-paper p-5 text-left transition-colors hover:border-apricot/50">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-apricot/80">{hubCategoryLabel(a.category)}</span>
                  {a.pinned && <Pin className="h-3 w-3 text-basalt/40" />}
                </div>
                <p className="mt-2 font-display text-lg leading-snug">{a.title}</p>
                {a.excerpt && <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-basalt/55">{a.excerpt}</p>}
                <span className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-apricot">Read →</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
