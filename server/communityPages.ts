/**
 * revamp.community for crawlers (migration 0125, 2026-10-29). The community
 * site is a domain alias of the same deploy; on that host renderForBot(),
 * the sitemap and llms.txt hand over to this module so bots get the
 * community's own pages — home, news, guides — never the travel catalog.
 * Every interpolated field is escaped (news/guide text is admin- or
 * AI-written); JSON-LD goes through the same "<" guard as server/prerender.ts.
 */
import { publicClient } from "./supabase.js";
import { communityLockupSvg } from "../shared/brandLogo.js";
import { renderMarkdown, markdownToPlain } from "../shared/markdown.js";
import {
  COMMUNITY_DESCRIPTION,
  COMMUNITY_FAQ,
  COMMUNITY_OFFERS,
  COMMUNITY_STANDARDS,
  COMMUNITY_TITLE,
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
  newsCategoryLabel,
  sourceLabel,
  type CommunityGuide,
  type CommunityMeetup,
  type CommunityNewsItem,
} from "../shared/community.js";

function esc(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

// 10-minute cache per warm function — bots hit these pages in bursts.
let cache: { at: number; news: CommunityNewsItem[]; guides: CommunityGuide[]; meetups: CommunityMeetup[] } | null = null;
export async function communityData(): Promise<{ news: CommunityNewsItem[]; guides: CommunityGuide[]; meetups: CommunityMeetup[] }> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache;
  const db = publicClient();
  if (!db) return { news: [], guides: [], meetups: [] };
  const [n, g, m] = await Promise.all([
    db.from("community_news").select(NEWS_COLS).eq("status", "published").order("published_at", { ascending: false }).limit(200),
    db.from("hub_articles").select(GUIDE_COLS).eq("status", "published").eq("public", true).order("published_at", { ascending: false }).limit(200),
    db.from("community_meetups").select(MEETUP_COLS).eq("status", "published").gte("starts_at", new Date().toISOString()).order("starts_at").limit(20),
  ]);
  cache = {
    at: Date.now(),
    news: (n.data ?? []).map(mapNewsRow),
    guides: (g.data ?? []).map(mapGuideRow),
    meetups: (m.data ?? []).map(mapMeetupRow),
  };
  return cache;
}

