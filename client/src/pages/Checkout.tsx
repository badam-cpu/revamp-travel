/**
 * The dedicated checkout page — the step between a listing's "Book" button and
 * PayLink's hosted payment page. Reached at /checkout/:slug?start&end&guests
 * (the non-sensitive selection travels in the URL; contact details are only
 * ever entered here, never in a query string).
 *
 * Flow:
 *   • New / guest travelers give their name, email and phone (no account).
 *   • Signed-in travelers skip that — we already have them.
 *   • Stays additionally offer concierge add-ons (the admin's enabled catalog),
 *     shown 3 at a time with "Show more".
 *   • "Pay" calls POST /api/start-checkout (amount computed + re-priced
 *     server-side) and redirects to PayLink. A booking is only ever confirmed
 *     server-side after payment — never here.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { startCheckout, ApiError } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import {
  computeBookingAmountCents,
  computeBookingCharge,
  promoDiscount,
  nightsBetween,
  addonUnitCost,
  isBookableType,
  describeBookingBasis,
  describeCancellationPolicy,
  TAX_PERCENT,
} from "@shared/bookings";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ADDONS_PREVIEW = 3; // show this many, then "Show more"

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default function Checkout({ slug }: { slug: string }) {
  const { user, loading: authLoading, signInAnonymously } = useAuth();
  const { listings, offline } = useListings();
  const { settings } = useSiteSettings();
  const { format, currency: displayCurrency } = useCurrency();
  const [, navigate] = useLocation();
  const search = useSearch();

  useDocumentMeta({ title: "Checkout · Revamp", description: "Complete your booking.", canonicalPath: "/checkout", noindex: true });

  const params = new URLSearchParams(search);
  const startDate = params.get("start") ?? "";
  const endDate = params.get("end") ?? "";
  const guests = Math.max(1, Number(params.get("guests")) || 1);

  const listing = useMemo(() => listings.find((l) => l.slug === slug) ?? null, [listings, slug]);
  const isStay = listing?.type === "stay";

  // Anonymous sessions (e.g. from support chat) are treated as guests — they
  // have no email/profile — so we still collect contact details from them.
  const isGuest = !user || user.is_anonymous === true;
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [showAllAddons, setShowAllAddons] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // --- pricing (mirrors BookingPanel / the server) --------------------------
  const valid = !!listing && isBookableType(listing.type) && !!startDate && !!endDate && listing.price > 0;
  const nights = startDate && endDate ? nightsBetween(startDate, endDate) : 1;

  const accommodationCents = listing
    ? computeBookingAmountCents(
        {
          priceCents: Math.round(listing.price * 100),
          priceUnit: listing.priceUnit,
          cancellationPolicy: listing.cancellationPolicy,
          nonrefundableDiscountPercent: listing.nonrefundableDiscountPercent,
          seasonalRates: listing.seasonalRates,
        },
        { startDate, endDate, guests },
      )
    : 0;
  const promo = listing ? promoDiscount(accommodationCents, listing, startDate) : { active: false, discountCents: 0, netCents: 0 };
  const cleaningCents = accommodationCents > 0 ? listing?.cleaningFeeCents ?? 0 : 0;
  const charge = computeBookingCharge(promo.netCents + cleaningCents);

  const addons = isStay
    ? (settings.addons ?? []).filter((a) => a.enabled && a.name && (a.priceCents > 0 || a.onRequest))
    : [];
  const visibleAddons = showAllAddons ? addons : addons.slice(0, ADDONS_PREVIEW);
  const addonsTotalCents = addons.reduce((sum, a) => sum + (addonQty[a.id] ?? 0) * addonUnitCost(a, { nights, guests }), 0);
  const amountCents = charge.totalCents + addonsTotalCents;

  // GA funnel: checkout started (once per listing when the selection is valid).
  useEffect(() => {
    if (listing && valid) trackEvent("begin_checkout", { item_id: listing.id, item_name: listing.title, item_category: listing.type, value: Math.round(amountCents / 100), currency: "AMD" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, valid]);

  // --- guards ----------------------------------------------------------------
  if (!listing && !offline && listings.length === 0) {
    // listings still loading
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-24 text-center text-basalt/55">Loading…</main>
        <SiteFooter />
      </div>
    );
  }
  if (!valid) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-24 text-center">
          <h1 className="font-display text-3xl font-normal text-basalt">We couldn't set up this checkout</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-basalt/55">
            The dates or listing look incomplete. Head back and pick your dates again.
          </p>
          <Link href={listing ? `/listing/${listing.slug}` : "/explore"} className="mt-6 inline-flex items-center gap-2 rounded-none bg-apricot px-5 py-3 text-sm font-semibold text-white hover:bg-apricot/90">
            <ArrowLeft className="h-4 w-4" /> Back to the listing
          </Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const policyText = describeCancellationPolicy(listing!.cancellationPolicy, {
    freeCancelDays: listing!.freeCancelDays,
    startDate,
    discountPercent: listing!.nonrefundableDiscountPercent,
  });

  const pay = async () => {
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
      // Guests with no session at all get a silent anonymous one so the booking
      // has an owner (no account required).
      if (!user) await signInAnonymously();
      const addonSel = Object.entries(addonQty)
        .filter(([, q]) => q > 0)
        .map(([id, qty]) => ({ id, qty }));
      const { redirectUrl } = await startCheckout({
        listingId: listing!.id,
        startDate,
        endDate,
        guests,
        ...(addonSel.length ? { addons: addonSel } : {}),
        ...(isGuest ? { guestName: guestName.trim(), guestEmail: guestEmail.trim(), guestPhone: guestPhone.trim() } : {}),
      });
      window.location.href = redirectUrl;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't start checkout. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <Link href={`/listing/${listing!.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-basalt/55 hover:text-apricot">
          <ArrowLeft className="h-4 w-4" /> Back to {listing!.title}
        </Link>
        <h1 className="mt-4 font-display text-3xl font-normal text-basalt sm:text-4xl">Confirm and pay</h1>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
          {/* Left: details + add-ons */}
          <div className="grid gap-8">
            {/* Contact — guests only */}
            {isGuest && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/50">Your details</h2>
                <p className="mt-1 text-sm text-basalt/55">No account needed — we'll email your confirmation here.</p>
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="co-name" className="text-xs font-semibold text-basalt/60">Full name</Label>
                    <Input id="co-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Full name" autoComplete="name" className="h-12 rounded-none" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="co-email" className="text-xs font-semibold text-basalt/60">Email address</Label>
                    <Input id="co-email" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className="h-12 rounded-none" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="co-phone" className="text-xs font-semibold text-basalt/60">Phone</Label>
                    <Input id="co-phone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+374 …" autoComplete="tel" className="h-12 rounded-none" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-basalt/45">
                  Have an account?{" "}
                  <Link href={`/login?redirect=${encodeURIComponent(`/checkout/${listing!.slug}?${search}`)}`} className="font-semibold text-apricot hover:underline">Sign in</Link>
                </p>
              </section>
            )}

            {/* Concierge add-ons — stays only */}
            {addons.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/50">Enhance your stay</h2>
                <p className="mt-1 text-sm text-basalt/55">Optional extras, added to your total.</p>
                <div className="mt-4 grid gap-3">
                  {visibleAddons.map((a) => {
                    const qty = addonQty[a.id] ?? 0;
                    const on = qty > 0;
                    const unitCost = addonUnitCost(a, { nights, guests });
                    return (
                      <div key={a.id} className={cn("flex items-start gap-3 border p-3", on ? "border-apricot/60 bg-apricot/5" : "border-basalt/12 bg-paper")}>
                        <Checkbox
                          checked={on}
                          onCheckedChange={(c) => setAddonQty((p) => ({ ...p, [a.id]: c === true ? 1 : 0 }))}
                          className="mt-0.5 rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot"
                        />
                        {a.image && <img src={a.image} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />}
                        <div className="flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-basalt">{a.name}</span>
                            <span className="shrink-0 text-sm text-basalt/60">{a.onRequest ? "On request" : `${format(unitCost)}${a.unit === "per_item" ? " each" : ""}`}</span>
                          </div>
                          {a.description && <p className="mt-1 text-xs leading-5 text-basalt/50">{a.description}</p>}
                          {on && a.unit === "per_item" && !a.onRequest && (
                            <div className="mt-2 inline-flex items-center gap-2">
                              <button type="button" aria-label="Fewer" onClick={() => setAddonQty((p) => ({ ...p, [a.id]: Math.max(1, (p[a.id] ?? 1) - 1) }))} className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt hover:border-apricot"><Minus className="h-3.5 w-3.5" /></button>
                              <span className="text-sm font-semibold tabular-nums">{qty}</span>
                              <button type="button" aria-label="More" onClick={() => setAddonQty((p) => ({ ...p, [a.id]: Math.min(20, (p[a.id] ?? 1) + 1) }))} className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt hover:border-apricot"><Plus className="h-3.5 w-3.5" /></button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {addons.length > ADDONS_PREVIEW && (
                  <button type="button" onClick={() => setShowAllAddons((s) => !s)} className="mt-3 text-sm font-semibold text-apricot hover:underline">
                    {showAllAddons ? "Show fewer" : `Show ${addons.length - ADDONS_PREVIEW} more`}
                  </button>
                )}
              </section>
            )}
          </div>

          {/* Right: summary */}
          <aside className="lg:sticky lg:top-[104px] lg:self-start">
            <div className="brand-notch border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
              <div className="flex gap-3 border-b border-basalt/10 pb-4">
                {listing!.image && <img src={listing!.image} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />}
                <div>
                  <p className="text-sm font-semibold leading-5 text-basalt">{listing!.title}</p>
                  <p className="mt-0.5 text-xs text-basalt/50">{listing!.city}, Armenia</p>
                </div>
              </div>

              <div className="mt-4 grid gap-1.5 text-sm">
                <div className="flex items-center justify-between text-basalt/55">
                  <span>{isStay ? "Dates" : "Date"}</span>
                  <span className="font-medium text-basalt">{fmtDate(startDate)}{isStay ? ` → ${fmtDate(endDate)}` : ""}</span>
                </div>
                <div className="flex items-center justify-between text-basalt/55">
                  <span>Guests</span>
                  <span className="font-medium text-basalt">{guests}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-1.5 border-t border-basalt/10 pt-4 text-sm">
                <div className="flex items-center justify-between text-basalt/55">
                  <span>{describeBookingBasis(listing!, { startDate, endDate, guests }, format(nights > 0 ? Math.round(accommodationCents / nights) : Math.round(listing!.price * 100)))}</span>
                  <span>{format(accommodationCents)}</span>
                </div>
                {promo.active && (
                  <div className="flex items-center justify-between font-semibold text-apricot">
                    <span>Discount{listing!.discountType === "percent" ? ` (${listing!.discountValue}% off)` : " (sale)"}</span>
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

              <p className="mt-3 text-xs leading-5 text-basalt/55">
                {listing!.cancellationPolicy === "non_refundable" ? "🔒 " : "✓ "}
                {policyText}.
              </p>

              <Button
                onClick={pay}
                disabled={submitting || authLoading}
                className={cn("mt-5 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90", (submitting || authLoading) && "opacity-60")}
              >
                {submitting ? "Taking you to payment…" : `Pay · ${format(amountCents)}`}
              </Button>
              <p className="mt-3 text-center text-[11px] leading-5 text-basalt/42">
                You'll pay securely via{" "}
                <a href="https://paylink.am" target="_blank" rel="noreferrer" className="font-semibold text-basalt/55 underline underline-offset-2 hover:text-apricot">PayLink</a>
                . Your dates are confirmed once payment clears.{displayCurrency === "USD" ? " Charged in AMD; USD shown for reference." : ""}
              </p>
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
