/**
 * revamp.community → News & updates: the list (/news, category filter) and one
 * story (/news/:slug). Stories are found by Aha AI from the admin's sources,
 * written from the article and checked against it, then reviewed and
 * published by an admin (server/communityNews.ts) — each links its source and
 * carries key points and a "What it means for you" line.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { getPublishedNews, listPublishedNews } from "@/lib/community";
import { COMMUNITY_ORIGIN, NEWS_CATEGORIES, formatNewsDate, newsArt, sourceLabel, type CommunityNewsItem, type NewsCategory } from "@shared/community";
import { communityNoindex } from "./communityNav";
import { useCommunityLang } from "./communityLang";

const PAGE = 20;

export function NewsFilter({ value, onChange }: { value: NewsCategory | null; onChange: (c: NewsCategory | null) => void }) {
  const { t } = useCommunityLang();
  const chip = (active: boolean) =>
    `inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-semibold transition-colors ${active ? "bg-basalt text-paper" : "border border-basalt/15 bg-paper text-basalt hover:border-basalt/40"}`;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={t("news.filterLabel")}>
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={chip(value === null)}>
        {t("news.filterAll")}
      </button>
      {NEWS_CATEGORIES.map((c) => (
        <button key={c.key} type="button" aria-pressed={value === c.key} onClick={() => onChange(c.key)} className={chip(value === c.key)}>
          {t(`cat.${c.key}`)}
        </button>
      ))}
    </div>
  );
}

function SourceLink({ item, onDark = false }: { item: CommunityNewsItem; onDark?: boolean }) {
  const { t } = useCommunityLang();
  return (
    <span className={onDark ? "text-paper/65" : "text-basalt/70"}>
      {t("news.source")}{" "}
      <a href={item.sourceUrl} target="_blank" rel="nofollow noopener noreferrer" className={`inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline ${onDark ? "text-paper" : "text-basalt"}`}>
        {sourceLabel(item)} <ArrowUpRight className="h-3 w-3" />
      </a>
    </span>
  );
}

/**
 * A story's main photo, or Revamp's art for its topic when it has none or the
 * photo won't load (some sites refuse pictures shown elsewhere). The photo is
 * the source's, so its credit is always shown with it.
 */
function NewsPicture({ item, className, alt = "" }: { item: CommunityNewsItem; className: string; alt?: string }) {
  const { t } = useCommunityLang();
  const [failed, setFailed] = useState(false);
  const photo = item.imageUrl && !failed ? item.imageUrl : null;
  const credit = photo ? item.imageCredit.trim() : "";
  return (
    <figure className={`relative overflow-hidden bg-basalt/[0.05] ${className}`}>
      <img
        src={photo ?? newsArt(item.category)}
        alt={photo ? alt : ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
      {credit && (
        <figcaption className="absolute bottom-2 right-2 max-w-[90%] truncate rounded-full bg-basalt/75 px-2.5 py-0.5 text-xs font-medium text-paper">
          {t("news.image")} {credit}
        </figcaption>
      )}
    </figure>
  );
}

/** Topic · date · source, the one small line every story shows. */
function NewsMeta({ item, source = false }: { item: CommunityNewsItem; source?: boolean }) {
  const { lang, t } = useCommunityLang();
  return (
    <p className="flex flex-wrap gap-x-2 text-sm font-semibold text-basalt/70">
      <span>{t(`cat.${item.category}`)}</span>
      <span aria-hidden="true">·</span>
      <span>{formatNewsDate(item.storyDate ?? item.publishedAt, lang)}</span>
      {source && (
        <>
          <span aria-hidden="true">·</span>
          <span>{sourceLabel(item)}</span>
        </>
      )}
    </p>
  );
}

/** The large dark card for the newest story. */
export function LeadNewsCard({ item }: { item: CommunityNewsItem }) {
  const { lang, t } = useCommunityLang();
  return (
    <article className="flex flex-col overflow-hidden rounded-[28px] bg-basalt text-paper">
      <NewsPicture item={item} className="aspect-[16/9]" />
      <div className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-bold">
          <span className="rounded-full bg-apricot px-3 py-1.5 text-white">{t(`cat.${item.category}`)}</span>
          <span className="text-paper/65">{formatNewsDate(item.storyDate ?? item.publishedAt, lang)}</span>
        </div>
        <h3 className="font-display text-[1.65rem] font-extrabold leading-tight sm:text-[2rem]">
          <Link href={`/news/${item.slug}`} className="hover:underline hover:decoration-apricot hover:underline-offset-4">{item.title}</Link>
        </h3>
        <p className="text-[17px] leading-relaxed text-paper/80">{item.summary}</p>
        {item.forYou && (
          <div className="rounded-[18px] border border-white/15 px-5 py-4">
            <p className="text-sm font-extrabold text-apricot">{t("news.forYou")}</p>
            <p className="mt-1 text-base leading-relaxed">{item.forYou}</p>
          </div>
        )}
        <div className="mt-auto flex flex-wrap justify-between gap-3 pt-2 text-sm">
          <SourceLink item={item} onDark />
          <span className="text-paper/55">{t("news.creditShort")}</span>
        </div>
      </div>
    </article>
  );
}

/** One story on the news page: photo, headline, short summary. The whole card opens it. */
function NewsCard({ item }: { item: CommunityNewsItem }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[20px] border border-basalt/12 bg-paper transition-colors hover:border-basalt/30">
      <NewsPicture item={item} className="aspect-[16/10]" />
      <div className="flex flex-1 flex-col gap-2 p-5">
        <NewsMeta item={item} />
        <h2 className="text-[1.3rem] font-extrabold leading-snug">
          <Link href={`/news/${item.slug}`} className="after:absolute after:inset-0 group-hover:text-apricot">{item.title}</Link>
        </h2>
        <p className="line-clamp-3 text-base leading-relaxed text-basalt/75">{item.summary || item.forYou}</p>
        <p className="mt-auto pt-1 text-sm text-basalt/70">{sourceLabel(item)}</p>
      </div>
    </article>
  );
}

