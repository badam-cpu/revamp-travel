/**
 * Admin control for a restaurant's PREPAID BALANCE (migration 0083). Revamp
 * pre-buys dining credit (pays the restaurant upfront, usually at a discount);
 * the restaurant sees the balance on /venue and it draws down as diners redeem.
 * Here an admin tops it up (paid vs face), makes manual adjustments, sets a
 * low-balance warning line, and pauses/resumes. Lives in /admin → Vouchers.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useListings } from "@/contexts/ListingsContext";
import { adminPrepaid, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface PrepaidRow { balance_cents: number; total_paid_cents: number; total_face_cents: number; low_threshold_cents: number; active: boolean }

export function AdminPrepaid() {
  const { format } = useCurrency();
  const { listings } = useListings();
  const eats = useMemo(() => listings.filter((l) => l.type === "eat").sort((a, b) => a.title.localeCompare(b.title)), [listings]);
  const [listingId, setListingId] = useState("");
  const [row, setRow] = useState<PrepaidRow | null>(null);
  const [paid, setPaid] = useState("");
  const [face, setFace] = useState("");
  const [delta, setDelta] = useState("");
  const [busy, setBusy] = useState(false);

  const load = (id: string) => {
    if (!id) { setRow(null); return; }
    supabase.from("restaurant_prepaid").select("balance_cents, total_paid_cents, total_face_cents, low_threshold_cents, active").eq("listing_id", id).maybeSingle()
      .then(({ data }) => setRow((data as PrepaidRow) ?? null));
  };
  useEffect(() => { load(listingId); }, [listingId]);

  const run = async (input: Parameters<typeof adminPrepaid>[0], ok: string) => {
    setBusy(true);
    try { await adminPrepaid(input); toast.success(ok); load(listingId); }
    catch (e) { toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't update."); }
    finally { setBusy(false); }
  };

  const topup = () => {
    const f = Math.round((Number(face) || 0) * 100);
    const p = Math.round((Number(paid) || 0) * 100);
    if (f <= 0) return toast("Enter the face credit to add.");
    run({ listingId, action: "topup", paidCents: p, faceCents: f }, "Balance topped up.").then(() => { setPaid(""); setFace(""); });
  };
  const adjust = () => {
    const d = Math.round((Number(delta) || 0) * 100);
    if (!d) return toast("Enter a non-zero amount (use − to deduct).");
    run({ listingId, action: "adjust", deltaCents: d, note: "Admin adjustment" }, "Adjusted.").then(() => setDelta(""));
  };

  return (
    <div className="border border-basalt/12 bg-paper p-5">
      <h3 className="font-display text-xl font-normal text-basalt">Prepaid balance</h3>
      <p className="mt-1 max-w-2xl text-sm text-basalt/55">Pre-buy dining credit from a restaurant: pay them upfront (often at a discount) and grant a face-value balance that draws down as diners redeem. Shows on their <code className="text-basalt/70">/venue</code> dashboard. Customers still buy vouchers as usual.</p>

      <div className="mt-4 grid gap-1.5">
        <Label className="text-xs font-semibold">Restaurant</Label>
        <select value={listingId} onChange={(e) => setListingId(e.target.value)} className="h-10 max-w-md rounded-none border border-basalt/15 bg-paper px-3 text-sm">
          <option value="">Choose a restaurant…</option>
          {eats.map((l) => <option key={l.id} value={l.id}>{l.title} · {l.city}</option>)}
        </select>
      </div>

      {listingId && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 border border-basalt/10 bg-chalk/40 p-4">
            <div>
              <p className="font-display text-3xl font-normal tabular-nums text-basalt">{format(row?.balance_cents ?? 0)}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">Current balance {row && !row.active && "· paused"}</p>
            </div>
            <div className="text-xs text-basalt/55">
              <p>Paid in total: <b className="text-basalt/75">{format(row?.total_paid_cents ?? 0)}</b></p>
              <p>Face granted: <b className="text-basalt/75">{format(row?.total_face_cents ?? 0)}</b></p>
              <p>Low-balance line: {format(row?.low_threshold_cents ?? 0)}</p>
            </div>
            {row && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => run({ listingId, action: "active", active: !row.active }, row.active ? "Paused." : "Resumed.")} className="h-9 rounded-none border-basalt/20">
                {row.active ? "Pause" : "Resume"}
              </Button>
            )}
          </div>

          {/* Top up */}
          <div className="mt-4 grid gap-3 border border-basalt/10 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Amount Revamp paid (AMD)</Label>
              <Input value={paid} onChange={(e) => setPaid(e.target.value)} type="number" min={0} placeholder="e.g. 20000" className="h-10 rounded-none" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Face credit granted (AMD)</Label>
              <Input value={face} onChange={(e) => setFace(e.target.value)} type="number" min={0} placeholder="e.g. 25000" className="h-10 rounded-none" />
            </div>
            <Button type="button" onClick={topup} disabled={busy} className="h-10 rounded-none bg-apricot text-white hover:bg-apricot/90">Add funds</Button>
          </div>

          {/* Adjust + threshold */}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Manual adjust (AMD, − to deduct)</Label>
              <Input value={delta} onChange={(e) => setDelta(e.target.value)} type="number" placeholder="e.g. -5000" className="h-10 w-44 rounded-none" />
            </div>
            <Button type="button" variant="outline" onClick={adjust} disabled={busy} className="h-10 rounded-none border-basalt/20">Apply</Button>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Low-balance warning at (AMD)</Label>
              <Input defaultValue={row ? String(Math.round(row.low_threshold_cents / 100)) : ""} type="number" min={0} className="h-10 w-44 rounded-none"
                onBlur={(e) => { const v = Math.round((Number(e.target.value) || 0) * 100); run({ listingId, action: "threshold", lowThresholdCents: v }, "Threshold saved."); }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
