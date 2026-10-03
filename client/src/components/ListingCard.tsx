/** Revamp brandbook: use rounded image-led cards, compact marketplace facts, restrained motion, and no fabricated review signals. */
import { useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, MapPin, MoveUpRight, Play, Star } from "lucide-react";
import { Link } from "wouter";
import { Listing, typeLabels } from "@/data/listings";
import { cn } from "@/lib/utils";
import { useSavedPlaces } from "@/contexts/SavedPlacesContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { nightlyPriceRange } from "@shared/bookings";
import { imgAttrs } from "@/lib/responsiveImg";
import { DiscountBadge } from "@/components/DiscountBadge";
import { useExternalRatings } from "@/hooks/useExternalRatings";
import { useImpressionRef, trackListing } from "@/lib/track";
import { usePromoBadges } from "@/hooks/usePromoBadges";
import { hasVideo } from "@/lib/video";
import { promoBadgeText } from "@shared/promo";

export function ListingCard({ listing, large = false, active = false, onHover, surface = "" }: { listing: Listing; large?: boolean; active?: boolean; onHover?: (id?: string) => void; surface?: string }) {
  const { isSaved, toggleSaved } = useSavedPlaces();
  const impressionRef = useImpressionRef<HTMLElement>(listing.id, surface);
  const promoFor = usePromoBadges();
  const promoBadge = promoFor(listing.id, (listing as { operatorId?: string }).operatorId);
  const { format } = useCurrency();
  const isEat = listing.type === "eat";
  const ratingFor = useExternalRatings();
  const external = ratingFor((listing as { operatorId?: string }).operatorId, listing.id);
  // Eat = free recommendation: show its cached Google rating, not imported reviews.
  const rating = isEat
    ? listing.googleRating
      ? { avg: listing.googleRating, count: listing.googleRatingCount ?? 0 }
      : null
    : external;
  const saved = isSaved(listing.id);
  // Per-card photo carousel: cover first (keeps its focal point), then the
  // gallery, de-duped. Arrows/dots only render when there's more than one.
  const images = Array.from(new Set([listing.image, ...listing.gallery].filter(Boolean)));
  const [index, setIndex] = useState(0);
  const step = (delta: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIndex((current) => (current + delta + images.length) % images.length);
  };
  // Headline shows the LOWEST upcoming nightly rate ("from ֏X") when the stay
  // uses seasonal/daily pricing; otherwise just the base price.
  const priceRange = nightlyPriceRange({ priceCents: Math.round(listing.price * 100), priceUnit: listing.priceUnit, seasonalRates: listing.seasonalRates });
  const priceLabel = listing.price > 0 ? format(priceRange.lowCents) : "Rate on request";
  return (
    <article
      ref={impressionRef}
      className={cn("group relative h-full", active && "is-active")}
      onMouseEnter={() => onHover?.(listing.id)}
      onMouseLeave={() => onHover?.(undefined)}
    >
      <Link href={`/listing/${listing.slug}`} onClick={() => trackListing(listing.id, "card_click", surface)} className="flex h-full flex-col focus-visible:outline-none">
        <div className={cn("listing-image brand-notch relative overflow-hidden bg-basalt/5", large ? "aspect-[16/10]" : "aspect-[4/3]")}> 
          {images.map((src, i) => (
            <img
              key={src + i}
              {...imgAttrs(src, large ? "(min-width:1024px) 66vw, 100vw" : "(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw")}
              alt={images.length > 1 ? `${listing.title} — photo ${i + 1} of ${images.length}` : listing.title}
              loading="lazy"
              style={i === 0 ? { objectPosition: listing.coverFocus || undefined } : undefined}
              className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", i === index ? "opacity-100" : "opacity-0")}
            />
          ))}
          <div className="absolute inset-0 bg-gradient-to-t from-basalt/55 via-transparent to-transparent" />
          <span className="absolute left-4 top-4 bg-paper px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.17em] text-basalt">
            {typeLabels[listing.type]}
          </span>
          <DiscountBadge listing={listing} className="absolute left-4 top-14" />
          {promoBadge && (
            <span className="absolute right-14 top-4 bg-apricot px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white shadow-sm">
              {promoBadgeText(promoBadge, format)}
            </span>
          )}
          {hasVideo(listing.videoUrl) && (
            <span className="absolute bottom-4 right-4 inline-flex items-center gap-1 rounded-full bg-basalt/70 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm">
              <Play className="h-3 w-3 fill-white" /> Video
            </span>
          )}
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
              "absolute right-4 top-4 grid h-9 w-9 place-items-center text-white backdrop-blur-sm transition-colors",
              saved ? "bg-apricot" : "bg-basalt/55 hover:bg-apricot",
            )}
          >
            <Bookmark className={cn("h-4 w-4", saved && "fill-current")} />
          </button>
          <div className="absolute bottom-4 left-4 flex items-center gap-1.5 text-xs font-semibold text-white">
            <MapPin className="h-3.5 w-3.5" /> {listing.city}, {listing.region}
          </div>
          {rating && (
            <div className="absolute bottom-4 right-4 inline-flex items-center gap-1 bg-paper/95 px-2 py-1 text-xs font-semibold text-basalt shadow-sm backdrop-blur-sm">
              <Star className="h-3.5 w-3.5 fill-apricot text-apricot" /> {rating.avg.toFixed(1)}
              <span className="font-normal text-basalt/50">({rating.count})</span>
            </div>
          )}
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={(event) => step(-1, event)}
                className="absolute left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-paper/90 text-basalt opacity-0 shadow-md transition-opacity hover:bg-apricot hover:text-white group-hover:opacity-100 sm:grid"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={(event) => step(1, event)}
                className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-paper/90 text-basalt opacity-0 shadow-md transition-opacity hover:bg-apricot hover:text-white group-hover:opacity-100 sm:grid"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-[1.1rem] left-1/2 flex -translate-x-1/2 gap-1.5">
                {images.map((_, i) => (
                  <span key={i} className={cn("h-1.5 w-1.5 rounded-full bg-white/60 shadow transition-all", i === index && "w-3.5 bg-white")} />
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-start justify-between gap-4 pt-4">
          <div>
            <p className="mb-1 line-clamp-1 text-[10px] font-bold uppercase tracking-[0.17em] text-tuff">{listing.eyebrow}</p>
            <h3 className={cn("line-clamp-2 font-display leading-[1.05] tracking-[-0.025em] text-basalt transition-colors group-hover:text-apricot", large ? "text-[2rem]" : "text-[1.55rem]")}>{listing.title}</h3>
            <p className="mt-2 line-clamp-2 max-w-xl text-sm leading-6 text-basalt/58">{listing.shortDescription}</p>
          </div>
          <MoveUpRight className="mt-1 h-5 w-5 shrink-0 text-basalt/35 transition-all group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-apricot" />
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-basalt/10 pt-4 text-xs text-basalt/50">
          {isEat ? (
            <>
              <span className="min-w-0 truncate">{[listing.venueType || listing.cuisine, listing.neighborhood || listing.city].filter(Boolean).join(" · ")}</span>
              {listing.priceBand && <span className="shrink-0 font-bold tracking-wide text-basalt/70">{listing.priceBand}</span>}
            </>
          ) : (
            <>
              <span className="min-w-0 truncate">{listing.tags.slice(0, 2).join(" · ")}</span>
              <span className="shrink-0 whitespace-nowrap">{priceRange.varies && listing.price > 0 ? "from " : ""}<strong className="text-sm text-basalt">{priceLabel}</strong>{listing.price > 0 ? ` / ${listing.priceUnit}` : ""}</span>
            </>
          )}
        </div>
      </Link>
    </article>
  );
}