/** One story in the short list beside the lead card on the home page. */
export function NewsRow({ item }: { item: CommunityNewsItem }) {
  return (
    <article className="group relative flex flex-col gap-1.5 border-t border-basalt/10 py-5">
      <NewsMeta item={item} source />
      <h3 className="text-xl font-extrabold leading-snug">
        <Link href={`/news/${item.slug}`} className="after:absolute after:inset-0 group-hover:text-apricot">{item.title}</Link>
      </h3>
      <p className="line-clamp-2 text-base leading-relaxed text-basalt/75">{item.summary || item.forYou}</p>
    </article>
  );
}

export default function CommunityNews() {
  const { lang, t, path } = useCommunityLang();
  const [category, setCategory] = useState<NewsCategory | null>(null);
  const [items, setItems] = useState<CommunityNewsItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useDocumentMeta({
    title: t("meta.newsTitle"),
    description: t("meta.newsDescription"),
    canonicalPath: path("/news"),
    noindex: communityNoindex(),
  });

  useEffect(() => {
    let live = true;
    setItems(null);
    setFailed(false);
    listPublishedNews({ category, limit: PAGE, lang })
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
  }, [category, lang]);

  const loadMore = async () => {
    if (!items) return;
    try {
      const r = await listPublishedNews({ category, limit: PAGE, offset: items.length, lang });
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
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{t("news.title")}</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-basalt/75">{t("news.pageLede")}</p>
      </div>
      <NewsFilter value={category} onChange={setCategory} />
      {failed ? (
        <p className="rounded-2xl bg-apricot-soft p-6 text-base">{t("news.failed")}</p>
      ) : items === null ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="aspect-[16/10] animate-pulse rounded-[20px] bg-basalt/[0.05]" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-2xl bg-apricot-soft p-6 text-base">{t("news.empty")}</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((n) => <NewsCard key={n.id} item={n} />)}
        </div>
      )}
      {more && (
        <button type="button" onClick={loadMore} className="self-start rounded-full border-[1.5px] border-basalt px-6 py-3 text-[15px] font-bold">
          {t("news.showMore")}
        </button>
      )}
    </section>
  );
}