function shell(opts: { title: string; description: string; canonical: string; origin: string; body: string; jsonLd?: unknown[]; type?: string }): string {
  const image = `${opts.origin}/images/og-cover.jpg`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${esc(opts.canonical)}" />
<meta property="og:title" content="${esc(opts.title)}" />
<meta property="og:description" content="${esc(opts.description)}" />
<meta property="og:type" content="${opts.type ?? "website"}" />
<meta property="og:site_name" content="revamp community" />
<meta property="og:url" content="${esc(opts.canonical)}" />
<meta property="og:image" content="${esc(image)}" />
<meta name="twitter:card" content="summary_large_image" />
${(opts.jsonLd ?? []).map(jsonLd).join("\n")}
</head>
<body>
<header>
<a href="/">${communityLockupSvg("#F15822", 32)}</a>
<nav aria-label="Main"><a href="/news">News</a> · <a href="/guides">Guides</a> · <a href="/#meetups">Meetups</a> · <a href="/#join">Join the community</a> · <a href="${VACATIONS_ORIGIN}/host">Host on Revamp</a></nav>
</header>
<main>
${opts.body}
</main>
<footer><p>revamp community · © Revamp Hospitality LLC · Yerevan, Armenia · <a href="${VACATIONS_ORIGIN}">revampvacations.com</a> · <a href="mailto:hello@revampvacations.com">hello@revampvacations.com</a></p></footer>
</body>
</html>`;
}

function newsItemHtml(n: CommunityNewsItem): string {
  return `<article><p>${esc(newsCategoryLabel(n.category))} · ${esc(formatNewsDate(n.storyDate ?? n.publishedAt))}</p><h3><a href="/news/${esc(n.slug)}">${esc(n.title)}</a></h3><p>${esc(n.summary)}</p>${n.forYou ? `<p><strong>What it means for you:</strong> ${esc(n.forYou)}</p>` : ""}<p>Source: <a href="${esc(n.sourceUrl)}" rel="nofollow noopener">${esc(sourceLabel(n))}</a></p></article>`;
}

function renderHome(origin: string, d: Awaited<ReturnType<typeof communityData>>): string {
  const body = `<h1>Hosts helping hosts.</h1>
<p>${esc(COMMUNITY_DESCRIPTION)}</p>
<section><h2>What you'll find here</h2><ul>${COMMUNITY_OFFERS.map((o) => `<li><a href="${esc(o.href)}">${esc(o.title)}</a> — ${esc(o.body)}</li>`).join("")}</ul></section>
<section id="news"><h2>News &amp; updates</h2>${d.news.slice(0, 6).map(newsItemHtml).join("\n") || "<p>New stories every week.</p>"}<p><a href="/news">All news</a></p></section>
<section id="guides"><h2>From the guides</h2><ul>${d.guides.slice(0, 6).map((g) => `<li><a href="/guides/${esc(g.slug)}">${esc(g.title)}</a> — ${esc(g.excerpt)}</li>`).join("")}</ul></section>
<section id="meetups"><h2>Meetups</h2><ul>${d.meetups.map((m) => { const w = formatMeetupWhen(m.startsAt); return `<li>${esc(w.day)}, ${esc(w.time)} — ${esc(m.title)} (${esc(meetupPlace(m))})</li>`; }).join("") || "<li>The next date is announced soon.</li>"}</ul></section>
<section><h2>What we ask of every member</h2><ol>${COMMUNITY_STANDARDS.map((s) => `<li><strong>${esc(s.title)}</strong> — ${esc(s.body)}</li>`).join("")}</ol></section>
<section><h2>Questions</h2><dl>${COMMUNITY_FAQ.map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join("")}</dl></section>
<section id="join"><h2>Join the community</h2><p>Stay. Experience. Repeat.</p></section>`;
  return shell({
    title: COMMUNITY_TITLE,
    description: COMMUNITY_DESCRIPTION,
    canonical: `${origin}/`,
    origin,
    body,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebSite", name: "revamp community", url: `${origin}/`, publisher: { "@type": "Organization", name: "Revamp Hospitality LLC", url: VACATIONS_ORIGIN } },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: COMMUNITY_FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  });
}

function renderNewsIndex(origin: string, news: CommunityNewsItem[]): string {
  return shell({
    title: "News for hosts in Armenia — revamp community",
    description: "Travel to Armenia, short-term rentals, OTA news, rules and taxes — what changed and what it means for hosts.",
    canonical: `${origin}/news`,
    origin,
    body: `<h1>News &amp; updates</h1>${news.map(newsItemHtml).join("\n") || "<p>New stories every week.</p>"}`,
  });
}

function renderNewsArticle(origin: string, n: CommunityNewsItem): string {
  const date = n.storyDate ?? n.publishedAt?.slice(0, 10) ?? undefined;
  return shell({
    title: `${n.title} — revamp community`,
    description: n.summary.slice(0, 160),
    canonical: `${origin}/news/${n.slug}`,
    origin,
    type: "article",
    body: `<article><p>${esc(newsCategoryLabel(n.category))} · ${esc(formatNewsDate(n.storyDate ?? n.publishedAt))}</p><h1>${esc(n.title)}</h1><p>${esc(n.summary)}</p>${n.keyPoints.length ? `<h2>The details</h2><ul>${n.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}${n.forYou ? `<h2>What it means for you</h2><p>${esc(n.forYou)}</p>` : ""}<p>Source: <a href="${esc(n.sourceUrl)}" rel="nofollow noopener">${esc(sourceLabel(n))}</a></p>${n.extraSources.length ? `<p>Also reported by: ${n.extraSources.map((x) => `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.name)}</a>`).join(", ")}</p>` : ""}<p>${n.verifiedAt ? "Written by Aha AI from the source article, with each detail checked against it, then reviewed by the Revamp team." : "Summarised by Aha AI, checked by the Revamp team."}</p></article><p><a href="/news">All news</a></p>`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: n.title,
        description: n.summary,
        ...(date ? { datePublished: date } : {}),
        url: `${origin}/news/${n.slug}`,
        isBasedOn: n.extraSources.length ? [n.sourceUrl, ...n.extraSources.map((x) => x.url)] : n.sourceUrl,
        publisher: { "@type": "Organization", name: "Revamp Hospitality LLC", url: VACATIONS_ORIGIN },
      },
    ],
  });
}

