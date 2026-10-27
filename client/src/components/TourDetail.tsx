/**
 * GetYourGuide-style detail layout shared by type: "tour" and type:
 * "experience" listings (ListingPage.tsx keeps the original shared template
 * for stays/restaurants). Experience-only Highlights/Not included/What to
 * bring/Good-to-know sections render conditionally when present.
 * Everything here reads from the real Listing record — gallery, facts, tags,
 * amenities — and degrades gracefully for a host-added tour that has fewer
 * photos or fewer quick facts than the curated seed tours, instead of
 * assuming a fixed shape (that assumption is what caused a visible gap in
 * the old shared template for any tour with under 4 gallery photos).
 * No star ratings, review counts, or "X booked today" claims — this
 * brand's non-negotiable rules forbid fabricating any of that, so the
 * quick-facts row and "what's included" list carry the weight instead.
 */
import { gallerySlides, infoPoints } from "@shared/listings";
import { useAhaPhoto } from "@/lib/ahaBooking";
import { ListingFaq } from "@/components/ListingFaq";
import { photoCaption } from "@shared/listings";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Backpack, Ban, Car, Check, Clock, Gauge, Info, Languages, MapPin, Play, Share2, Bookmark, Sparkles, UserCheck, Users, X } from "lucide-react";
import { Link } from "wouter";
import { shareCurrentPage } from "@/lib/share";
import { Listing } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { useSavedPlaces } from "@/contexts/SavedPlacesContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { TourCard } from "@/components/TourCard";
import { formatLocation } from "@/lib/region";
import { BookingPanel } from "@/components/BookingPanel";
import { Button } from "@/components/ui/button";
import { factValue, otherFacts } from "@/lib/tourFacts";
import { cn } from "@/lib/utils";
import { imgAttrs } from "@/lib/responsiveImg";
import { trackEvent } from "@/lib/analytics";
import { trackListing } from "@/lib/track";
import { OperatorBrand } from "@/components/OperatorBrand";
import { ListingVideo } from "@/components/ListingVideo";
import { ExternalReviews } from "@/components/ExternalReviews";
import { ExpandableDescription } from "@/components/ExpandableDescription";