export function CommunityNewsArticle() {
  const { lang, t, path } = useCommunityLang();
  const { slug } = useParams<{ slug: string }>();
  const [item, setItem] = useState<CommunityNewsItem | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setItem(undefined);
    getPublishedNews(slug, lang)
      .then((r) => live && setItem(r))
      .catch((e) => {
        console.error("[community/news/article]", e);
        if (live) setItem(null);
      });
    return () => {
      live = false;
    };
  }, [slug, lang]);

  // On the Armenian site, a story without approved Armenian points to the English.
  const onlyEnglish = lang === "hy" && !!item && item.hyStatus !== "approved";

  useDocumentMeta({
    title: item && !onlyEnglish ? `${item.title} — revamp community` : t("meta.storyFallback"),
    description: item?.summary.slice(0, 160) || t("meta.newsDescription"),
    canonicalPath: path(`/news/${slug}`),
    noindex: communityNoindex() || item === null || onlyEnglish,
    jsonLd: item
      ? { "@context": "https://schema.org", "@type": "NewsArticle", headline: item.title, description: item.summary, ...(item.storyDate ? { datePublished: item.storyDate } : {}), image: item.imageUrl ?? `${COMMUNITY_ORIGIN}${newsArt(item.category)}`, isBasedOn: item.extraSources.length ? [item.sourceUrl, ...item.extraSources.map((x) => x.url)] : item.sourceUrl, publisher: { "@type": "Organization", name: "Revamp Hospitality LLC" } }
      : undefined,
  });

  return (
    <section className="mx-auto max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <Link href="/news" className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-basalt/70 hover:text-basalt">
        <ArrowLeft className="h-4 w-4" /> {t("news.all")}
      </Link>
      {item === undefined ? (
        <div className="mt-6 space-y-4" aria-busy="true">
          <div className="h-10 w-3/4 animate-pulse rounded-xl bg-basalt/[0.06]" />
          <div className="h-32 animate-pulse rounded-xl bg-basalt/[0.05]" />
        </div>
      ) : item === null ? (
        <div className="mt-6">
          <h1 className="font-display text-3xl font-extrabold">{t("news.notFoundTitle")}</h1>
          <p className="mt-3 text-lg text-basalt/70">{t("news.notFoundBody")}</p>
        </div>
      ) : onlyEnglish ? (
        <div className="mt-6">
          <h1 className="font-display text-3xl font-extrabold">{t("news.onlyEnglishTitle")}</h1>
          <p className="mt-3 text-lg text-basalt/70">{t("news.onlyEnglishBody")}</p>
          <Link href={`~/news/${slug}`} className="mt-6 inline-flex h-12 items-center rounded-full bg-basalt px-6 font-bold text-paper">{t("news.readEnglish")}</Link>
        </div>
      ) : (
        <article className="mt-6 flex flex-col gap-5">
          <p className="flex flex-wrap gap-x-3 text-sm font-bold text-basalt/70">
            <span className="text-apricot">{t(`cat.${item.category}`)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatNewsDate(item.storyDate ?? item.publishedAt, lang)}</span>
          </p>
          <h1 className="font-display text-[2rem] font-extrabold leading-tight tracking-tight sm:text-[2.6rem]">{item.title}</h1>
          <p className="text-lg leading-relaxed text-basalt/85">{item.summary}</p>
          <NewsPicture item={item} alt={item.title} className="aspect-[16/9] rounded-[20px]" />
          {item.keyPoints.length > 0 && (
            <div>
              <h2 className="text-lg font-extrabold">{t("news.details")}</h2>
              <ul className="mt-2 space-y-2">
                {item.keyPoints.map((k, i) => (
                  <li key={i} className="flex gap-3 text-[17px] leading-relaxed text-basalt/85">
                    <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-apricot" />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.forYou && (
            <div className="rounded-[20px] bg-apricot-soft px-5 py-4">
              <p className="text-sm font-extrabold">{t("news.forYou")}</p>
              <p className="mt-1 text-base leading-relaxed">{item.forYou}</p>
            </div>
          )}
          <p className="text-[15px]"><SourceLink item={item} /></p>
          {item.extraSources.length > 0 && (
            <p className="-mt-3 text-[15px] text-basalt/70">
              {t("news.alsoReported")}{" "}
              {item.extraSources.map((x, i) => (
                <span key={x.url}>
                  {i > 0 && ", "}
                  <a href={x.url} target="_blank" rel="nofollow noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-basalt underline-offset-2 hover:underline">
                    {x.name} <ArrowUpRight className="h-3 w-3" />
                  </a>
                </span>
              ))}
            </p>
          )}
          <p className="border-t border-basalt/10 pt-4 text-sm text-basalt/70">
            {t(item.verifiedAt && item.extraSources.length ? "news.creditReports" : item.verifiedAt ? "news.creditChecked" : "news.creditOld")}
          </p>
        </article>
      )}
    </section>
  );
}
