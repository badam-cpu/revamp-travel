/**
 * Right-rail panel on an "eat" listing page. Restaurants are free, admin-curated
 * recommendations — never bookable — so instead of a booking widget this shows
 * the price band, the cached Google rating, honest "we don't earn from this"
 * attribution, and outward CTAs (directions, website, Google).
 */
import { Star, MapPin, Globe, ExternalLink, Bookmark, UtensilsCrossed } from "lucide-react";
import type { LiveListing } from "@/contexts/ListingsContext";
import { useSavedPlaces } from "@/contexts/SavedPlacesContext";
import { cn } from "@/lib/utils";

function directionsUrl(l: LiveListing): string {
  const { lat, lng } = l.coordinates || { lat: 0, lng: 0 };
  if (lat && lng) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${l.googlePlaceId ? `&query_place_id=${l.googlePlaceId}` : ""}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.title} ${l.city} ${l.region}`)}`;
}
function googleUrl(l: LiveListing): string | null {
  return l.googlePlaceId ? `https://www.google.com/maps/place/?q=place_id:${l.googlePlaceId}` : null;
}

export function EatGuidePanel({ listing }: { listing: LiveListing }) {
  const { isSaved, toggleSaved } = useSavedPlaces();
  const saved = isSaved(listing.id);
  const gmaps = googleUrl(listing);
  return (
    <div className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
      {/* Lead with what a diner cares about: the rating. */}
      {typeof listing.googleRating === "number" ? (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl font-normal leading-none">{listing.googleRating.toFixed(1)}</span>
            <Star className="h-5 w-5 fill-apricot text-apricot" />
          </div>
          <p className="mt-1.5 text-xs text-basalt/55">{listing.googleRatingCount ? `${listing.googleRatingCount.toLocaleString()} Google reviews` : "Google rating"}</p>
        </div>
      ) : typeof listing.tripadvisorRating !== "number" ? (
        <p className="font-display text-2xl font-normal text-basalt/70">Recommended</p>
      ) : null}

      {/* Tripadvisor rating — attribution per their terms: bubble image + link. */}
      {typeof listing.tripadvisorRating === "number" && (
        <div className={typeof listing.googleRating === "number" ? "mt-4 border-t border-basalt/10 pt-4" : ""}>
          <div className="flex items-center gap-2">
            {listing.tripadvisorRatingImage ? (
              <img src={listing.tripadvisorRatingImage} alt={`Tripadvisor rating ${listing.tripadvisorRating.toFixed(1)} of 5`} className="h-4" />
            ) : (
              <span className="font-semibold">{listing.tripadvisorRating.toFixed(1)}</span>
            )}
            <span className="text-xs text-basalt/55">{listing.tripadvisorRatingCount ? `${listing.tripadvisorRatingCount.toLocaleString()} Tripadvisor reviews` : "on Tripadvisor"}</span>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-2 border-t border-basalt/10 pt-5">
        <a
          href={directionsUrl(listing)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 bg-apricot px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-apricot/90"
        >
          <MapPin className="h-4 w-4" /> Get directions
        </a>
        {listing.website && (
          <a
            href={listing.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 border border-basalt/20 bg-paper px-4 py-3 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
          >
            <Globe className="h-4 w-4" /> Website
          </a>
        )}
        {listing.tripadvisorMenuUrl && (
          <a
            href={listing.tripadvisorMenuUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 border border-basalt/20 bg-paper px-4 py-3 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
          >
            <UtensilsCrossed className="h-4 w-4" /> View menu
          </a>
        )}
        {gmaps && (
          <a
            href={gmaps}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 border border-basalt/20 bg-paper px-4 py-3 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
          >
            <ExternalLink className="h-4 w-4" /> View on Google
          </a>
        )}
        {listing.tripadvisorUrl && (
          <a
            href={listing.tripadvisorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 border border-basalt/20 bg-paper px-4 py-3 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
          >
            <ExternalLink className="h-4 w-4" /> View on Tripadvisor
          </a>
        )}
        <button
          type="button"
          onClick={() => toggleSaved({ id: listing.id, title: listing.title })}
          className={cn(
            "inline-flex items-center justify-center gap-2 border px-4 py-3 text-sm font-semibold transition-colors",
            saved ? "border-apricot bg-apricot/10 text-apricot" : "border-basalt/20 bg-paper text-basalt hover:border-apricot hover:text-apricot",
          )}
        >
          <Bookmark className={cn("h-4 w-4", saved && "fill-current")} /> {saved ? "Saved" : "Save for later"}
        </button>
      </div>

      <p className="mt-5 border-t border-basalt/10 pt-4 text-xs leading-relaxed text-basalt/50">
        An independent Revamp pick — we don't earn from this recommendation. This spot takes reservations directly; contact the venue to book a table.
      </p>
    </div>
  );
}
