/**
 * Operator bookings timeline — a Hosteeva/Airbnb-style grid: the operator's
 * listings as rows, a horizontal date axis, and each booking drawn as a bar
 * across the nights it occupies (colored by status). iCal-blocked dates render
 * as unavailable. v1 shows booking + availability bars only; per-night prices
 * (toward the full channel-manager format) can be layered on later.
 *
 * Data: bookings on listings this operator owns (same RLS as OperatorBookings),
 * plus each listing's iCal blocked_ranges (from useListings).
 *
 * Hotels (multi-room, 0092): a summary row with rooms free per night, expanding
 * into one row per room (grouped by room type) with that room's bookings, its
 * own synced Airbnb/Booking.com nights (0096), its blocks and nightly price.
 * Clicking a day on a room row records a direct booking for THAT room. Every
 * room counts as one unit in the header's "available/total".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { BookingStatus } from "@shared/bookings";
import { BookingDetailDialog } from "@/components/BookingDetailDialog";
import { DirectBookingDialog, type DirectBookingRoom } from "@/components/DirectBookingDialog";
import { fetchRoomTypes } from "@/lib/roomTypes";
import type { RoomType, SeasonalRate } from "@shared/listings";
import { roomUnitLabel, unitBaseCents, unitNightCents, unitPricing } from "@shared/rooms";
import type { LiveListing } from "@/contexts/ListingsContext";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const CELL_W = 46; // px per day
const NAME_W = 210; // px, sticky left column
const DAYS = 180; // rolling window length (~6 months), scrolled horizontally

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

const BAR_STYLE: Partial<Record<BookingStatus, string>> = {
  confirmed: "bg-sevan text-white",
  pending_payment: "bg-tuff text-white",
  completed: "bg-basalt/55 text-white",
};

/** Compact per-day price for the tight timeline cells (e.g. ֏45k, $116). */
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

