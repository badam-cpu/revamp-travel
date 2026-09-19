/**
 * Single-listing month calendar (Airbnb host style) for a STAY: each day shows
 * its nightly price (base or seasonal override) and availability (confirmed
 * booking / external synced block). Click a day or drag a range, then set one
 * AMD price for the selection — saved to the listing's seasonal_rates via
 * useListings().setSeasonalRates (a content-only write; status untouched).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());

export function PricingCalendar({ listing }: { listing: LiveListing }) {
  const { setSeasonalRates } = useListings();
  const { format } = useCurrency();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const [booked, setBooked] = useState<{ start: string; end: string }[]>([]);
  const [sel, setSel] = useState<{ a: string; b: string } | null>(null);
  const dragging = useRef(false);
  const [priceInput, setPriceInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Confirmed/pending bookings for this listing (to mark booked days).
  useEffect(() => {
    supabase
      .from("bookings")
      .select("start_date, end_date")
      .eq("listing_id", listing.id)
      .in("status", ["pending_payment", "confirmed", "completed"])
      .then(({ data }) => setBooked((data ?? []).map((r) => ({ start: r.start_date as string, end: r.end_date as string }))));
  }, [listing.id]);

  const isStay = listing.type === "stay";
  const base = Math.round(listing.price * 100);
  const rates = listing.seasonalRates ?? [];
  const priceForDate = (d: string) => {
    const match = rates.filter((r) => r.start <= d && d <= r.end).pop();
    return match ? match.priceCents : base;
  };
  const isBooked = (d: string) => booked.some((b) => b.start <= d && d < b.end);
  const isBlocked = (d: string) => (listing.blockedRanges ?? []).some((b) => b.start <= d && d < b.end);

  // Month grid: leading blanks + each day.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(month.y, month.m, 1));
    const startPad = first.getUTCDay(); // 0=Sun
    const daysInMonth = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array(startPad).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(iso(new Date(Date.UTC(month.y, month.m, d))));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const monthLabel = new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const today = todayIso();

  const inSel = (d: string) => sel !== null && d >= (sel.a < sel.b ? sel.a : sel.b) && d <= (sel.a < sel.b ? sel.b : sel.a);
  const selStart = sel && (sel.a < sel.b ? sel.a : sel.b);
  const selEnd = sel && (sel.a < sel.b ? sel.b : sel.a);
  const selNights = sel && selStart && selEnd ? Math.round((Date.parse(selEnd) - Date.parse(selStart)) / DAY_MS) + 1 : 0;

  const startDrag = (d: string) => {
    if (!isStay || d < today) return; // pricing is per-night, stays only
    dragging.current = true;
    setSel({ a: d, b: d });
  };
  const extendDrag = (d: string) => {
    if (dragging.current && d >= today) setSel((s) => (s ? { ...s, b: d } : s));
  };
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const applyPrice = async () => {
    if (!selStart || !selEnd) return;
    const amd = Math.round(Number(priceInput) || 0);
    if (amd <= 0) {
      toast("Enter a nightly price in AMD.");
      return;
    }
    setSaving(true);
    try {
      // Drop existing rates fully covered by the new range, then append it
      // (compute uses last-match-wins, so the newest override applies).
      const kept = rates.filter((r) => !(r.start >= selStart && r.end <= selEnd));
      await setSeasonalRates(listing.id, [...kept, { start: selStart, end: selEnd, priceCents: amd * 100 }]);
      toast(`Price set for ${selNights} night${selNights === 1 ? "" : "s"}.`);
      setSel(null);
      setPriceInput("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the price.");
    } finally {
      setSaving(false);
    }
  };

  const resetToBase = async () => {
    if (!selStart || !selEnd) return;
    setSaving(true);
    try {
      // Remove any overrides intersecting the selection → falls back to base.
      const kept = rates.filter((r) => r.end < selStart || r.start > selEnd);
      await setSeasonalRates(listing.id, kept);
      toast("Reset to base price.");
      setSel(null);
      setPriceInput("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't reset.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMonth((m) => (m.m === 0 ? { y: m.y - 1, m: 11 } : { y: m.y, m: m.m - 1 }))} aria-label="Previous month" className="grid h-8 w-8 place-items-center border border-basalt/15 hover:border-apricot hover:text-apricot"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setMonth((m) => (m.m === 11 ? { y: m.y + 1, m: 0 } : { y: m.y, m: m.m + 1 }))} aria-label="Next month" className="grid h-8 w-8 place-items-center border border-basalt/15 hover:border-apricot hover:text-apricot"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <p className="font-display text-xl">{monthLabel}</p>
        <span className="ml-auto text-xs text-basalt/45">{base > 0 ? (isStay ? `Base rate ${format(base)} / night` : `Price ${format(base)}`) : "Rate on request"}</span>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-basalt/55">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-sevan" /> Booked</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-blue-500/40 bg-[repeating-linear-gradient(45deg,#3b82f640,#3b82f640_3px,transparent_3px,transparent_6px)]" /> External (synced)</span>
        {isStay && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-apricot bg-apricot/15" /> Selected</span>}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-basalt/10 text-center text-[10px] font-bold uppercase tracking-wide text-basalt/40">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 border-l border-t border-basalt/10 select-none">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="min-h-[74px] border-b border-r border-basalt/10 bg-basalt/[0.02]" />;
          const past = d < today;
          const booked = isBooked(d);
          const blocked = isBlocked(d);
          const selected = inSel(d);
          const price = priceForDate(d);
          const overridden = rates.some((r) => r.start <= d && d <= r.end);
          return (
            <div
              key={d}
              onPointerDown={() => !past && !booked && !blocked && startDrag(d)}
              onPointerEnter={() => extendDrag(d)}
              className={cn(
                "relative min-h-[74px] border-b border-r border-basalt/10 p-1.5 text-left transition-colors",
                past ? "bg-basalt/[0.02] text-basalt/30" : booked || blocked ? "cursor-not-allowed" : isStay ? "cursor-pointer hover:bg-apricot/[0.04]" : "",
                selected && "bg-apricot/15 ring-1 ring-inset ring-apricot",
                booked && "bg-sevan/10",
                blocked && "bg-[repeating-linear-gradient(45deg,#3b82f626,#3b82f626_4px,transparent_4px,transparent_8px)]",
              )}
            >
              <span className={cn("text-xs font-semibold tabular-nums", d === today && "text-apricot")}>{Number(d.slice(8, 10))}</span>
              {isStay && !past && !booked && !blocked && base > 0 && (
                <span className={cn("mt-3 block text-[11px] font-semibold", overridden ? "text-apricot" : "text-basalt/70")}>{format(price)}</span>
              )}
              {booked && <span className="mt-3 block text-[10px] font-semibold text-sevan">Booked</span>}
              {blocked && !booked && <span className="mt-3 block text-[10px] font-semibold text-blue-600">External</span>}
            </div>
          );
        })}
      </div>

      {/* Selection → price setter */}
      {sel && selStart && selEnd && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border border-apricot/40 bg-apricot/[0.06] p-4">
          <p className="text-sm font-semibold">
            {selNights} night{selNights === 1 ? "" : "s"} selected
            <span className="ml-2 font-normal text-basalt/55">{selStart}{selNights > 1 ? ` → ${selEnd}` : ""}</span>
          </p>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-basalt/55">֏</span>
            <Input type="number" min={0} value={priceInput} onChange={(e) => setPriceInput(e.target.value)} placeholder="per night (AMD)" className="h-9 w-40 rounded-none" />
            <Button size="sm" disabled={saving} onClick={applyPrice} className="rounded-none bg-apricot text-white hover:bg-apricot/90">{saving ? "Saving…" : "Set price"}</Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={resetToBase} className="rounded-none">Reset to base</Button>
            <Button size="sm" variant="ghost" onClick={() => { setSel(null); setPriceInput(""); }}>Cancel</Button>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-basalt/45">
        {isStay
          ? "Click a day or drag across several to set a nightly price. Prices in AMD; days show the price guests pay per night. Booked and externally-synced days can't be repriced here."
          : "Booked and externally-synced (hatched) days are shown. Tours and experiences use a single price, edited on the listing itself — this calendar is for availability."}
      </p>
    </div>
  );
}
