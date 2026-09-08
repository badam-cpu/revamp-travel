/**
 * A dedicated, GetYourGuide-style browser for tours specifically (kept separate
 * from the generic Explore page used by stays/restaurants/"all"). Same visual
 * language as GetYourGuide's activity grid — hero band with search, real
 * category pills, duration/sort controls, boxed cards — but with no fabricated
 * star ratings, review counts, or "X booked today" urgency claims, since this
 * brand's non-negotiable content rules forbid inventing customer sentiment.
 * Filters and category pills are all derived from the live catalog's real
 * tags and facts, not hardcoded categories.
 */
import { useMemo, useState } from "react";
import { Map as MapIcon, Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { TourCard } from "@/components/TourCard";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useListings } from "@/contexts/ListingsContext";
import { cn } from "@/lib/utils";

type SortKey = "recommended" | "price-asc" | "price-desc" | "duration-asc";

function durationHours(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  const dayMatch = value.match(/(\d+(?:\.\d+)?)\s*day/i);
  if (dayMatch) return parseFloat(dayMatch[1]) * 24;
  const hourMatch = value.match(/(\d+(?:\.\d+)?)\s*hour/i);
  if (hourMatch) return parseFloat(hourMatch[1]);
  return Number.POSITIVE_INFINITY;
}

const DURATION_BUCKETS: { key: string; label: string; test: (hours: number) => boolean }[] = [
  { key: "half", label: "Half-day", test: (h) => h <= 6 },
  { key: "full", label: "Full-day", test: (h) => h > 6 && h <= 24 },
  { key: "multi", label: "Multi-day", test: (h) => h > 24 },
];

export default function Tours() {
  const { listings } = useListings();
  const tours = useMemo(() => listings.filter((listing) => listing.type === "tour"), [listings]);
  const initialQuery = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("query") || "" : "";

  const [query, setQuery] = useState(initialQuery);
  const [tag, setTag] = useState("all");
  const [duration, setDuration] = useState("all");
  const [sort, setSort] = useState<SortKey>("recommended");
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    tours.forEach((tour) => tour.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([t]) => t);
  }, [tours]);

  const availableBuckets = useMemo(() => {
    return DURATION_BUCKETS.filter((bucket) =>
      tours.some((tour) => bucket.test(durationHours(tour.facts.find((f) => f.label === "Duration")?.value))),
    );
  }, [tours]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const activeBucket = DURATION_BUCKETS.find((b) => b.key === duration);
    const matches = tours.filter((tour) => {
      const matchesTag = tag === "all" || tour.tags.includes(tag);
      const hours = durationHours(tour.facts.find((f) => f.label === "Duration")?.value);
      const matchesDuration = !activeBucket || activeBucket.test(hours);
      const haystack = [tour.title, tour.city, tour.region, tour.shortDescription, ...tour.tags].join(" ").toLowerCase();
      const matchesQuery = !needle || haystack.includes(needle);
      return matchesTag && matchesDuration && matchesQuery;
    });

    return [...matches].sort((a, b) => {
      if (sort === "price-asc") return a.price - b.price;
      if (sort === "price-desc") return b.price - a.price;
      if (sort === "duration-asc") {
        return (
          durationHours(a.facts.find((f) => f.label === "Duration")?.value) -
          durationHours(b.facts.find((f) => f.label === "Duration")?.value)
        );
      }
      return Number(b.featured) - Number(a.featured);
    });
  }, [tours, query, tag, duration, sort]);

  const reset = () => {
    setQuery("");
    setTag("all");
    setDuration("all");
    setSort("recommended");
  };

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-basalt/10 bg-basalt text-paper">
          <img src="/images/garni.svg" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-t from-basalt via-basalt/75 to-basalt/40" />
          <div className="container relative py-14 lg:py-20">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-apricot">Tours & experiences</p>
            <h1 className="mt-3 max-w-xl font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Guided days across Armenia.</h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-paper/65">
              Small-group hikes, monastery routes, and food-and-craft walks — led by local guides, priced per person.
            </p>
            <label className="relative mt-7 block max-w-md">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-basalt/40" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tours by place or theme"
                className="h-12 w-full rounded-full border-0 bg-paper pl-11 pr-4 text-sm text-basalt outline-none placeholder:text-basalt/40 focus:ring-2 focus:ring-apricot"
              />
            </label>
          </div>
        </section>

        <section className="container py-8 lg:py-10">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTag("all")} className={cn("filter-chip", tag === "all" && "active")}>
              All tours
            </button>
            {tagOptions.map((t) => (
              <button key={t} onClick={() => setTag(t)} className={cn("filter-chip", tag === t && "active")}>
                {t}
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-y border-basalt/10 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">Duration</span>
              <button onClick={() => setDuration("all")} className={cn("filter-chip", duration === "all" && "active")}>
                Any
              </button>
              {availableBuckets.map((bucket) => (
                <button key={bucket.key} onClick={() => setDuration(bucket.key)} className={cn("filter-chip", duration === bucket.key && "active")}>
                  {bucket.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/40">
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                  className="h-9 border border-basalt/15 bg-paper px-2 text-xs font-bold uppercase tracking-[0.06em] text-basalt outline-none focus:border-apricot"
                >
                  <option value="recommended">Recommended</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="duration-asc">Duration: shortest first</option>
                </select>
              </label>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-full border-basalt/20">
                    <MapIcon className="mr-2 h-3.5 w-3.5" /> Map
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[85vh] border-0 bg-paper p-3">
                  <SheetTitle className="sr-only">Tours on the map</SheetTitle>
                  <SheetDescription className="sr-only">View the currently filtered Armenia tours on the interactive Revamp atlas.</SheetDescription>
                  <ArmeniaMap listings={filtered} selectedId={selectedId} onSelect={setSelectedId} className="h-full" />
                </SheetContent>
              </Sheet>
            </div>
          </div>

          <p className="mt-5 text-sm text-basalt/55">
            <strong className="text-basalt">{filtered.length}</strong> of {tours.length} tours
          </p>

          {filtered.length ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((tour) => (
                <TourCard key={tour.id} listing={tour} />
              ))}
            </div>
          ) : (
            <div className="my-16 border border-dashed border-basalt/20 bg-chalk px-6 py-16 text-center">
              <p className="eyebrow">No tours match yet</p>
              <h2 className="mt-3 font-display text-4xl">Try a different theme.</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-basalt/55">Clear the filters to see every guided route currently in the catalog.</p>
              <Button onClick={reset} className="mt-6 rounded-none bg-apricot text-white">
                Reset filters
              </Button>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
