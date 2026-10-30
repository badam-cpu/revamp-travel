/**
 * revamp.community for crawlers (migration 0125, 2026-10-29). The community
 * site is a domain alias of the same deploy; on that host renderForBot(),
 * the sitemap and llms.txt hand over to this module so bots get the
 * community's own pages — home, news, guides — never the travel catalog.
 * Every interpolated field is escaped (news/guide text is admin- or
 * AI-written); JSON-LD goes through the same "<" guard as server/prerender.ts.
 */
import { communityText, type CommunityT } from "../shared/communityText.js";
import { publicClient } from "./supabase.js";
import { communityLockupSvg } from "../shared/brandLogo.js";
import { renderMarkdown, markdownToPlain } from "../shared/markdown.js";
import {
  COMMUNITY_DESCRIPTION,
  COMMUNITY_FAQ,
  COMMUNITY_OFFERS,
  COMMUNITY_STANDARDS,
  GUIDE_CATEGORY_LABELS,
  GUIDE_COLS,
  MEETUP_COLS,
  NEWS_COLS,
  VACATIONS_ORIGIN,
  formatMeetupWhen,
  formatNewsDate,
  mapGuideRow,
  mapMeetupRow,
  mapNewsRow,
  meetupPlace,
  newsArt,
  localizeGuide,
  localizeMeetup,
  localizeNews,
  sourceLabel,
  type CommunityGuide,
  type CommunityMeetup,
  type CommunityLang,
  type CommunityNewsItem,
  LANG_NAMES,
} from "../shared/community.js";

function esc(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

// 10-minute cache per warm function — bots hit these pages in bursts.
let cache: { at: number; news: CommunityNewsItem[]; guides: CommunityGuide[]; meetups: CommunityMeetup[]; hyText: Record<string, string>; enText: Record<string, string> } | null = null;
export async function communityData(): Promise<{ news: CommunityNewsItem[]; guides: CommunityGuide[]; meetups: CommunityMeetup[]; hyText: Record<string, string>; enText: Record<string, string> }> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache;
  const db = publicClient();
  if (!db) return { news: [], guides: [], meetups: [], hyText: {}, enText: {} };
  const [n, g, m, s] = await Promise.all([
    db.from("community_news").select(NEWS_COLS).eq("status", "published").order("published_at", { ascending: false }).limit(200),
    db.from("hub_articles").select(GUIDE_COLS).eq("status", "published").eq("public", true).order("published_at", { ascending: false }).limit(200),
    db.from("community_meetups").select(MEETUP_COLS).eq("status", "published").gte("starts_at", new Date().toISOString()).order("starts_at").limit(20),
    db.from("community_settings").select("hy_text, en_text").eq("id", 1).maybeSingle(),
  ]);
  cache = {
    at: Date.now(),
    news: (n.data ?? []).map(mapNewsRow),
    guides: (g.data ?? []).map(mapGuideRow),
    meetups: (m.data ?? []).map(mapMeetupRow),
    hyText: ((s.data as { hy_text?: Record<string, string> } | null)?.hy_text ?? {}),
    enText: ((s.data as { en_text?: Record<string, string> } | null)?.en_text ?? {}),
  };
  return cache;
}

/** One language's view of the site for crawlers. */
interface Ctx {
  lang: CommunityLang;
  t: CommunityT;
  /** A path in this language: "/news" → "/hy/news". */
  p: (path: string) => string;
}
const ctxFor = (lang: CommunityLang, edits: Record<string, string>): Ctx => ({
  lang,
  t: communityText(lang, edits),
  p: (path) => (lang === "hy" ? `/hy${path === "/" ? "" : path}` : path),
});

