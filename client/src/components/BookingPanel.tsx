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
import { ChevronDown, Minus, Plus, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { LiveListing, BlockedRange } from "@/contexts/ListingsContext";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { startCheckout, ApiError } from "@/lib/api";
import { computeBookingAmountCents, computeBookingCharge, describeBookingBasis, describeCancellationPolicy, isBookableType, promoDiscount, nightsBetween, addonUnitCost, TAX_PERCENT } from "@shared/bookings";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

export function BookingPanel({ listing }: { listing: LiveListing }) {
  const { user, loading, signInAnonymously } = useAuth();
  const { format, currency: displayCurrency } = useCurrency();
  const { settings } = useSiteSettings();
  const bookable = isBookableType(listing.type);
  const isStay = listing.type === "stay";
  const maxGuests = listing.maxGuests ?? 8;
  const priceLabel = listing.price > 0 ? format(Math.round(listing.price * 100)) : "Rate on request";

  const [guests, setGuests] = useState(1);
  const [range, setRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [booked, setBooked] = useState<BlockedRange[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Guest checkout contact details (signed-out travelers).
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  // Selected concierge add-ons: id → quantity (0/absent = not selected).
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  // When there are more than 3 add-ons, keep them behind an expandable dropdown
  // so the booking box stays compact.
  const [addonsOpen, setAddonsOpen] = useState(false);

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
  // top (same helper the server charges with).
  const cleaningCents = accommodationCents > 0 ? listing.cleaningFeeCents ?? 0 : 0;
  const charge = computeBookingCharge(netAccommodationCents + cleaningCents);
  // Concierge add-ons (Revamp-managed) — added on top of the booking total.
  // Stays only: these extras (grocery, luggage, airport pickup, toiletries) are
  // stay-specific, so tours/experiences never show the section.
  const nights = selected ? nightsBetween(selected.startDate, selected.endDate) : 1;
  // Every add-on in the catalog is offered (no per-item enable step) as long as
  // it's a real, priced entry: a name plus either a price or an "on request" flag.
  const addons = isStay
    ? (settings.addons ?? []).filter((a) => a.name && (a.priceCents > 0 || a.onRequest))
    : [];
  const addonsTotalCents = addons.reduce((sum, a) => sum + (addonQty[a.id] ?? 0) * addonUnitCost(a, { nights, guests }), 0);
  const amountCents = charge.totalCents + addonsTotalCents; // total charged to the guest (AMD, settlement)
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
    // Signed-out travelers check out as a guest: validate their contact details,
    // then sign in anonymously so the booking has an owner (no account needed).
    const isGuest = !user;
    if (isGuest) {
      if (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim()) {
        toast("Add your name, email, and phone to continue.");
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail.trim())) {
        toast("Enter a valid email address.");
        return;
      }
    }
    setSubmitting(true);
    try {
      if (isGuest) await signInAnonymously();
      const addonSel = Object.entries(addonQty)
        .filter(([, q]) => q > 0)
        .map(([id, qty]) => ({ id, qty }));
      const { redirectUrl } = await startCheckout({
        listingId: listing.id,
        startDate: selected.startDate,
        endDate: selected.endDate,
        guests,
        ...(addonSel.length ? { addons: addonSel } : {}),
        ...(isGuest ? { guestName: guestName.trim(), guestEmail: guestEmail.trim(), guestPhone: guestPhone.trim() } : {}),
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

      {/* Concierge add-ons (Revamp-managed extras). More than 3 collapse into a
          dropdown so the booking box stays compact. */}
      {addons.length > 0 && (() => {
        const collapsible = addons.length > 3;
        const expanded = !collapsible || addonsOpen;
        const selectedCount = addons.reduce((n, a) => n + ((addonQty[a.id] ?? 0) > 0 ? 1 : 0), 0);
        return (
        <div className="mt-4 border-t border-basalt/10 pt-4">
          {collapsible ? (
            <button type="button" onClick={() => setAddonsOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-basalt/45">
                Enhance your stay{selectedCount > 0 ? ` · ${selectedCount} added` : ` · ${addons.length} available`}
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-basalt/45 transition-transform", expanded && "rotate-180")} />
            </button>
          ) : (
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-basalt/45">Enhance your stay</p>
          )}
          {expanded && (
          <div className="mt-3 grid gap-3">
            {addons.map((a) => {
              const qty = addonQty[a.id] ?? 0;
              const on = qty > 0;
              const unitCost = addonUnitCost(a, { nights, guests });
              return (
                <div key={a.id} className="flex items-start gap-2.5">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(c) => setAddonQty((p) => ({ ...p, [a.id]: c === true ? 1 : 0 }))}
                    className="mt-0.5 rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot"
                  />
                  {a.image && <img src={a.image} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />}
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-basalt">{a.name}</span>
                      <span className="shrink-0 text-basalt/55">{a.onRequest ? "On request" : `${format(unitCost)}${a.unit === "per_item" ? " each" : ""}`}</span>
                    </div>
                    {a.description && <p className="mt-0.5 text-xs leading-5 text-basalt/45">{a.description}</p>}
                    {on && a.unit === "per_item" && !a.onRequest && (
                      <div className="mt-1.5 inline-flex items-center gap-2">
                        <button type="button" aria-label="Fewer" onClick={() => setAddonQty((p) => ({ ...p, [a.id]: Math.max(1, (p[a.id] ?? 1) - 1) }))} className="grid h-6 w-6 place-items-center border border-basalt/15 text-basalt hover:border-apricot"><Minus className="h-3 w-3" /></button>
                        <span className="text-sm font-semibold tabular-nums">{qty}</span>
                        <button type="button" aria-label="More" onClick={() => setAddonQty((p) => ({ ...p, [a.id]: Math.min(20, (p[a.id] ?? 1) + 1) }))} className="grid h-6 w-6 place-items-center border border-basalt/15 text-basalt hover:border-apricot"><Plus className="h-3 w-3" /></button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
        );
      })()}

      {/* Price breakdown — base + turnover tax added on top */}
      {selected && charge.baseCents > 0 && (
        <div className="mt-4 grid gap-1.5 border-t border-basalt/10 pt-4 text-sm">
          <div className="flex items-center justify-between text-basalt/55">
            <span>{describeBookingBasis(listing, { ...selected, guests }, format(Math.round(listing.price * 100)))}</span>
            <span>{format(accommodationCents)}</span>
          </div>
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
          {addonsTotalCents > 0 && (
            <div className="flex items-center justify-between text-basalt/55">
              <span>Add-ons</span>
              <span>{format(addonsTotalCents)}</span>
            </div>
          )}
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

      {/* Action */}
      {loading ? (
        <Button disabled className="mt-5 h-12 w-full rounded-none bg-basalt/10 text-basalt/40">…</Button>
      ) : listing.price <= 0 ? (
        <Button disabled title="Rate on request" className="mt-5 h-12 w-full cursor-not-allowed rounded-none bg-basalt/10 text-basalt/45 hover:bg-basalt/10">
          Rate on request
        </Button>
      ) : (
        <>
          {/* Guest checkout — no account required. */}
          {!user && (
            <div className="mt-5 grid gap-2.5 border-t border-basalt/10 pt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-basalt/45">Your details</p>
              <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Full name" autoComplete="name" className="h-11 rounded-none" />
              <Input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="Email address" autoComplete="email" className="h-11 rounded-none" />
              <Input type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="Phone (e.g. +374 …)" autoComplete="tel" className="h-11 rounded-none" />
            </div>
          )}
          <Button
            onClick={book}
            disabled={!selected || submitting}
            className={cn("mt-4 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90", (!selected || submitting) && "opacity-60")}
          >
            {submitting ? (isStay ? "Reserving your dates…" : "Reserving your spot…") : selected ? `Book · ${format(amountCents)}` : "Select dates to book"}
          </Button>
          {!user && (
            <p className="mt-2 text-center text-[11px] text-basalt/45">
              Have an account?{" "}
              <Link href={`/login?redirect=${encodeURIComponent(`/listing/${listing.slug}`)}`} className="font-semibold text-apricot hover:underline">Sign in</Link>
            </p>
          )}
        </>
      )}
      <p className="mt-3 text-center text-[11px] leading-5 text-basalt/42">
        You'll pay securely via{" "}
        <a href="https://paylink.am" target="_blank" rel="noreferrer" className="font-semibold text-basalt/55 underline underline-offset-2 hover:text-apricot">PayLink</a>
        . Your dates are confirmed once payment clears.{!user ? " No account needed — we'll email your confirmation." : ""}{displayCurrency === "USD" ? " Charged in AMD; USD shown for reference." : ""}
      </p>
    </div>
  );
}
