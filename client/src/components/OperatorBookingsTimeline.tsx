/**
 * Operator bookings timeline — the operator's listings as rows, nights as
 * columns, bookings as bars. Hotels (0092) expand into room-type rows (type
 * price, rooms free) and one row per room. Prices/blocks are edited in the
 * Calendar tab; here an operator reads the house and records direct bookings.
 *
 * Reading order (critique 2026-10-13): the operator's own bookings are the
 * loudest marks — near-full-height bars with a status glyph (confirmed =
 * charcoal, awaiting payment = white with an apricot outline, completed =
 * light). Nights sold elsewhere (iCal) are a quiet palette hatch; blocks a flat
 * grey. Orange means only "needs attention" (unpaid, unassigned, sync stale).
 * Stay bars run from mid check-in day to mid check-out day, so a same-day
 * turnover reads as two bars meeting; the window opens 2 days back so in-house
 * guests show; bars cut by the window edge get a "continues" mark.
 *
 * It's an ARIA grid: one cell is tabbable at a time; arrows move by night
 * (Ctrl/⌘ + ←/→ by a week), Home/End jump to the ends, Enter records a direct
 * booking on a free night or opens the booking on a booked one. Every cell is
 * described ("Room 14, Wed 14 Oct, free, ֏30k"). The date header stays pinned
 * inside the scroll box. Loading shows a skeleton; a failed load says so with
 * Retry instead of an empty grid. Rows with a connected calendar show when they
 * last synced (orange once stale) — a stalled sync must never look like "free".
 *
 * Data: bookings on this operator's listings inside the window (RLS +
 * listings!inner on operator_id), each listing's iCal blocked_ranges and
 * manual blocks, hotels' room types/rooms (+ each room's calendar status).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Ban, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { BookingStatus } from "@shared/bookings";
import { BookingDetailDialog } from "@/components/BookingDetailDialog";
import { DirectBookingDialog, type DirectBookingRoom } from "@/components/DirectBookingDialog";
import { fetchRoomCalendars, fetchRoomTypes, type RoomCalendar } from "@/lib/roomTypes";
import type { RoomType, SeasonalRate } from "@shared/listings";
import { roomUnitLabel, unitBaseCents, unitNightCents, unitPricing } from "@shared/rooms";
import type { LiveListing } from "@/contexts/ListingsContext";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const CELL_W = 48; // px per night
const DAYS_BACK = 2; // open a couple of nights back, so in-house guests are visible
const DAYS = 184; // rolling window (~6 months)
const STALE_HOURS = 6; // a connected calendar older than this is flagged
const COLLAPSE_KEY = "revamp.timelineCollapsed";

type Range = { start: string; end: string };

function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
/** Whole days from a→b (b−a). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS);
}
const fmtDay = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtShort = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const covers = (r: Range, night: string) => r.start <= night && night < r.end;

interface Row {
  id: string;
  start_date: string;
  end_date: string;
  status: BookingStatus;
  guests: number;
  listing_id: string;
  /** Hotels: the room the booking is in (0092). */
  room_unit_id: string | null;
  guest_name: string | null;
  profiles: { display_name: string } | null;
}

const STATUS: Partial<Record<BookingStatus, { label: string; bar: string; Icon: typeof Check }>> = {
  confirmed: { label: "Confirmed", bar: "bg-basalt text-paper", Icon: Check },
  pending_payment: { label: "Awaiting payment", bar: "bg-paper text-basalt ring-2 ring-inset ring-apricot", Icon: Clock },
  awaiting_payment: { label: "Awaiting payment", bar: "bg-paper text-basalt ring-2 ring-inset ring-apricot", Icon: Clock },
  completed: { label: "Completed", bar: "bg-chalk text-basalt/80 ring-1 ring-inset ring-basalt/15", Icon: CheckCheck },
};
const statusOf = (s: BookingStatus) => STATUS[s] ?? STATUS.confirmed!;
const guestName = (b: Row) => b.profiles?.display_name || b.guest_name || "Guest";

/** Compact per-night price for the cells (e.g. ֏45k, $116). */
function useCompactPrice() {
  const { currency, rate } = useCurrency();
  return (amdCents: number): string => {
    if (currency === "USD" && rate > 0) {
      const usd = Math.round(amdCents / 100 / rate);
      return usd >= 10000 ? `$${Math.round(usd / 1000)}k` : `$${usd.toLocaleString()}`;
    }
    const drams = Math.round(amdCents / 100);
    return drams >= 1000 ? `֏${Math.round(drams / 1000)}k` : `֏${drams}`;
  };
}

