/**
 * Region landing page (/region/:slug) — an SEO/AEO hub for a place: a curated
 * editorial intro + climate + quick facts, the live listings that match the
 * region (stays, tours, experiences, tables), and a region FAQ. Emits
 * CollectionPage + FAQPage + BreadcrumbList structured data. Content comes from
 * shared/regionGuides.ts; listings are matched by city/region via listingInRegion.
 */
import { Link } from "wouter";
import { MapPin } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ListingCard } from "@/components/ListingCard";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";
import { Button } from "@/components/ui/button";
import { useListings } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { findRegionGuide, listingInRegion, REGION_GUIDES } from "@shared/regionGuides";
import { slugify } from "@/lib/slug";
import { buildCollectionPageJsonLd, buildFaqJsonLd, buildBreadcrumbJsonLd } from "@shared/seo";

const SECTIONS: { type: "stay" | "tour" | "experience" | "eat"; heading: string; sub: string }[] = [
  { type: "stay", heading: "Places to stay", sub: "Guesthouses, apartments, hotels, and cabins — real, bookable listings." },
  { type: "tour", heading: "Tours & day trips", sub: "Guided routes led by locals." },
  { type: "experience", heading: "Experiences", sub: "Hands-on classes, crafts, and tastings." },
  { type: "eat", heading: "Where to eat", sub: "Armenian tables and cellars." },
];

export default function Region({ slug }: { slug: string }) {
  const { listings, loading } = useListings();
  const guide = findRegionGuide(slug);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const matched = guide ? listings.filter((l) => listingInRegion(l.city, l.region, guide)) : [];

  useDocumentMeta({
    title: guide ? `${guide.name}, Armenia — Where to Stay & What to Do | Revamp Vacations` : "Region | Revamp Vacations",
    description: guide ? `${guide.intro[0]}`.slice(0, 155) : "Explore Armenia by region on Revamp Vacations.",
    canonicalPath: `/region/${slug}`,
    noindex: !guide,
    jsonLd: guide
      ? [
          buildCollectionPageJsonLd(origin, `/region/${slug}`, `Where to stay and what to do in ${guide.name}`, matched),
          buildFaqJsonLd(guide.faq),
          buildBreadcrumbJsonLd(origin, [
            { name: "Home", path: "/" },
            { name: guide.name, path: `/region/${slug}` },
          ]),
        ]
      : undefined,
  });

  if (!guide) {
    return (
      <div className="min-h-screen bg-paper text-basalt">
        <SiteHeader />
        <div className="container py-24 text-center">
          <p className="eyebrow">Region not found</p>
          <h1 className="mt-4 font-display text-5xl">We don't have a guide for this place yet.</h1>
          <Button asChild className="mt-7 rounded-none bg-apricot text-white"><Link href="/explore">Browse everything</Link></Button>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const others = REGION_GUIDES.filter((g) => g.slug !== guide.slug);

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-8 lg:py-12">
        <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-apricot">Home</Link><span>›</span>
          <span className="font-semibold text-basalt">{guide.name}</span>
        </nav>

        {/* Hero */}
        <header className="mt-5 max-w-3xl">
          <p className="eyebrow">{guide.eyebrow}</p>
          <h1 className="mt-3 font-display text-[3rem] leading-[0.95] tracking-[-0.04em] sm:text-6xl">Where to stay in {guide.name}</h1>
          {guide.intro.map((p, i) => (
            <p key={i} className={i === 0 ? "mt-6 text-lg leading-8 text-basalt/85" : "mt-3 text-base leading-7 text-basalt/60"}>{p}</p>
          ))}
        </header>

        {/* Quick facts */}
        <dl className="mt-8 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-5 border-y border-basalt/10 py-6 sm:grid-cols-4">
          {guide.facts.map((f) => (
            <div key={f.label}>
              <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">{f.label}</dt>
              <dd className="mt-1 text-sm font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>

        {/* Climate */}
        <p className="mt-5 flex max-w-3xl items-start gap-2.5 text-sm leading-7 text-basalt/70">
          <MapPin className="mt-1 h-4 w-4 shrink-0 text-apricot" />
          <span><span className="font-semibold text-basalt">Climate:</span> {guide.climate}</span>
        </p>

        {/* Listing sections */}
        {loading && matched.length === 0 ? (
          <section className="mt-12">
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <ListingCardSkeleton key={i} />)}
            </div>
          </section>
        ) : (
          SECTIONS.map((s) => {
            const items = matched.filter((l) => l.type === s.type);
            if (items.length === 0) return null;
            return (
              <section key={s.type} className="mt-14">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-3xl tracking-[-0.03em] sm:text-4xl">{s.heading}</h2>
                  {s.type === "eat" && (
                    <Link href={`/eat/${slugify(guide.name)}`} className="shrink-0 text-xs font-bold uppercase tracking-[0.12em] text-apricot hover:underline">
                      Full eat guide →
                    </Link>
                  )}
                </div>
                <p className="mt-2 max-w-xl text-sm text-basalt/55">{s.sub}</p>
                <div className="mt-7 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((l) => <ListingCard key={l.id} listing={l} />)}
                </div>
              </section>
            );
          })
        )}

        {!loading && matched.length === 0 && (
          <div className="mt-12 border border-dashed border-basalt/20 bg-chalk px-6 py-14 text-center">
            <p className="eyebrow">Coming soon</p>
            <h2 className="mt-3 font-display text-3xl">New listings in {guide.name} are on the way.</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-basalt/55">In the meantime, browse everything across Armenia or plan a trip with the AI planner.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button asChild className="rounded-none bg-apricot text-white"><Link href="/explore">Browse everything</Link></Button>
              <Button asChild variant="outline" className="rounded-none border-basalt/20"><Link href="/plan">AI trip planner</Link></Button>
            </div>
          </div>
        )}

        {/* FAQ */}
        <section className="mt-16 max-w-3xl">
          <h2 className="font-display text-3xl tracking-[-0.03em] sm:text-4xl">Good to know</h2>
          <dl className="mt-6 divide-y divide-basalt/10 border-t border-basalt/10">
            {guide.faq.map((f) => (
              <div key={f.q} className="py-6">
                <dt className="font-display text-xl leading-snug tracking-[-0.01em]">{f.q}</dt>
                <dd className="mt-2.5 text-[15px] leading-7 text-basalt/70">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Other regions */}
        {others.length > 0 && (
          <section className="mt-16">
            <h2 className="font-display text-2xl tracking-[-0.02em]">Explore more of Armenia</h2>
            <div className="mt-5 flex flex-wrap gap-2.5">
              {others.map((g) => (
                <Link key={g.slug} href={`/region/${g.slug}`} className="border border-basalt/15 px-4 py-2 text-sm font-semibold transition-colors hover:border-apricot hover:text-apricot">
                  {g.name}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
