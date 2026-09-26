/**
 * Booking detail window for operators (opened from the bookings timeline/list).
 * Shows guest contact, dates, guests, the full payment breakdown, add-ons, and
 * a communication History (sent emails etc.) from the booking_events log
 * (supabase/migrations/0032_booking_events.sql). RLS scopes reads to bookings on
 * the operator's own listings.
 */
import { useEffect, useState } from "react";
import { Mail, Phone, User, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { setBookingPayment, cancelBooking, ensureBookingThread, updateBookingContact } from "@/lib/api";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { BookingStatus } from "@shared/bookings";

interface AddonSnap { id: string; name: string; unit?: string; qty: number; amountCents: number; onRequest?: boolean }
interface FullBooking {
  id: string;
  start_date: string;
  end_date: string;
  guests: number;
  amount_cents: number;
  base_cents: number | null;
  tax_cents: number | null;
  addons_cents: number | null;
  addons: AddonSnap[] | null;
  currency: string;
  status: BookingStatus;
  provider: string | null;
  payment_status: string | null;
  created_at: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  traveler_id: string | null;
  refund_amount_cents: number | null;
  listings: { title: string; type: string; city: string } | null;
  profiles: { display_name: string } | null;
}
interface BookingEvent { id: string; type: string; detail: string | null; created_at: string }

const STATUS_LABEL: Partial<Record<BookingStatus, string>> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  payment_failed: "Payment failed",
  expired: "Expired",
};

const EVENT_LABEL: Record<string, string> = {
  email_traveler_confirmation: "Confirmation email sent to guest",
  email_operator_new_booking: "New-booking email sent to you",
  email_cancellation: "Cancellation email sent",
  email_review_request: "Review-request email sent to guest",
  status_confirmed: "Booking confirmed",
  status_cancelled: "Booking cancelled",
  status_expired: "Unpaid hold expired (auto-cancelled)",
  direct_created: "Direct booking recorded",
  payment_status: "Payment status changed",
  email_failed: "⚠️ Email failed to send",
};

function money(cents: number | null | undefined, currency: string): string {
  const c = cents ?? 0;
  if (currency && currency !== "AMD") return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  return `֏${Math.round(c / 100).toLocaleString()}`;
}
function fmtDate(iso: string): string {
  return new Date(iso.length > 10 ? iso : iso + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric", timeZone: iso.length > 10 ? undefined : "UTC" });
}
function nights(a: string, b: string): number {
  return Math.max(1, Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000));
}

