/**
 * Which Revamp site a server request is for — the server-side twin of
 * client/src/contexts/SiteContext.tsx. Both domains hit the same Express app
 * (Netlify domain alias), so the public crawl surfaces (sitemap, llms.txt,
 * bot prerender) decide by hostname which listings to expose.
 *
 * ZERO-REGRESSION CONTRACT: anything that isn't a revampstay.* host is
 * "vacations", and filterForSite("vacations", …) keeps TODAY's output exactly —
 * every non-stay type always, and every stay that carries the nightly offer
 * (which every existing row does by default). See REVAMPSTAY-ARCHITECTURE.md §4.
 */
import { visibleOnStay, visibleOnVacations, type ListingType, type OfferType } from "../shared/listings.js";

export type Site = "vacations" | "stay";

/** Resolve the site from a Host header (port and case ignored). */
export function siteFromHost(host: string | undefined): Site {
  const h = (host || "").toLowerCase().replace(/:\d+$/, "");
  return /(^|\.)revampstay\.(com|test|localhost)$/.test(h) ? "stay" : "vacations";
}

/** Filter a published catalog to what the given site shows. */
export function filterForSite<T extends { type: ListingType; offerTypes?: OfferType[] | null }>(site: Site, catalog: T[]): T[] {
  return site === "stay" ? catalog.filter(visibleOnStay) : catalog.filter(visibleOnVacations);
}
