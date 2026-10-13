/**
 * /admin → Payouts: operators paid directly to their own PayLink (migration
 * 0094). Lists connected accounts (pause/resume) and the monthly commission
 * statements (mark paid with a reference — also how a "Revamp owes you" credit
 * is marked paid out — or waive). Reads under admin RLS; every change goes
 * through an admin-only endpoint.
 */
import { SubHeader } from "@/components/PageHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pause, Play, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { adminMarkStatementPaid, adminSetDirectPaymentsPaused, adminVoidStatement } from "@/lib/api";
import { cn } from "@/lib/utils";

type Name = { display_name: string | null; business_name: string | null } | null;
interface Account {
  operator_id: string;
  status: "active" | "paused" | "disconnected";
  account_hint: string | null;
  connected_at: string;
  paused_reason: string | null;
  profiles: Name;
}
interface Statement {
  id: string;
  operator_id: string;
  period_start: string;
  total_due_cents: number;
  currency: string;
  status: "open" | "sent" | "paid" | "overdue" | "void" | "credit";
  due_date: string | null;
  paid_at: string | null;
  reference: string | null;
  profiles: Name;
}

const fmt = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "AMD", currencyDisplay: "narrowSymbol", maximumFractionDigits: currency === "AMD" ? 0 : 2 }).format(cents / 100);
const nameOf = (p: Name, id: string) => p?.business_name || p?.display_name || id.slice(0, 8);
const month = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

const FILTERS = [
  { key: "due", label: "Due", match: (s: Statement) => s.status === "sent" || s.status === "overdue" || s.status === "open" },
  { key: "credit", label: "Revamp owes", match: (s: Statement) => s.status === "credit" },
  { key: "all", label: "All", match: () => true },
] as const;

