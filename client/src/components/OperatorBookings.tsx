/**
 * Dashboard → Bookings: every reservation on the operator's listings, with the
 * filters a host actually uses (Hosteeva-style reservations list).
 *
 * Top row: Booking ID · Keywords (guest name / email / phone, listing, room) ·
 * which date to filter on (Check in / Check out / Booked / Cancelled) · a date
 * range. "More" holds only filters that apply to Revamp data — property, city,
 * listing type, status, channel (Revamp vs direct), pay status, needs
 * attention, nights, returning guests, promo code, add-ons, gift card — and a
 * filter only shows when the bookings in view give it something to choose
 * between (or it's already set).
 *
 * Tiles: search results, occupancy (stays, Revamp bookings, over the date
 * range), nights sold and income (before commission) of the confirmed results.
 *
 * Data: bookings on listings this operator owns (RLS "bookings operator read on
 * own listings" + listings!inner on operator_id), the date filter applied in
 * the query (up to 1000 rows), the rest client-side. "Cancelled" dates use the
 * booking's last update (cancelling is its last change). Actions stay where
 * they were: Approve / Decline a request, Cancel an upcoming booking, open the
 * booking window.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { cancelBooking, approveBooking, declineBooking, userMessage } from "@/lib/api";
import type { BookingStatus } from "@shared/bookings";
import { formatSlotTime } from "@shared/sessions";
import { BookingDetailDialog } from "@/components/BookingDetailDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchBookingRoomNames, fetchRoomTypes } from "@/lib/roomTypes";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const PAGE = 20;

interface Booking {
  id: string;
  start_date: string;
  end_date: string;
  starts_at: string | null;
  guests: number;
  amount_cents: number;
  base_cents: number | null;
  currency: string;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  traveler_id: string | null;
  provider: string | null;
  payment_status: string | null;
  refund_amount_cents: number | null;
  promo_code_id: string | null;
  addons_cents: number | null;
  gift_applied_cents: number | null;
  room_unit_id: string | null;
  listing_id: string;
  listings: { title: string; slug: string; type: string; city: string; multi_room: boolean | null } | null;
  profiles: { display_name: string } | null;
}

const STATUS: Partial<Record<BookingStatus, { label: string; className: string }>> = {
  requested: { label: "Requested", className: "bg-apricot/15 text-apricot" },
  awaiting_payment: { label: "Approved · awaiting payment", className: "bg-tuff/15 text-tuff" },
  pending_payment: { label: "Awaiting payment", className: "bg-tuff/15 text-tuff" },
  confirmed: { label: "Confirmed", className: "bg-sevan/15 text-sevan" },
  completed: { label: "Completed", className: "bg-basalt/10 text-basalt/70" },
  cancelled: { label: "Cancelled", className: "bg-destructive/10 text-destructive" },
  refunded: { label: "Refunded", className: "bg-basalt/10 text-basalt/70" },
};
const ALL_STATUSES = Object.keys(STATUS) as BookingStatus[];

type DateField = "checkin" | "checkout" | "booked" | "cancelled";
const DATE_FIELDS: { value: DateField; label: string }[] = [
  { value: "checkin", label: "Check in" },
  { value: "checkout", label: "Check out" },
  { value: "booked", label: "Booked" },
  { value: "cancelled", label: "Cancelled" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS);
const fmtDate = (iso: string) => new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
function fmtMoney(cents: number, currency: string): string {
  const major = cents / 100;
  if (currency === "USD") return `$${major % 1 === 0 ? major : major.toFixed(2)}`;
  return `֏${Math.round(major).toLocaleString()}`;
}
const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const guestOf = (b: Booking) => b.profiles?.display_name || b.guest_name || "Guest";
const nightsOf = (b: Booking) => Math.max(1, dayDiff(b.start_date, b.end_date));
const isStay = (b: Booking) => b.listings?.type === "stay";
const sold = (b: Booking) => b.status === "confirmed" || b.status === "completed";
const guestKey = (b: Booking) => b.traveler_id || (b.guest_email ? b.guest_email.trim().toLowerCase() : "") || (b.guest_phone ? b.guest_phone.replace(/\D/g, "") : "");

function payStatus(b: Booking): "paid" | "unpaid" | "awaiting" | "refund_due" | "refunded" | "none" {
  if (b.status === "refunded") return "refunded";
  if (b.status === "cancelled") return (b.refund_amount_cents ?? 0) > 0 ? "refund_due" : "none";
  if (b.status === "pending_payment" || b.status === "awaiting_payment") return "awaiting";
  if (sold(b)) return b.provider === "direct" && b.payment_status !== "paid" ? "unpaid" : "paid";
  return "none";
}
/** Why a booking needs the operator, if it does. */
function attention(b: Booking): "approve" | "unpaid" | "refund_due" | "no_room" | null {
  if (b.status === "requested") return "approve";
  const p = payStatus(b);
  if (p === "refund_due") return "refund_due";
  if (p === "unpaid" && b.end_date >= todayIso()) return "unpaid";
  if (sold(b) && b.listings?.multi_room && !b.room_unit_id && b.end_date >= todayIso()) return "no_room";
  return null;
}
const ATTENTION_LABEL = { approve: "Request to approve", unpaid: "Unpaid (direct)", refund_due: "Refund due", no_room: "No room assigned" } as const;
const PAY_LABEL = { paid: "Paid", unpaid: "Unpaid (direct)", awaiting: "Awaiting payment", refund_due: "Refund due", refunded: "Refunded", none: "Not charged" } as const;
const NIGHT_BUCKETS = [
  { value: "1", label: "1 night", test: (n: number) => n === 1 },
  { value: "2-3", label: "2–3 nights", test: (n: number) => n >= 2 && n <= 3 },
  { value: "4-6", label: "4–6 nights", test: (n: number) => n >= 4 && n <= 6 },
  { value: "7+", label: "7+ nights", test: (n: number) => n >= 7 },
] as const;
const TYPE_LABEL: Record<string, string> = { stay: "Stays", tour: "Tours", experience: "Experiences" };

