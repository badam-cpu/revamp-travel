/**
 * The booking box in a listing's sidebar — the front half of the PayLink
 * booking loop. Replaces the old date+guests controls and the disabled
 * "Payments coming soon" BookingCta. Handles both shapes:
 *   • stays      — a check-in → check-out range (AvailabilityCalendar)
 *   • activities — a single date (tours / experiences), end = start + 1 day
 * Restaurants aren't bookable, so it shows a contact note instead.
 *
 * Availability = the listing's iCal blocked_ranges ∪ its confirmed bookings
 * (read from the identity-free `listing_booked_ranges` view). The price shown
 * is computed by the SAME shared helper the server charges with
 * (computeBookingAmountCents), so the preview always matches the real charge.
 * "Book" doesn't check out here — it hands off to the dedicated /checkout page
 * (contact details + concierge add-ons + PayLink), carrying the chosen dates
 * and guest count in the URL.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Minus, Plus, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { LiveListing, BlockedRange } from "@/contexts/ListingsContext";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { Button } from "@/components/ui/button";
import { computeBookingAmountCents, computeBookingCharge, describeBookingBasis, describeCancellationPolicy, isBookableType, promoDiscount, averageNightlyCents, nightsBetween } from "@shared/bookings";
import { TAX_PERCENT } from "@shared/bookings";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

export function BookingPanel({ listing }: { listing: LiveListing }) {
  const { format, currency: displayCurrency } = useCurrency();
  const [, navigate] = useLocation();
  const bookable = isBookableType(listing.type);
  const isStay = listing.type === "stay";
  const maxGuests = listing.maxGuests ?? 8;
  // Headline shows the day-weighted average nightly rate when the stay uses
  // seasonal/daily rates; otherwise the base price.
  const priceLabel = listing.price > 0 ? format(averageNightlyCents({ priceCents: Math.round(listing.price * 100), priceUnit: listing.priceUnit, seasonalRates: listing.seasonalRates })) : "Rate on request";

  const [guests, setGuests] = useState(1);
  const [range, setRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [booked, setBooked] = useState<BlockedRange[]>([]);

  // Confirmed bookings for this listing (identity-free public view).
  useEffect(() => {
    let active = true;
    supabase
      .from("listing_booked_ranges")
      .select("start_date, end_date")
      .eq("listing_id", listing.id)
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        setBooked(data.map((r) => ({ start: r.start_date as string, end: r.end_date as string })));
      });
    return () => {
      active = false;
    };
  }, [listing.id]);

  // Resolve the chosen [start, end) for either mode. Stays pick a range;
  // activities pick a single date (end = next day).
  const selected = useMemo(() => {
    if (isStay) return range.start && range.end ? { startDate: range.start, endDate: range.end } : null;
    if (range.start) return { startDate: range.start, endDate: addDays(range.start, 1) };
    return null;
  }, [isStay, range]);

  const accommodationCents = selected
    ? computeBookingAmountCents(
        {
          priceCents: Math.round(listing.price * 100),
          priceUnit: listing.priceUnit,
          cancellationPolicy: listing.cancellationPolicy,
          nonrefundableDiscountPercent: listing.nonrefundableDiscountPercent,
          seasonalRates: listing.seasonalRates,
        },
        { ...selected, guests },
      )
    : 0;
  // Promo discount (applies when the check-in date is in the sale window).
  const promo = promoDiscount(accommodationCents, listing, selected?.startDate ?? "");
  const netAccommodationCents = promo.netCents;
  // Base = discounted accommodation + flat cleaning fee; guest pays base + tax on
  // top (same helper the server charges with). Add-ons are chosen on /checkout.
  const cleaningCents = accommodationCents > 0 ? listing.cleaningFeeCents ?? 0 : 0;
  const charge = computeBookingCharge(netAccommodationCents + cleaningCents);
  const amountCents = charge.totalCents; // accommodation total; add-ons added at checkout
  const policyText = describeCancellationPolicy(listing.cancellationPolicy, {
    freeCancelDays: listing.freeCancelDays,
    startDate: selected?.startDate,
    discountPercent: listing.nonrefundableDiscountPercent,
  });

  if (!bookable) {
    return (
      <div className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
        <p>
          <strong className="font-display text-4xl font-normal">{priceLabel}</strong>{" "}
          {listing.price > 0 && <span className="text-sm text-basalt/50">/ {listing.priceUnit}</span>}
        </p>
        <p className="mt-4 text-sm leading-6 text-basalt/55">
          This spot takes reservations directly. Save it to your account and get in touch with the venue to book a table.
        </p>
      </div>
    );
  }

  // "Book" → the dedicated checkout page (details + add-ons + payment). We only
  // carry the non-sensitive selection in the URL; contact details are collected
  // on the checkout page, never in a query string.
  const goToCheckout = () => {
    if (!selected) {
      toast(isStay ? "Choose your check-in and check-out dates." : "Pick a date first.");
      return;
    }
    const q = new URLSearchParams({ start: selected.startDate, end: selected.endDate, guests: String(guests) });
    navigate(`/checkout/${listing.slug}?${q.toString()}`);
  };

  return (
    <div id="book" className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)] lg:max-h-[calc(100vh_-_124px)] lg:overflow-y-auto">
      <div className="flex items-end justify-between gap-4 border-b border-basalt/10 pb-5">
        <p>
          <strong className="font-display text-4xl font-normal">{priceLabel}</strong>{" "}
          {listing.price > 0 && <span className="text-sm text-basalt/50">/ {listing.priceUnit}</span>}
        </p>
      </div>

      {/* Dates — stays pick a range, activities pick a single date; same calendar. */}
      <div className="mt-5">
        <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/45">
          {isStay ? "Choose your dates" : "Choose a date"}
        </span>
        <AvailabilityCalendar
          mode={isStay ? "range" : "single"}
          blockedRanges={listing.blockedRanges ?? []}
          bookedRanges={booked}
          onChange={setRange}
        />
      </div>

      {/* Guests */}
      <div className="mt-4">
        <span className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/45">
          <Users className="h-3.5 w-3.5 text-tuff" /> Guests
        </span>
        <div className="flex items-center justify-between border border-basalt/15 bg-paper px-3 py-2">
          <button
            type="button"
            aria-label="Fewer guests"
            disabled={guests <= 1}
            onClick={() => setGuests((g) => Math.max(1, g - 1))}
            className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt transition-colors hover:border-apricot hover:text-apricot disabled:opacity-30 disabled:hover:border-basalt/15 disabled:hover:text-basalt"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm font-semibold">{guests} {guests === 1 ? "guest" : "guests"}</span>
          <button
            type="button"
            aria-label="More guests"
            disabled={guests >= maxGuests}
            onClick={() => setGuests((g) => Math.min(maxGuests, g + 1))}
            className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt transition-colors hover:border-apricot hover:text-apricot disabled:opacity-30 disabled:hover:border-basalt/15 disabled:hover:text-basalt"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-xs text-basalt/45">Up to {maxGuests} {maxGuests === 1 ? "guest" : "guests"}.</p>
      </div>

      {/* Price breakdown — base + turnover tax added on top (add-ons at checkout) */}
      {selected && charge.baseCents > 0 && (
        <div className="mt-4 grid gap-1.5 border-t border-basalt/10 pt-4 text-sm">
          {(() => {
            // Compact basis: when seasonal/daily rates apply, show the average
            // nightly rate of the chosen dates ("avg ֏X × N nights"); otherwise
            // the plain per-night rate. Either way it reconciles to the total.
            const n = nightsBetween(selected.startDate, selected.endDate);
            const perNight = n > 0 ? Math.round(accommodationCents / n) : Math.round(listing.price * 100);
            const label = format(perNight);
            return (
              <div className="flex items-center justify-between text-basalt/55">
                <span>{describeBookingBasis(listing, { ...selected, guests }, label)}</span>
                <span>{format(accommodationCents)}</span>
              </div>
            );
          })()}
          {promo.active && (
            <div className="flex items-center justify-between font-semibold text-apricot">
              <span>Discount{listing.discountType === "percent" ? ` (${listing.discountValue}% off)` : " (sale)"}</span>
              <span>−{format(promo.discountCents)}</span>
            </div>
          )}
          {cleaningCents > 0 && (
            <div className="flex items-center justify-between text-basalt/55">
              <span>Cleaning fee</span>
              <span>{format(cleaningCents)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-basalt/55">
            <span>Tax ({TAX_PERCENT}%)</span>
            <span>{format(charge.taxCents)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-basalt/10 pt-1.5">
            <span className="font-semibold">Total</span>
            <strong className="font-display text-xl font-normal">{format(amountCents)}</strong>
          </div>
        </div>
      )}

      {/* Cancellation policy */}
      <p className="mt-3 text-xs leading-5 text-basalt/55">
        {listing.cancellationPolicy === "non_refundable" ? "🔒 " : "✓ "}
        {policyText}.
      </p>

      {/* Action — hands off to the checkout page */}
      {listing.price <= 0 ? (
        <Button disabled title="Rate on request" className="mt-5 h-12 w-full cursor-not-allowed rounded-none bg-basalt/10 text-basalt/45 hover:bg-basalt/10">
          Rate on request
        </Button>
      ) : (
        <Button
          onClick={goToCheckout}
          disabled={!selected}
          className={cn("mt-5 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90", !selected && "opacity-60")}
        >
          {selected ? `Book · ${format(amountCents)}` : "Select dates to book"}
        </Button>
      )}
      <p className="mt-3 text-center text-[11px] leading-5 text-basalt/42">
        You'll add your details{isStay ? " and any extras" : ""} on the next step, then pay securely via{" "}
        <a href="https://paylink.am" target="_blank" rel="noreferrer" className="font-semibold text-basalt/55 underline underline-offset-2 hover:text-apricot">PayLink</a>
        . No account needed.{displayCurrency === "USD" ? " Charged in AMD; USD shown for reference." : ""}
      </p>
    </div>
  );
}
