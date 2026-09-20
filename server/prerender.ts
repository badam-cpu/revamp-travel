/**
 * Hand-written HTML prerendering for non-JS-executing crawlers (see
 * server/botDetect.ts for the full list this covers — GPTBot, ClaudeBot,
 * PerplexityBot, CCBot, Twitterbot, and friends). This is deliberately NOT
 * a headless-browser render: this app's production hosting target is an
 * arbitrary/unknown single Node process (`pnpm start`), and installing a
 * Chromium binary there is operationally fragile (missing shared libs,
 * large deploy size, cold-start cost). Instead this builds real, semantic
 * HTML — title/meta/OG/Twitter/JSON-LD plus genuine visible content and
 * internal links — directly from the same published-catalog data the app
 * already reads, with no browser involved.
 *
 * Every interpolated piece of listing content is operator-submitted text
 * (from client/src/pages/Dashboard.tsx) that, until now, only ever reached
 * a page through React's automatic escaping. Writing it into a raw HTML
 * string here for the first time is a new stored-XSS surface — escapeHtml()
 * below is applied to every such value before it's placed in bodyHtml, and
 * the JSON-LD block gets its own separate escaping (see jsonLdScript()).
 */
import type { PublicListing } from "./supabase.js";
import { getPublishedCatalog, getPublishedPosts, getPublishedPostBySlug, type PublicPost } from "./supabase.js";
import { regions, typeLabels } from "../shared/listings.js";
import type { ListingType } from "../shared/listings.js";
import { buildArticleJsonLd, buildBlogListJsonLd, buildBreadcrumbJsonLd, buildCollectionPageJsonLd, buildListingJsonLd, buildWebsiteJsonLd } from "../shared/seo.js";
import { renderMarkdown, markdownToPlain } from "../shared/markdown.js";

export type PageKind =
  | "home"
  | "explore"
  | "explore-category"
  | "tour-browser"
  | "map"
  | "plan"
  | "listing-detail"
  | "blog"
  | "blog-post"
  | "login"
  | "signup"
  | "not-found";

export interface MatchedRoute {
  kind: PageKind;
  category?: "stay" | "eat" | "experience";
  slug?: string;
}

const MAX_GRID_ITEMS = 60;

/** Mirrors client/src/App.tsx's route order — most-specific first. */
export function matchRoute(pathname: string): MatchedRoute {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return { kind: "home" };
  if (path === "/explore/tour") return { kind: "tour-browser" };
  if (path === "/explore") return { kind: "explore" };
  if (path === "/explore/stay") return { kind: "explore-category", category: "stay" };
  if (path === "/explore/eat") return { kind: "explore-category", category: "eat" };
  if (path === "/explore/experience") return { kind: "explore-category", category: "experience" };
  if (path.startsWith("/explore/")) return { kind: "explore" }; // unrecognized category → unfiltered explore, not a 404
  if (path === "/map") return { kind: "map" };
  if (path === "/plan") return { kind: "plan" };
  if (path === "/login") return { kind: "login" };
  if (path === "/signup") return { kind: "signup" };
  if (path === "/blog") return { kind: "blog" };
  const postMatch = path.match(/^\/blog\/([^/]+)$/);
  if (postMatch) return { kind: "blog-post", slug: decodeURIComponent(postMatch[1]) };
  const listingMatch = path.match(/^\/listing\/([^/]+)$/);
  if (listingMatch) return { kind: "listing-detail", slug: decodeURIComponent(listingMatch[1]) };

  return { kind: "not-found" };
}

export interface RenderResult {
  status: number;
  body: string;
}

