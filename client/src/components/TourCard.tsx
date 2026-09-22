/**
 * GetYourGuide-inspired activity card: boxed white surface, hover-lift, and a
 * hoverable photo carousel drawn from the listing's own gallery. Deliberately
 * uses real facts (duration / group size / difficulty) in the slot where a
 * marketplace like this would normally show star ratings — this brand's
 * non-negotiable rule is no fabricated reviews, ratings, or urgency claims,
 * so the card leads with information that's actually true instead.
 */
import { useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Clock, Gauge, MapPin, Star, Users } from "lucide-react";
import { Link } from "wouter";
import { Listing } from "@/data/listings";
import { factValue } from "@/lib/tourFacts";
import { cn } from "@/lib/utils";
import { imgAttrs } from "@/lib/responsiveImg";
import { useSavedPlaces } from "@/contexts/SavedPlacesContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useExternalRatings } from "@/hooks/useExternalRatings";
import { DiscountBadge } from "@/components/DiscountBadge";

export function TourCard({ listing }: { listing: Listing }) {
  const images = listing.gallery.length ? listing.gallery : [listing.image];
  const [index, setIndex] = useState(0);
  const { isSaved, toggleSaved } = useSavedPlaces();
  const { format } = useCurrency();
  const ratingFor = useExternalRatings();
  const rating = ratingFor((listing as { operatorId?: string }).operatorId, listing.id);
  const saved = isSaved(listing.id);
  const priceLabel = listing.price > 0 ? format(Math.round(listing.price * 100)) : "Rate on request";

  const duration = factValue(listing, "Duration");
  const group = factValue(listing, "Group", "Format");
  const level = factValue(listing, "Level", "Start");

  const step = (delta: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIndex((current) => (current + delta + images.length) % images.length);
  };

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-basalt/12 bg-paper transition-all duration-200 hover:-translate-y-1 hover:border-basalt/20 hover:shadow-[0_18px_40px_rgba(33,33,33,0.14)]">
      <Link href={`/listing/${listing.slug}`} className="flex h-full flex-col focus-visible:outline-none">
        <div className="relative aspect-[4/3] overflow-hidden bg-basalt/5">
          {images.map((src, i) => (
            <img
              key={src + i}
              {...imgAttrs(src, "(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw")}
              alt={`${listing.title} — photo ${i + 1} of ${images.length}`}
              loading="lazy"
              className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", i === index ? "opacity-100" : "opacity-0")}
            />
          ))}

          {listing.featured && (
            <span className="absolute left-3 top-3 rounded-full bg-apricot px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-sm">
              Revamp pick
            </span>
          )}
          <DiscountBadge listing={listing} className="absolute bottom-3 left-3" />

          <button
            type="button"
            aria-label={saved ? `Remove ${listing.title} from saved` : `Save ${listing.title}`}
            aria-pressed={saved}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleSaved({ id: listing.id, title: listing.title });
            }}
            className={cn(
              "absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full shadow-sm backdrop-blur-sm transition-colors",
              saved ? "bg-apricot text-white" : "bg-white/90 text-basalt hover:bg-apricot hover:text-white",
            )}
          >
            <Bookmark className={cn("h-4 w-4", saved && "fill-current")} />
          </button>

          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={(event) => step(-1, event)}
                className="absolute left-2 top-1/2 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-basalt opacity-0 shadow-sm transition-opacity group-hover:opacity-100 sm:grid"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={(event) => step(1, event)}
                className="absolute right-2 top-1/2 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-basalt opacity-0 shadow-sm transition-opacity group-hover:opacity-100 sm:grid"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5">
                {images.map((_, i) => (
                  <span key={i} className={cn("h-1.5 w-1.5 rounded-full bg-white/60 transition-all", i === index && "w-3.5 bg-white")} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-center gap-1.5 text-xs text-basalt/50">
            <MapPin className="h-3.5 w-3.5 shrink-0" /> {listing.city}, {listing.region}
          </div>
          <h3 className="line-clamp-2 font-display text-lg leading-snug tracking-[-0.01em] text-basalt transition-colors group-hover:text-apricot">
            {listing.title}
          </h3>
          <p className="line-clamp-2 text-sm leading-6 text-basalt/58">{listing.shortDescription}</p>

          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-basalt/10 pt-3 text-xs text-basalt/60">
            {rating && (
              <span className="inline-flex items-center gap-1 font-semibold text-basalt">
                <Star className="h-3.5 w-3.5 fill-apricot text-apricot" /> {rating.avg.toFixed(1)}
                <span className="font-normal text-basalt/45">({rating.count})</span>
              </span>
            )}
            {duration && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-apricot" /> {duration}
              </span>
            )}
            {group && (
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-apricot" /> {group}
              </span>
            )}
            {level && (
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-apricot" /> {level}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">From</span>
            <span className="whitespace-nowrap text-right font-display text-xl text-basalt">
              {priceLabel} {listing.price > 0 && <span className="font-sans text-xs font-normal text-basalt/50">/ {listing.priceUnit}</span>}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
