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
      price: listing.price,
      priceCurrency: "USD",
      url,
    };
    if (listing.type === "stay" || listing.type === "eat") {
      base.priceRange = listing.priceLabel;
    }
  }

  return base;
}

/** Site-wide structured data for the home page. */
export function buildWebsiteJsonLd(origin: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Revamp Travel",
    url: origin,
    potentialAction: {
      "@type": "SearchAction",
      target: `${origin}/explore?query={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
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
