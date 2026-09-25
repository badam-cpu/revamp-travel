/**
 * Eat landing pages — SEO/GEO hubs that target real "where to eat" searches:
 *   /eat/:region          → "Where to eat in {Region}"
 *   /eat/cuisine/:cuisine  → "The best {Cuisine} in Armenia"
 *
 * Unlike the interactive /explore/eat guide, these are content-first, indexable
 * pages: an editorial intro grounded in the live data, the curated spots, and —
 * for a region — cross-links to nearby bookable stays/tours (the funnel from
 * free food content into revenue). Emits CollectionPage + BreadcrumbList JSON-LD
 * so Google and AI answer engines can cite them. Every restaurant carries
 * Restaurant structured data via its own listing page.
 */
import { useState } from "react";
import { Link } from "wouter";
import { UtensilsCrossed } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ListingCard } from "@/components/ListingCard";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";
import { Button } from "@/components/ui/button";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { buildCollectionPageJsonLd, buildBreadcrumbJsonLd } from "@shared/seo";
import { ARMENIA_REGIONS } from "@shared/listings";
import { compareEatListings, bestEatRating } from "@shared/eat";
import { EAT_CATEGORIES } from "@/lib/eatCategories";
import { slugify } from "@/lib/slug";

const normalizeRegion = (r: string) => r.trim().replace(/\s+(province|marz)$/i, "").trim();

/** Resolve a URL slug back to its canonical region / cuisine label. */
function resolveRegion(slug: string): string | null {
  return ARMENIA_REGIONS.find((r) => slugify(r) === slug) ?? null;
}
function resolveCuisine(slug: string): string | null {
  return EAT_CATEGORIES.find((c) => slugify(c) === slug) ?? null;
}

