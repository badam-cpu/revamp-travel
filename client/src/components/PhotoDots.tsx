/**
 * Compact photo-position indicator for card carousels. Shows at most MAX dots in
 * a sliding window so a listing with many photos never grows a dot row wide
 * enough to collide with the card's location/rating overlays. The active dot is
 * a wider pill; when there are more photos beyond the window, the window's edge
 * dot shrinks to hint "there's more". Renders nothing for a single photo.
 */
import { cn } from "@/lib/utils";

const MAX = 5;

export function PhotoDots({ count, index, className }: { count: number; index: number; className?: string }) {
  if (count <= 1) return null;
  // Slide a MAX-wide window so the active dot stays roughly centered within it.
  const start = count > MAX ? Math.min(Math.max(index - 2, 0), count - MAX) : 0;
  const end = Math.min(start + MAX, count);
  const dots = [];
  for (let i = start; i < end; i++) {
    const active = i === index;
    const moreBeyond = (i === start && start > 0) || (i === end - 1 && end < count);
    dots.push(
      <span
        key={i}
        className={cn(
          "shrink-0 rounded-full shadow transition-all",
          active ? "h-1.5 w-3.5 bg-white" : moreBeyond ? "h-1 w-1 bg-white/50" : "h-1.5 w-1.5 bg-white/60",
        )}
      />,
    );
  }
  return <div className={cn("pointer-events-none flex items-center gap-1.5", className)}>{dots}</div>;
}
