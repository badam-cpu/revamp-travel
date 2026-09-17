/** Revamp brandbook: detail pages combine rounded imagery, bold sans hierarchy, concise facts, white space, and orange actions. */
import { useState } from "react";
import { ArrowLeft, BedDouble, Bookmark, Check, Coffee, Home, KeyRound, MapPin, Navigation, Share2, ShieldCheck, Sparkles, SprayCan, Users, Wifi } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { ListingCard } from "@/components/ListingCard";
import { TourDetail } from "@/components/TourDetail";
import { BookingPanel } from "@/components/BookingPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { groupAmenitiesForDisplay } from "@/components/AmenityPicker";
import { houseRuleIcon } from "@/lib/houseRules";
import { nearbySights } from "@/lib/yerevanSights";
import { findListing, typeLabels } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { useSavedPlaces } from "@/contexts/SavedPlacesContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { cn } from "@/lib/utils";
import { describeCancellationPolicy } from "@shared/bookings";
import { buildBreadcrumbJsonLd, buildListingJsonLd } from "@shared/seo";
import { toast } from "sonner";

/** What every Revamp stay includes — a marketplace-wide baseline shown on stay
 * pages (a stated standard Revamp holds stay operators to, not a per-listing
 * claim; the listing's own amenities are shown separately below). */
const REVAMP_STANDARD = [
  { icon: Wifi, label: "Fast Wi-Fi" },
  { icon: BedDouble, label: "Fresh linen and towels" },
  { icon: Coffee, label: "Tea, coffee, salt and oil" },
  { icon: SprayCan, label: "Cleaning and laundry supplies" },
  { icon: KeyRound, label: "Self check-in with a code" },
  { icon: Sparkles, label: "Cleaned before you arrive" },
];

/** How many of a listing's own amenities to show inline before the "show all"
 * modal — keeps a 30-35-amenity listing from flooding the page. */
const AMENITIES_INLINE_LIMIT = 10;

