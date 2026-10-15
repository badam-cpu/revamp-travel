/**
 * Revamp credit (0105) — the signed-in guest's own credit, read straight from
 * Supabase under RLS (own rows only). Rules: shared/credit.ts. Any error (or
 * a database without 0105) reads as "no credit" — never breaks checkout.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { creditBalance } from "@shared/credit";

export interface CreditLot {
  id: string;
  source: "earned" | "adjustment";
  amountCents: number;
  remainingCents: number;
  expiresAt: string;
  createdAt: string;
  note: string | null;
  listingTitle: string | null;
}
export interface CreditUse {
  id: number;
  amountCents: number;
  status: "applied" | "returned";
  createdAt: string;
  returnedAt: string | null;
  listingTitle: string | null;
  holdId: string;
}
export interface CreditState {
  loading: boolean;
  balanceCents: number;
  /** Soonest expiry among lots that still have credit. */
  nextExpiry: { date: string; cents: number } | null;
  lots: CreditLot[];
  uses: CreditUse[];
  reload: () => void;
}

type LotRow = {
  id: string; source: "earned" | "adjustment"; amount_cents: number; remaining_cents: number; expires_at: string; created_at: string; note: string | null;
  bookings: { listings: { title: string } | null } | null;
};
type UseRow = { id: number; hold_id: string; amount_cents: number; status: "applied" | "returned"; created_at: string; returned_at: string | null; bookings: { listings: { title: string } | null } | null };

export function useRevampCredit(): CreditState {
  const { user } = useAuth();
  const [state, setState] = useState<Omit<CreditState, "reload">>({ loading: true, balanceCents: 0, nextExpiry: null, lots: [], uses: [] });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!user || user.is_anonymous) {
      setState({ loading: false, balanceCents: 0, nextExpiry: null, lots: [], uses: [] });
      return;
    }
    let live = true;
    (async () => {
      const [lotsRes, usesRes] = await Promise.all([
        supabase
          .from("credit_lots")
          .select("id, source, amount_cents, remaining_cents, expires_at, created_at, note, bookings(listings(title))")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("credit_uses")
          .select("id, hold_id, amount_cents, status, created_at, returned_at, bookings(listings(title))")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (!live) return;
      if (lotsRes.error) {
        // Before 0105 the table doesn't exist — no credit, quietly.
        if (!/credit_lots|schema cache|does not exist/i.test(lotsRes.error.message)) console.error("[credit] load failed", lotsRes.error.message);
        setState({ loading: false, balanceCents: 0, nextExpiry: null, lots: [], uses: [] });
        return;
      }
      const lots: CreditLot[] = ((lotsRes.data ?? []) as unknown as LotRow[]).map((r) => ({
        id: r.id,
        source: r.source,
        amountCents: r.amount_cents,
        remainingCents: r.remaining_cents,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        note: r.note,
        listingTitle: r.bookings?.listings?.title ?? null,
      }));
      const uses: CreditUse[] = ((usesRes.data ?? []) as unknown as UseRow[]).map((r) => ({
        id: r.id,
        holdId: r.hold_id,
        amountCents: r.amount_cents,
        status: r.status,
        createdAt: r.created_at,
        returnedAt: r.returned_at,
        listingTitle: r.bookings?.listings?.title ?? null,
      }));
      const now = Date.now();
      const balanceCents = creditBalance(lots.map((l) => ({ remaining_cents: l.remainingCents, expires_at: l.expiresAt })), now);
      const liveLots = lots.filter((l) => l.remainingCents > 0 && Date.parse(l.expiresAt) > now).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
      const nextExpiry = liveLots.length ? { date: liveLots[0].expiresAt, cents: liveLots[0].remainingCents } : null;
      setState({ loading: false, balanceCents, nextExpiry, lots, uses });
    })();
    return () => {
      live = false;
    };
  }, [user?.id, user?.is_anonymous, tick]);

  return { ...state, reload };
}
