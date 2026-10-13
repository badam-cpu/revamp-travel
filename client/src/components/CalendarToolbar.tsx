/**
 * The toolbar shared by Bookings → Timeline and Bookings → Calendar: a Today
 * button, a month menu that follows the scroll, and the listing-type filter
 * (only when the operator has more than one type). Plus the compact per-night
 * price used in both grids (֏45k / $116).
 */
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
