/** Revamp brandbook: marketplace utility uses bold sans hierarchy, white surfaces, orange filters, rounded cards, and a synchronized atlas. */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Filter, Map as MapIcon, RotateCcw, SlidersHorizontal } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SearchBar } from "@/components/SearchBar";
import { ListingCard } from "@/components/ListingCard";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ListingType, typeLabels } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { cn } from "@/lib/utils";

const validTypes = new Set(["all", "stay", "eat", "tour"]);

export default function Explore({ initialType = "" }: { initialType?: string }) {
  const [, navigate] = useLocation();
  const { listings } = useListings();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const urlType = params.get("type") || initialType;
  const [query, setQuery] = useState(params.get("query") || "");
  const [type, setType] = useState(validTypes.has(urlType) ? urlType : "all");
  const [region, setRegion] = useState("all");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const regions = Array.from(new Set(listings.map((listing) => listing.region))).sort();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return listings.filter((listing) => {
      const matchesType = type === "all" || listing.type === type;
      const matchesRegion = region === "all" || listing.region === region;
      const haystack = [listing.title, listing.city, listing.region, listing.type, listing.shortDescription, ...listing.tags].join(" ").toLowerCase();
      return matchesType && matchesRegion && (!needle || haystack.includes(needle));
    });
  }, [query, type, region, listings]);

  const reset = () => {
    setQuery("");
    setType("all");
    setRegion("all");
  };

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
              {["all", "stay", "eat", "tour"].map((value) => (
                <button
                  key={value}
                  onClick={() => (value === "tour" ? navigate(`/explore/tour${query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ""}`) : setType(value))}
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
          </div>

          <div className="mt-7 flex items-center justify-between">
            <p className="text-sm text-basalt/55"><strong className="text-basalt">{filtered.length}</strong> places across Armenia</p>
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

          {filtered.length ? (
            <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(390px,0.9fr)]">
              <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2">
                {filtered.map((listing) => <ListingCard key={listing.id} listing={listing} active={listing.id === selectedId} onHover={setSelectedId} />)}
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
