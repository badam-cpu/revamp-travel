/**
 * Horizontal, snap-scrolling card row with left/right arrow controls — the
 * discovery-grid counterpart to the regions carousel on the home page. Replaces
 * a wrapping `grid` of listing cards: cards lay out in a single scrollable row
 * that peeks the next card, with circular prev/next arrows overlaid on the card
 * media (desktop only — touch users swipe). Arrows auto-hide when everything
 * already fits and disable at each end.
 *
 * Callers pass each card pre-wrapped in a width element so per-item widths stay
 * flexible (e.g. a featured hero card spanning two columns). Use the exported
 * `CARD_ITEM` for the standard 1/2/3-up card and `CARD_ITEM_WIDE` for a
 * double-width hero. The track gap is 1.5rem (gap-6); the width calcs assume it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Standard card: full-width on phones (peeking the next), 2-up on sm, 3-up on lg. */
export const CARD_ITEM =
  "w-[85%] shrink-0 snap-start sm:w-[calc((100%-1.5rem)/2)] lg:w-[calc((100%-3rem)/3)]";

/** Double-width hero card: still 2-up on sm, spans two of the three lg columns. */
export const CARD_ITEM_WIDE =
  "w-[85%] shrink-0 snap-start sm:w-[calc((100%-1.5rem)/2)] lg:w-[calc(2*((100%-3rem)/3)+1.5rem)]";

interface CardCarouselProps {
  children: ReactNode;
  /** Accessible noun for the arrow labels, e.g. "stays". */
  label?: string;
  /** Arrow tone — default (light surfaces) or "onDark" (over a dark section). */
  tone?: "default" | "onDark";
  className?: string;
}

export function CardCarousel({ children, label = "cards", tone = "default", className }: CardCarouselProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < max - 4);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    // Re-measure when the children change (filters, async load).
  }, [update, children]);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.82, behavior: "smooth" });
  };

  // Nothing overflows → no arrows needed at all.
  const overflowing = canLeft || canRight;

  const arrowBase =
    "absolute top-[30%] z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border shadow-md backdrop-blur-sm transition disabled:pointer-events-none disabled:opacity-0 sm:grid";
  const arrowTone =
    tone === "onDark"
      ? "border-white/25 bg-basalt/70 text-paper hover:border-apricot hover:text-apricot"
      : "border-basalt/15 bg-paper/95 text-basalt hover:border-apricot hover:text-apricot";

  return (
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        className="flex snap-x snap-mandatory gap-6 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      <button
        type="button"
        onClick={() => scroll(-1)}
        aria-label={`Scroll ${label} left`}
        disabled={!canLeft}
        className={cn(arrowBase, arrowTone, "-left-3 lg:-left-5", !overflowing && "sm:hidden")}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => scroll(1)}
        aria-label={`Scroll ${label} right`}
        disabled={!canRight}
        className={cn(arrowBase, arrowTone, "-right-3 lg:-right-5", !overflowing && "sm:hidden")}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