export function AdminDirectPayments() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("due");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: a, error }, { data: s }] = await Promise.all([
      supabase.from("operator_payment_accounts").select("operator_id, status, account_hint, connected_at, paused_reason, profiles(display_name, business_name)").order("connected_at", { ascending: false }),
      supabase.from("commission_statements").select("id, operator_id, period_start, total_due_cents, currency, status, due_date, paid_at, reference, profiles(display_name, business_name)").order("period_start", { ascending: false }).limit(300),
    ]);
    if (error) {
      setAccounts([]); // pre-0094 → nothing to show
      return;
    }
    setAccounts((a ?? []) as unknown as Account[]);
    setStatements((s ?? []) as unknown as Statement[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => statements.filter(FILTERS.find((f) => f.key === filter)!.match), [statements, filter]);
  const dueTotal = statements.filter((s) => s.status === "sent" || s.status === "overdue").reduce((a, s) => a + s.total_due_cents, 0);
  const creditTotal = statements.filter((s) => s.status === "credit").reduce((a, s) => a + Math.abs(s.total_due_cents), 0);
  const currency = statements[0]?.currency ?? "AMD";

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast(ok);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update that.");
    } finally {
      setBusy(null);
    }
  };

  if (accounts === null) return <p className="inline-flex items-center gap-2 text-sm text-basalt/55"><Loader2 className="h-4 w-4 animate-spin" /> Loading direct payments…</p>;
  const connected = accounts.filter((a) => a.status !== "disconnected");

  return (
    <section className="mt-12 grid gap-6">
      <SubHeader
        className="mb-0"
        title="Direct payments"
        sub="Operators paid straight to their own PayLink. Commission and add-ons are billed monthly; unpaid statements pause direct payments after 14 days."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border border-basalt/10 bg-paper p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/50">Connected</p><p className="mt-1 font-display text-2xl tabular-nums">{connected.length}</p></div>
        <div className="border border-basalt/10 bg-paper p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/50">Owed to Revamp</p><p className="mt-1 font-display text-2xl tabular-nums">{fmt(dueTotal, currency)}</p></div>
        <div className="border border-basalt/10 bg-paper p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/50">Revamp owes operators</p><p className="mt-1 font-display text-2xl tabular-nums">{fmt(creditTotal, currency)}</p></div>
      </div>

      <div className="border border-basalt/10 bg-paper">
        <p className="border-b border-basalt/10 px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-basalt/55">Connected accounts</p>
        {connected.length === 0 ? (
          <p className="px-4 py-4 text-sm text-basalt/50">No operator has connected their own PayLink yet.</p>
        ) : (
          <ul className="divide-y divide-basalt/8">
            {connected.map((a) => (
              <li key={a.operator_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="font-semibold">{nameOf(a.profiles, a.operator_id)}</span>
                <span className="font-mono text-xs text-basalt/50">{a.account_hint}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", a.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>{a.status}</span>
                {a.status === "paused" && a.paused_reason && <span className="text-xs text-basalt/55">{a.paused_reason}</span>}
                <span className="text-xs text-basalt/45">since {new Date(a.connected_at).toLocaleDateString()}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto rounded-none"
                  disabled={busy === a.operator_id}
                  onClick={() => void act(a.operator_id, () => adminSetDirectPaymentsPaused(a.operator_id, a.status === "active"), a.status === "active" ? "Direct payments paused." : "Direct payments resumed.")}
                >
                  {a.status === "active" ? <><Pause className="mr-1.5 h-3.5 w-3.5" /> Pause</> : <><Play className="mr-1.5 h-3.5 w-3.5" /> Resume</>}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border border-basalt/10 bg-paper">
        <div className="flex flex-wrap items-center gap-2 border-b border-basalt/10 px-4 py-3">
          <p className="mr-auto text-xs font-bold uppercase tracking-[0.12em] text-basalt/55">Commission statements</p>
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} className={cn("rounded-none border px-3 py-1 text-xs font-semibold", filter === f.key ? "border-basalt bg-basalt text-paper" : "border-basalt/15 text-basalt/65 hover:border-basalt/40")}>
              {f.label}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="px-4 py-4 text-sm text-basalt/50">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-basalt/8">
            {visible.map((s) => {
              const open = s.status === "sent" || s.status === "overdue" || s.status === "open" || s.status === "credit";
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-[9rem] font-semibold">{nameOf(s.profiles, s.operator_id)}</span>
                  <span className="text-basalt/60">{month(s.period_start)}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", s.status === "overdue" ? "bg-red-50 text-red-700" : s.status === "credit" ? "bg-sky-50 text-sky-800" : s.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-chalk text-basalt/60")}>
                    {s.status === "credit" ? "Revamp owes" : s.status}
                  </span>
                  {s.due_date && (s.status === "sent" || s.status === "overdue") && <span className="text-xs text-basalt/50">due {s.due_date}</span>}
                  {s.reference && <span className="text-xs text-basalt/45">ref {s.reference}</span>}
                  <span className="ml-auto font-display tabular-nums">{fmt(Math.abs(s.total_due_cents), s.currency)}</span>
                  {open && (
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        className="rounded-none bg-basalt text-paper hover:bg-basalt/90"
                        disabled={busy === s.id}
                        onClick={() => {
                          const ref = window.prompt(s.status === "credit" ? "Reference for the payment to the operator (optional):" : "Payment reference (optional, e.g. bank transfer):") ?? null;
                          if (ref === null) return;
                          void act(s.id, () => adminMarkStatementPaid(s.id, ref || undefined), s.status === "credit" ? "Marked paid out." : "Marked paid.");
                        }}
                      >
                        {s.status === "credit" ? "Mark paid out" : "Mark paid"}
                      </Button>
                      {s.status !== "credit" && (
                        <Button variant="ghost" size="sm" className="rounded-none" disabled={busy === s.id} onClick={() => { if (window.confirm("Waive this statement? Its charges won't be billed again.")) void act(s.id, () => adminVoidStatement(s.id), "Statement waived."); }}>
                          Waive
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
