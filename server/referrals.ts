/**
 * Referral program server logic (service-role). Operators refer operators; the
 * referrer earns account credit when the referred operator's first booking is
 * confirmed. The `referrals` table is the ledger (pending → qualified → paid).
 *
 * All writes go through here with the service-role client — RLS grants no client
 * write, so a referral can't be forged or self-marked paid. Deliberately decoupled
 * from the PayLink/payout path: qualifying a referral never alters a booking,
 * the guest charge, or the operator payout.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_REFERRAL_REWARD_CENTS, generateReferralCode, normalizeReferralCode, type ReferralSummary } from "../shared/referrals.js";
import { sendReferralReward } from "./email.js";

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");

export function referralLink(code: string): string {
  return `${SITE()}/r/${code}`;
}

async function readConfig(admin: SupabaseClient): Promise<{ enabled: boolean; rewardCents: number }> {
  // select("*") so a not-yet-run 0089 migration doesn't break the read.
  const { data } = await admin.from("site_settings").select("*").maybeSingle();
  const row = data as Record<string, unknown> | null;
  const enabled = row?.referral_enabled === undefined ? true : row.referral_enabled !== false;
  const rewardCents = typeof row?.referral_reward_cents === "number" ? (row.referral_reward_cents as number) : DEFAULT_REFERRAL_REWARD_CENTS;
  return { enabled, rewardCents };
}

/** Return this user's referral code, generating + persisting one if needed. */
export async function ensureReferralCode(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
  const existing = (data as { referral_code?: string | null } | null)?.referral_code;
  if (existing) return existing;
  // Generate + persist, retrying on the unique collision (rare).
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateReferralCode(6);
    const { error } = await admin.from("profiles").update({ referral_code: code }).eq("id", userId);
    if (!error) return code;
    if (error.code !== "23505") throw new Error(error.message); // not a collision → real error
    // On a collision, re-check in case a concurrent call set ours.
    const { data: again } = await admin.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
    const now = (again as { referral_code?: string | null } | null)?.referral_code;
    if (now) return now;
  }
  throw new Error("Couldn't generate a referral code.");
}