/** Naive English pluralizer for venue-type nouns in the intro prose. */
function pluralize(w: string): string {
  if (/(s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/** Join a list into readable prose ("a, b and c"). */
function proseList(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length <= 1) return clean.join("");
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

const PAGE_SIZE = 12;

export default function EatLanding({ mode, value }: { mode: "region" | "cuisine"; value: string }) {
  const { listings, loading } = useListings();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [visible, setVisible] = useState(PAGE_SIZE);

  const label = mode === "region" ? resolveRegion(value) : resolveCuisine(value);
  const path = mode === "region" ? `/eat/${value}` : `/eat/cuisine/${value}`;

  const allEats = listings.filter((l) => l.type === "eat");
  const eats: LiveListing[] = (
    mode === "region"
      ? allEats.filter((l) => normalizeRegion(l.region || "").toLowerCase() === normalizeRegion(label || "").toLowerCase())
      : allEats.filter((l) => (l.cuisine || "").trim().toLowerCase() === (label || "").toLowerCase())
  )
    .slice()
    .sort(compareEatListings); // featured + editor rank first (admin curation)

  // For a region, pull nearby bookable inventory to cross-link into.
  const nearbyStays = mode === "region" ? listings.filter((l) => l.type === "stay" && normalizeRegion(l.region || "").toLowerCase() === normalizeRegion(label || "").toLowerCase()).slice(0, 3) : [];
  const nearbyTours = mode === "region" ? listings.filter((l) => (l.type === "tour" || l.type === "experience") && normalizeRegion(l.region || "").toLowerCase() === normalizeRegion(label || "").toLowerCase()).slice(0, 3) : [];

  const title = mode === "region" ? `Where to eat in ${label}` : `The best ${label} food in Armenia`;

  // Editorial intro, grounded in the live data so each page is genuinely unique.
  const venueTypes = Array.from(new Set(eats.map((l) => l.venueType).filter(Boolean) as string[]));
  const examples = eats.slice(0, 3).map((l) => l.title);
  const intro =
    eats.length > 0
      ? mode === "region"
        ? `${label}'s dining runs from ${proseList(venueTypes.slice(0, 3).map((t) => pluralize(t.toLowerCase()))) || "cafés to full restaurants"}. We've hand-picked ${eats.length} place${eats.length === 1 ? "" : "s"} worth your time${examples.length ? ` — including ${proseList(examples)}` : ""}. Every spot is an independent Revamp pick, never a paid placement.`
        : `Looking for ${label?.toLowerCase()} in Armenia? These ${eats.length} spot${eats.length === 1 ? "" : "s"}${examples.length ? `, like ${proseList(examples)},` : ""} are hand-picked by Revamp — honest recommendations, no paid placements.`
      : "";

  useDocumentMeta({
    title: label ? `${title} | Revamp Vacations` : "Eat guide | Revamp Vacations",
    description: label
      ? (intro || `An independent, hand-picked guide to ${mode === "region" ? `eating in ${label}` : `${label} food in Armenia`}.`).slice(0, 155)
      : "An independent, hand-picked restaurant guide across Armenia.",
    canonicalPath: path,
    noindex: !label || eats.length === 0,
    jsonLd: label
      ? [
          buildCollectionPageJsonLd(origin, path, title, eats),
          buildBreadcrumbJsonLd(origin, [
            { name: "Home", path: "/" },
            { name: "Where to eat", path: "/explore/eat" },
            { name: label, path },
          ]),
        ]
      : undefined,
  });

  if (!label) {
    return (
      <div className="min-h-screen bg-paper text-basalt">
        <SiteHeader />
        <div className="container py-24 text-center">
          <p className="eyebrow">Not found</p>
          <h1 className="mt-4 font-display text-5xl">We don't have this eating guide yet.</h1>
          <Button asChild className="mt-7 rounded-none bg-apricot text-white"><Link href="/explore/eat">Browse the eat guide</Link></Button>
        </div>
        <SiteFooter />
      </div>
    );
  }

  // Sibling links for internal linking / crawl depth.
  const otherRegions = ARMENIA_REGIONS.filter((r) => allEats.some((l) => normalizeRegion(l.region || "").toLowerCase() === normalizeRegion(r).toLowerCase())).filter((r) => r !== label);
  const otherCuisines = EAT_CATEGORIES.filter((c) => allEats.some((l) => (l.cuisine || "").trim().toLowerCase() === c.toLowerCase())).filter((c) => c !== label);

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-8 lg:py-12">
        <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-apricot">Home</Link><span>›</span>
          <Link href="/explore/eat" className="hover:text-apricot">Where to eat</Link><span>›</span>
          <span className="font-semibold text-basalt">{label}</span>
        </nav>

        {/* Hero — intro on the left; a compact "at a glance" panel fills the
            right on wide screens so it isn't a big empty void. */}
        <header className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="max-w-2xl">
            <p className="eyebrow">{mode === "region" ? "Eat guide · by area" : "Eat guide · by cuisine"}</p>
            <h1 className="mt-3 font-display text-[3rem] leading-[0.95] tracking-[-0.04em] sm:text-6xl">{title}</h1>
            {intro && <p className="mt-6 text-lg leading-8 text-basalt/85">{intro}</p>}
          </div>
          {eats.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-basalt/10 py-6 lg:mt-1 lg:grid-cols-1 lg:gap-y-4 lg:border lg:bg-chalk/40 lg:p-6">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">Places</dt>
                <dd className="mt-1 font-display text-2xl tabular-nums">{eats.length}</dd>
              </div>
              {(() => {
                const rated = eats.map(bestEatRating).filter((r) => r > 0);
                if (!rated.length) return null;
                const avg = rated.reduce((s, r) => s + r, 0) / rated.length;
                return (
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">Avg rating</dt>
                    <dd className="mt-1 font-display text-2xl tabular-nums">{avg.toFixed(1)}★</dd>
                  </div>
                );
              })()}
              {(() => {
                const facet = mode === "region"
                  ? Array.from(new Set(eats.map((l) => l.cuisine).filter(Boolean) as string[]))
                  : Array.from(new Set(eats.map((l) => normalizeRegion(l.region || "")).filter(Boolean)));
                if (!facet.length) return null;
                return (
                  <div className="col-span-2 lg:col-span-1">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">{mode === "region" ? "Cuisines" : "Areas"}</dt>
                    <dd className="mt-1 text-sm font-semibold leading-6">{facet.slice(0, 6).join(" · ")}</dd>
                  </div>
                );
              })()}
            </dl>
          )}
        </header>

        {/* The spots */}
        {loading && eats.length === 0 ? (
          <section className="mt-12 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <ListingCardSkeleton key={i} />)}
          </section>
        ) : eats.length > 0 ? (
          <section className="mt-12">
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {eats.slice(0, visible).map((l) => <ListingCard key={l.id} listing={l} />)}
            </div>
            {eats.length > visible && (
              <div className="mt-8 text-center">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="rounded-none border border-basalt/20 px-6 py-3 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
                >
                  Show more ({eats.length - visible} more)
                </button>
              </div>
            )}
          </section>
        ) : (
          <div className="mt-12 border border-dashed border-basalt/20 bg-chalk px-6 py-14 text-center">
            <UtensilsCrossed className="mx-auto h-8 w-8 text-basalt/30" />
            <h2 className="mt-3 font-display text-3xl">No picks here yet.</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-basalt/55">We're still curating this guide. Browse the full eat guide in the meantime.</p>
            <Button asChild className="mt-6 rounded-none bg-apricot text-white"><Link href="/explore/eat">All eat picks</Link></Button>
          </div>
        )}

        {/* Cross-link into bookable inventory (region pages only) */}
        {(nearbyStays.length > 0 || nearbyTours.length > 0) && (
          <section className="mt-16 border-t border-basalt/10 pt-12">
            <p className="eyebrow">Make a trip of it</p>
            <h2 className="mt-2 font-display text-3xl tracking-[-0.03em] sm:text-4xl">Stay & explore in {label}</h2>
            {nearbyStays.length > 0 && (
              <div className="mt-7">
                <div className="mb-4 flex items-baseline justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Places to stay</h3>
                  <Link href={`/explore/stay?region=${encodeURIComponent(label)}`} className="text-xs font-bold uppercase tracking-[0.12em] text-apricot hover:underline">See all →</Link>
                </div>
                <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">{nearbyStays.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
              </div>
            )}
            {nearbyTours.length > 0 && (
              <div className="mt-10">
                <div className="mb-4 flex items-baseline justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Things to do</h3>
                  <Link href={`/explore/tour?region=${encodeURIComponent(label)}`} className="text-xs font-bold uppercase tracking-[0.12em] text-apricot hover:underline">See all →</Link>
                </div>
                <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">{nearbyTours.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
              </div>
            )}
          </section>
        )}

        {/* Internal links to sibling guides */}
        {(otherRegions.length > 0 || otherCuisines.length > 0) && (
          <section className="mt-16 border-t border-basalt/10 pt-10">
            {mode === "region" && otherRegions.length > 0 && (
              <div>
                <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Eat in other regions</h2>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {otherRegions.map((r) => (
                    <Link key={r} href={`/eat/${slugify(r)}`} className="rounded-none border border-basalt/15 px-3.5 py-2 text-sm hover:border-apricot hover:text-apricot">Eat in {r}</Link>
                  ))}
                </div>
              </div>
            )}
            {otherCuisines.length > 0 && (
              <div className={mode === "region" && otherRegions.length > 0 ? "mt-8" : ""}>
                <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Browse by cuisine</h2>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {otherCuisines.map((c) => (
                    <Link key={c} href={`/eat/cuisine/${slugify(c)}`} className="rounded-none border border-basalt/15 px-3.5 py-2 text-sm hover:border-apricot hover:text-apricot">{c}</Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
