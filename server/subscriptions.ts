/**
 * Operator subscriptions — the recurring-billing analog of server/bookings.ts.
 * Sits between server/paylink.ts (the PayLink Subscription/Person API) and the
 * DB, so "register the plan, enroll the operator, verify server-side, then flip
 * to active" lives in one place. Used by the /api/subscription/* routes and the
 * reconcile cron.
 *
 * Model: a `subscription_plans` row is mirrored as a PayLink *Subscription*
 * (the plan). Each operator is a PayLink *Person* who enrolls via a hosted
 * payment link and is then charged monthly automatically. PayLink has no
 * webhook, so we POLL Subscription/Search to confirm — exactly like the booking
 * loop. All writes use the service-role client (RLS grants operators read-only).
 * Money is AMD; *_cents columns are AMD hundredths (AMD has no minor unit, so
 * PayLink is charged whole drams).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerSubscription, ensurePerson, getPersonSubscription, terminatePersonSubscription, updateSubscriptionAmount } from "./paylink.js";
import { DEFAULT_CURRENCY, PLATFORM_COMMISSION_PERCENT } from "../shared/bookings.js";

export interface PlanRow {
  id: string;
  name: string;
  description: string;
  amount_cents: number; // flat: fixed price; per_listing: unit price per listing
  months_quantity: number;
  currency: string;
  pricing_mode: "flat" | "per_listing";
  paylink_subscription_id: number | null;
  paylink_request_id: string | null;
  request_url: string | null;
  is_active: boolean;
}

/** Listing types that count toward a per-listing subscription fee (eat = the
 *  free curated guide, never billed). */
const BILLABLE_TYPES = ["stay", "tour", "experience"];

export interface OperatorSubscriptionRow {
  id: string;
  operator_id: string;
  plan_id: string;
  status: string;
  paylink_person_id: number | null;
  paylink_subscription_id: number | null;
  phone: string | null;
}

const PLAN_COLS = "id, name, description, amount_cents, months_quantity, currency, pricing_mode, paylink_subscription_id, paylink_request_id, request_url, is_active";

/** PayLink's `amount` is major currency units; AMD has no minor unit. */
function toMajorUnits(cents: number, currency: string): number {
  return currency === "AMD" ? Math.round(cents / 100) : cents / 100;
}

/** PayLink rejects a first-payment day in the past; use tomorrow (UTC midday). */
function firstPaymentDayIso(): string {
  return `${new Date(Date.now() + 24 * 3_600_000).toISOString().slice(0, 10)}T12:00:00.000Z`;
}

/** Count an operator's billable (stay/tour/experience) PUBLISHED listings —
 *  what a per-listing plan charges for. */
export async function countBillableListings(admin: SupabaseClient, operatorId: string): Promise<number> {
  const { count } = await admin
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("operator_id", operatorId)
    .eq("status", "published")
    .in("type", BILLABLE_TYPES);
  return count ?? 0;
}

/**
 * Ensure a plan is registered with PayLink (has a subscription id). Registers it
 * on first use and persists the returned id + hosted subscribe URL. Idempotent.
 */
export async function ensurePlanRegistered(admin: SupabaseClient, plan: PlanRow): Promise<PlanRow> {
  // per_listing plans are NOT registered globally — each operator gets their own
  // PayLink Subscription at their computed amount (see startOperatorSubscription).
  if (plan.pricing_mode === "per_listing") return plan;
  if (plan.paylink_subscription_id) return plan;
  const site = (process.env.URL || "").replace(/\/+$/, "");
  const reg = await registerSubscription({
    name: plan.name,
    info: plan.description,
    amount: toMajorUnits(plan.amount_cents, plan.currency),
    currency: plan.currency,
    monthsQuantity: plan.months_quantity,
    firstPaymentDay: firstPaymentDayIso(),
    returnUrl: site ? `${site}/dashboard?section=billing&subscription=return` : undefined,
  });
  if (!reg.subscriptionId) throw new Error("PayLink didn't return a subscription id.");
  const { data } = await admin
    .from("subscription_plans")
    .update({ paylink_subscription_id: reg.subscriptionId, paylink_request_id: reg.requestId, request_url: reg.requestUrl })
    .eq("id", plan.id)
    .select(PLAN_COLS)
    .maybeSingle();
  return (data as PlanRow) ?? { ...plan, paylink_subscription_id: reg.subscriptionId, paylink_request_id: reg.requestId, request_url: reg.requestUrl };
}

