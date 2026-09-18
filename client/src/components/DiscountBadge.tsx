/**
 * "On sale" badge for a listing with an active/upcoming promotional discount.
 * Renders nothing when there's no live discount. Percent discounts read
 * "X% off"; fixed-amount discounts are formatted through the currency toggle.
 */
import { isDiscountLive } from "@shared/bookings";
import type { Listing } from "@shared/listings";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

type DiscountFields = Pick<Listing, "discountType" | "discountValue" | "discountStart" | "discountEnd">;

export function DiscountBadge({ listing, className }: { listing: DiscountFields; className?: string }) {
  const { format } = useCurrency();
  const today = new Date().toISOString().slice(0, 10);
  if (!isDiscountLive(listing, today)) return null;
  const label = listing.discountType === "percent" ? `${listing.discountValue}% off` : `${format(listing.discountValue ?? 0)} off`;
  return (
    <span className={cn("inline-flex items-center rounded-full bg-apricot px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white shadow-sm", className)}>
      {label}
    </span>
  );
}
