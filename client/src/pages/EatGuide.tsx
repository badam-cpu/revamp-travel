/**
 * "Where to eat" — a free, admin-curated restaurant guide (the Eat category).
 * These are recommendations, not bookable inventory: no prices to transact, no
 * operator accounts. Listings are grouped by cuisine with a cuisine filter, and
 * each card links to the guide-style detail page.
 */
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ListingCard } from "@/components/ListingCard";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { cn } from "@/lib/utils";

const OTHER = "More spots";

export default function EatGuide() {
  const { listings, loading } = useListings();
  const [cuisine, setCuisine] = useState("all");

  useDocumentMeta({
    title: "Where to eat in Armenia — Revamp Vacations",
    description: "An independent, hand-picked guide to restaurants, cafés and wine bars across Armenia. Free recommendations from Revamp — no bookings, no strings.",
    canonicalPath: "/explore/eat",
  });

  const eateries = useMemo(() => listings.filter((l) => l.type === "eat"), [listings]);

  // Cuisine facets present in the data (for the filter chips), most common first.
  const cuisines = useMemo(() => {
    const counts = new Map<string, number>();
    eateries.forEach((l) => {
      const c = l.cuisine?.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [eateries]);

  const shown = useMemo(
    () => (cuisine === "all" ? eateries : eateries.filter((l) => (l.cuisine?.trim() || OTHER) === cuisine)),
    [eateries, cuisine],
  );

  // Group the shown set by cuisine for the section headings.
  const groups = useMemo(() => {
    const map = new Map<string, LiveListing[]>();
    shown.forEach((l) => {
      const key = l.cuisine?.trim() || OTHER;
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    });
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
        </section>

        {cuisines.length > 0 && (
          <section className="container mt-8">
            <div className="flex flex-wrap gap-x-2 gap-y-3 border-b border-basalt/10 pb-6">
              <button onClick={() => setCuisine("all")} className={cn("filter-chip", cuisine === "all" && "active")}>All cuisines</button>
              {cuisines.map((c) => (
                <button key={c} onClick={() => setCuisine(c)} className={cn("filter-chip", cuisine === c && "active")}>{c}</button>
              ))}
            </div>
          </section>
        )}

        <section className="container py-10 lg:py-12">
          {loading ? (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <ListingCardSkeleton key={i} />)}
            </div>
          ) : eateries.length === 0 ? (
            <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-16 text-center text-sm text-basalt/55">No restaurant recommendations yet — check back soon.</p>
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