export interface StartResult {
  redirectUrl?: string;
  alreadyActive?: boolean;
}

/**
 * Begin (or resume) an operator's enrollment in a plan. Ensures the plan is
 * registered + the operator has a PayLink Person, looks up their hosted payment
 * link, and upserts a `pending` operator_subscriptions row. Returns the hosted
 * link to redirect the operator to (or alreadyActive if they're already paying).
 */
export async function startOperatorSubscription(
  admin: SupabaseClient,
  { operatorId, planId, email, phone, firstName, lastName }: { operatorId: string; planId: string; email: string; phone: string; firstName?: string; lastName?: string },
): Promise<StartResult> {
  const { data: planRow } = await admin.from("subscription_plans").select(PLAN_COLS).eq("id", planId).eq("is_active", true).maybeSingle();
  if (!planRow) throw new Error("Plan not found.");
  const plan = planRow as PlanRow;

  const personId = await ensurePerson({ email, mobile: phone, firstName, lastName });
  if (personId == null) throw new Error("Couldn't set up billing for your account. Check the phone number and try again.");

  // Resolve the PayLink subscription id + the operator's monthly amount for this
  // plan. Flat: one shared subscription at the plan price. Per-listing: a
  // dedicated subscription for this operator at unit × their listing count.
  let subId: number;
  let quantity: number | null = null;
  let amountCents = plan.amount_cents;
  let requestUrlFallback: string | null = null;

  if (plan.pricing_mode === "per_listing") {
    const count = await countBillableListings(admin, operatorId);
    if (count < 1) throw new Error("Publish at least one listing before subscribing — this plan bills per listing.");
    quantity = count;
    amountCents = plan.amount_cents * count;
    const site = (process.env.URL || "").replace(/\/+$/, "");
    const label = (firstName || email).slice(0, 40);
    const reg = await registerSubscription({
      name: `${plan.name} · ${label}`,
      info: `${count} listing${count === 1 ? "" : "s"} · ${plan.description}`.slice(0, 250),
      amount: toMajorUnits(amountCents, plan.currency),
      currency: plan.currency,
      monthsQuantity: plan.months_quantity,
      firstPaymentDay: firstPaymentDayIso(),
      returnUrl: site ? `${site}/dashboard?section=billing&subscription=return` : undefined,
    });
    if (!reg.subscriptionId) throw new Error("PayLink didn't return a subscription id.");
    subId = reg.subscriptionId;
    requestUrlFallback = reg.requestUrl;
  } else {
    const registered = await ensurePlanRegistered(admin, plan);
    if (!registered.paylink_subscription_id) throw new Error("This plan isn't set up with PayLink yet.");
    subId = registered.paylink_subscription_id;
    requestUrlFallback = registered.request_url;
  }

  const state = await getPersonSubscription({ personId, subscriptionId: subId });

  // Upsert the enrollment row (pending until PayLink reports the person subscribed).
  await admin.from("operator_subscriptions").upsert(
    {
      operator_id: operatorId,
      plan_id: planId,
      status: state.isSubscribed ? "active" : "pending",
      paylink_person_id: personId,
      paylink_subscription_id: subId,
      quantity,
      amount_cents: amountCents,
      phone,
      ...(state.isSubscribed ? { started_at: new Date().toISOString() } : {}),
    },
    { onConflict: "operator_id,plan_id" },
  );

  if (state.isSubscribed) return { alreadyActive: true };
  // Prefer the person-specific payment link; fall back to the hosted URL.
  const redirectUrl = state.paymentLink || requestUrlFallback || undefined;
  if (!redirectUrl) throw new Error("Couldn't get a payment link from PayLink.");
  return { redirectUrl };
}

