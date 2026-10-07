/**
 * Client API for the referral program (operators refer operators). Thin authed
 * fetch wrappers around /api/referral/*; types are shared with the server via
 * @shared/referrals.
 */
import { supabase } from "@/lib/supabase";
import { ApiError } from "@/lib/api";
import type { ReferralSummary } from "@shared/referrals";

export type { ReferralSummary } from "@shared/referrals";

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new ApiError("Sign in.");
  return t;
}

async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  const t = await token();
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, ...(init?.headers || {}) } });
  } catch {
    throw new ApiError("We couldn't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error || "Something went wrong. Please try again.");
  return body as T;
}

/* Referral-code capture: a ?ref= param or /r/:code link stashes the code here
 * until a new operator finishes signing up, then Dashboard attaches it. */
export const REF_STORAGE_KEY = "revamp:ref";
export function storeReferralCode(code: string): void {
  try {
    if (code.trim()) localStorage.setItem(REF_STORAGE_KEY, code.trim());
  } catch {
    /* private mode / blocked storage — attribution is best-effort */
  }
}
export function getStoredReferralCode(): string | null {
  try {
    return localStorage.getItem(REF_STORAGE_KEY);
  } catch {
    return null;
  }
}
export function clearStoredReferralCode(): void {
  try {
    localStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function fetchMyReferral(): Promise<ReferralSummary> {
  return authed<ReferralSummary>("/api/referral/me");
}

/** Attach the signed-in new operator to a referral code. Soft result (never throws on a bad code). */
export function attachReferral(code: string): Promise<{ ok: boolean; reason?: string }> {
  return authed<{ ok: boolean; reason?: string }>("/api/referral/attach", { method: "POST", body: JSON.stringify({ code }) });
}

export interface AdminReferralRow {
  id: string;
  status: "pending" | "qualified" | "paid" | "void";
  reward_cents: number;
  currency: string;
  created_at: string;
  qualified_at: string | null;
  paid_at: string | null;
  referrer: { display_name: string | null; business_name: string | null } | null;
  referred: { display_name: string | null; business_name: string | null } | null;
}
export interface AdminReferralData {
  referrals: AdminReferralRow[];
  config: { enabled: boolean; rewardCents: number };
  totals: { owedCents: number; paidCents: number };
}

export function adminListReferrals(): Promise<AdminReferralData> {
  return authed<AdminReferralData>("/api/referral/admin");
}

export function adminPayReferral(referralId: string): Promise<{ ok: boolean }> {
  return authed<{ ok: boolean }>("/api/referral/admin-pay", { method: "POST", body: JSON.stringify({ referralId }) });
}

export function adminSaveReferralSettings(patch: { enabled?: boolean; rewardCents?: number }): Promise<{ ok: boolean }> {
  return authed<{ ok: boolean }>("/api/referral/admin-settings", { method: "POST", body: JSON.stringify(patch) });
}