export async function renderForBot(pathname: string, origin: string): Promise<RenderResult> {
  const route = matchRoute(pathname);
  const catalog = await getPublishedCatalog();

  switch (route.kind) {
    case "home":
      return { status: 200, body: renderHome(catalog, origin) };
    case "explore":
      return { status: 200, body: renderExplore(catalog, origin, undefined) };
    case "explore-category":
      return { status: 200, body: renderExplore(catalog, origin, route.category) };
    case "tour-browser":
      return { status: 200, body: renderExplore(catalog, origin, "tour") };
    case "map":
      return { status: 200, body: renderMap(catalog, origin) };
    case "plan":
      return { status: 200, body: renderPlan(origin) };
    case "login":
      return { status: 200, body: renderAuthPage(origin, "login") };
    case "signup":
      return { status: 200, body: renderAuthPage(origin, "signup") };
    case "listing-detail": {
      const listing = catalog.find((item) => item.slug === route.slug);
      if (!listing) return { status: 404, body: renderNotFound(origin) };
      return { status: 200, body: renderListingDetail(listing, catalog, origin) };
    }
    case "blog": {
      const posts = await getPublishedPosts();
      return { status: 200, body: renderBlogIndex(posts, origin) };
    }
    case "blog-post": {
      const post = route.slug ? await getPublishedPostBySlug(route.slug) : null;
      if (!post) return { status: 404, body: renderNotFound(origin) };
      return { status: 200, body: renderBlogPost(post, origin) };
    }
    case "not-found":
    default:
      return { status: 404, body: renderNotFound(origin) };
  }
}

