/**
 * Per-region landing pages — /stay/:region, /tour/:region, /experience/:region,
 * /visit/:region (listing type "place"). Shared by the React page
 * (client/src/pages/RegionLanding.tsx), the bot prerender (server/prerender.ts)
 * and the sitemap, so people, Google and AI crawlers always get the same page —
 * and a page only exists (200 + in the sitemap) where real listings do.
 *
 * History: until 2026-10-15 only the React page knew these routes, so crawlers
 * got the prerender's 404 for every one of them. Any new landing type must be
 * added HERE, not in one of the three consumers.
 */
import { ARMENIA_REGIONS, PLACE_CATEGORIES, type ListingType } from "./listings.js";
import { compareEatListings, type EatSortable } from "./eat.js";
import { slugify } from "./slug.js";

export type LandingType = "stay" | "tour" | "experience" | "place";
export const LANDING_TYPES: LandingType[] = ["stay", "tour", "experience", "place"];

export const LANDING_COPY: Record<LandingType, { eyebrow: string; h1: (r: string) => string; noun: string; nounOne: string; browse: string; browseLabel: string }> = {
  stay: { eyebrow: "Stays · by area", h1: (r) => `Where to stay in ${r}`, noun: "places to stay", nounOne: "place to stay", browse: "/explore/stay", browseLabel: "All stays" },
  tour: { eyebrow: "Tours · by area", h1: (r) => `Tours & day trips in ${r}`, noun: "tours", nounOne: "tour", browse: "/explore/tour", browseLabel: "All tours" },
  experience: { eyebrow: "Experiences · by area", h1: (r) => `Experiences in ${r}`, noun: "experiences", nounOne: "experience", browse: "/explore/experience", browseLabel: "All experiences" },
  place: { eyebrow: "Visit · by area", h1: (r) => `Places to visit in ${r}`, noun: "places to visit", nounOne: "place to visit", browse: "/explore/place", browseLabel: "All places to visit" },
};

/** Route segment used in landing URLs for a listing type. */
export const LANDING_PATH: Record<LandingType, string> = { stay: "stay", tour: "tour", experience: "experience", place: "visit" };

/** "/stay/yerevan" → { type: "stay", slug: "yerevan" }; anything else → null. */
export function matchLandingPath(path: string): { type: LandingType; slug: string } | null {
  const m = path.match(/^\/(stay|tour|experience|visit)\/([^/]+)$/);
  if (!m) return null;
  const type = (m[1] === "visit" ? "place" : m[1]) as LandingType;
  return { type, slug: decodeURIComponent(m[2]) };
}

/** Strip the "Province"/"Marz" suffix (same rule as client/src/lib/region.ts). */
export function normalizeRegion(region: string): string {
  return (region || "").trim().replace(/\s+(province|marz)$/i, "").trim();
}

/** A landing page's region, only from the official list ("tavush" → "Tavush"). */
export function resolveLandingRegion(slug: string): string | null {
  return ARMENIA_REGIONS.find((r) => slugify(r) === slug) ?? null;
}

export function inRegion(l: { region?: string | null }, label: string): boolean {
  return normalizeRegion(l.region || "").toLowerCase() === normalizeRegion(label).toLowerCase();
}

export function landingItems<T extends { type: string; region?: string | null }>(listings: T[], type: LandingType, label: string): T[] {
  const items = listings.filter((l) => l.type === type && inRegion(l, label));
  // Places are admin-curated (pin + curation rank), same order as the Visit guide.
  return type === "place" ? items.sort((a, b) => compareEatListings(a as unknown as EatSortable, b as unknown as EatSortable)) : items;
}

