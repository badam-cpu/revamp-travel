/**
 * "Buy a dining voucher" card on a restaurant's listing page. Renders only when
 * the restaurant has an ACTIVE voucher offer (restaurant_voucher_offers, public-
 * read via RLS). Shows the denominations with the customer discount applied, and
 * starts a PayLink checkout. Signed-out visitors are routed to sign in first.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Ticket, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { startVoucherCheckout, ApiError } from "@/lib/api";
import { VOUCHER_AMOUNTS_CENTS, VOUCHER_VALID_MONTHS, voucherPriceCents } from "@shared/vouchers";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function RestaurantVoucherCard({ listing }: { listing: { id: string; title: string; slug: string } }) {
  const { user } = useAuth();
  const { format } = useCurrency();
  const [, navigate] = useLocation();
  const [discount, setDiscount] = useState<number | null>(null);
  const [sel, setSel] = useState<number>(VOUCHER_AMOUNTS_CENTS[1]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    supabase
      .from("restaurant_voucher_offers")
      .select("customer_discount_percent, active")
      .eq("listing_id", listing.id)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => { if (live) setDiscount(data ? (data.customer_discount_percent as number) : null); });
    return () => { live = false; };
  }, [listing.id]);

  if (discount === null) return null; // no active offer

  const buy = async () => {
    if (!user) {
      navigate(`/login?redirect=/listing/${listing.slug}`);
      return;
    }
    setBusy(true);
    try {
      const r = await startVoucherCheckout(listing.id, sel);
      if (r.redirectUrl) window.location.href = r.redirectUrl;
      else {
        toast("Couldn't start checkout.");
        setBusy(false);
      }
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(false);
    }
  };

  return (
    <div className="brand-notch border border-basalt/12 bg-chalk p-6">
      <h3 className="flex items-center gap-2 font-display text-xl"><Ticket className="h-5 w-5 text-apricot" /> Dining vouchers</h3>
      <p className="mt-1 text-sm text-basalt/55">Prepay{discount > 0 ? ` and save ${discount}%` : ""} — redeem in person at {listing.title}.</p>
      <div className="mt-4 grid gap-2">
        {VOUCHER_AMOUNTS_CENTS.map((face) => {
          const price = voucherPriceCents(face, discount);
          const on = sel === face;
          return (
            <button
              key={face}
              type="button"
              onClick={() => setSel(face)}
              className={cn("flex items-center justify-between border px-4 py-3 text-sm transition-colors", on ? "border-apricot bg-apricot/10 text-basalt" : "border-basalt/15 text-basalt/70 hover:border-apricot/60")}
            >
              <span className="font-semibold">{format(face)} credit</span>
              <span>
                {discount > 0 ? (
                  <>
                    <span className="mr-2 text-basalt/40 line-through">{format(face)}</span>
                    <strong className="text-apricot">{format(price)}</strong>
                  </>
                ) : (
                  <strong>{format(price)}</strong>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <Button onClick={buy} disabled={busy} className="mt-4 w-full rounded-none bg-apricot text-white hover:bg-apricot/90">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Buy voucher · ${format(voucherPriceCents(sel, discount))}`}
      </Button>
      <p className="mt-2 text-[11px] leading-4 text-basalt/45">Valid {VOUCHER_VALID_MONTHS} months. Appears in your account with a code to redeem at the restaurant.</p>
    </div>
  );
}