export function BookingDetailDialog({ bookingId, onClose, onChanged }: { bookingId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [booking, setBooking] = useState<FullBooking | null>(null);
  const [events, setEvents] = useState<BookingEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingContact, setEditingContact] = useState(false);
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!bookingId) {
      setBooking(null);
      setEvents([]);
      return;
    }
    setLoading(true);
    supabase
      .from("bookings")
      // select("*") so a not-yet-run 0035 (payment_status) migration doesn't break the dialog.
      .select("*, listings!inner(title, type, city), profiles!traveler_id(display_name)")
      .eq("id", bookingId)
      .maybeSingle()
      .then(({ data }) => {
        setBooking((data as unknown as FullBooking) ?? null);
        setLoading(false);
      });
    // History log — degrades to empty if the table isn't there yet.
    supabase
      .from("booking_events")
      .select("id, type, detail, created_at")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => setEvents(error ? [] : ((data ?? []) as BookingEvent[])));
  }, [bookingId, reloadKey]);

  const b = booking;
  const guestName = b?.guest_name || b?.profiles?.display_name || "Guest";

  const startEditContact = () => {
    setCName(b?.guest_name || "");
    setCEmail(b?.guest_email || "");
    setCPhone(b?.guest_phone || "");
    setEditingContact(true);
  };
  const saveContact = async () => {
    if (!b) return;
    setSavingContact(true);
    try {
      await updateBookingContact(b.id, { name: cName.trim(), email: cEmail.trim(), phone: cPhone.trim() });
      setEditingContact(false);
      setReloadKey((k) => k + 1);
      onChanged?.();
      toast("Contact details updated.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update the contact details.");
    } finally {
      setSavingContact(false);
    }
  };
  const todayIso = new Date().toISOString().slice(0, 10);
  const canCancel = !!b && (b.status === "pending_payment" || b.status === "confirmed") && b.start_date >= todayIso;

  const messageGuest = async () => {
    if (!b) return;
    setMessaging(true);
    try {
      await ensureBookingThread(b.id);
      onClose();
      navigate("/dashboard?section=messages");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't open the conversation.");
    } finally {
      setMessaging(false);
    }
  };

  const doCancel = async () => {
    if (!b) return;
    if (!window.confirm(`Cancel this booking for ${b.listings?.title ?? "your listing"}? The guest is emailed and the dates reopen.`)) return;
    setCancelling(true);
    try {
      const { refundCents } = await cancelBooking(b.id);
      setBooking((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
      toast(refundCents > 0 ? `Cancelled — refund ${money(refundCents, b.currency)} to process manually in PayLink.` : "Booking cancelled — the dates are reopened.");
      onChanged?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't cancel that booking.");
    } finally {
      setCancelling(false);
    }
  };
  const baseCents = b ? (b.base_cents ?? b.amount_cents) : 0;
  const totalLabel =
    b?.status === "confirmed" || b?.status === "completed"
      ? "Paid"
      : b?.status === "pending_payment"
        ? "Total due"
        : b?.status === "cancelled" || b?.status === "refunded"
          ? "Charged"
          : "Total";

  return (
    <Dialog open={!!bookingId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden rounded-none p-0">
        {loading || !b ? (
          <div className="p-8 text-sm text-basalt/50">{loading ? "Loading…" : "Booking not found."}</div>
        ) : (
          <div className="max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-basalt/10 bg-chalk p-5 pr-14">
              <div className="min-w-0">
                <DialogTitle className="truncate font-display text-2xl font-normal leading-tight">{b.listings?.title ?? "Booking"}</DialogTitle>
                <p className="mt-1 text-xs uppercase tracking-[0.1em] text-basalt/45">{b.listings?.type} · {b.listings?.city}</p>
              </div>
              <span className="shrink-0 rounded-full bg-basalt px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-paper">{STATUS_LABEL[b.status] ?? b.status}</span>
            </div>

            <div className="grid gap-6 p-5">
              {/* Guest */}
              <section>
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Guest</h3>
                  {!editingContact && (
                    <button type="button" onClick={startEditContact} className="inline-flex items-center gap-1 text-[11px] font-semibold text-basalt/50 transition-colors hover:text-apricot">
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  )}
                </div>
                {editingContact ? (
                  <div className="mt-2 grid gap-2">
                    <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Guest name" className="h-10 rounded-none" />
                    <Input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="Email (optional)" className="h-10 rounded-none" />
                    <Input type="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="Phone (optional)" className="h-10 rounded-none" />
                    <div className="flex items-center gap-2">
                      <Button onClick={saveContact} disabled={savingContact} className="h-9 rounded-none bg-apricot text-white hover:bg-apricot/90">{savingContact ? "Saving…" : "Save"}</Button>
                      <button type="button" onClick={() => setEditingContact(false)} disabled={savingContact} className="text-sm font-semibold text-basalt/50 hover:text-basalt">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 grid gap-1.5 text-sm">
                    <p className="flex items-center gap-2"><User className="h-4 w-4 text-basalt/40" /> {guestName}</p>
                    <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-basalt/40" /> {b.guest_email ? <a href={`mailto:${b.guest_email}`} className="text-apricot hover:underline">{b.guest_email}</a> : <span className="text-basalt/40">Not shared (account guest)</span>}</p>
                    <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-basalt/40" /> {b.guest_phone ? <a href={`tel:${b.guest_phone}`} className="text-apricot hover:underline">{b.guest_phone}</a> : <span className="text-basalt/40">—</span>}</p>
                  </div>
                )}
              </section>

              {/* Stay */}
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Reservation</h3>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-basalt/45">Check-in</p><p className="font-semibold">{fmtDate(b.start_date)}</p></div>
                  <div><p className="text-basalt/45">Check-out</p><p className="font-semibold">{fmtDate(b.end_date)}</p></div>
                  <div><p className="text-basalt/45">Nights</p><p className="font-semibold">{nights(b.start_date, b.end_date)}</p></div>
                  <div><p className="text-basalt/45">Guests</p><p className="font-semibold">{b.guests}</p></div>
                </div>
              </section>

              {/* Payment */}
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Payment</h3>
                <div className="mt-2 grid gap-1.5 text-sm">
                  <div className="flex justify-between text-basalt/60"><span>Base</span><span>{money(baseCents - (b.addons_cents ?? 0), b.currency)}</span></div>
                  {b.addons_cents ? <div className="flex justify-between text-basalt/60"><span>Add-ons</span><span>{money(b.addons_cents, b.currency)}</span></div> : null}
                  {b.tax_cents ? <div className="flex justify-between text-basalt/60"><span>Tax</span><span>{money(b.tax_cents, b.currency)}</span></div> : null}
                  <div className="flex justify-between border-t border-basalt/10 pt-1.5 font-semibold"><span>{totalLabel}</span><span>{money(b.amount_cents, b.currency)}</span></div>
                  {b.refund_amount_cents ? <div className="flex justify-between text-destructive"><span>Refund due</span><span>{money(b.refund_amount_cents, b.currency)}</span></div> : null}
                </div>
                {/* Direct (offline) bookings: manually-flipped payment status. */}
                {b.provider === "direct" && (
                  <div className="mt-3 flex items-center gap-2 border-t border-basalt/10 pt-3">
                    <span className="text-sm text-basalt/55">Payment status</span>
                    <div className="ml-auto flex border border-basalt/15">
                      {(["unpaid", "paid"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          disabled={savingPay}
                          onClick={async () => {
                            if ((b.payment_status ?? "unpaid") === v) return;
                            setSavingPay(true);
                            try {
                              await setBookingPayment(b.id, v);
                              setBooking((prev) => (prev ? { ...prev, payment_status: v } : prev));
                              toast(`Marked ${v}.`);
                            } catch (e) {
                              toast(e instanceof Error ? e.message : "Couldn't update payment.");
                            } finally {
                              setSavingPay(false);
                            }
                          }}
                          className={cn("px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition-colors disabled:opacity-50", (b.payment_status ?? "unpaid") === v ? (v === "paid" ? "bg-sevan text-white" : "bg-tuff text-white") : "text-basalt/55 hover:text-basalt")}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {b.addons && b.addons.length > 0 && (
                  <ul className="mt-3 grid gap-1 border-t border-basalt/10 pt-3 text-xs text-basalt/55">
                    {b.addons.map((a) => (
                      <li key={a.id} className="flex justify-between"><span>{a.name}{a.qty > 1 ? ` × ${a.qty}` : ""}{a.onRequest ? " (on request)" : ""}</span><span>{a.onRequest ? "—" : money(a.amountCents, b.currency)}</span></li>
                    ))}
                  </ul>
                )}
              </section>

              {/* History */}
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">History</h3>
                <p className="mt-1 text-[11px] text-basalt/40">Booked {fmtDate(b.created_at)}.</p>
                {events.length === 0 ? (
                  <p className="mt-2 text-sm text-basalt/45">No communication logged yet.</p>
                ) : (
                  <ul className="mt-2 grid gap-2">
                    {events.map((e) => (
                      <li key={e.id} className="flex items-start gap-2.5 border-l-2 border-apricot/40 pl-3 text-sm">
                        <span className="min-w-0">
                          <span className="block font-medium text-basalt">{EVENT_LABEL[e.type] ?? e.type}</span>
                          {e.detail && <span className="block text-xs text-basalt/45">{e.detail}</span>}
                          <span className="block text-[11px] text-basalt/40">{fmtDate(e.created_at)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Message the guest (in-app, only when they have an account) */}
              {b.traveler_id && (
                <section className="border-t border-basalt/10 pt-4">
                  <Button variant="outline" disabled={messaging} onClick={messageGuest} className="rounded-none border-basalt/20">
                    {messaging ? "Opening…" : "Message guest"}
                  </Button>
                  <p className="mt-2 text-xs text-basalt/45">Opens a conversation in your inbox. Keep bookings and payments on Revamp.</p>
                </section>
              )}

              {/* Cancel */}
              {canCancel && (
                <section className="border-t border-basalt/10 pt-4">
                  <Button variant="outline" disabled={cancelling} onClick={doCancel} className="rounded-none border-destructive/30 text-destructive hover:bg-destructive/5">
                    {cancelling ? "Cancelling…" : "Cancel booking"}
                  </Button>
                  <p className="mt-2 text-xs text-basalt/45">The guest is emailed and the dates reopen. A paid booking flags a manual refund — issue it in the PayLink dashboard (PayLink has no refund API).</p>
                </section>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
