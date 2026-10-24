/**
 * Operator analytics — a compact monthly bar chart of bookings or generated
 * revenue over the last 12 months, with a listing-type filter and a date-basis
 * filter (Booked / Check-in / Check-out / Cancelled). Reads the operator's own
 * bookings (RLS-scoped) client-side and buckets them by month.
 *
 * Revenue is normalized to AMD (old USD bookings converted at the display rate)
 * and formatted through the currency toggle. "Booked/Check-in/Check-out" count
 * confirmed + completed bookings; "Cancelled" counts cancelled + refunded.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

interface Row {
  created_at: string;
  start_date: string;
  end_date: string;
  amount_cents: number;
  currency: string;
  status: string;
  listings: { type: string } | null;
}

type Metric = "bookings" | "revenue";
type Basis = "booked" | "checkin" | "checkout" | "cancelled";
type TypeFilter = "all" | "stay" | "tour" | "experience";

const BASES: { key: Basis; label: string }[] = [
  { key: "booked", label: "Booked" },
  { key: "checkin", label: "Check-in" },
  { key: "checkout", label: "Check-out" },
  { key: "cancelled", label: "Cancelled" },
];
const TYPES: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "stay", label: "Stays" },
  { key: "tour", label: "Tours" },
  { key: "experience", label: "Experiences" },
];

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
function monthLabel(key: string, withYear = false): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", withYear ? { month: "short", year: "numeric" } : { month: "short" });
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-10 shrink-0 rounded-full px-3.5 text-xs font-semibold transition-colors sm:h-auto sm:px-3 sm:py-1.5",
        active ? "bg-basalt text-paper" : "border border-basalt/15 bg-paper text-basalt/60 hover:text-basalt",
      )}
    >
      {children}
    </button>
  );
}

export function OperatorAnalytics() {
  const { user } = useAuth();
  const { format, rate } = useCurrency();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [metric, setMetric] = useState<Metric>("bookings");
  const [basis, setBasis] = useState<Basis>("booked");
  const [type, setType] = useState<TypeFilter>("all");
  // Tapped month — its value shows under the total (the bar title is hover-only).
  const [selMonth, setSelMonth] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("bookings")
      .select("created_at, start_date, end_date, amount_cents, currency, status, listings!inner(type, operator_id)")
      .eq("listings.operator_id", user.id)
      .limit(1000)
      .then(({ data, error }) => {
        if (!active) return;
        setRows(error ? [] : ((data ?? []) as unknown as Row[]));
      });
    return () => {
      active = false;
    };
  }, [user]);

  const months = useMemo(() => lastMonths(12), []);
  const { buckets, total } = useMemo(() => {
    const map: Record<string, number> = {};
    months.forEach((m) => (map[m] = 0));
    let total = 0;
    for (const r of rows ?? []) {
      if (type !== "all" && r.listings?.type !== type) continue;
      const isCancelled = r.status === "cancelled" || r.status === "refunded";
      const isReal = r.status === "confirmed" || r.status === "completed";
      let dateIso: string | undefined;
      if (basis === "cancelled") dateIso = isCancelled ? r.created_at?.slice(0, 10) : undefined;
      else if (basis === "booked") dateIso = isReal ? r.created_at?.slice(0, 10) : undefined;
      else if (basis === "checkin") dateIso = isReal ? r.start_date : undefined;
      else dateIso = isReal ? r.end_date : undefined;
      if (!dateIso) continue;
      const key = dateIso.slice(0, 7);
      if (!(key in map)) continue;
      const amdCents = r.currency === "USD" ? Math.round(r.amount_cents * (rate || 1)) : r.amount_cents;
      const val = metric === "bookings" ? 1 : amdCents;
      map[key] += val;
      total += val;
    }
    return { buckets: months.map((m) => ({ month: m, value: map[m] })), total };
  }, [rows, months, type, basis, metric, rate]);

  const max = Math.max(1, ...buckets.map((b) => b.value));
  const totalLabel = metric === "revenue" ? format(total) : `${total}`;
  const valueLabel = (v: number) => (metric === "revenue" ? format(v) : `${v} booking${v === 1 ? "" : "s"}`);
  const selBucket = selMonth ? buckets.find((b) => b.month === selMonth) : undefined;

  return (
    <div className="border border-basalt/10 bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-basalt/45">
            {metric === "revenue" ? "Revenue" : "Bookings"} · last 12 months
          </p>
          <p className="mt-1 font-display text-4xl font-normal tabular-nums">{totalLabel}</p>
          {selBucket && (
            <p className="mt-1 text-xs font-semibold tabular-nums text-basalt/60" aria-live="polite">
              {monthLabel(selBucket.month, true)} · {valueLabel(selBucket.value)}
            </p>
          )}
        </div>
        <div className="inline-flex overflow-hidden rounded-full border border-basalt/15">
          {(["bookings", "revenue"] as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={cn("h-10 px-3.5 text-xs font-semibold capitalize transition-colors sm:h-auto sm:py-1.5", metric === m ? "bg-apricot text-white" : "text-basalt/60 hover:text-basalt")}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        <div className="-mx-1 flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <span className="mr-1 shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/35">Type</span>
          {TYPES.map((t) => (
            <Chip key={t.key} active={type === t.key} onClick={() => setType(t.key)}>{t.label}</Chip>
          ))}
        </div>
        <div className="-mx-1 flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <span className="mr-1 shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/35">Date</span>
          {BASES.map((b) => (
            <Chip key={b.key} active={basis === b.key} onClick={() => setBasis(b.key)}>{b.label}</Chip>
          ))}
        </div>
      </div>

      {rows === null ? (
        <p className="mt-8 text-sm text-basalt/45">Loading…</p>
      ) : (
        <div className="mt-8 flex h-44 items-end gap-1.5" role="group" aria-label={`${metric} by month`}>
          {buckets.map((b) => (
            <button
              key={b.month}
              type="button"
              aria-pressed={selMonth === b.month}
              aria-label={`${monthLabel(b.month, true)}: ${valueLabel(b.value)}`}
              onClick={() => setSelMonth((cur) => (cur === b.month ? null : b.month))}
              className="group flex h-full min-w-0 flex-1 flex-col items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot"
            >
              <span className="flex w-full flex-1 items-end">
                <span
                  className={cn("block w-full rounded-t-sm transition-all group-hover:bg-apricot", selMonth === b.month ? "bg-apricot" : "bg-apricot/85")}
                  style={{ height: `${b.value === 0 ? 0 : Math.max(4, (b.value / max) * 100)}%` }}
                  title={`${monthLabel(b.month)}: ${metric === "revenue" ? format(b.value) : b.value}`}
                />
              </span>
              <span className={cn("text-[10px]", selMonth === b.month ? "font-semibold text-basalt" : "text-basalt/40")}>{monthLabel(b.month)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
