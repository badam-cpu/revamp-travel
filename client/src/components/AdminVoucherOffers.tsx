/**
 * Admin: enable/configure restaurant dining vouchers per eatery
 * (restaurant_voucher_offers). Toggle a restaurant on, set the customer discount
 * (funded by the wholesale spread) and Revamp's commission. Writes go straight to
 * Supabase under the admin RLS write policy. Also shows a per-restaurant tally of
 * sold / redeemed vouchers and what's owed the restaurant (redeemed × (100−commission)).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useListings } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { voucherPayoutCents } from "@shared/vouchers";
import { toast } from "sonner";

interface OfferRow { listing_id: string; active: boolean; customer_discount_percent: number; commission_percent: number }
interface VoucherAgg { listing_id: string; status: string; face_cents: number; commission_percent: number }

export function AdminVoucherOffers() {
  const { listings } = useListings();
  const { format } = useCurrency();
  const [offers, setOffers] = useState<Record<string, OfferRow>>({});
  const [vouchers, setVouchers] = useState<VoucherAgg[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.from("restaurant_voucher_offers").select("listing_id, active, customer_discount_percent, commission_percent"),
      supabase.from("restaurant_vouchers").select("listing_id, status, face_cents, commission_percent"),
    ]).then(([o, v]) => {
      const map: Record<string, OfferRow> = {};
      for (const row of (o.data as OfferRow[]) ?? []) map[row.listing_id] = row;
      setOffers(map);
      setVouchers((v.data as VoucherAgg[]) ?? []);
      setLoading(false);
    });
  };
  useEffect(load, []);

  const eateries = useMemo(() => listings.filter((l) => l.type === "eat"), [listings]);
  const aggByListing = useMemo(() => {
    const m = new Map<string, { sold: number; redeemed: number; owed: number }>();
    for (const v of vouchers) {
      const e = m.get(v.listing_id) ?? { sold: 0, redeemed: 0, owed: 0 };
      if (v.status === "active" || v.status === "redeemed") e.sold += 1;
      if (v.status === "redeemed") {
        e.redeemed += 1;
        e.owed += voucherPayoutCents(v.face_cents, v.commission_percent);
      }
      m.set(v.listing_id, e);
    }
    return m;
  }, [vouchers]);

  if (loading) return <p className="text-sm text-basalt/45">Loading…</p>;

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="font-display text-3xl font-normal text-basalt">Dining vouchers</h2>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">Enable prepaid vouchers per restaurant (consignment — you settle only redeemed ones). The customer discount is funded by the wholesale spread; commission is your cut of redeemed value.</p>
      </div>
      <div className="grid gap-3">
        {eateries.map((l) => (
          <OfferEditor key={l.id} listing={l} offer={offers[l.id]} agg={aggByListing.get(l.id)} format={format} onSaved={load} />
        ))}
        {eateries.length === 0 && <p className="text-sm text-basalt/45">No restaurants yet.</p>}
      </div>
    </div>
  );
}

function OfferEditor({
  listing,
  offer,
  agg,
  format,
  onSaved,
}: {
  listing: { id: string; title: string; city: string };
  offer?: OfferRow;
  agg?: { sold: number; redeemed: number; owed: number };
  format: (cents: number) => string;
  onSaved: () => void;
}) {
  const [active, setActive] = useState(offer?.active ?? false);
  const [discount, setDiscount] = useState(String(offer?.customer_discount_percent ?? 10));
  const [commission, setCommission] = useState(String(offer?.commission_percent ?? 15));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("restaurant_voucher_offers").upsert(
      {
        listing_id: listing.id,
        active,
        customer_discount_percent: Math.min(90, Math.max(0, Math.round(Number(discount) || 0))),
        commission_percent: Math.min(90, Math.max(0, Math.round(Number(commission) || 0))),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "listing_id" },
    );
    setSaving(false);
    if (error) toast(error.message);
    else {
      toast(active ? "Vouchers enabled." : "Saved.");
      onSaved();
    }
  };

  return (
    <div className="border border-basalt/10 bg-paper p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex min-w-0 flex-1 items-center gap-3">
          <Checkbox checked={active} onCheckedChange={(c) => setActive(c === true)} className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot" />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-basalt">{listing.title}</span>
            <span className="block truncate text-xs uppercase tracking-[0.1em] text-basalt/45">{listing.city}</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-basalt/55">Customer discount</span>
          <Input type="number" min={0} max={90} value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-9 w-16 rounded-none" />
          <span className="text-basalt/45">%</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-basalt/55">Commission</span>
          <Input type="number" min={0} max={90} value={commission} onChange={(e) => setCommission(e.target.value)} className="h-9 w-16 rounded-none" />
          <span className="text-basalt/45">%</span>
        </label>
        <Button onClick={save} disabled={saving} className="h-9 rounded-none bg-apricot text-white hover:bg-apricot/90">{saving ? "…" : "Save"}</Button>
      </div>
      {agg && (agg.sold > 0 || agg.redeemed > 0) && (
        <p className="mt-3 border-t border-basalt/10 pt-3 text-xs text-basalt/55">
          {agg.sold} sold · {agg.redeemed} redeemed · <span className="font-semibold text-basalt">{format(agg.owed)}</span> owed to the restaurant (redeemed, net of commission)
        </p>
      )}
    </div>
  );
}
