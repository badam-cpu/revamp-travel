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
 * "Book" hands off to POST /api/start-checkout and redirects to PayLink; a
 * signed-out visitor is sent to sign in and back (Login.tsx honors ?redirect).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { LogIn, Minus, Plus, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { LiveListing, BlockedRange } from "@/contexts/ListingsContext";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { Button } from "@/components/ui/button";
import { startCheckout, ApiError } from "@/lib/api";
import { computeBookingAmountCents, computeBookingCharge, describeBookingBasis, describeCancellationPolicy, isBookableType, TAX_PERCENT } from "@shared/bookings";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

export function BookingPanel({ listing }: { listing: LiveListing }) {
  const { user, loading } = useAuth();
  const { format, currency: displayCurrency } = useCurrency();
  const bookable = isBookableType(listing.type);
  const isStay = listing.type === "stay";
  const maxGuests = listing.maxGuests ?? 8;
  const priceLabel = listing.price > 0 ? format(Math.round(listing.price * 100)) : "Rate on request";

  const [guests, setGuests] = useState(1);
  const [range, setRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [booked, setBooked] = useState<BlockedRange[]>([]);
  const [submitting, setSubmitting] = useState(false);

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
        },
        { ...selected, guests },
      )
    : 0;
  // Base = accommodation + flat cleaning fee; guest pays base + tax on top
  // (same helper the server charges with).
  const cleaningCents = accommodationCents > 0 ? listing.cleaningFeeCents ?? 0 : 0;
  const charge = computeBookingCharge(accommodationCents + cleaningCents);
  const amountCents = charge.totalCents; // what the guest is actually charged (USD, settlement)
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

  const book = async () => {
    if (!selected) {
      toast(isStay ? "Choose your check-in and check-out dates." : "Pick a date first.");
      return;
    }
    setSubmitting(true);
    try {
      const { redirectUrl } = await startCheckout({
        listingId: listing.id,
        startDate: selected.startDate,
        endDate: selected.endDate,
        guests,
      });
      // Hand off to PayLink's hosted payment page.
      window.location.href = redirectUrl;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't start checkout. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div id="book" className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
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

      {/* Price breakdown — base + turnover tax added on top */}
      {selected && charge.baseCents > 0 && (
        <div className="mt-4 grid gap-1.5 border-t border-basalt/10 pt-4 text-sm">
          <div className="flex items-center justify-between text-basalt/55">
            <span>{describeBookingBasis(listing, { ...selected, guests })}</span>
            <span>{format(accommodationCents)}</span>
          </div>
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
            <strong className="font-display text-xl font-normal">{format(charge.totalCents)}</strong>
          </div>
        </div>
      )}

      {/* Cancellation policy */}
      <p className="mt-3 text-xs leading-5 text-basalt/55">
        {listing.cancellationPolicy === "non_refundable" ? "🔒 " : "✓ "}
        {policyText}.
      </p>

      {/* Action */}
      {loading ? (
        <Button disabled className="mt-5 h-12 w-full rounded-none bg-basalt/10 text-basalt/40">…</Button>
      ) : !user ? (
        <Button asChild className="mt-5 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90">
          <Link href={`/login?redirect=${encodeURIComponent(`/listing/${listing.slug}`)}`}>
            <LogIn className="mr-2 h-4 w-4" /> Sign in to book
          </Link>
        </Button>
      ) : listing.price <= 0 ? (
        <Button disabled title="Rate on request" className="mt-5 h-12 w-full cursor-not-allowed rounded-none bg-basalt/10 text-basalt/45 hover:bg-basalt/10">
          Rate on request
        </Button>
      ) : (
        <Button
          onClick={book}
          disabled={!selected || submitting}
          className={cn("mt-5 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90", (!selected || submitting) && "opacity-60")}
        >
          {submitting ? "Starting checkout…" : selected ? `Request to book · ${format(amountCents)}` : "Select dates to book"}
        </Button>
      )}
      <p className="mt-3 text-center text-[11px] leading-5 text-basalt/42">
        You'll pay securely via PayLink. Your dates are confirmed once payment clears.{displayCurrency === "AMD" ? " Charged in USD; AMD shown for reference." : ""}
      </p>
    </div>
  );
}