// ---------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Safe to embed inside a <script type="application/ld+json"> block — JSON.stringify already escapes for JSON syntax; this additionally stops a literal "</script>" substring (e.g. from an operator-typed title) from closing the tag early in an HTML parser. */
function jsonLdScript(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

// ---------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------

interface ShellOptions {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
  jsonLd?: unknown[];
  bodyHtml: string;
  robots?: string;
}

function renderPageShell(opts: ShellOptions): string {
  // Every call site below passes an already-absolute ogImage (origin + a
  // root-relative asset path), so no further resolution is needed here.
  const image = opts.ogImage ?? "";
  const jsonLdBlocks = (opts.jsonLd ?? []).map(jsonLdScript).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}" />
<meta name="robots" content="${opts.robots ?? "index, follow"}" />
<link rel="canonical" href="${escapeHtml(opts.canonical)}" />
<meta property="og:title" content="${escapeHtml(opts.title)}" />
<meta property="og:description" content="${escapeHtml(opts.description)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(opts.canonical)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(opts.title)}" />
<meta name="twitter:description" content="${escapeHtml(opts.description)}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
${jsonLdBlocks}
</head>
<body>
<nav aria-label="Primary">
<a href="/">Home</a> ·
<a href="/explore">Explore</a> ·
<a href="/explore/stay">Stay</a> ·
<a href="/explore/eat">Eat</a> ·
<a href="/explore/tour">Tour</a> ·
<a href="/explore/experience">Experience</a> ·
<a href="/map">Map</a> ·
<a href="/plan">AI Planner</a> ·
<a href="/login">Sign in</a>
</nav>
${opts.bodyHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------

/** A listing image is either a root-relative brand asset (/images/…) or an absolute uploaded URL (Supabase Storage) — only prepend the origin to the former. */
function imgUrl(src: string, origin: string): string {
  return /^https?:\/\//i.test(src) ? src : `${origin}${src}`;
}

// Social/link-preview scrapers (WhatsApp, iMessage, Telegram, Facebook, X,
// LinkedIn) don't render SVG og:images — they need a raster. This branded
// 1200×630 JPG is the default whenever a page has no real uploaded photo.
const OG_IMAGE = "/images/og-cover.jpg";

/** A listing's og:image: its uploaded photo when it has one, else the raster
 *  default (a brand SVG fallback wouldn't preview). */
function listingOg(src: string, origin: string): string {
  return src && !/\.svg($|\?)/i.test(src) && !src.startsWith("/images/") ? imgUrl(src, origin) : `${origin}${OG_IMAGE}`;
}

function listingCardHtml(listing: PublicListing, origin: string): string {
  return `<article>
<h3><a href="${origin}/listing/${escapeHtml(listing.slug)}">${escapeHtml(listing.title)}</a></h3>
<img src="${escapeHtml(imgUrl(listing.image, origin))}" alt="${escapeHtml(listing.title)}" />
<p>${escapeHtml(listing.shortDescription)}</p>
<p>${escapeHtml(listing.city)}, ${escapeHtml(listing.region)} — ${escapeHtml(listing.priceLabel)} / ${escapeHtml(listing.priceUnit)}</p>
</article>`;
}

function listingGridHtml(listings: PublicListing[], origin: string): string {
  if (listings.length === 0) return "<p>No listings are published in this category yet.</p>";
  return `<div>${listings
    .slice(0, MAX_GRID_ITEMS)
    .map((listing) => listingCardHtml(listing, origin))
    .join("\n")}</div>`;
}

// ---------------------------------------------------------------------
// Per-kind renderers
// ---------------------------------------------------------------------

function renderHome(catalog: PublicListing[], origin: string): string {
  const featured = catalog.filter((listing) => listing.featured).slice(0, 6);
  const shown = featured.length > 0 ? featured : catalog.slice(0, 6);

  const bodyHtml = `
<h1>Revamp Vacations — Stays, Tours &amp; Experiences in Armenia</h1>
<p>Curated places to stay, Armenian restaurants, local tours, and memorable routes across Armenia.</p>
<section>
<h2>Browse by category</h2>
<ul>
<li><a href="${origin}/explore/stay">${typeLabels.stay} — places to stay</a></li>
<li><a href="${origin}/explore/eat">${typeLabels.eat} — restaurants</a></li>
<li><a href="${origin}/explore/tour">${typeLabels.tour} — guided tours</a></li>
<li><a href="${origin}/explore/experience">${typeLabels.experience} — hands-on classes & activities</a></li>
</ul>
</section>
<section>
<h2>Featured listings</h2>
${listingGridHtml(shown, origin)}
</section>
<section>
<h2>Regions</h2>
<ul>
${regions.map((region) => `<li><a href="${origin}/explore?query=${encodeURIComponent(region.query)}">${escapeHtml(region.name)} — ${escapeHtml(region.label)}</a></li>`).join("\n")}
</ul>
</section>`;

  return renderPageShell({
    title: "Revamp Vacations — Stays, Tours & Experiences in Armenia",
    description: "Curated places to stay, Armenian restaurants, local tours, and memorable routes across Armenia.",
    canonical: `${origin}/`,
    ogImage: `${origin}${OG_IMAGE}`,
    jsonLd: [buildWebsiteJsonLd(origin)],
    bodyHtml,
  });
}

function renderExplore(catalog: PublicListing[], origin: string, category: ListingType | undefined): string {
  const filtered = category ? catalog.filter((listing) => listing.type === category) : catalog;
  const label = category ? typeLabels[category] : "All listings";
  const canonicalPath = category === "stay" ? "/explore/stay" : category === "eat" ? "/explore/eat" : category === "tour" ? "/explore/tour" : category === "experience" ? "/explore/experience" : "/explore";
  const title = category ? `${label} in Armenia | Revamp Vacations` : "Explore Armenia | Revamp Vacations";
  const description = category
    ? `Browse ${label.toLowerCase()} across Armenia on Revamp Vacations.`
    : "Browse places to stay, restaurants, and tours across Armenia on Revamp Vacations.";

  const bodyHtml = `
<h1>${escapeHtml(label)}</h1>
<p>${escapeHtml(description)}</p>
${listingGridHtml(filtered, origin)}`;

  return renderPageShell({
    title,
    description,
    canonical: `${origin}${canonicalPath}`,
    ogImage: `${origin}${OG_IMAGE}`,
    jsonLd: [buildCollectionPageJsonLd(origin, canonicalPath, title, filtered)],
    bodyHtml,
  });
}

function renderMap(catalog: PublicListing[], origin: string): string {
  const byRegion = new Map<string, PublicListing[]>();
  for (const listing of catalog) {
    const bucket = byRegion.get(listing.region) ?? [];
    bucket.push(listing);
    byRegion.set(listing.region, bucket);
  }

  const bodyHtml = `
<h1>Map — Revamp Vacations</h1>
<p>Every published listing, grouped by region. The interactive atlas itself needs JavaScript; here's the same listings as a directory.</p>
${Array.from(byRegion.entries())
  .map(([region, listings]) => `<section><h2>${escapeHtml(region)}</h2>${listingGridHtml(listings, origin)}</section>`)
  .join("\n")}`;

  return renderPageShell({
    title: "Map — Revamp Vacations",
    description: "Every published Revamp Vacations listing across Armenia, browsable by region.",
    canonical: `${origin}/map`,
    ogImage: `${origin}${OG_IMAGE}`,
    jsonLd: [buildCollectionPageJsonLd(origin, "/map", "Map — Revamp Vacations", catalog)],
    bodyHtml,
  });
}

function renderPlan(origin: string): string {
  const bodyHtml = `
<h1>AI Trip Planner</h1>
<p>Generate a day-by-day Armenia itinerary grounded in Revamp Vacations's live, published stay/eat/tour/experience catalog. Open <a href="${origin}/plan">the planner</a> to set trip length, starting city, traveler count, pace, budget, and interests.</p>`;

  return renderPageShell({
    title: "AI Trip Planner | Revamp Vacations",
    description: "Generate a day-by-day Armenia itinerary grounded in Revamp Vacations's live, published catalog.",
    canonical: `${origin}/plan`,
    ogImage: `${origin}${OG_IMAGE}`,
    bodyHtml,
  });
}

function renderAuthPage(origin: string, kind: "login" | "signup"): string {
  const title = kind === "login" ? "Sign in | Revamp Vacations" : "Sign up | Revamp Vacations";
  const description =
    kind === "login"
      ? "Sign in to your Revamp Vacations account to book, save places, or manage your listings."
      : "Create a Revamp Vacations account as a traveler or an operator.";
  const bodyHtml = `<h1>${kind === "login" ? "Sign in" : "Sign up"}</h1><p>${escapeHtml(description)}</p>`;

  return renderPageShell({
    title,
    description,
    canonical: `${origin}/${kind}`,
    ogImage: `${origin}${OG_IMAGE}`,
    bodyHtml,
  });
}

function renderListingDetail(listing: PublicListing, catalog: PublicListing[], origin: string): string {
  const canonicalPath = `/listing/${listing.slug}`;
  const title = `${listing.title} — ${typeLabels[listing.type]} in ${listing.city} | Revamp Vacations`;
  const categoryPath = listing.type === "stay" ? "/explore/stay" : listing.type === "eat" ? "/explore/eat" : listing.type === "experience" ? "/explore/experience" : "/explore/tour";
  const related = catalog.filter((item) => item.slug !== listing.slug && (item.type === listing.type || item.region === listing.region)).slice(0, 3);

  const factsHtml =
    listing.facts.length > 0
      ? `<dl>${listing.facts.map((fact) => `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>`).join("")}</dl>`
      : "";
  const amenitiesHtml = listing.amenities.length > 0 ? `<ul>${listing.amenities.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  const galleryHtml = [listing.image, ...listing.gallery]
    .filter((src, index, all) => all.indexOf(src) === index)
    .map((src) => `<img src="${escapeHtml(imgUrl(src, origin))}" alt="${escapeHtml(listing.title)}" />`)
    .join("\n");
  const tagsHtml = listing.tags.length > 0 ? `<p>${listing.tags.map((tag) => escapeHtml(tag)).join(", ")}</p>` : "";
  // "Itinerary" for experiences, "Highlights" for tours — same `highlights`
  // data; keep in sync with TourDetail.tsx's client-rendered heading.
  const highlightsHtml = listing.highlights?.length ? `<h2>${listing.type === "experience" ? "Itinerary" : "Highlights"}</h2><ul>${listing.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  const notIncludedHtml = listing.notIncluded?.length ? `<h2>Not included</h2><ul>${listing.notIncluded.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  const whatToBringHtml = listing.whatToBring?.length ? `<h2>What to bring</h2><ul>${listing.whatToBring.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  const notSuitableForHtml = listing.notSuitableFor?.length ? `<h2>Not suitable for</h2><ul>${listing.notSuitableFor.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  const importantInfoHtml = listing.importantInfo ? `<h2>Good to know</h2><p>${escapeHtml(listing.importantInfo)}</p>` : "";

  const bodyHtml = `
<nav aria-label="Breadcrumb">
<a href="${origin}/">Home</a> &gt;
<a href="${origin}/explore">Explore</a> &gt;
<a href="${origin}${categoryPath}">${escapeHtml(typeLabels[listing.type])}</a> &gt;
${escapeHtml(listing.title)}
</nav>
<h1>${escapeHtml(listing.title)}</h1>
<p>${escapeHtml(listing.eyebrow)} — ${escapeHtml(listing.city)}, ${escapeHtml(listing.region)}</p>
${galleryHtml}
<p>${escapeHtml(listing.shortDescription)}</p>
<p>${escapeHtml(listing.longDescription).replace(/\n/g, "<br>")}</p>
<p>${listing.price > 0 ? `${escapeHtml(listing.priceLabel)} / ${escapeHtml(listing.priceUnit)}` : escapeHtml(listing.priceLabel)}</p>
${factsHtml}
${highlightsHtml}
<h2>What's part of the experience</h2>
${amenitiesHtml}
${notIncludedHtml}
${whatToBringHtml}
${notSuitableForHtml}
${importantInfoHtml}
${tagsHtml}
<a href="${origin}/explore">Back to Explore</a>
${
  related.length > 0
    ? `<section><h2>Keep exploring</h2>${listingGridHtml(related, origin)}</section>`
    : ""
}`;

  return renderPageShell({
    title,
    description: listing.shortDescription,
    canonical: `${origin}${canonicalPath}`,
    ogImage: listingOg(listing.image, origin),
    jsonLd: [
      buildListingJsonLd(listing, origin),
      buildBreadcrumbJsonLd(origin, [
        { name: "Home", path: "/" },
        { name: "Explore", path: "/explore" },
        { name: typeLabels[listing.type], path: categoryPath },
        { name: listing.title, path: canonicalPath },
      ]),
    ],
    bodyHtml,
  });
}

function renderBlogIndex(posts: PublicPost[], origin: string): string {
  const cardsHtml =
    posts.length > 0
      ? posts
          .map(
            (p) => `<article>
<h2><a href="${origin}/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h2>
${p.coverImage ? `<img src="${escapeHtml(imgUrl(p.coverImage, origin))}" alt="${escapeHtml(p.title)}" />` : ""}
<p>${escapeHtml(p.excerpt || markdownToPlain(p.body))}</p>
</article>`,
          )
          .join("\n")
      : "<p>No posts yet — check back soon.</p>";

  const bodyHtml = `<h1>The Revamp Journal</h1>
<p>Stories, guides, and field notes from across Armenia.</p>
${cardsHtml}`;

  return renderPageShell({
    title: "The Revamp Journal | Revamp Vacations",
    description: "Stories, guides, and field notes from across Armenia — from the Revamp Vacations team.",
    canonical: `${origin}/blog`,
    ogImage: `${origin}${OG_IMAGE}`,
    jsonLd: [buildBlogListJsonLd(origin, posts)],
    bodyHtml,
  });
}

function renderBlogPost(post: PublicPost, origin: string): string {
  const canonicalPath = `/blog/${post.slug}`;
  const description = post.excerpt || markdownToPlain(post.body);
  // renderMarkdown() HTML-escapes its input before emitting a fixed set of
  // tags, so its output is safe to embed directly (same guarantee the React
  // page relies on) — no additional escaping here.
  const bodyHtml = `<nav aria-label="Breadcrumb"><a href="${origin}/">Home</a> &gt; <a href="${origin}/blog">Blog</a> &gt; ${escapeHtml(post.title)}</nav>
<article>
<h1>${escapeHtml(post.title)}</h1>
${post.publishedAt ? `<p><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(new Date(post.publishedAt).toISOString().slice(0, 10))}</time></p>` : ""}
${post.coverImage ? `<img src="${escapeHtml(imgUrl(post.coverImage, origin))}" alt="${escapeHtml(post.title)}" />` : ""}
${renderMarkdown(post.body)}
</article>
<a href="${origin}/blog">Back to the blog</a>`;

  return renderPageShell({
    title: `${post.title} | Revamp Vacations`,
    description,
    canonical: `${origin}${canonicalPath}`,
    ogImage: post.coverImage ? imgUrl(post.coverImage, origin) : `${origin}${OG_IMAGE}`,
    jsonLd: [
      buildArticleJsonLd(post, origin),
      buildBreadcrumbJsonLd(origin, [
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
        { name: post.title, path: canonicalPath },
      ]),
    ],
    bodyHtml,
  });
}

function renderNotFound(origin: string): string {
  const bodyHtml = `<h1>This path ends here.</h1><p>The page you're looking for doesn't exist or isn't published.</p><a href="${origin}/explore">Return to the marketplace</a>`;
  return renderPageShell({
    title: "Place not found | Revamp Vacations",
    description: "This listing or page could not be found.",
    canonical: `${origin}/404`,
    ogImage: `${origin}${OG_IMAGE}`,
    bodyHtml,
    robots: "noindex, follow",
  });
}
