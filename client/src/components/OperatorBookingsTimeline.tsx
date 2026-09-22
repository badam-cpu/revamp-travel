/**
 * Operator bookings timeline — a Hosteeva/Airbnb-style grid: the operator's
 * listings as rows, a horizontal date axis, and each booking drawn as a bar
 * across the nights it occupies (colored by status). iCal-blocked dates render
 * as unavailable. v1 shows booking + availability bars only; per-night prices
 * (toward the full channel-manager format) can be layered on later.
 *
 * Data: bookings on listings this operator owns (same RLS as OperatorBookings),
 * plus each listing's iCal blocked_ranges (from useListings).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { BookingStatus } from "@shared/bookings";
import { BookingDetailDialog } from "@/components/BookingDetailDialog";
import { DirectBookingDialog } from "@/components/DirectBookingDialog";
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
  const [direct, setDirect] = useState<{ listing: LiveListing; date: string } | null>(null);
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
      .select("id, start_date, end_date, status, guests, listing_id, guest_name, listings!inner(operator_id), profiles!traveler_id(display_name)")
      .eq("listings.operator_id", user.id)
      .in("status", ["pending_payment", "confirmed", "completed"])
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [user, reload]);

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

  // Clip a [start,end) span to the visible window, in px offset + width.
  const spanBox = (s: string, e: string) => {
    const from = Math.max(0, dayDiff(startDate, s));
    const to = Math.min(DAYS, dayDiff(startDate, e));
    if (to <= from) return null;
    return { left: from * CELL_W, width: (to - from) * CELL_W };
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
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {mine.map((listing) => {
            const bookings = byListing.get(listing.id) ?? [];
            const blocked = (listing.blockedRanges ?? []).map((b) => spanBox(b.start, addDaysIso(b.end, 1))).filter(Boolean) as { left: number; width: number }[];
            const manualBlk = (listing.manualBlockedRanges ?? []).map((b) => spanBox(b.start, b.end)).filter(Boolean) as { left: number; width: number }[];
            const rBase = Math.round(listing.price * 100);
            const rRates = listing.seasonalRates ?? [];
            const priceOn = (d: string) => {
              const m = rRates.filter((r) => r.start <= d && d <= r.end).pop();
              return { cents: m ? m.priceCents : rBase, overridden: Boolean(m) };
            };
            return (
              <div key={listing.id} className="flex border-b border-basalt/8 last:border-b-0">
                {/* Sticky listing label */}
                <Link href={`/listing/${listing.slug}`} className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-basalt/12 bg-paper px-3 py-3 hover:bg-chalk" style={{ width: NAME_W }}>
                  {listing.image && <img src={listing.image} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-basalt">{listing.title}</span>
                    <span className="block truncate text-[11px] uppercase tracking-wide text-basalt/40">{listing.type}</span>
                  </span>
                </Link>
                {/* Track */}
                <div className="relative shrink-0" style={{ width: trackW, height: 62 }}>
                  {/* day gridlines + per-day price */}
                  {days.map((d, i) => {
                    const dt = new Date(d + "T00:00:00Z");
                    const weekend = [0, 6].includes(dt.getUTCDay());
                    const monthStart = i !== 0 && dt.getUTCDate() === 1;
                    const past = d < today;
                    const p = rBase > 0 && !past ? priceOn(d) : null;
                    return (
                      <div
                        key={d}
                        onClick={() => setDirect({ listing, date: d })}
                        title="Record a direct booking"
                        className={cn("group/cell absolute top-0 h-full cursor-pointer border-r border-basalt/8 hover:bg-apricot/[0.07]", monthStart && "border-l-2 border-l-basalt/25", weekend && "bg-basalt/[0.02]", d === today && "bg-apricot/[0.06]")}
                        style={{ left: i * CELL_W, width: CELL_W }}
                      >
                        <span className="pointer-events-none absolute left-1/2 top-2 hidden -translate-x-1/2 text-sm font-bold leading-none text-apricot group-hover/cell:block">+</span>
                        {p && <span className={cn("pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] font-semibold tabular-nums", p.overridden ? "text-apricot" : "text-basalt/40")}>{compact(p.cents)}</span>}
                      </div>
                    );
                  })}
                  {/* blocked overlays (top band, above the price row) */}
                  {blocked.map((b, i) => (
                    <div key={`blk-${i}`} title="External booking (synced from a connected calendar)" className="absolute top-1.5 h-[30px] rounded-sm border border-blue-500/40 bg-blue-500/[0.08] bg-[repeating-linear-gradient(45deg,#3b82f640,#3b82f640_4px,transparent_4px,transparent_8px)]" style={{ left: b.left + 1, width: Math.max(0, b.width - 2) }} />
                  ))}
                  {/* manual availability blocks (operator-set) */}
                  {manualBlk.map((b, i) => (
                    <div key={`mb-${i}`} title="Blocked by you" className="absolute top-1.5 h-[30px] rounded-sm border border-basalt/25 bg-basalt/[0.15]" style={{ left: b.left + 1, width: Math.max(0, b.width - 2) }} />
                  ))}
                  {/* booking bars (top band, above the price row) */}
                  {bookings.map((b) => {
                    const box = spanBox(b.start_date, b.end_date);
                    if (!box) return null;
                    const name = b.profiles?.display_name || b.guest_name || "Guest";
                    return (
                      <button
                        type="button"
                        key={b.id}
                        onClick={() => setOpenId(b.id)}
                        title={`${name} · ${b.start_date} → ${b.end_date} · ${b.guests} guest${b.guests === 1 ? "" : "s"}`}
                        className={cn("absolute top-1.5 flex h-[30px] items-center overflow-hidden rounded px-2 text-[11px] font-semibold shadow-sm transition-[filter] hover:brightness-95", BAR_STYLE[b.status] ?? "bg-basalt text-white")}
                        style={{ left: box.left + 1, width: Math.max(0, box.width - 2) }}
                      >
                        <span className="truncate">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-basalt/45">Rolling {startDate} → {addDaysIso(windowEnd, -1)}. Scroll sideways or use the month menu to move ahead. Bars are your bookings; hatched blocks are dates synced as unavailable from a connected calendar. Tap a booking for full details.</p>
      <BookingDetailDialog bookingId={openId} onClose={() => setOpenId(null)} onChanged={() => setReload((k) => k + 1)} />
      <DirectBookingDialog listing={direct?.listing ?? null} startDate={direct?.date ?? null} onClose={() => setDirect(null)} onCreated={() => setReload((k) => k + 1)} />
    </div>
  );
}
