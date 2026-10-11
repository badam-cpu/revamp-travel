/**
 * Live character counter for a listing text field ("24 / 40 · min 10"), using
 * the shared length rules (shared/listings.ts listingTextLimits). Pass `value`
 * for a controlled input, or `forId` to watch an uncontrolled one; programmatic
 * fills of an uncontrolled field (Aha AI, link import) should dispatch an
 * "input" event on it so the count follows.
 */
import { useEffect, useState } from "react";
import { listingTextLimits, type ListingTextField, type ListingType } from "@shared/listings";
import { stripBold } from "@shared/richText";
import { cn } from "@/lib/utils";

export function CharCount({
  field,
  forId,
  value,
  listingType,
  className,
}: {
  field: ListingTextField;
  forId?: string;
  value?: string;
  listingType?: ListingType;
  className?: string;
}) {
  const [watched, setWatched] = useState(0);
  const { min, max } = listingTextLimits(field, listingType);

  useEffect(() => {
    if (value !== undefined || !forId) return;
    const el = document.getElementById(forId) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return;
    const sync = () => setWatched(stripBold(el.value).trim().length);
    sync();
    el.addEventListener("input", sync);
    return () => el.removeEventListener("input", sync);
  }, [forId, value]);

  const n = value !== undefined ? stripBold(value).trim().length : watched;
  const off = (n > 0 && n < min) || n > max;
  return (
    <span aria-live="polite" className={cn("shrink-0 text-xs tabular-nums", off ? "font-semibold text-apricot" : "text-basalt/45", className)}>
      {n} / {max}
      {n < min && <span className="font-normal text-basalt/45"> · min {min}</span>}
    </span>
  );
}