export default function ListingPage({ params }: { params: { slug: string } }) {
  const { listings, loading } = useListings();
  const { isSaved, toggleSaved } = useSavedPlaces();
  const { format } = useCurrency();
  const [amenitiesOpen, setAmenitiesOpen] = useState(false);
  const listing = findListing(params.slug, listings);
  const saved = listing ? isSaved(listing.id) : false;
  const priceLabel = listing && listing.price > 0 ? format(Math.round(listing.price * 100)) : "Rate on request";

  // Hook call must come before any early return (rules of hooks) — this
  // covers both the not-found and found cases with one call.
  useDocumentMeta({
    title: listing
      ? `${listing.title} — ${typeLabels[listing.type]} in ${listing.city} | Revamp Vacations`
      : loading
        ? "Loading… | Revamp Vacations"
        : "Place not found | Revamp Vacations",
    description: listing?.shortDescription ?? "This listing could not be found.",
    canonicalPath: `/listing/${params.slug}`,
    ogImage: listing?.image,
    noindex: !listing && !loading,
    jsonLd: listing
      ? [
          buildListingJsonLd(listing, window.location.origin),
          buildBreadcrumbJsonLd(window.location.origin, [
            { name: "Home", path: "/" },
            { name: "Explore", path: "/explore" },
            { name: typeLabels[listing.type], path: listing.type === "stay" ? "/explore/stay" : listing.type === "eat" ? "/explore/eat" : listing.type === "experience" ? "/explore/experience" : "/explore/tour" },
            { name: listing.title, path: `/listing/${listing.slug}` },
          ]),
        ]
      : undefined,
  });

  if (!listing) {
    // While the catalog is still loading (e.g. a hard refresh on this page,
    // before the Supabase fetch resolves), don't flash the not-found state —
    // the slug may well exist once listings arrive.
    if (loading) {
      return (
        <div className="min-h-screen bg-paper"><SiteHeader /><div className="container flex items-center justify-center py-32" aria-busy="true"><span className="h-7 w-7 animate-spin rounded-full border-2 border-basalt/15 border-t-apricot" /></div></div>
      );
    }
    return (
      <div className="min-h-screen bg-paper"><SiteHeader /><div className="container py-24 text-center"><p className="eyebrow">Place not found</p><h1 className="mt-4 font-display text-6xl">This path ends here.</h1><Button asChild className="mt-7 rounded-none bg-apricot text-white"><Link href="/explore">Return to the marketplace</Link></Button></div></div>
    );
  }

  const live = listings.find((l) => l.id === listing.id);

  // Tours and experiences get a dedicated GetYourGuide-style detail layout;
  // stays and restaurants keep the original shared template below.
  if (listing.type === "tour" || listing.type === "experience") {
    return (
      <div className="min-h-screen bg-paper text-basalt">
        <SiteHeader />
        <main>
          <TourDetail listing={listing} />
        </main>
        <SiteFooter />
      </div>
    );
  }

  const related = listings.filter((item) => item.id !== listing.id && (item.type === listing.type || item.region === listing.region)).slice(0, 3);

  // Listing-page derived data: grouped amenities for the "all amenities" modal,
  // an inline-limited slice so a 30+ amenity listing doesn't flood the page,
  // the operator's house rules, and the cancellation policy summary.
  const amenityGroups = groupAmenitiesForDisplay(listing.type, listing.amenities);
  const inlineAmenities = listing.amenities.slice(0, AMENITIES_INLINE_LIMIT);
  const hiddenAmenityCount = Math.max(0, listing.amenities.length - inlineAmenities.length);
  const houseRules = listing.houseRules ?? [];
  // Major central-Yerevan sights closest to this listing (curated list, English
  // names, distances computed here) — empty for listings outside that radius.
  const nearby = nearbySights(listing.coordinates.lat, listing.coordinates.lng);
  const cancellationText = describeCancellationPolicy(listing.cancellationPolicy, {
    freeCancelDays: listing.freeCancelDays,
    discountPercent: listing.nonrefundableDiscountPercent,
  });

  // "At a glance" facts for the left column, so it's never empty even when the
  // operator added no custom facts (derived from data the listing already has).
  const glance: { label: string; value: string; icon: typeof ShieldCheck }[] = [];
  if (listing.maxGuests) glance.push({ label: "Guests", value: `Up to ${listing.maxGuests}`, icon: Users });
  glance.push({ label: "Cancellation", value: listing.cancellationPolicy === "non_refundable" ? "Non-refundable" : "Flexible", icon: ShieldCheck });
  if (houseRules.includes("Self check-in")) glance.push({ label: "Check-in", value: "Self check-in", icon: KeyRound });
  glance.push({ label: "Type", value: typeLabels[listing.type], icon: Home });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        <div className="container relative flex items-center justify-between py-5">
          <span className="absolute left-1/2 top-1/2 hidden h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-apricot/18 md:block" />
          <Link href="/explore" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-basalt/55 hover:text-apricot"><ArrowLeft className="h-4 w-4" /> Back to places</Link>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-none border-basalt/15 bg-paper" onClick={async () => { await navigator.clipboard?.writeText(window.location.href); toast("Link copied to your clipboard."); }}><Share2 className="mr-2 h-4 w-4" /> Share</Button>
            <Button variant="outline" size="sm" aria-pressed={saved} className={cn("rounded-none border-basalt/15 bg-paper", saved && "border-apricot text-apricot")} onClick={() => toggleSaved({ id: listing.id, title: listing.title })}><Bookmark className={cn("mr-2 h-4 w-4", saved && "fill-current")} /> {saved ? "Saved" : "Save"}</Button>
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
                {listing.facts.length > 0 && (
                  <div className="mt-6 space-y-4">
                    {listing.facts.map((fact) => <div key={fact.label}><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/40">{fact.label}</p><p className="mt-1 font-semibold">{fact.value}</p></div>)}
                  </div>
                )}
                {glance.length > 0 && (
                  <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-basalt/10 pt-6">
                    {glance.map((g) => (
                      <div key={g.label} className="flex items-start gap-2.5">
                        <g.icon className="mt-0.5 h-4 w-4 shrink-0 text-apricot" strokeWidth={1.75} />
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">{g.label}</dt>
                          <dd className="mt-0.5 text-sm font-semibold">{g.value}</dd>
                        </div>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              <div>
                <h2 className="font-display text-4xl leading-tight tracking-[-0.03em]">{listing.shortDescription}</h2>
                <p className="mt-6 whitespace-pre-line text-base leading-8 text-basalt/62">{listing.longDescription}</p>
              </div>
            </div>

            {listing.type === "stay" && (
              <div className="my-10 brand-notch bg-apricot/10 p-7 sm:p-9">
                <p className="font-display text-3xl tracking-[-0.02em]">Revamp standard</p>
                <p className="mt-1 text-sm text-basalt/55">The same in every Revamp stay.</p>
                <div className="mt-6 grid gap-x-10 gap-y-4 sm:grid-cols-2">
                  {REVAMP_STANDARD.map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-3 text-[15px] text-basalt">
                      <Icon className="h-5 w-5 shrink-0 text-basalt" strokeWidth={1.75} /> {label}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setAmenitiesOpen(true)}
                  className="mt-7 rounded-full bg-basalt/[0.07] px-5 py-2.5 text-sm font-semibold text-basalt transition-colors hover:bg-basalt/15"
                >
                  All amenities
                </button>
              </div>
            )}

            {listing.amenities.length > 0 && (
              <div id="amenities" className="py-10 scroll-mt-24">
                <p className="eyebrow">What’s part of the experience</p>
                <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  {inlineAmenities.map((amenity) => <div key={amenity} className="flex items-center gap-3 border-b border-basalt/10 pb-3 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-sevan/10 text-sevan"><Check className="h-3.5 w-3.5" /></span>{amenity}</div>)}
                </div>
                {hiddenAmenityCount > 0 && (
                  <Button variant="outline" className="mt-7 rounded-none border-basalt/20 bg-paper" onClick={() => setAmenitiesOpen(true)}>
                    Show all {listing.amenities.length} amenities
                  </Button>
                )}
              </div>
            )}

            {houseRules.length > 0 && (
              <div className="border-t border-basalt/10 py-10">
                <p className="eyebrow">House rules</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {houseRules.map((rule) => {
                    const Icon = houseRuleIcon(rule);
                    return (
                      <span key={rule} className="inline-flex items-center gap-2.5 border border-basalt/12 bg-chalk px-4 py-2.5 text-sm font-medium text-basalt">
                        <Icon className="h-4 w-4 shrink-0 text-basalt/60" strokeWidth={1.75} /> {rule}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="border-t border-basalt/10 py-10">
              <p className="eyebrow">Cancellation policy</p>
              <p className="mt-4 flex items-start gap-3 text-base leading-7 text-basalt/70">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-apricot" strokeWidth={1.75} />
                <span>{cancellationText}.{listing.cancellationPolicy === "non_refundable" ? " This rate is non-refundable." : " Cancel before the cutoff for a full refund; after it, the booking is non-refundable."}</span>
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {listing.gallery.slice(2, 4).map((image, index) => <img key={image} src={image} alt={`${listing.title} detail ${index + 1}`} className="aspect-[4/3] w-full object-cover" />)}
            </div>
          </div>

          <aside>
            {live ? (
              <BookingPanel listing={live} />
            ) : (
              <div className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
                <p><strong className="font-display text-4xl font-normal">{priceLabel}</strong> {listing.price > 0 && <span className="text-sm text-basalt/50">/ {listing.priceUnit}</span>}</p>
                <p className="mt-4 text-sm leading-6 text-basalt/55">Booking isn't available in offline preview.</p>
              </div>
            )}
          </aside>
        </section>

        <section className="relative overflow-hidden border-y border-basalt/10 bg-chalk">
          <div className="pointer-events-none absolute -right-12 -top-20 text-[14rem] font-bold leading-none tracking-[-0.12em] text-apricot/[0.07]">re.</div>
          <div className="container relative grid gap-8 py-12 lg:grid-cols-[0.65fr_1.35fr] lg:items-center lg:py-16">
            <div>
              <p className="eyebrow">On the map</p>
              <h2 className="mt-3 font-display text-5xl leading-none tracking-[-0.04em]">Meet the neighborhood.</h2>
              <p className="mt-5 max-w-sm whitespace-pre-line text-sm leading-6 text-basalt/55">
                {listing.neighborhood?.trim() || "Use the map as a starting point. Exact arrival notes are shared once a date is confirmed."}
              </p>
              {nearby.length > 0 && (
                <div className="mt-7">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/40">Sights nearby</p>
                  <ul className="mt-3 grid gap-2">
                    {nearby.map((place) => (
                      <li key={place.name} className="flex items-center gap-3 text-sm text-basalt/75">
                        <Navigation className="h-3.5 w-3.5 shrink-0 text-apricot" strokeWidth={2} />
                        <span className="font-medium text-basalt">{place.name}</span>
                        {place.category && <span className="text-basalt/45">· {place.category}</span>}
                        {typeof place.distanceM === "number" && (
                          <span className="ml-auto shrink-0 text-xs tabular-nums text-basalt/45">
                            {place.distanceM < 1000 ? `${place.distanceM} m` : `${(place.distanceM / 1000).toFixed(1)} km`}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
        <p><strong className="font-display text-2xl font-normal">{priceLabel}</strong> {listing.price > 0 && <span className="text-xs text-basalt/45">/ {listing.priceUnit}</span>}</p>
        <Button
          onClick={() => document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="h-11 rounded-none bg-apricot px-6 text-white hover:bg-apricot/90"
        >
          Book
        </Button>
      </div>
      <Dialog open={amenitiesOpen} onOpenChange={setAmenitiesOpen}>
        <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto rounded-none sm:max-w-2xl">
          <DialogHeader className="border-b border-basalt/10 pb-4">
            <DialogTitle className="font-display text-2xl font-normal tracking-[-0.02em]">Amenities</DialogTitle>
          </DialogHeader>
          <div className="grid gap-8 py-6">
            {amenityGroups.map((group) => (
              <div key={group.category}>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">{group.category}</p>
                <div className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <div key={item} className="flex items-center gap-3 border-b border-basalt/10 pb-3 text-sm text-basalt">
                      <Check className="h-4 w-4 shrink-0 text-apricot" /> {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <SiteFooter />
    </div>
  );
}
