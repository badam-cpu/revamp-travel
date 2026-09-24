/**
 * "Where to eat" — a free, admin-curated restaurant guide (the Eat category).
 * These are recommendations, not bookable inventory: no prices to transact, no
 * operator accounts. Listings are grouped by cuisine with a cuisine filter, and
 * each card links to the guide-style detail page.
 */
import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { X } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ListingCard } from "@/components/ListingCard";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { cn } from "@/lib/utils";

const OTHER = "More spots";
const normalizeRegion = (r: string) => r.trim().replace(/\s+(province|marz)$/i, "").trim();

export default function EatGuide() {
  const { listings, loading } = useListings();
  const search = useSearch();
  const regionParam = new URLSearchParams(search).get("region");
  const [cuisine, setCuisine] = useState("all");
  const [loc, setLoc] = useState("all");
  const [minRating, setMinRating] = useState(0);

  useDocumentMeta({
    title: "Where to eat in Armenia — Revamp Vacations",
    description: "An independent, hand-picked guide to restaurants, cafés and wine bars across Armenia. Free recommendations from Revamp — no bookings, no strings.",
    canonicalPath: "/explore/eat",
  });

  // Base set — narrowed to a region when arriving from Explore with ?region=,
  // so every downstream facet (types, locations, groups) reflects that region.
  const eateries = useMemo(() => {
    const all = listings.filter((l) => l.type === "eat");
    if (!regionParam) return all;
    const want = normalizeRegion(regionParam).toLowerCase();
    return all.filter((l) => normalizeRegion(l.region || "").toLowerCase() === want);
  }, [listings, regionParam]);

  // Venue-type facets present in the data (for the filter chips), most common first.
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    eateries.forEach((l) => {
      const c = l.venueType?.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [eateries]);

  // Distinct locations (city + its region) for the location filter.
  const locations = useMemo(() => {
    const seen = new Map<string, { city: string; region: string }>();
    eateries.forEach((l) => {
      const city = l.city?.trim();
      if (city && !seen.has(city.toLowerCase())) seen.set(city.toLowerCase(), { city, region: l.region?.trim() || "" });
    });
    return Array.from(seen.values()).sort((a, b) => a.city.localeCompare(b.city));
  }, [eateries]);

  // Best available rating for a spot (Google preferred, else Tripadvisor).
  const bestRating = (l: LiveListing) => l.googleRating ?? l.tripadvisorRating ?? 0;

  const shown = useMemo(
    () =>
      eateries.filter(
        (l) =>
          (cuisine === "all" || (l.venueType?.trim() || OTHER) === cuisine) &&
          (loc === "all" || l.city?.trim() === loc) &&
          (minRating === 0 || bestRating(l) >= minRating),
      ),
    [eateries, cuisine, loc, minRating],
  );

  // Group by venue type; within each group, best-rated first.
  const groups = useMemo(() => {
    const map = new Map<string, LiveListing[]>();
    shown.forEach((l) => {
      const key = l.venueType?.trim() || OTHER;
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    });
    map.forEach((arr) => arr.sort((a, b) => bestRating(b) - bestRating(a)));
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [shown]);

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        <section className="container pt-10 lg:pt-14">
          <p className="eyebrow">Where to eat</p>
          <h1 className="mt-2 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-0.03em] lg:text-6xl">Our favourite tables in Armenia.</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-basalt/60">
            An independent guide to the restaurants, cafés and wine bars we love — hand-picked by the Revamp team. These are free recommendations: we don't take bookings or earn a commission on them.
          </p>
          {regionParam && (
            <Link href="/explore/eat" className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-apricot/40 bg-apricot/5 px-3 py-1.5 text-sm font-semibold text-basalt hover:border-apricot">
              {normalizeRegion(regionParam)} <X className="h-3.5 w-3.5 text-basalt/50" />
            </Link>
          )}
        </section>

        {(types.length > 0 || locations.length > 0) && (
          <section className="container mt-8">
            <div className="flex flex-col gap-4 border-b border-basalt/10 pb-6">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                {locations.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/45">Location</span>
                    <select
                      value={loc}
                      onChange={(e) => setLoc(e.target.value)}
                      className="h-9 border border-basalt/15 bg-paper px-3 text-sm outline-none focus:border-apricot"
                    >
                      <option value="all">All of Armenia</option>
                      {locations.map((l) => (
                        <option key={l.city} value={l.city}>{l.region && l.region !== l.city ? `${l.city} · ${l.region}` : l.city}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/45">Rating</span>
                  <select
                    value={minRating}
                    onChange={(e) => setMinRating(Number(e.target.value))}
                    className="h-9 border border-basalt/15 bg-paper px-3 text-sm outline-none focus:border-apricot"
                  >
                    <option value={0}>Any rating</option>
                    <option value={4.5}>4.5★ &amp; up</option>
                    <option value={4}>4.0★ &amp; up</option>
                    <option value={3.5}>3.5★ &amp; up</option>
                  </select>
                </div>
              </div>
              {types.length > 0 && (
                <div className="flex flex-wrap gap-x-2 gap-y-3">
                  <button onClick={() => setCuisine("all")} className={cn("filter-chip", cuisine === "all" && "active")}>All types</button>
                  {types.map((c) => (
                    <button key={c} onClick={() => setCuisine(c)} className={cn("filter-chip", cuisine === c && "active")}>{c}</button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="container py-10 lg:py-12">
          {loading ? (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <ListingCardSkeleton key={i} />)}
            </div>
          ) : eateries.length === 0 ? (
            <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-16 text-center text-sm text-basalt/55">{regionParam ? `No restaurant picks in ${normalizeRegion(regionParam)} yet — check back soon.` : "No restaurant recommendations yet — check back soon."}</p>
          ) : shown.length === 0 ? (
            <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-16 text-center">
              <p className="text-sm text-basalt/55">No spots match these filters.</p>
              <button type="button" onClick={() => { setCuisine("all"); setLoc("all"); setMinRating(0); }} className="mt-3 text-sm font-semibold text-apricot hover:underline">Clear filters</button>
            </div>
          ) : (
            <div className="grid gap-14">
              {groups.map(([name, items]) => (
                <div key={name}>
                  <div className="mb-6 flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-2xl tracking-[-0.02em]">{name}</h2>
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-basalt/40">{items.length} spot{items.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((l) => <ListingCard key={l.id} listing={l} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
