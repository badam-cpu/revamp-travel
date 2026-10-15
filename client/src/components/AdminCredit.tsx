/**
 * Admin → Guest credit (0105 + 0106 guardrails). Revamp credit is money Revamp
 * owes guests, so this shows the liability — outstanding, on hold, earned,
 * used, expired — and every credit with the booking's price and the ACTUAL %
 * earned (anything off the programme's 2% is flagged). Credits held for review
 * (large, >2% of the price, or over the daily limit) wait here for Approve /
 * Void; any credit can be voided with a note. Every review is recorded on the
 * credit (who, when, note). Created only by the after-trip award cron.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { adminReviewCredit, ApiError } from "@/lib/api";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CREDIT_PERCENT, CREDIT_VALID_MONTHS } from "@shared/credit";
import { cn } from "@/lib/utils";

type Status = "active" | "held" | "void";
type Lot = {
  id: string;
  user_id: string;
  amount_cents: number;
  remaining_cents: number;
  expires_at: string;
  created_at: string;
  status?: Status | null;
  base_cents?: number | null;
  review_reason?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  source_booking_id: string | null;
  profiles: { display_name: string | null } | null;
  bookings: { listings: { title: string } | null } | null;
};
type Use = { amount_cents: number; status: "applied" | "returned" };
type Filter = "all" | "held" | "flagged" | "void";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const statusOf = (l: Lot): Status => l.status ?? "active";
/** Actual % of the booking's pre-tax price this credit is (null when the base wasn't recorded). */
const shareOf = (l: Lot) => (l.base_cents && l.base_cents > 0 ? (l.amount_cents / l.base_cents) * 100 : null);
/** Off-programme: more than 2% (+ rounding) of the price. */
const isFlagged = (l: Lot) => {
  const s = shareOf(l);
  return s != null && s > CREDIT_PERCENT + 0.05;
};

