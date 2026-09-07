/** Revamp brandbook: detail pages combine rounded imagery, bold sans hierarchy, concise facts, white space, and orange actions. */
import { ArrowLeft, Bookmark, CalendarDays, Check, Clock3, MapPin, Share2, Users } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { ListingCard } from "@/components/ListingCard";
import { Button } from "@/components/ui/button";
import { findListing, typeLabels } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { toast } from "sonner";

export default function ListingPage({ params }: { params: { slug: string } }) {
  const { listings } = useListings();
  const listing = findListing(params.slug, listings);
  if (!listing) {
    return (
      <div className="min-h-screen bg-paper"><SiteHeader /><div className="container py-24 text-center"><p className="eyebrow">Place not found</p><h1 className="mt-4 font-display text-6xl">This path ends here.</h1><Button asChild className="mt-7 rounded-none bg-apricot text-white"><Link href="/explore">Return to the marketplace</Link></Button></div></div>
    );
  }

  const related = listings.filter((item) => item.id !== listing.id && (item.type === listing.type || item.region === listing.region)).slice(0, 3);
  const action = listing.type === "stay" ? "Check dates" : listing.type === "eat" ? "Reserve a table" : "Choose a date";

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        <div className="container relative flex items-center justify-between py-5">
          <span className="absolute left-1/2 top-1/2 hidden h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-apricot/18 md:block" />
          <Link href="/explore" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-basalt/55 hover:text-apricot"><ArrowLeft className="h-4 w-4" /> Back to places</Link>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-none border-basalt/15 bg-paper" onClick={async () => { await navigator.clipboard?.writeText(window.location.href); toast("Link copied to your clipboard."); }}><Share2 className="mr-2 h-4 w-4" /> Share</Button>
            <Button variant="outline" size="sm" className="rounded-none border-basalt/15 bg-paper" onClick={() => toast(`${listing.title} saved for later.`)}><Bookmark className="mr-2 h-4 w-4" /> Save</Button>
          </div>
        </div>

        <section className="container grid gap-2 md:grid-cols-[1.45fr_0.72fr] md:grid-rows-2">
          <div className="brand-notch relative min-h-[360px] overflow-hidden md:row-span-2 md:min-h-[600px]">
            <img src={listing.gallery[0]} alt={listing.title} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-basalt/60 via-transparent to-transparent" />
            <div className="absolute bottom-7 left-7 max-w-xl text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">{typeLabels[listing.type]} · {listing.city}</p>
              <h1 className="mt-2 font-display text-5xl leading-[0.92] tracking-[-0.04em] sm:text-6xl lg:text-7xl">{listing.title}</h1>
            </div>
          </div>
          <div className="hidden overflow-hidden md:block"><img src={listing.gallery[1]} alt="" className="h-full w-full object-cover" /></div>
          <div className="hidden overflow-hidden md:block"><img src={listing.gallery[2]} alt="" className="h-full w-full object-cover" /></div>
        </section>

        <section className="container grid gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-20">
          <div>
            <div className="grid gap-7 border-b border-basalt/10 pb-10 sm:grid-cols-[0.72fr_1.28fr]">
              <div>
                <p className="eyebrow">{listing.eyebrow}</p>
                <p className="mt-4 flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-apricot" /> {listing.city}, {listing.region}</p>
                <div className="mt-6 space-y-4">
                  {listing.facts.map((fact) => <div key={fact.label}><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/40">{fact.label}</p><p className="mt-1 font-semibold">{fact.value}</p></div>)}
                </div>
              </div>
              <div>
                <h2 className="font-display text-4xl leading-tight tracking-[-0.03em]">{listing.shortDescription}</h2>
                <p className="mt-6 text-base leading-8 text-basalt/62">{listing.longDescription}</p>
              </div>
            </div>

            <div className="py-10">
              <p className="eyebrow">What’s part of the experience</p>
              <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {listing.amenities.map((amenity) => <div key={amenity} className="flex items-center gap-3 border-b border-basalt/10 pb-3 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-sevan/10 text-sevan"><Check className="h-3.5 w-3.5" /></span>{amenity}</div>)}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {listing.gallery.slice(2, 4).map((image, index) => <img key={image} src={image} alt={`${listing.title} detail ${index + 1}`} className="aspect-[4/3] w-full object-cover" />)}
            </div>
          </div>

          <aside>
            <div className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
              <div className="flex items-end justify-between gap-4 border-b border-basalt/10 pb-5">
                <p><strong className="font-display text-4xl font-normal">{listing.priceLabel}</strong> <span className="text-sm text-basalt/50">/ {listing.priceUnit}</span></p>
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-tuff">Illustrative rate</span>
              </div>
              <label className="mt-5 block"><span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/45">Preferred date</span><div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-apricot" /><input type="date" className="h-11 w-full border border-basalt/15 bg-paper pl-10 pr-3 text-sm outline-none focus:border-apricot" /></div></label>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-basalt/55">
                <div className="border border-basalt/10 bg-paper p-3"><Clock3 className="mb-2 h-4 w-4 text-sevan" /> Flexible timing</div>
                <div className="border border-basalt/10 bg-paper p-3"><Users className="mb-2 h-4 w-4 text-tuff" /> Small scale</div>
              </div>
            <Button className="mt-5 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={() => toast("Your date has been noted. Live availability would connect here.")}>{action}</Button>
              <p className="mt-3 text-center text-[11px] leading-5 text-basalt/42">No payment is taken in this marketplace concept.</p>
            </div>
          </aside>
        </section>

        <section className="relative overflow-hidden border-y border-basalt/10 bg-chalk">
          <div className="pointer-events-none absolute -right-12 -top-20 text-[14rem] font-bold leading-none tracking-[-0.12em] text-apricot/[0.07]">re.</div>
          <div className="container relative grid gap-8 py-12 lg:grid-cols-[0.65fr_1.35fr] lg:items-center lg:py-16">
            <div>
              <p className="eyebrow">On the map</p>
              <h2 className="mt-3 font-display text-5xl leading-none tracking-[-0.04em]">Meet the neighborhood.</h2>
              <p className="mt-5 max-w-sm text-sm leading-6 text-basalt/55">Use the map as a starting point. Exact arrival notes are shared once a date is confirmed.</p>
            </div>
            <ArmeniaMap listings={[listing]} single className="h-[430px]" />
          </div>
        </section>

        <section className="container py-16 lg:py-24">
          <div className="flex items-end justify-between gap-5">
            <div><p className="eyebrow">Keep exploring</p><h2 className="mt-3 font-display text-5xl tracking-[-0.04em]">Follow the next thread.</h2></div>
            <Link href="/explore" className="hidden text-xs font-bold uppercase tracking-[0.15em] text-apricot sm:block">View all places</Link>
          </div>
          <div className="mt-9 grid gap-9 md:grid-cols-3">{related.map((item) => <ListingCard key={item.id} listing={item} />)}</div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-basalt/10 bg-paper/95 px-4 py-3 shadow-[0_-10px_30px_rgba(35,35,33,0.08)] backdrop-blur lg:hidden">
        <p><strong className="font-display text-2xl font-normal">{listing.priceLabel}</strong> <span className="text-xs text-basalt/45">/ {listing.priceUnit}</span></p>
        <Button className="rounded-none bg-apricot text-white" onClick={() => toast("Live availability would connect here.")}>{action}</Button>
      </div>
      <SiteFooter />
    </div>
  );
}