export function proseList(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

/** The page's factual intro (counts + real titles only) — shown in full on the page. */
export function landingDescription(type: LandingType, label: string, items: { title: string }[]): string {
  const copy = LANDING_COPY[type];
  const examples = items.slice(0, 3).map((l) => l.title);
  return `${label} has ${items.length} ${items.length === 1 ? copy.nounOne : copy.noun} on Revamp${examples.length ? `, including ${proseList(examples)}` : ""}. Hand-picked, honest listings.`;
}

/** Search-snippet length (~155), cut at a word boundary with "…", never mid-word. */
export function clipMeta(text: string, max = 155): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 80 ? cut.slice(0, at) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

/** Every landing page that has at least one listing — for the sitemap. */
export function populatedLandingPaths(listings: { type: string; region?: string | null }[]): string[] {
  const out: string[] = [];
  for (const type of LANDING_TYPES) {
    for (const r of ARMENIA_REGIONS) {
      if (landingItems(listings, type, r).length) out.push(`/${LANDING_PATH[type]}/${slugify(r)}`);
    }
  }
  return out;
}

/** Sibling regions with this type, and other types in this region (cross-links). */
export function landingCrossLinks(listings: { type: string; region?: string | null }[], type: LandingType, label: string) {
  const otherRegions = ARMENIA_REGIONS.filter((r) => r !== label && landingItems(listings, type, r).length > 0);
  const alsoHere = (["stay", "eat", "tour", "experience", "place"] as ListingType[]).filter(
    (t) => t !== type && listings.some((l) => l.type === t && inRegion(l, label)),
  );
  const typePath = (t: ListingType): string => (t === "eat" ? `/eat/${slugify(label)}` : `/${LANDING_PATH[t as LandingType]}/${slugify(label)}`);
  return { otherRegions, alsoHere, typePath };
}

export const TYPE_WORD: Record<ListingType, string> = { stay: "Stays", eat: "Restaurants", tour: "Tours", experience: "Experiences", place: "Places to visit" };

// ── Visit-guide category pages: /visit/museums, /visit/coworking, … ──────────
// Same rules as the region pages: one definition shared by the React page
// (PlaceCategoryLanding.tsx), the bot prerender and the sitemap; a page exists
// only when real published places of that kind do. URL = the category's `hub`
// (shared/listings.ts PLACE_CATEGORIES), never a region slug — so /visit/<x>
// is a category page when <x> is a hub, otherwise a region page.

export type PlaceCategoryHub = (typeof PLACE_CATEGORIES)[number];

export function resolvePlaceCategoryHub(slug: string): PlaceCategoryHub | null {
  return PLACE_CATEGORIES.find((c) => c.hub === slug) ?? null;
}

/** "/visit/museums" → the category; anything else (incl. /visit/yerevan) → null. */
export function matchPlaceCategoryPath(path: string): PlaceCategoryHub | null {
  const m = path.match(/^\/visit\/([^/]+)$/);
  return m ? resolvePlaceCategoryHub(decodeURIComponent(m[1])) : null;
}

export const placeCategoryPath = (c: PlaceCategoryHub): string => `/visit/${c.hub}`;
export const placeCategoryH1 = (c: PlaceCategoryHub): string => `${c.plural} in Armenia`;

/** Published places of one kind, in the Visit guide's own order (pin + curation rank). */
export function placeCategoryItems<T extends { type: string; category?: string | null }>(listings: T[], c: PlaceCategoryHub): T[] {
  return listings
    .filter((l) => l.type === "place" && l.category === c.slug)
    .sort((a, b) => compareEatListings(a as unknown as EatSortable, b as unknown as EatSortable));
}

/** "Museums" → "museums", but acronyms stay ("ATMs & banks"). */
const lowerNoun = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** Factual intro: the count, the real cities and real names only. */
export function placeCategoryDescription(c: PlaceCategoryHub, items: { title: string; city?: string | null }[]): string {
  const n = items.length;
  const noun = n === 1 ? lowerNoun(c.label) : lowerNoun(c.plural);
  const cities = Array.from(new Set(items.map((l) => (l.city || "").trim()).filter(Boolean)));
  const where = cities.length ? ` in ${proseList(cities.slice(0, 4))}${cities.length > 4 ? " and more" : ""}` : "";
  const examples = items.slice(0, 3).map((l) => l.title);
  return `${n} ${noun}${where} on Revamp's Visit guide${examples.length ? `, including ${proseList(examples)}` : ""}. Hand-picked, honest listings.`;
}

/** Every category page that has at least one place — for the sitemap. */
export function populatedPlaceCategoryPaths(listings: { type: string; category?: string | null }[]): string[] {
  return PLACE_CATEGORIES.filter((c) => placeCategoryItems(listings, c).length > 0).map(placeCategoryPath);
}

/** Other categories with places (cross-links) and the regions that have this kind. */
export function placeCategoryCrossLinks(listings: { type: string; category?: string | null; region?: string | null }[], c: PlaceCategoryHub) {
  const otherCategories = PLACE_CATEGORIES.filter((o) => o.slug !== c.slug && placeCategoryItems(listings, o).length > 0);
  const regions = ARMENIA_REGIONS.filter((r) => listings.some((l) => l.type === "place" && l.category === c.slug && inRegion(l, r)));
  return { otherCategories, regions };
}

