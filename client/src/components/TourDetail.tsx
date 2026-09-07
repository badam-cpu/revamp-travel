/**
 * GetYourGuide-style detail layout used only for type: "tour" listings
 * (ListingPage.tsx keeps the original shared template for stays/restaurants).
 * Everything here reads from the real Listing record — gallery, facts, tags,
 * amenities — and degrades gracefully for a host-added tour that has fewer
 * photos or fewer quick facts than the curated seed tours, instead of
 * assuming a fixed shape (that assumption is what caused a visible gap in
 * the old shared template for any tour with under 4 gallery photos).
 * No star ratings, review counts, or "X booked today" claims — this
 * brand's non-negotiable rules forbid fabricating any of that, so the
 * quick-facts row and "what's included" list carry the weight instead.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, Check, Clock, Gauge, Info, MapPin, Minus, Plus, Share2, Bookmark, Users } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Listing } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { TourCard } from "@/components/TourCard";
import { Button } from "@/components/ui/button";
import { factValue, otherFacts } from "@/lib/tourFacts";
import { cn } from "@/lib/utils";

export function TourDetail({ listing }: { listing: Listing }) {
  const { listings } = useListings();
  const [activeImage, setActiveImage] = useState(0);
  const [travelers, setTravelers] = useState(2);

  const images = listing.gallery.length ? listing.gallery : [listing.image];
  const duration = factValue(listing, "Duration");
  const group = factValue(listing, "Group", "Format");
  const level = factValue(listing, "Level", "Start");
  const extraFacts = otherFacts(listing);

  const relatedTours = useMemo(
    () => listings.filter((item) => item.type === "tour" && item.id !== listing.id).slice(0, 3),
    [listings, listing.id],
  );

  const bookNote = () => toast("Your date and traveler count have been noted. Live availability would connect here.");

  return (
    <>
      <div className="container relative flex items-center justify-between py-5">
        <Link href="/explore/tour" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-basalt/55 hover:text-apricot">
          <ArrowLeft className="h-4 w-4" /> Back to tours
        </Link>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-none border-basalt/15 bg-paper"
            onClick={async () => {
              await navigator.clipboard?.writeText(window.location.href);
              toast("Link copied to your clipboard.");
            }}
          >
            <Share2 className="mr-2 h-4 w-4" /> Share
          </Button>
          <Button variant="outline" size="sm" className="rounded-none border-basalt/15 bg-paper" onClick={() => toast(`${listing.title} saved for later.`)}>
            <Bookmark className="mr-2 h-4 w-4" /> Save
          </Button>
        </div>
      </div>

      <section className="container">
        <div className="brand-notch relative aspect-[16/9] overflow-hidden bg-basalt/5 sm:aspect-[2/1]">
          <img src={images[activeImage]} alt={`${listing.title} — photo ${activeImage + 1} of ${images.length}`} className="h-full w-full object-cover" />
          {images.length > 1 && (
            <span className="absolute bottom-4 right-4 bg-basalt/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white backdrop-blur-sm">
              {activeImage + 1} / {images.length}
            </span>
          )}
        </div>
        {images.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {images.map((src, i) => (
              <button
                key={src + i}
                onClick={() => setActiveImage(i)}
                aria-label={`Show photo ${i + 1}`}
                className={cn(
                  "h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                  i === activeImage ? "border-apricot" : "border-transparent opacity-70 hover:opacity-100",
                )}
              >
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="container grid gap-12 py-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-14">
        <div>
          <p className="eyebrow">{listing.eyebrow}</p>
          <h1 className="mt-2 font-display text-4xl leading-[0.98] tracking-[-0.035em] sm:text-5xl">{listing.title}</h1>
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-basalt/70">
            <MapPin className="h-4 w-4 text-apricot" /> {listing.city}, {listing.region}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-basalt/10 py-5">
            {duration && (
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4 text-apricot" /> {duration}
              </span>
            )}
            {group && (
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-apricot" /> {group}
              </span>
            )}
            {level && (
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <Gauge className="h-4 w-4 text-apricot" /> {level}
              </span>
            )}
            {extraFacts.map((fact) => (
              <span key={fact.label} className="inline-flex items-center gap-2 text-sm font-semibold">
                <Info className="h-4 w-4 text-apricot" /> {fact.label}: {fact.value}
              </span>
            ))}
          </div>

          {listing.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {listing.tags.map((tag) => (
                <span key={tag} className="filter-chip pointer-events-none">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-8">
            <p className="eyebrow">Overview</p>
            <h2 className="mt-3 font-display text-2xl leading-snug tracking-[-0.02em] text-basalt/90">{listing.shortDescription}</h2>
            <p className="mt-4 text-base leading-8 text-basalt/62">{listing.longDescription}</p>
          </div>

          {listing.amenities.length > 0 && (
            <div className="mt-10 border-t border-basalt/10 pt-8">
              <p className="eyebrow">What's included</p>
              <div className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {listing.amenities.map((amenity) => (
                  <div key={amenity} className="flex items-center gap-3 border-b border-basalt/10 pb-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sevan/10 text-sevan">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {amenity}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-basalt/40">
                Anything beyond what's listed above — personal gear, extra meals, transport to Armenia — isn't included.
              </p>
            </div>
          )}

          <div className="mt-10 border-t border-basalt/10 pt-8">
            <p className="eyebrow">Starting point</p>
            <h2 className="mt-3 font-display text-3xl tracking-[-0.03em]">Meet here.</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-basalt/55">Use the map as a starting reference — exact meeting details are shared once a date is confirmed.</p>
            <ArmeniaMap listings={[listing]} single className="mt-6 h-[360px]" />
          </div>
        </div>

        <aside>
          <div className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
            <div className="flex items-end justify-between gap-4 border-b border-basalt/10 pb-5">
              <p>
                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">From</span>
                <strong className="font-display text-4xl font-normal">{listing.priceLabel}</strong> <span className="text-sm text-basalt/50">/ {listing.priceUnit}</span>
              </p>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-tuff">Illustrative rate</span>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/45">Preferred date</span>
              <input type="date" className="h-11 w-full border border-basalt/15 bg-paper px-3 text-sm outline-none focus:border-apricot" />
            </label>

            <div className="mt-4">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/45">Travelers</span>
              <div className="flex items-center justify-between border border-basalt/15 bg-paper px-3 py-2">
                <button
                  type="button"
                  aria-label="Fewer travelers"
                  onClick={() => setTravelers((t) => Math.max(1, t - 1))}
                  className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt hover:border-apricot hover:text-apricot"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="text-sm font-semibold">
                  {travelers} {travelers === 1 ? "traveler" : "travelers"}
                </span>
                <button
                  type="button"
                  aria-label="More travelers"
                  onClick={() => setTravelers((t) => Math.min(20, t + 1))}
                  className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt hover:border-apricot hover:text-apricot"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-basalt/10 pt-4 text-sm">
              <span className="text-basalt/55">Estimated total</span>
              <strong className="font-display text-xl font-normal">${listing.price * travelers}</strong>
            </div>

            <Button className="mt-5 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={bookNote}>
              Choose a date
            </Button>
            <p className="mt-3 text-center text-[11px] leading-5 text-basalt/42">No payment is taken in this marketplace concept.</p>
          </div>
        </aside>
      </section>

      {relatedTours.length > 0 && (
        <section className="container py-16 lg:py-24">
          <div className="flex items-end justify-between gap-5">
            <div>
              <p className="eyebrow">Keep exploring</p>
              <h2 className="mt-3 font-display text-4xl tracking-[-0.04em] sm:text-5xl">More tours like this.</h2>
            </div>
            <Link href="/explore/tour" className="hidden text-xs font-bold uppercase tracking-[0.15em] text-apricot sm:block">
              View all tours
            </Link>
          </div>
          <div className="mt-9 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {relatedTours.map((item) => (
              <TourCard key={item.id} listing={item} />
            ))}
          </div>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-basalt/10 bg-paper/95 px-4 py-3 shadow-[0_-10px_30px_rgba(35,35,33,0.08)] backdrop-blur lg:hidden">
        <p>
          <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-basalt/40">From</span>
          <strong className="font-display text-2xl font-normal">{listing.priceLabel}</strong> <span className="text-xs text-basalt/45">/ {listing.priceUnit}</span>
        </p>
        <Button className="rounded-none bg-apricot text-white" onClick={bookNote}>
          Choose a date
        </Button>
      </div>
    </>
  );
}