function shell(c: Ctx, opts: { title: string; description: string; path: string; origin: string; body: string; jsonLd?: unknown[]; type?: string; canonicalPath?: string; noAlternate?: boolean }): string {
  const { t, lang, p } = c;
  const image = `${opts.origin}/images/og-cover.jpg`;
  const canonical = `${opts.origin}${opts.canonicalPath ?? p(opts.path)}`;
  const en = `${opts.origin}${opts.path}`;
  const hy = `${opts.origin}${opts.path === "/" ? "/hy" : `/hy${opts.path}`}`;
  const alternates = opts.noAlternate ? "" : `<link rel="alternate" hreflang="en" href="${esc(en)}" />
<link rel="alternate" hreflang="hy" href="${esc(hy)}" />
<link rel="alternate" hreflang="x-default" href="${esc(en)}" />
`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${esc(canonical)}" />
${alternates}<meta property="og:title" content="${esc(opts.title)}" />
<meta property="og:description" content="${esc(opts.description)}" />
<meta property="og:type" content="${opts.type ?? "website"}" />
<meta property="og:site_name" content="revamp community" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(image)}" />
<meta name="twitter:card" content="summary_large_image" />
${(opts.jsonLd ?? []).map(jsonLd).join("\n")}
</head>
<body>
<header>
<a href="${p("/")}">${communityLockupSvg("#F15822", 32)}</a>
<nav aria-label="Main"><a href="${p("/news")}">${esc(t("nav.news"))}</a> · <a href="${p("/guides")}">${esc(t("nav.guides"))}</a> · <a href="${p("/")}#meetups">${esc(t("nav.meetups"))}</a> · <a href="${p("/")}#join">${esc(t("cta.join"))}</a> · <a href="${VACATIONS_ORIGIN}/host">${esc(t("footer.hostOnRevamp"))}</a> · <a href="${lang === "hy" ? esc(opts.path) : esc(opts.path === "/" ? "/hy" : `/hy${opts.path}`)}" lang="${lang === "hy" ? "en" : "hy"}">${LANG_NAMES[lang === "hy" ? "en" : "hy"]}</a></nav>
</header>
<main>
${opts.body}
</main>
<footer><p>revamp community · ${esc(t("footer.copyright"))} · <a href="${VACATIONS_ORIGIN}">revampvacations.com</a> · <a href="mailto:hello@revampvacations.com">hello@revampvacations.com</a></p></footer>
</body>
</html>`;
}

function newsItemHtml(c: Ctx, n: CommunityNewsItem): string {
  const { t, lang, p } = c;
  return `<article><p>${esc(t(`cat.${n.category}`))} · ${esc(formatNewsDate(n.storyDate ?? n.publishedAt, lang))}</p><h3><a href="${p(`/news/${esc(n.slug)}`)}">${esc(n.title)}</a></h3><p>${esc(n.summary)}</p>${n.forYou ? `<p><strong>${esc(t("news.forYou"))}:</strong> ${esc(n.forYou)}</p>` : ""}<p>${esc(t("news.source"))} <a href="${esc(n.sourceUrl)}" rel="nofollow noopener">${esc(sourceLabel(n))}</a></p></article>`;
}

function renderHome(c: Ctx, origin: string, d: { guides: CommunityGuide[]; meetups: CommunityMeetup[] }, news: CommunityNewsItem[]): string {
  const { t, lang, p } = c;
  const body = `<h1>${esc(t("hero.title"))}</h1>
