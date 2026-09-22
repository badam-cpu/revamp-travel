/**
 * Admin — gift cards oversight (read-only). Lists issued gift cards with their
 * status, balance, recipient, and expiry. Admins read all rows under RLS
 * (migration 0039). Balance/status moves happen server-side only.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

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

export function AdminGiftCards() {
  const { format } = useCurrency();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase
      .from("gift_cards")
      .select("id, code, status, initial_amount_cents, balance_cents, currency, recipient_name, recipient_email, purchaser_email, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => setCards((data ?? []) as Card[]));
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (cards ?? []).filter(
      (c) => !n || (c.code ?? "").toLowerCase().includes(n) || (c.recipient_email ?? "").toLowerCase().includes(n) || (c.recipient_name ?? "").toLowerCase().includes(n),
    );
  }, [cards, q]);

  const badge = (s: string) =>
    s === "active" ? "text-emerald-700 bg-emerald-50" : s === "depleted" ? "text-basalt/50 bg-basalt/5" : s === "pending_payment" ? "text-amber-700 bg-amber-50" : "text-basalt/45 bg-basalt/5";

  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">Gift cards</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Issued gift cards.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Every gift card, newest first — status, remaining balance, and who it's for. Balances move only through the server (purchase, redemption).</p>
      </div>

      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by code, recipient name or email…" className="mb-5 h-11 max-w-md rounded-none" />

      {cards === null ? (
        <div className="grid place-items-center py-16 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-basalt/50">No gift cards{q ? " match that search" : " yet"}.</p>
      ) : (
        <ul className="grid gap-2">
          {filtered.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-basalt/12 bg-paper px-4 py-3">
              <span className="font-mono text-sm font-semibold text-basalt">{c.code ?? "— (unpaid)"}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge(c.status)}`}>{c.status.replace(/_/g, " ")}</span>
              <span className="text-sm text-basalt/70">{format(c.balance_cents)} <span className="text-basalt/40">/ {format(c.initial_amount_cents)}</span></span>
              <span className="min-w-0 flex-1 truncate text-sm text-basalt/55">→ {c.recipient_name || c.recipient_email || "—"}</span>
              <span className="shrink-0 text-xs text-basalt/40">{c.expires_at ? `exp ${new Date(c.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
