/**
 * Structured-data (schema.org JSON-LD) builders shared by the client's
 * per-page `<head>` hook (`client/src/hooks/useDocumentMeta.ts`) and the
 * server's bot-facing prerenderer (`server/prerender.ts`) — one place to
 * assemble this data so the "never fabricate customer ratings/reviews"
 * product rule only needs auditing in one file, not two.
 *
 * Every field below comes straight from a real `Listing`/catalog value.
 * NONE of these builders ever sets `aggregateRating`, `review`,
 * `ratingValue`, or a review/rating count — there is no real ratings data
 * anywhere in this app (see CLAUDE.md's "Customer content" rule), and
 * schema.org markup is exactly the kind of thing that rule has to cover,
 * not just visible page text. If you're tempted to add one of those
 * fields because a search engine's rich-result docs mention it, don't —
 * it would be inventing a customer rating.
 */
import type { Listing, ListingType } from "./listings.js";

type JsonLd = Record<string, unknown>;

const SCHEMA_TYPE_BY_LISTING_TYPE: Record<ListingType, string> = {
  stay: "LodgingBusiness",
  eat: "Restaurant",
  tour: "TouristTrip",
  experience: "Service",
};

/** Structured data for one listing-detail page. */
export function buildListingJsonLd(listing: Listing, origin: string): JsonLd {
  const url = `${origin}/listing/${listing.slug}`;
  const images = [listing.image, ...listing.gallery].filter((src, index, all) => all.indexOf(src) === index).map((src) => absoluteUrl(src, origin));

  const base: JsonLd = {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPE_BY_LISTING_TYPE[listing.type],
    name: listing.title,
    description: listing.shortDescription,
    image: images,
    url,
    address: {
      "@type": "PostalAddress",
      addressLocality: listing.city,
      addressRegion: listing.region,
      addressCountry: "AM",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: listing.coordinates.lat,
      longitude: listing.coordinates.lng,
    },
  };

  // Only publish a price when there's a real one. A listing with no price is
  // shown as "Rate on request" everywhere in the UI (see ListingsContext's
  // priceLabel) — emitting `price: 0` here would fabricate a $0/free rate,
  // which the "never show $0" decision explicitly forbids. When present, this
  // is illustrative pricing, not a live bookable rate (Milestone A collects no
  // payment) — Offer is still the correct schema.org shape for "this is what
  // it costs," it just isn't paired with an availability claim.
  if (listing.price > 0) {
    base.offers = {
      "@type": "Offer",
      price: Math.round(listing.price),
      priceCurrency: "AMD",
      url,
    };
    if (listing.type === "stay" || listing.type === "eat") {
      base.priceRange = listing.priceLabel;
    }
  }

  // Amenities → LocationFeatureSpecification (rich results + clean facts for AI).
  if (listing.amenities?.length) {
    base.amenityFeature = listing.amenities.slice(0, 40).map((name) => ({ "@type": "LocationFeatureSpecification", name, value: true }));
  }

  const fact = (...labels: string[]) => listing.facts?.find((f) => labels.includes(f.label.toLowerCase()))?.value?.trim();

  if (listing.type === "stay") {
    const checkin = fact("check-in");
    const checkout = fact("checkout");
    if (checkin) base.checkinTime = checkin;
    if (checkout) base.checkoutTime = checkout;
    if (listing.maxGuests) base.occupancy = { "@type": "QuantitativeValue", maxValue: listing.maxGuests };
  }

  // Tours/experiences: publish the itinerary/highlights as an ordered list.
  if ((listing.type === "tour" || listing.type === "experience") && listing.highlights?.length) {
    base.itinerary = {
      "@type": "ItemList",
      itemListElement: listing.highlights.slice(0, 30).map((name, i) => ({ "@type": "ListItem", position: i + 1, name })),
    };
    const duration = fact("duration");
    if (duration) base.tourDuration = duration;
  }

  return base;
}

/**
 * Site-wide Organization entity. The single strongest "who is this brand"
 * signal for Google's Knowledge Graph and for AI answer engines deciding
 * whether "Revamp Vacations" is a real, citable entity. Emitted on the home
 * page. No fabricated ratings/review counts (see the file header).
 */
export function buildOrganizationJsonLd(origin: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Revamp Vacations",
    legalName: "Revamp Hospitality LLC",
    url: origin,
    logo: `${origin}/images/og-cover.jpg`,
    image: `${origin}/images/og-cover.jpg`,
    description: "Armenia's travel marketplace — curated places to stay, Armenian tables, and local tours and experiences across the country.",
    email: "hello@revampvacations.com",
    areaServed: { "@type": "Country", name: "Armenia" },
    sameAs: ["https://www.instagram.com/revamphomes_yerevan"],
  };
}

/** Site-wide structured data for the home page. */
export function buildWebsiteJsonLd(origin: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Revamp Vacations",
    url: origin,
    potentialAction: {
      "@type": "SearchAction",
      target: `${origin}/explore?query={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/** FAQPage structured data — heavily used by Google rich results and by AI
 *  answer engines, which quote Q&A directly. Items are the shared FAQ_ITEMS. */
export function buildFaqJsonLd(items: { q: string; a: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

/** Structured data for a listing-grid page (explore, tours, map). */
export function buildCollectionPageJsonLd(origin: string, path: string, title: string, listings: Listing[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: `${origin}${path}`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: listings.map((listing, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${origin}/listing/${listing.slug}`,
        name: listing.title,
      })),
    },
  };
}

/** Breadcrumb trail structured data, used on listing-detail pages. */
export function buildBreadcrumbJsonLd(origin: string, crumbs: { name: string; path: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${origin}${crumb.path}`,
    })),
  };
}

function absoluteUrl(src: string, origin: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${origin}${src.startsWith("/") ? "" : "/"}${src}`;
}

/** Structured data for a single blog post (no rating/review fields — see header). */
export function buildArticleJsonLd(
  post: { slug: string; title: string; excerpt: string; coverImage: string; publishedAt: string | null; updatedAt: string },
  origin: string,
): JsonLd {
  const jsonLd: JsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    url: `${origin}/blog/${post.slug}`,
    mainEntityOfPage: `${origin}/blog/${post.slug}`,
    publisher: { "@type": "Organization", name: "Revamp Vacations" },
  };
  if (post.excerpt) jsonLd.description = post.excerpt;
  if (post.coverImage) jsonLd.image = absoluteUrl(post.coverImage, origin);
  if (post.publishedAt) jsonLd.datePublished = post.publishedAt;
  if (post.updatedAt) jsonLd.dateModified = post.updatedAt;
  return jsonLd;
}

/** Structured data for the blog index (list of posts). */
export function buildBlogListJsonLd(origin: string, posts: { slug: string; title: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "The Revamp Journal",
    url: `${origin}/blog`,
    blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${origin}/blog/${p.slug}` })),
  };
}
