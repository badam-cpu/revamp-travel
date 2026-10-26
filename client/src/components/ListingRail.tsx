/**
 * A horizontal, swipeable row of listing cards for the home page showcase
 * (client/src/lib/homeRows.ts). Native scroll with snap points — swipe on
 * phones, trackpad/shift-scroll or the arrow buttons on larger screens. Cards
 * are sized so the next one peeks in, which says "there's more" without words.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { ListingCard } from "@/components/ListingCard";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";
import type { LiveListing } from "@/contexts/ListingsContext";
import { cn } from "@/lib/utils";

const CARD = "w-[82%] shrink-0 snap-start sm:w-[44%] lg:w-[29%]";

export function ListingRail({ title, href, linkLabel, items, loading = false, className }: { title: string; href?: string; linkLabel?: string; items: LiveListing[]; loading?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [items.length, loading]);

  // Page to an exact card edge (a snap point). "scrollBy ~one screen" fought the
  // snap points and sometimes didn't move at all.
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    const cards = Array.from(el.children) as HTMLElement[];
    const x = el.scrollLeft;
    const target =
      dir > 0
        ? cards.find((c) => c.offsetLeft + c.offsetWidth - pad > x + el.clientWidth + 1) // first card not fully in view
        : cards.find((c) => c.offsetLeft - pad >= x - el.clientWidth + 1); // the card a screen back
    el.scrollTo({ left: target ? Math.max(0, target.offsetLeft - pad) : dir > 0 ? el.scrollWidth : 0, behavior: "smooth" });
  };

  return (
    <section className={className} aria-label={title}>
      <div className="flex items-end justify-between gap-4">
        <h3 className="font-display text-2xl tracking-[-0.02em] sm:text-3xl">{title}</h3>
        <div className="flex shrink-0 items-center gap-2">
          {href && linkLabel && (
            <Link href={href} className="inline-flex min-h-10 items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-apricot hover:text-basalt">
              {linkLabel} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          <div className="hidden gap-2 md:flex">
            <button type="button" onClick={() => page(-1)} disabled={edges.start} aria-label={`Previous ${title.toLowerCase()}`} className="grid h-10 w-10 place-items-center rounded-full border border-basalt/15 bg-paper text-basalt transition-colors hover:border-basalt/40 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => page(1)} disabled={edges.end} aria-label={`More ${title.toLowerCase()}`} className="grid h-10 w-10 place-items-center rounded-full border border-basalt/15 bg-paper text-basalt transition-colors hover:border-basalt/40 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {/* Bleeds to the screen edge on phones so a swipe has room; scroll-padding keeps snap aligned with the container. */}
      <div
        ref={ref}
        className="relative -mx-4 mt-6 flex snap-x snap-mandatory scroll-px-4 gap-5 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:gap-7 lg:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {loading && items.length === 0
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className={CARD}>
                <ListingCardSkeleton />
              </div>
            ))
          : items.map((l) => (
              <div key={l.id} className={cn(CARD)}>
                <ListingCard listing={l} surface="home" />
              </div>
            ))}
      </div>
    </section>
  );
}
