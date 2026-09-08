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
import { getPublishedCatalog } from "./supabase.js";
import { brandAssets, regions, typeLabels } from "../shared/listings.js";
import type { ListingType } from "../shared/listings.js";
import { buildBreadcrumbJsonLd, buildCollectionPageJsonLd, buildListingJsonLd, buildWebsiteJsonLd } from "../shared/seo.js";

export type PageKind =
  | "home"
  | "explore"
  | "explore-category"
  | "tour-browser"
  | "map"
  | "plan"
  | "listing-detail"
  | "login"
  | "signup"
  | "not-found";

export interface MatchedRoute {
  kind: PageKind;
  category?: "stay" | "eat";
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
  if (path.startsWith("/explore/")) return { kind: "explore" }; // unrecognized category → unfiltered explore, not a 404
  if (path === "/map") return { kind: "map" };
  if (path === "/plan") return { kind: "plan" };
  if (path === "/login") return { kind: "login" };
  if (path === "/signup") return { kind: "signup" };
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
<a href="/explore/tour">Tours</a> ·
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

function listingCardHtml(listing: PublicListing, origin: string): string {
  return `<article>
<h3><a href="${origin}/listing/${escapeHtml(listing.slug)}">${escapeHtml(listing.title)}</a></h3>
<img src="${origin}${listing.image}" alt="${escapeHtml(listing.title)}" />
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
<h1>Revamp Travel — Discover Armenia</h1>
<p>Curated places to stay, Armenian restaurants, local tours, and memorable routes across Armenia.</p>
<section>
<h2>Browse by category</h2>
<ul>
<li><a href="${origin}/explore/stay">${typeLabels.stay} — places to stay</a></li>
<li><a href="${origin}/explore/eat">${typeLabels.eat} — restaurants</a></li>
<li><a href="${origin}/explore/tour">${typeLabels.tour} — guided tours</a></li>
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
    title: "Revamp Travel — Discover Armenia",
    description: "Curated places to stay, Armenian restaurants, local tours, and memorable routes across Armenia.",
    canonical: `${origin}/`,
    ogImage: `${origin}${brandAssets.hero}`,
    jsonLd: [buildWebsiteJsonLd(origin)],
    bodyHtml,
  });
}

function renderExplore(catalog: PublicListing[], origin: string, category: ListingType | undefined): string {
  const filtered = category ? catalog.filter((listing) => listing.type === category) : catalog;
  const label = category ? typeLabels[category] : "All listings";
  const canonicalPath = category === "stay" ? "/explore/stay" : category === "eat" ? "/explore/eat" : category === "tour" ? "/explore/tour" : "/explore";
  const title = category ? `${label} in Armenia | Revamp Travel` : "Explore Armenia | Revamp Travel";
  const description = category
    ? `Browse ${label.toLowerCase()} across Armenia on Revamp Travel.`
    : "Browse places to stay, restaurants, and tours across Armenia on Revamp Travel.";

  const bodyHtml = `
<h1>${escapeHtml(label)}</h1>
<p>${escapeHtml(description)}</p>
${listingGridHtml(filtered, origin)}`;

  return renderPageShell({
    title,
    description,
    canonical: `${origin}${canonicalPath}`,
    ogImage: `${origin}${brandAssets.hero}`,
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
<h1>Map — Revamp Travel</h1>
<p>Every published listing, grouped by region. The interactive atlas itself needs JavaScript; here's the same listings as a directory.</p>
${Array.from(byRegion.entries())
  .map(([region, listings]) => `<section><h2>${escapeHtml(region)}</h2>${listingGridHtml(listings, origin)}</section>`)
  .join("\n")}`;

  return renderPageShell({
    title: "Map — Revamp Travel",
    description: "Every published Revamp Travel listing across Armenia, browsable by region.",
    canonical: `${origin}/map`,
    ogImage: `${origin}${brandAssets.hero}`,
    jsonLd: [buildCollectionPageJsonLd(origin, "/map", "Map — Revamp Travel", catalog)],
    bodyHtml,
  });
}

function renderPlan(origin: string): string {
  const bodyHtml = `
<h1>AI Trip Planner</h1>
<p>Generate a day-by-day Armenia itinerary grounded in Revamp Travel's live, published stay/eat/tour catalog. Open <a href="${origin}/plan">the planner</a> to set trip length, starting city, traveler count, pace, budget, and interests.</p>`;

  return renderPageShell({
    title: "AI Trip Planner | Revamp Travel",
    description: "Generate a day-by-day Armenia itinerary grounded in Revamp Travel's live, published catalog.",
    canonical: `${origin}/plan`,
    ogImage: `${origin}${brandAssets.hero}`,
    bodyHtml,
  });
}

function renderAuthPage(origin: string, kind: "login" | "signup"): string {
  const title = kind === "login" ? "Sign in | Revamp Travel" : "Sign up | Revamp Travel";
  const description =
    kind === "login"
      ? "Sign in to your Revamp Travel account to book, save places, or manage your listings."
      : "Create a Revamp Travel account as a traveler or an operator.";
  const bodyHtml = `<h1>${kind === "login" ? "Sign in" : "Sign up"}</h1><p>${escapeHtml(description)}</p>`;

  return renderPageShell({
    title,
    description,
    canonical: `${origin}/${kind}`,
    ogImage: `${origin}${brandAssets.hero}`,
    bodyHtml,
  });
}

function renderListingDetail(listing: PublicListing, catalog: PublicListing[], origin: string): string {
  const canonicalPath = `/listing/${listing.slug}`;
  const title = `${listing.title} — ${typeLabels[listing.type]} in ${listing.city} | Revamp Travel`;
  const categoryPath = listing.type === "stay" ? "/explore/stay" : listing.type === "eat" ? "/explore/eat" : "/explore/tour";
  const related = catalog.filter((item) => item.slug !== listing.slug && (item.type === listing.type || item.region === listing.region)).slice(0, 3);

  const factsHtml =
    listing.facts.length > 0
      ? `<dl>${listing.facts.map((fact) => `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>`).join("")}</dl>`
      : "";
  const amenitiesHtml = listing.amenities.length > 0 ? `<ul>${listing.amenities.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  const galleryHtml = [listing.image, ...listing.gallery]
    .filter((src, index, all) => all.indexOf(src) === index)
    .map((src) => `<img src="${origin}${src}" alt="${escapeHtml(listing.title)}" />`)
    .join("\n");
  const tagsHtml = listing.tags.length > 0 ? `<p>${listing.tags.map((tag) => escapeHtml(tag)).join(", ")}</p>` : "";

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
<p>${escapeHtml(listing.longDescription)}</p>
<p>${listing.price > 0 ? `${escapeHtml(listing.priceLabel)} / ${escapeHtml(listing.priceUnit)}` : escapeHtml(listing.priceLabel)} — online booking and payment are launching soon.</p>
${factsHtml}
<h2>What's part of the experience</h2>
${amenitiesHtml}
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
    ogImage: `${origin}${listing.image}`,
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

function renderNotFound(origin: string): string {
  const bodyHtml = `<h1>This path ends here.</h1><p>The page you're looking for doesn't exist or isn't published.</p><a href="${origin}/explore">Return to the marketplace</a>`;
  return renderPageShell({
    title: "Place not found | Revamp Travel",
    description: "This listing or page could not be found.",
    canonical: `${origin}/404`,
    ogImage: `${origin}${brandAssets.hero}`,
    bodyHtml,
    robots: "noindex, follow",
  });
}
