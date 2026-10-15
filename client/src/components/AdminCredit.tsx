/**
 * Admin → Guest credit (0105). Revamp credit is money Revamp owes guests, so
 * this shows the liability at a glance — outstanding (spendable now), earned,
 * used and expired — and every guest's lots. Read-only: credit is only created
 * by the after-trip award cron and moved by checkout/cancel (server/credit.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CREDIT_PERCENT, CREDIT_VALID_MONTHS } from "@shared/credit";
import { cn } from "@/lib/utils";

type Lot = {
  id: string;
  user_id: string;
  amount_cents: number;
  remaining_cents: number;
  expires_at: string;
  created_at: string;
  profiles: { display_name: string | null } | null;
  bookings: { listings: { title: string } | null } | null;
};
type Use = { amount_cents: number; status: "applied" | "returned" };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function AdminCredit() {
  const { format } = useCurrency();
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [uses, setUses] = useState<Use[]>([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      supabase
        .from("credit_lots")
        .select("id, user_id, amount_cents, remaining_cents, expires_at, created_at, profiles!credit_lots_user_id_fkey(display_name), bookings(listings(title))")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase.from("credit_uses").select("amount_cents, status").limit(5000),
    ]).then(([l, u]) => {
      if (!live) return;
      if (l.error) {
        setMissing(true);
        setLots([]);
        return;
      }
      setLots((l.data as unknown as Lot[]) ?? []);
      setUses((u.data as Use[]) ?? []);
    });
    return () => {
      live = false;
    };
  }, []);

  const now = Date.now();
  const totals = useMemo(() => {
    const t = { outstanding: 0, earned: 0, used: 0, expired: 0, guests: new Set<string>() };
    for (const l of lots ?? []) {
      t.earned += l.amount_cents;
      if (Date.parse(l.expires_at) > now) {
        t.outstanding += l.remaining_cents;
        if (l.remaining_cents > 0) t.guests.add(l.user_id);
      } else t.expired += l.remaining_cents;
    }
    for (const u of uses) if (u.status === "applied") t.used += u.amount_cents;
    return t;
  }, [lots, uses, now]);

  return (
    <div className="grid gap-5">
      <PageHeader
        className="mb-0"
        title="Guest credit"
        sub={`Guests earn ${CREDIT_PERCENT}% back after each trip, valid ${CREDIT_VALID_MONTHS} months. Revamp funds it — operators are paid in full.`}
      />
      {lots === null ? (
        <p className="text-sm text-basalt/45">Loading…</p>
      ) : missing ? (
        <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">
          Guest credit isn't set up yet — run migration 0105 in Supabase.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Outstanding", value: totals.outstanding, hint: `${totals.guests.size} guest${totals.guests.size === 1 ? "" : "s"} can spend this` },
              { label: "Earned", value: totals.earned, hint: "all time" },
              { label: "Used at checkout", value: totals.used, hint: "paid by Revamp" },
              { label: "Expired unused", value: totals.expired, hint: "no longer owed" },
            ].map((k) => (
              <div key={k.label} className={cn("border bg-paper p-4", k.label === "Outstanding" ? "border-apricot/40" : "border-basalt/10")}>
                <p className="font-display text-2xl font-normal tabular-nums text-basalt">{format(k.value)}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">{k.label}</p>
                <p className="mt-1 text-xs text-basalt/45">{k.hint}</p>
              </div>
            ))}
          </div>

          {lots.length === 0 ? (
            <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">
              No credit earned yet. Guests earn it the day after a trip that ended on or after launch.
            </div>
          ) : (
            <div className="overflow-x-auto border border-basalt/10">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-basalt/12 bg-chalk text-left text-[11px] uppercase tracking-[0.08em] text-basalt/50">
                    <th className="px-3 py-2.5 font-semibold">Guest</th>
                    <th className="px-3 py-2.5 font-semibold">From</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Earned</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Left</th>
                    <th className="px-3 py-2.5 font-semibold">Valid until</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => {
                    const expired = Date.parse(l.expires_at) <= now;
                    return (
                      <tr key={l.id} className="border-b border-basalt/8 last:border-0">
                        <td className="px-3 py-2.5 font-semibold text-basalt">{l.profiles?.display_name || "Guest"}</td>
                        <td className="px-3 py-2.5 text-basalt/65">{l.bookings?.listings?.title ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-basalt/70">{format(l.amount_cents)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-basalt">{l.remaining_cents ? format(l.remaining_cents) : "—"}</td>
                        <td className={cn("px-3 py-2.5 tabular-nums", expired ? "text-basalt/40 line-through" : "text-basalt/65")}>{shortDate(l.expires_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
