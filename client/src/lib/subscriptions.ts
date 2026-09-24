/**
 * Operator subscriptions (recurring platform billing) — client reads + server
 * calls. Plans and an operator's own enrollment rows are read straight from
 * Supabase under RLS (operators read active plans + their own subscription);
 * every state-changing call goes through the server (holds PayLink creds).
 */
import { supabase } from "@/lib/supabase";
import { ApiError } from "@/lib/api";

export type SubscriptionStatus = "pending" | "active" | "past_due" | "cancelled" | "expired";

export type PricingMode = "flat" | "per_listing";

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  amountCents: number; // flat: fixed price; per_listing: unit price per listing
  monthsQuantity: number;
  currency: string;
  pricingMode: PricingMode;
  commissionPercent: number | null; // rate subscribers pay; null = site default
  isActive: boolean;
  sort: number;
  paylinkSubscriptionId: number | null;
}

export interface OperatorSubscription {
  id: string;
  operatorId: string;
  planId: string;
  status: SubscriptionStatus;
  phone: string | null;
  quantity: number | null;
  amountCents: number | null;
  nextChargeDate: string | null;
  lastPaymentAt: string | null;
  startedAt: string | null;
  cancelledAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPlan(r: any): SubscriptionPlan {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    amountCents: r.amount_cents ?? 0,
    monthsQuantity: r.months_quantity ?? 12,
    currency: r.currency ?? "AMD",
    pricingMode: (r.pricing_mode as PricingMode) ?? "flat",
    commissionPercent: r.commission_percent == null ? null : Number(r.commission_percent),
    isActive: !!r.is_active,
    sort: r.sort ?? 0,
    paylinkSubscriptionId: r.paylink_subscription_id ?? null,
  };
}
function mapSub(r: any): OperatorSubscription {
  return {
    id: r.id,
    operatorId: r.operator_id,
    planId: r.plan_id,
    status: r.status,
    phone: r.phone ?? null,
    quantity: r.quantity ?? null,
    amountCents: r.amount_cents ?? null,
    nextChargeDate: r.next_charge_date ?? null,
    lastPaymentAt: r.last_payment_at ?? null,
    startedAt: r.started_at ?? null,
    cancelledAt: r.cancelled_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const PLAN_COLS = "id, name, description, amount_cents, months_quantity, currency, pricing_mode, commission_percent, is_active, sort, paylink_subscription_id";
const SUB_COLS = "id, operator_id, plan_id, status, phone, quantity, amount_cents, next_charge_date, last_payment_at, started_at, cancelled_at";

/** Active plans (operator-facing). RLS returns only active ones to non-admins. */
export async function listActivePlans(): Promise<SubscriptionPlan[]> {
  const { data, error } = await supabase.from("subscription_plans").select(PLAN_COLS).eq("is_active", true).order("sort").order("amount_cents");
  if (error) throw new ApiError(error.message);
  return (data ?? []).map(mapPlan);
}

/** All plans incl. archived (admin — RLS gates this to admins). */
export async function listAllPlans(): Promise<SubscriptionPlan[]> {
  const { data, error } = await supabase.from("subscription_plans").select(PLAN_COLS).order("sort").order("amount_cents");
  if (error) throw new ApiError(error.message);
  return (data ?? []).map(mapPlan);
}

/** The signed-in operator's own subscription rows. */
export async function listMySubscriptions(): Promise<OperatorSubscription[]> {
  const { data, error } = await supabase.from("operator_subscriptions").select(SUB_COLS);
  if (error) throw new ApiError(error.message);
  return (data ?? []).map(mapSub);
}

/** Every operator subscription + the operator's name (admin — RLS gates it). */
export interface AdminSubscriptionRow extends OperatorSubscription {
  operatorName: string;
  planName: string;
}
export async function listAllSubscriptions(): Promise<AdminSubscriptionRow[]> {
  const { data, error } = await supabase
    .from("operator_subscriptions")
    .select(`${SUB_COLS}, profiles!operator_subscriptions_operator_id_fkey(display_name, business_name), subscription_plans(name)`)
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => ({
    ...mapSub(r),
    operatorName: (r.profiles?.display_name || r.profiles?.business_name || "Operator").trim(),
    planName: r.subscription_plans?.name || "Plan",
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Sign in.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: await authHeader(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json?.error || "Something went wrong. Please try again.");
  return json as T;
}

/** Admin: create/update a plan (also registers it with PayLink). */
export function saveSubscriptionPlan(input: {
  id?: string;
  name: string;
  description?: string;
  amountCents: number;
  monthsQuantity?: number;
  pricingMode?: PricingMode;
  commissionPercent?: number | null;
  isActive?: boolean;
  sort?: number;
}): Promise<{ ok: boolean; id: string; paylinkSynced: boolean; paylinkError?: string | null }> {
  return post("/api/admin-subscription-plan", input);
}

/** The site-wide default commission (%) for operators WITHOUT an active
 *  subscription. Public-read (site_settings); admin-write via RLS. */
export async function getDefaultCommissionPercent(): Promise<number> {
  const { data } = await supabase.from("site_settings").select("default_commission_percent").eq("id", 1).maybeSingle();
  const v = (data as { default_commission_percent?: number | string | null } | null)?.default_commission_percent;
  return v == null ? 12.5 : Number(v);
}

/** Admin-only (RLS): set the default non-subscriber commission (%). */
export async function setDefaultCommissionPercent(percent: number): Promise<void> {
  const { error } = await supabase.from("site_settings").update({ default_commission_percent: percent }).eq("id", 1);
  if (error) throw new ApiError(error.message);
}

/** Operator: begin/resume enrollment. Returns a hosted redirect URL or alreadyActive. */
export function startSubscription(planId: string, phone: string): Promise<{ redirectUrl?: string; alreadyActive?: boolean }> {
  return post("/api/subscription/start", { planId, phone });
}

/** Poll PayLink for the operator's pending enrollments (on return / load). */
export function confirmSubscriptions(): Promise<{ activated: number; pending: number }> {
  return post("/api/subscription/confirm", {});
}

/** Cancel a subscription (operator's own, or any for an admin). */
export function cancelSubscription(rowId: string): Promise<{ ok: boolean }> {
  return post("/api/subscription/cancel", { rowId });
}
