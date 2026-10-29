/**
 * revamp.community → News & updates: the list (/news, category filter) and one
 * story (/news/:slug). Stories are found by Aha AI with web search, then
 * checked and published by an admin (server/communityNews.ts) — each links its
 * source and carries a "What it means for you" line.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { getPublishedNews, listPublishedNews } from "@/lib/community";
import { NEWS_CATEGORIES, formatNewsDate, newsCategoryLabel, sourceLabel, type CommunityNewsItem, type NewsCategory } from "@shared/community";
import { communityNoindex } from "./communityNav";

const PAGE = 20;

export function NewsFilter({ value, onChange }: { value: NewsCategory | null; onChange: (c: NewsCategory | null) => void }) {
  const chip = (active: boolean) =>
    `inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-semibold transition-colors ${active ? "bg-basalt text-paper" : "border border-basalt/15 bg-paper text-basalt hover:border-basalt/40"}`;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter news">
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={chip(value === null)}>
        All
      </button>
      {NEWS_CATEGORIES.map((c) => (
        <button key={c.key} type="button" aria-pressed={value === c.key} onClick={() => onChange(c.key)} className={chip(value === c.key)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

function SourceLink({ item, onDark = false }: { item: CommunityNewsItem; onDark?: boolean }) {
  return (
    <span className={onDark ? "text-paper/65" : "text-basalt/70"}>
      Source:{" "}
      <a href={item.sourceUrl} target="_blank" rel="nofollow noopener noreferrer" className={`inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline ${onDark ? "text-paper" : "text-basalt"}`}>
        {sourceLabel(item)} <ArrowUpRight className="h-3 w-3" />
      </a>
    </span>
  );
}

/** The large dark card for the newest story. */
export function LeadNewsCard({ item }: { item: CommunityNewsItem }) {
  return (
    <article className="flex flex-col gap-4 rounded-[28px] bg-basalt p-6 text-paper sm:p-9">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-bold">
        <span className="rounded-full bg-apricot px-3 py-1.5 text-basalt">{newsCategoryLabel(item.category)}</span>
        <span className="text-paper/65">{formatNewsDate(item.storyDate ?? item.publishedAt)}</span>
      </div>
      <h3 className="font-display text-[1.65rem] font-extrabold leading-tight sm:text-[2rem]">
        <Link href={`/news/${item.slug}`} className="hover:underline hover:decoration-apricot hover:underline-offset-4">{item.title}</Link>
      </h3>
      <p className="text-[17px] leading-relaxed text-paper/80">{item.summary}</p>
      {item.forYou && (
        <div className="rounded-[18px] bg-white/[0.07] px-5 py-4">
          <p className="text-sm font-extrabold text-apricot">What it means for you</p>
          <p className="mt-1 text-base leading-relaxed">{item.forYou}</p>
        </div>
      )}
      <div className="mt-auto flex flex-wrap justify-between gap-3 pt-2 text-sm">
        <SourceLink item={item} onDark />
        <span className="text-paper/55">Summarised by Aha AI · checked by the Revamp team</span>
      </div>
    </article>
  );
}

/** One row in a news list. */
export function NewsRow({ item }: { item: CommunityNewsItem }) {
  return (
    <article className="flex flex-col gap-2 border-t border-basalt/10 py-5">
      <p className="flex flex-wrap gap-x-3 text-sm font-bold text-basalt/70">
        <span>{newsCategoryLabel(item.category)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatNewsDate(item.storyDate ?? item.publishedAt)}</span>
      </p>
      <h3 className="text-xl font-extrabold leading-snug">
        <Link href={`/news/${item.slug}`} className="hover:text-apricot">{item.title}</Link>
      </h3>
      {item.forYou ? (
        <p className="text-[15px] leading-relaxed text-basalt/70"><span className="font-bold text-basalt">For you:</span> {item.forYou}</p>
      ) : (
        <p className="text-[15px] leading-relaxed text-basalt/70">{item.summary}</p>
      )}
      <p className="text-sm"><SourceLink item={item} /></p>
    </article>
  );
}