<p>${esc(t("meta.description"))}</p>
<section><h2>${esc(t("find.title"))}</h2><ul>${COMMUNITY_OFFERS.map((o) => `<li><a href="${esc(o.href.startsWith("http") ? o.href : p(o.href))}">${esc(t(`offer.${o.key}.title`))}</a> — ${esc(t(`offer.${o.key}.body`))}</li>`).join("")}</ul></section>
<section id="news"><h2>${esc(t("news.title"))}</h2>${news.slice(0, 6).map((n) => newsItemHtml(c, n)).join("\n") || `<p>${esc(t("news.empty"))}</p>`}<p><a href="${p("/news")}">${esc(t("news.all"))}</a></p></section>
<section id="guides"><h2>${esc(t("guides.homeTitle"))}</h2><ul>${d.guides.slice(0, 6).map((g) => `<li><a href="${p(`/guides/${esc(g.slug)}`)}">${esc(g.title)}</a> — ${esc(g.excerpt)}</li>`).join("")}</ul></section>
<section id="meetups"><h2>${esc(t("meetups.title"))}</h2><ul>${d.meetups.map((m) => { const w = formatMeetupWhen(m.startsAt, lang); return `<li>${esc(w.day)}, ${esc(w.time)} — ${esc(m.title)} (${esc(meetupPlace(m, lang))})</li>`; }).join("") || `<li>${esc(t("meetups.emptyTitle"))}</li>`}</ul></section>
<section><h2>${esc(t("standards.title"))}</h2><ol>${COMMUNITY_STANDARDS.map((_, i) => `<li><strong>${esc(t(`standard.${i}.title`))}</strong> — ${esc(t(`standard.${i}.body`))}</li>`).join("")}</ol></section>
<section><h2>${esc(t("faq.title"))}</h2><dl>${COMMUNITY_FAQ.map((_, i) => `<dt>${esc(t(`faq.${i}.q`))}</dt><dd>${esc(t(`faq.${i}.a`))}</dd>`).join("")}</dl></section>
<section id="join"><h2>${esc(t("cta.join"))}</h2><p>Stay. Experience. Repeat.</p></section>`;
  return shell(c, {
    title: t("meta.title"),
    description: t("meta.description"),
    path: "/",
    origin,
    body,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebSite", name: "revamp community", url: `${origin}/`, publisher: { "@type": "Organization", name: "Revamp Hospitality LLC", url: VACATIONS_ORIGIN } },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: COMMUNITY_FAQ.map((_, i) => ({ "@type": "Question", name: t(`faq.${i}.q`), acceptedAnswer: { "@type": "Answer", text: t(`faq.${i}.a`) } })) },
    ],
  });
}

function renderNewsIndex(c: Ctx, origin: string, news: CommunityNewsItem[]): string {
  const { t } = c;
  return shell(c, {
    title: t("meta.newsTitle"),
    description: t("meta.newsDescription"),
    path: "/news",
    origin,
    body: `<h1>${esc(t("news.title"))}</h1>${news.map((n) => newsItemHtml(c, n)).join("\n") || `<p>${esc(t("news.empty"))}</p>`}`,
  });
}

function renderNewsArticle(c: Ctx, origin: string, n: CommunityNewsItem): string {
  const { t, lang, p } = c;
  const date = n.storyDate ?? n.publishedAt?.slice(0, 10) ?? undefined;
  return shell(c, {
    title: `${n.title} — revamp community`,
    description: n.summary.slice(0, 160),
    path: `/news/${n.slug}`,
    noAlternate: n.hyStatus !== "approved",
    origin,
    type: "article",
    body: `<article><p>${esc(t(`cat.${n.category}`))} · ${esc(formatNewsDate(n.storyDate ?? n.publishedAt, lang))}</p><h1>${esc(n.title)}</h1><p>${esc(n.summary)}</p>${n.imageUrl ? `<figure><img src="${esc(n.imageUrl)}" alt="${esc(n.title)}" />${n.imageCredit ? `<figcaption>${esc(t("news.image"))} ${esc(n.imageCredit)}</figcaption>` : ""}</figure>` : ""}${n.keyPoints.length ? `<h2>${esc(t("news.details"))}</h2><ul>${n.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}${n.forYou ? `<h2>${esc(t("news.forYou"))}</h2><p>${esc(n.forYou)}</p>` : ""}<p>${esc(t("news.source"))} <a href="${esc(n.sourceUrl)}" rel="nofollow noopener">${esc(sourceLabel(n))}</a></p>${n.extraSources.length ? `<p>${esc(t("news.alsoReported"))} ${n.extraSources.map((x) => `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.name)}</a>`).join(", ")}</p>` : ""}<p>${esc(t(n.verifiedAt && n.extraSources.length ? "news.creditReports" : n.verifiedAt ? "news.creditChecked" : "news.creditOld"))}</p></article><p><a href="${p("/news")}">${esc(t("news.all"))}</a></p>`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: n.title,
        description: n.summary,
        ...(date ? { datePublished: date } : {}),
        url: `${origin}${p(`/news/${n.slug}`)}`,
        inLanguage: lang,
        image: n.imageUrl ?? `${origin}${newsArt(n.category)}`,
        isBasedOn: n.extraSources.length ? [n.sourceUrl, ...n.extraSources.map((x) => x.url)] : n.sourceUrl,
        publisher: { "@type": "Organization", name: "Revamp Hospitality LLC", url: VACATIONS_ORIGIN },
      },
    ],
  });
}

const guideCat = (c: Ctx, category: string) => (GUIDE_CATEGORY_LABELS[category] ? c.t(`guidecat.${category}`) : "");

function renderGuidesIndex(c: Ctx, origin: string, guides: CommunityGuide[]): string {
  const { t, p } = c;
  return shell(c, {
    title: t("meta.guidesTitle"),
    description: t("meta.guidesDescription"),
    path: "/guides",
    origin,
    body: `<h1>${esc(t("guides.title"))}</h1><ul>${guides.map((g) => `<li>${esc(guideCat(c, g.category))} — <a href="${p(`/guides/${esc(g.slug)}`)}">${esc(g.title)}</a>: ${esc(g.excerpt)}</li>`).join("")}</ul>`,
  });
}

function renderGuide(c: Ctx, origin: string, g: CommunityGuide): string {
  const { t, p } = c;
  return shell(c, {
    title: `${g.title} — revamp community`,
    description: (g.excerpt || markdownToPlain(g.body, 160)).slice(0, 160),
    path: `/guides/${g.slug}`,
    // Not yet in Armenian: the English page is the one to index.
    ...(g.hyStatus === "approved" ? {} : { canonicalPath: `/guides/${g.slug}`, noAlternate: true }),
    origin,
    type: "article",
    // renderMarkdown escapes the source itself (shared safe renderer).
    body: `<article><p>${esc(guideCat(c, g.category))}</p><h1>${esc(g.title)}</h1>${renderMarkdown(g.body)}</article><p><a href="${p("/guides")}">${esc(t("guides.all"))}</a></p>`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "Article", headline: g.title, url: `${origin}/guides/${g.slug}`, ...(g.publishedAt ? { datePublished: g.publishedAt.slice(0, 10) } : {}), publisher: { "@type": "Organization", name: "Revamp Hospitality LLC" } }],
  });
}

