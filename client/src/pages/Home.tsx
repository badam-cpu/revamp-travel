/** Revamp brandbook: bold sans hierarchy, white/orange/charcoal surfaces, rounded media, cropped logo patterns, and Armenian photography. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Compass, MapPin, MoveUpRight, Pause, Play } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SearchBar } from "@/components/SearchBar";
import { AhaVoiceSearchButton } from "@/components/AhaVoiceButton";
import { imgAttrs } from "@/lib/responsiveImg";
import { ListingRail } from "@/components/ListingRail";
import { buildHomeRows } from "@/lib/homeRows";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { Button } from "@/components/ui/button";
import { brandAssets, regions } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { buildWebsiteJsonLd, buildOrganizationJsonLd } from "@shared/seo";
import { findRegionGuide } from "@shared/regionGuides";
import { ReMark } from "@/components/BrandMark";

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
  { type: "experience", number: "04", name: "Experience", title: "Learn from the makers", label: "Classes, crafts & tastings", image: brandAssets.categories.experience },
];

export default function Home() {
  const { publicListings: listings, loading } = useListings();
  const { settings } = useSiteSettings();
  const { format } = useCurrency();

  // Admin-editable home content, each with a fallback to the built-in default.
  const heroImage = settings.heroImage || brandAssets.hero;
  // Hero slideshow: the admin's uploaded hero photos cross-fade automatically;
  // with only one image it's a plain hero (no motion).
  const heroSlides = settings.heroImages.length ? settings.heroImages : [heroImage];
  const [heroIdx, setHeroIdx] = useState(0);
  // Visitors can pause the slideshow (WCAG 2.2.2); reduced-motion never plays.
  const [heroPaused, setHeroPaused] = useState(false);
  const reducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const heroMeta = settings.homeContent.heroSlides ?? {};
  const heroCaption = heroMeta[heroSlides[heroIdx]]?.caption?.trim();
  const regionScrollRef = useRef<HTMLDivElement>(null);
  const scrollRegions = (dir: 1 | -1) => {
    const el = regionScrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };
  useEffect(() => setHeroIdx(0), [heroSlides.length]);
  useEffect(() => {
    if (heroSlides.length < 2 || reducedMotion || heroPaused) return;
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroSlides.length), 6000);
    return () => clearInterval(t);
  }, [heroSlides.length, reducedMotion, heroPaused]);
  // Hero headline (admin-editable in Site content) says plainly what Revamp is;
  // the slogan moves in its own band below the search.
  const heroHeadline = settings.heroHeadline?.trim() || "Places to stay, eat and explore across Armenia";
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

  // Showcase: "Our picks" (admin's pinned slugs → featured flag → a daily
  // rotation of the rest) + one swipeable row per type (daily rotation), so
  // the home page keeps showing a fair share of a growing catalog. See lib/homeRows.ts.
  const { picks: featured, rows: typeRows } = useMemo(() => buildHomeRows(listings, settings.featuredSlugs), [listings, settings.featuredSlugs]);
  const [selectedId, setSelectedId] = useState(featured[0]?.id);

  useDocumentMeta({
    title: "Revamp Vacations — Stays, Tours & Experiences in Armenia",
    description: "Curated places to stay, Armenian restaurants, local tours, and memorable routes across Armenia.",
    canonicalPath: "/",
    // Shared links show the slogan card (Stay. Experience. Repeat. + a hero
    // photo) — the same image the bot prerender uses (server/prerender.ts).
    ogImage: "/images/og-cover.jpg",
    jsonLd: [buildWebsiteJsonLd(window.location.origin), buildOrganizationJsonLd(window.location.origin)],
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        <section className="hero-field relative overflow-hidden border-b border-basalt/10">
          {heroSlides.map((src, i) => (
            <img
              key={`${src}-${i}`}
              {...imgAttrs(src, "100vw")}
              alt={heroMeta[src]?.alt?.trim() || ""}
              aria-hidden={i === heroIdx ? undefined : true}
              {...(i === 0 ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
              className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-[1200ms] ${i === heroIdx ? "opacity-100" : "opacity-0"}`}
            />
          ))}
          {/* Photo first: a soft charcoal fade (from the bottom and the left) keeps
              the white headline readable without washing out the picture. */}
          <div className="hero-image-overlay absolute inset-0 bg-[linear-gradient(180deg,rgba(33,33,33,0.18)_0%,rgba(33,33,33,0.06)_38%,rgba(33,33,33,0.58)_100%),linear-gradient(90deg,rgba(33,33,33,0.32)_0%,rgba(33,33,33,0)_55%)]" />
          <div className="container relative z-10 flex min-h-[500px] flex-col justify-end pb-24 pt-14 sm:min-h-[580px] lg:pb-28">
            <div className="max-w-[760px] text-white [text-shadow:0_2px_18px_rgba(15,15,15,0.35)]">
              <div className="hero-enter flex items-center gap-3 text-xs font-bold uppercase tracking-[0.22em] text-white [text-shadow:0_1px_10px_rgba(15,15,15,0.7)]"><span className="h-px w-10 bg-apricot" /> Curated across Armenia</div>
              <h1 className="hero-enter mt-4 max-w-[16ch] font-display text-[2.6rem] leading-[0.98] tracking-[-0.045em] sm:text-[3.6rem] lg:text-[4.4rem]">{heroHeadline}</h1>
            </div>
            {(heroCaption || heroSlides.length > 1) && (
              <div className="absolute right-4 top-4 flex items-end gap-4 text-right text-white sm:bottom-14 sm:right-8 sm:top-auto lg:bottom-24">
                {heroCaption && (
                  <div key={heroSlides[heroIdx]} className="hero-caption hidden items-end gap-2 lg:flex">
                    <p className="font-display text-xl leading-tight [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">{heroCaption}</p>
                    <MapPin className="mb-0.5 h-5 w-5 shrink-0 text-apricot" />
                  </div>
                )}
                {heroSlides.length > 1 && (
                  <div className="flex items-center gap-1 rounded-full bg-basalt/45 py-1 pl-1 pr-2.5 backdrop-blur-sm">
                    {!reducedMotion && (
                      <button
                        type="button"
                        onClick={() => setHeroPaused((p) => !p)}
                        aria-label={heroPaused ? "Play slideshow" : "Pause slideshow"}
                        aria-pressed={heroPaused}
                        className="grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white sm:h-8 sm:w-8"
                      >
                        {heroPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
                      </button>
                    )}
                    {/* Each dot sits in a taller tap area (the dot itself stays small). */}
                    <div className="flex items-center pl-0.5">
                      {heroSlides.map((src, i) => (
                        <button
                          key={`dot-${src}-${i}`}
                          type="button"
                          onClick={() => { setHeroIdx(i); setHeroPaused(true); }}
                          aria-label={`Show photo ${i + 1} of ${heroSlides.length}`}
                          aria-current={i === heroIdx}
                          className="group/dot grid h-10 place-items-center px-[3px] focus-visible:outline-2 focus-visible:outline-white sm:h-8"
                        >
                          <span className={`block h-1.5 rounded-full transition-all ${i === heroIdx ? "w-5 bg-white" : "w-1.5 bg-white/50 group-hover/dot:bg-white/80"}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="container relative z-20 -mt-10" data-support-yield><SearchBar mobileCollapse /></div>
        <div className="container relative z-20 mt-3 flex justify-center"><AhaVoiceSearchButton /></div>

        {/* The slogan's own (compact) moment below the search — a fixed brand
            asset, never admin-editable: stacked, "Experience." in orange. The intro uses
            the same columns as the "Four ways in" row, so both end on one edge. */}
        <section className="container pt-12 lg:pt-16">
          <div className="grid gap-6 border-b border-basalt/10 pb-12 lg:grid-cols-[0.7fr_1.3fr] lg:items-end lg:gap-8 lg:pb-14">
            <div>
              <p className="font-display text-[2.9rem] leading-[0.88] tracking-[-0.055em] text-basalt sm:text-[3.6rem] lg:text-[4.1rem]">
                Stay.
                <br />
                <span className="text-apricot">Experience.</span>
                <br />
                Repeat.
              </p>
            </div>
            <div className="max-w-xl lg:justify-self-end">
              <p className="text-base leading-7 text-basalt/70">{heroSubcopy}</p>
              <Link href="/explore" className="group mt-5 inline-flex items-center gap-3 text-xs font-bold uppercase tracking-[0.17em] text-basalt hover:text-apricot focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-apricot">
                Browse all of Armenia
                <span className="grid h-9 w-9 place-items-center rounded-full border border-basalt/25 transition-colors group-hover:border-apricot group-hover:bg-apricot group-hover:text-white"><ArrowRight className="h-4 w-4" /></span>
              </Link>
            </div>
          </div>
        </section>

        <section className="container pb-20 pt-14 lg:pb-28 lg:pt-16">
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
                {/* Labels get a 2-line slot filled from the bottom (spare room sits above, over the
                    photo), so a 1-line label lines up with 2-line ones. Titles stay natural — no gap. */}
                <div className="absolute inset-x-0 bottom-0 p-6 text-white [text-shadow:0_2px_14px_rgba(15,15,15,0.55)]"><p className="flex min-h-[2.9em] items-end text-[10px] font-bold uppercase leading-[1.45] tracking-[0.17em]"><span><span className="text-apricot">{category.name}</span><span className="text-white/80"> · {category.label}</span></span></p><h3 className="mt-2 max-w-[260px] font-display text-4xl leading-[0.96] tracking-[-0.03em]">{category.title}</h3><MoveUpRight className="mt-5 h-5 w-5 text-apricot transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" /></div>
              </Link>
            ))}
          </div>
        </section>

        {(hc.mediaMentions ?? []).length > 0 && (
          <section className="border-y border-basalt/10 bg-paper">
            <div className="container py-16 lg:py-20">
              <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-apricot">Armenia in the world's press</p>
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
            </div>
          </section>
        )}

        <section className="border-y border-basalt/10 bg-chalk">
          <div className="container py-20 lg:py-28">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="eyebrow">{editEyebrow}</p><h2 className="mt-3 whitespace-pre-line font-display text-5xl tracking-[-0.04em] sm:text-6xl">{editTitle}</h2></div>
              <Link href="/explore" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-apricot hover:text-basalt">See every place <ArrowRight className="h-4 w-4" /></Link>
            </div>
            <ListingRail className="mt-12" title="Our picks" items={featured} loading={loading} />
            {typeRows.map((r) => (
              <ListingRail key={r.key} className="mt-16" title={r.title} href={r.href} linkLabel={r.linkLabel} items={r.items} />
            ))}
          </div>
        </section>

        <section className="relative overflow-hidden bg-basalt py-20 text-paper lg:py-28">
          <div className="pointer-events-none absolute -right-16 -top-28 text-[22rem] font-bold leading-none tracking-[-0.12em] text-white/[0.045]"><ReMark /></div>
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

        <section data-bubble-contrast className="relative overflow-hidden border-t border-basalt/10 bg-apricot text-white">
          <div className="pointer-events-none absolute -bottom-24 -left-10 text-[15rem] font-bold leading-none tracking-[-0.12em] text-white/10"><ReMark /></div>
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
