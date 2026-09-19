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
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { BookingStatus } from "@shared/bookings";
import { BookingDetailDialog } from "@/components/BookingDetailDialog";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const CELL_W = 46; // px per day
const NAME_W = 210; // px, sticky left column
const DAYS = 35; // window length

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
  const [startDate, setStartDate] = useState(() => todayIso());
  const [openId, setOpenId] = useState<string | null>(null);

  const mine = useMemo(
    () => listings.filter((l) => l.operatorId === user?.id).sort((a, b) => a.title.localeCompare(b.title)),
    [listings, user?.id],
  );

  useEffect(() => {
    if (!user) return;
    supabase
      .from("bookings")
      .select("id, start_date, end_date, status, guests, listing_id, guest_name, listings!inner(operator_id), profiles!traveler_id(display_name)")
      .eq("listings.operator_id", user.id)
      .in("status", ["pending_payment", "confirmed", "completed"])
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [user]);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDaysIso(startDate, i)), [startDate]);
  const windowEnd = addDaysIso(startDate, DAYS);
  const monthLabel = new Date(startDate + "T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const today = todayIso();

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
  if (mine.length === 0) {
    return <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Add a listing to see it on the timeline.</p>;
  }

  const trackW = DAYS * CELL_W;

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setStartDate((d) => addDaysIso(d, -14))} aria-label="Earlier" className="grid h-8 w-8 place-items-center border border-basalt/15 hover:border-apricot hover:text-apricot"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setStartDate((d) => addDaysIso(d, 14))} aria-label="Later" className="grid h-8 w-8 place-items-center border border-basalt/15 hover:border-apricot hover:text-apricot"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <p className="font-display text-xl">{monthLabel}</p>
        <button type="button" onClick={() => setStartDate(todayIso())} className="ml-auto border border-basalt/15 px-3 py-1.5 text-xs font-semibold hover:border-apricot hover:text-apricot">Today</button>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-basalt/55">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-sevan" /> Confirmed</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-tuff" /> Awaiting payment</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-blue-500/40 bg-[repeating-linear-gradient(45deg,#3b82f640,#3b82f640_3px,transparent_3px,transparent_6px)]" /> External booking (synced)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-basalt/25 bg-basalt/[0.15]" /> Blocked (you)</span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto border border-basalt/12">
        <div style={{ width: NAME_W + trackW }}>
          {/* Header: date columns */}
          <div className="flex border-b border-basalt/12 bg-chalk">
            <div className="sticky left-0 z-10 shrink-0 border-r border-basalt/12 bg-chalk" style={{ width: NAME_W }} />
            {days.map((d) => {
              const dt = new Date(d + "T00:00:00Z");
              const isToday = d === today;
              const weekend = [0, 6].includes(dt.getUTCDay());
              return (
                <div key={d} style={{ width: CELL_W }} className={cn("shrink-0 border-r border-basalt/8 py-1.5 text-center", weekend && "bg-basalt/[0.03]", isToday && "bg-apricot/10")}>
                  <div className="text-[9px] font-bold uppercase tracking-wide text-basalt/40">{dt.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }).slice(0, 2)}</div>
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
                    const weekend = [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay());
                    const past = d < today;
                    const p = rBase > 0 && !past ? priceOn(d) : null;
                    return (
                      <div key={d} className={cn("absolute top-0 h-full border-r border-basalt/8", weekend && "bg-basalt/[0.02]", d === today && "bg-apricot/[0.06]")} style={{ left: i * CELL_W, width: CELL_W }}>
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
      <p className="mt-3 text-xs text-basalt/45">Showing {startDate} → {addDaysIso(windowEnd, -1)}. Bars are your bookings; hatched blocks are dates synced as unavailable from a connected calendar. Tap a booking for full details.</p>
      <BookingDetailDialog bookingId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
