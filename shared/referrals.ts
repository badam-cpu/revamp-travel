/**
 * Referral program shared constants/types (client + server).
 *
 * Operators refer operators; the REFERRER earns account credit when the
 * referred operator's first booking is confirmed (referrer-only). Revamp-funded
 * — it never changes the guest charge or the operator payout. See
 * supabase/migrations/0089_referral_program.sql and server/referrals.ts.
 */

/** Fallback reward if site_settings hasn't been configured yet: 15,000 AMD. */
export const DEFAULT_REFERRAL_REWARD_CENTS = 1_500_000;

export type ReferralStatus = "pending" | "qualified" | "paid" | "void";

export interface ReferralRow {
  id: string;
  status: ReferralStatus;
  rewardCents: number;
  currency: string;
  createdAt: string;
  qualifiedAt: string | null;
  paidAt: string | null;
}

export interface ReferralSummary {
  enabled: boolean;
  code: string;
  link: string;
  rewardCents: number;
  currency: string;
  stats: {
    invited: number; // pending (signed up, not yet qualified)
    qualified: number; // earned, not yet paid
    paid: number;
    owedCents: number; // sum of qualified rewards awaiting payout
    paidCents: number;
  };
  referrals: ReferralRow[];
}

/** Characters used for generated codes — no ambiguous 0/O/1/I/L. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A short, human-friendly referral code, e.g. "K7M4PQ". */
export function generateReferralCode(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** Normalize a user-typed code (trim, upper, strip spaces/dashes). */
export function normalizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
