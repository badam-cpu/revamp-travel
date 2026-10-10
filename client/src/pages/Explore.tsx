/** Revamp brandbook: marketplace utility uses bold sans hierarchy, white surfaces, orange filters, rounded cards, and a synchronized atlas. */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { supabase } from "@/lib/supabase";
import { Filter, Map as MapIcon, RotateCcw, SlidersHorizontal } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SearchBar } from "@/components/SearchBar";
import { ListingCard } from "@/components/ListingCard";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ListingType, typeLabels } from "@/data/listings";
import { isCuratedType, PLACE_CATEGORIES, PLACE_GROUPS, placeCategoryLabel, placeGroupForCategory, hasOffer, type OfferType } from "@shared/listings";
import { slugify } from "@/lib/slug";
import { useListings } from "@/contexts/ListingsContext";
import { useSite } from "@/contexts/SiteContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { buildCollectionPageJsonLd } from "@shared/seo";
import { cn } from "@/lib/utils";

const validTypes = new Set(["all", "stay", "eat", "tour", "experience", "place"]);
const validOffers = new Set(["all", "nightly", "monthly", "sale"]);
// revampstay offer tabs — short stays (nightly), long-term (monthly), for sale.
const OFFER_CHIPS: { value: string; label: string }[] = [
  { value: "all", label: "All homes" },
  { value: "nightly", label: "Short stays" },
  { value: "monthly", label: "Long-term" },
  { value: "sale", label: "For sale" },
];

// Canonicalize an Armenian region name so "Tavush" and "Tavush Province" (or
// "…Marz") collapse to one filter option and still match listings either way.
const normalizeRegion = (r: string) => r.trim().replace(/\s+(province|marz)$/i, "").trim();