/** "Synced 2h ago" for a row with a connected calendar; stale/broken ones need attention. */
function syncNote(hasFeeds: boolean, syncedAt: string | null | undefined, error: string | null | undefined, now: number): { text: string; stale: boolean } | null {
  if (!hasFeeds) return null;
  if (error) return { text: "Calendar sync issue", stale: true };
  if (!syncedAt) return { text: "Calendar not synced yet", stale: true };
  const h = (now - Date.parse(syncedAt)) / 3_600_000;
  const ago = h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  return { text: `Synced ${ago} ago`, stale: h > STALE_HOURS };
}

/** Narrow screens give the dates more room. */
function useNameWidth(): number {
  const [w, setW] = useState(208);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const f = () => setW(mq.matches ? 128 : 208);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return w;
}

export function OperatorBookingsTimeline() {
  const { user } = useAuth();
  const { listings } = useListings();
  const compact = useCompactPrice();
  const nameW = useNameWidth();
  const narrow = nameW < 200;
  const today = todayIso();
  const startDate = useMemo(() => addDaysIso(todayIso(), -DAYS_BACK), []);
  const windowEnd = addDaysIso(startDate, DAYS);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDaysIso(startDate, i)), [startDate]);
  const todayCol = dayDiff(startDate, today);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [direct, setDirect] = useState<{ listing: LiveListing; date: string; room?: DirectBookingRoom } | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "stay" | "tour" | "experience">("all");
  const [roomsByHotel, setRoomsByHotel] = useState<Map<string, RoomType[]>>(new Map());
  const [roomCals, setRoomCals] = useState<Map<string, RoomCalendar>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleKey = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* private mode — not remembered */
      }
      return next;
    });

  const allMine = useMemo(() => listings.filter((l) => l.operatorId === user?.id).sort((a, b) => a.title.localeCompare(b.title)), [listings, user?.id]);
  const mine = useMemo(() => (typeFilter === "all" ? allMine : allMine.filter((l) => l.type === typeFilter)), [allMine, typeFilter]);
  const availableTypes = useMemo(() => {
    const present = new Set(allMine.map((l) => l.type));
    return (["all", "stay", "tour", "experience"] as const).filter((t) => t === "all" || present.has(t));
  }, [allMine]);

  // Bookings inside the window only.
  useEffect(() => {
    if (!user) return;
    let live = true;
    setLoadError(false);
    supabase
      .from("bookings")
      .select("id, start_date, end_date, status, guests, listing_id, room_unit_id, guest_name, listings!inner(operator_id), profiles!traveler_id(display_name)")
      .eq("listings.operator_id", user.id)
      .in("status", ["pending_payment", "awaiting_payment", "confirmed", "completed"])
      .gt("end_date", startDate)
      .lt("start_date", windowEnd)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          console.error("[timeline] bookings load failed", error.message);
          setLoadError(true);
          setRows([]);
          return;
        }
        setRows((data ?? []) as unknown as Row[]);
      });
    return () => {
      live = false;
    };
  }, [user, reload, startDate, windowEnd]);

  // Hotels: room types + rooms, and each room's calendar sync status.
  const hotelIds = useMemo(() => allMine.filter((l) => l.type === "stay" && l.multiRoom).map((l) => l.id).join(","), [allMine]);
  useEffect(() => {
    const ids = hotelIds ? hotelIds.split(",") : [];
    if (!ids.length) return;
    let live = true;
    Promise.all(ids.map(async (id) => [id, await fetchRoomTypes(id)] as const)).then(async (pairs) => {
      if (!live) return;
      setRoomsByHotel(new Map(pairs));
      const unitIds = pairs.flatMap(([, types]) => types.flatMap((t) => t.units.map((u) => u.id)));
      const cals = await fetchRoomCalendars(unitIds);
      if (live) setRoomCals(cals);
    });
    return () => {
      live = false;
    };
  }, [hotelIds, reload]);
  const roomsOf = useCallback(
    (listingId: string) => (roomsByHotel.get(listingId) ?? []).flatMap((type) => type.units.filter((u) => u.active).map((unit) => ({ type, unit }))),
    [roomsByHotel],
  );

  const byListing = useMemo(() => {
    const map = new Map<string, Row[]>();
    (rows ?? []).forEach((r) => {
      const arr = map.get(r.listing_id) ?? [];
      arr.push(r);
      map.set(r.listing_id, arr);
    });
    return map;
  }, [rows]);

  // Units free per night: a listing is one unit, a hotel counts each room.
  const hotelFreeByDay = useMemo(() => {
    const out = new Map<string, number[]>();
    mine.forEach((listing) => {
      const rooms = roomsOf(listing.id);
      if (!rooms.length) return;
      const bks = byListing.get(listing.id) ?? [];
      out.set(
        listing.id,
        days.map((d) => rooms.filter(({ unit }) => !(bks.some((b) => b.room_unit_id === unit.id && covers({ start: b.start_date, end: b.end_date }, d)) || (unit.blockedRanges ?? []).some((r) => covers(r, d)) || unit.manualBlockedRanges.some((r) => covers(r, d)))).length),
      );
    });
    return out;
  }, [days, mine, byListing, roomsOf]);
  const totalUnits = mine.reduce((a, l) => a + (hotelFreeByDay.has(l.id) ? roomsOf(l.id).length : 1), 0);
  const availByDay = useMemo(() => {
    const counts = days.map(() => 0);
    mine.forEach((listing) => {
      const hotel = hotelFreeByDay.get(listing.id);
      if (hotel) return hotel.forEach((n, i) => (counts[i] += n));
      const bks = byListing.get(listing.id) ?? [];
      days.forEach((d, i) => {
        const taken = bks.some((b) => covers({ start: b.start_date, end: b.end_date }, d)) || (listing.blockedRanges ?? []).some((r) => covers(r, d)) || (listing.manualBlockedRanges ?? []).some((r) => covers(r, d));
        if (!taken) counts[i] += 1;
      });
    });
    return counts;
  }, [days, mine, byListing, hotelFreeByDay]);

  // ── Scrolling: Today, month menu that follows the view ───────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const months = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; offset: number }>();
    days.forEach((d, i) => {
      const key = d.slice(0, 7);
      if (!seen.has(key)) seen.set(key, { key, label: new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }), offset: i });
    });
    return Array.from(seen.values());
  }, [days]);
  const [viewMonth, setViewMonth] = useState(today.slice(0, 7));
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const col = Math.min(DAYS - 1, Math.max(0, Math.floor(el.scrollLeft / CELL_W) + 1));
    const m = days[col].slice(0, 7);
    if (m !== viewMonth) setViewMonth(m);
  };
  const jumpTo = (col: number) => scrollRef.current?.scrollTo({ left: Math.max(0, col * CELL_W), behavior: "smooth" });

  // ── Keyboard grid: roving focus across cells ─────────────────────────────────
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 1, c: todayCol });
  const focusCell = (r: number, c: number) => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (!root || !el) return false;
    setActive({ r, c });
    el.focus({ preventScroll: true });
    // Keep the cell clear of the pinned name column and header.
    const cr = root.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.left < cr.left + nameW) root.scrollLeft -= cr.left + nameW - er.left + 4;
    else if (er.right > cr.right) root.scrollLeft += er.right - cr.right + 4;
    if (er.top < cr.top + 76) root.scrollTop -= cr.top + 76 - er.top;
    else if (er.bottom > cr.bottom) root.scrollTop += er.bottom - cr.bottom;
    return true;
  };
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const r = Number(t.dataset.r);
    const c = Number(t.dataset.c);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    const big = e.ctrlKey || e.metaKey ? 7 : 1;
    let next: [number, number] | null = null;
    if (e.key === "ArrowRight") next = [r, Math.min(DAYS - 1, c + big)];
    else if (e.key === "ArrowLeft") next = [r, Math.max(0, c - big)];
    else if (e.key === "ArrowDown") next = [r + 1, c];
    else if (e.key === "ArrowUp") next = [Math.max(1, r - 1), c];
    else if (e.key === "Home") next = [r, 0];
    else if (e.key === "End") next = [r, DAYS - 1];
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      t.click();
      return;
    }
    if (next) {
      e.preventDefault();
      focusCell(next[0], next[1]);
    }
  };

  // ── Geometry ────────────────────────────────────────────────────────────────
  /** A [start,end) span of nights as a bar box. Stays sit mid-day to mid-day (afternoon
   *  check-in, morning check-out); tours fill their day. Clipped edges are flagged. */
  const nightBox = (s: string, e: string, halfDay: boolean) => {
    const off = halfDay ? CELL_W / 2 : 0;
    const rawL = dayDiff(startDate, s) * CELL_W + off;
    const rawR = dayDiff(startDate, e) * CELL_W + off;
    const left = Math.max(0, rawL);
    const right = Math.min(DAYS * CELL_W, rawR);
    // A sliver at the window edge (e.g. a check-out on its first morning) is noise.
    if (right - left < (halfDay ? CELL_W / 2 + 4 : 4)) return null;
    return { left, width: right - left, clipL: rawL < 0, clipR: rawR > DAYS * CELL_W };
  };

  // Row index counter for the keyboard grid (header is row 0).
  let rowIdx = 0;

  /** One row of nights: cells (focusable, described), synced/blocked spans, booking bars. */
  const track = (t: {
    label: string;
    height: number;
    halfDay: boolean;
    bookings: Row[];
    synced: Range[];
    manual: Range[];
    base: number;
    rates: SeasonalRate[];
    onDay?: (d: string) => void;
  }) => {
    const r = ++rowIdx;
    const barH = t.height - 20; // the bottom band holds the price on free nights
    const priceOn = (d: string) => {
      const m = t.rates.filter((x) => x.start <= d && d <= x.end).pop();
      return { cents: m ? m.priceCents : t.base, special: Boolean(m) };
    };
    const bookingOn = (d: string) => t.bookings.find((b) => covers({ start: b.start_date, end: b.end_date }, d));
    return (
      <div role="presentation" className="relative shrink-0" style={{ width: DAYS * CELL_W, height: t.height }}>
        {days.map((d, i) => {
          const bk = bookingOn(d);
          const syncedNight = t.synced.some((x) => covers(x, d));
          const blockedNight = t.manual.some((x) => covers(x, d));
          const free = !bk && !syncedNight && !blockedNight;
          const past = d < today;
          const p = free && !past && t.base > 0 ? priceOn(d) : null;
          const canBook = free && !past && !!t.onDay;
          const desc = bk
            ? `booked by ${guestName(bk)}, ${statusOf(bk.status).label.toLowerCase()}, ${fmtShort(bk.start_date)} to ${fmtShort(bk.end_date)}`
            : syncedNight
              ? "booked on another channel"
              : blockedNight
                ? "blocked"
                : past
                  ? "free (past)"
                  : `free${p ? `, ${compact(p.cents)}${p.special ? " special price" : ""}` : ""}`;
          const dt = new Date(d + "T00:00:00Z");
          return (
            <div
              key={d}
              role="gridcell"
              data-r={r}
              data-c={i}
              tabIndex={active.r === r && active.c === i ? 0 : -1}
              aria-label={`${t.label}, ${fmtDay(d)}, ${desc}${canBook ? ". Press Enter to record a direct booking" : bk ? ". Press Enter to open the booking" : ""}`}
              onFocus={() => setActive({ r, c: i })}
              onClick={bk ? () => setOpenId(bk.id) : canBook ? () => t.onDay!(d) : undefined}
              title={canBook ? `${fmtDay(d)} · record a direct booking` : undefined}
              className={cn(
                "group/cell absolute top-0 h-full border-r border-basalt/[0.07] outline-none focus-visible:z-[5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-basalt",
                dt.getUTCDate() === 1 && i !== 0 && "border-l-2 border-l-basalt/20",
                [0, 6].includes(dt.getUTCDay()) && "bg-chalk/70",
                d === today && "bg-basalt/[0.05]",
                canBook && "cursor-pointer hover:bg-apricot/[0.06]",
              )}
              style={{ left: i * CELL_W, width: CELL_W }}
            >
              {canBook && (
                <span aria-hidden className="pointer-events-none absolute left-1/2 top-2 hidden -translate-x-1/2 text-base font-semibold leading-none text-basalt/70 group-hover/cell:block group-focus-visible/cell:block">+</span>
              )}
              {p && (
                <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-1 flex items-center justify-center gap-0.5 text-[11px] tabular-nums leading-none", p.special ? "font-bold text-basalt" : "font-medium text-basalt/70")}>
                  {p.special && <span className="h-1 w-1 rounded-full bg-basalt" />}
                  {compact(p.cents)}
                </span>
              )}
            </div>
          );
        })}
        {t.synced.map((x, k) => {
          const b = nightBox(x.start, x.end, t.halfDay);
          if (!b) return null;
          return (
            <div key={`s${k}`} aria-hidden title={`Booked on another channel · ${fmtShort(x.start)} → ${fmtShort(x.end)}`} className={cn("tl-synced pointer-events-none absolute top-1.5 flex items-center overflow-hidden rounded-md ring-1 ring-inset ring-basalt/12", b.clipL && "rounded-l-none", b.clipR && "rounded-r-none")} style={{ left: b.left + 1, width: Math.max(0, b.width - 2), height: barH }}>
              {b.width >= CELL_W * 2 && <span className="truncate px-2 text-[11px] font-medium text-basalt/70">Other channel</span>}
            </div>
          );
        })}
        {t.manual.map((x, k) => {
          const b = nightBox(x.start, x.end, t.halfDay);
          if (!b) return null;
          return (
            <div key={`m${k}`} aria-hidden title={`Blocked by you · ${fmtShort(x.start)} → ${fmtShort(x.end)}`} className={cn("pointer-events-none absolute top-1.5 flex items-center gap-1 overflow-hidden rounded-md bg-basalt/[0.11] px-2 text-[11px] font-medium text-basalt/70", b.clipL && "rounded-l-none", b.clipR && "rounded-r-none")} style={{ left: b.left + 1, width: Math.max(0, b.width - 2), height: barH }}>
              <Ban className="h-3 w-3 shrink-0" />
              {b.width >= CELL_W * 2 && <span className="truncate">Blocked</span>}
            </div>
          );
        })}
        {t.bookings.map((bk) => {
          const b = nightBox(bk.start_date, bk.end_date, t.halfDay);
          if (!b) return null;
          const s = statusOf(bk.status);
          return (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              key={bk.id}
              onClick={() => setOpenId(bk.id)}
              title={`${guestName(bk)} · ${s.label} · ${fmtDay(bk.start_date)} → ${fmtDay(bk.end_date)} · ${bk.guests} guest${bk.guests === 1 ? "" : "s"}`}
              className={cn("absolute top-1.5 z-[2] flex items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-[12px] font-semibold shadow-[0_1px_2px_rgba(33,33,33,0.18)] transition-[filter] hover:brightness-95", s.bar, b.clipL && "rounded-l-none", b.clipR && "rounded-r-none")}
              style={{ left: b.left + 1, width: Math.max(0, b.width - 2), height: barH }}
            >
              {b.clipL && <ChevronLeft className="-ml-1.5 h-3.5 w-3.5 shrink-0 opacity-70" />}
              <s.Icon className={cn("h-3.5 w-3.5 shrink-0", s.label === "Awaiting payment" && "text-apricot")} />
              <span className="truncate">{guestName(bk)}</span>
              {b.clipR && <ChevronRight className="ml-auto -mr-1.5 h-3.5 w-3.5 shrink-0 opacity-70" />}
            </button>
          );
        })}
      </div>
    );
  };

  /** A summary track (hotel / room type): a short line per night, described for screen readers. */
  const summaryTrack = (t: { label: string; height: number; cell: (d: string, i: number) => { main: React.ReactNode; sub: React.ReactNode; aria: string } }) => {
    const r = ++rowIdx;
    return (
      <div role="presentation" className="relative shrink-0" style={{ width: DAYS * CELL_W, height: t.height }}>
        {days.map((d, i) => {
          const c = t.cell(d, i);
          const dt = new Date(d + "T00:00:00Z");
          return (
            <div
              key={d}
              role="gridcell"
              data-r={r}
              data-c={i}
              tabIndex={active.r === r && active.c === i ? 0 : -1}
              aria-label={`${t.label}, ${fmtDay(d)}, ${c.aria}`}
              onFocus={() => setActive({ r, c: i })}
              className={cn(
                "absolute top-0 flex h-full flex-col items-center justify-center gap-0.5 border-r border-basalt/[0.07] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-basalt",
                dt.getUTCDate() === 1 && i !== 0 && "border-l-2 border-l-basalt/20",
                d === today && "bg-basalt/[0.05]",
              )}
              style={{ left: i * CELL_W, width: CELL_W }}
            >
              {c.main}
              {c.sub}
            </div>
          );
        })}
      </div>
    );
  };

  if (rows === null) {
    return (
      <div aria-busy="true" aria-label="Loading your bookings" className="grid gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-[14px] bg-chalk" />
        ))}
      </div>
    );
  }
  if (loadError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-basalt/12 bg-chalk px-5 py-4">
        <p className="text-sm text-basalt/80">We couldn't load your bookings. Check your connection and try again.</p>
        <button type="button" onClick={() => setReload((k) => k + 1)} className="rounded-full bg-basalt px-4 py-2 text-sm font-semibold text-paper hover:bg-basalt/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot">
          Retry
        </button>
      </div>
    );
  }
  if (allMine.length === 0) {
    return <p className="rounded-[14px] border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/70">Add a listing to see it on the timeline.</p>;
  }

  const trackW = DAYS * CELL_W;
  const now = Date.now();
  const nameCell = "sticky left-0 z-10 shrink-0 border-r border-basalt/12";

  return (
    <div>
      {/* Controls: Today, the month in view, the type filter. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => jumpTo(DAYS_BACK - 1)} className="h-10 rounded-full border border-basalt/15 bg-paper px-4 text-sm font-semibold hover:border-basalt/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot">
          Today
        </button>
        <div className="relative inline-flex items-center">
          <select
            aria-label="Month in view"
            value={viewMonth}
            onChange={(e) => {
              const m = months.find((x) => x.key === e.target.value);
              if (m) jumpTo(m.offset);
            }}
            className="h-10 min-w-[11rem] appearance-none rounded-full border border-basalt/15 bg-paper pl-4 pr-9 text-sm font-semibold hover:border-basalt/40 focus:border-basalt focus:outline-none"
          >
            {months.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-basalt/70" />
        </div>
        {availableTypes.length > 2 && (
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5 sm:ml-2">
            {availableTypes.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={typeFilter === t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "h-10 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot",
                  typeFilter === t ? "border-basalt bg-basalt text-paper" : "border-basalt/15 bg-paper text-basalt/70 hover:border-basalt/40 hover:text-basalt",
                )}
              >
                {t === "all" ? "All" : t === "stay" ? "Stays" : t === "tour" ? "Tours" : "Experiences"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-basalt/70" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5"><span className="grid h-4 w-6 place-items-center rounded bg-basalt text-paper"><Check className="h-3 w-3" /></span> Confirmed</li>
        <li className="inline-flex items-center gap-1.5"><span className="grid h-4 w-6 place-items-center rounded bg-paper ring-2 ring-inset ring-apricot"><Clock className="h-3 w-3 text-apricot" /></span> Awaiting payment</li>
        <li className="inline-flex items-center gap-1.5"><span className="grid h-4 w-6 place-items-center rounded bg-chalk ring-1 ring-inset ring-basalt/15"><CheckCheck className="h-3 w-3" /></span> Completed</li>
        <li className="inline-flex items-center gap-1.5"><span className="tl-synced h-4 w-6 rounded ring-1 ring-inset ring-basalt/12" /> Booked on another channel</li>
        <li className="inline-flex items-center gap-1.5"><span className="grid h-4 w-6 place-items-center rounded bg-basalt/[0.11]"><Ban className="h-3 w-3 text-basalt/70" /></span> Blocked by you</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-basalt" /><span className="font-bold text-basalt">֏</span> Special price</li>
        <li className="hidden text-basalt/70 lg:list-item lg:list-none">Click a free night to record a direct booking · arrow keys move between nights</li>
      </ul>

      {/* Grid */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onKeyDown={onGridKey}
        role="grid"
        aria-label={`Bookings, ${fmtDay(startDate)} to ${fmtDay(addDaysIso(windowEnd, -1))}`}
        aria-rowcount={-1}
        className="max-h-[min(78vh,calc(100dvh-210px))] overflow-auto overscroll-contain rounded-[14px] border border-basalt/12 bg-paper"
      >
        <div style={{ width: nameW + trackW }}>
          {/* Pinned date header */}
          <div role="row" className="sticky top-0 z-20 flex border-b border-basalt/12 bg-chalk">
            <div role="columnheader" className={cn(nameCell, "z-30 flex items-end justify-end bg-chalk px-3 pb-1.5")} style={{ width: nameW }}>
              <span className="text-[11px] font-semibold text-basalt/70">Free of {totalUnits}</span>
            </div>
            {days.map((d, i) => {
              const dt = new Date(d + "T00:00:00Z");
              const isToday = d === today;
              const monthStart = i === 0 || dt.getUTCDate() === 1;
              const n = availByDay[i];
              return (
                <div
                  key={d}
                  role="columnheader"
                  aria-label={`${fmtDay(d)}${isToday ? ", today" : ""}, ${n} of ${totalUnits} free`}
                  style={{ width: CELL_W }}
                  className={cn("relative flex shrink-0 flex-col items-center border-r border-basalt/[0.07] pb-1.5 pt-4", monthStart && i !== 0 && "border-l-2 border-l-basalt/20", [0, 6].includes(dt.getUTCDay()) && "bg-basalt/[0.025]")}
                >
                  {monthStart && (
                    <span aria-hidden className="absolute left-1 top-1 whitespace-nowrap text-[11px] font-bold uppercase leading-none tracking-wide text-basalt">
                      {dt.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}
                    </span>
                  )}
                  <span aria-hidden className="text-[11px] font-medium leading-tight text-basalt/70">{dt.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</span>
                  <span aria-hidden className={cn("mt-0.5 grid h-6 min-w-6 place-items-center rounded-full px-1 text-sm font-semibold tabular-nums leading-none", isToday ? "bg-basalt text-paper" : "text-basalt")}>{dt.getUTCDate()}</span>
                  <span aria-hidden className={cn("mt-0.5 text-[11px] tabular-nums leading-tight", n === 0 ? "font-bold text-basalt" : "font-medium text-basalt/70")}>{n === 0 ? "Full" : n}</span>
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {mine.map((listing) => {
            const bookings = byListing.get(listing.id) ?? [];
            const rooms = roomsOf(listing.id);
            const isStay = listing.type === "stay";
            const sync = syncNote(listing.icalFeeds.length > 0 || !!listing.icalUrl, listing.icalSyncedAt, listing.icalError, now);
            const label = (
              <>
                {listing.image && !narrow && <img src={listing.image} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-basalt">{listing.title}</span>
                  <span className={cn("block truncate text-[11px]", sync?.stale ? "font-semibold text-apricot" : "text-basalt/70")}>
                    {rooms.length ? `Hotel · ${rooms.length} rooms` : listing.type === "stay" ? "Stay" : listing.type === "tour" ? "Tour" : "Experience"}
                    {sync && !rooms.length ? ` · ${sync.text}` : ""}
                  </span>
                </span>
              </>
            );

            if (!rooms.length) {
              return (
                <div key={listing.id} role="row" className="flex border-b border-basalt/[0.08]">
                  <Link role="rowheader" href={`/listing/${listing.slug}`} className={cn(nameCell, "flex items-center gap-2.5 bg-paper px-3 hover:bg-chalk focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-apricot")} style={{ width: nameW }}>
                    {label}
                  </Link>
                  {track({
                    label: listing.title,
                    height: 58,
                    halfDay: isStay,
                    bookings,
                    synced: listing.blockedRanges ?? [],
                    manual: listing.manualBlockedRanges ?? [],
                    base: Math.round(listing.price * 100),
                    rates: listing.seasonalRates ?? [],
                    onDay: (d) => setDirect({ listing, date: d }),
                  })}
                </div>
              );
            }

            // Hotel: summary row (rooms free per night) → room-type rows → rooms.
            const isOpen = !collapsed.has(listing.id);
            const free = hotelFreeByDay.get(listing.id) ?? [];
            return (
              <div key={listing.id} className="border-b border-basalt/[0.08]">
                <div role="row" className="flex bg-chalk/50">
                  <button type="button" role="rowheader" onClick={() => toggleKey(listing.id)} aria-expanded={isOpen} className={cn(nameCell, "flex items-center gap-2 bg-paper px-3 text-left hover:bg-chalk focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-apricot")} style={{ width: nameW }}>
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-basalt/70" /> : <ChevronRight className="h-4 w-4 shrink-0 text-basalt/70" />}
                    {label}
                  </button>
                  {summaryTrack({
                    label: `${listing.title}, all rooms`,
                    height: 52,
                    cell: (_d, i) => {
                      const n = free[i] ?? 0;
                      return {
                        main: <span className={cn("text-sm font-semibold tabular-nums leading-none", n === 0 ? "text-basalt" : "text-basalt/80")}>{n === 0 ? "Full" : n}</span>,
                        sub: n > 0 ? <span className="text-[11px] leading-none text-basalt/70">free</span> : null,
                        aria: n === 0 ? "full" : `${n} of ${rooms.length} rooms free`,
                      };
                    },
                  })}
                </div>
                {isOpen &&
                  groupByType(rooms).map(({ type, units }) => {
                    const typeKey = `${listing.id}:${type.id}`;
                    const typeOpen = !collapsed.has(typeKey);
                    const typeRates = type.seasonalRates ?? [];
                    const typeFree = (d: string) =>
                      units.filter((u) => !bookings.some((b) => b.room_unit_id === u.id && covers({ start: b.start_date, end: b.end_date }, d)) && !(u.blockedRanges ?? []).some((x) => covers(x, d)) && !u.manualBlockedRanges.some((x) => covers(x, d))).length;
                    return (
                      <div key={type.id}>
                        <div role="row" className="flex border-t border-basalt/[0.08] bg-chalk/40">
                          <button
                            type="button"
                            role="rowheader"
                            onClick={() => toggleKey(typeKey)}
                            aria-expanded={typeOpen}
                            className={cn(nameCell, "flex items-center gap-2 bg-chalk pr-3 text-left hover:bg-chalk/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-apricot", narrow ? "pl-3" : "pl-6")}
                            style={{ width: nameW }}
                          >
                            {typeOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-basalt/70" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-basalt/70" />}
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-basalt">{type.name}</span>
                              <span className="block truncate text-[11px] text-basalt/70">{units.length} room{units.length === 1 ? "" : "s"}</span>
                            </span>
                          </button>
                          {summaryTrack({
                            label: type.name,
                            height: 46,
                            cell: (d) => {
                              const rate = typeRates.filter((x) => x.start <= d && d <= x.end).pop();
                              const n = typeFree(d);
                              const price = rate ? rate.priceCents : type.priceCents;
                              return {
                                main:
                                  d >= today ? (
                                    <span className={cn("flex items-center gap-0.5 text-[11px] tabular-nums leading-none", rate ? "font-bold text-basalt" : "font-medium text-basalt/70")}>
                                      {rate && <span className="h-1 w-1 rounded-full bg-basalt" />}
                                      {compact(price)}
                                    </span>
                                  ) : null,
                                sub: <span className={cn("text-[11px] tabular-nums leading-none", n === 0 ? "font-bold text-basalt" : "text-basalt/70")}>{n === 0 ? "Full" : `${n} free`}</span>,
                                aria: `${compact(price)}${rate ? " special price" : ""}, ${n === 0 ? "full" : `${n} of ${units.length} free`}`,
                              };
                            },
                          })}
                        </div>
                        {typeOpen &&
                          units.map((unit) => {
                            const roomLabel = `${type.name} · ${roomUnitLabel(unit.name)}`;
                            const cal = roomCals.get(unit.id);
                            const rs = syncNote((cal?.feeds.length ?? 0) > 0, cal?.syncedAt, cal?.error, now);
                            return (
                              <div key={unit.id} role="row" className="flex border-t border-basalt/[0.06]">
                                <div role="rowheader" className={cn(nameCell, "flex flex-col justify-center bg-paper pr-3", narrow ? "pl-4" : "pl-12")} style={{ width: nameW }}>
                                  <span className="truncate text-sm font-semibold text-basalt">{roomUnitLabel(unit.name)}</span>
                                  <span className={cn("truncate text-[11px]", rs?.stale ? "font-semibold text-apricot" : "text-basalt/70")}>
                                    {rs ? rs.text : unit.seasonalRates.length ? "Own prices on some dates" : type.name}
                                  </span>
                                </div>
                                {track({
                                  label: roomLabel,
                                  height: 52,
                                  halfDay: true,
                                  bookings: bookings.filter((b) => b.room_unit_id === unit.id),
                                  synced: unit.blockedRanges ?? [],
                                  manual: unit.manualBlockedRanges,
                                  base: unitBaseCents(type, unit),
                                  // Type prices first, the room's own last (they win) — shared/rooms.ts unitPricing.
                                  rates: unitPricing(type, unit).seasonalRates,
                                  onDay: (d) => setDirect({ listing, date: d, room: { unitId: unit.id, label: roomLabel, nightlyCents: unitNightCents(type, unit, d).cents } }),
                                })}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
                {/* Bookings with no room (e.g. recorded before rooms existed) stay visible — and need attention. */}
                {isOpen && bookings.some((b) => !b.room_unit_id) && (
                  <div role="row" className="flex border-t border-basalt/[0.06]">
                    <div role="rowheader" className={cn(nameCell, "flex flex-col justify-center bg-paper pr-3", narrow ? "pl-4" : "pl-10")} style={{ width: nameW }}>
                      <span className="truncate text-sm font-semibold text-apricot">No room assigned</span>
                      <span className="truncate text-[11px] text-basalt/70">Open a booking to assign a room</span>
                    </div>
                    {track({ label: `${listing.title}, no room assigned`, height: 52, halfDay: true, bookings: bookings.filter((b) => !b.room_unit_id), synced: [], manual: [], base: 0, rates: [] })}
                  </div>
                )}
              </div>
            );
          })}
          {/* Room to scroll the last row clear of the floating assistant button. */}
          <div aria-hidden className="h-16" />
        </div>
      </div>
      <BookingDetailDialog bookingId={openId} onClose={() => setOpenId(null)} onChanged={() => setReload((k) => k + 1)} />
      <DirectBookingDialog listing={direct?.listing ?? null} startDate={direct?.date ?? null} room={direct?.room ?? null} onClose={() => setDirect(null)} onCreated={() => setReload((k) => k + 1)} />
    </div>
  );
}

/** A hotel's rooms grouped under their room type, in order. */
function groupByType(rooms: { type: RoomType; unit: RoomType["units"][number] }[]): { type: RoomType; units: RoomType["units"] }[] {
  const out: { type: RoomType; units: RoomType["units"] }[] = [];
  for (const r of rooms) {
    const g = out.find((x) => x.type.id === r.type.id);
    if (g) g.units.push(r.unit);
    else out.push({ type: r.type, units: [r.unit] });
  }
  return out;
}
