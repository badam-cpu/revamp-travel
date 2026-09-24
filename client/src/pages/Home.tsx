/** Revamp brandbook: bold sans hierarchy, white/orange/charcoal surfaces, rounded media, cropped logo patterns, and Armenian photography. */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight, Compass, MapPin, MoveUpRight } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SearchBar } from "@/components/SearchBar";
import { imgAttrs } from "@/lib/responsiveImg";
import { ListingCard } from "@/components/ListingCard";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { Button } from "@/components/ui/button";
import { brandAssets, regions } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { buildWebsiteJsonLd, buildOrganizationJsonLd } from "@shared/seo";
import { findRegionGuide } from "@shared/regionGuides";

/** Link a region card to its guide page when one exists, else to filtered explore. */
function regionHref(name: string, query: string): string {
  const slug = name.toLowerCase().replace(/\s+(province|marz)$/i, "").trim().replace(/\s+/g, "-");
  return findRegionGuide(slug) ? `/region/${slug}` : `/explore?query=${encodeURIComponent(query)}`;
}

// `name` is the canonical category word used everywhere else (nav, filters,
// listing badges); it anchors the poetic `title` so a visitor can map a tile
// back to the "Stay/Eat/Tour/Experience" they clicked.
const categories = [
  { type: "stay", number: "01", name: "Stay", title: "Stay with a sense of place", label: "Homes, cabins & small hotels", image: brandAssets.categories.stay },
  { type: "eat", number: "02", name: "Eat", title: "Taste the landscape", label: "Tables, cellars & courtyards", image: brandAssets.categories.eat },
  { type: "tour", number: "03", name: "Tour", title: "Go with someone local", label: "Walks, routes & field days", image: brandAssets.categories.tour },
  { type: "experience", number: "04", name: "Experience", title: "Make something with your hands", label: "Classes, crafts & tastings", image: brandAssets.categories.experience },
];

