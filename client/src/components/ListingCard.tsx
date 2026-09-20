/** Revamp brandbook: use rounded image-led cards, compact marketplace facts, restrained motion, and no fabricated review signals. */
import { Bookmark, MapPin, MoveUpRight } from "lucide-react";
import { Link } from "wouter";
import { Listing, typeLabels } from "@/data/listings";
import { cn } from "@/lib/utils";
import { useSavedPlaces } from "@/contexts/SavedPlacesContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { averageNightlyCents } from "@shared/bookings";
import { imgAttrs } from "@/lib/responsiveImg";
import { DiscountBadge } from "@/components/DiscountBadge";

export function ListingCard({ listing, large = false, active = false, onHover }: { listing: Listing; large?: boolean; active?: boolean; onHover?: (id?: string) => void }) {
  const { isSaved, toggleSaved } = useSavedPlaces();
  const { format } = useCurrency();
  const saved = isSaved(listing.id);
  // Headline shows the day-weighted average nightly rate when the stay uses
  // seasonal/daily rates; otherwise it's just the base price.
  const nightlyCents = averageNightlyCents({ priceCents: Math.round(listing.price * 100), priceUnit: listing.priceUnit, seasonalRates: listing.seasonalRates });
  const priceLabel = listing.price > 0 ? format(nightlyCents) : "Rate on request";
  return (
    <article
      className={cn("group relative", active && "is-active")}
      onMouseEnter={() => onHover?.(listing.id)}
      onMouseLeave={() => onHover?.(undefined)}
    >
      <Link href={`/listing/${listing.slug}`} className="block focus-visible:outline-none">
        <div className={cn("listing-image brand-notch relative overflow-hidden bg-basalt/5", large ? "aspect-[16/10]" : "aspect-[4/3]")}> 
          <img {...imgAttrs(listing.image, large ? "(min-width:1024px) 66vw, 100vw" : "(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw")} alt={listing.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" />
          <div className="absolute inset-0 bg-gradient-to-t from-basalt/55 via-transparent to-transparent" />
          <span className="absolute left-4 top-4 bg-paper px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.17em] text-basalt">
            {typeLabels[listing.type]}
          </span>
          <DiscountBadge listing={listing} className="absolute left-4 top-14" />
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
        </div>
        <div className="flex items-start justify-between gap-4 pt-4">
          <div>
            <p className="mb-1 line-clamp-1 text-[10px] font-bold uppercase tracking-[0.17em] text-tuff">{listing.eyebrow}</p>
            <h3 className={cn("line-clamp-2 font-display leading-[1.05] tracking-[-0.025em] text-basalt transition-colors group-hover:text-apricot", large ? "text-[2rem]" : "text-[1.55rem]")}>{listing.title}</h3>
            <p className="mt-2 line-clamp-2 max-w-xl text-sm leading-6 text-basalt/58">{listing.shortDescription}</p>
          </div>
          <MoveUpRight className="mt-1 h-5 w-5 shrink-0 text-basalt/35 transition-all group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-apricot" />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-basalt/10 pt-3 text-xs text-basalt/50">
          <span className="min-w-0 truncate">{listing.tags.slice(0, 2).join(" · ")}</span>
          <span className="shrink-0 whitespace-nowrap"><strong className="text-sm text-basalt">{priceLabel}</strong>{listing.price > 0 ? ` / ${listing.priceUnit}` : ""}</span>
        </div>
      </Link>
    </article>
  );
}
