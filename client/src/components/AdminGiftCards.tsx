/**
 * Admin — gift cards oversight. Lists issued gift cards with status, balance,
 * recipient, and expiry (admins read all rows under RLS, migration 0039). Expand
 * a card to see its append-only audit ledger (gift_card_events, migration 0040):
 * every activation, redemption, release/refund, void, and expiry — nothing is
 * ever removed. Admins can VOID a card (fraud/chargeback); that only flips its
 * status and logs it, keeping the balance + full history.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminVoidGiftCard } from "@/lib/api";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";

interface Card {
  id: string;
  code: string | null;
  status: string;
  initial_amount_cents: number;
  balance_cents: number;
  currency: string;
  recipient_name: string | null;
  recipient_email: string | null;
  purchaser_email: string | null;
  expires_at: string | null;
  created_at: string;
}
interface Event {
  id: string;
  type: string;
  amount_cents: number;
  balance_after: number | null;
  detail: string | null;
  created_at: string;
}

export function AdminGiftCards() {
  const { format, rate, currency } = useCurrency();
  const usdRef = (amdCents: number) => (rate > 0 && currency === "AMD" ? `$${Math.round(amdCents / 100 / rate).toLocaleString()}` : null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, Event[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () =>
    supabase
      .from("gift_cards")
      .select("id, code, status, initial_amount_cents, balance_cents, currency, recipient_name, recipient_email, purchaser_email, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => setCards((data ?? []) as Card[]));

  useEffect(() => {
    load();
  }, []);

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!events[id]) {
      const { data } = await supabase
        .from("gift_card_events")
        .select("id, type, amount_cents, balance_after, detail, created_at")
        .eq("gift_card_id", id)
        .order("created_at", { ascending: false });
      setEvents((prev) => ({ ...prev, [id]: (data ?? []) as Event[] }));
    }
  };

  const voidCard = async (c: Card) => {
    const reason = window.prompt(`Void gift card ${c.code ?? ""}? It can no longer be redeemed (balance + history are kept). Optional reason:`);
    if (reason === null) return;
    setBusyId(c.id);
    try {
      await adminVoidGiftCard(c.id, reason || undefined);
      toast("Gift card voided.");
      setEvents((prev) => ({ ...prev, [c.id]: [] })); // force reload of its ledger on next open
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't void that card.");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (cards ?? []).filter(
      (c) => !n || (c.code ?? "").toLowerCase().includes(n) || (c.recipient_email ?? "").toLowerCase().includes(n) || (c.recipient_name ?? "").toLowerCase().includes(n),
    );
  }, [cards, q]);

  const badge = (s: string) =>
    s === "active" ? "text-emerald-700 bg-emerald-50" : s === "depleted" ? "text-basalt/50 bg-basalt/5" : s === "pending_payment" ? "text-amber-700 bg-amber-50" : s === "cancelled" ? "text-red-700 bg-red-50" : "text-basalt/45 bg-basalt/5";

  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">Gift cards</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Issued gift cards.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Every gift card, newest first. Expand one for its full audit trail. Voiding a card stops redemption but keeps the balance and history.</p>
      </div>

      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by code, recipient name or email…" className="mb-5 h-11 max-w-md rounded-none" />

      {cards === null ? (
        <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-basalt/50">No gift cards{q ? " match that search" : " yet"}.</p>
      ) : (
        <ul className="grid gap-2">
          {filtered.map((c) => (
            <li key={c.id} className="border border-basalt/12 bg-paper">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <button type="button" onClick={() => toggle(c.id)} className="flex items-center gap-1 font-mono text-sm font-semibold text-basalt hover:text-apricot">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openId === c.id ? "rotate-180" : ""}`} />
                  {c.code ?? "— (unpaid)"}
                </button>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge(c.status)}`}>{c.status.replace(/_/g, " ")}</span>
                <span className="text-sm text-basalt/70">
                  {format(c.balance_cents)} <span className="text-basalt/40">/ {format(c.initial_amount_cents)}</span>
                  {usdRef(c.initial_amount_cents) && <span className="ml-1 text-xs text-basalt/40">(≈ {usdRef(c.initial_amount_cents)})</span>}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-basalt/55">→ {c.recipient_name || c.recipient_email || "—"}</span>
                <span className="shrink-0 text-xs text-basalt/40">{c.expires_at ? `exp ${new Date(c.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</span>
                {c.status !== "cancelled" && c.code && (
                  <button type="button" disabled={busyId === c.id} onClick={() => voidCard(c)} className="shrink-0 text-xs font-semibold text-red-600 underline-offset-2 hover:underline disabled:opacity-50">
                    {busyId === c.id ? "…" : "Void"}
                  </button>
                )}
              </div>
              {openId === c.id && (
                <div className="border-t border-basalt/10 bg-chalk/40 px-4 py-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/45">Audit trail</p>
                  {!events[c.id] ? (
                    <Loader2 className="h-4 w-4 animate-spin text-basalt/40" />
                  ) : events[c.id].length === 0 ? (
                    <p className="text-xs text-basalt/45">No events recorded.</p>
                  ) : (
                    <ul className="grid gap-1.5">
                      {events[c.id].map((e) => (
                        <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 text-xs text-basalt/60">
                          <span className="w-20 shrink-0 font-bold uppercase tracking-wide text-basalt/70">{e.type}</span>
                          {e.amount_cents > 0 && <span>{format(e.amount_cents)}</span>}
                          {e.balance_after != null && <span className="text-basalt/40">→ bal {format(e.balance_after)}</span>}
                          {e.detail && <span className="min-w-0 flex-1 truncate">{e.detail}</span>}
                          <span className="shrink-0 text-basalt/35">{new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
