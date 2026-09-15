/**
 * Admin payouts on /admin — the operations side of operator payouts. Lists all
 * payouts (admins read all under RLS), defaults to the ones that are due
 * ("unpaid"), and lets an admin mark one paid (status=paid + paid_at + optional
 * reference) once Revamp has actually sent the money. Marking paid is the only
 * write; creation happens server-side on booking confirm.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { payoutState, PAYOUT_STATE_LABEL, type PayoutState } from "@shared/payouts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Row {
  id: string;
  listing_title: string;
  listing_type: string;
  net_cents: number;
  currency: string;
  due_date: string;
  status: "pending" | "paid" | "cancelled";
  paid_at: string | null;
  profiles: { display_name: string; business_name: string | null } | null;
}

function money(cents: number, currency: string): string {
  const major = cents / 100;
  const n = major % 1 === 0 ? major.toLocaleString() : major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${n}` : `${n} ${currency}`;
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const PILL: Record<PayoutState, string> = {
  paid: "bg-sevan/15 text-sevan",
  unpaid: "bg-apricot/15 text-apricot",
  pending: "bg-basalt/10 text-basalt/55",
  cancelled: "bg-destructive/10 text-destructive",
};

export function AdminPayouts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<"all" | PayoutState>("unpaid");
  const [busy, setBusy] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("payouts")
      .select("id, listing_title, listing_type, net_cents, currency, due_date, status, paid_at, profiles!operator_id(display_name, business_name)")
      .order("due_date", { ascending: true });
    if (error) {
      console.error("Failed to load payouts", error);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as Row[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markPaid = async (id: string) => {
    const reference = window.prompt("Payment reference (optional) — e.g. bank transfer ID:") ?? "";
    setBusy(id);
    try {
      const { error } = await supabase.from("payouts").update({ status: "paid", paid_at: new Date().toISOString(), reference: reference.trim() || null }).eq("id", id);
      if (error) throw new Error(error.message);
      toast("Payout marked paid.");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't mark it paid.");
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === "all" || payoutState(r.status, r.due_date, today) === filter),
    [rows, filter, today],
  );
  const dueTotal = useMemo(
    () => (rows ?? []).filter((r) => payoutState(r.status, r.due_date, today) === "unpaid").reduce((s, r) => s + r.net_cents, 0),
    [rows, today],
  );

  return (
    <section className="mt-14 border-t border-basalt/10 pt-10">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-apricot" />
        <h2 className="font-display text-3xl tracking-[-0.03em]">Payouts</h2>
      </div>
      <p className="mt-2 max-w-xl text-sm text-basalt/55">
        What Revamp owes operators. <strong className="text-basalt">{money(dueTotal, rows?.[0]?.currency ?? "USD")}</strong> is currently due. Mark a payout paid once you've sent it.
      </p>

      <div className="mt-5 mb-3 flex gap-1.5">
        {(["unpaid", "pending", "paid", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "border px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
              filter === f ? "border-apricot bg-apricot/5 text-apricot" : "border-basalt/15 text-basalt/55 hover:border-basalt/30",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {rows === null ? (
        <p className="text-sm text-basalt/50">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-8 text-center text-sm text-basalt/55">No {filter === "all" ? "" : filter} payouts.</p>
      ) : (
        <div className="grid gap-2">
          {visible.map((r) => {
            const st = payoutState(r.status, r.due_date, today);
            return (
              <div key={r.id} className="grid gap-2 border border-basalt/10 bg-paper p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]", PILL[st])}>{PAYOUT_STATE_LABEL[st]}</span>
                  <h3 className="mt-1.5 font-semibold">{r.profiles?.business_name || r.profiles?.display_name || "Operator"}</h3>
                  <p className="mt-0.5 text-sm text-basalt/55">
                    {r.listing_title} · {r.listing_type} · {st === "paid" && r.paid_at ? `paid ${fmtDate(r.paid_at.slice(0, 10))}` : `due ${fmtDate(r.due_date)}`}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <p className="font-display text-xl font-normal">{money(r.net_cents, r.currency)}</p>
                  {st !== "paid" && st !== "cancelled" && (
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => markPaid(r.id)}
                      className="rounded-none bg-sevan px-3 py-1.5 text-xs font-semibold text-white hover:bg-sevan/90 disabled:opacity-50"
                    >
                      {busy === r.id ? "…" : "Mark paid"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