function renderGuidesIndex(origin: string, guides: CommunityGuide[]): string {
  return shell({
    title: "Guides for hosts — revamp community",
    description: "Practical guides for hosts in Armenia: listing quality, reviews, hosting standards and local news.",
    canonical: `${origin}/guides`,
    origin,
    body: `<h1>Guides</h1><ul>${guides.map((g) => `<li>${esc(GUIDE_CATEGORY_LABELS[g.category] ?? "")} — <a href="/guides/${esc(g.slug)}">${esc(g.title)}</a>: ${esc(g.excerpt)}</li>`).join("")}</ul>`,
  });
}

function renderGuide(origin: string, g: CommunityGuide): string {
  return shell({
    title: `${g.title} — revamp community`,
    description: (g.excerpt || markdownToPlain(g.body, 160)).slice(0, 160),
    canonical: `${origin}/guides/${g.slug}`,
    origin,
    type: "article",
    // renderMarkdown escapes the source itself (shared safe renderer).
    body: `<article><p>${esc(GUIDE_CATEGORY_LABELS[g.category] ?? "")}</p><h1>${esc(g.title)}</h1>${renderMarkdown(g.body)}</article><p><a href="/guides">All guides</a></p>`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "Article", headline: g.title, url: `${origin}/guides/${g.slug}`, ...(g.publishedAt ? { datePublished: g.publishedAt.slice(0, 10) } : {}), publisher: { "@type": "Organization", name: "Revamp Hospitality LLC" } }],
  });
}

function renderNotFound(origin: string): string {
  return shell({ title: "Page not found — revamp community", description: COMMUNITY_DESCRIPTION, canonical: `${origin}/`, origin, body: `<h1>We couldn't find that page.</h1><p><a href="/">Back to revamp community</a></p>` });
}

/** Crawler HTML for a revamp.community path. */
export async function renderCommunityForBot(pathname: string, origin: string): Promise<{ status: number; body: string }> {
  const path = pathname.replace(/\/+$/, "") || "/";
  const d = await communityData();
  if (path === "/") return { status: 200, body: renderHome(origin, d) };
  if (path === "/news") return { status: 200, body: renderNewsIndex(origin, d.news) };
  if (path === "/guides") return { status: 200, body: renderGuidesIndex(origin, d.guides) };
  const news = path.match(/^\/news\/([a-z0-9-]+)$/);
  if (news) {
    const n = d.news.find((x) => x.slug === news[1]);
    return n ? { status: 200, body: renderNewsArticle(origin, n) } : { status: 404, body: renderNotFound(origin) };
  }
  const guide = path.match(/^\/guides\/([a-z0-9-]+)$/);
  if (guide) {
    const g = d.guides.find((x) => x.slug === guide[1]);
    return g ? { status: 200, body: renderGuide(origin, g) } : { status: 404, body: renderNotFound(origin) };
  }
  return { status: 404, body: renderNotFound(origin) };
}

/** sitemap.xml body for revamp.community. */
export async function communitySitemapXml(origin: string): Promise<string> {
  const d = await communityData();
  const urls = [
    `<url><loc>${origin}/</loc></url>`,
    `<url><loc>${origin}/news</loc></url>`,
    `<url><loc>${origin}/guides</loc></url>`,
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
    `- [News for hosts](${origin}/news): weekly news on travel to Armenia, short-term rentals, OTA news, rules and taxes — each with the source linked`,
    `- [Guides](${origin}/guides)`,
    `- [Host on Revamp](${VACATIONS_ORIGIN}/host)`,
    "",
    "## Latest news",
    ...d.news.slice(0, 20).map((n) => `- [${n.title}](${origin}/news/${n.slug}): ${n.summary.slice(0, 160)}`),
  ];
  return L.join("\n") + "\n";
}
