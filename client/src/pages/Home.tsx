/** Revamp brandbook: bold sans hierarchy, white/orange/charcoal surfaces, rounded media, cropped logo patterns, and Armenian photography. */
import { useState } from "react";
import { ArrowDown, ArrowRight, Compass, MapPin, MoveUpRight } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SearchBar } from "@/components/SearchBar";
import { ListingCard } from "@/components/ListingCard";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { Button } from "@/components/ui/button";
import { brandAssets, regions } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { buildWebsiteJsonLd } from "@shared/seo";

const categories = [
  { type: "stay", number: "01", title: "Stay with a sense of place", label: "Homes, cabins & small hotels", image: brandAssets.categories.stay },
  { type: "eat", number: "02", title: "Taste the landscape", label: "Tables, cellars & courtyards", image: brandAssets.categories.eat },
  { type: "tour", number: "03", title: "Go with someone local", label: "Walks, routes & field days", image: brandAssets.categories.tour },
];

export default function Home() {
  const { listings } = useListings();
  const featured = (listings.filter((listing) => listing.featured).length ? listings.filter((listing) => listing.featured) : listings).slice(0, 6);
  const [selectedId, setSelectedId] = useState(featured[0]?.id);

  useDocumentMeta({
    title: "Revamp Travel — Discover Armenia",
    description: "Curated places to stay, Armenian restaurants, local tours, and memorable routes across Armenia.",
    canonicalPath: "/",
    ogImage: brandAssets.hero,
    jsonLd: buildWebsiteJsonLd(window.location.origin),
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        <section className="hero-field relative min-h-[660px] overflow-hidden border-b border-basalt/10 sm:min-h-[720px]">
          <img src={brandAssets.hero} alt="Armenian highlands at morning light" className="absolute inset-0 h-full w-full object-cover object-center" />
          <div className="hero-image-overlay absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.98)_0%,rgba(255,255,255,0.88)_36%,rgba(255,255,255,0.18)_67%,rgba(33,33,33,0.12)_100%)]" />
          <div className="brand-pattern-hero pointer-events-none absolute -left-8 top-14 text-[15rem] font-bold leading-none tracking-[-0.12em] text-apricot/10">re.</div>
          <div className="container relative z-10 flex min-h-[660px] flex-col justify-center pb-28 pt-16 sm:min-h-[720px]">
            <div className="max-w-[720px]">
              <div className="hero-enter flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.23em] text-tuff"><span className="h-px w-10 bg-tuff" /> Curated across Armenia</div>
              <h1 className="hero-enter mt-7 font-display text-[4rem] leading-[0.86] tracking-[-0.055em] text-basalt sm:text-[5.6rem] lg:text-[7rem]">Stay.<br /><span className="text-apricot">Experience.</span><br />Repeat.</h1>
              <p className="hero-enter mt-7 max-w-lg text-base leading-7 text-basalt/65 sm:text-lg">Exceptional stays, Armenian tables, and local routes—carefully gathered for travelers who want to feel the country, not just pass through it.</p>
              <Link href="/explore" className="hero-enter mt-8 inline-flex items-center gap-3 text-xs font-bold uppercase tracking-[0.17em] text-basalt hover:text-apricot">Find your way through Armenia <span className="grid h-9 w-9 place-items-center border border-basalt/25"><ArrowDown className="h-4 w-4" /></span></Link>
            </div>
            <div className="absolute bottom-9 right-8 hidden items-end gap-3 text-right text-white lg:flex"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/65">Field note 001</p><p className="mt-1 font-display text-xl">Morning road to Geghard</p></div><MapPin className="mb-1 h-5 w-5 text-apricot" /></div>
          </div>
        </section>

        <div className="container relative z-20 -mt-10"><SearchBar /></div>

        <section className="container py-20 lg:py-28">
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
            <div><p className="eyebrow">Three ways in</p><h2 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Let curiosity<br />choose the route.</h2></div>
            <p className="max-w-xl text-base leading-7 text-basalt/58 lg:justify-self-end">Start with a room, a table, or a day in the open. Each collection is small enough to feel considered and broad enough to lead somewhere unexpected.</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {categories.map((category, index) => (
              <Link key={category.type} href={`/explore/${category.type}`} className={`category-panel group relative overflow-hidden ${index === 1 ? "md:translate-y-8" : ""}`}>
                <img src={category.image} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" />
                <div className="absolute inset-0 bg-gradient-to-t from-basalt/78 via-basalt/8 to-transparent" />
                <span className="absolute left-5 top-5 grid h-9 w-9 place-items-center bg-paper text-[10px] font-bold text-basalt">{category.number}</span>
                <div className="absolute inset-x-0 bottom-0 p-6 text-white"><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/60">{category.label}</p><h3 className="mt-2 max-w-[260px] font-display text-4xl leading-[0.96] tracking-[-0.03em]">{category.title}</h3><MoveUpRight className="mt-5 h-5 w-5 text-apricot transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" /></div>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-y border-basalt/10 bg-chalk">
          <div className="container py-20 lg:py-28">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="eyebrow">The revamp. edit</p><h2 className="mt-3 font-display text-5xl tracking-[-0.04em] sm:text-6xl">Worth taking the long way.</h2></div>
              <Link href="/explore" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-apricot hover:text-basalt">See every place <ArrowRight className="h-4 w-4" /></Link>
            </div>
            <div className="mt-12 grid gap-x-7 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
              {featured.map((listing, index) => <div key={listing.id} className={index === 0 ? "md:col-span-2 lg:col-span-2" : ""}><ListingCard listing={listing} large={index === 0} /></div>)}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-basalt py-20 text-paper lg:py-28">
          <div className="pointer-events-none absolute -right-16 -top-28 text-[22rem] font-bold leading-none tracking-[-0.12em] text-white/[0.045]">re.</div>
          <div className="container">
            <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
              <div><p className="eyebrow text-apricot">Regions to read slowly</p><h2 className="mt-3 font-display text-5xl leading-[0.94] tracking-[-0.04em] sm:text-6xl">The landscape changes the story.</h2></div>
              <p className="max-w-xl text-base leading-7 text-paper/52 lg:justify-self-end">From Tavush forest to the high blue of Sevan and the deep southern folds of Syunik, Armenia rewards the detour.</p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-[1.1fr_0.9fr_1.1fr]">
              {regions.map((region, index) => (
                <Link key={region.name} href={`/explore?query=${region.query}`} className={`region-card group relative overflow-hidden ${index === 1 ? "md:mt-14" : ""}`}>
                  <img src={region.image} alt={region.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-basalt/78 via-transparent to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-6"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-apricot">{region.label}</p><h3 className="mt-1 font-display text-4xl">{region.name}</h3></div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-paper py-20 lg:py-28">
          <div className="container grid gap-10 lg:grid-cols-[0.78fr_1.22fr]">
            <div>
              <p className="eyebrow">Move through the map</p>
              <h2 className="mt-3 font-display text-5xl leading-[0.94] tracking-[-0.04em] sm:text-6xl">See what’s<br />around the bend.</h2>
              <p className="mt-5 max-w-md text-sm leading-7 text-basalt/55">Hover a place to follow it across Armenia, then open the full atlas when geography—not category—is leading the plan.</p>
              <div className="mt-8 space-y-2">
                {featured.slice(0, 4).map((listing) => (
                  <Link key={listing.id} href={`/listing/${listing.slug}`} onMouseEnter={() => setSelectedId(listing.id)} className={`flex items-center justify-between border-t border-basalt/10 py-4 transition-colors hover:text-apricot ${selectedId === listing.id ? "text-apricot" : ""}`}>
                    <span><span className="mr-3 text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/40">{listing.city}</span><strong>{listing.title}</strong></span>
                    <span className="text-xs">{listing.priceLabel} <ArrowRight className="ml-1 inline h-3 w-3" /></span>
                  </Link>
                ))}
              </div>
              <Button asChild className="mt-7 rounded-none bg-sevan px-6 text-white hover:bg-sevan/90"><Link href="/map"><Compass className="mr-2 h-4 w-4" /> Open the field atlas</Link></Button>
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