export function OperatorBookingsTimeline() {
  const { user } = useAuth();
  const { listings } = useListings();
  const compact = useCompactPrice();
  const [rows, setRows] = useState<Row[] | null>(null);
  // Rolling window: always anchored at today, scrolled horizontally rather than paged.
  const startDate = useMemo(() => todayIso(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [direct, setDirect] = useState<{ listing: LiveListing; date: string; room?: DirectBookingRoom } | null>(null);
  // Hotels: their room types + rooms, and which hotels are collapsed to the summary row.
  const [roomsByHotel, setRoomsByHotel] = useState<Map<string, RoomType[]>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleKey = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const [reload, setReload] = useState(0);
  const [typeFilter, setTypeFilter] = useState<"all" | "stay" | "tour" | "experience">("all");

  const allMine = useMemo(
    () => listings.filter((l) => l.operatorId === user?.id).sort((a, b) => a.title.localeCompare(b.title)),
    [listings, user?.id],
  );
  const mine = useMemo(
    () => (typeFilter === "all" ? allMine : allMine.filter((l) => l.type === typeFilter)),
    [allMine, typeFilter],
  );
  // Which type filters to actually offer (only types the operator has).
  const availableTypes = useMemo(() => {
    const present = new Set(allMine.map((l) => l.type));
    return (["all", "stay", "tour", "experience"] as const).filter((t) => t === "all" || present.has(t));
  }, [allMine]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("bookings")
      .select("id, start_date, end_date, status, guests, listing_id, room_unit_id, guest_name, listings!inner(operator_id), profiles!traveler_id(display_name)")
      .eq("listings.operator_id", user.id)
      .in("status", ["pending_payment", "confirmed", "completed"])
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [user, reload]);

  // Load every hotel's rooms once (and after a booking change, so new rooms show).
  const hotelIds = useMemo(() => allMine.filter((l) => l.type === "stay" && l.multiRoom).map((l) => l.id).join(","), [allMine]);
  useEffect(() => {
    const ids = hotelIds ? hotelIds.split(",") : [];
    if (!ids.length) return;
    let live = true;
    Promise.all(ids.map(async (id) => [id, await fetchRoomTypes(id)] as const)).then((pairs) => {
      if (live) setRoomsByHotel(new Map(pairs));
    });
    return () => {
      live = false;
    };
  }, [hotelIds, reload]);
  /** A hotel's active rooms in display order (empty for a hotel with no rooms yet). */
  const roomsOf = (listingId: string) =>
    (roomsByHotel.get(listingId) ?? []).flatMap((type) => type.units.filter((u) => u.active).map((unit) => ({ type, unit })));

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDaysIso(startDate, i)), [startDate]);
  const windowEnd = addDaysIso(startDate, DAYS);
  const today = todayIso();

  // Months present in the rolling window → jump targets for the "Today ▾" dropdown.
  const months = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; offset: number }>();
    days.forEach((d, i) => {
      const key = d.slice(0, 7);
      if (!seen.has(key)) {
        const dt = new Date(d + "T00:00:00Z");
        seen.set(key, { key, label: dt.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }), offset: i });
      }
    });
    return Array.from(seen.values());
  }, [days]);

  const jumpTo = (offset: number) => scrollRef.current?.scrollTo({ left: offset * CELL_W, behavior: "smooth" });

  const byListing = useMemo(() => {
    const map = new Map<string, Row[]>();
    (rows ?? []).forEach((r) => {
      const arr = map.get(r.listing_id) ?? [];
      arr.push(r);
      map.set(r.listing_id, arr);
    });
    return map;
  }, [rows]);

  // Per-day availability across the shown listings: "available/total" units.
  // A listing is one unit; a hotel counts each of its rooms. A unit is
  // unavailable that day if a booking covers it or it's blocked (synced or manual,
  // both end-exclusive).
  const covers = (r: { start: string; end: string }, d: string) => r.start <= d && d < r.end;
  const hotelFreeByDay = useMemo(() => {
    const out = new Map<string, number[]>();
    mine.forEach((listing) => {
      const rooms = roomsOf(listing.id);
      if (!rooms.length) return;
      const bks = byListing.get(listing.id) ?? [];
      out.set(
        listing.id,
        days.map((d) => rooms.filter(({ unit }) =>
          !(bks.some((b) => b.room_unit_id === unit.id && b.start_date <= d && d < b.end_date) ||
            (unit.blockedRanges ?? []).some((r) => covers(r, d)) ||
            unit.manualBlockedRanges.some((r) => covers(r, d)))).length),
      );
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, mine, byListing, roomsByHotel]);
  const totalUnits = mine.reduce((a, l) => a + (hotelFreeByDay.has(l.id) ? roomsOf(l.id).length : 1), 0);
  const availByDay = useMemo(() => {
    const counts = days.map(() => 0);
    mine.forEach((listing) => {
      const hotel = hotelFreeByDay.get(listing.id);
      if (hotel) {
        hotel.forEach((n, i) => (counts[i] += n));
        return;
      }
      const bks = byListing.get(listing.id) ?? [];
      days.forEach((d, i) => {
        const taken =
          bks.some((b) => b.start_date <= d && d < b.end_date) ||
          (listing.blockedRanges ?? []).some((r) => covers(r, d)) ||
          (listing.manualBlockedRanges ?? []).some((r) => covers(r, d));
        if (!taken) counts[i] += 1;
      });
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, mine, byListing, hotelFreeByDay]);

  // Clip a [start,end) span to the visible window, in px offset + width.
  const spanBox = (s: string, e: string) => {
    const from = Math.max(0, dayDiff(startDate, s));
    const to = Math.min(DAYS, dayDiff(startDate, e));
    if (to <= from) return null;
    return { left: from * CELL_W, width: (to - from) * CELL_W };
  };

  /** One row's date track: per-day price + "record a booking" cells, synced and manual
   *  blocks (end-exclusive), and booking bars. Used by listings and hotel rooms. */
  const track = (t: {
    height: number;
    bookings: Row[];
    synced: { start: string; end: string }[];
    manual: { start: string; end: string }[];
    base: number;
    rates: SeasonalRate[];
    onDay: (d: string) => void;
  }) => {
    const bar = t.height - 32; // leave the bottom band for the price
    const priceOn = (d: string) => {
      const m = t.rates.filter((r) => r.start <= d && d <= r.end).pop();
      return { cents: m ? m.priceCents : t.base, overridden: Boolean(m) };
    };
    const boxes = (list: { start: string; end: string }[]) => list.map((b) => spanBox(b.start, b.end)).filter(Boolean) as { left: number; width: number }[];
    return (
      <div className="relative shrink-0" style={{ width: DAYS * CELL_W, height: t.height }}>
        {days.map((d, i) => {
          const dt = new Date(d + "T00:00:00Z");
          const weekend = [0, 6].includes(dt.getUTCDay());
          const monthStart = i !== 0 && dt.getUTCDate() === 1;
          const p = t.base > 0 && d >= today ? priceOn(d) : null;
          return (
            <div
              key={d}
              onClick={() => t.onDay(d)}
              title="Record a direct booking"
              className={cn("group/cell absolute top-0 h-full cursor-pointer border-r border-basalt/8 hover:bg-apricot/[0.07]", monthStart && "border-l-2 border-l-basalt/25", weekend && "bg-basalt/[0.02]", d === today && "bg-apricot/[0.06]")}
              style={{ left: i * CELL_W, width: CELL_W }}
            >
              <span className="pointer-events-none absolute left-1/2 top-2 hidden -translate-x-1/2 text-sm font-bold leading-none text-apricot group-hover/cell:block">+</span>
              {p && <span className={cn("pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] font-semibold tabular-nums", p.overridden ? "text-apricot" : "text-basalt/40")}>{compact(p.cents)}</span>}
            </div>
          );
        })}
        {boxes(t.synced).map((b, i) => (
          <div key={`blk-${i}`} title="External booking (synced from a connected calendar)" className="absolute top-1.5 rounded-sm border border-blue-500/40 bg-blue-500/[0.08] bg-[repeating-linear-gradient(45deg,#3b82f640,#3b82f640_4px,transparent_4px,transparent_8px)]" style={{ left: b.left + 1, width: Math.max(0, b.width - 2), height: bar }} />
        ))}
        {boxes(t.manual).map((b, i) => (
          <div key={`mb-${i}`} title="Blocked by you" className="absolute top-1.5 rounded-sm border border-basalt/25 bg-basalt/[0.15]" style={{ left: b.left + 1, width: Math.max(0, b.width - 2), height: bar }} />
        ))}
        {t.bookings.map((b) => {
          const box = spanBox(b.start_date, b.end_date);
          if (!box) return null;
          const name = b.profiles?.display_name || b.guest_name || "Guest";
          return (
            <button
              type="button"
              key={b.id}
              onClick={() => setOpenId(b.id)}
              title={`${name} · ${b.start_date} → ${b.end_date} · ${b.guests} guest${b.guests === 1 ? "" : "s"}`}
              className={cn("absolute top-1.5 flex items-center overflow-hidden rounded px-2 text-[11px] font-semibold shadow-sm transition-[filter] hover:brightness-95", BAR_STYLE[b.status] ?? "bg-basalt text-white")}
              style={{ left: box.left + 1, width: Math.max(0, box.width - 2), height: bar }}
            >
              <span className="truncate">{name}</span>
            </button>
          );
        })}
      </div>
    );
  };

  if (rows === null) return <p className="text-sm text-basalt/50">Loading…</p>;
  if (allMine.length === 0) {
    return <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Add a listing to see it on the timeline.</p>;
  }

  const trackW = DAYS * CELL_W;

  return (
    <div>
      {/* Controls — a single "Today ▾" jump menu; the grid is one long rolling strip you scroll. */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative inline-flex items-center">
          <select
            aria-label="Jump to month"
            onChange={(e) => {
              jumpTo(Number(e.target.value));
              e.target.selectedIndex = 0; // snap back to "Today" label
            }}
            className="h-9 min-w-[150px] appearance-none border border-basalt/15 bg-paper pl-3 pr-9 text-sm font-semibold hover:border-apricot focus:border-apricot focus:outline-none"
          >
            <option value={0}>Today</option>
            {months.map((m) => (
              <option key={m.key} value={m.offset}>{m.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-basalt/45" />
        </div>
        <p className="text-xs text-basalt/45">Scroll right for later dates → showing {DAYS} days from today.</p>
      </div>

      {/* Product-type filter (only when the operator has more than one type). */}
      {availableTypes.length > 2 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {availableTypes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cn(
                "border px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                typeFilter === t ? "border-basalt bg-basalt text-paper" : "border-basalt/15 text-basalt/60 hover:border-apricot hover:text-apricot",
              )}
            >
              {t === "all" ? "All" : t === "stay" ? "Stays" : t === "tour" ? "Tours" : "Experiences"}
            </button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-basalt/55">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-sevan" /> Confirmed</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-tuff" /> Awaiting payment</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-blue-500/40 bg-[repeating-linear-gradient(45deg,#3b82f640,#3b82f640_3px,transparent_3px,transparent_6px)]" /> External booking (synced)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-basalt/25 bg-basalt/[0.15]" /> Blocked (you)</span>
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="overflow-x-auto border border-basalt/12">
        <div style={{ width: NAME_W + trackW }}>
          {/* Header: date columns */}
          <div className="flex border-b border-basalt/12 bg-chalk">
            <div className="sticky left-0 z-10 shrink-0 border-r border-basalt/12 bg-chalk" style={{ width: NAME_W }} />
            {days.map((d, i) => {
              const dt = new Date(d + "T00:00:00Z");
              const isToday = d === today;
              const weekend = [0, 6].includes(dt.getUTCDay());
              const monthStart = i === 0 || dt.getUTCDate() === 1;
              return (
                <div key={d} style={{ width: CELL_W }} className={cn("relative shrink-0 border-r border-basalt/8 py-1.5 text-center", monthStart && "border-l-2 border-l-basalt/25", weekend && "bg-basalt/[0.03]", isToday && "bg-apricot/10")}>
                  {monthStart && (
                    <div className="absolute -top-0 left-0 whitespace-nowrap px-1 text-[9px] font-bold uppercase tracking-wide text-apricot">
                      {dt.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}
                    </div>
                  )}
                  <div className="mt-2 text-[9px] font-bold uppercase tracking-wide text-basalt/40">{dt.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }).slice(0, 2)}</div>
                  <div className={cn("text-sm font-semibold tabular-nums", isToday && "text-apricot")}>{dt.getUTCDate()}</div>
                  <div className={cn("text-[9px] font-semibold tabular-nums", availByDay[i] === 0 ? "text-tuff" : "text-basalt/45")} title={`${availByDay[i]} of ${totalUnits} available`}>{availByDay[i]}/{totalUnits}</div>
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {mine.map((listing) => {
            const bookings = byListing.get(listing.id) ?? [];
            const rooms = roomsOf(listing.id);
            const label = (
              <>
                {listing.image && <img src={listing.image} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-basalt">{listing.title}</span>
                  <span className="block truncate text-[11px] uppercase tracking-wide text-basalt/40">{rooms.length ? `Hotel · ${rooms.length} room${rooms.length === 1 ? "" : "s"}` : listing.type}</span>
                </span>
              </>
            );

            if (!rooms.length) {
              return (
                <div key={listing.id} className="flex border-b border-basalt/8 last:border-b-0">
                  <Link href={`/listing/${listing.slug}`} className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-basalt/12 bg-paper px-3 py-3 hover:bg-chalk" style={{ width: NAME_W }}>
                    {label}
                  </Link>
                  {track({
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

            // Hotel: summary row (rooms free per night) + one row per room.
            const isOpen = !collapsed.has(listing.id);
            const free = hotelFreeByDay.get(listing.id) ?? [];
            const toggle = () =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(listing.id)) next.delete(listing.id);
                else next.add(listing.id);
                return next;
              });
            return (
              <div key={listing.id} className="border-b border-basalt/8 last:border-b-0">
                <div className="flex bg-chalk/50">
                  <button type="button" onClick={toggle} aria-expanded={isOpen} className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-basalt/12 bg-paper px-3 py-3 text-left hover:bg-chalk focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-apricot" style={{ width: NAME_W }}>
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-basalt/45" /> : <ChevronRight className="h-4 w-4 shrink-0 text-basalt/45" />}
                    {label}
                  </button>
                  <div className="relative shrink-0" style={{ width: trackW, height: 62 }}>
                    {days.map((d, i) => {
                      const n = free[i] ?? 0;
                      return (
                        <div key={d} className={cn("absolute top-0 flex h-full flex-col items-center justify-center border-r border-basalt/8", d === today && "bg-apricot/[0.06]")} style={{ left: i * CELL_W, width: CELL_W }} title={`${n} of ${rooms.length} rooms free`}>
                          <span className={cn("text-sm font-semibold tabular-nums", n === 0 ? "text-tuff" : "text-basalt/70")}>{n}</span>
                          <span className="text-[9px] text-basalt/40">free</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {isOpen &&
                  groupByType(rooms).map(({ type, units }) => {
                    const typeKey = `${listing.id}:${type.id}`;
                    const typeOpen = !collapsed.has(typeKey);
                    const typeRates = type.seasonalRates ?? [];
                    const typeFree = (d: string) =>
                      units.filter((u) => !bookings.some((b) => b.room_unit_id === u.id && b.start_date <= d && d < b.end_date) && !(u.blockedRanges ?? []).some((r) => r.start <= d && d < r.end) && !u.manualBlockedRanges.some((r) => r.start <= d && d < r.end)).length;
                    return (
                      <div key={type.id}>
                        {/* Room type row: the type's price per night (all its rooms) and rooms free. */}
                        <div className="flex border-t border-basalt/8 bg-chalk/40">
                          <button
                            type="button"
                            onClick={() => toggleKey(typeKey)}
                            aria-expanded={typeOpen}
                            className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-basalt/12 bg-chalk py-2 pl-6 pr-3 text-left hover:bg-chalk/70"
                            style={{ width: NAME_W }}
                          >
                            {typeOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-basalt/45" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-basalt/45" />}
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-basalt">{type.name}</span>
                              <span className="block truncate text-[11px] text-basalt/45">Room type · {units.length} room{units.length === 1 ? "" : "s"}</span>
                            </span>
                          </button>
                          <div className="relative shrink-0" style={{ width: trackW, height: 46 }}>
                            {days.map((d, i) => {
                              const rate = typeRates.filter((r) => r.start <= d && d <= r.end).pop();
                              const n = typeFree(d);
                              return (
                                <div key={d} className={cn("absolute top-0 flex h-full flex-col items-center justify-center border-r border-basalt/8", d === today && "bg-apricot/[0.06]")} style={{ left: i * CELL_W, width: CELL_W }} title={`${type.name}: ${n} of ${units.length} free`}>
                                  {d >= today && <span className={cn("text-[10px] font-bold tabular-nums", rate ? "text-apricot" : "text-basalt/70")}>{compact(rate ? rate.priceCents : type.priceCents)}</span>}
                                  <span className={cn("text-[9px] tabular-nums", n === 0 ? "font-semibold text-tuff" : "text-basalt/40")}>{n}/{units.length}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {typeOpen &&
                          units.map((unit) => {
                            const roomLabel = `${type.name} · ${roomUnitLabel(unit.name)}`;
                            return (
                              <div key={unit.id} className="flex border-t border-basalt/6">
                                <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-basalt/12 bg-paper py-2 pl-12 pr-3" style={{ width: NAME_W }}>
                                  <span className="truncate text-sm font-semibold text-basalt">{roomUnitLabel(unit.name)}</span>
                                  <span className="truncate text-[11px] text-basalt/45">{unit.seasonalRates.length ? "Own prices on some dates" : type.name}</span>
                                </div>
                                {track({
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
                  <div className="flex border-t border-basalt/6">
                    <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-basalt/12 bg-paper py-2 pl-10 pr-3" style={{ width: NAME_W }}>
                      <span className="truncate text-sm font-semibold text-tuff">No room assigned</span>
                      <span className="truncate text-[11px] text-basalt/45">Open a booking to move it to a room</span>
                    </div>
                    {track({ height: 52, bookings: bookings.filter((b) => !b.room_unit_id), synced: [], manual: [], base: 0, rates: [], onDay: () => {} })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-basalt/45">Rolling {startDate} → {addDaysIso(windowEnd, -1)}. Scroll sideways or use the month menu to move ahead. Bars are your bookings; hatched blocks are dates synced as unavailable from a connected calendar. Hotels and guesthouses open into one row per room — click a day on a room to record a booking for it. Tap a booking for full details.</p>
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