export default function Explore({ initialType = "" }: { initialType?: string }) {
  const [, navigate] = useLocation();
  const searchStr = useSearch(); // live query string — re-renders when the URL changes
  const { publicListings: listings, loading } = useListings();
  const { settings } = useSiteSettings();
  const params = new URLSearchParams(searchStr);
  const urlType = params.get("type") || initialType;
  const [query, setQuery] = useState(params.get("query") || "");
  const [type, setType] = useState(validTypes.has(urlType) ? urlType : "all");
  const [region, setRegion] = useState(params.get("region") || "all");
  // Visit (place) sub-filter: "all", a category slug (museum / pharmacy / …), or
  // a whole group as "g:<groupSlug>" (e.g. g:everyday). Deep-linkable via
  // ?cat=<slug> or ?group=<slug> so the guide can land on Everyday essentials.
  const initialPlaceCat = params.get("group") ? `g:${params.get("group")}` : params.get("cat") || "all";
  const [placeCat, setPlaceCat] = useState(initialPlaceCat);
  const site = useSite();
  // revampstay offer filter (Short stays / Long-term / For sale). Deep-linkable
  // via ?offer=nightly|monthly|sale. "all" = no offer constraint — the default
  // everywhere, so it never affects the vacations site.
  const urlOffer = params.get("offer") || "all";
  const [offer, setOffer] = useState(validOffers.has(urlOffer) ? urlOffer : "all");
  const PAGE = 12;
  const [visible, setVisible] = useState(PAGE);

  // Re-sync from the URL whenever it changes — e.g. a new SearchBar submit while
  // we're already on /explore (same route, so the component isn't remounted).
  // Local edits (the in-page filter / chips) don't touch the URL, so they persist.
  useEffect(() => {
    const p = new URLSearchParams(searchStr);
    const t = p.get("type") || initialType;
    setType(validTypes.has(t) ? t : "all");
    setQuery(p.get("query") || "");
    setRegion(p.get("region") || "all");
    setPlaceCat(p.get("group") ? `g:${p.get("group")}` : p.get("cat") || "all");
    const o = p.get("offer") || "all";
    setOffer(validOffers.has(o) ? o : "all");
  }, [searchStr, initialType]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // Stay-availability filter: when a date range is searched, hide stays whose
  // dates are blocked (iCal/manual) or already confirmed-booked for that window.
  const checkin = params.get("checkin") || "";
  const checkout = params.get("checkout") || "";
  const hasRange = !!checkin && !!checkout && checkout > checkin;
  const [bookedByListing, setBookedByListing] = useState<Map<string, { start: string; end: string }[]>>(new Map());
  useEffect(() => {
    if (!hasRange) return;
    supabase
      .from("listing_booked_ranges")
      .select("listing_id, start_date, end_date")
      .then(({ data }) => {
        const m = new Map<string, { start: string; end: string }[]>();
        (data ?? []).forEach((r: { listing_id: string; start_date: string; end_date: string }) => {
          const arr = m.get(r.listing_id) ?? [];
          arr.push({ start: r.start_date, end: r.end_date });
          m.set(r.listing_id, arr);
        });
        setBookedByListing(m);
      });
  }, [hasRange]);

  const addDayIso = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  // Two half-open [start,end) ranges overlap when each starts before the other ends.
  const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && aEnd > bStart;
  const isAvailableForRange = (listing: (typeof listings)[number]) => {
    if (!hasRange || listing.type !== "stay") return true; // range check applies to stays only
    const blocks: [string, string][] = [
      ...(listing.blockedRanges ?? []).map((b) => [b.start, addDayIso(b.end)] as [string, string]), // iCal end is inclusive
      ...(listing.manualBlockedRanges ?? []).map((b) => [b.start, b.end] as [string, string]), // manual end exclusive
      ...(bookedByListing.get(listing.id) ?? []).map((b) => [b.start, b.end] as [string, string]),
    ];
    return !blocks.some(([s, e]) => overlaps(checkin, checkout, s, e));
  };
  // Region options = the regions the site actually showcases: the admin's home
  // region cards, plus any region that has a live listing. (Not every Armenian
  // marze — an empty region would only create a dead-end "0 places" filter.)
  const showcasedRegions = (settings.homeContent.regionCards ?? []).map((r) => normalizeRegion(r.name)).filter(Boolean);
  const listingRegions = listings.map((listing) => normalizeRegion(listing.region)).filter(Boolean);
  // Dedupe case-insensitively (keep first-seen casing) so no near-duplicates.
  const regions = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of [...showcasedRegions, ...listingRegions]) {
      const k = r.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
    return out.sort();
  })();

  // A region is "in play" via the filter OR a region-named search query — the home
  // "Vayots Dzor" card routes to /explore?query=Vayots Dzor. When it is, the Eat
  // tab should scope to that region's guide (/eat/:region), not dump to the whole
  // Eat section.
  const activeRegion =
    region !== "all"
      ? region
      : regions.find((r) => normalizeRegion(r).toLowerCase() === normalizeRegion(query).toLowerCase()) ?? "";

  // Visit (place) sub-filter chips, grouped by parent (Culture / Everyday / Work)
  // and limited to the categories actually present in the data. Any custom
  // category not in the curated list falls into an "Other" group.
  const placeCategoryGroups = useMemo(() => {
    const present = new Set(listings.filter((l) => l.type === "place" && l.category).map((l) => l.category as string));
    const groups = PLACE_GROUPS.map((g) => ({
      key: g.slug as string,
      label: g.label as string,
      categories: PLACE_CATEGORIES.filter((c) => c.group === g.slug && present.has(c.slug)).map((c) => c.slug as string),
    })).filter((g) => g.categories.length > 0);
    const known = new Set(PLACE_CATEGORIES.map((c) => c.slug as string));
    const extras = Array.from(present).filter((s) => !known.has(s));
    if (extras.length) groups.push({ key: "other", label: "Other", categories: extras });
    return groups;
  }, [listings]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return listings.filter((listing) => {
      // Eat listings live in their own free guide (/explore/eat), not the
      // bookable marketplace grid — keep them out of "All places".
      // "All" = bookable inventory; the free curated guides (eat + place) have their own tabs.
      const matchesType = type === "all" ? !isCuratedType(listing.type) : listing.type === type;
      const matchesRegion = region === "all" || normalizeRegion(listing.region).toLowerCase() === region.toLowerCase();
      const matchesCategory =
        type !== "place" ||
        placeCat === "all" ||
        (placeCat.startsWith("g:") ? placeGroupForCategory(listing.category) === placeCat.slice(2) : listing.category === placeCat);
      // revampstay offer filter — only constrains stays; "all" is a no-op.
      const matchesOffer = offer === "all" || (listing.type === "stay" && hasOffer(listing, offer as OfferType));
      const haystack = [listing.title, listing.city, listing.region, listing.type, listing.shortDescription, ...listing.tags].join(" ").toLowerCase();
      return matchesType && matchesRegion && matchesCategory && matchesOffer && (!needle || haystack.includes(needle)) && isAvailableForRange(listing);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, region, placeCat, offer, listings, hasRange, checkin, checkout, bookedByListing]);

  // Reset the visible window whenever the result set's filters change.
  useEffect(() => setVisible(PAGE), [query, type, region, placeCat, offer, hasRange]);
  // Leaving the Visit tab clears its category sub-filter.
  useEffect(() => { if (type !== "place") setPlaceCat("all"); }, [type]);
  const shown = filtered.slice(0, visible);

  const reset = () => {
    setQuery("");
    setType("all");
    setRegion("all");
    setOffer("all");
  };

  const pageLabel = type === "all" ? "All listings" : typeLabels[type as ListingType];
  const canonicalPath = type === "all" ? "/explore" : `/explore/${type}`;
  useDocumentMeta({
    title: type === "all" ? "Explore Armenia | Revamp Vacations" : `${pageLabel} in Armenia | Revamp Vacations`,
    description:
      type === "all"
        ? "Browse places to stay, restaurants, and tours across Armenia on Revamp Vacations."
        : `Browse ${pageLabel.toLowerCase()} across Armenia on Revamp Vacations.`,
    canonicalPath,
    jsonLd: buildCollectionPageJsonLd(window.location.origin, canonicalPath, pageLabel, filtered),
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-basalt/10 bg-chalk">
          <div className="pointer-events-none absolute -right-20 -top-16 text-[13rem] font-bold leading-none tracking-[-0.12em] text-apricot/[0.08]">re.</div>
          <div className="absolute left-[36%] top-0 h-full w-px bg-apricot/14" />
          <span className="absolute right-8 top-5 hidden text-[8px] font-bold uppercase tracking-[0.24em] text-basalt/35 md:block">Atlas sheet 02 · 40.18° N</span>
          <div className="container relative grid gap-8 py-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-end lg:py-14">
            <div>
              <p className="eyebrow">The Armenia edit</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.94] tracking-[-0.04em] sm:text-6xl">Choose a thread<br />through the landscape.</h1>
            </div>
            <SearchBar compact initialQuery={query} initialType={type} />
          </div>
        </section>

        <section className="container py-8 lg:py-10">
          <div className="flex flex-col gap-5 border-b border-basalt/10 pb-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-apricot" /> Refine the edit</div>
              <Button variant="ghost" size="sm" className="rounded-none text-xs" onClick={reset}><RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset</Button>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-3">
              {site === "stay"
                ? OFFER_CHIPS.map(({ value, label }) => (
                    <button key={value} onClick={() => setOffer(value)} className={cn("filter-chip", offer === value && "active")}>
                      {label}
                    </button>
                  ))
                : ["all", "stay", "eat", "place", "tour", "experience"].map((value) => (
                    <button
                      key={value}
                      onClick={() => {
                        if (value === "tour") navigate(`/explore/tour${query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ""}`);
                        else if (value === "eat") navigate(activeRegion ? `/eat/${slugify(normalizeRegion(activeRegion))}` : "/explore/eat");
                        else setType(value);
                      }}
                      className={cn("filter-chip", type === value && "active")}
                    >
                      {value === "all" ? "All places" : typeLabels[value as ListingType]}
                    </button>
                  ))}
              <span className="mx-1 hidden h-9 w-px bg-basalt/10 sm:block" />
              <select value={region} onChange={(event) => setRegion(event.target.value)} className="h-10 border border-basalt/15 bg-paper px-3 text-xs font-bold uppercase tracking-[0.12em] outline-none focus:border-apricot">
                <option value="all">Every region</option>
                {regions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <label className="relative min-w-[210px] flex-1 sm:max-w-xs">
                <Filter className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-basalt/35" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by place or interest" className="h-10 w-full border border-basalt/15 bg-paper pl-9 pr-3 text-sm outline-none placeholder:text-basalt/35 focus:border-apricot" />
              </label>
            </div>
            {type === "place" && placeCategoryGroups.length > 0 && (
              <div className="mt-3 flex flex-col gap-2.5">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setPlaceCat("all")} className={cn("filter-chip", placeCat === "all" && "active")}>All types</button>
                </div>
                {placeCategoryGroups.map((g) => (
                  <div key={g.key} className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setPlaceCat(`g:${g.key}`)}
                      className={cn("mr-0.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors", placeCat === `g:${g.key}` ? "text-apricot" : "text-basalt/35 hover:text-basalt/60")}
                    >
                      {g.label}
                    </button>
                    {g.categories.map((c) => (
                      <button key={c} onClick={() => setPlaceCat(c)} className={cn("filter-chip", placeCat === c && "active")}>{placeCategoryLabel(c)}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-7 flex items-center justify-between">
            <p className="text-sm text-basalt/55">{loading ? "Loading places…" : <><strong className="text-basalt">{filtered.length}</strong> places across Armenia</>}</p>
            <Sheet>
              <SheetTrigger asChild>
                <Button className="rounded-none bg-basalt text-paper lg:hidden"><MapIcon className="mr-2 h-4 w-4" /> Show map</Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[92vh] border-0 bg-paper p-3">
                <SheetTitle className="sr-only">Map results</SheetTitle>
                <SheetDescription className="sr-only">View the currently filtered Armenia travel places on the interactive Revamp atlas.</SheetDescription>
                <ArmeniaMap listings={filtered} selectedId={selectedId} onSelect={setSelectedId} className="h-full" />
              </SheetContent>
            </Sheet>
          </div>

          {loading ? (
            <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(390px,0.9fr)]">
              <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => <ListingCardSkeleton key={i} />)}
              </div>
              <div className="hidden lg:block">
                <div className="sticky top-[100px] h-[calc(100vh-124px)] min-h-[560px] animate-pulse bg-basalt/5" />
              </div>
            </div>
          ) : filtered.length ? (
            <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(390px,0.9fr)]">
              <div>
                <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2">
                  {shown.map((listing) => <ListingCard key={listing.id} listing={listing} active={listing.id === selectedId} onHover={setSelectedId} />)}
                </div>
                {filtered.length > visible && (
                  <div className="mt-10 text-center">
                    <Button onClick={() => setVisible((v) => v + PAGE)} variant="outline" className="rounded-none border-basalt/20 px-6">
                      Show more ({filtered.length - visible} more)
                    </Button>
                  </div>
                )}
              </div>
              <div className="hidden lg:block">
                <ArmeniaMap listings={filtered} selectedId={selectedId} onSelect={setSelectedId} className="sticky top-[100px] h-[calc(100vh-124px)] min-h-[560px]" />
              </div>
            </div>
          ) : (
            <div className="my-20 border border-dashed border-basalt/20 bg-chalk px-6 py-16 text-center">
              <p className="eyebrow">No paths found</p>
              <h2 className="mt-3 font-display text-4xl">Try widening the map.</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-basalt/55">Clear one or more filters to discover a broader mix of Armenian stays, tables, and local routes.</p>
              <Button onClick={reset} className="mt-6 rounded-none bg-apricot text-white">Reset all filters</Button>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
