/**
 * The toolbar shared by Bookings → Timeline and Bookings → Calendar: a Today
 * button, a month menu that follows the scroll, and the listing-type filter
 * (only when the operator has more than one type). Plus the compact per-night
 * price used in both grids (֏45k / $116).
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

export type TypeFilter = "all" | "stay" | "tour" | "experience";
export interface ToolbarMonth {
  key: string;
  label: string;
  /** Column (day index) the month starts at. */
  offset: number;
}

const TYPE_LABEL: Record<TypeFilter, string> = { all: "All", stay: "Stays", tour: "Tours", experience: "Experiences" };

/** Compact per-night price for tight grid cells (e.g. ֏45k, $116). */
export function useCompactPrice() {
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

/** Months covered by a run of ISO days, with the column each starts at. */
export function monthsOf(days: string[]): ToolbarMonth[] {
  const seen = new Map<string, ToolbarMonth>();
  days.forEach((d, i) => {
    const key = d.slice(0, 7);
    if (!seen.has(key)) seen.set(key, { key, label: new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }), offset: i });
  });
  return Array.from(seen.values());
}

export function CalendarToolbar({
  onToday,
  months,
  viewMonth,
  onMonth,
  types,
  type,
  onType,
  children,
}: {
  onToday: () => void;
  months: ToolbarMonth[];
  viewMonth: string;
  onMonth: (offset: number) => void;
  types: readonly TypeFilter[];
  type: TypeFilter;
  onType: (t: TypeFilter) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={onToday} className="h-10 rounded-full border border-basalt/15 bg-paper px-4 text-sm font-semibold hover:border-basalt/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot">
        Today
      </button>
      <div className="relative inline-flex items-center">
        <select
          aria-label="Month in view"
          value={viewMonth}
          onChange={(e) => {
            const m = months.find((x) => x.key === e.target.value);
            if (m) onMonth(m.offset);
          }}
          className="h-10 min-w-[11rem] appearance-none rounded-full border border-basalt/15 bg-paper pl-4 pr-9 text-sm font-semibold hover:border-basalt/40 focus:border-basalt focus:outline-none"
        >
          {months.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-basalt/70" />
      </div>
      {types.length > 2 && (
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5 sm:ml-2">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => onType(t)}
              className={cn(
                "h-10 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot",
                type === t ? "border-basalt bg-basalt text-paper" : "border-basalt/15 bg-paper text-basalt/70 hover:border-basalt/40 hover:text-basalt",
              )}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * The colour key under the toolbar. Always shown from sm up; on phones it folds
 * behind a "Colour key" toggle so the grid isn't pushed below the fold.
 */
export function CalendarLegend({ children, className }: { children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex h-8 items-center gap-1 text-xs font-semibold text-basalt/60 hover:text-basalt sm:hidden">
        Colour key
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <ul aria-label="Legend" className={cn("flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:flex", open ? "mt-1 flex" : "hidden", className)}>
        {children}
      </ul>
    </div>
  );
}

/** A labelled pill select for the toolbar (Page size, Group by). */
export function ToolbarSelect<T extends string | number>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-basalt/70">{label}</label>
      <div className="relative inline-flex items-center">
        <select
          id={id}
          value={String(value)}
          onChange={(e) => {
            const o = options.find((x) => String(x.value) === e.target.value);
            if (o) onChange(o.value);
          }}
          className="h-10 appearance-none rounded-full border border-basalt/15 bg-paper pl-4 pr-9 text-sm font-semibold hover:border-basalt/40 focus:border-basalt focus:outline-none"
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-basalt/70" />
      </div>
    </div>
  );
}

/** Read a remembered choice (private mode / bad value → fallback). */
export function remembered<T>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const v = raw == null ? null : (JSON.parse(raw) as T);
    return v != null && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
export function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — not remembered */
  }
}

/**
 * Group by (timeline + calendar). Only the choices that make sense for what's
 * shown are offered: "Room type" needs a multi-room property (hotel /
 * guesthouse) in view — and then shows ONLY those, rooms grouped under their
 * room types; "Listing type" needs the All filter and more than one type.
 */
export const GROUP_OPTIONS = [
  { value: "none", label: "None" },
  { value: "roomType", label: "Room type" },
  { value: "listingType", label: "Listing type" },
  { value: "city", label: "City" },
] as const;
export type GroupBy = (typeof GROUP_OPTIONS)[number]["value"];
const TYPE_HEADING: Record<string, string> = { stay: "Stays", tour: "Tours", experience: "Experiences" };

export function groupOptionsFor(type: TypeFilter, listings: readonly { type: string; multiRoom?: boolean }[]) {
  const shown = type === "all" ? listings : listings.filter((l) => l.type === type);
  const hasHotels = shown.some((l) => l.type === "stay" && l.multiRoom);
  const types = new Set(shown.map((l) => l.type));
  return GROUP_OPTIONS.filter((o) => (o.value === "roomType" ? hasHotels : o.value === "listingType" ? type === "all" && types.size > 1 : true));
}
/** The listings to show for a grouping, and each one's section heading ("" = none). */
export function applyGrouping<L extends { type: string; multiRoom?: boolean; city: string; title: string }>(listings: L[], group: GroupBy): { ordered: L[]; key: (l: L) => string } {
  const key = (l: L) => (group === "listingType" ? TYPE_HEADING[l.type] ?? l.type : group === "city" ? l.city || "No city" : "");
  if (group === "roomType") return { ordered: listings.filter((l) => l.type === "stay" && l.multiRoom), key };
  if (group === "none") return { ordered: listings, key };
  return { ordered: [...listings].sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title)), key };
}

