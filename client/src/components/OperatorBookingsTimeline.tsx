/**
 * Operator bookings timeline — a Hosteeva/Airbnb-style grid: the operator's
 * listings as rows, a horizontal date axis, and each booking drawn as a bar
 * across the nights it occupies (coloured by status). Nights synced from a
 * connected calendar are hatched, the operator's own blocks grey, and each
 * future night shows its price (orange = a custom price set for that date).
 * Prices/blocks are edited in the Calendar tab; here an operator reads the
 * house and records direct bookings (click a free night).
 *
 * Hotels (0092) expand into room-type rows (type price, rooms free) and one row
 * per room. Rows with a connected calendar say when they last synced (orange
 * once stale) — a stalled sync must never look like "free".
 *
 * Toolbar: Today, a month menu that follows the scroll, type filter. The grid
 * is an ARIA grid (one tabbable cell; arrows / Ctrl+arrows / Home / End /
 * Enter). Loading shows a skeleton; a failed load says so with Retry.
 *
 * Data: bookings on this operator's listings inside the window (RLS +
 * listings!inner on operator_id), each listing's iCal blocked_ranges and
 * manual blocks, hotels' room types/rooms (+ each room's calendar status).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
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
import { applyGrouping, CalendarToolbar, GROUP_OPTIONS, groupOptionsFor, monthsOf, remember, remembered, ToolbarSelect, useCompactPrice, type GroupBy, type TypeFilter } from "@/components/CalendarToolbar";

const DAY_MS = 86_400_000;
const CELL_W = 46; // px per night
const DAYS_BACK = 0; // the window opens on today (a stay already under way shows from today)
const DAYS = 180; // rolling window (~6 months)
const STALE_HOURS = 6; // a connected calendar older than this is flagged
const COLLAPSE_KEY = "revamp.timelineCollapsed";
const PAGE_KEY = "revamp.timelinePageSize";
const GROUP_KEY = "revamp.timelineGroup"; // new key: "Room type" now shows only multi-room properties
const PAGE_SIZES = [8, 20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

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

const STATUS: Partial<Record<BookingStatus, { label: string; bar: string }>> = {
  confirmed: { label: "Confirmed", bar: "bg-sevan text-white" },
  pending_payment: { label: "Awaiting payment", bar: "bg-tuff text-white" },
  awaiting_payment: { label: "Awaiting payment", bar: "bg-tuff text-white" },
  completed: { label: "Completed", bar: "bg-basalt/55 text-white" },
};
const statusOf = (s: BookingStatus) => STATUS[s] ?? STATUS.confirmed!;
const guestName = (b: Row) => b.profiles?.display_name || b.guest_name || "Guest";

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
  const [w, setW] = useState(210);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const f = () => setW(mq.matches ? 128 : 210);
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [pageSize, setPageSize] = useState<PageSize>(() => remembered<PageSize>(PAGE_KEY, PAGE_SIZES, 20));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => remembered<GroupBy>(GROUP_KEY, GROUP_OPTIONS.map((g) => g.value), "none"));
  const [page, setPage] = useState(0);
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
  // Group (section headings), then page through the listings — a hotel counts as one.
  const groupChoices = useMemo(() => groupOptionsFor(typeFilter, allMine), [typeFilter, allMine]);
  // A remembered choice that doesn't fit this filter (e.g. Room type on Tours) falls back to None.
  const group: GroupBy = groupChoices.some((o) => o.value === groupBy) ? groupBy : "none";
  const { ordered, key: groupKey } = useMemo(() => applyGrouping(mine, group), [mine, group]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const pageNow = Math.min(page, pageCount - 1);
  const paged = ordered.slice(pageNow * pageSize, (pageNow + 1) * pageSize);
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    ordered.forEach((l) => m.set(groupKey(l), (m.get(groupKey(l)) ?? 0) + 1));
    return m;
  }, [ordered, groupKey]);
  useEffect(() => setPage(0), [typeFilter, group, pageSize]);
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
  const totalUnits = ordered.reduce((a, l) => a + (hotelFreeByDay.has(l.id) ? roomsOf(l.id).length : 1), 0);
  const availByDay = useMemo(() => {
    const counts = days.map(() => 0);
    ordered.forEach((listing) => {
      const hotel = hotelFreeByDay.get(listing.id);
      if (hotel) return hotel.forEach((n, i) => (counts[i] += n));
      const bks = byListing.get(listing.id) ?? [];
      days.forEach((d, i) => {
        const taken = bks.some((b) => covers({ start: b.start_date, end: b.end_date }, d)) || (listing.blockedRanges ?? []).some((r) => covers(r, d)) || (listing.manualBlockedRanges ?? []).some((r) => covers(r, d));
        if (!taken) counts[i] += 1;
      });
    });
    return counts;
  }, [days, ordered, byListing, hotelFreeByDay]);

  // ── Scrolling: Today, month menu that follows the view ───────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const months = useMemo(() => monthsOf(days), [days]);
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
  /** Clip a [start,end) span to the window, in px offset + width. */
  const spanBox = (st: string, en: string) => {
    const from = Math.max(0, dayDiff(startDate, st));
    const to = Math.min(DAYS, dayDiff(startDate, en));
    if (to <= from) return null;
    return { left: from * CELL_W, width: (to - from) * CELL_W };
  };

  // Row index counter for the keyboard grid (header is row 0).
  let rowIdx = 0;

  /** One row of nights: cells (price, "record a booking"), synced/blocked spans, booking bars. */
  const track = (t: {
    label: string;
    height: number;
    bookings: Row[];
    synced: Range[];
    manual: Range[];
    base: number;
    rates: SeasonalRate[];
    onDay?: (d: string) => void;
  }) => {
    const r = ++rowIdx;
    const bar = t.height - 32; // the bottom band holds the price
    const priceOn = (d: string) => {
      const m = t.rates.filter((x) => x.start <= d && d <= x.end).pop();
      return { cents: m ? m.priceCents : t.base, custom: Boolean(m) };
    };
    const bookingOn = (d: string) => t.bookings.find((b) => covers({ start: b.start_date, end: b.end_date }, d));
    const boxes = (list: Range[]) => list.map((x) => spanBox(x.start, x.end)).filter(Boolean) as { left: number; width: number }[];
    return (
      <div role="presentation" className="relative shrink-0" style={{ width: DAYS * CELL_W, height: t.height }}>
        {days.map((d, i) => {
          const bk = bookingOn(d);
          const syncedNight = t.synced.some((x) => covers(x, d));
          const blockedNight = t.manual.some((x) => covers(x, d));
          const free = !bk && !syncedNight && !blockedNight;
          const past = d < today;
          const p = t.base > 0 && !past ? priceOn(d) : null;
          const canBook = free && !past && !!t.onDay;
          const desc = bk
            ? `booked by ${guestName(bk)}, ${statusOf(bk.status).label.toLowerCase()}, ${fmtShort(bk.start_date)} to ${fmtShort(bk.end_date)}`
            : syncedNight
              ? "booked on another channel"
              : blockedNight
                ? "blocked"
                : past
                  ? "free (past)"
                  : `free${p ? `, ${compact(p.cents)}${p.custom ? " custom price" : ""}` : ""}`;
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
              title={canBook ? "Record a direct booking" : undefined}
              className={cn(
                "group/cell absolute top-0 h-full border-r border-basalt/8 outline-none focus-visible:z-[5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apricot",
                i !== 0 && dt.getUTCDate() === 1 && "border-l-2 border-l-basalt/25",
                [0, 6].includes(dt.getUTCDay()) && "bg-basalt/[0.02]",
                d === today && "bg-apricot/[0.06]",
                canBook && "cursor-pointer hover:bg-apricot/[0.07]",
              )}
              style={{ left: i * CELL_W, width: CELL_W }}
            >
              {canBook && <span aria-hidden className="pointer-events-none absolute left-1/2 top-2 hidden -translate-x-1/2 text-sm font-bold leading-none text-apricot group-hover/cell:block">+</span>}
              {p && <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] font-semibold tabular-nums", p.custom ? "text-apricot" : "text-basalt/40")}>{compact(p.cents)}</span>}
            </div>
          );
        })}
        {boxes(t.synced).map((b, k) => (
          <div key={`s${k}`} aria-hidden title="Booked on another channel (synced calendar)" className="pointer-events-none absolute top-1.5 rounded-sm border border-blue-500/40 bg-blue-500/[0.08] bg-[repeating-linear-gradient(45deg,#3b82f640,#3b82f640_4px,transparent_4px,transparent_8px)]" style={{ left: b.left + 1, width: Math.max(0, b.width - 2), height: bar }} />
        ))}
        {boxes(t.manual).map((b, k) => (
          <div key={`m${k}`} aria-hidden title="Blocked by you" className="pointer-events-none absolute top-1.5 rounded-sm border border-basalt/25 bg-basalt/[0.15]" style={{ left: b.left + 1, width: Math.max(0, b.width - 2), height: bar }} />
        ))}
        {t.bookings.map((bk) => {
          const b = spanBox(bk.start_date, bk.end_date);
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
              className={cn("absolute top-1.5 z-[2] flex items-center overflow-hidden rounded px-2 text-left text-[11px] font-semibold shadow-sm transition-[filter] hover:brightness-95", s.bar)}
              style={{ left: b.left + 1, width: Math.max(0, b.width - 2), height: bar }}
            >
              <span className="truncate">{guestName(bk)}</span>
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
                "absolute top-0 flex h-full flex-col items-center justify-center border-r border-basalt/8 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apricot",
                dt.getUTCDate() === 1 && i !== 0 && "border-l-2 border-l-basalt/25",
                d === today && "bg-apricot/[0.06]",
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
          <div key={i} className="h-14 animate-pulse bg-chalk" />
        ))}
      </div>
    );
  }
  if (loadError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-basalt/12 bg-chalk px-5 py-4">
        <p className="text-sm text-basalt/80">We couldn't load your bookings. Check your connection and try again.</p>
        <button type="button" onClick={() => setReload((k) => k + 1)} className="rounded-none bg-basalt px-4 py-2 text-sm font-semibold text-paper hover:bg-basalt/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot">
          Retry
        </button>
      </div>
    );
  }
  if (allMine.length === 0) {
    return <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Add a listing to see it on the timeline.</p>;
  }

  const trackW = DAYS * CELL_W;
  const now = Date.now();
  const nameCell = "sticky left-0 z-10 shrink-0 border-r border-basalt/12";

  /** One listing's rows: a plain row, or a hotel (summary → room types → rooms). */
  const renderListing = (listing: LiveListing) => {
    const bookings = byListing.get(listing.id) ?? [];
    const rooms = roomsOf(listing.id);
    const sync = syncNote(listing.icalFeeds.length > 0 || !!listing.icalUrl, listing.icalSyncedAt, listing.icalError, now);
    const label = (
      <>
        {listing.image && !narrow && <img src={listing.image} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-basalt">{listing.title}</span>
          <span className="block truncate text-[11px] uppercase tracking-wide text-basalt/40">
            {rooms.length ? `Hotel · ${rooms.length} room${rooms.length === 1 ? "" : "s"}` : listing.type}
            {sync && !rooms.length && <span className={cn("normal-case tracking-normal", sync.stale && "font-semibold text-apricot")}> · {sync.text}</span>}
          </span>
        </span>
      </>
    );

    if (!rooms.length) {
      return (
        <div key={listing.id} role="row" className="flex border-b border-basalt/8 last:border-b-0">
          <Link role="rowheader" href={`/listing/${listing.slug}`} className={cn(nameCell, "flex items-center gap-2 bg-paper px-3 py-3 hover:bg-chalk focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-apricot")} style={{ width: nameW }}>
            {label}
          </Link>
          {track({
            label: listing.title,
            height: 62,
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
      <div key={listing.id} className="border-b border-basalt/8 last:border-b-0">
        <div role="row" className="flex bg-chalk/50">
          <button type="button" role="rowheader" onClick={() => toggleKey(listing.id)} aria-expanded={isOpen} className={cn(nameCell, "flex items-center gap-2 bg-paper px-3 py-3 text-left hover:bg-chalk focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-apricot")} style={{ width: nameW }}>
            {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-basalt/45" /> : <ChevronRight className="h-4 w-4 shrink-0 text-basalt/45" />}
            {label}
          </button>
          {summaryTrack({
            label: `${listing.title}, all rooms`,
            height: 62,
            cell: (_d, i) => {
              const n = free[i] ?? 0;
              return {
                main: <span className={cn("text-sm font-semibold tabular-nums", n === 0 ? "text-tuff" : "text-basalt/70")}>{n}</span>,
                sub: <span className="text-[9px] text-basalt/40">free</span>,
                aria: `${n} of ${rooms.length} rooms free`,
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
                {/* Room type row: the type's price per night (all its rooms) and rooms free. */}
                <div role="row" className="flex border-t border-basalt/8 bg-chalk/40">
                  <button
                    type="button"
                    role="rowheader"
                    onClick={() => toggleKey(typeKey)}
                    aria-expanded={typeOpen}
                    className={cn(nameCell, "flex items-center gap-2 bg-chalk py-2 pr-3 text-left hover:bg-chalk/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-apricot", narrow ? "pl-3" : "pl-6")}
                    style={{ width: nameW }}
                  >
                    {typeOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-basalt/45" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-basalt/45" />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-basalt">{type.name}</span>
                      <span className="block truncate text-[11px] text-basalt/45">Room type · {units.length} room{units.length === 1 ? "" : "s"}</span>
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
                        main: d >= today ? <span className={cn("text-[10px] font-bold tabular-nums", rate ? "text-apricot" : "text-basalt/70")}>{compact(price)}</span> : null,
                        sub: <span className={cn("text-[9px] tabular-nums", n === 0 ? "font-semibold text-tuff" : "text-basalt/40")}>{n}/{units.length}</span>,
                        aria: `${compact(price)}${rate ? " custom price" : ""}, ${n} of ${units.length} free`,
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
                      <div key={unit.id} role="row" className="flex border-t border-basalt/6">
                        <div role="rowheader" className={cn(nameCell, "flex flex-col justify-center bg-paper py-2 pr-3", narrow ? "pl-4" : "pl-12")} style={{ width: nameW }}>
                          <span className="truncate text-sm font-semibold text-basalt">{roomUnitLabel(unit.name)}</span>
                          <span className={cn("truncate text-[11px]", rs?.stale ? "font-semibold text-apricot" : "text-basalt/45")}>
                            {rs ? rs.text : unit.seasonalRates.length ? "Own prices on some dates" : type.name}
                          </span>
                        </div>
                        {track({
                          label: roomLabel,
                          height: 52,
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
        {/* Bookings with no room (e.g. recorded before rooms existed) stay visible. */}
        {isOpen && bookings.some((b) => !b.room_unit_id) && (
          <div role="row" className="flex border-t border-basalt/6">
            <div role="rowheader" className={cn(nameCell, "flex flex-col justify-center bg-paper py-2 pr-3", narrow ? "pl-4" : "pl-10")} style={{ width: nameW }}>
              <span className="truncate text-sm font-semibold text-tuff">No room assigned</span>
              <span className="truncate text-[11px] text-basalt/45">Open a booking to move it to a room</span>
            </div>
            {track({ label: `${listing.title}, no room assigned`, height: 52, bookings: bookings.filter((b) => !b.room_unit_id), synced: [], manual: [], base: 0, rates: [] })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <CalendarToolbar
        onToday={() => jumpTo(DAYS_BACK)}
        months={months}
        viewMonth={viewMonth}
        onMonth={(offset) => jumpTo(offset)}
        types={availableTypes}
        type={typeFilter}
        onType={setTypeFilter}
      >
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <ToolbarSelect
            id="tl-group"
            label="Group by"
            value={group}
            options={groupChoices}
            onChange={(v) => {
              setGroupBy(v);
              remember(GROUP_KEY, v);
            }}
          />
          <ToolbarSelect
            id="tl-page-size"
            label="Page size"
            value={pageSize}
            options={PAGE_SIZES.map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => {
              setPageSize(v);
              remember(PAGE_KEY, v);
            }}
          />
        </div>
      </CalendarToolbar>

      {/* Legend */}
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-basalt/55" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-sevan" /> Confirmed</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-tuff" /> Awaiting payment</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-basalt/55" /> Completed</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-blue-500/40 bg-[repeating-linear-gradient(45deg,#3b82f640,#3b82f640_3px,transparent_3px,transparent_6px)]" /> Booked on another channel (synced)</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-basalt/25 bg-basalt/[0.15]" /> Blocked by you</li>
        <li className="inline-flex items-center gap-1.5"><span className="text-[11px] font-semibold text-basalt/45">֏30k</span> Your price per night</li>
        <li className="inline-flex items-center gap-1.5"><span className="text-[11px] font-semibold text-apricot">֏35k</span> Custom price for that date</li>
      </ul>

      {/* Grid */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onKeyDown={onGridKey}
        role="grid"
        aria-label={`Bookings, ${fmtDay(startDate)} to ${fmtDay(addDaysIso(windowEnd, -1))}`}
        aria-rowcount={-1}
        className="grid-scroll max-h-[min(78vh,calc(100dvh-210px))] overflow-auto overscroll-contain border border-basalt/12 bg-paper"
      >
        <div style={{ width: nameW + trackW }}>
          {/* Pinned date header */}
          <div role="row" className="sticky top-0 z-20 flex border-b border-basalt/12 bg-chalk">
            <div role="columnheader" aria-label="Listing" className={cn(nameCell, "z-30 bg-chalk")} style={{ width: nameW }} />
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
                  className={cn("relative shrink-0 border-r border-basalt/8 py-1.5 text-center", monthStart && i !== 0 && "border-l-2 border-l-basalt/25", [0, 6].includes(dt.getUTCDay()) && "bg-basalt/[0.03]", isToday && "bg-apricot/10")}
                >
                  {monthStart && (
                    <span aria-hidden className="absolute left-0 top-0 whitespace-nowrap px-1 text-[9px] font-bold uppercase tracking-wide text-apricot">
                      {dt.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}
                    </span>
                  )}
                  <span aria-hidden className="mt-2 block text-[9px] font-bold uppercase tracking-wide text-basalt/40">{dt.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }).slice(0, 2)}</span>
                  <span aria-hidden className={cn("block text-sm font-semibold tabular-nums", isToday && "text-apricot")}>{dt.getUTCDate()}</span>
                  <span aria-hidden title={`${n} of ${totalUnits} available`} className={cn("block text-[9px] font-semibold tabular-nums", n === 0 ? "text-tuff" : "text-basalt/45")}>{n}/{totalUnits}</span>
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {paged.map((listing, idx) => {
            const key = groupKey(listing);
            const heading =
              key && (idx === 0 || groupKey(paged[idx - 1]) !== key) ? (
                <div role="row" className="flex border-b border-basalt/12 bg-chalk">
                  <div role="rowheader" className={cn(nameCell, "bg-chalk px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/70")} style={{ width: nameW }}>
                    {key} <span className="font-semibold normal-case tracking-normal text-basalt/45">· {groupCounts.get(key)}</span>
                  </div>
                  <div aria-hidden style={{ width: trackW }} />
                </div>
              ) : null;
            return (
              <Fragment key={listing.id}>
                {heading}
                {renderListing(listing)}
              </Fragment>
            );
          })}
        </div>
      </div>
      {pageCount > 1 && (
        <nav aria-label="Listing pages" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-basalt/60 tabular-nums">
            {pageNow * pageSize + 1}–{Math.min(ordered.length, (pageNow + 1) * pageSize)} of {ordered.length} listings
          </span>
          <button type="button" onClick={() => setPage(pageNow - 1)} disabled={pageNow === 0} aria-label="Previous page" className="grid h-9 w-9 place-items-center rounded-full border border-basalt/15 bg-paper hover:border-basalt/40 disabled:opacity-35">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums text-basalt/70">Page {pageNow + 1} of {pageCount}</span>
          <button type="button" onClick={() => setPage(pageNow + 1)} disabled={pageNow >= pageCount - 1} aria-label="Next page" className="grid h-9 w-9 place-items-center rounded-full border border-basalt/15 bg-paper hover:border-basalt/40 disabled:opacity-35">
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
            <p className="mt-3 text-xs text-basalt/45">Bars are your bookings; hatched blocks are nights booked on another channel (synced from a connected calendar). Click a free night to record a direct booking, or a bar for its details. Hotels and guesthouses open into one row per room.</p>
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
