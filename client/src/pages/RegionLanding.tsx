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
import { buildCollectionPageJsonLd, buildBreadcrumbJsonLd } from "@shared/seo";
import {
  LANDING_COPY as COPY,
  matchPlaceCategoryPath,
  populatedPlaceCategoryPaths,
  LANDING_PATH,
  TYPE_WORD,
  landingCrossLinks,
  clipMeta,
  landingDescription,
  landingItems,
  resolveLandingRegion,
  type LandingType,
} from "@shared/regionLanding";

export { LANDING_PATH, type LandingType };

export default function RegionLanding({ type, region }: { type: LandingType; region: string }) {
  const { publicListings: listings, loading } = useListings();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const label = resolveLandingRegion(region);
  const copy = COPY[type];
  const path = `/${LANDING_PATH[type]}/${region}`;

  const items: LiveListing[] = label ? landingItems(listings, type, label) : [];
  const empty = !loading && (!label || items.length === 0);

  const title = label && !empty ? `${copy.h1(label)} | Revamp Vacations` : "Not found | Revamp Vacations";
  // No count until the listings have loaded (it would read "0 places").
  const description = label && !loading ? landingDescription(type, label, items) : "";

  useDocumentMeta({
    title,
    description: clipMeta(description),
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

  // Sibling regions that also have this type, and other types in this region (cross-links).
  const { otherRegions, alsoHere, typePath } = landingCrossLinks(listings, type, label!);
  const typeWord = TYPE_WORD;

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
          {loading ? (
            <div className="mt-6 h-8 max-w-xl animate-pulse bg-chalk" aria-hidden />
          ) : (
            <p className="mt-6 text-lg leading-8 text-basalt/85">{description}</p>
          )}
        </header>

        <section className="mt-10" aria-busy={loading}>
          {loading ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading listings">
              {[0, 1, 2].map((i) => <div key={i} className="aspect-[4/3] animate-pulse bg-chalk" />)}
            </div>
          ) : usesTourCard ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((l) => <TourCard key={l.id} listing={l} surface="region" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
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

        {type === "place" && populatedPlaceCategoryPaths(items).length > 0 && (
          <section className="mt-12">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">By type, across Armenia</h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {populatedPlaceCategoryPaths(items).map((p) => (
                <Link key={p} href={p} className="rounded-none border border-basalt/15 px-3.5 py-2 text-sm hover:border-apricot hover:text-apricot">{matchPlaceCategoryPath(p)!.plural}</Link>
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