/** Poll one operator subscription against PayLink; flip pending→active when the
 *  person is subscribed. Returns whether it is (now) active. */
export async function confirmOperatorSubscriptionRow(admin: SupabaseClient, row: OperatorSubscriptionRow): Promise<boolean> {
  if (row.status === "active") return true;
  if (row.paylink_person_id == null || row.paylink_subscription_id == null) return false;
  const state = await getPersonSubscription({ personId: row.paylink_person_id, subscriptionId: row.paylink_subscription_id });
  if (!state.isSubscribed) return false;
  await admin
    .from("operator_subscriptions")
    .update({ status: "active", started_at: new Date().toISOString(), last_payment_at: new Date().toISOString(), last_error: null })
    .eq("id", row.id)
    .in("status", ["pending", "past_due"]);
  return true;
}

/** Confirm all of one operator's pending subscriptions (on return / dashboard load). */
export async function reconcileOperatorSubscriptions(admin: SupabaseClient, operatorId: string): Promise<{ activated: number; pending: number }> {
  const { data } = await admin
    .from("operator_subscriptions")
    .select("id, operator_id, plan_id, status, paylink_person_id, paylink_subscription_id, phone")
    .eq("operator_id", operatorId)
    .in("status", ["pending", "past_due"]);
  const rows = (data as OperatorSubscriptionRow[]) ?? [];
  let activated = 0;
  for (const row of rows) {
    try {
      if (await confirmOperatorSubscriptionRow(admin, row)) activated++;
    } catch (err) {
      console.error("[subscriptions] confirm failed", row.id, err);
    }
  }
  return { activated, pending: rows.length - activated };
}

/** Global sweep for the cron: confirm pending enrollments where the operator
 *  paid but never returned to the redirect. Caps the batch. */
export async function reconcileAllSubscriptions(admin: SupabaseClient, { limit = 200 }: { limit?: number } = {}): Promise<{ polled: number; activated: number }> {
  const { data } = await admin
    .from("operator_subscriptions")
    .select("id, operator_id, plan_id, status, paylink_person_id, paylink_subscription_id, phone")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  const rows = (data as OperatorSubscriptionRow[]) ?? [];
  let activated = 0;
  for (const row of rows) {
    try {
      if (await confirmOperatorSubscriptionRow(admin, row)) activated++;
    } catch (err) {
      console.error("[subscriptions] reconcile row failed", row.id, err);
    }
  }
  return { polled: rows.length, activated };
}

/**
 * Recompute per-listing subscription amounts. For each ACTIVE per_listing
 * enrollment whose operator's billable listing count has changed, patch the
 * PayLink subscription's amount (applies to the NEXT scheduled charge) and store
 * the new quantity + amount. Runs on the reconcile cron. Cheap: only drifted
 * rows call PayLink.
 */
