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

interface OfferRow { listing_id: string; active: boolean; redeem_active: boolean; customer_discount_percent: number; commission_percent: number; redeem_token: string | null; staff_note: string | null }
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
      supabase.from("restaurant_voucher_offers").select("listing_id, active, redeem_active, customer_discount_percent, commission_percent, redeem_token, staff_note"),
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
  const [redeemActive, setRedeemActive] = useState(offer?.redeem_active ?? false);
  const [discount, setDiscount] = useState(String(offer?.customer_discount_percent ?? 10));
  const [commission, setCommission] = useState(String(offer?.commission_percent ?? 15));
  const [staffNote, setStaffNote] = useState(offer?.staff_note ?? "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate a redeem token the first time vouchers are enabled (the private
  // validator link is the restaurant's credential).
  const token = offer?.redeem_token ?? null;
  const redeemUrl = token ? `${window.location.origin}/redeem/${token}` : null;

  const save = async () => {
    setSaving(true);
    // Generate the redeem link the first time redemption is enabled.
    const nextToken = token ?? (redeemActive ? crypto.randomUUID().replace(/-/g, "") : null);
    const { error } = await supabase.from("restaurant_voucher_offers").upsert(
      {
        listing_id: listing.id,
        active,
        redeem_active: redeemActive,
        customer_discount_percent: Math.min(90, Math.max(0, Math.round(Number(discount) || 0))),
        commission_percent: Math.min(90, Math.max(0, Math.round(Number(commission) || 0))),
        redeem_token: nextToken,
        staff_note: staffNote.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "listing_id" },
    );
    setSaving(false);
    if (error) toast(error.message);
    else {
      toast("Saved.");
      onSaved();
    }
  };

  const copyLink = async () => {
    if (!redeemUrl) return;
    try {
      await navigator.clipboard.writeText(redeemUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Copy failed — select and copy the link manually.");
    }
  };

  return (
    <div className="border border-basalt/10 bg-paper p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-basalt">{listing.title}</span>
          <span className="block truncate text-xs uppercase tracking-[0.1em] text-basalt/45">{listing.city}</span>
        </span>
        <label className="flex items-center gap-2 text-sm" title="Show the buy card on the listing (customers can purchase)">
          <Checkbox checked={active} onCheckedChange={(c) => setActive(c === true)} className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot" />
          <span className="text-basalt/70">Sell to customers</span>
        </label>
        <label className="flex items-center gap-2 text-sm" title="The staff redeem link works">
          <Checkbox checked={redeemActive} onCheckedChange={(c) => setRedeemActive(c === true)} className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot" />
          <span className="text-basalt/70">Redemption on</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-basalt/55">Discount</span>
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
      {active && !redeemActive && (
        <p className="mt-2 text-xs font-semibold text-amber-600">Selling is on but redemption is off — customers could buy vouchers they can't redeem yet.</p>
      )}
      {redeemActive && redeemUrl && (
        <div className="mt-3 border-t border-basalt/10 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/45">Staff redeem link (private — give to the restaurant)</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate bg-chalk px-2.5 py-1.5 text-xs text-basalt/70">{redeemUrl}</code>
            <button type="button" onClick={copyLink} className="shrink-0 border border-basalt/15 px-3 py-1.5 text-xs font-semibold text-basalt/70 hover:border-apricot hover:text-apricot">{copied ? "Copied" : "Copy"}</button>
          </div>
          <label className="mt-3 grid gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/45">Staff note on the redeem page (optional)</span>
            <Input value={staffNote} onChange={(e) => setStaffNote(e.target.value)} placeholder="e.g. Apply the ֏ as a discount under 'Revamp' on the POS" className="h-9 rounded-none" />
            <span className="text-[11px] text-basalt/40">Save to update. The page also shows the restaurant's name automatically.</span>
          </label>
        </div>
      )}
      {agg && (agg.sold > 0 || agg.redeemed > 0) && (
        <p className="mt-3 border-t border-basalt/10 pt-3 text-xs text-basalt/55">
          {agg.sold} sold · {agg.redeemed} redeemed · <span className="font-semibold text-basalt">{format(agg.owed)}</span> owed to the restaurant (redeemed, net of commission)
        </p>
      )}
    </div>
  );
}