/**
 * Rolling two-year window: days from `startIso` to the end of the same month two
 * years ahead (Oct 2026 → through Oct 2028).
 */
export function rollingDays(startIso: string): number {
  const d = new Date(startIso + "T00:00:00Z");
  const endExclusive = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 25, 1);
  return Math.round((endExclusive - Date.parse(startIso + "T00:00:00Z")) / 86_400_000);
}

/**
 * Which day columns to draw: the ones in view plus a buffer either side
 * (two years × every row would be tens of thousands of cells). Snapped to
 * blocks of 14 so scrolling re-renders only every couple of weeks of travel.
 * `keep` (the keyboard's active column) is always drawn so the grid stays
 * reachable with Tab.
 */
export function useColumnWindow(ref: RefObject<HTMLElement | null>, cellW: number, nameW: number, total: number, ready: boolean, keep: number): { cols: number[]; from: number; to: number } {
  const BLOCK = 14;
  const [win, setWin] = useState({ from: 0, to: Math.min(total, BLOCK * 4) });
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const first = el.scrollLeft / cellW;
      const last = (el.scrollLeft + Math.max(0, el.clientWidth - nameW)) / cellW;
      const from = Math.max(0, Math.floor((first - BLOCK) / BLOCK) * BLOCK);
      const to = Math.min(total, Math.ceil((last + BLOCK) / BLOCK) * BLOCK);
      setWin((w) => (w.from === from && w.to === to ? w : { from, to }));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    el.addEventListener("scroll", on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", on);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, cellW, nameW, total, ready]);
  return useMemo(() => {
    const cols: number[] = [];
    for (let i = win.from; i < win.to; i++) cols.push(i);
    if (keep >= 0 && keep < total && (keep < win.from || keep >= win.to)) cols.push(keep);
    return { cols, from: win.from, to: win.to };
  }, [win, keep, total]);
}

/**
 * Touch range-drag for the calendars: press and HOLD a day (~0.35 s), then slide
 * to stretch the selection. A quick swipe still scrolls — the hold is what tells
 * the two apart, so dragging never fights scrolling. While a drag is on, the
 * page/grid doesn't scroll (touchmove is cancelled), and the grid scrolls itself
 * when the finger nears its left/right edge. Cells are found with
 * `cellSelector` under the finger. `onStart` returns false for a day that can't
 * be picked. Call `consumeClick()` in the cell's onClick: true = the tap was the
 * end of a hold/drag and must be ignored.
 */
export function useHoldToDrag(
  ref: RefObject<HTMLElement | null>,
  cellSelector: string,
  onStart: (cell: HTMLElement) => boolean,
  onMove: (cell: HTMLElement) => void,
  /** False while the grid isn't mounted yet (loading skeleton). */
  ready = true,
): { consumeClick: () => boolean } {
  const cb = useRef({ onStart, onMove });
  cb.current = { onStart, onMove };
  const swallow = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    let timer = 0;
    let active = false;
    let x0 = 0;
    let y0 = 0;
    let cell: HTMLElement | null = null;
    const clear = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return clear();
      const t = e.touches[0];
      cell = (e.target as HTMLElement).closest(cellSelector);
      if (!cell) return;
      x0 = t.clientX;
      y0 = t.clientY;
      clear();
      timer = window.setTimeout(() => {
        timer = 0;
        if (cell && cb.current.onStart(cell)) {
          active = true;
          navigator.vibrate?.(8);
        }
      }, 350);
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!active) {
        if (timer && Math.hypot(t.clientX - x0, t.clientY - y0) > 10) clear(); // a swipe: let it scroll
        return;
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth) {
        if (t.clientX > r.right - 40) el.scrollLeft += 14;
        else if (t.clientX < r.left + 40) el.scrollLeft -= 14;
      }
      const under = document.elementFromPoint(t.clientX, t.clientY)?.closest(cellSelector) as HTMLElement | null;
      if (under && el.contains(under)) cb.current.onMove(under);
    };
    const end = () => {
      clear();
      if (active) {
        active = false;
        swallow.current = true;
        window.setTimeout(() => (swallow.current = false), 400);
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      clear();
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [ref, cellSelector, ready]);
  return {
    consumeClick: () => {
      if (!swallow.current) return false;
      swallow.current = false;
      return true;
    },
  };
}