export function AdminCredit() {
  const { format } = useCurrency();
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [uses, setUses] = useState<Use[]>([]);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([
      supabase
        .from("credit_lots")
        // * so the 0106 columns (status, base_cents, review_*) are read when present.
        .select("*, profiles!credit_lots_user_id_fkey(display_name), bookings(listings(title))")
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
  }, [tick]);

  const now = Date.now();
  const totals = useMemo(() => {
    const t = { outstanding: 0, held: 0, heldCount: 0, earned: 0, used: 0, expired: 0, flagged: 0, guests: new Set<string>() };
    for (const l of lots ?? []) {
      const st = statusOf(l);
      if (st !== "void") t.earned += l.amount_cents;
      if (isFlagged(l)) t.flagged++;
      if (st === "held") {
        t.held += l.remaining_cents;
        t.heldCount++;
      } else if (st === "active") {
        if (Date.parse(l.expires_at) > now) {
          t.outstanding += l.remaining_cents;
          if (l.remaining_cents > 0) t.guests.add(l.user_id);
        } else t.expired += l.remaining_cents;
      }
    }
    for (const u of uses) if (u.status === "applied") t.used += u.amount_cents;
    return t;
  }, [lots, uses, now]);

  const shown = (lots ?? []).filter((l) =>
    filter === "all" ? true : filter === "held" ? statusOf(l) === "held" : filter === "flagged" ? isFlagged(l) : statusOf(l) === "void",
  );

  const review = async (l: Lot, action: "approve" | "void") => {
    let note: string | undefined;
    if (action === "void") {
      const spent = l.amount_cents - l.remaining_cents;
      const n = window.prompt(
        `Void this ${format(l.amount_cents)} credit?${spent > 0 ? ` ${format(spent)} of it was already spent and stays spent — only the rest is cancelled.` : ""}\n\nWhy? (kept on record)`,
      );
      if (!n || !n.trim()) return;
      note = n.trim();
    }
    setBusy(l.id);
    try {
      await adminReviewCredit(l.id, action, note);
      toast.success(action === "approve" ? "Approved — the guest can use it now and has been emailed." : "Credit voided.");
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update that credit.");
    } finally {
      setBusy(null);
    }
  };

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
          {(totals.heldCount > 0 || totals.flagged > 0) && (
            <div className="flex items-start gap-3 border border-apricot/40 bg-apricot/5 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-apricot" aria-hidden />
              <p className="text-basalt/80">
                {totals.heldCount > 0 && (
                  <>
                    <strong>{totals.heldCount}</strong> credit{totals.heldCount === 1 ? " is" : "s are"} on hold for review ({format(totals.held)}) — guests can't spend {totals.heldCount === 1 ? "it" : "them"} until you approve.{" "}
                  </>
                )}
                {totals.flagged > 0 && (
                  <>
                    <strong>{totals.flagged}</strong> credit{totals.flagged === 1 ? " is" : "s are"} more than {CREDIT_PERCENT}% of the booking's price.
                  </>
                )}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: "Outstanding", value: totals.outstanding, hint: `${totals.guests.size} guest${totals.guests.size === 1 ? "" : "s"} can spend this`, strong: true },
              { label: "On hold", value: totals.held, hint: `${totals.heldCount} waiting for review` },
              { label: "Earned", value: totals.earned, hint: "all time, excl. void" },
              { label: "Used at checkout", value: totals.used, hint: "paid by Revamp" },
              { label: "Expired unused", value: totals.expired, hint: "no longer owed" },
            ].map((k) => (
              <div key={k.label} className={cn("border bg-paper p-4", k.strong ? "border-apricot/40" : "border-basalt/10")}>
                <p className="font-display text-2xl font-normal tabular-nums text-basalt">{format(k.value)}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">{k.label}</p>
                <p className="mt-1 text-xs text-basalt/45">{k.hint}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter credits">
            {(
              [
                { key: "all", label: "All" },
                { key: "held", label: `Needs review${totals.heldCount ? ` (${totals.heldCount})` : ""}` },
                { key: "flagged", label: `Over ${CREDIT_PERCENT}%${totals.flagged ? ` (${totals.flagged})` : ""}` },
                { key: "void", label: "Void" },
              ] as { key: Filter; label: string }[]
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  filter === f.key ? "bg-basalt text-paper" : "border border-basalt/15 bg-paper text-basalt/60 hover:text-basalt",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">
              {lots.length === 0 ? "No credit earned yet. Guests earn it the day after a trip that ended on or after launch." : "Nothing here."}
            </div>
          ) : (
            <div className="overflow-x-auto border border-basalt/10">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-basalt/12 bg-chalk text-left text-[11px] uppercase tracking-[0.08em] text-basalt/50">
                    <th className="px-3 py-2.5 font-semibold">Guest</th>
                    <th className="px-3 py-2.5 font-semibold">From</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Booking price</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Credit</th>
                    <th className="px-3 py-2.5 text-right font-semibold">%</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Left</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => {
                    const st = statusOf(l);
                    const expired = Date.parse(l.expires_at) <= now;
                    const share = shareOf(l);
                    const flagged = isFlagged(l);
                    return (
                      <tr key={l.id} className={cn("border-b border-basalt/8 align-top last:border-0", st === "held" && "bg-apricot/[0.04]")}>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-basalt">{l.profiles?.display_name || "Guest"}</p>
                          <p className="text-[11px] text-basalt/45">{shortDate(l.created_at)}</p>
                        </td>
                        <td className="px-3 py-2.5 text-basalt/65">
                          {l.bookings?.listings?.title ?? "—"}
                          {l.source_booking_id && <p className="font-mono text-[11px] text-basalt/40">#{l.source_booking_id.slice(0, 8).toUpperCase()}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-basalt/60">{l.base_cents ? format(l.base_cents) : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-basalt">{format(l.amount_cents)}</td>
                        <td className={cn("px-3 py-2.5 text-right tabular-nums", flagged ? "font-bold text-apricot" : "text-basalt/55")}>
                          {share == null ? "—" : `${share.toFixed(share < 10 ? 2 : 1)}%`}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-basalt/70">{l.remaining_cents ? format(l.remaining_cents) : "—"}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]",
                              st === "held" ? "bg-apricot text-white" : st === "void" ? "bg-basalt/15 text-basalt/55" : expired ? "bg-basalt/10 text-basalt/45" : "bg-basalt text-paper",
                            )}
                          >
                            {st === "held" ? "On hold" : st === "void" ? "Void" : expired ? "Expired" : "Active"}
                          </span>
                          {st === "held" && l.review_reason && <p className="mt-1 max-w-[180px] text-[11px] leading-4 text-basalt/55">{l.review_reason}</p>}
                          {l.review_note && <p className="mt-1 max-w-[180px] text-[11px] leading-4 text-basalt/45">Note: {l.review_note}</p>}
                          {st !== "held" && !expired && st !== "void" && <p className="mt-1 text-[11px] text-basalt/40">until {shortDate(l.expires_at)}</p>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {st === "held" && (
                            <Button size="sm" disabled={busy === l.id} onClick={() => review(l, "approve")} className="mr-1.5 h-8 rounded-none bg-apricot px-3 text-xs text-white hover:bg-apricot/90">
                              Approve
                            </Button>
                          )}
                          {st !== "void" && l.status !== undefined && (
                            <Button size="sm" variant="outline" disabled={busy === l.id} onClick={() => review(l, "void")} className="h-8 rounded-none border-basalt/20 px-3 text-xs">
                              Void
                            </Button>
                          )}
                        </td>
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
