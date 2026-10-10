/**
 * revampstay — the sidebar panel for a home offered long-term (monthly) and/or
 * for sale. These listings have NO nightly offer, so there's no checkout: the
 * prospect requests a VIEWING instead, which becomes a lead in the host's inbox
 * (POST /api/viewing-request). No account needed — an unregistered visitor gets
 * a silent anonymous session, exactly like AskHostButton. Rendered by
 * ListingPage in place of BookingPanel when `!hasOffer(listing, "nightly")`.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CalendarCheck, Home, Loader2, Ruler, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { LiveListing } from "@/contexts/ListingsContext";
import { listingOffers, type OfferType } from "@shared/listings";
import { requestViewing, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const FURNISHED_LABEL: Record<string, string> = { furnished: "Furnished", semi: "Semi-furnished", unfurnished: "Unfurnished" };

export function RequestViewingPanel({ listing }: { listing: LiveListing }) {
  const { user, profile, signInAnonymously } = useAuth();
  const { format } = useCurrency();
  const [, navigate] = useLocation();

  // The non-nightly offers this home carries (sale and/or monthly).
  const offers = useMemo(() => listingOffers(listing).filter((o) => o !== "nightly"), [listing]);
  const [offerType, setOfferType] = useState<OfferType>(offers[0] ?? "monthly");
  const [mode, setMode] = useState<"in_person" | "video">("in_person");
  const [times, setTimes] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  // A host can't request a viewing on their own listing.
  if (user && listing.operatorId === user.id) return null;
  if (offers.length === 0) return null;

  const isGuest = !user || !!user.is_anonymous;
  const hasSale = offers.includes("sale");
  const hasMonthly = offers.includes("monthly");

  const submit = async () => {
    if (isGuest && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast("That email doesn't look right — check it, or leave it blank.");
      return;
    }
    if (isGuest && !email.trim() && !phone.trim()) {
      toast("Add an email or phone so the host can reach you.");
      return;
    }
    setSending(true);
    try {
      if (!user) await signInAnonymously();
      const preferredTimes = times.split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 5);
      await requestViewing({
        listingId: listing.id,
        offerType,
        mode,
        preferredTimes,
        message: message.trim(),
        guestName: name.trim(),
        guestEmail: email.trim(),
        guestPhone: phone.trim(),
      });
      setOpen(false);
      setMessage("");
      setTimes("");
      if (isGuest) {
        toast.success("Sent — the host will be in touch to arrange your viewing.");
      } else {
        toast.success("Sent — the host will reply in your inbox to arrange a time.");
        navigate(profile?.role === "operator" ? "/dashboard?view=messages" : "/account?tab=messages");
      }
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't send your request.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
        {hasSale && listing.salePriceCents != null && (
          <div className={cn(hasMonthly && "border-b border-basalt/10 pb-5")}>
            <p className="eyebrow">For sale</p>
            <p className="mt-2">
              <strong className="font-display text-4xl font-normal">{format(listing.salePriceCents)}</strong>
            </p>
            {listing.saleStatus && listing.saleStatus !== "available" && (
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-apricot">{listing.saleStatus === "under_offer" ? "Under offer" : "Sold"}</p>
            )}
          </div>
        )}
        {hasMonthly && listing.monthlyRentCents != null && (
          <div className={cn(hasSale && listing.salePriceCents != null && "pt-5")}>
            <p className="eyebrow">Long-term rent</p>
            <p className="mt-2">
              <strong className="font-display text-4xl font-normal">{format(listing.monthlyRentCents)}</strong> <span className="text-sm text-basalt/50">/ month</span>
            </p>
            {listing.depositCents != null && listing.depositCents > 0 && (
              <p className="mt-1 text-sm text-basalt/55">{format(listing.depositCents)} deposit</p>
            )}
          </div>
        )}

        <dl className="mt-5 grid gap-2.5 text-sm text-basalt/70">
          {listing.areaM2 != null && (
            <div className="flex items-center gap-2"><Ruler className="h-4 w-4 shrink-0 text-apricot" strokeWidth={1.75} /> {listing.areaM2} m²{listing.floor != null && `, floor ${listing.floor}${listing.totalFloors != null ? `/${listing.totalFloors}` : ""}`}</div>
          )}
          {hasMonthly && listing.furnished && (
            <div className="flex items-center gap-2"><Home className="h-4 w-4 shrink-0 text-apricot" strokeWidth={1.75} /> {FURNISHED_LABEL[listing.furnished] ?? listing.furnished}{listing.utilitiesIncluded ? " · utilities included" : ""}</div>
          )}
          {hasMonthly && listing.minLeaseMonths != null && (
            <div className="flex items-center gap-2"><CalendarCheck className="h-4 w-4 shrink-0 text-apricot" strokeWidth={1.75} /> {listing.minLeaseMonths}-month minimum lease</div>
          )}
          {hasMonthly && listing.availableFrom && (
            <div className="flex items-center gap-2"><Tag className="h-4 w-4 shrink-0 text-apricot" strokeWidth={1.75} /> Available from {new Date(listing.availableFrom).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
          )}
        </dl>

        <Button onClick={() => setOpen(true)} className="mt-6 w-full rounded-none bg-apricot py-6 text-base font-semibold text-white hover:bg-apricot/90">
          Request a viewing
        </Button>
        <p className="mt-3 text-center text-xs leading-5 text-basalt/50">Free, no obligation. The host arranges the viewing with you directly.</p>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Request a viewing</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-sm text-basalt/55">For <span className="font-semibold text-basalt">{listing.title}</span>. The host will reach out to confirm a time.</p>

          {offers.length > 1 && (
            <div className="mt-2">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-basalt/55">I'm interested in</p>
              <div className="grid grid-cols-2 gap-2">
                {hasMonthly && (
                  <button type="button" onClick={() => setOfferType("monthly")} className={cn("rounded-none border px-3 py-2 text-sm font-semibold", offerType === "monthly" ? "border-apricot bg-apricot/10 text-apricot" : "border-basalt/20 text-basalt/70")}>Renting</button>
                )}
                {hasSale && (
                  <button type="button" onClick={() => setOfferType("sale")} className={cn("rounded-none border px-3 py-2 text-sm font-semibold", offerType === "sale" ? "border-apricot bg-apricot/10 text-apricot" : "border-basalt/20 text-basalt/70")}>Buying</button>
                )}
              </div>
            </div>
          )}

          <div className="mt-2">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-basalt/55">Viewing format</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("in_person")} className={cn("rounded-none border px-3 py-2 text-sm font-semibold", mode === "in_person" ? "border-apricot bg-apricot/10 text-apricot" : "border-basalt/20 text-basalt/70")}>In person</button>
              <button type="button" onClick={() => setMode("video")} className={cn("rounded-none border px-3 py-2 text-sm font-semibold", mode === "video" ? "border-apricot bg-apricot/10 text-apricot" : "border-basalt/20 text-basalt/70")}>Video call</button>
            </div>
          </div>

          <Textarea
            rows={2}
            value={times}
            onChange={(e) => setTimes(e.target.value)}
            placeholder="Preferred days/times — e.g. Weekday evenings, Saturday morning (one per line)"
            className="mt-2 rounded-none text-base"
          />
          <Textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Anything to add? e.g. move-in timing, questions about the lease or sale"
            className="mt-2 rounded-none text-base"
          />

          {isGuest && (
            <div className="mt-2 grid gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" className="h-10 rounded-none" />
              <div className="grid grid-cols-2 gap-2">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="h-10 rounded-none" />
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="h-10 rounded-none" />
              </div>
              <p className="text-[11px] leading-4 text-basalt/45">Add an email or phone so the host can arrange your viewing. No sign-up needed.</p>
            </div>
          )}

          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={submit} disabled={sending} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