export default function CommunityNews() {
  const [category, setCategory] = useState<NewsCategory | null>(null);
  const [items, setItems] = useState<CommunityNewsItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useDocumentMeta({
    title: "News for hosts in Armenia — revamp community",
    description: "Travel to Armenia, short-term rentals, booking-site changes, rules and taxes — what changed and what it means for hosts.",
    canonicalPath: "/news",
    noindex: communityNoindex(),
  });

  useEffect(() => {
    let live = true;
    setItems(null);
    setFailed(false);
    listPublishedNews({ category, limit: PAGE })
      .then((r) => {
        if (!live) return;
        setItems(r);
        setMore(r.length === PAGE);
      })
      .catch((e) => {
        console.error("[community/news]", e);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [category]);

  const loadMore = async () => {
    if (!items) return;
    try {
      const r = await listPublishedNews({ category, limit: PAGE, offset: items.length });
      setItems([...items, ...r]);
      setMore(r.length === PAGE);
    } catch (e) {
      console.error("[community/news] more", e);
      setMore(false);
    }
  };

  return (
    <section className="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">News &amp; updates</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-basalt/75">What changed in travel, short-term rentals and on the booking sites, and what it means for you. Every story links its source.</p>
      </div>
      <NewsFilter value={category} onChange={setCategory} />
      {failed ? (
        <p className="rounded-2xl bg-[#FDF1EB] p-6 text-base">The news didn't load. Please refresh the page in a moment.</p>
      ) : items === null ? (
        <div className="space-y-4" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-basalt/[0.05]" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-2xl bg-[#FDF1EB] p-6 text-base">No stories here yet. New ones are added every week.</p>
      ) : (
        <div className="grid gap-x-10 lg:grid-cols-2">
          {items.map((n) => <NewsRow key={n.id} item={n} />)}
        </div>
      )}
      {more && (
        <button type="button" onClick={loadMore} className="self-start rounded-full border-[1.5px] border-basalt px-6 py-3 text-[15px] font-bold">
          Show more
        </button>
      )}
    </section>
  );
}

export function CommunityNewsArticle() {
  const { slug } = useParams<{ slug: string }>();
  const [item, setItem] = useState<CommunityNewsItem | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setItem(undefined);
    getPublishedNews(slug)
      .then((r) => live && setItem(r))
      .catch((e) => {
        console.error("[community/news/article]", e);
        if (live) setItem(null);
      });
    return () => {
      live = false;
    };
  }, [slug]);

  useDocumentMeta({
    title: item ? `${item.title} — revamp community` : "News — revamp community",
    description: item?.summary.slice(0, 160) || "News for hosts in Armenia.",
    canonicalPath: `/news/${slug}`,
    noindex: communityNoindex() || item === null,
    jsonLd: item
      ? { "@context": "https://schema.org", "@type": "NewsArticle", headline: item.title, description: item.summary, ...(item.storyDate ? { datePublished: item.storyDate } : {}), isBasedOn: item.sourceUrl, publisher: { "@type": "Organization", name: "Revamp Hospitality LLC" } }
      : undefined,
  });

  return (
    <section className="mx-auto max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <Link href="/news" className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-basalt/70 hover:text-basalt">
        <ArrowLeft className="h-4 w-4" /> All news
      </Link>
      {item === undefined ? (
        <div className="mt-6 space-y-4" aria-busy="true">
          <div className="h-10 w-3/4 animate-pulse rounded-xl bg-basalt/[0.06]" />
          <div className="h-32 animate-pulse rounded-xl bg-basalt/[0.05]" />
        </div>
      ) : item === null ? (
        <div className="mt-6">
          <h1 className="font-display text-3xl font-extrabold">This story isn't available.</h1>
          <p className="mt-3 text-lg text-basalt/70">It may have been taken down. The latest news is one tap away.</p>
        </div>
      ) : (
        <article className="mt-6 flex flex-col gap-5">
          <p className="flex flex-wrap gap-x-3 text-sm font-bold text-basalt/70">
            <span className="text-apricot">{newsCategoryLabel(item.category)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatNewsDate(item.storyDate ?? item.publishedAt)}</span>
          </p>
          <h1 className="font-display text-[2rem] font-extrabold leading-tight tracking-tight sm:text-[2.6rem]">{item.title}</h1>
          <p className="text-lg leading-relaxed text-basalt/85">{item.summary}</p>
          {item.forYou && (
            <div className="rounded-[20px] bg-[#FDF1EB] px-5 py-4">
              <p className="text-sm font-extrabold">What it means for you</p>
              <p className="mt-1 text-base leading-relaxed">{item.forYou}</p>
            </div>
          )}
          <p className="text-[15px]"><SourceLink item={item} /></p>
          <p className="border-t border-basalt/10 pt-4 text-sm text-basalt/70">Summarised by Aha AI and checked by the Revamp team. For the full story, read the source.</p>
        </article>
      )}
    </section>
  );
}
