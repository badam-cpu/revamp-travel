/**
 * Bookings → Calendar: every listing's prices and availability on one grid,
 * Airbnb multi-calendar style. Rows are listings (a hotel opens into its room
 * types), columns are days; each sellable day shows its price, a day that can't
 * be sold (booked here, booked on another channel, blocked, or a full room
 * type) is a grey cell with a diagonal stroke.
 *
 * Select one day, or drag / Shift+click across several in a row, and a panel
 * opens on the right (desktop) to set the price for those dates, go back to the
 * base price, or block / open them. Below desktop width the selection shows in
 * a bar at the bottom and "Edit" opens the same panel as a bottom sheet. Touch
 * never selects on touch-down (that would fight scrolling the grid): a tap
 * picks a day, and a second tap in the same row makes it a range. The same
 * writes as the single-listing calendar (PricingCalendar):
 *   - listing: seasonal_rates (per-date price) + manual_blocked_ranges
 *   - hotel room type (0100): room_types.seasonal_rates, and a block closes
 *     each room of the type (room_units.manual_blocked_ranges)
 * Ranges are end-exclusive for blocks, end-inclusive for rates (as stored).
 * Per-room prices and the minimum stay live in the single-listing calendar,
 * opened from the listing's name.
 *
 * Keyboard: an ARIA grid — arrows move, Shift+arrows extend the selection,
 * Enter/Space selects, Esc clears.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings, type BlockedRange, type LiveListing } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { applyGrouping, CalendarLegend, CalendarToolbar, GROUP_OPTIONS, groupOptionsFor, monthsOf, remember, remembered, rollingDays, ToolbarSelect, useColumnWindow, useCompactPrice, useHoldToDrag, type GroupBy, type TypeFilter } from "@/components/CalendarToolbar";
import { fetchRoomTypes, updateRoomTypeRates, updateRoomUnitCalendar } from "@/lib/roomTypes";
import { userMessage } from "@/lib/api";
import type { RoomType, RoomUnit, SeasonalRate } from "@shared/listings";
import { isSuspendedOn } from "@shared/listings";
import { eventsOn, useEvents } from "@/lib/events";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const CELL_W = 72; // px per day
const ROW_H = 64;
const DAYS_BACK = 1; // yesterday, faded — like Airbnb
const COLLAPSE_KEY = "revamp.calendarCollapsed";
const PAGE_KEY = "revamp.calendarPage"; // new key: everyone starts at the default of 5
const GROUP_KEY = "revamp.calendarGroup"; // new key: "Room type" now shows only multi-room properties
const PAGE_SIZES = [5, 20, 50, 100] as const; // 5 = the smallest and the default
type PageSize = (typeof PAGE_SIZES)[number];

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
const covers = (r: BlockedRange, d: string) => r.start <= d && d < r.end;
const fmtDay = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** A rate list with the days [s, e] (inclusive) taken out — partial overlaps are trimmed, not dropped. */
export function withoutDays(rates: SeasonalRate[], s: string, e: string): SeasonalRate[] {
  const out: SeasonalRate[] = [];
  for (const r of rates) {
    if (r.end < s || r.start > e) {
      out.push(r);
      continue;
    }
    if (r.start < s) out.push({ ...r, end: addDaysIso(s, -1) });
    if (r.end > e) out.push({ ...r, start: addDaysIso(e, 1) });
  }
  return out;
}
/** Block or open the days [s, e] (inclusive) in end-exclusive ranges; `skip` days are left alone. */
function setBlocked(ranges: BlockedRange[], s: string, e: string, block: boolean, skip: (d: string) => boolean = () => false): BlockedRange[] {
  const set = new Set<string>();
  for (const r of ranges) for (let d = r.start; d < r.end; d = addDaysIso(d, 1)) set.add(d);
  for (let d = s; d <= e; d = addDaysIso(d, 1)) if (!skip(d)) (block ? set.add(d) : set.delete(d));
  const out: BlockedRange[] = [];
  for (const d of Array.from(set).sort()) {
    const last = out[out.length - 1];
    if (last && last.end === d) last.end = addDaysIso(d, 1);
    else out.push({ start: d, end: addDaysIso(d, 1) });
  }
  return out;
}

interface Bk {
  start_date: string;
  end_date: string;
  listing_id: string;
  room_unit_id: string | null;
}

/** What a day in a row is: sellable (with a price) or not, and why. */
interface DayState {
  sellable: boolean;
  why?: "booked" | "synced" | "blocked" | "full" | "suspended" | "inactive";
  /** Tours/experiences: bookings that day (the day stays sellable). Hotels: rooms free. */
  note?: string;
  cents: number;
  custom: boolean;
  /** Blocked by the operator (can be opened again). */
  blocked: boolean;
  /** Booked here (can't be blocked/opened from this view). */
  booked: boolean;
}

/** A selectable calendar row: a listing, or a hotel's room type. */
interface CalRow {
  key: string;
  listing: LiveListing;
  type?: RoomType;
  label: string;
  sub: string;
  unit: string; // "night" | "person" …
  base: number;
  rates: SeasonalRate[];
  day: (d: string) => DayState;
}

