/**
 * Dashboard → Billing: monthly commission statements for operators paid
 * directly to their own PayLink (migration 0094). Reads the operator's own
 * statements + this month's running charges under RLS; paying opens the
 * statement's PayLink link (Revamp's account). Back from paying
 * (?statement=return) it asks the server to verify right away. Renders nothing
 * for operators who've never used direct payments.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { confirmCommissionStatements } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Statement {
  id: string;
  period_start: string;
  commission_cents: number;
  addons_cents: number;
  gift_credit_cents: number;
  adjustment_cents: number;
  total_due_cents: number;
  currency: string;
  status: "open" | "sent" | "paid" | "overdue" | "void" | "credit";
  due_date: string | null;
  pay_url: string | null;
  paid_at: string | null;
}

const fmt = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "AMD", currencyDisplay: "narrowSymbol", maximumFractionDigits: currency === "AMD" ? 0 : 2 }).format(cents / 100);
const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });

const STATUS: Record<Statement["status"], { label: string; cls: string }> = {
  open: { label: "Preparing", cls: "bg-chalk text-basalt/60" },
  sent: { label: "Due", cls: "bg-apricot/10 text-apricot" },
  overdue: { label: "Overdue", cls: "bg-red-50 text-red-700" },
  paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700" },
  credit: { label: "Revamp owes you", cls: "bg-sky-50 text-sky-800" },
  void: { label: "Waived", cls: "bg-chalk text-basalt/50" },
};

export function CommissionStatements() {
  const { user } = useAuth();
  const [statements, setStatements] = useState<Statement[] | null>(null);
  const [running, setRunning] = useState<{ due: number; count: number; currency: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: s, error }, { data: open }] = await Promise.all([
      supabase.from("commission_statements").select("*").eq("operator_id", user.id).order("period_start", { ascending: false }).limit(24),
      supabase.from("direct_payment_ledger").select("net_due_cents, currency").eq("operator_id", user.id).eq("status", "open"),
    ]);
    if (error) {
      setStatements([]); // table not there yet (pre-0094) → render nothing
      return;
    }
    setStatements((s ?? []) as Statement[]);
    const rows = (open ?? []) as { net_due_cents: number; currency: string }[];
    setRunning(rows.length ? { due: rows.reduce((a, r) => a + r.net_due_cents, 0), count: rows.length, currency: rows[0].currency } : null);
  }, [user]);

  useEffect(() => {
    void load();
    // Back from paying a statement → verify now instead of waiting for the cron.
    if (new URLSearchParams(window.location.search).get("statement") === "return") {
      setChecking(true);
      confirmCommissionStatements()
        .then((r) => {
          if (r.paid > 0) toast("Payment received — thank you.");
          void load();
        })
        .catch(() => {})
        .finally(() => setChecking(false));
    }
  }, [load]);

  const outstanding = useMemo(() => (statements ?? []).filter((s) => s.status === "sent" || s.status === "overdue"), [statements]);

  if (statements === null) return null;
  if (statements.length === 0 && !running) return null;

  return (
    <section className="grid gap-5 border border-basalt/12 bg-paper p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-apricot/10 text-apricot"><Receipt className="h-5 w-5" /></div>
        <div>
          <p className="font-display text-lg leading-tight">Commission statements</p>
          <p className="mt-1 text-sm text-basalt/60">For bookings guests paid straight to your PayLink. Issued on the 1st, due within 14 days.</p>
        </div>
        {checking && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-basalt/55"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking payment…</span>}
      </div>

      {(outstanding.length > 0 || running) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {outstanding.length > 0 && (
            <div className="border border-apricot/30 bg-apricot/5 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-apricot">Due now</p>
              <p className="mt-1 font-display text-2xl tabular-nums">{fmt(outstanding.reduce((a, s) => a + s.total_due_cents, 0), outstanding[0].currency)}</p>
              <p className="mt-0.5 text-xs text-basalt/60">{outstanding.length} statement{outstanding.length === 1 ? "" : "s"}</p>
            </div>
          )}
          {running && (
            <div className="border border-basalt/10 bg-chalk/60 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/55">This month so far</p>
              <p className="mt-1 font-display text-2xl tabular-nums">{fmt(running.due, running.currency)}</p>
              <p className="mt-0.5 text-xs text-basalt/60">{running.count} payment{running.count === 1 ? "" : "s"} · billed on the 1st</p>
            </div>
          )}
        </div>
      )}

      {statements.length > 0 && (
        <ul className="grid divide-y divide-basalt/8 border-t border-basalt/10">
          {statements.map((s) => {
            const st = STATUS[s.status];
            const payable = (s.status === "sent" || s.status === "overdue") && s.pay_url;
            return (
              <li key={s.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{monthLabel(s.period_start)}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", st.cls)}>{st.label}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-basalt/60">
                    Commission {fmt(s.commission_cents, s.currency)}
                    {s.addons_cents ? ` · add-ons ${fmt(s.addons_cents, s.currency)}` : ""}
                    {s.gift_credit_cents ? ` · gift cards −${fmt(s.gift_credit_cents, s.currency)}` : ""}
                    {s.adjustment_cents ? ` · cancellations −${fmt(Math.abs(s.adjustment_cents), s.currency)}` : ""}
                    {s.status === "sent" && s.due_date ? ` · due ${dayLabel(s.due_date)}` : ""}
                    {s.status === "paid" && s.paid_at ? ` · paid ${new Date(s.paid_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <p className={cn("font-display text-lg tabular-nums", s.total_due_cents < 0 && "text-sky-800")}>{fmt(Math.abs(s.total_due_cents), s.currency)}</p>
                  {payable && (
                    <Button asChild size="sm" className="rounded-none bg-apricot text-white hover:bg-apricot/90">
                      <a href={s.pay_url as string}>Pay <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