export async function reconcilePerListingAmounts(admin: SupabaseClient, { limit = 500 }: { limit?: number } = {}): Promise<{ checked: number; updated: number }> {
  const { data } = await admin
    .from("operator_subscriptions")
    .select("id, operator_id, quantity, amount_cents, paylink_subscription_id, subscription_plans!inner(name, description, amount_cents, months_quantity, currency, pricing_mode)")
    .eq("status", "active")
    .limit(limit);
  const rows = (data ?? []) as unknown as {
    id: string;
    operator_id: string;
    quantity: number | null;
    amount_cents: number | null;
    paylink_subscription_id: number | null;
    subscription_plans: { name: string; description: string; amount_cents: number; months_quantity: number; currency: string; pricing_mode: string } | null;
  }[];
  let updated = 0;
  let checked = 0;
  for (const row of rows) {
    const plan = row.subscription_plans;
    if (!plan || plan.pricing_mode !== "per_listing" || row.paylink_subscription_id == null) continue;
    checked++;
    try {
      const count = await countBillableListings(admin, row.operator_id);
      if (count < 1 || count === row.quantity) continue; // no change (or 0 → keep last, admin handles)
      const amountCents = plan.amount_cents * count;
      const ok = await updateSubscriptionAmount({
        subscriptionId: row.paylink_subscription_id,
        name: plan.name,
        info: `${count} listing${count === 1 ? "" : "s"} · ${plan.description}`.slice(0, 250),
        amount: toMajorUnits(amountCents, plan.currency),
        currency: plan.currency,
        monthsQuantity: plan.months_quantity,
        firstPaymentDay: firstPaymentDayIso(),
      });
      if (ok) {
        await admin.from("operator_subscriptions").update({ quantity: count, amount_cents: amountCents }).eq("id", row.id);
        updated++;
      }
    } catch (err) {
      console.error("[subscriptions] per-listing recompute failed", row.id, err);
    }
  }
  return { checked, updated };
}

/**
 * Resolve the per-booking commission rate (%) that applies to an operator's
 * payout, for the "operator's choice" model: if they have an ACTIVE subscription
 * whose plan sets a commission_percent, that rate wins; otherwise the site-wide
 * default for non-subscribers (site_settings.default_commission_percent), and
 * finally the hard-coded standard rate. Called at booking confirm — affects the
 * operator payout split only, never the guest charge.
 */
export async function resolveOperatorCommissionPercent(admin: SupabaseClient, operatorId: string): Promise<number> {
  try {
    const { data: sub } = await admin
      .from("operator_subscriptions")
      .select("status, subscription_plans!inner(commission_percent)")
      .eq("operator_id", operatorId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    const planPct = (sub as { subscription_plans?: { commission_percent?: number | string | null } } | null)?.subscription_plans?.commission_percent;
    if (planPct != null && Number.isFinite(Number(planPct))) return Number(planPct);
  } catch {
    /* fall through to the default */
  }
  try {
    const { data: settings } = await admin.from("site_settings").select("default_commission_percent").eq("id", 1).maybeSingle();
    const def = (settings as { default_commission_percent?: number | string | null } | null)?.default_commission_percent;
    if (def != null && Number.isFinite(Number(def))) return Number(def);
  } catch {
    /* fall through to the constant */
  }
  return PLATFORM_COMMISSION_PERCENT;
}

/** Cancel an operator's subscription: terminate at PayLink, then mark cancelled. */
export async function cancelOperatorSubscription(admin: SupabaseClient, { operatorId, rowId }: { operatorId: string; rowId: string }): Promise<boolean> {
  const { data } = await admin
    .from("operator_subscriptions")
    .select("id, operator_id, plan_id, status, paylink_person_id, paylink_subscription_id, phone")
    .eq("id", rowId)
    .eq("operator_id", operatorId)
    .maybeSingle();
  const row = data as OperatorSubscriptionRow | null;
  if (!row) return false;
  if (row.paylink_person_id != null && row.paylink_subscription_id != null) {
    try {
      await terminatePersonSubscription({ personId: row.paylink_person_id, subscriptionId: row.paylink_subscription_id });
    } catch (err) {
      console.error("[subscriptions] terminate at PayLink failed", row.id, err);
      // Still mark cancelled locally — the operator asked to stop; a lingering
      // PayLink schedule is surfaced to the admin, not silently billed forever.
    }
  }
  const { data: upd } = await admin
    .from("operator_subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("operator_id", operatorId)
    .select("id");
  return !!(upd && upd.length);
}

export { DEFAULT_CURRENCY };
