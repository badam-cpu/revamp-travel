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
import { registerSubscription, ensurePerson, getPersonSubscription, terminatePersonSubscription } from "./paylink.js";
import { DEFAULT_CURRENCY } from "../shared/bookings.js";

export interface PlanRow {
  id: string;
  name: string;
  description: string;
  amount_cents: number;
  months_quantity: number;
  currency: string;
  paylink_subscription_id: number | null;
  paylink_request_id: string | null;
  request_url: string | null;
  is_active: boolean;
}

export interface OperatorSubscriptionRow {
  id: string;
  operator_id: string;
  plan_id: string;
  status: string;
  paylink_person_id: number | null;
  paylink_subscription_id: number | null;
  phone: string | null;
}

const PLAN_COLS = "id, name, description, amount_cents, months_quantity, currency, paylink_subscription_id, paylink_request_id, request_url, is_active";

/** PayLink's `amount` is major currency units; AMD has no minor unit. */
function toMajorUnits(cents: number, currency: string): number {
  return currency === "AMD" ? Math.round(cents / 100) : cents / 100;
}

/**
 * Ensure a plan is registered with PayLink (has a subscription id). Registers it
 * on first use and persists the returned id + hosted subscribe URL. Idempotent.
 */
export async function ensurePlanRegistered(admin: SupabaseClient, plan: PlanRow): Promise<PlanRow> {
  if (plan.paylink_subscription_id) return plan;
  const site = (process.env.URL || "").replace(/\/+$/, "");
  const reg = await registerSubscription({
    name: plan.name,
    info: plan.description,
    amount: toMajorUnits(plan.amount_cents, plan.currency),
    currency: plan.currency,
    monthsQuantity: plan.months_quantity,
    firstPaymentDay: new Date().toISOString(),
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
  const plan = await ensurePlanRegistered(admin, planRow as PlanRow);
  const subId = plan.paylink_subscription_id!;

  const personId = await ensurePerson({ email, mobile: phone, firstName, lastName });
  if (personId == null) throw new Error("Couldn't set up billing for your account. Check the phone number and try again.");

  const state = await getPersonSubscription({ personId, subscriptionId: subId });

  // Upsert the enrollment row (pending until PayLink reports the person subscribed).
  await admin.from("operator_subscriptions").upsert(
    {
      operator_id: operatorId,
      plan_id: planId,
      status: state.isSubscribed ? "active" : "pending",
      paylink_person_id: personId,
      paylink_subscription_id: subId,
      phone,
      ...(state.isSubscribed ? { started_at: new Date().toISOString() } : {}),
    },
    { onConflict: "operator_id,plan_id" },
  );

  if (state.isSubscribed) return { alreadyActive: true };
  // Prefer the person-specific payment link; fall back to the plan's hosted URL.
  const redirectUrl = state.paymentLink || plan.request_url || undefined;
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
