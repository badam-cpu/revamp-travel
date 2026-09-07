/** Revamp brandbook: use rounded image-led cards, compact marketplace facts, restrained motion, and no fabricated review signals. */
import { Bookmark, MapPin, MoveUpRight } from "lucide-react";
import { Link } from "wouter";
import { Listing, typeLabels } from "@/data/listings";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function ListingCard({ listing, large = false, active = false, onHover }: { listing: Listing; large?: boolean; active?: boolean; onHover?: (id?: string) => void }) {
  return (
    <article
      className={cn("group relative", active && "is-active")}
      onMouseEnter={() => onHover?.(listing.id)}
      onMouseLeave={() => onHover?.(undefined)}
    >
      <Link href={`/listing/${listing.slug}`} className="block focus-visible:outline-none">
        <div className={cn("listing-image brand-notch relative overflow-hidden bg-basalt/5", large ? "aspect-[16/10]" : "aspect-[4/3]")}> 
          <img src={listing.image} alt={listing.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" />
          <div className="absolute inset-0 bg-gradient-to-t from-basalt/55 via-transparent to-transparent" />
          <span className="absolute left-4 top-4 bg-paper px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.17em] text-basalt">
            {typeLabels[listing.type]}
          </span>
          <button
            type="button"
            aria-label={`Save ${listing.title}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toast(`${listing.title} saved for later.`);
            }}
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center bg-basalt/55 text-white backdrop-blur-sm transition-colors hover:bg-apricot"
          >
            <Bookmark className="h-4 w-4" />
          </button>
          <div className="absolute bottom-4 left-4 flex items-center gap-1.5 text-xs font-semibold text-white">
            <MapPin className="h-3.5 w-3.5" /> {listing.city}, {listing.region}
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 pt-4">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.17em] text-tuff">{listing.eyebrow}</p>
            <h3 className={cn("font-display leading-[1.05] tracking-[-0.025em] text-basalt transition-colors group-hover:text-apricot", large ? "text-[2rem]" : "text-[1.55rem]")}>{listing.title}</h3>
            <p className="mt-2 line-clamp-2 max-w-xl text-sm leading-6 text-basalt/58">{listing.shortDescription}</p>
          </div>
          <MoveUpRight className="mt-1 h-5 w-5 shrink-0 text-basalt/35 transition-all group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-apricot" />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-basalt/10 pt-3 text-xs text-basalt/50">
          <span>{listing.tags.slice(0, 2).join(" · ")}</span>
          <span><strong className="text-sm text-basalt">{listing.priceLabel}</strong>{listing.price > 0 ? ` / ${listing.priceUnit}` : ""}</span>
        </div>
      </Link>
    </article>
  );
}
