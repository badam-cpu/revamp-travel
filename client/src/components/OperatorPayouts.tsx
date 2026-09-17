/**
 * Operator payouts on /dashboard. Revamp is merchant of record; this shows what
 * Revamp owes/has paid the operator, one row per confirmed booking (see
 * supabase/migrations/0016_payouts.sql). Summary tiles (paid / unpaid / pending),
 * a filterable list, and a Revamp-branded PDF statement (openPayoutStatement).
 * Read-only under RLS (operator reads own); marking paid is admin-only.
 */
import { useEffect, useMemo, useState } from "react";
import { Wallet, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { payoutState, PAYOUT_STATE_LABEL, type Payout, type PayoutState } from "@shared/payouts";
import { openPayoutStatement } from "@/lib/payoutStatement";
import { cn } from "@/lib/utils";

function money(cents: number, currency: string): string {
  const major = cents / 100;
  const n = major % 1 === 0 ? major.toLocaleString() : major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${n}` : currency === "AMD" ? `֏${n}` : `${n} ${currency}`;
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): Payout {
  return {
    id: r.id,
    bookingId: r.booking_id,
    operatorId: r.operator_id,
    listingId: r.listing_id,
    listingTitle: r.listing_title,
    listingType: r.listing_type,
    grossCents: r.gross_cents,
    feeCents: r.fee_cents,
    netCents: r.net_cents,
    currency: r.currency,
    dueDate: r.due_date,
    status: r.status,
    paidAt: r.paid_at,
    reference: r.reference,
    createdAt: r.created_at,
  };
}

const PILL: Record<PayoutState, string> = {
  paid: "bg-sevan/15 text-sevan",
  unpaid: "bg-apricot/15 text-apricot",
  pending: "bg-basalt/10 text-basalt/55",
  cancelled: "bg-destructive/10 text-destructive",
};
const FILTERS: { key: "all" | PayoutState; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "pending", label: "Pending" },
  { key: "paid", label: "Paid" },
];

export function OperatorPayouts() {
  const { user, profile } = useAuth();
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [filter, setFilter] = useState<"all" | PayoutState>("all");
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("payouts")
      .select("*")
      .eq("operator_id", user.id)
      .order("due_date", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Failed to load payouts", error);
          setPayouts([]);
          return;
        }
        setPayouts((data ?? []).map(mapRow));
      });
    return () => {
      active = false;
    };
  }, [user]);

  const totals = useMemo(() => {
    const t = { paid: 0, unpaid: 0, pending: 0 };
    for (const p of payouts ?? []) {
      const st = payoutState(p.status, p.dueDate, today);
      if (st in t) t[st as "paid" | "unpaid" | "pending"] += p.netCents;
    }
    return t;
  }, [payouts, today]);

  const currency = payouts?.[0]?.currency ?? "USD";
  const visible = useMemo(
    () => (payouts ?? []).filter((p) => filter === "all" || payoutState(p.status, p.dueDate, today) === filter),
    [payouts, filter, today],
  );

  // Nothing yet, or table not migrated — stay quiet rather than an empty shell.
  if (payouts === null || payouts.length === 0) return null;

  const operatorName = profile?.businessName || profile?.displayName || "Operator";

  return (
    <section className="mb-12">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-apricot" />
          <h2 className="font-display text-2xl tracking-[-0.02em]">Payouts</h2>
        </div>
        <button
          type="button"
          onClick={() => openPayoutStatement({ operatorName, payouts: visible.length ? visible : payouts, currency })}
          className="inline-flex items-center gap-2 border border-basalt/20 px-3 py-2 text-sm font-semibold hover:border-apricot hover:text-apricot"
        >
          <Download className="h-4 w-4" /> Download statement (PDF)
        </button>
      </div>

      <p className="mb-4 max-w-2xl text-sm text-basalt/55">
        Revamp collects payment and pays you separately — stays the day after check-in, tours &amp; experiences monthly.
      </p>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {([
          { key: "paid", label: "Paid", v: totals.paid },
          { key: "unpaid", label: "Unpaid (due)", v: totals.unpaid },
          { key: "pending", label: "Pending", v: totals.pending },
        ] as const).map((t) => (
          <div key={t.key} className={cn("border bg-paper p-4", t.key === "unpaid" ? "border-apricot/40" : "border-basalt/10")}>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/45">{t.label}</p>
            <p className="mt-1 font-display text-3xl font-normal">{money(t.v, currency)}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "border px-3 py-1.5 text-xs font-semibold transition-colors",
              filter === f.key ? "border-apricot bg-apricot/5 text-apricot" : "border-basalt/15 text-basalt/55 hover:border-basalt/30",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        {visible.map((p) => {
          const st = payoutState(p.status, p.dueDate, today);
          return (
            <div key={p.id} className="grid gap-2 border border-basalt/10 bg-paper p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]", PILL[st])}>{PAYOUT_STATE_LABEL[st]}</span>
                <h3 className="mt-1.5 font-semibold">{p.listingTitle}</h3>
                <p className="mt-0.5 text-sm text-basalt/55">
                  {p.listingType} · {st === "paid" && p.paidAt ? `Paid ${fmtDate(p.paidAt.slice(0, 10))}` : `${st === "unpaid" ? "Due" : "Scheduled"} ${fmtDate(p.dueDate)}`}
                </p>
              </div>
              <p className="text-right font-display text-xl font-normal">{money(p.netCents, p.currency)}</p>
            </div>
          );
        })}
        {visible.length === 0 && <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-8 text-center text-sm text-basalt/55">No {filter} payouts.</p>}
      </div>
    </section>
  );
}
