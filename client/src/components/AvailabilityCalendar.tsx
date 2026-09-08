/**
 * On-brand availability calendar for a listing detail page. Shows a month grid
 * with the host's unavailable dates (synced from their Airbnb iCal — see
 * server/ical.ts) greyed out, and lets a visitor pick a check-in → check-out
 * RANGE. Past and blocked dates can't be endpoints, and a range can't span a
 * blocked night. Selection is a soft "preferred dates" preview only — per the
 * product's honesty rule, no booking is taken here yet.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockedRange } from "@/contexts/ListingsContext";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_MS = 86400000;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function prettyDate(s: string): string {
  return parseIso(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function expandBlocked(ranges: BlockedRange[]): Set<string> {
  const set = new Set<string>();
  for (const range of ranges) {
    const end = parseIso(range.end); // exclusive
    for (const d = parseIso(range.start); d < end; d.setDate(d.getDate() + 1)) {
      set.add(iso(d));
    }
  }
  return set;
}

export function AvailabilityCalendar({ blockedRanges }: { blockedRanges: BlockedRange[] }) {
  const blocked = useMemo(() => expandBlocked(blockedRanges), [blockedRanges]);
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  // A range start..end is valid for a stay if no night in [start, end) is blocked.
  const spansBlocked = (from: string, to: string): boolean => {
    const toDate = parseIso(to);
    for (const d = parseIso(from); d < toDate; d.setDate(d.getDate() + 1)) {
      if (blocked.has(iso(d))) return true;
    }
    return false;
  };

  const onPick = (key: string) => {
    if (!start || (start && end)) {
      setStart(key);
      setEnd(null);
      return;
    }
    // start set, end not set
    if (key <= start || spansBlocked(start, key)) {
      setStart(key); // restart the range at the new click
      setEnd(null);
      return;
    }
    setEnd(key);
  };

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const canGoPrev = new Date(year, month, 1) > new Date(today.getFullYear(), today.getMonth(), 1);
  const monthLabel = view.toLocaleString(undefined, { month: "long", year: "numeric" });
  const nights = start && end ? Math.round((parseIso(end).getTime() - parseIso(start).getTime()) / DAY_MS) : 0;

  return (
    <div className="border border-basalt/12 bg-paper p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          disabled={!canGoPrev}
          onClick={() => setView(new Date(year, month - 1, 1))}
          className="grid h-8 w-8 place-items-center rounded-full text-basalt/60 transition-colors hover:bg-chalk hover:text-basalt disabled:opacity-25 disabled:hover:bg-transparent"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-display text-sm font-semibold tracking-tight">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          className="grid h-8 w-8 place-items-center rounded-full text-basalt/60 transition-colors hover:bg-chalk hover:text-basalt"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-basalt/35">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1.5">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = iso(d);
          const isPast = d < today;
          const isBlocked = blocked.has(key);
          const isDisabled = isPast || isBlocked;
          const isStart = key === start;
          const isEnd = key === end;
          const inRange = Boolean(start && end && key > start && key < end);
          const isEndpoint = isStart || isEnd;
          return (
            <div key={i} className={cn("flex items-center justify-center", (inRange || (isEndpoint && end)) && "bg-apricot/10", isStart && end && "rounded-l-full", isEnd && "rounded-r-full")}>
              <button
                type="button"
                disabled={isDisabled}
                aria-pressed={isEndpoint}
                onClick={() => onPick(key)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors",
                  isEndpoint
                    ? "bg-apricot font-semibold text-white"
                    : isBlocked
                      ? "text-basalt/30 line-through"
                      : isPast
                        ? "text-basalt/25"
                        : "cursor-pointer text-basalt hover:bg-apricot/20",
                )}
              >
                {d.getDate()}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex min-h-[1.25rem] items-center justify-between text-xs">
        <span className="text-basalt/55">
          {start && end ? (
            <>
              <strong className="font-semibold text-basalt">{nights} {nights === 1 ? "night" : "nights"}</strong> · {prettyDate(start)} → {prettyDate(end)}
            </>
          ) : start ? (
            <>Check-in {prettyDate(start)} — now pick a check-out date.</>
          ) : (
            <span className="text-basalt/45">Select your check-in and check-out dates.</span>
          )}
        </span>
        {(start || end) && (
          <button type="button" onClick={() => { setStart(null); setEnd(null); }} className="font-semibold text-apricot hover:underline">
            Clear
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-basalt/50">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border border-basalt/25" /> Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-basalt/12" /> Unavailable
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-basalt/45">
        Unavailable dates are synced from the host's own calendar. Dates are a guide — no booking is taken on Revamp yet.
      </p>
    </div>
  );
}