interface More {
  property: string;
  city: string;
  type: string;
  status: string;
  channel: string;
  pay: string;
  attention: string;
  nights: string;
  returning: string;
  promo: string;
  addons: string;
  gift: string;
}
const NO_MORE: More = { property: "", city: "", type: "", status: "", channel: "", pay: "", attention: "", nights: "", returning: "", promo: "", addons: "", gift: "" };

export function OperatorBookings() {
  const { user } = useAuth();
  const { listings } = useListings();
  const mine = useMemo(() => listings.filter((l) => l.operatorId === user?.id && l.type !== "eat"), [listings, user?.id]);

  const [bookingId, setBookingId] = useState("");
  const [keywords, setKeywords] = useState("");
  const [dateField, setDateField] = useState<DateField>("checkin");
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDays(todayIso(), 30));
  const [more, setMore] = useState<More>(NO_MORE);
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<Booking[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [roomNames, setRoomNames] = useState<Map<string, string>>(new Map());
  const [guestCounts, setGuestCounts] = useState<Map<string, number>>(new Map());
  const [occupancy, setOccupancy] = useState<{ pct: number; nights: number; capacity: number } | null>(null);
  // ?booking=<id> (e.g. "Open booking" in a Telegram alert) opens that booking's window.
  const [openId, setOpenId] = useState<string | null>(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("booking");
      return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState<string | null>(null);

  // Bookings for the chosen date field + range (everything else filters client-side).
  useEffect(() => {
    if (!user) return;
    let live = true;
    setLoadError(false);
    let q = supabase
      .from("bookings")
      .select(
        "id, start_date, end_date, starts_at, guests, amount_cents, base_cents, currency, status, created_at, updated_at, guest_name, guest_email, guest_phone, traveler_id, provider, payment_status, refund_amount_cents, promo_code_id, addons_cents, gift_applied_cents, room_unit_id, listing_id, listings!inner(title, slug, type, city, multi_room, operator_id), profiles!traveler_id(display_name)",
      )
      .eq("listings.operator_id", user.id)
      .in("status", ALL_STATUSES);
    const col = dateField === "checkin" ? "start_date" : dateField === "checkout" ? "end_date" : dateField === "booked" ? "created_at" : "updated_at";
    const ts = dateField === "booked" || dateField === "cancelled";
    if (dateField === "cancelled") q = q.in("status", ["cancelled", "refunded"]);
    if (from) q = q.gte(col, ts ? `${from}T00:00:00Z` : from);
    if (to) q = ts ? q.lt(col, `${addDays(to, 1)}T00:00:00Z`) : q.lte(col, to);
    q.order(col, { ascending: dateField === "checkin" || dateField === "checkout" })
      .limit(1000)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          console.error("[bookings] load failed", error.message);
          setLoadError(true);
          setRows([]);
          return;
        }
        const loaded = (data ?? []) as unknown as Booking[];
        setRows(loaded);
        fetchBookingRoomNames(loaded.map((b) => b.id)).then((m) => live && setRoomNames(m));
      });
    return () => {
      live = false;
    };
  }, [user, dateField, from, to, reload]);

  // Returning guests: how many confirmed stays each guest has had with this operator (all time).
  useEffect(() => {
    if (!user) return;
    supabase
      .from("bookings")
      .select("traveler_id, guest_email, guest_phone, listings!inner(operator_id)")
      .eq("listings.operator_id", user.id)
      .in("status", ["confirmed", "completed"])
      .limit(5000)
      .then(({ data, error }) => {
        if (error) return console.error("[bookings] guest history failed", error.message);
        const m = new Map<string, number>();
        for (const b of (data ?? []) as unknown as Booking[]) {
          const k = guestKey(b);
          if (k) m.set(k, (m.get(k) ?? 0) + 1);
        }
        setGuestCounts(m);
      });
  }, [user, reload]);

  // Occupancy over the range: Revamp-booked nights ÷ (stay units × nights). A hotel counts each room.
  const stayScope = useMemo(
    () => mine.filter((l) => l.type === "stay" && (!more.property || l.id === more.property) && (!more.city || l.city === more.city) && (!more.type || more.type === "stay")),
    [mine, more.property, more.city, more.type],
  );
  useEffect(() => {
    if (!user || !from || !to || to < from || !stayScope.length) {
      setOccupancy(null);
      return;
    }
    let live = true;
    const rangeNights = dayDiff(from, to) + 1;
    const end = addDays(to, 1);
    (async () => {
      const units = await Promise.all(stayScope.map(async (l) => (l.multiRoom ? (await fetchRoomTypes(l.id)).reduce((a, t) => a + t.units.filter((u) => u.active).length, 0) : 1)));
      const capacity = units.reduce((a, n) => a + n, 0) * rangeNights;
      const { data, error } = await supabase
        .from("bookings")
        .select("start_date, end_date, listing_id, listings!inner(operator_id)")
        .eq("listings.operator_id", user.id)
        .in("listing_id", stayScope.map((l) => l.id))
        .in("status", ["confirmed", "completed"])
        .lt("start_date", end)
        .gt("end_date", from);
      if (!live) return;
      if (error || !capacity) return setOccupancy(null);
      const nights = (data ?? []).reduce((a, b) => {
        const s = (b.start_date as string) > from ? (b.start_date as string) : from;
        const e = (b.end_date as string) < end ? (b.end_date as string) : end;
        return a + Math.max(0, dayDiff(s, e));
      }, 0);
      setOccupancy({ pct: Math.round((nights / capacity) * 100), nights, capacity });
    })().catch((e) => {
      console.error("[bookings] occupancy failed", e);
      if (live) setOccupancy(null);
    });
    return () => {
      live = false;
    };
  }, [user, from, to, stayScope, reload]);

  // ── Client-side filters ─────────────────────────────────────────────────────
  const titleOf = (b: Booking) => `${b.listings?.title ?? "Listing"}${roomNames.get(b.id) ? ` · ${roomNames.get(b.id)}` : ""}`;
  const filtered = useMemo(() => {
    if (!rows) return [];
    const id = bookingId.trim().toLowerCase().replace(/^#/, "");
    const kw = keywords.trim().toLowerCase();
    return rows.filter((b) => {
      if (id && !b.id.toLowerCase().startsWith(id)) return false;
      if (kw) {
        const hay = [guestOf(b), b.guest_email, b.guest_phone, b.listings?.title, roomNames.get(b.id), b.listings?.city].filter(Boolean).join(" ").toLowerCase();
        if (!kw.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (more.property && b.listing_id !== more.property) return false;
      if (more.city && b.listings?.city !== more.city) return false;
      if (more.type && b.listings?.type !== more.type) return false;
      if (more.status && b.status !== more.status) return false;
      if (more.channel && (b.provider === "direct" ? "direct" : "revamp") !== more.channel) return false;
      if (more.pay && payStatus(b) !== more.pay) return false;
      if (more.attention && (more.attention === "any" ? !attention(b) : attention(b) !== more.attention)) return false;
      if (more.nights && !(isStay(b) && NIGHT_BUCKETS.find((n) => n.value === more.nights)!.test(nightsOf(b)))) return false;
      if (more.returning && ((guestCounts.get(guestKey(b)) ?? 0) > 1 ? "returning" : "first") !== more.returning) return false;
      if (more.promo && (b.promo_code_id ? "yes" : "no") !== more.promo) return false;
      if (more.addons && ((b.addons_cents ?? 0) > 0 ? "yes" : "no") !== more.addons) return false;
      if (more.gift && ((b.gift_applied_cents ?? 0) > 0 ? "yes" : "no") !== more.gift) return false;
      return true;
    });
  }, [rows, bookingId, keywords, more, roomNames, guestCounts]);
  useEffect(() => setPage(0), [bookingId, keywords, dateField, from, to, more]);

  const confirmed = filtered.filter(sold);
  const nightsSold = confirmed.filter(isStay).reduce((a, b) => a + nightsOf(b), 0);
  const income = confirmed.filter((b) => b.currency !== "USD").reduce((a, b) => a + (b.base_cents ?? b.amount_cents), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageNow = Math.min(page, pages - 1);
  const shown = filtered.slice(pageNow * PAGE, (pageNow + 1) * PAGE);

  // ── "More": only filters with something to choose between (or already set) ──
  const moreFilters = useMemo(() => {
    const r = rows ?? [];
    const distinct = <T,>(xs: T[]) => new Set(xs).size;
    const opt = (key: keyof More, all: string, options: { value: string; label: string }[], applicable: boolean) => ({ key, all, options, show: applicable || !!more[key] });
    const attentionPresent = (Object.keys(ATTENTION_LABEL) as (keyof typeof ATTENTION_LABEL)[]).filter((k) => r.some((b) => attention(b) === k));
    const payPresent = (Object.keys(PAY_LABEL) as (keyof typeof PAY_LABEL)[]).filter((k) => r.some((b) => payStatus(b) === k));
    const cities = Array.from(new Set(mine.map((l) => l.city).filter(Boolean))).sort();
    const types = Array.from(new Set(mine.map((l) => l.type)));
    return [
      opt("property", "All properties", [...mine].sort((a, b) => a.title.localeCompare(b.title)).map((l) => ({ value: l.id, label: l.title })), mine.length > 1),
      opt("city", "All cities", cities.map((c) => ({ value: c, label: c })), cities.length > 1),
      opt("type", "All listing types", types.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? t })), types.length > 1),
      opt("status", "All statuses", ALL_STATUSES.filter((s) => r.some((b) => b.status === s)).map((s) => ({ value: s, label: STATUS[s]!.label })), distinct(r.map((b) => b.status)) > 1),
      opt("channel", "All channels", [{ value: "revamp", label: "Revamp (online)" }, { value: "direct", label: "Direct (recorded by you)" }], distinct(r.map((b) => b.provider === "direct")) > 1),
      opt("pay", "All pay statuses", payPresent.map((k) => ({ value: k, label: PAY_LABEL[k] })), payPresent.length > 1),
      opt("attention", "Needs attention: all", attentionPresent.length ? [{ value: "any", label: "Needs attention" }, ...attentionPresent.map((k) => ({ value: k, label: ATTENTION_LABEL[k] }))] : [], attentionPresent.length > 0),
      opt("nights", "All nights", NIGHT_BUCKETS.filter((n) => r.some((b) => isStay(b) && n.test(nightsOf(b)))).map((n) => ({ value: n.value, label: n.label })), r.some(isStay)),
      opt("returning", "All guests", [{ value: "returning", label: "Returning guests" }, { value: "first", label: "First-time guests" }], r.some((b) => (guestCounts.get(guestKey(b)) ?? 0) > 1)),
      opt("promo", "Promo code: any", [{ value: "yes", label: "With a promo code" }, { value: "no", label: "Without a promo code" }], r.some((b) => b.promo_code_id)),
      opt("addons", "Add-ons: any", [{ value: "yes", label: "With add-ons" }, { value: "no", label: "Without add-ons" }], r.some((b) => (b.addons_cents ?? 0) > 0)),
      opt("gift", "Gift card: any", [{ value: "yes", label: "Paid with a gift card" }, { value: "no", label: "No gift card" }], r.some((b) => (b.gift_applied_cents ?? 0) > 0)),
    ].filter((f) => f.show);
  }, [rows, mine, more, guestCounts]);
  const activeMore = (Object.keys(more) as (keyof More)[]).filter((k) => more[k]).length;

  // ── Actions (unchanged from the old list) ────────────────────────────────────
  const patch = (id: string, status: BookingStatus) => setRows((prev) => (prev ? prev.map((x) => (x.id === id ? { ...x, status } : x)) : prev));
  const decide = async (b: Booking, approve: boolean) => {
    setBusy(b.id);
    try {
      if (approve) {
        await approveBooking(b.id);
        patch(b.id, "awaiting_payment");
        toast.success("Approved — the guest has been emailed a link to pay.");
      } else {
        await declineBooking(b.id);
        patch(b.id, "cancelled");
        toast("Request declined — the seats are freed and the guest notified.");
      }
    } catch (err) {
      toast(userMessage(err, "Couldn't update that request."));
    } finally {
      setBusy(null);
    }
  };
  const cancel = async (b: Booking) => {
    if (!window.confirm(`Cancel this booking for ${b.listings?.title ?? "your listing"}? The guest is notified and the dates reopen.`)) return;
    setBusy(b.id);
    try {
      const { refundCents } = await cancelBooking(b.id);
      patch(b.id, "cancelled");
      toast(refundCents > 0 ? `Cancelled — refund ${fmtMoney(refundCents, b.currency)} to the guest in PayLink.` : "Booking cancelled — no refund applies.");
    } catch (err) {
      toast(userMessage(err, "Couldn't cancel that booking."));
    } finally {
      setBusy(null);
    }
  };
  const canCancel = (b: Booking) => (b.status === "pending_payment" || b.status === "confirmed") && b.start_date >= todayIso();
  const actions = (b: Booking) =>
    b.status === "requested" ? (
      <span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button type="button" disabled={busy === b.id} onClick={() => void decide(b, false)} className="text-xs font-semibold text-basalt/60 hover:text-destructive hover:underline disabled:opacity-50">Decline</button>
        <button type="button" disabled={busy === b.id} onClick={() => void decide(b, true)} className="rounded-none bg-apricot px-3 py-1.5 text-xs font-bold text-white hover:bg-apricot/90 disabled:opacity-50">{busy === b.id ? "…" : "Approve"}</button>
      </span>
    ) : canCancel(b) ? (
      <button type="button" disabled={busy === b.id} onClick={(e) => { e.stopPropagation(); void cancel(b); }} className="text-xs font-semibold text-basalt/60 hover:text-destructive hover:underline disabled:opacity-50">
        {busy === b.id ? "Cancelling…" : "Cancel"}
      </button>
    ) : null;

  const field = "h-11 rounded-full border border-basalt/15 bg-paper px-4 text-sm outline-none hover:border-basalt/40 focus:border-basalt";
  const dates = (b: Booking) => ({ in: fmtDate(b.start_date) + (b.starts_at ? ` · ${formatSlotTime(b.starts_at)}` : ""), out: isStay(b) ? fmtDate(b.end_date) : "—" });

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Booking ID" value={bookingId} onChange={(e) => setBookingId(e.target.value)} placeholder="Booking ID" className={cn(field, "w-36")} />
        <input aria-label="Keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Guest, email, phone, listing…" className={cn(field, "w-full sm:w-64")} />
        <div className="relative inline-flex items-center">
          <select aria-label="Filter by date" value={dateField} onChange={(e) => setDateField(e.target.value as DateField)} className={cn(field, "appearance-none pr-9 font-semibold")}>
            {DATE_FIELDS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-basalt/70" />
        </div>
        <div className="inline-flex h-11 items-center gap-1 rounded-full border border-basalt/15 bg-paper pl-3 pr-1 text-sm">
          <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent tabular-nums outline-none" />
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-basalt/40" />
          <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="bg-transparent tabular-nums outline-none" />
          {(from || to) && (
            <button type="button" onClick={() => { setFrom(""); setTo(""); }} aria-label="Any dates" title="Any dates" className="grid h-8 w-8 place-items-center rounded-full text-basalt/50 hover:bg-chalk hover:text-basalt">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={cn(field, "inline-flex items-center gap-2 font-semibold", activeMore > 0 && "border-basalt")}>
              <SlidersHorizontal className="h-4 w-4" /> More
              {activeMore > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-basalt px-1 text-[11px] text-paper">{activeMore}</span>}
              <ChevronDown className="h-4 w-4 text-basalt/70" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[70dvh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-3">
            {moreFilters.length === 0 ? (
              <p className="p-2 text-sm text-basalt/60">No more filters apply to the bookings in view.</p>
            ) : (
              <div className="grid gap-2">
                {moreFilters.map((f) => (
                  <div key={f.key} className="relative">
                    <select
                      aria-label={f.all}
                      value={more[f.key]}
                      onChange={(e) => setMore((m) => ({ ...m, [f.key]: e.target.value }))}
                      className={cn("h-11 w-full appearance-none rounded-[0.875rem] border bg-paper pl-3 pr-9 text-sm outline-none focus:border-basalt", more[f.key] ? "border-basalt font-semibold" : "border-basalt/15")}
                    >
                      <option value="">{f.all}</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-basalt/70" />
                  </div>
                ))}
                {activeMore > 0 && (
                  <button type="button" onClick={() => setMore(NO_MORE)} className="mt-1 justify-self-start text-sm font-semibold text-basalt/70 underline-offset-4 hover:text-apricot hover:underline">
                    Clear these filters
                  </button>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Tiles */}
      <div className="mt-5 grid grid-cols-2 border border-basalt/10 bg-paper lg:grid-cols-4">
        {[
          { label: "Search results", value: rows ? filtered.length.toLocaleString() : "—" },
          {
            label: "Occupancy",
            value: occupancy ? `${occupancy.pct}%` : "—",
            hint: occupancy ? `${occupancy.nights} of ${occupancy.capacity} stay nights, Revamp bookings` : from && to ? "Stays only" : "Pick a date range",
          },
          { label: "Nights sold", value: nightsSold.toLocaleString(), hint: "Confirmed stays in the results" },
          { label: "Income", value: fmtMoney(income, "AMD"), hint: "Confirmed, before commission" },
        ].map((t, i) => (
          <div key={t.label} className={cn("p-5", i % 2 === 1 && "border-l border-basalt/10", i >= 2 && "border-t border-basalt/10 lg:border-t-0", i === 2 && "lg:border-l")}>
            <p className="text-sm text-basalt/70">{t.label}</p>
            <p className="mt-1 font-display text-3xl tabular-nums tracking-[-0.02em] sm:text-4xl">{t.value}</p>
            {t.hint && <p className="mt-1 text-[11px] text-basalt/55">{t.hint}</p>}
          </div>
        ))}
      </div>

      {/* Results */}
      <div className="mt-5 border border-basalt/10 bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-basalt/10 px-4 py-3 text-sm">
          <p className="text-basalt/70">
            {rows === null ? "Loading…" : filtered.length === 0 ? "No results." : `Showing ${pageNow * PAGE + 1}–${Math.min(filtered.length, (pageNow + 1) * PAGE)} of ${filtered.length}${rows.length >= 1000 ? " (first 1,000 — narrow the dates)" : ""}`}
          </p>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(pageNow - 1)} disabled={pageNow === 0} aria-label="Previous page" className="grid h-9 w-9 place-items-center rounded-full border border-basalt/15 hover:border-basalt/40 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
              <span className="tabular-nums text-basalt/70">Page {pageNow + 1} of {pages}</span>
              <button type="button" onClick={() => setPage(pageNow + 1)} disabled={pageNow >= pages - 1} aria-label="Next page" className="grid h-9 w-9 place-items-center rounded-full border border-basalt/15 hover:border-basalt/40 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
        </div>

        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-6">
            <p className="text-sm text-basalt/80">We couldn't load your bookings. Check your connection and try again.</p>
            <button type="button" onClick={() => setReload((k) => k + 1)} className="rounded-none bg-basalt px-4 py-2 text-sm font-semibold text-paper hover:bg-basalt/90">Retry</button>
          </div>
        ) : rows === null ? (
          <div aria-busy="true" className="grid gap-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse bg-chalk" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CalendarCheck className="mx-auto h-7 w-7 text-basalt/30" />
            <p className="mt-3 text-sm text-basalt/70">No bookings match these filters.</p>
            {(from || to || activeMore > 0 || bookingId || keywords) && (
              <button
                type="button"
                onClick={() => { setFrom(""); setTo(""); setMore(NO_MORE); setBookingId(""); setKeywords(""); }}
                className="mt-3 text-sm font-semibold text-basalt underline-offset-4 hover:text-apricot hover:underline"
              >
                Show all bookings
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-chalk text-xs font-semibold text-basalt/70">
                  <tr>
                    {["Booking ID", "Guest", "Status", "Check in", "Check out", "Nights", "Listing", "Amount"].map((h) => (
                      <th key={h} scope="col" className={cn("whitespace-nowrap px-3 py-3", h === "Amount" && "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((b) => {
                    const s = STATUS[b.status] ?? STATUS.pending_payment!;
                    const att = attention(b);
                    const d = dates(b);
                    return (
                      <tr key={b.id} onClick={() => setOpenId(b.id)} className="cursor-pointer border-t border-basalt/8 hover:bg-chalk/70">
                        <td className="whitespace-nowrap px-3 py-3">
                          <button type="button" onClick={(e) => { e.stopPropagation(); setOpenId(b.id); }} className="font-mono text-xs font-semibold text-basalt hover:text-apricot">#{shortId(b.id)}</button>
                          <span className="block text-[11px] text-basalt/55">Booked {fmtDate(b.created_at)}{b.provider === "direct" ? " · Direct" : ""}</span>
                        </td>
                        <td className="max-w-[11rem] px-3 py-3">
                          <span className="block truncate font-semibold">{guestOf(b)}</span>
                          <span className="block text-[11px] text-basalt/55">{b.guests} guest{b.guests === 1 ? "" : "s"}{(guestCounts.get(guestKey(b)) ?? 0) > 1 ? " · returning" : ""}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold", s.className)}>{s.label}</span>
                          {att && <span className="mt-1 block whitespace-nowrap text-[11px] font-semibold text-apricot">{ATTENTION_LABEL[att]}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 tabular-nums">{d.in}</td>
                        <td className="whitespace-nowrap px-3 py-3 tabular-nums">{d.out}</td>
                        <td className="px-3 py-3 tabular-nums">{isStay(b) ? nightsOf(b) : "—"}</td>
                        <td className="max-w-[14rem] px-3 py-3"><span className="block truncate" title={titleOf(b)}>{titleOf(b)}</span></td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <span className="block font-semibold tabular-nums">{fmtMoney(b.amount_cents, b.currency)}</span>
                          {actions(b) && <span className="mt-1 flex justify-end">{actions(b)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Phone / tablet cards */}
            <ul className="divide-y divide-basalt/8 xl:hidden">
              {shown.map((b) => {
                const s = STATUS[b.status] ?? STATUS.pending_payment!;
                const att = attention(b);
                const d = dates(b);
                return (
                  <li key={b.id}>
                    <div role="button" tabIndex={0} onClick={() => setOpenId(b.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(b.id); } }} className="grid cursor-pointer gap-1.5 px-4 py-3 hover:bg-chalk/70">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold", s.className)}>{s.label}</span>
                        {att && <span className="text-[11px] font-semibold text-apricot">{ATTENTION_LABEL[att]}</span>}
                        <span className="ml-auto font-mono text-xs text-basalt/60">#{shortId(b.id)}{b.provider === "direct" ? " · Direct" : ""}</span>
                      </div>
                      <p className="font-semibold">{guestOf(b)} <span className="font-normal text-basalt/60">· {b.guests} guest{b.guests === 1 ? "" : "s"}</span></p>
                      <p className="truncate text-sm text-basalt/70">{titleOf(b)}</p>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="tabular-nums text-basalt/70">{d.in}{isStay(b) ? ` → ${d.out} · ${nightsOf(b)} night${nightsOf(b) === 1 ? "" : "s"}` : ""}</span>
                        <span className="font-semibold tabular-nums">{fmtMoney(b.amount_cents, b.currency)}</span>
                      </div>
                      {actions(b) && <div className="flex justify-end">{actions(b)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <BookingDetailDialog bookingId={openId} onClose={() => setOpenId(null)} onChanged={() => setReload((k) => k + 1)} />
    </div>
  );
}