export default function Home() {
  const { listings, loading } = useListings();
  const { settings } = useSiteSettings();
  const { format } = useCurrency();

  // Admin-editable home content, each with a fallback to the built-in default.
  const heroImage = settings.heroImage || brandAssets.hero;
  // Hero slideshow: the admin's uploaded hero photos cross-fade automatically;
  // with only one image it's a plain hero (no motion).
  const heroSlides = settings.heroImages.length ? settings.heroImages : [heroImage];
  const [heroIdx, setHeroIdx] = useState(0);
  const regionScrollRef = useRef<HTMLDivElement>(null);
  const scrollRegions = (dir: 1 | -1) => {
    const el = regionScrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };
  useEffect(() => {
    setHeroIdx(0);
    if (heroSlides.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroSlides.length), 5000);
    return () => clearInterval(t);
  }, [heroSlides.length]);
  const heroSubcopy =
    settings.heroSubcopy ||
    "Exceptional stays, Armenian tables, and local routes—carefully gathered for travelers who want to feel the country, not just pass through it.";

  // Admin-editable "choose the route" section: heading + per-card title/label,
  // each falling back to the built-in default.
  const hc = settings.homeContent;
  const categoriesEyebrow = hc.categoriesEyebrow?.trim() || "Four ways in";
  const categoriesTitle = hc.categoriesTitle?.trim() || "Let curiosity\nchoose the route.";
  const categoriesIntro =
    hc.categoriesIntro?.trim() ||
    "Start with a room, a table, a day in the open, or something made with your own hands. Each collection is small enough to feel considered and broad enough to lead somewhere unexpected.";
  const cards = categories.map((c) => ({
    ...c,
    title: hc.categories?.[c.type]?.title?.trim() || c.title,
    label: hc.categories?.[c.type]?.label?.trim() || c.label,
    image: hc.categories?.[c.type]?.image?.trim() || c.image,
  }));
  const editEyebrow = hc.editEyebrow?.trim() || "The revamp. edit";
  const editTitle = hc.editTitle?.trim() || "Worth taking the long way.";
  const regionsEyebrow = hc.regionsEyebrow?.trim() || "Regions to read slowly";
  const regionsTitle = hc.regionsTitle?.trim() || "The landscape changes the story.";
  const regionsIntro =
    hc.regionsIntro?.trim() ||
    "From Tavush forest to the high blue of Sevan and the deep southern folds of Syunik, Armenia rewards the detour.";
  // Regions are a fully admin-managed list (add/remove). Fall back to the
  // built-in three when the admin hasn't set any; a card with no uploaded image
  // borrows a built-in region illustration so it never renders blank.
  const regionCards = (hc.regionCards && hc.regionCards.length
    ? hc.regionCards.map((r, i) => ({
        name: r.name?.trim() || "Region",
        label: r.label?.trim() || "",
        image: r.image?.trim() || regions[i % regions.length]?.image || brandAssets.hero,
        query: (r.query?.trim() || r.name?.trim() || "").trim(),
      }))
    : regions.map((r) => ({ name: r.name, label: r.label, image: r.image, query: r.query })));
  const mapEyebrow = hc.mapEyebrow?.trim() || "Move through the map";
  const mapTitle = hc.mapTitle?.trim() || "See what’s\naround the bend.";
  const mapIntro =
    hc.mapIntro?.trim() ||
    "Hover a place to follow it across Armenia, then open the full atlas when geography—not category—is leading the plan.";

  // Featured row: admin's ordered slug list (published only) if set, else the
  // automatic pick (listings flagged `featured`, falling back to the first few).
  const adminFeatured = settings.featuredSlugs
    .map((slug) => listings.find((l) => l.slug === slug))
    .filter((l): l is (typeof listings)[number] => Boolean(l));
  // Cap at 8: with the large first card spanning 2 columns, 8 fills the 3-column
  // grid exactly (2+1, 3, 3) — 6 left a gap in the last row.
  const autoFeatured = (listings.filter((listing) => listing.featured).length ? listings.filter((listing) => listing.featured) : listings).slice(0, 8);
  const featured = (adminFeatured.length ? adminFeatured : autoFeatured).slice(0, 8);
  const [selectedId, setSelectedId] = useState(featured[0]?.id);

  useDocumentMeta({
    title: "Revamp Vacations — Stays, Tours & Experiences in Armenia",
    description: "Curated places to stay, Armenian restaurants, local tours, and memorable routes across Armenia.",
    canonicalPath: "/",
    // Link previews can't render SVG — use the raster OG card unless the admin
    // set a real (raster) hero photo.
    ogImage: heroImage.endsWith(".svg") ? "/images/og-cover.jpg" : heroImage,
    jsonLd: [buildWebsiteJsonLd(window.location.origin), buildOrganizationJsonLd(window.location.origin)],
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        <section className="hero-field relative min-h-[660px] overflow-hidden border-b border-basalt/10 sm:min-h-[720px]">
          {heroSlides.map((src, i) => (
            <img
              key={`${src}-${i}`}
              {...imgAttrs(src, "100vw")}
              alt={i === 0 ? "Armenian highlands at morning light" : ""}
              aria-hidden={i === heroIdx ? undefined : true}
              className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-[1200ms] ${i === heroIdx ? "opacity-100" : "opacity-0"}`}
            />
          ))}
          <div className="hero-image-overlay absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.98)_0%,rgba(255,255,255,0.88)_36%,rgba(255,255,255,0.18)_67%,rgba(33,33,33,0.12)_100%)]" />
          <div className="brand-pattern-hero pointer-events-none absolute -left-8 top-14 text-[15rem] font-bold leading-none tracking-[-0.12em] text-apricot/10">re.</div>
          <div className="container relative z-10 flex min-h-[660px] flex-col justify-center pb-28 pt-16 sm:min-h-[720px]">
            <div className="max-w-[720px]">
              <div className="hero-enter flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.23em] text-tuff"><span className="h-px w-10 bg-tuff" /> Curated across Armenia</div>
              <h1 className="hero-enter mt-7 font-display text-[4rem] leading-[0.86] tracking-[-0.055em] text-basalt sm:text-[5.6rem] lg:text-[7rem]">
                {settings.heroHeadline ? settings.heroHeadline : (<>Stay.<br /><span className="text-apricot">Experience.</span><br />Repeat.</>)}
              </h1>
              <p className="hero-enter mt-7 max-w-lg text-base leading-7 text-basalt/65 sm:text-lg">{heroSubcopy}</p>
              <Link href="/explore" className="hero-enter mt-8 inline-flex items-center gap-3 text-xs font-bold uppercase tracking-[0.17em] text-basalt hover:text-apricot">Find your way through Armenia <span className="grid h-9 w-9 place-items-center border border-basalt/25"><ArrowDown className="h-4 w-4" /></span></Link>
            </div>
            <div className="absolute bottom-9 right-8 hidden items-end gap-3 text-right text-white lg:flex"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/65">Field note 001</p><p className="mt-1 font-display text-xl">Morning road to Geghard</p></div><MapPin className="mb-1 h-5 w-5 text-apricot" /></div>
          </div>
        </section>

        <div className="container relative z-20 -mt-10"><SearchBar /></div>

        <section className="container py-20 lg:py-28">
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
            <div><p className="eyebrow">{categoriesEyebrow}</p><h2 className="mt-3 whitespace-pre-line font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">{categoriesTitle}</h2></div>
            <p className="max-w-xl whitespace-pre-line text-base leading-7 text-basalt/58 lg:justify-self-end">{categoriesIntro}</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((category) => (
              <Link key={category.type} href={`/explore/${category.type}`} className="category-panel group relative overflow-hidden">
                <img src={category.image} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" />
                <div className="absolute inset-0 bg-gradient-to-t from-basalt/95 via-basalt/45 to-transparent" />
                <span className="absolute left-5 top-5 grid h-9 w-9 place-items-center bg-paper text-[10px] font-bold text-basalt">{category.number}</span>
                <div className="absolute inset-x-0 bottom-0 p-6 text-white [text-shadow:0_2px_14px_rgba(15,15,15,0.55)]"><p className="text-[10px] font-bold uppercase tracking-[0.17em]"><span className="text-apricot">{category.name}</span><span className="text-white/80"> · {category.label}</span></p><h3 className="mt-2 max-w-[260px] font-display text-4xl leading-[0.96] tracking-[-0.03em]">{category.title}</h3><MoveUpRight className="mt-5 h-5 w-5 text-apricot transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" /></div>
              </Link>
            ))}
          </div>
        </section>

        {(hc.mediaMentions ?? []).length > 0 && (
          <section className="border-y border-basalt/10 bg-paper">
            <div className="container py-16 lg:py-20">
              <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-basalt/45">Armenia in the world's press</p>
              <h2 className="mx-auto mt-3 max-w-2xl text-center font-display text-3xl leading-tight tracking-[-0.02em]">A destination the world keeps writing about.</h2>
              <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {(hc.mediaMentions ?? []).map((m, i) => {
                  const inner = m.logo ? (
                    <img src={m.logo} alt={m.name} loading="lazy" className="max-h-20 max-w-[88%] object-contain" />
                  ) : (
                    <span className="text-center font-display text-xl text-basalt/70">{m.name}</span>
                  );
                  const cls = "flex h-32 items-center justify-center rounded-[0.875rem] bg-chalk px-6 py-5 transition-shadow";
                  return m.url ? (
                    <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" title={`${m.name} — read the article`} className={`${cls} hover:shadow-[0_10px_30px_rgba(35,35,33,0.10)]`}>
                      {inner}
                    </a>
                  ) : (
                    <div key={i} className={cls}>{inner}</div>
                  );
                })}
              </div>
              <p className="mt-6 text-center text-xs text-basalt/40">Independent editorial coverage of Armenia. Logos belong to their publishers; each links to the original article.</p>
            </div>
          </section>
        )}

        <section className="border-y border-basalt/10 bg-chalk">
          <div className="container py-20 lg:py-28">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="eyebrow">{editEyebrow}</p><h2 className="mt-3 whitespace-pre-line font-display text-5xl tracking-[-0.04em] sm:text-6xl">{editTitle}</h2></div>
              <Link href="/explore" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-apricot hover:text-basalt">See every place <ArrowRight className="h-4 w-4" /></Link>
            </div>
            <div className="mt-12 grid gap-x-7 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
              {loading && featured.length === 0
                ? Array.from({ length: 5 }).map((_, i) => <div key={i} className={i === 0 ? "md:col-span-2 lg:col-span-2" : ""}><ListingCardSkeleton large={i === 0} /></div>)
                : featured.map((listing, index) => <div key={listing.id} className={index === 0 ? "md:col-span-2 lg:col-span-2" : ""}><ListingCard listing={listing} large={index === 0} /></div>)}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-basalt py-20 text-paper lg:py-28">
          <div className="pointer-events-none absolute -right-16 -top-28 text-[22rem] font-bold leading-none tracking-[-0.12em] text-white/[0.045]">re.</div>
          <div className="container">
            <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
              <div><p className="eyebrow text-apricot">{regionsEyebrow}</p><h2 className="mt-3 whitespace-pre-line font-display text-5xl leading-[0.94] tracking-[-0.04em] sm:text-6xl">{regionsTitle}</h2></div>
              <p className="max-w-xl whitespace-pre-line text-base leading-7 text-paper/52 lg:justify-self-end">{regionsIntro}</p>
            </div>
            <div ref={regionScrollRef} className="mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {regionCards.map((region, index) => (
                <Link key={`${region.name}-${index}`} href={regionHref(region.name, region.query)} className="region-card group relative w-[82%] shrink-0 snap-start overflow-hidden sm:w-[calc((100%-1.25rem)/2)] lg:w-[calc((100%-2.5rem)/3)]">
                  <img src={region.image} alt={region.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-basalt/95 via-basalt/40 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-6 text-white [text-shadow:0_2px_14px_rgba(15,15,15,0.55)]"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-apricot">{region.label}</p><h3 className="mt-1 font-display text-4xl">{region.name}</h3></div>
                </Link>
              ))}
            </div>
            {regionCards.length > 1 && (
              <div className="mt-8 flex items-center justify-center gap-4">
                <button type="button" onClick={() => scrollRegions(-1)} aria-label="Previous regions" className="grid h-11 w-11 place-items-center rounded-full border border-white/20 text-paper transition-colors hover:border-apricot hover:text-apricot">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-paper/45">Scroll for more</span>
                <button type="button" onClick={() => scrollRegions(1)} aria-label="More regions" className="grid h-11 w-11 place-items-center rounded-full border border-white/20 text-paper transition-colors hover:border-apricot hover:text-apricot">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="bg-paper py-20 lg:py-28">
          <div className="container grid gap-10 lg:grid-cols-[0.78fr_1.22fr]">
            <div>
              <p className="eyebrow">{mapEyebrow}</p>
              <h2 className="mt-3 whitespace-pre-line font-display text-5xl leading-[0.94] tracking-[-0.04em] sm:text-6xl">{mapTitle}</h2>
              <p className="mt-5 max-w-md whitespace-pre-line text-sm leading-7 text-basalt/55">{mapIntro}</p>
              <div className="mt-8 space-y-2">
                {featured.slice(0, 4).map((listing) => (
                  <Link key={listing.id} href={`/listing/${listing.slug}`} onMouseEnter={() => setSelectedId(listing.id)} className={`flex items-center justify-between border-t border-basalt/10 py-4 transition-colors hover:text-apricot ${selectedId === listing.id ? "text-apricot" : ""}`}>
                    <span><span className="mr-3 text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/40">{listing.city}</span><strong>{listing.title}</strong></span>
                    <span className="text-xs">{listing.price > 0 ? format(Math.round(listing.price * 100)) : "Rate on request"} <ArrowRight className="ml-1 inline h-3 w-3" /></span>
                  </Link>
                ))}
              </div>
              <Button asChild className="mt-7 rounded-none bg-sevan px-6 text-white hover:bg-sevan/90"><Link href="/map"><Compass className="mr-2 h-4 w-4" /> Open the map</Link></Button>
            </div>
            <ArmeniaMap listings={featured} selectedId={selectedId} onSelect={setSelectedId} className="brand-notch h-[620px]" />
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-basalt/10 bg-apricot text-white">
          <div className="pointer-events-none absolute -bottom-24 -left-10 text-[15rem] font-bold leading-none tracking-[-0.12em] text-white/10">re.</div>
          <div className="container grid gap-8 py-14 md:grid-cols-[1fr_auto] md:items-center lg:py-20">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">A quieter kind of itinerary</p><h2 className="mt-3 max-w-3xl font-display text-5xl leading-[0.96] tracking-[-0.04em]">One room. One table. One road you’ll remember.</h2></div>
            <Button asChild size="lg" className="brand-notch rounded-none bg-paper px-7 text-basalt hover:bg-white"><Link href="/explore">Begin the route <MoveUpRight className="ml-2 h-4 w-4" /></Link></Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