function renderNotFound(c: Ctx, origin: string): string {
  const { t, p } = c;
  return shell(c, { title: t("meta.notFoundTitle"), description: t("meta.description"), path: "/", noAlternate: true, origin, body: `<h1>${esc(t("notFound.title"))}</h1><p><a href="${p("/")}">${esc(t("notFound.back"))}</a></p>` });
}

/** Crawler HTML for a revamp.community path. */
export async function renderCommunityForBot(pathname: string, origin: string): Promise<{ status: number; body: string }> {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const lang: CommunityLang = clean === "/hy" || clean.startsWith("/hy/") ? "hy" : "en";
  const path = lang === "hy" ? clean.slice(3) || "/" : clean;
  const d = await communityData();
  const c = ctxFor(lang, lang === "hy" ? d.hyText : d.enText);
  // The Armenian site shows only stories whose Armenian an admin has approved.
  const news = (lang === "hy" ? d.news.filter((n) => n.hyStatus === "approved") : d.news).map((n) => localizeNews(n, lang));
  const guides = d.guides.map((g) => localizeGuide(g, lang));
  const meetups = d.meetups.map((m) => localizeMeetup(m, lang));
  if (path === "/") return { status: 200, body: renderHome(c, origin, { guides, meetups }, news) };
  if (path === "/news") return { status: 200, body: renderNewsIndex(c, origin, news) };
  if (path === "/guides") return { status: 200, body: renderGuidesIndex(c, origin, guides) };
  const story = path.match(/^\/news\/([a-z0-9-]+)$/);
  if (story) {
    const n = news.find((x) => x.slug === story[1]);
    return n ? { status: 200, body: renderNewsArticle(c, origin, n) } : { status: 404, body: renderNotFound(c, origin) };
  }
  const guide = path.match(/^\/guides\/([a-z0-9-]+)$/);
  if (guide) {
    const g = guides.find((x) => x.slug === guide[1]);
    return g ? { status: 200, body: renderGuide(c, origin, g) } : { status: 404, body: renderNotFound(c, origin) };
  }
  return { status: 404, body: renderNotFound(c, origin) };
}

/** sitemap.xml body for revamp.community. */
export async function communitySitemapXml(origin: string): Promise<string> {
  const d = await communityData();
  const urls = [
    `<url><loc>${origin}/</loc></url>`,
    `<url><loc>${origin}/news</loc></url>`,
    `<url><loc>${origin}/guides</loc></url>`,
    `<url><loc>${origin}/hy</loc></url>`,
    `<url><loc>${origin}/hy/news</loc></url>`,
    `<url><loc>${origin}/hy/guides</loc></url>`,
    ...d.guides.filter((g) => g.hyStatus === "approved").map((g) => `<url><loc>${origin}/hy/guides/${esc(g.slug)}</loc></url>`),
    ...d.news.filter((n) => n.hyStatus === "approved").map((n) => `<url><loc>${origin}/hy/news/${esc(n.slug)}</loc>${n.publishedAt ? `<lastmod>${n.publishedAt.slice(0, 10)}</lastmod>` : ""}</url>`),
    ...d.news.map((n) => `<url><loc>${origin}/news/${esc(n.slug)}</loc>${n.publishedAt ? `<lastmod>${n.publishedAt.slice(0, 10)}</lastmod>` : ""}</url>`),
    ...d.guides.map((g) => `<url><loc>${origin}/guides/${esc(g.slug)}</loc>${g.publishedAt ? `<lastmod>${g.publishedAt.slice(0, 10)}</lastmod>` : ""}</url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** llms.txt for revamp.community. */
export async function communityLlmsTxt(origin: string): Promise<string> {
  const d = await communityData();
  const L = [
    "# revamp community",
    "",
    `> ${COMMUNITY_DESCRIPTION}`,
    "",
    `Run by Revamp Hospitality LLC, the company behind Revamp Vacations (${VACATIONS_ORIGIN}), Armenia's travel marketplace. Open to every host. Contact: hello@revampvacations.com.`,
    "",
    "## Pages",
    `- [Home](${origin}/)`,
    `- [News for hosts](${origin}/news): weekly news on travel to Armenia, short-term rentals, OTA news, rules and local regulations — each with the source linked`,
    `- [Guides](${origin}/guides)`,
    `- [Armenian version](${origin}/hy): the same site in Armenian`,
    `- [Host on Revamp](${VACATIONS_ORIGIN}/host)`,
    "",
    "## Latest news",
    ...d.news.slice(0, 20).map((n) => `- [${n.title}](${origin}/news/${n.slug}): ${n.summary.slice(0, 160)}`),
  ];
  return L.join("\n") + "\n";
}
