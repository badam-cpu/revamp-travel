/** Loading placeholder matching ListingCard's shape — shown while the live
 * catalog loads, in place of the old brand-illustration "mockup" flash. */
import { cn } from "@/lib/utils";

export function ListingCardSkeleton({ large = false }: { large?: boolean }) {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className={cn("brand-notch bg-basalt/10", large ? "aspect-[16/10]" : "aspect-[4/3]")} />
      <div className="pt-4">
        <div className="h-2.5 w-24 rounded bg-basalt/10" />
        <div className={cn("mt-3 rounded bg-basalt/10", large ? "h-7 w-3/4" : "h-5 w-2/3")} />
        <div className="mt-3 h-3 w-full rounded bg-basalt/10" />
        <div className="mt-2 h-3 w-5/6 rounded bg-basalt/10" />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-basalt/10 pt-4">
        <div className="h-3 w-28 rounded bg-basalt/10" />
        <div className="h-3.5 w-16 rounded bg-basalt/10" />
      </div>
    </div>
  );
}