export function TourDetail({ listing }: { listing: Listing }) {
  const { publicListings: listings } = useListings();
  const { isSaved, toggleSaved } = useSavedPlaces();
  const { format } = useCurrency();
  const priceLabel = listing.price > 0 ? format(Math.round(listing.price * 100)) : "Rate on request";
  const saved = isSaved(listing.id);
  const [activeImage, setActiveImage] = useState(0);
  const live = listings.find((l) => l.id === listing.id) ?? null;

  // Show the sticky mobile "Book" bar only once the inline booking panel (#book)
  // has scrolled out of view — so there's never two Book buttons at once.
  const [showMobileBar, setShowMobileBar] = useState(false);
  useEffect(() => {
    const el = document.getElementById("book");
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setShowMobileBar(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [listing.id, live]);

  const images = listing.gallery.length ? listing.gallery : [listing.image];
  // The video is one of the gallery slides, at the host's chosen position (0120).
  const slides = gallerySlides(images, listing.videoUrl, listing.videoPosition);
  const current = slides[activeImage] ?? slides[0];
  // "Show me the route" — Aha shows photo N (numbered like `images`) as the main image.
  useAhaPhoto(listing.slug, (index) => {
    const at = slides.findIndex((x) => x.kind === "photo" && x.src === images[index]);
    if (at < 0) return `There are ${images.length} photos — which one would you like to see?`;
    setActiveImage(at);
    document.getElementById("tour-gallery")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return `Photo ${index + 1} of ${images.length} is showing at the top of the page.`;
  });
  const duration = factValue(listing, "Duration");
  const group = factValue(listing, "Group", "Format", "Group size");
  const level = factValue(listing, "Level", "Start");
  const extraFacts = otherFacts(listing);

  const isExperience = listing.type === "experience";
  const browsePath = isExperience ? "/explore/experience" : "/explore/tour";
  const browseNoun = isExperience ? "experiences" : "tours";

  const relatedItems = useMemo(
    () => listings.filter((item) => item.type === listing.type && item.id !== listing.id).slice(0, 3),
    [listings, listing.id, listing.type],
  );

  // GA funnel + first-party per-listing view (powers the analytics dashboard).
  useEffect(() => {
    trackEvent("view_item", { item_id: listing.id, item_name: listing.title, item_category: listing.type });
    trackListing(listing.id, "view", "detail");
  }, [listing.id]);

  // The prop is typed as the base Listing, but the runtime object is a LiveListing.
  const operatorId = (listing as { operatorId?: string }).operatorId;

  return (
    <>
      <div className="container relative flex items-center justify-between py-5">
        <Link href={browsePath} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-basalt/55 hover:text-apricot">
          <ArrowLeft className="h-4 w-4" /> Back to {browseNoun}
        </Link>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-none border-basalt/15 bg-paper"
            onClick={() => shareCurrentPage(listing.title)}
          >
            <Share2 className="mr-2 h-4 w-4" /> Share
          </Button>
          <Button variant="outline" size="sm" aria-pressed={saved} className={cn("rounded-none border-basalt/15 bg-paper", saved && "border-apricot text-apricot")} onClick={() => toggleSaved({ id: listing.id, title: listing.title })}>
            <Bookmark className={cn("mr-2 h-4 w-4", saved && "fill-current")} /> {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      <section id="tour-gallery" className="container scroll-mt-24">
        <div className="brand-notch relative aspect-[16/9] overflow-hidden bg-basalt/5 sm:aspect-[2/1]">
          {current.kind === "video" ? (
            <div className="h-full w-full">
              <ListingVideo url={current.url} poster={images[0]} className="h-full rounded-none object-cover aspect-auto" />
            </div>
          ) : (
            <img {...imgAttrs(current.src, "(min-width:1024px) 1100px, 100vw")} alt={photoCaption(listing, current.src) || `${listing.title} — photo ${activeImage + 1} of ${slides.length}`} style={activeImage === 0 ? { objectPosition: listing.coverFocus || undefined } : undefined} className="h-full w-full object-cover" />
          )}
          {slides.length > 1 && current.kind === "photo" && (
            <span className="pointer-events-none absolute bottom-4 right-4 bg-basalt/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white backdrop-blur-sm">
              {activeImage + 1} / {slides.length}
            </span>
          )}
        </div>
        {current.kind === "photo" && photoCaption(listing, current.src) && <p className="mt-2 text-sm leading-6 text-basalt/65">{photoCaption(listing, current.src)}</p>}
        {slides.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {slides.map((slide, i) => (
              <button
                key={(slide.kind === "photo" ? slide.src : slide.url) + i}
                onClick={() => setActiveImage(i)}
                aria-label={slide.kind === "video" ? "Play the video" : `Show photo ${i + 1}`}
                className={cn(
                  "relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                  i === activeImage ? "border-apricot" : "border-transparent opacity-70 hover:opacity-100",
                )}
              >
                <img {...imgAttrs(slide.kind === "photo" ? slide.src : images[0], "96px")} alt={slide.kind === "photo" ? photoCaption(listing, slide.src) : ""} loading="lazy" className="h-full w-full object-cover" />
                {slide.kind === "video" && (
                  <span className="absolute inset-0 grid place-items-center bg-basalt/45 text-white">
                    <Play className="h-5 w-5 fill-current" aria-hidden />
                  </span>
                )}
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
            <MapPin className="h-4 w-4 text-apricot" /> {formatLocation(listing.city, listing.region)}
          </p>

          {operatorId && <OperatorBrand operatorId={operatorId} className="mt-5" />}

          {(() => {
            // At a glance: a labelled grid (like stays). Bare numbers get their unit
            // ("6" → "6 hours", "2" → "Up to 2", "18" → "18+").
            const bare = (v?: string) => !!v && /^\d+(?:[.,]\d+)?$/.test(v.trim());
            const tiles: { key: string; label: string; value: string; Icon: typeof Clock; wide?: boolean }[] = [];
            if (duration) tiles.push({ key: "duration", label: "Duration", value: bare(duration) ? `${duration.trim()} ${duration.trim() === "1" ? "hour" : "hours"}` : duration, Icon: Clock });
            if (group) tiles.push({ key: "group", label: "Group size", value: bare(group) ? `Up to ${group.trim()}` : group, Icon: Users });
            if (level) tiles.push({ key: "level", label: "Level", value: level, Icon: Gauge });
            for (const f of extraFacts) {
              const l = f.label.toLowerCase();
              if (l === "languages") tiles.push({ key: l, label: f.label, value: f.value, Icon: Languages });
              else if (l === "minimum age") tiles.push({ key: l, label: f.label, value: bare(f.value) ? `${f.value.trim()}+` : f.value, Icon: UserCheck });
              else if (l === "parking") tiles.push({ key: l, label: f.label, value: f.value, Icon: Car });
              else if (l === "meeting point" || l === "starting point") tiles.push({ key: l, label: f.label, value: f.value, Icon: MapPin, wide: true });
              else tiles.push({ key: l, label: f.label, value: f.value, Icon: Info });
            }
            return tiles.length ? (
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-basalt/10 py-6 sm:grid-cols-4">
                {tiles.map((t) => (
                  <div key={t.key} className={cn("flex min-w-0 items-start gap-2.5", t.wide && "col-span-2")}>
                    <t.Icon className="mt-0.5 h-4 w-4 shrink-0 text-apricot" strokeWidth={1.75} aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">{t.label}</dt>
                      <dd className="mt-0.5 text-sm font-semibold [overflow-wrap:anywhere]">{t.value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            ) : null;
          })()}

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
            <ExpandableDescription text={listing.longDescription} lead={listing.shortDescription} title={listing.type === "experience" ? "About this experience" : "About this tour"} className="mt-4" />
          </div>

          {!!listing.highlights?.length && (() => {
            const startPoint = factValue(listing, "Starting point", "Meeting point");
            // A stop can carry an optional subtitle after " — " or " - ".
            const stops = listing.highlights.map((raw) => {
              const m = raw.split(/\s+[—-]\s+/);
              return { title: m[0].trim(), sub: m.slice(1).join(" — ").trim() };
            });
            type Node = { title: string; sub?: string; endpoint?: boolean };
            const nodes: Node[] = [
              ...(startPoint ? [{ title: "Starting location", sub: startPoint, endpoint: true }] : []),
              ...stops,
              ...(startPoint ? [{ title: "Arrive back at", sub: startPoint, endpoint: true }] : []),
            ];
            return (
              <div className="mt-8 border-t border-basalt/10 pt-8">
                <p className="eyebrow">Itinerary</p>
                <div className="relative mt-6 pl-9">
                  <span className="absolute left-[13px] top-2 bottom-2 w-px bg-basalt/15" aria-hidden />
                  {nodes.map((n, i) => (
                    <div key={i} className="relative mb-6 last:mb-0">
                      <span className={cn("absolute -left-9 top-0 grid h-7 w-7 place-items-center rounded-full text-white shadow-sm", n.endpoint ? "bg-apricot" : "bg-basalt")}>
                        {n.endpoint ? <MapPin className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                      </span>
                      <p className="font-semibold leading-6 text-basalt">{n.title}{n.endpoint && ":"}</p>
                      {n.sub && <p className="mt-0.5 text-sm leading-6 text-basalt/60">{n.sub}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

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
              {!listing.notIncluded?.length && (
                <p className="mt-4 text-xs leading-5 text-basalt/40">
                  Anything beyond what's listed above — personal gear, extra meals, transport to Armenia — isn't included.
                </p>
              )}
            </div>
          )}

          {!!listing.notIncluded?.length && (
            <div className="mt-10 border-t border-basalt/10 pt-8">
              <p className="eyebrow">Not included</p>
              <div className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {listing.notIncluded.map((item) => (
                  <div key={item} className="flex items-center gap-3 border-b border-basalt/10 pb-3 text-sm text-basalt/70">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!!listing.whatToBring?.length && (
            <div className="mt-10 border-t border-basalt/10 pt-8">
              <p className="eyebrow">What to bring</p>
              <div className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {listing.whatToBring.map((item) => (
                  <div key={item} className="flex items-center gap-3 border-b border-basalt/10 pb-3 text-sm text-basalt/70">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tuff/10 text-tuff">
                      <Backpack className="h-3.5 w-3.5" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!!listing.notSuitableFor?.length && (
            <div className="mt-10 border-t border-basalt/10 pt-8">
              <p className="eyebrow">Not suitable for</p>
              <div className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {listing.notSuitableFor.map((item) => (
                  <div key={item} className="flex items-center gap-3 border-b border-basalt/10 pb-3 text-sm text-basalt/70">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
                      <Ban className="h-3.5 w-3.5" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {listing.importantInfo && (
            <div className="mt-10 flex items-start gap-3 border border-tuff/30 bg-tuff/5 p-4 text-sm leading-6 text-basalt/75">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-tuff" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-tuff">Good to know</p>
                {infoPoints(listing.importantInfo).length > 1 ? (
                  <ul className="mt-1.5 grid gap-1.5">
                    {infoPoints(listing.importantInfo).map((p) => (
                      <li key={p} className="flex gap-2">
                        <span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-tuff" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5">{infoPoints(listing.importantInfo)[0] ?? listing.importantInfo}</p>
                )}
              </div>
            </div>
          )}

          <ListingFaq items={listing.faq} className="mt-10 scroll-mt-24" />

          <div className="mt-10 border-t border-basalt/10 pt-8">
            <p className="eyebrow">Starting point</p>
            <h2 className="mt-3 font-display text-3xl tracking-[-0.03em]">Meet here.</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-basalt/55">Use the map as a starting reference — exact meeting details are shared once a date is confirmed.</p>
            <ArmeniaMap listings={[listing]} single className="mt-6 h-[360px]" />
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

      {operatorId && (
        <div className="container">
          <ExternalReviews operatorId={operatorId} listingId={(listing as { id?: string }).id} kind={listing.type} className="pt-12 lg:pt-16" />
        </div>
      )}

      {relatedItems.length > 0 && (
        <section className="container py-16 lg:py-24">
          <div className="flex items-end justify-between gap-5">
            <div>
              <p className="eyebrow">Keep exploring</p>
              <h2 className="mt-3 font-display text-4xl tracking-[-0.04em] sm:text-5xl">More {browseNoun} like this.</h2>
            </div>
            <Link href={browsePath} className="hidden text-xs font-bold uppercase tracking-[0.15em] text-apricot sm:block">
              View all {browseNoun}
            </Link>
          </div>
          <div className="mt-9 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {relatedItems.map((item) => (
              <TourCard key={item.id} listing={item} surface="related" />
            ))}
          </div>
        </section>
      )}

      <div className={cn("fixed inset-x-0 bottom-0 z-40 items-center justify-between border-t border-basalt/10 bg-paper/95 px-4 py-3 shadow-[0_-10px_30px_rgba(35,35,33,0.08)] backdrop-blur lg:hidden", showMobileBar ? "flex" : "hidden")}>
        <p>
          <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-basalt/40">From</span>
          <strong className="font-display text-2xl font-normal">{priceLabel}</strong> {listing.price > 0 && <span className="text-xs text-basalt/45">/ {listing.priceUnit}</span>}
        </p>
        <Button
          onClick={() => document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="h-11 rounded-none bg-apricot px-6 text-white hover:bg-apricot/90"
        >
          Book
        </Button>
      </div>
    </>
  );
}
