/**
 * Incoming bookings for an operator — the host side of the PayLink booking
 * loop, shown on /dashboard. Reads bookings placed on listings this operator
 * owns (RLS policy "bookings operator read on own listings" in
 * supabase/migrations/0010_bookings.sql authorizes it; the `listings!inner`
 * filter on operator_id scopes the query to their own listings). Confirmed
 * bookings are real, paid reservations; pending ones are mid-checkout holds.
 *
 * Read-only for now: cancellation / refund is Phase 3. The traveler's name
 * comes from the public `profiles` row via the traveler_id FK embed.
 */
import { useEffect, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { cancelBooking } from "@/lib/api";
import type { BookingStatus } from "@shared/bookings";
import { BookingDetailDialog } from "@/components/BookingDetailDialog";
import { toast } from "sonner";

interface IncomingBooking {
  id: string;
  start_date: string;
  end_date: string;
  guests: number;
  amount_cents: number;
  currency: string;
  status: BookingStatus;
  created_at: string;
  listings: { title: string; slug: string; type: string } | null;
  profiles: { display_name: string } | null;
}

const TYPE_TABS: { type: string; label: string }[] = [
  { type: "stay", label: "Stays" },
  { type: "tour", label: "Tours" },
  { type: "experience", label: "Experiences" },
];

const STATUS_STYLE: Partial<Record<BookingStatus, { label: string; className: string }>> = {
  pending_payment: { label: "Awaiting payment", className: "bg-tuff/15 text-tuff" },
  confirmed: { label: "Confirmed", className: "bg-sevan/15 text-sevan" },
  completed: { label: "Completed", className: "bg-basalt/10 text-basalt/60" },
  cancelled: { label: "Cancelled", className: "bg-destructive/10 text-destructive" },
  refunded: { label: "Refunded", className: "bg-basalt/10 text-basalt/60" },
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtMoney(cents: number, currency: string): string {
  const major = cents / 100;
  if (currency === "USD") {
    const n = major % 1 === 0 ? major.toString() : major.toFixed(2);
    return `$${n}`;
  }
  // AMD (and anything else) — dram sign + thousands separator, whole numbers.
  return `֏${Math.round(major).toLocaleString()}`;
}

export function OperatorBookings() {
  const { user } = useAuth();
  const [rows, setRows] = useState<IncomingBooking[] | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);

  const todayIso = new Date().toISOString().slice(0, 10);
  const canCancel = (b: IncomingBooking) => (b.status === "pending_payment" || b.status === "confirmed") && b.start_date >= todayIso;

  const cancel = async (b: IncomingBooking) => {
    if (!window.confirm(`Cancel this booking for ${b.listings?.title ?? "your listing"}? The traveler is notified and the dates reopen.`)) return;
    setCancelling(b.id);
    try {
      const { refundCents } = await cancelBooking(b.id);
      setRows((prev) => (prev ? prev.map((x) => (x.id === b.id ? { ...x, status: "cancelled" } : x)) : prev));
      toast(refundCents > 0 ? `Cancelled — refund ${fmtMoney(refundCents, b.currency)} to the traveler in PayLink.` : "Booking cancelled — no refund applies.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't cancel that booking.");
    } finally {
      setCancelling(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("bookings")
      .select(
        "id, start_date, end_date, guests, amount_cents, currency, status, created_at, listings!inner(title, slug, type, operator_id), profiles!traveler_id(display_name)",
      )
      .eq("listings.operator_id", user.id)
      .in("status", ["pending_payment", "confirmed", "completed", "cancelled", "refunded"])
      .order("start_date", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Failed to load incoming bookings", error);
          setRows([]);
          return;
        }
        setRows((data ?? []) as unknown as IncomingBooking[]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  if (rows === null) return <p className="text-sm text-basalt/50">Loading your bookings…</p>;

  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-14 text-center">
        <CalendarCheck className="mx-auto h-7 w-7 text-basalt/30" />
        <h3 className="mt-4 font-display text-2xl">No bookings yet.</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-basalt/55">When a traveler books one of your listings, it shows up here.</p>
      </div>
    );
  }

  // Only show category tabs for the listing types this operator actually has
  // bookings in (an operator with only stays sees no Tours/Experiences tab).
  const presentTypes = TYPE_TABS.filter((t) => rows.some((r) => r.listings?.type === t.type));
  const current = activeType && presentTypes.some((t) => t.type === activeType) ? activeType : presentTypes[0]?.type ?? "";
  const visible = presentTypes.length > 1 ? rows.filter((r) => r.listings?.type === current) : rows;

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <CalendarCheck className="h-5 w-5 text-apricot" />
        <h2 className="font-display text-2xl tracking-[-0.02em]">Bookings</h2>
      </div>
      {presentTypes.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-1 border-b border-basalt/10">
          {presentTypes.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => setActiveType(t.type)}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                current === t.type ? "border-apricot text-basalt" : "border-transparent text-basalt/50 hover:text-basalt"
              }`}
            >
              {t.label} <span className="text-basalt/35">{rows.filter((r) => r.listings?.type === t.type).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-2">
        {visible.map((b) => {
          const s = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending_payment!;
          return (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(b.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(b.id); } }}
              className="grid cursor-pointer gap-2 border border-basalt/10 bg-paper p-4 transition-colors hover:border-apricot/40 hover:bg-chalk sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div>
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${s.className}`}>{s.label}</span>
                <h3 className="mt-1.5 font-semibold">{b.listings?.title ?? "Listing"}</h3>
                <p className="mt-0.5 text-sm text-basalt/55">
                  {b.profiles?.display_name ?? "A traveler"} · {fmtDate(b.start_date)} → {fmtDate(b.end_date)} · {b.guests} {b.guests === 1 ? "guest" : "guests"}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                <p className="font-display text-lg font-normal">{fmtMoney(b.amount_cents, b.currency)}</p>
                {canCancel(b) && (
                  <button
                    type="button"
                    disabled={cancelling === b.id}
                    onClick={(e) => { e.stopPropagation(); cancel(b); }}
                    className="text-xs font-semibold text-basalt/45 underline-offset-2 transition-colors hover:text-destructive hover:underline disabled:opacity-50"
                  >
                    {cancelling === b.id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <BookingDetailDialog bookingId={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}