function useIsDesktop() {
  const [desk, setDesk] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const f = () => setDesk(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return desk;
}
function useNameWidth(): number {
  const [w, setW] = useState(240);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const f = () => setW(mq.matches ? 132 : 240);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return w;
}

export function OperatorMultiCalendar({ onOpenListing }: { onOpenListing: (l: LiveListing) => void }) {
  const { user } = useAuth();
  const { listings, setSeasonalRates, setManualBlocks } = useListings();
  const compact = useCompactPrice();
  const desktop = useIsDesktop();
  const nameW = useNameWidth();
  const narrow = nameW < 200;
  const today = todayIso();
  const startDate = useMemo(() => addDaysIso(todayIso(), -DAYS_BACK), []);
  // Rolling two years: through the same month two years ahead.
  const DAYS = useMemo(() => rollingDays(startDate), [startDate]);
  const windowEnd = addDaysIso(startDate, DAYS);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDaysIso(startDate, i)), [startDate, DAYS]);
  // Holidays / festivals / concerts on each day (0102) — a dot in the date header.
  const events = useEvents(startDate, windowEnd);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [pageSize, setPageSize] = useState<PageSize>(() => remembered<PageSize>(PAGE_KEY, PAGE_SIZES, 5));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => remembered<GroupBy>(GROUP_KEY, GROUP_OPTIONS.map((g) => g.value), "none"));
  const [page, setPage] = useState(0);
  const [bookings, setBookings] = useState<Bk[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [roomsByHotel, setRoomsByHotel] = useState<Map<string, RoomType[]>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (k: string) =>
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

  const allMine = useMemo(() => listings.filter((l) => l.operatorId === user?.id && l.type !== "eat").sort((a, b) => a.title.localeCompare(b.title)), [listings, user?.id]);
  const mine = useMemo(() => (typeFilter === "all" ? allMine : allMine.filter((l) => l.type === typeFilter)), [allMine, typeFilter]);
  // Group (section headings), then page through the listings — a hotel counts as one.
  const groupChoices = useMemo(() => groupOptionsFor(typeFilter, allMine), [typeFilter, allMine]);
  // A remembered choice that doesn't fit this filter (e.g. Room type on Tours) falls back to None.
  const group: GroupBy = groupChoices.some((o) => o.value === groupBy) ? groupBy : "none";
  const { ordered, key: groupKey } = useMemo(() => applyGrouping(mine, group), [mine, group]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const pageNow = Math.min(page, pageCount - 1);
  const paged = useMemo(() => ordered.slice(pageNow * pageSize, (pageNow + 1) * pageSize), [ordered, pageNow, pageSize]);
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

  useEffect(() => {
    if (!user) return;
    let live = true;
    setLoadError(false);
    supabase
      .from("bookings")
      .select("start_date, end_date, listing_id, room_unit_id, listings!inner(operator_id)")
      .eq("listings.operator_id", user.id)
      .in("status", ["pending_payment", "awaiting_payment", "confirmed", "completed"])
      .gt("end_date", startDate)
      .lt("start_date", windowEnd)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          console.error("[calendar] bookings load failed", error.message);
          setLoadError(true);
          setBookings([]);
          return;
        }
        setBookings((data ?? []) as unknown as Bk[]);
      });
    return () => {
      live = false;
    };
  }, [user, reload, startDate, windowEnd]);

  const hotelIds = useMemo(() => allMine.filter((l) => l.type === "stay" && l.multiRoom).map((l) => l.id).join(","), [allMine]);
  useEffect(() => {
    const ids = hotelIds ? hotelIds.split(",") : [];
    if (!ids.length) return;
    let live = true;
    Promise.all(ids.map(async (id) => [id, await fetchRoomTypes(id)] as const))
      .then((pairs) => live && setRoomsByHotel(new Map(pairs)))
      .catch((e) => console.error("[calendar] rooms load failed", e));
    return () => {
      live = false;
    };
  }, [hotelIds, reload]);
  const saveType = (listingId: string, type: RoomType) =>
    setRoomsByHotel((prev) => new Map(prev).set(listingId, (prev.get(listingId) ?? []).map((t) => (t.id === type.id ? type : t))));
  const saveUnit = (listingId: string, unit: RoomUnit) =>
    setRoomsByHotel((prev) => new Map(prev).set(listingId, (prev.get(listingId) ?? []).map((t) => (t.id === unit.roomTypeId ? { ...t, units: t.units.map((u) => (u.id === unit.id ? unit : u)) } : t))));

  // ── Rows ────────────────────────────────────────────────────────────────────
  type Group = { listing: LiveListing; rows: CalRow[]; hotel?: { rooms: number; free: (d: string) => number } };
  const groups: Group[] = useMemo(() => {
    const bks = bookings ?? [];
    return paged.map((listing): Group => {
      const mineBks = bks.filter((b) => b.listing_id === listing.id);
      const priceOf = (rates: SeasonalRate[], base: number, d: string) => {
        const m = rates.filter((r) => r.start <= d && d <= r.end).pop();
        return { cents: m ? m.priceCents : base, custom: Boolean(m) };
      };
      const types = listing.multiRoom ? (roomsByHotel.get(listing.id) ?? []).filter((t) => t.units.some((u) => u.active)) : [];
      if (types.length) {
        const unitFree = (u: RoomUnit, d: string) =>
          !mineBks.some((b) => b.room_unit_id === u.id && covers({ start: b.start_date, end: b.end_date }, d)) && !(u.blockedRanges ?? []).some((r) => covers(r, d)) && !u.manualBlockedRanges.some((r) => covers(r, d));
        const all = types.flatMap((t) => t.units.filter((u) => u.active));
        return {
          listing,
          hotel: { rooms: all.length, free: (d) => all.filter((u) => unitFree(u, d)).length },
          rows: types.map((type): CalRow => {
            const units = type.units.filter((u) => u.active);
            const rates = type.seasonalRates ?? [];
            return {
              key: `type:${type.id}`,
              listing,
              type,
              label: type.name,
              sub: `${units.length} room${units.length === 1 ? "" : "s"}`,
              unit: "night",
              base: type.priceCents,
              rates,
              day: (d) => {
                const free = units.filter((u) => unitFree(u, d)).length;
                const allBlocked = units.every((u) => u.manualBlockedRanges.some((r) => covers(r, d)));
                const p = priceOf(rates, type.priceCents, d);
                const off = listing.isActive === false ? "inactive" : isSuspendedOn(listing, d) ? "suspended" : null;
                return {
                  sellable: free > 0 && !off,
                  why: off ?? (free > 0 ? undefined : allBlocked ? "blocked" : "full"),
                  note: free > 0 ? `${free} free` : undefined,
                  ...p,
                  blocked: allBlocked,
                  booked: false,
                };
              },
            };
          }),
        };
      }
      const isStay = listing.type === "stay";
      const rates = listing.seasonalRates ?? [];
      const base = Math.round(listing.price * 100);
      return {
        listing,
        rows: [
          {
            key: `listing:${listing.id}`,
            listing,
            label: listing.title,
            sub: (isStay ? "Stay" : listing.type === "tour" ? "Tour" : "Experience") + (listing.isActive === false ? " · Inactive" : ""),
            unit: isStay ? "night" : listing.priceUnit || "person",
            base,
            rates,
            day: (d) => {
              const onDay = mineBks.filter((b) => covers({ start: b.start_date, end: b.end_date > b.start_date ? b.end_date : addDaysIso(b.start_date, 1) }, d));
              const synced = (listing.blockedRanges ?? []).some((r) => covers(r, d));
              const blocked = (listing.manualBlockedRanges ?? []).some((r) => covers(r, d));
              // A stay is one unit: a booking takes the night. Tours keep selling — show the count.
              const booked = isStay && onDay.length > 0;
              const why = booked ? "booked" : listing.isActive === false ? "inactive" : isSuspendedOn(listing, d) ? "suspended" : synced ? "synced" : blocked ? "blocked" : undefined;
              return {
                sellable: !why,
                why,
                note: !isStay && onDay.length ? `${onDay.length} booked` : undefined,
                ...priceOf(rates, base, d),
                blocked,
                booked,
              };
            },
          },
        ],
      };
    });
  }, [paged, bookings, roomsByHotel]);
  const visibleRows = useMemo(() => groups.flatMap((g) => (g.hotel && collapsed.has(g.listing.id) ? [] : g.rows)), [groups, collapsed]);

  // ── Selection ───────────────────────────────────────────────────────────────
  const [sel, setSel] = useState<{ key: string; a: string; b: string } | null>(null);
  const dragging = useRef(false);
  // Mouse: pressing a second day sets the END (Airbnb click-click), but if the
  // press turns into a drag, the range starts over from where it was pressed.
  const pressedNew = useRef<{ key: string; d: string } | null>(null);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);
  const selRow = sel ? visibleRows.find((r) => r.key === sel.key) ?? null : null;
  const selStart = sel ? (sel.a < sel.b ? sel.a : sel.b) : null;
  const selEnd = sel ? (sel.a < sel.b ? sel.b : sel.a) : null;
  const inSel = (key: string, d: string) => !!sel && sel.key === key && d >= selStart! && d <= selEnd!;
  // Airbnb-style: with ONE day selected, choosing another day in the same row
  // makes it the other end of a range (no Shift needed); with a range selected,
  // a choice starts over. Shift still extends a range.
  const pick = (key: string, d: string, extend: boolean) => {
    if (d < today) return;
    const single = !!sel && sel.key === key && sel.a === sel.b;
    if ((extend || single) && sel && sel.key === key) setSel({ ...sel, b: d });
    else setSel({ key, a: d, b: d });
  };
  /** From the panel's Start / End date fields. */
  const setRange = (a: string, b: string) => {
    if (!sel) return;
    const last = days[days.length - 1];
    const start = a < today ? today : a > last ? last : a;
    const end = b < start ? start : b > last ? last : b;
    setSel({ key: sel.key, a: start, b: end });
  };
  // Touch/pen: a tap picks a day; a second tap in the same row extends it to a
  // range; tapping the single selected day again clears it.
  const pointerKind = useRef("mouse");
  const tap = (key: string, d: string) => {
    if (d < today) return;
    if (sel && sel.key === key && sel.a === sel.b) setSel(d === sel.a ? null : { ...sel, b: d });
    else setSel({ key, a: d, b: d });
  };
  // Below desktop width the panel is a bottom sheet, opened from the selection bar.
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!sel) setSheetOpen(false);
  }, [sel]);
  // While the phone selection bar is up, the floating Aha AI button (bottom
  // right) would sit on top of "Edit" — it hides via the body class.
  const barShown = !desktop && !!selRow && !sheetOpen;
  useEffect(() => {
    document.body.classList.toggle("cal-selecting", barShown);
    return () => document.body.classList.remove("cal-selecting");
  }, [barShown]);
  useEffect(() => {
    if (!sel) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [sel]);

  // ── Scroll + keyboard ───────────────────────────────────────────────────────
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

  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: DAYS_BACK });
  const focusCell = (r: number, c: number, tries = 0): void => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (!root) return;
    if (!el) {
      // Off-screen days aren't drawn: scroll there, let it render, then focus.
      setActive({ r, c });
      root.scrollLeft = Math.max(0, c * CELL_W - (root.clientWidth - nameW) / 2);
      if (tries < 6) requestAnimationFrame(() => focusCell(r, c, tries + 1));
      return;
    }
    setActive({ r, c });
    el.focus({ preventScroll: true });
    const cr = root.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.left < cr.left + nameW) root.scrollLeft -= cr.left + nameW - er.left + 4;
    else if (er.right > cr.right) root.scrollLeft += er.right - cr.right + 4;
    if (er.top < cr.top + 64) root.scrollTop -= cr.top + 64 - er.top;
    else if (er.bottom > cr.bottom) root.scrollTop += er.bottom - cr.bottom;
  };
  // Only the days near the view are drawn (two years × every row is a lot of cells).
  const { cols, from: colFrom, to: colTo } = useColumnWindow(scrollRef, CELL_W, nameW, DAYS, bookings !== null && !loadError, active.c);
  // Touch: hold a day, then slide along the row to stretch the range.
  const holdDrag = useHoldToDrag(
    scrollRef,
    '[role="gridcell"][data-c]',
    (cell) => {
      const row = visibleRows[Number(cell.dataset.r)];
      const d = days[Number(cell.dataset.c)];
      if (!row || !d || d < today) return false;
      setSel({ key: row.key, a: d, b: d });
      return true;
    },
    (cell) => {
      const key = visibleRows[Number(cell.dataset.r)]?.key;
      const d = days[Number(cell.dataset.c)];
      if (d && d >= today) setSel((x) => (x && x.key === key && x.b !== d ? { ...x, b: d } : x));
    },
    bookings !== null && !loadError,
  );

  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const r = Number(t.dataset.r);
    const c = Number(t.dataset.c);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    const row = visibleRows[r];
    const step = e.ctrlKey || e.metaKey ? 7 : 1;
    let next: [number, number] | null = null;
    if (e.key === "ArrowRight") next = [r, Math.min(DAYS - 1, c + step)];
    else if (e.key === "ArrowLeft") next = [r, Math.max(0, c - step)];
    else if (e.key === "ArrowDown") next = [Math.min(visibleRows.length - 1, r + 1), c];
    else if (e.key === "ArrowUp") next = [Math.max(0, r - 1), c];
    else if (e.key === "Home") next = [r, 0];
    else if (e.key === "End") next = [r, DAYS - 1];
    else if ((e.key === "Enter" || e.key === " ") && row) {
      e.preventDefault();
      pick(row.key, days[c], e.shiftKey);
      return;
    }
    if (next) {
      e.preventDefault();
      if (e.shiftKey && next[0] === r && row) pick(row.key, days[next[1]], true);
      focusCell(next[0], next[1]);
    }
  };

  // ── Saving ──────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const run = async (fn: () => Promise<void>, done: string, fail: string) => {
    setSaving(true);
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast(userMessage(e, fail));
    } finally {
      setSaving(false);
    }
  };
  const saveRates = async (row: CalRow, rates: SeasonalRate[]) => {
    if (row.type) saveType(row.listing.id, { ...row.type, seasonalRates: await updateRoomTypeRates(row.type.id, rates) });
    else await setSeasonalRates(row.listing.id, rates);
  };
  const nightsLabel = (n: number, row: CalRow) => `${n} ${row.listing.type === "stay" ? "night" : "day"}${n === 1 ? "" : "s"}`;
  const selCount = selStart && selEnd ? Math.round((Date.parse(selEnd) - Date.parse(selStart)) / DAY_MS) + 1 : 0;

  const applyPrice = (amd: number) => {
    if (!selRow || !selStart || !selEnd) return;
    const cents = Math.round(amd) * 100;
    const kept = withoutDays(selRow.rates, selStart, selEnd);
    const next = cents === selRow.base ? kept : [...kept, { start: selStart, end: selEnd, priceCents: cents, source: "manual" as const }];
    void run(() => saveRates(selRow, next), `Price saved for ${nightsLabel(selCount, selRow)}.`, "Couldn't save the price.");
  };
  const resetPrice = () => {
    if (!selRow || !selStart || !selEnd) return;
    void run(() => saveRates(selRow, withoutDays(selRow.rates, selStart, selEnd)), "Back to your base price.", "Couldn't reset the price.");
  };
  const applyBlock = (block: boolean) => {
    if (!selRow || !selStart || !selEnd) return;
    const row = selRow;
    void run(
      async () => {
        if (row.type) {
          for (const u of row.type.units.filter((x) => x.active)) {
            saveUnit(row.listing.id, await updateRoomUnitCalendar(u.id, { manualBlockedRanges: setBlocked(u.manualBlockedRanges, selStart, selEnd, block) }));
          }
        } else {
          // A night already booked here stays as it is.
          await setManualBlocks(row.listing.id, setBlocked(row.listing.manualBlockedRanges ?? [], selStart, selEnd, block, (d) => row.day(d).booked));
        }
      },
      `${block ? "Blocked" : "Opened"} ${nightsLabel(selCount, row)}${row.type ? ` for every ${row.type.name}` : ""}.`,
      "Couldn't change the availability.",
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (bookings === null) {
    return (
      <div aria-busy="true" aria-label="Loading your calendar" className="grid gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse bg-chalk" />
        ))}
      </div>
    );
  }
  if (loadError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-basalt/12 bg-chalk px-5 py-4">
        <p className="text-sm text-basalt/80">We couldn't load your calendar. Check your connection and try again.</p>
        <button type="button" onClick={() => setReload((k) => k + 1)} className="rounded-none bg-basalt px-4 py-2 text-sm font-semibold text-paper hover:bg-basalt/90">
          Retry
        </button>
      </div>
    );
  }
  if (allMine.length === 0) {
    return <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Add a listing to manage its prices and availability here.</p>;
  }

  const nameCell = "sticky left-0 z-10 shrink-0 border-r border-basalt/10 bg-paper";
  let rowIdx = -1;

  const dayCells = (row: CalRow) => {
    const r = ++rowIdx;
    return (
      <div role="presentation" className="relative shrink-0" style={{ width: DAYS * CELL_W, height: ROW_H }}>
        {cols.map((i) => {
      const d = days[i];
      const s = row.day(d);
      const past = d < today;
      const selected = inSel(row.key, d);
      const priced = row.base > 0 || s.custom;
      const why = s.why === "booked" ? "Booked" : s.why === "synced" ? "Synced" : s.why === "blocked" ? "Blocked" : s.why === "full" ? "Full" : s.why === "suspended" ? "Suspended" : s.why === "inactive" ? "Inactive" : null;
      const dt = new Date(d + "T00:00:00Z");
      return (
        <div
          key={d}
          role="gridcell"
          data-r={r}
          data-c={i}
          aria-selected={selected}
          tabIndex={active.r === r && active.c === i ? 0 : -1}
          aria-label={`${row.label}, ${fmtDay(d)}, ${why ? why.toLowerCase() : "available"}${priced ? `, ${compact(s.cents)}${s.custom ? " custom price" : ""}` : ""}${s.note ? `, ${s.note}` : ""}`}
          onFocus={() => setActive({ r, c: i })}
          onPointerDown={(e) => {
            pointerKind.current = e.pointerType;
            if (past || e.button !== 0 || e.pointerType !== "mouse") return;
            dragging.current = true;
            pressedNew.current = !e.shiftKey && sel && sel.key === row.key && sel.a === sel.b && sel.a !== d ? { key: row.key, d } : null;
            pick(row.key, d, e.shiftKey);
          }}
          onClick={() => !holdDrag.consumeClick() && pointerKind.current !== "mouse" && tap(row.key, d)}
          onPointerEnter={() => {
            if (!dragging.current || past || sel?.key !== row.key) return;
            const p = pressedNew.current;
            pressedNew.current = null;
            setSel((x) => (p && p.key === row.key ? { key: row.key, a: p.d, b: d } : x ? { ...x, b: d } : x));
          }}
          className={cn(
            "absolute top-0 select-none border-r border-basalt/[0.08] outline-none [-webkit-touch-callout:none] focus-visible:z-[5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apricot",
            i !== 0 && dt.getUTCDate() === 1 && "border-l border-l-basalt/25",
            !s.sellable && "cal-unavail",
            past ? "bg-basalt/[0.02]" : "cursor-pointer hover:bg-basalt/[0.03]",
            selected && "z-[3] bg-paper ring-2 ring-inset ring-basalt",
          )}
          style={{ left: i * CELL_W, width: CELL_W, height: ROW_H }}
        >
          {priced && (s.sellable || selected) && (
            <span className={cn("absolute right-2 top-2 text-[13px] tabular-nums leading-none", past ? "text-basalt/35" : s.custom ? "font-semibold text-apricot" : "text-basalt")}>{compact(s.cents)}</span>
          )}
          {(why || s.note) && !past && (
            <span className={cn("absolute bottom-1.5 left-2 right-1 truncate text-[11px] leading-none", why ? "font-medium text-basalt/70" : "text-basalt/55")}>{why ?? s.note}</span>
          )}
        </div>
      );
        })}
      </div>
    );
  };

  const panel = selRow && selStart && selEnd && (
    <SelectionPanel
      key={sel!.key}
      row={selRow}
      start={selStart}
      end={selEnd}
      minDate={today}
      maxDate={days[days.length - 1]}
      onRange={setRange}
      count={selCount}
      nightsLabel={nightsLabel}
      saving={saving}
      onPrice={applyPrice}
      onReset={resetPrice}
      onBlock={applyBlock}
      onOpenListing={() => onOpenListing(selRow.listing)}
      onClose={() => setSel(null)}
      closable={desktop}
    />
  );

  return (
    <div>
      <CalendarToolbar
        onToday={() => jumpTo(0)}
        months={months}
        viewMonth={viewMonth}
        onMonth={jumpTo}
        types={availableTypes}
        type={typeFilter}
        onType={(t) => {
          setTypeFilter(t);
          setSel(null);
        }}
      >
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <ToolbarSelect
            id="cal-group"
            label="Group by"
            value={group}
            options={groupChoices}
            onChange={(v) => {
              setGroupBy(v);
              setSel(null);
              remember(GROUP_KEY, v);
            }}
          />
          <ToolbarSelect
            id="cal-page-size"
            label="Page size"
            value={pageSize}
            options={PAGE_SIZES.map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => {
              setPageSize(v);
              setSel(null);
              remember(PAGE_KEY, v);
            }}
          />
        </div>
      </CalendarToolbar>
      <CalendarLegend className="text-basalt/60">
        <li className="inline-flex items-center gap-1.5"><span className="text-[13px] tabular-nums text-basalt">֏30k</span> Your price</li>
        <li className="inline-flex items-center gap-1.5"><span className="text-[13px] font-semibold tabular-nums text-apricot">֏35k</span> Custom price for that date</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-apricot" /> Holiday or event (hover or tap the date)</li>
        <li className="inline-flex items-center gap-1.5"><span className="cal-unavail h-4 w-6 border border-basalt/10" /> Not available — booked, synced from another site, or blocked</li>
      </CalendarLegend>

      <div className="flex items-start gap-4">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onKeyDown={onGridKey}
          role="grid"
          aria-label="Prices and availability"
          aria-multiselectable
          className="grid-scroll max-h-[min(78vh,calc(100dvh-210px))] min-w-0 flex-1 overflow-auto overscroll-contain border border-basalt/12 bg-paper"
        >
          <div style={{ width: nameW + DAYS * CELL_W }}>
            {/* Pinned date header */}
            <div role="row" className="sticky top-0 z-20 flex border-b border-basalt/12 bg-paper">
              <div role="columnheader" className={cn(nameCell, "z-30 flex items-end px-3 pb-2 text-[11px] font-semibold text-basalt/60")} style={{ width: nameW }}>
                {allMine.length} listing{allMine.length === 1 ? "" : "s"}
              </div>
              <div aria-hidden className="shrink-0" style={{ width: colFrom * CELL_W }} />
              {days.slice(colFrom, colTo).map((d, k) => {
                const i = colFrom + k;
                const dt = new Date(d + "T00:00:00Z");
                const isToday = d === today;
                const monthStart = i === 0 || dt.getUTCDate() === 1;
                const evs = eventsOn(events, d);
                return (
                  <div key={d} role="columnheader" title={evs.length ? evs.map((e) => e.title).join(" · ") : undefined} onClick={evs.length ? () => toast(`${fmtDay(d)}: ${evs.map((e) => e.title).join(" · ")}`) : undefined} aria-label={`${fmtDay(d)}${isToday ? ", today" : ""}${evs.length ? `, ${evs.map((e) => e.title).join(", ")}` : ""}`} style={{ width: CELL_W }} className={cn("relative flex shrink-0 flex-col items-center pb-1.5 pt-5", evs.length > 0 && "cursor-pointer", monthStart && i !== 0 && "border-l border-l-basalt/25")}>
                    {monthStart && (
                      <span aria-hidden className="absolute left-1.5 top-1 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-basalt">
                        {dt.toLocaleDateString(undefined, { month: "short", year: dt.getUTCMonth() === 0 ? "numeric" : undefined, timeZone: "UTC" })}
                      </span>
                    )}
                    {evs.length > 0 && <span aria-hidden className={cn("absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full", evs.some((e) => e.impact === "high") ? "bg-apricot" : "bg-basalt/40")} />}
                    <span aria-hidden className="text-[11px] font-medium text-basalt/60">{dt.toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" })}</span>
                    <span aria-hidden className={cn("mt-0.5 grid h-7 min-w-7 place-items-center rounded-full px-1 text-sm font-semibold tabular-nums", isToday ? "bg-basalt text-paper" : d < today ? "text-basalt/40" : "text-basalt")}>{dt.getUTCDate()}</span>
                  </div>
                );
              })}
              <div aria-hidden className="shrink-0" style={{ width: (DAYS - colTo) * CELL_W }} />
            </div>

            {groups.map((g, gi) => [
              groupKey(g.listing) && (gi === 0 || groupKey(groups[gi - 1].listing) !== groupKey(g.listing)) ? (
                <div key={`h:${groupKey(g.listing)}`} role="row" className="flex border-b border-basalt/12 bg-chalk">
                  <div role="rowheader" className={cn(nameCell, "bg-chalk px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/70")} style={{ width: nameW }}>
                    {groupKey(g.listing)} <span className="font-semibold normal-case tracking-normal text-basalt/60">· {groupCounts.get(groupKey(g.listing))}</span>
                  </div>
                  <div aria-hidden style={{ width: DAYS * CELL_W }} />
                </div>
              ) : null,
              ((g: Group) => {
              const thumb = g.listing.image && !narrow ? <img src={g.listing.image} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" /> : null;
              const title = (
                <button type="button" onClick={() => onOpenListing(g.listing)} title="Open this listing's calendar" className="block w-full truncate text-left text-sm font-semibold text-basalt hover:text-apricot hover:underline focus-visible:outline-2 focus-visible:outline-apricot">
                  {g.listing.title}
                </button>
              );
              if (!g.hotel) {
                const row = g.rows[0];
                return (
                  <div key={g.listing.id} role="row" className="flex border-b border-basalt/[0.08]">
                    <div role="rowheader" className={cn(nameCell, "flex items-center gap-2.5 px-3")} style={{ width: nameW }}>
                      {thumb}
                      <span className="min-w-0 flex-1">
                        {title}
                        <span className="block truncate text-[11px] text-basalt/60">{row.sub}{row.base > 0 ? ` · per ${row.unit}` : " · rate on request"}</span>
                      </span>
                    </div>
                    {dayCells(row)}
                  </div>
                );
              }
              const open = !collapsed.has(g.listing.id);
              const hotel = g.hotel;
              return (
                <div key={g.listing.id} className="border-b border-basalt/[0.08]">
                  <div role="row" className="flex bg-chalk/50">
                    <div role="rowheader" className={cn(nameCell, "flex items-center gap-2 bg-chalk px-3")} style={{ width: nameW }}>
                      <button type="button" onClick={() => toggle(g.listing.id)} aria-expanded={open} aria-label={open ? "Hide room types" : "Show room types"} className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-basalt/[0.06]">
                        {open ? <ChevronDown className="h-4 w-4 text-basalt/60" /> : <ChevronRight className="h-4 w-4 text-basalt/60" />}
                      </button>
                      {thumb}
                      <span className="min-w-0 flex-1">
                        {title}
                        <span className="block truncate text-[11px] text-basalt/60">Hotel · {hotel.rooms} rooms{g.listing.isActive === false ? " · Inactive" : ""}</span>
                      </span>
                    </div>
                    <div aria-hidden className="shrink-0" style={{ width: colFrom * CELL_W }} />
                    {days.slice(colFrom, colTo).map((d) => {
                      const n = hotel.free(d);
                      return (
                        <div key={d} role="gridcell" aria-label={`${g.listing.title}, ${fmtDay(d)}, ${n} of ${hotel.rooms} rooms free`} className={cn("flex shrink-0 items-center justify-center border-r border-basalt/[0.08] text-[11px] tabular-nums", n === 0 ? "cal-unavail font-medium text-basalt/70" : "text-basalt/60", d < today && "opacity-50")} style={{ width: CELL_W, height: 44 }}>
                          {n === 0 ? "Full" : `${n} free`}
                        </div>
                      );
                    })}
                    <div aria-hidden className="shrink-0" style={{ width: (DAYS - colTo) * CELL_W }} />
                  </div>
                  {open &&
                    g.rows.map((row) => (
                      <div key={row.key} role="row" className="flex border-t border-basalt/[0.06]">
                        <div role="rowheader" className={cn(nameCell, "flex flex-col justify-center pr-3", narrow ? "pl-4" : "pl-12")} style={{ width: nameW }}>
                          <span className="truncate text-sm font-semibold text-basalt">{row.label}</span>
                          <span className="truncate text-[11px] text-basalt/60">{row.sub} · per night</span>
                        </div>
                        {dayCells(row)}
                      </div>
                    ))}
                </div>
              );
            })(g),
            ])}
            <div aria-hidden className="h-16" />
          </div>
        </div>

        {desktop && panel && <aside className="sticky top-4 w-[320px] shrink-0 border border-basalt/12 bg-paper">{panel}</aside>}
      </div>

      {pageCount > 1 && (
        <nav aria-label="Listing pages" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="tabular-nums text-basalt/60">
            {pageNow * pageSize + 1}–{Math.min(ordered.length, (pageNow + 1) * pageSize)} of {ordered.length} listings
          </span>
          <button type="button" onClick={() => { setPage(pageNow - 1); setSel(null); }} disabled={pageNow === 0} aria-label="Previous page" className="grid h-9 w-9 place-items-center rounded-full border border-basalt/15 bg-paper hover:border-basalt/40 disabled:opacity-35">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums text-basalt/70">Page {pageNow + 1} of {pageCount}</span>
          <button type="button" onClick={() => { setPage(pageNow + 1); setSel(null); }} disabled={pageNow >= pageCount - 1} aria-label="Next page" className="grid h-9 w-9 place-items-center rounded-full border border-basalt/15 bg-paper hover:border-basalt/40 disabled:opacity-35">
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}

      {!desktop && panel && !sheetOpen && (
        <>
          {/* Keeps the pager clear of the selection bar. */}
          <div aria-hidden className="h-24" />
          <div role="region" aria-label="Selected dates" className="fixed inset-x-0 bottom-0 z-40 border-t border-basalt/12 bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <div className="mx-auto flex max-w-xl items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {selStart === selEnd ? fmtDay(selStart!) : `${fmtDay(selStart!)} – ${fmtDay(selEnd!)}`}
                  <span className="font-normal text-basalt/60"> · {nightsLabel(selCount, selRow!)}</span>
                </p>
                <p className="truncate text-xs text-basalt/60">{selCount === 1 ? "Tap the end date, or hold a day and slide" : selRow!.type ? `${selRow!.listing.title} · ${selRow!.label}` : selRow!.label}</p>
              </div>
              <button type="button" onClick={() => setSel(null)} className="h-11 shrink-0 px-3 text-sm font-semibold text-basalt/70 hover:text-basalt">
                Clear
              </button>
              <button type="button" onClick={() => setSheetOpen(true)} className="h-11 shrink-0 rounded-none bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90">
                Edit
              </button>
            </div>
          </div>
        </>
      )}

      {!desktop && (
        <Sheet open={sheetOpen && !!panel} onOpenChange={(o) => !o && setSel(null)}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-[14px] p-0">
            <SheetTitle className="sr-only">Edit dates</SheetTitle>
            <SheetDescription className="sr-only">Change the price or availability of the selected dates.</SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** The editor for a selection: dates, availability, price. */
function SelectionPanel({
  row,
  start,
  end,
  count,
  nightsLabel,
  saving,
  onPrice,
  onReset,
  onBlock,
  onOpenListing,
  onClose,
  closable,
  minDate,
  maxDate,
  onRange,
}: {
  row: CalRow;
  start: string;
  end: string;
  minDate: string;
  maxDate: string;
  /** Change the selection from the Start / End date fields. */
  onRange: (start: string, end: string) => void;
  count: number;
  nightsLabel: (n: number, row: CalRow) => string;
  saving: boolean;
  onPrice: (amd: number) => void;
  onReset: () => void;
  onBlock: (block: boolean) => void;
  onOpenListing: () => void;
  onClose: () => void;
  /** The bottom sheet brings its own close button. */
  closable: boolean;
}) {
  const { format } = useCurrency();
  const stats = useMemo(() => {
    let booked = 0, synced = 0, blocked = 0, custom = 0, full = 0;
    const prices = new Set<number>();
    for (let d = start; d <= end; d = addDaysIso(d, 1)) {
      const s = row.day(d);
      if (s.booked) booked++;
      else if (s.why === "synced") synced++;
      else if (s.why === "full") full++;
      if (s.blocked) blocked++;
      if (s.custom) custom++;
      prices.add(s.cents);
    }
    return { booked, synced, blocked, custom, full, price: prices.size === 1 ? Array.from(prices)[0] : null };
  }, [row, start, end]);
  const [price, setPrice] = useState(stats.price ? String(Math.round(stats.price / 100)) : "");
  // The panel stays mounted while the dates change (Start / End fields, clicks in
  // the row): show the new dates' price unless the operator has typed one.
  // A fresh single-day pick starts clean.
  const typed = useRef(false);
  const lastStart = useRef(start);
  useEffect(() => {
    if (count === 1 && start !== lastStart.current) typed.current = false;
    lastStart.current = start;
    if (!typed.current) setPrice(stats.price ? String(Math.round(stats.price / 100)) : "");
  }, [stats.price, start, count]);
  const openable = count - stats.booked;
  const allBlocked = openable > 0 && stats.blocked >= openable;
  const changed = price.trim() !== "" && Math.round(Number(price)) * 100 !== stats.price;
  const amd = Number(price);
  const valid = Number.isFinite(amd) && amd > 0;

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/60">{row.type ? `${row.listing.title} · ${row.label}` : row.label}</p>
          <h2 className="mt-1 font-display text-xl leading-tight tracking-[-0.02em]">
            {start === end ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`}
          </h2>
          <p className="mt-0.5 text-sm text-basalt/60">{nightsLabel(count, row)}</p>
        </div>
        {closable && <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-chalk focus-visible:outline-2 focus-visible:outline-apricot">
          <X className="h-4 w-4" />
        </button>}
      </div>

      {/* Dates — pick the end (or a new start) here, like Airbnb's panel. */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {([
          ["cal-start", "Start date", start, (v: string) => onRange(v, end < v ? v : end)],
          ["cal-end", "End date", end, (v: string) => onRange(start, v)],
        ] as const).map(([id, label, value, change]) => (
          <div key={id} className="min-w-0">
            <label htmlFor={id} className="text-xs font-semibold text-basalt/70">{label}</label>
            <input
              id={id}
              type="date"
              value={value}
              min={id === "cal-end" ? start : minDate}
              max={maxDate}
              onChange={(e) => e.target.value && change(e.target.value)}
              className="mt-1 h-11 w-full min-w-0 rounded-[0.875rem] border border-basalt/15 bg-paper px-3 text-sm font-semibold tabular-nums outline-none focus:border-basalt"
            />
          </div>
        ))}
      </div>
      {count === 1 && <p className="mt-1.5 text-xs text-basalt/60">One day selected. Set an end date, or choose another day in this row.</p>}

      {(stats.booked > 0 || stats.synced > 0 || stats.full > 0) && (
        <p className="mt-3 border-l-2 border-basalt/20 pl-3 text-xs leading-5 text-basalt/70">
          {[
            stats.booked && `${nightsLabel(stats.booked, row)} already booked here — they stay as they are.`,
            stats.synced && `${nightsLabel(stats.synced, row)} booked on another channel (synced calendar).`,
            stats.full && `${nightsLabel(stats.full, row)} with every room taken.`,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}

      {/* Availability */}
      <fieldset className="mt-5" disabled={saving || openable === 0}>
        <legend className="text-sm font-semibold">Availability</legend>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-full border border-basalt/15 p-1">
          {[
            { block: false, label: "Open", on: !allBlocked && stats.blocked === 0 },
            { block: true, label: "Blocked", on: allBlocked },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={o.on}
              onClick={() => !o.on && onBlock(o.block)}
              className={cn("h-9 rounded-full text-sm font-semibold transition-colors disabled:opacity-50", o.on ? "bg-basalt text-paper" : "text-basalt/70 hover:bg-chalk")}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-basalt/60">
          {row.type ? `Blocking closes every ${row.label} on these dates.` : stats.blocked > 0 && !allBlocked ? `${nightsLabel(stats.blocked, row)} of these are blocked.` : "Blocked dates can't be booked on Revamp and are shared with your connected calendars."}
        </p>
      </fieldset>

      {/* Price */}
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && changed) onPrice(amd);
        }}
      >
        <label htmlFor="cal-price" className="text-sm font-semibold">
          Price per {row.unit}
        </label>
        <div className="mt-2 flex items-center rounded-[0.875rem] border border-basalt/15 bg-paper px-4 focus-within:border-basalt">
          <span className="text-base text-basalt/60">֏</span>
          <input
            id="cal-price"
            inputMode="numeric"
            value={price}
            onChange={(e) => {
              typed.current = true;
              setPrice(e.target.value.replace(/[^\d]/g, ""));
            }}
            placeholder={stats.price == null ? "Mixed prices" : ""}
            className="h-12 w-full bg-transparent pl-2 text-base font-semibold tabular-nums outline-none"
          />
        </div>
        <p className="mt-1.5 text-xs text-basalt/60">
          {row.base > 0 ? `Base price ${format(row.base)} per ${row.unit}.` : "No base price set."}
          {stats.custom > 0 && ` ${nightsLabel(stats.custom, row)} use a custom price.`}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={saving || !valid || !changed} className="h-11 rounded-none bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90 disabled:opacity-40">
            {saving ? "Saving…" : "Save price"}
          </button>
          {stats.custom > 0 && row.base > 0 && (
            <button type="button" disabled={saving} onClick={onReset} className="h-11 px-2 text-sm font-semibold text-basalt/70 underline-offset-4 hover:text-basalt hover:underline disabled:opacity-40">
              Use base price
            </button>
          )}
        </div>
      </form>

      <button type="button" onClick={onOpenListing} className="mt-6 text-sm font-semibold text-basalt/70 underline-offset-4 hover:text-apricot hover:underline">
        {row.type ? "Per-room prices & minimum stay →" : row.listing.type === "stay" ? "Minimum stay & full calendar →" : "Open full calendar →"}
      </button>
    </div>
  );
}
