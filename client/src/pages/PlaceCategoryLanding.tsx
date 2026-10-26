/**
 * Visit-guide category pages — /visit/museums, /visit/coworking, /visit/gift-shops, …
 * ("Museums in Armenia"). Phase 3 of the Visit guide, same pattern as the Eat
 * pages and the region pages: logic in shared/regionLanding.ts (shared with the
 * bot prerender and the sitemap), a factual intro (count, real cities, real
 * names), CollectionPage + breadcrumb JSON-LD, and a real 404 (noindex) when no
 * published place of that kind exists — never a thin page.
 */
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ListingCard } from "@/components/ListingCard";
import NotFound from "@/pages/NotFound";
import { slugify } from "@/lib/slug";
import { buildCollectionPageJsonLd, buildBreadcrumbJsonLd } from "@shared/seo";
import {
  clipMeta,
  placeCategoryCrossLinks,
  placeCategoryDescription,
  placeCategoryH1,
  placeCategoryItems,
  placeCategoryPath,
  resolvePlaceCategoryHub,
} from "@shared/regionLanding";

const BROWSE = "/explore/place";
const BROWSE_LABEL = "All places to visit";

export default function PlaceCategoryLanding({ hub }: { hub: string }) {
  const { publicListings: listings, loading } = useListings();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const cat = resolvePlaceCategoryHub(hub);
  const items: LiveListing[] = cat ? placeCategoryItems(listings, cat) : [];
  const empty = !loading && (!cat || items.length === 0);
  const h1 = cat ? placeCategoryH1(cat) : "";
  const path = cat ? placeCategoryPath(cat) : `/visit/${hub}`;
  // No count until the listings have loaded (it would read "0 museums").
  const description = cat && !loading ? placeCategoryDescription(cat, items) : "";

  useDocumentMeta({
    title: cat && !empty ? `${h1} | Revamp Vacations` : "Not found | Revamp Vacations",
    description: clipMeta(description),
    canonicalPath: path,
    noindex: empty,
    jsonLd:
      cat && !empty
        ? [
            buildCollectionPageJsonLd(origin, path, h1, items),
            buildBreadcrumbJsonLd(origin, [
              { name: "Home", path: "/" },
              { name: BROWSE_LABEL, path: BROWSE },
              { name: cat.plural, path },
            ]),
          ]
        : undefined,
  });

  if (empty || !cat) return empty ? <NotFound /> : null;
  const { otherCategories, regions } = placeCategoryCrossLinks(listings, cat);

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-8 lg:py-12">
        <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-apricot">Home</Link><span>›</span>
          <Link href={BROWSE} className="hover:text-apricot">{BROWSE_LABEL}</Link><span>›</span>
          <span className="font-semibold text-basalt">{cat.plural}</span>
        </nav>

        <header className="mt-5 max-w-3xl">
          <p className="eyebrow">Visit · by type</p>
          <h1 className="mt-3 font-display text-[3rem] leading-[0.95] tracking-[-0.04em] sm:text-6xl">{h1}</h1>
          {loading ? (
            <div className="mt-6 h-8 max-w-xl animate-pulse bg-chalk" aria-hidden />
          ) : (
            <p className="mt-6 text-lg leading-8 text-basalt/85">{description}</p>
          )}
        </header>

        <section className="mt-10" aria-busy={loading}>
          {loading ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading places">
              {[0, 1, 2].map((i) => <div key={i} className="aspect-[4/3] animate-pulse bg-chalk" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((l) => <ListingCard key={l.id} listing={l} surface="region" />)}
            </div>
          )}
        </section>

        {regions.length > 0 && (
          <section className="mt-14 border-t border-basalt/10 pt-8">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Places to visit by area</h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {regions.map((r) => (
                <Link key={r} href={`/visit/${slugify(r)}`} className="rounded-none border border-basalt/15 px-3.5 py-2 text-sm hover:border-apricot hover:text-apricot">{r}</Link>
              ))}
            </div>
          </section>
        )}

        {otherCategories.length > 0 && (
          <section className="mt-12">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">More to visit in Armenia</h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {otherCategories.map((c) => (
                <Link key={c.slug} href={placeCategoryPath(c)} className="rounded-none border border-basalt/15 px-3.5 py-2 text-sm hover:border-apricot hover:text-apricot">{c.plural}</Link>
              ))}
            </div>
          </section>
        )}

        <div className="mt-12">
          <Link href={BROWSE} className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-apricot hover:text-basalt">
            {BROWSE_LABEL} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
