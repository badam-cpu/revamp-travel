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

      {/* Plan picker — only when there's no live subscription */}
      {!liveSub && (
        <div>
          {plans.length === 0 ? (
            <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">
              No plans are available right now. Check back soon.
            </p>
          ) : (
            <>
              <div className="mb-5 max-w-md">
                <Label htmlFor="billing-phone" className="text-sm font-semibold">
                  Billing phone
                </Label>
                <Input
                  id="billing-phone"
                  type="tel"
                  placeholder="e.g. +374 XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-basalt/45">Required by our payment provider to set up recurring billing.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {plans.map((plan) => {
                  const selected = pickPlan === plan.id;
                  const perListing = plan.pricingMode === "per_listing";
                  const total = perListing ? plan.amountCents * listingCount : plan.amountCents;
                  const noListings = perListing && listingCount < 1;
                  return (
                    <div key={plan.id} className={`flex flex-col border p-6 transition-colors ${selected ? "border-apricot" : "border-basalt/12"}`}>
                      <h3 className="font-display text-2xl">{plan.name}</h3>
                      {perListing ? (
                        <>
                          <p className="mt-1 font-display text-3xl tabular-nums">
                            {format(plan.amountCents)}
                            <span className="text-base font-normal text-basalt/50"> / listing / month</span>
                          </p>
                          <p className="mt-1 text-sm text-basalt/60">
                            You have {listingCount} listing{listingCount === 1 ? "" : "s"} →{" "}
                            <span className="font-semibold text-basalt">{format(total)} / month</span>
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 font-display text-3xl tabular-nums">
                          {format(plan.amountCents)}
                          <span className="text-base font-normal text-basalt/50"> / month</span>
                        </p>
                      )}
                      {plan.description && <p className="mt-3 text-sm leading-6 text-basalt/65 whitespace-pre-line">{plan.description}</p>}
                      {plan.commissionPercent != null && (
                        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-[#1f7a4d]">
                          <Check className="h-4 w-4 shrink-0" />
                          {plan.commissionPercent === 0 ? "0% booking commission" : `${plan.commissionPercent}% booking commission`}
                          {defaultCommission != null && plan.commissionPercent < defaultCommission && (
                            <span className="font-normal text-basalt/45">vs {defaultCommission}% standard</span>
                          )}
                        </p>
                      )}
                      <div className="flex-1" />
                      <Button
                        className="mt-5"
                        disabled={busyPlan === plan.id || noListings}
                        onClick={() => {
                          setPickPlan(plan.id);
                          subscribe(plan.id);
                        }}
                      >
                        {busyPlan === plan.id ? (
                          <>
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Starting…
                          </>
                        ) : (
                          <>
                            <CreditCard className="mr-1.5 h-4 w-4" /> Subscribe
                          </>
                        )}
                      </Button>
                      {noListings && <p className="mt-2 text-xs text-basalt/50">Publish a listing first — this plan bills per listing.</p>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
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
