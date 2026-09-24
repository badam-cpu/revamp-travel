/**
 * Operator billing (Dashboard → Billing). Shows Revamp's recurring plans and the
 * operator's current subscription. Subscribing collects a phone number (PayLink
 * requires a mobile for the subscriber), then redirects to PayLink's hosted card
 * page; confirmation is server-verified by polling (same as the booking loop),
 * so we call confirm on load — including on the ?subscription=return redirect.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, CreditCard, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import {
  listActivePlans,
  listMySubscriptions,
  startSubscription,
  confirmSubscriptions,
  cancelSubscription,
  getDefaultCommissionPercent,
  type SubscriptionPlan,
  type OperatorSubscription,
  type SubscriptionStatus,
} from "@/lib/subscriptions";

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  pending: "Awaiting payment",
  past_due: "Past due",
  cancelled: "Cancelled",
  expired: "Expired",
};
const STATUS_TONE: Record<SubscriptionStatus, string> = {
  active: "bg-[#1f7a4d]/10 text-[#1f7a4d]",
  pending: "bg-apricot/10 text-apricot",
  past_due: "bg-[#b4472e]/10 text-[#b4472e]",
  cancelled: "bg-basalt/10 text-basalt/60",
  expired: "bg-basalt/10 text-basalt/60",
};

const BILLABLE_TYPES = ["stay", "tour", "experience"];

export function OperatorSubscription() {
  const { format } = useCurrency();
  const { user } = useAuth();
  const { listings } = useListings();
  // The operator's live billable listing count — must match the server's rule
  // (published stay/tour/experience) so the previewed total matches the charge.
  const listingCount = useMemo(
    () =>
      listings.filter(
        (l) => (l as { operatorId?: string }).operatorId === user?.id && (l as { status?: string }).status === "published" && BILLABLE_TYPES.includes(l.type),
      ).length,
    [listings, user?.id],
  );
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subs, setSubs] = useState<OperatorSubscription[]>([]);
  const [defaultCommission, setDefaultCommission] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [pickPlan, setPickPlan] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s, dc] = await Promise.all([listActivePlans(), listMySubscriptions(), getDefaultCommissionPercent()]);
      setPlans(p);
      setSubs(s);
      setDefaultCommission(dc);
    } catch {
      /* RLS/offline — leave empty */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Confirm first (catches the PayLink return), then load fresh state.
    confirmSubscriptions()
      .then((r) => {
        if (r.activated > 0) toast.success("Subscription active — thank you!");
      })
      .catch(() => {})
      .finally(load);
  }, [load]);

  const liveSub = subs.find((s) => s.status === "active" || s.status === "pending" || s.status === "past_due") ?? null;
  const activePlan = liveSub ? plans.find((p) => p.id === liveSub.planId) : null;

  const subscribe = async (planId: string) => {
    if (phone.trim().length < 6) {
      toast("Enter a phone number for billing.");
      return;
    }
    setBusyPlan(planId);
    try {
      const r = await startSubscription(planId, phone.trim());
      if (r.alreadyActive) {
        toast.success("You're already subscribed.");
        load();
        return;
      }
      if (r.redirectUrl) {
        window.location.href = r.redirectUrl;
        return;
      }
      toast("Couldn't start checkout. Try again.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start your subscription.");
    } finally {
      setBusyPlan(null);
    }
  };

  const cancel = async (rowId: string) => {
    if (!confirm("Cancel this subscription? Your recurring charge will stop.")) return;
    try {
      await cancelSubscription(rowId);
      toast.success("Subscription cancelled.");
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't cancel.");
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      await confirmSubscriptions();
    } catch {
      /* ignore */
    }
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-basalt/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading billing…
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      {/* Current subscription */}
      {liveSub && (
        <div className="border border-basalt/12 bg-paper p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="font-display text-2xl">{activePlan?.name ?? "Your plan"}</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em] ${STATUS_TONE[liveSub.status]}`}>
                  {STATUS_LABEL[liveSub.status]}
                </span>
              </div>
              {activePlan && (
                <p className="mt-1.5 text-sm text-basalt/60">
                  {format(liveSub.amountCents ?? activePlan.amountCents)} / month
                  {activePlan.pricingMode === "per_listing" && liveSub.quantity != null && ` · ${format(activePlan.amountCents)} × ${liveSub.quantity} listing${liveSub.quantity === 1 ? "" : "s"}`}
                  {liveSub.status === "pending" && " · complete payment on PayLink to activate"}
                </p>
              )}
              {activePlan?.pricingMode === "per_listing" && liveSub.quantity != null && listingCount !== liveSub.quantity && (
                <p className="mt-1 text-xs text-apricot">
                  You now have {listingCount} listing{listingCount === 1 ? "" : "s"} — your charge updates to {format(activePlan.amountCents * listingCount)} / month at the next cycle.
                </p>
              )}
              {activePlan?.commissionPercent != null && (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-[#1f7a4d]">
                  <Check className="h-3.5 w-3.5" />
                  {activePlan.commissionPercent === 0 ? "0% booking commission" : `${activePlan.commissionPercent}% booking commission`}
                  {defaultCommission != null && activePlan.commissionPercent < defaultCommission && (
                    <span className="font-normal text-basalt/45">(standard is {defaultCommission}%)</span>
                  )}
                </p>
              )}
              {liveSub.lastPaymentAt && (
                <p className="mt-1 text-xs text-basalt/45">Last charge {new Date(liveSub.lastPaymentAt).toLocaleDateString()}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {liveSub.status === "pending" && (
                <Button variant="outline" size="sm" onClick={refresh}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Check status
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-[#b4472e] hover:bg-[#b4472e]/10 hover:text-[#b4472e]" onClick={() => cancel(liveSub.id)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Plan comparison — pay-as-you-go vs. subscription, as connected tiers. */}
      {!liveSub && (
        <div>
          <div className="mb-6 max-w-2xl">
            <h2 className="font-display text-2xl tracking-[-0.02em]">Choose how you sell on Revamp</h2>
            <p className="mt-1.5 text-sm leading-6 text-basalt/60">
              Keep it simple with pay-as-you-go, or subscribe to lock in a lower per-booking commission. Switch whenever you like.
            </p>
          </div>

          <div className={`grid items-stretch gap-5 ${plans.length >= 2 ? "lg:grid-cols-3 sm:grid-cols-2" : "sm:grid-cols-2"}`}>
            {/* Pay-as-you-go tier (the current default) */}
            <div className="flex flex-col rounded-none border border-basalt/12 bg-chalk/40 p-6">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-xl">Pay as you go</h3>
                <span className="rounded-full bg-[#1f7a4d]/12 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#1f7a4d]">Current</span>
              </div>
              <p className="mt-3 font-display text-4xl leading-none tabular-nums">
                {defaultCommission != null ? `${defaultCommission}%` : "—"}
                <span className="ml-1 align-middle text-base font-normal text-basalt/50">per booking</span>
              </p>
              <ul className="mt-5 space-y-2.5 text-sm text-basalt/70">
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-basalt/40" /> No monthly fee — pay only when you earn</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-basalt/40" /> Commission on Revamp bookings only</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-basalt/40" /> No commitment</li>
              </ul>
              <div className="flex-1" />
              <p className="mt-6 rounded-none border border-basalt/12 bg-paper/60 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.1em] text-basalt/50">
                Your current plan
              </p>
            </div>

            {/* Subscription tiers */}
            {plans.map((plan) => {
              const perListing = plan.pricingMode === "per_listing";
              const total = perListing ? plan.amountCents * listingCount : plan.amountCents;
              const noListings = perListing && listingCount < 1;
              const saves = plan.commissionPercent != null && defaultCommission != null && plan.commissionPercent < defaultCommission;
              const picking = pickPlan === plan.id;
              const descLines = plan.description.split("\n").map((s) => s.trim()).filter(Boolean);
              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-none border p-6 ${saves ? "border-apricot bg-apricot/[0.04] shadow-[0_1px_0_0_rgba(241,88,34,0.15)]" : "border-basalt/12 bg-paper"}`}
                >
                  {saves && (
                    <span className="absolute -top-3 left-6 rounded-full bg-apricot px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-paper">
                      Best value
                    </span>
                  )}
                  <h3 className="font-display text-xl">{plan.name}</h3>

                  {perListing ? (
                    <>
                      <p className="mt-3 font-display text-4xl leading-none tabular-nums">
                        {format(total)}
                        <span className="ml-1 align-middle text-base font-normal text-basalt/50">/ month</span>
                      </p>
                      <p className="mt-1.5 text-xs text-basalt/55">
                        {format(plan.amountCents)} / listing × {listingCount} listing{listingCount === 1 ? "" : "s"}
                      </p>
                    </>
                  ) : (
                    <p className="mt-3 font-display text-4xl leading-none tabular-nums">
                      {format(plan.amountCents)}
                      <span className="ml-1 align-middle text-base font-normal text-basalt/50">/ month</span>
                    </p>
                  )}

                  <ul className="mt-5 space-y-2.5 text-sm text-basalt/75">
                    {plan.commissionPercent != null && (
                      <li className="flex gap-2 font-semibold text-[#1f7a4d]">
                        <Check className="mt-0.5 h-4 w-4 shrink-0" />
                        {plan.commissionPercent === 0 ? "0% booking commission" : `${plan.commissionPercent}% booking commission`}
                        {saves && <span className="font-normal text-basalt/45">— save vs {defaultCommission}%</span>}
                      </li>
                    )}
                    {descLines.map((line, i) => (
                      <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-apricot" /> {line}</li>
                    ))}
                    <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-apricot" /> Billed monthly · cancel anytime</li>
                  </ul>

                  <div className="flex-1" />

                  {picking ? (
                    <div className="mt-6 space-y-2">
                      <Label htmlFor={`phone-${plan.id}`} className="text-xs font-semibold">Billing phone</Label>
                      <Input
                        id={`phone-${plan.id}`}
                        type="tel"
                        autoFocus
                        placeholder="e.g. +374 XX XXX XXX"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                      <p className="text-[11px] text-basalt/45">Required by PayLink to set up recurring billing.</p>
                      <Button className="w-full" disabled={busyPlan === plan.id || phone.trim().length < 6} onClick={() => subscribe(plan.id)}>
                        {busyPlan === plan.id ? (
                          <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Starting…</>
                        ) : (
                          <><CreditCard className="mr-1.5 h-4 w-4" /> Continue to payment</>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button className="mt-6 w-full" variant={saves ? "default" : "outline"} disabled={noListings} onClick={() => setPickPlan(plan.id)}>
                        Subscribe
                      </Button>
                      {noListings && <p className="mt-2 text-center text-xs text-basalt/50">Publish a listing first — this plan bills per listing.</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="flex items-center gap-2 text-xs text-basalt/45">
        <ShieldCheck className="h-3.5 w-3.5" /> Payments are processed securely by PayLink. Revamp never sees your card details. Cancel anytime.
      </p>
      {liveSub?.status === "active" && (
        <p className="flex items-center gap-2 text-xs text-[#1f7a4d]">
          <Check className="h-3.5 w-3.5" /> Your subscription is active.
        </p>
      )}
    </div>
  );
}