/** Full referral summary for the operator's "Refer & earn" page. */
export async function getReferralSummary(admin: SupabaseClient, userId: string): Promise<ReferralSummary> {
  const [{ enabled, rewardCents }, code] = await Promise.all([readConfig(admin), ensureReferralCode(admin, userId)]);
  const { data } = await admin
    .from("referrals")
    .select("id,status,reward_cents,currency,created_at,qualified_at,paid_at")
    .eq("referrer_id", userId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Array<{ id: string; status: string; reward_cents: number; currency: string; created_at: string; qualified_at: string | null; paid_at: string | null }>;
  const referrals = rows.map((r) => ({
    id: r.id,
    status: r.status as ReferralSummary["referrals"][number]["status"],
    rewardCents: r.reward_cents,
    currency: r.currency,
    createdAt: r.created_at,
    qualifiedAt: r.qualified_at,
    paidAt: r.paid_at,
  }));
  const invited = referrals.filter((r) => r.status === "pending").length;
  const qualified = referrals.filter((r) => r.status === "qualified").length;
  const paid = referrals.filter((r) => r.status === "paid").length;
  const owedCents = referrals.filter((r) => r.status === "qualified").reduce((s, r) => s + r.rewardCents, 0);
  const paidCents = referrals.filter((r) => r.status === "paid").reduce((s, r) => s + r.rewardCents, 0);
  return {
    enabled,
    code,
    link: referralLink(code),
    rewardCents,
    currency: "AMD",
    stats: { invited, qualified, paid, owedCents, paidCents },
    referrals,
  };
}

export interface AttachResult {
  ok: boolean;
  reason?: "disabled" | "not_operator" | "unknown_code" | "self" | "already_referred" | "referrer_not_operator" | "error";
}

/**
 * Link a newly-signed-up operator (`referredId`) to the operator who owns `code`.
 * Idempotent-ish: a second call for an already-referred user returns
 * already_referred. All guard rails enforced here (self, role, unknown code).
 */
export async function attachReferral(admin: SupabaseClient, referredId: string, rawCode: string): Promise<AttachResult> {
  const { enabled } = await readConfig(admin);
  if (!enabled) return { ok: false, reason: "disabled" };
  const code = normalizeReferralCode(rawCode);
  if (!code) return { ok: false, reason: "unknown_code" };

  // The referred account must be an operator (operator-refers-operator program).
  const { data: referred } = await admin.from("profiles").select("role").eq("id", referredId).maybeSingle();
  if ((referred as { role?: string } | null)?.role !== "operator") return { ok: false, reason: "not_operator" };

  // Already referred? (unique(referred_id) also enforces this at the DB level.)
  const { data: existing } = await admin.from("referrals").select("id").eq("referred_id", referredId).maybeSingle();
  if (existing) return { ok: false, reason: "already_referred" };

  // Resolve the code → referrer, who must themselves be an operator and not self.
  const { data: referrer } = await admin.from("profiles").select("id,role").eq("referral_code", code).maybeSingle();
  const ref = referrer as { id: string; role: string } | null;
  if (!ref) return { ok: false, reason: "unknown_code" };
  if (ref.id === referredId) return { ok: false, reason: "self" };
  if (ref.role !== "operator") return { ok: false, reason: "referrer_not_operator" };

  const { error } = await admin.from("referrals").insert({ referrer_id: ref.id, referred_id: referredId, code, status: "pending" });
  if (error) {
    if (error.code === "23505") return { ok: false, reason: "already_referred" }; // raced another insert
    console.error("[referrals] attach insert failed", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

/**
 * Called from the booking-confirm side effects: if this operator was referred
 * and their referral is still pending, qualify it (this is their first confirmed
 * booking) and snapshot the reward. Best-effort — NEVER throws, so it can't
 * affect the confirmation. Emails the referrer.
 */
export async function qualifyReferralForOperator(admin: SupabaseClient, operatorId: string, bookingId: string): Promise<void> {
  try {
    const { data } = await admin.from("referrals").select("id,referrer_id").eq("referred_id", operatorId).eq("status", "pending").maybeSingle();
    const ref = data as { id: string; referrer_id: string } | null;
    if (!ref) return;
    const { enabled, rewardCents } = await readConfig(admin);
    if (!enabled) return; // program paused → leave it pending; it can qualify later

    // Guarded on status='pending' so concurrent confirms can't double-award.
    const { data: updated } = await admin
      .from("referrals")
      .update({ status: "qualified", reward_cents: rewardCents, qualifying_booking_id: bookingId, qualified_at: new Date().toISOString() })
      .eq("id", ref.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!updated) return; // someone else qualified it first

    // Notify the referrer (best-effort).
    const { data: u } = await admin.auth.admin.getUserById(ref.referrer_id);
    const email = u?.user?.email;
    if (email) await sendReferralReward(email, { rewardCents, currency: "AMD" });
  } catch (err) {
    console.error("[referrals] qualify failed (non-fatal)", err);
  }
}

/* ── Admin ───────────────────────────────────────────────────────────────── */

export async function listAllReferrals(admin: SupabaseClient): Promise<{ referrals: unknown[]; config: { enabled: boolean; rewardCents: number }; totals: { owedCents: number; paidCents: number } }> {
  const [{ data }, config] = await Promise.all([
    admin
      .from("referrals")
      .select("id,status,reward_cents,currency,created_at,qualified_at,paid_at,referrer:referrer_id(display_name,business_name),referred:referred_id(display_name,business_name)")
      .order("created_at", { ascending: false }),
    readConfig(admin),
  ]);
  const rows = (data ?? []) as Array<{ status: string; reward_cents: number }>;
  const owedCents = rows.filter((r) => r.status === "qualified").reduce((s, r) => s + r.reward_cents, 0);
  const paidCents = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.reward_cents, 0);
  return { referrals: data ?? [], config, totals: { owedCents, paidCents } };
}

export async function markReferralPaid(admin: SupabaseClient, referralId: string): Promise<boolean> {
  const { data } = await admin
    .from("referrals")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", referralId)
    .eq("status", "qualified")
    .select("id")
    .maybeSingle();
  return !!data;
}

export async function setReferralConfig(admin: SupabaseClient, patch: { enabled?: boolean; rewardCents?: number }): Promise<void> {
  const update: Record<string, unknown> = {};
  if (typeof patch.enabled === "boolean") update.referral_enabled = patch.enabled;
  if (typeof patch.rewardCents === "number" && patch.rewardCents >= 0) update.referral_reward_cents = Math.round(patch.rewardCents);
  if (Object.keys(update).length === 0) return;
  // site_settings is a single row; update the first (there is only one).
  const { data } = await admin.from("site_settings").select("id").limit(1).maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (id) await admin.from("site_settings").update(update).eq("id", id);
}
