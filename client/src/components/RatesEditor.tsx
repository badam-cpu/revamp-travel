/**
 * Seasonal / daily nightly-rate editor for the operator stay form. Each row is
 * a date range with a nightly price that overrides the base rate for those
 * nights (the booking sums each night at its matching rate — see
 * computeBookingAmountCents). Prices are stored in AMD (the settlement
 * currency); an AMD/USD toggle lets the operator type in either — USD is
 * converted to AMD at the admin rate on the way in and shown back converted.
 *
 * Uncontrolled with a ref.getValue() like the other pickers; read once at submit.
 */
import { forwardRef, useImperativeHandle, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SeasonalRate } from "@shared/listings";

export type RatesEditorHandle = { getValue: () => SeasonalRate[] };

type Row = { id: string; label: string; start: string; end: string; priceCents: number };

export const RatesEditor = forwardRef<RatesEditorHandle, { defaultValue: SeasonalRate[]; rate: number }>(function RatesEditor({ defaultValue, rate }, ref) {
  const [rows, setRows] = useState<Row[]>(() => defaultValue.map((r) => ({ id: crypto.randomUUID(), label: r.label ?? "", start: r.start, end: r.end, priceCents: r.priceCents })));
  const [currency, setCurrency] = useState<"AMD" | "USD">("AMD");
  const usdAvailable = rate > 0;

  useImperativeHandle(
    ref,
    () => ({ getValue: () => rows.filter((r) => r.start && r.end && r.priceCents > 0).map((r) => ({ start: r.start, end: r.end, priceCents: r.priceCents, label: r.label.trim() || undefined })) }),
    [rows],
  );

  const update = (id: string, patch: Partial<Row>) => setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => setRows((p) => p.filter((r) => r.id !== id));
  const add = () => setRows((p) => [...p, { id: crypto.randomUUID(), label: "", start: "", end: "", priceCents: 0 }]);

  // Show the stored AMD price in the selected input currency.
  const toDisplay = (cents: number) => {
    if (!cents) return "";
    const amd = cents / 100;
    return currency === "USD" && rate > 0 ? String(Math.round((amd / rate) * 100) / 100) : String(Math.round(amd));
  };
  const fromInput = (val: string) => {
    const n = Number(val) || 0;
    return currency === "USD" && rate > 0 ? Math.round(n * rate * 100) : Math.round(n * 100);
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>Seasonal &amp; daily rates <span className="font-normal text-basalt/45">(optional)</span></Label>
          <p className="mt-1 text-xs text-basalt/45">Override the nightly price for specific date ranges (holidays, high season). Nights outside a range use your base price.</p>
        </div>
        <div className="inline-flex shrink-0 overflow-hidden rounded-none border border-basalt/20 text-xs font-bold">
          {(["AMD", "USD"] as const).map((c) => (
            <button
              key={c}
              type="button"
              disabled={c === "USD" && !usdAvailable}
              onClick={() => setCurrency(c)}
              className={`px-2.5 py-1.5 transition-colors ${currency === c ? "bg-apricot text-white" : "text-basalt/60 hover:text-basalt disabled:opacity-30"}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {rows.map((r) => (
        <div key={r.id} className="grid gap-2 border border-basalt/10 bg-paper p-3">
          <div className="flex items-center gap-2">
            <Input value={r.label} onChange={(e) => update(r.id, { label: e.target.value })} placeholder="Label (e.g. New Year, High season)" className="h-10 rounded-none text-sm" />
            <button type="button" onClick={() => remove(r.id)} aria-label="Remove rate" className="grid h-10 w-10 shrink-0 place-items-center border border-basalt/15 text-basalt/50 hover:border-destructive hover:text-destructive"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label className="text-xs font-semibold text-basalt/60">From</Label>
              <Input type="date" value={r.start} onChange={(e) => update(r.id, { start: e.target.value })} className="h-10 rounded-none text-sm" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-semibold text-basalt/60">To</Label>
              <Input type="date" value={r.end} onChange={(e) => update(r.id, { end: e.target.value })} className="h-10 rounded-none text-sm" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-semibold text-basalt/60">Rate / night ({currency})</Label>
              <Input type="number" min={0} value={toDisplay(r.priceCents)} onChange={(e) => update(r.id, { priceCents: fromInput(e.target.value) })} placeholder={currency === "USD" ? "e.g. 120" : "e.g. 45000"} className="h-10 rounded-none text-sm" />
            </div>
          </div>
        </div>
      ))}

      <button type="button" onClick={add} className="inline-flex items-center gap-1.5 self-start rounded-none border border-basalt/20 bg-paper px-4 py-2 text-sm font-semibold text-basalt hover:border-apricot"><Plus className="h-4 w-4" /> Add a rate period</button>
    </div>
  );
});
