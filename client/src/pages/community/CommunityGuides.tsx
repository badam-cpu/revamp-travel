/**
 * revamp.community → Guides: Partner Hub articles an admin marked "Also show
 * on revamp.community" (hub_articles.public, migration 0125). List (/guides)
 * and one guide (/guides/:slug), Markdown via the shared safe renderer.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Camera, FileText, ShieldCheck, Star, type LucideIcon } from "lucide-react";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { getPublicGuide, listPublicGuides } from "@/lib/community";
import { renderMarkdown } from "@shared/markdown";
import { GUIDE_CATEGORY_LABELS, VACATIONS_ORIGIN, type CommunityGuide as Guide } from "@shared/community";
import type { CommunityT } from "@shared/communityText";
import { communityNoindex } from "./communityNav";
import { useCommunityLang } from "./communityLang";

const GUIDE_LOOK: Record<string, { icon: LucideIcon; tile: string; ink: string }> = {
  listing_quality: { icon: Camera, tile: "bg-apricot", ink: "text-paper" },
  reviews: { icon: Star, tile: "bg-basalt", ink: "text-apricot" },
  hosting_standards: { icon: ShieldCheck, tile: "bg-apricot-soft", ink: "text-basalt" },
  local_news: { icon: FileText, tile: "bg-apricot-soft", ink: "text-basalt" },
};

const categoryName = (t: CommunityT, category: string) => (GUIDE_CATEGORY_LABELS[category] ? t(`guidecat.${category}`) : t("guides.label"));

export function GuideCard({ guide }: { guide: Guide }) {
  const { t } = useCommunityLang();
  const look = GUIDE_LOOK[guide.category] ?? GUIDE_LOOK.local_news;
  const Icon = look.icon;
  return (
    <Link href={`/guides/${guide.slug}`} className="group flex flex-col gap-4">
      <div className={`flex h-48 items-center justify-center rounded-[24px] sm:h-56 ${look.tile}`}>
        <Icon className={`h-16 w-16 ${look.ink}`} strokeWidth={1.4} aria-hidden="true" />
      </div>
      <span className="text-sm font-bold text-basalt/70">{categoryName(t, guide.category)}</span>
      <span className="text-[1.35rem] font-extrabold leading-snug group-hover:text-apricot">{guide.title}</span>
      {guide.excerpt && <span className="text-[15px] leading-relaxed text-basalt/70">{guide.excerpt}</span>}
    </Link>
  );
}

export default function CommunityGuides() {
  const { lang, t, path } = useCommunityLang();
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [failed, setFailed] = useState(false);
  useDocumentMeta({
    title: t("meta.guidesTitle"),
    description: t("meta.guidesDescription"),
    canonicalPath: path("/guides"),
    noindex: communityNoindex(),
  });
  useEffect(() => {
    listPublicGuides(50, lang)
      .then(setGuides)
      .catch((e) => {
        console.error("[community/guides]", e);
        setFailed(true);
      });
  }, [lang]);
  return (
    <section className="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{t("guides.title")}</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-basalt/75">{t("guides.lede")}</p>
        {lang === "hy" && guides?.some((g) => g.hyStatus !== "approved") && <p className="text-[15px] text-basalt/70">{t("guides.englishNote")}</p>}
      </div>
      {failed ? (
        <p className="rounded-2xl bg-apricot-soft p-6">{t("guides.failed")}</p>
      ) : guides === null ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-[24px] bg-basalt/[0.05]" />)}
        </div>
      ) : guides.length === 0 ? (
        <p className="rounded-2xl bg-apricot-soft p-6">{t("guides.empty")}</p>
      ) : (
        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {guides.map((g) => <GuideCard key={g.slug} guide={g} />)}
        </div>
      )}
    </section>
  );
}

export function CommunityGuide() {
  const { lang, t, path } = useCommunityLang();
  const { slug } = useParams<{ slug: string }>();
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setGuide(undefined);
    getPublicGuide(slug, lang)
      .then((g) => live && setGuide(g))
      .catch((e) => {
        console.error("[community/guide]", e);
        if (live) setGuide(null);
      });
    return () => {
      live = false;
    };
  }, [slug, lang]);
  useDocumentMeta({
    title: guide ? `${guide.title} — revamp community` : "Guide — revamp community",
    description: guide?.excerpt || t("meta.guidesDescription"),
    // A guide not yet in Armenian points search engines to the English page.
    canonicalPath: guide?.hyStatus === "approved" ? path(`/guides/${slug}`) : `/guides/${slug}`,
    noindex: communityNoindex() || guide === null,
  });
  return (
    <section className="mx-auto max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <Link href="/guides" className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-basalt/70 hover:text-basalt">
        <ArrowLeft className="h-4 w-4" /> {t("guides.all")}
      </Link>
      {guide === undefined ? (
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-basalt/[0.05]" aria-busy="true" />
      ) : guide === null ? (
        <div className="mt-6">
          <h1 className="font-display text-3xl font-extrabold">{t("guides.notFoundTitle")}</h1>
          <p className="mt-3 text-lg text-basalt/70">{t("guides.notFoundBody")}</p>
        </div>
      ) : (
        <article className="mt-6">
          <p className="text-sm font-bold text-apricot">{categoryName(t, guide.category)}</p>
          <h1 className="mt-3 font-display text-[2rem] font-extrabold leading-tight tracking-tight sm:text-[2.6rem]">{guide.title}</h1>
          <div className="prose-blog mt-6 text-[1.05rem] leading-8 text-basalt/85" dangerouslySetInnerHTML={{ __html: renderMarkdown(guide.body) }} />
          <div className="mt-10 rounded-[20px] bg-apricot-soft p-5">
            <p className="font-extrabold">{t("guides.hostTitle")}</p>
            <p className="mt-1 text-[15px] leading-relaxed text-basalt/80">{t("guides.hostBody")}</p>
            <a href={`${VACATIONS_ORIGIN}/host`} className="mt-3 inline-flex h-11 items-center rounded-full bg-basalt px-5 text-[15px] font-bold text-paper">{t("guides.hostCta")}</a>
          </div>
        </article>
      )}
    </section>
  );
}
