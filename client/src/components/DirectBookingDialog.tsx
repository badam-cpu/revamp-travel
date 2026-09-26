/**
 * Operator-facing "record a direct booking" dialog, opened from the Bookings
 * timeline. For offline reservations (phone / email / walk-in): capture the
 * guest's contact details + the agreed price, and create a confirmed booking
 * that blocks the dates. Money is handled offline, so there's a manual
 * paid/unpaid status (no PayLink). 10% tax is added on top of the entered base.
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { LiveListing } from "@/contexts/ListingsContext";
import { computeBookingCharge, nightsBetween, TAX_PERCENT } from "@shared/bookings";
import { scheduleHasSlots } from "@shared/sessions";
import { getListingSessions, slotLocalDate, formatSlotTime, type ListingSession } from "@/lib/sessions";
import { createDirectBooking } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export function DirectBookingDialog({
  listing,
  startDate,
  onClose,
  onCreated,
}: {
  listing: LiveListing | null;
  startDate: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const open = Boolean(listing && startDate);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-none">
        {listing && startDate && <DirectBookingForm key={listing.id + startDate} listing={listing} startDate={startDate} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function DirectBookingForm({ listing, startDate, onClose, onCreated }: { listing: LiveListing; startDate: string; onClose: () => void; onCreated: () => void }) {
  const { format } = useCurrency();
  const isStay = listing.type === "stay";
  const slotMode = !isStay && scheduleHasSlots(listing.sessionSchedule);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [checkIn, setCheckIn] = useState(startDate);
  const [checkOut, setCheckOut] = useState(addDays(startDate, 1));
  const [guests, setGuests] = useState(1);
  const [nightly, setNightly] = useState(String(Math.round(listing.price) || ""));
  const [cleaning, setCleaning] = useState(String(Math.round((listing.cleaningFeeCents ?? 0) / 100) || ""));
  const [flat, setFlat] = useState(String(Math.round(listing.price) || "")); // tours/experiences total
  const [paid, setPaid] = useState(false);
  const [collectVia, setCollectVia] = useState<"offline" | "paylink">("offline");
  const [saving, setSaving] = useState(false);

  // Slot mode: load the listing's bookable sessions once, then filter to the
  // chosen date so the operator picks a real time slot (whose seat we reserve).
  const [sessions, setSessions] = useState<ListingSession[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(slotMode);
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    if (!slotMode) return;
    let live = true;
    setLoadingSlots(true);
    getListingSessions(listing.id)
      .then((s) => { if (live) setSessions(s); })
      .finally(() => { if (live) setLoadingSlots(false); });
    return () => { live = false; };
  }, [slotMode, listing.id]);

  const daySessions = useMemo(
    () => sessions.filter((s) => slotLocalDate(s.startsAt) === checkIn).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [sessions, checkIn],
  );
  const selectedSession = daySessions.find((s) => s.id === sessionId) ?? null;
  // Drop a stale selection when the date changes to one without that slot.
  useEffect(() => {
    if (sessionId && !daySessions.some((s) => s.id === sessionId)) setSessionId("");
  }, [daySessions, sessionId]);

  const nights = isStay ? nightsBetween(checkIn, checkOut) : 1;
  const baseCents = useMemo(() => {
    if (isStay) return Math.max(0, Math.round(Number(nightly) || 0)) * 100 * nights + Math.max(0, Math.round(Number(cleaning) || 0)) * 100;
    return Math.max(0, Math.round(Number(flat) || 0)) * 100;
  }, [isStay, nightly, cleaning, nights, flat]);
  const charge = computeBookingCharge(baseCents);

  const submit = async () => {
    if (!name.trim()) {
      toast("Enter the guest's name.");
      return;
    }
    if (isStay && checkOut <= checkIn) {
      toast("Check-out must be after check-in.");
      return;
    }
    if (slotMode && !sessionId) {
      toast("Pick a time slot.");
      return;
    }
    if (slotMode && selectedSession && guests > selectedSession.seatsLeft) {
      toast(`Only ${selectedSession.seatsLeft} seat${selectedSession.seatsLeft === 1 ? "" : "s"} left on that slot.`);
      return;
    }
    if (baseCents <= 0) {
      toast("Enter the price.");
      return;
    }
    if (collectVia === "paylink" && !email.trim()) {
      toast("Add the customer's email to send them a payment link.");
      return;
    }
    setSaving(true);
    try {
      const r = await createDirectBooking({
        listingId: listing.id,
        sessionId: slotMode ? sessionId : undefined,
        startDate: checkIn,
        endDate: isStay ? checkOut : addDays(checkIn, 1),
        guests,
        guestName: name.trim(),
        guestEmail: email.trim(),
        guestPhone: phone.trim(),
        baseCents,
        paymentStatus: paid ? "paid" : "unpaid",
        collectVia,
      });
      if (r.paymentLinkSent) toast.success(`Payment link emailed to ${email.trim()} — the booking confirms once they pay.`);
      else toast(slotMode ? "Direct booking created — the seat is reserved on that slot." : "Direct booking created — the dates are now blocked.");
      onCreated();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't create the booking.");
    } finally {
      setSaving(false);
    }
  };

  const field = "h-10 rounded-none";
  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">Direct booking</DialogTitle>
      </DialogHeader>
      <p className="-mt-1 text-sm text-basalt/55">{listing.title}</p>

      <div className="mt-2 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="db-name" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Guest name</Label>
          <Input id="db-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="db-email" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Email</Label>
            <Input id="db-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" className={field} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="db-phone" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Phone</Label>
            <Input id="db-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" className={field} />
          </div>
        </div>

        {isStay ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="db-in" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Check-in</Label>
              <Input id="db-in" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={field} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="db-out" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Check-out</Label>
              <Input id="db-out" type="date" min={addDays(checkIn, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={field} />
            </div>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="db-date" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Date</Label>
            <Input id="db-date" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={field} />
          </div>
        )}

        {slotMode && (
          <div className="grid gap-1.5">
            <Label className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Time slot</Label>
            {loadingSlots ? (
              <p className="text-sm text-basalt/45">Loading slots…</p>
            ) : daySessions.length === 0 ? (
              <p className="text-sm text-basalt/55">No open time slots on this date. Pick another date, or add slots in the listing's schedule.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {daySessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setSessionId(s.id); if (guests > s.seatsLeft) setGuests(s.seatsLeft); }}
                    className={cn(
                      "rounded-none border px-3 py-1.5 text-sm transition-colors",
                      sessionId === s.id ? "border-apricot bg-apricot/10 text-basalt" : "border-basalt/15 text-basalt/70 hover:border-apricot/60",
                    )}
                  >
                    {formatSlotTime(s.startsAt)} · <span className="text-basalt/50">{s.seatsLeft} left</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="db-guests" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Guests</Label>
            <Input id="db-guests" type="number" min={1} max={slotMode ? (selectedSession?.seatsLeft ?? 1) : 50} value={guests} onChange={(e) => setGuests(Math.max(1, Math.min(slotMode && selectedSession ? selectedSession.seatsLeft : 50, Number(e.target.value) || 1)))} className={field} />
          </div>
          {isStay ? (
            <div className="grid gap-1.5">
              <Label htmlFor="db-nightly" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Nightly rate (֏)</Label>
              <Input id="db-nightly" type="number" min={0} value={nightly} onChange={(e) => setNightly(e.target.value)} className={field} />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="db-flat" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Price (֏)</Label>
              <Input id="db-flat" type="number" min={0} value={flat} onChange={(e) => setFlat(e.target.value)} className={field} />
            </div>
          )}
        </div>

        {isStay && (
          <div className="grid gap-1.5">
            <Label htmlFor="db-clean" className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Cleaning fee (֏)</Label>
            <Input id="db-clean" type="number" min={0} value={cleaning} onChange={(e) => setCleaning(e.target.value)} className={field} />
          </div>
        )}

        {/* Total breakdown */}
        <div className="mt-1 grid gap-1 border-t border-basalt/10 pt-3 text-sm">
          <div className="flex justify-between text-basalt/55"><span>{isStay ? `${format(Math.round(Number(nightly) || 0) * 100)} × ${nights} night${nights === 1 ? "" : "s"}${Number(cleaning) > 0 ? " + cleaning" : ""}` : "Price"}</span><span>{format(charge.baseCents)}</span></div>
          <div className="flex justify-between text-basalt/55"><span>Tax ({TAX_PERCENT}%)</span><span>{format(charge.taxCents)}</span></div>
          <div className="flex justify-between border-t border-basalt/10 pt-1.5 font-semibold"><span>Total</span><span className="font-display text-lg font-normal">{format(charge.totalCents)}</span></div>
        </div>

        {/* How to collect payment */}
        <div className="grid gap-1.5">
          <span className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Collect payment</span>
          <div className="grid grid-cols-2 gap-2">
            {([["offline", "Record offline"], ["paylink", "Send payment link"]] as const).map(([v, lbl]) => (
              <button
                key={v}
                type="button"
                onClick={() => setCollectVia(v)}
                className={cn("rounded-none border px-3 py-2 text-sm font-semibold transition-colors", collectVia === v ? "border-apricot bg-apricot/10 text-basalt" : "border-basalt/15 text-basalt/60 hover:border-apricot/60")}
              >
                {lbl}
              </button>
            ))}
          </div>
          {collectVia === "paylink" && (
            <p className="text-[11px] leading-4 text-basalt/50">We'll email the customer a secure PayLink link. The booking confirms automatically once they pay — enter their email above.</p>
          )}
        </div>

        {/* Payment status — only for offline bookings */}
        {collectVia === "offline" && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Payment</span>
            <div className="ml-auto flex border border-basalt/15">
              {([["unpaid", "Unpaid"], ["paid", "Paid"]] as const).map(([v, lbl]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPaid(v === "paid")}
                  className={cn("px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition-colors", (paid ? "paid" : "unpaid") === v ? "bg-basalt text-paper" : "text-basalt/55 hover:text-basalt")}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <DialogFooter className="mt-4">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving} className="rounded-none bg-apricot text-white hover:bg-apricot/90">{saving ? (collectVia === "paylink" ? "Sending…" : "Creating…") : collectVia === "paylink" ? "Send payment link" : "Create booking"}</Button>
      </DialogFooter>
      <p className="mt-1 text-center text-[11px] leading-4 text-basalt/45">
        {collectVia === "paylink"
          ? "Emails the customer a PayLink link; the booking confirms automatically when they pay."
          : `${slotMode ? "Reserves a seat on the selected time slot" : "Blocks these dates"}. Money is collected offline — no charge is made here.`}
      </p>
    </>
  );
}
