/**
 * Per-region landing pages for every product type, mirroring the Eat guide's
 * /eat/:region pages for consistency + SEO. One reusable renderer keyed by
 * (type, region):
 *   /stay/:region        → "Where to stay in {Region}"
 *   /tour/:region        → "Tours & day trips in {Region}"
 *   /experience/:region  → "Experiences in {Region}"
 *   /visit/:region       → "Places to visit in {Region}"  (listing type "place")
 *
 * Grounded, factual intros (no fabricated claims). Pages only exist where real
 * listings do — an empty (type, region) combo renders a 404 and is set noindex,
 * so we never publish thin pages. Cross-links to sibling regions + the other
 * things to do in the same region keep the internal-link graph dense.
 */
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ListingCard } from "@/components/ListingCard";
import { TourCard } from "@/components/TourCard";
import NotFound from "@/pages/NotFound";
import { slugify } from "@/lib/slug";
import { normalizeRegion } from "@/lib/region";
import { ARMENIA_REGIONS, type ListingType } from "@shared/listings";
import { buildCollectionPageJsonLd, buildBreadcrumbJsonLd } from "@shared/seo";

export type LandingType = "stay" | "tour" | "experience" | "place";

const COPY: Record<LandingType, { eyebrow: string; h1: (r: string) => string; noun: string; nounOne: string; browse: string; browseLabel: string }> = {
  stay: { eyebrow: "Stays · by area", h1: (r) => `Where to stay in ${r}`, noun: "places to stay", nounOne: "place to stay", browse: "/explore/stay", browseLabel: "All stays" },
  tour: { eyebrow: "Tours · by area", h1: (r) => `Tours & day trips in ${r}`, noun: "tours", nounOne: "tour", browse: "/explore/tour", browseLabel: "All tours" },
  experience: { eyebrow: "Experiences · by area", h1: (r) => `Experiences in ${r}`, noun: "experiences", nounOne: "experience", browse: "/explore/experience", browseLabel: "All experiences" },
  place: { eyebrow: "Visit · by area", h1: (r) => `Places to visit in ${r}`, noun: "places to visit", nounOne: "place to visit", browse: "/explore/place", browseLabel: "All places to visit" },
};

/** Route segment used in landing URLs for a listing type. */
export const LANDING_PATH: Record<LandingType, string> = { stay: "stay", tour: "tour", experience: "experience", place: "visit" };

function resolveRegion(slug: string): string | null {
  return ARMENIA_REGIONS.find((r) => slugify(r) === slug) ?? null;
}

function proseList(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

const sameRegion = (l: LiveListing, label: string) => normalizeRegion(l.region || "").toLowerCase() === normalizeRegion(label).toLowerCase();

export default function RegionLanding({ type, region }: { type: LandingType; region: string }) {
  const { publicListings: listings, loading } = useListings();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const label = resolveRegion(region);
  const copy = COPY[type];
  const path = `/${LANDING_PATH[type]}/${region}`;

  const items = label ? listings.filter((l) => l.type === type && sameRegion(l, label)) : [];
  const examples = items.slice(0, 3).map((l) => l.title);
  const empty = !loading && (!label || items.length === 0);

  const title = label && !empty ? `${copy.h1(label)} | Revamp Vacations` : "Not found | Revamp Vacations";
  const description = label
    ? `${label} has ${items.length} ${items.length === 1 ? copy.nounOne : copy.noun} on Revamp${examples.length ? `, including ${proseList(examples)}` : ""}. Hand-picked, honest listings.`.slice(0, 155)
    : "";

  useDocumentMeta({
    title,
    description,
    canonicalPath: path,
    noindex: empty,
    jsonLd: label && !empty
      ? [
          buildCollectionPageJsonLd(origin, path, copy.h1(label), items),
          buildBreadcrumbJsonLd(origin, [
            { name: "Home", path: "/" },
            { name: copy.browseLabel, path: copy.browse },
            { name: label, path },
          ]),
        ]
      : undefined,
  });

  if (empty) return <NotFound />;

  // Sibling regions that also have this type (for cross-links).
  const otherRegions = ARMENIA_REGIONS.filter(
    (r) => r !== label && listings.some((l) => l.type === type && sameRegion(l, r)),
  );
  // Other product types present in THIS region (for the "also here" strip).
  const alsoHere = (["stay", "eat", "tour", "experience", "place"] as ListingType[])
    .filter((t) => t !== type && label && listings.some((l) => l.type === t && sameRegion(l, label)));
  const typePath = (t: ListingType): string =>
    t === "eat" ? `/eat/${slugify(label!)}` : `/${LANDING_PATH[t as LandingType]}/${slugify(label!)}`;
  const typeWord: Record<ListingType, string> = { stay: "Stays", eat: "Restaurants", tour: "Tours", experience: "Experiences", place: "Places to visit" };

  const usesTourCard = type === "tour" || type === "experience";

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-8 lg:py-12">
        <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-apricot">Home</Link><span>›</span>
          <Link href={copy.browse} className="hover:text-apricot">{copy.browseLabel}</Link><span>›</span>
          <span className="font-semibold text-basalt">{label}</span>
        </nav>

        <header className="mt-5 max-w-3xl">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1 className="mt-3 font-display text-[3rem] leading-[0.95] tracking-[-0.04em] sm:text-6xl">{copy.h1(label!)}</h1>
          <p className="mt-6 text-lg leading-8 text-basalt/85">{description}</p>
        </header>

        <section className="mt-10">
          {usesTourCard ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((l) => <TourCard key={l.id} listing={l} surface="region" />)}
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((l) => <ListingCard key={l.id} listing={l} surface="region" />)}
            </div>
          )}
        </section>

        {alsoHere.length > 0 && (
          <section className="mt-14 border-t border-basalt/10 pt-8">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Also in {label}</h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {alsoHere.map((t) => (
                <Link key={t} href={typePath(t)} className="rounded-none border border-basalt/15 px-3.5 py-2 text-sm hover:border-apricot hover:text-apricot">{typeWord[t]} in {label}</Link>
              ))}
            </div>
          </section>
        )}

        {otherRegions.length > 0 && (
          <section className="mt-12">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">{copy.browseLabel.replace("All ", "")} in other regions</h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {otherRegions.map((r) => (
                <Link key={r} href={`/${LANDING_PATH[type]}/${slugify(r)}`} className="rounded-none border border-basalt/15 px-3.5 py-2 text-sm hover:border-apricot hover:text-apricot">{r}</Link>
              ))}
            </div>
          </section>
        )}

        <div className="mt-12">
          <Link href={copy.browse} className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-apricot hover:text-basalt">
            {copy.browseLabel} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
